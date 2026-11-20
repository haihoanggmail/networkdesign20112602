import type { DwgDatabase, LibreDwgEx } from '@mlightcad/libredwg-web';
import { MAX_DWG_WASM_BYTES } from '../import/CADImportValidator';
import { detectDwgSignature } from '../import/DXFBinaryImporter';
import { mapDwgDatabaseToCadDocument } from '../import/DwgDatabaseMapper';
import type { DxfImportResult } from '../import/DXFImporter';

export { MAX_DWG_WASM_BYTES };

const DWG_ERR_SECTIONNOTFOUND = 256;
const DWG_ERR_INVALIDDWG = 2048;
const DWG_ERR_IOERROR = 4096;
const DWG_ERR_OUTOFMEM = 8192;

export interface LibreDwgRuntimeLike {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    analyzePath: (path: string, dontResolveLastLink?: boolean) => { exists: boolean };
    unlink: (path: string) => void;
  };
  dwg_read_file: (path: string) => { data: number; error: number };
  convertEx: (dataPtr: number) => {
    database: DwgDatabase;
    stats: { unknownEntityCount: number };
  };
  dwg_free: (dataPtr: number) => void;
  dwg_abandon?: (dataPtr: number) => void;
  dwg_get_version_type?: (dataPtr: number) => number | string;
}

let cachedLibreDwgPromise: Promise<LibreDwgEx> | null = null;
let tempFileSeq = 0;

export function resolveLibreDwgWasmDir(): string {
  const isNode =
    typeof process !== 'undefined' &&
    typeof process.versions === 'object' &&
    typeof process.versions.node === 'string';
  if (isNode) {
    return './node_modules/@mlightcad/libredwg-web/wasm';
  }
  if (
    typeof self !== 'undefined' &&
    typeof self.location === 'object' &&
    self.location.origin &&
    self.location.origin !== 'null'
  ) {
    return `${self.location.origin}/wasm`;
  }
  return '/wasm';
}

export async function getLibreDwgInstance(wasmDirOverride?: string): Promise<LibreDwgEx> {
  if (!cachedLibreDwgPromise) {
    cachedLibreDwgPromise = (async () => {
      const { LibreDwg } = await import('@mlightcad/libredwg-web');
      const wasmDir = wasmDirOverride ?? resolveLibreDwgWasmDir();
      return LibreDwg.create(wasmDir);
    })().catch(err => {
      cachedLibreDwgPromise = null;
      throw err;
    });
  }
  return cachedLibreDwgPromise;
}

export interface DecodeDwgWasmOptions {
  fileName?: string;
  fileSizeBytes?: number;
  projectId?: string;
  signal?: AbortSignal;
  onProgress?: (pct: number, stageVi: string) => void;
  libreDwgOverride?: LibreDwgRuntimeLike;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Đã hủy giải mã tệp DWG.', 'AbortError');
  }
}

export async function decodeDwgBufferWithLibreDwg(
  buffer: ArrayBuffer,
  options?: DecodeDwgWasmOptions
): Promise<DxfImportResult> {
  throwIfAborted(options?.signal);

  const fileName = options?.fileName || 'drawing.dwg';
  const fileSizeBytes = options?.fileSizeBytes ?? buffer.byteLength;

  if (buffer.byteLength <= 0) {
    throw new Error(`Tệp DWG "${fileName}" bị rỗng (0 byte).`);
  }
  if (buffer.byteLength > MAX_DWG_WASM_BYTES) {
    const mb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
    const limitMb = Math.round(MAX_DWG_WASM_BYTES / (1024 * 1024));
    throw new Error(
      `Tệp DWG "${fileName}" (${mb} MB) vượt ngưỡng ${limitMb} MB cho bộ giải mã WASM trên trình duyệt. Hãy lưu sang DXF hoặc dùng Endpoint chuyển đổi nội bộ.`
    );
  }

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  options?.onProgress?.(16, 'Đang khởi tạo bộ giải mã LibreDWG WebAssembly (ngoại tuyến)...');

  const libredwg: LibreDwgRuntimeLike =
    options?.libreDwgOverride ?? (await getLibreDwgInstance());

  throwIfAborted(options?.signal);
  options?.onProgress?.(35, 'Đang phân tích cấu trúc nhị phân DWG...');

  const tempPath = `hachihi_in_${++tempFileSeq}_${Date.now()}.dwg`;
  const bytes = new Uint8Array(buffer);
  let dataPtr = 0;

  try {
    libredwg.FS.writeFile(tempPath, bytes);
    const readRes = libredwg.dwg_read_file(tempPath);
    const errCode = Number(readRes?.error ?? 0);
    dataPtr = Number(readRes?.data ?? 0);

    if (errCode & DWG_ERR_OUTOFMEM) {
      if (dataPtr && typeof libredwg.dwg_abandon === 'function') {
        libredwg.dwg_abandon(dataPtr);
      }
      dataPtr = 0;
      throw new Error(
        'Hết bộ nhớ WebAssembly khi đọc tệp DWG lớn. Hãy xuất bản vẽ sang DXF Streaming hoặc lọc bớt đối tượng.'
      );
    }

    if ((errCode & (DWG_ERR_INVALIDDWG | DWG_ERR_IOERROR)) !== 0 || !dataPtr) {
      throw new Error(
        `LibreDWG WebAssembly không thể giải mã tệp "${fileName}" (mã lỗi DWG ${errCode || 'INVALID'}). Tệp có thể bị hỏng, mã hóa hoặc dùng phiên bản AutoCAD chưa hỗ trợ.`
      );
    }

    throwIfAborted(options?.signal);
    options?.onProgress?.(55, 'Đang trích xuất Layer, Block & hình học DWG...');

    const converted = libredwg.convertEx(dataPtr);
    const db = converted?.database;
    const unknownCount = Number(converted?.stats?.unknownEntityCount ?? 0);

    if (!db || typeof db !== 'object') {
      throw new Error(`Không trích xuất được dữ liệu bản vẽ từ tệp DWG "${fileName}".`);
    }

    const layerCount = db.tables?.LAYER?.entries?.length ?? 0;
    const blockCount = db.tables?.BLOCK_RECORD?.entries?.length ?? 0;
    const entityCount = db.entities?.length ?? 0;

    if (
      (errCode & DWG_ERR_SECTIONNOTFOUND) !== 0 &&
      entityCount === 0 &&
      layerCount === 0 &&
      blockCount === 0
    ) {
      throw new Error(
        `Tệp "${fileName}" thiếu bảng dữ liệu DWG tiêu chuẩn (SECTIONNOTFOUND). Vui lòng lưu sang AutoCAD DXF hoặc thử Endpoint chuyển đổi.`
      );
    }

    const dwgSig = detectDwgSignature(buffer);
    const rawVerType =
      typeof libredwg.dwg_get_version_type === 'function'
        ? libredwg.dwg_get_version_type(dataPtr)
        : undefined;
    const detectedAcadVersion =
      (dwgSig.isDwg && dwgSig.versionCode) ||
      (typeof rawVerType === 'string' && /^AC\d{4}$/i.test(rawVerType.trim())
        ? rawVerType.trim().toUpperCase()
        : undefined);

    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return mapDwgDatabaseToCadDocument(db, {
      fileName,
      fileSizeBytes,
      projectId: options?.projectId,
      parseDurationMs: Math.max(1, Math.round(t1 - t0)),
      unknownEntityCount: unknownCount,
      detectedAcadVersion,
      onProgress: options?.onProgress
    });
  } finally {
    if (dataPtr) {
      try {
        libredwg.dwg_free(dataPtr);
      } catch {
        // ignore double-free errors
      }
    }
    try {
      if (libredwg.FS.analyzePath(tempPath, false)?.exists) {
        libredwg.FS.unlink(tempPath);
      }
    } catch {
      // ignore MEMFS cleanup errors
    }
  }
}
