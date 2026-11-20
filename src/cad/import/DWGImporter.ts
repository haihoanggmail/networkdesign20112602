import type { DWGInspectionResult } from '../dwg/DWGAdapter';
import { dwgConversionService } from '../dwg/DWGConversionService';
import type { DWGProviderConfig } from '../dwg/DWGProviderConfig';
import {
  decodeDwgBufferWithLibreDwg,
  type LibreDwgRuntimeLike
} from '../dwg/LibreDwgWasmLoader';
import { DxfImportResult, importDxfContent } from './DXFImporter';

export interface DWGImportOutcome {
  status: 'converted' | 'requires-conversion';
  decodedBy?: 'libredwg-wasm' | 'http-converter';
  inspection: DWGInspectionResult;
  result?: DxfImportResult;
}

export async function importDwgBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options?: {
    projectId?: string;
    providerConfig?: DWGProviderConfig;
    signal?: AbortSignal;
    skipWasm?: boolean;
    libreDwgOverride?: LibreDwgRuntimeLike;
    onProgress?: (pct: number, stageVi: string) => void;
  }
): Promise<DWGImportOutcome> {
  const cfg = options?.providerConfig;

  if (cfg?.mode === 'http-converter' && cfg.endpointUrl.trim()) {
    const inspection = dwgConversionService.inspectDwgBuffer(buffer, fileName);
    options?.onProgress?.(20, 'Đang gửi tệp DWG tới bộ chuyển đổi đã cấu hình...');
    const converted = await dwgConversionService.convertWithConfiguredProvider(
      buffer,
      fileName,
      cfg,
      options?.signal
    );

    options?.onProgress?.(45, 'Đang đọc bản vẽ DXF sau chuyển đổi...');
    const result = importDxfContent(converted.dxfBuffer, {
      fileName: converted.convertedFileName,
      fileSizeBytes: converted.dxfBuffer.byteLength,
      projectId: options?.projectId,
      onProgress: options?.onProgress
    });
    result.document.metadata.sourceFormat = 'dwg-converted';
    result.report.sourceFormat = 'dwg-converted';

    return {
      status: 'converted',
      decodedBy: 'http-converter',
      inspection: { ...inspection, conversionRequired: false },
      result
    };
  }

  if (!options?.skipWasm) {
    try {
      const result = await decodeDwgBufferWithLibreDwg(buffer, {
        fileName,
        fileSizeBytes: buffer.byteLength,
        projectId: options?.projectId,
        signal: options?.signal,
        onProgress: options?.onProgress,
        libreDwgOverride: options?.libreDwgOverride
      });
      const inspection = dwgConversionService.inspectDwgBuffer(buffer, fileName);
      return {
        status: 'converted',
        decodedBy: 'libredwg-wasm',
        inspection: { ...inspection, conversionRequired: false },
        result
      };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw err;
      }
      const wasmErrorVi = err instanceof Error ? err.message : String(err);
      const inspection = dwgConversionService.inspectDwgBuffer(buffer, fileName, wasmErrorVi);
      return {
        status: 'requires-conversion',
        inspection
      };
    }
  }

  const inspection = dwgConversionService.inspectDwgBuffer(buffer, fileName);
  return {
    status: 'requires-conversion',
    inspection
  };
}
