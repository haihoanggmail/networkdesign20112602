export const CAD_DB_NAME = 'hachihi-cad-db';
export const CAD_DB_VERSION = 2;
export const CAD_ENTITY_CHUNK_SIZE = 2000;

export const CAD_STORES = [
  'documents',
  'layers',
  'blocks',
  'entities',
  'styles',
  'layouts',
  'revisions',
  'attachments'
] as const;

export type CADStoreName = (typeof CAD_STORES)[number];

export const V8_SAFE_HEAP_RATIO = 0.85;
export const V8_CRITICAL_HEAP_RATIO = 0.93;

export interface V8HeapMemoryStats {
  usedMB: number;
  totalMB: number;
  limitMB: number;
  usageRatio: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

/**
 * Reads V8 JS heap telemetry when exposed by Chromium-based browsers or Node/V8.
 * Returns null in engines that do not expose `performance.memory`.
 */
export function getV8HeapMemoryStats(): V8HeapMemoryStats | null {
  if (typeof performance === 'undefined') return null;
  const mem = (performance as PerformanceWithMemory).memory;
  if (!mem || !Number.isFinite(mem.usedJSHeapSize) || !Number.isFinite(mem.jsHeapSizeLimit) || mem.jsHeapSizeLimit <= 0) {
    return null;
  }
  const mb = 1024 * 1024;
  return {
    usedMB: Math.round((mem.usedJSHeapSize / mb) * 10) / 10,
    totalMB: Math.round((mem.totalJSHeapSize / mb) * 10) / 10,
    limitMB: Math.round((mem.jsHeapSizeLimit / mb) * 10) / 10,
    usageRatio: mem.usedJSHeapSize / mem.jsHeapSizeLimit
  };
}

export function isMemoryPressureHigh(thresholdRatio = V8_SAFE_HEAP_RATIO): boolean {
  const stats = getV8HeapMemoryStats();
  if (!stats) return false;
  return stats.usageRatio >= thresholdRatio;
}

/**
 * Yields to the event loop after processing a chunk so V8 GC can reclaim short-lived buffers,
 * and triggers `globalThis.gc()` if running in an environment with exposed GC.
 */
export async function yieldAndReleaseMemory(): Promise<void> {
  const maybeGc = (globalThis as { gc?: () => void }).gc;
  if (typeof maybeGc === 'function') {
    try {
      maybeGc();
    } catch {
      // Ignore if gc() is restricted
    }
  }
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

class CADDatabaseManager {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryFallback = new Map<CADStoreName, Map<string, unknown>>();

  isIndexedDbAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private getMemoryStore(name: CADStoreName): Map<string, unknown> {
    let store = this.memoryFallback.get(name);
    if (!store) {
      store = new Map<string, unknown>();
      this.memoryFallback.set(name, store);
    }
    return store;
  }

  async open(): Promise<IDBDatabase | null> {
    if (!this.isIndexedDbAvailable()) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(CAD_DB_NAME, CAD_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const storeName of CAD_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            const os = db.createObjectStore(storeName, { keyPath: 'id' });
            if (storeName === 'documents') {
              os.createIndex('projectId', 'projectId', { unique: false });
              os.createIndex('updatedAt', 'updatedAt', { unique: false });
            } else {
              os.createIndex('docId', 'docId', { unique: false });
            }
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Không thể mở IndexedDB hachihi-cad-db'));
    });

    return this.dbPromise;
  }

  async putRecord<T extends { id: string }>(storeName: CADStoreName, record: T): Promise<void> {
    const db = await this.open();
    if (!db) {
      this.getMemoryStore(storeName).set(record.id, structuredClone(record));
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Writes multiple records inside a single IndexedDB transaction, then yields for memory release.
   */
  async putRecordsBatch<T extends { id: string }>(storeName: CADStoreName, records: T[]): Promise<void> {
    if (records.length === 0) return;
    const db = await this.open();
    if (!db) {
      const mem = this.getMemoryStore(storeName);
      for (const rec of records) {
        mem.set(rec.id, structuredClone(rec));
      }
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const os = tx.objectStore(storeName);
      for (const rec of records) {
        os.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Writes entity chunks into an isolated generation namespace (`${docId}::g${generation}__chunk_i`)
   * WITHOUT deleting prior committed generations.
   */
  async saveEntityChunksForGeneration<T>(
    docId: string,
    generation: number,
    entities: T[],
    options?: {
      chunkSize?: number;
      txBatchChunks?: number;
      onChunkSaved?: (savedCount: number, totalCount: number) => void;
      onBeforeBatch?: (batchIndex: number) => void | Promise<void>;
    }
  ): Promise<number> {
    const chunkSize = Math.max(250, options?.chunkSize ?? CAD_ENTITY_CHUNK_SIZE);
    const txBatchChunks = Math.max(1, options?.txBatchChunks ?? 4);
    await this.deleteDocRecordsForGeneration('entities', docId, generation);

    const chunkCount = Math.max(1, Math.ceil(entities.length / chunkSize));
    let batch: Array<{ id: string; docId: string; generation: number; chunkIndex: number; entities: T[] }> = [];
    let batchIdx = 0;

    for (let i = 0; i < chunkCount; i++) {
      const slice = entities.slice(i * chunkSize, (i + 1) * chunkSize);
      batch.push({
        id: `${docId}::g${generation}__chunk_${i}`,
        docId,
        generation,
        chunkIndex: i,
        entities: slice
      });

      if (batch.length >= txBatchChunks || i === chunkCount - 1) {
        if (options?.onBeforeBatch) {
          await options.onBeforeBatch(batchIdx);
        }
        await this.putRecordsBatch('entities', batch);
        batchIdx += 1;
        batch = [];
        options?.onChunkSaved?.(Math.min(entities.length, (i + 1) * chunkSize), entities.length);
        if (isMemoryPressureHigh() || i % (txBatchChunks * 2) === 0) {
          await yieldAndReleaseMemory();
        }
      }
    }
    return chunkCount;
  }

  /**
   * Persists a large entity array in chunked IndexedDB batches with V8 heap checks between batches
   * so saving hundreds of thousands of entities does not spike heap memory.
   */
  async saveEntityChunksStreaming<T>(
    docId: string,
    entities: T[],
    options?: {
      chunkSize?: number;
      txBatchChunks?: number;
      onChunkSaved?: (savedCount: number, totalCount: number) => void;
    }
  ): Promise<number> {
    const chunkSize = Math.max(250, options?.chunkSize ?? CAD_ENTITY_CHUNK_SIZE);
    const txBatchChunks = Math.max(1, options?.txBatchChunks ?? 4);
    await this.deleteRecordsByDocId('entities', docId);

    const chunkCount = Math.max(1, Math.ceil(entities.length / chunkSize));
    let batch: Array<{ id: string; docId: string; chunkIndex: number; entities: T[] }> = [];

    for (let i = 0; i < chunkCount; i++) {
      const slice = entities.slice(i * chunkSize, (i + 1) * chunkSize);
      batch.push({
        id: `${docId}__chunk_${i}`,
        docId,
        chunkIndex: i,
        entities: slice
      });

      if (batch.length >= txBatchChunks || i === chunkCount - 1) {
        await this.putRecordsBatch('entities', batch);
        batch = [];
        options?.onChunkSaved?.(Math.min(entities.length, (i + 1) * chunkSize), entities.length);
        if (isMemoryPressureHigh() || i % (txBatchChunks * 2) === 0) {
          await yieldAndReleaseMemory();
        }
      }
    }
    return chunkCount;
  }

  async getRecord<T>(storeName: CADStoreName, id: string): Promise<T | null> {
    const db = await this.open();
    if (!db) {
      const v = this.getMemoryStore(storeName).get(id);
      return v ? (structuredClone(v) as T) : null;
    }
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllRecords<T>(storeName: CADStoreName): Promise<T[]> {
    const db = await this.open();
    if (!db) {
      return Array.from(this.getMemoryStore(storeName).values()).map(v => structuredClone(v) as T);
    }
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getRecordsByDocId<T extends { docId?: string }>(storeName: CADStoreName, docId: string): Promise<T[]> {
    const db = await this.open();
    if (!db) {
      return Array.from(this.getMemoryStore(storeName).values())
        .filter(item => (item as { docId?: string }).docId === docId)
        .map(v => structuredClone(v) as T);
    }
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains('docId')) {
        resolve([]);
        return;
      }
      const req = store.index('docId').getAll(docId);
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteRecord(storeName: CADStoreName, id: string): Promise<void> {
    const db = await this.open();
    if (!db) {
      this.getMemoryStore(storeName).delete(id);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteRecordsByDocId(storeName: CADStoreName, docId: string): Promise<void> {
    const db = await this.open();
    if (!db) {
      const store = this.getMemoryStore(storeName);
      for (const [k, v] of store.entries()) {
        if ((v as { docId?: string }).docId === docId) {
          store.delete(k);
        }
      }
      return;
    }
    const existing = await this.getRecordsByDocId<{ id: string; docId: string }>(storeName, docId);
    if (existing.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const os = tx.objectStore(storeName);
      for (const rec of existing) {
        os.delete(rec.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteDocRecordsForGeneration(
    storeName: CADStoreName,
    docId: string,
    generation: number
  ): Promise<void> {
    const db = await this.open();
    if (!db) {
      const store = this.getMemoryStore(storeName);
      for (const [k, v] of store.entries()) {
        const rec = v as { docId?: string; generation?: number };
        if (rec.docId === docId && rec.generation === generation) {
          store.delete(k);
        }
      }
      return;
    }
    const existing = await this.getRecordsByDocId<{ id: string; docId: string; generation?: number }>(storeName, docId);
    const matching = existing.filter(r => r.generation === generation);
    if (matching.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const os = tx.objectStore(storeName);
      for (const rec of matching) {
        os.delete(rec.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteDocRecordsExceptGeneration(
    storeName: CADStoreName,
    docId: string,
    keepGeneration: number
  ): Promise<void> {
    const db = await this.open();
    if (!db) {
      const store = this.getMemoryStore(storeName);
      for (const [k, v] of store.entries()) {
        const rec = v as { docId?: string; generation?: number };
        if (rec.docId === docId && rec.generation !== keepGeneration) {
          store.delete(k);
        }
      }
      return;
    }
    const existing = await this.getRecordsByDocId<{ id: string; docId: string; generation?: number }>(storeName, docId);
    const stale = existing.filter(r => r.generation !== keepGeneration);
    if (stale.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const os = tx.objectStore(storeName);
      for (const rec of stale) {
        os.delete(rec.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const cadDatabase = new CADDatabaseManager();
