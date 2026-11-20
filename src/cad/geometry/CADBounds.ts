import type {
  BoundingBox2D,
  CADBlock,
  CADDocument,
  CADEntity,
  Point2D,
  Point3D
} from '../core/CADTypes';
import { isCADLayerVisible } from '../core/CADDocument';
import { Affine2D, IDENTITY_2D, applyAffine2D, buildInsertTransform2D } from '../core/CADTransform';
import {
  tessellateArc,
  tessellateEllipse,
  tessellatePolyline,
  tessellateSpline
} from './CADCurve';

export function emptyBounds(): BoundingBox2D {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
}

export function isValidBounds(b?: BoundingBox2D | null): b is BoundingBox2D {
  return Boolean(
    b &&
      Number.isFinite(b.minX) &&
      Number.isFinite(b.minY) &&
      Number.isFinite(b.maxX) &&
      Number.isFinite(b.maxY)
  );
}

export function expandBoundsPoint(b: BoundingBox2D, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}

export function mergeBounds(a: BoundingBox2D, b: BoundingBox2D): BoundingBox2D {
  if (!isValidBounds(a)) return { ...b };
  if (!isValidBounds(b)) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

export function boundsIntersect(a: BoundingBox2D, b: BoundingBox2D): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function boundsContainedIn(inner: BoundingBox2D, outer: BoundingBox2D): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  );
}

function expandTransformedPoints(b: BoundingBox2D, pts: Point2D[], m: Affine2D): void {
  for (const p of pts) {
    const tp = applyAffine2D(m, p);
    expandBoundsPoint(b, tp.x, tp.y);
  }
}

export function computeEntityBounds2D(
  entity: CADEntity,
  blocks?: Record<string, CADBlock>,
  transform: Affine2D = IDENTITY_2D,
  depth = 0,
  visitingBlocks?: Set<string>
): BoundingBox2D {
  const b = emptyBounds();

  switch (entity.type) {
    case 'LINE':
      expandTransformedPoints(b, [entity.start, entity.end], transform);
      break;
    case 'POINT':
      expandTransformedPoints(b, [entity.position], transform);
      break;
    case 'CIRCLE': {
      const r = Math.max(0, entity.radius);
      const pts: Point2D[] = [
        { x: entity.center.x - r, y: entity.center.y - r },
        { x: entity.center.x + r, y: entity.center.y - r },
        { x: entity.center.x + r, y: entity.center.y + r },
        { x: entity.center.x - r, y: entity.center.y + r }
      ];
      expandTransformedPoints(b, pts, transform);
      break;
    }
    case 'ARC': {
      const pts = tessellateArc(entity.center, entity.radius, entity.startAngle, entity.endAngle, 24);
      expandTransformedPoints(b, pts, transform);
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = tessellatePolyline(entity.vertices, entity.closed, 12);
      expandTransformedPoints(b, pts, transform);
      break;
    }
    case 'SPLINE': {
      const pts = tessellateSpline(entity, 32);
      expandTransformedPoints(b, pts, transform);
      break;
    }
    case 'ELLIPSE': {
      const pts = tessellateEllipse(entity, 32);
      expandTransformedPoints(b, pts, transform);
      break;
    }
    case 'HATCH': {
      for (const loop of entity.boundaryLoops) {
        expandTransformedPoints(b, loop, transform);
      }
      break;
    }
    case 'SOLID': {
      expandTransformedPoints(b, entity.points, transform);
      break;
    }
    case '3DFACE': {
      expandTransformedPoints(b, entity.vertices, transform);
      break;
    }
    case 'TEXT':
    case 'ATTRIB':
    case 'ATTDEF': {
      const h = Math.max(1, entity.height || 2.5);
      const len = Math.max(1, (entity.text || ' ').length);
      const w = len * h * 0.65 * (entity.type === 'TEXT' ? entity.widthFactor || 1 : 1);
      const rad = ((entity.rotation || 0) * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const p0 = entity.position;
      let minLx = 0;
      let maxLx = w;
      if (entity.type === 'TEXT') {
        if (entity.hAlign === 1 || entity.hAlign === 4) {
          minLx = -w / 2;
          maxLx = w / 2;
        } else if (entity.hAlign === 2) {
          minLx = -w;
          maxLx = 0;
        }
      }
      expandTransformedPoints(
        b,
        [
          { x: p0.x + minLx * c, y: p0.y + minLx * s },
          { x: p0.x + maxLx * c, y: p0.y + maxLx * s },
          { x: p0.x + minLx * c - h * s, y: p0.y + minLx * s + h * c },
          { x: p0.x + maxLx * c - h * s, y: p0.y + maxLx * s + h * c }
        ],
        transform
      );
      break;
    }
    case 'MTEXT': {
      const h = Math.max(1, entity.height || 2.5);
      const lines = (entity.plainText || ' ').split('\n');
      const maxChars = lines.reduce((m, l) => Math.max(m, l.length), 1);
      const w = entity.width > 0 ? entity.width : maxChars * h * 0.65;
      const totalH = lines.length * h * 1.35;
      const rad = ((entity.rotation || 0) * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const p0 = entity.position;
      const att = entity.attachmentPoint || 1;
      const col = (att - 1) % 3; // 0=left, 1=center, 2=right
      const row = Math.floor((att - 1) / 3); // 0=top, 1=middle, 2=bottom
      const minLx = col === 0 ? 0 : col === 1 ? -w / 2 : -w;
      const maxLx = minLx + w;
      const maxLy = row === 0 ? 0 : row === 1 ? totalH / 2 : totalH;
      const minLy = maxLy - totalH;
      expandTransformedPoints(
        b,
        [
          { x: p0.x + minLx * c - minLy * s, y: p0.y + minLx * s + minLy * c },
          { x: p0.x + maxLx * c - minLy * s, y: p0.y + maxLx * s + minLy * c },
          { x: p0.x + minLx * c - maxLy * s, y: p0.y + minLx * s + maxLy * c },
          { x: p0.x + maxLx * c - maxLy * s, y: p0.y + maxLx * s + maxLy * c }
        ],
        transform
      );
      break;
    }
    case 'DIMENSION': {
      const anchorPts: Point3D[] = [];
      if (entity.defPoint2) anchorPts.push(entity.defPoint2);
      if (entity.defPoint3) anchorPts.push(entity.defPoint3);
      if (entity.defPoint4) anchorPts.push(entity.defPoint4);

      const isNearOrigin = (pt: Point3D) => Math.hypot(pt.x, pt.y) < 1e-3;
      const anchorBounds = emptyBounds();
      for (const ap of anchorPts) expandBoundsPoint(anchorBounds, ap.x, ap.y);

      const skipOriginDefPoint =
        isValidBounds(anchorBounds) &&
        isNearOrigin(entity.defPoint) &&
        Math.hypot(
          (anchorBounds.minX + anchorBounds.maxX) / 2,
          (anchorBounds.minY + anchorBounds.maxY) / 2
        ) > 250;

      const pts: Point3D[] = [];
      if (!skipOriginDefPoint) pts.push(entity.defPoint);
      if (!(isNearOrigin(entity.textMidPoint) && skipOriginDefPoint)) {
        pts.push(entity.textMidPoint);
      }
      pts.push(...anchorPts);
      expandTransformedPoints(b, pts, transform);
      break;
    }
    case 'LEADER':
    case 'MLEADER': {
      expandTransformedPoints(b, entity.vertices, transform);
      break;
    }
    case 'INSERT': {
      expandTransformedPoints(b, [entity.position], transform);
      if (blocks && depth < 32) {
        const blk = blocks[entity.blockName];
        const stack = visitingBlocks || new Set<string>();
        if (blk && !stack.has(entity.blockName)) {
          stack.add(entity.blockName);
          const mLocal = buildInsertTransform2D(
            entity.position,
            entity.scale,
            entity.rotation,
            blk.basePoint
          );
          const combined: Affine2D = [
            transform[0] * mLocal[0] + transform[2] * mLocal[1],
            transform[1] * mLocal[0] + transform[3] * mLocal[1],
            transform[0] * mLocal[2] + transform[2] * mLocal[3],
            transform[1] * mLocal[2] + transform[3] * mLocal[3],
            transform[0] * mLocal[4] + transform[2] * mLocal[5] + transform[4],
            transform[1] * mLocal[4] + transform[3] * mLocal[5] + transform[5]
          ];
          for (const sub of blk.entities) {
            const subB = computeEntityBounds2D(sub, blocks, combined, depth + 1, stack);
            if (isValidBounds(subB)) {
              expandBoundsPoint(b, subB.minX, subB.minY);
              expandBoundsPoint(b, subB.maxX, subB.maxY);
            }
          }
          stack.delete(entity.blockName);
        }
      }
      if (entity.attributes) {
        for (const att of entity.attributes) {
          expandTransformedPoints(b, [att.position], transform);
        }
      }
      break;
    }
    case 'UNKNOWN': {
      if (entity.dxfType === 'VIEWPORT' && entity.previewPoint && entity.rawDxf) {
        const w = Number(entity.rawDxf.find(p => p.code === 40)?.value) || 0;
        const h = Number(entity.rawDxf.find(p => p.code === 41)?.value) || 0;
        if (w > 0 && h > 0) {
          expandTransformedPoints(
            b,
            [
              { x: entity.previewPoint.x - w / 2, y: entity.previewPoint.y - h / 2 },
              { x: entity.previewPoint.x + w / 2, y: entity.previewPoint.y + h / 2 }
            ],
            transform
          );
          break;
        }
      }
      if (entity.previewPoint) {
        expandTransformedPoints(b, [entity.previewPoint], transform);
      }
      break;
    }
  }

  return b;
}

export function recomputeDocumentExtents(doc: Pick<CADDocument, 'entities' | 'blocks'>): BoundingBox2D {
  let acc = emptyBounds();
  for (const ent of doc.entities) {
    const eb = computeEntityBounds2D(ent, doc.blocks);
    ent.bounds = isValidBounds(eb) ? eb : undefined;
    if (isValidBounds(eb)) {
      acc = mergeBounds(acc, eb);
    }
  }
  if (!isValidBounds(acc)) {
    return { minX: 0, minY: 0, maxX: 10000, maxY: 8000 };
  }
  return acc;
}

export function computeEntitiesBoundingBox(
  entities: CADEntity[],
  blocks?: Record<string, CADBlock>
): BoundingBox2D {
  let acc = emptyBounds();
  for (const ent of entities) {
    const eb = computeEntityBounds2D(ent, blocks);
    if (isValidBounds(eb)) {
      acc = mergeBounds(acc, eb);
    }
  }
  if (!isValidBounds(acc)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return acc;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Computes robust visible-cluster bounds for Zoom-Fit, Minimap, and HTML/SVG export.
 * Excludes hidden/frozen layers, Paper Space helpers (when model space exists),
 * and extreme stray outlier geometry (e.g. stray (0,0) anchors or infinite axis lines)
 * that otherwise shrink real drawings into a tiny unreadable speck.
 */
export function computeSmartFitExtents(
  doc: Pick<CADDocument, 'entities' | 'blocks' | 'layers' | 'extents'>,
  options?: { excludeOutliers?: boolean; space?: 'model' | 'paper' }
): BoundingBox2D {
  const excludeOutliers = options?.excludeOutliers !== false;
  const targetSpace = options?.space ?? 'model';

  let candidates = doc.entities.filter(
    e =>
      e.visible !== false &&
      (targetSpace === 'paper' ? e.space === 'paper' : e.space !== 'paper') &&
      isCADLayerVisible(doc as CADDocument, e.layer)
  );
  if (candidates.length === 0 && targetSpace === 'model') {
    candidates = doc.entities.filter(
      e => e.visible !== false && isCADLayerVisible(doc as CADDocument, e.layer)
    );
  }
  if (candidates.length === 0) {
    candidates = doc.entities.filter(e =>
      targetSpace === 'paper' ? e.space === 'paper' : true
    );
  }

  const boxes: BoundingBox2D[] = [];
  let visibleRaw = emptyBounds();

  for (const ent of candidates) {
    const eb =
      ent.bounds && isValidBounds(ent.bounds)
        ? ent.bounds
        : computeEntityBounds2D(ent, doc.blocks);
    if (!isValidBounds(eb)) continue;
    boxes.push(eb);
    visibleRaw = mergeBounds(visibleRaw, eb);
  }

  if (!isValidBounds(visibleRaw)) {
    return isValidBounds(doc.extents)
      ? { ...doc.extents }
      : { minX: 0, minY: 0, maxX: 10000, maxY: 8000 };
  }

  if (!excludeOutliers || boxes.length < 6) {
    return visibleRaw;
  }

  const cxs = boxes.map(b => (b.minX + b.maxX) / 2).sort((a, b) => a - b);
  const cys = boxes.map(b => (b.minY + b.maxY) / 2).sort((a, b) => a - b);

  const q05X = quantile(cxs, 0.05);
  const q95X = quantile(cxs, 0.95);
  const q25X = quantile(cxs, 0.25);
  const q75X = quantile(cxs, 0.75);

  const q05Y = quantile(cys, 0.05);
  const q95Y = quantile(cys, 0.95);
  const q25Y = quantile(cys, 0.25);
  const q75Y = quantile(cys, 0.75);

  const coreSpanX = Math.max(1e-3, q95X - q05X, (q75X - q25X) * 1.5);
  const coreSpanY = Math.max(1e-3, q95Y - q05Y, (q75Y - q25Y) * 1.5);
  const coreSize = Math.max(coreSpanX, coreSpanY, 1);

  // Conservative outlier tolerances: keep multi-zone/asymmetric drawing halves intact
  // and only discard genuine extreme stray entities (e.g. stray (0,0) anchors or +/-50000 crosses).
  const marginX = Math.max(coreSpanX * 2.5, coreSize * 2.0);
  const marginY = Math.max(coreSpanY * 2.5, coreSize * 2.0);
  const maxEntitySpan = coreSize * 6.0;

  let cluster = emptyBounds();
  let kept = 0;

  for (const eb of boxes) {
    const cx = (eb.minX + eb.maxX) / 2;
    const cy = (eb.minY + eb.maxY) / 2;
    const span = Math.max(eb.maxX - eb.minX, eb.maxY - eb.minY);
    if (
      span <= maxEntitySpan &&
      cx >= q05X - marginX &&
      cx <= q95X + marginX &&
      cy >= q05Y - marginY &&
      cy <= q95Y + marginY &&
      eb.minX >= q05X - marginX * 1.6 &&
      eb.maxX <= q95X + marginX * 1.6 &&
      eb.minY >= q05Y - marginY * 1.6 &&
      eb.maxY <= q95Y + marginY * 1.6
    ) {
      cluster = mergeBounds(cluster, eb);
      kept++;
    }
  }

  if (kept >= Math.max(3, Math.floor(boxes.length * 0.85)) && isValidBounds(cluster)) {
    const visW = Math.max(1e-3, visibleRaw.maxX - visibleRaw.minX);
    const visH = Math.max(1e-3, visibleRaw.maxY - visibleRaw.minY);
    const clusW = Math.max(1e-3, cluster.maxX - cluster.minX);
    const clusH = Math.max(1e-3, cluster.maxY - cluster.minY);
    if (clusW < visW * 0.5 || clusH < visH * 0.5) {
      return cluster;
    }
  }

  return visibleRaw;
}

export function areExtentsSignificantlyDifferent(a: BoundingBox2D, b: BoundingBox2D): boolean {
  if (!isValidBounds(a) || !isValidBounds(b)) return false;
  const wa = Math.max(1e-3, a.maxX - a.minX);
  const ha = Math.max(1e-3, a.maxY - a.minY);
  const wb = Math.max(1e-3, b.maxX - b.minX);
  const hb = Math.max(1e-3, b.maxY - b.minY);
  const ratioW = Math.max(wa / wb, wb / wa);
  const ratioH = Math.max(ha / hb, hb / ha);
  return ratioW > 1.6 || ratioH > 1.6;
}

