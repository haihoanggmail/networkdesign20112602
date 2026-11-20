export type AssistantPersona = 'architect' | 'rack_power' | 'bom_tia';

export type ChatModelMode = 'deep' | 'fast';

export interface ChatTurnInput {
  role: 'user' | 'model';
  text: string;
}

export interface ProjectContextSummary {
  projectName?: string;
  activeMode?: string;
  activeFloorName?: string;
  deviceCount?: number;
  rackCount?: number;
  cableCount?: number;
  roomCount?: number;
  totalPowerWatts?: number;
  auditSummary?: {
    errorCount: number;
    warningCount: number;
    topIssues: string[];
  };
  sampleDevices?: Array<{
    name: string;
    category: string;
    ipAddress?: string;
    vlan?: string;
    powerWatts?: number;
  }>;
  racksSummary?: Array<{
    name: string;
    totalUnits: number;
    usedUnits: number;
    powerWatts: number;
  }>;
}

export interface ChatRequestBody {
  message: string;
  history: ChatTurnInput[];
  persona: AssistantPersona;
  modelMode: ChatModelMode;
  projectContext?: ProjectContextSummary;
}

export interface ChatHttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

export type HeaderMap = Record<string, string | string[] | undefined>;

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_HISTORY_TURNS = 16;
export const MAX_TOTAL_HISTORY_CHARS = 24_000;
export const MAX_CHAT_BODY_BYTES = 512 * 1024;
export const GEMINI_TIMEOUT_MS = 45_000;
export const MAX_OUTPUT_TOKENS = 2048;

export const DEFAULT_GEMINI_MODEL_DEEP = 'gemini-4-hydrogen';
export const DEFAULT_GEMINI_MODEL_FAST = 'gemini-3.1-flash-lite';

export interface AiRuntimeConfig {
  apiKey: string | undefined;
  aiConfigured: boolean;
  upstashUrl: string | undefined;
  upstashToken: string | undefined;
  upstashConfigured: boolean;
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  dailyQuotaLimit: number;
  dailyTokenBudget: number;
  failClosedOnRedisError: boolean;
  requiredSecret: string | undefined;
}

export function getAiRuntimeConfig(env: Record<string, string | undefined> = process.env): AiRuntimeConfig {
  const rawKey = env.GEMINI_API_KEY?.trim();
  const aiConfigured = Boolean(
    rawKey &&
      rawKey !== 'MY_GEMINI_API_KEY' &&
      rawKey !== 'YOUR_GEMINI_API_KEY' &&
      rawKey.length >= 10
  );

  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, '') || undefined;
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim() || undefined;
  const upstashConfigured = Boolean(upstashUrl && upstashToken);

  const parsePositiveInt = (val: string | undefined, fallback: number, min: number): number => {
    const n = Number(val);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
  };

  const failClosedEnv = env.CHAT_RATE_LIMIT_FAIL_CLOSED?.trim().toLowerCase();
  const failClosedOnRedisError =
    failClosedEnv === 'true'
      ? true
      : failClosedEnv === 'false'
      ? false
      : env.NODE_ENV === 'production';

  return {
    apiKey: aiConfigured ? rawKey : undefined,
    aiConfigured,
    upstashUrl,
    upstashToken,
    upstashConfigured,
    rateLimitPerMinute: parsePositiveInt(env.CHAT_RATE_LIMIT_PER_MIN, 15, 3),
    rateLimitPerHour: parsePositiveInt(env.CHAT_RATE_LIMIT_PER_HOUR, 60, 10),
    dailyQuotaLimit: parsePositiveInt(env.CHAT_DAILY_LIMIT, 500, 20),
    dailyTokenBudget: parsePositiveInt(env.CHAT_DAILY_TOKEN_LIMIT, 1_500_000, 10_000),
    failClosedOnRedisError,
    requiredSecret: env.CHAT_API_SECRET?.trim() || undefined
  };
}
