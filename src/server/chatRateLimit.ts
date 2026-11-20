import { AiRuntimeConfig, getAiRuntimeConfig } from './chatTypes';

export interface RateLimitCheckResult {
  allowed: boolean;
  statusCode?: number;
  retryAfterSec?: number;
  reason?: 'rate_limit' | 'daily_quota' | 'daily_token_budget' | 'rate_limiter_unavailable';
  store: 'redis' | 'memory' | 'redis-error';
}

const RATE_WINDOW_MINUTE_MS = 60_000;
const RATE_WINDOW_HOUR_MS = 3_600_000;

const ipHits = new Map<string, number[]>();
const dailyGlobalHits = new Map<string, number>();
const dailyGlobalTokens = new Map<string, number>();

export function resetInMemoryRateLimitState() {
  ipHits.clear();
  dailyGlobalHits.clear();
  dailyGlobalTokens.clear();
}

function getUtcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function runUpstashPipeline(
  url: string,
  token: string,
  commands: Array<Array<string | number>>,
  fetchImpl: typeof fetch = fetch
): Promise<Array<{ result?: unknown }> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const resp = await fetchImpl(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands),
      signal: controller.signal
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? (data as Array<{ result?: unknown }>) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkRateLimitShared(
  ip: string,
  options?: {
    config?: AiRuntimeConfig;
    now?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<RateLimitCheckResult> {
  const cfg = options?.config || getAiRuntimeConfig();
  const now = options?.now ?? Date.now();
  const minBucket = Math.floor(now / RATE_WINDOW_MINUTE_MS);
  const hourBucket = Math.floor(now / RATE_WINDOW_HOUR_MS);
  const dayKey = getUtcDayKey(now);

  if (cfg.upstashUrl && cfg.upstashToken) {
    const kMin = `hachihi:rl:m:${ip}:${minBucket}`;
    const kHour = `hachihi:rl:h:${ip}:${hourBucket}`;
    const kDay = `hachihi:rl:daily:${dayKey}`;
    const kTok = `hachihi:rl:tokens:${dayKey}`;

    const res = await runUpstashPipeline(
      cfg.upstashUrl,
      cfg.upstashToken,
      [
        ['INCR', kMin],
        ['EXPIRE', kMin, 70],
        ['INCR', kHour],
        ['EXPIRE', kHour, 3700],
        ['INCR', kDay],
        ['EXPIRE', kDay, 90000],
        ['GET', kTok]
      ],
      options?.fetchImpl
    );

    if (res && res.length >= 7) {
      const minCount = Number(res[0]?.result || 0);
      const hourCount = Number(res[2]?.result || 0);
      const dayCount = Number(res[4]?.result || 0);
      const dayTokens = Number(res[6]?.result || 0);

      if (dayTokens > cfg.dailyTokenBudget) {
        return {
          allowed: false,
          statusCode: 429,
          retryAfterSec: 3600,
          reason: 'daily_token_budget',
          store: 'redis'
        };
      }
      if (dayCount > cfg.dailyQuotaLimit) {
        return {
          allowed: false,
          statusCode: 429,
          retryAfterSec: 3600,
          reason: 'daily_quota',
          store: 'redis'
        };
      }
      if (minCount > cfg.rateLimitPerMinute) {
        return {
          allowed: false,
          statusCode: 429,
          retryAfterSec: Math.max(1, Math.ceil(((minBucket + 1) * RATE_WINDOW_MINUTE_MS - now) / 1000)),
          reason: 'rate_limit',
          store: 'redis'
        };
      }
      if (hourCount > cfg.rateLimitPerHour) {
        return {
          allowed: false,
          statusCode: 429,
          retryAfterSec: Math.max(1, Math.ceil(((hourBucket + 1) * RATE_WINDOW_HOUR_MS - now) / 1000)),
          reason: 'rate_limit',
          store: 'redis'
        };
      }
      return { allowed: true, store: 'redis' };
    }

    // Fail-closed in production or when explicitly enabled so Redis failure cannot bypass cost limits
    if (cfg.failClosedOnRedisError) {
      return {
        allowed: false,
        statusCode: 503,
        retryAfterSec: 30,
        reason: 'rate_limiter_unavailable',
        store: 'redis-error'
      };
    }
  }

  // In-memory rate limit + global daily request & token caps
  const curDayTokens = dailyGlobalTokens.get(dayKey) || 0;
  if (curDayTokens >= cfg.dailyTokenBudget) {
    return {
      allowed: false,
      statusCode: 429,
      retryAfterSec: 3600,
      reason: 'daily_token_budget',
      store: 'memory'
    };
  }

  const curDayTotal = dailyGlobalHits.get(dayKey) || 0;
  if (curDayTotal >= cfg.dailyQuotaLimit) {
    return {
      allowed: false,
      statusCode: 429,
      retryAfterSec: 3600,
      reason: 'daily_quota',
      store: 'memory'
    };
  }

  const prev = (ipHits.get(ip) || []).filter(ts => now - ts < RATE_WINDOW_HOUR_MS);
  const lastMinuteCount = prev.filter(ts => now - ts < RATE_WINDOW_MINUTE_MS).length;

  if (lastMinuteCount >= cfg.rateLimitPerMinute) {
    const oldestInMin = prev.find(ts => now - ts < RATE_WINDOW_MINUTE_MS) || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldestInMin + RATE_WINDOW_MINUTE_MS - now) / 1000));
    ipHits.set(ip, prev);
    return { allowed: false, statusCode: 429, retryAfterSec, reason: 'rate_limit', store: 'memory' };
  }

  if (prev.length >= cfg.rateLimitPerHour) {
    const oldestInHour = prev[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((oldestInHour + RATE_WINDOW_HOUR_MS - now) / 1000));
    ipHits.set(ip, prev);
    return { allowed: false, statusCode: 429, retryAfterSec, reason: 'rate_limit', store: 'memory' };
  }

  prev.push(now);
  ipHits.set(ip, prev);
  dailyGlobalHits.set(dayKey, curDayTotal + 1);

  if (dailyGlobalHits.size > 4) {
    for (const key of dailyGlobalHits.keys()) {
      if (key !== dayKey) dailyGlobalHits.delete(key);
    }
  }
  if (dailyGlobalTokens.size > 4) {
    for (const key of dailyGlobalTokens.keys()) {
      if (key !== dayKey) dailyGlobalTokens.delete(key);
    }
  }
  if (ipHits.size > 2000) {
    for (const [key, list] of ipHits.entries()) {
      const fresh = list.filter(ts => now - ts < RATE_WINDOW_HOUR_MS);
      if (fresh.length === 0) ipHits.delete(key);
      else ipHits.set(key, fresh);
    }
  }

  return { allowed: true, store: 'memory' };
}

export async function recordDailyTokenUsage(
  tokens: number,
  options?: { config?: AiRuntimeConfig; now?: number; fetchImpl?: typeof fetch }
): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const rounded = Math.round(tokens);
  const cfg = options?.config || getAiRuntimeConfig();
  const dayKey = getUtcDayKey(options?.now ?? Date.now());

  if (cfg.upstashUrl && cfg.upstashToken) {
    const kTok = `hachihi:rl:tokens:${dayKey}`;
    await runUpstashPipeline(
      cfg.upstashUrl,
      cfg.upstashToken,
      [
        ['INCRBY', kTok, rounded],
        ['EXPIRE', kTok, 90000]
      ],
      options?.fetchImpl
    );
    return;
  }

  dailyGlobalTokens.set(dayKey, (dailyGlobalTokens.get(dayKey) || 0) + rounded);
}
