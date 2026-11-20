import type { RawDxfGroupPair } from '../core/CADTypes';

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\0';

/**
 * Checks whether an ArrayBuffer starts with the standard 22-byte AutoCAD Binary DXF header.
 */
export function isBinaryDxfBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BINARY_DXF_SENTINEL.length) return false;
  const bytes = new Uint8Array(buffer, 0, BINARY_DXF_SENTINEL.length);
  for (let i = 0; i < BINARY_DXF_SENTINEL.length; i++) {
    if (bytes[i] !== BINARY_DXF_SENTINEL.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Checks whether an ArrayBuffer is an AutoCAD native DWG binary header (`AC1012`..`AC1032`).
 */
export function detectDwgSignature(buffer: ArrayBuffer): { isDwg: boolean; versionCode?: string; versionLabel?: string } {
  if (buffer.byteLength < 6) return { isDwg: false };
  const bytes = new Uint8Array(buffer, 0, 6);
  const sig = String.fromCharCode(...bytes);
  if (!/^AC10\d{2}$/.test(sig)) return { isDwg: false };

  const labels: Record<string, string> = {
    AC1012: 'AutoCAD R13',
    AC1014: 'AutoCAD R14',
    AC1015: 'AutoCAD 2000 / 2000i / 2002',
    AC1018: 'AutoCAD 2004 / 2005 / 2006',
    AC1021: 'AutoCAD 2007 / 2008 / 2009',
    AC1024: 'AutoCAD 2010 / 2011 / 2012',
    AC1027: 'AutoCAD 2013–2017',
    AC1032: 'AutoCAD 2018–2025+'
  };
  return {
    isDwg: true,
    versionCode: sig,
    versionLabel: labels[sig] || `AutoCAD (${sig})`
  };
}

function readNullTerminatedString(bytes: Uint8Array, offset: number): { value: string; nextOffset: number } {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) {
    end += 1;
  }
  const slice = bytes.subarray(offset, end);
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  } catch {
    value = String.fromCharCode(...slice);
  }
  return {
    value,
    nextOffset: end < bytes.length ? end + 1 : end
  };
}

function valueKindForGroupCode(
  code: number
): 'string' | 'double' | 'int16' | 'int32' | 'int64' | 'bool' | 'binary' {
  if (
    (code >= 0 && code <= 9) ||
    code === 100 ||
    code === 102 ||
    code === 105 ||
    (code >= 300 && code <= 309) ||
    (code >= 320 && code <= 369) ||
    (code >= 390 && code <= 399) ||
    (code >= 410 && code <= 419) ||
    (code >= 430 && code <= 439) ||
    (code >= 470 && code <= 481) ||
    code === 999 ||
    (code >= 1000 && code <= 1009)
  ) {
    return 'string';
  }
  if (code >= 310 && code <= 319) return 'binary';
  if (
    (code >= 10 && code <= 59) ||
    (code >= 110 && code <= 149) ||
    (code >= 210 && code <= 239) ||
    (code >= 460 && code <= 469) ||
    (code >= 1010 && code <= 1059)
  ) {
    return 'double';
  }
  if ((code >= 290 && code <= 299)) return 'bool';
  if (code >= 160 && code <= 169) return 'int64';
  if (
    (code >= 90 && code <= 99) ||
    (code >= 420 && code <= 429) ||
    (code >= 440 && code <= 459) ||
    code === 1071
  ) {
    return 'int32';
  }
  return 'int16';
}

/**
 * Decodes an AutoCAD Binary DXF buffer directly in the browser into canonical
 * `(code, value)` group pairs and equivalent ASCII DXF text.
 */
export function decodeBinaryDxfBuffer(
  buffer: ArrayBuffer,
  options?: { skipAsciiBuild?: boolean }
): {
  pairs: RawDxfGroupPair[];
  asciiDxf: string;
} {
  if (!isBinaryDxfBuffer(buffer)) {
    throw new Error('Tệp không có chữ ký tiêu chuẩn "AutoCAD Binary DXF".');
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const pairs: RawDxfGroupPair[] = [];
  const skipAscii = Boolean(options?.skipAsciiBuild);
  const asciiLines: string[] = [];

  let offset = BINARY_DXF_SENTINEL.length;

  // Heuristic: R13+ Binary DXF stores every group code as 2-byte little-endian uint16,
  // whereas R10/R12 uses 1-byte code unless 0xFF escape precedes uint16.
  const isTwoByteGroupCode =
    offset + 3 < bytes.length && bytes[offset] === 0 && bytes[offset + 1] === 0 && bytes[offset + 2] === 0x53;

  while (offset < bytes.length) {
    let code: number;
    if (isTwoByteGroupCode) {
      if (offset + 2 > bytes.length) break;
      code = view.getUint16(offset, true);
      offset += 2;
    } else {
      const b0 = bytes[offset++];
      if (b0 === 255) {
        if (offset + 2 > bytes.length) break;
        code = view.getUint16(offset, true);
        offset += 2;
      } else {
        code = b0;
      }
    }

    const kind = valueKindForGroupCode(code);
    let value: string | number = '';

    if (kind === 'string') {
      const strRes = readNullTerminatedString(bytes, offset);
      value = strRes.value;
      offset = strRes.nextOffset;
    } else if (kind === 'binary') {
      if (offset >= bytes.length) break;
      const chunkLen = bytes[offset++];
      const slice = bytes.subarray(offset, Math.min(bytes.length, offset + chunkLen));
      offset += slice.length;
      value = Array.from(slice)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join('');
    } else if (kind === 'double') {
      if (offset + 8 > bytes.length) break;
      value = view.getFloat64(offset, true);
      offset += 8;
    } else if (kind === 'bool') {
      if (offset >= bytes.length) break;
      value = bytes[offset++];
    } else if (kind === 'int64') {
      if (offset + 8 > bytes.length) break;
      const lo = view.getUint32(offset, true);
      const hi = view.getInt32(offset + 4, true);
      value = hi * 4294967296 + lo;
      offset += 8;
    } else if (kind === 'int32') {
      if (offset + 4 > bytes.length) break;
      value = view.getInt32(offset, true);
      offset += 4;
    } else {
      if (offset + 2 > bytes.length) break;
      value = view.getInt16(offset, true);
      offset += 2;
    }

    pairs.push({ code, value });
    if (!skipAscii) {
      asciiLines.push(String(code), String(value));
    }
    if (code === 0 && String(value).toUpperCase() === 'EOF') {
      break;
    }
  }

  return {
    pairs,
    asciiDxf: skipAscii ? '' : asciiLines.join('\n') + '\n'
  };
}
