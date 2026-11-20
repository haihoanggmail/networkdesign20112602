import type {
  CADEntity,
  CADLineEntity,
  CADLwPolylineEntity,
  Point2D
} from '../core/CADTypes';
import { getArcEndpoints, tessellateArc, tessellatePolyline } from './CADCurve';

export function lineLineIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  segmentOnly = true
): Point2D | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-9) return null;

  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = (dx * dby - dy * dbx) / denom;
  const u = (dx * day - dy * dax) / denom;

  if (segmentOnly && (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6)) {
    return null;
  }
  return {
    x: a1.x + t * dax,
    y: a1.y + t * day
  };
}

export function lineCircleIntersection(
  p1: Point2D,
  p2: Point2D,
  center: Point2D,
  radius: number,
  segmentOnly = true
): Point2D[] {
  if (!(radius > 0)) return [];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;

  const a = dx * dx + dy * dy;
  if (a < 1e-12) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < -1e-9) return [];

  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  const ts = disc < 1e-9 ? [-b / (2 * a)] : [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)];
  const hits: Point2D[] = [];
  for (const t of ts) {
    if (segmentOnly && (t < -1e-6 || t > 1 + 1e-6)) continue;
    hits.push({ x: p1.x + t * dx, y: p1.y + t * dy });
  }
  return hits;
}

export function circleCircleIntersection(
  c1: Point2D,
  r1: number,
  c2: Point2D,
  r2: number
): Point2D[] {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
  if (d < 1e-9 || d > r1 + r2 + 1e-6 || d < Math.abs(r1 - r2) - 1e-6) {
    return [];
  }
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = Math.max(0, r1 * r1 - a * a);
  const h = Math.sqrt(hSq);
  const xm = c1.x + (a * (c2.x - c1.x)) / d;
  const ym = c1.y + (a * (c2.y - c1.y)) / d;
  if (h < 1e-6) return [{ x: xm, y: ym }];
  const rx = -(c2.y - c1.y) * (h / d);
  const ry = (c2.x - c1.x) * (h / d);
  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry }
  ];
}

export function entityToLineSegments(entity: CADEntity): Array<[Point2D, Point2D]> {
  switch (entity.type) {
    case 'LINE':
      return [[{ x: entity.start.x, y: entity.start.y }, { x: entity.end.x, y: entity.end.y }]];
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = tessellatePolyline(entity.vertices, entity.closed, 16);
      const segs: Array<[Point2D, Point2D]> = [];
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push([pts[i], pts[i + 1]]);
      }
      return segs;
    }
    case 'ARC': {
      const pts = tessellateArc(entity.center, entity.radius, entity.startAngle, entity.endAngle, 32);
      const segs: Array<[Point2D, Point2D]> = [];
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push([pts[i], pts[i + 1]]);
      }
      return segs;
    }
    case 'SOLID':
    case '3DFACE': {
      const src = entity.type === 'SOLID' ? entity.points : entity.vertices;
      const segs: Array<[Point2D, Point2D]> = [];
      for (let i = 0; i < src.length; i++) {
        segs.push([src[i], src[(i + 1) % src.length]]);
      }
      return segs;
    }
    case 'LEADER':
    case 'MLEADER': {
      const segs: Array<[Point2D, Point2D]> = [];
      for (let i = 0; i < entity.vertices.length - 1; i++) {
        segs.push([entity.vertices[i], entity.vertices[i + 1]]);
      }
      return segs;
    }
    default:
      return [];
  }
}

export function findEntityIntersections(a: CADEntity, b: CADEntity): Point2D[] {
  if (a.id === b.id) return [];
  if (a.type === 'CIRCLE' && b.type === 'CIRCLE') {
    return circleCircleIntersection(a.center, a.radius, b.center, b.radius);
  }
  if (a.type === 'LINE' && b.type === 'CIRCLE') {
    return lineCircleIntersection(a.start, a.end, b.center, b.radius, true);
  }
  if (b.type === 'LINE' && a.type === 'CIRCLE') {
    return lineCircleIntersection(b.start, b.end, a.center, a.radius, true);
  }

  const segsA = entityToLineSegments(a);
  const segsB = entityToLineSegments(b);
  const hits: Point2D[] = [];
  for (const [a1, a2] of segsA) {
    for (const [b1, b2] of segsB) {
      const hit = lineLineIntersection(a1, a2, b1, b2, true);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

/**
 * Trim a LINE against cutting entities at the nearest intersection on the clicked side.
 */
export function trimLineAgainstCutters(
  target: CADLineEntity,
  cutters: CADEntity[],
  clickPoint: Point2D
): { mode: 'trim' | 'split'; updated: CADLineEntity; extra?: CADLineEntity } | null {
  const dx = target.end.x - target.start.x;
  const dy = target.end.y - target.start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return null;

  const projectT = (p: Point2D) => ((p.x - target.start.x) * dx + (p.y - target.start.y) * dy) / lenSq;
  const clickT = Math.max(0, Math.min(1, projectT(clickPoint)));

  const cutTs: number[] = [];
  for (const cutter of cutters) {
    if (cutter.id === target.id) continue;
    for (const pt of findEntityIntersections(target, cutter)) {
      const t = projectT(pt);
      if (t > 1e-4 && t < 1 - 1e-4) cutTs.push(t);
    }
  }
  if (cutTs.length === 0) return null;
  cutTs.sort((u, v) => u - v);

  let leftT = 0;
  let rightT = 1;
  for (const t of cutTs) {
    if (t <= clickT) leftT = t;
    else {
      rightT = t;
      break;
    }
  }

  const pointAt = (t: number) => ({
    x: target.start.x + t * dx,
    y: target.start.y + t * dy,
    z: target.start.z + t * (target.end.z - target.start.z)
  });

  if (leftT === 0 && rightT < 1) {
    return {
      mode: 'trim',
      updated: { ...target, start: pointAt(rightT), dirty: true }
    };
  }
  if (rightT === 1 && leftT > 0) {
    return {
      mode: 'trim',
      updated: { ...target, end: pointAt(leftT), dirty: true }
    };
  }
  if (leftT > 0 && rightT < 1) {
    return {
      mode: 'split',
      updated: { ...target, end: pointAt(leftT), dirty: true },
      extra: {
        ...target,
        id: `${target.id}_split_${Date.now().toString(36)}`,
        handle: '',
        start: pointAt(rightT),
        end: { ...target.end },
        rawDxf: undefined,
        dirty: true
      }
    };
  }
  return null;
}

/**
 * Extend a LINE toward boundary entities on the end closest to `clickPoint`.
 */
export function extendLineToBoundaries(
  target: CADLineEntity,
  boundaries: CADEntity[],
  clickPoint: Point2D
): CADLineEntity | null {
  const dStart = Math.hypot(clickPoint.x - target.start.x, clickPoint.y - target.start.y);
  const dEnd = Math.hypot(clickPoint.x - target.end.x, clickPoint.y - target.end.y);
  const extendEnd = dEnd <= dStart;

  const anchor = extendEnd ? target.start : target.end;
  const tip = extendEnd ? target.end : target.start;
  const dx = tip.x - anchor.x;
  const dy = tip.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-8) return null;

  let bestDist = Infinity;
  let bestHit: Point2D | null = null;

  for (const boundary of boundaries) {
    if (boundary.id === target.id) continue;
    const segs = entityToLineSegments(boundary);
    for (const [b1, b2] of segs) {
      const hit = lineLineIntersection(anchor, tip, b1, b2, false);
      if (!hit) continue;
      // Must be strictly inside boundary segment
      const bdx = b2.x - b1.x;
      const bdy = b2.y - b1.y;
      const bLenSq = bdx * bdx + bdy * bdy;
      const u = bLenSq > 1e-9 ? ((hit.x - b1.x) * bdx + (hit.y - b1.y) * bdy) / bLenSq : -1;
      if (u < -1e-4 || u > 1 + 1e-4) continue;
      // Must be forward along ray beyond tip
      const t = ((hit.x - anchor.x) * dx + (hit.y - anchor.y) * dy) / (len * len);
      if (t > 1 + 1e-4) {
        const dist = (t - 1) * len;
        if (dist < bestDist) {
          bestDist = dist;
          bestHit = hit;
        }
      }
    }
    if (boundary.type === 'CIRCLE') {
      const hits = lineCircleIntersection(anchor, tip, boundary.center, boundary.radius, false);
      for (const hit of hits) {
        const t = ((hit.x - anchor.x) * dx + (hit.y - anchor.y) * dy) / (len * len);
        if (t > 1 + 1e-4) {
          const dist = (t - 1) * len;
          if (dist < bestDist) {
            bestDist = dist;
            bestHit = hit;
          }
        }
      }
    }
  }

  if (!bestHit) return null;
  return extendEnd
    ? { ...target, end: { ...target.end, x: bestHit.x, y: bestHit.y }, dirty: true }
    : { ...target, start: { ...target.start, x: bestHit.x, y: bestHit.y }, dirty: true };
}

export function offsetSimpleEntity(
  entity: CADLineEntity | CADLwPolylineEntity,
  distance: number,
  sidePoint: Point2D
): CADLineEntity | CADLwPolylineEntity {
  if (entity.type === 'LINE') {
    const dx = entity.end.x - entity.start.x;
    const dy = entity.end.y - entity.start.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const cross = (sidePoint.x - entity.start.x) * ny - (sidePoint.y - entity.start.y) * nx;
    const dotSide = (sidePoint.x - entity.start.x) * nx + (sidePoint.y - entity.start.y) * ny;
    const sign = dotSide >= 0 ? 1 : -1;
    void cross;
    return {
      ...entity,
      id: `${entity.id}_off_${Date.now().toString(36)}`,
      handle: '',
      start: { ...entity.start, x: entity.start.x + nx * distance * sign, y: entity.start.y + ny * distance * sign },
      end: { ...entity.end, x: entity.end.x + nx * distance * sign, y: entity.end.y + ny * distance * sign },
      rawDxf: undefined,
      dirty: true
    };
  }

  const verts = entity.vertices;
  if (verts.length < 2) return entity;
  const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
  const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length;
  const outwardSign = Math.hypot(sidePoint.x - cx, sidePoint.y - cy) >= 1 ? 1 : -1;
  const newVerts = verts.map(v => {
    const vx = v.x - cx;
    const vy = v.y - cy;
    const len = Math.hypot(vx, vy) || 1;
    return {
      ...v,
      x: v.x + (vx / len) * distance * outwardSign,
      y: v.y + (vy / len) * distance * outwardSign
    };
  });
  return {
    ...entity,
    id: `${entity.id}_off_${Date.now().toString(36)}`,
    handle: '',
    vertices: newVerts,
    rawDxf: undefined,
    dirty: true
  };
}

export { getArcEndpoints };
