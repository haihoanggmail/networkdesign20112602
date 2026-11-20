import {
  CustomDevicePreset,
  DEVICE_CATALOG,
  getCategoryAccentColor,
  loadCustomDevicePresets,
  saveCustomDevicePresets
} from '../data/deviceCatalog';
import {
  DeviceAsset,
  ProjectRevision,
  ProjectState,
  ProjectSummary
} from '../types/infrastructure';
import {
  CURRENT_SCHEMA_VERSION,
  listRevisionsFromDB,
  migrateAndValidateProject
} from './projectStorage';
import {
  checkImportPayloadSize,
  getUtf8ByteLength,
  MAX_BUNDLE_PROJECTS,
  MAX_IMPORT_JSON_BYTES,
  sanitizeSafeImageUrl
} from './security';
import { APP_VERSION } from '../config/appInfo';
import type { CADDocument } from '../cad/core/CADTypes';
import { createCadId } from '../cad/core/CADRegistry';
import { cadRepository } from '../cad/storage/CADRepository';

const MAX_EMBEDDED_CAD_JSON_BYTES = 8 * 1024 * 1024; // 8 MB safe CAD budget inside 15 MB package cap

export const PACKAGE_FORMAT_TAG = 'hachihi.project.package' as const;
export const PACKAGE_FORMAT_VERSION = 1;
export { APP_VERSION };
export const CUSTOM_DEVICES_UPDATED_EVENT = 'hachihi-custom-devices-updated';

export interface HachihiPackageManifest {
  format: typeof PACKAGE_FORMAT_TAG;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  exportedBy: string;
  projectId: string;
  projectName: string;
  counts: {
    buildings: number;
    floors: number;
    rooms: number;
    racks: number;
    assets: number;
    nodes: number;
    cables: number;
    revisions: number;
    customDevices: number;
    embeddedImages: number;
    cadDocuments?: number;
  };
}

export interface EmbeddedImageResource {
  originalUrl: string;
  dataUrl: string;
  mimeType: string;
  usedBy: Array<'background' | 'node' | 'asset'>;
}

export interface HachihiPackageResources {
  embeddedImages: EmbeddedImageResource[];
  usedCustomDevices: CustomDevicePreset[];
  fullCustomLibrary?: CustomDevicePreset[];
  cadDocuments?: CADDocument[];
}

export interface HachihiProjectPackage {
  manifest: HachihiPackageManifest;
  project: ProjectState;
  resources: HachihiPackageResources;
  revisions?: ProjectRevision[];
  checksum: {
    algorithm: 'SHA-256';
    digest: string;
  };
}

export interface CreateProjectPackageOptions {
  includeRevisions?: boolean;
  includeFullCustomLibrary?: boolean;
  includeCadDocuments?: boolean;
  embedExternalImages?: boolean;
  revisionsOverride?: ProjectRevision[];
  customLibraryOverride?: CustomDevicePreset[];
  cadDocumentsOverride?: CADDocument[];
  exportedBy?: string;
}

export interface CreateProjectPackageResult {
  pkg: HachihiProjectPackage;
  jsonString: string;
  warnings: string[];
}

export type PackageIntegrityStatus = 'valid' | 'tampered' | 'missing' | 'legacy_raw';

export interface PackagePreviewInspection {
  ok: true;
  kind: 'package' | 'raw_project';
  fileName?: string;
  manifest: HachihiPackageManifest;
  integrityStatus: PackageIntegrityStatus;
  isNewerFormat: boolean;
  isNewerSchema: boolean;
  newerVersionReason?: string;
  project: ProjectState;
  revisions: ProjectRevision[];
  usedCustomDevices: CustomDevicePreset[];
  fullCustomLibrary: CustomDevicePreset[];
  cadDocuments: CADDocument[];
  embeddedImageCount: number;
  conflictingProject?: ProjectSummary;
  skippedFields: string[];
  migrationWarnings: string[];
}

export type ImportPayloadInspection =
  | PackagePreviewInspection
  | {
      ok: true;
      kind: 'workspace_bundle';
      fileName?: string;
      exportedAt?: string;
      projects: ProjectState[];
      failedCount: number;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

const KNOWN_PROJECT_KEYS = new Set<string>([
  'id',
  'name',
  'author',
  'version',
  'schemaVersion',
  'lastModified',
  'lastSavedAt',
  'buildings',
  'floors',
  'rooms',
  'cableTrays',
  'racks',
  'assets',
  'nodes',
  'cables',
  'vlans',
  'subnets',
  'patchLinks',
  'activeMode',
  'activeBuildingId',
  'activeFloorId',
  'settings'
]);

const KNOWN_SETTINGS_KEYS = new Set<string>([
  'gridSize',
  'snapToGrid',
  'showRulers',
  'showGrid',
  'showPortLabels',
  'showIpAddresses',
  'showCableCodes',
  'showCoverageRadius',
  'unit',
  'scale',
  'backgroundColor',
  'backgroundPreset',
  'backgroundPattern',
  'backgroundImageUrl',
  'backgroundImageOpacity',
  'backgroundImageMode',
  'isDarkMode',
  'hiddenLayers',
  'lockedLayers',
  'autoLayeringEnabled',
  'guideLines',
  'ipRangeStart',
  'ipRangeEnd',
  'ipSubnetMask',
  'ipGateway',
  'experienceMode',
  'canvasPerformanceMode'
]);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Deterministic canonical JSON serialization (sorted keys, JSON.stringify-compatible omissions).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(item =>
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? 'null'
        : canonicalStringify(item)
    );
    return `[${items.join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    entries.push(`${JSON.stringify(key)}:${canonicalStringify(v)}`);
  }
  return `{${entries.join(',')}}`;
}

/**
 * Computes lowercase hex SHA-256 digest using Web Crypto (Browser & Node >= 19).
 */
export async function computeSha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Môi trường hiện tại không hỗ trợ Web Crypto SHA-256.');
  }
  const hashBuffer = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function fetchUrlAsDataUrl(
  url: string,
  timeoutMs = 3000
): Promise<{ dataUrl: string; mimeType: string } | null> {
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') {
    return null;
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const resp = await fetch(url, { signal: controller?.signal });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const mimeType = blob.type || 'image/png';
    if (!mimeType.startsWith('image/')) return null;

    const dataUrl = await new Promise<string | null>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
    return { dataUrl, mimeType };
  } catch {
    return null;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

function extractMimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match ? match[1] : 'image/png';
}

/**
 * Collects and converts external/relative images in the project to embedded data: URLs
 * so the package opens identically on offline/other machines.
 */
export async function inlineProjectImages(
  project: ProjectState,
  embedExternal = true
): Promise<{
  project: ProjectState;
  embeddedImages: EmbeddedImageResource[];
  warnings: string[];
}> {
  const cloned = structuredClone(project);
  const warnings: string[] = [];
  const urlCache = new Map<string, { dataUrl: string; mimeType: string; usedBy: Set<'background' | 'node' | 'asset'> }>();

  const registerOrInline = async (
    rawUrl: string | undefined,
    kind: 'background' | 'node' | 'asset',
    label: string
  ): Promise<string | undefined> => {
    const safeUrl = sanitizeSafeImageUrl(rawUrl);
    if (!safeUrl) return undefined;

    if (safeUrl.startsWith('data:image/')) {
      const existing = urlCache.get(safeUrl);
      if (existing) {
        existing.usedBy.add(kind);
      } else {
        urlCache.set(safeUrl, {
          dataUrl: safeUrl,
          mimeType: extractMimeFromDataUrl(safeUrl),
          usedBy: new Set([kind])
        });
      }
      return safeUrl;
    }

    if (!embedExternal) {
      return safeUrl;
    }

    const cached = urlCache.get(safeUrl);
    if (cached) {
      cached.usedBy.add(kind);
      return cached.dataUrl;
    }

    const converted = await fetchUrlAsDataUrl(safeUrl);
    if (converted) {
      urlCache.set(safeUrl, {
        dataUrl: converted.dataUrl,
        mimeType: converted.mimeType,
        usedBy: new Set([kind])
      });
      return converted.dataUrl;
    }

    warnings.push(`Không thể nhúng ảnh ngoài "${label}" (${safeUrl.slice(0, 64)}), giữ nguyên liên kết gốc.`);
    return safeUrl;
  };

  if (cloned.settings.backgroundImageUrl) {
    cloned.settings.backgroundImageUrl = await registerOrInline(
      cloned.settings.backgroundImageUrl,
      'background',
      'Ảnh nền bản vẽ'
    );
  }

  for (const node of cloned.nodes) {
    if (node.customImageUrl) {
      node.customImageUrl = await registerOrInline(
        node.customImageUrl,
        'node',
        node.label || node.id
      );
    }
  }

  for (const asset of Object.values(cloned.assets)) {
    if (asset.customImageUrl) {
      asset.customImageUrl = await registerOrInline(
        asset.customImageUrl,
        'asset',
        asset.name || asset.id
      );
    }
  }

  const embeddedImages: EmbeddedImageResource[] = Array.from(urlCache.entries()).map(
    ([originalUrl, entry]) => ({
      originalUrl,
      dataUrl: entry.dataUrl,
      mimeType: entry.mimeType,
      usedBy: Array.from(entry.usedBy)
    })
  );

  return { project: cloned, embeddedImages, warnings };
}

function assetMatchesPreset(
  asset: DeviceAsset,
  preset: { category: string; vendor: string; model: string }
): boolean {
  return (
    asset.category === preset.category &&
    asset.vendor.trim().toLowerCase() === preset.vendor.trim().toLowerCase() &&
    asset.model.trim().toLowerCase() === preset.model.trim().toLowerCase()
  );
}

/**
 * Finds all custom device presets used in this project (from local library + synthesized if needed)
 * so the target machine can continue editing/adding the exact same custom devices.
 */
export function collectUsedCustomDevices(
  project: ProjectState,
  libraryPresets: CustomDevicePreset[]
): CustomDevicePreset[] {
  const used = new Map<string, CustomDevicePreset>();
  const assets = Object.values(project.assets);

  for (const preset of libraryPresets) {
    if (assets.some(a => assetMatchesPreset(a, preset))) {
      used.set(preset.id, preset);
    }
  }

  // Synthesize portable preset definitions for non-standard assets not in built-in DEVICE_CATALOG
  for (const asset of assets) {
    const inBuiltIn = DEVICE_CATALOG.some(p => assetMatchesPreset(asset, p));
    if (inBuiltIn) continue;

    const alreadyInUsed = Array.from(used.values()).some(p => assetMatchesPreset(asset, p));
    if (alreadyInUsed) continue;

    const matchingNode = project.nodes.find(n => n.assetId === asset.id);
    const synthId = `custom_pkg_${asset.category}_${asset.model.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    used.set(synthId, {
      id: synthId,
      createdAt: project.lastModified || new Date().toISOString(),
      category: asset.category,
      name: asset.model && asset.model !== 'Standard' ? `${asset.vendor} ${asset.model}` : asset.name,
      vendor: asset.vendor || 'Tùy chỉnh',
      model: asset.model || asset.name,
      defaultUHeight: asset.rackUnitHeight || 1,
      powerWatts: asset.powerWatts || 0,
      weightKg: asset.weightKg || 1,
      defaultPorts: (asset.ports || []).map(pt => ({
        name: pt.name,
        type: pt.type,
        speed: pt.speed,
        poe: pt.poe
      })),
      description: `Thiết bị tùy chỉnh nhúng từ dự án "${project.name}"`,
      defaultWidth: matchingNode?.width || 140,
      defaultHeight: matchingNode?.height || 56,
      color: matchingNode?.style?.backgroundColor || getCategoryAccentColor(asset.category),
      iconName: matchingNode?.customIcon || asset.customIcon || 'Cpu'
    });
  }

  return Array.from(used.values());
}

/**
 * Builds a complete, integrity-protected `.hachihi.json` Project Package.
 */
export async function createProjectPackage(
  project: ProjectState,
  options: CreateProjectPackageOptions = {}
): Promise<CreateProjectPackageResult> {
  const {
    includeRevisions = true,
    includeFullCustomLibrary = true,
    includeCadDocuments = true,
    embedExternalImages = true,
    revisionsOverride,
    customLibraryOverride,
    cadDocumentsOverride,
    exportedBy
  } = options;

  const { project: inlinedProject, embeddedImages, warnings } = await inlineProjectImages(
    project,
    embedExternalImages
  );

  const libraryPresets = customLibraryOverride ?? loadCustomDevicePresets();
  const usedCustomDevices = collectUsedCustomDevices(inlinedProject, libraryPresets);

  let revisions: ProjectRevision[] | undefined;
  if (includeRevisions) {
    revisions = revisionsOverride ?? (await listRevisionsFromDB(project.id));
  }

  let includedCadDocuments: CADDocument[] = [];
  if (includeCadDocuments) {
    let candidateDocs: CADDocument[] = [];
    if (cadDocumentsOverride) {
      candidateDocs = cadDocumentsOverride;
    } else {
      try {
        const summaries = await cadRepository.listDocumentsForProject(project.id);
        for (const summary of summaries) {
          const loaded = await cadRepository.loadDocument(summary.id);
          if (loaded) candidateDocs.push(loaded);
        }
      } catch {
        // Ignore CAD IndexedDB read failure when exporting project package
      }
    }

    let usedCadBytes = 0;
    for (const rawDoc of candidateDocs) {
      const compactDoc: CADDocument = {
        ...structuredClone(rawDoc),
        projectId: project.id,
        rawSections: undefined
      };
      const serializedBytes = getUtf8ByteLength(JSON.stringify(compactDoc));
      if (usedCadBytes + serializedBytes > MAX_EMBEDDED_CAD_JSON_BYTES) {
        warnings.push(
          `Bản vẽ CAD "${compactDoc.name}" vượt ngân sách nhúng 8 MB nên đã được bỏ qua khỏi gói .hachihi.json.`
        );
        continue;
      }
      usedCadBytes += serializedBytes;
      includedCadDocuments.push(compactDoc);
    }
  }

  const resources: HachihiPackageResources = {
    embeddedImages,
    usedCustomDevices,
    ...(includeFullCustomLibrary ? { fullCustomLibrary: libraryPresets } : {}),
    ...(includedCadDocuments.length > 0 ? { cadDocuments: includedCadDocuments } : {})
  };

  const manifest: HachihiPackageManifest = {
    format: PACKAGE_FORMAT_TAG,
    formatVersion: PACKAGE_FORMAT_VERSION,
    schemaVersion: inlinedProject.schemaVersion || CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy || inlinedProject.author || 'Engineer',
    projectId: inlinedProject.id,
    projectName: inlinedProject.name,
    counts: {
      buildings: inlinedProject.buildings.length,
      floors: inlinedProject.floors.length,
      rooms: inlinedProject.rooms.length,
      racks: inlinedProject.racks.length,
      assets: Object.keys(inlinedProject.assets).length,
      nodes: inlinedProject.nodes.length,
      cables: inlinedProject.cables.length,
      revisions: revisions?.length ?? 0,
      customDevices: includeFullCustomLibrary
        ? Math.max(usedCustomDevices.length, libraryPresets.length)
        : usedCustomDevices.length,
      embeddedImages: embeddedImages.length,
      ...(includedCadDocuments.length > 0 ? { cadDocuments: includedCadDocuments.length } : {})
    }
  };

  const unsignedPayload = {
    manifest,
    project: inlinedProject,
    resources,
    ...(revisions !== undefined ? { revisions } : {})
  };

  const digest = await computeSha256Hex(canonicalStringify(unsignedPayload));

  const pkg: HachihiProjectPackage = {
    ...unsignedPayload,
    checksum: {
      algorithm: 'SHA-256',
      digest
    }
  };

  return {
    pkg,
    jsonString: JSON.stringify(pkg, null, 2),
    warnings
  };
}

function collectSkippedUnknownKeys(rawProject: unknown): string[] {
  if (!isPlainObject(rawProject)) return [];
  const skipped: string[] = [];

  for (const key of Object.keys(rawProject)) {
    if (!KNOWN_PROJECT_KEYS.has(key)) {
      skipped.push(`project.${key}`);
    }
  }

  if (isPlainObject(rawProject.settings)) {
    for (const sKey of Object.keys(rawProject.settings)) {
      if (!KNOWN_SETTINGS_KEYS.has(sKey)) {
        skipped.push(`settings.${sKey}`);
      }
    }
  }

  return skipped;
}

function applyEmbeddedImagesFallback(
  project: ProjectState,
  embeddedImages: EmbeddedImageResource[]
): ProjectState {
  if (!embeddedImages || embeddedImages.length === 0) return project;
  const byOriginalUrl = new Map<string, string>();
  for (const entry of embeddedImages) {
    if (entry.originalUrl && entry.dataUrl?.startsWith('data:image/')) {
      const safe = sanitizeSafeImageUrl(entry.dataUrl);
      if (safe) byOriginalUrl.set(entry.originalUrl, safe);
    }
  }
  if (byOriginalUrl.size === 0) return project;

  const next = structuredClone(project);
  if (next.settings.backgroundImageUrl && byOriginalUrl.has(next.settings.backgroundImageUrl)) {
    next.settings.backgroundImageUrl = byOriginalUrl.get(next.settings.backgroundImageUrl);
  }
  for (const node of next.nodes) {
    if (node.customImageUrl && byOriginalUrl.has(node.customImageUrl)) {
      node.customImageUrl = byOriginalUrl.get(node.customImageUrl);
    }
  }
  for (const asset of Object.values(next.assets)) {
    if (asset.customImageUrl && byOriginalUrl.has(asset.customImageUrl)) {
      asset.customImageUrl = byOriginalUrl.get(asset.customImageUrl);
    }
  }
  return next;
}

function sanitizeCustomPresets(rawList: unknown): CustomDevicePreset[] {
  if (!Array.isArray(rawList)) return [];
  return rawList.filter((item): item is CustomDevicePreset => {
    return (
      isPlainObject(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.category === 'string'
    );
  });
}

function sanitizeCadDocuments(rawList: unknown, fallbackProjectId: string): CADDocument[] {
  if (!Array.isArray(rawList)) return [];
  const valid: CADDocument[] = [];
  for (const item of rawList) {
    if (
      !isPlainObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      !Array.isArray(item.entities) ||
      !isPlainObject(item.layers) ||
      !isPlainObject(item.extents) ||
      !isPlainObject(item.underlay)
    ) {
      continue;
    }
    const clone = structuredClone(item) as unknown as CADDocument;
    clone.projectId = typeof clone.projectId === 'string' && clone.projectId ? clone.projectId : fallbackProjectId;
    valid.push(clone);
  }
  return valid;
}

/**
 * Inspects any imported JSON/.hachihi.json payload: verifies SHA-256 integrity,
 * detects newer format/schema versions, extracts embedded resources & revisions,
 * detects conflicting project IDs, and lists any skipped fields.
 */
export async function inspectProjectImportPayload(
  rawInput: unknown,
  existingProjects: ProjectSummary[] = [],
  fileName?: string
): Promise<ImportPayloadInspection> {
  let parsed: unknown = rawInput;
  if (typeof rawInput === 'string') {
    const sizeCheck = checkImportPayloadSize(rawInput, MAX_IMPORT_JSON_BYTES, fileName || 'tệp gói dự án');
    if (!sizeCheck.ok) {
      return { ok: false, error: sizeCheck.error };
    }
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      return { ok: false, error: 'Tệp không phải JSON hợp lệ hoặc đã bị hỏng cấu trúc.' };
    }
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Dữ liệu nhập không phải đối tượng gói dự án hợp lệ.' };
  }

  // Case 1: Workspace multi-project backup bundle
  if ('projects' in parsed && Array.isArray(parsed.projects)) {
    if (parsed.projects.length > MAX_BUNDLE_PROJECTS) {
      return {
        ok: false,
        error: `Gói sao lưu chứa ${parsed.projects.length} dự án, vượt quá giới hạn an toàn (${MAX_BUNDLE_PROJECTS} dự án/lần nhập).`
      };
    }
    const validProjects: ProjectState[] = [];
    const warnings: string[] = [];
    let failedCount = 0;

    for (const item of parsed.projects) {
      const mig = migrateAndValidateProject(item);
      if (mig.ok) {
        validProjects.push(mig.project);
        warnings.push(...mig.warnings);
      } else {
        failedCount++;
      }
    }

    if (validProjects.length === 0) {
      return { ok: false, error: 'Gói sao lưu nhiều dự án không chứa dự án hợp lệ nào.' };
    }

    return {
      ok: true,
      kind: 'workspace_bundle',
      fileName,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : undefined,
      projects: validProjects,
      failedCount,
      warnings
    };
  }

  // Case 2: Self-contained `.hachihi.json` Project Package
  if (isPlainObject(parsed.manifest) && parsed.manifest.format === PACKAGE_FORMAT_TAG) {
    const manifest = parsed.manifest as unknown as HachihiPackageManifest;
    const resources = isPlainObject(parsed.resources)
      ? (parsed.resources as unknown as HachihiPackageResources)
      : { embeddedImages: [], usedCustomDevices: [] };
    const revisions = Array.isArray(parsed.revisions)
      ? (parsed.revisions as ProjectRevision[]).filter(r => isPlainObject(r) && typeof r.id === 'string' && isPlainObject(r.snapshot))
      : [];

    // Verify SHA-256 checksum
    let integrityStatus: PackageIntegrityStatus = 'missing';
    if (isPlainObject(parsed.checksum) && parsed.checksum.algorithm === 'SHA-256' && typeof parsed.checksum.digest === 'string') {
      const unsignedPayload = {
        manifest: parsed.manifest,
        project: parsed.project,
        resources: parsed.resources,
        ...(parsed.revisions !== undefined ? { revisions: parsed.revisions } : {})
      };
      try {
        const expected = await computeSha256Hex(canonicalStringify(unsignedPayload));
        integrityStatus =
          expected.toLowerCase() === parsed.checksum.digest.toLowerCase() ? 'valid' : 'tampered';
      } catch {
        integrityStatus = 'missing';
      }
    }

    const isNewerFormat = Number(manifest.formatVersion) > PACKAGE_FORMAT_VERSION;
    const isNewerSchema = Number(manifest.schemaVersion) > CURRENT_SCHEMA_VERSION;
    const newerReasons: string[] = [];
    if (isNewerFormat) {
      newerReasons.push(`Định dạng gói v${manifest.formatVersion} mới hơn phiên bản hỗ trợ (v${PACKAGE_FORMAT_VERSION}).`);
    }
    if (isNewerSchema) {
      newerReasons.push(`Cấu trúc dữ liệu v${manifest.schemaVersion} (ứng dụng v${manifest.appVersion || '?'}) mới hơn bản hiện tại.`);
    }

    const skippedFields = collectSkippedUnknownKeys(parsed.project);
    const mig = migrateAndValidateProject(parsed.project);
    if (!mig.ok) {
      return { ok: false, error: mig.error };
    }

    const embeddedImages = Array.isArray(resources.embeddedImages) ? resources.embeddedImages : [];
    const hydratedProject = applyEmbeddedImagesFallback(mig.project, embeddedImages);
    const conflictingProject = existingProjects.find(p => p.id === hydratedProject.id);

    return {
      ok: true,
      kind: 'package',
      fileName,
      manifest,
      integrityStatus,
      isNewerFormat,
      isNewerSchema,
      newerVersionReason: newerReasons.length > 0 ? newerReasons.join(' ') : undefined,
      project: hydratedProject,
      revisions,
      usedCustomDevices: sanitizeCustomPresets(resources.usedCustomDevices),
      fullCustomLibrary: sanitizeCustomPresets(resources.fullCustomLibrary),
      cadDocuments: sanitizeCadDocuments(resources.cadDocuments, hydratedProject.id),
      embeddedImageCount: embeddedImages.length,
      conflictingProject,
      skippedFields,
      migrationWarnings: mig.warnings
    };
  }

  // Case 3: Legacy / Raw single ProjectState JSON
  const skippedFields = collectSkippedUnknownKeys(parsed);
  const mig = migrateAndValidateProject(parsed);
  if (!mig.ok) {
    return { ok: false, error: mig.error };
  }

  const rawSchema = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 3;
  const isNewerSchema = rawSchema > CURRENT_SCHEMA_VERSION;
  const conflictingProject = existingProjects.find(p => p.id === mig.project.id);

  const syntheticManifest: HachihiPackageManifest = {
    format: PACKAGE_FORMAT_TAG,
    formatVersion: 0,
    schemaVersion: rawSchema,
    appVersion: mig.project.version || '3.0.0',
    exportedAt: mig.project.lastModified || new Date().toISOString(),
    exportedBy: mig.project.author || 'Không rõ',
    projectId: mig.project.id,
    projectName: mig.project.name,
    counts: {
      buildings: mig.project.buildings.length,
      floors: mig.project.floors.length,
      rooms: mig.project.rooms.length,
      racks: mig.project.racks.length,
      assets: Object.keys(mig.project.assets).length,
      nodes: mig.project.nodes.length,
      cables: mig.project.cables.length,
      revisions: 0,
      customDevices: 0,
      embeddedImages: 0
    }
  };

  return {
    ok: true,
    kind: 'raw_project',
    fileName,
    manifest: syntheticManifest,
    integrityStatus: 'legacy_raw',
    isNewerFormat: false,
    isNewerSchema,
    newerVersionReason: isNewerSchema
      ? `Tệp dự án có schema v${rawSchema} mới hơn bản hiện tại (v${CURRENT_SCHEMA_VERSION}).`
      : undefined,
    project: mig.project,
    revisions: [],
    usedCustomDevices: [],
    fullCustomLibrary: [],
    cadDocuments: [],
    embeddedImageCount: 0,
    conflictingProject,
    skippedFields,
    migrationWarnings: mig.warnings
  };
}

/**
 * Merges imported custom device presets into local library without overwriting user's existing items.
 * Returns count of newly added presets.
 */
export function mergeImportedCustomDevices(presets: CustomDevicePreset[]): number {
  if (!presets || presets.length === 0) return 0;
  const existing = loadCustomDevicePresets();
  const next = [...existing];
  let added = 0;

  for (const preset of presets) {
    const duplicate = next.some(
      e =>
        e.id === preset.id ||
        (e.category === preset.category &&
          e.vendor.trim().toLowerCase() === preset.vendor.trim().toLowerCase() &&
          e.model.trim().toLowerCase() === preset.model.trim().toLowerCase())
    );
    if (!duplicate) {
      next.push(preset);
      added++;
    }
  }

  if (added > 0) {
    saveCustomDevicePresets(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CUSTOM_DEVICES_UPDATED_EVENT));
    }
  }
  return added;
}

/**
 * Clones an imported project with a brand-new project ID (safe "Import as New Copy")
 * and remaps associated revisions to the new projectId.
 */
export function cloneProjectForNewImport(
  project: ProjectState,
  revisions: ProjectRevision[] = [],
  cadDocuments: CADDocument[] = []
): { project: ProjectState; revisions: ProjectRevision[]; cadDocuments: CADDocument[] } {
  const now = new Date().toISOString();
  const newProjectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const clonedProject: ProjectState = {
    ...structuredClone(project),
    id: newProjectId,
    lastModified: now,
    lastSavedAt: now
  };
  const remappedRevisions: ProjectRevision[] = revisions.map((rev, idx) => ({
    ...structuredClone(rev),
    id: `rev_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
    projectId: newProjectId,
    snapshot: {
      ...structuredClone(rev.snapshot),
      id: newProjectId
    }
  }));
  const remappedCadDocuments: CADDocument[] = cadDocuments.map(doc => ({
    ...structuredClone(doc),
    id: createCadId('cad'),
    projectId: newProjectId,
    updatedAt: now
  }));

  return {
    project: clonedProject,
    revisions: remappedRevisions,
    cadDocuments: remappedCadDocuments
  };
}
