import {
  buildInsertTransform2D,
  multiplyAffine2D,
  Affine2D,
  IDENTITY_2D,
  applyAffine2D
} from '../cad/core/CADTransform';
import { isCADLayerVisible } from '../cad/core/CADDocument';
import type { CADDocument, CADEntity, CADUnitCode, Point2D } from '../cad/core/CADTypes';
import { convertCADDistanceToMeters, getCADUnitMeta } from '../cad/core/CADUnits';
import {
  tessellateArc,
  tessellateEllipse,
  tessellatePolyline,
  tessellateSpline
} from '../cad/geometry/CADCurve';
import type { CableEdge } from '../types/infrastructure';

export type CadBomTargetKind =
  | CableEdge['cableType']
  | 'network_tray'
  | 'conduit'
  | 'ignored';

export interface CadBomLayerSummary {
  layerName: string;
  entityCount: number;
  rawDrawingUnits: number;
  meters: number;
  autoTarget: CadBomTargetKind;
  effectiveTarget: CadBomTargetKind;
}

export interface CadBomCableSummaryItem {
  cableType: CableEdge['cableType'];
  entityCount: number;
  meters: number;
  layers: string[];
}

export interface CadBomExtractionSummary {
  documentId: string;
  documentName: string;
  unitCode: CADUnitCode;
  unitLabel: string;
  totalLinearEntities: number;
  totalExtractedMeters: number;
  cableMetersByType: Partial<Record<CableEdge['cableType'], number>>;
  cableCountsByType: Partial<Record<CableEdge['cableType'], number>>;
  cableBreakdown: CadBomCableSummaryItem[];
  trayMeters: number;
  trayEntityCount: number;
  conduitMeters: number;
  conduitEntityCount: number;
  layers: CadBomLayerSummary[];
}

export const CAD_BOM_TARGET_LABELS: Record<CadBomTargetKind, string> = {
  CAT6_UTP: 'Cáp mạng Cat6 UTP',
  CAT6A_STP: 'Cáp mạng Cat6A STP',
  FIBER_SM_OS2: 'Cáp quang Singlemode OS2',
  FIBER_MM_OM4: 'Cáp quang Multimode OM4',
  DAC_10G: 'Cáp DAC 10G Twinax',
  POWER_AC: 'Cáp nguồn AC',
  network_tray: 'Máng cáp 100×50mm',
  conduit: 'Ống gen luồn dây PVC',
  ignored: 'Bỏ qua (Kiến trúc / Không tính BOM)'
};

const MAX_INSERT_TRAVERSAL_DEPTH = 12;

function polylineLength2D(pts: Point2D[], closed = false): number {
  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  if (closed && pts.length >= 2) {
    const last = pts[pts.length - 1];
    const first = pts[0];
    total += Math.hypot(first.x - last.x, first.y - last.y);
  }
  return total;
}

function transformPoints2D(pts: Point2D[], m: Affine2D): Point2D[] {
  if (m === IDENTITY_2D) return pts;
  return pts.map(p => applyAffine2D(m, p));
}

/**
 * Computes the geometric length in native CAD drawing units of a linear/curve CADEntity
 * (LINE, LWPOLYLINE incl. bulge arcs, POLYLINE, ARC, CIRCLE, ELLIPSE, SPLINE).
 */
export function computeCadCurveLengthDrawingUnits(
  entity: CADEntity,
  transform: Affine2D = IDENTITY_2D
): number {
  switch (entity.type) {
    case 'LINE': {
      const a = applyAffine2D(transform, entity.start);
      const b = applyAffine2D(transform, entity.end);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    case 'LWPOLYLINE': {
      const sampled = tessellatePolyline(entity.vertices, Boolean(entity.closed), 20);
      return polylineLength2D(transformPoints2D(sampled, transform), false);
    }
    case 'POLYLINE': {
      const sampled = tessellatePolyline(entity.vertices, Boolean(entity.closed), 20);
      return polylineLength2D(transformPoints2D(sampled, transform), false);
    }
    case 'ARC': {
      const sampled = tessellateArc(entity.center, entity.radius, entity.startAngle, entity.endAngle, 48);
      return polylineLength2D(transformPoints2D(sampled, transform), false);
    }
    case 'CIRCLE': {
      const sampled = tessellateArc(entity.center, entity.radius, 0, 360, 48);
      return polylineLength2D(transformPoints2D(sampled, transform), false);
    }
    case 'ELLIPSE': {
      const sampled = tessellateEllipse(entity, 48);
      return polylineLength2D(transformPoints2D(sampled, transform), false);
    }
    case 'SPLINE': {
      const sampled = tessellateSpline(entity, 48);
      return polylineLength2D(transformPoints2D(sampled, transform), Boolean(entity.closed));
    }
    default:
      return 0;
  }
}

/**
 * Automatically classifies a CAD layer name into cable/tray/conduit BOM buckets.
 * Architectural & annotation layers (`0`, `DEFPOINTS`, `WALL`, `DOOR`, `GRID`, `DIM`, `TEXT`, `AXIS`, `FURNITURE`)
 * default to `'ignored'` so structural lines don't inflate cable BOM unless explicitly mapped by the engineer.
 */
export function classifyCadLayerForBom(layerName: string): CadBomTargetKind {
  const norm = layerName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (!norm || norm === '0' || norm === 'DEFPOINTS') return 'ignored';

  // Ignore HACHIHI's own exported network overlay layers so combined DXF re-imports never double-count diagram cables
  if (norm.startsWith('HACHIHI_')) return 'ignored';

  // Explicit structural / architectural exclusions
  if (
    /(WALL|TUONG|DOOR|CUA|WINDOW|GRID|AXIS|TRUC|DIM|TEXT|ANNO|HATCH|FURNITURE|NOI_THAT|STAIR|CAU_THANG|COLUMN|COT|FLOOR|SAN)/.test(
      norm
    )
  ) {
    return 'ignored';
  }

  // Cable trays & ladder racks
  if (/(TRAY|MANG|LADDER|THANG_CAP|TRUNKING)/.test(norm)) {
    return 'network_tray';
  }

  // PVC / EMT Conduits
  if (/(CONDUIT|ONG_GEN|\bGEN\b|\bPVC\b|\bEMT\b|\bHDPE\b|ONG_LUON)/.test(norm)) {
    return 'conduit';
  }

  // Fiber optic
  if (/(OM4|MULTIMODE|MM_FIBER|FIBER_MM)/.test(norm)) {
    return 'FIBER_MM_OM4';
  }
  if (/(FIBER|QUANG|OS2|SINGLEMODE|OPTIC|FO_|_FO)/.test(norm)) {
    return 'FIBER_SM_OS2';
  }

  // Cat6A shielded
  if (/(CAT6A|6A|STP|FTP|SFTP)/.test(norm)) {
    return 'CAT6A_STP';
  }

  // Power AC cables
  if (/(POWER|DIEN|NGUON|UPS|AC_220|CAP_DIEN|ELV_PWR|LIGHTING)/.test(norm)) {
    return 'POWER_AC';
  }

  // General Data / LAN / Wi-Fi / CCTV / Cat6 / ELV copper cabling
  if (/(CAT6|CAT5|LAN|DATA|NETWORK|MANG|WIFI|AP_|CCTV|CAM|ELV|CABLE|DAY_MANG)/.test(norm)) {
    return 'CAT6_UTP';
  }

  return 'ignored';
}

export interface ExtractCadBomOptions {
  layerMappings?: Record<string, CadBomTargetKind>;
  includeHiddenLayers?: boolean;
  includeBlocks?: boolean;
}

/**
 * Traverses all curve/polyline entities in a CADDocument (including optional INSERT block expansions)
 * and aggregates real-world lengths in meters grouped by CAD layer and BOM target type.
 */
export function extractBomQuantitiesFromCad(
  doc: CADDocument,
  options?: ExtractCadBomOptions
): CadBomExtractionSummary {
  const unitCode = doc.header?.$INSUNITS ?? 4;
  const unitMeta = getCADUnitMeta(unitCode);
  const includeHidden = Boolean(options?.includeHiddenLayers);
  const includeBlocks = options?.includeBlocks !== false;
  const userMappings = options?.layerMappings || {};

  const layerBuckets = new Map<
    string,
    { entityCount: number; rawUnits: number; autoTarget: CadBomTargetKind; effectiveTarget: CadBomTargetKind }
  >();

  const getOrCreateLayerBucket = (layerName: string) => {
    const existing = layerBuckets.get(layerName);
    if (existing) return existing;
    const autoTarget = classifyCadLayerForBom(layerName);
    const effectiveTarget = userMappings[layerName] ?? autoTarget;
    const next = {
      entityCount: 0,
      rawUnits: 0,
      autoTarget,
      effectiveTarget
    };
    layerBuckets.set(layerName, next);
    return next;
  };

  const accumulateEntity = (
    entity: CADEntity,
    transform: Affine2D,
    inheritedLayer: string | undefined,
    depth: number,
    visitedBlocks: Set<string>
  ) => {
    if (entity.visible === false) return;
    const layerName = entity.layer === '0' && inheritedLayer ? inheritedLayer : entity.layer || '0';
    if (!includeHidden && !isCADLayerVisible(doc, layerName)) return;

    if (entity.type === 'INSERT') {
      if (!includeBlocks || depth >= MAX_INSERT_TRAVERSAL_DEPTH) return;
      if (visitedBlocks.has(entity.blockName)) return;
      const blockDef = doc.blocks[entity.blockName];
      if (!blockDef || blockDef.entities.length === 0) return;
      const localInsertMat = buildInsertTransform2D(
        entity.position,
        entity.scale,
        entity.rotation,
        blockDef.basePoint
      );
      const insertMat = multiplyAffine2D(transform, localInsertMat);
      const nextVisited = new Set(visitedBlocks);
      nextVisited.add(entity.blockName);
      for (const child of blockDef.entities) {
        accumulateEntity(child, insertMat, layerName, depth + 1, nextVisited);
      }
      return;
    }

    const rawLen = computeCadCurveLengthDrawingUnits(entity, transform);
    if (!(rawLen > 0) || !Number.isFinite(rawLen)) return;

    const bucket = getOrCreateLayerBucket(layerName);
    bucket.entityCount += 1;
    bucket.rawUnits += rawLen;
  };

  for (const ent of doc.entities) {
    accumulateEntity(ent, IDENTITY_2D, undefined, 0, new Set());
  }

  const cableMetersByType: Partial<Record<CableEdge['cableType'], number>> = {};
  const cableCountsByType: Partial<Record<CableEdge['cableType'], number>> = {};
  const cableLayerSets = new Map<CableEdge['cableType'], Set<string>>();

  let trayMetersRaw = 0;
  let trayEntityCount = 0;
  let conduitMetersRaw = 0;
  let conduitEntityCount = 0;
  let totalLinearEntities = 0;
  let totalExtractedMetersRaw = 0;

  const layers: CadBomLayerSummary[] = [];

  for (const [layerName, bucket] of layerBuckets.entries()) {
    const meters = Math.round(convertCADDistanceToMeters(bucket.rawUnits, unitCode) * 10) / 10;
    layers.push({
      layerName,
      entityCount: bucket.entityCount,
      rawDrawingUnits: Math.round(bucket.rawUnits * 100) / 100,
      meters,
      autoTarget: bucket.autoTarget,
      effectiveTarget: bucket.effectiveTarget
    });

    totalLinearEntities += bucket.entityCount;
    if (bucket.effectiveTarget === 'ignored') continue;
    totalExtractedMetersRaw += meters;

    if (bucket.effectiveTarget === 'network_tray') {
      trayMetersRaw += meters;
      trayEntityCount += bucket.entityCount;
    } else if (bucket.effectiveTarget === 'conduit') {
      conduitMetersRaw += meters;
      conduitEntityCount += bucket.entityCount;
    } else {
      const cType = bucket.effectiveTarget;
      cableMetersByType[cType] = Math.round(((cableMetersByType[cType] || 0) + meters) * 10) / 10;
      cableCountsByType[cType] = (cableCountsByType[cType] || 0) + bucket.entityCount;
      let set = cableLayerSets.get(cType);
      if (!set) {
        set = new Set<string>();
        cableLayerSets.set(cType, set);
      }
      set.add(layerName);
    }
  }

  layers.sort((a, b) => {
    const aActive = a.effectiveTarget !== 'ignored' ? 1 : 0;
    const bActive = b.effectiveTarget !== 'ignored' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.meters - a.meters;
  });

  const cableBreakdown: CadBomCableSummaryItem[] = (
    Object.keys(cableMetersByType) as CableEdge['cableType'][]
  ).map(cType => ({
    cableType: cType,
    entityCount: cableCountsByType[cType] || 0,
    meters: cableMetersByType[cType] || 0,
    layers: Array.from(cableLayerSets.get(cType) || [])
  }));

  return {
    documentId: doc.id,
    documentName: doc.name,
    unitCode,
    unitLabel: unitMeta.labelVi,
    totalLinearEntities,
    totalExtractedMeters: Math.round(totalExtractedMetersRaw * 10) / 10,
    cableMetersByType,
    cableCountsByType,
    cableBreakdown,
    trayMeters: Math.round(trayMetersRaw * 10) / 10,
    trayEntityCount,
    conduitMeters: Math.round(conduitMetersRaw * 10) / 10,
    conduitEntityCount,
    layers
  };
}
