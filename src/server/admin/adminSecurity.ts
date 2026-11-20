import crypto from 'node:crypto';
import type { HeaderMap } from '../chatTypes';
import { extractTrustedClientIp, getSingleHeader, isOriginAllowed } from '../chatSecurity';
import type { AdminUser } from './adminTypes';

export const ADMIN_SESSION_COOKIE_NAME = 'hachihi_admin_session';
const SESSION_TTL_SECONDS = 4 * 60 * 60; // 4 hours
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_FAILURES = 12;

interface FailedLoginBucket {
  count: number;
  resetAt: number;
}

const failedLoginBuckets = new Map<string, FailedLoginBucket>();

export function timingSafeEquals(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function getConfiguredAdminCredentials(
  env: Record<string, string | undefined> = process.env
): { configured: boolean; username: string; password: string } {
  const username = (env.ADMIN_USERNAME || '').trim();
  const password = env.ADMIN_PASSWORD ?? '';
  return {
    configured: Boolean(username && password.length > 0),
    username,
    password
  };
}

function getSessionSigningKey(env: Record<string, string | undefined> = process.env): string | null {
  const explicitSecret = (env.ADMIN_SESSION_SECRET || '').trim();
  if (explicitSecret.length >= 16) return explicitSecret;
  const creds = getConfiguredAdminCredentials(env);
  if (!creds.configured) return null;
  // Deterministic fallback derived from Vercel env credentials so stateless serverless functions agree across instances
  return crypto
    .createHash('sha256')
    .update(`hachihi-admin-cookie-key:${creds.username}:${creds.password}`)
    .digest('hex');
}

export function createSignedSessionToken(
  username: string,
  env: Record<string, string | undefined> = process.env,
  nowMs = Date.now()
): string | null {
  const key = getSessionSigningKey(env);
  if (!key) return null;
  const payload = {
    u: username,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS,
    jti: crypto.randomBytes(10).toString('hex')
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${sig}`;
}

export function verifySignedSessionToken(
  token: string | undefined,
  env: Record<string, string | undefined> = process.env,
  nowMs = Date.now()
): AdminUser | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) return null;

  const key = getSessionSigningKey(env);
  if (!key) return null;

  const expectedSig = crypto.createHmac('sha256', key).update(encodedPayload).digest('base64url');
  if (!timingSafeEquals(providedSig, expectedSig)) return null;

  try {
    const rawJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const parsed = JSON.parse(rawJson) as { u?: unknown; exp?: unknown };
    if (typeof parsed.u !== 'string' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp * 1000 <= nowMs) return null;

    // Ensure user still matches current env allowlist (immediate invalidation if Vercel env changes)
    const creds = getConfiguredAdminCredentials(env);
    if (!creds.configured || !timingSafeEquals(parsed.u, creds.username)) {
      return null;
    }

    return { username: creds.username };
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (name) {
      try {
        out[name] = decodeURIComponent(val);
      } catch {
        out[name] = val;
      }
    }
  }
  return out;
}

export function getAdminUserFromHeaders(
  headers: HeaderMap,
  env: Record<string, string | undefined> = process.env
): AdminUser | null {
  const cookieHeader = getSingleHeader(headers, 'cookie');
  const cookies = parseCookieHeader(cookieHeader);
  return verifySignedSessionToken(cookies[ADMIN_SESSION_COOKIE_NAME], env);
}

function shouldUseSecureCrossSiteCookie(
  headers: HeaderMap,
  env: Record<string, string | undefined> = process.env
): boolean {
  const proto = (getSingleHeader(headers, 'x-forwarded-proto') || '').toLowerCase();
  if (proto.includes('https')) return true;
  if ((env.VERCEL || '').trim() === '1') return true;
  if ((env.NODE_ENV || '').toLowerCase() === 'production' && !(env.APP_URL || '').startsWith('http://localhost')) {
    return true;
  }
  if ((env.APP_URL || '').toLowerCase().startsWith('https://')) return true;
  return false;
}

export function buildSessionSetCookieHeader(
  token: string,
  headers: HeaderMap,
  env: Record<string, string | undefined> = process.env
): string {
  const secure = shouldUseSecureCrossSiteCookie(headers, env);
  const attrs = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secure ? 'SameSite=None' : 'SameSite=Lax',
    ...(secure ? ['Secure'] : [])
  ];
  return attrs.join('; ');
}

export function buildClearSessionCookieHeader(
  headers: HeaderMap,
  env: Record<string, string | undefined> = process.env
): string {
  const secure = shouldUseSecureCrossSiteCookie(headers, env);
  const attrs = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    ...(secure ? ['Secure'] : [])
  ];
  return attrs.join('; ');
}

export function checkAdminOrigin(
  headers: HeaderMap,
  env: Record<string, string | undefined> = process.env
): boolean {
  return isOriginAllowed(headers, env);
}

export function checkLoginRateLimit(
  headers: HeaderMap,
  remoteIp?: string,
  nowMs = Date.now()
): { allowed: boolean; retryAfterSec?: number } {
  const ip = extractTrustedClientIp(headers, remoteIp);
  const bucket = failedLoginBuckets.get(ip);
  if (!bucket || bucket.resetAt <= nowMs) {
    return { allowed: true };
  }
  if (bucket.count >= LOGIN_MAX_FAILURES) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000))
    };
  }
  return { allowed: true };
}

export function recordFailedLoginAttempt(headers: HeaderMap, remoteIp?: string, nowMs = Date.now()): void {
  const ip = extractTrustedClientIp(headers, remoteIp);
  const existing = failedLoginBuckets.get(ip);
  if (!existing || existing.resetAt <= nowMs) {
    failedLoginBuckets.set(ip, { count: 1, resetAt: nowMs + LOGIN_WINDOW_MS });
  } else {
    existing.count += 1;
  }
}

export function clearFailedLoginAttempts(headers: HeaderMap, remoteIp?: string): void {
  const ip = extractTrustedClientIp(headers, remoteIp);
  failedLoginBuckets.delete(ip);
}
