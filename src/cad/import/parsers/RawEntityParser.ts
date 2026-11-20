import type { CADLayer, RawDxfGroupPair } from '../../core/CADTypes';

export interface RawEntityRecord {
  index: number;
  dxfType: string;
  handle?: string;
  pairs: RawDxfGroupPair[];
}

export interface RawBlockRecord {
  name: string;
  handle?: string;
  headerPairs: RawDxfGroupPair[];
  entityRecords: RawEntityRecord[];
  endblkPairs: RawDxfGroupPair[];
}

export interface RawExtraTable {
  name: string;
  handle?: string;
  rawHeaderPairs?: RawDxfGroupPair[];
  rawPairs: RawDxfGroupPair[];
}

export interface RawDxfTokenizedDocument {
  headerPairs: RawDxfGroupPair[];
  classesPairs?: RawDxfGroupPair[];
  tables: Record<string, RawEntityRecord[]>;
  extraTables?: RawExtraTable[];
  blocks: Record<string, RawBlockRecord>;
  entityRecords: RawEntityRecord[];
  objectsPairs?: RawDxfGroupPair[];
  thumbnailPairs?: RawDxfGroupPair[];
  malformedLines: number;
}

export interface StreamEntityFilterOptions {
  /** Skip HATCH entities (can contain tens of thousands of boundary vertices). */
  skipHatch?: boolean;
  /** Skip 3DSOLID, REGION, BODY, SURFACE, IMAGE, RASTERIMAGE, OLE2FRAME, WIPEOUT, ACAD_PROXY_ENTITY. */
  skipHeavy3DAndImages?: boolean;
  /** Skip entities assigned to layers that are turned Off (visible === false). */
  skipHiddenLayers?: boolean;
  /** Skip entities assigned to Frozen layers (frozen === true). */
  skipFrozenLayers?: boolean;
  /** Skip entities assigned to Locked layers (locked === true). */
  skipLockedLayers?: boolean;
}

export const HEAVY_3D_AND_IMAGE_DXF_TYPES = new Set([
  '3DSOLID',
  'IMAGE',
  'RASTERIMAGE',
  'REGION',
  'BODY',
  'SURFACE',
  'OLE2FRAME',
  'WIPEOUT',
  'ACAD_PROXY_ENTITY'
]);

/**
 * Checks whether a DXF entity type should be skipped immediately at the stream layer
 * before allocating raw pair arrays or geometry objects.
 */
export function isGarbageOrHeavyDxfType(
  dxfType: string,
  filter?: StreamEntityFilterOptions
): 'HATCH' | 'HEAVY_3D_IMAGE' | null {
  if (!filter) return null;
  const upper = dxfType.toUpperCase();
  if (filter.skipHatch && upper === 'HATCH') {
    return 'HATCH';
  }
  if (filter.skipHeavy3DAndImages && HEAVY_3D_AND_IMAGE_DXF_TYPES.has(upper)) {
    return 'HEAVY_3D_IMAGE';
  }
  return null;
}

/**
 * Evaluates both heavy-entity filtering and layer-state filtering (Hidden / Frozen / Locked)
 * right at the stream/raw parsing layer.
 */
export function shouldSkipStreamEntity(
  dxfType: string,
  layerName: string | undefined,
  layersMap: Record<string, Pick<CADLayer, 'visible' | 'frozen' | 'locked'>>,
  filter?: StreamEntityFilterOptions
): { skip: boolean; reason?: 'HATCH' | 'HEAVY_3D_IMAGE' | 'LAYER_HIDDEN' | 'LAYER_FROZEN' | 'LAYER_LOCKED' } {
  const heavyReason = isGarbageOrHeavyDxfType(dxfType, filter);
  if (heavyReason) {
    return { skip: true, reason: heavyReason };
  }
  if (!filter || (!filter.skipHiddenLayers && !filter.skipFrozenLayers && !filter.skipLockedLayers)) {
    return { skip: false };
  }
  const layerKey = (layerName || '0').trim() || '0';
  const layer = layersMap[layerKey];
  if (!layer) return { skip: false };

  if (filter.skipHiddenLayers && layer.visible === false) {
    return { skip: true, reason: 'LAYER_HIDDEN' };
  }
  if (filter.skipFrozenLayers && layer.frozen) {
    return { skip: true, reason: 'LAYER_FROZEN' };
  }
  if (filter.skipLockedLayers && layer.locked) {
    return { skip: true, reason: 'LAYER_LOCKED' };
  }
  return { skip: false };
}

export function isDxfCodeString(code: number): boolean {
  return (
    (code >= 0 && code <= 9) ||
    code === 100 ||
    code === 102 ||
    code === 105 ||
    (code >= 300 && code <= 369) ||
    (code >= 390 && code <= 399) ||
    (code >= 410 && code <= 419) ||
    (code >= 430 && code <= 439) ||
    (code >= 470 && code <= 479) ||
    code === 999 ||
    (code >= 1000 && code <= 1009)
  );
}

export function parseDxfPairValue(code: number, rawVal: string): string | number {
  const trimmed = rawVal.trim();
  if (isDxfCodeString(code)) {
    return trimmed;
  }
  if (
    (code >= 10 && code <= 59) ||
    (code >= 110 && code <= 149) ||
    (code >= 210 && code <= 239) ||
    (code >= 460 && code <= 469) ||
    (code >= 1010 && code <= 1059)
  ) {
    const num = parseFloat(trimmed);
    return Number.isFinite(num) ? num : trimmed;
  }
  if (
    (code >= 60 && code <= 79) ||
    (code >= 90 && code <= 99) ||
    (code >= 160 && code <= 179) ||
    (code >= 270 && code <= 299) ||
    (code >= 370 && code <= 389) ||
    (code >= 400 && code <= 409) ||
    (code >= 420 && code <= 429) ||
    (code >= 440 && code <= 459) ||
    (code >= 1060 && code <= 1071)
  ) {
    const num = parseInt(trimmed, 10);
    return Number.isFinite(num) ? num : trimmed;
  }
  return trimmed;
}

/**
 * Stateful line-by-line DXF `(code, value)` pair tokenizer that keeps sync safely
 * across arbitrary chunked line batches without splitting group code/value pairs.
 */
export class DxfPairStreamTokenizer {
  private pendingCode: number | null = null;
  public malformedLines = 0;

  reset(): void {
    this.pendingCode = null;
    this.malformedLines = 0;
  }

  feedLines(lines: string[], onPair: (code: number, value: string | number) => void): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (this.pendingCode === null) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const code = parseInt(trimmed, 10);
        if (!Number.isFinite(code)) {
          this.malformedLines += 1;
          continue;
        }
        this.pendingCode = code;
      } else {
        const code = this.pendingCode;
        this.pendingCode = null;
        onPair(code, parseDxfPairValue(code, line));
      }
    }
  }
}

export function tokenizeAsciiDxf(dxfText: string): {
  pairs: RawDxfGroupPair[];
  malformedLines: number;
} {
  const normalized = dxfText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const pairs: RawDxfGroupPair[] = [];
  let malformedLines = 0;

  let i = 0;
  while (i + 1 < lines.length) {
    const rawCodeLine = lines[i].trim();
    if (!rawCodeLine && i === lines.length - 1) break;
    const code = parseInt(rawCodeLine, 10);
    if (!Number.isFinite(code)) {
      malformedLines += 1;
      i += 1;
      continue;
    }
    const rawVal = lines[i + 1] ?? '';
    pairs.push({ code, value: parseDxfPairValue(code, rawVal) });
    i += 2;
  }
  return { pairs, malformedLines };
}

export function extractHandleFromPairs(pairs: RawDxfGroupPair[]): string | undefined {
  for (const p of pairs) {
    if (p.code === 5 || p.code === 105) {
      const s = String(p.value).trim();
      if (s) return s.toUpperCase();
    }
  }
  return undefined;
}

export function groupPairsIntoRecords(pairs: RawDxfGroupPair[]): RawEntityRecord[] {
  const records: RawEntityRecord[] = [];
  let current: RawDxfGroupPair[] | null = null;
  let seq = 0;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.code === 0) {
      if (current && current.length > 0) {
        const dxfType = String(current[0].value).toUpperCase();
        records.push({
          index: seq++,
          dxfType,
          handle: extractHandleFromPairs(current),
          pairs: current
        });
      }
      current = [p];
    } else if (current) {
      current.push(p);
    }
  }
  if (current && current.length > 0) {
    const dxfType = String(current[0].value).toUpperCase();
    records.push({
      index: seq++,
      dxfType,
      handle: extractHandleFromPairs(current),
      pairs: current
    });
  }
  return records;
}

/**
 * Splits a DXF token stream into structured raw sections while capturing every group code intact
 * for lossless round-trip export and unknown-entity preservation.
 */
export function parseRawDxfSections(dxfText: string): RawDxfTokenizedDocument {
  const { pairs, malformedLines } = tokenizeAsciiDxf(dxfText);
  return parseRawDxfSectionsFromPairs(pairs, malformedLines);
}

export function parseRawDxfSectionsFromPairs(
  pairs: RawDxfGroupPair[],
  malformedLines = 0
): RawDxfTokenizedDocument {
  const result: RawDxfTokenizedDocument = {
    headerPairs: [],
    tables: {},
    blocks: {},
    entityRecords: [],
    malformedLines
  };

  let idx = 0;
  while (idx < pairs.length) {
    const p = pairs[idx];
    if (p.code === 0 && String(p.value).toUpperCase() === 'SECTION') {
      const namePair = pairs[idx + 1];
      const secName = namePair && namePair.code === 2 ? String(namePair.value).toUpperCase() : '';
      idx += 2;
      const secPairs: RawDxfGroupPair[] = [];
      while (idx < pairs.length) {
        const cur = pairs[idx];
        if (cur.code === 0 && String(cur.value).toUpperCase() === 'ENDSEC') {
          idx += 1;
          break;
        }
        secPairs.push(cur);
        idx += 1;
      }

      if (secName === 'HEADER') {
        result.headerPairs = secPairs;
      } else if (secName === 'CLASSES') {
        result.classesPairs = secPairs;
      } else if (secName === 'OBJECTS') {
        result.objectsPairs = secPairs;
      } else if (secName === 'THUMBNAILIMAGE') {
        result.thumbnailPairs = secPairs;
      } else if (secName === 'ENTITIES') {
        result.entityRecords = groupPairsIntoRecords(secPairs);
      } else if (secName === 'TABLES') {
        const coreTables = new Set(['LTYPE', 'LAYER', 'STYLE', 'DIMSTYLE']);
        let tIdx = 0;
        while (tIdx < secPairs.length) {
          const tp = secPairs[tIdx];
          if (tp.code === 0 && String(tp.value).toUpperCase() === 'TABLE') {
            const tNamePair = secPairs[tIdx + 1];
            const tName = tNamePair && tNamePair.code === 2 ? String(tNamePair.value).toUpperCase() : '';
            tIdx += 2;
            const tableInner: RawDxfGroupPair[] = [];
            while (tIdx < secPairs.length) {
              const curT = secPairs[tIdx];
              if (curT.code === 0 && String(curT.value).toUpperCase() === 'ENDTAB') {
                tIdx += 1;
                break;
              }
              tableInner.push(curT);
              tIdx += 1;
            }
            if (tName) {
              if (coreTables.has(tName)) {
                result.tables[tName] = groupPairsIntoRecords(tableInner);
              } else {
                const headerPairs: RawDxfGroupPair[] = [];
                for (const pair of tableInner) {
                  if (pair.code === 0) break;
                  headerPairs.push(pair);
                }
                if (!result.extraTables) result.extraTables = [];
                result.extraTables.push({
                  name: tName,
                  handle: extractHandleFromPairs(headerPairs),
                  rawHeaderPairs: headerPairs.length > 0 ? headerPairs : undefined,
                  rawPairs: tableInner
                });
              }
            }
          } else {
            tIdx += 1;
          }
        }
      } else if (secName === 'BLOCKS') {
        let bIdx = 0;
        while (bIdx < secPairs.length) {
          const bp = secPairs[bIdx];
          if (bp.code === 0 && String(bp.value).toUpperCase() === 'BLOCK') {
            const headerPairs: RawDxfGroupPair[] = [bp];
            bIdx += 1;
            let blockName = '';
            while (bIdx < secPairs.length) {
              const curB = secPairs[bIdx];
              if (curB.code === 0) break;
              if (curB.code === 2 && !blockName) blockName = String(curB.value);
              headerPairs.push(curB);
              bIdx += 1;
            }
            const bodyPairs: RawDxfGroupPair[] = [];
            const endblkPairs: RawDxfGroupPair[] = [];
            while (bIdx < secPairs.length) {
              const curB = secPairs[bIdx];
              if (curB.code === 0 && String(curB.value).toUpperCase() === 'ENDBLK') {
                endblkPairs.push(curB);
                bIdx += 1;
                while (bIdx < secPairs.length && secPairs[bIdx].code !== 0) {
                  endblkPairs.push(secPairs[bIdx]);
                  bIdx += 1;
                }
                break;
              }
              bodyPairs.push(curB);
              bIdx += 1;
            }
            if (blockName) {
              result.blocks[blockName] = {
                name: blockName,
                handle: extractHandleFromPairs(headerPairs),
                headerPairs,
                entityRecords: groupPairsIntoRecords(bodyPairs),
                endblkPairs
              };
            }
          } else {
            bIdx += 1;
          }
        }
      }
    } else {
      idx += 1;
    }
  }

  return result;
}
