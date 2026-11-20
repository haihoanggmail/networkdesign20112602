import type {
  DwgAlignedDimensionEntity,
  DwgAngularDimensionEntity,
  DwgArcEdge,
  DwgArcEntity,
  DwgAttdefEntity,
  DwgAttribEntity,
  DwgCircleEntity,
  DwgDatabase,
  DwgDimensionEntity,
  DwgEdgeBoundaryPath,
  DwgEllipseEdge,
  DwgEllipseEntity,
  DwgEntity,
  DwgHatchEntity,
  DwgInsertEntity,
  DwgLeaderEntity,
  DwgLineEdge,
  DwgLineEntity,
  DwgLWPolylineEntity,
  DwgMTextEntity,
  DwgOrdinateDimensionEntity,
  DwgPoint2D,
  DwgPoint3D,
  DwgPointEntity,
  DwgPolyline2dEntity,
  DwgPolyline3dEntity,
  DwgPolylineBoundaryPath,
  DwgRadialDiameterDimensionEntity,
  DwgSolidEntity,
  DwgSplineEdge,
  DwgSplineEntity,
  DwgTextBase,
  DwgTextEntity,
  Dwg3dFaceEntity
} from '@mlightcad/libredwg-web';
import { CAD_SCHEMA_VERSION } from '../core/CADDocument';
import { CADHandleAllocator, createCadId } from '../core/CADRegistry';
import { ocsPointToWcs } from '../core/CADTransform';
import type {
  CADBlock,
  CADDimensionKind,
  CADDimensionStyle,
  CADDocument,
  CADEntity,
  CADHeaderVariables,
  CADInsertAttribute,
  CADLayer,
  CADLayout,
  CADLineType,
  CADTextStyle,
  CADXDataEntry,
  Point2D,
  Point3D,
  RawDxfGroupPair
} from '../core/CADTypes';
import { normalizeCADUnitCode } from '../core/CADUnits';
import { recomputeDocumentExtents } from '../geometry/CADBounds';
import { decodeAutoCadText, stripMTextFormatting } from '../geometry/CADCurve';
import { buildCADImportReport, type CADImportWarning } from './CADImportReport';
import {
  MAX_CAD_ENTITIES,
  auditMissingCadFonts,
  detectBlockCycles,
  sanitizeCadString
} from './CADImportValidator';
import type { DxfImportResult } from './DXFImporter';

const ACAD_VERSION_LABELS: Record<string, string> = {
  AC1006: 'AutoCAD R10',
  AC1009: 'AutoCAD R11/R12',
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000 / 2002',
  AC1018: 'AutoCAD 2004 / 2006',
  AC1021: 'AutoCAD 2007 / 2009',
  AC1024: 'AutoCAD 2010 / 2012',
  AC1027: 'AutoCAD 2013 / 2017',
  AC1032: 'AutoCAD 2018–2025+'
};

const RAD_TO_DEG = 180 / Math.PI;

function radToDeg(rad: number | undefined): number {
  const n = Number(rad);
  return Number.isFinite(n) ? n * RAD_TO_DEG : 0;
}

function toPoint3D(pt: Partial<DwgPoint3D | DwgPoint2D> | undefined, fallbackZ = 0): Point3D {
  if (!pt || typeof pt !== 'object') {
    return { x: 0, y: 0, z: fallbackZ };
  }
  const x = Number(pt.x);
  const y = Number(pt.y);
  const z = 'z' in pt ? Number(pt.z) : fallbackZ;
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    z: Number.isFinite(z) ? z : fallbackZ
  };
}

function normalizeExtrusion(ext: Partial<DwgPoint3D> | undefined): Point3D | undefined {
  if (!ext || typeof ext !== 'object') return undefined;
  const x = Number(ext.x ?? 0);
  const y = Number(ext.y ?? 0);
  const z = Number(ext.z ?? 1);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z - 1) < 1e-9) {
    return undefined;
  }
  return { x, y, z };
}

function resolveDimensionKind(subCode: number): CADDimensionKind {
  const low = subCode & 0x0f;
  switch (low) {
    case 1:
      return 'aligned';
    case 2:
    case 5:
      return 'angular';
    case 3:
      return 'diameter';
    case 4:
      return 'radial';
    case 6:
      return 'ordinate';
    default:
      return 'linear';
  }
}

function isPolylineBoundaryPath(path: unknown): path is DwgPolylineBoundaryPath {
  return Boolean(path && typeof path === 'object' && 'vertices' in path && Array.isArray((path as DwgPolylineBoundaryPath).vertices));
}

function isEdgeBoundaryPath(path: unknown): path is DwgEdgeBoundaryPath<DwgLineEdge | DwgArcEdge | DwgEllipseEdge | DwgSplineEdge> {
  return Boolean(path && typeof path === 'object' && 'edges' in path && Array.isArray((path as DwgEdgeBoundaryPath<DwgLineEdge>).edges));
}

function sampleHatchBoundaryLoops(hatch: DwgHatchEntity): Point2D[][] {
  const loops: Point2D[][] = [];
  const paths = Array.isArray(hatch.boundaryPaths) ? hatch.boundaryPaths : [];

  for (const path of paths) {
    if (isPolylineBoundaryPath(path)) {
      const pts: Point2D[] = path.vertices
        .filter(v => Number.isFinite(Number(v?.x)) && Number.isFinite(Number(v?.y)))
        .map(v => ({ x: Number(v.x), y: Number(v.y) }));
      if (pts.length > 1) loops.push(pts);
      continue;
    }
    if (isEdgeBoundaryPath(path)) {
      const pts: Point2D[] = [];
      for (const edge of path.edges) {
        if (!edge || typeof edge !== 'object') continue;
        if ('start' in edge && 'end' in edge && edge.start && edge.end) {
          pts.push({ x: Number(edge.start.x) || 0, y: Number(edge.start.y) || 0 });
          pts.push({ x: Number(edge.end.x) || 0, y: Number(edge.end.y) || 0 });
        } else if ('radius' in edge && edge.center) {
          const steps = 16;
          const cx = Number(edge.center.x) || 0;
          const cy = Number(edge.center.y) || 0;
          const r = Math.max(0, Number(edge.radius) || 0);
          const s = Number(edge.startAngle) || 0;
          let e = Number(edge.endAngle) || Math.PI * 2;
          if (e <= s) e += Math.PI * 2;
          for (let k = 0; k <= steps; k++) {
            const a = s + ((e - s) * k) / steps;
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
          }
        } else if ('controlPoints' in edge && Array.isArray(edge.controlPoints)) {
          for (const cp of edge.controlPoints) {
            if (cp) pts.push({ x: Number(cp.x) || 0, y: Number(cp.y) || 0 });
          }
        } else if ('fitDatum' in edge && Array.isArray(edge.fitDatum)) {
          for (const fp of edge.fitDatum) {
            if (fp) pts.push({ x: Number(fp.x) || 0, y: Number(fp.y) || 0 });
          }
        }
      }
      if (pts.length > 1) loops.push(pts);
    }
  }

  return loops;
}

interface DwgMapContext {
  allocator: CADHandleAllocator;
  securityWarnings: Set<string>;
  unknownTypes: Record<string, number>;
}

function mapDwgXData(rawEnt: DwgEntity): CADXDataEntry[] | undefined {
  const rawXdata = (rawEnt as unknown as {
    xdata?: Array<{
      appName?: string;
      value?: Array<{ code?: number; value?: unknown }>;
      values?: Array<{ code?: number; value?: unknown }>;
    }>;
  }).xdata;
  if (!Array.isArray(rawXdata) || rawXdata.length === 0) return undefined;

  const entries: CADXDataEntry[] = [];
  for (const item of rawXdata) {
    if (!item || typeof item !== 'object') continue;
    const appName = typeof item.appName === 'string' ? item.appName.trim() : '';
    if (!appName) continue;
    const rawPairs = Array.isArray(item.value)
      ? item.value
      : Array.isArray(item.values)
        ? item.values
        : [];
    const values: RawDxfGroupPair[] = [];
    for (const pair of rawPairs) {
      if (!pair || typeof pair !== 'object') continue;
      const code = Number(pair.code);
      if (!Number.isFinite(code)) continue;
      const val = pair.value;
      if (typeof val === 'number' && Number.isFinite(val)) {
        values.push({ code, value: val });
      } else if (typeof val === 'string') {
        values.push({ code, value: val });
      } else if (typeof val === 'boolean') {
        values.push({ code, value: val ? 1 : 0 });
      } else if (val !== undefined && val !== null) {
        values.push({ code, value: String(val) });
      }
    }
    if (values.length > 0) {
      entries.push({ appName, values });
    }
  }
  return entries.length > 0 ? entries : undefined;
}

function mapDwgEntity(rawEnt: DwgEntity, ctx: DwgMapContext): CADEntity | null {
  if (!rawEnt || typeof rawEnt !== 'object') return null;

  const dwgType = String(rawEnt.type || 'UNKNOWN').toUpperCase();
  const handle = (rawEnt.handle && String(rawEnt.handle).trim().toUpperCase()) || ctx.allocator.allocate();
  ctx.allocator.register(handle);

  const rawLayer = (typeof rawEnt.layer === 'string' && rawEnt.layer.trim()) || '0';
  const layer = decodeAutoCadText(rawLayer) || '0';
  const colorIndex = typeof rawEnt.colorIndex === 'number' && Number.isFinite(rawEnt.colorIndex)
    ? rawEnt.colorIndex
    : undefined;
  const trueColor = typeof rawEnt.color === 'number' && Number.isFinite(rawEnt.color)
    ? rawEnt.color
    : undefined;
  const lineType = typeof rawEnt.lineType === 'string' && rawEnt.lineType.trim()
    ? rawEnt.lineType.trim()
    : undefined;
  const lineTypeScale = typeof rawEnt.lineTypeScale === 'number' && Number.isFinite(rawEnt.lineTypeScale)
    ? rawEnt.lineTypeScale
    : undefined;
  const lineWeight = typeof rawEnt.lineweight === 'number' && Number.isFinite(rawEnt.lineweight)
    ? rawEnt.lineweight
    : undefined;
  const xdata = mapDwgXData(rawEnt);

  const base = {
    id: createCadId('ent'),
    handle,
    layer,
    colorIndex,
    trueColor,
    lineType,
    lineTypeScale,
    lineWeight,
    visible: rawEnt.isVisible !== false,
    space: rawEnt.isInPaperSpace ? ('paper' as const) : ('model' as const),
    ...(xdata ? { xdata } : {}),
    dirty: false
  };

  if (dwgType === 'LINE') {
    const e = rawEnt as DwgLineEntity;
    const extrusion = normalizeExtrusion(e.extrusionDirection);
    return {
      ...base,
      extrusion,
      type: 'LINE',
      preservationTier: 'supported',
      start: toPoint3D(e.startPoint),
      end: toPoint3D(e.endPoint)
    };
  }

  if (dwgType === 'POINT') {
    const e = rawEnt as DwgPointEntity;
    return {
      ...base,
      extrusion: normalizeExtrusion(e.extrusionDirection),
      type: 'POINT',
      preservationTier: 'supported',
      position: toPoint3D(e.position)
    };
  }

  if (dwgType === 'CIRCLE') {
    const e = rawEnt as DwgCircleEntity;
    const extrusion = normalizeExtrusion(e.extrusionDirection);
    const ocsCenter = toPoint3D(e.center);
    return {
      ...base,
      extrusion,
      type: 'CIRCLE',
      preservationTier: 'supported',
      center: extrusion ? ocsPointToWcs(ocsCenter, extrusion) : ocsCenter,
      radius: Math.max(0, Number(e.radius) || 0)
    };
  }

  if (dwgType === 'ARC') {
    const e = rawEnt as DwgArcEntity;
    const extrusion = normalizeExtrusion(e.extrusionDirection);
    const ocsCenter = toPoint3D(e.center);
    const flippedX = extrusion && extrusion.z < -0.5;
    const sAng = radToDeg(e.startAngle);
    const eAng = radToDeg(e.endAngle);
    return {
      ...base,
      extrusion,
      type: 'ARC',
      preservationTier: 'supported',
      center: extrusion ? ocsPointToWcs(ocsCenter, extrusion) : ocsCenter,
      radius: Math.max(0, Number(e.radius) || 0),
      startAngle: flippedX ? 180 - eAng : sAng,
      endAngle: flippedX ? 180 - sAng : eAng
    };
  }

  if (dwgType === 'LWPOLYLINE') {
    const e = rawEnt as DwgLWPolylineEntity;
    const extrusion = normalizeExtrusion(e.extrusionDirection);
    const elevation = Number(e.elevation) || 0;
    const verts = (e.vertices || []).map(v => {
      const p = { x: Number(v.x) || 0, y: Number(v.y) || 0, z: elevation };
      const wp = extrusion ? ocsPointToWcs(p, extrusion) : p;
      return {
        x: wp.x,
        y: wp.y,
        z: wp.z,
        bulge: Number.isFinite(Number(v.bulge)) ? Number(v.bulge) : undefined,
        startWidth: Number.isFinite(Number(v.startWidth)) ? Number(v.startWidth) : undefined,
        endWidth: Number.isFinite(Number(v.endWidth)) ? Number(v.endWidth) : undefined
      };
    });
    return {
      ...base,
      extrusion,
      type: 'LWPOLYLINE',
      preservationTier: 'supported',
      vertices: verts,
      closed: Boolean((e.flag ?? 0) & 1),
      elevation,
      constantWidth: Number.isFinite(Number(e.constantWidth)) ? Number(e.constantWidth) : undefined
    };
  }

  if (dwgType === 'POLYLINE2D' || dwgType === 'POLYLINE3D') {
    const e = rawEnt as DwgPolyline2dEntity | DwgPolyline3dEntity;
    const extrusion = normalizeExtrusion(e.extrusionDirection);
    const flag = Number(e.flag) || 0;
    const verts = (e.vertices || []).map(v => ({
      x: Number(v.x) || 0,
      y: Number(v.y) || 0,
      z: Number(v.z) || 0,
      bulge: 'bulge' in v && Number.isFinite(Number(v.bulge)) ? Number(v.bulge) : undefined
    }));
    return {
      ...base,
      extrusion,
      type: 'POLYLINE',
      preservationTier: 'supported',
      vertices: verts,
      closed: Boolean(flag & 1),
      is3D: dwgType === 'POLYLINE3D' || Boolean(flag & 8),
      isPolygonMesh: Boolean(flag & 16)
    };
  }

  if (dwgType === 'SPLINE') {
    const e = rawEnt as DwgSplineEntity;
    return {
      ...base,
      extrusion: normalizeExtrusion(e.normal),
      type: 'SPLINE',
      preservationTier: 'supported',
      degree: Number(e.degree) || 3,
      controlPoints: (e.controlPoints || []).map(p => toPoint3D(p)),
      fitPoints: (e.fitPoints || []).map(p => toPoint3D(p)),
      knots: Array.isArray(e.knots) ? e.knots.map(k => Number(k) || 0) : [],
      weights: Array.isArray(e.weights) && e.weights.length > 0 ? e.weights.map(w => Number(w) || 1) : undefined,
      closed: Boolean((e.flag ?? 0) & 1)
    };
  }

  if (dwgType === 'ELLIPSE') {
    const e = rawEnt as DwgEllipseEntity;
    return {
      ...base,
      extrusion: normalizeExtrusion(e.extrusionDirection),
      type: 'ELLIPSE',
      preservationTier: 'supported',
      center: toPoint3D(e.center),
      majorAxisEndPoint: toPoint3D(e.majorAxisEndPoint),
      axisRatio: Math.max(0.01, Number(e.axisRatio) || 1),
      startParam: Number.isFinite(Number(e.startAngle)) ? Number(e.startAngle) : 0,
      endParam: Number.isFinite(Number(e.endAngle)) ? Number(e.endAngle) : Math.PI * 2
    };
  }

  if (dwgType === 'HATCH') {
    const e = rawEnt as DwgHatchEntity;
    return {
      ...base,
      extrusion: normalizeExtrusion(e.extrusionDirection),
      type: 'HATCH',
      preservationTier: 'readonly',
      patternName: (e.patternName || 'SOLID').trim() || 'SOLID',
      solidFill: Number(e.solidFill) === 1,
      patternScale: Number(e.patternScale) || 1,
      patternAngle: radToDeg(e.patternAngle),
      boundaryLoops: sampleHatchBoundaryLoops(e)
    };
  }

  if (dwgType === 'SOLID') {
    const e = rawEnt as DwgSolidEntity;
    const p0 = toPoint3D(e.corner1);
    const p1 = toPoint3D(e.corner2);
    const p2 = toPoint3D(e.corner3);
    const p3 = e.corner4 ? toPoint3D(e.corner4) : p2;
    return {
      ...base,
      extrusion: normalizeExtrusion(e.extrusionDirection),
      type: 'SOLID',
      preservationTier: 'readonly',
      points: [p0, p1, p2, p3]
    };
  }

  if (dwgType === '3DFACE') {
    const e = rawEnt as Dwg3dFaceEntity;
    const p0 = toPoint3D(e.corner1);
    const p1 = toPoint3D(e.corner2);
    const p2 = toPoint3D(e.corner3);
    const p3 = e.corner4 ? toPoint3D(e.corner4) : p2;
    return {
      ...base,
      type: '3DFACE',
      preservationTier: 'readonly',
      vertices: [p0, p1, p2, p3]
    };
  }

  if (dwgType === 'TEXT') {
    const e = rawEnt as DwgTextEntity;
    const extrusion = normalizeExtrusion(e.extrusionDirection);
    const { clean, hadUnsafePattern } = sanitizeCadString(String(e.text || ''));
    if (hadUnsafePattern) {
      ctx.securityWarnings.add('Đã tự động lọc mã script không an toàn khỏi văn bản TEXT/MTEXT.');
    }
    const elev = Number(e.elevation) || 0;
    const startOcs = toPoint3D(e.startPoint, elev);
    const hasEnd = Boolean(e.endPoint && Number.isFinite(Number(e.endPoint.x)) && Number.isFinite(Number(e.endPoint.y)));
    const endOcs = hasEnd ? toPoint3D(e.endPoint, elev) : undefined;
    const hAlign = Number(e.halign) || 0;
    const vAlign = Number(e.valign) || 0;
    const startWcs = extrusion ? ocsPointToWcs(startOcs, extrusion) : startOcs;
    const endWcs = endOcs ? (extrusion ? ocsPointToWcs(endOcs, extrusion) : endOcs) : undefined;
    const useSec = (hAlign !== 0 || vAlign !== 0) && endWcs;

    return {
      ...base,
      extrusion,
      type: 'TEXT',
      preservationTier: 'supported',
      position: useSec ? endWcs : startWcs,
      secondAlignmentPoint: endWcs,
      height: Math.max(0.5, Number(e.textHeight) || 2.5),
      rotation: radToDeg(e.rotation),
      text: decodeAutoCadText(clean),
      style: (e.styleName || 'STANDARD').trim() || 'STANDARD',
      hAlign,
      vAlign,
      widthFactor: Number(e.xScale) || 1,
      obliqueAngle: radToDeg(e.obliqueAngle)
    };
  }

  if (dwgType === 'MTEXT') {
    const e = rawEnt as DwgMTextEntity;
    const { clean, hadUnsafePattern } = sanitizeCadString(String(e.text || ''));
    if (hadUnsafePattern) {
      ctx.securityWarnings.add('Đã tự động lọc mã script không an toàn khỏi văn bản MTEXT.');
    }
    let rotationDeg = radToDeg(e.rotation);
    if (
      Math.abs(rotationDeg) < 1e-6 &&
      e.direction &&
      (Math.abs(Number(e.direction.x) || 0) > 1e-6 || Math.abs(Number(e.direction.y) || 0) > 1e-6)
    ) {
      rotationDeg = (Math.atan2(Number(e.direction.y) || 0, Number(e.direction.x) || 0) * 180) / Math.PI;
    }
    return {
      ...base,
      extrusion: normalizeExtrusion(e.extrusionDirection),
      type: 'MTEXT',
      preservationTier: 'supported',
      position: toPoint3D(e.insertionPoint),
      height: Math.max(0.5, Number(e.textHeight) || 2.5),
      width: Math.max(0, Number(e.rectWidth) || 0),
      rotation: rotationDeg,
      rawText: clean,
      plainText: stripMTextFormatting(clean),
      style: (e.styleName || 'STANDARD').trim() || 'STANDARD',
      attachmentPoint: Number(e.attachmentPoint) || 1,
      lineSpacingFactor: Number.isFinite(Number(e.lineSpacing)) ? Number(e.lineSpacing) : undefined
    };
  }

  if (dwgType === 'ATTRIB' || dwgType === 'ATTDEF') {
    const e = rawEnt as DwgAttribEntity | DwgAttdefEntity;
    const tb: Partial<DwgTextBase> | undefined =
      e.text && typeof e.text === 'object' ? e.text : undefined;
    const rawStr = tb ? String(tb.text || '') : typeof e.text === 'string' ? e.text : '';
    const { clean } = sanitizeCadString(rawStr);
    const pos = tb
      ? toPoint3D(tb.startPoint, Number(tb.elevation) || 0)
      : toPoint3D(e.alignmentPoint);
    return {
      ...base,
      extrusion: normalizeExtrusion(tb?.extrusionDirection),
      type: dwgType as 'ATTRIB' | 'ATTDEF',
      preservationTier: 'supported',
      position: pos,
      tag: String(e.tag || ''),
      text: decodeAutoCadText(clean),
      prompt: dwgType === 'ATTDEF' ? decodeAutoCadText(String((e as DwgAttdefEntity).prompt || '')) : undefined,
      height: Math.max(0.5, Number(tb?.textHeight) || 2.5),
      rotation: radToDeg(tb?.rotation),
      style: (tb?.styleName || 'STANDARD').trim() || 'STANDARD',
      flags: Number(e.flags) || 0
    };
  }

  if (dwgType === 'DIMENSION') {
    const e = rawEnt as DwgDimensionEntity;
    const subTypeCode = Number(e.dimensionType) || 0;
    const aligned = e as Partial<DwgAlignedDimensionEntity>;
    const angular = e as Partial<DwgAngularDimensionEntity>;
    const radial = e as Partial<DwgRadialDiameterDimensionEntity>;
    const ordinate = e as Partial<DwgOrdinateDimensionEntity>;

    const defPoint = toPoint3D(e.definitionPoint);
    const defPoint2 = aligned.subDefinitionPoint1
      ? toPoint3D(aligned.subDefinitionPoint1)
      : ordinate.subDefinitionPoint1
        ? toPoint3D(ordinate.subDefinitionPoint1)
        : undefined;
    const defPoint3 = aligned.subDefinitionPoint2
      ? toPoint3D(aligned.subDefinitionPoint2)
      : ordinate.subDefinitionPoint2
        ? toPoint3D(ordinate.subDefinitionPoint2)
        : undefined;
    const defPoint4 = radial.centerPoint
      ? toPoint3D(radial.centerPoint)
      : angular.arcPoint
        ? toPoint3D(angular.arcPoint)
        : undefined;

    const computedDist =
      defPoint2 && defPoint3
        ? Math.hypot(defPoint3.x - defPoint2.x, defPoint3.y - defPoint2.y)
        : 0;
    const measuredValue =
      typeof e.measurement === 'number' && Number.isFinite(e.measurement)
        ? e.measurement
        : computedDist;
    const overrideText = decodeAutoCadText(sanitizeCadString(String(e.text || '')).clean);

    return {
      ...base,
      extrusion: normalizeExtrusion(e.extrusionDirection),
      type: 'DIMENSION',
      preservationTier: 'supported',
      dimensionType: resolveDimensionKind(subTypeCode),
      subTypeCode,
      defPoint,
      defPoint2,
      defPoint3,
      defPoint4,
      textMidPoint: toPoint3D(e.textPoint),
      text: overrideText,
      measuredValue,
      style: (e.styleName || 'STANDARD').trim() || 'STANDARD',
      blockName: e.name ? String(e.name) : undefined,
      rotation:
        typeof aligned.rotationAngle === 'number' && Number.isFinite(aligned.rotationAngle)
          ? radToDeg(aligned.rotationAngle)
          : undefined
    };
  }

  if (dwgType === 'LEADER') {
    const e = rawEnt as DwgLeaderEntity;
    return {
      ...base,
      extrusion: normalizeExtrusion(e.normal),
      type: 'LEADER',
      preservationTier: 'readonly',
      vertices: (e.vertices || []).map(v => toPoint3D(v)),
      hasArrowhead: e.isArrowheadEnabled !== false
    };
  }

  if (dwgType === 'INSERT') {
    const e = rawEnt as DwgInsertEntity;
    const extrusion = normalizeExtrusion(e.extrusionDirection);
    const posOcs = toPoint3D(e.insertionPoint);
    const attributes: CADInsertAttribute[] = [];
    for (const att of e.attribs || []) {
      const tb: Partial<DwgTextBase> | undefined =
        att.text && typeof att.text === 'object' ? att.text : undefined;
      const attText = tb ? String(tb.text || '') : typeof att.text === 'string' ? att.text : '';
      attributes.push({
        id: createCadId('att'),
        tag: String(att.tag || ''),
        text: decodeAutoCadText(sanitizeCadString(attText).clean),
        position: tb ? toPoint3D(tb.startPoint, Number(tb.elevation) || 0) : toPoint3D(att.alignmentPoint),
        height: Math.max(0.5, Number(tb?.textHeight) || 2.5),
        rotation: radToDeg(tb?.rotation),
        style: (tb?.styleName || 'STANDARD').trim() || 'STANDARD',
        layer: decodeAutoCadText((att.layer && att.layer.trim()) || layer) || layer,
        handle: att.handle ? String(att.handle).toUpperCase() : undefined
      });
    }

    return {
      ...base,
      extrusion,
      type: 'INSERT',
      preservationTier: 'supported',
      blockName: decodeAutoCadText(String(e.name || '')),
      position: extrusion ? ocsPointToWcs(posOcs, extrusion) : posOcs,
      scale: {
        x: Number(e.xScale) || 1,
        y: Number(e.yScale) || 1,
        z: Number(e.zScale) || 1
      },
      rotation: radToDeg(e.rotation),
      columnCount: Number(e.columnCount) > 1 ? Number(e.columnCount) : undefined,
      rowCount: Number(e.rowCount) > 1 ? Number(e.rowCount) : undefined,
      columnSpacing: Number(e.columnSpacing) || undefined,
      rowSpacing: Number(e.rowSpacing) || undefined,
      attributes: attributes.length > 0 ? attributes : undefined
    };
  }

  // Fallback for MLEADER, WIPEOUT, IMAGE, RAY, XLINE, 3DSOLID, VIEWPORT, TABLE, PROXY_ENTITY
  ctx.unknownTypes[dwgType] = (ctx.unknownTypes[dwgType] || 0) + 1;
  const anyEnt = rawEnt as unknown as Record<string, unknown>;
  const previewRaw =
    anyEnt.insertionPoint ||
    anyEnt.position ||
    anyEnt.firstPoint ||
    anyEnt.startPoint ||
    anyEnt.viewportCenter;
  const previewPoint =
    previewRaw && typeof previewRaw === 'object'
      ? toPoint3D(previewRaw as Partial<DwgPoint3D>)
      : undefined;

  return {
    ...base,
    type: 'UNKNOWN',
    preservationTier: 'unknown',
    dxfType: dwgType,
    previewPoint,
    note: `Đối tượng DWG nguyên bản (${dwgType})`
  };
}

function normalizeDwgHandseed(rawSeed: unknown): string | undefined {
  if (typeof rawSeed === 'number' && Number.isFinite(rawSeed) && rawSeed > 0) {
    return Math.floor(rawSeed).toString(16).toUpperCase();
  }
  if (typeof rawSeed === 'string') {
    const trimmed = rawSeed.trim().toUpperCase();
    if (!trimmed) return undefined;
    if (/^[0-9A-F]+$/i.test(trimmed)) return trimmed;
  }
  return undefined;
}

function mapDwgHeader(
  dbHeader: DwgDatabase['header'],
  detectedAcadVersion?: string
): CADHeaderVariables {
  const rawVer = typeof dbHeader.ACADVER === 'string' ? dbHeader.ACADVER.trim().toUpperCase() : '';
  const detected = detectedAcadVersion?.trim().toUpperCase() || '';
  const acadVer = rawVer || detected || 'AC1027';
  const handseed = normalizeDwgHandseed((dbHeader as unknown as { HANDSEED?: unknown }).HANDSEED);

  return {
    $ACADVER: acadVer,
    $INSUNITS: normalizeCADUnitCode(dbHeader.INSUNITS ?? 4),
    $MEASUREMENT: Number(dbHeader.MEASUREMENT ?? 1) === 0 ? 0 : 1,
    $LUNITS: Number(dbHeader.LUNITS ?? 2) || 2,
    $DIMSCALE: Number(dbHeader.DIMSCALE) || 1,
    $LTSCALE: Number(dbHeader.LTSCALE) || 1,
    $TEXTSIZE: Number(dbHeader.TEXTSIZE) || 250,
    $CLAYER: typeof dbHeader.CLAYER === 'string' && dbHeader.CLAYER.trim() ? dbHeader.CLAYER.trim() : '0',
    $EXTMIN: dbHeader.EXTMIN ? toPoint3D(dbHeader.EXTMIN) : undefined,
    $EXTMAX: dbHeader.EXTMAX ? toPoint3D(dbHeader.EXTMAX) : undefined,
    $INSBASE: { x: 0, y: 0, z: 0 },
    $UCSORG: dbHeader.UCSORG ? toPoint3D(dbHeader.UCSORG) : undefined,
    ...(handseed ? { $HANDSEED: handseed } : {})
  };
}

export function mapDwgDatabaseToCadDocument(
  db: DwgDatabase,
  options?: {
    fileName?: string;
    fileSizeBytes?: number;
    projectId?: string;
    parseDurationMs?: number;
    unknownEntityCount?: number;
    detectedAcadVersion?: string;
    onProgress?: (pct: number, stageVi: string) => void;
  }
): DxfImportResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const fileName = options?.fileName || 'drawing.dwg';
  const fileSizeBytes = options?.fileSizeBytes ?? 0;

  options?.onProgress?.(65, 'Đang dựng bảng Layer, LineType & TextStyle từ DWG...');
  const allocator = new CADHandleAllocator();

  // Layers
  const layers: Record<string, CADLayer> = {};
  for (const lyr of db.tables?.LAYER?.entries || []) {
    const rawName = String(lyr.name || '').trim();
    const name = decodeAutoCadText(rawName) || rawName;
    if (!name) continue;
    const handle = lyr.handle ? String(lyr.handle).toUpperCase() : undefined;
    if (handle) allocator.register(handle);
    const hasAci = typeof lyr.colorIndex === 'number' && lyr.colorIndex >= 1 && lyr.colorIndex <= 255;
    const trueColor =
      !hasAci && typeof lyr.color === 'number' && lyr.color !== 0xffffff ? lyr.color : undefined;

    layers[name] = {
      id: `layer_${name}`,
      name,
      colorIndex: hasAci ? Math.abs(lyr.colorIndex) : 7,
      trueColor,
      lineType: (lyr.lineType || 'CONTINUOUS').trim() || 'CONTINUOUS',
      lineWeight: typeof lyr.lineweight === 'number' ? lyr.lineweight : -3,
      visible: !lyr.off && (lyr.colorIndex ?? 7) >= 0,
      frozen: Boolean(lyr.frozen),
      locked: Boolean(lyr.locked),
      plottable: lyr.plotFlag !== 0,
      handle
    };
  }
  if (!layers['0']) {
    layers['0'] = {
      id: 'layer_0',
      name: '0',
      colorIndex: 7,
      lineType: 'CONTINUOUS',
      lineWeight: -3,
      visible: true,
      frozen: false,
      locked: false,
      plottable: true
    };
  }

  // LineTypes
  const lineTypes: Record<string, CADLineType> = {};
  for (const lt of db.tables?.LTYPE?.entries || []) {
    const name = String(lt.name || '').trim();
    if (!name) continue;
    lineTypes[name.toUpperCase()] = {
      name,
      description: String(lt.description || ''),
      pattern: (lt.pattern || []).map(el => Number(el.elementLength) || 0),
      totalLength: Number(lt.totalPatternLength) || 0,
      handle: lt.handle ? String(lt.handle).toUpperCase() : undefined
    };
  }
  if (!lineTypes['CONTINUOUS']) {
    lineTypes['CONTINUOUS'] = {
      name: 'CONTINUOUS',
      description: 'Solid line',
      pattern: [],
      totalLength: 0
    };
  }

  // TextStyles
  const textStyles: Record<string, CADTextStyle> = {};
  for (const st of db.tables?.STYLE?.entries || []) {
    const name = String(st.name || '').trim();
    if (!name) continue;
    textStyles[name.toUpperCase()] = {
      name,
      fontFile: String(st.font || 'txt').trim(),
      bigFontFile: st.bigFont ? String(st.bigFont).trim() : undefined,
      fixedHeight: Number(st.fixedTextHeight) || 0,
      widthFactor: Number(st.widthFactor) || 1,
      obliqueAngle: radToDeg(st.obliqueAngle),
      isShapeFile: Boolean((st.standardFlag ?? 0) & 1),
      handle: st.handle ? String(st.handle).toUpperCase() : undefined
    };
  }
  if (!textStyles['STANDARD']) {
    textStyles['STANDARD'] = {
      name: 'STANDARD',
      fontFile: 'txt',
      fixedHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0
    };
  }

  // DimStyles
  const dimStyles: Record<string, CADDimensionStyle> = {};
  for (const ds of db.tables?.DIMSTYLE?.entries || []) {
    const name = String(ds.name || '').trim();
    if (!name) continue;
    dimStyles[name.toUpperCase()] = {
      name,
      dimscale: Number(ds.DIMSCALE) || 1,
      dimasz: Number(ds.DIMASZ) || 2.5,
      dimexo: Number(ds.DIMEXO) || 0.625,
      dimexe: Number(ds.DIMEXE) || 1.25,
      dimtxt: Number(ds.DIMTXT) || 2.5,
      dimlfac: Number(ds.DIMLFAC) || 1,
      dimdec: Number(ds.DIMDEC) ?? 2,
      handle: ds.handle ? String(ds.handle).toUpperCase() : undefined
    };
  }
  if (!dimStyles['STANDARD']) {
    dimStyles['STANDARD'] = {
      name: 'STANDARD',
      dimscale: 1,
      dimtxt: 180,
      dimasz: 180,
      dimexo: 62.5,
      dimexe: 125,
      dimlfac: 1,
      dimdec: 2
    };
  }

  options?.onProgress?.(75, 'Đang dựng Block & hình học từ DWG...');
  const securityWarnings = new Set<string>();
  const unknownTypes: Record<string, number> = {};
  const missingXrefs: string[] = [];
  const ctx: DwgMapContext = { allocator, securityWarnings, unknownTypes };

  // Blocks
  const blocks: Record<string, CADBlock> = {};
  for (const btr of db.tables?.BLOCK_RECORD?.entries || []) {
    const rawName = String(btr.name || '').trim();
    const name = decodeAutoCadText(rawName) || rawName;
    if (!name) continue;
    const upper = name.toUpperCase();
    const isModel = upper === '*MODEL_SPACE';
    const isPaper = upper.startsWith('*PAPER_SPACE');
    const flags = Number(btr.flags) || 0;
    const handle = btr.handle ? String(btr.handle).toUpperCase() : undefined;
    if (handle) allocator.register(handle);
    if (flags & 4 && !missingXrefs.includes(name)) {
      missingXrefs.push(name);
    }

    // Avoid duplicating ModelSpace/PaperSpace entities inside doc.blocks (they live in db.entities)
    const blockEntities: CADEntity[] = [];
    if (!isModel && !isPaper) {
      const blockCtx: DwgMapContext = { allocator, securityWarnings, unknownTypes: {} };
      const ownedBlockAttribs = new Set<string>();
      for (const re of btr.entities || []) {
        if (re.type === 'INSERT') {
          for (const att of (re as DwgInsertEntity).attribs || []) {
            if (att.handle) ownedBlockAttribs.add(String(att.handle).toUpperCase());
          }
        }
      }
      for (const re of btr.entities || []) {
        if (
          re.type === 'ATTRIB' &&
          re.handle &&
          ownedBlockAttribs.has(String(re.handle).toUpperCase())
        ) {
          continue;
        }
        const mapped = mapDwgEntity(re, blockCtx);
        if (mapped) blockEntities.push(mapped);
      }
    }

    blocks[name] = {
      id: createCadId('blk'),
      name,
      basePoint: toPoint3D(btr.basePoint),
      entities: blockEntities,
      isAnonymous: Boolean(flags & 1) || name.startsWith('*'),
      isPaperSpace: isPaper,
      isXref: Boolean(flags & 4) || undefined,
      handle
    };
  }

  // Model & Paper Space Entities
  const rawEntities = db.entities || [];
  if (rawEntities.length > MAX_CAD_ENTITIES * 2) {
    throw new Error(
      `Bản vẽ DWG chứa quá nhiều đối tượng (${rawEntities.length.toLocaleString('vi-VN')} > ngưỡng an toàn). Vui lòng chia nhỏ bản vẽ trước khi mở.`
    );
  }

  // LibreDWG pushes INSERT attributes into both insert.attribs and db.entities — skip duplicates
  const ownedAttribHandles = new Set<string>();
  for (const re of rawEntities) {
    if (re.type === 'INSERT') {
      for (const att of (re as DwgInsertEntity).attribs || []) {
        if (att.handle) ownedAttribHandles.add(String(att.handle).toUpperCase());
      }
    }
  }

  const entities: CADEntity[] = [];
  for (const re of rawEntities) {
    if (re.type === 'ATTRIB' && re.handle && ownedAttribHandles.has(String(re.handle).toUpperCase())) {
      continue;
    }
    const mapped = mapDwgEntity(re, ctx);
    if (mapped) entities.push(mapped);
  }

  const cycleWarnings = detectBlockCycles(blocks);
  for (const w of cycleWarnings) {
    securityWarnings.add(w);
  }

  // Ensure every layer referenced by entities exists
  for (const ent of entities) {
    if (!layers[ent.layer]) {
      layers[ent.layer] = {
        id: `layer_${ent.layer}`,
        name: ent.layer,
        colorIndex: 7,
        lineType: 'CONTINUOUS',
        lineWeight: -3,
        visible: true,
        frozen: false,
        locked: false,
        plottable: true
      };
    }
  }

  const missingFonts = auditMissingCadFonts(textStyles);
  const header = mapDwgHeader(db.header || {}, options?.detectedAcadVersion);
  if (header.$HANDSEED) {
    allocator.register(header.$HANDSEED);
  }

  const layouts: CADLayout[] = [];
  const rawLayouts = db.objects?.LAYOUT || [];
  for (const lo of rawLayouts) {
    const lName = String(lo.layoutName || '').trim();
    if (!lName) continue;
    layouts.push({
      name: lName,
      tabOrder: Number(lo.tabOrder) || layouts.length,
      isModelSpace: lName.toUpperCase() === 'MODEL'
    });
  }
  if (!layouts.some(l => l.isModelSpace)) {
    layouts.unshift({ name: 'Model', tabOrder: 0, isModelSpace: true });
  }
  layouts.sort((a, b) => a.tabOrder - b.tabOrder);

  options?.onProgress?.(90, 'Đang tính biên bản vẽ DWG (Extents)...');
  const extents = recomputeDocumentExtents({ entities, blocks });
  const spanX = Math.max(1, extents.maxX - extents.minX);
  const spanY = Math.max(1, extents.maxY - extents.minY);
  const maxSpan = Math.max(spanX, spanY);
  const autoUnderlayScale = Number(Math.min(2, Math.max(0.002, 1000 / maxSpan)).toFixed(6));

  const now = new Date().toISOString();
  const baseName = fileName.replace(/\.(dxf|dwg)$/i, '') || 'AutoCAD Drawing';
  const acadLabel = ACAD_VERSION_LABELS[header.$ACADVER] || header.$ACADVER;

  const doc: CADDocument = {
    id: createCadId('cad'),
    name: baseName,
    projectId: options?.projectId,
    schemaVersion: CAD_SCHEMA_VERSION,
    header,
    layers,
    lineTypes,
    textStyles,
    dimStyles,
    blocks,
    layouts,
    entities,
    extents,
    nextHandleSeed: allocator.getNextSeed(),
    metadata: {
      sourceFileName: fileName,
      sourceFileSizeBytes: fileSizeBytes,
      sourceFormat: 'dwg-converted',
      acadVersion: `${header.$ACADVER} (${acadLabel})`,
      hasRawRoundTripData: false,
      missingFonts,
      missingXrefs,
      unknownEntityTypes: unknownTypes,
      securityWarnings: Array.from(securityWarnings),
      importTimestamp: now
    },
    underlay: {
      enabled: true,
      opacity: 0.72,
      offsetX: Number((-extents.minX * autoUnderlayScale + 80).toFixed(1)),
      offsetY: Number((extents.maxY * autoUnderlayScale + 80).toFixed(1)),
      scaleToCanvasPx: autoUnderlayScale,
      rotationDeg: 0,
      locked: true,
      showIn3D: true
    },
    createdAt: now,
    updatedAt: now
  };

  const extraWarnings: CADImportWarning[] = [
    {
      code: 'DWG_WASM_DECODED',
      severity: 'info',
      messageVi: `Đã giải mã trực tiếp tệp nhị phân .DWG (${doc.metadata.acadVersion}) ngoại tuyến trong trình duyệt bằng LibreDWG WebAssembly.`
    }
  ];

  if (options?.unknownEntityCount && options.unknownEntityCount > 0) {
    extraWarnings.push({
      code: 'UNKNOWN_ENTITIES',
      severity: 'info',
      messageVi: `Tệp DWG có ${options.unknownEntityCount} đối tượng nhị phân mở rộng (AEC/Proxy/Custom) không giải mã được ở tầng LibreDWG.`,
      count: options.unknownEntityCount
    });
  }

  options?.onProgress?.(100, 'Hoàn tất phân tích bản vẽ DWG!');
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const duration = options?.parseDurationMs ?? Math.max(1, Math.round(t1 - t0));
  const report = buildCADImportReport(doc, duration, extraWarnings, {
    dwgUnsupportedCount: options?.unknownEntityCount ?? 0
  });

  return { document: doc, report };
}
