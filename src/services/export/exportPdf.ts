import { ProjectState } from '../../types/infrastructure';
import {
  buildTechnicalPdfArtifact,
  exportTechnicalPdf,
  ExportA4PdfResult
} from '../../utils/pdfExporter';
import { capture3DAnglesStrict, capture3DSnapshotStrict } from './capture3D';
import { ExportPdfConfig } from './exportTypes';
import { trackExport } from '../../services/tracker';

export async function runExportPdf(
  project: ProjectState,
  config: ExportPdfConfig
): Promise<ExportA4PdfResult> {
  const needs3D = config.includeDiagram && (config.contentScope === '3d' || config.contentScope === 'both');

  config.onProgress?.({
    percent: 4,
    stage: needs3D ? 'Đang chụp ảnh không gian 3D WebGL...' : 'Đang chuẩn bị dữ liệu xuất PDF...'
  });

  let captures3D = undefined;
  if (needs3D) {
    const angles = config.cameraAngles3D && config.cameraAngles3D.length > 0 ? config.cameraAngles3D : [];
    captures3D =
      angles.length > 0
        ? await capture3DAnglesStrict(config.capture3D, angles, {
            width: 1920,
            height: 1080,
            background: config.background3D ?? 'light'
          })
        : [
            await capture3DSnapshotStrict(config.capture3D, {
              width: 1920,
              height: 1080,
              background: config.background3D ?? 'light'
            })
          ];
  }

  const res = await exportTechnicalPdf(project, {
    contentScope: config.contentScope,
    floorScope: config.floorScope,
    paperSize: config.paperSize || 'A4',
    orientation: config.orientation,
    autoFit: config.autoFit ?? true,
    margins: config.margins,
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    includeDiagram: config.includeDiagram,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    includeCad: config.includeCad,
    cadDocument: config.cadDocument,
    captures3D,
    onProgress: config.onProgress
  });
  trackExport(`pdf:${config.paperSize || 'A4'}_${config.contentScope}${config.includeCad ? '_with_cad' : ''}`);
  return res;
}

export async function buildExportPdfForBundle(
  project: ProjectState,
  config: ExportPdfConfig
) {
  const needs3D = config.includeDiagram && (config.contentScope === '3d' || config.contentScope === 'both');

  if (needs3D) {
    config.onProgress?.({ percent: 6, stage: 'Đang chụp ảnh 3D cho hồ sơ bàn giao...' });
  }

  const captures3D = needs3D
    ? config.cameraAngles3D && config.cameraAngles3D.length > 0
      ? await capture3DAnglesStrict(config.capture3D, config.cameraAngles3D, {
          width: 1920,
          height: 1080,
          background: config.background3D ?? 'light'
        })
      : [
          await capture3DSnapshotStrict(config.capture3D, {
            width: 1920,
            height: 1080,
            background: config.background3D ?? 'light'
          })
        ]
    : undefined;

  const pdfArtifact = await buildTechnicalPdfArtifact(project, {
    contentScope: config.contentScope,
    floorScope: config.floorScope,
    paperSize: config.paperSize || 'A4',
    orientation: config.orientation,
    autoFit: config.autoFit ?? true,
    margins: config.margins,
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    includeDiagram: config.includeDiagram,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    includeCad: config.includeCad,
    cadDocument: config.cadDocument,
    captures3D,
    onProgress: config.onProgress
  });

  return { pdfArtifact, captures3D: captures3D || [] };
}
