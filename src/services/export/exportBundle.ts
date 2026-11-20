import { ProjectState } from '../../types/infrastructure';
import { exportHandoverZipBundle } from '../../utils/handoverBundle';
import { buildExportPdfForBundle } from './exportPdf';
import { ExportBundleConfig, sanitizeExportBaseName } from './exportTypes';

export async function runExportBundle(
  project: ProjectState,
  config: ExportBundleConfig
): Promise<{ filename: string; totalBytes: number; entries: string[] }> {
  const baseName = sanitizeExportBaseName(project.name);

  config.onProgress?.({ percent: 4, stage: 'Đang chuẩn bị đóng gói hồ sơ PDF & Excel...' });

  const { pdfArtifact, captures3D } = await buildExportPdfForBundle(project, {
    contentScope: config.contentScope,
    floorScope: config.floorScope,
    paperSize: 'A4',
    orientation: config.orientation,
    autoFit: config.autoFit ?? true,
    margins: config.margins,
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    includeDiagram: true,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    includeCad: config.includeCad,
    cadDocument: config.cadDocument,
    background3D: config.background3D,
    cameraAngles3D: config.cameraAngles3D,
    capture3D: config.capture3D,
    onProgress: p => {
      config.onProgress?.({
        percent: Math.round(5 + p.percent * 0.6),
        stage: p.stage,
        currentPage: p.currentPage,
        totalPages: p.totalPages
      });
    }
  });

  const captured3DImages = captures3D.map(cap => ({
    filename: `${baseName}_3D_${cap.preset.toUpperCase()}.png`,
    bytes: cap.bytes
  }));

  return exportHandoverZipBundle(project, {
    floorScope: config.floorScope,
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    orientation: config.orientation,
    autoFit: config.autoFit ?? true,
    margins: config.margins,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    includeCad: config.includeCad,
    cadDocument: config.cadDocument,
    customPdfArtifact: {
      uint8: pdfArtifact.uint8,
      filename: pdfArtifact.filename
    },
    captured3DImages,
    viewerOptions: {
      contentScope: config.contentScope,
      background3D: config.background3D,
      floorScope: config.floorScope
    },
    onProgress: p => {
      config.onProgress?.({
        percent: Math.round(66 + p.percent * 0.34),
        stage: p.stage
      });
    }
  });
}
