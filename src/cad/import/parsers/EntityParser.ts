import type {
  CADAttribEntity,
  CADDimensionKind,
  CADEntity,
  CADInsertAttribute,
  CADPolylineVertex,
  CADXDataEntry,
  Point2D,
  Point3D,
  RawDxfGroupPair
} from '../../core/CADTypes';
import { CADHandleAllocator, createCadId } from '../../core/CADRegistry';
import { ocsPointToWcs } from '../../core/CADTransform';
import { decodeAutoCadText, stripMTextFormatting } from '../../geometry/CADCurve';
import { sanitizeCadString } from '../CADImportValidator';
import type { RawEntityRecord } from './RawEntityParser';

function valNum(pairs: RawDxfGroupPair[], code: number, fallback = 0): number {
  for (const p of pairs) {
    if (p.code === code) {
      const n = Number(p.value);
      return Number.isFinite(n) ? n : fallback;
    }
  }
  return fallback;
}

function valOptNum(pairs: RawDxfGroupPair[], code: number): number | undefined {
  for (const p of pairs) {
    if (p.code === code) {
      const n = Number(p.value);
      return Number.isFinite(n) ? n : undefined;
    }
  }
  return undefined;
}

function valStr(pairs: RawDxfGroupPair[], code: number, fallback = ''): string {
  for (const p of pairs) {
    if (p.code === code) return String(p.value);
  }
  return fallback;
}

function collectTextGroups(pairs: RawDxfGroupPair[]): string {
  const chunks: string[] = [];
  for (const p of pairs) {
    if (p.code === 3 || p.code === 1) {
      chunks.push(String(p.value));
    }
  }
  return chunks.join('');
}

function extractExtrusion(pairs: RawDxfGroupPair[]): Point3D | undefined {
  const ex = valOptNum(pairs, 210);
  const ey = valOptNum(pairs, 220);
  const ez = valOptNum(pairs, 230);
  if (ex === undefined && ey === undefined && ez === undefined) return undefined;
  return { x: ex ?? 0, y: ey ?? 0, z: ez ?? 1 };
}

function extractXData(pairs: RawDxfGroupPair[]): CADXDataEntry[] | undefined {
  const entries: CADXDataEntry[] = [];
  let current: CADXDataEntry | null = null;
  for (const p of pairs) {
    if (p.code === 1001) {
      if (current) entries.push(current);
      current = { appName: String(p.value), values: [] };
    } else if (current && p.code >= 1000) {
      current.values.push(p);
    }
  }
  if (current) entries.push(current);
  return entries.length > 0 ? entries : undefined;
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

export interface EntityParseContext {
  allocator: CADHandleAllocator;
  securityWarnings: Set<string>;
  unknownTypes: Record<string, number>;
}

export interface EntityParseOptions {
  /** Attach original `rawDxf` group pairs for lossless round-trip export. Set false in low-memory streaming mode. */
  preserveRawDxf?: boolean;
}

/**
 * Converts a stream of raw entity records (`RawEntityRecord[]`, including VERTEX/ATTRIB/SEQEND sequences)
 * into strongly-typed discriminated union `CADEntity[]` preserving raw group pairs for round-trip DXF export.
 */
export function parseEntityRecords(
  records: RawEntityRecord[],
  ctx: EntityParseContext,
  options?: EntityParseOptions
): CADEntity[] {
  const preserveRawDxf = options?.preserveRawDxf !== false;
  const entities: CADEntity[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const dxfType = rec.dxfType;
    if (dxfType === 'SEQEND' || dxfType === 'VERTEX' || dxfType === 'ENDBLK') {
      continue;
    }

    const pairs = rec.pairs;
    const handle = rec.handle || ctx.allocator.allocate();
    ctx.allocator.register(handle);

    const rawLayerName = valStr(pairs, 8, '0').trim() || '0';
    const layer = decodeAutoCadText(rawLayerName) || '0';
    const colorIndex = valOptNum(pairs, 62);
    const trueColor = valOptNum(pairs, 420);
    const lineType = valStr(pairs, 6, '').trim() || undefined;
    const lineTypeScale = valOptNum(pairs, 48);
    const lineWeight = valOptNum(pairs, 370);
    const invisibleFlag = valNum(pairs, 60, 0);
    const paperFlag = valNum(pairs, 67, 0);
    const extrusion = extractExtrusion(pairs);
    const xdata = extractXData(pairs);

    const base = {
      id: createCadId('ent'),
      handle,
      layer,
      colorIndex,
      trueColor,
      lineType,
      lineTypeScale,
      lineWeight,
      visible: invisibleFlag !== 1,
      space: paperFlag === 1 ? ('paper' as const) : ('model' as const),
      extrusion,
      xdata,
      rawDxf: preserveRawDxf ? pairs : undefined,
      dirty: false
    };

    if (dxfType === 'LINE') {
      entities.push({
        ...base,
        type: 'LINE',
        preservationTier: 'supported',
        start: { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) },
        end: { x: valNum(pairs, 11), y: valNum(pairs, 21), z: valNum(pairs, 31) }
      });
      continue;
    }

    if (dxfType === 'POINT') {
      entities.push({
        ...base,
        type: 'POINT',
        preservationTier: 'supported',
        position: { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) }
      });
      continue;
    }

    if (dxfType === 'CIRCLE') {
      const ocsCenter = { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) };
      entities.push({
        ...base,
        type: 'CIRCLE',
        preservationTier: 'supported',
        center: extrusion ? ocsPointToWcs(ocsCenter, extrusion) : ocsCenter,
        radius: Math.max(0, valNum(pairs, 40))
      });
      continue;
    }

    if (dxfType === 'ARC') {
      const ocsCenter = { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) };
      const flippedX = extrusion && extrusion.z < -0.5;
      const sAng = valNum(pairs, 50);
      const eAng = valNum(pairs, 51);
      entities.push({
        ...base,
        type: 'ARC',
        preservationTier: 'supported',
        center: extrusion ? ocsPointToWcs(ocsCenter, extrusion) : ocsCenter,
        radius: Math.max(0, valNum(pairs, 40)),
        startAngle: flippedX ? 180 - eAng : sAng,
        endAngle: flippedX ? 180 - sAng : eAng
      });
      continue;
    }

    if (dxfType === 'LWPOLYLINE') {
      const vertices: CADPolylineVertex[] = [];
      const flags = valNum(pairs, 70, 0);
      const elevation = valNum(pairs, 38, 0);
      const constantWidth = valOptNum(pairs, 43);
      let currentV: CADPolylineVertex | null = null;
      for (const p of pairs) {
        if (p.code === 10) {
          if (currentV) vertices.push(currentV);
          currentV = { x: Number(p.value) || 0, y: 0, z: elevation };
        } else if (p.code === 20 && currentV) {
          currentV.y = Number(p.value) || 0;
        } else if (p.code === 42 && currentV) {
          currentV.bulge = Number(p.value) || 0;
        } else if (p.code === 40 && currentV) {
          currentV.startWidth = Number(p.value) || 0;
        } else if (p.code === 41 && currentV) {
          currentV.endWidth = Number(p.value) || 0;
        }
      }
      if (currentV) vertices.push(currentV);

      const transformedVerts = extrusion
        ? vertices.map(v => {
            const wp = ocsPointToWcs({ x: v.x, y: v.y, z: v.z ?? elevation }, extrusion);
            return { ...v, x: wp.x, y: wp.y, z: wp.z };
          })
        : vertices;

      entities.push({
        ...base,
        type: 'LWPOLYLINE',
        preservationTier: 'supported',
        vertices: transformedVerts,
        closed: Boolean(flags & 1),
        elevation,
        constantWidth
      });
      continue;
    }

    if (dxfType === 'POLYLINE') {
      const flags = valNum(pairs, 70, 0);
      const vertices: CADPolylineVertex[] = [];
      const combinedRaw: RawDxfGroupPair[] | undefined = preserveRawDxf ? [...pairs] : undefined;
      let j = i + 1;
      while (j < records.length) {
        const sub = records[j];
        if (sub.dxfType === 'VERTEX') {
          if (combinedRaw) combinedRaw.push(...sub.pairs);
          vertices.push({
            x: valNum(sub.pairs, 10),
            y: valNum(sub.pairs, 20),
            z: valNum(sub.pairs, 30),
            bulge: valOptNum(sub.pairs, 42)
          });
          j++;
        } else if (sub.dxfType === 'SEQEND') {
          if (combinedRaw) combinedRaw.push(...sub.pairs);
          j++;
          break;
        } else {
          break;
        }
      }
      i = j - 1;
      entities.push({
        ...base,
        rawDxf: combinedRaw,
        type: 'POLYLINE',
        preservationTier: 'supported',
        vertices,
        closed: Boolean(flags & 1),
        is3D: Boolean(flags & 8),
        isPolygonMesh: Boolean(flags & 16)
      });
      continue;
    }

    if (dxfType === 'SPLINE') {
      const flags = valNum(pairs, 70, 0);
      const degree = valNum(pairs, 71, 3);
      const knots: number[] = [];
      const weights: number[] = [];
      const controlPoints: Point3D[] = [];
      const fitPoints: Point3D[] = [];

      let curCtrl: Point3D | null = null;
      let curFit: Point3D | null = null;
      for (const p of pairs) {
        if (p.code === 40) knots.push(Number(p.value) || 0);
        else if (p.code === 41) weights.push(Number(p.value) || 1);
        else if (p.code === 10) {
          if (curCtrl) controlPoints.push(curCtrl);
          curCtrl = { x: Number(p.value) || 0, y: 0, z: 0 };
        } else if (p.code === 20 && curCtrl) curCtrl.y = Number(p.value) || 0;
        else if (p.code === 30 && curCtrl) curCtrl.z = Number(p.value) || 0;
        else if (p.code === 11) {
          if (curFit) fitPoints.push(curFit);
          curFit = { x: Number(p.value) || 0, y: 0, z: 0 };
        } else if (p.code === 21 && curFit) curFit.y = Number(p.value) || 0;
        else if (p.code === 31 && curFit) curFit.z = Number(p.value) || 0;
      }
      if (curCtrl) controlPoints.push(curCtrl);
      if (curFit) fitPoints.push(curFit);

      entities.push({
        ...base,
        type: 'SPLINE',
        preservationTier: 'supported',
        degree,
        controlPoints,
        fitPoints,
        knots,
        weights: weights.length > 0 ? weights : undefined,
        closed: Boolean(flags & 1)
      });
      continue;
    }

    if (dxfType === 'ELLIPSE') {
      entities.push({
        ...base,
        type: 'ELLIPSE',
        preservationTier: 'supported',
        center: { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) },
        majorAxisEndPoint: { x: valNum(pairs, 11, 1), y: valNum(pairs, 21, 0), z: valNum(pairs, 31, 0) },
        axisRatio: Math.max(0.01, valNum(pairs, 40, 1)),
        startParam: valNum(pairs, 41, 0),
        endParam: valNum(pairs, 42, Math.PI * 2)
      });
      continue;
    }

    if (dxfType === 'HATCH') {
      const patternName = valStr(pairs, 2, 'SOLID');
      const solidFill = valNum(pairs, 70, 0) === 1;
      const patternScale = valNum(pairs, 41, 1) || 1;
      const patternAngle = valNum(pairs, 52, 0);
      const boundaryLoops: Point2D[][] = [];
      let activeLoop: Point2D[] = [];
      let curPt: Point2D | null = null;
      let inBoundary = false;

      for (const p of pairs) {
        if (p.code === 92) {
          if (curPt) {
            activeLoop.push(curPt);
            curPt = null;
          }
          if (activeLoop.length > 1) boundaryLoops.push(activeLoop);
          activeLoop = [];
          inBoundary = true;
        } else if (inBoundary && p.code === 10) {
          if (curPt) activeLoop.push(curPt);
          curPt = { x: Number(p.value) || 0, y: 0 };
        } else if (inBoundary && p.code === 20 && curPt) {
          curPt.y = Number(p.value) || 0;
        } else if (p.code === 75 || p.code === 98) {
          inBoundary = false;
        }
      }
      if (curPt) activeLoop.push(curPt);
      if (activeLoop.length > 1) boundaryLoops.push(activeLoop);

      entities.push({
        ...base,
        type: 'HATCH',
        preservationTier: 'readonly',
        patternName,
        solidFill,
        patternScale,
        patternAngle,
        boundaryLoops
      });
      continue;
    }

    if (dxfType === 'SOLID' || dxfType === '3DFACE') {
      const p0: Point3D = { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) };
      const p1: Point3D = { x: valNum(pairs, 11, p0.x), y: valNum(pairs, 21, p0.y), z: valNum(pairs, 31, p0.z) };
      const p2: Point3D = { x: valNum(pairs, 12, p1.x), y: valNum(pairs, 22, p1.y), z: valNum(pairs, 32, p1.z) };
      const p3: Point3D = { x: valNum(pairs, 13, p2.x), y: valNum(pairs, 23, p2.y), z: valNum(pairs, 33, p2.z) };
      if (dxfType === 'SOLID') {
        entities.push({
          ...base,
          type: 'SOLID',
          preservationTier: 'readonly',
          points: [p0, p1, p2, p3]
        });
      } else {
        entities.push({
          ...base,
          type: '3DFACE',
          preservationTier: 'readonly',
          vertices: [p0, p1, p2, p3]
        });
      }
      continue;
    }

    if (dxfType === 'TEXT') {
      const rawText = collectTextGroups(pairs);
      const { clean, hadUnsafePattern } = sanitizeCadString(rawText);
      if (hadUnsafePattern) {
        ctx.securityWarnings.add('Đã tự động lọc mã script không an toàn khỏi văn bản TEXT/MTEXT.');
      }
      const hasAlign = valOptNum(pairs, 11) !== undefined;
      const hAlign = valNum(pairs, 72, 0);
      const vAlign = valNum(pairs, 73, 0);
      const pos: Point3D = { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) };
      const secAlign: Point3D | undefined = hasAlign
        ? { x: valNum(pairs, 11), y: valNum(pairs, 21), z: valNum(pairs, 31) }
        : undefined;

      entities.push({
        ...base,
        type: 'TEXT',
        preservationTier: 'supported',
        position: (hAlign !== 0 || vAlign !== 0) && secAlign ? secAlign : pos,
        secondAlignmentPoint: secAlign,
        height: Math.max(0.01, valNum(pairs, 40, 2.5)),
        rotation: valNum(pairs, 50, 0),
        text: decodeAutoCadText(clean),
        style: valStr(pairs, 7, 'STANDARD'),
        hAlign,
        vAlign,
        widthFactor: valNum(pairs, 41, 1) || 1,
        obliqueAngle: valNum(pairs, 51, 0)
      });
      continue;
    }

    if (dxfType === 'MTEXT') {
      const rawText = collectTextGroups(pairs);
      const { clean, hadUnsafePattern } = sanitizeCadString(rawText);
      if (hadUnsafePattern) {
        ctx.securityWarnings.add('Đã tự động lọc mã script không an toàn khỏi văn bản MTEXT.');
      }
      let rotation = valOptNum(pairs, 50);
      if (rotation === undefined) {
        const dx = valOptNum(pairs, 11);
        const dy = valOptNum(pairs, 21);
        if (dx !== undefined && dy !== undefined && (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6)) {
          rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
        }
      }
      entities.push({
        ...base,
        type: 'MTEXT',
        preservationTier: 'supported',
        position: { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) },
        height: Math.max(0.01, valNum(pairs, 40, 2.5)),
        width: Math.max(0, valNum(pairs, 41, 0)),
        rotation: rotation ?? 0,
        rawText: clean,
        plainText: stripMTextFormatting(clean),
        style: valStr(pairs, 7, 'STANDARD'),
        attachmentPoint: valNum(pairs, 71, 1),
        lineSpacingFactor: valOptNum(pairs, 44)
      });
      continue;
    }

    if (dxfType === 'ATTRIB' || dxfType === 'ATTDEF') {
      const { clean } = sanitizeCadString(valStr(pairs, 1, ''));
      const ent: CADAttribEntity = {
        ...base,
        type: dxfType,
        preservationTier: 'supported',
        position: { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) },
        tag: valStr(pairs, 2, ''),
        text: decodeAutoCadText(clean),
        prompt: dxfType === 'ATTDEF' ? decodeAutoCadText(valStr(pairs, 3, '')) : undefined,
        height: Math.max(0.01, valNum(pairs, 40, 2.5)),
        rotation: valNum(pairs, 50, 0),
        style: valStr(pairs, 7, 'STANDARD'),
        flags: valNum(pairs, 70, 0)
      };
      entities.push(ent);
      continue;
    }

    if (dxfType === 'DIMENSION') {
      const subTypeCode = valNum(pairs, 70, 0);
      const defPoint: Point3D = { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) };
      const textMidPoint: Point3D = { x: valNum(pairs, 11), y: valNum(pairs, 21), z: valNum(pairs, 31) };
      const defPoint2: Point3D | undefined =
        valOptNum(pairs, 13) !== undefined
          ? { x: valNum(pairs, 13), y: valNum(pairs, 23), z: valNum(pairs, 33) }
          : undefined;
      const defPoint3: Point3D | undefined =
        valOptNum(pairs, 14) !== undefined
          ? { x: valNum(pairs, 14), y: valNum(pairs, 24), z: valNum(pairs, 34) }
          : undefined;
      const defPoint4: Point3D | undefined =
        valOptNum(pairs, 15) !== undefined
          ? { x: valNum(pairs, 15), y: valNum(pairs, 25), z: valNum(pairs, 35) }
          : undefined;

      const measuredGroup = valOptNum(pairs, 42);
      const computedDist =
        defPoint2 && defPoint3
          ? Math.hypot(defPoint3.x - defPoint2.x, defPoint3.y - defPoint2.y)
          : 0;
      const measuredValue = measuredGroup !== undefined ? measuredGroup : computedDist;
      const overrideText = decodeAutoCadText(sanitizeCadString(valStr(pairs, 1, '')).clean);

      entities.push({
        ...base,
        type: 'DIMENSION',
        preservationTier: 'supported',
        dimensionType: resolveDimensionKind(subTypeCode),
        subTypeCode,
        defPoint,
        defPoint2,
        defPoint3,
        defPoint4,
        textMidPoint,
        text: overrideText,
        measuredValue,
        style: valStr(pairs, 3, 'STANDARD'),
        blockName: valStr(pairs, 2, '') || undefined,
        rotation: valOptNum(pairs, 50)
      });
      continue;
    }

    if (dxfType === 'LEADER' || dxfType === 'MLEADER') {
      const vertices: Point3D[] = [];
      let curV: Point3D | null = null;
      for (const p of pairs) {
        if (p.code === 10) {
          if (curV) vertices.push(curV);
          curV = { x: Number(p.value) || 0, y: 0, z: 0 };
        } else if (p.code === 20 && curV) curV.y = Number(p.value) || 0;
        else if (p.code === 30 && curV) curV.z = Number(p.value) || 0;
      }
      if (curV) vertices.push(curV);

      entities.push({
        ...base,
        type: dxfType,
        preservationTier: 'readonly',
        vertices,
        text: decodeAutoCadText(sanitizeCadString(valStr(pairs, 304, valStr(pairs, 1, ''))).clean) || undefined,
        hasArrowhead: valNum(pairs, 71, 1) !== 0
      });
      continue;
    }

    if (dxfType === 'INSERT') {
      const blockName = decodeAutoCadText(valStr(pairs, 2, ''));
      const hasFollow = valNum(pairs, 66, 0) === 1;
      const attributes: CADInsertAttribute[] = [];
      const combinedRaw: RawDxfGroupPair[] | undefined = preserveRawDxf ? [...pairs] : undefined;

      if (hasFollow) {
        let j = i + 1;
        while (j < records.length) {
          const sub = records[j];
          if (sub.dxfType === 'ATTRIB') {
            if (combinedRaw) combinedRaw.push(...sub.pairs);
            attributes.push({
              id: createCadId('att'),
              tag: valStr(sub.pairs, 2, ''),
              text: decodeAutoCadText(sanitizeCadString(valStr(sub.pairs, 1, '')).clean),
              position: { x: valNum(sub.pairs, 10), y: valNum(sub.pairs, 20), z: valNum(sub.pairs, 30) },
              height: Math.max(0.01, valNum(sub.pairs, 40, 2.5)),
              rotation: valNum(sub.pairs, 50, 0),
              style: valStr(sub.pairs, 7, 'STANDARD'),
              layer: decodeAutoCadText(valStr(sub.pairs, 8, layer)) || layer,
              handle: sub.handle,
              rawPairs: preserveRawDxf ? sub.pairs : undefined
            });
            j++;
          } else if (sub.dxfType === 'SEQEND') {
            if (combinedRaw) combinedRaw.push(...sub.pairs);
            j++;
            break;
          } else {
            break;
          }
        }
        i = j - 1;
      }

      entities.push({
        ...base,
        rawDxf: combinedRaw,
        type: 'INSERT',
        preservationTier: 'supported',
        blockName,
        position: { x: valNum(pairs, 10), y: valNum(pairs, 20), z: valNum(pairs, 30) },
        scale: {
          x: valNum(pairs, 41, 1) || 1,
          y: valNum(pairs, 42, 1) || 1,
          z: valNum(pairs, 43, 1) || 1
        },
        rotation: valNum(pairs, 50, 0),
        columnCount: valOptNum(pairs, 70),
        rowCount: valOptNum(pairs, 71),
        columnSpacing: valOptNum(pairs, 44),
        rowSpacing: valOptNum(pairs, 45),
        attributes: attributes.length > 0 ? attributes : undefined
      });
      continue;
    }

    // Fallback: Preserve unknown / proxy / 3DSOLID / REGION / VIEWPORT entities without dropping
    ctx.unknownTypes[dxfType] = (ctx.unknownTypes[dxfType] || 0) + 1;
    const px = valOptNum(pairs, 10);
    const py = valOptNum(pairs, 20);
    entities.push({
      ...base,
      type: 'UNKNOWN',
      preservationTier: 'unknown',
      dxfType,
      previewPoint: px !== undefined && py !== undefined ? { x: px, y: py, z: valNum(pairs, 30) } : undefined,
      note: `Đối tượng DXF nguyên bản (${dxfType})`
    });
  }

  return entities;
}

/**
 * Stateful streaming entity assembler used by the Chunked Web Worker parser.
 * Buffers multi-record DXF sequences (`POLYLINE -> VERTEX* -> SEQEND` and `INSERT(66=1) -> ATTRIB* -> SEQEND`)
 * across batch boundaries while converting standalone records immediately without retaining raw pairs.
 */
export class StreamingEntityAssembler {
  private pendingSeq: RawEntityRecord[] | null = null;
  private pendingSeqKind: 'POLYLINE' | 'INSERT' | null = null;

  constructor(
    private readonly ctx: EntityParseContext,
    private readonly options: EntityParseOptions = { preserveRawDxf: false }
  ) {}

  pushRecord(rec: RawEntityRecord, onEntities: (entities: CADEntity[]) => void): void {
    const t = rec.dxfType;

    if (this.pendingSeq && this.pendingSeqKind) {
      const expectsSub =
        (this.pendingSeqKind === 'POLYLINE' && t === 'VERTEX') ||
        (this.pendingSeqKind === 'INSERT' && t === 'ATTRIB');

      if (expectsSub) {
        this.pendingSeq.push(rec);
        return;
      }
      if (t === 'SEQEND') {
        this.pendingSeq.push(rec);
        const parsed = parseEntityRecords(this.pendingSeq, this.ctx, this.options);
        this.pendingSeq = null;
        this.pendingSeqKind = null;
        if (parsed.length > 0) onEntities(parsed);
        return;
      }
      // Sequence terminated implicitly by a new entity
      this.flushPending(onEntities);
    }

    if (t === 'POLYLINE') {
      this.pendingSeq = [rec];
      this.pendingSeqKind = 'POLYLINE';
      return;
    }

    if (t === 'INSERT' && valNum(rec.pairs, 66, 0) === 1) {
      this.pendingSeq = [rec];
      this.pendingSeqKind = 'INSERT';
      return;
    }

    if (t === 'SEQEND' || t === 'VERTEX' || t === 'ENDBLK') {
      return;
    }

    const parsed = parseEntityRecords([rec], this.ctx, this.options);
    if (parsed.length > 0) onEntities(parsed);
  }

  flushPending(onEntities: (entities: CADEntity[]) => void): void {
    if (!this.pendingSeq || this.pendingSeq.length === 0) {
      this.pendingSeq = null;
      this.pendingSeqKind = null;
      return;
    }
    const parsed = parseEntityRecords(this.pendingSeq, this.ctx, this.options);
    this.pendingSeq = null;
    this.pendingSeqKind = null;
    if (parsed.length > 0) onEntities(parsed);
  }
}
