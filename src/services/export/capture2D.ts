import { ProjectState } from '../../types/infrastructure';
import {
  computePureDiagramBounds,
  computeViewportDiagramBounds,
  exportCurrentViewToPng,
  exportProjectToPng,
  generateCompositeBuildingSvgMarkup,
  generatePureSvgMarkup
} from '../../utils/svgExport';
import { resolveCanvasAppearance } from '../../utils/canvasBackgrounds';
import { scanProjectFloors } from './exportService';
import type { Export2DViewportRect, ExportFloorScope } from './exportTypes';

export interface Export2DPngResult {
  blob: Blob;
  filename: string;
}

export function generate2DSvgString(
  project: ProjectState,
  options?: { darkTheme?: boolean; includeTitleBlock?: boolean; floorScope?: ExportFloorScope }
): string {
  const darkTheme = options?.darkTheme ?? project.settings.isDarkMode;
  const includeTitleBlock = options?.includeTitleBlock ?? true;
  const meta = scanProjectFloors(project, options?.floorScope ?? 'all');

  if (meta.hasMultipleFloors && meta.isFloorBasedMode && meta.resolvedFloorId === '__ALL__') {
    return generateCompositeBuildingSvgMarkup(project, {
      darkTheme,
      includeTitleBlock
    });
  }

  return generatePureSvgMarkup(project, {
    darkTheme,
    includeTitleBlock,
    floorScopeId: meta.resolvedFloorId
  });
}

export function download2DHighResPng(
  project: ProjectState,
  floorScope: ExportFloorScope = 'active'
): Promise<void> {
  const meta = scanProjectFloors(project, floorScope);
  const scopedProject =
    meta.resolvedFloorId && meta.resolvedFloorId !== '__ALL__' && meta.resolvedFloorId !== '__SINGLE__'
      ? { ...project, activeFloorId: meta.resolvedFloorId }
      : project;
  return new Promise((resolve, reject) => {
    exportProjectToPng(
      scopedProject,
      () => resolve(),
      errMsg => reject(new Error(errMsg))
    );
  });
}

export function download2DQuickViewPng(
  project: ProjectState,
  viewport?: Export2DViewportRect,
  whiteBackground = true
): Promise<void> {
  return new Promise((resolve, reject) => {
    exportCurrentViewToPng(
      project,
      viewport,
      { whiteBackground, includeTitleBlock: false },
      () => resolve(),
      errMsg => reject(new Error(errMsg))
    );
  });
}

/**
 * Renders the 2D diagram to a crisp PNG Blob (for combined ZIP or multi-file exports).
 */
export async function render2DPngBlob(
  project: ProjectState,
  options?: {
    viewport?: Export2DViewportRect;
    whiteBackground?: boolean;
    includeTitleBlock?: boolean;
    floorScope?: ExportFloorScope;
  }
): Promise<Blob> {
  const whiteBackground = options?.whiteBackground ?? false;
  const meta = scanProjectFloors(project, options?.floorScope ?? 'active');
  const floorScopeId = meta.resolvedFloorId;
  const bounds =
    (options?.viewport
      ? computeViewportDiagramBounds(
          options.viewport.pan,
          options.viewport.zoom,
          options.viewport.viewportSize
        )
      : undefined) || computePureDiagramBounds(project, { floorScopeId });

  const svgMarkup =
    meta.hasMultipleFloors && meta.isFloorBasedMode && floorScopeId === '__ALL__' && !options?.viewport
      ? generateCompositeBuildingSvgMarkup(project, {
          darkTheme: whiteBackground ? false : project.settings.isDarkMode,
          includeTitleBlock: options?.includeTitleBlock ?? true,
          whiteBackground
        })
      : generatePureSvgMarkup(project, {
          darkTheme: whiteBackground ? false : project.settings.isDarkMode,
          includeTitleBlock: options?.includeTitleBlock ?? true,
          boundsOverride: bounds,
          whiteBackground,
          floorScopeId
        });

  const appearance = resolveCanvasAppearance(project.settings, project.settings.isDarkMode);
  const bgColor = whiteBackground ? '#ffffff' : appearance.backgroundColor;

  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const urlApi = window.URL || window.webkitURL || window;
  const blobUrl = urlApi.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không thể kết xuất hình ảnh PNG từ bản vẽ 2D.'));
      image.src = blobUrl;
    });

    const scale = Math.min(3, Math.max(1.5, 2200 / Math.max(bounds.width, bounds.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(480, Math.round(bounds.width * scale));
    canvas.height = Math.max(360, Math.round(bounds.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ 2D Canvas để tạo ảnh PNG.');
    }
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/png', 1)
    );
    if (!blob) {
      throw new Error('Không thể chuyển đổi bản vẽ 2D sang PNG Blob.');
    }
    return blob;
  } finally {
    urlApi.revokeObjectURL(blobUrl);
  }
}
