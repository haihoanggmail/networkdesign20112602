import { DEFAULT_CAD_SNAP_SETTINGS, isCADLayerVisible } from '../core/CADDocument';
import { cadPointToNetworkCanvas, networkCanvasToCadPoint } from '../core/CADUnderlayTransform';
import type { CADDocument, CADEntity, Point2D } from '../core/CADTypes';
import { computeEntityBounds2D, isValidBounds } from './CADBounds';
import { findBestSnapPoint } from './CADSnap';

export interface CADUnderlaySnapResult {
  point: Point2D;
  cadPoint: Point2D;
  mode: string;
  labelVi: string;
  entityId?: string;
}

/**
 * Snaps a HACHIHI Network Canvas coordinate onto visible Model-Space AutoCAD underlay geometry
 * (walls, corridors, racks/blocks, arcs, intersections) within `toleranceCanvasPx`.
 */
export function snapCanvasPointToCadUnderlay(
  canvasPt: Point2D,
  cadDoc: CADDocument | null | undefined,
  toleranceCanvasPx = 10
): CADUnderlaySnapResult | null {
  if (!cadDoc || !cadDoc.underlay.enabled || cadDoc.entities.length === 0) {
    return null;
  }
  const scale = cadDoc.underlay.scaleToCanvasPx;
  if (!Number.isFinite(scale) || scale <= 1e-8) return null;

  const cadPt = networkCanvasToCadPoint(canvasPt, cadDoc.underlay);
  const tolWorld = Math.max(1e-3, toleranceCanvasPx / scale);
  const searchPad = tolWorld * 2.5;

  const nearby: CADEntity[] = [];
  for (let i = 0; i < cadDoc.entities.length; i++) {
    const ent = cadDoc.entities[i];
    if (ent.visible === false || ent.space === 'paper') continue;
    if (!isCADLayerVisible(cadDoc, ent.layer)) continue;

    const b = ent.bounds && isValidBounds(ent.bounds) ? ent.bounds : computeEntityBounds2D(ent, cadDoc.blocks);
    if (!isValidBounds(b)) continue;
    if (
      cadPt.x < b.minX - searchPad ||
      cadPt.x > b.maxX + searchPad ||
      cadPt.y < b.minY - searchPad ||
      cadPt.y > b.maxY + searchPad
    ) {
      continue;
    }
    nearby.push(ent);
    if (nearby.length >= 250) break;
  }

  if (nearby.length === 0) return null;

  const hit = findBestSnapPoint(cadDoc, cadPt, tolWorld, DEFAULT_CAD_SNAP_SETTINGS, {
    candidateEntities: nearby
  });
  if (!hit) return null;

  return {
    point: cadPointToNetworkCanvas(hit.point, cadDoc.underlay),
    cadPoint: hit.point,
    mode: hit.mode,
    labelVi: hit.labelVi,
    entityId: hit.entityId
  };
}
