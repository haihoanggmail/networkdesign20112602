import { zipSync, strToU8 } from 'fflate';
import type { DesignMode, ProjectState } from '../types/infrastructure';
import { CURRENT_SCHEMA_VERSION, migrateAndValidateProject } from '../utils/projectStorage';
import { generateCompositeBuildingSvgMarkup } from '../utils/svgExport';

export interface TemplateManifest {
  id: string;
  name: string;
  category: string;
  mode: DesignMode;
  badge: string;
  version: string;
  updatedAt?: string;
  author?: string;
  description: string;
  highlights?: string[];
  projectFile: string;
  preview: string;
  tags?: string[];
}

export interface TemplateCatalogStats {
  nodes: number;
  assets: number;
  racks: number;
  cables: number;
  floors: number;
}

export interface TemplateCatalogEntry {
  id: string;
  slug: string;
  name: string;
  category: string;
  mode: DesignMode;
  badge: string;
  version: string;
  updatedAt: string;
  author: string;
  description: string;
  highlights: string[];
  tags: string[];
  projectUrl: string;
  previewUrl: string | null;
  hasProjectData: boolean;
  stats?: TemplateCatalogStats;
  validationError?: string;
  previewError?: string;
}

export interface TemplateCatalogFile {
  schemaVersion: number;
  generatedAt: string;
  totalTemplates: number;
  categories: string[];
  templates: TemplateCatalogEntry[];
  buildErrors?: Array<{ folder: string; message: string }>;
}

export interface FetchCatalogResult {
  catalog: TemplateCatalogFile;
  source: 'online' | 'cache';
  fetchedAt: string;
}

export type TemplateLoadResult =
  | {
      ok: true;
      project: ProjectState;
      warnings: string[];
      entry?: TemplateCatalogEntry;
    }
  | {
      ok: false;
      error: string;
      entry?: TemplateCatalogEntry;
    };

export interface TemplateExportInput {
  slug?: string;
  id?: string;
  name: string;
  category: string;
  mode?: DesignMode;
  badge?: string;
  version?: string;
  author?: string;
  description?: string;
  highlights?: string[];
  tags?: string[];
}

export interface TemplateExportBundle {
  slug: string;
  manifest: TemplateManifest;
  templateJsonString: string;
  projectJsonString: string;
  previewSvgString: string;
  previewFilename: string;
  zipBytes: Uint8Array;
  zipFilename: string;
}

export const TEMPLATE_CATALOG_URL = '/templates/catalog.json';
const TEMPLATE_FAVORITES_KEY = 'hachihi_template_favorites_v1';
const TEMPLATE_CATALOG_CACHE_KEY = 'hachihi_template_catalog_cache_v1';

const VALID_DESIGN_MODES: ReadonlySet<DesignMode> = new Set<DesignMode>([
  'floorplan',
  'topology',
  'rack',
  'cctv',
  'wifi',
  'fiber',
  'electrical',
  'multisite'
]);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

export function slugifyTemplateId(raw: string): string {
  const ascii = (raw || 'custom-template')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return ascii || 'custom-template';
}

export function normalizeTemplateCatalogEntry(raw: unknown, index: number): TemplateCatalogEntry {
  if (!isPlainObject(raw)) {
    return {
      id: `invalid_tpl_${index}`,
      slug: `invalid-${index}`,
      name: `Mẫu không hợp lệ #${index + 1}`,
      category: 'Khác',
      mode: 'topology',
      badge: 'Lỗi cấu trúc',
      version: '0.0.0',
      updatedAt: '',
      author: 'HACHIHI',
      description: 'Mục template trong catalog không phải đối tượng JSON hợp lệ.',
      highlights: [],
      tags: [],
      projectUrl: '',
      previewUrl: null,
      hasProjectData: false,
      validationError: 'Dữ liệu metadata trong catalog.json bị sai định dạng.'
    };
  }

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `tpl_unknown_${index}`;
  const slug = typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug.trim() : id;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const category =
    typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : 'Khác';
  const rawMode = typeof raw.mode === 'string' ? (raw.mode as DesignMode) : 'topology';
  const mode: DesignMode = VALID_DESIGN_MODES.has(rawMode) ? rawMode : 'topology';
  const badge = typeof raw.badge === 'string' && raw.badge.trim() ? raw.badge.trim() : mode.toUpperCase();
  const version = typeof raw.version === 'string' && raw.version.trim() ? raw.version.trim() : '1.0.0';
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : '';
  const author = typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : 'HACHIHI';
  const description = typeof raw.description === 'string' ? raw.description : '';
  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 8)
    : [];
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 12)
    : [];
  const projectUrl = typeof raw.projectUrl === 'string' ? raw.projectUrl.trim() : '';
  const previewUrl =
    typeof raw.previewUrl === 'string' && raw.previewUrl.trim() ? raw.previewUrl.trim() : null;

  let validationError =
    typeof raw.validationError === 'string' && raw.validationError.trim()
      ? raw.validationError.trim()
      : undefined;

  if (!projectUrl && !validationError) {
    validationError = 'Thiếu đường dẫn project.json cho template này.';
  }

  const statsRaw = isPlainObject(raw.stats) ? raw.stats : null;
  const stats: TemplateCatalogStats | undefined = statsRaw
    ? {
        nodes: Number(statsRaw.nodes) || 0,
        assets: Number(statsRaw.assets) || 0,
        racks: Number(statsRaw.racks) || 0,
        cables: Number(statsRaw.cables) || 0,
        floors: Number(statsRaw.floors) || 0
      }
    : undefined;

  return {
    id,
    slug,
    name,
    category,
    mode,
    badge,
    version,
    updatedAt,
    author,
    description,
    highlights,
    tags,
    projectUrl,
    previewUrl,
    hasProjectData: Boolean(raw.hasProjectData) && !validationError && Boolean(projectUrl),
    stats,
    validationError,
    previewError: typeof raw.previewError === 'string' && raw.previewError.trim() ? raw.previewError.trim() : undefined
  };
}

export function normalizeTemplateCatalogPayload(raw: unknown): TemplateCatalogFile {
  if (!isPlainObject(raw) || !Array.isArray(raw.templates)) {
    throw new Error('File catalog.json không đúng cấu trúc thư viện template.');
  }

  const templates = raw.templates.map((item, idx) => normalizeTemplateCatalogEntry(item, idx));
  const derivedCategories = Array.from(new Set(templates.map(t => t.category).filter(Boolean)));
  const categories =
    Array.isArray(raw.categories) && raw.categories.length > 0
      ? raw.categories.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : derivedCategories;

  const buildErrors = Array.isArray(raw.buildErrors)
    ? raw.buildErrors
        .filter((e): e is { folder: string; message: string } =>
          isPlainObject(e) && typeof e.folder === 'string' && typeof e.message === 'string'
        )
    : undefined;

  return {
    schemaVersion: Number(raw.schemaVersion) || 1,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    totalTemplates: templates.length,
    categories,
    templates,
    ...(buildErrors && buildErrors.length > 0 ? { buildErrors } : {})
  };
}

function readCachedCatalog(): TemplateCatalogFile | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(TEMPLATE_CATALOG_CACHE_KEY);
    if (!raw) return null;
    return normalizeTemplateCatalogPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedCatalog(catalog: TemplateCatalogFile): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(TEMPLATE_CATALOG_CACHE_KEY, JSON.stringify(catalog));
  } catch {
    // ignore storage quota errors
  }
}

export function invalidateTemplateCatalogCache(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(TEMPLATE_CATALOG_CACHE_KEY);
  } catch {
    // ignore storage failures
  }
}

export async function fetchTemplateCatalog(options?: {
  forceRefresh?: boolean;
  catalogUrl?: string;
}): Promise<FetchCatalogResult> {
  const baseUrl = options?.catalogUrl || TEMPLATE_CATALOG_URL;
  const requestUrl = options?.forceRefresh
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
    : baseUrl;

  try {
    const response = await fetch(requestUrl, {
      cache: options?.forceRefresh ? 'reload' : 'no-cache',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} khi tải catalog template.`);
    }
    const parsed: unknown = await response.json();
    const catalog = normalizeTemplateCatalogPayload(parsed);
    writeCachedCatalog(catalog);
    return {
      catalog,
      source: 'online',
      fetchedAt: new Date().toISOString()
    };
  } catch (err) {
    const cached = readCachedCatalog();
    if (cached) {
      return {
        catalog: cached,
        source: 'cache',
        fetchedAt: cached.generatedAt
      };
    }
    throw new Error(
      err instanceof Error
        ? `Không thể tải danh sách Template từ thư viện (${err.message}).`
        : 'Không thể tải danh sách Template từ thư viện.'
    );
  }
}

export async function refreshTemplateCatalog(options?: {
  catalogUrl?: string;
}): Promise<FetchCatalogResult> {
  return fetchTemplateCatalog({
    catalogUrl: options?.catalogUrl,
    forceRefresh: true
  });
}

/**
 * Validates, migrates, and isolates raw template project JSON into a brand-new independent ProjectState:
 * 1. Validates JSON object shape & schema limits
 * 2. Runs migration if template uses an older schemaVersion
 * 3. Generates a fresh project ID distinct from template ID
 * 4. Deep-clones data so edits never mutate template definitions
 */
export function prepareProjectFromRawTemplateJson(
  rawJson: unknown,
  entry?: Pick<TemplateCatalogEntry, 'id' | 'name' | 'mode' | 'version' | 'author'>
): TemplateLoadResult {
  const validated = migrateAndValidateProject(rawJson);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const nowIso = new Date().toISOString();
  const cloned = structuredClone(validated.project);
  const uniqueId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const prepared: ProjectState = {
    ...cloned,
    id: uniqueId,
    name: cloned.name?.trim() || entry?.name || 'Dự án từ Template',
    author: cloned.author?.trim() || entry?.author || 'HACHIHI User',
    version: cloned.version?.trim() || entry?.version || '1.0.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeMode: cloned.activeMode || entry?.mode || 'topology',
    lastModified: nowIso,
    lastSavedAt: nowIso
  };

  return {
    ok: true,
    project: prepared,
    warnings: validated.warnings
  };
}

export async function fetchAndPrepareTemplateProject(
  entry: TemplateCatalogEntry
): Promise<TemplateLoadResult> {
  if (entry.validationError || !entry.projectUrl) {
    return {
      ok: false,
      error: entry.validationError || `Template "${entry.name}" thiếu dữ liệu project.json hợp lệ.`,
      entry
    };
  }

  try {
    const url = entry.projectUrl;
    const resp = await fetch(url, {
      cache: 'no-cache',
      headers: { Accept: 'application/json' }
    });
    if (!resp.ok) {
      return {
        ok: false,
        error: `Không tải được tệp project.json của "${entry.name}" (HTTP ${resp.status}).`,
        entry
      };
    }

    let rawJson: unknown;
    try {
      rawJson = await resp.json();
    } catch {
      return {
        ok: false,
        error: `Tệp project.json của "${entry.name}" bị lỗi cú pháp JSON.`,
        entry
      };
    }

    const prepared = prepareProjectFromRawTemplateJson(rawJson, entry);
    if (!prepared.ok) {
      return {
        ok: false,
        error: `Dữ liệu mẫu "${entry.name}" không hợp lệ: ${prepared.error}`,
        entry
      };
    }

    return {
      ok: true,
      project: prepared.project,
      warnings: prepared.warnings,
      entry
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Lỗi kết nối khi tải mẫu "${entry.name}": ${err.message}`
          : `Lỗi không xác định khi tải mẫu "${entry.name}".`,
      entry
    };
  }
}

export function getFavoriteTemplateIds(): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(TEMPLATE_FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export function setFavoriteTemplateIds(ids: string[]): string[] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(TEMPLATE_FAVORITES_KEY, JSON.stringify(unique));
    }
  } catch {
    // ignore storage failures
  }
  return unique;
}

export function toggleFavoriteTemplateId(id: string): string[] {
  const current = getFavoriteTemplateIds();
  const exists = current.includes(id);
  const next = exists ? current.filter(x => x !== id) : [id, ...current];
  return setFavoriteTemplateIds(next);
}

function triggerFileDownload(blobParts: BlobPart[], mimeType: string, filename: string): void {
  const blob = new Blob(blobParts, { type: mimeType });
  const urlApi = window.URL || window.webkitURL;
  const url = urlApi.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  urlApi.revokeObjectURL(url);
}

export async function downloadTemplateProjectJson(entry: TemplateCatalogEntry): Promise<TemplateLoadResult> {
  const res = await fetchAndPrepareTemplateProject(entry);
  if (!res.ok) return res;
  const jsonText = JSON.stringify(res.project, null, 2);
  triggerFileDownload([jsonText], 'application/json;charset=utf-8', `${entry.slug || entry.id}.project.json`);
  return res;
}

export interface TemplateExportPackageOptions {
  previewRasterBytes?: Uint8Array;
  previewExtension?: 'png' | 'webp';
}

export function generateTemplateSnapshotSvg(project: ProjectState): string {
  return generateCompositeBuildingSvgMarkup(project, {
    darkTheme: false,
    includeTitleBlock: false,
    whiteBackground: true
  });
}

/**
 * Rasterizes the composite SVG snapshot to PNG/WebP bytes in browser environments.
 * Returns null in headless Node tests or if canvas rendering fails so SVG fallback is used cleanly.
 */
export async function rasterizeSvgSnapshotBytes(
  svgMarkup: string,
  mimeType: 'image/png' | 'image/webp' = 'image/png',
  maxWidth = 1280,
  maxHeight = 800
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL === 'undefined') {
    return null;
  }
  try {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Không thể dựng ảnh chụp snapshot từ SVG.'));
        el.src = objectUrl;
      });
      const natW = Math.max(320, img.naturalWidth || maxWidth);
      const natH = Math.max(200, img.naturalHeight || maxHeight);
      const scale = Math.min(maxWidth / natW, maxHeight / natH, 1);
      const outW = Math.max(320, Math.round(natW * scale));
      const outH = Math.max(200, Math.round(natH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(img, 0, 0, outW, outH);

      const outBlob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(b => resolve(b), mimeType, 0.92)
      );
      if (!outBlob || outBlob.size === 0) return null;
      const buf = await outBlob.arrayBuffer();
      return new Uint8Array(buf);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/**
 * Exports an active ProjectState into a complete GitHub-ready Template Folder bundle:
 * - <slug>/template.json
 * - <slug>/project.json
 * - <slug>/preview.png (or preview.webp / preview.svg fallback)
 * - <slug>/README.txt
 */
export function buildTemplateExportPackage(
  project: ProjectState,
  input: TemplateExportInput,
  options?: TemplateExportPackageOptions
): TemplateExportBundle {
  const name = input.name.trim() || project.name || 'HACHIHI Custom Template';
  const slug = slugifyTemplateId(input.slug?.trim() || name);
  const id = input.id?.trim() || slug;
  const mode = input.mode || project.activeMode || 'topology';
  const category = input.category.trim() || 'Mạng LAN';
  const version = input.version?.trim() || '1.0.0';
  const author = input.author?.trim() || project.author || 'HACHIHI';
  const badge = input.badge?.trim() || category;
  const description =
    input.description?.trim() ||
    `Mẫu thiết kế ${name} (${project.nodes.length} nút, ${Object.keys(project.assets).length} thiết bị, ${project.cables.length} tuyến cáp).`;

  const highlights = (input.highlights || [])
    .map(s => s.trim())
    .filter(Boolean);
  const tags = (input.tags || [])
    .map(s => s.trim())
    .filter(Boolean);

  const hasRaster = Boolean(options?.previewRasterBytes && options.previewRasterBytes.byteLength > 0);
  const previewFilename = hasRaster
    ? `preview.${options?.previewExtension === 'webp' ? 'webp' : 'png'}`
    : 'preview.svg';

  const manifest: TemplateManifest = {
    id,
    name,
    category,
    mode,
    badge,
    version,
    updatedAt: new Date().toISOString().slice(0, 10),
    author,
    description,
    highlights:
      highlights.length > 0
        ? highlights
        : [
            `${project.floors?.length || 1} tầng`,
            `${Object.keys(project.assets).length} thiết bị`,
            `${project.racks.length} tủ Rack`,
            `${project.cables.length} tuyến cáp`
          ],
    projectFile: 'project.json',
    preview: previewFilename,
    tags: tags.length > 0 ? tags : [category, mode.toUpperCase()]
  };

  const sanitizedProject: ProjectState = {
    ...structuredClone(project),
    id: `tpl_project_${slug}`,
    name,
    author,
    version,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastModified: new Date().toISOString(),
    lastSavedAt: new Date().toISOString()
  };

  const previewSvgString = generateTemplateSnapshotSvg(sanitizedProject);
  const templateJsonString = JSON.stringify(manifest, null, 2);
  const projectJsonString = JSON.stringify(sanitizedProject, null, 2);
  const readmeText = [
    `HACHIHI Template Package: ${name} (${id})`,
    '',
    'Huong dan cap nhat len thu vien GitHub:',
    `1. Giai nen thu muc "${slug}/" vao duong dan "public/templates/${slug}/" trong repository.`,
    `2. Kiem tra du 3 tep: template.json, project.json, ${previewFilename}.`,
    '3. Commit va push len GitHub — Vercel se tu dong chay build va sinh catalog.json moi.',
    ''
  ].join('\n');

  const files: Record<string, Uint8Array> = {
    [`${slug}/template.json`]: strToU8(templateJsonString),
    [`${slug}/project.json`]: strToU8(projectJsonString),
    [`${slug}/preview.svg`]: strToU8(previewSvgString),
    [`${slug}/README.txt`]: strToU8(readmeText)
  };
  if (hasRaster && options?.previewRasterBytes) {
    files[`${slug}/${previewFilename}`] = options.previewRasterBytes;
  }

  const zipBytes = zipSync(files);

  return {
    slug,
    manifest,
    templateJsonString,
    projectJsonString,
    previewSvgString,
    previewFilename,
    zipBytes,
    zipFilename: `${slug}-template.zip`
  };
}

export function downloadTemplatePackageZip(
  project: ProjectState,
  input: TemplateExportInput,
  options?: TemplateExportPackageOptions
): TemplateExportBundle {
  const pkg = buildTemplateExportPackage(project, input, options);
  const copy = new Uint8Array(pkg.zipBytes);
  triggerFileDownload([copy.buffer], 'application/zip', pkg.zipFilename);
  return pkg;
}

export async function downloadTemplatePackageZipWithSnapshot(
  project: ProjectState,
  input: TemplateExportInput
): Promise<TemplateExportBundle> {
  const previewSvg = generateTemplateSnapshotSvg(project);
  const pngBytes = await rasterizeSvgSnapshotBytes(previewSvg, 'image/png');
  return downloadTemplatePackageZip(
    project,
    input,
    pngBytes ? { previewRasterBytes: pngBytes, previewExtension: 'png' } : undefined
  );
}

export function downloadTemplateSingleFiles(
  project: ProjectState,
  input: TemplateExportInput
): TemplateExportBundle {
  const pkg = buildTemplateExportPackage(project, input);
  triggerFileDownload([pkg.templateJsonString], 'application/json;charset=utf-8', 'template.json');
  window.setTimeout(() => {
    triggerFileDownload([pkg.projectJsonString], 'application/json;charset=utf-8', 'project.json');
  }, 120);
  return pkg;
}
