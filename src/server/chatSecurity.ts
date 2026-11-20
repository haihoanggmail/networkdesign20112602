import crypto from 'node:crypto';
import { HeaderMap } from './chatTypes';

export function getSingleHeader(headers: HeaderMap, name: string): string | undefined {
  const lower = name.toLowerCase();
  const direct = headers[lower] ?? headers[name];
  if (typeof direct === 'string') return direct.trim() || undefined;
  if (Array.isArray(direct) && direct.length > 0) {
    return typeof direct[0] === 'string' ? direct[0].trim() || undefined : undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (typeof v === 'string') return v.trim() || undefined;
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim() || undefined;
    }
  }
  return undefined;
}

function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  // Reject absurdly long or non-IP values
  if (ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip;
}

/**
 * Resolves the client IP using platform/proxy-verified values first, rather than
 * blindly trusting the leftmost X-Forwarded-For entry which any client can spoof.
 */
export function extractTrustedClientIp(
  headers: HeaderMap,
  expressResolvedIp?: string
): string {
  // 1. Platform-injected headers set by Vercel Edge / Cloudflare (cannot be forged by client)
  const vercelFwd = getSingleHeader(headers, 'x-vercel-forwarded-for');
  if (vercelFwd) {
    const first = normalizeIp(vercelFwd.split(',')[0]);
    if (first) return first;
  }

  const cfIp = normalizeIp(getSingleHeader(headers, 'cf-connecting-ip'));
  if (cfIp) return cfIp;

  // 2. Express `req.ip` (computed by Express `trust proxy` from socket/trusted hops)
  const resolved = normalizeIp(expressResolvedIp);
  if (resolved && resolved !== '127.0.0.1' && resolved !== '::1') {
    return resolved;
  }

  // 3. x-real-ip set by Nginx/reverse proxy
  const realIp = normalizeIp(getSingleHeader(headers, 'x-real-ip'));
  if (realIp) return realIp;

  // 4. Rightmost external IP in X-Forwarded-For (closest hop appended by edge proxy)
  const xff = getSingleHeader(headers, 'x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(p => normalizeIp(p)).filter((p): p is string => Boolean(p));
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  return resolved || 'anonymous-client';
}

/**
 * Normalizes and checks Origin against Host + configured APP_URL + ALLOWED_ORIGINS allowlist.
 * Note: Origin checking mitigates browser CSRF/cross-origin abuse; never rely on Origin as sole auth.
 */
export function isOriginAllowed(
  headers: HeaderMap,
  env: Record<string, string | undefined> = process.env
): boolean {
  const origin = getSingleHeader(headers, 'origin');
  if (!origin) return true; // Same-origin fetch without Origin header or server-to-server call

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const host = getSingleHeader(headers, 'x-forwarded-host') || getSingleHeader(headers, 'host');
  if (host) {
    const allowedHosts = host.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    if (allowedHosts.includes(parsedOrigin.host.toLowerCase())) {
      return true;
    }
  }

  const candidates: string[] = [];
  const configuredAppUrl = env.APP_URL?.trim();
  if (configuredAppUrl && configuredAppUrl !== 'MY_APP_URL') {
    candidates.push(configuredAppUrl);
  }
  const extraOrigins = env.ALLOWED_ORIGINS?.trim();
  if (extraOrigins) {
    for (const item of extraOrigins.split(',')) {
      const trimmed = item.trim();
      if (trimmed) candidates.push(trimmed);
    }
  }

  for (const candidate of candidates) {
    try {
      const candidateOrigin = new URL(candidate).origin;
      if (parsedOrigin.origin === candidateOrigin) return true;
    } catch {
      // ignore malformed env URL
    }
  }

  return false;
}

function timingSafeEquals(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Enforces optional CHAT_API_SECRET only when configured on the server.
 * Frontend chat works seamlessly when CHAT_API_SECRET is left unset.
 */
export function verifyOptionalChatSecret(
  headers: HeaderMap,
  requiredSecret: string | undefined
): boolean {
  if (!requiredSecret) return true;
  const authHeader = getSingleHeader(headers, 'authorization') || '';
  const provided =
    getSingleHeader(headers, 'x-hachihi-token') ||
    getSingleHeader(headers, 'x-hachihi-secret') ||
    (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');

  if (!provided) return false;
  return timingSafeEquals(provided, requiredSecret);
}

export function classifyAndSanitizeAiError(err: unknown): { statusCode: number; error: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const upper = raw.toUpperCase();

  if (
    upper.includes('GEMINI_TIMEOUT') ||
    upper.includes('ABORT') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    upper.includes('ETIMEDOUT')
  ) {
    return {
      statusCode: 504,
      error: 'Trợ lý AI phản hồi quá thời gian cho phép (timeout). Vui lòng thử lại hoặc rút gọn câu hỏi.'
    };
  }

  if (upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('QUOTA')) {
    return {
      statusCode: 429,
      error: 'Hệ thống AI đang quá tải tạm thời (429). Vui lòng thử lại sau vài giây.'
    };
  }

  if (
    upper.includes('401') ||
    upper.includes('403') ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('API KEY')
  ) {
    return {
      statusCode: 403,
      error: 'Không có quyền truy cập dịch vụ Gemini AI trên máy chủ.'
    };
  }

  return {
    statusCode: 500,
    error: 'Không thể xử lý yêu cầu trợ lý AI vào lúc này. Chế độ phân tích kỹ thuật cục bộ vẫn sẵn sàng.'
  };
}
