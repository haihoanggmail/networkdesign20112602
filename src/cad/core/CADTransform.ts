import type { Point2D, Point3D } from './CADTypes';

/**
 * 2D Affine matrix [a, b, c, d, tx, ty]:
 * x' = a*x + c*y + tx
 * y' = b*x + d*y + ty
 */
export type Affine2D = [number, number, number, number, number, number];

export const IDENTITY_2D: Affine2D = [1, 0, 0, 1, 0, 0];

export function multiplyAffine2D(m1: Affine2D, m2: Affine2D): Affine2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

export function createTranslation2D(tx: number, ty: number): Affine2D {
  return [1, 0, 0, 1, tx, ty];
}

export function createRotation2D(angleDeg: number): Affine2D {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cos, sin, -sin, cos, 0, 0];
}

export function createScale2D(sx: number, sy: number): Affine2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function applyAffine2D(m: Affine2D, pt: Point2D): Point2D {
  return {
    x: m[0] * pt.x + m[2] * pt.y + m[4],
    y: m[1] * pt.x + m[3] * pt.y + m[5]
  };
}

/**
 * Compose Block local -> INSERT world affine matrix:
 * T(position) * R(rotation) * S(scale) * T(-basePoint)
 */
export function buildInsertTransform2D(
  position: Point2D,
  scale: { x: number; y: number },
  rotationDeg: number,
  basePoint: Point2D = { x: 0, y: 0 }
): Affine2D {
  const tPos = createTranslation2D(position.x, position.y);
  const r = createRotation2D(rotationDeg || 0);
  const s = createScale2D(
    Number.isFinite(scale.x) && scale.x !== 0 ? scale.x : 1,
    Number.isFinite(scale.y) && scale.y !== 0 ? scale.y : 1
  );
  const tBase = createTranslation2D(-basePoint.x, -basePoint.y);
  return multiplyAffine2D(multiplyAffine2D(multiplyAffine2D(tPos, r), s), tBase);
}

/**
 * Extract effective scale & rotation angle from a 2D affine matrix (for rotated/scaled arcs/text).
 */
export function decomposeAffine2D(m: Affine2D): {
  tx: number;
  ty: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  hasNegativeFlip: boolean;
} {
  const det = m[0] * m[3] - m[1] * m[2];
  const scaleX = Math.hypot(m[0], m[1]) || 1;
  const scaleY = (Math.hypot(m[2], m[3]) || 1) * (det < 0 ? -1 : 1);
  const rotationDeg = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  return {
    tx: m[4],
    ty: m[5],
    scaleX,
    scaleY,
    rotationDeg,
    hasNegativeFlip: det < 0
  };
}

/**
 * AutoCAD Arbitrary Axis Algorithm (DXF OCS -> WCS):
 * Computes orthonormal (Ax, Ay, Az) basis for a planar entity with extrusion normal N.
 */
export function computeOcsAxes(extrusion?: Point3D): { ax: Point3D; ay: Point3D; az: Point3D } {
  if (!extrusion) {
    return {
      ax: { x: 1, y: 0, z: 0 },
      ay: { x: 0, y: 1, z: 0 },
      az: { x: 0, y: 0, z: 1 }
    };
  }
  const len = Math.hypot(extrusion.x, extrusion.y, extrusion.z);
  if (len < 1e-9) {
    return {
      ax: { x: 1, y: 0, z: 0 },
      ay: { x: 0, y: 1, z: 0 },
      az: { x: 0, y: 0, z: 1 }
    };
  }
  const az: Point3D = { x: extrusion.x / len, y: extrusion.y / len, z: extrusion.z / len };
  if (Math.abs(az.x - 0) < 1e-6 && Math.abs(az.y - 0) < 1e-6 && Math.abs(az.z - 1) < 1e-6) {
    return {
      ax: { x: 1, y: 0, z: 0 },
      ay: { x: 0, y: 1, z: 0 },
      az
    };
  }
  const cap = 1 / 64;
  const worldUp =
    Math.abs(az.x) < cap && Math.abs(az.y) < cap
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };

  // Ax = normalize(worldUp x Az)
  const rawAx = {
    x: worldUp.y * az.z - worldUp.z * az.y,
    y: worldUp.z * az.x - worldUp.x * az.z,
    z: worldUp.x * az.y - worldUp.y * az.x
  };
  const lenAx = Math.hypot(rawAx.x, rawAx.y, rawAx.z) || 1;
  const ax: Point3D = { x: rawAx.x / lenAx, y: rawAx.y / lenAx, z: rawAx.z / lenAx };

  // Ay = normalize(Az x Ax)
  const rawAy = {
    x: az.y * ax.z - az.z * ax.y,
    y: az.z * ax.x - az.x * ax.z,
    z: az.x * ax.y - az.y * ax.x
  };
  const lenAy = Math.hypot(rawAy.x, rawAy.y, rawAy.z) || 1;
  const ay: Point3D = { x: rawAy.x / lenAy, y: rawAy.y / lenAy, z: rawAy.z / lenAy };

  return { ax, ay, az };
}

export function ocsPointToWcs(pt: Point3D, extrusion?: Point3D): Point3D {
  if (!extrusion) return pt;
  const { ax, ay, az } = computeOcsAxes(extrusion);
  return {
    x: pt.x * ax.x + pt.y * ay.x + pt.z * az.x,
    y: pt.x * ax.y + pt.y * ay.y + pt.z * az.y,
    z: pt.x * ax.z + pt.y * ay.z + pt.z * az.z
  };
}
