import { detectDwgSignature } from '../import/DXFBinaryImporter';
import type { DWGAdapter, DWGConversionOutput, DWGInspectionResult } from './DWGAdapter';
import {
  DWGProviderConfig,
  loadDWGProviderConfig,
  validateDwgConverterUrl
} from './DWGProviderConfig';

export class HttpBridgeDWGAdapter implements DWGAdapter {
  readonly id = 'http-converter';
  readonly name = 'Dịch vụ chuyển đổi DWG -> DXF tùy chỉnh (ODA / Cloud)';

  async convertToDxf(
    dwgBuffer: ArrayBuffer,
    fileName: string,
    config: DWGProviderConfig,
    signal?: AbortSignal
  ): Promise<DWGConversionOutput> {
    const valid = validateDwgConverterUrl(config.endpointUrl);
    if (!valid.ok) {
      throw new Error(valid.error);
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Source-Filename': encodeURIComponent(fileName)
    };
    if (config.authHeader?.trim()) {
      headers['Authorization'] = config.authHeader.trim();
    }

    const res = await fetch(valid.url.toString(), {
      method: 'POST',
      headers,
      body: dwgBuffer,
      signal
    });

    if (!res.ok) {
      throw new Error(`Bộ chuyển đổi DWG trả về mã lỗi HTTP ${res.status}.`);
    }

    const dxfBuffer = await res.arrayBuffer();
    if (dxfBuffer.byteLength === 0) {
      throw new Error('Bộ chuyển đổi DWG trả về dữ liệu rỗng.');
    }

    return {
      dxfBuffer,
      convertedFileName: fileName.replace(/\.dwg$/i, '.dxf'),
      providerLabel: valid.url.origin
    };
  }
}

export class DWGConversionService {
  private adapter: DWGAdapter = new HttpBridgeDWGAdapter();

  inspectDwgBuffer(buffer: ArrayBuffer, fileName: string, wasmErrorVi?: string): DWGInspectionResult {
    const sig = detectDwgSignature(buffer);
    return {
      isValidDwg: sig.isDwg,
      versionCode: sig.versionCode,
      versionLabel: sig.versionLabel,
      fileSizeBytes: buffer.byteLength,
      conversionRequired: true,
      wasmErrorVi,
      guideStepsVi: [
        `Tệp "${fileName}" sử dụng định dạng DWG nhị phân (${sig.versionLabel || 'AutoCAD DWG'}) mà bộ giải mã ngoại tuyến chưa đọc trọn vẹn được.`,
        'Cách 1 (Miễn phí & Nhanh nhất): Mở trong AutoCAD / BricsCAD / ZWCAD / LibreCAD -> Save As -> AutoCAD DXF (khuyến nghị bản 2013/2018 DXF).',
        'Cách 2 (Chuyển hàng loạt miễn phí): Dùng ODA File Converter trên Windows/macOS để đổi .dwg sang .dxf rồi kéo thả trực tiếp vào HACHIHI.',
        'Cách 3 (Tùy chọn doanh nghiệp): Nhập Endpoint dịch vụ chuyển đổi DWG -> DXF nội bộ bên dưới để chuyển đổi tự động.'
      ]
    };
  }

  async convertWithConfiguredProvider(
    buffer: ArrayBuffer,
    fileName: string,
    overrideConfig?: DWGProviderConfig,
    signal?: AbortSignal
  ): Promise<DWGConversionOutput> {
    const cfg = overrideConfig || loadDWGProviderConfig();
    if (cfg.mode !== 'http-converter' || !cfg.endpointUrl.trim()) {
      throw new Error(
        'Chưa cấu hình dịch vụ chuyển đổi DWG. Vui lòng lưu file sang DXF hoặc cấu hình Endpoint chuyển đổi nội bộ.'
      );
    }
    return this.adapter.convertToDxf(buffer, fileName, cfg, signal);
  }
}

export const dwgConversionService = new DWGConversionService();
