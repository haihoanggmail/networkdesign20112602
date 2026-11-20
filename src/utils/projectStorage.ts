import {
  ProjectState,
  CanvasSettings,
  ServerRack,
  DeviceAsset,
  ProjectSummary,
  VlanSpec,
  SubnetSpec,
  PatchLink,
  ProjectRevision,
  ProjectSnapshot,
  ProjectSnapshotTrigger,
  RevisionDiffSummary,
  CableTray,
  CanvasGuideLine
} from '../types/infrastructure';
import {
  isSafeSvgContent,
  MAX_PROJECT_ASSETS,
  MAX_PROJECT_CABLES,
  MAX_PROJECT_NODES,
  sanitizeSafeImageUrl
} from './security';
import { isValidCanvasLayerId } from './layerPolicy';

export const PRIMARY_STORAGE_KEY = 'hachihi_network_designer_v3_state';
export const RECOVERY_STORAGE_KEY = 'hachihi_network_designer_recovery_v4';
export const RECOVERY_SNAPSHOTS_KEY = 'hachihi_network_designer_recovery_snapshots_v5';
export const MAX_RECOVERY_SNAPSHOTS = 3;
export const RECOVERY_ENVELOPE_VERSION = 1;
export const CURRENT_SCHEMA_VERSION = 5;
export const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_INDEXEDDB_SNAPSHOTS_PER_PROJECT = 24;
export const MAX_LOCALSTORAGE_RECOVERY_CHARS = 1_500_000;

const IDB_NAME = 'hachihi_designer_db';
const IDB_VERSION = 3;
const STORE_PROJECTS = 'projects';
const STORE_META = 'meta';
const STORE_REVISIONS = 'revisions';
const STORE_SNAPSHOTS = 'snapshots';

export const DEFAULT_CANVAS_SETTINGS: CanvasSettings = {
  gridSize: 20,
  snapToGrid: true,
  showRulers: true,
  showGrid: true,
  showPortLabels: true,
  showIpAddresses: true,
  showCableCodes: true,
  showCoverageRadius: true,
  unit: 'm',
  scale: 30,
  backgroundColor: '#f8fafc',
  isDarkMode: false,
  hiddenLayers: [],
  lockedLayers: [],
  autoLayeringEnabled: false,
  guideLines: [],
  ipRangeStart: '192.168.10.10',
  ipRangeEnd: '192.168.10.250',
  ipSubnetMask: '255.255.255.0',
  ipGateway: '192.168.10.1',
  experienceMode: 'advanced',
  canvasPerformanceMode: 'auto'
};

export type MigrationResult =
  | { ok: true; project: ProjectState; warnings: string[] }
  | { ok: false; error: string };

export interface StoredProjectRecord {
  id: string;
  name: string;
  author: string;
  version: string;
  lastModified: string;
  lastSavedAt: string;
  nodeCount: number;
  assetCount: number;
  rackCount: number;
  cableCount: number;
  isTrashed: boolean;
  trashedAt?: string;
  data: ProjectState;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Validates and migrates a saved/imported JSON project (including legacy Premium V3 files)
 * into a safe, normalized Ultimate Edition ProjectState without dropping existing devices,
 * rack placements, or cables.
 */
export function migrateAndValidateProject(raw: unknown): MigrationResult {
  if (!isPlainRecord(raw)) {
    return { ok: false, error: 'Dữ liệu dự án không phải đối tượng JSON hợp lệ.' };
  }

  if (!isPlainRecord(raw.assets)) {
    return { ok: false, error: 'Thiếu danh sách thiết bị (assets) trong file dự án.' };
  }
  if (!Array.isArray(raw.nodes)) {
    return { ok: false, error: 'Thiếu danh sách nút sơ đồ (nodes) trong file dự án.' };
  }

  const assetEntriesCount = Object.keys(raw.assets).length;
  if (assetEntriesCount > MAX_PROJECT_ASSETS) {
    return {
      ok: false,
      error: `Số lượng thiết bị (${assetEntriesCount}) vượt quá giới hạn an toàn (${MAX_PROJECT_ASSETS} thiết bị).`
    };
  }
  if (raw.nodes.length > MAX_PROJECT_NODES) {
    return {
      ok: false,
      error: `Số lượng nút sơ đồ (${raw.nodes.length}) vượt quá giới hạn an toàn (${MAX_PROJECT_NODES} nút).`
    };
  }
  if (Array.isArray(raw.cables) && raw.cables.length > MAX_PROJECT_CABLES) {
    return {
      ok: false,
      error: `Số lượng tuyến cáp (${raw.cables.length}) vượt quá giới hạn an toàn (${MAX_PROJECT_CABLES} tuyến).`
    };
  }

  const warnings: string[] = [];

  // Normalize assets
  const normalizedAssets: Record<string, DeviceAsset> = {};
  for (const [key, val] of Object.entries(raw.assets)) {
    if (!isPlainRecord(val)) continue;
    const a = val as unknown as DeviceAsset;
    const id = a.id || key;
    const sanitizedImg = sanitizeSafeImageUrl(a.customImageUrl);
    if (a.customImageUrl && !sanitizedImg) {
      warnings.push(`Đã gỡ URL ảnh thiết bị không an toàn trên "${a.name || id}".`);
    }
    const rawUps = isPlainRecord((val as Record<string, unknown>).upsSpecs)
      ? ((val as Record<string, unknown>).upsSpecs as Record<string, unknown>)
      : null;
    const normalizedUpsSpecs: DeviceAsset['upsSpecs'] = (() => {
      if (!rawUps) return undefined;
      const batteryAh = Number.isFinite(Number(rawUps.batteryAh)) && Number(rawUps.batteryAh) > 0
        ? Number(rawUps.batteryAh)
        : 0;
      const batteryVoltageV = Number.isFinite(Number(rawUps.batteryVoltageV)) && Number(rawUps.batteryVoltageV) > 0
        ? Number(rawUps.batteryVoltageV)
        : 0;
      const batteryCount = Number.isFinite(Number(rawUps.batteryCount)) && Number(rawUps.batteryCount) > 0
        ? Math.max(1, Math.round(Number(rawUps.batteryCount)))
        : 0;
      const ratedVa = Number.isFinite(Number(rawUps.ratedVa)) && Number(rawUps.ratedVa) > 0
        ? Math.round(Number(rawUps.ratedVa))
        : undefined;
      const powerFactor =
        Number.isFinite(Number(rawUps.powerFactor)) &&
        Number(rawUps.powerFactor) > 0 &&
        Number(rawUps.powerFactor) <= 1
          ? Math.round(Number(rawUps.powerFactor) * 100) / 100
          : undefined;
      const hasBatteryTuple = batteryAh > 0 && batteryVoltageV > 0 && batteryCount > 0;
      const hasElectricalMetadata =
        ratedVa !== undefined ||
        powerFactor !== undefined ||
        typeof rawUps.batteryConfig === 'string' ||
        typeof rawUps.inputVoltageRange === 'string' ||
        typeof rawUps.redundancyMode === 'string' ||
        typeof rawUps.powerDomain === 'string';
      if (!hasBatteryTuple && !hasElectricalMetadata) return undefined;

      return {
        ...(ratedVa !== undefined ? { ratedVa } : {}),
        ...(powerFactor !== undefined ? { powerFactor } : {}),
        batteryAh,
        batteryVoltageV,
        batteryCount,
        ...(typeof rawUps.batteryConfig === 'string' && rawUps.batteryConfig.trim()
          ? { batteryConfig: rawUps.batteryConfig.trim().slice(0, 80) }
          : {}),
        ...(typeof rawUps.inputVoltageRange === 'string' && rawUps.inputVoltageRange.trim()
          ? { inputVoltageRange: rawUps.inputVoltageRange.trim().slice(0, 60) }
          : {}),
        inverterEfficiency:
          Number.isFinite(Number(rawUps.inverterEfficiency)) &&
          Number(rawUps.inverterEfficiency) >= 0.5 &&
          Number(rawUps.inverterEfficiency) <= 0.98
            ? Number(rawUps.inverterEfficiency)
            : undefined,
        dodFactor:
          Number.isFinite(Number(rawUps.dodFactor)) &&
          Number(rawUps.dodFactor) >= 0.4 &&
          Number(rawUps.dodFactor) <= 0.95
            ? Number(rawUps.dodFactor)
            : undefined,
        ...(rawUps.redundancyMode === 'standalone' ||
        rawUps.redundancyMode === 'parallel' ||
        rawUps.redundancyMode === 'n_plus_1'
          ? { redundancyMode: rawUps.redundancyMode }
          : {}),
        ...(typeof rawUps.powerDomain === 'string' && rawUps.powerDomain.trim()
          ? { powerDomain: rawUps.powerDomain.trim().slice(0, 80) }
          : {})
      };
    })();

    const rawL2 = isPlainRecord((val as Record<string, unknown>).l2Config)
      ? ((val as Record<string, unknown>).l2Config as Record<string, unknown>)
      : null;
    const normalizedL2Config: DeviceAsset['l2Config'] = rawL2
      ? {
          ...(rawL2.role === 'core' ||
          rawL2.role === 'distribution' ||
          rawL2.role === 'access' ||
          rawL2.role === 'edge'
            ? { role: rawL2.role }
            : {}),
          ...(rawL2.stpMode === 'none' ||
          rawL2.stpMode === 'stp' ||
          rawL2.stpMode === 'rstp' ||
          rawL2.stpMode === 'mstp' ||
          rawL2.stpMode === 'pvst'
            ? { stpMode: rawL2.stpMode }
            : {}),
          ...(Number.isFinite(Number(rawL2.stpPriority))
            ? { stpPriority: Math.max(0, Math.round(Number(rawL2.stpPriority))) }
            : {}),
          ...(typeof rawL2.lacpEnabled === 'boolean' ? { lacpEnabled: rawL2.lacpEnabled } : {}),
          ...(typeof rawL2.mlagDomain === 'string' && rawL2.mlagDomain.trim()
            ? { mlagDomain: rawL2.mlagDomain.trim().slice(0, 60) }
            : {})
        }
      : undefined;

    const normalizedPorts = Array.isArray(a.ports)
      ? a.ports
          .filter((p): p is DeviceAsset['ports'][number] => isPlainRecord(p) && typeof p.id === 'string')
          .map(p => ({
            ...p,
            ...(p.portMode === 'access' ||
            p.portMode === 'trunk' ||
            p.portMode === 'routed' ||
            p.portMode === 'lacp_member'
              ? { portMode: p.portMode }
              : {}),
            ...(typeof p.lacpGroup === 'string' && p.lacpGroup.trim()
              ? { lacpGroup: p.lacpGroup.trim().slice(0, 40) }
              : {}),
            ...(typeof p.nativeVlan === 'string' && p.nativeVlan.trim()
              ? { nativeVlan: p.nativeVlan.trim().slice(0, 20) }
              : {}),
            ...(typeof p.allowedVlans === 'string' && p.allowedVlans.trim()
              ? { allowedVlans: p.allowedVlans.trim().slice(0, 120) }
              : {})
          }))
      : [];

    normalizedAssets[id] = {
      ...a,
      id,
      name: a.name || `Device-${id.slice(-4)}`,
      category: a.category || 'switch',
      vendor: a.vendor || 'Generic',
      model: a.model || 'Standard',
      assetTag: a.assetTag || '',
      serialNumber: a.serialNumber || '',
      ipAddress: a.ipAddress || '',
      subnetMask: a.subnetMask || '255.255.255.0',
      gateway: a.gateway || '',
      macAddress: a.macAddress || '',
      vlan: a.vlan || '1',
      status: a.status || 'online',
      customImageUrl: sanitizedImg,
      rackSide: a.rackSide === 'rear' ? 'rear' : 'front',
      powerDomain:
        typeof a.powerDomain === 'string' && a.powerDomain.trim()
          ? a.powerDomain.trim().slice(0, 80)
          : undefined,
      fedByUpsId: typeof a.fedByUpsId === 'string' && a.fedByUpsId.trim() ? a.fedByUpsId.trim() : undefined,
      fedByPduId: typeof a.fedByPduId === 'string' && a.fedByPduId.trim() ? a.fedByPduId.trim() : undefined,
      powerFeed: a.powerFeed === 'A' || a.powerFeed === 'B' || a.powerFeed === 'single' ? a.powerFeed : undefined,
      circuitBreaker:
        typeof a.circuitBreaker === 'string' && a.circuitBreaker.trim()
          ? a.circuitBreaker.trim().slice(0, 40)
          : undefined,
      poeRole:
        a.poeRole === 'pse' || a.poeRole === 'pd' || a.poeRole === 'none' || a.poeRole === 'auto'
          ? a.poeRole
          : undefined,
      l2Config: normalizedL2Config && Object.keys(normalizedL2Config).length > 0 ? normalizedL2Config : undefined,
      upsSpecs: normalizedUpsSpecs,
      ports: normalizedPorts
    };
  }

  // Normalize racks (preserve legacy slots + initialize rearSlots safely)
  const rawRacks = Array.isArray(raw.racks) ? raw.racks : [];
  const normalizedRacks: ServerRack[] = rawRacks
    .filter((r): r is Record<string, unknown> => isPlainRecord(r))
    .map((r, idx) => {
      const unitsNum = Number(r.totalUnits);
      const totalUnits = Number.isFinite(unitsNum) && unitsNum >= 4 && unitsNum <= 64
        ? Math.round(unitsNum)
        : 42;
      const rackId = typeof r.id === 'string' && r.id ? r.id : `rack_mig_${idx + 1}`;

      const slots: Record<number, string> = {};
      if (isPlainRecord(r.slots)) {
        for (const [uKey, devId] of Object.entries(r.slots)) {
          const uNum = parseInt(uKey, 10);
          if (!Number.isNaN(uNum) && typeof devId === 'string' && normalizedAssets[devId]) {
            slots[uNum] = devId;
            if (!normalizedAssets[devId].rackId) {
              normalizedAssets[devId].rackId = rackId;
            }
            if (!normalizedAssets[devId].rackUnitStart) {
              normalizedAssets[devId].rackUnitStart = uNum;
            }
          }
        }
      }

      const rearSlots: Record<number, string> = {};
      if (isPlainRecord(r.rearSlots)) {
        for (const [uKey, devId] of Object.entries(r.rearSlots)) {
          const uNum = parseInt(uKey, 10);
          if (!Number.isNaN(uNum) && typeof devId === 'string' && normalizedAssets[devId]) {
            rearSlots[uNum] = devId;
            normalizedAssets[devId].rackSide = 'rear';
          }
        }
      }

      return {
        id: rackId,
        name: typeof r.name === 'string' && r.name ? r.name : `Rack ${idx + 1}`,
        buildingId: typeof r.buildingId === 'string' ? r.buildingId : undefined,
        floorId: typeof r.floorId === 'string' ? r.floorId : undefined,
        roomId: typeof r.roomId === 'string' ? r.roomId : undefined,
        totalUnits,
        widthMm: Number(r.widthMm) || 800,
        depthMm: Number(r.depthMm) || 1000,
        maxLoadKg: Number(r.maxLoadKg) || 1000,
        x: Number.isFinite(Number(r.x)) ? Number(r.x) : 300,
        y: Number.isFinite(Number(r.y)) ? Number(r.y) : 100,
        slots,
        rearSlots
      };
    });

  // Normalize nodes
  const normalizedNodes = raw.nodes
    .filter((n): n is Record<string, unknown> => isPlainRecord(n) && typeof n.id === 'string')
    .map(n => {
      const style = isPlainRecord(n.style) ? n.style : {};
      const safeNodeImg = sanitizeSafeImageUrl(typeof n.customImageUrl === 'string' ? n.customImageUrl : undefined);
      if (typeof n.customImageUrl === 'string' && n.customImageUrl && !safeNodeImg) {
        warnings.push(`Đã gỡ URL ảnh nút không an toàn trên "${String(n.label || n.id)}".`);
      }
      const rawCustomData = isPlainRecord(n.customData)
        ? (n.customData as ProjectState['nodes'][number]['customData'])
        : undefined;
      const hasLockedFlag = n.locked === true || rawCustomData?.locked === true;
      const normalizedCustomData =
        rawCustomData || hasLockedFlag
          ? {
              ...(rawCustomData || {}),
              ...(hasLockedFlag ? { locked: true } : {})
            }
          : undefined;
      return {
        ...(n as unknown as ProjectState['nodes'][number]),
        diagramMode: (n.diagramMode as ProjectState['activeMode']) || 'topology',
        type: (n.type as ProjectState['nodes'][number]['type']) || 'device',
        layerId: isValidCanvasLayerId(n.layerId) ? n.layerId : undefined,
        locked: hasLockedFlag ? true : undefined,
        hidden: n.hidden === true ? true : undefined,
        customData: normalizedCustomData,
        customImageUrl: safeNodeImg,
        label: typeof n.label === 'string' ? n.label : 'Node',
        x: Number.isFinite(Number(n.x)) ? Number(n.x) : 100,
        y: Number.isFinite(Number(n.y)) ? Number(n.y) : 100,
        width: Math.max(24, Number(n.width) || 140),
        height: Math.max(24, Number(n.height) || 56),
        rotation: Number(n.rotation) || 0,
        flipX: n.flipX === true ? true : undefined,
        flipY: n.flipY === true ? true : undefined,
        style: {
          backgroundColor: (style.backgroundColor as string) || '#0284c7',
          borderColor: (style.borderColor as string) || '#334155',
          borderWidth: Number(style.borderWidth) || 2,
          borderStyle: (style.borderStyle as 'solid' | 'dashed' | 'dotted') || 'solid',
          opacity: typeof style.opacity === 'number' ? style.opacity : 1,
          textColor: (style.textColor as string) || '#ffffff',
          iconColor: (style.iconColor as string) || '#ffffff'
        }
      };
    });

  const nodeIds = new Set(normalizedNodes.map(n => n.id));
  const rawCables = Array.isArray(raw.cables) ? raw.cables : [];
  const normalizedCables = rawCables
    .filter((c): c is ProjectState['cables'][number] => {
      if (!isPlainRecord(c) || typeof c.id !== 'string') return false;
      if (typeof c.sourceNodeId !== 'string' || typeof c.targetNodeId !== 'string') return false;
      if (!nodeIds.has(c.sourceNodeId) || !nodeIds.has(c.targetNodeId)) {
        warnings.push(`Bỏ qua tuyến cáp ${String(c.cableCode || c.id)} do thiếu thiết bị đầu/cuối.`);
        return false;
      }
      return true;
    })
    .map(c => ({
      ...c,
      label: typeof c.label === 'string' && c.label.trim().length > 0 ? c.label : undefined,
      labelFontSize:
        typeof c.labelFontSize === 'number' && Number.isFinite(c.labelFontSize)
          ? Math.max(7, Math.min(24, c.labelFontSize))
          : undefined,
      labelRotation:
        typeof c.labelRotation === 'number' && Number.isFinite(c.labelRotation)
          ? Math.max(-180, Math.min(180, c.labelRotation))
          : undefined,
      labelAutoOrient: typeof c.labelAutoOrient === 'boolean' ? c.labelAutoOrient : undefined,
      slackFactor:
        typeof c.slackFactor === 'number' && Number.isFinite(c.slackFactor)
          ? Math.max(1, Math.min(1.5, Math.round(c.slackFactor * 100) / 100))
          : undefined,
      fiberConnectors:
        typeof c.fiberConnectors === 'number' && Number.isFinite(c.fiberConnectors)
          ? Math.max(0, Math.min(40, Math.round(c.fiberConnectors)))
          : undefined,
      fiberSplices:
        typeof c.fiberSplices === 'number' && Number.isFinite(c.fiberSplices)
          ? Math.max(0, Math.min(80, Math.round(c.fiberSplices)))
          : undefined,
      transceiverBudgetDb:
        typeof c.transceiverBudgetDb === 'number' && Number.isFinite(c.transceiverBudgetDb)
          ? Math.max(0.5, Math.min(40, Math.round(c.transceiverBudgetDb * 10) / 10))
          : undefined
    }));

  const buildings = Array.isArray(raw.buildings) ? (raw.buildings as ProjectState['buildings']) : [];
  const floors = Array.isArray(raw.floors) ? (raw.floors as ProjectState['floors']) : [];
  const rooms = Array.isArray(raw.rooms) ? (raw.rooms as ProjectState['rooms']) : [];

  const rawSettings = isPlainRecord(raw.settings) ? (raw.settings as Partial<CanvasSettings>) : {};
  const safeBgUrl = sanitizeSafeImageUrl(rawSettings.backgroundImageUrl);
  if (rawSettings.backgroundImageUrl && !safeBgUrl) {
    warnings.push('Đã loại bỏ URL ảnh nền không an toàn khỏi cấu hình trang vẽ.');
  }

  const normalizedGuideLines: CanvasGuideLine[] = Array.isArray(rawSettings.guideLines)
    ? (rawSettings.guideLines as unknown[])
        .filter(
          (g): g is Record<string, unknown> =>
            isPlainRecord(g) &&
            (g.orientation === 'horizontal' || g.orientation === 'vertical') &&
            Number.isFinite(Number(g.pos))
        )
        .slice(0, 200)
        .map((g, idx) => ({
          id: typeof g.id === 'string' && g.id ? g.id : `guide_${idx + 1}`,
          orientation: g.orientation as 'horizontal' | 'vertical',
          pos: Math.round(Number(g.pos) * 10) / 10,
          floorId: typeof g.floorId === 'string' && g.floorId ? g.floorId : undefined
        }))
    : [];

  const rawPerfMode = rawSettings.canvasPerformanceMode;
  const normalizedPerfMode: CanvasSettings['canvasPerformanceMode'] =
    rawPerfMode === 'auto' || rawPerfMode === 'high_quality' || rawPerfMode === 'high_performance'
      ? rawPerfMode
      : 'auto';

  const settings: CanvasSettings = {
    ...DEFAULT_CANVAS_SETTINGS,
    ...rawSettings,
    autoLayeringEnabled: Boolean(rawSettings.autoLayeringEnabled),
    guideLines: normalizedGuideLines,
    backgroundImageUrl: safeBgUrl,
    canvasPerformanceMode: normalizedPerfMode
  };

  const normalizedVlans: VlanSpec[] = Array.isArray(raw.vlans)
    ? raw.vlans
        .filter((v): v is Record<string, unknown> => isPlainRecord(v) && Number.isFinite(Number(v.vlanId)))
        .map((v, idx) => ({
          id: typeof v.id === 'string' && v.id ? v.id : `vlan_${Number(v.vlanId)}_${idx}`,
          vlanId: Math.max(1, Math.min(4094, Math.round(Number(v.vlanId)))),
          name: typeof v.name === 'string' && v.name ? v.name : `VLAN ${v.vlanId}`,
          purpose: typeof v.purpose === 'string' ? v.purpose : undefined,
          color: typeof v.color === 'string' ? v.color : undefined
        }))
    : [];

  const normalizedSubnets: SubnetSpec[] = Array.isArray(raw.subnets)
    ? raw.subnets
        .filter((s): s is Record<string, unknown> => isPlainRecord(s) && typeof s.cidr === 'string' && s.cidr.trim().length > 0)
        .map((s, idx) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `subnet_${idx + 1}`,
          name: typeof s.name === 'string' && s.name ? s.name : String(s.cidr),
          cidr: String(s.cidr).trim(),
          vlanId: Number.isFinite(Number(s.vlanId)) ? Math.round(Number(s.vlanId)) : undefined,
          gateway: typeof s.gateway === 'string' ? s.gateway.trim() : undefined,
          dnsServers: typeof s.dnsServers === 'string' ? s.dnsServers.trim() : undefined,
          dhcpRange: typeof s.dhcpRange === 'string' ? s.dhcpRange.trim() : undefined,
          notes: typeof s.notes === 'string' ? s.notes : undefined
        }))
    : [];

  const normalizedPatchLinks: PatchLink[] = Array.isArray(raw.patchLinks)
    ? raw.patchLinks
        .filter((p): p is Record<string, unknown> => isPlainRecord(p) && typeof p.patchPanelAssetId === 'string')
        .map((p, idx) => ({
          id: typeof p.id === 'string' && p.id ? p.id : `patch_${idx + 1}`,
          patchPanelAssetId: String(p.patchPanelAssetId),
          patchPort: typeof p.patchPort === 'string' ? p.patchPort : `P${idx + 1}`,
          targetDeviceName: typeof p.targetDeviceName === 'string' ? p.targetDeviceName : '',
          targetPort: typeof p.targetPort === 'string' ? p.targetPort : undefined,
          cableCode: typeof p.cableCode === 'string' ? p.cableCode : undefined,
          roomName: typeof p.roomName === 'string' ? p.roomName : undefined,
          vlan: typeof p.vlan === 'string' ? p.vlan : undefined,
          notes: typeof p.notes === 'string' ? p.notes : undefined
        }))
    : [];

  const normalizedCableTrays: CableTray[] = Array.isArray(raw.cableTrays)
    ? raw.cableTrays
        .filter((t): t is Record<string, unknown> => isPlainRecord(t) && Array.isArray(t.points))
        .map((t, idx) => ({
          id: typeof t.id === 'string' && t.id ? t.id : `tray_${idx + 1}`,
          name: typeof t.name === 'string' && t.name ? t.name : `Máng cáp ${idx + 1}`,
          floorId: typeof t.floorId === 'string' ? t.floorId : undefined,
          kind:
            t.kind === 'power_tray' || t.kind === 'conduit'
              ? t.kind
              : 'network_tray',
          widthPx: Math.max(8, Math.min(120, Number(t.widthPx) || 24)),
          color: typeof t.color === 'string' ? t.color : undefined,
          points: (t.points as unknown[])
            .filter((pt): pt is Record<string, unknown> => isPlainRecord(pt) && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y)))
            .map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
        }))
    : [];

  const migrated: ProjectState = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `proj_${Date.now()}`,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'HACHIHI Infrastructure Project',
    author: typeof raw.author === 'string' ? raw.author : 'Engineer',
    version: typeof raw.version === 'string' ? raw.version : '4.0.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastModified: typeof raw.lastModified === 'string' ? raw.lastModified : new Date().toISOString(),
    lastSavedAt: typeof raw.lastSavedAt === 'string' ? raw.lastSavedAt : new Date().toISOString(),
    buildings,
    floors,
    rooms,
    cableTrays: normalizedCableTrays,
    racks: normalizedRacks,
    assets: normalizedAssets,
    nodes: normalizedNodes,
    cables: normalizedCables,
    vlans: normalizedVlans,
    subnets: normalizedSubnets,
    patchLinks: normalizedPatchLinks,
    activeMode: (raw.activeMode as ProjectState['activeMode']) || 'topology',
    activeBuildingId: typeof raw.activeBuildingId === 'string' ? raw.activeBuildingId : buildings[0]?.id || '',
    activeFloorId: typeof raw.activeFloorId === 'string' ? raw.activeFloorId : floors[0]?.id || '',
    settings
  };

  return { ok: true, project: migrated, warnings };
}

/* --------------------------------------------------------------------------
 * IndexedDB Storage Engine (supports multi-project workspace, trash, meta)
 * -------------------------------------------------------------------------- */

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

let sharedDbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (sharedDbPromise) {
    return sharedDbPromise;
  }
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDB()) {
      sharedDbPromise = null;
      reject(new Error('Trình duyệt không hỗ trợ IndexedDB.'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_REVISIONS)) {
        const revStore = db.createObjectStore(STORE_REVISIONS, { keyPath: 'id' });
        revStore.createIndex('by_project', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snapStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        snapStore.createIndex('by_project', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // ignore
        }
        sharedDbPromise = null;
      };
      db.onclose = () => {
        if (sharedDbPromise === promise) {
          sharedDbPromise = null;
        }
      };
      resolve(db);
    };
    req.onerror = () => {
      if (sharedDbPromise === promise) {
        sharedDbPromise = null;
      }
      reject(req.error || new Error('Không thể mở cơ sở dữ liệu IndexedDB.'));
    };
    req.onblocked = () => {
      if (sharedDbPromise === promise) {
        sharedDbPromise = null;
      }
    };
  });
  sharedDbPromise = promise;
  return promise;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // non-fatal
  }
  return false;
}

export function toProjectSummary(rec: StoredProjectRecord): ProjectSummary {
  return {
    id: rec.id,
    name: rec.name,
    author: rec.author,
    version: rec.version,
    lastModified: rec.lastModified,
    lastSavedAt: rec.lastSavedAt,
    nodeCount: rec.nodeCount,
    assetCount: rec.assetCount,
    rackCount: rec.rackCount,
    cableCount: rec.cableCount,
    isTrashed: rec.isTrashed,
    trashedAt: rec.trashedAt
  };
}

export function toProjectSummaryFromState(
  project: ProjectState,
  isTrashed = false,
  trashedAt?: string
): ProjectSummary {
  const now = new Date().toISOString();
  return {
    id: project.id,
    name: project.name,
    author: project.author,
    version: project.version,
    lastModified: project.lastModified || now,
    lastSavedAt: project.lastSavedAt || now,
    nodeCount: project.nodes.length,
    assetCount: Object.keys(project.assets || {}).length,
    rackCount: project.racks.length,
    cableCount: project.cables.length,
    isTrashed,
    trashedAt
  };
}

function buildRecord(project: ProjectState, isTrashed = false, trashedAt?: string): StoredProjectRecord {
  const now = new Date().toISOString();
  return {
    id: project.id,
    name: project.name,
    author: project.author,
    version: project.version,
    lastModified: project.lastModified || now,
    lastSavedAt: project.lastSavedAt || now,
    nodeCount: project.nodes.length,
    assetCount: Object.keys(project.assets).length,
    rackCount: project.racks.length,
    cableCount: project.cables.length,
    isTrashed,
    trashedAt,
    data: project
  };
}

export async function saveProjectToDB(
  project: ProjectState,
  options?: { isTrashed?: boolean; trashedAt?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const db = await openDB();
    const record = buildRecord(project, options?.isTrashed ?? false, options?.trashedAt);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_META], 'readwrite');
      tx.objectStore(STORE_PROJECTS).put(record);
      if (!record.isTrashed) {
        tx.objectStore(STORE_META).put({ key: 'activeProjectId', value: project.id });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Lỗi ghi dữ liệu vào IndexedDB.'));
      tx.onabort = () => reject(tx.error || new Error('Giao dịch lưu IndexedDB bị hủy.'));
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Không thể lưu vào IndexedDB: ${message}` };
  }
}

export async function listProjectsFromDB(): Promise<ProjectSummary[]> {
  try {
    const db = await openDB();
    const records = await new Promise<StoredProjectRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).getAll();
      req.onsuccess = () => resolve((req.result || []) as StoredProjectRecord[]);
      req.onerror = () => reject(req.error);
    });
    return records
      .map(toProjectSummary)
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
  } catch {
    return [];
  }
}

export async function loadProjectFromDB(projectId: string): Promise<ProjectState | null> {
  try {
    const db = await openDB();
    const record = await new Promise<StoredProjectRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).get(projectId);
      req.onsuccess = () => resolve(req.result as StoredProjectRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record?.data) return null;
    const migrated = migrateAndValidateProject(record.data);
    return migrated.ok ? migrated.project : null;
  } catch {
    return null;
  }
}

export async function setProjectTrashStateInDB(projectId: string, isTrashed: boolean): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const getReq = store.get(projectId);
      getReq.onsuccess = () => {
        const rec = getReq.result as StoredProjectRecord | undefined;
        if (rec) {
          rec.isTrashed = isTrashed;
          rec.trashedAt = isTrashed ? new Date().toISOString() : undefined;
          store.put(rec);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteProjectPermanentlyFromDB(projectId: string): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const storeNames = db.objectStoreNames.contains(STORE_SNAPSHOTS)
        ? [STORE_PROJECTS, STORE_SNAPSHOTS]
        : [STORE_PROJECTS];
      const tx = db.transaction(storeNames, 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(projectId);
      if (db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snapStore = tx.objectStore(STORE_SNAPSHOTS);
        const index = snapStore.index('by_project');
        const req = index.getAllKeys(projectId);
        req.onsuccess = () => {
          const keys = (req.result || []) as IDBValidKey[];
          for (const key of keys) {
            snapStore.delete(key);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function getMetaValue<T = string>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    const res = await new Promise<{ key: string; value: T } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(key);
      req.onsuccess = () => resolve(req.result as { key: string; value: T } | undefined);
      req.onerror = () => reject(req.error);
    });
    return res ? res.value : null;
  } catch {
    return null;
  }
}

export async function setMetaValue<T = string>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // non-fatal
  }
}

/* --------------------------------------------------------------------------
 * Named Project Revisions / Checkpoints
 * -------------------------------------------------------------------------- */

export async function saveRevisionToDB(revision: ProjectRevision): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REVISIONS, 'readwrite');
      tx.objectStore(STORE_REVISIONS).put(revision);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function listRevisionsFromDB(projectId: string): Promise<ProjectRevision[]> {
  try {
    const db = await openDB();
    const list = await new Promise<ProjectRevision[]>((resolve, reject) => {
      const tx = db.transaction(STORE_REVISIONS, 'readonly');
      const store = tx.objectStore(STORE_REVISIONS);
      const index = store.index('by_project');
      const req = index.getAll(projectId);
      req.onsuccess = () => resolve((req.result || []) as ProjectRevision[]);
      req.onerror = () => reject(req.error);
    });
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export async function deleteRevisionFromDB(revisionId: string): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REVISIONS, 'readwrite');
      tx.objectStore(STORE_REVISIONS).delete(revisionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------------
 * Periodic IndexedDB Project Snapshots (Auto 10-min + Manual + Pre-Restore)
 * -------------------------------------------------------------------------- */

export function computeSnapshotByteSize(project: ProjectState): number {
  try {
    const serialized = JSON.stringify(project);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(serialized).length;
    }
    return serialized.length * 2;
  } catch {
    return 0;
  }
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function createProjectSnapshotRecord(
  project: ProjectState,
  trigger: ProjectSnapshotTrigger = 'auto_interval',
  customLabel?: string
): ProjectSnapshot {
  const cloned = structuredClone(project);
  if (!cloned.schemaVersion) {
    cloned.schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  const nowIso = new Date().toISOString();
  const timeText = new Date(nowIso).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const defaultLabel =
    trigger === 'auto_interval'
      ? `Snapshot tự động (${timeText})`
      : trigger === 'pre_restore'
      ? `Sao lưu trước khi khôi phục (${timeText})`
      : `Snapshot thủ công (${timeText})`;

  return {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: cloned.id,
    projectName: cloned.name || 'HACHIHI Project',
    createdAt: nowIso,
    trigger,
    label: customLabel?.trim() || defaultLabel,
    checksum: computeProjectChecksum(cloned),
    byteSize: computeSnapshotByteSize(cloned),
    nodeCount: (cloned.nodes || []).length,
    assetCount: Object.keys(cloned.assets || {}).length,
    rackCount: (cloned.racks || []).length,
    cableCount: (cloned.cables || []).length,
    floorCount: (cloned.floors || []).length,
    snapshot: cloned
  };
}

export function selectSnapshotIdsToPrune(
  snapshots: ProjectSnapshot[],
  maxPerProject = MAX_INDEXEDDB_SNAPSHOTS_PER_PROJECT
): string[] {
  if (snapshots.length <= maxPerProject) return [];
  const sortedNewestFirst = [...snapshots].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const excess = sortedNewestFirst.length - maxPerProject;
  // Prefer pruning oldest automatic snapshots first; fall back to oldest overall if needed
  const oldestFirst = [...sortedNewestFirst].reverse();
  const toDelete: string[] = [];
  for (const snap of oldestFirst) {
    if (toDelete.length >= excess) break;
    if (snap.trigger === 'auto_interval') {
      toDelete.push(snap.id);
    }
  }
  for (const snap of oldestFirst) {
    if (toDelete.length >= excess) break;
    if (!toDelete.includes(snap.id)) {
      toDelete.push(snap.id);
    }
  }
  return toDelete;
}

export async function listProjectSnapshotsFromDB(projectId?: string): Promise<ProjectSnapshot[]> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
      return [];
    }
    const list = await new Promise<ProjectSnapshot[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const req = projectId
        ? store.index('by_project').getAll(projectId)
        : store.getAll();
      req.onsuccess = () => resolve((req.result || []) as ProjectSnapshot[]);
      req.onerror = () => reject(req.error);
    });
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export async function saveProjectSnapshotToDB(
  project: ProjectState,
  options?: {
    trigger?: ProjectSnapshotTrigger;
    label?: string;
    skipIfUnchanged?: boolean;
    maxPerProject?: number;
  }
): Promise<{
  ok: boolean;
  snapshot?: ProjectSnapshot;
  skippedDuplicate?: boolean;
  error?: string;
}> {
  try {
    const migrated = migrateAndValidateProject(project);
    if (!migrated.ok) {
      return { ok: false, error: migrated.error };
    }
    const trigger = options?.trigger ?? 'auto_interval';
    const maxPerProject = options?.maxPerProject ?? MAX_INDEXEDDB_SNAPSHOTS_PER_PROJECT;
    const record = createProjectSnapshotRecord(migrated.project, trigger, options?.label);

    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
      return { ok: false, error: 'Cơ sở dữ liệu IndexedDB chưa có kho lưu Snapshot.' };
    }

    const existing = await new Promise<ProjectSnapshot[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readonly');
      const req = tx.objectStore(STORE_SNAPSHOTS).index('by_project').getAll(record.projectId);
      req.onsuccess = () => resolve((req.result || []) as ProjectSnapshot[]);
      req.onerror = () => reject(req.error);
    });
    existing.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options?.skipIfUnchanged && existing[0]?.checksum === record.checksum) {
      return { ok: true, skippedDuplicate: true, snapshot: existing[0] };
    }

    const pruneIds = selectSnapshotIdsToPrune([record, ...existing], maxPerProject);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      store.put(record);
      for (const id of pruneIds) {
        if (id !== record.id) {
          store.delete(id);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Không thể ghi Snapshot vào IndexedDB.'));
      tx.onabort = () => reject(tx.error || new Error('Giao dịch ghi Snapshot bị hủy.'));
    });
    return { ok: true, snapshot: record };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function deleteProjectSnapshotFromDB(snapshotId: string): Promise<boolean> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
      return false;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
      tx.objectStore(STORE_SNAPSHOTS).delete(snapshotId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export function computeRevisionDiff(current: ProjectState, snapshot: ProjectState): RevisionDiffSummary {
  const curNodeIds = new Set(current.nodes.map(n => n.id));
  const snapNodeIds = new Set(snapshot.nodes.map(n => n.id));
  const curAssetIds = new Set(Object.keys(current.assets));
  const snapAssetIds = new Set(Object.keys(snapshot.assets));
  const curCableIds = new Set(current.cables.map(c => c.id));
  const snapCableIds = new Set(snapshot.cables.map(c => c.id));
  const curRackIds = new Set(current.racks.map(r => r.id));
  const snapRackIds = new Set(snapshot.racks.map(r => r.id));

  let addedNodes = 0;
  let removedNodes = 0;
  curNodeIds.forEach(id => { if (!snapNodeIds.has(id)) addedNodes++; });
  snapNodeIds.forEach(id => { if (!curNodeIds.has(id)) removedNodes++; });

  let addedAssets = 0;
  let removedAssets = 0;
  curAssetIds.forEach(id => { if (!snapAssetIds.has(id)) addedAssets++; });
  snapAssetIds.forEach(id => { if (!curAssetIds.has(id)) removedAssets++; });

  let addedCables = 0;
  let removedCables = 0;
  curCableIds.forEach(id => { if (!snapCableIds.has(id)) addedCables++; });
  snapCableIds.forEach(id => { if (!curCableIds.has(id)) removedCables++; });

  let addedRacks = 0;
  let removedRacks = 0;
  curRackIds.forEach(id => { if (!snapRackIds.has(id)) addedRacks++; });
  snapRackIds.forEach(id => { if (!curRackIds.has(id)) removedRacks++; });

  return {
    addedNodes,
    removedNodes,
    addedAssets,
    removedAssets,
    addedCables,
    removedCables,
    addedRacks,
    removedRacks
  };
}

export interface DetailedAssetFieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface DetailedAssetDiffEntry {
  assetId: string;
  name: string;
  changes: DetailedAssetFieldChange[];
}

export interface DetailedRevisionDiff {
  summary: RevisionDiffSummary;
  addedNodeLabels: string[];
  removedNodeLabels: string[];
  addedCableCodes: string[];
  removedCableCodes: string[];
  modifiedAssets: DetailedAssetDiffEntry[];
}

export function computeDetailedRevisionDiff(
  current: ProjectState,
  snapshot: ProjectState
): DetailedRevisionDiff {
  const summary = computeRevisionDiff(current, snapshot);
  const curNodeMap = new Map(current.nodes.map(n => [n.id, n]));
  const snapNodeMap = new Map(snapshot.nodes.map(n => [n.id, n]));
  const curCableMap = new Map(current.cables.map(c => [c.id, c]));
  const snapCableMap = new Map(snapshot.cables.map(c => [c.id, c]));

  const addedNodeLabels: string[] = [];
  const removedNodeLabels: string[] = [];
  curNodeMap.forEach((n, id) => {
    if (!snapNodeMap.has(id)) addedNodeLabels.push(n.label || id);
  });
  snapNodeMap.forEach((n, id) => {
    if (!curNodeMap.has(id)) removedNodeLabels.push(n.label || id);
  });

  const addedCableCodes: string[] = [];
  const removedCableCodes: string[] = [];
  curCableMap.forEach((c, id) => {
    if (!snapCableMap.has(id)) addedCableCodes.push(c.cableCode || id);
  });
  snapCableMap.forEach((c, id) => {
    if (!curCableMap.has(id)) removedCableCodes.push(c.cableCode || id);
  });

  const modifiedAssets: DetailedAssetDiffEntry[] = [];
  const trackedFields: Array<{ key: keyof ProjectState['assets'][string]; label: string }> = [
    { key: 'name', label: 'Tên thiết bị' },
    { key: 'ipAddress', label: 'Địa chỉ IP' },
    { key: 'vlan', label: 'VLAN' },
    { key: 'rackUnitStart', label: 'Vị trí U' },
    { key: 'status', label: 'Trạng thái' }
  ];

  for (const [assetId, curAsset] of Object.entries(current.assets)) {
    const snapAsset = snapshot.assets[assetId];
    if (!snapAsset) continue;
    const changes: DetailedAssetFieldChange[] = [];
    for (const f of trackedFields) {
      const before = snapAsset[f.key] !== undefined && snapAsset[f.key] !== '' ? String(snapAsset[f.key]) : '—';
      const after = curAsset[f.key] !== undefined && curAsset[f.key] !== '' ? String(curAsset[f.key]) : '—';
      if (before !== after) {
        changes.push({ field: String(f.key), label: f.label, before, after });
      }
    }
    if (changes.length > 0) {
      modifiedAssets.push({
        assetId,
        name: curAsset.name || assetId,
        changes
      });
    }
  }

  return {
    summary,
    addedNodeLabels,
    removedNodeLabels,
    addedCableCodes,
    removedCableCodes,
    modifiedAssets
  };
}

/**
 * Exports all non-trashed projects in IndexedDB as a single workspace backup bundle.
 */
export async function exportAllProjectsBundle(): Promise<{
  bundleVersion: number;
  exportedAt: string;
  projects: ProjectState[];
}> {
  const db = await openDB();
  const records = await new Promise<StoredProjectRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    req.onsuccess = () => resolve((req.result || []) as StoredProjectRecord[]);
    req.onerror = () => reject(req.error);
  });
  return {
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    projects: records.filter(r => !r.isTrashed).map(r => r.data)
  };
}

/**
 * Synchronous deterministic dual FNV-1a 64-bit hex checksum over canonical project JSON
 * so recovery snapshots in localStorage detect truncation or tampering synchronously.
 */
export function computeProjectChecksum(project: ProjectState): string {
  const payload = JSON.stringify(project);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (code + (i & 0xff)) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `fnv1a-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export interface RecoverySnapshotEnvelope {
  __hachihiRecoveryEnvelope: true;
  envelopeVersion: number;
  schemaVersion: number;
  snapshotId: string;
  projectId: string;
  projectName: string;
  savedAt: string;
  reason: 'autosave' | 'manual' | 'crash_guard' | 'pre_switch';
  checksum: string;
  counts: {
    assets: number;
    nodes: number;
    racks: number;
    cables: number;
    floors: number;
  };
  project: ProjectState;
}

export type RecoveryInspectEntry =
  | { ok: true; envelope: RecoverySnapshotEnvelope; warnings: string[] }
  | { ok: false; error: string; rawId?: string; savedAt?: string; projectName?: string };

export function buildRecoveryEnvelope(
  project: ProjectState,
  reason: RecoverySnapshotEnvelope['reason'] = 'autosave'
): RecoverySnapshotEnvelope {
  const cloned = structuredClone(project);
  if (!cloned.schemaVersion) {
    cloned.schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  const savedAt = cloned.lastSavedAt || new Date().toISOString();
  return {
    __hachihiRecoveryEnvelope: true,
    envelopeVersion: RECOVERY_ENVELOPE_VERSION,
    schemaVersion: cloned.schemaVersion,
    snapshotId: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: cloned.id,
    projectName: cloned.name || 'HACHIHI Project',
    savedAt,
    reason,
    checksum: computeProjectChecksum(cloned),
    counts: {
      assets: Object.keys(cloned.assets || {}).length,
      nodes: (cloned.nodes || []).length,
      racks: (cloned.racks || []).length,
      cables: (cloned.cables || []).length,
      floors: (cloned.floors || []).length
    },
    project: cloned
  };
}

export function verifyRecoveryEnvelope(raw: unknown): {
  ok: true;
  envelope: RecoverySnapshotEnvelope;
  project: ProjectState;
  warnings: string[];
} | {
  ok: false;
  error: string;
} {
  if (!isPlainRecord(raw)) {
    return { ok: false, error: 'Dữ liệu bản sao lưu phục hồi không hợp lệ.' };
  }

  // Support verified envelope format
  if (raw.__hachihiRecoveryEnvelope === true) {
    if (!isPlainRecord(raw.project) || typeof raw.checksum !== 'string') {
      return { ok: false, error: 'Bản sao lưu phục hồi thiếu checksum hoặc dữ liệu dự án.' };
    }
    const rawProject = raw.project as unknown as ProjectState;
    const expectedChecksum = computeProjectChecksum(rawProject);
    if (expectedChecksum !== raw.checksum) {
      return {
        ok: false,
        error: 'Bản sao lưu phục hồi bị hỏng hoặc đã bị sửa đổi (checksum không khớp).'
      };
    }
    const migrated = migrateAndValidateProject(rawProject);
    if (!migrated.ok) {
      return { ok: false, error: migrated.error };
    }
    const env = raw as unknown as RecoverySnapshotEnvelope;
    return {
      ok: true,
      envelope: {
        ...env,
        counts: {
          assets: Object.keys(migrated.project.assets).length,
          nodes: migrated.project.nodes.length,
          racks: migrated.project.racks.length,
          cables: migrated.project.cables.length,
          floors: migrated.project.floors.length
        },
        project: migrated.project
      },
      project: migrated.project,
      warnings: migrated.warnings
    };
  }

  // Legacy un-enveloped ProjectState support
  const legacy = migrateAndValidateProject(raw);
  if (!legacy.ok) {
    return { ok: false, error: legacy.error };
  }
  const envelope = buildRecoveryEnvelope(legacy.project, 'autosave');
  return {
    ok: true,
    envelope,
    project: legacy.project,
    warnings: legacy.warnings
  };
}

function getStorageSafe(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export interface PreparedRecoveryEnvelopePayload {
  envelope: RecoverySnapshotEnvelope;
  serializedPrimary: string;
}

interface CachedRingEntry {
  projectId: string;
  checksum: string;
  json: string;
}

let cachedRingEntries: CachedRingEntry[] | null = null;
let lastWrittenRingRaw: string | null = null;

export function prepareRecoveryEnvelopePayload(
  project: ProjectState,
  reason: RecoverySnapshotEnvelope['reason'] = 'autosave'
): { ok: true; payload: PreparedRecoveryEnvelopePayload } | { ok: false; error: string } {
  const migrated = migrateAndValidateProject(project);
  if (!migrated.ok) {
    return { ok: false, error: migrated.error };
  }
  const envelope = buildRecoveryEnvelope(migrated.project, reason);
  const serializedPrimary = JSON.stringify(envelope);
  return {
    ok: true,
    payload: { envelope, serializedPrimary }
  };
}

export function commitPreparedRecoveryEnvelope(
  envelope: RecoverySnapshotEnvelope,
  serializedPrimary: string
): { ok: true; envelope: RecoverySnapshotEnvelope; skippedLocalStorageQuota?: boolean } | { ok: false; error: string } {
  const storage = getStorageSafe();
  if (!storage) {
    return { ok: false, error: 'Trình duyệt không hỗ trợ bộ nhớ cục bộ để ghi recovery snapshot.' };
  }

  // Large enterprise projects (>~3 MB UTF-16) already persist in IndexedDB; skip blocking localStorage quota overflow
  if (serializedPrimary.length > MAX_LOCALSTORAGE_RECOVERY_CHARS) {
    return { ok: true, envelope, skippedLocalStorageQuota: true };
  }

  let existingEntries: CachedRingEntry[] = [];
  try {
    const rawRing = storage.getItem(RECOVERY_SNAPSHOTS_KEY);
    if (rawRing && cachedRingEntries !== null && rawRing === lastWrittenRingRaw) {
      existingEntries = cachedRingEntries;
    } else if (rawRing) {
      const parsed: unknown = JSON.parse(rawRing);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const verified = verifyRecoveryEnvelope(item);
          if (verified.ok) {
            existingEntries.push({
              projectId: verified.envelope.projectId,
              checksum: verified.envelope.checksum,
              json: JSON.stringify(verified.envelope)
            });
          }
        }
      }
    }
  } catch {
    existingEntries = [];
  }

  const filtered = existingEntries.filter(
    e => !(e.projectId === envelope.projectId && e.checksum === envelope.checksum)
  );
  const nextRingEntries: CachedRingEntry[] = [
    { projectId: envelope.projectId, checksum: envelope.checksum, json: serializedPrimary },
    ...filtered
  ].slice(0, MAX_RECOVERY_SNAPSHOTS);

  try {
    storage.setItem(RECOVERY_STORAGE_KEY, serializedPrimary);
  } catch {
    try {
      storage.removeItem(RECOVERY_SNAPSHOTS_KEY);
      cachedRingEntries = null;
      lastWrittenRingRaw = null;
      storage.setItem(RECOVERY_STORAGE_KEY, serializedPrimary);
    } catch {
      return { ok: false, error: 'Bộ nhớ trình duyệt đã đầy, không thể ghi bản phục hồi khẩn cấp.' };
    }
  }

  for (let count = nextRingEntries.length; count >= 1; count--) {
    const slice = nextRingEntries.slice(0, count);
    const ringJson = `[${slice.map(entry => entry.json).join(',')}]`;
    try {
      storage.setItem(RECOVERY_SNAPSHOTS_KEY, ringJson);
      cachedRingEntries = slice;
      lastWrittenRingRaw = ringJson;
      break;
    } catch {
      if (count === 1) {
        // Primary recovery key is still saved
      }
    }
  }

  return { ok: true, envelope };
}

export function saveRecoverySnapshot(
  project: ProjectState,
  reason: RecoverySnapshotEnvelope['reason'] = 'autosave'
): { ok: true; envelope: RecoverySnapshotEnvelope; skippedLocalStorageQuota?: boolean } | { ok: false; error: string } {
  const storage = getStorageSafe();
  if (!storage) {
    return { ok: false, error: 'Trình duyệt không hỗ trợ bộ nhớ cục bộ để ghi recovery snapshot.' };
  }

  const prepared = prepareRecoveryEnvelopePayload(project, reason);
  if (!prepared.ok) {
    return prepared;
  }

  return commitPreparedRecoveryEnvelope(
    prepared.payload.envelope,
    prepared.payload.serializedPrimary
  );
}

export function listRecoverySnapshots(): RecoveryInspectEntry[] {
  const storage = getStorageSafe();
  if (!storage) return [];

  const entries: RecoveryInspectEntry[] = [];
  const seenChecksums = new Set<string>();

  try {
    const rawRing = storage.getItem(RECOVERY_SNAPSHOTS_KEY);
    if (rawRing) {
      const parsed: unknown = JSON.parse(rawRing);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const res = verifyRecoveryEnvelope(item);
          if (res.ok) {
            seenChecksums.add(`${res.envelope.projectId}:${res.envelope.checksum}`);
            entries.push({ ok: true, envelope: res.envelope, warnings: res.warnings });
          } else {
            const rec = isPlainRecord(item) ? item : {};
            entries.push({
              ok: false,
              error: res.error,
              rawId: typeof rec.snapshotId === 'string' ? rec.snapshotId : undefined,
              savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : undefined,
              projectName: typeof rec.projectName === 'string' ? rec.projectName : undefined
            });
          }
        }
      }
    }
  } catch {
    entries.push({ ok: false, error: 'Danh sách bản sao lưu phục hồi bị hỏng (JSON không hợp lệ).' });
  }

  try {
    const rawPrimary = storage.getItem(RECOVERY_STORAGE_KEY);
    if (rawPrimary) {
      const parsedPrimary: unknown = JSON.parse(rawPrimary);
      const res = verifyRecoveryEnvelope(parsedPrimary);
      if (res.ok) {
        const key = `${res.envelope.projectId}:${res.envelope.checksum}`;
        if (!seenChecksums.has(key)) {
          entries.unshift({ ok: true, envelope: res.envelope, warnings: res.warnings });
        }
      } else if (entries.length === 0) {
        entries.push({ ok: false, error: res.error });
      }
    }
  } catch {
    if (entries.length === 0) {
      entries.push({ ok: false, error: 'Bản sao lưu phục hồi chính bị hỏng (JSON không hợp lệ).' });
    }
  }

  return entries.slice(0, MAX_RECOVERY_SNAPSHOTS + 1);
}

export function loadLatestValidRecoverySnapshot(): {
  envelope: RecoverySnapshotEnvelope;
  project: ProjectState;
} | null {
  const entries = listRecoverySnapshots();
  for (const entry of entries) {
    if (entry.ok) {
      return { envelope: entry.envelope, project: entry.envelope.project };
    }
  }
  return null;
}

export function clearRecoverySnapshots(): void {
  cachedRingEntries = null;
  lastWrittenRingRaw = null;
  const storage = getStorageSafe();
  if (!storage) return;
  try {
    storage.removeItem(RECOVERY_SNAPSHOTS_KEY);
    storage.removeItem(RECOVERY_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

/**
 * Legacy localStorage helpers kept for migration & emergency recovery fallback.
 */
export function safeSaveToStorage(key: string, project: ProjectState): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function safeLoadFromStorage(key: string): ProjectState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const verified = verifyRecoveryEnvelope(parsed);
    return verified.ok ? verified.project : null;
  } catch {
    return null;
  }
}

/**
 * Validates and converts an uploaded device icon image (PNG/JPG/WebP/SVG) into
 * a safe, compact 96x96 PNG Data URL so scripts inside SVGs are stripped.
 */
export async function validateAndConvertIconImage(
  file: File
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, error: 'Định dạng ảnh không hỗ trợ. Chọn PNG, JPG, WebP hoặc SVG.' };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, error: 'Kích thước ảnh tối đa 2MB.' };
  }

  if (file.type === 'image/svg+xml') {
    try {
      const svgText = await file.text();
      if (!isSafeSvgContent(svgText)) {
        return { ok: false, error: 'Tệp SVG chứa thẻ hoặc đường dẫn không an toàn.' };
      }
    } catch {
      return { ok: false, error: 'Không thể đọc nội dung tệp SVG.' };
    }
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, error: 'Không thể đọc tệp hình ảnh.' });
    reader.onload = () => {
      const src = reader.result as string;
      const img = new window.Image();
      img.onerror = () => resolve({ ok: false, error: 'Hình ảnh bị hỏng hoặc không hợp lệ.' });
      img.onload = () => {
        try {
          const maxDim = 256;
          const canvas = document.createElement('canvas');
          canvas.width = maxDim;
          canvas.height = maxDim;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ ok: false, error: 'Trình duyệt không hỗ trợ xử lý ảnh.' });
            return;
          }
          const scale = Math.min(maxDim / (img.width || maxDim), maxDim / (img.height || maxDim));
          const w = (img.width || maxDim) * scale;
          const h = (img.height || maxDim) * scale;
          ctx.clearRect(0, 0, maxDim, maxDim);
          ctx.drawImage(img, (maxDim - w) / 2, (maxDim - h) / 2, w, h);
          const pngDataUrl = canvas.toDataURL('image/png', 0.9);
          resolve({ ok: true, dataUrl: pngDataUrl });
        } catch {
          resolve({ ok: false, error: 'Lỗi nén biểu tượng ảnh.' });
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
