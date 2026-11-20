import defaultPricingCatalogJson from '../data/bomPricingCatalog.json';
import { CableEdge } from '../types/infrastructure';

const PRICE_OVERRIDES_STORAGE_KEY = 'hachihi_bom_price_overrides_v1';
const CUSTOM_CATALOG_STORAGE_KEY = 'hachihi_bom_pricing_catalog_v1';

export interface BomSkuPriceEntry {
  sku: string;
  unitPriceVnd: number;
  supplier: string;
}

export interface BomModelOverrideRule {
  pattern: string;
  flags?: string;
  sku: string;
  unitPriceVnd: number;
  supplier: string;
}

export interface BomPricingCatalogData {
  catalogVersion: string;
  currency: 'VND';
  updatedAt: string;
  sourceLabel?: string;
  quotationDefaults?: {
    defaultAuxMaterialPct: number;
    defaultLaborUnitPriceVnd: number;
  };
  deviceCategoryDefaults: Record<string, BomSkuPriceEntry>;
  modelOverrides: BomModelOverrideRule[];
  cablePricePerMeter: Record<CableEdge['cableType'], BomSkuPriceEntry>;
  accessoryPrices: Record<string, BomSkuPriceEntry>;
}

const DEFAULT_PRICING_CATALOG: BomPricingCatalogData = {
  catalogVersion: defaultPricingCatalogJson.catalogVersion || '2026.11-vn',
  currency: 'VND',
  updatedAt: defaultPricingCatalogJson.updatedAt || '2026-11-18',
  sourceLabel: defaultPricingCatalogJson.sourceLabel || 'HACHIHI Reference Catalog (JSON)',
  quotationDefaults: {
    defaultAuxMaterialPct: Number(defaultPricingCatalogJson.quotationDefaults?.defaultAuxMaterialPct) || 5,
    defaultLaborUnitPriceVnd:
      Number(defaultPricingCatalogJson.quotationDefaults?.defaultLaborUnitPriceVnd) || 650_000
  },
  deviceCategoryDefaults: defaultPricingCatalogJson.deviceCategoryDefaults as Record<string, BomSkuPriceEntry>,
  modelOverrides: defaultPricingCatalogJson.modelOverrides as BomModelOverrideRule[],
  cablePricePerMeter: defaultPricingCatalogJson.cablePricePerMeter as Record<
    CableEdge['cableType'],
    BomSkuPriceEntry
  >,
  accessoryPrices: defaultPricingCatalogJson.accessoryPrices as Record<string, BomSkuPriceEntry>
};

function normalizeSkuPriceEntry(raw: unknown, fallback?: BomSkuPriceEntry): BomSkuPriceEntry | null {
  if (!raw || typeof raw !== 'object') return fallback ? { ...fallback } : null;
  const obj = raw as Record<string, unknown>;
  const sku = typeof obj.sku === 'string' && obj.sku.trim() ? obj.sku.trim() : fallback?.sku || '';
  const unitPriceVnd = Number(obj.unitPriceVnd);
  const supplier =
    typeof obj.supplier === 'string' && obj.supplier.trim()
      ? obj.supplier.trim()
      : fallback?.supplier || 'HACHIHI Partner';
  if (!sku || !Number.isFinite(unitPriceVnd) || unitPriceVnd < 0) {
    return fallback ? { ...fallback } : null;
  }
  return {
    sku,
    unitPriceVnd: Math.round(unitPriceVnd),
    supplier
  };
}

function normalizePriceMap(
  rawMap: unknown,
  baseMap: Record<string, BomSkuPriceEntry>
): Record<string, BomSkuPriceEntry> {
  const out: Record<string, BomSkuPriceEntry> = {};
  for (const [k, baseVal] of Object.entries(baseMap)) {
    out[k] = { ...baseVal };
  }
  if (rawMap && typeof rawMap === 'object') {
    for (const [k, val] of Object.entries(rawMap as Record<string, unknown>)) {
      const normalized = normalizeSkuPriceEntry(val, out[k]);
      if (normalized) out[k] = normalized;
    }
  }
  return out;
}

export function getDefaultBomPricingCatalog(): BomPricingCatalogData {
  return structuredClone(DEFAULT_PRICING_CATALOG);
}

/**
 * Validates and merges any external JSON catalog payload (uploaded file or open API response)
 * onto the base schema so missing entries degrade safely.
 */
export function validateAndMergePricingCatalog(
  payload: unknown,
  sourceOverride?: string
): { ok: true; catalog: BomPricingCatalogData } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Tệp danh mục giá phải là một đối tượng JSON hợp lệ.' };
  }
  const obj = payload as Record<string, unknown>;
  const hasAnyPriceSection =
    obj.deviceCategoryDefaults || obj.modelOverrides || obj.cablePricePerMeter || obj.accessoryPrices;
  if (!hasAnyPriceSection) {
    return {
      ok: false,
      error: 'JSON thiếu các nhóm giá chuẩn (deviceCategoryDefaults, cablePricePerMeter, accessoryPrices...).'
    };
  }

  const base = DEFAULT_PRICING_CATALOG;
  const deviceCategoryDefaults = normalizePriceMap(obj.deviceCategoryDefaults, base.deviceCategoryDefaults);
  const cablePricePerMeter = normalizePriceMap(
    obj.cablePricePerMeter,
    base.cablePricePerMeter
  ) as Record<CableEdge['cableType'], BomSkuPriceEntry>;
  const accessoryPrices = normalizePriceMap(obj.accessoryPrices, base.accessoryPrices);

  const modelOverrides: BomModelOverrideRule[] = Array.isArray(obj.modelOverrides)
    ? obj.modelOverrides
        .map((item): BomModelOverrideRule | null => {
          if (!item || typeof item !== 'object') return null;
          const m = item as Record<string, unknown>;
          const pattern = typeof m.pattern === 'string' ? m.pattern.trim() : '';
          const sku = typeof m.sku === 'string' ? m.sku.trim() : '';
          const unitPriceVnd = Number(m.unitPriceVnd);
          const supplier = typeof m.supplier === 'string' && m.supplier.trim() ? m.supplier.trim() : 'Partner';
          const flags = typeof m.flags === 'string' ? m.flags : 'i';
          if (!pattern || !sku || !Number.isFinite(unitPriceVnd) || unitPriceVnd < 0) return null;
          try {
            // Verify regex pattern compiles safely
            void new RegExp(pattern, flags);
          } catch {
            return null;
          }
          return {
            pattern,
            flags,
            sku,
            unitPriceVnd: Math.round(unitPriceVnd),
            supplier
          };
        })
        .filter((r): r is BomModelOverrideRule => r !== null)
    : [...base.modelOverrides];

  const qRaw = (obj.quotationDefaults && typeof obj.quotationDefaults === 'object'
    ? obj.quotationDefaults
    : {}) as Record<string, unknown>;

  const catalog: BomPricingCatalogData = {
    catalogVersion:
      typeof obj.catalogVersion === 'string' && obj.catalogVersion.trim()
        ? obj.catalogVersion.trim()
        : base.catalogVersion,
    currency: 'VND',
    updatedAt:
      typeof obj.updatedAt === 'string' && obj.updatedAt.trim()
        ? obj.updatedAt.trim()
        : new Date().toISOString().slice(0, 10),
    sourceLabel:
      sourceOverride ||
      (typeof obj.sourceLabel === 'string' && obj.sourceLabel.trim()
        ? obj.sourceLabel.trim()
        : 'Danh mục giá tùy chỉnh (JSON)'),
    quotationDefaults: {
      defaultAuxMaterialPct: Number.isFinite(Number(qRaw.defaultAuxMaterialPct))
        ? Math.max(0, Math.min(50, Number(qRaw.defaultAuxMaterialPct)))
        : base.quotationDefaults?.defaultAuxMaterialPct ?? 5,
      defaultLaborUnitPriceVnd: Number.isFinite(Number(qRaw.defaultLaborUnitPriceVnd))
        ? Math.max(0, Math.round(Number(qRaw.defaultLaborUnitPriceVnd)))
        : base.quotationDefaults?.defaultLaborUnitPriceVnd ?? 650_000
    },
    deviceCategoryDefaults,
    modelOverrides: modelOverrides.length > 0 ? modelOverrides : [...base.modelOverrides],
    cablePricePerMeter,
    accessoryPrices
  };

  return { ok: true, catalog };
}

export function loadActivePricingCatalog(): BomPricingCatalogData {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_PRICING_CATALOG;
    const raw = localStorage.getItem(CUSTOM_CATALOG_STORAGE_KEY);
    if (!raw) return DEFAULT_PRICING_CATALOG;
    const parsed: unknown = JSON.parse(raw);
    const res = validateAndMergePricingCatalog(parsed);
    return res.ok ? res.catalog : DEFAULT_PRICING_CATALOG;
  } catch {
    return DEFAULT_PRICING_CATALOG;
  }
}

export function saveCustomPricingCatalog(catalog: BomPricingCatalogData): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CUSTOM_CATALOG_STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // ignore storage quota errors
  }
}

export function clearCustomPricingCatalog(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(CUSTOM_CATALOG_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function exportPricingCatalogJson(catalog?: BomPricingCatalogData): string {
  return JSON.stringify(catalog || loadActivePricingCatalog(), null, 2);
}

/**
 * Fetches an updated pricing catalog from an open HTTP(S) or relative JSON API endpoint.
 */
export async function fetchPricingCatalogFromApi(
  apiUrl: string
): Promise<{ ok: true; catalog: BomPricingCatalogData } | { ok: false; error: string }> {
  const trimmed = apiUrl.trim();
  if (!trimmed) {
    return { ok: false, error: 'Vui lòng nhập URL API danh mục giá (JSON).' };
  }
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/')) {
    return { ok: false, error: 'URL API phải bắt đầu bằng https://, http:// hoặc /api/...' };
  }
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    const res = await fetch(trimmed, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `API trả về mã lỗi HTTP ${res.status}.` };
    }
    const data: unknown = await res.json();
    const merged = validateAndMergePricingCatalog(data, `API: ${trimmed}`);
    if (!merged.ok) return merged;
    saveCustomPricingCatalog(merged.catalog);
    return merged;
  } catch (err: unknown) {
    return {
      ok: false,
      error: `Không thể tải danh mục giá từ API: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

export function loadBomPriceOverrides(): Record<string, number> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(PRICE_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) clean[k] = Math.round(n);
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveBomPriceOverrides(overrides: Record<string, number>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PRICE_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore quota errors
  }
}

export function clearBomPriceOverrides(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PRICE_OVERRIDES_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function buildGeneratedSku(category: string, vendor: string, model: string): string {
  const clean = (s: string, max: number) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, max);
  const vCode = clean(vendor, 3) || 'GEN';
  const cCode = clean(category, 3) || 'DEV';
  const mCode = clean(model, 8) || 'STD';
  return `${vCode}-${cCode}-${mCode}`;
}

export function resolveDeviceSkuAndPrice(
  key: string,
  category: string,
  vendor: string,
  model: string,
  overrides?: Record<string, number>,
  catalog?: BomPricingCatalogData
): BomSkuPriceEntry {
  const activeCatalog = catalog || loadActivePricingCatalog();
  const modelMatch = activeCatalog.modelOverrides.find(o => {
    try {
      return new RegExp(o.pattern, o.flags || 'i').test(model);
    } catch {
      return false;
    }
  });
  const catBase =
    activeCatalog.deviceCategoryDefaults[category] ||
    activeCatalog.deviceCategoryDefaults.other ||
    DEFAULT_PRICING_CATALOG.deviceCategoryDefaults.other;
  const sku = modelMatch ? modelMatch.sku : buildGeneratedSku(category, vendor, model);
  const supplier = modelMatch
    ? modelMatch.supplier
    : vendor && vendor !== 'Chưa rõ'
    ? vendor
    : catBase.supplier;
  const defaultPrice = modelMatch ? modelMatch.unitPriceVnd : catBase.unitPriceVnd;
  const customPrice = overrides?.[key] ?? overrides?.[sku];
  return {
    sku,
    unitPriceVnd: typeof customPrice === 'number' && Number.isFinite(customPrice) ? customPrice : defaultPrice,
    supplier
  };
}

export function resolveCableSkuAndPrice(
  cableType: CableEdge['cableType'],
  overrides?: Record<string, number>,
  catalog?: BomPricingCatalogData
): BomSkuPriceEntry {
  const activeCatalog = catalog || loadActivePricingCatalog();
  const base =
    activeCatalog.cablePricePerMeter[cableType] ||
    activeCatalog.cablePricePerMeter.CAT6_UTP ||
    DEFAULT_PRICING_CATALOG.cablePricePerMeter.CAT6_UTP;
  const customPrice = overrides?.[`cable::${cableType}`] ?? overrides?.[base.sku];
  return {
    sku: base.sku,
    unitPriceVnd: typeof customPrice === 'number' && Number.isFinite(customPrice) ? customPrice : base.unitPriceVnd,
    supplier: base.supplier
  };
}

export function resolveAccessorySkuAndPrice(
  accId: string,
  overrides?: Record<string, number>,
  catalog?: BomPricingCatalogData
): BomSkuPriceEntry {
  const activeCatalog = catalog || loadActivePricingCatalog();
  const base = activeCatalog.accessoryPrices[accId] || {
    sku: `HCH-${accId.replace(/^acc_/, '').toUpperCase().slice(0, 10)}`,
    unitPriceVnd: 50_000,
    supplier: 'HACHIHI Partner'
  };
  const customPrice = overrides?.[`acc::${accId}`] ?? overrides?.[base.sku];
  return {
    sku: base.sku,
    unitPriceVnd: typeof customPrice === 'number' && Number.isFinite(customPrice) ? customPrice : base.unitPriceVnd,
    supplier: base.supplier
  };
}

export function formatVnd(amount: number): string {
  if (!Number.isFinite(amount)) return '0 đ';
  return `${Math.round(amount).toLocaleString('vi-VN')} đ`;
}
