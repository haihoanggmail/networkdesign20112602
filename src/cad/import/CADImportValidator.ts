import type { CADBlock, CADTextStyle } from '../core/CADTypes';

export type CADFileFormatPolicyKey =
  | 'dxf-ascii'
  | 'dxf-binary'
  | 'dwg-wasm'
  | 'dwg-http-bridge';

export interface CADFormatMemoryPolicy {
  format: CADFileFormatPolicyKey;
  labelVi: string;
  recommendedMaxBytes: number;
  hardMaxBytes: number;
  streamThresholdBytes?: number;
  usesFullArrayBuffer: boolean;
}

export const CAD_FORMAT_MEMORY_POLICIES: Record<CADFileFormatPolicyKey, CADFormatMemoryPolicy> = {
  'dxf-ascii': {
    format: 'dxf-ascii',
    labelVi: 'DXF ASCII (Streaming Worker)',
    streamThresholdBytes: 24 * 1024 * 1024,
    recommendedMaxBytes: 120 * 1024 * 1024,
    hardMaxBytes: 250 * 1024 * 1024,
    usesFullArrayBuffer: false
  },
  'dxf-binary': {
    format: 'dxf-binary',
    labelVi: 'AutoCAD Binary DXF',
    recommendedMaxBytes: 32 * 1024 * 1024,
    hardMaxBytes: 64 * 1024 * 1024,
    usesFullArrayBuffer: true
  },
  'dwg-wasm': {
    format: 'dwg-wasm',
    labelVi: 'DWG (LibreDWG WebAssembly ngoại tuyến)',
    recommendedMaxBytes: 35 * 1024 * 1024,
    hardMaxBytes: 64 * 1024 * 1024,
    usesFullArrayBuffer: true
  },
  'dwg-http-bridge': {
    format: 'dwg-http-bridge',
    labelVi: 'DWG (Dịch vụ chuyển đổi HTTP Bridge)',
    recommendedMaxBytes: 100 * 1024 * 1024,
    hardMaxBytes: 150 * 1024 * 1024,
    usesFullArrayBuffer: true
  }
};

export const MAX_CAD_FILE_BYTES = CAD_FORMAT_MEMORY_POLICIES['dxf-ascii'].hardMaxBytes;
export const MAX_DWG_WASM_BYTES = CAD_FORMAT_MEMORY_POLICIES['dwg-wasm'].hardMaxBytes;
export const LARGE_CAD_STREAM_THRESHOLD_BYTES = 24 * 1024 * 1024; // 24 MB: bật đọc luồng + tiết kiệm RAM
export const MAX_CAD_ENTITIES = 600_000;
export const MAX_BLOCK_NESTING_DEPTH = 32;

const BROWSER_SAFE_FONT_BASES = new Set([
  'arial',
  'times',
  'times new roman',
  'courier',
  'courier new',
  'tahoma',
  'verdana',
  'inter',
  'roboto',
  'segoe ui',
  'helvetica',
  'sans',
  'txt'
]);

export function validateCadFilePayload(
  fileName: string,
  byteLength: number,
  format: CADFileFormatPolicyKey = 'dxf-ascii'
): { ok: true; warning?: string } | { ok: false; error: string } {
  if (byteLength <= 0) {
    return {
      ok: false,
      error: `Tệp "${fileName}" bị rỗng (0 byte). Vui lòng chọn tệp DXF hoặc DWG hợp lệ.`
    };
  }
  const policy = CAD_FORMAT_MEMORY_POLICIES[format] ?? CAD_FORMAT_MEMORY_POLICIES['dxf-ascii'];
  const mb = (byteLength / (1024 * 1024)).toFixed(1);
  const hardLimitMb = Math.round(policy.hardMaxBytes / (1024 * 1024));
  const recLimitMb = Math.round(policy.recommendedMaxBytes / (1024 * 1024));

  if (byteLength > policy.hardMaxBytes) {
    const remediation =
      format === 'dwg-wasm'
        ? 'Hãy lưu sang DXF ASCII (Streaming tới 250 MB), lọc bớt đối tượng/Xref hoặc dùng Bộ chuyển đổi HTTP Bridge.'
        : format === 'dxf-binary'
          ? 'Hãy lưu sang DXF ASCII để kích hoạt bộ đọc luồng tiết kiệm RAM.'
          : 'Hãy Purge đối tượng thừa, tách bản vẽ theo tầng hoặc lọc bớt HATCH/Layer trước khi mở.';
    return {
      ok: false,
      error: `Tệp "${fileName}" (${mb} MB) vượt quá giới hạn bộ nhớ trình duyệt cho định dạng ${policy.labelVi} (${hardLimitMb} MB). ${remediation}`
    };
  }

  if (byteLength > policy.recommendedMaxBytes) {
    return {
      ok: true,
      warning: `Tệp "${fileName}" (${mb} MB) vượt mức khuyến nghị (${recLimitMb} MB) cho ${policy.labelVi} — trình duyệt có thể tiêu tốn nhiều RAM hơn bình thường.`
    };
  }

  return { ok: true };
}

/**
 * Strips any script/HTML/LISP injection artifacts from DXF text payloads while keeping pure text.
 */
export function sanitizeCadString(raw: string): { clean: string; hadUnsafePattern: boolean } {
  if (!raw) return { clean: '', hadUnsafePattern: false };
  const hasScript = /<\s*script\b|javascript\s*:|\(\s*defun\s+|\(\s*vl-|\(\s*command\s+/i.test(raw);
  const clean = raw
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/javascript\s*:/gi, '');
  return { clean, hadUnsafePattern: hasScript };
}

/**
 * Validates recursive block hierarchies and detects circular `INSERT` loops.
 */
export function detectBlockCycles(blocks: Record<string, CADBlock>): string[] {
  const warnings: string[] = [];
  const reportedCycles = new Set<string>();

  const dfs = (name: string, stack: string[], depth: number) => {
    if (depth > MAX_BLOCK_NESTING_DEPTH) {
      if (!reportedCycles.has(name)) {
        reportedCycles.add(name);
        warnings.push(
          `Block "${name}" lồng nhau sâu vượt ngưỡng ${MAX_BLOCK_NESTING_DEPTH} cấp — đã tự động cắt nhánh để chống treo.`
        );
      }
      return;
    }
    const blk = blocks[name];
    if (!blk) return;
    for (const ent of blk.entities) {
      if (ent.type === 'INSERT') {
        if (stack.includes(ent.blockName)) {
          if (!reportedCycles.has(ent.blockName)) {
            reportedCycles.add(ent.blockName);
            warnings.push(
              `Phát hiện tham chiếu Block vòng lặp (${stack.join(' -> ')} -> ${ent.blockName}) — đã vô hiệu hóa đệ quy vô hạn.`
            );
          }
          continue;
        }
        dfs(ent.blockName, [...stack, ent.blockName], depth + 1);
      }
    }
  };

  for (const name of Object.keys(blocks)) {
    dfs(name, [name], 0);
  }
  return warnings;
}

export function auditMissingCadFonts(textStyles: Record<string, CADTextStyle>): string[] {
  const missing: string[] = [];
  for (const style of Object.values(textStyles)) {
    const rawFont = (style.fontFile || '').trim();
    if (!rawFont) continue;
    const base = rawFont.replace(/\.(shx|ttf|otf)$/i, '').toLowerCase();
    const isShx = /\.shx$/i.test(rawFont) || (!/\.(ttf|otf)$/i.test(rawFont) && !BROWSER_SAFE_FONT_BASES.has(base));
    if (isShx && !BROWSER_SAFE_FONT_BASES.has(base)) {
      style.missingFontFallback = true;
      if (!missing.includes(rawFont)) {
        missing.push(rawFont);
      }
    }
  }
  return missing;
}
