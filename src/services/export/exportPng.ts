import { ProjectState } from '../../types/infrastructure';
import {
  download2DHighResPng,
  download2DQuickViewPng,
  render2DPngBlob
} from './capture2D';
import { capture3DSnapshotStrict } from './capture3D';
import {
  ExportPngConfig,
  sanitizeExportBaseName,
  triggerBlobDownload
} from './exportTypes';
import { trackExport } from '../../services/tracker';

export interface ExportPngOutcome {
  exportedFiles: string[];
  width?: number;
  height?: number;
}

export async function runExportPng(
  project: ProjectState,
  config: ExportPngConfig
): Promise<ExportPngOutcome> {
  const baseName = sanitizeExportBaseName(project.name);

  if (config.contentScope === '2d') {
    if (config.quickView) {
      await download2DQuickViewPng(
        project,
        config.viewport2D,
        config.whiteBackground2D ?? true
      );
      trackExport('png:quick_2d');
      return { exportedFiles: [`${baseName}_QuickView.png`] };
    }
    await download2DHighResPng(project, config.floorScope ?? 'active');
    trackExport('png:2d');
    return { exportedFiles: [`${baseName}_HighRes.png`] };
  }

  if (config.contentScope === '3d') {
    const snap3D = await capture3DSnapshotStrict(config.capture3D, {
      width: 1920,
      height: 1080,
      background: config.background3D ?? 'light'
    });
    const filename = `${baseName}_3D_${snap3D.preset.toUpperCase()}.png`;
    triggerBlobDownload(new Blob([new Uint8Array(snap3D.bytes)], { type: 'image/png' }), filename);
    trackExport(config.quickView ? 'png:quick_3d' : 'png:3d');
    return {
      exportedFiles: [filename],
      width: snap3D.width,
      height: snap3D.height
    };
  }

  // 'both' -> capture 3D strictly first (fails loudly if 3D inactive/error), then render 2D and download both
  const snap3D = await capture3DSnapshotStrict(config.capture3D, {
    width: 1920,
    height: 1080,
    background: config.background3D ?? 'light'
  });
  const blob2D = await render2DPngBlob(project, {
    viewport: config.quickView ? config.viewport2D : undefined,
    whiteBackground: config.quickView ? (config.whiteBackground2D ?? true) : false,
    includeTitleBlock: !config.quickView,
    floorScope: config.floorScope ?? 'active'
  });

  const file2D = `${baseName}_2D.png`;
  const file3D = `${baseName}_3D_${snap3D.preset.toUpperCase()}.png`;
  triggerBlobDownload(blob2D, file2D);
  triggerBlobDownload(new Blob([new Uint8Array(snap3D.bytes)], { type: 'image/png' }), file3D);
  trackExport('png:both');

  return {
    exportedFiles: [file2D, file3D],
    width: snap3D.width,
    height: snap3D.height
  };
}
