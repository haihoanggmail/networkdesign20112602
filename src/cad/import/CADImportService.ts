import { collectDependentBlockNames } from '../core/CADRegistry';
import type { CADBlock, CADDocument, CADEntity, CADLayer } from '../core/CADTypes';
import { recomputeDocumentExtents } from '../geometry/CADBounds';
import {
  type CADFileFormatPolicyKey,
  LARGE_CAD_STREAM_THRESHOLD_BYTES,
  validateCadFilePayload
} from './CADImportValidator';
import { detectDwgSignature, isBinaryDxfBuffer } from './DXFBinaryImporter';
import {
  DEFAULT_STREAM_BATCH_LINES,
  DEFAULT_WORKER_ENTITY_CHUNK_SIZE,
  DxfImportResult,
  StreamingDxfSession,
  StreamingDocumentShell,
  buildStreamingDxfImportResult,
  importDxfContent,
  streamDxfFileLineBatches
} from './DXFImporter';
import { DWGImportOutcome, importDwgBuffer } from './DWGImporter';
import type { DWGProviderConfig } from '../dwg/DWGProviderConfig';
import type { StreamEntityFilterOptions } from './parsers/RawEntityParser';
import type {
  CadDwgWorkerRequest,
  CadStreamWorkerRequest,
  CadWorkerMessage,
  CadWorkerRequest
} from '../workers/cadImport.worker';
import {
  getV8HeapMemoryStats,
  isMemoryPressureHigh,
  yieldAndReleaseMemory
} from '../storage/CADDatabase';

export type CADImportMode = 'full-edit' | 'filter-layers' | 'locked-underlay';

export interface CADImportProgressInfo {
  percent: number;
  stageVi: string;
  pass?: 1 | 2;
  entitiesParsed?: number;
  skippedCount?: number;
  heapUsedMB?: number;
  heapLimitMB?: number;
}

export interface CADImportOptions {
  projectId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  dwgProviderConfig?: DWGProviderConfig;
  lowMemoryMode?: boolean;
  filterOptions?: StreamEntityFilterOptions;
  onProgress?: (percent: number, stageVi: string) => void;
  onProgressDetail?: (info: CADImportProgressInfo) => void;
}

export type CADUnifiedImportResult =
  | {
      kind: 'dxf';
      importResult: DxfImportResult;
    }
  | {
      kind: 'dwg';
      outcome: DWGImportOutcome;
    };

/**
 * Applies user's chosen import mode (Full Edit, Filtered Layers keeping dependent blocks, or Reference Underlay)
 * before opening the document in Workspace or Canvas.
 * Uses shallow structural cloning on large entity arrays to avoid doubling V8 heap memory.
 */
export function applyImportModeToDocument(
  sourceDoc: CADDocument,
  mode: CADImportMode,
  selectedLayerNames?: string[]
): CADDocument {
  const clonedLayers: Record<string, CADLayer> = {};
  for (const [k, l] of Object.entries(sourceDoc.layers)) {
    clonedLayers[k] = { ...l };
  }

  const doc: CADDocument = {
    ...sourceDoc,
    header: { ...sourceDoc.header },
    layers: clonedLayers,
    lineTypes: { ...sourceDoc.lineTypes },
    textStyles: { ...sourceDoc.textStyles },
    dimStyles: { ...sourceDoc.dimStyles },
    blocks: { ...sourceDoc.blocks },
    layouts: [...sourceDoc.layouts],
    metadata: { ...sourceDoc.metadata },
    underlay: { ...sourceDoc.underlay }
  };

  if (mode === 'locked-underlay') {
    for (const layer of Object.values(doc.layers)) {
      layer.locked = true;
    }
    doc.underlay.enabled = true;
    doc.underlay.locked = true;
    return doc;
  }

  if (mode === 'filter-layers' && selectedLayerNames) {
    const allowed = new Set(selectedLayerNames);
    allowed.add('0'); // Always keep default layer 0
    doc.entities = doc.entities.filter(e => allowed.has(e.layer));

    const keptLayers: Record<string, CADLayer> = {};
    for (const [name, layer] of Object.entries(doc.layers)) {
      if (allowed.has(name) || name === '0') {
        keptLayers[name] = layer;
      }
    }
    doc.layers = keptLayers;

    // Preserve all Block definitions referenced by surviving entities (transitive dependencies)
    const neededBlocks = collectDependentBlockNames(doc.entities, doc.blocks);
    const keptBlocks: Record<string, CADBlock> = {};
    for (const bName of neededBlocks) {
      if (doc.blocks[bName]) {
        keptBlocks[bName] = doc.blocks[bName];
      }
    }
    doc.blocks = keptBlocks;
    doc.extents = recomputeDocumentExtents(doc);
  }

  return doc;
}

function emitProgress(
  options: CADImportOptions | undefined,
  info: CADImportProgressInfo
): void {
  options?.onProgress?.(info.percent, info.stageVi);
  options?.onProgressDetail?.(info);
}

async function runDxfWorker(
  buffer: ArrayBuffer,
  fileName: string,
  fileSizeBytes: number,
  options?: CADImportOptions
): Promise<DxfImportResult> {
  if (typeof Worker === 'undefined') {
    return importDxfContent(buffer, {
      fileName,
      fileSizeBytes,
      projectId: options?.projectId,
      filterOptions: options?.filterOptions,
      preserveRawDxf: options?.lowMemoryMode ? false : undefined,
      onProgress: (pct, stageVi) => emitProgress(options, { percent: pct, stageVi })
    });
  }

  return new Promise<DxfImportResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/cadImport.worker.ts', import.meta.url), {
        type: 'module'
      });
    } catch {
      try {
        resolve(
          importDxfContent(buffer, {
            fileName,
            fileSizeBytes,
            projectId: options?.projectId,
            filterOptions: options?.filterOptions,
            preserveRawDxf: options?.lowMemoryMode ? false : undefined,
            onProgress: (pct, stageVi) => emitProgress(options, { percent: pct, stageVi })
          })
        );
      } catch (err) {
        reject(err);
      }
      return;
    }

    const requestId = `cad_req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const timeoutMs = options?.timeoutMs ?? 120_000;
    let settled = false;

    const cleanup = () => {
      if (timerId !== null) clearTimeout(timerId);
      options?.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Đã hủy nhập tệp CAD.', 'AbortError'));
    };

    const timerId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          'Quá thời gian xử lý tệp CAD. Vui lòng thử lại với bản vẽ nhẹ hơn hoặc lọc bớt Hatch.'
        )
      );
    }, timeoutMs);

    if (options?.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    worker.onmessage = (ev: MessageEvent<CadWorkerMessage>) => {
      const msg = ev.data;
      if (!msg || msg.requestId !== requestId) return;
      if (msg.type === 'progress') {
        emitProgress(options, {
          percent: msg.percent,
          stageVi: msg.stageVi,
          pass: msg.pass,
          entitiesParsed: msg.entitiesParsed,
          skippedCount: msg.skippedCount,
          heapUsedMB: msg.heapUsedMB,
          heapLimitMB: msg.heapLimitMB
        });
      } else if (msg.type === 'result') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(msg.result);
      } else if (msg.type === 'error') {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(msg.error));
      }
    };

    worker.onerror = ev => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(ev.message || 'Lỗi Worker khi phân tích tệp DXF.'));
    };

    const copy = buffer.slice(0);
    const req: CadWorkerRequest = {
      requestId,
      fileName,
      fileSizeBytes,
      projectId: options?.projectId,
      buffer: copy,
      filterOptions: options?.filterOptions,
      preserveRawDxf: options?.lowMemoryMode ? false : undefined
    };
    worker.postMessage(req, [copy]);
  });
}

async function runDwgWorker(
  buffer: ArrayBuffer,
  fileName: string,
  options?: CADImportOptions
): Promise<DWGImportOutcome> {
  if (typeof Worker === 'undefined') {
    return importDwgBuffer(buffer, fileName, {
      projectId: options?.projectId,
      providerConfig: options?.dwgProviderConfig,
      signal: options?.signal,
      onProgress: (pct, stageVi) => emitProgress(options, { percent: pct, stageVi })
    });
  }

  return new Promise<DWGImportOutcome>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/cadImport.worker.ts', import.meta.url), {
        type: 'module'
      });
    } catch {
      void importDwgBuffer(buffer, fileName, {
        projectId: options?.projectId,
        providerConfig: options?.dwgProviderConfig,
        signal: options?.signal,
        onProgress: (pct, stageVi) => emitProgress(options, { percent: pct, stageVi })
      }).then(resolve, reject);
      return;
    }

    const requestId = `cad_dwg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const timeoutMs = options?.timeoutMs ?? 120_000;
    let settled = false;

    const cleanup = () => {
      if (timerId !== null) clearTimeout(timerId);
      options?.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Đã hủy nhập tệp DWG.', 'AbortError'));
    };

    const timerId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          'Quá thời gian giải mã tệp DWG trong trình duyệt. Vui lòng thử lưu sang DXF hoặc dùng Endpoint chuyển đổi.'
        )
      );
    }, timeoutMs);

    if (options?.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    worker.onmessage = (ev: MessageEvent<CadWorkerMessage>) => {
      const msg = ev.data;
      if (!msg || msg.requestId !== requestId) return;
      if (msg.type === 'progress') {
        emitProgress(options, {
          percent: msg.percent,
          stageVi: msg.stageVi
        });
      } else if (msg.type === 'dwg-outcome') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(msg.outcome);
      } else if (msg.type === 'error') {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(msg.error));
      }
    };

    worker.onerror = ev => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(ev.message || 'Lỗi Worker khi giải mã tệp DWG.'));
    };

    const copy = buffer.slice(0);
    const req: CadDwgWorkerRequest = {
      type: 'dwg-wasm',
      requestId,
      fileName,
      fileSizeBytes: buffer.byteLength,
      projectId: options?.projectId,
      buffer: copy,
      providerConfig: options?.dwgProviderConfig
    };
    worker.postMessage(req, [copy]);
  });
}

/**
 * Fallback streaming DXF parser on Main Thread with cooperative event-loop yields
 * when Web Workers are unavailable (e.g. headless Node tests or restricted CSP).
 */
async function runStreamingDxfInProcess(
  file: Blob,
  fileName: string,
  fileSizeBytes: number,
  options?: CADImportOptions
): Promise<DxfImportResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const lowMemoryMode =
    options?.lowMemoryMode ?? fileSizeBytes >= LARGE_CAD_STREAM_THRESHOLD_BYTES;
  const filterOptions: StreamEntityFilterOptions = options?.filterOptions ?? (
    lowMemoryMode ? { skipHatch: true, skipHeavy3DAndImages: true } : {}
  );

  const session = new StreamingDxfSession({
    fileName,
    fileSizeBytes,
    projectId: options?.projectId,
    lowMemoryMode,
    filterOptions,
    entityChunkSize: DEFAULT_WORKER_ENTITY_CHUNK_SIZE
  });

  emitProgress(options, {
    percent: 4,
    stageVi: 'Pass 1/2: Đang mở luồng đọc bảng Layer & Block...',
    pass: 1,
    entitiesParsed: 0,
    skippedCount: 0
  });

  await streamDxfFileLineBatches(file, {
    batchSizeLines: DEFAULT_STREAM_BATCH_LINES,
    signal: options?.signal,
    onBatch: async (lines, bytesRead) => {
      session.feedPass1Lines(lines);
      const pct = Math.min(28, 4 + Math.round((bytesRead / Math.max(1, fileSizeBytes)) * 24));
      emitProgress(options, {
        percent: pct,
        stageVi: `Pass 1/2: Quét bảng Layer & Block (${Math.round((bytesRead / Math.max(1, fileSizeBytes)) * 100)}%)...`,
        pass: 1,
        entitiesParsed: 0,
        skippedCount: 0
      });
      await yieldAndReleaseMemory();
    }
  });

  const p1 = session.finishPass1();
  await yieldAndReleaseMemory();

  emitProgress(options, {
    percent: 30,
    stageVi: `Pass 2/2: Đã lập chỉ mục ${p1.layerCount} Layer, ${p1.blockCount} Block. Đang nạp hình học...`,
    pass: 2,
    entitiesParsed: 0,
    skippedCount: 0
  });

  const entities: CADEntity[] = [];
  const pushChunk = async (chunk: CADEntity[]) => {
    for (let i = 0; i < chunk.length; i++) {
      entities.push(chunk[i]);
    }
    if (isMemoryPressureHigh()) {
      await yieldAndReleaseMemory();
    }
  };

  await streamDxfFileLineBatches(file, {
    batchSizeLines: DEFAULT_STREAM_BATCH_LINES,
    signal: options?.signal,
    onBatch: async (lines, bytesRead) => {
      const pendingChunks: CADEntity[][] = [];
      session.feedPass2Lines(lines, chunk => {
        pendingChunks.push(chunk);
      });
      for (const c of pendingChunks) {
        await pushChunk(c);
      }
      const heap = getV8HeapMemoryStats();
      const pct = Math.min(96, 30 + Math.round((bytesRead / Math.max(1, fileSizeBytes)) * 66));
      emitProgress(options, {
        percent: pct,
        stageVi: `Pass 2/2: Nạp đối tượng CAD (${session.entitiesParsed.toLocaleString('vi-VN')} đã đọc)...`,
        pass: 2,
        entitiesParsed: session.entitiesParsed,
        skippedCount: session.skippedCount,
        heapUsedMB: heap?.usedMB,
        heapLimitMB: heap?.limitMB
      });
      await yieldAndReleaseMemory();
    }
  });

  const tailChunks: CADEntity[][] = [];
  const shell = session.finishPass2(chunk => {
    tailChunks.push(chunk);
  });
  for (const c of tailChunks) {
    await pushChunk(c);
  }
  await yieldAndReleaseMemory();

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  emitProgress(options, {
    percent: 100,
    stageVi: 'Hoàn tất phân tích bản vẽ CAD!',
    pass: 2,
    entitiesParsed: entities.length,
    skippedCount: shell.skippedCount
  });
  return buildStreamingDxfImportResult(shell, entities, t1 - t0);
}

/**
 * Streams a large ASCII DXF `File`/`Blob` via `file.stream()` -> `TextDecoderStream` -> `LineBuffer`
 * directly into `cadImport.worker.ts` using two-pass chunked parsing with pull-based backpressure.
 */
async function runStreamingDxfWorker(
  file: Blob,
  fileName: string,
  fileSizeBytes: number,
  options?: CADImportOptions
): Promise<DxfImportResult> {
  if (typeof Worker === 'undefined') {
    return runStreamingDxfInProcess(file, fileName, fileSizeBytes, options);
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/cadImport.worker.ts', import.meta.url), {
      type: 'module'
    });
  } catch {
    return runStreamingDxfInProcess(file, fileName, fileSizeBytes, options);
  }

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const requestId = `cad_stream_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const inactivityTimeoutMs = options?.timeoutMs ?? 90_000;
  const lowMemoryMode =
    options?.lowMemoryMode ?? fileSizeBytes >= LARGE_CAD_STREAM_THRESHOLD_BYTES;
  const filterOptions: StreamEntityFilterOptions = options?.filterOptions ?? (
    lowMemoryMode ? { skipHatch: true, skipHeavy3DAndImages: true } : {}
  );

  const entities: CADEntity[] = [];
  let closed = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  let pendingReadyResolve: (() => void) | null = null;
  let pendingAckResolve: (() => void) | null = null;
  let pendingPass1Resolve: (() => void) | null = null;
  let pendingCompleteResolve: ((shell: StreamingDocumentShell) => void) | null = null;
  let pendingReject: ((err: Error) => void) | null = null;

  const resetWatchdog = () => {
    if (timerId !== null) clearTimeout(timerId);
    if (closed) return;
    timerId = setTimeout(() => {
      failAll(
        new Error(
          'Worker xử lý luồng DXF không phản hồi quá lâu. Vui lòng thử lại hoặc bật lọc bớt HATCH / Layer ẩn.'
        )
      );
    }, inactivityTimeoutMs);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    options?.signal?.removeEventListener('abort', onAbort);
    worker.terminate();
  };

  const failAll = (err: Error) => {
    const rej = pendingReject;
    pendingReadyResolve = null;
    pendingAckResolve = null;
    pendingPass1Resolve = null;
    pendingCompleteResolve = null;
    pendingReject = null;
    cleanup();
    rej?.(err);
  };

  const onAbort = () => {
    try {
      worker.postMessage({ type: 'stream-abort', requestId } satisfies CadStreamWorkerRequest);
    } catch {
      // Ignore post failure on abort
    }
    failAll(new DOMException('Đã hủy nhập tệp CAD.', 'AbortError') as unknown as Error);
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      cleanup();
      throw new DOMException('Đã hủy nhập tệp CAD.', 'AbortError');
    }
    options.signal.addEventListener('abort', onAbort, { once: true });
  }

  worker.onmessage = (ev: MessageEvent<CadWorkerMessage>) => {
    const msg = ev.data;
    if (!msg || msg.requestId !== requestId) return;
    resetWatchdog();

    switch (msg.type) {
      case 'stream-ready': {
        const res = pendingReadyResolve;
        pendingReadyResolve = null;
        res?.();
        break;
      }
      case 'progress': {
        emitProgress(options, {
          percent: msg.percent,
          stageVi: msg.stageVi,
          pass: msg.pass,
          entitiesParsed: msg.entitiesParsed,
          skippedCount: msg.skippedCount,
          heapUsedMB: msg.heapUsedMB,
          heapLimitMB: msg.heapLimitMB
        });
        break;
      }
      case 'batch-ack': {
        const res = pendingAckResolve;
        pendingAckResolve = null;
        res?.();
        break;
      }
      case 'pass1-complete': {
        const res = pendingPass1Resolve;
        pendingPass1Resolve = null;
        res?.();
        break;
      }
      case 'entities-chunk': {
        for (let i = 0; i < msg.entities.length; i++) {
          entities.push(msg.entities[i]);
        }
        break;
      }
      case 'stream-complete': {
        const res = pendingCompleteResolve;
        pendingCompleteResolve = null;
        res?.(msg.shell);
        break;
      }
      case 'error': {
        failAll(new Error(msg.error));
        break;
      }
    }
  };

  worker.onerror = ev => {
    failAll(new Error(ev.message || 'Lỗi Worker khi phân tích luồng tệp DXF.'));
  };

  try {
    resetWatchdog();

    await new Promise<void>((resolve, reject) => {
      pendingReadyResolve = resolve;
      pendingReject = reject;
      const initReq: CadStreamWorkerRequest = {
        type: 'stream-init',
        requestId,
        fileName,
        fileSizeBytes,
        projectId: options?.projectId,
        lowMemoryMode,
        filterOptions,
        entityChunkSize: DEFAULT_WORKER_ENTITY_CHUNK_SIZE
      };
      worker.postMessage(initReq);
    });

    const sendBatchAndWaitAck = (pass: 1 | 2, batchId: number, lines: string[], bytesRead: number) =>
      new Promise<void>((resolve, reject) => {
        if (closed) {
          reject(new Error('Phiên đọc luồng DXF đã đóng.'));
          return;
        }
        pendingAckResolve = resolve;
        pendingReject = reject;
        const req: CadStreamWorkerRequest = {
          type: 'stream-chunk',
          requestId,
          pass,
          batchId,
          lines,
          bytesRead
        };
        worker.postMessage(req);
      });

    // Pass 1: Stream HEADER, TABLES, LAYERS, BLOCKS to index
    emitProgress(options, {
      percent: 4,
      stageVi: 'Pass 1/2: Đang đọc luồng Streaming bảng Layer & Block...',
      pass: 1,
      entitiesParsed: 0,
      skippedCount: 0
    });

    let batchCounter = 0;
    await streamDxfFileLineBatches(file, {
      batchSizeLines: DEFAULT_STREAM_BATCH_LINES,
      signal: options?.signal,
      onBatch: async (lines, bytesRead) => {
        await sendBatchAndWaitAck(1, batchCounter++, lines, bytesRead);
      }
    });

    await new Promise<void>((resolve, reject) => {
      pendingPass1Resolve = resolve;
      pendingReject = reject;
      worker.postMessage({
        type: 'stream-pass-end',
        requestId,
        pass: 1
      } satisfies CadStreamWorkerRequest);
    });

    // Pass 2: Stream ENTITIES chunk-by-chunk with filtering & V8 heap check
    batchCounter = 0;
    await streamDxfFileLineBatches(file, {
      batchSizeLines: DEFAULT_STREAM_BATCH_LINES,
      signal: options?.signal,
      onBatch: async (lines, bytesRead) => {
        await sendBatchAndWaitAck(2, batchCounter++, lines, bytesRead);
        if (isMemoryPressureHigh()) {
          await yieldAndReleaseMemory();
        }
      }
    });

    const shell = await new Promise<StreamingDocumentShell>((resolve, reject) => {
      pendingCompleteResolve = resolve;
      pendingReject = reject;
      worker.postMessage({
        type: 'stream-pass-end',
        requestId,
        pass: 2
      } satisfies CadStreamWorkerRequest);
    });

    cleanup();
    await yieldAndReleaseMemory();

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const heap = getV8HeapMemoryStats();
    emitProgress(options, {
      percent: 100,
      stageVi: 'Hoàn tất phân tích bản vẽ CAD!',
      pass: 2,
      entitiesParsed: entities.length,
      skippedCount: shell.skippedCount,
      heapUsedMB: heap?.usedMB,
      heapLimitMB: heap?.limitMB
    });

    return buildStreamingDxfImportResult(shell, entities, t1 - t0);
  } catch (err) {
    cleanup();
    throw err;
  }
}

export class CADImportService {
  async importFile(file: File, options?: CADImportOptions): Promise<CADUnifiedImportResult> {
    if (file.size <= 0) {
      const emptyCheck = validateCadFilePayload(file.name, file.size, 'dxf-ascii');
      if (!emptyCheck.ok) {
        throw new Error(emptyCheck.error);
      }
    }

    if (options?.signal?.aborted) {
      throw new DOMException('Đã hủy nhập tệp CAD.', 'AbortError');
    }

    emitProgress(options, { percent: 2, stageVi: 'Đang kiểm tra định dạng & ngưỡng bộ nhớ tệp CAD...' });

    // Inspect only the first 64 bytes before reading/streaming so oversized DWG/Binary DXF never allocate full RAM
    const headBuffer = await file.slice(0, 64).arrayBuffer();
    if (options?.signal?.aborted) {
      throw new DOMException('Đã hủy nhập tệp CAD.', 'AbortError');
    }

    const isDwgByExt = /\.dwg$/i.test(file.name);
    const dwgSig = detectDwgSignature(headBuffer);
    const isDwg = isDwgByExt || dwgSig.isDwg;
    const isBinaryDxf = !isDwg && isBinaryDxfBuffer(headBuffer);

    const useHttpConverter =
      isDwg &&
      options?.dwgProviderConfig?.mode === 'http-converter' &&
      Boolean(options.dwgProviderConfig.endpointUrl?.trim());

    const formatPolicy: CADFileFormatPolicyKey = isDwg
      ? useHttpConverter
        ? 'dwg-http-bridge'
        : 'dwg-wasm'
      : isBinaryDxf
        ? 'dxf-binary'
        : 'dxf-ascii';

    const sizeCheck = validateCadFilePayload(file.name, file.size, formatPolicy);
    if (!sizeCheck.ok) {
      throw new Error(sizeCheck.error);
    }
    if (sizeCheck.warning) {
      emitProgress(options, { percent: 4, stageVi: sizeCheck.warning });
    }

    if (isDwg) {
      emitProgress(options, { percent: 8, stageVi: 'Đang nạp tệp nhị phân DWG...' });
      const buffer = await file.arrayBuffer();
      const outcome = useHttpConverter
        ? await importDwgBuffer(buffer, file.name, {
            projectId: options?.projectId,
            providerConfig: options?.dwgProviderConfig,
            signal: options?.signal,
            onProgress: (pct, stageVi) => emitProgress(options, { percent: pct, stageVi })
          })
        : await runDwgWorker(buffer, file.name, options);
      return { kind: 'dwg', outcome };
    }

    if (isBinaryDxf) {
      emitProgress(options, { percent: 10, stageVi: 'Đang nạp AutoCAD Binary DXF...' });
      const buffer = await file.arrayBuffer();
      const importResult = await runDxfWorker(buffer, file.name, file.size, options);
      return { kind: 'dxf', importResult };
    }

    // ASCII DXF: Stream via ReadableStream + TextDecoderStream + LineBuffer into Chunked Web Worker
    const importResult = await runStreamingDxfWorker(file, file.name, file.size, options);
    return { kind: 'dxf', importResult };
  }

  importFromString(
    dxfText: string,
    fileName = 'drawing.dxf',
    options?: Pick<CADImportOptions, 'projectId' | 'onProgress' | 'filterOptions' | 'lowMemoryMode'>
  ): DxfImportResult {
    return importDxfContent(dxfText, {
      fileName,
      fileSizeBytes: dxfText.length,
      projectId: options?.projectId,
      filterOptions: options?.filterOptions,
      preserveRawDxf: options?.lowMemoryMode ? false : undefined,
      onProgress: options?.onProgress
    });
  }
}

export const cadImportService = new CADImportService();
