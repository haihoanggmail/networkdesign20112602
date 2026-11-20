import type { CADDocument, CADUnderlayAlignment, CADUnitCode, Point2D } from './CADTypes';
import { computeMetersPerCanvasPx, convertCADDistanceToMeters, getCADUnitMeta } from './CADUnits';
import {
  MIN_SCALE_PX_PER_METER,
  normalizeScalePxPerMeter,
  roundScalePxPerMeter
} from '../../utils/scaleUtils';

/**
 * Forward transform: CAD World coordinates (Y-up) -> HACHIHI Network Canvas coordinates (Y-down px).
 */
export function cadPointToNetworkCanvas(
  pt: Point2D,
  underlay: Pick<CADUnderlayAlignment, 'offsetX' | 'offsetY' | 'scaleToCanvasPx' | 'rotationDeg'>
): Point2D {
  const s = Number.isFinite(underlay.scaleToCanvasPx) && Math.abs(underlay.scaleToCanvasPx) > 1e-8
    ? underlay.scaleToCanvasPx
    : 0.05;
  const rad = ((underlay.rotationDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  const sx = pt.x * s;
  const sy = -pt.y * s;
  return {
    x: sx * c - sy * sn + (underlay.offsetX || 0),
    y: sx * sn + sy * c + (underlay.offsetY || 0)
  };
}

/**
 * Exact inverse transform: HACHIHI Network Canvas coordinates (Y-down px) -> CAD World coordinates (Y-up).
 */
export function networkCanvasToCadPoint(
  canvasPt: Point2D,
  underlay: Pick<CADUnderlayAlignment, 'offsetX' | 'offsetY' | 'scaleToCanvasPx' | 'rotationDeg'>
): Point2D {
  const s = Number.isFinite(underlay.scaleToCanvasPx) && Math.abs(underlay.scaleToCanvasPx) > 1e-8
    ? underlay.scaleToCanvasPx
    : 0.05;
  const rad = -((underlay.rotationDeg || 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  const dx = canvasPt.x - (underlay.offsetX || 0);
  const dy = canvasPt.y - (underlay.offsetY || 0);
  const sx = dx * c - dy * sn;
  const sy = dx * sn + dy * c;
  return {
    x: sx / s,
    y: -sy / s
  };
}

/**
 * Derives HACHIHI Network Canvas `settings.scale` (pixels per 1 meter) from the active
 * CAD document's `$INSUNITS` and `underlay.scaleToCanvasPx`.
 * Returns `null` for unitless (`$INSUNITS === 0`) or invalid scales.
 */
export function computeNetworkPxPerMeterFromCad(
  cadDoc: Pick<CADDocument, 'header' | 'underlay'> | null | undefined
): number | null {
  if (!cadDoc) return null;
  const unitCode = cadDoc.header.$INSUNITS;
  if (unitCode === 0) return null;
  const s = cadDoc.underlay.scaleToCanvasPx;
  if (!Number.isFinite(s) || s <= 1e-8) return null;
  const meta = getCADUnitMeta(unitCode);
  if (!Number.isFinite(meta.metersPerUnit) || meta.metersPerUnit <= 0) return null;
  const pxPerMeter = s / meta.metersPerUnit;
  if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return null;
  return roundScalePxPerMeter(pxPerMeter, 4);
}

/**
 * Inverse conversion: derives CAD `underlay.scaleToCanvasPx` (canvas pixels per 1 CAD unit)
 * from HACHIHI Network Canvas `settings.scale` (px per 1 meter) and `$INSUNITS`.
 */
export function computeCadUnderlayScaleFromNetworkPxPerMeter(
  pxPerMeter: number,
  unitCode: CADUnitCode
): number | null {
  if (unitCode === 0) return null;
  if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return null;
  const meta = getCADUnitMeta(unitCode);
  if (!Number.isFinite(meta.metersPerUnit) || meta.metersPerUnit <= 0) return null;
  const scaleToCanvasPx = pxPerMeter * meta.metersPerUnit;
  if (!Number.isFinite(scaleToCanvasPx) || scaleToCanvasPx <= 1e-8) return null;
  return Number(scaleToCanvasPx.toFixed(6));
}

export interface CadNetworkScaleConsistency {
  hasUnit: boolean;
  unitCode: CADUnitCode;
  unitShortLabel: string;
  cadPxPerMeter: number | null;
  projectPxPerMeter: number;
  metersPerCanvasPx: number | null;
  deltaRatio: number;
  consistent: boolean;
}

/**
 * Checks whether ProjectState's `settings.scale` (`px/m`) matches the active CAD underlay's
 * `$INSUNITS` + `scaleToCanvasPx` within `toleranceRatio` (default 1.5%).
 */
export function checkCadNetworkScaleConsistency(
  cadDoc: Pick<CADDocument, 'header' | 'underlay'> | null | undefined,
  projectScalePxPerMeter: number,
  toleranceRatio = 0.015
): CadNetworkScaleConsistency {
  const safeProjectScale = normalizeScalePxPerMeter(projectScalePxPerMeter);
  if (!cadDoc) {
    return {
      hasUnit: false,
      unitCode: 0,
      unitShortLabel: 'unit',
      cadPxPerMeter: null,
      projectPxPerMeter: safeProjectScale,
      metersPerCanvasPx: null,
      deltaRatio: 0,
      consistent: true
    };
  }
  const unitCode = cadDoc.header.$INSUNITS;
  const meta = getCADUnitMeta(unitCode);
  const cadPxPerMeter = computeNetworkPxPerMeterFromCad(cadDoc);
  const metersPerCanvasPx = computeMetersPerCanvasPx(cadDoc.underlay.scaleToCanvasPx, unitCode);
  if (cadPxPerMeter === null) {
    return {
      hasUnit: false,
      unitCode,
      unitShortLabel: meta.shortLabel,
      cadPxPerMeter: null,
      projectPxPerMeter: safeProjectScale,
      metersPerCanvasPx: null,
      deltaRatio: 0,
      consistent: false
    };
  }
  const deltaRatio = Math.abs(safeProjectScale - cadPxPerMeter) / Math.max(MIN_SCALE_PX_PER_METER, cadPxPerMeter);
  return {
    hasUnit: true,
    unitCode,
    unitShortLabel: meta.shortLabel,
    cadPxPerMeter,
    projectPxPerMeter: safeProjectScale,
    metersPerCanvasPx,
    deltaRatio: Number(deltaRatio.toFixed(6)),
    consistent: deltaRatio <= toleranceRatio
  };
}

/**
 * Computes real distance between two HACHIHI Network Canvas points directly in the linked
 * CAD drawing's native `$INSUNITS` and meters.
 */
export function computeCadUnderlayDistance(
  cadDoc: Pick<CADDocument, 'header' | 'underlay'>,
  aCanvas: Point2D,
  bCanvas: Point2D
): { cadUnits: number; meters: number; unitShortLabel: string } {
  const cadA = networkCanvasToCadPoint(aCanvas, cadDoc.underlay);
  const cadB = networkCanvasToCadPoint(bCanvas, cadDoc.underlay);
  const cadUnits = Math.hypot(cadB.x - cadA.x, cadB.y - cadA.y);
  const meta = getCADUnitMeta(cadDoc.header.$INSUNITS);
  const meters = convertCADDistanceToMeters(cadUnits, cadDoc.header.$INSUNITS);
  return { cadUnits, meters, unitShortLabel: meta.shortLabel };
}
