import type { CADBlock, RawDxfGroupPair } from '../../core/CADTypes';
import { createCadId } from '../../core/CADRegistry';
import { decodeAutoCadText } from '../../geometry/CADCurve';
import type { RawDxfTokenizedDocument } from './RawEntityParser';
import { EntityParseContext, EntityParseOptions, parseEntityRecords } from './EntityParser';

function valNum(pairs: RawDxfGroupPair[], code: number, fallback = 0): number {
  for (const p of pairs) {
    if (p.code === code) {
      const n = Number(p.value);
      return Number.isFinite(n) ? n : fallback;
    }
  }
  return fallback;
}

function valStr(pairs: RawDxfGroupPair[], code: number, fallback = ''): string {
  for (const p of pairs) {
    if (p.code === code) return String(p.value);
  }
  return fallback;
}

export function parseBlocksFromRaw(
  raw: RawDxfTokenizedDocument,
  ctx: EntityParseContext,
  missingXrefs: string[],
  options?: EntityParseOptions
): Record<string, CADBlock> {
  const blocks: Record<string, CADBlock> = {};
  const preserveRaw = options?.preserveRawDxf !== false;

  for (const [rawName, rawBlk] of Object.entries(raw.blocks)) {
    const name = decodeAutoCadText(rawName) || rawName;
    const flags = valNum(rawBlk.headerPairs, 70, 0);
    const xrefPath = valStr(rawBlk.headerPairs, 1, '').trim() || undefined;
    if (xrefPath && !missingXrefs.includes(xrefPath)) {
      missingXrefs.push(xrefPath);
    }
    if (rawBlk.handle) ctx.allocator.register(rawBlk.handle);

    const blockUnknownTypes: Record<string, number> = {};
    const blockCtx: EntityParseContext = {
      allocator: ctx.allocator,
      securityWarnings: ctx.securityWarnings,
      unknownTypes: blockUnknownTypes
    };
    const parsedEntities = parseEntityRecords(rawBlk.entityRecords, blockCtx, options);

    blocks[name] = {
      id: createCadId('blk'),
      name,
      basePoint: {
        x: valNum(rawBlk.headerPairs, 10, 0),
        y: valNum(rawBlk.headerPairs, 20, 0),
        z: valNum(rawBlk.headerPairs, 30, 0)
      },
      entities: parsedEntities,
      isAnonymous: Boolean(flags & 1) || name.startsWith('*'),
      isPaperSpace: name.toUpperCase().startsWith('*PAPER_SPACE'),
      isXref: Boolean(flags & 4) || Boolean(xrefPath),
      xrefPath,
      handle: rawBlk.handle,
      rawHeaderPairs: preserveRaw ? rawBlk.headerPairs : undefined,
      rawEndblkPairs: preserveRaw ? rawBlk.endblkPairs : undefined
    };
  }

  return blocks;
}
