import type {
  CADBlock,
  CADDimensionStyle,
  CADEntity,
  CADHeaderVariables,
  CADLayer,
  CADLineType,
  CADTextStyle,
  Point3D,
  RawDxfGroupPair
} from '../core/CADTypes';
import { CADHandleAllocator } from '../core/CADRegistry';

function cleanStr(val: string): string {
  return String(val ?? '').replace(/[\r\n]+/g, ' ');
}

function fmtFloat(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1e-10) return '0';
  return Number(n.toFixed(6)).toString();
}

export function formatDxfPairs(pairs: RawDxfGroupPair[]): string {
  const out: string[] = [];
  for (const p of pairs) {
    out.push(String(p.code));
    if (typeof p.value === 'number') {
      const isInt =
        (p.code >= 60 && p.code <= 79) ||
        (p.code >= 90 && p.code <= 99) ||
        (p.code >= 160 && p.code <= 179) ||
        (p.code >= 270 && p.code <= 299) ||
        (p.code >= 370 && p.code <= 389) ||
        (p.code >= 400 && p.code <= 409) ||
        (p.code >= 420 && p.code <= 429) ||
        (p.code >= 440 && p.code <= 459) ||
        (p.code >= 1060 && p.code <= 1071);
      out.push(isInt ? String(Math.round(p.value)) : fmtFloat(p.value));
    } else {
      out.push(cleanStr(String(p.value)));
    }
  }
  return out.join('\n');
}

function pushPoint(pairs: RawDxfGroupPair[], baseCode: number, pt: Point3D): void {
  pairs.push(
    { code: baseCode, value: pt.x },
    { code: baseCode + 10, value: pt.y },
    { code: baseCode + 20, value: pt.z ?? 0 }
  );
}

function appendCommonEntityProps(
  pairs: RawDxfGroupPair[],
  entity: CADEntity,
  handle: string,
  includeAcDb: boolean
): void {
  pairs.push({ code: 5, value: handle });
  if (includeAcDb) {
    pairs.push({ code: 100, value: 'AcDbEntity' });
  }
  if (entity.space === 'paper') {
    pairs.push({ code: 67, value: 1 });
  }
  pairs.push({ code: 8, value: entity.layer || '0' });
  if (entity.lineType && entity.lineType !== 'BYLAYER') {
    pairs.push({ code: 6, value: entity.lineType });
  }
  if (typeof entity.colorIndex === 'number' && entity.colorIndex !== 256) {
    pairs.push({ code: 62, value: entity.colorIndex });
  }
  if (typeof entity.trueColor === 'number') {
    pairs.push({ code: 420, value: entity.trueColor });
  }
  if (typeof entity.lineTypeScale === 'number' && entity.lineTypeScale !== 1) {
    pairs.push({ code: 48, value: entity.lineTypeScale });
  }
  if (typeof entity.lineWeight === 'number' && entity.lineWeight !== -3) {
    pairs.push({ code: 370, value: entity.lineWeight });
  }
  if (entity.visible === false) {
    pairs.push({ code: 60, value: 1 });
  }
}

function appendXData(pairs: RawDxfGroupPair[], entity: CADEntity): void {
  if (!entity.xdata || entity.xdata.length === 0) return;
  for (const xd of entity.xdata) {
    pairs.push({ code: 1001, value: xd.appName });
    for (const v of xd.values) {
      pairs.push(v);
    }
  }
}

function patchRawPairsForUntouchedEntity(
  raw: RawDxfGroupPair[],
  entity: CADEntity,
  handle: string
): RawDxfGroupPair[] {
  const patched: RawDxfGroupPair[] = [];
  let hasHandle = false;
  let hasLayer = false;
  let inSubRecord = false;
  let inXData = false;

  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (i > 0 && p.code === 0) {
      inSubRecord = true;
      inXData = false;
    }
    if (!inSubRecord && p.code === 1001) {
      inXData = true;
    }

    if (!inSubRecord && !inXData) {
      if (p.code === 5) {
        patched.push({ code: 5, value: handle });
        hasHandle = true;
        continue;
      }
      if (p.code === 8) {
        patched.push({ code: 8, value: entity.layer || '0' });
        hasLayer = true;
        continue;
      }
      if (p.code === 60) {
        patched.push({ code: 60, value: entity.visible === false ? 1 : 0 });
        continue;
      }
    }

    patched.push({ code: p.code, value: p.value });
  }

  if ((!hasHandle || !hasLayer) && patched.length > 0) {
    // Insert right after (0, TYPE) before any sub-records
    const head = patched[0];
    const rest = patched.slice(1);
    const additions: RawDxfGroupPair[] = [];
    if (!hasHandle) additions.push({ code: 5, value: handle });
    if (!hasLayer) additions.push({ code: 8, value: entity.layer || '0' });
    return [head, ...additions, ...rest];
  }
  return patched;
}

const EMITTED_HEADER_VARS = new Set([
  '$ACADVER',
  '$INSUNITS',
  '$MEASUREMENT',
  '$LUNITS',
  '$DIMSCALE',
  '$LTSCALE',
  '$TEXTSIZE',
  '$CLAYER',
  '$INSBASE',
  '$EXTMIN',
  '$EXTMAX',
  '$LIMMIN',
  '$LIMMAX',
  '$UCSORG',
  '$UCSXDIR',
  '$UCSYDIR',
  '$HANDSEED'
]);

export function serializeHeaderToPairs(
  header: CADHeaderVariables,
  nextHandleSeed?: number
): RawDxfGroupPair[] {
  const existingSeed = header.$HANDSEED ? parseInt(header.$HANDSEED.trim(), 16) : 0;
  const resolvedSeed = Math.max(
    0x100,
    Number.isFinite(existingSeed) ? existingSeed : 0,
    nextHandleSeed ?? 0
  );

  const pairs: RawDxfGroupPair[] = [
    { code: 9, value: '$ACADVER' },
    { code: 1, value: header.$ACADVER || 'AC1015' },
    { code: 9, value: '$HANDSEED' },
    { code: 5, value: resolvedSeed.toString(16).toUpperCase() },
    { code: 9, value: '$INSUNITS' },
    { code: 70, value: header.$INSUNITS ?? 4 },
    { code: 9, value: '$MEASUREMENT' },
    { code: 70, value: header.$MEASUREMENT ?? 1 },
    { code: 9, value: '$LUNITS' },
    { code: 70, value: header.$LUNITS ?? 2 },
    { code: 9, value: '$DIMSCALE' },
    { code: 40, value: header.$DIMSCALE ?? 1 },
    { code: 9, value: '$LTSCALE' },
    { code: 40, value: header.$LTSCALE ?? 1 },
    { code: 9, value: '$TEXTSIZE' },
    { code: 40, value: header.$TEXTSIZE ?? 250 },
    { code: 9, value: '$CLAYER' },
    { code: 8, value: header.$CLAYER || '0' }
  ];

  if (header.$INSBASE) {
    pairs.push({ code: 9, value: '$INSBASE' });
    pushPoint(pairs, 10, header.$INSBASE);
  }
  if (header.$EXTMIN) {
    pairs.push({ code: 9, value: '$EXTMIN' });
    pushPoint(pairs, 10, header.$EXTMIN);
  }
  if (header.$EXTMAX) {
    pairs.push({ code: 9, value: '$EXTMAX' });
    pushPoint(pairs, 10, header.$EXTMAX);
  }
  if (header.$LIMMIN) {
    pairs.push(
      { code: 9, value: '$LIMMIN' },
      { code: 10, value: header.$LIMMIN.x },
      { code: 20, value: header.$LIMMIN.y }
    );
  }
  if (header.$LIMMAX) {
    pairs.push(
      { code: 9, value: '$LIMMAX' },
      { code: 10, value: header.$LIMMAX.x },
      { code: 20, value: header.$LIMMAX.y }
    );
  }
  if (header.$UCSORG) {
    pairs.push({ code: 9, value: '$UCSORG' });
    pushPoint(pairs, 10, header.$UCSORG);
  }
  if (header.$UCSXDIR) {
    pairs.push({ code: 9, value: '$UCSXDIR' });
    pushPoint(pairs, 10, header.$UCSXDIR);
  }
  if (header.$UCSYDIR) {
    pairs.push({ code: 9, value: '$UCSYDIR' });
    pushPoint(pairs, 10, header.$UCSYDIR);
  }

  if (header.extra) {
    for (const [varName, varPairs] of Object.entries(header.extra)) {
      if (EMITTED_HEADER_VARS.has(varName) || !Array.isArray(varPairs) || varPairs.length === 0) {
        continue;
      }
      pairs.push({ code: 9, value: varName });
      for (const p of varPairs) {
        pairs.push({ code: p.code, value: p.value });
      }
    }
  }
  return pairs;
}

function patchTableRawPairs(
  rawPairs: RawDxfGroupPair[],
  handleCode: 5 | 105,
  handle: string,
  replacements: Record<number, string | number | undefined>,
  flagsTransform?: (existingFlags: number) => number
): RawDxfGroupPair[] {
  const out: RawDxfGroupPair[] = [];
  const xdataStartIdx = rawPairs.findIndex(p => p.code === 1001);
  const seen = new Set<number>();

  for (let i = 0; i < rawPairs.length; i++) {
    const p = rawPairs[i];
    const inXData = xdataStartIdx >= 0 && i >= xdataStartIdx;
    if (!inXData) {
      if (p.code === handleCode) {
        out.push({ code: handleCode, value: handle });
        seen.add(handleCode);
        continue;
      }
      if (p.code === 70 && flagsTransform) {
        out.push({ code: 70, value: flagsTransform(Number(p.value) || 0) });
        seen.add(70);
        continue;
      }
      if (p.code in replacements) {
        seen.add(p.code);
        const val = replacements[p.code];
        if (val !== undefined) {
          out.push({ code: p.code, value: val });
        }
        continue;
      }
    }
    out.push({ code: p.code, value: p.value });
  }

  // Insert handle if missing right after code 0
  if (!seen.has(handleCode) && out.length > 0) {
    out.splice(1, 0, { code: handleCode, value: handle });
  }
  return out;
}

export function serializeLayerToPairs(
  layer: CADLayer,
  allocator: CADHandleAllocator,
  includeAcDb: boolean
): RawDxfGroupPair[] {
  const handle = layer.handle || allocator.allocate();
  allocator.register(handle);
  const color = layer.visible ? Math.abs(layer.colorIndex || 7) : -Math.abs(layer.colorIndex || 7);

  if (layer.rawPairs && layer.rawPairs.length > 0) {
    const patched = patchTableRawPairs(
      layer.rawPairs,
      5,
      handle,
      {
        2: layer.name,
        62: color,
        6: layer.lineType || 'CONTINUOUS',
        370: layer.lineWeight ?? -3,
        420: typeof layer.trueColor === 'number' ? layer.trueColor : undefined,
        290: layer.plottable === false ? 0 : 1
      },
      existing => (existing & ~5) | (layer.frozen ? 1 : 0) | (layer.locked ? 4 : 0)
    );
    if (typeof layer.trueColor === 'number' && !patched.some(p => p.code === 420)) {
      const xdIdx = patched.findIndex(p => p.code === 1001);
      const insertAt = xdIdx >= 0 ? xdIdx : patched.length;
      patched.splice(insertAt, 0, { code: 420, value: layer.trueColor });
    }
    return patched;
  }

  const flags = (layer.frozen ? 1 : 0) | (layer.locked ? 4 : 0);
  const pairs: RawDxfGroupPair[] = [
    { code: 0, value: 'LAYER' },
    { code: 5, value: handle }
  ];
  if (includeAcDb) {
    pairs.push({ code: 100, value: 'AcDbSymbolTableRecord' });
    pairs.push({ code: 100, value: 'AcDbLayerTableRecord' });
  }
  pairs.push(
    { code: 2, value: layer.name },
    { code: 70, value: flags },
    { code: 62, value: color },
    { code: 6, value: layer.lineType || 'CONTINUOUS' }
  );
  if (typeof layer.trueColor === 'number') {
    pairs.push({ code: 420, value: layer.trueColor });
  }
  if (layer.plottable === false) {
    pairs.push({ code: 290, value: 0 });
  }
  pairs.push({ code: 370, value: layer.lineWeight ?? -3 });
  return pairs;
}

export function serializeLineTypeToPairs(
  lt: CADLineType,
  allocator: CADHandleAllocator,
  includeAcDb: boolean
): RawDxfGroupPair[] {
  const handle = lt.handle || allocator.allocate();
  allocator.register(handle);
  if (lt.rawPairs && lt.rawPairs.length > 0) {
    return patchTableRawPairs(lt.rawPairs, 5, handle, {
      2: lt.name,
      3: lt.description || ''
    });
  }
  const pairs: RawDxfGroupPair[] = [
    { code: 0, value: 'LTYPE' },
    { code: 5, value: handle }
  ];
  if (includeAcDb) {
    pairs.push({ code: 100, value: 'AcDbSymbolTableRecord' });
    pairs.push({ code: 100, value: 'AcDbLinetypeTableRecord' });
  }
  pairs.push(
    { code: 2, value: lt.name },
    { code: 70, value: 0 },
    { code: 3, value: lt.description || '' },
    { code: 72, value: 65 },
    { code: 73, value: lt.pattern.length },
    { code: 40, value: lt.totalLength || 0 }
  );
  for (const dash of lt.pattern) {
    pairs.push({ code: 49, value: dash }, { code: 74, value: 0 });
  }
  return pairs;
}

export function serializeTextStyleToPairs(
  style: CADTextStyle,
  allocator: CADHandleAllocator,
  includeAcDb: boolean
): RawDxfGroupPair[] {
  const handle = style.handle || allocator.allocate();
  allocator.register(handle);
  if (style.rawPairs && style.rawPairs.length > 0) {
    return patchTableRawPairs(style.rawPairs, 5, handle, {
      2: style.name,
      40: style.fixedHeight || 0,
      41: style.widthFactor || 1,
      50: style.obliqueAngle || 0,
      3: style.fontFile || 'txt',
      4: style.bigFontFile || ''
    });
  }
  const pairs: RawDxfGroupPair[] = [
    { code: 0, value: 'STYLE' },
    { code: 5, value: handle }
  ];
  if (includeAcDb) {
    pairs.push({ code: 100, value: 'AcDbSymbolTableRecord' });
    pairs.push({ code: 100, value: 'AcDbTextStyleTableRecord' });
  }
  pairs.push(
    { code: 2, value: style.name },
    { code: 70, value: style.isShapeFile ? 1 : 0 },
    { code: 40, value: style.fixedHeight || 0 },
    { code: 41, value: style.widthFactor || 1 },
    { code: 50, value: style.obliqueAngle || 0 },
    { code: 71, value: 0 },
    { code: 42, value: style.fixedHeight || 2.5 },
    { code: 3, value: style.fontFile || 'txt' },
    { code: 4, value: style.bigFontFile || '' }
  );
  return pairs;
}

export function serializeDimStyleToPairs(
  ds: CADDimensionStyle,
  allocator: CADHandleAllocator,
  includeAcDb: boolean
): RawDxfGroupPair[] {
  const handle = ds.handle || allocator.allocate();
  allocator.register(handle);
  if (ds.rawPairs && ds.rawPairs.length > 0) {
    return patchTableRawPairs(ds.rawPairs, 105, handle, {
      2: ds.name,
      40: ds.dimscale || 1,
      41: ds.dimasz || 180,
      42: ds.dimexo || 62.5,
      44: ds.dimexe || 125,
      140: ds.dimtxt || 180,
      144: ds.dimlfac || 1,
      271: ds.dimdec ?? 2
    });
  }
  const pairs: RawDxfGroupPair[] = [
    { code: 0, value: 'DIMSTYLE' },
    { code: 105, value: handle }
  ];
  if (includeAcDb) {
    pairs.push({ code: 100, value: 'AcDbSymbolTableRecord' });
    pairs.push({ code: 100, value: 'AcDbDimStyleTableRecord' });
  }
  pairs.push(
    { code: 2, value: ds.name },
    { code: 70, value: 0 },
    { code: 40, value: ds.dimscale || 1 },
    { code: 41, value: ds.dimasz || 180 },
    { code: 42, value: ds.dimexo || 62.5 },
    { code: 44, value: ds.dimexe || 125 },
    { code: 140, value: ds.dimtxt || 180 },
    { code: 144, value: ds.dimlfac || 1 },
    { code: 271, value: ds.dimdec ?? 2 }
  );
  return pairs;
}

export function serializeEntityToPairs(
  entity: CADEntity,
  allocator: CADHandleAllocator,
  options?: { includeAcDb?: boolean; preferRawIfUntouched?: boolean }
): RawDxfGroupPair[] {
  const includeAcDb = options?.includeAcDb ?? true;
  const preferRaw = options?.preferRawIfUntouched ?? true;
  const handle = entity.handle || allocator.allocate();
  allocator.register(handle);

  // Unknown entities always preserve raw DXF pairs verbatim (patching handle/layer if needed)
  if (entity.type === 'UNKNOWN') {
    if (entity.rawDxf && entity.rawDxf.length > 0) {
      return patchRawPairsForUntouchedEntity(entity.rawDxf, entity, handle);
    }
    return [];
  }

  // Untouched entities in Round-Trip mode keep every original group code/subclass/handle intact
  if (preferRaw && !entity.dirty && entity.rawDxf && entity.rawDxf.length > 0) {
    return patchRawPairsForUntouchedEntity(entity.rawDxf, entity, handle);
  }

  const pairs: RawDxfGroupPair[] = [];

  switch (entity.type) {
    case 'LINE': {
      pairs.push({ code: 0, value: 'LINE' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbLine' });
      pushPoint(pairs, 10, entity.start);
      pushPoint(pairs, 11, entity.end);
      break;
    }
    case 'POINT': {
      pairs.push({ code: 0, value: 'POINT' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbPoint' });
      pushPoint(pairs, 10, entity.position);
      break;
    }
    case 'CIRCLE': {
      pairs.push({ code: 0, value: 'CIRCLE' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbCircle' });
      pushPoint(pairs, 10, entity.center);
      pairs.push({ code: 40, value: Math.max(0.0001, entity.radius) });
      break;
    }
    case 'ARC': {
      pairs.push({ code: 0, value: 'ARC' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) {
        pairs.push({ code: 100, value: 'AcDbCircle' });
      }
      pushPoint(pairs, 10, entity.center);
      pairs.push({ code: 40, value: Math.max(0.0001, entity.radius) });
      if (includeAcDb) {
        pairs.push({ code: 100, value: 'AcDbArc' });
      }
      pairs.push({ code: 50, value: entity.startAngle }, { code: 51, value: entity.endAngle });
      break;
    }
    case 'LWPOLYLINE': {
      pairs.push({ code: 0, value: 'LWPOLYLINE' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbPolyline' });
      pairs.push(
        { code: 90, value: entity.vertices.length },
        { code: 70, value: entity.closed ? 1 : 0 }
      );
      if (typeof entity.constantWidth === 'number') {
        pairs.push({ code: 43, value: entity.constantWidth });
      }
      if (entity.elevation) {
        pairs.push({ code: 38, value: entity.elevation });
      }
      for (const v of entity.vertices) {
        pairs.push({ code: 10, value: v.x }, { code: 20, value: v.y });
        if (typeof v.startWidth === 'number') pairs.push({ code: 40, value: v.startWidth });
        if (typeof v.endWidth === 'number') pairs.push({ code: 41, value: v.endWidth });
        if (v.bulge) pairs.push({ code: 42, value: v.bulge });
      }
      break;
    }
    case 'POLYLINE': {
      pairs.push({ code: 0, value: 'POLYLINE' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) {
        pairs.push({ code: 100, value: entity.is3D ? 'AcDb3dPolyline' : 'AcDb2dPolyline' });
      }
      const flags = (entity.closed ? 1 : 0) | (entity.is3D ? 8 : 0) | (entity.isPolygonMesh ? 16 : 0);
      pairs.push(
        { code: 66, value: 1 },
        { code: 10, value: 0 },
        { code: 20, value: 0 },
        { code: 30, value: 0 },
        { code: 70, value: flags }
      );
      appendXData(pairs, entity);
      for (const v of entity.vertices) {
        const vh = allocator.allocate();
        pairs.push({ code: 0, value: 'VERTEX' }, { code: 5, value: vh });
        if (includeAcDb) {
          pairs.push({ code: 100, value: 'AcDbEntity' });
          pairs.push({ code: 100, value: 'AcDbVertex' });
          pairs.push({ code: 100, value: entity.is3D ? 'AcDb3dPolylineVertex' : 'AcDb2dVertex' });
        }
        pairs.push(
          { code: 8, value: entity.layer || '0' },
          { code: 10, value: v.x },
          { code: 20, value: v.y },
          { code: 30, value: v.z ?? 0 }
        );
        if (v.bulge) pairs.push({ code: 42, value: v.bulge });
      }
      pairs.push(
        { code: 0, value: 'SEQEND' },
        { code: 5, value: allocator.allocate() },
        { code: 8, value: entity.layer || '0' }
      );
      return pairs;
    }
    case 'SPLINE': {
      pairs.push({ code: 0, value: 'SPLINE' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbSpline' });
      pairs.push(
        { code: 70, value: entity.closed ? 1 : 0 },
        { code: 71, value: entity.degree || 3 },
        { code: 72, value: entity.knots.length },
        { code: 73, value: entity.controlPoints.length },
        { code: 74, value: entity.fitPoints.length }
      );
      for (const k of entity.knots) pairs.push({ code: 40, value: k });
      if (entity.weights) {
        for (const w of entity.weights) pairs.push({ code: 41, value: w });
      }
      for (const cp of entity.controlPoints) pushPoint(pairs, 10, cp);
      for (const fp of entity.fitPoints) pushPoint(pairs, 11, fp);
      break;
    }
    case 'ELLIPSE': {
      pairs.push({ code: 0, value: 'ELLIPSE' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbEllipse' });
      pushPoint(pairs, 10, entity.center);
      pushPoint(pairs, 11, entity.majorAxisEndPoint);
      pairs.push(
        { code: 40, value: entity.axisRatio },
        { code: 41, value: entity.startParam },
        { code: 42, value: entity.endParam }
      );
      break;
    }
    case 'HATCH': {
      if (entity.rawDxf && entity.rawDxf.length > 0) {
        return patchRawPairsForUntouchedEntity(entity.rawDxf, entity, handle);
      }
      pairs.push({ code: 0, value: 'HATCH' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbHatch' });
      pairs.push(
        { code: 10, value: 0 },
        { code: 20, value: 0 },
        { code: 30, value: 0 },
        { code: 2, value: entity.patternName || 'SOLID' },
        { code: 70, value: entity.solidFill ? 1 : 0 },
        { code: 71, value: 0 },
        { code: 91, value: entity.boundaryLoops.length }
      );
      for (const loop of entity.boundaryLoops) {
        pairs.push({ code: 92, value: 2 }, { code: 72, value: 0 }, { code: 73, value: 1 }, { code: 93, value: loop.length });
        for (const p of loop) {
          pairs.push({ code: 10, value: p.x }, { code: 20, value: p.y });
        }
      }
      pairs.push({ code: 75, value: 0 }, { code: 76, value: 1 });
      break;
    }
    case 'SOLID': {
      pairs.push({ code: 0, value: 'SOLID' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbTrace' });
      pushPoint(pairs, 10, entity.points[0]);
      pushPoint(pairs, 11, entity.points[1]);
      pushPoint(pairs, 12, entity.points[2]);
      pushPoint(pairs, 13, entity.points[3]);
      break;
    }
    case '3DFACE': {
      pairs.push({ code: 0, value: '3DFACE' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbFace' });
      pushPoint(pairs, 10, entity.vertices[0]);
      pushPoint(pairs, 11, entity.vertices[1]);
      pushPoint(pairs, 12, entity.vertices[2]);
      pushPoint(pairs, 13, entity.vertices[3]);
      break;
    }
    case 'TEXT': {
      pairs.push({ code: 0, value: 'TEXT' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbText' });
      pushPoint(pairs, 10, entity.position);
      pairs.push(
        { code: 40, value: entity.height },
        { code: 1, value: entity.text },
        { code: 50, value: entity.rotation || 0 },
        { code: 41, value: entity.widthFactor || 1 },
        { code: 51, value: entity.obliqueAngle || 0 },
        { code: 7, value: entity.style || 'STANDARD' },
        { code: 72, value: entity.hAlign || 0 }
      );
      if (entity.secondAlignmentPoint || entity.hAlign || entity.vAlign) {
        pushPoint(pairs, 11, entity.secondAlignmentPoint || entity.position);
      }
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbText' });
      if (entity.vAlign) {
        pairs.push({ code: 73, value: entity.vAlign });
      }
      break;
    }
    case 'MTEXT': {
      pairs.push({ code: 0, value: 'MTEXT' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbMText' });
      pushPoint(pairs, 10, entity.position);
      pairs.push(
        { code: 40, value: entity.height },
        { code: 41, value: entity.width || 0 },
        { code: 71, value: entity.attachmentPoint || 1 },
        { code: 72, value: 5 },
        { code: 1, value: entity.rawText || entity.plainText },
        { code: 7, value: entity.style || 'STANDARD' },
        { code: 50, value: entity.rotation || 0 }
      );
      break;
    }
    case 'ATTRIB':
    case 'ATTDEF': {
      pairs.push({ code: 0, value: entity.type });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) {
        pairs.push({ code: 100, value: 'AcDbText' });
      }
      pushPoint(pairs, 10, entity.position);
      pairs.push(
        { code: 40, value: entity.height },
        { code: 1, value: entity.text },
        { code: 50, value: entity.rotation || 0 },
        { code: 7, value: entity.style || 'STANDARD' }
      );
      if (includeAcDb) {
        pairs.push({
          code: 100,
          value: entity.type === 'ATTRIB' ? 'AcDbAttribute' : 'AcDbAttributeDefinition'
        });
      }
      if (entity.type === 'ATTDEF') {
        pairs.push({ code: 3, value: entity.prompt || '' });
      }
      pairs.push({ code: 2, value: entity.tag }, { code: 70, value: entity.flags || 0 });
      break;
    }
    case 'DIMENSION': {
      pairs.push({ code: 0, value: 'DIMENSION' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbDimension' });
      if (entity.blockName) pairs.push({ code: 2, value: entity.blockName });
      pushPoint(pairs, 10, entity.defPoint);
      pushPoint(pairs, 11, entity.textMidPoint);
      pairs.push({ code: 70, value: entity.subTypeCode || 0 });
      if (entity.text) pairs.push({ code: 1, value: entity.text });
      pairs.push({ code: 3, value: entity.style || 'STANDARD' });
      if (includeAcDb) {
        pairs.push({ code: 100, value: 'AcDbAlignedDimension' });
      }
      if (entity.defPoint2) pushPoint(pairs, 13, entity.defPoint2);
      if (entity.defPoint3) pushPoint(pairs, 14, entity.defPoint3);
      if (entity.defPoint4) pushPoint(pairs, 15, entity.defPoint4);
      if (typeof entity.rotation === 'number') pairs.push({ code: 50, value: entity.rotation });
      break;
    }
    case 'LEADER':
    case 'MLEADER': {
      if (entity.rawDxf && entity.rawDxf.length > 0) {
        return patchRawPairsForUntouchedEntity(entity.rawDxf, entity, handle);
      }
      pairs.push({ code: 0, value: entity.type });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbLeader' });
      pairs.push({ code: 71, value: entity.hasArrowhead ? 1 : 0 }, { code: 76, value: entity.vertices.length });
      for (const v of entity.vertices) pushPoint(pairs, 10, v);
      break;
    }
    case 'INSERT': {
      pairs.push({ code: 0, value: 'INSERT' });
      appendCommonEntityProps(pairs, entity, handle, includeAcDb);
      if (includeAcDb) pairs.push({ code: 100, value: 'AcDbBlockReference' });
      if (entity.attributes && entity.attributes.length > 0) {
        pairs.push({ code: 66, value: 1 });
      }
      pairs.push({ code: 2, value: entity.blockName });
      pushPoint(pairs, 10, entity.position);
      pairs.push(
        { code: 41, value: entity.scale.x || 1 },
        { code: 42, value: entity.scale.y || 1 },
        { code: 43, value: entity.scale.z || 1 },
        { code: 50, value: entity.rotation || 0 }
      );
      if (entity.columnCount && entity.columnCount > 1) {
        pairs.push({ code: 70, value: entity.columnCount }, { code: 44, value: entity.columnSpacing || 0 });
      }
      if (entity.rowCount && entity.rowCount > 1) {
        pairs.push({ code: 71, value: entity.rowCount }, { code: 45, value: entity.rowSpacing || 0 });
      }
      appendXData(pairs, entity);
      if (entity.attributes && entity.attributes.length > 0) {
        for (const att of entity.attributes) {
          const ah = att.handle || allocator.allocate();
          allocator.register(ah);
          pairs.push({ code: 0, value: 'ATTRIB' }, { code: 5, value: ah });
          if (includeAcDb) {
            pairs.push({ code: 100, value: 'AcDbEntity' }, { code: 100, value: 'AcDbText' });
          }
          pairs.push({ code: 8, value: att.layer || entity.layer || '0' });
          pushPoint(pairs, 10, att.position);
          pairs.push(
            { code: 40, value: att.height || 2.5 },
            { code: 1, value: att.text || '' },
            { code: 50, value: att.rotation || 0 },
            { code: 7, value: att.style || 'STANDARD' }
          );
          if (includeAcDb) pairs.push({ code: 100, value: 'AcDbAttribute' });
          pairs.push({ code: 2, value: att.tag || '' }, { code: 70, value: 0 });
        }
        pairs.push(
          { code: 0, value: 'SEQEND' },
          { code: 5, value: allocator.allocate() },
          { code: 8, value: entity.layer || '0' }
        );
      }
      return pairs;
    }
  }

  appendXData(pairs, entity);
  return pairs;
}

export function serializeBlockToPairs(
  block: CADBlock,
  allocator: CADHandleAllocator,
  options?: { includeAcDb?: boolean; preferRawIfUntouched?: boolean }
): RawDxfGroupPair[] {
  const includeAcDb = options?.includeAcDb ?? true;
  const preferRaw = options?.preferRawIfUntouched ?? true;
  const blockHandle = block.handle || allocator.allocate();
  allocator.register(blockHandle);

  const pairs: RawDxfGroupPair[] = [];
  if (preferRaw && block.rawHeaderPairs && block.rawHeaderPairs.length > 0) {
    pairs.push(
      ...patchTableRawPairs(
        block.rawHeaderPairs,
        5,
        blockHandle,
        {
          2: block.name,
          3: block.name,
          10: block.basePoint?.x ?? 0,
          20: block.basePoint?.y ?? 0,
          30: block.basePoint?.z ?? 0,
          1: block.xrefPath ?? ''
        },
        existing =>
          block.isXref || block.xrefPath ? existing | 4 : existing & ~4
      )
    );
  } else {
    pairs.push({ code: 0, value: 'BLOCK' }, { code: 5, value: blockHandle });
    if (includeAcDb) {
      pairs.push({ code: 100, value: 'AcDbEntity' }, { code: 8, value: '0' }, { code: 100, value: 'AcDbBlockBegin' });
    } else {
      pairs.push({ code: 8, value: '0' });
    }
    pairs.push(
      { code: 2, value: block.name },
      { code: 70, value: block.isXref || block.xrefPath ? 4 : 0 }
    );
    pushPoint(pairs, 10, block.basePoint || { x: 0, y: 0, z: 0 });
    pairs.push({ code: 3, value: block.name });
    pairs.push({ code: 1, value: block.xrefPath || '' });
  }

  for (const ent of block.entities) {
    pairs.push(...serializeEntityToPairs(ent, allocator, { includeAcDb, preferRawIfUntouched: preferRaw }));
  }

  if (preferRaw && block.rawEndblkPairs && block.rawEndblkPairs.length > 0) {
    const existingEndHandle = block.rawEndblkPairs.find(p => p.code === 5)?.value;
    const endHandle = existingEndHandle ? String(existingEndHandle) : allocator.allocate();
    allocator.register(endHandle);
    pairs.push(...patchTableRawPairs(block.rawEndblkPairs, 5, endHandle, {}));
  } else {
    const endHandle = allocator.allocate();
    pairs.push({ code: 0, value: 'ENDBLK' }, { code: 5, value: endHandle });
    if (includeAcDb) {
      pairs.push({ code: 100, value: 'AcDbEntity' }, { code: 8, value: '0' }, { code: 100, value: 'AcDbBlockEnd' });
    } else {
      pairs.push({ code: 8, value: '0' });
    }
  }
  return pairs;
}
