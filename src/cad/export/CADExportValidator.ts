import type { CADDocument } from '../core/CADTypes';

export interface CADExportValidationResult {
  valid: boolean;
  warningsVi: string[];
  errorsVi: string[];
}

export function validateCadDocumentForExport(doc: CADDocument): CADExportValidationResult {
  const warningsVi: string[] = [];
  const errorsVi: string[] = [];

  if (!doc || !Array.isArray(doc.entities)) {
    errorsVi.push('Tài liệu CAD không hợp lệ hoặc thiếu danh sách đối tượng.');
    return { valid: false, warningsVi, errorsVi };
  }

  const seenHandles = new Set<string>();
  let duplicateHandles = 0;
  let missingBlocks = 0;
  let missingLayers = 0;

  for (const ent of doc.entities) {
    if (ent.handle) {
      const norm = ent.handle.trim().toUpperCase();
      if (seenHandles.has(norm)) duplicateHandles++;
      seenHandles.add(norm);
    }
    if (!doc.layers[ent.layer]) {
      missingLayers++;
    }
    if (ent.type === 'INSERT' && !doc.blocks[ent.blockName]) {
      missingBlocks++;
    }
  }

  if (duplicateHandles > 0) {
    warningsVi.push(`Có ${duplicateHandles} handle trùng lặp — bộ xuất sẽ tự động cấp handle duy nhất.`);
  }
  if (missingLayers > 0) {
    warningsVi.push(`Có ${missingLayers} đối tượng thuộc layer chưa khai báo — sẽ tự động bổ sung vào bảng LAYER.`);
  }
  if (missingBlocks > 0) {
    warningsVi.push(`Có ${missingBlocks} Block chèn (INSERT) thiếu định nghĩa Block tương ứng.`);
  }
  if (doc.entities.length === 0) {
    warningsVi.push('Bản vẽ CAD hiện không có đối tượng nào.');
  }

  return {
    valid: errorsVi.length === 0,
    warningsVi,
    errorsVi
  };
}
