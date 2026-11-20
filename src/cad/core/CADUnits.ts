import type { CADUnitCode } from './CADTypes';

export interface CADUnitMeta {
  code: CADUnitCode;
  shortLabel: string;
  labelVi: string;
  metersPerUnit: number;
}

export const CAD_UNIT_CATALOG: Record<number, CADUnitMeta> = {
  0: { code: 0, shortLabel: 'unit', labelVi: 'Không đơn vị (Unitless)', metersPerUnit: 1 },
  1: { code: 1, shortLabel: 'in', labelVi: 'Inch (in)', metersPerUnit: 0.0254 },
  2: { code: 2, shortLabel: 'ft', labelVi: 'Feet (ft)', metersPerUnit: 0.3048 },
  3: { code: 3, shortLabel: 'mi', labelVi: 'Dặm (Miles)', metersPerUnit: 1609.344 },
  4: { code: 4, shortLabel: 'mm', labelVi: 'Milimét (mm)', metersPerUnit: 0.001 },
  5: { code: 5, shortLabel: 'cm', labelVi: 'Centimét (cm)', metersPerUnit: 0.01 },
  6: { code: 6, shortLabel: 'm', labelVi: 'Mét (m)', metersPerUnit: 1 },
  7: { code: 7, shortLabel: 'km', labelVi: 'Kilômét (km)', metersPerUnit: 1000 },
  10: { code: 10, shortLabel: 'yd', labelVi: 'Yard (yd)', metersPerUnit: 0.9144 },
  14: { code: 14, shortLabel: 'dm', labelVi: 'Decimét (dm)', metersPerUnit: 0.1 }
};

export function getCADUnitMeta(code: number | undefined): CADUnitMeta {
  if (typeof code === 'number' && CAD_UNIT_CATALOG[code]) {
    return CAD_UNIT_CATALOG[code];
  }
  return CAD_UNIT_CATALOG[4]; // Default mm for architectural/MEP DXF
}

export function normalizeCADUnitCode(raw: unknown): CADUnitCode {
  const num = typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw ?? ''), 10);
  if (Number.isFinite(num) && num >= 0 && num <= 20) {
    return num as CADUnitCode;
  }
  return 4;
}

export function convertCADDistanceToMeters(distance: number, unitCode: CADUnitCode): number {
  const meta = getCADUnitMeta(unitCode);
  return distance * meta.metersPerUnit;
}

export function convertCADUnits(
  value: number,
  fromUnit: CADUnitCode,
  toUnit: CADUnitCode
): number {
  if (fromUnit === toUnit) return value;
  const fromMeta = getCADUnitMeta(fromUnit);
  const toMeta = getCADUnitMeta(toUnit);
  return (value * fromMeta.metersPerUnit) / toMeta.metersPerUnit;
}

export function computeMetersPerCanvasPx(
  scaleToCanvasPx: number,
  unitCode: CADUnitCode
): number | null {
  if (unitCode === 0) return null;
  if (!Number.isFinite(scaleToCanvasPx) || scaleToCanvasPx <= 1e-8) return null;
  const meta = getCADUnitMeta(unitCode);
  if (!Number.isFinite(meta.metersPerUnit) || meta.metersPerUnit <= 0) return null;
  return meta.metersPerUnit / scaleToCanvasPx;
}

export function formatCADMeasurement(distance: number, unitCode: CADUnitCode): string {
  const meta = getCADUnitMeta(unitCode);
  const abs = Math.abs(distance);
  const formatted =
    abs >= 1000 ? distance.toFixed(1) : abs >= 10 ? distance.toFixed(2) : distance.toFixed(3);
  const meters = convertCADDistanceToMeters(distance, unitCode);
  if (unitCode === 6 || unitCode === 0) {
    return `${formatted} ${meta.shortLabel}`;
  }
  return `${formatted} ${meta.shortLabel} (${meters.toFixed(3)} m)`;
}
