import type {
  CADDimensionStyle,
  CADLayer,
  CADLineType,
  CADTextStyle,
  RawDxfGroupPair
} from '../../core/CADTypes';
import { decodeAutoCadText } from '../../geometry/CADCurve';
import type { RawDxfTokenizedDocument, RawEntityRecord } from './RawEntityParser';
import type { IDxf } from 'dxf-parser';

function getFirstVal(pairs: RawDxfGroupPair[], code: number): string | number | undefined {
  for (const p of pairs) {
    if (p.code === code) return p.value;
  }
  return undefined;
}

function getAllNumericVals(pairs: RawDxfGroupPair[], code: number): number[] {
  const out: number[] = [];
  for (const p of pairs) {
    if (p.code === code) {
      const n = Number(p.value);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

export function parseLayersFromBundle(
  dxf: Partial<IDxf> | undefined,
  raw: RawDxfTokenizedDocument
): Record<string, CADLayer> {
  const layers: Record<string, CADLayer> = {};
  const rawByName = new Map<string, RawEntityRecord>();
  for (const rec of raw.tables.LAYER || []) {
    const rawName = String(getFirstVal(rec.pairs, 2) ?? '').trim();
    const name = decodeAutoCadText(rawName) || rawName;
    if (name) rawByName.set(name, rec);
  }

  // Merge dxf-parser parsed layers
  const parsedLayers = dxf?.tables?.layer?.layers || {};
  for (const [rawName, lyr] of Object.entries(parsedLayers)) {
    const name = decodeAutoCadText(rawName) || rawName;
    const rawRec = rawByName.get(name);
    const flags = rawRec ? Number(getFirstVal(rawRec.pairs, 70) ?? 0) : 0;
    const rawColor = rawRec ? Number(getFirstVal(rawRec.pairs, 62) ?? lyr.colorIndex ?? 7) : lyr.colorIndex ?? 7;
    const trueColorRaw = rawRec ? getFirstVal(rawRec.pairs, 420) : undefined;
    const lineWeightRaw = rawRec ? Number(getFirstVal(rawRec.pairs, 370) ?? -3) : -3;
    const plottableRaw = rawRec ? getFirstVal(rawRec.pairs, 290) : 1;
    const lineType = rawRec ? String(getFirstVal(rawRec.pairs, 6) ?? 'CONTINUOUS') : 'CONTINUOUS';

    layers[name] = {
      id: `layer_${name}`,
      name,
      colorIndex: Math.abs(rawColor || 7),
      trueColor: typeof trueColorRaw === 'number' ? trueColorRaw : undefined,
      lineType: lineType || 'CONTINUOUS',
      lineWeight: Number.isFinite(lineWeightRaw) ? lineWeightRaw : -3,
      visible: rawColor >= 0 && lyr.visible !== false,
      frozen: Boolean(lyr.frozen) || Boolean(flags & 1),
      locked: Boolean(flags & 4),
      plottable: plottableRaw === undefined ? true : Number(plottableRaw) !== 0,
      handle: rawRec?.handle,
      rawPairs: rawRec?.pairs
    };
  }

  // Ensure any raw LAYER records missed by dxf-parser are included
  for (const [name, rawRec] of rawByName.entries()) {
    if (layers[name]) continue;
    const flags = Number(getFirstVal(rawRec.pairs, 70) ?? 0);
    const rawColor = Number(getFirstVal(rawRec.pairs, 62) ?? 7);
    const trueColorRaw = getFirstVal(rawRec.pairs, 420);
    const lineWeightRaw = Number(getFirstVal(rawRec.pairs, 370) ?? -3);
    const plottableRaw = getFirstVal(rawRec.pairs, 290);
    const lineType = String(getFirstVal(rawRec.pairs, 6) ?? 'CONTINUOUS');

    layers[name] = {
      id: `layer_${name}`,
      name,
      colorIndex: Math.abs(rawColor || 7),
      trueColor: typeof trueColorRaw === 'number' ? trueColorRaw : undefined,
      lineType: lineType || 'CONTINUOUS',
      lineWeight: Number.isFinite(lineWeightRaw) ? lineWeightRaw : -3,
      visible: rawColor >= 0,
      frozen: Boolean(flags & 1),
      locked: Boolean(flags & 4),
      plottable: plottableRaw === undefined ? true : Number(plottableRaw) !== 0,
      handle: rawRec.handle,
      rawPairs: rawRec.pairs
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
  return layers;
}

export function parseLineTypesFromBundle(
  dxf: Partial<IDxf> | undefined,
  raw: RawDxfTokenizedDocument
): Record<string, CADLineType> {
  const lineTypes: Record<string, CADLineType> = {};
  const rawByName = new Map<string, RawEntityRecord>();
  for (const rec of raw.tables.LTYPE || []) {
    const name = String(getFirstVal(rec.pairs, 2) ?? '').trim();
    if (name) rawByName.set(name.toUpperCase(), rec);
  }

  const parsed = dxf?.tables?.lineType?.lineTypes || {};
  for (const [key, lt] of Object.entries(parsed)) {
    const norm = (lt.name || key).toUpperCase();
    const rawRec = rawByName.get(norm);
    const patternNums = rawRec
      ? getAllNumericVals(rawRec.pairs, 49)
      : (lt.pattern || []).map(v => Number(v)).filter(Number.isFinite);
    const totalLen = rawRec
      ? Number(getFirstVal(rawRec.pairs, 40) ?? lt.patternLength ?? 0)
      : Number(lt.patternLength ?? 0);

    lineTypes[norm] = {
      name: lt.name || key,
      description: lt.description || '',
      pattern: patternNums,
      totalLength: Number.isFinite(totalLen) ? totalLen : 0,
      handle: rawRec?.handle,
      rawPairs: rawRec?.pairs
    };
  }

  for (const [norm, rawRec] of rawByName.entries()) {
    if (lineTypes[norm]) continue;
    lineTypes[norm] = {
      name: String(getFirstVal(rawRec.pairs, 2) ?? norm),
      description: String(getFirstVal(rawRec.pairs, 3) ?? ''),
      pattern: getAllNumericVals(rawRec.pairs, 49),
      totalLength: Number(getFirstVal(rawRec.pairs, 40) ?? 0),
      handle: rawRec.handle,
      rawPairs: rawRec.pairs
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
  return lineTypes;
}

export function parseTextStylesFromRaw(raw: RawDxfTokenizedDocument): Record<string, CADTextStyle> {
  const styles: Record<string, CADTextStyle> = {};
  for (const rec of raw.tables.STYLE || []) {
    const name = String(getFirstVal(rec.pairs, 2) ?? '').trim();
    if (!name) continue;
    const flags = Number(getFirstVal(rec.pairs, 70) ?? 0);
    const fontFile = String(getFirstVal(rec.pairs, 3) ?? 'txt').trim();
    const bigFontFile = getFirstVal(rec.pairs, 4);
    styles[name.toUpperCase()] = {
      name,
      fontFile,
      bigFontFile: bigFontFile ? String(bigFontFile).trim() : undefined,
      fixedHeight: Number(getFirstVal(rec.pairs, 40) ?? 0) || 0,
      widthFactor: Number(getFirstVal(rec.pairs, 41) ?? 1) || 1,
      obliqueAngle: Number(getFirstVal(rec.pairs, 50) ?? 0) || 0,
      isShapeFile: Boolean(flags & 1),
      handle: rec.handle,
      rawPairs: rec.pairs
    };
  }
  if (!styles['STANDARD']) {
    styles['STANDARD'] = {
      name: 'STANDARD',
      fontFile: 'txt',
      fixedHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0
    };
  }
  return styles;
}

export function parseDimStylesFromRaw(raw: RawDxfTokenizedDocument): Record<string, CADDimensionStyle> {
  const styles: Record<string, CADDimensionStyle> = {};
  for (const rec of raw.tables.DIMSTYLE || []) {
    const name = String(getFirstVal(rec.pairs, 2) ?? '').trim();
    if (!name) continue;
    styles[name.toUpperCase()] = {
      name,
      dimscale: Number(getFirstVal(rec.pairs, 40) ?? 1) || 1,
      dimasz: Number(getFirstVal(rec.pairs, 41) ?? 2.5) || 2.5,
      dimexo: Number(getFirstVal(rec.pairs, 42) ?? 0.625) || 0.625,
      dimexe: Number(getFirstVal(rec.pairs, 44) ?? 1.25) || 1.25,
      dimtxt: Number(getFirstVal(rec.pairs, 140) ?? 2.5) || 2.5,
      dimlfac: Number(getFirstVal(rec.pairs, 144) ?? 1) || 1,
      dimdec: Number(getFirstVal(rec.pairs, 271) ?? 2) || 2,
      handle: rec.handle,
      rawPairs: rec.pairs
    };
  }
  if (!styles['STANDARD']) {
    styles['STANDARD'] = {
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
  return styles;
}
