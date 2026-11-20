import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  ChatHttpResponse,
  DEFAULT_GEMINI_MODEL_DEEP,
  DEFAULT_GEMINI_MODEL_FAST,
  GEMINI_TIMEOUT_MS,
  getAiRuntimeConfig,
  HeaderMap,
  MAX_OUTPUT_TOKENS
} from './chatTypes';
import {
  classifyAndSanitizeAiError,
  extractTrustedClientIp,
  isOriginAllowed,
  verifyOptionalChatSecret
} from './chatSecurity';
import { checkRateLimitShared, recordDailyTokenUsage } from './chatRateLimit';
import { buildSystemInstruction, validateChatRequest } from './chatValidation';

export interface UnifiedChatInput {
  method?: string;
  headers: HeaderMap;
  body: unknown;
  rawByteLength?: number;
  remoteIp?: string;
}

export function buildHealthPayload(version?: string) {
  const cfg = getAiRuntimeConfig();
  return {
    ok: true,
    service: 'hachihi-designer-api',
    ...(version ? { version } : {}),
    aiConfigured: cfg.aiConfigured,
    rateLimiterBackend: cfg.upstashConfigured ? 'upstash-redis' : 'in-memory',
    dailyQuotaLimit: cfg.dailyQuotaLimit,
    dailyTokenBudget: cfg.dailyTokenBudget
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('GEMINI_TIMEOUT'));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function handleChatRequest(input: UnifiedChatInput): Promise<ChatHttpResponse> {
  if (input.method && input.method.toUpperCase() !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'POST' },
      body: { error: 'Method Not Allowed' }
    };
  }

  if (!isOriginAllowed(input.headers)) {
    return {
      statusCode: 403,
      body: { error: 'Origin không được phép truy cập API.' }
    };
  }

  const cfg = getAiRuntimeConfig();
  if (!verifyOptionalChatSecret(input.headers, cfg.requiredSecret)) {
    return {
      statusCode: 401,
      body: { error: 'Thiếu hoặc sai mã xác thực truy cập Trợ lý AI.' }
    };
  }

  const clientIp = extractTrustedClientIp(input.headers, input.remoteIp);
  const rate = await checkRateLimitShared(clientIp, { config: cfg });
  if (!rate.allowed) {
    const headers: Record<string, string> = {};
    if (rate.retryAfterSec) headers['Retry-After'] = String(rate.retryAfterSec);

    const errorMessage =
      rate.reason === 'rate_limiter_unavailable'
        ? 'Dịch vụ kiểm soát lưu lượng tạm thời gián đoạn. Vui lòng thử lại sau ít phút hoặc dùng chế độ phân tích cục bộ.'
        : rate.reason === 'daily_token_budget' || rate.reason === 'daily_quota'
        ? 'Hệ thống Trợ lý AI đã đạt giới hạn sử dụng trong ngày (Daily Quota). Chế độ phân tích cục bộ vẫn sẵn sàng.'
        : `Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau ${rate.retryAfterSec ?? 30} giây.`;

    return {
      statusCode: rate.statusCode || 429,
      headers,
      body: { error: errorMessage }
    };
  }

  if (!cfg.apiKey) {
    return {
      statusCode: 503,
      body: {
        error: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ. Chế độ phân tích cục bộ ngoại tuyến vẫn khả dụng.'
      }
    };
  }

  const validated = validateChatRequest(input.body, input.rawByteLength);
  if (!validated.ok) {
    return {
      statusCode: validated.statusCode,
      body: { error: validated.error }
    };
  }

  const { message, history, persona, modelMode, projectContext } = validated.value;
  const fastMode = modelMode === 'fast';
  const model = fastMode
    ? process.env.GEMINI_MODEL_FAST?.trim() || DEFAULT_GEMINI_MODEL_FAST
    : process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL_DEEP;

  try {
    const ai = new GoogleGenAI({
      apiKey: cfg.apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'hachihi-designer-api'
        }
      }
    });

    const chat = ai.chats.create({
      model,
      history: history.map(turn => ({
        role: turn.role,
        parts: [{ text: turn.text }]
      })),
      config: {
        systemInstruction: buildSystemInstruction(persona, projectContext),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: {
          thinkingLevel: fastMode ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM
        }
      }
    });

    const response = await withTimeout(chat.sendMessage({ message }), GEMINI_TIMEOUT_MS);
    const totalTokens = response.usageMetadata?.totalTokenCount;
    if (typeof totalTokens === 'number' && totalTokens > 0) {
      void recordDailyTokenUsage(totalTokens, { config: cfg });
    } else {
      // Conservative fallback token accounting when usage metadata is omitted
      const approxTokens = Math.ceil((message.length + (response.text?.length || 0)) / 3);
      void recordDailyTokenUsage(approxTokens, { config: cfg });
    }

    const reply = (response.text || '').trim();
    return {
      statusCode: 200,
      body: {
        reply: reply || 'Trợ lý kỹ thuật chưa nhận được nội dung phản hồi. Vui lòng thử diễn đạt lại câu hỏi.',
        modelUsed: model
      }
    };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error('[/api/gemini/chat] Error:', rawMsg);
    const sanitized = classifyAndSanitizeAiError(err);
    return {
      statusCode: sanitized.statusCode,
      body: { error: sanitized.error }
    };
  }
}
