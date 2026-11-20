import { CableEdge } from '../types/infrastructure';
import {
  RectBox,
  computeBundledCablePath,
  computeCablePath
} from '../utils/cableRouting';
import { CoordinateTransform, Point2D, Point3D } from './CoordinateTransform';

const PATH_COMMAND_REGEX = /([MLQC])\s*([^MLQC]*)/gi;

/**
 * Deterministically samples an SVG path string emitted by `computeCablePath` / `computeBundledCablePath`
 * (commands M, L, Q, C) into a 2D polyline without altering any input data.
 */
export function sampleSvgPath2D(d: string, curveSegments = 16): Point2D[] {
  const points: Point2D[] = [];
  if (!d) return points;

  let cur: Point2D = { x: 0, y: 0 };
  const matches = d.matchAll(PATH_COMMAND_REGEX);

  for (const match of matches) {
    const cmd = match[1].toUpperCase();
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);

    if (cmd === 'M' && nums.length >= 2) {
      cur = { x: nums[0], y: nums[1] };
      points.push(cur);
      for (let i = 2; i + 1 < nums.length; i += 2) {
        cur = { x: nums[i], y: nums[i + 1] };
        points.push(cur);
      }
    } else if (cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        cur = { x: nums[i], y: nums[i + 1] };
        points.push(cur);
      }
    } else if (cmd === 'Q') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const cx = nums[i];
        const cy = nums[i + 1];
        const x2 = nums[i + 2];
        const y2 = nums[i + 3];
        for (let s = 1; s <= curveSegments; s++) {
          const t = s / curveSegments;
          const mt = 1 - t;
          points.push({
            x: mt * mt * cur.x + 2 * mt * t * cx + t * t * x2,
            y: mt * mt * cur.y + 2 * mt * t * cy + t * t * y2
          });
        }
        cur = { x: x2, y: y2 };
      }
    } else if (cmd === 'C') {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const c1x = nums[i];
        const c1y = nums[i + 1];
        const c2x = nums[i + 2];
        const c2y = nums[i + 3];
        const x3 = nums[i + 4];
        const y3 = nums[i + 5];
        for (let s = 1; s <= curveSegments; s++) {
          const t = s / curveSegments;
          const mt = 1 - t;
          points.push({
            x:
              mt * mt * mt * cur.x +
              3 * mt * mt * t * c1x +
              3 * mt * t * t * c2x +
              t * t * t * x3,
            y:
              mt * mt * mt * cur.y +
              3 * mt * mt * t * c1y +
              3 * mt * t * t * c2y +
              t * t * t * y3
          });
        }
        cur = { x: x3, y: y3 };
      }
    }
  }

  return deduplicateAdjacentPoints2D(points);
}

function deduplicateAdjacentPoints2D(points: Point2D[], eps = 1e-4): Point2D[] {
  if (points.length <= 1) return points;
  const out: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const curr = points[i];
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > eps) {
      out.push(curr);
    }
  }
  return out;
}

export interface Cable3DProjectionOptions {
  /** World Y height of source terminal */
  sourceY: number;
  /** World Y height of target terminal */
  targetY: number;
  /** Optional overhead/floor tray Y height for horizontal run on same floor */
  trayY?: number;
  /** Optional bundle lateral offset in 2D px + normal matching 2D bundle layout */
  bundleOffsetPx?: number;
  bundleNormal?: Point2D;
  /** Number of samples per Bezier curve segment */
  curveSegments?: number;
}

export interface ProjectedCableRoute3D {
  /** Exact 2D top-down polyline (in canvas px) */
  points2D: Point2D[];
  /** Projected 3D world polyline whose (x, z) matches points2D under `transform` */
  points3D: Point3D[];
  /** Canonical midpoint in 3D world space */
  midWorld: Point3D;
}

/**
 * Projects a 2D cable route (`computeCablePath` or `computeBundledCablePath`) into 3D space
 * while guaranteeing top-down XZ projection parity and NEVER mutating `cable.controlPoints`.
 */
export function projectCableRouteTo3D(
  cable: CableEdge,
  srcRect: RectBox,
  tgtRect: RectBox,
  transform: CoordinateTransform,
  options: Cable3DProjectionOptions
): ProjectedCableRoute3D {
  const path2D =
    options.bundleOffsetPx && options.bundleNormal
      ? computeBundledCablePath(
          cable,
          srcRect,
          tgtRect,
          options.bundleOffsetPx,
          options.bundleNormal
        )
      : computeCablePath(cable, srcRect, tgtRect);

  const sampled2D = sampleSvgPath2D(path2D.d, options.curveSegments ?? 16);
  const points2D: Point2D[] =
    sampled2D.length >= 2
      ? sampled2D
      : [
          { x: path2D.x1, y: path2D.y1 },
          { x: path2D.x2, y: path2D.y2 }
        ];

  const { sourceY, targetY } = options;
  const isInterFloor = Math.abs(sourceY - targetY) > 0.15;
  const trayY = options.trayY ?? Math.max(sourceY, targetY) + 0.08;

  // Compute cumulative 2D arc lengths so Y interpolation stays proportional to XZ travel
  const cumLens: number[] = [0];
  for (let i = 1; i < points2D.length; i++) {
    const seg = Math.hypot(points2D[i].x - points2D[i - 1].x, points2D[i].y - points2D[i - 1].y);
    cumLens.push(cumLens[i - 1] + seg);
  }
  const totalLen = Math.max(1e-6, cumLens[cumLens.length - 1]);

  const points3D: Point3D[] = [];

  if (isInterFloor) {
    // Follow the 2D XZ path horizontally at sourceY until target XZ, then drop/rise vertically
    for (let i = 0; i < points2D.length; i++) {
      const xz = transform.canvasToWorld(points2D[i], sourceY);
      points3D.push(xz);
    }
    const lastPt = points2D[points2D.length - 1];
    points3D.push(transform.canvasToWorld(lastPt, targetY));
  } else {
    // Same-floor run: preserve exact XZ at all vertices while lifting smoothly onto trayY over middle span
    points3D.push(transform.canvasToWorld(points2D[0], sourceY));
    if (points2D.length === 2) {
      // Introduce intermediate riser/drop knees on straight 2-point runs so cable lifts off port onto trayY
      const p0 = points2D[0];
      const p1 = points2D[1];
      const liftA = { x: p0.x + (p1.x - p0.x) * 0.15, y: p0.y + (p1.y - p0.y) * 0.15 };
      const liftB = { x: p0.x + (p1.x - p0.x) * 0.85, y: p0.y + (p1.y - p0.y) * 0.85 };
      points3D.push(transform.canvasToWorld(liftA, trayY));
      points3D.push(transform.canvasToWorld(liftB, trayY));
    } else {
      for (let i = 1; i < points2D.length - 1; i++) {
        const u = cumLens[i] / totalLen;
        const ramp = u < 0.08 ? u / 0.08 : u > 0.92 ? (1 - u) / 0.08 : 1;
        const baseY = sourceY + (targetY - sourceY) * u;
        const y = baseY + (trayY - baseY) * ramp;
        points3D.push(transform.canvasToWorld(points2D[i], y));
      }
    }
    points3D.push(transform.canvasToWorld(points2D[points2D.length - 1], targetY));
  }

  const midWorldXZ = transform.canvasToWorld(
    path2D.midPoint,
    isInterFloor ? (sourceY + targetY) / 2 : trayY
  );

  return {
    points2D,
    points3D,
    midWorld: midWorldXZ
  };
}
