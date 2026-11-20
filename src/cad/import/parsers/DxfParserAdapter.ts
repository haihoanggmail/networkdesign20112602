import DxfParser, { IDxf } from 'dxf-parser';
import type { RawDxfGroupPair } from '../../core/CADTypes';
import {
  RawDxfTokenizedDocument,
  parseRawDxfSections,
  parseRawDxfSectionsFromPairs
} from './RawEntityParser';

export interface ParsedDxfBundle {
  dxf: IDxf;
  raw: RawDxfTokenizedDocument;
}

/**
 * Parses an ASCII DXF string using both `dxf-parser` (for structured entities/blocks/tables)
 * and `RawEntityParser` (for complete round-trip group codes, styles, dimstyles, XDATA, and unknown entities).
 */
export function parseDxfWithRawCapture(
  asciiDxf: string,
  preDecodedPairs?: RawDxfGroupPair[]
): ParsedDxfBundle {
  const parser = new DxfParser();
  const dxf = parser.parseSync(asciiDxf);
  if (!dxf) {
    throw new Error(
      'Không thể giải mã cấu trúc tệp DXF. Tệp có thể bị cắt cụt hoặc thiếu phần ENTITIES.'
    );
  }
  const raw = preDecodedPairs
    ? parseRawDxfSectionsFromPairs(preDecodedPairs, 0)
    : parseRawDxfSections(asciiDxf);

  return { dxf, raw };
}
