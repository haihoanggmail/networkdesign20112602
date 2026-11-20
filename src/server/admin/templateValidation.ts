import type {
  BuiltTemplateCatalogEntry,
  BuiltTemplateCatalogFile,
  BuiltTemplateStats
} from '../../../scripts/build-template-catalog';
import type { DesignMode, ProjectState } from '../../types/infrastructure';
import { CURRENT_SCHEMA_VERSION, migrateAndValidateProject } from '../../utils/projectStorage';
import { isSafeSvgContent } from '../../utils/security';
import type { AdminTemplateManifestInput } from './adminTypes';

export const MAX_PREVIEW_BYTES = 2.5 * 1024 * 1024; // 2.5 MB
export const MAX_PROJECT_JSON_BYTES = 4 * 1024 * 1024; // 4 MB

const VALID_MODES = new Set<DesignMode>([
  'floorplan',
  'topology',
  'rack',
  'cctv',
  'wifi',
  'fiber',
  'electrical',
  'multisite'
]);

const RESERVED_SLUGS = new Set([
  'catalog',
  'catalog.json',
  'con',
  'prn',
  'aux',
  'nul',
  '.',
  '..'
]);

const PREVIEW_FILENAME_RE = /^preview\.(svg|png|jpg|jpeg|webp)$/i;

export function validateTemplateSlug(rawSlug: string): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = String(rawSlug || '').trim().toLowerCase();
  if (!slug) {
    return { ok: false, error: 'Slug thư mục template không được để trống.' };
  }
  if (slug.length > 64) {
    return { ok: false, error: 'Slug template tối đa 64 ký tự.' };
  }
  if (RESERVED_SLUGS.has(slug) || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    return { ok: false, error: `Slug "${slug}" không hợp lệ hoặc nằm trong danh sách bảo lưu.` };
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    return {
      ok: false,
      error: 'Slug chỉ được chứa chữ thường a-z, số 0-9, dấu gạch ngang (-) hoặc gạch dưới (_).'
    };
  }
  return { ok: true, slug };
}

export function validateManifestInput(
  raw: unknown,
  fallbackSlug: string
): { ok: true; manifest: Required<AdminTemplateManifestInput> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Dữ liệu metadata template.json không phải đối tượng JSON hợp lệ.' };
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : fallbackSlug;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(id)) {
    return {
      ok: false,
      error: 'ID template chỉ được chứa chữ, số, dấu chấm, gạch ngang hoặc gạch dưới (tối đa 80 ký tự).'
    };
  }

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) {
    return { ok: false, error: 'Tên template không được để trống.' };
  }
  if (name.length > 160) {
    return { ok: false, error: 'Tên template tối đa 160 ký tự.' };
  }

  const category = typeof obj.category === 'string' && obj.category.trim() ? obj.category.trim() : 'Mạng LAN';
  const rawMode = typeof obj.mode === 'string' ? (obj.mode.trim() as DesignMode) : 'topology';
  if (!VALID_MODES.has(rawMode)) {
    return {
      ok: false,
      error: `Chế độ thiết kế "${String(obj.mode || '')}" không hợp lệ. Chỉ chấp nhận: ${Array.from(VALID_MODES).join(', ')}.`
    };
  }

  const version =
    typeof obj.version === 'string' && obj.version.trim() ? obj.version.trim().slice(0, 32) : '1.0.0';
  const badge =
    typeof obj.badge === 'string' && obj.badge.trim() ? obj.badge.trim().slice(0, 48) : category;
  const author =
    typeof obj.author === 'string' && obj.author.trim() ? obj.author.trim().slice(0, 80) : 'HACHIHI';
  const description =
    typeof obj.description === 'string' ? obj.description.trim().slice(0, 2000) : '';
  const updatedAt =
    typeof obj.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(obj.updatedAt.trim())
      ? obj.updatedAt.trim().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  const highlights = Array.isArray(obj.highlights)
    ? obj.highlights
        .filter((x): x is string => typeof x === 'string')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((x): x is string => typeof x === 'string')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const rawPreview = typeof obj.preview === 'string' && obj.preview.trim() ? obj.preview.trim() : 'preview.svg';
  const preview = PREVIEW_FILENAME_RE.test(rawPreview) ? rawPreview : 'preview.svg';

  return {
    ok: true,
    manifest: {
      id,
      name,
      category,
      mode: rawMode,
      badge,
      version,
      updatedAt,
      author,
      description,
      highlights,
      tags,
      projectFile: 'project.json',
      preview
    }
  };
}

export function validateAndNormalizeProjectJson(
  rawProject: unknown,
  manifest: Required<AdminTemplateManifestInput>,
  slug: string
): { ok: true; project: ProjectState; projectJsonText: string; stats: BuiltTemplateStats } | { ok: false; error: string } {
  let parsed = rawProject;
  if (typeof rawProject === 'string') {
    if (Buffer.byteLength(rawProject, 'utf8') > MAX_PROJECT_JSON_BYTES) {
      return { ok: false, error: 'Tệp project.json vượt quá giới hạn 4MB cho phép.' };
    }
    try {
      parsed = JSON.parse(rawProject);
    } catch {
      return { ok: false, error: 'Nội dung project.json không đúng cú pháp JSON.' };
    }
  }

  const migrated = migrateAndValidateProject(parsed);
  if (!migrated.ok) {
    return { ok: false, error: `Dữ liệu project.json không hợp lệ: ${migrated.error}` };
  }

  const nowIso = new Date().toISOString();
  const normalizedProject: ProjectState = {
    ...migrated.project,
    id: migrated.project.id?.trim() || `tpl_project_${slug}`,
    name: migrated.project.name?.trim() || manifest.name,
    author: manifest.author || migrated.project.author || 'HACHIHI',
    version: manifest.version || migrated.project.version || '1.0.0',
    activeMode: migrated.project.activeMode || manifest.mode,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastModified: nowIso,
    lastSavedAt: nowIso
  };

  const projectJsonText = `${JSON.stringify(normalizedProject, null, 2)}\n`;
  if (Buffer.byteLength(projectJsonText, 'utf8') > MAX_PROJECT_JSON_BYTES) {
    return { ok: false, error: 'Dữ liệu project.json sau chuẩn hóa vượt quá giới hạn 4MB.' };
  }

  const stats: BuiltTemplateStats = {
    nodes: normalizedProject.nodes.length,
    assets: Object.keys(normalizedProject.assets).length,
    racks: normalizedProject.racks.length,
    cables: normalizedProject.cables.length,
    floors: normalizedProject.floors.length
  };

  return { ok: true, project: normalizedProject, projectJsonText, stats };
}

function verifyRasterMagic(bytes: Buffer, ext: string): boolean {
  if (bytes.length < 8) return false;
  if (ext === 'png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (ext === 'webp') {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

export function validatePreviewPayload(preview: {
  filename: string;
  content: string;
  isBase64?: boolean;
}): { ok: true; filename: string; buffer: Buffer } | { ok: false; error: string } {
  const filename = pathSafePreviewFilename(preview.filename);
  if (!filename) {
    return {
      ok: false,
      error: 'Tên ảnh preview phải là preview.svg, preview.png, preview.jpg hoặc preview.webp.'
    };
  }

  const ext = filename.split('.').pop()!.toLowerCase();
  if (ext === 'svg') {
    const svgText = preview.isBase64
      ? Buffer.from(stripDataUrlPrefix(preview.content), 'base64').toString('utf8')
      : preview.content;
    if (Buffer.byteLength(svgText, 'utf8') > MAX_PREVIEW_BYTES) {
      return { ok: false, error: 'Ảnh preview SVG vượt quá giới hạn 2.5MB.' };
    }
    if (!isSafeSvgContent(svgText)) {
      return {
        ok: false,
        error: 'Ảnh SVG chứa thẻ hoặc thuộc tính không an toàn (script, event handler, URL ngoài).'
      };
    }
    return { ok: true, filename: 'preview.svg', buffer: Buffer.from(svgText, 'utf8') };
  }

  const rawBase64 = stripDataUrlPrefix(preview.content);
  const buffer = Buffer.from(rawBase64, 'base64');
  if (buffer.byteLength === 0) {
    return { ok: false, error: 'Nội dung ảnh preview rỗng hoặc sai mã hóa base64.' };
  }
  if (buffer.byteLength > MAX_PREVIEW_BYTES) {
    return { ok: false, error: 'Ảnh preview vượt quá giới hạn 2.5MB.' };
  }
  if (!verifyRasterMagic(buffer, ext)) {
    return { ok: false, error: `Tệp ${filename} không đúng định dạng ảnh ${ext.toUpperCase()} hợp lệ.` };
  }

  return { ok: true, filename, buffer };
}

function stripDataUrlPrefix(input: string): string {
  const trimmed = String(input || '').trim();
  const commaIdx = trimmed.indexOf(',');
  if (trimmed.startsWith('data:') && commaIdx !== -1) {
    return trimmed.slice(commaIdx + 1).replace(/\s+/g, '');
  }
  return trimmed.replace(/\s+/g, '');
}

export function pathSafePreviewFilename(raw: string): string | null {
  const base = String(raw || '').trim().split('/').pop()?.split('\\').pop() || '';
  if (!PREVIEW_FILENAME_RE.test(base)) return null;
  const lower = base.toLowerCase();
  return lower === 'preview.jpeg' ? 'preview.jpg' : lower;
}

export function buildCatalogEntryFromTemplate(
  slug: string,
  manifest: Required<AdminTemplateManifestInput>,
  project: ProjectState | null,
  previewFilename: string | null,
  validationError?: string,
  urlPrefix = '/templates'
): BuiltTemplateCatalogEntry {
  const cleanPrefix = urlPrefix.replace(/\/+$/, '');
  const hasProject = Boolean(project) && !validationError;
  const stats: BuiltTemplateStats | undefined = project
    ? {
        nodes: project.nodes.length,
        assets: Object.keys(project.assets).length,
        racks: project.racks.length,
        cables: project.cables.length,
        floors: project.floors.length
      }
    : undefined;

  return {
    id: manifest.id,
    slug,
    name: manifest.name,
    category: manifest.category,
    mode: manifest.mode,
    badge: manifest.badge || manifest.category,
    version: manifest.version || '1.0.0',
    updatedAt: manifest.updatedAt || new Date().toISOString().slice(0, 10),
    author: manifest.author || 'HACHIHI',
    description: manifest.description || '',
    highlights: manifest.highlights || [],
    tags: manifest.tags || [],
    projectUrl: hasProject ? `${cleanPrefix}/${encodeURIComponent(slug)}/project.json` : '',
    previewUrl: previewFilename
      ? `${cleanPrefix}/${encodeURIComponent(slug)}/${encodeURIComponent(previewFilename)}`
      : null,
    hasProjectData: hasProject,
    ...(stats ? { stats } : {}),
    ...(validationError ? { validationError } : {})
  };
}

export function buildSortedCatalogObject(
  entries: BuiltTemplateCatalogEntry[],
  buildErrors?: Array<{ folder: string; message: string }>
): BuiltTemplateCatalogFile {
  const sorted = [...entries].sort((a, b) =>
    a.slug.localeCompare(b.slug, 'en', { numeric: true })
  );
  const categories = Array.from(new Set(sorted.map(t => t.category).filter(Boolean)));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totalTemplates: sorted.length,
    categories,
    templates: sorted,
    ...(buildErrors && buildErrors.length > 0 ? { buildErrors } : {})
  };
}

export function buildFallbackPreviewSvg(name: string, mode: string, stats?: BuiltTemplateStats): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const subtitle = stats
    ? `${stats.assets} thiet bi · ${stats.cables} cap · ${stats.racks} rack`
    : mode.toUpperCase();
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">',
    '  <rect width="640" height="400" fill="#f8fafc"/>',
    '  <rect x="24" y="24" width="592" height="352" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>',
    '  <rect x="48" y="56" width="120" height="56" rx="8" fill="#155eef" fill-opacity="0.1" stroke="#155eef" stroke-width="1.5"/>',
    '  <rect x="260" y="56" width="120" height="56" rx="8" fill="#0f172a" fill-opacity="0.06" stroke="#334155" stroke-width="1.5"/>',
    '  <rect x="472" y="56" width="120" height="56" rx="8" fill="#16a34a" fill-opacity="0.1" stroke="#16a34a" stroke-width="1.5"/>',
    '  <line x1="168" y1="84" x2="260" y2="84" stroke="#64748b" stroke-width="2"/>',
    '  <line x1="380" y1="84" x2="472" y2="84" stroke="#64748b" stroke-width="2"/>',
    `  <text x="48" y="210" font-family="sans-serif" font-size="22" font-weight="700" fill="#0f172a">${esc(name.slice(0, 44))}</text>`,
    `  <text x="48" y="244" font-family="monospace" font-size="14" fill="#475569">${esc(subtitle)}</text>`,
    '</svg>'
  ].join('\n');
}
