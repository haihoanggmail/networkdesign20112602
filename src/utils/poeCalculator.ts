import {
  DeviceAsset,
  DeviceCategory,
  ProjectState
} from '../types/infrastructure';

export type PoeStandardId = '802.3af' | '802.3at' | '802.3bt-3' | '802.3bt-4';

export type PoeBudgetStatus = 'idle' | 'nominal' | 'warning' | 'overload' | 'no_pse';

export type PoeWattSource = 'asset_poe_watts' | 'port_poe_watts' | 'device_power' | 'default';

export interface PoeDeviceBreakdownItem {
  assetId: string;
  nodeId?: string;
  name: string;
  category: DeviceCategory;
  categoryLabel: string;
  model: string;
  ipAddress: string;
  watts: number;
  poePortCount: number;
  poeStandard: PoeStandardId;
  poeStandardLabel: string;
  source: PoeWattSource;
  status: DeviceAsset['status'];
}

export interface PoePseBreakdownItem {
  assetId: string;
  nodeId?: string;
  name: string;
  model: string;
  budgetWatts: number;
  poePortCount: number;
}

export interface PoeCategorySummary {
  key: 'camera' | 'ap' | 'other';
  label: string;
  count: number;
  totalWatts: number;
  percentage: number;
}

export interface ProjectPoeSummary {
  totalPoeWatts: number;
  poweredDeviceCount: number;
  totalPoeBudgetWatts: number;
  pseDeviceCount: number;
  headroomWatts: number;
  utilizationPct: number | null;
  status: PoeBudgetStatus;
  byCategory: PoeCategorySummary[];
  devices: PoeDeviceBreakdownItem[];
  pseDevices: PoePseBreakdownItem[];
}

const PASSIVE_OR_NON_PD_CATEGORIES = new Set<DeviceCategory>([
  'rack',
  'ups',
  'pdu',
  'electrical_panel',
  'cloud',
  'telecom_tower',
  'odf',
  'patch_panel'
]);

const PSE_CANDIDATE_CATEGORIES = new Set<DeviceCategory>([
  'switch',
  'core_switch',
  'nvr'
]);

function roundWatts(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 10) / 10;
}

export function getPoeCategoryLabel(category: DeviceCategory): string {
  switch (category) {
    case 'camera':
      return 'Camera IP';
    case 'ap':
      return 'Wi-Fi AP';
    case 'workstation':
      return 'Máy trạm / VoIP';
    case 'printer':
      return 'Máy in mạng';
    case 'router':
      return 'Router';
    case 'gateway':
      return 'Gateway';
    case 'firewall':
      return 'Firewall';
    case 'switch':
    case 'core_switch':
      return 'Switch PoE (PD)';
    default:
      return 'Thiết bị PoE';
  }
}

export function isPseCategoryCandidate(category: DeviceCategory): boolean {
  return PSE_CANDIDATE_CATEGORIES.has(category);
}

export type PoeDeviceRole = 'auto' | 'pse' | 'pd' | 'none';

export function resolvePoeDeviceRole(asset: DeviceAsset): 'pse' | 'pd' | 'none' {
  if (PASSIVE_OR_NON_PD_CATEGORIES.has(asset.category)) return 'none';
  if (asset.poeRole === 'none') return 'none';
  if (asset.poeRole === 'pse') return 'pse';
  if (asset.poeRole === 'pd') return 'pd';

  // Legacy 'auto' / undefined compatibility
  if (asset.poeEnabled === true) return 'pd';
  const poePortCount = (asset.ports || []).filter(p => p.poe === true).length;

  if (PSE_CANDIDATE_CATEGORIES.has(asset.category)) {
    if (typeof asset.poeBudgetWatts === 'number' && asset.poeBudgetWatts > 0) {
      return 'pse';
    }
    if (poePortCount > 0) return 'pse';
  }

  if (asset.category === 'router' || asset.category === 'gateway') {
    if (typeof asset.poeBudgetWatts === 'number' && asset.poeBudgetWatts > 0) {
      return 'pse';
    }
    if (poePortCount >= 2) return 'pse';
  }

  if (asset.poeEnabled === false) return 'none';
  if (typeof asset.poeWatts === 'number' && asset.poeWatts > 0) return 'pd';

  const hasPoePort = (asset.ports || []).some(
    p => p.poe === true || (typeof p.poeWatts === 'number' && p.poeWatts > 0)
  );
  if (hasPoePort) return 'pd';
  if (asset.category === 'camera' || asset.category === 'ap') return 'pd';

  return 'none';
}

/**
 * Determines whether a network device acts as Power Sourcing Equipment (PSE),
 * e.g. a PoE Access Switch or a PoE NVR with built-in PoE ports.
 */
export function isPseDevice(asset: DeviceAsset): boolean {
  return resolvePoeDeviceRole(asset) === 'pse';
}

/**
 * Computes the available PoE supply budget (in Watts) for a PSE device.
 */
export function resolvePseBudgetWatts(asset: DeviceAsset): number {
  if (typeof asset.poeBudgetWatts === 'number' && Number.isFinite(asset.poeBudgetWatts)) {
    return roundWatts(Math.max(0, asset.poeBudgetWatts));
  }

  const poePorts = (asset.ports || []).filter(p => p.poe === true);
  const explicitPortWattsSum = poePorts.reduce(
    (sum, p) => sum + (typeof p.poeWatts === 'number' && p.poeWatts > 0 ? p.poeWatts : 0),
    0
  );
  if (explicitPortWattsSum > 0) {
    return roundWatts(explicitPortWattsSum);
  }

  const ratedWatts = typeof asset.powerWatts === 'number' && asset.powerWatts > 0 ? asset.powerWatts : 0;
  if (asset.category === 'nvr') {
    // NVRs allocate a portion of system power to built-in PoE camera ports
    return ratedWatts > 0 ? Math.round(ratedWatts * 0.6) : poePorts.length * 15;
  }

  if (ratedWatts > 0) {
    return roundWatts(ratedWatts);
  }

  return poePorts.length * 15;
}

/**
 * Determines whether a device consumes PoE power (PD — Powered Device).
 */
export function isPoeConsumerDevice(asset: DeviceAsset): boolean {
  return resolvePoeDeviceRole(asset) === 'pd';
}

/**
 * Resolves PoE consumption in Watts for a Powered Device (PD)
 * from its explicit PoE attribute, PoE ports, device power rating, or IEEE standard fallback.
 */
export function resolveDevicePoeWatts(asset: DeviceAsset): {
  watts: number;
  source: PoeWattSource;
  poePortCount: number;
} {
  const poePorts = (asset.ports || []).filter(
    p => p.poe === true || (typeof p.poeWatts === 'number' && p.poeWatts > 0)
  );
  const poePortCount = Math.max(poePorts.length, 1);

  if (typeof asset.poeWatts === 'number' && Number.isFinite(asset.poeWatts) && asset.poeWatts >= 0) {
    return {
      watts: roundWatts(asset.poeWatts),
      source: 'asset_poe_watts',
      poePortCount
    };
  }

  const portWattsSum = (asset.ports || []).reduce((sum, port) => {
    if (port.poe === false) return sum;
    if (typeof port.poeWatts === 'number' && port.poeWatts > 0) {
      return sum + port.poeWatts;
    }
    return sum;
  }, 0);

  if (portWattsSum > 0) {
    return {
      watts: roundWatts(portWattsSum),
      source: 'port_poe_watts',
      poePortCount
    };
  }

  if (typeof asset.powerWatts === 'number' && asset.powerWatts > 0) {
    return {
      watts: roundWatts(asset.powerWatts),
      source: 'device_power',
      poePortCount
    };
  }

  const defaultWatts = asset.category === 'ap' ? 18 : asset.category === 'camera' ? 12 : 15;
  return {
    watts: defaultWatts,
    source: 'default',
    poePortCount
  };
}

export function classifyPoeStandard(watts: number): {
  id: PoeStandardId;
  label: string;
} {
  if (watts <= 15.4) {
    return { id: '802.3af', label: '802.3af' };
  }
  if (watts <= 30) {
    return { id: '802.3at', label: '802.3at+' };
  }
  if (watts <= 60) {
    return { id: '802.3bt-3', label: '802.3bt' };
  }
  return { id: '802.3bt-4', label: '802.3bt+' };
}

/**
 * Collects active DeviceAssets currently present in canvas nodes or mounted in racks.
 */
export function getActiveProjectAssets(project: ProjectState): {
  assets: DeviceAsset[];
  nodeIdByAssetId: Map<string, string>;
} {
  const activeIds = new Set<string>();
  const nodeIdByAssetId = new Map<string, string>();

  for (const node of project.nodes) {
    if (!node.assetId) continue;
    activeIds.add(node.assetId);
    if (!nodeIdByAssetId.has(node.assetId)) {
      nodeIdByAssetId.set(node.assetId, node.id);
    }
  }

  for (const rack of project.racks) {
    for (const assetId of Object.values(rack.slots || {})) {
      if (assetId) activeIds.add(assetId);
    }
    for (const assetId of Object.values(rack.rearSlots || {})) {
      if (assetId) activeIds.add(assetId);
    }
  }

  const assets: DeviceAsset[] = [];
  for (const assetId of activeIds) {
    const asset = project.assets[assetId];
    if (asset) assets.push(asset);
  }

  return { assets, nodeIdByAssetId };
}

export function computeAssetsPoeSummary(
  assets: DeviceAsset[],
  nodeIdByAssetId?: Map<string, string>
): ProjectPoeSummary {
  const devices: PoeDeviceBreakdownItem[] = [];
  const pseDevices: PoePseBreakdownItem[] = [];

  for (const asset of assets) {
    if (isPseDevice(asset)) {
      const budgetWatts = resolvePseBudgetWatts(asset);
      const poePortCount = (asset.ports || []).filter(p => p.poe === true).length;
      pseDevices.push({
        assetId: asset.id,
        nodeId: nodeIdByAssetId?.get(asset.id),
        name: asset.name,
        model: asset.model,
        budgetWatts,
        poePortCount
      });
      continue;
    }

    if (isPoeConsumerDevice(asset)) {
      const resolved = resolveDevicePoeWatts(asset);
      const std = classifyPoeStandard(resolved.watts);
      devices.push({
        assetId: asset.id,
        nodeId: nodeIdByAssetId?.get(asset.id),
        name: asset.name,
        category: asset.category,
        categoryLabel: getPoeCategoryLabel(asset.category),
        model: asset.model,
        ipAddress: asset.ipAddress || '',
        watts: resolved.watts,
        poePortCount: resolved.poePortCount,
        poeStandard: std.id,
        poeStandardLabel: std.label,
        source: resolved.source,
        status: asset.status
      });
    }
  }

  devices.sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name, 'vi'));
  pseDevices.sort((a, b) => b.budgetWatts - a.budgetWatts || a.name.localeCompare(b.name, 'vi'));

  const totalPoeWatts = roundWatts(devices.reduce((sum, d) => sum + d.watts, 0));
  const totalPoeBudgetWatts = roundWatts(pseDevices.reduce((sum, p) => sum + p.budgetWatts, 0));
  const rawHeadroom = totalPoeBudgetWatts - totalPoeWatts;
  const headroomWatts = Number.isFinite(rawHeadroom) ? Math.round(rawHeadroom * 10) / 10 : 0;
  const utilizationPct =
    totalPoeBudgetWatts > 0 ? Math.round((totalPoeWatts / totalPoeBudgetWatts) * 100) : null;

  let status: PoeBudgetStatus = 'nominal';
  if (totalPoeWatts === 0) {
    status = 'idle';
  } else if (totalPoeBudgetWatts === 0) {
    status = 'no_pse';
  } else if (totalPoeWatts > totalPoeBudgetWatts) {
    status = 'overload';
  } else if (utilizationPct !== null && utilizationPct >= 80) {
    status = 'warning';
  }

  const bucketMap: Record<'camera' | 'ap' | 'other', { label: string; count: number; totalWatts: number }> = {
    camera: { label: 'Camera IP / CCTV', count: 0, totalWatts: 0 },
    ap: { label: 'Bộ phát Wi-Fi (AP)', count: 0, totalWatts: 0 },
    other: { label: 'Thiết bị PoE khác', count: 0, totalWatts: 0 }
  };

  for (const item of devices) {
    const key = item.category === 'camera' ? 'camera' : item.category === 'ap' ? 'ap' : 'other';
    bucketMap[key].count += 1;
    bucketMap[key].totalWatts = roundWatts(bucketMap[key].totalWatts + item.watts);
  }

  const byCategory: PoeCategorySummary[] = (Object.entries(bucketMap) as Array<
    ['camera' | 'ap' | 'other', { label: string; count: number; totalWatts: number }]
  >)
    .filter(([, val]) => val.count > 0)
    .map(([key, val]) => ({
      key,
      label: val.label,
      count: val.count,
      totalWatts: val.totalWatts,
      percentage: totalPoeWatts > 0 ? Math.round((val.totalWatts / totalPoeWatts) * 100) : 0
    }))
    .sort((a, b) => b.totalWatts - a.totalWatts);

  return {
    totalPoeWatts,
    poweredDeviceCount: devices.length,
    totalPoeBudgetWatts,
    pseDeviceCount: pseDevices.length,
    headroomWatts,
    utilizationPct,
    status,
    byCategory,
    devices,
    pseDevices
  };
}

export interface SwitchConnectedPdItem {
  assetId: string;
  nodeId?: string;
  name: string;
  categoryLabel: string;
  poeStandardLabel: string;
  watts: number;
}

export interface SwitchPoeBreakdownItem {
  assetId: string;
  nodeId?: string;
  name: string;
  shortName: string;
  model: string;
  category: DeviceCategory;
  isPse: boolean;
  consumedWatts: number;
  budgetWatts: number;
  headroomWatts: number;
  utilizationPct: number | null;
  status: PoeBudgetStatus;
  poePortCount: number;
  connectedPds: SwitchConnectedPdItem[];
}

export interface SwitchPoeVisualizationSummary {
  switches: SwitchPoeBreakdownItem[];
  unassignedPds: SwitchConnectedPdItem[];
  unassignedWatts: number;
  totalConsumedWatts: number;
  totalBudgetWatts: number;
}

const PASSIVE_PASSTHROUGH_CATEGORIES = new Set<DeviceCategory>(['patch_panel', 'odf']);

function formatSwitchShortName(name: string, maxLen = 14): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

/**
 * Computes per-switch (and PoE PSE) power consumption vs allowed PoE budget
 * by tracing cable links (including through passive patch panels / ODF / risers).
 */
export function computeSwitchPoeBreakdown(project: ProjectState): SwitchPoeVisualizationSummary {
  const nodeById = new Map(project.nodes.map(n => [n.id, n]));
  const nodeIdsByAssetId = new Map<string, string[]>();

  for (const node of project.nodes) {
    if (!node.assetId) continue;
    const list = nodeIdsByAssetId.get(node.assetId) || [];
    list.push(node.id);
    nodeIdsByAssetId.set(node.assetId, list);
  }

  const { assets, nodeIdByAssetId } = getActiveProjectAssets(project);

  // Collect switches & active PSE devices (include all switches/core_switches + any PSE NVR/gateway)
  const switchAssetMap = new Map<string, DeviceAsset>();
  for (const asset of assets) {
    if (
      isPseDevice(asset) ||
      asset.category === 'switch' ||
      asset.category === 'core_switch'
    ) {
      switchAssetMap.set(asset.id, asset);
    }
  }

  // Build undirected adjacency across diagram nodes from project cables
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    let setA = adjacency.get(a);
    if (!setA) {
      setA = new Set<string>();
      adjacency.set(a, setA);
    }
    setA.add(b);
  };

  for (const cable of project.cables) {
    addEdge(cable.sourceNodeId, cable.targetNodeId);
    addEdge(cable.targetNodeId, cable.sourceNodeId);
  }

  // Also incorporate explicit port.connectedTarget links where assetIds map to nodes
  for (const asset of assets) {
    const srcNodes = nodeIdsByAssetId.get(asset.id);
    if (!srcNodes || srcNodes.length === 0) continue;
    for (const port of asset.ports || []) {
      const targetDevId = port.connectedTarget?.deviceId;
      if (!targetDevId) continue;
      const tgtNodes = nodeIdsByAssetId.get(targetDevId);
      if (!tgtNodes || tgtNodes.length === 0) continue;
      addEdge(srcNodes[0], tgtNodes[0]);
      addEdge(tgtNodes[0], srcNodes[0]);
    }
  }

  // Helper: BFS from a PD node through passive pass-through nodes to locate serving switch/PSE asset
  const findServingSwitchAssetId = (startNodeId: string): string | null => {
    const visited = new Set<string>([startNodeId]);
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= 4) continue;
      const neighbors = adjacency.get(current.nodeId);
      if (!neighbors) continue;

      for (const nextNodeId of neighbors) {
        if (visited.has(nextNodeId)) continue;
        visited.add(nextNodeId);
        const nextNode = nodeById.get(nextNodeId);
        if (!nextNode) continue;

        if (nextNode.assetId && switchAssetMap.has(nextNode.assetId)) {
          return nextNode.assetId;
        }

        const nextAsset = nextNode.assetId ? project.assets[nextNode.assetId] : undefined;
        const isPassthrough =
          nextNode.type === 'riser' ||
          (nextAsset && PASSIVE_PASSTHROUGH_CATEGORIES.has(nextAsset.category));

        if (isPassthrough) {
          queue.push({ nodeId: nextNodeId, depth: current.depth + 1 });
        }
      }
    }

    return null;
  };

  const pdsBySwitchId = new Map<string, SwitchConnectedPdItem[]>();
  const unassignedPds: SwitchConnectedPdItem[] = [];
  const processedPdAssetIds = new Set<string>();

  for (const asset of assets) {
    if (!isPoeConsumerDevice(asset) || processedPdAssetIds.has(asset.id)) continue;
    processedPdAssetIds.add(asset.id);

    const resolved = resolveDevicePoeWatts(asset);
    const std = classifyPoeStandard(resolved.watts);
    const pdItem: SwitchConnectedPdItem = {
      assetId: asset.id,
      nodeId: nodeIdByAssetId.get(asset.id),
      name: asset.name,
      categoryLabel: getPoeCategoryLabel(asset.category),
      poeStandardLabel: std.label,
      watts: resolved.watts
    };

    const candidateNodeIds = nodeIdsByAssetId.get(asset.id) || [];
    let servingSwitchId: string | null = null;
    for (const nId of candidateNodeIds) {
      servingSwitchId = findServingSwitchAssetId(nId);
      if (servingSwitchId) break;
    }

    if (servingSwitchId && switchAssetMap.has(servingSwitchId)) {
      const list = pdsBySwitchId.get(servingSwitchId) || [];
      list.push(pdItem);
      pdsBySwitchId.set(servingSwitchId, list);
    } else {
      unassignedPds.push(pdItem);
    }
  }

  const switches: SwitchPoeBreakdownItem[] = [];
  for (const swAsset of switchAssetMap.values()) {
    const connectedPds = (pdsBySwitchId.get(swAsset.id) || []).sort(
      (a, b) => b.watts - a.watts || a.name.localeCompare(b.name, 'vi')
    );
    const consumedWatts = roundWatts(connectedPds.reduce((s, d) => s + d.watts, 0));
    const pseCapable = isPseDevice(swAsset);
    const budgetWatts = pseCapable
      ? resolvePseBudgetWatts(swAsset)
      : roundWatts(typeof swAsset.poeBudgetWatts === 'number' ? swAsset.poeBudgetWatts : 0);

    // Keep switches that act as PSE, have explicit budget, or currently serve PoE devices
    if (!pseCapable && budgetWatts === 0 && consumedWatts === 0) {
      continue;
    }

    const rawHeadroom = budgetWatts - consumedWatts;
    const headroomWatts = Number.isFinite(rawHeadroom) ? Math.round(rawHeadroom * 10) / 10 : 0;
    const utilizationPct =
      budgetWatts > 0 ? Math.round((consumedWatts / budgetWatts) * 100) : null;

    let status: PoeBudgetStatus = 'nominal';
    if (consumedWatts === 0) {
      status = 'idle';
    } else if (budgetWatts === 0) {
      status = 'overload';
    } else if (consumedWatts > budgetWatts) {
      status = 'overload';
    } else if (utilizationPct !== null && utilizationPct >= 80) {
      status = 'warning';
    }

    switches.push({
      assetId: swAsset.id,
      nodeId: nodeIdByAssetId.get(swAsset.id),
      name: swAsset.name,
      shortName: formatSwitchShortName(swAsset.name),
      model: swAsset.model,
      category: swAsset.category,
      isPse: pseCapable,
      consumedWatts,
      budgetWatts,
      headroomWatts,
      utilizationPct,
      status,
      poePortCount: (swAsset.ports || []).filter(p => p.poe === true).length,
      connectedPds
    });
  }

  switches.sort(
    (a, b) =>
      b.consumedWatts - a.consumedWatts ||
      b.budgetWatts - a.budgetWatts ||
      a.name.localeCompare(b.name, 'vi')
  );
  unassignedPds.sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name, 'vi'));

  const unassignedWatts = roundWatts(unassignedPds.reduce((s, d) => s + d.watts, 0));
  const totalConsumedWatts = roundWatts(
    switches.reduce((s, sw) => s + sw.consumedWatts, 0) + unassignedWatts
  );
  const totalBudgetWatts = roundWatts(switches.reduce((s, sw) => s + sw.budgetWatts, 0));

  return {
    switches,
    unassignedPds,
    unassignedWatts,
    totalConsumedWatts,
    totalBudgetWatts
  };
}

export function computeProjectPoeSummary(project: ProjectState): ProjectPoeSummary {
  const { assets, nodeIdByAssetId } = getActiveProjectAssets(project);
  return computeAssetsPoeSummary(assets, nodeIdByAssetId);
}

export interface UpsRuntimeInput {
  totalLoadWatts: number;
  batteryAh: number;
  batteryVoltageV?: number;
  batteryCount?: number;
  inverterEfficiency?: number;
  dodFactor?: number;
}

export interface UpsRuntimeResult {
  batteryEnergyWh: number;
  usableEnergyWh: number;
  runtimeMinutes: number;
  runtimeHours: number;
  status: 'adequate' | 'short' | 'critical' | 'idle';
  derateFactor?: number;
}

/**
 * E5 + P0#3: Estimates UPS battery backup duration in minutes/hours from Ah, Voltage & Bank count
 * with Peukert / C-rate discharge derating under heavy inverter loads.
 */
export function computeUpsBatteryRuntime(input: UpsRuntimeInput): UpsRuntimeResult {
  const loadW = Math.max(0, input.totalLoadWatts || 0);
  const ah = Math.max(0, input.batteryAh || 0);
  const voltage = Math.max(12, input.batteryVoltageV ?? 12);
  const count = Math.max(1, Math.round(input.batteryCount ?? 1));
  const eff = Math.max(0.5, Math.min(0.98, input.inverterEfficiency ?? 0.85));
  const dod = Math.max(0.4, Math.min(0.95, input.dodFactor ?? 0.8));

  const batteryEnergyWh = Math.round(ah * voltage * count);
  const nominalUsableWh = batteryEnergyWh * eff * dod;

  if (loadW <= 0 || ah <= 0 || nominalUsableWh <= 0) {
    return {
      batteryEnergyWh,
      usableEnergyWh: Math.round(nominalUsableWh),
      runtimeMinutes: 0,
      runtimeHours: 0,
      status: 'idle',
      derateFactor: 1
    };
  }

  // Peukert / C-rate derating for VRLA UPS batteries relative to nominal C/20 (0.05C) rate (k ≈ 1.15)
  const cRate = (loadW / eff) / Math.max(1, batteryEnergyWh);
  const derateFactor =
    Math.round(Math.max(0.55, Math.min(1.0, Math.pow(0.05 / Math.max(0.01, cRate), 0.15))) * 1000) / 1000;
  const usableEnergyWh = Math.round(nominalUsableWh * derateFactor);

  const runtimeHours = Math.round((usableEnergyWh / loadW) * 100) / 100;
  const runtimeMinutes = Math.max(1, Math.round((usableEnergyWh / loadW) * 60));
  const status: UpsRuntimeResult['status'] =
    runtimeMinutes >= 30 ? 'adequate' : runtimeMinutes >= 10 ? 'short' : 'critical';

  return {
    batteryEnergyWh,
    usableEnergyWh,
    runtimeMinutes,
    runtimeHours,
    status,
    derateFactor
  };
}

export interface BranchOutageSimulationResult {
  failedNodeIds: string[];
  affectedDownstreamDevices: Array<{ nodeId: string; name: string; category: DeviceCategory; poeWatts: number }>;
  lostPoeWatts: number;
  lostTotalWatts: number;
}

/**
 * E5: Simulates failure of one or more upstream switches/UPS nodes and lists impacted downstream devices.
 */
export function simulateBranchOutage(
  project: ProjectState,
  disabledNodeIds: string[]
): BranchOutageSimulationResult {
  const disabledSet = new Set(disabledNodeIds.filter(Boolean));
  if (disabledSet.size === 0) {
    return { failedNodeIds: [], affectedDownstreamDevices: [], lostPoeWatts: 0, lostTotalWatts: 0 };
  }

  const nodeById = new Map(project.nodes.map(n => [n.id, n]));
  const affected: BranchOutageSimulationResult['affectedDownstreamDevices'] = [];
  const seenNode = new Set<string>();

  for (const cable of project.cables || []) {
    if (cable.cableType === 'POWER_AC') {
      if (disabledSet.has(cable.sourceNodeId) && !disabledSet.has(cable.targetNodeId)) {
        const tgt = nodeById.get(cable.targetNodeId);
        const asset = tgt?.assetId ? project.assets[tgt.assetId] : undefined;
        if (tgt && asset && !seenNode.has(tgt.id)) {
          seenNode.add(tgt.id);
          const poeW = isPoeConsumerDevice(asset) ? resolveDevicePoeWatts(asset).watts : 0;
          affected.push({ nodeId: tgt.id, name: asset.name, category: asset.category, poeWatts: poeW });
        }
      }
      continue;
    }

    const srcDisabled = disabledSet.has(cable.sourceNodeId);
    const tgtDisabled = disabledSet.has(cable.targetNodeId);
    if (srcDisabled === tgtDisabled) continue;
    const otherId = srcDisabled ? cable.targetNodeId : cable.sourceNodeId;
    if (seenNode.has(otherId)) continue;
    const otherNode = nodeById.get(otherId);
    const otherAsset = otherNode?.assetId ? project.assets[otherNode.assetId] : undefined;
    if (!otherNode || !otherAsset) continue;
    if (otherAsset.category === 'camera' || otherAsset.category === 'ap' || isPoeConsumerDevice(otherAsset)) {
      seenNode.add(otherId);
      affected.push({
        nodeId: otherId,
        name: otherAsset.name,
        category: otherAsset.category,
        poeWatts: resolveDevicePoeWatts(otherAsset).watts
      });
    }
  }

  const lostPoeWatts = roundWatts(affected.reduce((s, d) => s + d.poeWatts, 0));
  const lostTotalWatts = roundWatts(
    affected.reduce((s, d) => {
      const n = nodeById.get(d.nodeId);
      const a = n?.assetId ? project.assets[n.assetId] : undefined;
      return s + (a?.powerWatts || d.poeWatts);
    }, 0)
  );

  return {
    failedNodeIds: Array.from(disabledSet),
    affectedDownstreamDevices: affected,
    lostPoeWatts,
    lostTotalWatts
  };
}

