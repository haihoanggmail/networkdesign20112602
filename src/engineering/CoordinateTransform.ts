import { normalizeScalePxPerMeter } from '../utils/scaleUtils';
import { normalizeRotationDeg } from '../utils/coverageUtils';

export const LEGACY_WORLD_SCALE = 1 / 48;
export const LEGACY_FALLBACK_ORIGIN_X = 500;
export const LEGACY_FALLBACK_ORIGIN_Y = 320;

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface WorldCoordinateOrigin {
  centerX: number;
  centerY: number;
}

export type CoordinateTransformMode = 'legacy_world_scale' | 'physical_meters';

export interface CoordinateTransform {
  readonly mode: CoordinateTransformMode;
  readonly pixelsPerMeter: number;
  readonly worldUnitsPerPixel: number;
  readonly origin: WorldCoordinateOrigin;
  canvasToWorld(point: Point2D, elevationY?: number): Point3D;
  worldToCanvas(point: Pick<Point3D, 'x' | 'z'>): Point2D;
  pixelsToWorld(pixels: number): number;
  worldToPixels(worldDistance: number): number;
  metersToWorld(meters: number): number;
  worldToMeters(worldDistance: number): number;
  metersToPixels(meters: number): number;
  pixelsToMeters(pixels: number): number;
}

export interface BoundsNodeLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeWorldOriginFromBounds(
  nodes: readonly BoundsNodeLike[],
  rooms: readonly BoundsNodeLike[] = []
): WorldCoordinateOrigin {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const w = Number.isFinite(n.width) ? n.width : 0;
    const h = Number.isFinite(n.height) ? n.height : 0;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w);
    maxY = Math.max(maxY, n.y + h);
  }

  for (const r of rooms) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
    const w = Number.isFinite(r.width) ? r.width : 0;
    const h = Number.isFinite(r.height) ? r.height : 0;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + w);
    maxY = Math.max(maxY, r.y + h);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { centerX: LEGACY_FALLBACK_ORIGIN_X, centerY: LEGACY_FALLBACK_ORIGIN_Y };
  }

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * Creates a CoordinateTransform bridging 2D SVG canvas coordinates (px, top-left origin, +X right, +Y down)
 * with 3D Three.js world coordinates (+X right, +Y up, +Z down).
 *
 * - `'legacy_world_scale'` preserves exact existing `WORLD_SCALE = 1 / 48` XZ coordinates
 *   while still resolving physical meters via `project.settings.scale`.
 * - `'physical_meters'` maps 1 Three.js world unit = 1 physical meter directly via `pixelsPerMeter`.
 */
export function createCoordinateTransform(options: {
  pixelsPerMeter?: number;
  origin?: WorldCoordinateOrigin;
  mode?: CoordinateTransformMode;
  legacyWorldScale?: number;
}): CoordinateTransform {
  const mode: CoordinateTransformMode = options.mode ?? 'legacy_world_scale';
  const pixelsPerMeter = normalizeScalePxPerMeter(options.pixelsPerMeter);
  const origin: WorldCoordinateOrigin = options.origin ?? {
    centerX: LEGACY_FALLBACK_ORIGIN_X,
    centerY: LEGACY_FALLBACK_ORIGIN_Y
  };

  const legacyScale =
    typeof options.legacyWorldScale === 'number' &&
    Number.isFinite(options.legacyWorldScale) &&
    options.legacyWorldScale > 0
      ? options.legacyWorldScale
      : LEGACY_WORLD_SCALE;

  const worldUnitsPerPixel =
    mode === 'physical_meters' ? 1 / pixelsPerMeter : legacyScale;

  return {
    mode,
    pixelsPerMeter,
    worldUnitsPerPixel,
    origin,
    canvasToWorld(point: Point2D, elevationY = 0): Point3D {
      return {
        x: (point.x - origin.centerX) * worldUnitsPerPixel,
        y: elevationY,
        z: (point.y - origin.centerY) * worldUnitsPerPixel
      };
    },
    worldToCanvas(point: Pick<Point3D, 'x' | 'z'>): Point2D {
      return {
        x: origin.centerX + point.x / worldUnitsPerPixel,
        y: origin.centerY + point.z / worldUnitsPerPixel
      };
    },
    pixelsToWorld(pixels: number): number {
      return pixels * worldUnitsPerPixel;
    },
    worldToPixels(worldDistance: number): number {
      return worldDistance / worldUnitsPerPixel;
    },
    metersToWorld(meters: number): number {
      if (mode === 'physical_meters') return meters;
      // Preserve visual/canvas scale consistency in legacy mode:
      // 1 meter in 2D = pixelsPerMeter px -> pixels * worldUnitsPerPixel
      return meters * pixelsPerMeter * worldUnitsPerPixel;
    },
    worldToMeters(worldDistance: number): number {
      if (mode === 'physical_meters') return worldDistance;
      return worldDistance / (pixelsPerMeter * worldUnitsPerPixel);
    },
    metersToPixels(meters: number): number {
      return meters * pixelsPerMeter;
    },
    pixelsToMeters(pixels: number): number {
      return pixels / pixelsPerMeter;
    }
  };
}

/**
 * Canonical 2D <-> 3D rotation conversion.
 * Convention:
 * - 2D SVG: 0 deg points toward +X (right), positive clockwise (+X -> +Y).
 * - 3D Three.js: +X right, +Y up, +Z down (matches +Y in 2D), so clockwise in top-down XZ
 *   corresponds to `rotation.y = -deg * Math.PI / 180`.
 */
export function rotationDegToThreeYRad(rotationDeg: number | undefined): number {
  const deg = normalizeRotationDeg(rotationDeg ?? 0);
  return (-deg * Math.PI) / 180;
}

export function threeYRadToRotationDeg(rotationYRad: number): number {
  if (!Number.isFinite(rotationYRad)) return 0;
  return normalizeRotationDeg((-rotationYRad * 180) / Math.PI);
}
