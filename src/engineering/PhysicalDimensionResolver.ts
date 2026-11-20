import { CableTray, DeviceAsset, DiagramNode, Room, ServerRack } from '../types/infrastructure';
import { clampRackUnits } from '../utils/rackGeometry';
import { normalizeScalePxPerMeter } from '../utils/scaleUtils';
import { CoordinateTransform } from './CoordinateTransform';

export const EIA_1U_HEIGHT_METERS = 0.04445;
export const RACK_PLINTH_AND_CANOPY_METERS = 0.09 + 0.04 + 0.095;

export interface PhysicalDimensionsMeters {
  widthMeters: number;
  depthMeters: number;
  heightMeters: number;
  source: 'rack_specs' | 'device_specs' | 'canvas_scale' | 'preset_fallback';
}

export interface WorldBoxDimensions {
  widthWorld: number;
  depthWorld: number;
  heightWorld: number;
}

export function resolveRackPhysicalDimensions(rack: Pick<ServerRack, 'totalUnits' | 'widthMm' | 'depthMm'>): PhysicalDimensionsMeters {
  const units = clampRackUnits(rack.totalUnits || 42);
  const widthMeters = Math.max(0.45, Math.min(1.2, (rack.widthMm || 800) / 1000));
  const depthMeters = Math.max(0.45, Math.min(1.5, (rack.depthMm || 1000) / 1000));
  const heightMeters = RACK_PLINTH_AND_CANOPY_METERS + units * EIA_1U_HEIGHT_METERS;

  return {
    widthMeters,
    depthMeters,
    heightMeters,
    source: 'rack_specs'
  };
}

export function resolveRoomPhysicalDimensions(
  room: Pick<Room, 'width' | 'height'>,
  pixelsPerMeter: number
): PhysicalDimensionsMeters {
  const scale = normalizeScalePxPerMeter(pixelsPerMeter);
  return {
    widthMeters: Math.max(0.2, room.width / scale),
    depthMeters: Math.max(0.2, room.height / scale),
    heightMeters: 3.2,
    source: 'canvas_scale'
  };
}

export function resolveRoomWorldDimensions(
  room: Pick<Room, 'width' | 'height'>,
  transform: CoordinateTransform
): WorldBoxDimensions {
  return {
    widthWorld: Math.max(0.2, transform.pixelsToWorld(room.width)),
    depthWorld: Math.max(0.2, transform.pixelsToWorld(room.height)),
    heightWorld: transform.mode === 'physical_meters' ? 3.2 : 2.9
  };
}

export function resolveCableTrayWidthMeters(
  tray: Pick<CableTray, 'widthPx'>,
  pixelsPerMeter: number
): number {
  const scale = normalizeScalePxPerMeter(pixelsPerMeter);
  return Math.max(0.05, (tray.widthPx || 16) / scale);
}

export function resolveCableTrayWidthWorld(
  tray: Pick<CableTray, 'widthPx'>,
  transform: CoordinateTransform
): number {
  return Math.max(0.08, transform.pixelsToWorld(tray.widthPx || 16));
}

export function resolveDevicePhysicalDimensions(
  node: Pick<DiagramNode, 'width' | 'height' | 'customData'>,
  asset: DeviceAsset | undefined,
  pixelsPerMeter: number
): PhysicalDimensionsMeters {
  const rawW = node.customData?.physicalWidthMm;
  const rawD = node.customData?.physicalDepthMm;
  const rawH = node.customData?.physicalHeightMm;

  if (
    typeof rawW === 'number' &&
    rawW > 0 &&
    typeof rawD === 'number' &&
    rawD > 0 &&
    typeof rawH === 'number' &&
    rawH > 0
  ) {
    return {
      widthMeters: rawW / 1000,
      depthMeters: rawD / 1000,
      heightMeters: rawH / 1000,
      source: 'device_specs'
    };
  }

  // Category-aware physical approximations when asset has no explicit mm dimensions
  const cat = asset?.category;
  if (cat === 'camera') {
    return { widthMeters: 0.12, depthMeters: 0.24, heightMeters: 0.12, source: 'preset_fallback' };
  }
  if (cat === 'ap') {
    return { widthMeters: 0.22, depthMeters: 0.22, heightMeters: 0.05, source: 'preset_fallback' };
  }
  if (cat === 'switch' || cat === 'core_switch' || cat === 'router' || cat === 'firewall' || cat === 'patch_panel' || cat === 'odf' || cat === 'nvr') {
    const u = Math.max(1, asset?.rackUnitHeight || 1);
    return {
      widthMeters: 0.442,
      depthMeters: 0.36,
      heightMeters: u * EIA_1U_HEIGHT_METERS,
      source: 'preset_fallback'
    };
  }
  if (cat === 'server' || cat === 'storage') {
    const u = Math.max(1, asset?.rackUnitHeight || 2);
    return {
      widthMeters: 0.442,
      depthMeters: 0.72,
      heightMeters: u * EIA_1U_HEIGHT_METERS,
      source: 'preset_fallback'
    };
  }

  const scale = normalizeScalePxPerMeter(pixelsPerMeter);
  return {
    widthMeters: Math.max(0.2, node.width / scale),
    depthMeters: Math.max(0.2, node.height / scale),
    heightMeters: 0.45,
    source: 'canvas_scale'
  };
}
