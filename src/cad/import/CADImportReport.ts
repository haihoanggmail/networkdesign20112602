import type { BoundingBox2D, CADDocument, CADUnitCode } from '../core/CADTypes';
import { getCADUnitMeta } from '../core/CADUnits';

export interface CADImportWarning {
  code:
    | 'MISSING_FONT'
    | 'MISSING_XREF'
    | 'UNKNOWN_ENTITIES'
    | 'RECURSIVE_BLOCK_GUARD'
    | 'UNSAFE_CONTENT_STRIPPED'
    | 'BINARY_DXF_CONVERTED'
    | 'MALFORMED_LINES'
    | 'LOW_MEMORY_MODE'
    | 'DWG_WASM_DECODED';
  severity: 'info' | 'warning';
  messageVi: string;
  remediationVi?: string;
  count?: number;
}

export interface CADImportReport {
  ok: boolean;
  fileName: string;
  fileSizeBytes: number;
  sourceFormat: CADDocument['metadata']['sourceFormat'];
  acadVersion: string;
  unitCode: CADUnitCode;
  unitLabelVi: string;
  parseDurationMs: number;
  layerCount: number;
  blockCount: number;
  entityCount: number;
  readableCount: number;
  editableCount: number;
  supportedCount: number;
  readonlyCount: number;
  unsupportedCount: number;
  unknownCount: number;
  dwgUnsupportedCount: number;
  unknownEntityTypes: Record<string, number>;
  missingFonts: string[];
  missingXrefs: string[];
  extents: BoundingBox2D;
  warnings: CADImportWarning[];
  errorMessageVi?: string;
  skippedCount: number;
  skippedTypes: Record<string, number>;
  totalEncounteredCount: number;
  streamingUsed?: boolean;
}

export function buildCADImportReport(
  doc: CADDocument,
  parseDurationMs: number,
  extraWarnings: CADImportWarning[] = [],
  streamMeta?: {
    skippedCount?: number;
    skippedTypes?: Record<string, number>;
    streamingUsed?: boolean;
    dwgUnsupportedCount?: number;
  }
): CADImportReport {
  let supportedCount = 0;
  let readonlyCount = 0;
  let unknownCount = 0;

  for (const e of doc.entities) {
    if (e.preservationTier === 'supported') supportedCount++;
    else if (e.preservationTier === 'readonly') readonlyCount++;
    else unknownCount++;
  }

  const skippedCount = streamMeta?.skippedCount ?? 0;
  const skippedTypes = streamMeta?.skippedTypes ? { ...streamMeta.skippedTypes } : {};
  const dwgUnsupportedCount = streamMeta?.dwgUnsupportedCount ?? 0;
  const readableCount = doc.entities.length;
  const unsupportedCount = unknownCount + dwgUnsupportedCount;
  const totalEncounteredCount = readableCount + dwgUnsupportedCount + skippedCount;

  const warnings: CADImportWarning[] = [...extraWarnings];

  if (doc.metadata.missingFonts.length > 0) {
    warnings.push({
      code: 'MISSING_FONT',
      severity: 'warning',
      messageVi: `Phát hiện ${doc.metadata.missingFonts.length} font CAD (${doc.metadata.missingFonts.slice(0, 4).join(', ')}) không có sẵn trên trình duyệt — đã tự động thay bằng font Unicode tương thích tiếng Việt.`,
      remediationVi: 'Nếu ký tự bị lệch chiều rộng, có thể chỉnh Text Style hoặc hệ số Width Factor.',
      count: doc.metadata.missingFonts.length
    });
  }

  if (doc.metadata.missingXrefs.length > 0) {
    warnings.push({
      code: 'MISSING_XREF',
      severity: 'warning',
      messageVi: `Bản vẽ tham chiếu ${doc.metadata.missingXrefs.length} tệp Xref ngoài (${doc.metadata.missingXrefs.join(', ')}). HACHIHI không tự nạp tệp ngoài để bảo mật.`,
      remediationVi: 'Trong AutoCAD, hãy Bind các Xref vào bản vẽ trước khi xuất DXF để hiển thị đầy đủ.',
      count: doc.metadata.missingXrefs.length
    });
  }

  if (unknownCount > 0) {
    const types = Object.entries(doc.metadata.unknownEntityTypes)
      .map(([t, c]) => `${t} (${c})`)
      .join(', ');
    warnings.push({
      code: 'UNKNOWN_ENTITIES',
      severity: 'info',
      messageVi: doc.metadata.hasRawRoundTripData
        ? `Có ${unknownCount} đối tượng đặc thù (${types}) được giữ nguyên dữ liệu DXF gốc (không làm mất khi xuất DXF Round-trip).`
        : `Có ${unknownCount} đối tượng đặc thù (${types}) chỉ ghi nhận vị trí tham chiếu (không có rawDXF gốc từ DWG/Streaming để tái xuất nguyên bản).`,
      remediationVi: doc.metadata.hasRawRoundTripData
        ? 'Các đối tượng này chỉ xem vị trí tham chiếu khi chỉnh sửa trong trình duyệt.'
        : 'Nếu cần bảo toàn tuyệt đối các đối tượng này khi xuất lại DXF, hãy mở bản vẽ ở định dạng ASCII DXF (không bật chế độ Low-Memory).',
      count: unknownCount
    });
  }

  for (const secMsg of doc.metadata.securityWarnings) {
    warnings.push({
      code: 'UNSAFE_CONTENT_STRIPPED',
      severity: 'warning',
      messageVi: secMsg
    });
  }

  const unitMeta = getCADUnitMeta(doc.header.$INSUNITS);

  return {
    ok: true,
    fileName: doc.metadata.sourceFileName,
    fileSizeBytes: doc.metadata.sourceFileSizeBytes,
    sourceFormat: doc.metadata.sourceFormat,
    acadVersion: doc.metadata.acadVersion,
    unitCode: doc.header.$INSUNITS,
    unitLabelVi: unitMeta.labelVi,
    parseDurationMs,
    layerCount: Object.keys(doc.layers).length,
    blockCount: Object.values(doc.blocks).filter(
      b => !b.name.startsWith('*Model_Space') && !b.name.startsWith('*Paper_Space')
    ).length,
    entityCount: readableCount,
    readableCount,
    editableCount: supportedCount,
    supportedCount,
    readonlyCount,
    unsupportedCount,
    unknownCount,
    dwgUnsupportedCount,
    unknownEntityTypes: { ...doc.metadata.unknownEntityTypes },
    missingFonts: [...doc.metadata.missingFonts],
    missingXrefs: [...doc.metadata.missingXrefs],
    extents: doc.extents,
    warnings,
    skippedCount,
    skippedTypes,
    totalEncounteredCount,
    streamingUsed: streamMeta?.streamingUsed
  };
}
