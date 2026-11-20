import { extractTrustedClientIp, getSingleHeader, isOriginAllowed } from './chatSecurity';
import { HeaderMap } from './chatTypes';

export type TrackAction = 'visit' | 'template' | 'save' | 'export';

export const VALID_TRACK_ACTIONS = new Set<TrackAction>(['visit', 'template', 'save', 'export']);
export const TRACK_RATE_LIMIT_PER_MIN = 40;
export const TRACK_TIMEOUT_MS = 4000;
export const TRACK_MAX_BODY_BYTES = 8192;

export const SHEET_COLUMNS = [
  'time',
  'ip',
  'Quốc gia',
  'Thành Phố',
  'VisitID',
  'SessionID',
  'Action',
  'detail',
  'device',
  'language',
  'resolution'
] as const;

export interface ValidatedTrackPayload {
  action: TrackAction;
  visitId: string;
  sessionId: string;
  detail: string;
  device: string;
  language: string;
  resolution: string;
}

export interface TrackRequestInput {
  method?: string;
  headers: HeaderMap;
  body: unknown;
  rawByteLength?: number;
  remoteIp?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  allowLocalTestUrl?: boolean;
  now?: Date;
}

export interface TrackRequestResult {
  statusCode: 200;
  body: { ok: true };
  forwarded: boolean;
  skipReason?: string;
}

interface RateWindowEntry {
  windowStartMs: number;
  count: number;
}

const ipRateWindows = new Map<string, RateWindowEntry>();
const RATE_WINDOW_MS = 60_000;

export function resetTrackRateLimiter(): void {
  ipRateWindows.clear();
}

export function checkTrackRateLimit(
  ip: string,
  nowMs: number = Date.now(),
  limitPerMin: number = TRACK_RATE_LIMIT_PER_MIN
): boolean {
  if (ipRateWindows.size > 2000) {
    for (const [key, entry] of ipRateWindows.entries()) {
      if (nowMs - entry.windowStartMs >= RATE_WINDOW_MS) {
        ipRateWindows.delete(key);
      }
    }
  }

  const existing = ipRateWindows.get(ip);
  if (!existing || nowMs - existing.windowStartMs >= RATE_WINDOW_MS) {
    ipRateWindows.set(ip, { windowStartMs: nowMs, count: 1 });
    return true;
  }

  if (existing.count >= limitPerMin) {
    return false;
  }

  existing.count += 1;
  return true;
}

export function formatVietnamTime(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);

    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        map[p.type] = p.value;
      }
    }
    const hh = map.hour === '24' ? '00' : map.hour;
    if (map.year && map.month && map.day && hh && map.minute && map.second) {
      return `${map.year}-${map.month}-${map.day} ${hh}:${map.minute}:${map.second}`;
    }
  } catch {
    // fallback below
  }
  // UTC+7 manual fallback
  const vnMs = date.getTime() + 7 * 60 * 60 * 1000;
  return new Date(vnMs).toISOString().slice(0, 19).replace('T', ' ');
}

export function sanitizeSpreadsheetCell(value: unknown, maxLength = 256): string {
  if (value === null || value === undefined) return '';
  let str = String(value).replace(/[\r\n\0]+/g, ' ').trim();
  if (str.length > maxLength) {
    str = str.slice(0, maxLength);
  }
  if (!str) return '';
  // Prevent Google Sheets formula execution when cell begins with = + - @ (or leading tab/spaces before them)
  if (/^[\s\t]*[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function isValidAppsScriptUrl(
  rawUrl: string | undefined,
  allowLocalTestUrl = false
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol === 'https:' && parsed.hostname === 'script.google.com') {
    return true;
  }

  if (
    allowLocalTestUrl &&
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  ) {
    return true;
  }

  return false;
}

export function extractGeoFromHeaders(headers: HeaderMap): { country: string; city: string } {
  const country =
    getSingleHeader(headers, 'x-vercel-ip-country') ||
    getSingleHeader(headers, 'cf-ipcountry') ||
    '';

  const rawCity = getSingleHeader(headers, 'x-vercel-ip-city') || '';
  let city = rawCity;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }

  return {
    country: sanitizeSpreadsheetCell(country, 64),
    city: sanitizeSpreadsheetCell(city, 100)
  };
}

function readOptionalStringField(
  obj: Record<string, unknown>,
  key: string,
  maxLength: number
): { ok: true; value: string } | { ok: false } {
  const raw = obj[key];
  if (raw === undefined || raw === null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false };
  return { ok: true, value: sanitizeSpreadsheetCell(raw, maxLength) };
}

export function validateTrackPayload(body: unknown): ValidatedTrackPayload | null {
  let parsed: unknown = body;
  if (typeof parsed === 'string') {
    if (Buffer.byteLength(parsed, 'utf8') > TRACK_MAX_BODY_BYTES) return null;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const actionRaw = typeof obj.action === 'string' ? obj.action.trim() : '';
  if (!VALID_TRACK_ACTIONS.has(actionRaw as TrackAction)) {
    return null;
  }

  const visitRaw = typeof obj.visitId === 'string' ? obj.visitId.trim() : '';
  const sessionRaw = typeof obj.sessionId === 'string' ? obj.sessionId.trim() : '';
  if (!visitRaw || visitRaw.length > 80 || !sessionRaw || sessionRaw.length > 80) {
    return null;
  }

  const detail = readOptionalStringField(obj, 'detail', 300);
  const device = readOptionalStringField(obj, 'device', 120);
  const language = readOptionalStringField(obj, 'language', 32);
  const resolution = readOptionalStringField(obj, 'resolution', 32);

  if (!detail.ok || !device.ok || !language.ok || !resolution.ok) {
    return null;
  }

  return {
    action: actionRaw as TrackAction,
    visitId: sanitizeSpreadsheetCell(visitRaw, 80),
    sessionId: sanitizeSpreadsheetCell(sessionRaw, 80),
    detail: detail.value,
    device: device.value,
    language: language.value,
    resolution: resolution.value
  };
}

export async function handleTrackRequest(input: TrackRequestInput): Promise<TrackRequestResult> {
  const okResponse = (forwarded: boolean, skipReason?: string): TrackRequestResult => ({
    statusCode: 200,
    body: { ok: true },
    forwarded,
    ...(skipReason ? { skipReason } : {})
  });

  try {
    const method = (input.method || 'POST').toUpperCase();
    if (method !== 'POST') {
      return okResponse(false, 'method_not_post');
    }

    if (typeof input.rawByteLength === 'number' && input.rawByteLength > TRACK_MAX_BODY_BYTES) {
      return okResponse(false, 'payload_too_large');
    }

    const env = input.env || process.env;
    const headers = input.headers || {};

    if (!isOriginAllowed(headers, env)) {
      return okResponse(false, 'origin_denied');
    }

    const clientIp = extractTrustedClientIp(headers, input.remoteIp);
    const now = input.now || new Date();
    if (!checkTrackRateLimit(clientIp, now.getTime())) {
      return okResponse(false, 'rate_limited');
    }

    const urlSheet = env.URL_SHEET?.trim();
    const secretSheet = (env.SERECT_SHEET || env.SECRET_SHEET)?.trim();
    if (!urlSheet || !secretSheet) {
      return okResponse(false, 'missing_env');
    }

    if (!isValidAppsScriptUrl(urlSheet, Boolean(input.allowLocalTestUrl))) {
      return okResponse(false, 'invalid_sheet_url');
    }

    const payload = validateTrackPayload(input.body);
    if (!payload) {
      return okResponse(false, 'invalid_payload');
    }

    const geo = extractGeoFromHeaders(headers);
    const outboundBody = {
      secret: secretSheet,
      time: sanitizeSpreadsheetCell(formatVietnamTime(now), 40),
      ip: sanitizeSpreadsheetCell(clientIp, 64),
      country: geo.country,
      city: geo.city,
      visitId: payload.visitId,
      sessionId: payload.sessionId,
      action: payload.action,
      detail: payload.detail,
      device: payload.device,
      language: payload.language,
      resolution: payload.resolution
    };

    const fetchFn = input.fetchImpl || fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRACK_TIMEOUT_MS);

    try {
      const response = await fetchFn(urlSheet, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outboundBody),
        redirect: 'follow',
        signal: controller.signal
      });

      if (!response.ok) {
        return okResponse(false, `upstream_http_${response.status}`);
      }

      // Inspect Apps Script JSON response when provided, but tolerate opaque/empty bodies
      const text = await response.text().catch(() => '');
      if (text) {
        try {
          const parsed = JSON.parse(text) as { ok?: boolean; skipped?: boolean };
          if (parsed.ok === false || parsed.skipped === true) {
            return okResponse(false, 'upstream_skipped');
          }
        } catch {
          // Non-JSON upstream body on 2xx — treat gracefully
        }
      }

      return okResponse(true);
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return okResponse(false, isAbort ? 'timeout' : 'network_error');
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return okResponse(false, 'unexpected_error');
  }
}
