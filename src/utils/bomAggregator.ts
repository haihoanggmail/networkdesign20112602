import {
  CableEdge,
  CableTray,
  DeviceAsset,
  DeviceCategory,
  Floor,
  ProjectState
} from '../types/infrastructure';
import {
  CABLE_TYPE_META,
  calculateTrayAwareCableLengthMeters,
  computeProjectCableSummary,
  getDefaultCableColorForType,
  RectBox
} from './cableRouting';
import { computeProjectPoeSummary, getActiveProjectAssets } from './poeCalculator';
import { normalizeScalePxPerMeter } from './scaleUtils';
import { getAssetUHeight, getRackSlotsForSide, getRackStatistics } from './rackGeometry';
import type { CADDocument } from '../cad/core/CADTypes';
import {
  CadBomExtractionSummary,
  CadBomTargetKind,
  extractBomQuantitiesFromCad
} from './cadBomExtractor';
import {
  BomPricingCatalogData,
  loadActivePricingCatalog,
  loadBomPriceOverrides,
  resolveAccessorySkuAndPrice,
  resolveCableSkuAndPrice,
  resolveDeviceSkuAndPrice
} from './bomPricingCatalog';

export const CATEGORY_LABELS_VI: Record<DeviceCategory | 'rack_cabinet' | 'cabling' | 'other', string> = {
  core_switch: 'Switch Core',
  switch: 'Switch Mạng',
  router: 'Router / Gateway',
  gateway: 'Gateway / Biên',
  firewall: 'Tường lửa Firewall',
  server: 'Máy chủ Server',
  storage: 'Lưu trữ SAN / NAS',
  ups: 'Bộ lưu điện UPS',
  pdu: 'Thanh nguồn PDU',
  odf: 'Hộp phối quang ODF',
  patch_panel: 'Patch Panel',
  rack: 'Tủ Rack 19"',
  rack_cabinet: 'Tủ Rack 19"',
  ap: 'Wi-Fi Access Point',
  camera: 'Camera CCTV',
  nvr: 'Đầu ghi NVR / DVR',
  cloud: 'Cloud / WAN ISP',
  telecom_tower: 'Trạm phát sóng BTS',
  workstation: 'Máy trạm / PC',
  printer: 'Máy in mạng',
  electrical_panel: 'Tủ điện MDB / DB',
  sensor: 'Cảm biến IoT',
  iot: 'Thiết bị IoT',
  cabling: 'Cáp kết nối',
  other: 'Thiết bị khác'
};

export function getCategoryLabelVi(cat?: string): string {
  if (!cat) return 'Thiết bị khác';
  return (CATEGORY_LABELS_VI as Record<string, string>)[cat] || cat;
}

export interface BomDeviceGroupRow {
  key: string;
  sku: string;
  supplier: string;
  category: string;
  categoryLabel: string;
  vendor: string;
  model: string;
  unit: 'Cái' | 'Tủ';
  quantity: number;
  uSizeLabel: string;
  uHeight: number;
  unitWatts: number;
  totalWatts: number;
  unitWeightKg: number;
  totalWeightKg: number;
  unitPriceVnd: number;
  totalPriceVnd: number;
  devicePreviews: string[];
  floorNames: string[];
  assetIds: string[];
  nodeIds: string[];
}

export interface BomCableTypeRow {
  cableType: CableEdge['cableType'];
  sku: string;
  supplier: string;
  label: string;
  shortLabel: string;
  color: string;
  count: number;
  rawMeters: number;
  diagramRawMeters?: number;
  cadRawMeters?: number;
  cadEntityCount?: number;
  verticalRiseMeters: number;
  dropHeightMeters: number;
  serviceLoopMeters: number;
  lossPct: number;
  reserveMeters: number;
  totalWithReserveMeters: number;
  percentage: number;
  spoolLengthMeters?: number;
  estimatedRolls305m?: number;
  estimatedSpools?: number;
  unitPriceVnd: number;
  totalPriceVnd: number;
  trayRoutedCount: number;
  trayEstimatedMeters: number;
  cableCodes: string[];
  cableIds: string[];
}

export interface BomFloorSummaryRow {
  floorId: string;
  floorName: string;
  level: number;
  roomCount: number;
  areaM2: number;
  deviceCount: number;
  rackCount: number;
  cableCount: number;
  totalPowerWatts: number;
  totalWeightKg: number;
  estimatedCostVnd: number;
}

export interface BomRoomSummaryRow {
  roomId: string;
  roomName: string;
  floorId: string;
  floorName: string;
  areaM2: number;
  deviceCount: number;
  rackCount: number;
  totalPowerWatts: number;
  totalWeightKg: number;
  estimatedCostVnd: number;
  devicePreviews: string[];
}

export type BomSystemGroupKey = 'network' | 'wifi' | 'cctv' | 'fiber_patch' | 'rack' | 'power' | 'compute';

export interface BomSystemGroupRow {
  systemKey: BomSystemGroupKey;
  systemLabel: string;
  deviceCount: number;
  cableCount: number;
  cableMeters: number;
  totalPowerWatts: number;
  totalWeightKg: number;
  estimatedCostVnd: number;
  itemSummaries: string[];
}

export interface BomRackSummaryRow {
  rackId: string;
  rackName: string;
  floorName: string;
  totalUnits: number;
  usedUnits: number;
  utilizationPct: number;
  componentCount: number;
  totalPowerWatts: number;
  totalWeightKg: number;
  estimatedCostVnd: number;
}

export interface BomRackComponentRow {
  rackId: string;
  rackName: string;
  floorName: string;
  side: 'front' | 'rear';
  sideLabel: string;
  startU: number;
  uHeight: number;
  assetId: string;
  assetTag: string;
  deviceName: string;
  category: string;
  categoryLabel: string;
  vendor: string;
  model: string;
  powerWatts: number;
  weightKg: number;
}

export interface BomAssumptions {
  serviceLoopMetersPerEnd: number;
  dropHeightMeters: number;
  floorHeightMeters: number;
  copperLossPct: number;
  fiberLossPct: number;
  copperSpoolMeters: number;
  fiberSpoolMeters: number;
  upsHeadroomPct: number;
}

export const DEFAULT_BOM_ASSUMPTIONS: BomAssumptions = {
  serviceLoopMetersPerEnd: 3,
  dropHeightMeters: 0,
  floorHeightMeters: 3.8,
  copperLossPct: 15,
  fiberLossPct: 10,
  copperSpoolMeters: 305,
  fiberSpoolMeters: 1000,
  upsHeadroomPct: 30
};

export interface BomInferredAccessoryRow {
  id: string;
  sku: string;
  supplier: string;
  group: 'Cáp đồng' | 'Cáp quang' | 'Tủ Rack & Patch' | 'Nguồn & PoE' | 'Máng cáp & Ống gen';
  name: string;
  spec: string;
  unit: string;
  calculatedQty: number;
  orderQty: number;
  unitPriceVnd: number;
  totalPriceVnd: number;
  sourceRule: string;
  sourceCount: number;
}

export interface BomPrecisionWarning {
  severity: 'warning' | 'info';
  code: string;
  message: string;
}

export interface BomPrecisionCheck {
  routeTotalMeters: number;
  typeTotalMeters: number;
  floorTotalMeters: number;
  deltaMeters: number;
  isConsistent: boolean;
  warnings: BomPrecisionWarning[];
}

export interface BomQuotationSummary {
  materialSubtotalVnd: number;
  auxMaterialPct: number;
  auxMaterialCostVnd: number;
  laborWorkdays: number;
  laborUnitPriceVnd: number;
  laborTotalVnd: number;
  finalQuotationTotalVnd: number;
}

export interface BomFilterOptions {
  reservePct?: number;
  copperLossPct?: number;
  fiberLossPct?: number;
  serviceLoopMetersPerEnd?: number;
  dropHeightMeters?: number;
  floorHeightMeters?: number;
  copperSpoolMeters?: number;
  fiberSpoolMeters?: number;
  floorId?: string;
  category?: string;
  searchQuery?: string;
  priceOverrides?: Record<string, number>;
  pricingCatalog?: BomPricingCatalogData;
  cadDocument?: CADDocument | null;
  cadExtractEnabled?: boolean;
  cadLayerMappings?: Record<string, CadBomTargetKind>;
  auxMaterialPct?: number;
  laborWorkdays?: number;
  laborUnitPriceVnd?: number;
}

export interface ProjectBomStats {
  reservePct: number;
  assumptions: BomAssumptions;
  kpis: {
    deviceCount: number;
    rackCount: number;
    usedRackU: number;
    totalRackU: number;
    networkDeviceCount: number;
    electricalDeviceCount: number;
    cableCount: number;
    rawCableMeters: number;
    totalCableWithReserveMeters: number;
    trayTotalMeters: number;
    trayRoutedCableCount: number;
    totalPowerWatts: number;
    totalPowerKw: number;
    recommendedUpsVa: number;
    totalWeightKg: number;
    roomCount: number;
    totalAreaM2: number;
    rackComponentCount: number;
    devicesTotalVnd: number;
    cablesTotalVnd: number;
    accessoriesTotalVnd: number;
    estimatedGrandTotalVnd: number;
  };
  quotation: BomQuotationSummary;
  cadExtraction: CadBomExtractionSummary | null;
  deviceRows: BomDeviceGroupRow[];
  cableRows: BomCableTypeRow[];
  floorRows: BomFloorSummaryRow[];
  roomRows: BomRoomSummaryRow[];
  systemRows: BomSystemGroupRow[];
  rackSummaryRows: BomRackSummaryRow[];
  rackComponents: BomRackComponentRow[];
  inferredAccessories: BomInferredAccessoryRow[];
  precision: BomPrecisionCheck;
  availableCategories: Array<{ value: string; label: string }>;
}

export interface BomSpoolCutSegment {
  cableId: string;
  cableCode: string;
  cutMeters: number;
}

export interface BomSpoolCutBin {
  spoolNumber: number;
  spoolLengthMeters: number;
  usedMeters: number;
  scrapMeters: number;
  utilizationPct: number;
  segments: BomSpoolCutSegment[];
}

export interface BomSpoolTypePlan {
  cableType: CableEdge['cableType'];
  label: string;
  spoolLengthMeters: number;
  totalDemandMeters: number;
  naiveSpools: number;
  optimizedSpools: number;
  totalScrapMeters: number;
  overallUtilizationPct: number;
  spools: BomSpoolCutBin[];
}

export interface BomComparisonItemDiff {
  key: string;
  label: string;
  categoryLabel: string;
  unit: string;
  baselineQty: number;
  currentQty: number;
  qtyDelta: number;
  baselineCostVnd: number;
  currentCostVnd: number;
  costDeltaVnd: number;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
}

export interface BomComparisonResult {
  kpis: {
    deviceCountDelta: number;
    rackCountDelta: number;
    cableMetersDelta: number;
    powerWattsDelta: number;
    estimatedCostDeltaVnd: number;
  };
  deviceDiffs: BomComparisonItemDiff[];
  cableDiffs: BomComparisonItemDiff[];
  accessoryDiffs: BomComparisonItemDiff[];
}

const NETWORK_CATEGORIES = new Set<string>([
  'core_switch',
  'switch',
  'router',
  'gateway',
  'firewall',
  'ap',
  'camera',
  'nvr',
  'cloud',
  'server',
  'storage',
  'workstation',
  'patch_panel'
]);

const ELECTRICAL_CATEGORIES = new Set<string>([
  'ups',
  'pdu',
  'electrical_panel',
  'breaker',
  'generator',
  'ats',
  'transformer'
]);

const SYSTEM_GROUP_META: Array<{ key: BomSystemGroupKey; label: string }> = [
  { key: 'network', label: 'Mạng lõi & Chuyển mạch (Core/Dist/FW/Router)' },
  { key: 'wifi', label: 'Mạng không dây (Wi-Fi AP)' },
  { key: 'cctv', label: 'Camera Giám sát & Đầu ghi (CCTV / NVR)' },
  { key: 'fiber_patch', label: 'Đấu nối Quang & Đồng (ODF / Patch Panel)' },
  { key: 'rack', label: 'Tủ Rack 19" & Cơ khí' },
  { key: 'power', label: 'Nguồn điện, UPS & Tủ điện' },
  { key: 'compute', label: 'Máy chủ, Lưu trữ & Thiết bị đầu cuối' }
];

function classifyAssetSystem(category: string): BomSystemGroupKey {
  if (category === 'ap') return 'wifi';
  if (category === 'camera' || category === 'nvr') return 'cctv';
  if (category === 'odf' || category === 'patch_panel') return 'fiber_patch';
  if (category === 'rack') return 'rack';
  if (ELECTRICAL_CATEGORIES.has(category)) return 'power';
  if (category === 'server' || category === 'storage' || category === 'workstation' || category === 'printer') {
    return 'compute';
  }
  return 'network';
}

function classifyCableSystem(cable: CableEdge, nodeMap: Map<string, ProjectState['nodes'][number]>, assets: Record<string, DeviceAsset>): BomSystemGroupKey {
  if (cable.cableType === 'POWER_AC') return 'power';
  if (cable.cableType === 'FIBER_SM_OS2' || cable.cableType === 'FIBER_MM_OM4') return 'fiber_patch';
  const tgt = nodeMap.get(cable.targetNodeId);
  const src = nodeMap.get(cable.sourceNodeId);
  const tgtCat = tgt?.assetId ? assets[tgt.assetId]?.category : undefined;
  const srcCat = src?.assetId ? assets[src.assetId]?.category : undefined;
  if (tgtCat === 'camera' || tgtCat === 'nvr' || srcCat === 'camera' || srcCat === 'nvr') return 'cctv';
  if (tgtCat === 'ap' || srcCat === 'ap') return 'wifi';
  return 'network';
}

function resolveAssetFloorId(asset: DeviceAsset, project: ProjectState): string {
  if (asset.floorId) return asset.floorId;
  if (asset.roomId) {
    const rm = project.rooms.find(r => r.id === asset.roomId);
    if (rm?.floorId) return rm.floorId;
  }
  if (asset.rackId) {
    const rk = project.racks.find(r => r.id === asset.rackId);
    if (rk?.floorId) return rk.floorId;
  }
  const nd = project.nodes.find(n => n.assetId === asset.id);
  if (nd?.floorId) return nd.floorId;
  return project.activeFloorId || project.floors[0]?.id || '';
}

function formatDevicePreview(asset: DeviceAsset): string {
  const parts = [asset.name];
  if (asset.vlan) parts.push(`(VLAN ${asset.vlan})`);
  else if (asset.ipAddress) parts.push(`(${asset.ipAddress})`);
  return parts.join(' ');
}

const FIBER_CABLE_TYPES = new Set<CableEdge['cableType']>(['FIBER_SM_OS2', 'FIBER_MM_OM4']);
const COPPER_BULK_CABLE_TYPES = new Set<CableEdge['cableType']>(['CAT6_UTP', 'CAT6A_STP']);

function clampNumber(val: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

function computeTrayLengthMeters(tray: CableTray, pxPerMeter: number): number {
  if (!tray.points || tray.points.length < 2) return 0;
  let px = 0;
  for (let i = 0; i < tray.points.length - 1; i++) {
    px += Math.hypot(tray.points[i + 1].x - tray.points[i].x, tray.points[i + 1].y - tray.points[i].y);
  }
  const effectiveScale = normalizeScalePxPerMeter(pxPerMeter);
  return Math.round((px / effectiveScale) * 10) / 10;
}

function computeSingleCableOrderMeters(
  cable: CableEdge,
  nodeMap: Map<string, ProjectState['nodes'][number]>,
  floorMap: Map<string, Floor>,
  assumptions: BomAssumptions
): number {
  const raw = Math.max(0, Number(cable.lengthMeters) || 0);
  const isDac = cable.cableType === 'DAC_10G';
  const isFiber = FIBER_CABLE_TYPES.has(cable.cableType);
  const usesSpool = isFiber || COPPER_BULK_CABLE_TYPES.has(cable.cableType);
  const srcNode = nodeMap.get(cable.sourceNodeId);
  const tgtNode = nodeMap.get(cable.targetNodeId);
  const srcFl = srcNode?.floorId ? floorMap.get(srcNode.floorId) : undefined;
  const tgtFl = tgtNode?.floorId ? floorMap.get(tgtNode.floorId) : undefined;
  const verticalRise =
    !isDac && srcFl && tgtFl && srcFl.id !== tgtFl.id
      ? Math.abs(srcFl.level - tgtFl.level) * assumptions.floorHeightMeters
      : 0;
  const drop = isDac ? 0 : 2 * assumptions.dropHeightMeters;
  const serviceLoop = usesSpool ? 2 * assumptions.serviceLoopMetersPerEnd : 0;
  const lossPct = isFiber ? assumptions.fiberLossPct : isDac ? 0 : assumptions.copperLossPct;
  return Math.round((raw + verticalRise + drop + serviceLoop) * (1 + lossPct / 100) * 10) / 10;
}

export function computeProjectBomStats(
  project: ProjectState,
  options?: BomFilterOptions
): ProjectBomStats {
  const hasExplicitReserve = typeof options?.reservePct === 'number' && Number.isFinite(options.reservePct);
  const reservePct = clampNumber(options?.reservePct, 0, 50, DEFAULT_BOM_ASSUMPTIONS.copperLossPct);
  const copperLossPct = clampNumber(
    options?.copperLossPct,
    0,
    50,
    hasExplicitReserve ? reservePct : DEFAULT_BOM_ASSUMPTIONS.copperLossPct
  );
  const fiberLossPct = clampNumber(
    options?.fiberLossPct,
    0,
    50,
    hasExplicitReserve ? reservePct : DEFAULT_BOM_ASSUMPTIONS.fiberLossPct
  );
  const serviceLoopMetersPerEnd = clampNumber(
    options?.serviceLoopMetersPerEnd,
    0,
    15,
    hasExplicitReserve && options?.serviceLoopMetersPerEnd === undefined
      ? 0
      : DEFAULT_BOM_ASSUMPTIONS.serviceLoopMetersPerEnd
  );
  const copperSpoolMeters = clampNumber(options?.copperSpoolMeters, 50, 2000, DEFAULT_BOM_ASSUMPTIONS.copperSpoolMeters);
  const fiberSpoolMeters = clampNumber(options?.fiberSpoolMeters, 100, 5000, DEFAULT_BOM_ASSUMPTIONS.fiberSpoolMeters);
  const defaultBuildingFloorHeight = clampNumber(
    project.buildings?.[0]?.floorHeightMeters,
    2,
    12,
    DEFAULT_BOM_ASSUMPTIONS.floorHeightMeters
  );
  const floorHeightMeters = clampNumber(options?.floorHeightMeters, 2, 12, defaultBuildingFloorHeight);
  const dropHeightMeters = clampNumber(options?.dropHeightMeters, 0, 15, DEFAULT_BOM_ASSUMPTIONS.dropHeightMeters);
  const priceOverrides = options?.priceOverrides ?? loadBomPriceOverrides();
  const pricingCatalog = options?.pricingCatalog ?? loadActivePricingCatalog();
  const auxMaterialPct = clampNumber(options?.auxMaterialPct, 0, 100, 0);
  const laborWorkdays = clampNumber(options?.laborWorkdays, 0, 10000, 0);
  const laborUnitPriceVnd = clampNumber(options?.laborUnitPriceVnd, 0, 100_000_000, 0);

  const cadExtraction: CadBomExtractionSummary | null =
    options?.cadDocument && options?.cadExtractEnabled !== false
      ? extractBomQuantitiesFromCad(options.cadDocument, {
          layerMappings: options.cadLayerMappings
        })
      : null;

  const assumptions: BomAssumptions = {
    serviceLoopMetersPerEnd,
    dropHeightMeters,
    floorHeightMeters,
    copperLossPct,
    fiberLossPct,
    copperSpoolMeters,
    fiberSpoolMeters,
    upsHeadroomPct: DEFAULT_BOM_ASSUMPTIONS.upsHeadroomPct
  };

  const floorFilter = options?.floorId && options.floorId !== 'all' ? options.floorId : undefined;
  const categoryFilter = options?.category && options.category !== 'all' ? options.category : undefined;
  const query = (options?.searchQuery || '').trim().toLowerCase();

  const floorMap = new Map(project.floors.map(f => [f.id, f]));
  const floorNameMap = new Map(project.floors.map(f => [f.id, f.name]));
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const nodeIdsByAssetId = new Map<string, string[]>();
  for (const n of project.nodes) {
    if (!n.assetId) continue;
    const list = nodeIdsByAssetId.get(n.assetId);
    if (list) list.push(n.id);
    else nodeIdsByAssetId.set(n.assetId, [n.id]);
  }
  const { assets: activeAssets } = getActiveProjectAssets(project);
  const allAssets = activeAssets;
  const allRacks = project.racks || [];
  const allCables = project.cables || [];
  const allTrays = project.cableTrays || [];

  const floorFilteredAssets = allAssets.filter(asset => {
    if (!floorFilter) return true;
    return resolveAssetFloorId(asset, project) === floorFilter;
  });

  const floorFilteredRacks = allRacks.filter(rack => {
    if (!floorFilter) return true;
    const rackFloor =
      rack.floorId || project.nodes.find(n => n.customData?.rackId === rack.id || n.id === rack.id)?.floorId;
    return rackFloor === floorFilter;
  });

  const floorFilteredCables = allCables.filter(cable => {
    if (!floorFilter) return true;
    const src = nodeMap.get(cable.sourceNodeId);
    const tgt = nodeMap.get(cable.targetNodeId);
    return src?.floorId === floorFilter || tgt?.floorId === floorFilter;
  });

  const floorFilteredTrays = allTrays.filter(tray => {
    if (!floorFilter) return true;
    return !tray.floorId || tray.floorId === floorFilter;
  });

  // Compute global/filtered KPIs
  let totalRackU = 0;
  let usedRackU = 0;
  for (const rk of floorFilteredRacks) {
    const st = getRackStatistics(rk, project.assets || {});
    totalRackU += st.totalUnits;
    usedRackU += st.frontUsedUnits;
  }

  let totalWatts = 0;
  let totalAssetWeightKg = 0;
  let networkDeviceCount = 0;
  let electricalDeviceCount = 0;
  for (const a of floorFilteredAssets) {
    totalWatts += Number(a.powerWatts) || 0;
    totalAssetWeightKg += Number(a.weightKg) || 0;
    if (NETWORK_CATEGORIES.has(a.category)) networkDeviceCount += 1;
    if (ELECTRICAL_CATEGORIES.has(a.category)) electricalDeviceCount += 1;
  }

  const nonRackAssets = floorFilteredAssets.filter(a => a.category !== 'rack');
  const rackAssets = floorFilteredAssets.filter(a => a.category === 'rack');
  const totalRackCabinets = Math.max(floorFilteredRacks.length, rackAssets.length);

  const cableBaseSummary = computeProjectCableSummary(floorFilteredCables);

  const filteredRooms = project.rooms.filter(r => !floorFilter || r.floorId === floorFilter);
  const filteredFloors = project.floors.filter(f => !floorFilter || f.id === floorFilter);
  const pxPerMeter = normalizeScalePxPerMeter(project.settings?.scale);
  const roomAreaSum = filteredRooms.reduce((sum, r) => {
    return sum + Math.round((r.width / pxPerMeter) * (r.height / pxPerMeter) * 10) / 10;
  }, 0);
  const totalAreaM2 =
    roomAreaSum > 0
      ? Math.round(roomAreaSum * 10) / 10
      : Math.round(
          filteredFloors.reduce((sum, f) => sum + ((f.widthMeters || 0) * (f.depthMeters || 0)), 0) * 10
        ) / 10;

  const recommendedUpsVa =
    totalWatts > 0 ? Math.ceil((totalWatts * (1 + assumptions.upsHeadroomPct / 100)) / 0.8) : 0;

  // Group device rows (by category, vendor, model) + SKU & VNĐ pricing
  const categorySet = new Map<string, string>();
  const deviceGroupMap = new Map<string, BomDeviceGroupRow>();
  const assetCostMap = new Map<string, number>();

  for (const asset of floorFilteredAssets) {
    const cat = asset.category || 'other';
    const catLabel = getCategoryLabelVi(cat);
    categorySet.set(cat, catLabel);

    const vendor = (asset.vendor || 'Chưa rõ').trim();
    const model = (asset.model || asset.name || 'Generic').trim();
    const key = `${cat}::${vendor}::${model}`;
    const uH = asset.rackId || cat === 'rack' ? getAssetUHeight(asset) : 0;
    const watts = Number(asset.powerWatts) || 0;
    const weight = Number(asset.weightKg) || 0;
    const flName = floorNameMap.get(resolveAssetFloorId(asset, project)) || 'Chưa gán tầng';
    const priceInfo = resolveDeviceSkuAndPrice(key, cat, vendor, model, priceOverrides, pricingCatalog);
    assetCostMap.set(asset.id, priceInfo.unitPriceVnd);

    const existing = deviceGroupMap.get(key);
    const linkedNodes = nodeIdsByAssetId.get(asset.id) || [];
    if (existing) {
      existing.quantity += 1;
      existing.totalWatts += watts;
      existing.totalWeightKg = Math.round((existing.totalWeightKg + weight) * 10) / 10;
      existing.totalPriceVnd += existing.unitPriceVnd;
      existing.devicePreviews.push(formatDevicePreview(asset));
      if (!existing.floorNames.includes(flName)) existing.floorNames.push(flName);
      existing.assetIds.push(asset.id);
      linkedNodes.forEach(nid => {
        if (!existing.nodeIds.includes(nid)) existing.nodeIds.push(nid);
      });
    } else {
      deviceGroupMap.set(key, {
        key,
        sku: priceInfo.sku,
        supplier: priceInfo.supplier,
        category: cat,
        categoryLabel: catLabel,
        vendor,
        model,
        unit: cat === 'rack' ? 'Tủ' : 'Cái',
        quantity: 1,
        uSizeLabel: uH > 0 ? `${uH}U` : '—',
        uHeight: uH,
        unitWatts: watts,
        totalWatts: watts,
        unitWeightKg: weight,
        totalWeightKg: Math.round(weight * 10) / 10,
        unitPriceVnd: priceInfo.unitPriceVnd,
        totalPriceVnd: priceInfo.unitPriceVnd,
        devicePreviews: [formatDevicePreview(asset)],
        floorNames: [flName],
        assetIds: [asset.id],
        nodeIds: [...linkedNodes]
      });
    }
  }

  for (const rk of floorFilteredRacks) {
    const matchedRackAsset = rackAssets.some(
      a => a.id === rk.id || a.rackId === rk.id || a.name === rk.name
    );
    if (matchedRackAsset) continue;
    categorySet.set('rack', getCategoryLabelVi('rack'));
    const model = `SR-${rk.totalUnits}U-${rk.widthMm}x${rk.depthMm}`;
    const key = `rack::HACHIHI::${model}`;
    const flName = floorNameMap.get(rk.floorId || '') || 'Chưa gán tầng';
    const priceInfo = resolveDeviceSkuAndPrice(key, 'rack', 'HACHIHI', model, priceOverrides, pricingCatalog);
    const rackNodeIds = project.nodes
      .filter(n => n.customData?.rackId === rk.id || n.id === rk.id)
      .map(n => n.id);
    const existing = deviceGroupMap.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.totalWeightKg = Math.round((existing.totalWeightKg + 110) * 10) / 10;
      existing.totalPriceVnd += existing.unitPriceVnd;
      existing.devicePreviews.push(rk.name);
      if (!existing.floorNames.includes(flName)) existing.floorNames.push(flName);
      rackNodeIds.forEach(nid => {
        if (!existing.nodeIds.includes(nid)) existing.nodeIds.push(nid);
      });
    } else {
      deviceGroupMap.set(key, {
        key,
        sku: priceInfo.sku,
        supplier: priceInfo.supplier,
        category: 'rack',
        categoryLabel: getCategoryLabelVi('rack'),
        vendor: 'HACHIHI',
        model,
        unit: 'Tủ',
        quantity: 1,
        uSizeLabel: `${rk.totalUnits}U`,
        uHeight: rk.totalUnits,
        unitWatts: 0,
        totalWatts: 0,
        unitWeightKg: 110,
        totalWeightKg: 110,
        unitPriceVnd: priceInfo.unitPriceVnd,
        totalPriceVnd: priceInfo.unitPriceVnd,
        devicePreviews: [rk.name],
        floorNames: [flName],
        assetIds: [],
        nodeIds: rackNodeIds
      });
    }
  }

  const allDeviceRows = Array.from(deviceGroupMap.values()).sort(
    (a, b) => a.categoryLabel.localeCompare(b.categoryLabel, 'vi') || b.quantity - a.quantity || a.model.localeCompare(b.model)
  );

  const filteredDeviceRows = allDeviceRows.filter(row => {
    if (categoryFilter && row.category !== categoryFilter) return false;
    if (query) {
      const hay = `${row.sku} ${row.categoryLabel} ${row.vendor} ${row.model} ${row.devicePreviews.join(' ')}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  // Tray-aware length diagnostics per cable (B2)
  let totalTrayRoutedCableCount = 0;
  const trayInfoByCableId = new Map<string, { meters: number; routedViaTrayName?: string }>();
  if (allTrays.length > 0) {
    for (const c of floorFilteredCables) {
      const src = nodeMap.get(c.sourceNodeId);
      const tgt = nodeMap.get(c.targetNodeId);
      if (!src || !tgt) continue;
      const traysOnFloor = allTrays.filter(t => !t.floorId || t.floorId === src.floorId || t.floorId === tgt.floorId);
      if (traysOnFloor.length === 0) continue;
      const r1: RectBox = { x: src.x, y: src.y, width: src.width, height: src.height };
      const r2: RectBox = { x: tgt.x, y: tgt.y, width: tgt.width, height: tgt.height };
      const info = calculateTrayAwareCableLengthMeters(c, r1, r2, traysOnFloor, pxPerMeter);
      trayInfoByCableId.set(c.id, info);
      if (info.routedViaTrayName) totalTrayRoutedCableCount += 1;
    }
  }

  // Cable rows by type (diagram routes + optional auto-extracted CAD curve lengths)
  const cableBaseByType = new Map(cableBaseSummary.byType.map(r => [r.cableType, r]));
  const combinedCableTypeOrder: CableEdge['cableType'][] = [];
  for (const row of cableBaseSummary.byType) {
    combinedCableTypeOrder.push(row.cableType);
  }
  if (cadExtraction) {
    for (const item of cadExtraction.cableBreakdown) {
      if (item.meters > 0 && !cableBaseByType.has(item.cableType)) {
        combinedCableTypeOrder.push(item.cableType);
      }
    }
  }

  const totalCombinedRawCableMeters =
    Math.round(
      combinedCableTypeOrder.reduce((sum, cType) => {
        const dMeters = cableBaseByType.get(cType)?.totalMeters || 0;
        const cMeters = cadExtraction?.cableMetersByType[cType] || 0;
        return sum + dMeters + cMeters;
      }, 0) * 10
    ) / 10;

  const allCableRows: BomCableTypeRow[] = combinedCableTypeOrder.map(cableType => {
    const baseRow = cableBaseByType.get(cableType);
    const meta = CABLE_TYPE_META[cableType];
    const diagramRawMeters = baseRow?.totalMeters || 0;
    const cadRawMeters = cadExtraction?.cableMetersByType[cableType] || 0;
    const cadEntityCount = cadExtraction?.cableCountsByType[cableType] || 0;
    const raw = Math.round((diagramRawMeters + cadRawMeters) * 10) / 10;

    const isFiber = FIBER_CABLE_TYPES.has(cableType);
    const isCopperBulk = COPPER_BULK_CABLE_TYPES.has(cableType);
    const isDac = cableType === 'DAC_10G';
    const usesSpool = isFiber || isCopperBulk;
    const matchingCables = floorFilteredCables.filter(c => c.cableType === cableType);
    const diagramCount = matchingCables.length;

    let verticalRiseRaw = 0;
    let trayRoutedCount = 0;
    let trayEstimatedMetersRaw = cadRawMeters;
    for (const c of matchingCables) {
      const srcNode = nodeMap.get(c.sourceNodeId);
      const tgtNode = nodeMap.get(c.targetNodeId);
      if (!isDac) {
        const srcFl = srcNode?.floorId ? floorMap.get(srcNode.floorId) : undefined;
        const tgtFl = tgtNode?.floorId ? floorMap.get(tgtNode.floorId) : undefined;
        if (srcFl && tgtFl && srcFl.id !== tgtFl.id) {
          verticalRiseRaw += Math.abs(srcFl.level - tgtFl.level) * floorHeightMeters;
        }
      }
      const trayDiag = trayInfoByCableId.get(c.id);
      if (trayDiag?.routedViaTrayName) {
        trayRoutedCount += 1;
        trayEstimatedMetersRaw += trayDiag.meters;
      } else {
        trayEstimatedMetersRaw += Number(c.lengthMeters) || 0;
      }
    }

    const verticalRiseTotal = Math.round(verticalRiseRaw * 10) / 10;
    const dropTotal = isDac ? 0 : Math.round(diagramCount * 2 * dropHeightMeters * 10) / 10;
    const serviceLoopMeters = usesSpool ? Math.round(diagramCount * 2 * serviceLoopMetersPerEnd * 10) / 10 : 0;
    const lossPct = isFiber ? fiberLossPct : isDac ? 0 : copperLossPct;
    const totalWithReserve =
      Math.round((raw + verticalRiseTotal + dropTotal + serviceLoopMeters) * (1 + lossPct / 100) * 10) / 10;
    const reserveMeters = Math.round((totalWithReserve - raw) * 10) / 10;
    const spoolLen = isFiber ? fiberSpoolMeters : meta?.supports305mBox ? copperSpoolMeters : undefined;
    const estimatedSpools = spoolLen && totalWithReserve > 0 ? Math.ceil(totalWithReserve / spoolLen) : undefined;
    const priceInfo = resolveCableSkuAndPrice(cableType, priceOverrides, pricingCatalog);
    const qtyForCost = isDac ? Math.max(diagramCount, cadEntityCount) : totalWithReserve;
    const totalPriceVnd = Math.round(qtyForCost * priceInfo.unitPriceVnd);
    const percentage =
      totalCombinedRawCableMeters > 0 ? Math.round((raw / totalCombinedRawCableMeters) * 1000) / 10 : 0;

    const cableCodes = matchingCables.map(c => `${c.cableCode || c.id} (${c.lengthMeters || 0}m)`);
    if (cadRawMeters > 0) {
      cableCodes.push(`CAD (${cadEntityCount} nét · ${cadRawMeters}m)`);
    }

    return {
      cableType,
      sku: priceInfo.sku,
      supplier: priceInfo.supplier,
      label: baseRow?.label || meta?.label || cableType,
      shortLabel: baseRow?.shortLabel || meta?.shortLabel || cableType,
      color: baseRow?.color || getDefaultCableColorForType(cableType),
      count: diagramCount,
      rawMeters: raw,
      diagramRawMeters,
      cadRawMeters,
      cadEntityCount,
      verticalRiseMeters: verticalRiseTotal,
      dropHeightMeters: dropTotal,
      serviceLoopMeters,
      lossPct,
      reserveMeters,
      totalWithReserveMeters: totalWithReserve,
      percentage,
      spoolLengthMeters: spoolLen,
      estimatedRolls305m: meta?.supports305mBox ? estimatedSpools : undefined,
      estimatedSpools,
      unitPriceVnd: priceInfo.unitPriceVnd,
      totalPriceVnd,
      trayRoutedCount,
      trayEstimatedMeters: Math.round(trayEstimatedMetersRaw * 10) / 10,
      cableCodes,
      cableIds: matchingCables.map(c => c.id)
    };
  });

  const totalCableWithReserveMeters =
    Math.round(allCableRows.reduce((s, r) => s + r.totalWithReserveMeters, 0) * 10) / 10;

  const cableRows = allCableRows.filter(row => {
    if (categoryFilter && categoryFilter !== 'cabling') return false;
    if (query) {
      const hay = `${row.sku} ${row.label} ${row.shortLabel} ${row.cableType} ${row.cableCodes.join(' ')}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (allCableRows.length > 0) {
    categorySet.set('cabling', getCategoryLabelVi('cabling'));
  }

  // Floor rows
  const floorRows: BomFloorSummaryRow[] = project.floors
    .slice()
    .sort((a, b) => a.level - b.level)
    .filter(fl => !floorFilter || fl.id === floorFilter)
    .map(fl => {
      const roomsOnFloor = project.rooms.filter(r => r.floorId === fl.id);
      const assetsOnFloor = allAssets.filter(a => resolveAssetFloorId(a, project) === fl.id);
      const racksOnFloor = allRacks.filter(r => r.floorId === fl.id);
      const cablesOnFloor = allCables.filter(c => {
        const s = nodeMap.get(c.sourceNodeId);
        const t = nodeMap.get(c.targetNodeId);
        return s?.floorId === fl.id || t?.floorId === fl.id;
      });
      const roomsArea = roomsOnFloor.reduce(
        (s, r) => s + Math.round((r.width / pxPerMeter) * (r.height / pxPerMeter) * 10) / 10,
        0
      );
      const areaM2 =
        fl.widthMeters && fl.depthMeters
          ? Math.round(fl.widthMeters * fl.depthMeters * 10) / 10
          : Math.round(roomsArea * 10) / 10;
      const estimatedCostVnd = assetsOnFloor.reduce((s, a) => s + (assetCostMap.get(a.id) || 0), 0);
      return {
        floorId: fl.id,
        floorName: fl.name,
        level: fl.level,
        roomCount: roomsOnFloor.length,
        areaM2,
        deviceCount: assetsOnFloor.length,
        rackCount: racksOnFloor.length,
        cableCount: cablesOnFloor.length,
        totalPowerWatts: assetsOnFloor.reduce((s, a) => s + (a.powerWatts || 0), 0),
        totalWeightKg: Math.round(assetsOnFloor.reduce((s, a) => s + (a.weightKg || 0), 0) * 10) / 10,
        estimatedCostVnd
      };
    })
    .filter(row => {
      if (!query) return true;
      return row.floorName.toLowerCase().includes(query);
    });

  // Room rows (B7)
  const roomRows: BomRoomSummaryRow[] = filteredRooms.map(rm => {
    const flName = floorNameMap.get(rm.floorId) || '—';
    const assetsInRoom = floorFilteredAssets.filter(a => {
      if (a.roomId === rm.id) return true;
      const nd = project.nodes.find(n => n.assetId === a.id && n.floorId === rm.floorId);
      if (!nd) return false;
      const cx = nd.x + nd.width / 2;
      const cy = nd.y + nd.height / 2;
      return cx >= rm.x && cx <= rm.x + rm.width && cy >= rm.y && cy <= rm.y + rm.height;
    });
    const racksInRoom = floorFilteredRacks.filter(rk => rk.roomId === rm.id);
    const areaM2 = Math.round((rm.width / pxPerMeter) * (rm.height / pxPerMeter) * 10) / 10;
    return {
      roomId: rm.id,
      roomName: rm.name,
      floorId: rm.floorId,
      floorName: flName,
      areaM2,
      deviceCount: assetsInRoom.length,
      rackCount: racksInRoom.length,
      totalPowerWatts: assetsInRoom.reduce((s, a) => s + (Number(a.powerWatts) || 0), 0),
      totalWeightKg: Math.round(assetsInRoom.reduce((s, a) => s + (Number(a.weightKg) || 0), 0) * 10) / 10,
      estimatedCostVnd: assetsInRoom.reduce((s, a) => s + (assetCostMap.get(a.id) || 0), 0),
      devicePreviews: assetsInRoom.slice(0, 6).map(a => a.name)
    };
  });

  // System rows (B7)
  const systemBuckets = new Map<BomSystemGroupKey, BomSystemGroupRow>(
    SYSTEM_GROUP_META.map(m => [
      m.key,
      {
        systemKey: m.key,
        systemLabel: m.label,
        deviceCount: 0,
        cableCount: 0,
        cableMeters: 0,
        totalPowerWatts: 0,
        totalWeightKg: 0,
        estimatedCostVnd: 0,
        itemSummaries: []
      }
    ])
  );

  for (const row of allDeviceRows) {
    const sysKey = classifyAssetSystem(row.category);
    const bucket = systemBuckets.get(sysKey)!;
    bucket.deviceCount += row.quantity;
    bucket.totalPowerWatts += row.totalWatts;
    bucket.totalWeightKg = Math.round((bucket.totalWeightKg + row.totalWeightKg) * 10) / 10;
    bucket.estimatedCostVnd += row.totalPriceVnd;
    bucket.itemSummaries.push(`${row.quantity}× ${row.vendor} ${row.model}`);
  }
  for (const cable of floorFilteredCables) {
    const sysKey = classifyCableSystem(cable, nodeMap, project.assets || {});
    const bucket = systemBuckets.get(sysKey)!;
    const len = computeSingleCableOrderMeters(cable, nodeMap, floorMap, assumptions);
    const cablePrice = resolveCableSkuAndPrice(cable.cableType, priceOverrides, pricingCatalog);
    bucket.cableCount += 1;
    bucket.cableMeters = Math.round((bucket.cableMeters + len) * 10) / 10;
    bucket.estimatedCostVnd += Math.round((cable.cableType === 'DAC_10G' ? 1 : len) * cablePrice.unitPriceVnd);
  }
  const systemRows = Array.from(systemBuckets.values()).filter(
    s => s.deviceCount > 0 || s.cableCount > 0
  );

  // Rack components & Rack summary rows (B7)
  const rackComponents: BomRackComponentRow[] = [];
  const rackSummaryRows: BomRackSummaryRow[] = [];
  for (const rk of floorFilteredRacks) {
    const flName = floorNameMap.get(rk.floorId || '') || 'Chưa gán tầng';
    const st = getRackStatistics(rk, project.assets || {});
    const rackComps: BomRackComponentRow[] = [];
    const sides: Array<{ side: 'front' | 'rear'; label: string }> = [
      { side: 'front', label: 'Mặt trước (Front)' },
      { side: 'rear', label: 'Mặt sau (Rear)' }
    ];
    for (const s of sides) {
      const slots = getRackSlotsForSide(rk, s.side);
      const items: BomRackComponentRow[] = [];
      for (const [uStr, assetId] of Object.entries(slots)) {
        const startU = parseInt(uStr, 10);
        const asset = project.assets?.[assetId];
        if (Number.isNaN(startU) || !asset) continue;
        items.push({
          rackId: rk.id,
          rackName: rk.name,
          floorName: flName,
          side: s.side,
          sideLabel: s.label,
          startU,
          uHeight: getAssetUHeight(asset),
          assetId: asset.id,
          assetTag: asset.assetTag || '',
          deviceName: asset.name,
          category: asset.category,
          categoryLabel: getCategoryLabelVi(asset.category),
          vendor: asset.vendor || '',
          model: asset.model || '',
          powerWatts: Number(asset.powerWatts) || 0,
          weightKg: Number(asset.weightKg) || 0
        });
      }
      items.sort((a, b) => b.startU - a.startU);
      rackComps.push(...items);
      rackComponents.push(...items);
    }

    const rackCabPrice = resolveDeviceSkuAndPrice(
      `rack::HACHIHI::SR-${rk.totalUnits}U-${rk.widthMm}x${rk.depthMm}`,
      'rack',
      'HACHIHI',
      `SR-${rk.totalUnits}U`,
      priceOverrides,
      pricingCatalog
    ).unitPriceVnd;
    const compCost = rackComps.reduce((sum, rc) => sum + (assetCostMap.get(rc.assetId) || 0), 0);
    rackSummaryRows.push({
      rackId: rk.id,
      rackName: rk.name,
      floorName: flName,
      totalUnits: st.totalUnits,
      usedUnits: st.frontUsedUnits,
      utilizationPct: st.totalUnits > 0 ? Math.round((st.frontUsedUnits / st.totalUnits) * 100) : 0,
      componentCount: rackComps.length,
      totalPowerWatts: st.totalPowerWatts,
      totalWeightKg: st.totalWeightKg,
      estimatedCostVnd: rackCabPrice + compCost
    });
  }

  // Inferred installation accessories with clear rule provenance + B2 Cable Trays
  const inferredAccessories: BomInferredAccessoryRow[] = [];
  const pushAccessory = (base: Omit<BomInferredAccessoryRow, 'sku' | 'supplier' | 'unitPriceVnd' | 'totalPriceVnd'>) => {
    const pricing = resolveAccessorySkuAndPrice(base.id, priceOverrides, pricingCatalog);
    inferredAccessories.push({
      ...base,
      sku: pricing.sku,
      supplier: pricing.supplier,
      unitPriceVnd: pricing.unitPriceVnd,
      totalPriceVnd: Math.round(base.orderQty * pricing.unitPriceVnd)
    });
  };

  const copperCables = floorFilteredCables.filter(c => COPPER_BULK_CABLE_TYPES.has(c.cableType));
  const fiberCables = floorFilteredCables.filter(c => FIBER_CABLE_TYPES.has(c.cableType));
  const patchPanelCount = floorFilteredAssets.filter(a => a.category === 'patch_panel').length;
  const odfCount = floorFilteredAssets.filter(a => a.category === 'odf').length;

  if (copperCables.length > 0) {
    const qtyEnds = copperCables.length * 2;
    pushAccessory({
      id: 'acc_keystone_copper',
      group: 'Cáp đồng',
      name: 'Hạt mạng RJ45 / Nhân Keystone Cat6/Cat6A',
      spec: '2 đầu bấm / keystone cho mỗi tuyến cáp đồng',
      unit: 'Cái',
      calculatedQty: qtyEnds,
      orderQty: Math.ceil(qtyEnds * 1.05),
      sourceRule: `2 × ${copperCables.length} tuyến cáp đồng (+5% dự phòng bấm hỏng)`,
      sourceCount: copperCables.length
    });
    pushAccessory({
      id: 'acc_patch_cord_copper',
      group: 'Cáp đồng',
      name: 'Dây nhảy mạng Patch Cord Cat6 (1.5m–2m)',
      spec: 'Đấu nối từ Patch Panel vào Switch & từ ổ cắm tới thiết bị',
      unit: 'Sợi',
      calculatedQty: qtyEnds,
      orderQty: qtyEnds,
      sourceRule: `2 sợi × ${copperCables.length} tuyến cáp đồng`,
      sourceCount: copperCables.length
    });
  }

  if (fiberCables.length > 0) {
    const fiberEnds = fiberCables.length * 2;
    pushAccessory({
      id: 'acc_fiber_pigtail_lc',
      group: 'Cáp quang',
      name: 'Dây hàn quang Pigtail & Ống co nhiệt (LC Duplex)',
      spec: '2 đầu hàn quang cho mỗi tuyến cáp quang trục',
      unit: 'Bộ',
      calculatedQty: fiberEnds,
      orderQty: fiberEnds + 2,
      sourceRule: `2 × ${fiberCables.length} tuyến cáp quang (+2 dự phòng hàn)`,
      sourceCount: fiberCables.length
    });
    pushAccessory({
      id: 'acc_fiber_patch_cord',
      group: 'Cáp quang',
      name: 'Dây nhảy quang Patch Cord LC-LC Duplex (3m)',
      spec: 'Đấu nối giữa hộp ODF và module SFP quang',
      unit: 'Sợi',
      calculatedQty: fiberEnds,
      orderQty: fiberEnds,
      sourceRule: `2 sợi × ${fiberCables.length} tuyến cáp quang`,
      sourceCount: fiberCables.length
    });
  }

  // B2: Tray & conduit infrastructure inferred accessories (network diagram trays + extracted CAD curve layers)
  let diagramTrayMeters = 0;
  let diagramConduitMeters = 0;
  let trayFittingCount = 0;
  for (const t of floorFilteredTrays) {
    const m = computeTrayLengthMeters(t, pxPerMeter);
    if (t.kind === 'conduit') {
      diagramConduitMeters += m;
    } else {
      diagramTrayMeters += m;
      trayFittingCount += Math.max(0, t.points.length - 2);
    }
  }
  const cadTrayMeters = cadExtraction?.trayMeters || 0;
  const cadConduitMeters = cadExtraction?.conduitMeters || 0;
  const trayMeters = diagramTrayMeters + cadTrayMeters;
  const conduitMeters = diagramConduitMeters + cadConduitMeters;
  const trayTotalMeters = Math.round((trayMeters + conduitMeters) * 10) / 10;

  if (trayMeters > 0) {
    const orderTrayM = Math.ceil(trayMeters * 1.05);
    const diagramTrayCount = floorFilteredTrays.filter(t => t.kind !== 'conduit').length;
    const ruleParts: string[] = [];
    if (diagramTrayCount > 0) ruleParts.push(`${diagramTrayCount} tuyến máng sơ đồ (${Math.round(diagramTrayMeters * 10) / 10}m)`);
    if (cadTrayMeters > 0) ruleParts.push(`${cadExtraction?.trayEntityCount || 0} nét CAD (${cadTrayMeters}m)`);
    pushAccessory({
      id: 'acc_tray_straight',
      group: 'Máng cáp & Ống gen',
      name: 'Máng cáp sơn tĩnh điện 100×50mm (kèm nắp & ty ren)',
      spec: 'Tính từ tổng chiều dài các tuyến máng mạng/điện vẽ trên mặt bằng & CAD',
      unit: 'Mét',
      calculatedQty: Math.round(trayMeters * 10) / 10,
      orderQty: orderTrayM,
      sourceRule: `${ruleParts.join(' + ')} (+5% nối ghép)`,
      sourceCount: diagramTrayCount + (cadExtraction?.trayEntityCount || 0)
    });
    if (trayFittingCount > 0) {
      pushAccessory({
        id: 'acc_tray_fittings',
        group: 'Máng cáp & Ống gen',
        name: 'Co L 90° / Tê ngã ba chuyển hướng máng cáp 100×50mm',
        spec: 'Suy ra từ các điểm gấp khúc (vertex) trên tuyến máng cáp',
        unit: 'Cái',
        calculatedQty: trayFittingCount,
        orderQty: trayFittingCount,
        sourceRule: `${trayFittingCount} điểm rẽ góc trên đường máng cáp`,
        sourceCount: trayFittingCount
      });
    }
  }

  if (conduitMeters > 0) {
    const orderConduitM = Math.ceil(conduitMeters * 1.1);
    const diagramConduitCount = floorFilteredTrays.filter(t => t.kind === 'conduit').length;
    const ruleParts: string[] = [];
    if (diagramConduitCount > 0) ruleParts.push(`${diagramConduitCount} tuyến gen sơ đồ (${Math.round(diagramConduitMeters * 10) / 10}m)`);
    if (cadConduitMeters > 0) ruleParts.push(`${cadExtraction?.conduitEntityCount || 0} nét CAD (${cadConduitMeters}m)`);
    pushAccessory({
      id: 'acc_conduit_pvc',
      group: 'Máng cáp & Ống gen',
      name: 'Ống luồn dây chống cháy PVC D25',
      spec: 'Tính từ tuyến ống gen PVC trên mặt bằng & bản vẽ CAD',
      unit: 'Mét',
      calculatedQty: Math.round(conduitMeters * 10) / 10,
      orderQty: orderConduitM,
      sourceRule: `${ruleParts.join(' + ')} (+10% cắt nối)`,
      sourceCount: diagramConduitCount + (cadExtraction?.conduitEntityCount || 0)
    });
  }

  if (totalRackCabinets > 0 || rackComponents.length > 0) {
    const cageNutQty = totalRackCabinets * 20 + rackComponents.length * 4;
    pushAccessory({
      id: 'acc_cage_nuts',
      group: 'Tủ Rack & Patch',
      name: 'Bộ ốc lồng M6 & long đền nhựa lắp tủ Rack',
      spec: '20 bộ cơ bản/tủ + 4 bộ/thiết bị gắn khe U',
      unit: 'Bộ',
      calculatedQty: cageNutQty,
      orderQty: Math.ceil(cageNutQty / 20) * 20,
      sourceRule: `${totalRackCabinets} tủ Rack, ${rackComponents.length} thiết bị gắn U (làm tròn gói 20)`,
      sourceCount: totalRackCabinets + rackComponents.length
    });

    const cableMgrQty = Math.max(totalRackCabinets, Math.ceil((copperCables.length + fiberCables.length) / 24));
    if (cableMgrQty > 0) {
      pushAccessory({
        id: 'acc_cable_manager_1u',
        group: 'Tủ Rack & Patch',
        name: 'Thanh quản lý cáp ngang 1U có nắp đậy',
        spec: '1 thanh / mỗi 24 tuyến đấu nối hoặc tối thiểu 1 thanh/tủ',
        unit: 'Thanh',
        calculatedQty: cableMgrQty,
        orderQty: cableMgrQty,
        sourceRule: `${totalRackCabinets} tủ Rack · ${patchPanelCount} Patch Panel · ${odfCount} ODF`,
        sourceCount: totalRackCabinets
      });
    }
  }

  const totalPhysicalRoutes = copperCables.length + fiberCables.length;
  if (totalPhysicalRoutes > 0) {
    pushAccessory({
      id: 'acc_tia606_labels',
      group: 'Tủ Rack & Patch',
      name: 'Bộ nhãn đánh số cáp & cổng chuẩn TIA-606-C',
      spec: 'Gắn 2 đầu mỗi tuyến cáp và mặt trước thiết bị đấu nối',
      unit: 'Bộ nhãn',
      calculatedQty: totalPhysicalRoutes * 2,
      orderQty: totalPhysicalRoutes * 2,
      sourceRule: `2 nhãn × ${totalPhysicalRoutes} tuyến cáp cấu trúc`,
      sourceCount: totalPhysicalRoutes
    });
  }

  const poeSummary = computeProjectPoeSummary(project);
  if (poeSummary.totalPoeWatts > 0 && (poeSummary.status === 'no_pse' || poeSummary.status === 'overload')) {
    const deficitWatts = Math.max(0, poeSummary.totalPoeWatts - poeSummary.totalPoeBudgetWatts);
    const injectorQty = Math.max(1, Math.ceil(deficitWatts / 30));
    pushAccessory({
      id: 'acc_poe_injector_deficit',
      group: 'Nguồn & PoE',
      name: 'Bộ cấp nguồn PoE+ Injector 802.3at (30W) / Switch PoE bổ sung',
      spec: `Bù phần thiếu hụt ngân sách PoE (${deficitWatts} W)`,
      unit: 'Cái',
      calculatedQty: injectorQty,
      orderQty: injectorQty,
      sourceRule: `Tải PoE ${poeSummary.totalPoeWatts}W vượt ngân sách PSE ${poeSummary.totalPoeBudgetWatts}W`,
      sourceCount: poeSummary.poweredDeviceCount
    });
  }

  // Cost totals (B3) + Extended Construction Quotation
  const devicesTotalVnd = allDeviceRows.reduce((s, r) => s + r.totalPriceVnd, 0);
  const cablesTotalVnd = allCableRows.reduce((s, r) => s + r.totalPriceVnd, 0);
  const accessoriesTotalVnd = inferredAccessories.reduce((s, r) => s + r.totalPriceVnd, 0);
  const estimatedGrandTotalVnd = devicesTotalVnd + cablesTotalVnd + accessoriesTotalVnd;

  const auxMaterialCostVnd = Math.round(estimatedGrandTotalVnd * (auxMaterialPct / 100));
  const laborTotalVnd = Math.round(laborWorkdays * laborUnitPriceVnd);
  const finalQuotationTotalVnd = estimatedGrandTotalVnd + auxMaterialCostVnd + laborTotalVnd;
  const quotation: BomQuotationSummary = {
    materialSubtotalVnd: estimatedGrandTotalVnd,
    auxMaterialPct,
    auxMaterialCostVnd,
    laborWorkdays,
    laborUnitPriceVnd,
    laborTotalVnd,
    finalQuotationTotalVnd
  };

  // Precision cross-check & accuracy warnings
  const cadCableTotalRawMeters = cadExtraction
    ? cadExtraction.cableBreakdown.reduce((s, b) => s + b.meters, 0)
    : 0;
  const routeTotalMeters = Math.round((cableBaseSummary.totalMeters + cadCableTotalRawMeters) * 10) / 10;
  const typeTotalMeters = Math.round(allCableRows.reduce((s, r) => s + r.rawMeters, 0) * 10) / 10;
  const floorTotalMetersRaw = floorFilteredCables.reduce((sum, c) => {
    const s = nodeMap.get(c.sourceNodeId);
    const t = nodeMap.get(c.targetNodeId);
    const resolvedFloor = s?.floorId || t?.floorId || project.activeFloorId;
    if (floorFilter && resolvedFloor !== floorFilter) return sum;
    return sum + (Number.isFinite(Number(c.lengthMeters)) ? Math.max(0, Number(c.lengthMeters)) : 0);
  }, 0);
  const floorTotalMeters = Math.round((floorTotalMetersRaw + cadCableTotalRawMeters) * 10) / 10;
  const deltaMeters = Math.round(Math.max(Math.abs(routeTotalMeters - typeTotalMeters), Math.abs(routeTotalMeters - floorTotalMeters)) * 10) / 10;

  const warnings: BomPrecisionCheck['warnings'] = [];
  const over100mCopper = copperCables.filter(c => (c.lengthMeters || 0) > 100);
  if (over100mCopper.length > 0) {
    warnings.push({
      severity: 'warning',
      code: 'TIA_COPPER_100M',
      message: `${over100mCopper.length} tuyến cáp đồng dài > 100m (vượt chuẩn TIA-568: ${over100mCopper
        .slice(0, 3)
        .map(c => c.cableCode || c.id)
        .join(', ')}). Cân nhắc chuyển sang cáp quang hoặc thêm Switch trung gian.`
    });
  }

  const over55mCat6HighSpeed = copperCables.filter(
    c =>
      c.cableType === 'CAT6_UTP' &&
      (c.lengthMeters || 0) > 55 &&
      (c.lengthMeters || 0) <= 100 &&
      (c.bandwidth === '10G' || c.bandwidth === '25G' || c.bandwidth === '40G' || c.bandwidth === '100G')
  );
  if (over55mCat6HighSpeed.length > 0) {
    warnings.push({
      severity: 'warning',
      code: 'TIA_CAT6_10G_55M',
      message: `${over55mCat6HighSpeed.length} tuyến CAT6 UTP tốc độ 10G+ dài > 55m (${over55mCat6HighSpeed
        .slice(0, 3)
        .map(c => c.cableCode || c.id)
        .join(', ')}); nên đổi sang CAT6A STP hoặc cáp quang.`
    });
  }

  const zeroLengthCables = floorFilteredCables.filter(c => !c.lengthMeters || c.lengthMeters <= 0);
  if (zeroLengthCables.length > 0) {
    warnings.push({
      severity: 'warning',
      code: 'CABLE_ZERO_LENGTH',
      message: `${zeroLengthCables.length} tuyến cáp chưa có chiều dài thực tế (> 0m); tổng mét cáp có thể bị thiếu.`
    });
  }

  if (floorFilteredCables.length > 0 && (!project.settings?.scale || project.settings.scale === 25)) {
    warnings.push({
      severity: 'info',
      code: 'DEFAULT_SCALE_UNSET',
      message: `Bản vẽ đang dùng tỉ lệ mặc định (${project.settings?.scale || 25} px/m). Hãy hiệu chuẩn thước đo trước khi chốt đơn đặt hàng cáp.`
    });
  }

  const unportedCables = floorFilteredCables.filter(
    c => !c.sourcePortId || c.sourcePortId === 'Auto' || !c.targetPortId || c.targetPortId === 'Auto'
  );
  if (unportedCables.length > 0) {
    warnings.push({
      severity: 'info',
      code: 'MISSING_PORT_ASSIGNMENT',
      message: `${unportedCables.length} tuyến cáp chưa gán cổng đấu nối cụ thể (đang để Auto); nên gán cổng để xuất nhãn TIA-606-C chính xác.`
    });
  }

  const passiveOrStructuralCategories = new Set(['rack', 'cloud', 'patch_panel', 'odf']);
  const incompleteSpecAssets = floorFilteredAssets.filter(a => {
    if (passiveOrStructuralCategories.has(a.category)) return false;
    const modelStr = (a.model || '').trim().toLowerCase();
    return !modelStr || modelStr === 'standard' || modelStr === 'generic' || !a.powerWatts || a.powerWatts <= 0;
  });
  if (incompleteSpecAssets.length > 0) {
    warnings.push({
      severity: 'info',
      code: 'MISSING_DEVICE_SPECS',
      message: `${incompleteSpecAssets.length} thiết bị hoạt động chưa đủ Model hoặc công suất điện (W) (${incompleteSpecAssets
        .slice(0, 3)
        .map(a => a.name)
        .join(', ')}); dự toán tải UPS có thể thấp hơn thực tế.`
    });
  }

  const precision: BomPrecisionCheck = {
    routeTotalMeters,
    typeTotalMeters,
    floorTotalMeters,
    deltaMeters,
    isConsistent: deltaMeters <= 0.2,
    warnings
  };

  return {
    reservePct: copperLossPct,
    assumptions,
    kpis: {
      deviceCount: nonRackAssets.length,
      rackCount: totalRackCabinets,
      usedRackU,
      totalRackU,
      networkDeviceCount,
      electricalDeviceCount,
      cableCount: cableBaseSummary.totalCount,
      rawCableMeters: totalCombinedRawCableMeters,
      totalCableWithReserveMeters,
      trayTotalMeters,
      trayRoutedCableCount: totalTrayRoutedCableCount,
      totalPowerWatts: totalWatts,
      totalPowerKw: Math.round((totalWatts / 1000) * 100) / 100,
      recommendedUpsVa,
      totalWeightKg: Math.round(totalAssetWeightKg * 10) / 10,
      roomCount: filteredRooms.length,
      totalAreaM2,
      rackComponentCount: rackComponents.length,
      devicesTotalVnd,
      cablesTotalVnd,
      accessoriesTotalVnd,
      estimatedGrandTotalVnd
    },
    quotation,
    cadExtraction,
    deviceRows: filteredDeviceRows,
    cableRows,
    floorRows,
    roomRows,
    systemRows,
    rackSummaryRows,
    rackComponents,
    inferredAccessories,
    precision,
    availableCategories: Array.from(categorySet.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi'))
  };
}

/**
 * B8: First-Fit Decreasing (FFD) Cable Spool Optimization & Cut Plan.
 * Minimizes waste across 305m copper boxes / 1000m fiber drums.
 */
export function optimizeCableSpools(
  project: ProjectState,
  options?: BomFilterOptions
): BomSpoolTypePlan[] {
  const stats = computeProjectBomStats(project, options);
  const floorFilter = options?.floorId && options.floorId !== 'all' ? options.floorId : undefined;
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const floorMap = new Map(project.floors.map(f => [f.id, f]));

  const filteredCables = (project.cables || []).filter(cable => {
    if (!floorFilter) return true;
    const src = nodeMap.get(cable.sourceNodeId);
    const tgt = nodeMap.get(cable.targetNodeId);
    return src?.floorId === floorFilter || tgt?.floorId === floorFilter;
  });

  const spoolTypes: CableEdge['cableType'][] = ['CAT6_UTP', 'CAT6A_STP', 'FIBER_SM_OS2', 'FIBER_MM_OM4'];
  const plans: BomSpoolTypePlan[] = [];

  for (const cableType of spoolTypes) {
    const groupCables = filteredCables.filter(c => c.cableType === cableType);
    if (groupCables.length === 0) continue;

    const isFiber = FIBER_CABLE_TYPES.has(cableType);
    const spoolLen = isFiber ? stats.assumptions.fiberSpoolMeters : stats.assumptions.copperSpoolMeters;
    const meta = CABLE_TYPE_META[cableType];

    const demands: BomSpoolCutSegment[] = groupCables
      .map(c => ({
        cableId: c.id,
        cableCode: c.cableCode || c.id,
        cutMeters: Math.max(1, computeSingleCableOrderMeters(c, nodeMap, floorMap, stats.assumptions))
      }))
      .sort((a, b) => b.cutMeters - a.cutMeters);

    const bins: Array<{ remaining: number; used: number; segments: BomSpoolCutSegment[] }> = [];

    for (const seg of demands) {
      if (seg.cutMeters >= spoolLen) {
        // Single pull exceeds one spool: allocate dedicated spool(s)
        let remCut = seg.cutMeters;
        let part = 1;
        while (remCut > 0) {
          const take = Math.min(spoolLen, Math.round(remCut * 10) / 10);
          bins.push({
            remaining: Math.round((spoolLen - take) * 10) / 10,
            used: take,
            segments: [{ ...seg, cableCode: `${seg.cableCode} (đoạn ${part})`, cutMeters: take }]
          });
          remCut = Math.round((remCut - take) * 10) / 10;
          part += 1;
        }
        continue;
      }

      const targetBin = bins.find(b => b.remaining >= seg.cutMeters);
      if (targetBin) {
        targetBin.used = Math.round((targetBin.used + seg.cutMeters) * 10) / 10;
        targetBin.remaining = Math.round((spoolLen - targetBin.used) * 10) / 10;
        targetBin.segments.push(seg);
      } else {
        bins.push({
          used: seg.cutMeters,
          remaining: Math.round((spoolLen - seg.cutMeters) * 10) / 10,
          segments: [seg]
        });
      }
    }

    const totalDemandMeters = Math.round(demands.reduce((s, d) => s + d.cutMeters, 0) * 10) / 10;
    const totalSpoolCapacity = bins.length * spoolLen;
    const totalScrapMeters = Math.round(bins.reduce((s, b) => s + b.remaining, 0) * 10) / 10;
    const overallUtilizationPct =
      totalSpoolCapacity > 0 ? Math.round((totalDemandMeters / totalSpoolCapacity) * 1000) / 10 : 0;

    plans.push({
      cableType,
      label: meta?.label || cableType,
      spoolLengthMeters: spoolLen,
      totalDemandMeters,
      naiveSpools: Math.ceil(totalDemandMeters / spoolLen),
      optimizedSpools: bins.length,
      totalScrapMeters,
      overallUtilizationPct,
      spools: bins.map((b, i) => ({
        spoolNumber: i + 1,
        spoolLengthMeters: spoolLen,
        usedMeters: b.used,
        scrapMeters: b.remaining,
        utilizationPct: Math.round((b.used / spoolLen) * 1000) / 10,
        segments: b.segments
      }))
    });
  }

  return plans;
}

/**
 * B6: Compare two BOM snapshots (e.g., saved Revision vs current ProjectState).
 */
export function compareProjectBoms(
  baseline: ProjectBomStats,
  current: ProjectBomStats
): BomComparisonResult {
  const buildDiffList = <T>(
    baseItems: T[],
    curItems: T[],
    getKey: (item: T) => string,
    getMeta: (item: T) => { label: string; categoryLabel: string; unit: string; qty: number; costVnd: number }
  ): BomComparisonItemDiff[] => {
    const map = new Map<string, BomComparisonItemDiff>();
    for (const item of baseItems) {
      const k = getKey(item);
      const m = getMeta(item);
      map.set(k, {
        key: k,
        label: m.label,
        categoryLabel: m.categoryLabel,
        unit: m.unit,
        baselineQty: m.qty,
        currentQty: 0,
        qtyDelta: -m.qty,
        baselineCostVnd: m.costVnd,
        currentCostVnd: 0,
        costDeltaVnd: -m.costVnd,
        status: 'removed'
      });
    }
    for (const item of curItems) {
      const k = getKey(item);
      const m = getMeta(item);
      const prev = map.get(k);
      if (!prev) {
        map.set(k, {
          key: k,
          label: m.label,
          categoryLabel: m.categoryLabel,
          unit: m.unit,
          baselineQty: 0,
          currentQty: m.qty,
          qtyDelta: m.qty,
          baselineCostVnd: 0,
          currentCostVnd: m.costVnd,
          costDeltaVnd: m.costVnd,
          status: 'added'
        });
      } else {
        const qtyDelta = Math.round((m.qty - prev.baselineQty) * 10) / 10;
        const costDeltaVnd = Math.round(m.costVnd - prev.baselineCostVnd);
        prev.currentQty = m.qty;
        prev.qtyDelta = qtyDelta;
        prev.currentCostVnd = m.costVnd;
        prev.costDeltaVnd = costDeltaVnd;
        prev.status = Math.abs(qtyDelta) > 0.01 || Math.abs(costDeltaVnd) > 0 ? 'changed' : 'unchanged';
      }
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.costDeltaVnd) - Math.abs(a.costDeltaVnd));
  };

  return {
    kpis: {
      deviceCountDelta: current.kpis.deviceCount - baseline.kpis.deviceCount,
      rackCountDelta: current.kpis.rackCount - baseline.kpis.rackCount,
      cableMetersDelta:
        Math.round((current.kpis.totalCableWithReserveMeters - baseline.kpis.totalCableWithReserveMeters) * 10) / 10,
      powerWattsDelta: current.kpis.totalPowerWatts - baseline.kpis.totalPowerWatts,
      estimatedCostDeltaVnd: current.kpis.estimatedGrandTotalVnd - baseline.kpis.estimatedGrandTotalVnd
    },
    deviceDiffs: buildDiffList(
      baseline.deviceRows,
      current.deviceRows,
      r => r.key,
      r => ({
        label: `${r.vendor} · ${r.model}`,
        categoryLabel: r.categoryLabel,
        unit: r.unit,
        qty: r.quantity,
        costVnd: r.totalPriceVnd
      })
    ),
    cableDiffs: buildDiffList(
      baseline.cableRows,
      current.cableRows,
      r => r.cableType,
      r => ({
        label: r.label,
        categoryLabel: 'Dây cáp',
        unit: 'm',
        qty: r.totalWithReserveMeters,
        costVnd: r.totalPriceVnd
      })
    ),
    accessoryDiffs: buildDiffList(
      baseline.inferredAccessories,
      current.inferredAccessories,
      r => r.id,
      r => ({
        label: r.name,
        categoryLabel: r.group,
        unit: r.unit,
        qty: r.orderQty,
        costVnd: r.totalPriceVnd
      })
    )
  };
}
