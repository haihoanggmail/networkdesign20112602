import {
  CableEdge,
  CableTray,
  CanvasLayerId,
  CanvasSettings,
  DiagramNode,
  DeviceAsset,
  ProjectState,
  Room,
  SelectionState
} from '../types/infrastructure';

export interface LayerCatalogEntry {
  id: CanvasLayerId;
  label: string;
  shortLabel: string;
  description: string;
  badgeColor?: string;
}

export const LAYER_CATALOG: LayerCatalogEntry[] = [
  {
    id: 'rooms',
    label: 'Phòng & Kiến trúc',
    shortLabel: 'Phòng',
    description: 'Khung phòng ban, khu vực kỹ thuật và kiến trúc sàn'
  },
  {
    id: 'trays',
    label: 'Máng cáp',
    shortLabel: 'Máng cáp',
    description: 'Hệ thống thang máng cáp và tuyến ống kỹ thuật'
  },
  {
    id: 'racks',
    label: 'Tủ Server Rack',
    shortLabel: 'Tủ Rack',
    description: 'Tủ rack 19 inch trên mặt bằng và sơ đồ'
  },
  {
    id: 'devices',
    label: 'Thiết bị chung',
    shortLabel: 'Thiết bị',
    description: 'Thiết bị chưa phân lớp hoặc đối tượng chú giải tổng hợp'
  },
  {
    id: 'network',
    label: 'Thiết bị Mạng (Network)',
    shortLabel: 'Network',
    badgeColor: '#2563eb',
    description: 'Switch, Core Switch, Router, Firewall, Server, NAS, ODF, Patch Panel'
  },
  {
    id: 'iot',
    label: 'IoT & Cảm biến / Không dây',
    shortLabel: 'IoT',
    badgeColor: '#059669',
    description: 'Cảm biến IoT, IoT Gateway, Wi-Fi AP, Camera CCTV & Đầu ghi NVR'
  },
  {
    id: 'electrical',
    label: 'Nguồn & Điện (Electrical)',
    shortLabel: 'Electrical',
    badgeColor: '#d97706',
    description: 'UPS, Thanh nguồn PDU, Tủ điện MDB/DB & Hệ thống nguồn dự phòng'
  },
  {
    id: 'cables',
    label: 'Dây cáp kết nối',
    shortLabel: 'Dây cáp',
    description: 'Các tuyến cáp đồng, cáp quang và đường kết nối'
  },
  {
    id: 'cable_labels',
    label: 'Lớp nhãn dây cáp',
    shortLabel: 'Nhãn cáp',
    description: 'Mã tuyến cáp TIA-606 và nhãn ghi chú dọc theo dây'
  },
  {
    id: 'wifi',
    label: 'Phủ sóng Wi-Fi',
    shortLabel: 'Wi-Fi',
    description: 'Vùng phủ sóng 2.4/5GHz xung quanh Access Point'
  },
  {
    id: 'fov',
    label: 'Góc Camera FOV',
    shortLabel: 'FOV Camera',
    description: 'Nón góc quan sát và tầm nhìn của Camera CCTV'
  },
  {
    id: 'labels',
    label: 'Nhãn IP & Chú thích',
    shortLabel: 'Nhãn IP',
    description: 'Địa chỉ IP, VLAN và nhãn chú thích văn bản'
  }
];

const VALID_LAYER_ID_SET = new Set<CanvasLayerId>(LAYER_CATALOG.map(l => l.id));

export function isValidCanvasLayerId(value: unknown): value is CanvasLayerId {
  return typeof value === 'string' && VALID_LAYER_ID_SET.has(value as CanvasLayerId);
}

export function getHiddenLayerSet(settings?: Partial<CanvasSettings>): Set<CanvasLayerId> {
  return new Set<CanvasLayerId>(settings?.hiddenLayers || []);
}

export function getLockedLayerSet(settings?: Partial<CanvasSettings>): Set<CanvasLayerId> {
  return new Set<CanvasLayerId>(settings?.lockedLayers || []);
}

export function isLayerHidden(settings: Partial<CanvasSettings> | undefined, layerId: CanvasLayerId): boolean {
  return Boolean(settings?.hiddenLayers?.includes(layerId));
}

export function isLayerLocked(settings: Partial<CanvasSettings> | undefined, layerId: CanvasLayerId): boolean {
  return Boolean(settings?.lockedLayers?.includes(layerId));
}

const ELECTRICAL_CATEGORIES = new Set(['ups', 'pdu', 'electrical_panel']);
const IOT_CATEGORIES = new Set(['sensor', 'iot', 'ap', 'camera', 'nvr']);
const NETWORK_CATEGORIES = new Set([
  'core_switch',
  'switch',
  'router',
  'firewall',
  'gateway',
  'server',
  'storage',
  'odf',
  'patch_panel',
  'workstation',
  'printer',
  'cloud',
  'telecom_tower'
]);

/**
 * Classifies the target layer for Auto-Layering based on device type/category & metadata.
 */
export function classifyDeviceLayer(
  node: Pick<DiagramNode, 'type' | 'assetId' | 'label'>,
  assets?: Record<string, DeviceAsset>
): CanvasLayerId {
  if (node.type === 'rack') return 'racks';
  if (node.type === 'text') return 'labels';
  if (node.type === 'legend' || node.type === 'zone') return 'devices';

  const asset = node.assetId ? assets?.[node.assetId] : undefined;
  const category = asset?.category;

  if (category === 'rack') return 'racks';
  if (category && ELECTRICAL_CATEGORIES.has(category)) return 'electrical';
  if (category && IOT_CATEGORIES.has(category)) return 'iot';
  if (category && NETWORK_CATEGORIES.has(category)) return 'network';

  // Keyword heuristics for custom/cloud/telecom nodes or imported text categories
  const hint = `${node.label || ''} ${asset?.name || ''} ${asset?.model || ''}`.toLowerCase();
  if (/\b(ups|pdu|power|mdb|ats|generator|ắc quy|tủ điện|nguồn)\b/i.test(hint)) {
    return 'electrical';
  }
  if (/\b(sensor|cảm biến|iot|zigbee|mqtt|lora|camera|cam|nvr|wifi|wi-fi|access point|\bap\b)\b/i.test(hint)) {
    return 'iot';
  }
  if (node.type === 'cloud' || node.type === 'telecom_tower') {
    return 'network';
  }

  return 'network';
}

export interface AutoLayeringSummary {
  updatedCount: number;
  totalProcessed: number;
  counts: {
    network: number;
    iot: number;
    electrical: number;
    racks: number;
    labels: number;
    devices: number;
  };
}

export function computeAutoLayeringPlan(project: ProjectState): {
  nodes: DiagramNode[];
  summary: AutoLayeringSummary;
} {
  let updatedCount = 0;
  let totalProcessed = 0;
  const counts = {
    network: 0,
    iot: 0,
    electrical: 0,
    racks: 0,
    labels: 0,
    devices: 0
  };

  const nextNodes = (project.nodes || []).map(node => {
    totalProcessed += 1;
    const targetLayer = classifyDeviceLayer(node, project.assets);
    if (targetLayer === 'network') counts.network += 1;
    else if (targetLayer === 'iot') counts.iot += 1;
    else if (targetLayer === 'electrical') counts.electrical += 1;
    else if (targetLayer === 'racks') counts.racks += 1;
    else if (targetLayer === 'labels') counts.labels += 1;
    else counts.devices += 1;

    if (node.layerId !== targetLayer) {
      updatedCount += 1;
      return { ...node, layerId: targetLayer };
    }
    return node;
  });

  return {
    nodes: nextNodes,
    summary: {
      updatedCount,
      totalProcessed,
      counts
    }
  };
}

export function resolveNodeLayer(
  node: Pick<DiagramNode, 'type' | 'assetId' | 'layerId'>,
  assets?: Record<string, DeviceAsset>
): CanvasLayerId {
  if (node.type === 'rack') return 'racks';
  if (node.type === 'text') return 'labels';
  if (node.assetId && assets?.[node.assetId]?.category === 'rack') return 'racks';
  if (node.layerId && isValidCanvasLayerId(node.layerId)) {
    return node.layerId;
  }
  return 'devices';
}

export function isNodePositionLocked(
  node: Pick<DiagramNode, 'locked' | 'customData'>
): boolean {
  return Boolean(node.locked || node.customData?.locked === true);
}

export function isNodeEffectivelyLocked(
  node: Pick<DiagramNode, 'type' | 'assetId' | 'locked' | 'layerId' | 'customData'>,
  settings: Partial<CanvasSettings> | undefined,
  assets?: Record<string, DeviceAsset>,
  isReadOnlyMode = false
): boolean {
  if (isReadOnlyMode || isNodePositionLocked(node)) return true;
  const layer = resolveNodeLayer(node, assets);
  return isLayerLocked(settings, layer);
}

export function canDragNodeIn3DScene(
  node: Pick<DiagramNode, 'type' | 'assetId' | 'locked' | 'layerId' | 'customData'>,
  settings: Partial<CanvasSettings> | undefined,
  assets: Record<string, DeviceAsset> | undefined,
  options: { isReadOnlyMode?: boolean; isSceneDragLocked?: boolean } = {}
): boolean {
  if (options.isSceneDragLocked ?? true) return false;
  return !isNodeEffectivelyLocked(node, settings, assets, Boolean(options.isReadOnlyMode));
}

export function canInsertIn3DScene(
  options: {
    is3DView?: boolean;
    isSceneDragLocked?: boolean;
    isReadOnlyMode?: boolean;
  } = {}
): boolean {
  if (options.isReadOnlyMode) return false;
  if (options.is3DView) {
    return !(options.isSceneDragLocked ?? true);
  }
  return true;
}

export function isRoomEffectivelyLocked(
  room: Pick<Room, 'locked'>,
  settings: Partial<CanvasSettings> | undefined,
  isReadOnlyMode = false
): boolean {
  if (isReadOnlyMode || room.locked) return true;
  return isLayerLocked(settings, 'rooms');
}

export function isCableEffectivelyLocked(
  _cable: Pick<CableEdge, 'id'>,
  settings: Partial<CanvasSettings> | undefined,
  isReadOnlyMode = false
): boolean {
  if (isReadOnlyMode) return true;
  return isLayerLocked(settings, 'cables');
}

export function isTrayEffectivelyLocked(
  tray: Pick<CableTray, 'id'> & { locked?: boolean },
  settings: Partial<CanvasSettings> | undefined,
  isReadOnlyMode = false
): boolean {
  if (isReadOnlyMode || tray.locked) return true;
  return isLayerLocked(settings, 'trays');
}

export function isCableLabelEffectivelyLocked(
  settings: Partial<CanvasSettings> | undefined,
  isReadOnlyMode = false
): boolean {
  if (isReadOnlyMode) return true;
  return isLayerLocked(settings, 'cable_labels') || isLayerLocked(settings, 'cables');
}

export function getLayerLockReason(layerId: CanvasLayerId): string {
  const entry = LAYER_CATALOG.find(item => item.id === layerId);
  return entry ? `Lớp "${entry.label}" đang bị khóa.` : 'Lớp hiện tại đang bị khóa.';
}

export function computeLayerObjectCounts(
  project: ProjectState,
  floorId?: string
): Record<CanvasLayerId, number> {
  const counts: Record<CanvasLayerId, number> = {
    rooms: 0,
    trays: 0,
    racks: 0,
    devices: 0,
    network: 0,
    iot: 0,
    electrical: 0,
    cables: 0,
    cable_labels: 0,
    wifi: 0,
    fov: 0,
    labels: 0
  };

  const filterByFloor =
    Boolean(floorId) && ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);

  const visibleNodeIds = new Set<string>();
  for (const room of project.rooms || []) {
    if (filterByFloor && room.floorId && room.floorId !== floorId) continue;
    counts.rooms += 1;
  }

  for (const tray of project.cableTrays || []) {
    if (filterByFloor && tray.floorId && tray.floorId !== floorId) continue;
    counts.trays += 1;
  }

  for (const node of project.nodes || []) {
    if (node.hidden) continue;
    if (filterByFloor && node.floorId && node.floorId !== floorId) continue;
    if (project.activeMode === 'rack' && node.diagramMode !== 'rack' && node.type !== 'rack') continue;
    visibleNodeIds.add(node.id);

    const layer = resolveNodeLayer(node, project.assets);
    if (layer === 'racks') {
      counts.racks += 1;
    } else if (layer === 'labels') {
      counts.labels += 1;
    } else {
      if (layer === 'network') counts.network += 1;
      else if (layer === 'iot') counts.iot += 1;
      else if (layer === 'electrical') counts.electrical += 1;
      else counts.devices += 1;

      const asset = node.assetId ? project.assets?.[node.assetId] : undefined;
      if (asset?.category === 'ap' || typeof node.customData?.coverageRadiusMeters === 'number') {
        counts.wifi += 1;
      }
      if (asset?.category === 'camera') counts.fov += 1;
      if (asset?.ipAddress || asset?.vlan) counts.labels += 1;
    }
  }

  for (const cable of project.cables || []) {
    if (!visibleNodeIds.has(cable.sourceNodeId) || !visibleNodeIds.has(cable.targetNodeId)) continue;
    counts.cables += 1;
    if (cable.cableCode || (cable.label && cable.label.trim().length > 0)) {
      counts.cable_labels += 1;
    }
  }

  return counts;
}

function toNodeSelection(ids: string[]): SelectionState {
  if (ids.length === 0) return { type: 'none' };
  if (ids.length === 1) return { type: 'node', id: ids[0] };
  return { type: 'node', id: ids[0], additionalIds: ids.slice(1) };
}

/**
 * Single shared resolver for selecting all visible objects belonging to a design layer.
 * Used by both DesignCanvas HUD and PropertiesPanel / ProjectSettingsInspector.
 */
export function resolveSelectableTargetForLayer(
  project: ProjectState,
  layerId: CanvasLayerId
): SelectionState {
  const hiddenLayerSet = getHiddenLayerSet(project.settings);
  const filterByFloor = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);

  const visibleNodes = (project.nodes || []).filter(n => {
    if (n.hidden) return false;
    if (filterByFloor && n.floorId && project.activeFloorId && n.floorId !== project.activeFloorId) {
      return false;
    }
    if (project.activeMode === 'rack') {
      return n.diagramMode === 'rack' || n.type === 'rack';
    }
    return true;
  });

  const isRackNode = (n: DiagramNode) =>
    n.type === 'rack' || Boolean(n.assetId && project.assets?.[n.assetId]?.category === 'rack');

  const visibleRackNodes = hiddenLayerSet.has('racks')
    ? []
    : visibleNodes.filter(isRackNode);

  const visibleDeviceNodes = visibleNodes.filter(n => {
    if (isRackNode(n)) return false;
    const layer = resolveNodeLayer(n, project.assets);
    return !hiddenLayerSet.has(layer);
  });

  if (layerId === 'racks') {
    return toNodeSelection(visibleRackNodes.map(n => n.id));
  }

  if (layerId === 'devices' || layerId === 'network' || layerId === 'iot' || layerId === 'electrical') {
    const ids = visibleDeviceNodes
      .filter(n => n.type !== 'text' && resolveNodeLayer(n, project.assets) === layerId)
      .map(n => n.id);
    return toNodeSelection(ids);
  }

  if (layerId === 'wifi') {
    const ids = visibleDeviceNodes
      .filter(
        n =>
          (n.assetId && project.assets?.[n.assetId]?.category === 'ap') ||
          typeof n.customData?.coverageRadiusMeters === 'number'
      )
      .map(n => n.id);
    return toNodeSelection(ids);
  }

  if (layerId === 'fov') {
    const ids = visibleDeviceNodes
      .filter(n => n.assetId && project.assets?.[n.assetId]?.category === 'camera')
      .map(n => n.id);
    return toNodeSelection(ids);
  }

  if (layerId === 'labels') {
    const ids = visibleDeviceNodes.filter(n => n.type === 'text').map(n => n.id);
    return toNodeSelection(ids);
  }

  if (layerId === 'rooms') {
    if (hiddenLayerSet.has('rooms')) return { type: 'none' };
    const visibleRooms = (project.rooms || []).filter(r => {
      if (filterByFloor && r.floorId && project.activeFloorId && r.floorId !== project.activeFloorId) {
        return false;
      }
      return true;
    });
    return visibleRooms.length > 0 ? { type: 'room', id: visibleRooms[0].id } : { type: 'none' };
  }

  if (layerId === 'trays') {
    if (hiddenLayerSet.has('trays')) return { type: 'none' };
    const visibleTrays = (project.cableTrays || []).filter(t => {
      if (filterByFloor && t.floorId && project.activeFloorId && t.floorId !== project.activeFloorId) {
        return false;
      }
      return true;
    });
    return visibleTrays.length > 0 ? { type: 'tray', id: visibleTrays[0].id } : { type: 'none' };
  }

  if (layerId === 'cables' || layerId === 'cable_labels') {
    if (hiddenLayerSet.has('cables')) return { type: 'none' };
    const visibleNodeIdSet = new Set(visibleNodes.map(n => n.id));
    const visibleRackIdSet = new Set(
      visibleRackNodes
        .map(rn => {
          const asset = rn.assetId ? project.assets?.[rn.assetId] : undefined;
          const rack = (project.racks || []).find(
            r =>
              r.id === rn.customData?.rackId ||
              r.id === rn.id ||
              (asset && r.id === asset.id) ||
              r.name === rn.label
          );
          return rack?.id;
        })
        .filter((id): id is string => Boolean(id))
    );
    const nodeById = new Map((project.nodes || []).map(n => [n.id, n]));
    const isEndpointVisible = (nodeId: string): boolean => {
      if (visibleNodeIdSet.has(nodeId)) return true;
      const node = nodeById.get(nodeId);
      const asset = node?.assetId ? project.assets?.[node.assetId] : undefined;
      return Boolean(asset?.rackId && asset.rackUnitStart && visibleRackIdSet.has(asset.rackId));
    };

    const visibleCables = (project.cables || []).filter(
      c => isEndpointVisible(c.sourceNodeId) && isEndpointVisible(c.targetNodeId)
    );
    return visibleCables.length > 0 ? { type: 'edge', id: visibleCables[0].id } : { type: 'none' };
  }

  return { type: 'none' };
}
