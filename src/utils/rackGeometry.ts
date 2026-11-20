import { DeviceAsset, DiagramNode, RackSide, ServerRack } from '../types/infrastructure';
import { DEVICE_CATALOG } from '../data/deviceCatalog';

export const CANVAS_RACK_HEADER_H = 34;
export const CANVAS_RACK_FOOTER_H = 22;
export const CANVAS_RACK_RAIL_W = 30;
export const CANVAS_RACK_PAD_TOP = 4;
export const CANVAS_RACK_PAD_BOTTOM = 4;
export const CANVAS_RACK_DEFAULT_SLOT_H = 14;
export const CANVAS_RACK_COLLAPSED_BODY_H = 36;
export const CANVAS_RACK_COLLAPSED_H =
  CANVAS_RACK_HEADER_H + CANVAS_RACK_COLLAPSED_BODY_H + CANVAS_RACK_FOOTER_H;

export function isRackNodeCollapsed(rackNode: Pick<DiagramNode, 'customData'>): boolean {
  return Boolean(rackNode.customData?.collapsed);
}

export function getEffectiveRackDisplayHeight(
  rackNode: Pick<DiagramNode, 'height' | 'customData'>
): number {
  return isRackNodeCollapsed(rackNode) ? CANVAS_RACK_COLLAPSED_H : rackNode.height;
}

/**
 * Clamp custom rack U height to sensible 19-inch cabinet limits (4U..60U).
 */
export function clampRackUnits(units: number): number {
  if (!Number.isFinite(units)) return 42;
  return Math.max(4, Math.min(60, Math.round(units)));
}

/**
 * Determine how many Rack Units (U) a device asset occupies.
 */
export function getAssetUHeight(asset?: DeviceAsset): number {
  if (!asset) return 1;
  if (asset.rackUnitHeight && asset.rackUnitHeight >= 1) {
    return Math.round(asset.rackUnitHeight);
  }
  const byModel = DEVICE_CATALOG.find(p => p.model === asset.model);
  if (byModel && byModel.defaultUHeight >= 1) {
    return byModel.defaultUHeight;
  }
  if (asset.category === 'server' || asset.category === 'storage' || asset.category === 'ups') {
    return 2;
  }
  return 1;
}

/**
 * Determine U height from a catalog preset name.
 */
export function getPresetUHeight(presetName: string): number {
  const preset = DEVICE_CATALOG.find(p => p.name === presetName);
  if (!preset) return 1;
  return preset.defaultUHeight >= 1 ? preset.defaultUHeight : 1;
}

/**
 * Compute default canvas height for a rack node based on unit count.
 */
export function getCanvasRackHeight(totalUnits: number, slotH = CANVAS_RACK_DEFAULT_SLOT_H): number {
  const units = clampRackUnits(totalUnits);
  // Scale slotH down gracefully for very tall racks (45U+) so they remain crisp on canvas
  const effectiveSlotH = units > 42 ? Math.max(11, Math.min(slotH, 620 / units)) : slotH;
  return Math.round(
    CANVAS_RACK_HEADER_H + CANVAS_RACK_PAD_TOP + units * effectiveSlotH + CANVAS_RACK_PAD_BOTTOM + CANVAS_RACK_FOOTER_H
  );
}

/**
 * Compute exact pixel metrics for a Rack Node on the SVG canvas so visual rendering
 * and drop-zone hit-testing use identical coordinates.
 */
export function getRackCanvasMetrics(rackNode: Pick<DiagramNode, 'x' | 'y' | 'width' | 'height'>, totalUnits: number) {
  const units = totalUnits || 42;
  const slotsTopOffset = CANVAS_RACK_HEADER_H + CANVAS_RACK_PAD_TOP;
  const availableSlotsHeight = Math.max(
    units * 5,
    rackNode.height - slotsTopOffset - CANVAS_RACK_PAD_BOTTOM - CANVAS_RACK_FOOTER_H
  );
  const slotH = availableSlotsHeight / units;
  const slotsX = rackNode.x + CANVAS_RACK_RAIL_W;
  const slotsWidth = Math.max(60, rackNode.width - CANVAS_RACK_RAIL_W - 10);
  const slotsY = rackNode.y + slotsTopOffset;

  return {
    units,
    slotH,
    slotsTopOffset,
    slotsX,
    slotsWidth,
    slotsY,
    slotsBottomY: slotsY + availableSlotsHeight,
    availableSlotsHeight
  };
}

/**
 * Get the slot map for the requested rack mounting side ('front' or 'rear').
 */
export function getRackSlotsForSide(rack: ServerRack, side: RackSide = 'front'): Record<number, string> {
  return side === 'rear' ? (rack.rearSlots || {}) : (rack.slots || {});
}

/**
 * Clamp startU so a device of unitHeight stays within [1, totalUnits].
 * A device at startU occupies [startU, startU + unitHeight - 1].
 */
export function clampStartU(rawStartU: number, totalUnits: number, unitHeight = 1): number {
  const maxStart = Math.max(1, totalUnits - unitHeight + 1);
  return Math.max(1, Math.min(maxStart, rawStartU));
}

/**
 * Convert a Y coordinate relative to the top of the slots area into a 1-based U slot.
 * Top of slots area corresponds to U = totalUnits; bottom corresponds to U = 1.
 */
export function pixelYToRackU(relY: number, slotH: number, totalUnits: number, unitHeight = 1): number {
  const clampedRelY = Math.max(0, Math.min(totalUnits * slotH - 0.01, relY));
  const rowIndexFromTop = Math.floor(clampedRelY / slotH);
  const hoveredSingleU = totalUnits - rowIndexFromTop;
  const startU = unitHeight > 1 ? hoveredSingleU - Math.floor((unitHeight - 1) / 2) : hoveredSingleU;
  return clampStartU(startU, totalUnits, unitHeight);
}

/**
 * Build a set of all occupied U unit numbers in a rack for a given side (accounting for multi-U devices).
 */
export function getOccupiedUSet(
  rack: ServerRack,
  assets: Record<string, DeviceAsset>,
  excludeAssetId?: string,
  side: RackSide = 'front'
): Set<number> {
  const occupied = new Set<number>();
  const slotMap = getRackSlotsForSide(rack, side);
  for (const [uStr, devId] of Object.entries(slotMap)) {
    if (!devId || devId === excludeAssetId) continue;
    const startU = parseInt(uStr, 10);
    if (Number.isNaN(startU)) continue;
    const h = getAssetUHeight(assets[devId]);
    for (let u = startU; u < startU + h; u++) {
      occupied.add(u);
    }
  }
  return occupied;
}

/**
 * Check if a device of unitHeight can be placed at targetStartU without overlapping other devices.
 */
export function canPlaceDeviceAtU(
  rack: ServerRack,
  assets: Record<string, DeviceAsset>,
  targetStartU: number,
  unitHeight: number,
  excludeAssetId?: string,
  side: RackSide = 'front'
): boolean {
  const totalUnits = rack.totalUnits || 42;
  if (unitHeight > totalUnits) return false;
  if (targetStartU < 1 || targetStartU + unitHeight - 1 > totalUnits) {
    return false;
  }
  const occupied = getOccupiedUSet(rack, assets, excludeAssetId, side);
  for (let u = targetStartU; u < targetStartU + unitHeight; u++) {
    if (occupied.has(u)) return false;
  }
  return true;
}

/**
 * Find the nearest valid free startU closest to preferredU (no fixed bottom-to-top bias).
 */
export function findNearestAvailableU(
  rack: ServerRack,
  assets: Record<string, DeviceAsset>,
  preferredU: number,
  unitHeight = 1,
  excludeAssetId?: string,
  side: RackSide = 'front'
): number | null {
  const totalUnits = rack.totalUnits || 42;
  if (unitHeight > totalUnits) return null;
  const clampedPref = clampStartU(preferredU, totalUnits, unitHeight);

  if (canPlaceDeviceAtU(rack, assets, clampedPref, unitHeight, excludeAssetId, side)) {
    return clampedPref;
  }

  for (let offset = 1; offset <= totalUnits; offset++) {
    const above = clampedPref + offset;
    if (above <= totalUnits - unitHeight + 1 && canPlaceDeviceAtU(rack, assets, above, unitHeight, excludeAssetId, side)) {
      return above;
    }
    const below = clampedPref - offset;
    if (below >= 1 && canPlaceDeviceAtU(rack, assets, below, unitHeight, excludeAssetId, side)) {
      return below;
    }
  }

  return null;
}

/**
 * Get pixel rect (relative to rack slots top) for a device at [startU, startU + unitHeight - 1].
 */
export function getSlotSpanRect(startU: number, unitHeight: number, totalUnits: number, slotH: number) {
  const topU = Math.min(totalUnits, startU + unitHeight - 1);
  const topRowIndex = totalUnits - topU;
  return {
    top: topRowIndex * slotH,
    height: unitHeight * slotH
  };
}

export interface RackOverflowItem {
  assetId: string;
  name: string;
  side: RackSide;
  startU: number;
  uHeight: number;
}

export interface RackStatistics {
  totalUnits: number;
  frontUsedUnits: number;
  frontFreeUnits: number;
  frontDevicesCount: number;
  rearUsedUnits: number;
  rearFreeUnits: number;
  rearDevicesCount: number;
  totalDevicesCount: number;
  utilizationPct: number;
  totalPowerWatts: number;
  totalWeightKg: number;
  maxLoadKg: number;
  isOverweight: boolean;
  overflowItems: RackOverflowItem[];
}

/**
 * Compute comprehensive Rack Elevation statistics: Used/Free U (Front & Rear),
 * utilization %, total power (W), total weight (kg vs maxLoadKg), and overflow warnings.
 */
export function getRackStatistics(rack: ServerRack, assets: Record<string, DeviceAsset>): RackStatistics {
  const totalUnits = rack.totalUnits || 42;
  const frontUsedSet = new Set<number>();
  const rearUsedSet = new Set<number>();
  const countedAssetIds = new Set<string>();
  const overflowItems: RackOverflowItem[] = [];

  let frontDevicesCount = 0;
  let rearDevicesCount = 0;

  for (const [uStr, devId] of Object.entries(rack.slots || {})) {
    const startU = parseInt(uStr, 10);
    const dev = assets[devId];
    if (Number.isNaN(startU) || !dev) continue;
    frontDevicesCount++;
    countedAssetIds.add(devId);
    const uH = getAssetUHeight(dev);
    if (startU < 1 || startU + uH - 1 > totalUnits) {
      overflowItems.push({ assetId: devId, name: dev.name, side: 'front', startU, uHeight: uH });
    }
    for (let u = startU; u < startU + uH; u++) {
      if (u >= 1 && u <= totalUnits) frontUsedSet.add(u);
    }
  }

  for (const [uStr, devId] of Object.entries(rack.rearSlots || {})) {
    const startU = parseInt(uStr, 10);
    const dev = assets[devId];
    if (Number.isNaN(startU) || !dev) continue;
    rearDevicesCount++;
    countedAssetIds.add(devId);
    const uH = getAssetUHeight(dev);
    if (startU < 1 || startU + uH - 1 > totalUnits) {
      overflowItems.push({ assetId: devId, name: dev.name, side: 'rear', startU, uHeight: uH });
    }
    for (let u = startU; u < startU + uH; u++) {
      if (u >= 1 && u <= totalUnits) rearUsedSet.add(u);
    }
  }

  let totalPowerWatts = 0;
  let totalWeightKg = 0;
  countedAssetIds.forEach(id => {
    const dev = assets[id];
    if (dev) {
      totalPowerWatts += dev.powerWatts || 0;
      totalWeightKg += dev.weightKg || 0;
    }
  });

  const frontUsedUnits = frontUsedSet.size;
  const rearUsedUnits = rearUsedSet.size;
  const frontFreeUnits = Math.max(0, totalUnits - frontUsedUnits);
  const rearFreeUnits = Math.max(0, totalUnits - rearUsedUnits);
  const utilizationPct = Math.min(100, Math.round((frontUsedUnits / Math.max(1, totalUnits)) * 100));
  const maxLoadKg = rack.maxLoadKg || 1000;

  return {
    totalUnits,
    frontUsedUnits,
    frontFreeUnits,
    frontDevicesCount,
    rearUsedUnits,
    rearFreeUnits,
    rearDevicesCount,
    totalDevicesCount: countedAssetIds.size,
    utilizationPct,
    totalPowerWatts,
    totalWeightKg,
    maxLoadKg,
    isOverweight: totalWeightKg > maxLoadKg,
    overflowItems
  };
}

export interface ContiguousFreeUBlock {
  startU: number;
  endU: number;
  size: number;
}

/**
 * E2: Finds all contiguous runs of free Rack Units (U) of at least minBlockSize.
 */
export function findContiguousFreeUBlocks(
  rack: ServerRack,
  assets: Record<string, DeviceAsset>,
  minBlockSize = 1,
  side: RackSide = 'front'
): ContiguousFreeUBlock[] {
  const totalUnits = rack.totalUnits || 42;
  const occupied = getOccupiedUSet(rack, assets, undefined, side);
  const blocks: ContiguousFreeUBlock[] = [];
  let runStart: number | null = null;

  for (let u = 1; u <= totalUnits; u++) {
    if (!occupied.has(u)) {
      if (runStart === null) runStart = u;
    } else if (runStart !== null) {
      const size = u - runStart;
      if (size >= minBlockSize) {
        blocks.push({ startU: runStart, endU: u - 1, size });
      }
      runStart = null;
    }
  }
  if (runStart !== null) {
    const size = totalUnits - runStart + 1;
    if (size >= minBlockSize) {
      blocks.push({ startU: runStart, endU: totalUnits, size });
    }
  }
  return blocks.sort((a, b) => b.size - a.size || b.startU - a.startU);
}

export interface RackPduOutletSummary {
  pduCount: number;
  totalOutlets: number;
  poweredDeviceCount: number;
  usedOutlets: number;
  availableOutlets: number;
  isOverCapacity: boolean;
  pduNames: string[];
}

/**
 * E2: Summarizes PDU power outlets vs active powered devices mounted in a rack.
 */
export function computeRackPduOutletSummary(
  rack: ServerRack,
  assets: Record<string, DeviceAsset>
): RackPduOutletSummary {
  const mountedAssetIds = new Set<string>();
  Object.values(rack.slots || {}).forEach(id => id && mountedAssetIds.add(id));
  Object.values(rack.rearSlots || {}).forEach(id => id && mountedAssetIds.add(id));

  let pduCount = 0;
  let totalOutlets = 0;
  let poweredDeviceCount = 0;
  const pduNames: string[] = [];
  const passiveCats = new Set(['rack', 'patch_panel', 'odf', 'pdu']);

  mountedAssetIds.forEach(id => {
    const a = assets[id];
    if (!a) return;
    if (a.category === 'pdu') {
      pduCount += 1;
      pduNames.push(a.name);
      const outletMatch = `${a.name} ${a.model}`.match(/(\d+)\s*(port|outlets?|lỗ|cổng)/i);
      const portCount = a.ports?.length || (outletMatch ? parseInt(outletMatch[1], 10) : 8);
      totalOutlets += Math.max(4, portCount);
    } else if (!passiveCats.has(a.category) && (a.powerWatts || 0) > 0) {
      poweredDeviceCount += 1;
    }
  });

  const usedOutlets = Math.min(poweredDeviceCount, totalOutlets || poweredDeviceCount);
  const availableOutlets = Math.max(0, totalOutlets - poweredDeviceCount);
  return {
    pduCount,
    totalOutlets,
    poweredDeviceCount,
    usedOutlets,
    availableOutlets,
    isOverCapacity: pduCount > 0 ? poweredDeviceCount > totalOutlets : poweredDeviceCount > 0,
    pduNames
  };
}

/**
 * Checks whether a topology-only DiagramNode represents a device already mounted
 * inside a floorplan-visible rack on the same floor, so floorplan/3D views route cables
 * straight to the rack U-slot instead of drawing a duplicate floating box.
 */
export function isRackMountedTopologyShadowNode(
  node: DiagramNode,
  assets: Record<string, DeviceAsset>,
  floorplanRackNodes: DiagramNode[],
  racks: ServerRack[]
): boolean {
  if (node.diagramMode !== 'topology' || !node.assetId) return false;
  const asset = assets[node.assetId];
  if (!asset?.rackId || !asset?.rackUnitStart) return false;
  return floorplanRackNodes.some(rn => {
    if (rn.diagramMode !== 'floorplan') return false;
    if (node.floorId && rn.floorId && node.floorId !== rn.floorId) return false;
    const rack = racks.find(
      r => r.id === rn.customData?.rackId || r.id === rn.id || r.name === rn.label
    );
    return rack?.id === asset.rackId;
  });
}

/**
 * When viewing multi-floor buildings in Rack Elevation mode (`activeMode === 'rack'`),
 * racks placed vertically in the same shaft across different floors would overlap at (x, y).
 * If any two racks overlap, arrange them cleanly side-by-side with full U-height spacing.
 */
export function layoutRackNodesForElevationMode(
  rackNodes: DiagramNode[],
  racks: ServerRack[]
): DiagramNode[] {
  if (rackNodes.length <= 1) return rackNodes;

  let hasOverlap = false;
  for (let i = 0; i < rackNodes.length && !hasOverlap; i++) {
    const a = rackNodes[i];
    for (let j = i + 1; j < rackNodes.length; j++) {
      const b = rackNodes[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > -8 && oy > -8) {
        hasOverlap = true;
        break;
      }
    }
  }

  if (!hasOverlap) return rackNodes;

  const sorted = [...rackNodes].sort((a, b) => {
    const ra = racks.find(r => r.id === a.customData?.rackId || r.id === a.id || r.name === a.label);
    const rb = racks.find(r => r.id === b.customData?.rackId || r.id === b.id || r.name === b.label);
    const ua = ra?.totalUnits || a.customData?.totalUnits || 42;
    const ub = rb?.totalUnits || b.customData?.totalUnits || 42;
    if (ub !== ua) return ub - ua;
    return (a.label || '').localeCompare(b.label || '', 'vi');
  });

  let cursorX = 80;
  const baseY = 80;
  const gapX = 48;

  return sorted.map(rn => {
    const rack = racks.find(r => r.id === rn.customData?.rackId || r.id === rn.id || r.name === rn.label);
    const units = rack?.totalUnits || rn.customData?.totalUnits || 42;
    const width = Math.max(250, rn.width);
    const height = Math.max(getCanvasRackHeight(units), rn.height);
    const placed: DiagramNode = {
      ...rn,
      x: cursorX,
      y: baseY,
      width,
      height
    };
    cursorX += width + gapX;
    return placed;
  });
}



