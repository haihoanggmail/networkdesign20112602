import type { ProjectState } from '../../types/infrastructure';
import type { CADDocument } from './CADTypes';
import { computeNetworkPxPerMeterFromCad } from './CADUnderlayTransform';

export type CadScaleSyncReason =
  | 'open'
  | 'settings'
  | 'command'
  | 'undo'
  | 'redo'
  | 'autofit'
  | 'apply';

export interface ResolveCadScaleSyncOptions {
  reason?: CadScaleSyncReason;
  expectedProjectId?: string;
}

/**
 * Deterministically decides whether transitioning `prevDoc -> nextDoc` requires syncing
 * `project.settings.scale` (`px/m`) from the CAD document's `$INSUNITS` and `underlay.scaleToCanvasPx`.
 * Pure function with zero React/closure side effects.
 */
export function resolveCadScaleSyncEffect(
  prevDoc: CADDocument | null,
  nextDoc: CADDocument | null,
  options?: ResolveCadScaleSyncOptions
): number | null {
  if (!nextDoc) return null;
  if (
    options?.expectedProjectId &&
    nextDoc.projectId &&
    nextDoc.projectId !== options.expectedProjectId
  ) {
    return null;
  }

  const reason = options?.reason ?? 'settings';
  if (!nextDoc.underlay.enabled) {
    return null;
  }

  const pxPerMeter = computeNetworkPxPerMeterFromCad(nextDoc);
  if (pxPerMeter === null) return null;

  if (reason === 'open' || reason === 'autofit' || reason === 'apply') {
    return pxPerMeter;
  }

  if (!prevDoc) {
    return pxPerMeter;
  }

  const unitsChanged = prevDoc.header.$INSUNITS !== nextDoc.header.$INSUNITS;
  const scaleChanged =
    Math.abs((prevDoc.underlay.scaleToCanvasPx || 0) - (nextDoc.underlay.scaleToCanvasPx || 0)) > 1e-8;
  const underlayJustEnabled = !prevDoc.underlay.enabled && nextDoc.underlay.enabled;

  if (unitsChanged || scaleChanged || underlayJustEnabled) {
    return pxPerMeter;
  }

  return null;
}

/**
 * Computes an auto-fitted CAD underlay alignment matching the active floor's network rooms/nodes.
 */
export function computeAutoFitUnderlayDoc(
  doc: CADDocument,
  project: Pick<ProjectState, 'activeFloorId' | 'rooms' | 'nodes'>
): CADDocument {
  const ext = doc.extents;
  const cadW = Math.max(1e-3, ext.maxX - ext.minX);
  const cadH = Math.max(1e-3, ext.maxY - ext.minY);
  const cadCenterX = (ext.minX + ext.maxX) / 2;
  const cadCenterY = (ext.minY + ext.maxY) / 2;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of project.rooms) {
    if (project.activeFloorId && room.floorId && room.floorId !== project.activeFloorId) continue;
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.width);
    maxY = Math.max(maxY, room.y + room.height);
  }
  for (const node of project.nodes) {
    if (node.hidden) continue;
    if (project.activeFloorId && node.floorId && node.floorId !== project.activeFloorId) continue;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  if (!Number.isFinite(minX) || maxX - minX < 40 || maxY - minY < 40) {
    minX = 120;
    minY = 80;
    maxX = 1080;
    maxY = 720;
  }

  const targetW = Math.max(200, maxX - minX);
  const targetH = Math.max(200, maxY - minY);
  const targetCenterX = (minX + maxX) / 2;
  const targetCenterY = (minY + maxY) / 2;

  const s = Math.max(1e-5, Math.min(100, Math.min(targetW / cadW, targetH / cadH)));
  return {
    ...doc,
    underlay: {
      ...doc.underlay,
      enabled: true,
      rotationDeg: 0,
      scaleToCanvasPx: Number(s.toFixed(6)),
      offsetX: Math.round(targetCenterX - cadCenterX * s),
      offsetY: Math.round(targetCenterY + cadCenterY * s)
    },
    updatedAt: new Date().toISOString()
  };
}
