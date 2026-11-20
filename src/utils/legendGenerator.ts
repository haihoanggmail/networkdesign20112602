import {
  CableType,
  DeviceCategory,
  ProjectState
} from '../types/infrastructure';
import { normalizeCableColor } from './cableRouting';

export interface LegendComponentEntry {
  key: string;
  label: string;
  subLabel: string;
  category: DeviceCategory | string;
  count: number;
  customIcon?: string;
  customImageUrl?: string;
  accentColor: string;
  totalWatts: number;
}

export interface LegendCableEntry {
  key: string;
  cableType: CableType;
  label: string;
  color: string;
  count: number;
  totalMeters: number;
}

export interface GeneratedLegendData {
  title: string;
  scope: 'all' | 'activeFloor';
  scopeLabel: string;
  totalDevices: number;
  totalCables: number;
  components: LegendComponentEntry[];
  cables: LegendCableEntry[];
}

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  core_switch: 'Core Switch',
  switch: 'Network Switch',
  router: 'Router / Gateway',
  gateway: 'Gateway',
  firewall: 'Firewall / Security',
  server: 'Server / Compute',
  storage: 'Storage / NAS',
  ap: 'Wi-Fi Access Point',
  camera: 'Camera CCTV',
  nvr: 'Đầu ghi NVR',
  odf: 'ODF Quang',
  patch_panel: 'Patch Panel',
  ups: 'Bộ lưu điện UPS',
  pdu: 'Thanh nguồn PDU',
  rack: 'Tủ Rack 19"',
  workstation: 'Máy trạm PC',
  printer: 'Máy in mạng',
  cloud: 'Internet / Cloud WAN',
  telecom_tower: 'Trục Riser / Cột sóng',
  electrical_panel: 'Tủ điện kỹ thuật',
  sensor: 'Cảm biến / Sensor',
  iot: 'Thiết bị IoT',
  device: 'Thiết bị mạng'
};

const CABLE_TYPE_LABELS: Record<CableType, string> = {
  CAT6_UTP: 'Cáp mạng Cat6 UTP',
  CAT6A_STP: 'Cáp mạng Cat6A STP',
  FIBER_SM_OS2: 'Cáp quang Single-mode OS2',
  FIBER_MM_OM4: 'Cáp quang Multi-mode OM4',
  DAC_10G: 'Cáp DAC 10G/40G',
  POWER_AC: 'Dây nguồn AC 220V'
};

export function buildProjectLegendData(
  project: ProjectState,
  options?: {
    scope?: 'all' | 'activeFloor';
    includeCables?: boolean;
    title?: string;
  }
): GeneratedLegendData {
  const scope: 'all' | 'activeFloor' = options?.scope || 'all';
  const includeCables = options?.includeCables ?? true;
  const activeFloor = project.floors.find(f => f.id === project.activeFloorId);

  const scopedNodes = project.nodes.filter(n => {
    if (n.type === 'legend' || n.type === 'text') return false;
    if (scope === 'activeFloor' && project.activeFloorId) {
      if (n.floorId && n.floorId !== project.activeFloorId) return false;
    }
    return true;
  });

  const componentMap = new Map<string, LegendComponentEntry>();

  for (const node of scopedNodes) {
    const asset = node.assetId ? project.assets[node.assetId] : undefined;
    const category = asset?.category || (node.type === 'rack' ? 'rack' : node.type);
    const resolvedIcon = node.customIcon || asset?.customIcon || '';
    const resolvedImage = node.customImageUrl || asset?.customImageUrl || '';
    const vendorModel = [asset?.vendor, asset?.model].filter(Boolean).join(' ').trim();
    const displayBase = CATEGORY_DISPLAY_NAMES[category] || category.toUpperCase();
    const accentColor = node.style?.backgroundColor || '#1d4ed8';

    // Group identical component types + visual symbols together
    const key = [
      category,
      vendorModel || displayBase,
      resolvedIcon,
      resolvedImage ? resolvedImage.slice(0, 48) : '',
      accentColor.toLowerCase()
    ].join('::');

    const existing = componentMap.get(key);
    const watts = asset?.powerWatts || 0;
    if (existing) {
      existing.count += 1;
      existing.totalWatts += watts;
    } else {
      componentMap.set(key, {
        key,
        label: displayBase,
        subLabel: vendorModel || (node.type === 'rack' ? `${node.customData?.totalUnits || 42}U Standard` : node.label),
        category,
        count: 1,
        customIcon: resolvedIcon || undefined,
        customImageUrl: resolvedImage || undefined,
        accentColor,
        totalWatts: watts
      });
    }
  }

  const components = Array.from(componentMap.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );

  const nodeIdSet = new Set(scopedNodes.map(n => n.id));
  const cableMap = new Map<string, LegendCableEntry>();
  let totalCables = 0;

  if (includeCables) {
    for (const cable of project.cables) {
      if (scope === 'activeFloor') {
        if (!nodeIdSet.has(cable.sourceNodeId) && !nodeIdSet.has(cable.targetNodeId)) {
          continue;
        }
      }
      totalCables += 1;
      const color = normalizeCableColor(cable.color || '#0284c7');
      const key = `${cable.cableType}::${color}`;
      const existing = cableMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.totalMeters = Number((existing.totalMeters + (cable.lengthMeters || 0)).toFixed(1));
      } else {
        cableMap.set(key, {
          key,
          cableType: cable.cableType,
          label: CABLE_TYPE_LABELS[cable.cableType] || cable.cableType,
          color,
          count: 1,
          totalMeters: Number((cable.lengthMeters || 0).toFixed(1))
        });
      }
    }
  }

  const cables = Array.from(cableMap.values()).sort((a, b) => b.count - a.count);
  const totalDevices = scopedNodes.length;

  return {
    title: options?.title?.trim() || 'BẢNG CHÚ GIẢI KÝ HIỆU THIẾT BỊ',
    scope,
    scopeLabel:
      scope === 'activeFloor'
        ? `Phạm vi: ${activeFloor?.name || 'Tầng đang chọn'}`
        : 'Phạm vi: Toàn bộ dự án',
    totalDevices,
    totalCables,
    components,
    cables
  };
}

export interface LegendLayoutMetrics {
  scale: number;
  columns: 1 | 2;
  isCompact: boolean;
}

export function computeLegendLayoutMetrics(
  width: number,
  height: number,
  componentCount: number,
  explicitScale?: number
): LegendLayoutMetrics {
  const autoScale = Math.min(1.65, Math.max(0.76, width / 340));
  const scale =
    typeof explicitScale === 'number' && Number.isFinite(explicitScale)
      ? Math.min(1.8, Math.max(0.7, explicitScale))
      : autoScale;
  const columns: 1 | 2 = width >= 540 && componentCount >= 4 ? 2 : 1;
  const isCompact = height < 200 || width < 270;
  return {
    scale: Math.round(scale * 100) / 100,
    columns,
    isCompact
  };
}

export function computeRecommendedLegendSize(data: GeneratedLegendData): {
  width: number;
  height: number;
} {
  const headerH = 56;
  const colHeadH = 26;
  const rowH = 34;
  const componentRows = Math.max(1, data.components.length);
  const cableSectionH =
    data.cables.length > 0 ? 30 + data.cables.length * 26 : 0;
  const footerH = 26;

  return {
    width: 340,
    height: Math.max(150, headerH + colHeadH + componentRows * rowH + cableSectionH + footerH + 12)
  };
}
