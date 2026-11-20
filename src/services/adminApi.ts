import { unzipSync, strFromU8 } from 'fflate';
import type {
  AdminAuthStatusPayload,
  AdminListTemplatesPayload,
  AdminMutationSuccessPayload,
  AdminTemplateDetail,
  AdminTemplateManifestInput,
  AdminTemplateUpsertPayload
} from '../server/admin/adminTypes';
import type { DesignMode } from '../types/infrastructure';
import { slugifyTemplateId } from './templateLibrary';

export interface ParsedImportedTemplateFiles {
  slug: string;
  manifest: Partial<AdminTemplateManifestInput>;
  projectRawText: string;
  preview: {
    filename: string;
    content: string;
    isBase64: boolean;
  } | null;
}

const VALID_DESIGN_MODES = new Set<DesignMode>([
  'floorplan',
  'topology',
  'rack',
  'cctv',
  'wifi',
  'fiber',
  'electrical',
  'multisite'
]);

const MAX_ZIP_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const BLOCKED_EXT_RE = /\.(exe|dll|bat|cmd|sh|ps1|msi|vbs|js|ts|jsx|tsx|php|py|rb)$/i;

function getAdminClientRuntimeContext() {
  if (typeof window === 'undefined') {
    return {
      href: 'node-ssr',
      origin: 'node-ssr',
      pathname: 'node-ssr',
      hash: '',
      isEmbeddedInIframe: false,
      routingConflict: false
    };
  }
  let isEmbeddedInIframe = false;
  try {
    isEmbeddedInIframe = window.self !== window.top;
  } catch {
    isEmbeddedInIframe = true;
  }
  const { href, origin, pathname, hash } = window.location;
  const isExactAdminRoute = pathname === '/admin' || hash === '#/admin';
  const looksLikeAdminVariant = pathname.startsWith('/admin') || hash.startsWith('#/admin');
  return {
    href,
    origin,
    pathname,
    hash,
    isEmbeddedInIframe,
    isExactAdminRoute,
    routingConflict: looksLikeAdminVariant && !isExactAdminRoute
  };
}

function collectResponseHeaders(resp: Response): Record<string, string> {
  const out: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function readResponseDebugBody(resp: Response): Promise<{ parsed: unknown; rawText: string }> {
  try {
    const rawText = await resp.clone().text();
    if (!rawText) return { parsed: null, rawText: '' };
    try {
      return { parsed: JSON.parse(rawText) as unknown, rawText };
    } catch {
      return { parsed: null, rawText: rawText.slice(0, 300) };
    }
  } catch {
    return { parsed: null, rawText: '' };
  }
}

function diagnoseAuthResponse(params: {
  endpoint: string;
  method: string;
  status: number;
  responseHeaders: Record<string, string>;
  body: unknown;
  rawText: string;
}) {
  const ctx = getAdminClientRuntimeContext();
  const contentType = (params.responseHeaders['content-type'] || '').toLowerCase();
  const bodyObj = (params.body && typeof params.body === 'object' ? params.body : {}) as Record<
    string,
    unknown
  >;
  const missingVars = Array.isArray(bodyObj.missingVars) ? bodyObj.missingVars : [];
  const configured = typeof bodyObj.configured === 'boolean' ? bodyObj.configured : undefined;
  const authenticated = typeof bodyObj.authenticated === 'boolean' ? bodyObj.authenticated : undefined;

  const causes: string[] = [];
  if (ctx.routingConflict) {
    causes.push(
      `CLIENT_ROUTING_CONFLICT: URL (${ctx.pathname}${ctx.hash}) matches /admin prefix but not exact '/admin' or '#/admin'`
    );
  }
  if (contentType.includes('text/html') || params.rawText.trim().startsWith('<!')) {
    causes.push(
      'CLIENT_ROUTING_OR_API_FALLBACK_CONFLICT: API endpoint returned HTML instead of JSON (SPA fallback / missing /api/admin route)'
    );
  }
  if (params.status === 404) {
    causes.push('ROUTING_404: /api/admin endpoint not found (running pure Vite without server.ts or serverless /api)');
  }
  if (params.status === 503 || configured === false || missingVars.length > 0) {
    causes.push(
      `MISSING_ENV_VARS: Server missing admin credentials (${missingVars.length > 0 ? missingVars.join(', ') : 'ADMIN_USERNAME / ADMIN_PASSWORD'})`
    );
  }
  if (params.status === 403) {
    causes.push(
      `ORIGIN_VALIDATION_FAILED: Server rejected Origin (${ctx.origin}) via checkAdminOrigin/isOriginAllowed`
    );
  }
  if (params.status === 401) {
    causes.push(
      params.endpoint.includes('/api/admin/templates') || params.method === 'GET'
        ? 'SESSION_VALIDATION_FAILED: HttpOnly session cookie (hachihi_admin_session) missing, expired, or blocked (check iframe third-party cookies / SameSite / HTTPS proxy)'
        : 'INVALID_CREDENTIALS: Submitted username/password did not match server ADMIN_USERNAME/ADMIN_PASSWORD'
    );
  }
  if (params.status === 200 && configured === true && authenticated === false) {
    causes.push(
      ctx.isEmbeddedInIframe
        ? 'SESSION_NOT_AUTHENTICATED (IFRAME_CONTEXT): Not logged in yet, or browser blocked HttpOnly cookie inside iframe'
        : 'SESSION_NOT_AUTHENTICATED: No valid hachihi_admin_session cookie sent yet'
    );
  }
  if (params.status === 429) {
    causes.push(
      `RATE_LIMITED: Too many failed login attempts (Retry-After: ${params.responseHeaders['retry-after'] || 'unknown'}s)`
    );
  }

  console.log('[AdminAuth][Diagnosis]', {
    endpoint: params.endpoint,
    method: params.method,
    status: params.status,
    causes: causes.length > 0 ? causes : ['OK'],
    runtimeContext: ctx
  });
}

async function parseErrorResponse(resp: Response, fallback: string): Promise<string> {
  try {
    const data = (await resp.json()) as { error?: unknown };
    if (typeof data?.error === 'string' && data.error.trim()) {
      return data.error;
    }
  } catch {
    // ignore non-json error body
  }
  return `${fallback} (HTTP ${resp.status})`;
}

export async function fetchAdminAuthStatus(): Promise<AdminAuthStatusPayload> {
  const endpoint = '/api/admin/auth';
  const requestHeaders = { Accept: 'application/json' };
  const ctx = getAdminClientRuntimeContext();

  console.log('[AdminAuth][Request] GET /api/admin/auth (check auth & session)', {
    endpoint,
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: requestHeaders,
    payload: null,
    runtimeContext: ctx
  });

  const resp = await fetch(endpoint, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: requestHeaders
  });

  const responseHeaders = collectResponseHeaders(resp);
  const { parsed, rawText } = await readResponseDebugBody(resp);

  console.log('[AdminAuth][Response] GET /api/admin/auth', {
    endpoint,
    status: resp.status,
    statusText: resp.statusText,
    ok: resp.ok,
    headers: responseHeaders,
    body: parsed ?? rawText
  });

  diagnoseAuthResponse({
    endpoint,
    method: 'GET',
    status: resp.status,
    responseHeaders,
    body: parsed,
    rawText
  });

  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp, 'Không kiểm tra được trạng thái đăng nhập Admin'));
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Phản hồi từ /api/admin/auth không phải JSON hợp lệ (có thể bị xung đột routing SPA).');
  }
  return parsed as AdminAuthStatusPayload;
}

export async function adminLogin(
  username: string,
  password: string
): Promise<{ ok: true; user: { username: string } }> {
  const endpoint = '/api/admin/auth';
  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  const redactedPayload = {
    username,
    password: password ? `[REDACTED len=${password.length}]` : ''
  };
  const ctx = getAdminClientRuntimeContext();

  console.log('[AdminAuth][Request] POST /api/admin/auth (login)', {
    endpoint,
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders,
    payload: redactedPayload,
    runtimeContext: ctx
  });

  const resp = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders,
    body: JSON.stringify({ username, password })
  });

  const responseHeaders = collectResponseHeaders(resp);
  const { parsed, rawText } = await readResponseDebugBody(resp);

  console.log('[AdminAuth][Response] POST /api/admin/auth', {
    endpoint,
    status: resp.status,
    statusText: resp.statusText,
    ok: resp.ok,
    headers: responseHeaders,
    setCookieNote: 'Browser JS cannot read HttpOnly Set-Cookie header; verify Application -> Cookies -> hachihi_admin_session in DevTools',
    body: parsed ?? rawText
  });

  diagnoseAuthResponse({
    endpoint,
    method: 'POST',
    status: resp.status,
    responseHeaders,
    body: parsed,
    rawText
  });

  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp, 'Đăng nhập Admin thất bại'));
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Phản hồi đăng nhập từ /api/admin/auth không phải JSON hợp lệ.');
  }
  return parsed as { ok: true; user: { username: string } };
}

export async function adminLogout(): Promise<void> {
  const endpoint = '/api/admin/auth?action=logout';
  const requestHeaders = { Accept: 'application/json' };
  console.log('[AdminAuth][Request] POST /api/admin/auth?action=logout', {
    endpoint,
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders,
    payload: null,
    runtimeContext: getAdminClientRuntimeContext()
  });

  const resp = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: requestHeaders
  });

  const responseHeaders = collectResponseHeaders(resp);
  const { parsed, rawText } = await readResponseDebugBody(resp);
  console.log('[AdminAuth][Response] POST /api/admin/auth?action=logout', {
    endpoint,
    status: resp.status,
    statusText: resp.statusText,
    ok: resp.ok,
    headers: responseHeaders,
    body: parsed ?? rawText
  });

  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp, 'Không thể đăng xuất Admin'));
  }
}

export async function fetchAdminTemplates(): Promise<AdminListTemplatesPayload> {
  const endpoint = '/api/admin/templates';
  const requestHeaders = { Accept: 'application/json' };
  console.log('[AdminAuth][Request] GET /api/admin/templates (authenticated session check)', {
    endpoint,
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: requestHeaders,
    runtimeContext: getAdminClientRuntimeContext()
  });

  const resp = await fetch(endpoint, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: requestHeaders
  });

  const responseHeaders = collectResponseHeaders(resp);
  const { parsed, rawText } = await readResponseDebugBody(resp);
  console.log('[AdminAuth][Response] GET /api/admin/templates', {
    endpoint,
    status: resp.status,
    statusText: resp.statusText,
    ok: resp.ok,
    headers: responseHeaders,
    bodySummary:
      parsed && typeof parsed === 'object'
        ? {
            keys: Object.keys(parsed as Record<string, unknown>),
            error: (parsed as Record<string, unknown>).error
          }
        : rawText
  });

  if (!resp.ok) {
    diagnoseAuthResponse({
      endpoint,
      method: 'GET',
      status: resp.status,
      responseHeaders,
      body: parsed,
      rawText
    });
    throw new Error(await parseErrorResponse(resp, 'Không tải được danh sách template'));
  }
  return parsed as AdminListTemplatesPayload;
}

export async function fetchAdminTemplateDetail(slug: string): Promise<AdminTemplateDetail> {
  const resp = await fetch(`/api/admin/templates?slug=${encodeURIComponent(slug)}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store'
  });
  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp, `Không đọc được mẫu "${slug}"`));
  }
  return (await resp.json()) as AdminTemplateDetail;
}

export async function saveAdminTemplate(
  payload: AdminTemplateUpsertPayload
): Promise<AdminMutationSuccessPayload> {
  const resp = await fetch('/api/admin/templates', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp, 'Không lưu được mẫu template'));
  }
  return (await resp.json()) as AdminMutationSuccessPayload;
}

export async function deleteAdminTemplate(slug: string): Promise<AdminMutationSuccessPayload> {
  const resp = await fetch(`/api/admin/templates?slug=${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp, `Không xóa được mẫu "${slug}"`));
  }
  return (await resp.json()) as AdminMutationSuccessPayload;
}

export async function rebuildAdminCatalog(): Promise<AdminMutationSuccessPayload> {
  const resp = await fetch('/api/admin/templates?action=rebuild', {
    method: 'POST',
    credentials: 'include'
  });
  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp, 'Không đồng bộ lại được catalog.json'));
  }
  return (await resp.json()) as AdminMutationSuccessPayload;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function getPreviewMime(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'image/svg+xml';
}

export async function parseImportedTemplateFiles(
  fileList: File[]
): Promise<ParsedImportedTemplateFiles> {
  if (fileList.length === 0) {
    throw new Error('Vui lòng chọn ít nhất một tệp (.zip hoặc template.json / project.json).');
  }

  const entryBytes = new Map<string, Uint8Array>();

  if (fileList.length === 1 && fileList[0].name.toLowerCase().endsWith('.zip')) {
    const zipFile = fileList[0];
    if (zipFile.size > 12 * 1024 * 1024) {
      throw new Error('Tệp ZIP vượt quá giới hạn 12MB.');
    }
    const buf = new Uint8Array(await zipFile.arrayBuffer());
    const unpacked = unzipSync(buf);
    let totalBytes = 0;
    const entries = Object.entries(unpacked);
    if (entries.length > 40) {
      throw new Error('Gói ZIP chứa quá nhiều tệp (tối đa 40 tệp).');
    }
    for (const [rawPath, bytes] of entries) {
      const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!normalized || normalized.endsWith('/')) continue;
      if (normalized.includes('..')) {
        throw new Error(`Đường dẫn không an toàn trong ZIP: "${normalized}".`);
      }
      if (BLOCKED_EXT_RE.test(normalized)) {
        throw new Error(`Tệp thực thi không được phép trong gói template: "${normalized}".`);
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new Error('Tổng dung lượng giải nén ZIP vượt quá 16MB.');
      }
      entryBytes.set(normalized, bytes);
    }
  } else {
    for (const file of fileList) {
      const rel = (
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      ).replace(/\\/g, '/');
      if (rel.includes('..') || BLOCKED_EXT_RE.test(rel)) {
        throw new Error(`Tệp không hợp lệ hoặc không được phép: "${file.name}".`);
      }
      entryBytes.set(rel, new Uint8Array(await file.arrayBuffer()));
    }
  }

  let detectedSlug = '';
  let manifestRawText = '';
  let projectRawText = '';
  let previewItem: { filename: string; bytes: Uint8Array } | null = null;

  for (const [fullPath, bytes] of entryBytes.entries()) {
    const segments = fullPath.split('/').filter(Boolean);
    const basename = segments[segments.length - 1]?.toLowerCase() || '';
    if (segments.length >= 2 && !detectedSlug) {
      detectedSlug = segments[segments.length - 2];
    }

    if (basename === 'template.json') {
      manifestRawText = strFromU8(bytes);
    } else if (basename === 'project.json' || basename.endsWith('.project.json')) {
      projectRawText = strFromU8(bytes);
    } else if (/^preview\.(svg|png|jpg|jpeg|webp)$/i.test(basename)) {
      previewItem = {
        filename: basename === 'preview.jpeg' ? 'preview.jpg' : basename,
        bytes
      };
    }
  }

  let parsedManifest: Record<string, unknown> = {};
  if (manifestRawText) {
    try {
      const obj = JSON.parse(manifestRawText);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        parsedManifest = obj as Record<string, unknown>;
      }
    } catch {
      throw new Error('Tệp template.json trong gói không đúng định dạng JSON.');
    }
  }

  if (!projectRawText) {
    // Allow importing a standalone project.json / .hachihi.json file too
    const jsonFallback = Array.from(entryBytes.entries()).find(
      ([p]) => p.toLowerCase().endsWith('.json') && !p.toLowerCase().endsWith('template.json') && !p.toLowerCase().endsWith('catalog.json')
    );
    if (jsonFallback) {
      projectRawText = strFromU8(jsonFallback[1]);
    }
  }

  if (!projectRawText) {
    throw new Error('Không tìm thấy tệp project.json trong gói hoặc các tệp đã chọn.');
  }

  let parsedProjectObj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(projectRawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    parsedProjectObj = parsed as Record<string, unknown>;
  } catch {
    throw new Error('Tệp project.json không đúng cú pháp JSON hợp lệ.');
  }

  const name =
    (typeof parsedManifest.name === 'string' && parsedManifest.name.trim()) ||
    (typeof parsedProjectObj.name === 'string' && parsedProjectObj.name.trim()) ||
    'Mẫu thiết kế mới';
  const slug = slugifyTemplateId(detectedSlug || (typeof parsedManifest.id === 'string' ? parsedManifest.id : '') || name);
  const rawMode =
    (typeof parsedManifest.mode === 'string' ? parsedManifest.mode : undefined) ||
    (typeof parsedProjectObj.activeMode === 'string' ? parsedProjectObj.activeMode : undefined) ||
    'topology';
  const mode: DesignMode = VALID_DESIGN_MODES.has(rawMode as DesignMode)
    ? (rawMode as DesignMode)
    : 'topology';

  const manifest: Partial<AdminTemplateManifestInput> = {
    id:
      (typeof parsedManifest.id === 'string' && parsedManifest.id.trim()) || slug,
    name,
    category:
      (typeof parsedManifest.category === 'string' && parsedManifest.category.trim()) ||
      'Mạng LAN',
    mode,
    badge:
      (typeof parsedManifest.badge === 'string' && parsedManifest.badge.trim()) ||
      'Custom',
    version:
      (typeof parsedManifest.version === 'string' && parsedManifest.version.trim()) ||
      '1.0.0',
    author:
      (typeof parsedManifest.author === 'string' && parsedManifest.author.trim()) ||
      'HACHIHI',
    description:
      typeof parsedManifest.description === 'string' ? parsedManifest.description : '',
    highlights: Array.isArray(parsedManifest.highlights)
      ? parsedManifest.highlights.filter((x): x is string => typeof x === 'string')
      : [],
    tags: Array.isArray(parsedManifest.tags)
      ? parsedManifest.tags.filter((x): x is string => typeof x === 'string')
      : []
  };

  let preview: ParsedImportedTemplateFiles['preview'] = null;
  if (previewItem) {
    const ext = previewItem.filename.split('.').pop()!.toLowerCase();
    if (ext === 'svg') {
      preview = {
        filename: 'preview.svg',
        content: strFromU8(previewItem.bytes),
        isBase64: false
      };
    } else {
      preview = {
        filename: previewItem.filename,
        content: `data:${getPreviewMime(ext)};base64,${uint8ToBase64(previewItem.bytes)}`,
        isBase64: true
      };
    }
  }

  return {
    slug,
    manifest,
    projectRawText,
    preview
  };
}
