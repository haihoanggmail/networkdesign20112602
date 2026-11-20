import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface BuiltTemplateStats {
  nodes: number;
  assets: number;
  racks: number;
  cables: number;
  floors: number;
}

export interface BuiltTemplateCatalogEntry {
  id: string;
  slug: string;
  name: string;
  category: string;
  mode: string;
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
  stats?: BuiltTemplateStats;
  validationError?: string;
  previewError?: string;
}

export interface BuiltTemplateCatalogFile {
  schemaVersion: number;
  generatedAt: string;
  totalTemplates: number;
  categories: string[];
  templates: BuiltTemplateCatalogEntry[];
  buildErrors?: Array<{ folder: string; message: string }>;
}

const VALID_MODES = new Set([
  'floorplan',
  'topology',
  'rack',
  'cctv',
  'wifi',
  'fiber',
  'electrical',
  'multisite'
]);

const PREVIEW_CANDIDATES = ['preview.webp', 'preview.png', 'preview.jpg', 'preview.jpeg', 'preview.svg'];

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function resolveSafeSubpath(folderDir: string, relativeName: string): string | null {
  const cleaned = relativeName.trim().replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || path.isAbsolute(cleaned)) return null;
  const resolved = path.resolve(folderDir, cleaned);
  if (!resolved.startsWith(folderDir + path.sep) && resolved !== folderDir) return null;
  return resolved;
}

function validateProjectFile(projectPath: string): {
  ok: boolean;
  error?: string;
  stats?: BuiltTemplateStats;
} {
  if (!fs.existsSync(projectPath)) {
    return { ok: false, error: `Không tìm thấy tệp dữ liệu ${path.basename(projectPath)}.` };
  }
  let parsed: unknown;
  try {
    const rawText = fs.readFileSync(projectPath, 'utf8');
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: `Tệp ${path.basename(projectPath)} bị lỗi cú pháp JSON.` };
  }

  if (!isPlainRecord(parsed)) {
    return { ok: false, error: `Nội dung ${path.basename(projectPath)} không phải đối tượng JSON hợp lệ.` };
  }
  if (!isPlainRecord(parsed.assets)) {
    return { ok: false, error: `Thiếu trường assets trong ${path.basename(projectPath)}.` };
  }
  if (!Array.isArray(parsed.nodes)) {
    return { ok: false, error: `Thiếu mảng nodes trong ${path.basename(projectPath)}.` };
  }

  return {
    ok: true,
    stats: {
      nodes: parsed.nodes.length,
      assets: Object.keys(parsed.assets).length,
      racks: Array.isArray(parsed.racks) ? parsed.racks.length : 0,
      cables: Array.isArray(parsed.cables) ? parsed.cables.length : 0,
      floors: Array.isArray(parsed.floors) ? parsed.floors.length : 0
    }
  };
}

export function buildTemplateCatalogFromDir(
  templatesRootDir: string,
  options?: { urlPrefix?: string; writeOutput?: boolean; outputFilePath?: string }
): BuiltTemplateCatalogFile {
  const urlPrefix = (options?.urlPrefix || '/templates').replace(/\/+$/, '');
  const writeOutput = options?.writeOutput !== false;
  const outputPath = options?.outputFilePath || path.join(templatesRootDir, 'catalog.json');

  const templates: BuiltTemplateCatalogEntry[] = [];
  const buildErrors: Array<{ folder: string; message: string }> = [];

  if (!fs.existsSync(templatesRootDir)) {
    if (writeOutput) {
      fs.mkdirSync(templatesRootDir, { recursive: true });
    }
  } else {
    const dirEntries = fs
      .readdirSync(templatesRootDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

    for (const dirent of dirEntries) {
      const folderName = dirent.name;
      const folderDir = path.join(templatesRootDir, folderName);
      const manifestPath = path.join(folderDir, 'template.json');

      if (!fs.existsSync(manifestPath)) {
        buildErrors.push({
          folder: folderName,
          message: 'Thiếu tệp template.json trong thư mục mẫu.'
        });
        continue;
      }

      let manifestRaw: unknown;
      try {
        manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        const msg = 'Tệp template.json không đúng định dạng JSON.';
        buildErrors.push({ folder: folderName, message: msg });
        templates.push({
          id: `broken_${folderName}`,
          slug: folderName,
          name: folderName,
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
        });
        continue;
      }

      if (!isPlainRecord(manifestRaw)) {
        const msg = 'template.json phải là đối tượng JSON.';
        buildErrors.push({ folder: folderName, message: msg });
        continue;
      }

      const id =
        typeof manifestRaw.id === 'string' && manifestRaw.id.trim()
          ? manifestRaw.id.trim()
          : folderName;
      const name =
        typeof manifestRaw.name === 'string' && manifestRaw.name.trim()
          ? manifestRaw.name.trim()
          : folderName;
      const category =
        typeof manifestRaw.category === 'string' && manifestRaw.category.trim()
          ? manifestRaw.category.trim()
          : 'Khác';
      const rawMode = typeof manifestRaw.mode === 'string' ? manifestRaw.mode.trim() : 'topology';
      const mode = VALID_MODES.has(rawMode) ? rawMode : 'topology';
      const badge =
        typeof manifestRaw.badge === 'string' && manifestRaw.badge.trim()
          ? manifestRaw.badge.trim()
          : category;
      const version =
        typeof manifestRaw.version === 'string' && manifestRaw.version.trim()
          ? manifestRaw.version.trim()
          : '1.0.0';
      const author =
        typeof manifestRaw.author === 'string' && manifestRaw.author.trim()
          ? manifestRaw.author.trim()
          : 'HACHIHI';
      const description =
        typeof manifestRaw.description === 'string' ? manifestRaw.description.trim() : '';
      const highlights = Array.isArray(manifestRaw.highlights)
        ? manifestRaw.highlights.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : [];
      const tags = Array.isArray(manifestRaw.tags)
        ? manifestRaw.tags.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : [];

      const manifestStat = fs.statSync(manifestPath);
      const updatedAt =
        typeof manifestRaw.updatedAt === 'string' && manifestRaw.updatedAt.trim()
          ? manifestRaw.updatedAt.trim()
          : manifestStat.mtime.toISOString().slice(0, 10);

      const projectFileName =
        typeof manifestRaw.projectFile === 'string' && manifestRaw.projectFile.trim()
          ? manifestRaw.projectFile.trim()
          : 'project.json';
      const resolvedProjectPath = resolveSafeSubpath(folderDir, projectFileName);
      const projectCheck = resolvedProjectPath
        ? validateProjectFile(resolvedProjectPath)
        : { ok: false, error: 'Đường dẫn projectFile không hợp lệ.' };

      if (!projectCheck.ok && projectCheck.error) {
        buildErrors.push({ folder: folderName, message: projectCheck.error });
      }

      // Resolve preview file (explicit preview field or auto-detect preview.webp/png/jpg/svg)
      let previewUrl: string | null = null;
      let previewError: string | undefined;
      const requestedPreview =
        typeof manifestRaw.preview === 'string' && manifestRaw.preview.trim()
          ? manifestRaw.preview.trim()
          : '';

      if (requestedPreview) {
        const previewPath = resolveSafeSubpath(folderDir, requestedPreview);
        if (previewPath && fs.existsSync(previewPath) && fs.statSync(previewPath).size > 0) {
          previewUrl = `${urlPrefix}/${encodeURIComponent(folderName)}/${requestedPreview
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`;
        } else {
          // Try auto-fallback if another preview format exists in folder
          const fallbackCandidate = PREVIEW_CANDIDATES.find(cand => {
            const candPath = path.join(folderDir, cand);
            return fs.existsSync(candPath) && fs.statSync(candPath).size > 0;
          });
          if (fallbackCandidate) {
            previewUrl = `${urlPrefix}/${encodeURIComponent(folderName)}/${encodeURIComponent(fallbackCandidate)}`;
          } else {
            previewError = `Không tìm thấy ảnh xem trước (${requestedPreview}).`;
            buildErrors.push({ folder: folderName, message: previewError });
          }
        }
      } else {
        const detectedPreview = PREVIEW_CANDIDATES.find(cand => {
          const candPath = path.join(folderDir, cand);
          return fs.existsSync(candPath) && fs.statSync(candPath).size > 0;
        });
        if (detectedPreview) {
          previewUrl = `${urlPrefix}/${encodeURIComponent(folderName)}/${encodeURIComponent(detectedPreview)}`;
        }
      }

      templates.push({
        id,
        slug: folderName,
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
        projectUrl: projectCheck.ok
          ? `${urlPrefix}/${encodeURIComponent(folderName)}/${projectFileName
              .split('/')
              .map(encodeURIComponent)
              .join('/')}`
          : '',
        previewUrl,
        hasProjectData: projectCheck.ok,
        ...(projectCheck.stats ? { stats: projectCheck.stats } : {}),
        ...(projectCheck.ok ? {} : { validationError: projectCheck.error }),
        ...(previewError ? { previewError } : {})
      });
    }
  }

  const categories = Array.from(new Set(templates.map(t => t.category).filter(Boolean)));
  const catalog: BuiltTemplateCatalogFile = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totalTemplates: templates.length,
    categories,
    templates,
    ...(buildErrors.length > 0 ? { buildErrors } : {})
  };

  if (writeOutput) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  }

  return catalog;
}

const isCliEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCliEntry) {
  const templatesDir = path.resolve(process.cwd(), 'public', 'templates');
  const catalog = buildTemplateCatalogFromDir(templatesDir);
  const errorCount = catalog.buildErrors?.length || 0;
  console.log(
    `[templates] Built catalog.json: ${catalog.totalTemplates} templates across ${catalog.categories.length} categories` +
      (errorCount > 0 ? ` (${errorCount} per-template warnings)` : '')
  );
}
