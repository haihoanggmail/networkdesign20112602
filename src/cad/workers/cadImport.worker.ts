/// <reference lib="webworker" />
import type { CADEntity } from '../core/CADTypes';
import {
  DxfImportResult,
  StreamingDxfSession,
  StreamingDocumentShell,
  importDxfContent
} from '../import/DXFImporter';
import type { StreamEntityFilterOptions } from '../import/parsers/RawEntityParser';
import { importDwgBuffer, type DWGImportOutcome } from '../import/DWGImporter';
import type { DWGProviderConfig } from '../dwg/DWGProviderConfig';
import {
  V8_CRITICAL_HEAP_RATIO,
  getV8HeapMemoryStats,
  yieldAndReleaseMemory
} from '../storage/CADDatabase';

export interface CadWorkerRequest {
  requestId: string;
  fileName: string;
  fileSizeBytes: number;
  projectId?: string;
  buffer: ArrayBuffer;
  filterOptions?: StreamEntityFilterOptions;
  preserveRawDxf?: boolean;
}

export type CadStreamWorkerRequest =
  | {
      type: 'stream-init';
      requestId: string;
      fileName: string;
      fileSizeBytes: number;
      projectId?: string;
      lowMemoryMode?: boolean;
      filterOptions?: StreamEntityFilterOptions;
      entityChunkSize?: number;
    }
  | {
      type: 'stream-chunk';
      requestId: string;
      pass: 1 | 2;
      batchId: number;
      lines: string[];
      bytesRead: number;
    }
  | {
      type: 'stream-pass-end';
      requestId: string;
      pass: 1 | 2;
    }
  | {
      type: 'stream-abort';
      requestId: string;
    };

export interface CadDwgWorkerRequest {
  type: 'dwg-wasm';
  requestId: string;
  fileName: string;
  fileSizeBytes: number;
  projectId?: string;
  buffer: ArrayBuffer;
  providerConfig?: DWGProviderConfig;
}

export type CadAnyWorkerRequest = CadWorkerRequest | CadStreamWorkerRequest | CadDwgWorkerRequest;

export type CadWorkerMessage =
  | {
      type: 'progress';
      requestId: string;
      percent: number;
      stageVi: string;
      pass?: 1 | 2;
      entitiesParsed?: number;
      skippedCount?: number;
      heapUsedMB?: number;
      heapLimitMB?: number;
    }
  | {
      type: 'result';
      requestId: string;
      result: DxfImportResult;
    }
  | {
      type: 'stream-ready';
      requestId: string;
    }
  | {
      type: 'batch-ack';
      requestId: string;
      pass: 1 | 2;
      batchId: number;
      entitiesParsed: number;
      skippedCount: number;
      heapUsedMB?: number;
      heapLimitMB?: number;
    }
  | {
      type: 'pass1-complete';
      requestId: string;
      layerCount: number;
      blockCount: number;
      estimatedEntityCount: number;
    }
  | {
      type: 'entities-chunk';
      requestId: string;
      chunkIndex: number;
      entities: CADEntity[];
    }
  | {
      type: 'stream-complete';
      requestId: string;
      shell: StreamingDocumentShell;
    }
  | {
      type: 'dwg-outcome';
      requestId: string;
      outcome: DWGImportOutcome;
    }
  | {
      type: 'error';
      requestId: string;
      error: string;
    };

interface ActiveStreamState {
  session: StreamingDxfSession;
  chunkIndex: number;
  lastProgressEmitAt: number;
}

const activeStreams = new Map<string, ActiveStreamState>();

function isTypedWorkerMessage(
  msg: CadAnyWorkerRequest
): msg is CadStreamWorkerRequest | CadDwgWorkerRequest {
  return 'type' in msg;
}

self.onmessage = async (ev: MessageEvent<CadAnyWorkerRequest>) => {
  const payload = ev.data;
  const requestId = payload.requestId;

  if (!isTypedWorkerMessage(payload)) {
    const { fileName, fileSizeBytes, projectId, buffer, filterOptions, preserveRawDxf } = payload;
    try {
      const result = importDxfContent(buffer, {
        fileName,
        fileSizeBytes,
        projectId,
        filterOptions,
        preserveRawDxf,
        onProgress: (percent, stageVi) => {
          const msg: CadWorkerMessage = {
            type: 'progress',
            requestId,
            percent,
            stageVi
          };
          self.postMessage(msg);
        }
      });
      const doneMsg: CadWorkerMessage = {
        type: 'result',
        requestId,
        result
      };
      self.postMessage(doneMsg);
    } catch (err) {
      const errMsg: CadWorkerMessage = {
        type: 'error',
        requestId,
        error: err instanceof Error ? err.message : String(err)
      };
      self.postMessage(errMsg);
    }
    return;
  }

  try {
    if (payload.type === 'dwg-wasm') {
      const outcome = await importDwgBuffer(payload.buffer, payload.fileName, {
        projectId: payload.projectId,
        providerConfig: payload.providerConfig,
        onProgress: (percent, stageVi) => {
          self.postMessage({
            type: 'progress',
            requestId,
            percent,
            stageVi
          } satisfies CadWorkerMessage);
        }
      });
      self.postMessage({
        type: 'dwg-outcome',
        requestId,
        outcome
      } satisfies CadWorkerMessage);
      return;
    }

    if (payload.type === 'stream-abort') {
      activeStreams.delete(requestId);
      return;
    }

    if (payload.type === 'stream-init') {
      const session = new StreamingDxfSession({
        fileName: payload.fileName,
        fileSizeBytes: payload.fileSizeBytes,
        projectId: payload.projectId,
        lowMemoryMode: payload.lowMemoryMode,
        filterOptions: payload.filterOptions,
        entityChunkSize: payload.entityChunkSize
      });
      activeStreams.set(requestId, {
        session,
        chunkIndex: 0,
        lastProgressEmitAt: 0
      });
      self.postMessage({ type: 'stream-ready', requestId } satisfies CadWorkerMessage);
      return;
    }

    const state = activeStreams.get(requestId);
    if (!state) {
      self.postMessage({
        type: 'error',
        requestId,
        error: 'Phiên đọc luồng DXF không tồn tại hoặc đã bị hủy.'
      } satisfies CadWorkerMessage);
      return;
    }

    const { session } = state;

    if (payload.type === 'stream-chunk') {
      const totalBytes = Math.max(1, session.fileSizeBytes);
      const ratio = Math.max(0, Math.min(1, payload.bytesRead / totalBytes));
      let chunkFlushed = false;

      if (payload.pass === 1) {
        session.feedPass1Lines(payload.lines);
      } else {
        session.feedPass2Lines(payload.lines, chunk => {
          chunkFlushed = true;
          const msg: CadWorkerMessage = {
            type: 'entities-chunk',
            requestId,
            chunkIndex: state.chunkIndex++,
            entities: chunk
          };
          self.postMessage(msg);
        });
      }

      // Free batch lines reference immediately before memory check
      payload.lines.length = 0;

      let heap = getV8HeapMemoryStats();
      if (chunkFlushed || (heap && heap.usageRatio >= V8_CRITICAL_HEAP_RATIO)) {
        await yieldAndReleaseMemory();
        heap = getV8HeapMemoryStats();
        if (heap && heap.usageRatio >= 0.97) {
          activeStreams.delete(requestId);
          self.postMessage({
            type: 'error',
            requestId,
            error: `Bộ nhớ trình duyệt (V8 Heap ${heap.usedMB}/${heap.limitMB} MB) sắp cạn khi đọc bản vẽ. Hãy bật tùy chọn lọc HATCH / Layer ẩn và thử lại.`
          } satisfies CadWorkerMessage);
          return;
        }
      }

      const now = Date.now();
      if (now - state.lastProgressEmitAt >= 90 || chunkFlushed) {
        state.lastProgressEmitAt = now;
        const percent =
          payload.pass === 1
            ? Math.min(28, 4 + Math.round(ratio * 24))
            : Math.min(96, 30 + Math.round(ratio * 66));
        const stageVi =
          payload.pass === 1
            ? `Pass 1/2: Quét bảng Layer & Block (${Math.round(ratio * 100)}%)...`
            : `Pass 2/2: Nạp đối tượng CAD (${session.entitiesParsed.toLocaleString('vi-VN')} đã đọc${
                session.skippedCount > 0 ? `, lọc ${session.skippedCount.toLocaleString('vi-VN')}` : ''
              })...`;

        self.postMessage({
          type: 'progress',
          requestId,
          percent,
          stageVi,
          pass: payload.pass,
          entitiesParsed: session.entitiesParsed,
          skippedCount: session.skippedCount,
          heapUsedMB: heap?.usedMB,
          heapLimitMB: heap?.limitMB
        } satisfies CadWorkerMessage);
      }

      self.postMessage({
        type: 'batch-ack',
        requestId,
        pass: payload.pass,
        batchId: payload.batchId,
        entitiesParsed: session.entitiesParsed,
        skippedCount: session.skippedCount,
        heapUsedMB: heap?.usedMB,
        heapLimitMB: heap?.limitMB
      } satisfies CadWorkerMessage);
      return;
    }

    if (payload.type === 'stream-pass-end') {
      if (payload.pass === 1) {
        const stats = session.finishPass1();
        await yieldAndReleaseMemory();
        self.postMessage({
          type: 'progress',
          requestId,
          percent: 30,
          stageVi: `Hoàn tất Pass 1 (${stats.layerCount} Layer, ${stats.blockCount} Block). Đang nạp hình học...`,
          pass: 1,
          entitiesParsed: 0,
          skippedCount: 0
        } satisfies CadWorkerMessage);
        self.postMessage({
          type: 'pass1-complete',
          requestId,
          layerCount: stats.layerCount,
          blockCount: stats.blockCount,
          estimatedEntityCount: stats.estimatedEntityCount
        } satisfies CadWorkerMessage);
      } else {
        const shell = session.finishPass2(chunk => {
          const msg: CadWorkerMessage = {
            type: 'entities-chunk',
            requestId,
            chunkIndex: state.chunkIndex++,
            entities: chunk
          };
          self.postMessage(msg);
        });
        activeStreams.delete(requestId);
        await yieldAndReleaseMemory();

        const heap = getV8HeapMemoryStats();
        self.postMessage({
          type: 'progress',
          requestId,
          percent: 98,
          stageVi: 'Đang hoàn thiện chỉ mục & bản vẽ CAD...',
          pass: 2,
          entitiesParsed: shell.entityCount,
          skippedCount: shell.skippedCount,
          heapUsedMB: heap?.usedMB,
          heapLimitMB: heap?.limitMB
        } satisfies CadWorkerMessage);

        self.postMessage({
          type: 'stream-complete',
          requestId,
          shell
        } satisfies CadWorkerMessage);
      }
    }
  } catch (err) {
    activeStreams.delete(requestId);
    self.postMessage({
      type: 'error',
      requestId,
      error: err instanceof Error ? err.message : String(err)
    } satisfies CadWorkerMessage);
  }
};
