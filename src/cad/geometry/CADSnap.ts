import type {
  CADBlock,
  CADDocument,
  CADEntity,
  CADSnapMode,
  CADSnapSettings,
  Point2D
} from '../core/CADTypes';
import { applyAffine2D, buildInsertTransform2D } from '../core/CADTransform';
import { getArcEndpoints, tessellatePolyline } from './CADCurve';
import { distancePointToSegment2D } from './CADGeometry';
import { entityToLineSegments, findEntityIntersections } from './CADIntersection';

export interface CADSnapResult {
  point: Point2D;
  mode: CADSnapMode | 'grid' | 'ortho' | 'polar';
  entityId?: string;
  labelVi: string;
}

const SNAP_LABELS_VI: Record<CADSnapResult['mode'], string> = {
  endpoint: 'Điểm đầu/cuối (Endpoint)',
  midpoint: 'Trung điểm (Midpoint)',
  center: 'Tâm (Center)',
  intersection: 'Giao điểm (Intersection)',
  perpendicular: 'Vuông góc (Perpendicular)',
  quadrant: 'Điểm phần tư (Quadrant)',
  nearest: 'Điểm gần nhất (Nearest)',
  insertion: 'Điểm chèn (Insertion)',
  grid: 'Lưới (Grid)',
  ortho: 'Thẳng góc (Ortho)',
  polar: 'Góc cực (Polar)'
};

function collectEntitySnapTargets(
  entity: CADEntity,
  blocks?: Record<string, CADBlock>,
  cursor?: Point2D,
  basePoint?: Point2D
): Array<{ point: Point2D; mode: CADSnapMode }> {
  const targets: Array<{ point: Point2D; mode: CADSnapMode }> = [];

  switch (entity.type) {
    case 'LINE': {
      targets.push({ point: entity.start, mode: 'endpoint' });
      targets.push({ point: entity.end, mode: 'endpoint' });
      targets.push({
        point: {
          x: (entity.start.x + entity.end.x) / 2,
          y: (entity.start.y + entity.end.y) / 2
        },
        mode: 'midpoint'
      });
      if (basePoint) {
        const dx = entity.end.x - entity.start.x;
        const dy = entity.end.y - entity.start.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq > 1e-8) {
          const t = ((basePoint.x - entity.start.x) * dx + (basePoint.y - entity.start.y) * dy) / lenSq;
          if (t >= 0 && t <= 1) {
            targets.push({
              point: { x: entity.start.x + t * dx, y: entity.start.y + t * dy },
              mode: 'perpendicular'
            });
          }
        }
      }
      if (cursor) {
        const nearest = distancePointToSegment2D(cursor, entity.start, entity.end).closest;
        targets.push({ point: nearest, mode: 'nearest' });
      }
      break;
    }
    case 'CIRCLE': {
      const { center, radius } = entity;
      targets.push({ point: center, mode: 'center' });
      targets.push({ point: { x: center.x + radius, y: center.y }, mode: 'quadrant' });
      targets.push({ point: { x: center.x - radius, y: center.y }, mode: 'quadrant' });
      targets.push({ point: { x: center.x, y: center.y + radius }, mode: 'quadrant' });
      targets.push({ point: { x: center.x, y: center.y - radius }, mode: 'quadrant' });
      if (cursor) {
        const ang = Math.atan2(cursor.y - center.y, cursor.x - center.x);
        targets.push({
          point: { x: center.x + radius * Math.cos(ang), y: center.y + radius * Math.sin(ang) },
          mode: 'nearest'
        });
      }
      break;
    }
    case 'ARC': {
      const ends = getArcEndpoints(entity);
      targets.push({ point: ends.start, mode: 'endpoint' });
      targets.push({ point: ends.end, mode: 'endpoint' });
      targets.push({ point: ends.mid, mode: 'midpoint' });
      targets.push({ point: entity.center, mode: 'center' });
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const pts = tessellatePolyline(entity.vertices, entity.closed, 8);
      for (const v of entity.vertices) {
        targets.push({ point: { x: v.x, y: v.y }, mode: 'endpoint' });
      }
      for (let i = 0; i < pts.length - 1; i++) {
        targets.push({
          point: { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 },
          mode: 'midpoint'
        });
        if (cursor) {
          targets.push({
            point: distancePointToSegment2D(cursor, pts[i], pts[i + 1]).closest,
            mode: 'nearest'
          });
        }
      }
      break;
    }
    case 'POINT':
      targets.push({ point: entity.position, mode: 'endpoint' });
      break;
    case 'TEXT':
    case 'MTEXT':
    case 'ATTRIB':
    case 'ATTDEF':
      targets.push({ point: entity.position, mode: 'insertion' });
      break;
    case 'INSERT': {
      targets.push({ point: entity.position, mode: 'insertion' });
      const blk = blocks?.[entity.blockName];
      if (blk) {
        const m = buildInsertTransform2D(entity.position, entity.scale, entity.rotation, blk.basePoint);
        for (const sub of blk.entities.slice(0, 64)) {
          if (sub.type === 'LINE') {
            const a = applyAffine2D(m, sub.start);
            const b = applyAffine2D(m, sub.end);
            targets.push({ point: a, mode: 'endpoint' });
            targets.push({ point: b, mode: 'endpoint' });
            targets.push({ point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, mode: 'midpoint' });
          } else if (sub.type === 'CIRCLE') {
            targets.push({ point: applyAffine2D(m, sub.center), mode: 'center' });
          }
        }
      }
      break;
    }
    case 'DIMENSION':
      targets.push({ point: entity.defPoint, mode: 'endpoint' });
      if (entity.defPoint2) targets.push({ point: entity.defPoint2, mode: 'endpoint' });
      if (entity.defPoint3) targets.push({ point: entity.defPoint3, mode: 'endpoint' });
      break;
    case 'LEADER':
    case 'MLEADER':
      for (const v of entity.vertices) {
        targets.push({ point: v, mode: 'endpoint' });
      }
      break;
    default:
      break;
  }
  return targets;
}

export function findBestSnapPoint(
  doc: CADDocument,
  cursorWorld: Point2D,
  toleranceWorld: number,
  settings: CADSnapSettings,
  options?: {
    candidateEntities?: CADEntity[];
    basePoint?: Point2D;
  }
): CADSnapResult | null {
  const candidates = options?.candidateEntities || doc.entities;

  if (settings.enabled) {
    let best: CADSnapResult | null = null;
    let bestScore = Infinity;

    const priorityBonus: Record<CADSnapMode, number> = {
      endpoint: 0,
      intersection: 0.05,
      midpoint: 0.1,
      center: 0.12,
      insertion: 0.14,
      quadrant: 0.18,
      perpendicular: 0.2,
      nearest: 0.55
    };

    const maxInspect = Math.min(candidates.length, 250);
    const nearby: CADEntity[] = [];

    for (let i = 0; i < maxInspect; i++) {
      const ent = candidates[i];
      if (ent.visible === false) continue;
      const layer = doc.layers[ent.layer];
      if (layer && (!layer.visible || layer.frozen)) continue;
      nearby.push(ent);

      const targets = collectEntitySnapTargets(ent, doc.blocks, cursorWorld, options?.basePoint);
      for (const t of targets) {
        if (!settings.modes[t.mode]) continue;
        const d = Math.hypot(t.point.x - cursorWorld.x, t.point.y - cursorWorld.y);
        if (d <= toleranceWorld) {
          const score = d / Math.max(toleranceWorld, 1e-6) + priorityBonus[t.mode];
          if (score < bestScore) {
            bestScore = score;
            best = {
              point: t.point,
              mode: t.mode,
              entityId: ent.id,
              labelVi: SNAP_LABELS_VI[t.mode]
            };
          }
        }
      }
    }

    // Intersection OSNAP between nearby candidates
    if (settings.modes.intersection && nearby.length >= 2) {
      const pairCap = Math.min(nearby.length, 40);
      for (let i = 0; i < pairCap; i++) {
        for (let j = i + 1; j < pairCap; j++) {
          if (entityToLineSegments(nearby[i]).length === 0 && nearby[i].type !== 'CIRCLE') continue;
          const hits = findEntityIntersections(nearby[i], nearby[j]);
          for (const pt of hits) {
            const d = Math.hypot(pt.x - cursorWorld.x, pt.y - cursorWorld.y);
            if (d <= toleranceWorld) {
              const score = d / Math.max(toleranceWorld, 1e-6) + priorityBonus.intersection;
              if (score < bestScore) {
                bestScore = score;
                best = {
                  point: pt,
                  mode: 'intersection',
                  entityId: nearby[i].id,
                  labelVi: SNAP_LABELS_VI.intersection
                };
              }
            }
          }
        }
      }
    }

    if (best) return best;
  }

  // Ortho / Polar constraint relative to basePoint
  if (options?.basePoint && (settings.ortho || settings.polar)) {
    const dx = cursorWorld.x - options.basePoint.x;
    const dy = cursorWorld.y - options.basePoint.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-6) {
      if (settings.ortho) {
        const pt =
          Math.abs(dx) >= Math.abs(dy)
            ? { x: cursorWorld.x, y: options.basePoint.y }
            : { x: options.basePoint.x, y: cursorWorld.y };
        return { point: pt, mode: 'ortho', labelVi: SNAP_LABELS_VI.ortho };
      }
      if (settings.polar) {
        const angleRad = Math.atan2(dy, dx);
        const step = Math.PI / 4; // 45 deg increments
        const snapped = Math.round(angleRad / step) * step;
        if (Math.abs(angleRad - snapped) < (8 * Math.PI) / 180) {
          return {
            point: {
              x: options.basePoint.x + dist * Math.cos(snapped),
              y: options.basePoint.y + dist * Math.sin(snapped)
            },
            mode: 'polar',
            labelVi: SNAP_LABELS_VI.polar
          };
        }
      }
    }
  }

  if (settings.gridSnap && settings.gridSpacing > 0) {
    const step = settings.gridSpacing;
    return {
      point: {
        x: Math.round(cursorWorld.x / step) * step,
        y: Math.round(cursorWorld.y / step) * step
      },
      mode: 'grid',
      labelVi: SNAP_LABELS_VI.grid
    };
  }

  return null;
}
