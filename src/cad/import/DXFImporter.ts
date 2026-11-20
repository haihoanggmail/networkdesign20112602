import type {
  BoundingBox2D,
  CADBlock,
  CADDimensionStyle,
  CADDocument,
  CADEntity,
  CADHeaderVariables,
  CADLayer,
  CADLayout,
  CADLineType,
  CADTextStyle,
  Point3D,
  RawDxfGroupPair
} from '../core/CADTypes';
import { CAD_SCHEMA_VERSION, createDefaultLayer } from '../core/CADDocument';
import { CADHandleAllocator, createCadId } from '../core/CADRegistry';
import { normalizeCADUnitCode } from '../core/CADUnits';
import {
  computeEntityBounds2D,
  emptyBounds,
  expandBoundsPoint,
  isValidBounds,
  mergeBounds,
  recomputeDocumentExtents
} from '../geometry/CADBounds';
import { decodeBinaryDxfBuffer, detectDwgSignature, isBinaryDxfBuffer } from './DXFBinaryImporter';
import { parseDxfWithRawCapture } from './parsers/DxfParserAdapter';
import {
  parseDimStylesFromRaw,
  parseLayersFromBundle,
  parseLineTypesFromBundle,
  parseTextStylesFromRaw
} from './parsers/LayerParser';
import {
  EntityParseContext,
  EntityParseOptions,
  StreamingEntityAssembler,
  parseEntityRecords
} from './parsers/EntityParser';
import {
  DxfPairStreamTokenizer,
  RawBlockRecord,
  RawDxfTokenizedDocument,
  RawEntityRecord,
  StreamEntityFilterOptions,
  extractHandleFromPairs,
  groupPairsIntoRecords,
  isGarbageOrHeavyDxfType,
  shouldSkipStreamEntity
} from './parsers/RawEntityParser';
import { parseBlocksFromRaw } from './parsers/BlockParser';
import {
  LARGE_CAD_STREAM_THRESHOLD_BYTES,
  MAX_CAD_ENTITIES,
  auditMissingCadFonts,
  detectBlockCycles,
  validateCadFilePayload
} from './CADImportValidator';
import { CADImportReport, CADImportWarning, buildCADImportReport } from './CADImportReport';

export const DEFAULT_STREAM_BATCH_LINES = 10_000;
export const DEFAULT_WORKER_ENTITY_CHUNK_SIZE = 5_000;

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

const CORE_HEADER_VARS = new Set([
  '$ACADVER',
  '$INSUNITS',
  '$MEASUREMENT',
  '$LUNITS',
  '$DIMSCALE',
  '$LTSCALE',
  '$TEXTSIZE',
  '$CLAYER',
  '$EXTMIN',
  '$EXTMAX',
  '$LIMMIN',
  '$LIMMAX',
  '$INSBASE',
  '$UCSORG',
  '$UCSXDIR',
  '$UCSYDIR',
  '$HANDSEED'
]);

function parseHeaderVariables(dxfHeader: Record<string, unknown> | undefined): CADHeaderVariables {
  const h = dxfHeader || {};
  const pt = (key: string): Point3D | undefined => {
    const v = h[key] as { x?: number; y?: number; z?: number } | undefined;
    if (!v || typeof v !== 'object') return undefined;
    if (!Number.isFinite(Number(v.x)) || !Number.isFinite(Number(v.y))) return undefined;
    return { x: Number(v.x), y: Number(v.y), z: Number(v.z) || 0 };
  };
  const num = (key: string, fallback: number): number => {
    const n = Number(h[key]);
    return Number.isFinite(n) ? n : fallback;
  };
  const acadVer = typeof h.$ACADVER === 'string' && h.$ACADVER.trim() ? h.$ACADVER.trim() : 'AC1015';
  const extMin = pt('$EXTMIN');
  const extMax = pt('$EXTMAX');
  const limMin = pt('$LIMMIN');
  const limMax = pt('$LIMMAX');
  const handseedRaw = typeof h.$HANDSEED === 'string' ? h.$HANDSEED.trim().toUpperCase() : undefined;

  return {
    $ACADVER: acadVer,
    $INSUNITS: normalizeCADUnitCode(h.$INSUNITS ?? 4),
    $MEASUREMENT: num('$MEASUREMENT', 1) === 0 ? 0 : 1,
    $LUNITS: num('$LUNITS', 2),
    $DIMSCALE: num('$DIMSCALE', 1) || 1,
    $LTSCALE: num('$LTSCALE', 1) || 1,
    $TEXTSIZE: num('$TEXTSIZE', 250) || 250,
    $CLAYER: typeof h.$CLAYER === 'string' && h.$CLAYER.trim() ? h.$CLAYER.trim() : '0',
    $EXTMIN: extMin,
    $EXTMAX: extMax,
    $LIMMIN: limMin ? { x: limMin.x, y: limMin.y } : undefined,
    $LIMMAX: limMax ? { x: limMax.x, y: limMax.y } : undefined,
    $INSBASE: pt('$INSBASE') || { x: 0, y: 0, z: 0 },
    $UCSORG: pt('$UCSORG'),
    $UCSXDIR: pt('$UCSXDIR'),
    $UCSYDIR: pt('$UCSYDIR'),
    $HANDSEED: handseedRaw || undefined
  };
}

/**
 * Parses CAD header variables directly from raw `HEADER` section group pairs,
 * preserving `$HANDSEED` and all extra/custom `$*` variables for round-trip DXF fidelity.
 */
export function parseHeaderVariablesFromRawPairs(
  headerPairs: RawDxfGroupPair[],
  fallbackDxfHeader?: Record<string, unknown>
): CADHeaderVariables {
  const map: Record<string, unknown> = fallbackDxfHeader ? { ...fallbackDxfHeader } : {};
  const extra: Record<string, RawDxfGroupPair[]> = {};
  let currentVar = '';
  let currentRawPairs: RawDxfGroupPair[] = [];
  let pt: { x?: number; y?: number; z?: number } | null = null;
  let scalarVal: unknown = undefined;

  const commitVar = () => {
    if (!currentVar) return;
    if (CORE_HEADER_VARS.has(currentVar)) {
      if (pt && (pt.x !== undefined || pt.y !== undefined)) {
        map[currentVar] = pt;
      } else if (scalarVal !== undefined) {
        map[currentVar] = scalarVal;
      }
    } else if (currentRawPairs.length > 0) {
      extra[currentVar] = currentRawPairs;
    }
    currentVar = '';
    currentRawPairs = [];
    pt = null;
    scalarVal = undefined;
  };

  for (const p of headerPairs) {
    if (p.code === 9) {
      commitVar();
      currentVar = String(p.value).trim();
    } else if (currentVar) {
      currentRawPairs.push({ code: p.code, value: p.value });
      if (p.code === 10) {
        pt = pt || {};
        pt.x = Number(p.value);
      } else if (p.code === 20) {
        pt = pt || {};
        pt.y = Number(p.value);
      } else if (p.code === 30) {
        pt = pt || {};
        pt.z = Number(p.value);
      } else if (scalarVal === undefined) {
        scalarVal = p.value;
      }
    }
  }
  commitVar();

  const parsed = parseHeaderVariables(map);
  if (Object.keys(extra).length > 0) {
    parsed.extra = extra;
  }
  return parsed;
}

/**
 * LineBuffer accumulates decoded UTF-8 text chunks from a `ReadableStream` + `TextDecoderStream`
 * and splits them into complete lines without cutting across `\r\n`, `\n`, or DXF `(code, value)` pairs.
 */
export class LineBuffer {
  private partial = '';
  private pendingCR = false;
  private queuedLines: string[] = [];

  push(chunk: string): void {
    if (!chunk) return;
    let text = chunk;

    if (this.pendingCR) {
      this.pendingCR = false;
      if (text.startsWith('\n')) {
        text = text.slice(1);
      }
    }

    if (text.endsWith('\r')) {
      this.pendingCR = true;
      text = text.slice(0, -1);
      // Emit a newline marker for the trailing \r right away after combining with partial
      const combined = this.partial + text;
      this.partial = '';
      const parts = combined.split(/\r\n|\n|\r/);
      for (let i = 0; i < parts.length; i++) {
        this.queuedLines.push(parts[i]);
      }
      return;
    }

    const combined = this.partial + text;
    const parts = combined.split(/\r\n|\n|\r/);
    this.partial = parts.pop() ?? '';
    for (let i = 0; i < parts.length; i++) {
      this.queuedLines.push(parts[i]);
    }
  }

  get bufferedLineCount(): number {
    return this.queuedLines.length;
  }

  /**
   * Drains up to `batchSize` complete lines. When `pairAligned` is true (default),
   * guarantees an even number of lines so `[Code]` and `[Value]` DXF pairs stay together.
   */
  takeBatch(batchSize = DEFAULT_STREAM_BATCH_LINES, pairAligned = true): string[] | null {
    const minRequired = pairAligned ? Math.max(2, batchSize - (batchSize % 2)) : batchSize;
    if (this.queuedLines.length < minRequired) return null;
    const takeCount = pairAligned ? minRequired : batchSize;
    const batch = this.queuedLines.slice(0, takeCount);
    this.queuedLines = this.queuedLines.slice(takeCount);
    return batch;
  }

  /**
   * Flushes all remaining queued lines and any final partial line at EOF.
   */
  flush(): string[] {
    if (this.partial.length > 0) {
      this.queuedLines.push(this.partial);
      this.partial = '';
    }
    this.pendingCR = false;
    const out = this.queuedLines;
    this.queuedLines = [];
    return out;
  }
}

/**
 * Streams a Blob/File line-by-line via `file.stream()` -> `ReadableStream` -> `TextDecoderStream` -> `LineBuffer`,
 * emitting pair-aligned batches with async backpressure and AbortSignal support.
 */
export async function streamDxfFileLineBatches(
  file: Blob,
  options: {
    batchSizeLines?: number;
    signal?: AbortSignal;
    onBatch: (lines: string[], bytesRead: number) => Promise<void> | void;
  }
): Promise<{ totalBytesRead: number; totalLines: number }> {
  const batchSize = Math.max(2, options.batchSizeLines ?? DEFAULT_STREAM_BATCH_LINES);
  const lineBuffer = new LineBuffer();
  let bytesRead = 0;
  let totalLines = 0;

  if (options.signal?.aborted) {
    throw new DOMException('Đã hủy nhập tệp CAD.', 'AbortError');
  }

  const rawByteStream: ReadableStream<Uint8Array> = file.stream();

  const useTextDecoderStream =
    typeof TextDecoderStream !== 'undefined' && typeof TransformStream !== 'undefined';

  if (useTextDecoderStream) {
    const trackedByteStream = rawByteStream.pipeThrough(
      new TransformStream<Uint8Array, BufferSource>({
        transform(chunk, controller) {
          bytesRead += chunk.byteLength;
          controller.enqueue(chunk as BufferSource);
        }
      })
    );
    const textStream = trackedByteStream.pipeThrough(
      new TextDecoderStream('utf-8', { fatal: false })
    );
    const reader = textStream.getReader();

    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (options.signal?.aborted) {
          throw new DOMException('Đã hủy nhập tệp CAD.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          lineBuffer.push(value);
          while (true) {
            const batch = lineBuffer.takeBatch(batchSize, true);
            if (!batch) break;
            totalLines += batch.length;
            await options.onBatch(batch, bytesRead);
          }
        }
      }
      const tail = lineBuffer.flush();
      if (tail.length > 0) {
        totalLines += tail.length;
        await options.onBatch(tail, bytesRead);
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // Ignore if already released
      }
    }
  } else {
    // Fallback for runtimes lacking TextDecoderStream (e.g. older Node test environments)
    const reader = rawByteStream.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        if (options.signal?.aborted) {
          throw new DOMException('Đã hủy nhập tệp CAD.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytesRead += value.byteLength;
          const chunkText = decoder.decode(value, { stream: true });
          if (chunkText) {
            lineBuffer.push(chunkText);
            while (true) {
              const batch = lineBuffer.takeBatch(batchSize, true);
              if (!batch) break;
              totalLines += batch.length;
              await options.onBatch(batch, bytesRead);
            }
          }
        }
      }
      const tailText = decoder.decode();
      if (tailText) lineBuffer.push(tailText);
      const tail = lineBuffer.flush();
      if (tail.length > 0) {
        totalLines += tail.length;
        await options.onBatch(tail, bytesRead);
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        // Ignore
      }
    }
  }

  return { totalBytesRead: bytesRead, totalLines };
}

export interface StreamingDxfSessionOptions {
  fileName: string;
  fileSizeBytes: number;
  projectId?: string;
  lowMemoryMode?: boolean;
  filterOptions?: StreamEntityFilterOptions;
  entityChunkSize?: number;
}

export interface StreamingDocumentShell {
  id: string;
  name: string;
  projectId?: string;
  schemaVersion: number;
  header: CADHeaderVariables;
  layers: Record<string, CADLayer>;
  lineTypes: Record<string, CADLineType>;
  textStyles: Record<string, CADTextStyle>;
  dimStyles: Record<string, CADDimensionStyle>;
  blocks: Record<string, CADBlock>;
  layouts: CADLayout[];
  extents: BoundingBox2D;
  nextHandleSeed: number;
  rawSections?: CADDocument['rawSections'];
  metadata: CADDocument['metadata'];
  underlay: CADDocument['underlay'];
  createdAt: string;
  updatedAt: string;
  extraWarnings: CADImportWarning[];
  skippedCount: number;
  skippedTypes: Record<string, number>;
  entityCount: number;
  supportedCount: number;
  readonlyCount: number;
  unknownCount: number;
}

/**
 * Multi-pass streaming DXF parser designed to run inside `cadImport.worker.ts` (or headless in tests).
 *
 * - Pass 1: Scans stream to index `HEADER`, `TABLES` (`LAYER`, `LTYPE`, `STYLE`, `DIMSTYLE`), and `BLOCKS`
 *   while counting `ENTITIES` without retaining entity pair payloads in RAM.
 * - Pass 2: Streams `ENTITIES` chunk-by-chunk, applies garbage/heavy-entity & layer filtering right at the
 *   pair-stream layer, converts to `CADEntity` chunks, computes bounds incrementally, and flushes/clears chunks.
 */
export class StreamingDxfSession {
  public readonly fileName: string;
  public readonly fileSizeBytes: number;
  public readonly projectId?: string;
  public readonly lowMemoryMode: boolean;
  public readonly filterOptions: StreamEntityFilterOptions;
  public readonly entityChunkSize: number;

  private readonly startTimeMs: number;
  private tokenizer = new DxfPairStreamTokenizer();

  // Pass 1 section indexing state
  private p1Section: string = 'NONE';
  private p1ExpectSectionName = false;
  private p1HeaderPairs: RawDxfGroupPair[] = [];
  private p1ClassesPairs: RawDxfGroupPair[] = [];
  private p1ObjectsPairs: RawDxfGroupPair[] = [];
  private p1ThumbnailPairs: RawDxfGroupPair[] = [];
  private p1Tables: Record<string, RawEntityRecord[]> = {};
  private p1ExtraTables: NonNullable<RawDxfTokenizedDocument['extraTables']> = [];
  private p1ExtraTablePairCount = 0;
  private p1InTable = false;
  private p1ExpectTableName = false;
  private p1CurrentTableName = '';
  private p1CurrentTablePairs: RawDxfGroupPair[] = [];
  private p1Blocks: Record<string, RawBlockRecord> = {};
  private p1BlockState: 'NONE' | 'HEADER' | 'BODY' | 'ENDBLK' = 'NONE';
  private p1BlockHeaderPairs: RawDxfGroupPair[] = [];
  private p1BlockName = '';
  private p1BlockBodyPairs: RawDxfGroupPair[] = [];
  private p1BlockEndblkPairs: RawDxfGroupPair[] = [];
  private p1EntitySeqCount = 0;

  // Resolved Pass 1 metadata & dictionaries
  public header!: CADHeaderVariables;
  public layers: Record<string, CADLayer> = {};
  public lineTypes: Record<string, CADLineType> = {};
  public textStyles: Record<string, CADTextStyle> = {};
  public dimStyles: Record<string, CADDimensionStyle> = {};
  public blocks: Record<string, CADBlock> = {};
  public layouts: CADLayout[] = [{ name: 'Model', tabOrder: 0, isModelSpace: true }];
  public allocator = new CADHandleAllocator();
  public securityWarnings = new Set<string>();
  public unknownTypes: Record<string, number> = {};
  public missingXrefs: string[] = [];
  public missingFonts: string[] = [];
  public pass1EstimatedEntities = 0;

  // Pass 2 streaming entity state
  private p2Section: string = 'NONE';
  private p2ExpectSectionName = false;
  private p2CurrentType = '';
  private p2CurrentPairs: RawDxfGroupPair[] = [];
  private p2IgnoringEntity = false;
  private p2CurrentHasFollow = false;
  private p2SkipSeqKind: 'POLYLINE' | 'INSERT' | null = null;
  private p2RecordSeq = 0;
  private p2Assembler: StreamingEntityAssembler | null = null;
  private p2ChunkBuffer: CADEntity[] = [];
  private p2AccExtents: BoundingBox2D = emptyBounds();

  public entitiesParsed = 0;
  public supportedCount = 0;
  public readonlyCount = 0;
  public unknownCount = 0;
  public skippedCount = 0;
  public skippedTypes: Record<string, number> = {};

  constructor(options: StreamingDxfSessionOptions) {
    this.startTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.fileName = options.fileName;
    this.fileSizeBytes = options.fileSizeBytes;
    this.projectId = options.projectId;
    this.lowMemoryMode =
      options.lowMemoryMode ?? options.fileSizeBytes >= LARGE_CAD_STREAM_THRESHOLD_BYTES;
    this.filterOptions = options.filterOptions ?? {};
    this.entityChunkSize = Math.max(500, options.entityChunkSize ?? DEFAULT_WORKER_ENTITY_CHUNK_SIZE);
  }

  private recordSkipped(reason: string, dxfType: string): void {
    this.skippedCount += 1;
    const key =
      reason === 'HATCH'
        ? 'HATCH'
        : reason === 'HEAVY_3D_IMAGE'
          ? dxfType
          : `${reason}:${dxfType}`;
    this.skippedTypes[key] = (this.skippedTypes[key] || 0) + 1;
  }

  feedPass1Lines(lines: string[]): void {
    const rawPairCap = this.lowMemoryMode ? 20_000 : 250_000;

    this.tokenizer.feedLines(lines, (code, value) => {
      if (this.p1ExpectSectionName) {
        this.p1ExpectSectionName = false;
        if (code === 2) {
          this.p1Section = String(value).toUpperCase();
          return;
        }
        this.p1Section = 'OTHER';
      }

      if (code === 0 && String(value).toUpperCase() === 'SECTION') {
        this.p1ExpectSectionName = true;
        return;
      }

      if (code === 0 && String(value).toUpperCase() === 'ENDSEC') {
        if (this.p1Section === 'BLOCKS' && this.p1BlockState !== 'NONE') {
          this.commitPass1Block();
        }
        this.p1Section = 'NONE';
        this.p1InTable = false;
        return;
      }

      switch (this.p1Section) {
        case 'HEADER': {
          if (this.p1HeaderPairs.length < 15_000) {
            this.p1HeaderPairs.push({ code, value });
          }
          break;
        }
        case 'CLASSES': {
          if (!this.lowMemoryMode && this.p1ClassesPairs.length < rawPairCap) {
            this.p1ClassesPairs.push({ code, value });
          }
          break;
        }
        case 'OBJECTS': {
          if (!this.lowMemoryMode && this.p1ObjectsPairs.length < rawPairCap) {
            this.p1ObjectsPairs.push({ code, value });
          }
          break;
        }
        case 'THUMBNAILIMAGE': {
          if (!this.lowMemoryMode && this.p1ThumbnailPairs.length < 50_000) {
            this.p1ThumbnailPairs.push({ code, value });
          }
          break;
        }
        case 'TABLES': {
          if (this.p1ExpectTableName) {
            this.p1ExpectTableName = false;
            if (code === 2) {
              this.p1CurrentTableName = String(value).toUpperCase();
              this.p1CurrentTablePairs = [];
              this.p1InTable = true;
              return;
            }
          }
          if (code === 0 && String(value).toUpperCase() === 'TABLE') {
            this.p1ExpectTableName = true;
            return;
          }
          if (code === 0 && String(value).toUpperCase() === 'ENDTAB') {
            if (this.p1InTable) {
              if (
                this.p1CurrentTableName === 'LAYER' ||
                this.p1CurrentTableName === 'LTYPE' ||
                this.p1CurrentTableName === 'STYLE' ||
                this.p1CurrentTableName === 'DIMSTYLE'
              ) {
                this.p1Tables[this.p1CurrentTableName] = groupPairsIntoRecords(this.p1CurrentTablePairs);
              } else if (
                !this.lowMemoryMode &&
                this.p1CurrentTableName &&
                this.p1ExtraTablePairCount + this.p1CurrentTablePairs.length <= rawPairCap
              ) {
                const tableHeader: RawDxfGroupPair[] = [];
                for (const pair of this.p1CurrentTablePairs) {
                  if (pair.code === 0) break;
                  tableHeader.push(pair);
                }
                this.p1ExtraTables.push({
                  name: this.p1CurrentTableName,
                  handle: extractHandleFromPairs(tableHeader),
                  rawHeaderPairs: tableHeader.length > 0 ? tableHeader : undefined,
                  rawPairs: this.p1CurrentTablePairs
                });
                this.p1ExtraTablePairCount += this.p1CurrentTablePairs.length;
              }
            }
            this.p1InTable = false;
            this.p1CurrentTableName = '';
            this.p1CurrentTablePairs = [];
            return;
          }
          if (this.p1InTable) {
            const isCoreTable =
              this.p1CurrentTableName === 'LAYER' ||
              this.p1CurrentTableName === 'LTYPE' ||
              this.p1CurrentTableName === 'STYLE' ||
              this.p1CurrentTableName === 'DIMSTYLE';
            if (isCoreTable || (!this.lowMemoryMode && this.p1ExtraTablePairCount + this.p1CurrentTablePairs.length < rawPairCap)) {
              this.p1CurrentTablePairs.push({ code, value });
            }
          }
          break;
        }
        case 'BLOCKS': {
          const upperVal = code === 0 ? String(value).toUpperCase() : '';
          if (code === 0 && upperVal === 'BLOCK') {
            if (this.p1BlockState !== 'NONE') this.commitPass1Block();
            this.p1BlockState = 'HEADER';
            this.p1BlockHeaderPairs = [{ code, value }];
            this.p1BlockName = '';
            this.p1BlockBodyPairs = [];
            this.p1BlockEndblkPairs = [];
            return;
          }
          if (this.p1BlockState === 'HEADER') {
            if (code === 0) {
              this.p1BlockState = upperVal === 'ENDBLK' ? 'ENDBLK' : 'BODY';
              if (this.p1BlockState === 'ENDBLK') {
                this.p1BlockEndblkPairs.push({ code, value });
              } else {
                this.p1BlockBodyPairs.push({ code, value });
              }
            } else {
              if (code === 2 && !this.p1BlockName) this.p1BlockName = String(value);
              this.p1BlockHeaderPairs.push({ code, value });
            }
            return;
          }
          if (this.p1BlockState === 'BODY') {
            if (code === 0 && upperVal === 'ENDBLK') {
              this.p1BlockState = 'ENDBLK';
              this.p1BlockEndblkPairs.push({ code, value });
            } else {
              this.p1BlockBodyPairs.push({ code, value });
            }
            return;
          }
          if (this.p1BlockState === 'ENDBLK') {
            this.p1BlockEndblkPairs.push({ code, value });
          }
          break;
        }
        case 'ENTITIES': {
          if (code === 0) {
            const u = String(value).toUpperCase();
            if (u !== 'VERTEX' && u !== 'SEQEND' && u !== 'ATTRIB') {
              this.p1EntitySeqCount += 1;
            }
          }
          break;
        }
        default:
          break;
      }
    });
  }

  private commitPass1Block(): void {
    if (this.p1BlockName) {
      let bodyRecords = groupPairsIntoRecords(this.p1BlockBodyPairs);
      if (this.filterOptions.skipHatch || this.filterOptions.skipHeavy3DAndImages) {
        bodyRecords = bodyRecords.filter(
          rec => !isGarbageOrHeavyDxfType(rec.dxfType, this.filterOptions)
        );
      }
      this.p1Blocks[this.p1BlockName] = {
        name: this.p1BlockName,
        handle: extractHandleFromPairs(this.p1BlockHeaderPairs),
        headerPairs: this.p1BlockHeaderPairs,
        entityRecords: bodyRecords,
        endblkPairs: this.p1BlockEndblkPairs
      };
    }
    this.p1BlockState = 'NONE';
    this.p1BlockHeaderPairs = [];
    this.p1BlockName = '';
    this.p1BlockBodyPairs = [];
    this.p1BlockEndblkPairs = [];
  }

  finishPass1(): {
    layerCount: number;
    blockCount: number;
    estimatedEntityCount: number;
  } {
    if (this.p1BlockState !== 'NONE') {
      this.commitPass1Block();
    }

    const rawDoc: RawDxfTokenizedDocument = {
      headerPairs: this.p1HeaderPairs,
      classesPairs: this.p1ClassesPairs.length > 0 ? this.p1ClassesPairs : undefined,
      tables: this.p1Tables,
      blocks: this.p1Blocks,
      entityRecords: [],
      objectsPairs: this.p1ObjectsPairs.length > 0 ? this.p1ObjectsPairs : undefined,
      thumbnailPairs: this.p1ThumbnailPairs.length > 0 ? this.p1ThumbnailPairs : undefined,
      malformedLines: this.tokenizer.malformedLines
    };

    this.header = parseHeaderVariablesFromRawPairs(this.p1HeaderPairs);
    if (this.header.$HANDSEED) {
      const parsedSeed = parseInt(this.header.$HANDSEED, 16);
      if (Number.isFinite(parsedSeed) && parsedSeed > 0) {
        this.allocator.register((parsedSeed - 1).toString(16));
      }
    }
    this.layers = parseLayersFromBundle(undefined, rawDoc);
    this.lineTypes = parseLineTypesFromBundle(undefined, rawDoc);
    this.textStyles = parseTextStylesFromRaw(rawDoc);
    this.dimStyles = parseDimStylesFromRaw(rawDoc);

    for (const l of Object.values(this.layers)) {
      if (l.handle) this.allocator.register(l.handle);
    }
    for (const lt of Object.values(this.lineTypes)) {
      if (lt.handle) this.allocator.register(lt.handle);
    }
    for (const st of Object.values(this.textStyles)) {
      if (st.handle) this.allocator.register(st.handle);
    }
    for (const ds of Object.values(this.dimStyles)) {
      if (ds.handle) this.allocator.register(ds.handle);
    }
    for (const p of this.p1ObjectsPairs) {
      if (p.code === 5 || p.code === 105) this.allocator.register(String(p.value));
    }
    for (const tbl of this.p1ExtraTables) {
      if (tbl.handle) this.allocator.register(tbl.handle);
      for (const p of tbl.rawPairs) {
        if (p.code === 5 || p.code === 105) this.allocator.register(String(p.value));
      }
    }

    const parseOpts: EntityParseOptions = { preserveRawDxf: !this.lowMemoryMode };
    const ctx: EntityParseContext = {
      allocator: this.allocator,
      securityWarnings: this.securityWarnings,
      unknownTypes: this.unknownTypes
    };

    this.blocks = parseBlocksFromRaw(rawDoc, ctx, this.missingXrefs, parseOpts);

    const cycleWarnings = detectBlockCycles(this.blocks);
    for (const w of cycleWarnings) {
      this.securityWarnings.add(w);
    }

    this.missingFonts = auditMissingCadFonts(this.textStyles);
    this.layouts = [{ name: 'Model', tabOrder: 0, isModelSpace: true }];
    for (const b of Object.values(this.blocks)) {
      if (b.isPaperSpace && !this.layouts.some(l => l.name === b.name)) {
        this.layouts.push({ name: b.name, tabOrder: this.layouts.length, isModelSpace: false });
      }
    }

    this.pass1EstimatedEntities = this.p1EntitySeqCount;

    // Release temporary Pass 1 raw buffers immediately to keep V8 heap clean before Pass 2
    this.p1HeaderPairs = [];
    this.p1Tables = {};
    this.p1Blocks = {};
    this.p1CurrentTablePairs = [];
    this.tokenizer.reset();

    this.p2Assembler = new StreamingEntityAssembler(ctx, parseOpts);

    return {
      layerCount: Object.keys(this.layers).length,
      blockCount: Object.keys(this.blocks).length,
      estimatedEntityCount: this.pass1EstimatedEntities
    };
  }

  private pushParsedEntitiesToChunk(
    entities: CADEntity[],
    onEntityChunk: (chunk: CADEntity[]) => void
  ): void {
    for (const ent of entities) {
      if (this.entitiesParsed >= MAX_CAD_ENTITIES) {
        this.recordSkipped('CAP_EXCEEDED', ent.type);
        continue;
      }
      if (!this.layers[ent.layer]) {
        this.layers[ent.layer] = createDefaultLayer(ent.layer, 7);
      }

      // Precompute entity bounds inside worker so Main Thread spatial indexing is O(N) without re-tessellating
      const eb = computeEntityBounds2D(ent, this.blocks);
      if (isValidBounds(eb)) {
        ent.bounds = eb;
        expandBoundsPoint(this.p2AccExtents, eb.minX, eb.minY);
        expandBoundsPoint(this.p2AccExtents, eb.maxX, eb.maxY);
      }

      if (ent.preservationTier === 'supported') this.supportedCount++;
      else if (ent.preservationTier === 'readonly') this.readonlyCount++;
      else this.unknownCount++;

      this.entitiesParsed += 1;
      this.p2ChunkBuffer.push(ent);

      if (this.p2ChunkBuffer.length >= this.entityChunkSize) {
        const out = this.p2ChunkBuffer;
        this.p2ChunkBuffer = [];
        onEntityChunk(out);
      }
    }
  }

  private commitCurrentPass2Record(onEntityChunk: (chunk: CADEntity[]) => void): void {
    if (!this.p2CurrentType) return;
    const dxfType = this.p2CurrentType;
    const pairs = this.p2CurrentPairs;
    const wasIgnored = this.p2IgnoringEntity;
    const hadFollow = this.p2CurrentHasFollow;

    this.p2CurrentType = '';
    this.p2CurrentPairs = [];
    this.p2IgnoringEntity = false;
    this.p2CurrentHasFollow = false;

    if (wasIgnored) {
      if (dxfType === 'POLYLINE') {
        this.p2SkipSeqKind = 'POLYLINE';
      } else if (dxfType === 'INSERT' && hadFollow) {
        this.p2SkipSeqKind = 'INSERT';
      }
      return;
    }

    if (this.p2SkipSeqKind) {
      if (
        (this.p2SkipSeqKind === 'POLYLINE' && dxfType === 'VERTEX') ||
        (this.p2SkipSeqKind === 'INSERT' && dxfType === 'ATTRIB')
      ) {
        return;
      }
      if (dxfType === 'SEQEND') {
        this.p2SkipSeqKind = null;
        return;
      }
      this.p2SkipSeqKind = null;
    }

    const rec: RawEntityRecord = {
      index: this.p2RecordSeq++,
      dxfType,
      handle: extractHandleFromPairs(pairs),
      pairs
    };
    this.p2Assembler?.pushRecord(rec, entities => {
      this.pushParsedEntitiesToChunk(entities, onEntityChunk);
    });
  }

  feedPass2Lines(lines: string[], onEntityChunk: (chunk: CADEntity[]) => void): void {
    this.tokenizer.feedLines(lines, (code, value) => {
      if (this.p2ExpectSectionName) {
        this.p2ExpectSectionName = false;
        if (code === 2) {
          this.p2Section = String(value).toUpperCase();
          return;
        }
        this.p2Section = 'OTHER';
      }

      if (code === 0 && String(value).toUpperCase() === 'SECTION') {
        this.p2ExpectSectionName = true;
        return;
      }

      if (code === 0 && String(value).toUpperCase() === 'ENDSEC') {
        if (this.p2Section === 'ENTITIES') {
          this.commitCurrentPass2Record(onEntityChunk);
          this.p2Assembler?.flushPending(entities => {
            this.pushParsedEntitiesToChunk(entities, onEntityChunk);
          });
        }
        this.p2Section = 'NONE';
        return;
      }

      if (this.p2Section !== 'ENTITIES') return;

      if (code === 0) {
        this.commitCurrentPass2Record(onEntityChunk);
        const dxfType = String(value).toUpperCase();
        this.p2CurrentType = dxfType;

        if (this.p2SkipSeqKind) {
          if (
            (this.p2SkipSeqKind === 'POLYLINE' && dxfType === 'VERTEX') ||
            (this.p2SkipSeqKind === 'INSERT' && dxfType === 'ATTRIB') ||
            dxfType === 'SEQEND'
          ) {
            this.p2IgnoringEntity = true;
            this.p2CurrentPairs = [];
            return;
          }
          this.p2SkipSeqKind = null;
        }

        // Task 3: Skip garbage / heavy entities immediately at stream layer before allocating pair arrays!
        const heavySkip = isGarbageOrHeavyDxfType(dxfType, this.filterOptions);
        if (heavySkip) {
          this.p2IgnoringEntity = true;
          this.p2CurrentPairs = [];
          this.recordSkipped(heavySkip, dxfType);
          return;
        }

        this.p2IgnoringEntity = false;
        this.p2CurrentHasFollow = false;
        this.p2CurrentPairs = [{ code, value }];
        return;
      }

      if (this.p2CurrentType === 'INSERT' && code === 66 && Number(value) === 1) {
        this.p2CurrentHasFollow = true;
      }

      if (this.p2IgnoringEntity) {
        return;
      }

      // Layer-based stream filtering as soon as Group Code 8 arrives
      if (code === 8 && this.p2CurrentType) {
        const layerName = String(value).trim() || '0';
        const skipCheck = shouldSkipStreamEntity(
          this.p2CurrentType,
          layerName,
          this.layers,
          this.filterOptions
        );
        if (skipCheck.skip && skipCheck.reason) {
          this.p2IgnoringEntity = true;
          this.p2CurrentPairs = [];
          this.recordSkipped(skipCheck.reason, this.p2CurrentType);
          return;
        }
      }

      this.p2CurrentPairs.push({ code, value });
    });
  }

  finishPass2(onEntityChunk: (chunk: CADEntity[]) => void): StreamingDocumentShell {
    this.commitCurrentPass2Record(onEntityChunk);
    this.p2Assembler?.flushPending(entities => {
      this.pushParsedEntitiesToChunk(entities, onEntityChunk);
    });

    if (this.p2ChunkBuffer.length > 0) {
      const tail = this.p2ChunkBuffer;
      this.p2ChunkBuffer = [];
      onEntityChunk(tail);
    }

    const extents: BoundingBox2D = isValidBounds(this.p2AccExtents)
      ? this.p2AccExtents
      : { minX: 0, minY: 0, maxX: 10000, maxY: 8000 };

    const spanX = Math.max(1, extents.maxX - extents.minX);
    const spanY = Math.max(1, extents.maxY - extents.minY);
    const maxSpan = Math.max(spanX, spanY);
    const autoUnderlayScale = Number(Math.min(2, Math.max(0.002, 1000 / maxSpan)).toFixed(6));

    const now = new Date().toISOString();
    const baseName = this.fileName.replace(/\.(dxf|dwg)$/i, '') || 'AutoCAD Drawing';
    const acadLabel = ACAD_VERSION_LABELS[this.header.$ACADVER] || this.header.$ACADVER;

    const extraWarnings: CADImportWarning[] = [];
    if (this.tokenizer.malformedLines > 0) {
      extraWarnings.push({
        code: 'MALFORMED_LINES',
        severity: 'info',
        messageVi: `Đã tự động bỏ qua ${this.tokenizer.malformedLines} dòng mã nhóm DXF không chuẩn để tiếp tục đọc bản vẽ.`,
        count: this.tokenizer.malformedLines
      });
    }

    if (this.lowMemoryMode || this.skippedCount > 0) {
      const skippedSummary = Object.entries(this.skippedTypes)
        .map(([k, v]) => `${k}: ${v.toLocaleString('vi-VN')}`)
        .join(', ');
      extraWarnings.push({
        code: 'LOW_MEMORY_MODE',
        severity: 'info',
        messageVi:
          this.skippedCount > 0
            ? `Chế độ đọc luồng Streaming tiết kiệm RAM đã lọc bỏ ${this.skippedCount.toLocaleString('vi-VN')} đối tượng nặng/ẩn (${skippedSummary}).`
            : 'Chế độ đọc luồng Streaming tiết kiệm RAM (đã lược bỏ rawDxf dự phòng trên từng thực thể để chống tràn bộ nhớ V8).',
        remediationVi:
          'Bản vẽ vẫn hiển thị đầy đủ lớp Layer, đường nét và Block; khi xuất DXF sẽ sử dụng bộ xuất chuẩn AC1015 Clean DXF.'
      });
    }

    return {
      id: createCadId('cad'),
      name: baseName,
      projectId: this.projectId,
      schemaVersion: CAD_SCHEMA_VERSION,
      header: this.header,
      layers: this.layers,
      lineTypes: this.lineTypes,
      textStyles: this.textStyles,
      dimStyles: this.dimStyles,
      blocks: this.blocks,
      layouts: this.layouts,
      extents,
      nextHandleSeed: this.allocator.getNextSeed(),
      rawSections:
        !this.lowMemoryMode &&
        (this.p1ClassesPairs.length > 0 ||
          this.p1ObjectsPairs.length > 0 ||
          this.p1ThumbnailPairs.length > 0 ||
          this.p1ExtraTables.length > 0)
          ? {
              classes: this.p1ClassesPairs.length > 0 ? this.p1ClassesPairs : undefined,
              objects: this.p1ObjectsPairs.length > 0 ? this.p1ObjectsPairs : undefined,
              thumbnail: this.p1ThumbnailPairs.length > 0 ? this.p1ThumbnailPairs : undefined,
              extraTables: this.p1ExtraTables.length > 0 ? this.p1ExtraTables : undefined
            }
          : undefined,
      metadata: {
        sourceFileName: this.fileName,
        sourceFileSizeBytes: this.fileSizeBytes,
        sourceFormat: 'dxf-ascii',
        acadVersion: `${this.header.$ACADVER} (${acadLabel})`,
        hasRawRoundTripData: !this.lowMemoryMode,
        missingFonts: this.missingFonts,
        missingXrefs: this.missingXrefs,
        unknownEntityTypes: this.unknownTypes,
        securityWarnings: Array.from(this.securityWarnings),
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
      updatedAt: now,
      extraWarnings,
      skippedCount: this.skippedCount,
      skippedTypes: { ...this.skippedTypes },
      entityCount: this.entitiesParsed,
      supportedCount: this.supportedCount,
      readonlyCount: this.readonlyCount,
      unknownCount: this.unknownCount
    };
  }

  assembleImportResult(shell: StreamingDocumentShell, entities: CADEntity[]): DxfImportResult {
    const doc: CADDocument = {
      id: shell.id,
      name: shell.name,
      projectId: shell.projectId,
      schemaVersion: shell.schemaVersion,
      header: shell.header,
      layers: shell.layers,
      lineTypes: shell.lineTypes,
      textStyles: shell.textStyles,
      dimStyles: shell.dimStyles,
      blocks: shell.blocks,
      layouts: shell.layouts,
      entities,
      extents: shell.extents,
      nextHandleSeed: shell.nextHandleSeed,
      rawSections: shell.rawSections,
      metadata: shell.metadata,
      underlay: shell.underlay,
      createdAt: shell.createdAt,
      updatedAt: shell.updatedAt
    };

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const report = buildCADImportReport(
      doc,
      Math.max(1, Math.round(t1 - this.startTimeMs)),
      shell.extraWarnings,
      {
        skippedCount: shell.skippedCount,
        skippedTypes: shell.skippedTypes,
        streamingUsed: true
      }
    );

    return { document: doc, report };
  }
}

export function buildStreamingDxfImportResult(
  shell: StreamingDocumentShell,
  entities: CADEntity[],
  parseDurationMs: number
): DxfImportResult {
  const doc: CADDocument = {
    id: shell.id,
    name: shell.name,
    projectId: shell.projectId,
    schemaVersion: shell.schemaVersion,
    header: shell.header,
    layers: shell.layers,
    lineTypes: shell.lineTypes,
    textStyles: shell.textStyles,
    dimStyles: shell.dimStyles,
    blocks: shell.blocks,
    layouts: shell.layouts,
    entities,
    extents: shell.extents,
    nextHandleSeed: shell.nextHandleSeed,
    rawSections: shell.rawSections,
    metadata: shell.metadata,
    underlay: shell.underlay,
    createdAt: shell.createdAt,
    updatedAt: shell.updatedAt
  };

  const report = buildCADImportReport(doc, Math.max(1, Math.round(parseDurationMs)), shell.extraWarnings, {
    skippedCount: shell.skippedCount,
    skippedTypes: shell.skippedTypes,
    streamingUsed: true
  });

  return { document: doc, report };
}

export interface DxfImportResult {
  document: CADDocument;
  report: CADImportReport;
}

export function importDxfContent(
  input: string | ArrayBuffer,
  options?: {
    fileName?: string;
    fileSizeBytes?: number;
    projectId?: string;
    filterOptions?: StreamEntityFilterOptions;
    preserveRawDxf?: boolean;
    onProgress?: (pct: number, stageVi: string) => void;
  }
): DxfImportResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const fileName = options?.fileName || 'drawing.dxf';
  const extraWarnings: CADImportWarning[] = [];

  let byteLength = options?.fileSizeBytes ?? 0;
  let asciiText = '';
  let sourceFormat: CADDocument['metadata']['sourceFormat'] = 'dxf-ascii';
  let preDecodedPairs = undefined;

  if (typeof input === 'string') {
    byteLength = byteLength || input.length;
    const sizeCheck = validateCadFilePayload(fileName, byteLength, 'dxf-ascii');
    if (!sizeCheck.ok) throw new Error(sizeCheck.error);
    asciiText = input;
  } else {
    byteLength = byteLength || input.byteLength;
    const dwgCheck = detectDwgSignature(input);
    if (dwgCheck.isDwg) {
      throw new Error(
        `Tệp "${fileName}" là định dạng nhị phân DWG (${dwgCheck.versionLabel}). Trình duyệt không đọc trực tiếp tệp DWG độc quyền qua bộ đọc DXF — vui lòng mở qua bộ giải mã DWG.`
      );
    }

    const isBinary = isBinaryDxfBuffer(input);
    const sizeCheck = validateCadFilePayload(
      fileName,
      byteLength,
      isBinary ? 'dxf-binary' : 'dxf-ascii'
    );
    if (!sizeCheck.ok) throw new Error(sizeCheck.error);

    if (isBinary) {
      options?.onProgress?.(18, 'Đang giải mã AutoCAD Binary DXF...');
      const decoded = decodeBinaryDxfBuffer(input);
      asciiText = decoded.asciiDxf;
      preDecodedPairs = decoded.pairs;
      sourceFormat = 'dxf-binary';
      extraWarnings.push({
        code: 'BINARY_DXF_CONVERTED',
        severity: 'info',
        messageVi: 'Tệp là AutoCAD Binary DXF — đã được giải mã cục bộ thành công trên trình duyệt.'
      });
    } else {
      asciiText = new TextDecoder('utf-8', { fatal: false }).decode(input);
    }
  }

  options?.onProgress?.(36, 'Đang phân tích cấu trúc DXF & giữ dữ liệu gốc...');
  const { dxf, raw } = parseDxfWithRawCapture(asciiText, preDecodedPairs);

  if (raw.entityRecords.length > MAX_CAD_ENTITIES * 2 && !options?.filterOptions) {
    throw new Error(
      `Bản vẽ chứa quá nhiều bản ghi (${raw.entityRecords.length.toLocaleString('vi-VN')} > ngưỡng an toàn). Vui lòng chia nhỏ bản vẽ trước khi mở.`
    );
  }

  if (raw.malformedLines > 0) {
    extraWarnings.push({
      code: 'MALFORMED_LINES',
      severity: 'info',
      messageVi: `Đã tự động bỏ qua ${raw.malformedLines} dòng mã nhóm DXF không chuẩn để tiếp tục đọc bản vẽ.`,
      count: raw.malformedLines
    });
  }

  options?.onProgress?.(55, 'Đang đọc Layer, LineType, TextStyle & DimStyle...');
  const allocator = new CADHandleAllocator();
  const layers = parseLayersFromBundle(dxf, raw);
  const lineTypes = parseLineTypesFromBundle(dxf, raw);
  const textStyles = parseTextStylesFromRaw(raw);
  const dimStyles = parseDimStylesFromRaw(raw);

  for (const l of Object.values(layers)) {
    if (l.handle) allocator.register(l.handle);
  }
  for (const lt of Object.values(lineTypes)) {
    if (lt.handle) allocator.register(lt.handle);
  }
  for (const st of Object.values(textStyles)) {
    if (st.handle) allocator.register(st.handle);
  }
  for (const ds of Object.values(dimStyles)) {
    if (ds.handle) allocator.register(ds.handle);
  }
  for (const p of raw.objectsPairs || []) {
    if (p.code === 5 || p.code === 105) allocator.register(String(p.value));
  }
  for (const tbl of raw.extraTables || []) {
    if (tbl.handle) allocator.register(tbl.handle);
    for (const p of tbl.rawPairs) {
      if (p.code === 5 || p.code === 105) allocator.register(String(p.value));
    }
  }

  const securityWarnings = new Set<string>();
  const unknownTypes: Record<string, number> = {};
  const missingXrefs: string[] = [];
  const ctx: EntityParseContext = { allocator, securityWarnings, unknownTypes };
  const parseOpts: EntityParseOptions = { preserveRawDxf: options?.preserveRawDxf ?? true };

  options?.onProgress?.(70, 'Đang dựng hệ thống Block & đối tượng CAD...');
  const blocks = parseBlocksFromRaw(raw, ctx, missingXrefs, parseOpts);

  let recordsToParse = raw.entityRecords;
  let skippedCount = 0;
  const skippedTypes: Record<string, number> = {};
  if (options?.filterOptions) {
    recordsToParse = raw.entityRecords.filter(rec => {
      let layerName = '0';
      for (const p of rec.pairs) {
        if (p.code === 8) {
          layerName = String(p.value).trim() || '0';
          break;
        }
      }
      const chk = shouldSkipStreamEntity(rec.dxfType, layerName, layers, options.filterOptions);
      if (chk.skip) {
        skippedCount += 1;
        skippedTypes[rec.dxfType] = (skippedTypes[rec.dxfType] || 0) + 1;
        return false;
      }
      return true;
    });
  }

  const entities = parseEntityRecords(recordsToParse, ctx, parseOpts);

  // Security check on recursive blocks
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
  const header = parseHeaderVariablesFromRawPairs(
    raw.headerPairs,
    dxf.header as Record<string, unknown> | undefined
  );
  if (header.$HANDSEED) {
    const parsedSeed = parseInt(header.$HANDSEED, 16);
    if (Number.isFinite(parsedSeed) && parsedSeed > 0) {
      allocator.register((parsedSeed - 1).toString(16));
    }
  }

  const layouts: CADLayout[] = [{ name: 'Model', tabOrder: 0, isModelSpace: true }];
  for (const b of Object.values(blocks)) {
    if (b.isPaperSpace && !layouts.some(l => l.name === b.name)) {
      layouts.push({ name: b.name, tabOrder: layouts.length, isModelSpace: false });
    }
  }

  options?.onProgress?.(88, 'Đang tính biên bản vẽ (Extents) & chỉ mục không gian...');
  const extents = recomputeDocumentExtents({ entities, blocks });

  // Compute default CAD-to-HACHIHI canvas scale so drawing fits nicely (~1000px wide) as underlay
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
    rawSections: {
      classes: raw.classesPairs,
      objects: raw.objectsPairs,
      thumbnail: raw.thumbnailPairs,
      extraTables: raw.extraTables
    },
    metadata: {
      sourceFileName: fileName,
      sourceFileSizeBytes: byteLength,
      sourceFormat,
      acadVersion: `${header.$ACADVER} (${acadLabel})`,
      hasRawRoundTripData: parseOpts.preserveRawDxf !== false,
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

  options?.onProgress?.(100, 'Hoàn tất phân tích bản vẽ CAD!');
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const report = buildCADImportReport(doc, Math.max(1, Math.round(t1 - t0)), extraWarnings, {
    skippedCount,
    skippedTypes,
    streamingUsed: false
  });

  return { document: doc, report };
}
