import type {
  CADBlock,
  CADDocument,
  CADEntity,
  Point2D,
  Point3D
} from '../core/CADTypes';
import {
  Affine2D,
  IDENTITY_2D,
  applyAffine2D,
  buildInsertTransform2D,
  decomposeAffine2D
} from '../core/CADTransform';
import {
  isAngleInCcwArc,
  normalizeAngleDeg,
  tessellateEllipse,
  tessellatePolyline,
  tessellateSpline
} from './CADCurve';
import {
  boundsContainedIn,
  boundsIntersect,
  computeEntityBounds2D,
  isValidBounds
} from './CADBounds';
import { entityToLineSegments } from './CADIntersection';

export function distancePointToSegment2D(p: Point2D, a: Point2D, b: Point2D): {
  dist: number;
  closest: Point2D;
} {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    return { dist: Math.hypot(p.x - a.x, p.y - a.y), closest: { x: a.x, y: a.y } };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return { dist: Math.hypot(p.x - cx, p.y - cy), closest: { x: cx, y: cy } };
}

export function distanceToEntity2D(
  pt: Point2D,
  entity: CADEntity,
  blocks?: Record<string, CADBlock>,
  transform: Affine2D = IDENTITY_2D,
  depth = 0,
  visitedBlocks?: Set<string>
): number {
  switch (entity.type) {
    case 'LINE': {
      const a = applyAffine2D(transform, entity.start);
      const b = applyAffine2D(transform, entity.end);
      return distancePointToSegment2D(pt, a, b).dist;
    }
    case 'POINT': {
      const p = applyAffine2D(transform, entity.position);
      return Math.hypot(pt.x - p.x, pt.y - p.y);
    }
    case 'CIRCLE': {
      const c = applyAffine2D(transform, entity.center);
      const dec = decomposeAffine2D(transform);
      const r = entity.radius * ((Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2);
      return Math.abs(Math.hypot(pt.x - c.x, pt.y - c.y) - r);
    }
    case 'ARC': {
      const c = applyAffine2D(transform, entity.center);
      const dec = decomposeAffine2D(transform);
      const r = entity.radius * ((Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2);
      const ang = normalizeAngleDeg((Math.atan2(pt.y - c.y, pt.x - c.x) * 180) / Math.PI - dec.rotationDeg);
      if (isAngleInCcwArc(ang, entity.startAngle, entity.endAngle)) {
        return Math.abs(Math.hypot(pt.x - c.x, pt.y - c.y) - r);
      }
      const sRad = ((entity.startAngle + dec.rotationDeg) * Math.PI) / 180;
      const eRad = ((entity.endAngle + dec.rotationDeg) * Math.PI) / 180;
      return Math.min(
        Math.hypot(pt.x - (c.x + r * Math.cos(sRad)), pt.y - (c.y + r * Math.sin(sRad))),
        Math.hypot(pt.x - (c.x + r * Math.cos(eRad)), pt.y - (c.y + r * Math.sin(eRad)))
      );
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = tessellatePolyline(entity.vertices, entity.closed, 16).map(p => applyAffine2D(transform, p));
      let minDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        minDist = Math.min(minDist, distancePointToSegment2D(pt, pts[i], pts[i + 1]).dist);
      }
      return minDist;
    }
    case 'SPLINE':
    case 'ELLIPSE': {
      const raw = entity.type === 'SPLINE' ? tessellateSpline(entity, 32) : tessellateEllipse(entity, 32);
      const pts = raw.map(p => applyAffine2D(transform, p));
      let minDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        minDist = Math.min(minDist, distancePointToSegment2D(pt, pts[i], pts[i + 1]).dist);
      }
      return minDist;
    }
    case 'INSERT': {
      if (blocks && depth < 16) {
        const blk = blocks[entity.blockName];
        const stack = visitedBlocks || new Set<string>();
        if (blk && !stack.has(entity.blockName)) {
          stack.add(entity.blockName);
          const mLocal = buildInsertTransform2D(
            entity.position,
            entity.scale,
            entity.rotation,
            blk.basePoint
          );
          const nextT: Affine2D = [
            transform[0] * mLocal[0] + transform[2] * mLocal[1],
            transform[1] * mLocal[0] + transform[3] * mLocal[1],
            transform[0] * mLocal[2] + transform[2] * mLocal[3],
            transform[1] * mLocal[2] + transform[3] * mLocal[3],
            transform[0] * mLocal[4] + transform[2] * mLocal[5] + transform[4],
            transform[1] * mLocal[4] + transform[3] * mLocal[5] + transform[5]
          ];
          let minD = Infinity;
          for (const sub of blk.entities) {
            minD = Math.min(minD, distanceToEntity2D(pt, sub, blocks, nextT, depth + 1, stack));
          }
          stack.delete(entity.blockName);
          if (Number.isFinite(minD)) return minD;
        }
      }
      const p = applyAffine2D(transform, entity.position);
      return Math.hypot(pt.x - p.x, pt.y - p.y);
    }
    case 'TEXT':
    case 'MTEXT':
    case 'ATTRIB':
    case 'ATTDEF':
    case 'DIMENSION':
    case 'UNKNOWN': {
      const eb = computeEntityBounds2D(entity, blocks, transform);
      if (!isValidBounds(eb)) return Infinity;
      if (pt.x >= eb.minX && pt.x <= eb.maxX && pt.y >= eb.minY && pt.y <= eb.maxY) {
        return 0;
      }
      const dx = Math.max(eb.minX - pt.x, 0, pt.x - eb.maxX);
      const dy = Math.max(eb.minY - pt.y, 0, pt.y - eb.maxY);
      return Math.hypot(dx, dy);
    }
    default: {
      const segs = entityToLineSegments(entity);
      let minDist = Infinity;
      for (const [a, b] of segs) {
        const ta = applyAffine2D(transform, a);
        const tb = applyAffine2D(transform, b);
        minDist = Math.min(minDist, distancePointToSegment2D(pt, ta, tb).dist);
      }
      return minDist;
    }
  }
}

export function doesEntityMatchSelectionBox(
  entity: CADEntity,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  mode: 'window' | 'crossing',
  blocks?: Record<string, CADBlock>
): boolean {
  const eb = entity.bounds && isValidBounds(entity.bounds) ? entity.bounds : computeEntityBounds2D(entity, blocks);
  if (!isValidBounds(eb)) return false;
  if (mode === 'window') {
    return boundsContainedIn(eb, box);
  }
  return boundsIntersect(eb, box);
}

function mapPoint(pt: Point3D, fn: (p: Point3D) => Point3D): Point3D {
  return fn(pt);
}

export function translateEntity(entity: CADEntity, dx: number, dy: number, dz = 0): CADEntity {
  const shift = (p: Point3D): Point3D => ({ x: p.x + dx, y: p.y + dy, z: (p.z ?? 0) + dz });
  return mapEntityPoints(entity, shift, { markDirty: true });
}

export function rotateEntityAround(entity: CADEntity, origin: Point2D, angleDeg: number): CADEntity {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rotPt = (p: Point3D): Point3D => {
    const rx = p.x - origin.x;
    const ry = p.y - origin.y;
    return {
      x: origin.x + rx * c - ry * s,
      y: origin.y + rx * s + ry * c,
      z: p.z ?? 0
    };
  };
  const next = mapEntityPoints(entity, rotPt, { markDirty: true });
  if (next.type === 'ARC') {
    return {
      ...next,
      startAngle: normalizeAngleDeg(next.startAngle + angleDeg),
      endAngle: normalizeAngleDeg(next.endAngle + angleDeg)
    };
  }
  if (next.type === 'TEXT' || next.type === 'MTEXT' || next.type === 'ATTRIB' || next.type === 'ATTDEF' || next.type === 'INSERT') {
    return {
      ...next,
      rotation: normalizeAngleDeg((next.rotation || 0) + angleDeg)
    };
  }
  return next;
}

export function scaleEntityAround(entity: CADEntity, origin: Point2D, factor: number): CADEntity {
  const safe = Number.isFinite(factor) && Math.abs(factor) > 1e-6 ? factor : 1;
  const absScale = Math.abs(safe);
  const scalePt = (p: Point3D): Point3D => ({
    x: origin.x + (p.x - origin.x) * safe,
    y: origin.y + (p.y - origin.y) * safe,
    z: (p.z ?? 0) * safe
  });
  const next = mapEntityPoints(entity, scalePt, { markDirty: true });
  if (next.type === 'CIRCLE' || next.type === 'ARC') {
    return { ...next, radius: next.radius * absScale };
  }
  if (next.type === 'TEXT' || next.type === 'MTEXT' || next.type === 'ATTRIB' || next.type === 'ATTDEF') {
    return { ...next, height: Math.max(0.1, next.height * absScale) };
  }
  if (next.type === 'INSERT') {
    return {
      ...next,
      scale: {
        x: next.scale.x * safe,
        y: next.scale.y * safe,
        z: next.scale.z * safe
      }
    };
  }
  if (next.type === 'ELLIPSE') {
    return {
      ...next,
      majorAxisEndPoint: {
        x: next.majorAxisEndPoint.x * safe,
        y: next.majorAxisEndPoint.y * safe,
        z: next.majorAxisEndPoint.z * safe
      }
    };
  }
  return next;
}

export function mirrorEntityAcrossLine(entity: CADEntity, a: Point2D, b: Point2D): CADEntity {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return entity;
  const mirrorPt = (p: Point3D): Point3D => {
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return {
      x: 2 * projX - p.x,
      y: 2 * projY - p.y,
      z: p.z ?? 0
    };
  };
  const next = mapEntityPoints(entity, mirrorPt, { markDirty: true });
  if (next.type === 'LWPOLYLINE' || next.type === 'POLYLINE') {
    return {
      ...next,
      vertices: next.vertices.map(v => ({
        ...v,
        bulge: v.bulge ? -v.bulge : undefined
      }))
    };
  }
  return next;
}

function mapEntityPoints(
  entity: CADEntity,
  fn: (p: Point3D) => Point3D,
  opts?: { markDirty?: boolean }
): CADEntity {
  const dirty = opts?.markDirty ? true : entity.dirty;
  switch (entity.type) {
    case 'LINE':
      return { ...entity, start: mapPoint(entity.start, fn), end: mapPoint(entity.end, fn), dirty, bounds: undefined };
    case 'POINT':
      return { ...entity, position: mapPoint(entity.position, fn), dirty, bounds: undefined };
    case 'CIRCLE':
    case 'ARC':
    case 'ELLIPSE':
      return { ...entity, center: mapPoint(entity.center, fn), dirty, bounds: undefined };
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return {
        ...entity,
        vertices: entity.vertices.map(v => {
          const p = fn({ x: v.x, y: v.y, z: v.z ?? 0 });
          return { ...v, x: p.x, y: p.y, z: p.z };
        }),
        dirty,
        bounds: undefined
      };
    case 'SPLINE':
      return {
        ...entity,
        controlPoints: entity.controlPoints.map(fn),
        fitPoints: entity.fitPoints.map(fn),
        dirty,
        bounds: undefined
      };
    case 'HATCH':
      return {
        ...entity,
        boundaryLoops: entity.boundaryLoops.map(loop =>
          loop.map(p => {
            const tp = fn({ x: p.x, y: p.y, z: 0 });
            return { x: tp.x, y: tp.y };
          })
        ),
        dirty,
        bounds: undefined
      };
    case 'SOLID':
      return {
        ...entity,
        points: entity.points.map(fn) as [Point3D, Point3D, Point3D, Point3D],
        dirty,
        bounds: undefined
      };
    case '3DFACE':
      return {
        ...entity,
        vertices: entity.vertices.map(fn) as [Point3D, Point3D, Point3D, Point3D],
        dirty,
        bounds: undefined
      };
    case 'TEXT':
      return {
        ...entity,
        position: mapPoint(entity.position, fn),
        secondAlignmentPoint: entity.secondAlignmentPoint ? mapPoint(entity.secondAlignmentPoint, fn) : undefined,
        dirty,
        bounds: undefined
      };
    case 'MTEXT':
    case 'ATTRIB':
    case 'ATTDEF':
      return {
        ...entity,
        position: mapPoint(entity.position, fn),
        dirty,
        bounds: undefined
      };
    case 'DIMENSION':
      return {
        ...entity,
        defPoint: mapPoint(entity.defPoint, fn),
        defPoint2: entity.defPoint2 ? mapPoint(entity.defPoint2, fn) : undefined,
        defPoint3: entity.defPoint3 ? mapPoint(entity.defPoint3, fn) : undefined,
        defPoint4: entity.defPoint4 ? mapPoint(entity.defPoint4, fn) : undefined,
        textMidPoint: mapPoint(entity.textMidPoint, fn),
        dirty,
        bounds: undefined
      };
    case 'LEADER':
    case 'MLEADER':
      return {
        ...entity,
        vertices: entity.vertices.map(fn),
        dirty,
        bounds: undefined
      };
    case 'INSERT':
      return {
        ...entity,
        position: mapPoint(entity.position, fn),
        attributes: entity.attributes?.map(a => ({ ...a, position: mapPoint(a.position, fn) })),
        dirty,
        bounds: undefined
      };
    case 'UNKNOWN':
      return {
        ...entity,
        previewPoint: entity.previewPoint ? mapPoint(entity.previewPoint, fn) : undefined,
        dirty,
        bounds: undefined
      };
  }
}

export function isEntityGeometryEditable(entity: Pick<CADEntity, 'preservationTier'>): boolean {
  return entity.preservationTier === 'supported';
}

export function extractViewportSummary(
  entity: CADEntity
): { viewportId?: number; width: number; height: number } | null {
  if (entity.type !== 'UNKNOWN' || entity.dxfType !== 'VIEWPORT' || !entity.rawDxf) {
    return null;
  }
  const width = Number(entity.rawDxf.find(p => p.code === 40)?.value) || 0;
  const height = Number(entity.rawDxf.find(p => p.code === 41)?.value) || 0;
  const idPair = entity.rawDxf.find(p => p.code === 69)?.value;
  const viewportId = idPair !== undefined ? Number(idPair) : undefined;
  return { viewportId: Number.isFinite(viewportId) ? viewportId : undefined, width, height };
}

export function computeEntityLength2D(entity: CADEntity): number {
  switch (entity.type) {
    case 'LINE':
      return Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
    case 'CIRCLE':
      return 2 * Math.PI * Math.max(0, entity.radius);
    case 'ARC': {
      let sweep = (entity.endAngle - entity.startAngle) % 360;
      if (sweep <= 0) sweep += 360;
      return ((2 * Math.PI * Math.max(0, entity.radius)) * sweep) / 360;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = tessellatePolyline(entity.vertices, entity.closed, 12);
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      }
      return len;
    }
    case 'SPLINE':
    case 'ELLIPSE': {
      const pts = entity.type === 'SPLINE' ? tessellateSpline(entity, 24) : tessellateEllipse(entity, 24);
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      }
      return len;
    }
    default:
      return 0;
  }
}

export function getSimilarEntityIds(
  doc: CADDocument,
  seeds: CADEntity[],
  activeSpace: 'model' | 'paper' | 'all' = 'all'
): string[] {
  if (seeds.length === 0) return [];
  const keys = new Set(
    seeds.map(s =>
      s.type === 'INSERT'
        ? `INSERT:${s.layer}:${s.blockName}`
        : `${s.type}:${s.layer}`
    )
  );
  const out: string[] = [];
  for (const ent of doc.entities) {
    if (ent.visible === false) continue;
    const layer = doc.layers[ent.layer];
    if (layer && (!layer.visible || layer.frozen)) continue;
    if (activeSpace !== 'all') {
      const entSpace = ent.space === 'paper' ? 'paper' : 'model';
      if (entSpace !== activeSpace) continue;
    }
    const key =
      ent.type === 'INSERT'
        ? `INSERT:${ent.layer}:${ent.blockName}`
        : `${ent.type}:${ent.layer}`;
    if (keys.has(key)) out.push(ent.id);
  }
  return out;
}

export function pickTopEntityAtPoint(
  doc: CADDocument,
  worldPoint: Point2D,
  toleranceWorld: number,
  candidates?: CADEntity[],
  activeSpace: 'model' | 'paper' | 'all' = 'all'
): CADEntity | null {
  const list = candidates || doc.entities;
  let best: CADEntity | null = null;
  let bestDist = toleranceWorld;
  for (let i = list.length - 1; i >= 0; i--) {
    const ent = list[i];
    if (ent.visible === false) continue;
    if (activeSpace !== 'all') {
      const entSpace = ent.space === 'paper' ? 'paper' : 'model';
      if (entSpace !== activeSpace) continue;
    }
    const layer = doc.layers[ent.layer];
    if (layer && (!layer.visible || layer.frozen)) continue;
    const d = distanceToEntity2D(worldPoint, ent, doc.blocks);
    if (d <= bestDist && (best === null || d < bestDist - 1e-9)) {
      bestDist = d;
      best = ent;
    }
  }
  return best;
}
