/**
 * Security utilities for image URL sanitization, SVG payload validation, and XSS-safe escaping.
 */

export const MAX_IMPORT_JSON_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_EXCEL_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_SCANNER_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PROJECT_NODES = 5000;
export const MAX_PROJECT_CABLES = 10000;
export const MAX_PROJECT_ASSETS = 5000;
export const MAX_BUNDLE_PROJECTS = 50;

export function getUtf8ByteLength(input: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input).byteLength;
  }
  return input.length * 2;
}

export function checkImportPayloadSize(
  input: string | { size: number; name?: string },
  maxBytes: number,
  label = 'tệp nhập'
): { ok: true } | { ok: false; error: string } {
  const bytes = typeof input === 'string' ? getUtf8ByteLength(input) : Number(input.size) || 0;
  if (bytes > maxBytes) {
    const maxMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    const actualMb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
    return {
      ok: false,
      error: `Dung lượng ${label} (${actualMb} MB) vượt quá giới hạn an toàn (${maxMb} MB).`
    };
  }
  return { ok: true };
}

const DANGEROUS_SVG_PATTERNS: RegExp[] = [
  /<\s*script\b/i,
  /<\s*foreignObject\b/i,
  /<\s*iframe\b/i,
  /<\s*object\b/i,
  /<\s*embed\b/i,
  /<\s*applet\b/i,
  /<\s*meta\b/i,
  /\bon[a-z]+\s*=/i,
  /(?:javascript|vbscript)\s*:/i,
  /(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|\/\/)/i,
  /<\s*use\b[^>]*\b(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|\/\/|data:)/i,
  /<\s*image\b[^>]*\b(?:href|xlink:href)\s*=\s*["']\s*(?!data:image\/(?:png|jpeg|jpg|webp|gif);base64,)/i
];

export function isSafeSvgContent(svgMarkup: string): boolean {
  if (!svgMarkup || typeof svgMarkup !== 'string') return false;
  const trimmed = svgMarkup.trim();
  if (!trimmed.toLowerCase().includes('<svg')) return false;
  return !DANGEROUS_SVG_PATTERNS.some(re => re.test(trimmed));
}

function decodeBase64Utf8(b64: string): string {
  const cleaned = b64.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(cleaned, 'base64').toString('utf8');
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Validates that an image URL is safe for <img> or SVG <image href="...">.
 * Blocks javascript:, data:text/html, remote http(s):// tracking/taint URLs, and unsafe SVG scripts/handlers.
 */
export function sanitizeSafeImageUrl(
  rawUrl?: string | null,
  options?: { allowSanitizedSvg?: boolean }
): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  // Reject protocol-relative and explicit remote URLs or script protocols
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('http:') ||
    lower.startsWith('https:') ||
    lower.startsWith('//')
  ) {
    return undefined;
  }

  // Allow safe in-memory object URLs created internally
  if (lower.startsWith('blob:')) {
    return trimmed;
  }

  // Allow safe raster Data URLs
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }

  // Validate SVG Data URLs strictly before permitting
  if (lower.startsWith('data:image/svg+xml')) {
    if (options?.allowSanitizedSvg === false) return undefined;
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx === -1) return undefined;
    const header = trimmed.slice(0, commaIdx).toLowerCase();
    const payload = trimmed.slice(commaIdx + 1);
    try {
      const decoded = header.includes(';base64')
        ? decodeBase64Utf8(payload)
        : decodeURIComponent(payload);
      if (!isSafeSvgContent(decoded)) return undefined;
      return trimmed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function escapeXmlAttr(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
