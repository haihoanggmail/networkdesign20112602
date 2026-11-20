import fs from 'node:fs';
import path from 'node:path';
import {
  buildTemplateCatalogFromDir,
  type BuiltTemplateCatalogEntry,
  type BuiltTemplateCatalogFile
} from '../../../scripts/build-template-catalog';
import type { ProjectState } from '../../types/infrastructure';
import type { HeaderMap } from '../chatTypes';
import { getSingleHeader } from '../chatSecurity';
import {
  ADMIN_SESSION_COOKIE_NAME,
  buildClearSessionCookieHeader,
  buildSessionSetCookieHeader,
  checkAdminOrigin,
  checkLoginRateLimit,
  clearFailedLoginAttempts,
  createSignedSessionToken,
  getAdminUserFromHeaders,
  getConfiguredAdminCredentials,
  parseCookieHeader,
  recordFailedLoginAttempt,
  timingSafeEquals
} from './adminSecurity';
import type {
  AdminAuthStatusPayload,
  AdminListTemplatesPayload,
  AdminMutationSuccessPayload,
  AdminServiceResult,
  AdminStorageMode,
  AdminTemplateDetail,
  AdminTemplateManifestInput
} from './adminTypes';
import {
  commitTemplateChangesAtomicallyToGitHub,
  getGitHubRepoConfig,
  listGitHubDirectoryTree,
  readGitHubBlobBuffer,
  type GitHubFileUpsert,
  type GitHubRepoConfig
} from './githubRepoSync';
import {
  buildCatalogEntryFromTemplate,
  buildFallbackPreviewSvg,
  buildSortedCatalogObject,
  pathSafePreviewFilename,
  validateAndNormalizeProjectJson,
  validateManifestInput,
  validatePreviewPayload,
  validateTemplateSlug
} from './templateValidation';

export interface AdminRequestInput {
  method?: string;
  headers: HeaderMap;
  body?: unknown;
  query?: Record<string, string | undefined>;
  remoteIp?: string;
  env?: Record<string, string | undefined>;
  templatesDir?: string;
}

const PREVIEW_CANDIDATES = ['preview.webp', 'preview.png', 'preview.jpg', 'preview.jpeg', 'preview.svg'];

function getTemplatesDir(input?: AdminRequestInput): string {
  return input?.templatesDir || path.resolve(process.cwd(), 'public', 'templates');
}

export function isLocalTemplatesDirWritable(
  templatesDir: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if ((env.VERCEL || '').trim() === '1' || (env.AWS_LAMBDA_FUNCTION_NAME || '').trim().length > 0) {
    return false;
  }
  try {
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }
    const probeFile = path.join(templatesDir, `.write-probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probeFile, '1', 'utf8');
    fs.unlinkSync(probeFile);
    return true;
  } catch {
    return false;
  }
}

export function resolveAdminStorageMode(
  writableLocalFs: boolean,
  githubConfigured: boolean
): AdminStorageMode {
  if (writableLocalFs && githubConfigured) return 'local_and_github';
  if (githubConfigured) return 'github';
  if (writableLocalFs) return 'local';
  return 'readonly_unconfigured';
}

function formatManifestJson(manifest: Required<AdminTemplateManifestInput>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function getPreviewMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/svg+xml';
}

function summarizeAuthRequestHeaders(headers: HeaderMap) {
  const cookieHeader = getSingleHeader(headers, 'cookie');
  const cookies = parseCookieHeader(cookieHeader);
  return {
    origin: getSingleHeader(headers, 'origin') || null,
    host: getSingleHeader(headers, 'host') || null,
    xForwardedHost: getSingleHeader(headers, 'x-forwarded-host') || null,
    xForwardedProto: getSingleHeader(headers, 'x-forwarded-proto') || null,
    hasSessionCookie: Boolean(cookies[ADMIN_SESSION_COOKIE_NAME])
  };
}

export async function handleAdminAuthStatus(
  req: AdminRequestInput
): Promise<AdminServiceResult<AdminAuthStatusPayload>> {
  const env = req.env || process.env;
  const templatesDir = getTemplatesDir(req);
  const creds = getConfiguredAdminCredentials(env);
  const github = getGitHubRepoConfig(env);
  const writableLocalFs = isLocalTemplatesDirWritable(templatesDir, env);
  const storageMode = resolveAdminStorageMode(writableLocalFs, github.configured);
  const user = creds.configured ? getAdminUserFromHeaders(req.headers, env) : null;

  const missingVars: string[] = [];
  if (!env.ADMIN_USERNAME?.trim()) missingVars.push('ADMIN_USERNAME');
  if (!env.ADMIN_PASSWORD) missingVars.push('ADMIN_PASSWORD');

  const headerSummary = summarizeAuthRequestHeaders(req.headers);
  console.log('[AdminAuth][Server] GET /api/admin/auth', {
    statusCode: 200,
    configured: creds.configured,
    missingVars,
    authenticated: Boolean(user),
    reason: !creds.configured
      ? 'MISSING_ENV_VARS'
      : !headerSummary.hasSessionCookie
      ? 'NO_SESSION_COOKIE'
      : !user
      ? 'SESSION_TOKEN_INVALID_OR_EXPIRED'
      : 'OK',
    headers: headerSummary
  });

  return {
    statusCode: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      configured: creds.configured,
      authenticated: Boolean(user),
      user,
      storageMode,
      githubConfigured: github.configured,
      ...(github.configured ? { githubRepo: `${github.owner}/${github.repo}`, githubBranch: github.branch } : {}),
      writableLocalFs,
      missingVars
    }
  };
}

export async function handleAdminLogin(
  req: AdminRequestInput
): Promise<AdminServiceResult> {
  const env = req.env || process.env;
  const headerSummary = summarizeAuthRequestHeaders(req.headers);

  if (!checkAdminOrigin(req.headers, env)) {
    console.log('[AdminAuth][Server] POST /api/admin/auth -> 403 ORIGIN_FORBIDDEN', {
      headers: headerSummary,
      appUrl: env.APP_URL || null
    });
    return { statusCode: 403, body: { error: 'Origin không được phép thực hiện đăng nhập Admin.' } };
  }

  const rate = checkLoginRateLimit(req.headers, req.remoteIp);
  if (!rate.allowed) {
    console.log('[AdminAuth][Server] POST /api/admin/auth -> 429 RATE_LIMITED', {
      retryAfterSec: rate.retryAfterSec,
      headers: headerSummary
    });
    return {
      statusCode: 429,
      headers: { 'Retry-After': String(rate.retryAfterSec || 60) },
      body: {
        error: `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${rate.retryAfterSec || 60} giây.`
      }
    };
  }

  const creds = getConfiguredAdminCredentials(env);
  if (!creds.configured) {
    console.log('[AdminAuth][Server] POST /api/admin/auth -> 503 MISSING_ENV_VARS', {
      hasUsername: Boolean(env.ADMIN_USERNAME?.trim()),
      hasPassword: Boolean(env.ADMIN_PASSWORD),
      headers: headerSummary
    });
    return {
      statusCode: 503,
      body: {
        error:
          'Chưa cấu hình tài khoản Admin trên máy chủ. Hãy thêm biến môi trường ADMIN_USERNAME và ADMIN_PASSWORD trên Vercel.'
      }
    };
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    console.log('[AdminAuth][Server] POST /api/admin/auth -> 400 EMPTY_CREDENTIALS', {
      payload: { username, passwordLength: password.length }
    });
    return { statusCode: 400, body: { error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' } };
  }

  const validUser = timingSafeEquals(username, creds.username);
  const validPass = timingSafeEquals(password, creds.password);
  if (!validUser || !validPass) {
    recordFailedLoginAttempt(req.headers, req.remoteIp);
    console.log('[AdminAuth][Server] POST /api/admin/auth -> 401 INVALID_CREDENTIALS', {
      payload: { username, passwordLength: password.length },
      validUser,
      validPass
    });
    return { statusCode: 401, body: { error: 'Tên đăng nhập hoặc mật khẩu Admin không chính xác.' } };
  }

  clearFailedLoginAttempts(req.headers, req.remoteIp);
  const token = createSignedSessionToken(creds.username, env);
  if (!token) {
    console.log('[AdminAuth][Server] POST /api/admin/auth -> 500 TOKEN_SIGN_FAILED');
    return { statusCode: 500, body: { error: 'Không thể khởi tạo phiên đăng nhập bảo mật.' } };
  }

  const templatesDir = getTemplatesDir(req);
  const github = getGitHubRepoConfig(env);
  const writableLocalFs = isLocalTemplatesDirWritable(templatesDir, env);
  const setCookieHeader = buildSessionSetCookieHeader(token, req.headers, env);

  console.log('[AdminAuth][Server] POST /api/admin/auth -> 200 OK', {
    username: creds.username,
    cookieAttributes: setCookieHeader.split(';').slice(1).map(s => s.trim()),
    headers: headerSummary
  });

  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': setCookieHeader,
      'Cache-Control': 'no-store'
    },
    body: {
      ok: true,
      user: { username: creds.username },
      storageMode: resolveAdminStorageMode(writableLocalFs, github.configured)
    }
  };
}

export async function handleAdminLogout(
  req: AdminRequestInput
): Promise<AdminServiceResult> {
  const env = req.env || process.env;
  if (!checkAdminOrigin(req.headers, env)) {
    return { statusCode: 403, body: { error: 'Origin không hợp lệ.' } };
  }
  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': buildClearSessionCookieHeader(req.headers, env),
      'Cache-Control': 'no-store'
    },
    body: { ok: true }
  };
}

function requireAdminAuth(req: AdminRequestInput): { ok: true; username: string } | { ok: false; result: AdminServiceResult } {
  const env = req.env || process.env;
  const creds = getConfiguredAdminCredentials(env);
  const headerSummary = summarizeAuthRequestHeaders(req.headers);
  if (!creds.configured) {
    console.log('[AdminAuth][Server] requireAdminAuth -> 503 MISSING_ENV_VARS', {
      headers: headerSummary
    });
    return {
      ok: false,
      result: {
        statusCode: 503,
        body: { error: 'Chưa cấu hình ADMIN_USERNAME / ADMIN_PASSWORD trên máy chủ.' }
      }
    };
  }
  const user = getAdminUserFromHeaders(req.headers, env);
  if (!user) {
    console.log('[AdminAuth][Server] requireAdminAuth -> 401 SESSION_VALIDATION_FAILED', {
      reason: headerSummary.hasSessionCookie ? 'SESSION_TOKEN_INVALID_OR_EXPIRED' : 'NO_SESSION_COOKIE',
      headers: headerSummary
    });
    return {
      ok: false,
      result: {
        statusCode: 401,
        body: { error: 'Phiên đăng nhập Admin đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.' }
      }
    };
  }
  return { ok: true, username: user.username };
}

async function readTemplatesCatalogFromGitHub(
  github: GitHubRepoConfig
): Promise<{
  catalog: BuiltTemplateCatalogFile;
  headCommitSha: string;
  treeFiles: Array<{ path: string; sha: string; size?: number }>;
}> {
  const { headCommitSha, files } = await listGitHubDirectoryTree(github, 'public/templates');
  const slugs = new Set<string>();
  const fileMap = new Map<string, { sha: string; size?: number }>();

  for (const f of files) {
    fileMap.set(f.path, { sha: f.sha, size: f.size });
    const rel = f.path.slice('public/templates/'.length);
    const parts = rel.split('/');
    if (parts.length >= 2 && parts[0]) {
      slugs.add(parts[0]);
    }
  }

  const catalogFile = fileMap.get('public/templates/catalog.json');
  let existingCatalogMap = new Map<string, BuiltTemplateCatalogEntry>();
  if (catalogFile) {
    try {
      const buf = await readGitHubBlobBuffer(github, catalogFile.sha);
      const parsed = JSON.parse(buf.toString('utf8')) as BuiltTemplateCatalogFile;
      if (Array.isArray(parsed.templates)) {
        for (const item of parsed.templates) {
          if (item && typeof item.slug === 'string') {
            existingCatalogMap.set(item.slug, item);
          }
        }
      }
    } catch {
      // rebuild from individual folders below
    }
  }

  const entries: BuiltTemplateCatalogEntry[] = [];
  const buildErrors: Array<{ folder: string; message: string }> = [];

  for (const slug of Array.from(slugs).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const manifestBlob = fileMap.get(`public/templates/${slug}/template.json`);
    if (!manifestBlob) {
      buildErrors.push({ folder: slug, message: 'Thiếu tệp template.json trong thư mục mẫu.' });
      continue;
    }

    let manifestRaw: unknown;
    try {
      const buf = await readGitHubBlobBuffer(github, manifestBlob.sha);
      manifestRaw = JSON.parse(buf.toString('utf8'));
    } catch {
      const msg = 'Tệp template.json không đúng định dạng JSON.';
      buildErrors.push({ folder: slug, message: msg });
      const prev = existingCatalogMap.get(slug);
      entries.push(
        prev
          ? { ...prev, validationError: msg, hasProjectData: false }
          : {
              id: `broken_${slug}`,
              slug,
              name: slug,
              category: 'Khác',
              mode: 'topology',
              badge: 'Lỗi Manifest',
              version: '0.0.0',
              updatedAt: new Date().toISOString().slice(0, 10),
              author: 'HACHIHI',
              description: msg,
              highlights: [],
              tags: [],
              projectUrl: '',
              previewUrl: null,
              hasProjectData: false,
              validationError: msg
            }
      );
      continue;
    }

    const validatedManifest = validateManifestInput(manifestRaw, slug);
    if (!validatedManifest.ok) {
      buildErrors.push({ folder: slug, message: validatedManifest.error });
    }
    const manifest = validatedManifest.ok
      ? validatedManifest.manifest
      : {
          id: slug,
          name: slug,
          category: 'Khác',
          mode: 'topology' as const,
          badge: 'Lỗi',
          version: '1.0.0',
          updatedAt: new Date().toISOString().slice(0, 10),
          author: 'HACHIHI',
          description: '',
          highlights: [],
          tags: [],
          projectFile: 'project.json',
          preview: 'preview.svg'
        };

    const projectBlob = fileMap.get(`public/templates/${slug}/project.json`);
    let projectState: ProjectState | null = null;
    let projectError: string | undefined = validatedManifest.ok ? undefined : validatedManifest.error;

    if (!projectBlob) {
      projectError = projectError || 'Thiếu tệp project.json.';
    } else {
      const existingEntry = existingCatalogMap.get(slug);
      // Use project blob to extract exact stats & validate
      try {
        const projBuf = await readGitHubBlobBuffer(github, projectBlob.sha);
        const projParsed = JSON.parse(projBuf.toString('utf8'));
        const projCheck = validateAndNormalizeProjectJson(projParsed, manifest, slug);
        if (projCheck.ok) {
          projectState = projCheck.project;
        } else {
          projectError = projCheck.error;
        }
      } catch {
        projectError = existingEntry?.validationError || 'Lỗi đọc hoặc phân tích project.json.';
      }
    }

    const detectedPreview =
      (manifest.preview && fileMap.has(`public/templates/${slug}/${manifest.preview}`) ? manifest.preview : null) ||
      PREVIEW_CANDIDATES.find(cand => fileMap.has(`public/templates/${slug}/${cand}`)) ||
      null;

    if (projectError) {
      buildErrors.push({ folder: slug, message: projectError });
    }

    entries.push(buildCatalogEntryFromTemplate(slug, manifest, projectState, detectedPreview, projectError));
  }

  return {
    catalog: buildSortedCatalogObject(entries, buildErrors),
    headCommitSha,
    treeFiles: files
  };
}

export async function handleAdminListTemplates(
  req: AdminRequestInput
): Promise<AdminServiceResult<AdminListTemplatesPayload | { error: string }>> {
  const auth = requireAdminAuth(req);
  if (!auth.ok) return auth.result as AdminServiceResult<{ error: string }>;

  const env = req.env || process.env;
  const templatesDir = getTemplatesDir(req);
  const github = getGitHubRepoConfig(env);
  const writableLocalFs = isLocalTemplatesDirWritable(templatesDir, env);
  const storageMode = resolveAdminStorageMode(writableLocalFs, github.configured);

  if (github.configured && !writableLocalFs) {
    const gh = await readTemplatesCatalogFromGitHub(github);
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        catalog: gh.catalog,
        storageMode,
        githubConfigured: true,
        writableLocalFs,
        source: 'github',
        lastCommitSha: gh.headCommitSha
      }
    };
  }

  const catalog = buildTemplateCatalogFromDir(templatesDir, { writeOutput: false });
  return {
    statusCode: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      catalog,
      storageMode,
      githubConfigured: github.configured,
      writableLocalFs,
      source: 'local'
    }
  };
}

export async function handleAdminGetTemplate(
  req: AdminRequestInput,
  rawSlug: string
): Promise<AdminServiceResult<AdminTemplateDetail | { error: string }>> {
  const auth = requireAdminAuth(req);
  if (!auth.ok) return auth.result as AdminServiceResult<{ error: string }>;

  const slugRes = validateTemplateSlug(rawSlug);
  if (!slugRes.ok) {
    return { statusCode: 400, body: { error: slugRes.error } };
  }
  const slug = slugRes.slug;
  const env = req.env || process.env;
  const templatesDir = getTemplatesDir(req);
  const github = getGitHubRepoConfig(env);
  const writableLocalFs = isLocalTemplatesDirWritable(templatesDir, env);

  if (github.configured && !writableLocalFs) {
    const { files } = await listGitHubDirectoryTree(github, `public/templates/${slug}`);
    const byName = new Map<string, string>();
    for (const f of files) {
      const rel = f.path.slice(`public/templates/${slug}/`.length);
      byName.set(rel, f.sha);
    }
    const manifestSha = byName.get('template.json');
    if (!manifestSha) {
      return { statusCode: 404, body: { error: `Không tìm thấy mẫu "${slug}" trên GitHub.` } };
    }
    const manifestBuf = await readGitHubBlobBuffer(github, manifestSha);
    const manifestRaw = JSON.parse(manifestBuf.toString('utf8'));
    const manifestCheck = validateManifestInput(manifestRaw, slug);
    const manifest = manifestCheck.ok
      ? manifestCheck.manifest
      : {
          id: slug,
          name: slug,
          category: 'Khác',
          mode: 'topology' as const,
          badge: 'Lỗi',
          version: '1.0.0',
          updatedAt: new Date().toISOString().slice(0, 10),
          author: 'HACHIHI',
          description: '',
          highlights: [],
          tags: [],
          projectFile: 'project.json',
          preview: 'preview.svg'
        };

    const projectSha = byName.get('project.json');
    let projectJson: ProjectState | null = null;
    let projectRawText = '';
    let projectError: string | undefined = manifestCheck.ok ? undefined : manifestCheck.error;
    if (projectSha) {
      projectRawText = (await readGitHubBlobBuffer(github, projectSha)).toString('utf8');
      try {
        const parsed = JSON.parse(projectRawText);
        const projCheck = validateAndNormalizeProjectJson(parsed, manifest, slug);
        if (projCheck.ok) {
          projectJson = projCheck.project;
        } else {
          projectError = projCheck.error;
        }
      } catch {
        projectError = 'Lỗi cú pháp JSON trong project.json.';
      }
    } else {
      projectError = 'Thiếu tệp project.json.';
    }

    const previewFilename =
      (manifest.preview && byName.has(manifest.preview) ? manifest.preview : null) ||
      PREVIEW_CANDIDATES.find(c => byName.has(c)) ||
      null;
    let previewContent: string | null = null;
    let previewIsBase64 = false;
    if (previewFilename) {
      const prevSha = byName.get(previewFilename)!;
      const prevBuf = await readGitHubBlobBuffer(github, prevSha);
      if (previewFilename.endsWith('.svg')) {
        previewContent = prevBuf.toString('utf8');
      } else {
        previewIsBase64 = true;
        previewContent = `data:${getPreviewMimeType(previewFilename)};base64,${prevBuf.toString('base64')}`;
      }
    }

    const entry = buildCatalogEntryFromTemplate(slug, manifest, projectJson, previewFilename, projectError);
    return {
      statusCode: 200,
      headers: { 'Cache-Control': 'no-store' },
      body: {
        entry,
        manifest,
        projectJson,
        projectRawText,
        previewFilename,
        previewContent,
        previewIsBase64,
        source: 'github'
      }
    };
  }

  // Local FS read
  const folderDir = path.join(templatesDir, slug);
  const manifestPath = path.join(folderDir, 'template.json');
  if (!fs.existsSync(manifestPath)) {
    return { statusCode: 404, body: { error: `Không tìm thấy thư mục mẫu "${slug}".` } };
  }

  const catalog = buildTemplateCatalogFromDir(templatesDir, { writeOutput: false });
  const catalogEntry = catalog.templates.find(t => t.slug === slug);
  let manifestRaw: unknown = {};
  try {
    manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    manifestRaw = {};
  }
  const manifestCheck = validateManifestInput(manifestRaw, slug);
  const manifest = manifestCheck.ok
    ? manifestCheck.manifest
    : {
        id: catalogEntry?.id || slug,
        name: catalogEntry?.name || slug,
        category: catalogEntry?.category || 'Khác',
        mode: (catalogEntry?.mode as AdminTemplateManifestInput['mode']) || 'topology',
        badge: catalogEntry?.badge || 'Lỗi',
        version: catalogEntry?.version || '1.0.0',
        updatedAt: catalogEntry?.updatedAt || new Date().toISOString().slice(0, 10),
        author: catalogEntry?.author || 'HACHIHI',
        description: catalogEntry?.description || '',
        highlights: catalogEntry?.highlights || [],
        tags: catalogEntry?.tags || [],
        projectFile: 'project.json',
        preview: 'preview.svg'
      };

  const projectPath = path.join(folderDir, 'project.json');
  let projectJson: ProjectState | null = null;
  let projectRawText = '';
  let projectError: string | undefined = catalogEntry?.validationError;
  if (fs.existsSync(projectPath)) {
    projectRawText = fs.readFileSync(projectPath, 'utf8');
    try {
      const parsed = JSON.parse(projectRawText);
      const projCheck = validateAndNormalizeProjectJson(parsed, manifest, slug);
      if (projCheck.ok) {
        projectJson = projCheck.project;
      } else {
        projectError = projCheck.error;
      }
    } catch {
      projectError = 'Lỗi cú pháp JSON trong project.json.';
    }
  } else {
    projectError = 'Thiếu tệp project.json.';
  }

  const previewFilename =
    (manifest.preview && fs.existsSync(path.join(folderDir, manifest.preview)) ? manifest.preview : null) ||
    PREVIEW_CANDIDATES.find(c => fs.existsSync(path.join(folderDir, c))) ||
    null;

  let previewContent: string | null = null;
  let previewIsBase64 = false;
  if (previewFilename) {
    const prevBuf = fs.readFileSync(path.join(folderDir, previewFilename));
    if (previewFilename.endsWith('.svg')) {
      previewContent = prevBuf.toString('utf8');
    } else {
      previewIsBase64 = true;
      previewContent = `data:${getPreviewMimeType(previewFilename)};base64,${prevBuf.toString('base64')}`;
    }
  }

  const entry =
    catalogEntry || buildCatalogEntryFromTemplate(slug, manifest, projectJson, previewFilename, projectError);

  return {
    statusCode: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      entry,
      manifest,
      projectJson,
      projectRawText,
      previewFilename,
      previewContent,
      previewIsBase64,
      source: 'local'
    }
  };
}

export async function handleAdminUpsertTemplate(
  req: AdminRequestInput
): Promise<AdminServiceResult<AdminMutationSuccessPayload | { error: string }>> {
  const auth = requireAdminAuth(req);
  if (!auth.ok) return auth.result as AdminServiceResult<{ error: string }>;

  const env = req.env || process.env;
  if (!checkAdminOrigin(req.headers, env)) {
    return { statusCode: 403, body: { error: 'Origin không được phép thực hiện thay đổi mẫu.' } };
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : null) as Record<string, unknown> | null;
  if (!body) {
    return { statusCode: 400, body: { error: 'Dữ liệu yêu cầu không hợp lệ.' } };
  }

  const slugRes = validateTemplateSlug(String(body.slug || ''));
  if (!slugRes.ok) {
    return { statusCode: 400, body: { error: slugRes.error } };
  }
  const slug = slugRes.slug;

  let previousSlug: string | undefined;
  if (typeof body.previousSlug === 'string' && body.previousSlug.trim()) {
    const prevRes = validateTemplateSlug(body.previousSlug);
    if (!prevRes.ok) {
      return { statusCode: 400, body: { error: prevRes.error } };
    }
    previousSlug = prevRes.slug !== slug ? prevRes.slug : undefined;
  }

  const manifestRes = validateManifestInput(body.manifest, slug);
  if (!manifestRes.ok) {
    return { statusCode: 400, body: { error: manifestRes.error } };
  }
  const manifest = manifestRes.manifest;

  const projectRes = validateAndNormalizeProjectJson(body.projectJson, manifest, slug);
  if (!projectRes.ok) {
    return { statusCode: 400, body: { error: projectRes.error } };
  }

  const templatesDir = getTemplatesDir(req);
  const github = getGitHubRepoConfig(env);
  const writableLocalFs = isLocalTemplatesDirWritable(templatesDir, env);
  const storageMode = resolveAdminStorageMode(writableLocalFs, github.configured);

  if (storageMode === 'readonly_unconfigured') {
    return {
      statusCode: 422,
      body: {
        error:
          'Môi trường Vercel chỉ cho phép đọc tệp tĩnh. Hãy thêm các biến GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO (và GITHUB_BRANCH) trên Vercel để lưu thay đổi trực tiếp mà không cần sửa code thủ công.'
      }
    };
  }

  // Resolve preview payload (uploaded, existing preserved, or fallback generated SVG)
  let previewFile: { filename: string; buffer: Buffer } | null = null;
  if (body.preview && typeof body.preview === 'object') {
    const pObj = body.preview as Record<string, unknown>;
    if (typeof pObj.filename === 'string' && typeof pObj.content === 'string' && pObj.content.trim()) {
      const checked = validatePreviewPayload({
        filename: pObj.filename,
        content: pObj.content,
        isBase64: Boolean(pObj.isBase64)
      });
      if (!checked.ok) {
        return { statusCode: 400, body: { error: checked.error } };
      }
      previewFile = { filename: checked.filename, buffer: checked.buffer };
    }
  }

  // Check duplicate ID across other templates & preserve existing preview if none submitted
  let existingCatalogEntries: BuiltTemplateCatalogEntry[] = [];
  let githubHeadSha: string | undefined;
  let githubTreeFiles: Array<{ path: string; sha: string; size?: number }> = [];

  if (github.configured) {
    const ghState = await readTemplatesCatalogFromGitHub(github);
    existingCatalogEntries = ghState.catalog.templates;
    githubHeadSha = ghState.headCommitSha;
    githubTreeFiles = ghState.treeFiles;
  } else {
    existingCatalogEntries = buildTemplateCatalogFromDir(templatesDir, { writeOutput: false }).templates;
  }

  const conflictingIdEntry = existingCatalogEntries.find(
    e => e.id === manifest.id && e.slug !== slug && e.slug !== previousSlug
  );
  if (conflictingIdEntry) {
    return {
      statusCode: 409,
      body: {
        error: `ID template "${manifest.id}" đã được sử dụng bởi mẫu "${conflictingIdEntry.name}" (${conflictingIdEntry.slug}). Vui lòng chọn ID khác.`
      }
    };
  }

  if (!previewFile) {
    // Check if an existing preview exists on local or GitHub to preserve
    const sourceSlug = previousSlug || slug;
    if (writableLocalFs && fs.existsSync(path.join(templatesDir, sourceSlug))) {
      const existingPrevName = PREVIEW_CANDIDATES.find(c =>
        fs.existsSync(path.join(templatesDir, sourceSlug, c))
      );
      if (existingPrevName) {
        const cleanName = pathSafePreviewFilename(existingPrevName) || 'preview.svg';
        previewFile = {
          filename: cleanName,
          buffer: fs.readFileSync(path.join(templatesDir, sourceSlug, existingPrevName))
        };
      }
    } else if (github.configured) {
      const existingPrevBlob = githubTreeFiles.find(f =>
        PREVIEW_CANDIDATES.some(c => f.path === `public/templates/${sourceSlug}/${c}`)
      );
      if (existingPrevBlob) {
        const fname = existingPrevBlob.path.split('/').pop()!;
        const cleanName = pathSafePreviewFilename(fname) || 'preview.svg';
        previewFile = {
          filename: cleanName,
          buffer: await readGitHubBlobBuffer(github, existingPrevBlob.sha)
        };
      }
    }
  }

  if (!previewFile) {
    previewFile = {
      filename: 'preview.svg',
      buffer: Buffer.from(buildFallbackPreviewSvg(manifest.name, manifest.mode, projectRes.stats), 'utf8')
    };
  }

  const finalManifest: Required<AdminTemplateManifestInput> = {
    ...manifest,
    preview: previewFile.filename,
    projectFile: 'project.json'
  };
  const manifestText = formatManifestJson(finalManifest);

  let updatedCatalog: BuiltTemplateCatalogFile;
  let localUpdated = false;
  let githubCommitted = false;
  let commitSha: string | undefined;
  let commitUrl: string | undefined;

  if (writableLocalFs) {
    const targetDir = path.join(templatesDir, slug);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'template.json'), manifestText, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'project.json'), projectRes.projectJsonText, 'utf8');
    // Remove obsolete preview files of different format
    for (const cand of PREVIEW_CANDIDATES) {
      const p = path.join(targetDir, cand);
      if (cand !== previewFile.filename && fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
    fs.writeFileSync(path.join(targetDir, previewFile.filename), previewFile.buffer);

    if (previousSlug) {
      const oldDir = path.join(templatesDir, previousSlug);
      if (fs.existsSync(oldDir)) {
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
    }

    updatedCatalog = buildTemplateCatalogFromDir(templatesDir, { writeOutput: true });
    localUpdated = true;
  } else {
    const newEntry = buildCatalogEntryFromTemplate(
      slug,
      finalManifest,
      projectRes.project,
      previewFile.filename
    );
    const filteredEntries = existingCatalogEntries.filter(
      e => e.slug !== slug && e.slug !== previousSlug
    );
    updatedCatalog = buildSortedCatalogObject([...filteredEntries, newEntry]);
  }

  if (github.configured) {
    const upserts: GitHubFileUpsert[] = [
      {
        repoPath: `public/templates/${slug}/template.json`,
        content: Buffer.from(manifestText, 'utf8')
      },
      {
        repoPath: `public/templates/${slug}/project.json`,
        content: Buffer.from(projectRes.projectJsonText, 'utf8')
      },
      {
        repoPath: `public/templates/${slug}/${previewFile.filename}`,
        content: previewFile.buffer
      },
      {
        repoPath: 'public/templates/catalog.json',
        content: Buffer.from(`${JSON.stringify(updatedCatalog, null, 2)}\n`, 'utf8')
      }
    ];

    const deletePaths: string[] = [];
    for (const f of githubTreeFiles) {
      if (
        f.path.startsWith(`public/templates/${slug}/`) &&
        !upserts.some(u => u.repoPath === f.path)
      ) {
        deletePaths.push(f.path);
      }
      if (previousSlug && f.path.startsWith(`public/templates/${previousSlug}/`)) {
        deletePaths.push(f.path);
      }
    }

    const customMsg =
      typeof body.commitMessage === 'string' && body.commitMessage.trim()
        ? body.commitMessage.trim().slice(0, 140)
        : `chore(templates): update ${slug} and catalog.json`;

    const commitRes = await commitTemplateChangesAtomicallyToGitHub(github, {
      upserts,
      deletePaths,
      expectedHeadSha: githubHeadSha,
      message: `${customMsg}\n\nAdmin: ${auth.username}\nTemplate: ${slug}`
    });
    githubCommitted = true;
    commitSha = commitRes.commitSha;
    commitUrl = commitRes.commitUrl;
  }

  return {
    statusCode: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      ok: true,
      slug,
      catalog: updatedCatalog,
      storageMode,
      localUpdated,
      githubCommitted,
      ...(commitSha ? { commitSha } : {}),
      ...(commitUrl ? { commitUrl } : {}),
      message: githubCommitted
        ? `Đã lưu mẫu "${finalManifest.name}", cập nhật catalog.json và đồng bộ commit lên GitHub.`
        : `Đã lưu mẫu "${finalManifest.name}" và cập nhật catalog.json thành công.`
    }
  };
}

export async function handleAdminDeleteTemplate(
  req: AdminRequestInput,
  rawSlug: string
): Promise<AdminServiceResult<AdminMutationSuccessPayload | { error: string }>> {
  const auth = requireAdminAuth(req);
  if (!auth.ok) return auth.result as AdminServiceResult<{ error: string }>;

  const env = req.env || process.env;
  if (!checkAdminOrigin(req.headers, env)) {
    return { statusCode: 403, body: { error: 'Origin không được phép xóa mẫu.' } };
  }

  const slugRes = validateTemplateSlug(rawSlug);
  if (!slugRes.ok) {
    return { statusCode: 400, body: { error: slugRes.error } };
  }
  const slug = slugRes.slug;

  const templatesDir = getTemplatesDir(req);
  const github = getGitHubRepoConfig(env);
  const writableLocalFs = isLocalTemplatesDirWritable(templatesDir, env);
  const storageMode = resolveAdminStorageMode(writableLocalFs, github.configured);

  if (storageMode === 'readonly_unconfigured') {
    return {
      statusCode: 422,
      body: {
        error:
          'Môi trường Vercel chỉ cho phép đọc tệp tĩnh. Hãy thêm GITHUB_TOKEN, GITHUB_OWNER và GITHUB_REPO trên Vercel để xóa mẫu và đồng bộ catalog.json.'
      }
    };
  }

  let existingCatalogEntries: BuiltTemplateCatalogEntry[] = [];
  let githubHeadSha: string | undefined;
  let githubTreeFiles: Array<{ path: string; sha: string; size?: number }> = [];

  if (github.configured) {
    const ghState = await readTemplatesCatalogFromGitHub(github);
    existingCatalogEntries = ghState.catalog.templates;
    githubHeadSha = ghState.headCommitSha;
    githubTreeFiles = ghState.treeFiles;
  }

  const targetDir = path.join(templatesDir, slug);
  const existsLocal = writableLocalFs && fs.existsSync(targetDir);
  const githubDeletePaths = githubTreeFiles
    .filter(f => f.path.startsWith(`public/templates/${slug}/`))
    .map(f => f.path);

  if (!existsLocal && githubDeletePaths.length === 0) {
    return { statusCode: 404, body: { error: `Không tìm thấy thư mục mẫu "${slug}" để xóa.` } };
  }

  let updatedCatalog: BuiltTemplateCatalogFile;
  let localUpdated = false;
  let githubCommitted = false;
  let commitSha: string | undefined;
  let commitUrl: string | undefined;

  if (writableLocalFs && existsLocal) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    updatedCatalog = buildTemplateCatalogFromDir(templatesDir, { writeOutput: true });
    localUpdated = true;
  } else {
    updatedCatalog = buildSortedCatalogObject(
      existingCatalogEntries.filter(e => e.slug !== slug)
    );
  }

  if (github.configured) {
    const commitRes = await commitTemplateChangesAtomicallyToGitHub(github, {
      upserts: [
        {
          repoPath: 'public/templates/catalog.json',
          content: Buffer.from(`${JSON.stringify(updatedCatalog, null, 2)}\n`, 'utf8')
        }
      ],
      deletePaths: githubDeletePaths,
      expectedHeadSha: githubHeadSha,
      message: `chore(templates): delete ${slug} and update catalog.json\n\nAdmin: ${auth.username}`
    });
    githubCommitted = true;
    commitSha = commitRes.commitSha;
    commitUrl = commitRes.commitUrl;
  }

  return {
    statusCode: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      ok: true,
      slug,
      catalog: updatedCatalog,
      storageMode,
      localUpdated,
      githubCommitted,
      ...(commitSha ? { commitSha } : {}),
      ...(commitUrl ? { commitUrl } : {}),
      message: githubCommitted
        ? `Đã xóa mẫu "${slug}", cập nhật catalog.json và commit lên GitHub.`
        : `Đã xóa mẫu "${slug}" và cập nhật catalog.json.`
    }
  };
}

export async function handleAdminRebuildCatalog(
  req: AdminRequestInput
): Promise<AdminServiceResult<AdminMutationSuccessPayload | { error: string }>> {
  const auth = requireAdminAuth(req);
  if (!auth.ok) return auth.result as AdminServiceResult<{ error: string }>;

  const env = req.env || process.env;
  if (!checkAdminOrigin(req.headers, env)) {
    return { statusCode: 403, body: { error: 'Origin không hợp lệ.' } };
  }

  const templatesDir = getTemplatesDir(req);
  const github = getGitHubRepoConfig(env);
  const writableLocalFs = isLocalTemplatesDirWritable(templatesDir, env);
  const storageMode = resolveAdminStorageMode(writableLocalFs, github.configured);

  if (storageMode === 'readonly_unconfigured') {
    return {
      statusCode: 422,
      body: { error: 'Không thể ghi lại catalog.json trên môi trường chỉ đọc khi chưa cấu hình GitHub.' }
    };
  }

  let catalog: BuiltTemplateCatalogFile;
  let localUpdated = false;
  let githubCommitted = false;
  let commitSha: string | undefined;
  let commitUrl: string | undefined;

  if (writableLocalFs) {
    catalog = buildTemplateCatalogFromDir(templatesDir, { writeOutput: true });
    localUpdated = true;
  } else {
    const ghState = await readTemplatesCatalogFromGitHub(github);
    catalog = ghState.catalog;
  }

  if (github.configured) {
    const ghHead = writableLocalFs ? (await listGitHubDirectoryTree(github, 'public/templates')).headCommitSha : undefined;
    const commitRes = await commitTemplateChangesAtomicallyToGitHub(github, {
      upserts: [
        {
          repoPath: 'public/templates/catalog.json',
          content: Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
        }
      ],
      expectedHeadSha: ghHead,
      message: `chore(templates): rebuild catalog.json (${catalog.totalTemplates} templates)\n\nAdmin: ${auth.username}`
    });
    githubCommitted = true;
    commitSha = commitRes.commitSha;
    commitUrl = commitRes.commitUrl;
  }

  return {
    statusCode: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      ok: true,
      slug: 'catalog.json',
      catalog,
      storageMode,
      localUpdated,
      githubCommitted,
      ...(commitSha ? { commitSha } : {}),
      ...(commitUrl ? { commitUrl } : {}),
      message: `Đã đồng bộ lại catalog.json (${catalog.totalTemplates} mẫu).`
    }
  };
}
