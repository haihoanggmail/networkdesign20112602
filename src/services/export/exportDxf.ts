import { ProjectState } from '../../types/infrastructure';
import { exportProjectToDxf } from '../../utils/dxfExporter';
import { buildSafeCadExportFileName, cadExportService } from '../../cad/export/CADExportService';
import {
  ExportContentScope,
  ExportDxfOptions,
  ExportFloorScope,
  sanitizeExportBaseName
} from './exportTypes';
import { trackExport } from '../../services/tracker';

export function runExportDxf(
  project: ProjectState,
  contentScope: ExportContentScope = '2d',
  floorScope: ExportFloorScope = 'all',
  options?: ExportDxfOptions
): { filename: string } {
  if (contentScope === '3d') {
    throw new Error(
      'Định dạng AutoCAD DXF chỉ áp dụng cho bản vẽ mặt bằng 2D CAD. Vui lòng chọn "Bản vẽ 2D" hoặc "Cả 2D và 3D".'
    );
  }

  if (options?.includeCad && options?.cadDocument) {
    cadExportService.downloadCombinedDxf(options.cadDocument, project, { floorScope });
    const filename = buildSafeCadExportFileName(
      `${options.cadDocument.name}_${project.name}`,
      '_combined',
      'dxf'
    );
    trackExport('dxf:combined_cad');
    return { filename };
  }

  exportProjectToDxf(project, { floorScope });
  const baseName = sanitizeExportBaseName(project.name);
  trackExport('dxf');
  return { filename: `${baseName}_AutoCAD_R12.dxf` };
}
