import type { jsPDF as JsPdfDocument } from 'jspdf';
import { ProjectState } from '../types/infrastructure';
import type { BoundingBox2D, CADDocument } from '../cad/core/CADTypes';
import { convertCADDistanceToMeters, getCADUnitMeta } from '../cad/core/CADUnits';
import { computeSmartFitExtents } from '../cad/geometry/CADBounds';
import { renderCADDocumentToSvg } from '../cad/rendering/CADSVGRenderer';
import { APP_BUILD_HASH, APP_VERSION } from '../config/appInfo';
import {
  computePureDiagramBounds,
  DiagramBounds,
  generateCompositeBuildingSvgMarkup,
  generatePureSvgMarkup
} from './svgExport';
import { buildProjectLegendData, GeneratedLegendData } from './legendGenerator';
import { getRackStatistics, getAssetUHeight } from './rackGeometry';
import { sanitizeSafeImageUrl } from './security';
import { getHachihiLogoSvgMarkup } from './brandLogoSvg';
import {
  A4Orientation,
  A4ScaleBarSpec,
  A4ScaleMetrics,
  DEFAULT_PDF_MARGINS_MM,
  PdfMarginsMm,
  PdfPaperSizeUpper,
  PdfViewportFitResult,
  computeA4ScaleMetrics,
  computePdfViewportFitScale,
  getPaperDimensionsMm,
  normalizePdfMargins
} from './pdfScale';

export type {
  A4Orientation,
  A4ScaleBarSpec,
  A4ScaleMetrics,
  PdfMarginsMm,
  PdfPaperSizeUpper,
  PdfViewportFitResult
};
export {
  DEFAULT_PDF_MARGINS_MM,
  computeA4ScaleMetrics,
  computePdfViewportFitScale,
  getPaperDimensionsMm,
  normalizePdfMargins
};
export type PdfContentScope = '2d' | '3d' | 'both';

export interface PdfExportProgressEvent {
  percent: number;
  stage: string;
  currentPage?: number;
  totalPages?: number;
}

export type PdfExportProgressCallback = (progress: PdfExportProgressEvent) => void;

function emitPdfProgress(
  onProgress: PdfExportProgressCallback | undefined,
  percent: number,
  stage: string,
  currentPage?: number,
  totalPages?: number
): void {
  if (!onProgress) return;
  try {
    onProgress({
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      stage,
      currentPage,
      totalPages
    });
  } catch {
    // ignore listener errors
  }
}

async function yieldForProgressUi(onProgress?: PdfExportProgressCallback): Promise<void> {
  if (!onProgress || typeof window === 'undefined') return;
  await new Promise<void>(resolve => window.setTimeout(resolve, 0));
}

export interface Captured3DPageInput {
  preset: string;
  label: string;
  dataUrl: string;
  width: number;
  height: number;
  background?: 'light' | 'dark';
}

export interface ExportA4PdfOptions {
  orientation?: A4Orientation;
  drawingCode?: string;
  drawingScale?: string;
  autoFit?: boolean;
  margins?: Partial<PdfMarginsMm>;
  includeLegendPanel?: boolean;
  legendScope?: 'all' | 'activeFloor';
  floorScope?: 'all' | 'active' | string;
  includeRackElevation?: boolean;
  includeTables?: boolean;
  pixelRatio?: number;
  onProgress?: PdfExportProgressCallback;
}

export interface ExportTechnicalPdfOptions extends ExportA4PdfOptions {
  contentScope?: PdfContentScope;
  paperSize?: PdfPaperSizeUpper;
  includeDiagram?: boolean;
  includeCad?: boolean;
  cadDocument?: CADDocument | null;
  captures3D?: Captured3DPageInput[];
}

function parseDrawingScaleDenominator(drawingScale?: string): number | undefined {
  if (!drawingScale) return undefined;
  const match = drawingScale.match(/1\s*:\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const val = Number(match[1]);
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

interface PdfFloorSheetSpec {
  floorScopeId: string;
  label: string;
  isComposite: boolean;
}

function resolvePdfFloorSheets(
  project: ProjectState,
  floorScope: string | undefined
): PdfFloorSheetSpec[] {
  const sortedFloors = [...(project.floors || [])].sort((a, b) => a.level - b.level);
  const isFloorBased = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);

  if (floorScope === 'active') {
    const active = sortedFloors.find(f => f.id === project.activeFloorId);
    if (active) {
      return [{ floorScopeId: active.id, label: active.name, isComposite: false }];
    }
  } else if (floorScope && floorScope !== 'all' && floorScope !== '__ALL__') {
    const matched = sortedFloors.find(f => f.id === floorScope);
    if (matched) {
      return [{ floorScopeId: matched.id, label: matched.name, isComposite: false }];
    }
  }

  if (isFloorBased && sortedFloors.length > 1) {
    return [
      {
        floorScopeId: '__ALL__',
        label: `Toàn bộ tòa nhà (${sortedFloors.length} tầng)`,
        isComposite: true
      },
      ...sortedFloors.map(f => ({
        floorScopeId: f.id,
        label: f.name,
        isComposite: false
      }))
    ];
  }

  const single = sortedFloors[0];
  return [
    {
      floorScopeId: sortedFloors.length > 1 ? '__ALL__' : single?.id || '__ALL__',
      label:
        sortedFloors.length > 1
          ? `Toàn bộ tòa nhà (${sortedFloors.length} tầng)`
          : single?.name || 'Toàn bộ bản vẽ',
      isComposite: false
    }
  ];
}

export interface ExportA4PdfResult {
  filename: string;
  pageCount: number;
  scaleMetrics: A4ScaleMetrics;
}

export interface A4PdfArtifact extends ExportA4PdfResult {
  blob: Blob;
  uint8: Uint8Array;
}

export function fitBoxPreserveAspectRatio(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number
): { width: number; height: number; offsetX: number; offsetY: number } {
  const safeSrcW = Math.max(1, srcW);
  const safeSrcH = Math.max(1, srcH);
  const safeBoxW = Math.max(1, boxW);
  const safeBoxH = Math.max(1, boxH);
  const ratio = Math.min(safeBoxW / safeSrcW, safeBoxH / safeSrcH);
  const width = Number((safeSrcW * ratio).toFixed(2));
  const height = Number((safeSrcH * ratio).toFixed(2));
  const offsetX = Number(((safeBoxW - width) / 2).toFixed(2));
  const offsetY = Number(((safeBoxH - height) / 2).toFixed(2));
  return { width, height, offsetX, offsetY };
}

const MM_TO_PX_96DPI = 96 / 25.4;

function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX_96DPI);
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strips Tailwind v4 stylesheets using modern CSS color functions (oklch, oklab, color-mix)
 * from html2canvas's cloned document so html2canvas never throws CSS parser errors.
 */
export function sanitizeClonedDocForHtml2Canvas(clonedDoc: Document): void {
  const styleNodes = Array.from(clonedDoc.querySelectorAll('style, link[rel="stylesheet"]'));
  for (const node of styleNodes) {
    if (node.tagName === 'STYLE') {
      const css = node.textContent || '';
      if (
        css.includes('oklch(') ||
        css.includes('oklab(') ||
        css.includes('color-mix(') ||
        css.includes('--tw-')
      ) {
        node.remove();
      }
    } else if (node.tagName === 'LINK') {
      const href = (node as HTMLLinkElement).href || '';
      if (!href.includes('fonts.googleapis.com')) {
        node.remove();
      }
    }
  }

  clonedDoc.documentElement.classList.remove('dark');
  clonedDoc.documentElement.style.backgroundColor = '#ffffff';
  clonedDoc.documentElement.style.color = '#0f172a';
  clonedDoc.body.style.backgroundColor = '#ffffff';
  clonedDoc.body.style.color = '#0f172a';
  clonedDoc.body.style.margin = '0';
  clonedDoc.body.style.padding = '0';
}

async function rasterizeSvgMarkupToPng(
  svgMarkup: string,
  bounds: DiagramBounds,
  backgroundColor = '#ffffff'
): Promise<string> {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const urlApi = window.URL || window.webkitURL || window;
  const blobUrl = urlApi.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không thể kết xuất SVG sang ảnh cho PDF.'));
      image.src = blobUrl;
    });

    const safeBoundsW = Math.max(1, bounds.width);
    const safeBoundsH = Math.max(1, bounds.height);
    const targetMaxDim = 2800;
    const minDimScale = Math.max(480 / safeBoundsW, 360 / safeBoundsH, 1.75);
    const maxDimScale = 3600 / Math.max(safeBoundsW, safeBoundsH);
    const scale = Math.min(
      Math.max(minDimScale, Math.min(3, targetMaxDim / Math.max(safeBoundsW, safeBoundsH))),
      Math.max(1.75, maxDimScale)
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(120, Math.round(safeBoundsW * scale));
    canvas.height = Math.max(120, Math.round(safeBoundsH * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ 2D Canvas để tạo PDF.');
    }
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    urlApi.revokeObjectURL(blobUrl);
  }
}

function buildLegendHtml(legendData: GeneratedLegendData, orientation: A4Orientation): string {
  const maxComponents = orientation === 'landscape' ? 14 : 8;
  const maxCables = orientation === 'landscape' ? 8 : 5;
  const visibleComponents = legendData.components.slice(0, maxComponents);
  const visibleCables = legendData.cables.slice(0, maxCables);
  const totalWatts = legendData.components.reduce((sum, c) => sum + c.totalWatts, 0);
  const totalMeters = legendData.cables.reduce((sum, c) => sum + c.totalMeters, 0);

  const compRows =
    visibleComponents.length === 0
      ? `<tr><td colspan="3" style="padding:8px 6px;color:#64748b;text-align:center;font-size:9px;">Chưa có thiết bị trên phạm vi chọn</td></tr>`
      : visibleComponents
          .map(item => {
            const safeImg = sanitizeSafeImageUrl(item.customImageUrl);
            const swatch = safeImg
              ? `<img src="${escapeHtml(safeImg)}" style="width:14px;height:14px;object-fit:contain;border-radius:2px;display:block;" />`
              : `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${escapeHtml(item.accentColor)};border:1px solid #cbd5e1;"></span>`;
            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:3.5px 4px;width:18px;vertical-align:middle;">${swatch}</td>
                <td style="padding:3.5px 4px;vertical-align:middle;">
                  <div style="font-size:9px;font-weight:700;color:#0f172a;line-height:1.2;">${escapeHtml(item.label)}</div>
                  <div style="font-size:8px;color:#475569;line-height:1.2;">${escapeHtml(item.subLabel.slice(0, 26))}</div>
                </td>
                <td style="padding:3.5px 4px;text-align:right;vertical-align:middle;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:#155eef;white-space:nowrap;">×${item.count}</td>
              </tr>
            `;
          })
          .join('');

  const cableRows =
    visibleCables.length === 0
      ? ''
      : visibleCables
          .map(cab => {
            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:3px 4px;width:20px;vertical-align:middle;">
                  <span style="display:inline-block;width:14px;height:3px;background:${escapeHtml(cab.color)};border-radius:1px;"></span>
                </td>
                <td style="padding:3px 4px;font-size:8.5px;font-weight:600;color:#1e293b;vertical-align:middle;">${escapeHtml(cab.label)}</td>
                <td style="padding:3px 4px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:8.5px;color:#334155;vertical-align:middle;white-space:nowrap;">×${cab.count} (${cab.totalMeters}m)</td>
              </tr>
            `;
          })
          .join('');

  return `
    <div style="border:1px solid #cbd5e1;background:#ffffff;display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
      <div style="background:#14213d;color:#ffffff;padding:5px 8px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:9.5px;font-weight:700;letter-spacing:0.03em;">CHÚ GIẢI KÝ HIỆU (LEGEND)</span>
        <span style="font-size:8px;color:#cbd5e1;font-family:'JetBrains Mono',monospace;">${escapeHtml(legendData.scope === 'activeFloor' ? 'Tầng hiện tại' : 'Toàn dự án')}</span>
      </div>
      <div style="flex:1;overflow:hidden;padding:4px 6px;display:flex;flex-direction:column;gap:6px;">
        <div>
          <div style="font-size:8px;font-weight:700;color:#475569;margin-bottom:2px;letter-spacing:0.04em;">THIẾT BỊ (${legendData.totalDevices})</div>
          <table style="width:100%;border-collapse:collapse;">
            <tbody>${compRows}</tbody>
          </table>
          ${
            legendData.components.length > maxComponents
              ? `<div style="font-size:8px;color:#64748b;padding-top:2px;">+ ${legendData.components.length - maxComponents} nhóm thiết bị khác...</div>`
              : ''
          }
        </div>
        ${
          visibleCables.length > 0
            ? `<div>
                <div style="font-size:8px;font-weight:700;color:#475569;margin-bottom:2px;letter-spacing:0.04em;">TUYẾN CÁP (${legendData.totalCables})</div>
                <table style="width:100%;border-collapse:collapse;">
                  <tbody>${cableRows}</tbody>
                </table>
              </div>`
            : ''
        }
      </div>
      <div style="border-top:1px solid #cbd5e1;background:#f8fafc;padding:4px 8px;display:flex;justify-content:space-between;font-size:8.5px;font-family:'JetBrains Mono',monospace;color:#0f172a;">
        <span>Cáp: <strong>${totalMeters.toFixed(1)}m</strong></span>
        <span>Công suất: <strong>${totalWatts}W</strong></span>
      </div>
    </div>
  `;
}

function buildScaleBarHtml(metrics: A4ScaleMetrics, customDrawingScale?: string): string {
  const barPx = Math.min(220, mmToPx(metrics.scaleBar.barWidthMm));
  const segPx = Math.max(14, Math.round(barPx / metrics.scaleBar.segments));
  const segsHtml = Array.from({ length: metrics.scaleBar.segments })
    .map((_, idx) => {
      const bg = idx % 2 === 0 ? '#0f172a' : '#ffffff';
      return `<div style="width:${segPx}px;height:6px;background:${bg};border-right:${idx < metrics.scaleBar.segments - 1 ? '1px solid #0f172a' : 'none'};box-sizing:border-box;"></div>`;
    })
    .join('');

  const scaleBadge = metrics.autoFitApplied
    ? `${metrics.scaleRatioLabel} (Auto-Fit)`
    : customDrawingScale && customDrawingScale !== metrics.scaleRatioLabel
    ? `${metrics.scaleRatioLabel} · ${customDrawingScale}`
    : metrics.scaleRatioLabel;

  return `
    <div style="border-top:1px solid #cbd5e1;background:#f8fafc;padding:4px 8px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-sizing:border-box;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:8px;font-weight:700;color:#0f172a;letter-spacing:0.03em;">THƯỚC TỶ LỆ</span>
        <div style="display:flex;flex-direction:column;">
          <div style="display:flex;border:1px solid #0f172a;width:${segPx * metrics.scaleBar.segments}px;">
            ${segsHtml}
          </div>
          <div style="display:flex;justify-content:space-between;width:${segPx * metrics.scaleBar.segments}px;margin-top:1px;font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#334155;">
            <span>0m</span>
            <span>${metrics.scaleBar.ticks[1]}m</span>
            <span>${metrics.scaleBar.ticks[2]}m</span>
          </div>
        </div>
      </div>
      <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:8px;color:#475569;">
        <div><strong style="color:#155eef;">${escapeHtml(scaleBadge)}</strong></div>
        <div>Khung: ${metrics.realWorldWidthMeters}m × ${metrics.realWorldHeightMeters}m · ${metrics.pxPerMeter}px/m</div>
      </div>
    </div>
  `;
}

function buildTitleBlockHtml(
  project: ProjectState,
  metrics: A4ScaleMetrics,
  options: {
    drawingCode: string;
    drawingScale: string;
    orientation: A4Orientation;
    paperSize?: PdfPaperSizeUpper;
    pageNumber: number;
    totalPages: number;
    subtitle?: string;
  }
): string {
  const dateStr = new Date().toLocaleDateString('vi-VN');
  const paperLabel = options.paperSize || 'A4';
  const scaleText = options.drawingScale.trim()
    ? `${metrics.scaleRatioLabel} (${options.drawingScale.trim()})`
    : metrics.scaleRatioLabel;

  return `
    <table style="width:100%;border-collapse:collapse;border:1.5px solid #14213d;font-size:9px;background:#ffffff;color:#0f172a;">
      <tbody>
        <tr>
          <td rowspan="2" style="border:1px solid #14213d;padding:5px 8px;width:36%;vertical-align:middle;">
            <div style="display:flex;align-items:center;gap:8px;">
              ${getHachihiLogoSvgMarkup(24, 'light', `pdf_${options.pageNumber}`)}
              <div style="min-width:0;">
                <div style="font-size:8px;font-weight:700;color:#155eef;letter-spacing:0.04em;">HACHIHI NETWORK &amp; ELECTRICAL DESIGNER · hachihi.vn</div>
                <div style="font-size:11px;font-weight:800;color:#0f172a;margin-top:2px;">${escapeHtml(project.name)}</div>
                <div style="font-size:7.5px;color:#475569;margin-top:1px;">${options.subtitle ? `${escapeHtml(options.subtitle)} · ` : ''}Hotline: 093 384 2126 · App v${escapeHtml(APP_VERSION)} (${escapeHtml(APP_BUILD_HASH)})</div>
              </div>
            </div>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Số hiệu:</span> <strong style="font-family:'JetBrains Mono',monospace;">${escapeHtml(options.drawingCode)}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Tỷ lệ:</span> <strong style="font-family:'JetBrains Mono',monospace;">${escapeHtml(scaleText)}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Khổ giấy:</span> <strong>ISO ${escapeHtml(paperLabel)} (${options.orientation === 'landscape' ? 'Ngang' : 'Dọc'})</strong>
          </td>
        </tr>
        <tr>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Kỹ sư:</span> <strong>${escapeHtml(project.author || 'Kỹ sư hệ thống')}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Ngày xuất:</span> <strong style="font-family:'JetBrains Mono',monospace;">${dateStr}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Phiên bản:</span> <strong style="font-family:'JetBrains Mono',monospace;">Tài liệu v${escapeHtml(project.version)} · Phần mềm v${escapeHtml(APP_VERSION)} · Trang ${options.pageNumber}/${options.totalPages}</strong>
          </td>
        </tr>
      </tbody>
    </table>
  `;
}

function createA4DrawingPageElement(
  project: ProjectState,
  metrics: A4ScaleMetrics,
  legendData: GeneratedLegendData,
  options: {
    orientation: A4Orientation;
    paperSize?: PdfPaperSizeUpper;
    includeLegendPanel: boolean;
    drawingCode: string;
    drawingScale: string;
    pageNumber?: number;
    floorLabel?: string;
    totalPages: number;
  }
): HTMLDivElement {
  const paperLabel = options.paperSize || 'A4';
  const pagePxW = mmToPx(metrics.pageWidthMm);
  const pagePxH = mmToPx(metrics.pageHeightMm);
  const margins = metrics.marginsMm || normalizePdfMargins();

  const activeFloor = project.floors.find(f => f.id === project.activeFloorId);
  const floorBadge = options.floorLabel || (activeFloor ? activeFloor.name : 'Toàn bộ tầng');
  const pageNumber = options.pageNumber ?? 1;

  const pageEl = document.createElement('div');
  pageEl.style.width = `${pagePxW}px`;
  pageEl.style.height = `${pagePxH}px`;
  pageEl.style.overflow = 'hidden';
  pageEl.style.padding = `${mmToPx(margins.top)}px ${mmToPx(margins.right)}px ${mmToPx(margins.bottom)}px ${mmToPx(margins.left)}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.background = '#ffffff';
  pageEl.style.color = '#0f172a';
  pageEl.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';

  const flexDirection = options.orientation === 'landscape' ? 'row' : 'column';
  const legendPanelHtml = options.includeLegendPanel
    ? `<div style="${
        options.orientation === 'landscape'
          ? `width:${mmToPx(66)}px;min-height:0;flex-shrink:0;`
          : `width:100%;height:${mmToPx(54)}px;flex-shrink:0;`
      }">${buildLegendHtml(legendData, options.orientation)}</div>`
    : '';

  pageEl.innerHTML = `
    <div style="border:1.5px solid #14213d;flex:1;display:flex;flex-direction:column;padding:8px;box-sizing:border-box;gap:8px;background:#ffffff;min-height:0;">
      <!-- Top Sheet Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #155eef;padding-bottom:5px;flex-shrink:0;">
        <div>
          <div style="font-size:8.5px;font-weight:700;color:#155eef;letter-spacing:0.05em;">BẢN VẼ KỸ THUẬT HẠ TẦNG MẠNG &amp; ĐIỆN</div>
          <div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:1px;">${escapeHtml(project.name)}</div>
        </div>
        <div style="text-align:right;font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;">
          <div>Chế độ: <strong style="color:#0f172a;">${escapeHtml(project.activeMode.toUpperCase())}</strong> · ${escapeHtml(floorBadge)}</div>
          <div>Chuẩn xuất: ISO ${escapeHtml(paperLabel)} ${metrics.pageWidthMm}×${metrics.pageHeightMm}mm · ${escapeHtml(metrics.scaleRatioLabel)}</div>
        </div>
      </div>

      <!-- Canvas Drawing Viewport + Non-overlapping Scale Bar + Optional Legend Panel -->
      <div style="flex:1;display:flex;flex-direction:${flexDirection};gap:10px;min-height:0;align-items:stretch;">
        <div style="flex:1;min-width:0;min-height:0;border:1px solid #cbd5e1;background:#ffffff;display:flex;flex-direction:column;box-sizing:border-box;">
          <div data-pdf-diagram-viewport="true" style="flex:1;min-height:0;width:100%;background:#ffffff;box-sizing:border-box;"></div>
          ${buildScaleBarHtml(metrics, options.drawingScale)}
        </div>
        ${legendPanelHtml}
      </div>

      <!-- Bottom Engineering Title Block -->
      <div style="flex-shrink:0;">
        ${buildTitleBlockHtml(project, metrics, {
          drawingCode: options.drawingCode,
          drawingScale: options.drawingScale,
          orientation: options.orientation,
          paperSize: paperLabel,
          pageNumber,
          totalPages: options.totalPages,
          subtitle: `Sơ đồ ${project.activeMode.toUpperCase()} · ${floorBadge}`
        })}
      </div>
    </div>
  `;

  return pageEl;
}

function createA4AppendixPageElement(
  project: ProjectState,
  metrics: A4ScaleMetrics,
  options: {
    orientation: A4Orientation;
    paperSize?: PdfPaperSizeUpper;
    drawingCode: string;
    drawingScale: string;
    pageNumber: number;
    totalPages: number;
    title: string;
    bodyHtml: string;
  }
): HTMLDivElement {
  const pagePxW = mmToPx(metrics.pageWidthMm);
  const pagePxH = mmToPx(metrics.pageHeightMm);
  const margins = metrics.marginsMm || normalizePdfMargins();

  const pageEl = document.createElement('div');
  pageEl.style.width = `${pagePxW}px`;
  pageEl.style.height = `${pagePxH}px`;
  pageEl.style.overflow = 'hidden';
  pageEl.style.padding = `${mmToPx(margins.top)}px ${mmToPx(margins.right)}px ${mmToPx(margins.bottom)}px ${mmToPx(margins.left)}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.background = '#ffffff';
  pageEl.style.color = '#0f172a';
  pageEl.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';

  pageEl.innerHTML = `
    <div style="border:1.5px solid #14213d;flex:1;display:flex;flex-direction:column;padding:10px;box-sizing:border-box;gap:8px;background:#ffffff;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #155eef;padding-bottom:5px;flex-shrink:0;">
        <div>
          <div style="font-size:8.5px;font-weight:700;color:#155eef;letter-spacing:0.05em;">PHỤ LỤC HỒ SƠ KỸ THUẬT</div>
          <div style="font-size:13px;font-weight:800;color:#0f172a;">${escapeHtml(options.title)}</div>
        </div>
        <div style="font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;">
          ${escapeHtml(project.name)} · Trang ${options.pageNumber}/${options.totalPages}
        </div>
      </div>

      <div style="flex:1;overflow:hidden;">
        ${options.bodyHtml}
      </div>

      <div style="flex-shrink:0;">
        ${buildTitleBlockHtml(project, metrics, {
          drawingCode: options.drawingCode,
          drawingScale: options.drawingScale,
          orientation: options.orientation,
          paperSize: options.paperSize,
          pageNumber: options.pageNumber,
          totalPages: options.totalPages,
          subtitle: options.title
        })}
      </div>
    </div>
  `;

  return pageEl;
}

function buildRackAppendixHtml(project: ProjectState): string {
  const cards = project.racks
    .slice(0, 4)
    .map(rack => {
      const stats = getRackStatistics(rack, project.assets);
      const frontEntries = Object.entries(rack.slots || {})
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .slice(0, 14);
      const rearEntries = Object.entries(rack.rearSlots || {})
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .slice(0, 14);

      const renderRows = (entries: Array<[string, string]>) => {
        if (entries.length === 0) {
          return `<tr><td colspan="2" style="padding:4px;text-align:center;color:#94a3b8;font-size:8.5px;">Trống</td></tr>`;
        }
        return entries
          .map(([uStr, assetId]) => {
            const asset = project.assets[assetId];
            const u = parseInt(uStr, 10);
            const h = asset ? getAssetUHeight(asset) : 1;
            const uLabel = h > 1 ? `U${u}-${u + h - 1}` : `U${u}`;
            return `
              <tr>
                <td style="border:1px solid #cbd5e1;padding:2.5px 5px;font-family:'JetBrains Mono',monospace;font-size:8.5px;width:44px;">${uLabel}</td>
                <td style="border:1px solid #cbd5e1;padding:2.5px 5px;font-size:8.5px;">${escapeHtml(asset?.name || assetId)}</td>
              </tr>
            `;
          })
          .join('');
      };

      return `
        <div style="border:1px solid #cbd5e1;padding:8px;background:#ffffff;box-sizing:border-box;">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:6px;">
            <div>
              <div style="font-size:10px;font-weight:700;color:#0f172a;">${escapeHtml(rack.name)} (${rack.totalUnits}U)</div>
              <div style="font-size:8.5px;color:#475569;">Trước: ${stats.frontUsedUnits}U · Sau: ${stats.rearUsedUnits}U · Trống trước: ${stats.frontFreeUnits}U</div>
            </div>
            <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:8.5px;">
              <div style="font-weight:700;color:#155eef;">${stats.totalPowerWatts} W</div>
              <div style="color:#475569;">${stats.totalWeightKg.toFixed(1)}/${rack.maxLoadKg || 1000} kg</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <div style="font-size:8.5px;font-weight:700;color:#334155;margin-bottom:3px;">Mặt Trước (${frontEntries.length})</div>
              <table style="width:100%;border-collapse:collapse;"><tbody>${renderRows(frontEntries)}</tbody></table>
            </div>
            <div>
              <div style="font-size:8.5px;font-weight:700;color:#334155;margin-bottom:3px;">Mặt Sau (${rearEntries.length})</div>
              <table style="width:100%;border-collapse:collapse;"><tbody>${renderRows(rearEntries)}</tbody></table>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${cards}</div>`;
}

function buildScheduleAppendixHtml(project: ProjectState): string {
  const assets = Object.values(project.assets).slice(0, 22);
  const cables = project.cables.slice(0, 22);

  const assetRows = assets
    .map(a => {
      const rackName = project.racks.find(r => r.id === a.rackId)?.name || '—';
      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-family:'JetBrains Mono',monospace;">${escapeHtml(a.assetTag)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-weight:600;">${escapeHtml(a.name)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(`${a.vendor} ${a.model}`)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-family:'JetBrains Mono',monospace;">${escapeHtml(a.ipAddress || '—')}${a.vlan ? ` (V${escapeHtml(a.vlan)})` : ''}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${a.rackId ? escapeHtml(`${rackName} · U${a.rackUnitStart}`) : '—'}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;text-align:right;font-family:'JetBrains Mono',monospace;">${a.powerWatts || 0}W</td>
        </tr>
      `;
    })
    .join('');

  const cableRows = cables
    .map(c => {
      const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
      const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-family:'JetBrains Mono',monospace;">${escapeHtml(c.cableCode)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(src)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(tgt)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(c.cableType)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;text-align:right;font-family:'JetBrains Mono',monospace;">${escapeHtml(c.bandwidth)} · ${c.lengthMeters || 0}m</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:8.5px;">
      <div>
        <div style="font-size:9.5px;font-weight:700;color:#0f172a;margin-bottom:4px;">1. Danh mục thiết bị (${Object.keys(project.assets).length})</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Mã TS</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Thiết bị</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Model / Hãng</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">IP / VLAN</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Rack / U</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:right;">Công suất</th>
            </tr>
          </thead>
          <tbody>${assetRows}</tbody>
        </table>
      </div>
      ${
        cables.length > 0
          ? `<div>
              <div style="font-size:9.5px;font-weight:700;color:#0f172a;margin-bottom:4px;">2. Danh bạ đấu nối cáp (${project.cables.length})</div>
              <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;">
                <thead>
                  <tr style="background:#f1f5f9;">
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Mã cáp</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Nguồn</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Đích</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Chuẩn cáp</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:right;">Tốc độ / Dài</th>
                  </tr>
                </thead>
                <tbody>${cableRows}</tbody>
              </table>
            </div>`
          : ''
      }
    </div>
  `;
}

function stampDiagramIntoPdfViewport(
  pdf: JsPdfDocument,
  pageEl: HTMLElement,
  viewportSelector: string,
  diagramPngDataUrl: string,
  srcWidth: number,
  srcHeight: number,
  pageWidthMm: number,
  pageHeightMm: number,
  options?: {
    autoFit?: boolean;
    paddingMm?: number;
    targetScaleDenominator?: number;
    pxPerMeter?: number;
  }
): PdfViewportFitResult {
  const pageRect = pageEl.getBoundingClientRect();
  const vpEl = pageEl.querySelector(viewportSelector) as HTMLElement | null;
  const vpRect = vpEl ? vpEl.getBoundingClientRect() : pageRect;

  const boxXmm = ((vpRect.left - pageRect.left) / Math.max(1, pageRect.width)) * pageWidthMm;
  const boxYmm = ((vpRect.top - pageRect.top) / Math.max(1, pageRect.height)) * pageHeightMm;
  const boxWmm = (vpRect.width / Math.max(1, pageRect.width)) * pageWidthMm;
  const boxHmm = (vpRect.height / Math.max(1, pageRect.height)) * pageHeightMm;

  const fit = computePdfViewportFitScale(srcWidth, srcHeight, boxWmm, boxHmm, {
    autoFit: options?.autoFit ?? true,
    paddingMm: options?.paddingMm ?? 2,
    targetScaleDenominator: options?.targetScaleDenominator,
    pxPerMeter: options?.pxPerMeter
  });

  if (fit.clipped && pdf.saveGraphicsState && pdf.rect && pdf.clip && pdf.restoreGraphicsState) {
    pdf.saveGraphicsState();
    pdf.rect(boxXmm, boxYmm, boxWmm, boxHmm, null);
    pdf.clip();
    pdf.addImage(
      diagramPngDataUrl,
      'PNG',
      boxXmm + fit.offsetX,
      boxYmm + fit.offsetY,
      fit.width,
      fit.height,
      undefined,
      'FAST'
    );
    pdf.restoreGraphicsState();
  } else {
    pdf.addImage(
      diagramPngDataUrl,
      'PNG',
      boxXmm + fit.offsetX,
      boxYmm + fit.offsetY,
      fit.width,
      fit.height,
      undefined,
      'FAST'
    );
  }

  return fit;
}

export async function buildA4PdfArtifact(
  project: ProjectState,
  options?: ExportA4PdfOptions
): Promise<A4PdfArtifact> {
  const orientation: A4Orientation = options?.orientation || 'landscape';
  const autoFit = options?.autoFit ?? true;
  const margins = normalizePdfMargins(options?.margins);
  const onProgress = options?.onProgress;
  const includeLegendPanel = options?.includeLegendPanel ?? true;
  const includeRackElevation = options?.includeRackElevation ?? false;
  const includeTables = options?.includeTables ?? false;
  const drawingCode = options?.drawingCode?.trim() || 'NET-ELV-01';
  const drawingScale = options?.drawingScale?.trim() || '';
  const targetScaleDenom = parseDrawingScaleDenominator(drawingScale);
  const legendScope: 'all' | 'activeFloor' =
    options?.legendScope ||
    (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode) ? 'activeFloor' : 'all');

  emitPdfProgress(onProgress, 8, 'Đang tính BoundingBox & lề khổ giấy A4...');

  const floorSheets = resolvePdfFloorSheets(project, options?.floorScope ?? 'active');
  const firstSheetScopeId = floorSheets[0]?.floorScopeId ?? '__ALL__';
  const bounds = computePureDiagramBounds(project, { floorScopeId: firstSheetScopeId });
  const scaleMetrics = computeA4ScaleMetrics(bounds, project.settings.scale, orientation, {
    includeLegendPanel,
    autoFit,
    targetScaleDenominator: targetScaleDenom,
    margins
  });

  const hasRackPage = includeRackElevation && project.racks.length > 0;
  const hasSchedulePage =
    includeTables && (Object.keys(project.assets).length > 0 || project.cables.length > 0);
  const totalPages = floorSheets.length + (hasRackPage ? 1 : 0) + (hasSchedulePage ? 1 : 0);

  if (typeof document === 'undefined') {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
    let pageIdx = 0;
    for (const sheet of floorSheets) {
      if (pageIdx > 0) pdf.addPage('a4', orientation);
      pageIdx++;
      pdf.setFontSize(13);
      pdf.text(`HACHIHI 2D CAD - ${sheet.label}`, 12, 16);
      emitPdfProgress(
        onProgress,
        20 + (pageIdx / Math.max(1, totalPages)) * 65,
        `Đang tạo trang ${pageIdx}/${totalPages}...`,
        pageIdx,
        totalPages
      );
    }
    if (hasRackPage) {
      if (pageIdx > 0) pdf.addPage('a4', orientation);
      pageIdx++;
      pdf.text(`Rack Elevation Appendix (${project.racks.length})`, 12, 16);
    }
    if (hasSchedulePage) {
      if (pageIdx > 0) pdf.addPage('a4', orientation);
      pageIdx++;
      pdf.text(`Schedule Appendix`, 12, 16);
    }
    const safeName =
      (project.name || 'HACHIHI_Network_Design')
        .trim()
        .replace(/[^\p{L}\p{N}_-]+/gu, '_')
        .replace(/^_+|_+$/g, '') || 'HACHIHI_Technical_Drawing';
    const uint8 = new Uint8Array(pdf.output('arraybuffer'));
    emitPdfProgress(onProgress, 100, 'Hoàn tất xuất tệp PDF A4', pageIdx, pageIdx);
    return {
      blob: new Blob([uint8], { type: 'application/pdf' }),
      uint8,
      filename: `${safeName}_A4_Technical.pdf`,
      pageCount: pageIdx,
      scaleMetrics
    };
  }

  type A4PageJob =
    | {
        kind: '2d_diagram';
        element: HTMLDivElement;
        diagramPngDataUrl: string;
        bounds: DiagramBounds;
      }
    | { kind: 'appendix'; element: HTMLDivElement };

  const jobs: A4PageJob[] = [];
  let nextPage = 1;
  for (let sIdx = 0; sIdx < floorSheets.length; sIdx++) {
    const sheet = floorSheets[sIdx];
    emitPdfProgress(
      onProgress,
      15 + ((sIdx + 1) / Math.max(1, floorSheets.length)) * 28,
      `Đang kết xuất sơ đồ SVG (${sheet.label})...`,
      sIdx + 1,
      totalPages
    );
    await yieldForProgressUi(onProgress);
    const sheetBounds = computePureDiagramBounds(project, { floorScopeId: sheet.floorScopeId });
    const sheetMetrics = computeA4ScaleMetrics(sheetBounds, project.settings.scale, orientation, {
      includeLegendPanel,
      autoFit,
      targetScaleDenominator: targetScaleDenom,
      margins
    });
    const pureSvg = sheet.isComposite
      ? generateCompositeBuildingSvgMarkup(project, { darkTheme: false, includeTitleBlock: false })
      : generatePureSvgMarkup(project, {
          darkTheme: false,
          includeTitleBlock: false,
          floorScopeId: sheet.floorScopeId
        });
    const diagramPngDataUrl = await rasterizeSvgMarkupToPng(pureSvg, sheetBounds);
    const sheetProject: ProjectState =
      sheet.floorScopeId !== '__ALL__' && project.floors.some(f => f.id === sheet.floorScopeId)
        ? { ...project, activeFloorId: sheet.floorScopeId }
        : project;
    const sheetLegendData = buildProjectLegendData(sheetProject, {
      scope: sheet.isComposite ? 'all' : legendScope,
      includeCables: true
    });
    jobs.push({
      kind: '2d_diagram',
      diagramPngDataUrl,
      bounds: sheetBounds,
      element: createA4DrawingPageElement(sheetProject, sheetMetrics, sheetLegendData, {
        orientation,
        includeLegendPanel,
        drawingCode,
        drawingScale,
        pageNumber: nextPage++,
        floorLabel: sheet.label,
        totalPages
      })
    });
  }

  if (hasRackPage) {
    jobs.push({
      kind: 'appendix',
      element: createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        drawingCode,
        drawingScale,
        pageNumber: nextPage++,
        totalPages,
        title: `Hồ sơ bố trí Tủ Rack (${project.racks.length} tủ)`,
        bodyHtml: buildRackAppendixHtml(project)
      })
    });
  }
  if (hasSchedulePage) {
    jobs.push({
      kind: 'appendix',
      element: createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        drawingCode,
        drawingScale,
        pageNumber: nextPage++,
        totalPages,
        title: 'Danh mục Thiết bị & Tuyến cáp',
        bodyHtml: buildScheduleAppendixHtml(project)
      })
    });
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ]);

  const stagingRoot = document.createElement('div');
  stagingRoot.style.position = 'fixed';
  stagingRoot.style.left = '-99999px';
  stagingRoot.style.top = '0';
  stagingRoot.style.zIndex = '-1';
  stagingRoot.style.background = '#ffffff';
  stagingRoot.setAttribute('aria-hidden', 'true');
  jobs.forEach(j => stagingRoot.appendChild(j.element));
  document.body.appendChild(stagingRoot);

  try {
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });

    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pixelRatio = options?.pixelRatio ?? 2;
    const pagePxW = mmToPx(scaleMetrics.pageWidthMm);
    const pagePxH = mmToPx(scaleMetrics.pageHeightMm);

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      emitPdfProgress(
        onProgress,
        50 + ((i + 0.5) / Math.max(1, jobs.length)) * 42,
        `Đang render trang PDF ${i + 1}/${jobs.length}...`,
        i + 1,
        jobs.length
      );
      await yieldForProgressUi(onProgress);
      const canvas = await html2canvas(job.element, {
        scale: pixelRatio,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        width: pagePxW,
        height: pagePxH,
        windowWidth: pagePxW,
        windowHeight: pagePxH,
        onclone: clonedDoc => sanitizeClonedDocForHtml2Canvas(clonedDoc)
      });

      const imgData = canvas.toDataURL('image/png');
      if (i > 0) {
        pdf.addPage('a4', orientation);
      }
      pdf.addImage(
        imgData,
        'PNG',
        0,
        0,
        scaleMetrics.pageWidthMm,
        scaleMetrics.pageHeightMm,
        undefined,
        'FAST'
      );

      if (job.kind === '2d_diagram') {
        stampDiagramIntoPdfViewport(
          pdf,
          job.element,
          '[data-pdf-diagram-viewport="true"]',
          job.diagramPngDataUrl,
          job.bounds.width,
          job.bounds.height,
          scaleMetrics.pageWidthMm,
          scaleMetrics.pageHeightMm,
          {
            autoFit,
            paddingMm: 2,
            targetScaleDenominator: targetScaleDenom,
            pxPerMeter: project.settings.scale
          }
        );
      }
    }

    emitPdfProgress(onProgress, 96, 'Đang đóng gói tệp PDF hoàn chỉnh...', jobs.length, jobs.length);
    const safeName = (project.name || 'HACHIHI_Network_Design')
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'HACHIHI_Technical_Drawing';
    const filename = `${safeName}_A4_Technical.pdf`;
    const arrayBuffer = pdf.output('arraybuffer');
    const uint8 = new Uint8Array(arrayBuffer);
    const blob = new Blob([uint8], { type: 'application/pdf' });
    emitPdfProgress(onProgress, 100, `Đã tạo xong ${filename}`, jobs.length, jobs.length);

    return {
      blob,
      uint8,
      filename,
      pageCount: jobs.length,
      scaleMetrics
    };
  } finally {
    stagingRoot.remove();
  }
}

/**
 * Generates and downloads an ISO A4 technical drawing PDF.
 */
export async function exportCanvasToA4Pdf(
  project: ProjectState,
  options?: ExportA4PdfOptions
): Promise<ExportA4PdfResult> {
  const artifact = await buildA4PdfArtifact(project, options);
  const urlApi = window.URL || window.webkitURL;
  const blobUrl = urlApi.createObjectURL(artifact.blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = artifact.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => urlApi.revokeObjectURL(blobUrl), 1500);
  return {
    filename: artifact.filename,
    pageCount: artifact.pageCount,
    scaleMetrics: artifact.scaleMetrics
  };
}

function create3DFramePageElement(
  project: ProjectState,
  capture: Captured3DPageInput,
  metrics: A4ScaleMetrics,
  legendData: GeneratedLegendData,
  options: {
    orientation: A4Orientation;
    paperSize: PdfPaperSizeUpper;
    includeLegendPanel: boolean;
    drawingCode: string;
    drawingScale: string;
    pageNumber: number;
    totalPages: number;
  }
): {
  pageEl: HTMLDivElement;
  imageBoxMm: { x: number; y: number; w: number; h: number };
} {
  const margins = metrics.marginsMm || normalizePdfMargins();
  const headerTotalMm = 14;
  const titleBlockMm = 21;
  const padMm = 2.5;
  const legendReserveW = options.includeLegendPanel && options.orientation === 'landscape' ? 66 : 0;
  const legendReserveH = options.includeLegendPanel && options.orientation === 'portrait' ? 54 : 0;

  const boxXmm = margins.left + padMm;
  const boxYmm = margins.top + padMm + headerTotalMm + 2;
  const boxWmm = Math.max(
    60,
    metrics.pageWidthMm - margins.left - margins.right - padMm * 2 - legendReserveW - (legendReserveW > 0 ? 3 : 0)
  );
  const boxHmm = Math.max(
    60,
    metrics.pageHeightMm -
      margins.top -
      margins.bottom -
      padMm * 2 -
      headerTotalMm -
      titleBlockMm -
      4 -
      legendReserveH -
      (legendReserveH > 0 ? 3 : 0)
  );

  const pagePxW = mmToPx(metrics.pageWidthMm);
  const pagePxH = mmToPx(metrics.pageHeightMm);
  const drawBoxW = mmToPx(boxWmm);
  const drawBoxH = mmToPx(boxHmm);

  const activeFloor = project.floors.find(f => f.id === project.activeFloorId);
  const floorBadge = activeFloor ? activeFloor.name : 'Toàn bộ tầng';

  const pageEl = document.createElement('div');
  pageEl.style.width = `${pagePxW}px`;
  pageEl.style.height = `${pagePxH}px`;
  pageEl.style.overflow = 'hidden';
  pageEl.style.padding = `${mmToPx(margins.top)}px ${mmToPx(margins.right)}px ${mmToPx(margins.bottom)}px ${mmToPx(margins.left)}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.background = '#ffffff';
  pageEl.style.color = '#0f172a';
  pageEl.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';

  const flexDirection = options.orientation === 'landscape' ? 'row' : 'column';
  const legendPanelHtml = options.includeLegendPanel
    ? `<div style="${
        options.orientation === 'landscape'
          ? `width:${mmToPx(66)}px;height:${drawBoxH}px;flex-shrink:0;`
          : `width:100%;height:${mmToPx(54)}px;flex-shrink:0;`
      }">${buildLegendHtml(legendData, options.orientation)}</div>`
    : '';

  const viewBgHex = capture.background === 'dark' ? '#0b1120' : '#ffffff';

  pageEl.innerHTML = `
    <div style="border:1.5px solid #14213d;flex:1;display:flex;flex-direction:column;padding:8px;box-sizing:border-box;gap:8px;background:#ffffff;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #155eef;padding-bottom:5px;flex-shrink:0;">
        <div>
          <div style="font-size:8.5px;font-weight:700;color:#155eef;letter-spacing:0.05em;">MÔ HÌNH KHÔNG GIAN 3D HẠ TẦNG · ${escapeHtml(capture.label.toUpperCase())}</div>
          <div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:1px;">${escapeHtml(project.name)}</div>
        </div>
        <div style="text-align:right;font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;">
          <div>Chế độ: <strong style="color:#0f172a;">3D ${escapeHtml(project.activeMode.toUpperCase())}</strong> · ${escapeHtml(floorBadge)}</div>
          <div>Khổ giấy: ISO ${options.paperSize} (${options.orientation === 'landscape' ? 'Ngang' : 'Dọc'}) · Trang ${options.pageNumber}/${options.totalPages}</div>
        </div>
      </div>

      <div style="flex:1;display:flex;flex-direction:${flexDirection};gap:10px;min-height:0;align-items:stretch;">
        <div style="position:relative;width:${drawBoxW}px;height:${drawBoxH}px;border:1px solid #cbd5e1;background:${viewBgHex};box-sizing:border-box;flex:1;"></div>
        ${legendPanelHtml}
      </div>

      <div style="flex-shrink:0;">
        ${buildTitleBlockHtml(project, metrics, {
          drawingCode: options.drawingCode,
          drawingScale: options.drawingScale || '3D Perspective',
          orientation: options.orientation,
          paperSize: options.paperSize,
          pageNumber: options.pageNumber,
          totalPages: options.totalPages,
          subtitle: `${capture.label} · ${floorBadge}`
        })}
      </div>
    </div>
  `;

  return {
    pageEl,
    imageBoxMm: {
      x: boxXmm,
      y: boxYmm,
      w: boxWmm,
      h: boxHmm
    }
  };
}

/**
 * Builds a unified technical PDF supporting 2D CAD, 3D WebGL snapshots (one or multiple angles),
 * or combined 2D + 3D sheets plus optional Rack elevation and Equipment/Cable schedule appendices.
 */
export async function buildTechnicalPdfArtifact(
  project: ProjectState,
  options?: ExportTechnicalPdfOptions
): Promise<A4PdfArtifact> {
  const contentScope: PdfContentScope = options?.contentScope || '2d';
  const paperSize: PdfPaperSizeUpper = options?.paperSize || 'A4';
  const orientation: A4Orientation = options?.orientation || 'landscape';
  const autoFit = options?.autoFit ?? true;
  const margins = normalizePdfMargins(options?.margins);
  const onProgress = options?.onProgress;
  const includeDiagram = options?.includeDiagram ?? true;
  const includeLegendPanel = options?.includeLegendPanel ?? true;
  const includeRackElevation = options?.includeRackElevation ?? false;
  const includeTables = options?.includeTables ?? false;
  const includeCadPage = Boolean(options?.includeCad && options?.cadDocument);
  const cadDoc = options?.cadDocument ?? null;
  const drawingCode = options?.drawingCode?.trim() || 'NET-ELV-01';
  const drawingScale = options?.drawingScale?.trim() || '';
  const targetScaleDenom = parseDrawingScaleDenominator(drawingScale);
  const captures3D = options?.captures3D || [];

  if ((contentScope === '3d' || contentScope === 'both') && includeDiagram && captures3D.length === 0) {
    throw new Error('Không có ảnh chụp 3D hợp lệ để đưa vào tài liệu PDF.');
  }

  // Fast pure-A4 2D path stays identical when scope is 2D on A4 and no CAD sheet is appended
  if (contentScope === '2d' && paperSize === 'A4' && includeDiagram && !includeCadPage) {
    return buildA4PdfArtifact(project, options);
  }

  emitPdfProgress(onProgress, 10, `Đang tính BoundingBox & lề khổ ${paperSize}...`);

  const include2DPage = includeDiagram && (contentScope === '2d' || contentScope === 'both');
  const floorSheets = include2DPage ? resolvePdfFloorSheets(project, options?.floorScope ?? 'all') : [];
  const primaryFloorScopeId = floorSheets[0]?.floorScopeId ?? '__ALL__';

  const paperDims = getPaperDimensionsMm(paperSize, orientation);
  const bounds = computePureDiagramBounds(project, { floorScopeId: primaryFloorScopeId });
  const scaleMetrics = computeA4ScaleMetrics(bounds, project.settings.scale, orientation, {
    includeLegendPanel,
    paperSize,
    autoFit,
    targetScaleDenominator: targetScaleDenom,
    margins
  });

  const legendScope: 'all' | 'activeFloor' =
    options?.legendScope ||
    (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode) ? 'activeFloor' : 'all');

  const safeName =
    (project.name || 'HACHIHI_Network_Design')
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'HACHIHI_Technical_Drawing';
  const scopeSuffix = contentScope === '3d' ? '3D' : contentScope === 'both' ? '2D_3D' : '2D';
  const cadSuffix = includeCadPage ? '_With_CAD' : '';
  const filename = `${safeName}_${paperSize}_${scopeSuffix}${cadSuffix}_Technical.pdf`;

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: paperDims.format,
    compress: true
  });
  const captures3DToRender = includeDiagram && (contentScope === '3d' || contentScope === 'both') ? captures3D : [];
  const hasRackPage = includeRackElevation && project.racks.length > 0;
  const hasSchedulePage =
    includeTables && (Object.keys(project.assets).length > 0 || project.cables.length > 0);
  const cadSheetCount = includeCadPage ? 1 : 0;

  const totalPages =
    floorSheets.length +
    captures3DToRender.length +
    (hasRackPage ? 1 : 0) +
    (hasSchedulePage ? 1 : 0) +
    cadSheetCount;

  if (totalPages === 0) {
    throw new Error('Vui lòng chọn ít nhất một nội dung (Sơ đồ, Tủ Rack hoặc Bảng thống kê) để xuất PDF.');
  }

  // Headless Node environment fallback (used by automated unit tests verifying binary PDF creation & aspect ratios)
  if (typeof document === 'undefined') {
    let pageIdx = 0;
    for (const sheet of floorSheets) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      pdf.setFontSize(13);
      pdf.text(`HACHIHI 2D CAD - ${safeName} (${sheet.label})`, 12, 16);
    }
    for (const cap of captures3DToRender) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      const fit = fitBoxPreserveAspectRatio(
        cap.width,
        cap.height,
        paperDims.widthMm - 20,
        paperDims.heightMm - 42
      );
      pdf.setFontSize(12);
      pdf.text(`HACHIHI 3D (${cap.preset.toUpperCase()}) - ${safeName}`, 12, 15);
      pdf.addImage(
        cap.dataUrl,
        'PNG',
        10 + fit.offsetX,
        22 + fit.offsetY,
        fit.width,
        fit.height,
        undefined,
        'FAST'
      );
    }
    if (hasRackPage) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      pdf.text(`Rack Elevation Appendix (${project.racks.length})`, 12, 16);
    }
    if (hasSchedulePage) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      pdf.text(`Schedule Appendix`, 12, 16);
    }
    if (includeCadPage && cadDoc) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      const cadFit = computeSmartFitExtents(cadDoc);
      const extInfo = formatCadExtentSummary(cadDoc, cadFit);
      pdf.setFontSize(13);
      pdf.text(`HACHIHI CAD Studio - ${cadDoc.name || 'CAD Drawing'}`, 12, 16);
      pdf.setFontSize(10);
      pdf.text(`Extents: ${extInfo.widthLabel} x ${extInfo.heightLabel} | Auto-Fit: ${autoFit}`, 12, 24);
    }
    const uint8 = new Uint8Array(pdf.output('arraybuffer'));
    emitPdfProgress(onProgress, 100, `Đã tạo xong ${filename}`, pageIdx, pageIdx);
    return {
      blob: new Blob([uint8], { type: 'application/pdf' }),
      uint8,
      filename,
      pageCount: pageIdx,
      scaleMetrics
    };
  }

  const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
  const legendData = buildProjectLegendData(project, {
    scope: legendScope,
    includeCables: true
  });

  type RenderJob =
    | { kind: 'dom'; element: HTMLDivElement }
    | {
        kind: '2d_diagram';
        element: HTMLDivElement;
        diagramPngDataUrl: string;
        bounds: DiagramBounds;
      }
    | {
        kind: '3d_frame';
        element: HTMLDivElement;
        capture: Captured3DPageInput;
        imageBoxMm: { x: number; y: number; w: number; h: number };
      }
    | {
        kind: 'cad_sheet';
        element: HTMLDivElement;
        diagramPngDataUrl: string;
        srcW: number;
        srcH: number;
        cadPxPerMeter: number;
      };

  const jobs: RenderJob[] = [];
  let pageCursor = 1;

  for (let sIdx = 0; sIdx < floorSheets.length; sIdx++) {
    const sheet = floorSheets[sIdx];
    emitPdfProgress(
      onProgress,
      14 + ((sIdx + 1) / Math.max(1, floorSheets.length)) * 24,
      `Đang kết xuất sơ đồ 2D (${sheet.label})...`,
      sIdx + 1,
      totalPages
    );
    await yieldForProgressUi(onProgress);
    const sheetBounds = computePureDiagramBounds(project, { floorScopeId: sheet.floorScopeId });
    const sheetMetrics = computeA4ScaleMetrics(sheetBounds, project.settings.scale, orientation, {
      includeLegendPanel,
      paperSize,
      autoFit,
      targetScaleDenominator: targetScaleDenom,
      margins
    });
    const pureSvg = sheet.isComposite
      ? generateCompositeBuildingSvgMarkup(project, { darkTheme: false, includeTitleBlock: false })
      : generatePureSvgMarkup(project, {
          darkTheme: false,
          includeTitleBlock: false,
          floorScopeId: sheet.floorScopeId
        });
    const diagramPngDataUrl = await rasterizeSvgMarkupToPng(pureSvg, sheetBounds);
    const sheetProject: ProjectState =
      sheet.floorScopeId !== '__ALL__' && project.floors.some(f => f.id === sheet.floorScopeId)
        ? { ...project, activeFloorId: sheet.floorScopeId }
        : project;
    const sheetLegendData = buildProjectLegendData(sheetProject, {
      scope: sheet.isComposite ? 'all' : legendScope,
      includeCables: true
    });
    const el2d = createA4DrawingPageElement(sheetProject, sheetMetrics, sheetLegendData, {
      orientation,
      paperSize,
      includeLegendPanel,
      drawingCode,
      drawingScale,
      pageNumber: pageCursor++,
      floorLabel: sheet.label,
      totalPages
    });
    jobs.push({
      kind: '2d_diagram',
      element: el2d,
      diagramPngDataUrl,
      bounds: sheetBounds
    });
  }

  for (const cap of captures3DToRender) {
    const { pageEl, imageBoxMm } = create3DFramePageElement(project, cap, scaleMetrics, legendData, {
      orientation,
      paperSize,
      includeLegendPanel,
      drawingCode,
      drawingScale,
      pageNumber: pageCursor++,
      totalPages
    });
    jobs.push({ kind: '3d_frame', element: pageEl, capture: cap, imageBoxMm });
  }

  if (hasRackPage) {
    jobs.push({
      kind: 'dom',
      element: createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        paperSize,
        drawingCode,
        drawingScale,
        pageNumber: pageCursor++,
        totalPages,
        title: `Hồ sơ bố trí Tủ Rack (${project.racks.length} tủ)`,
        bodyHtml: buildRackAppendixHtml(project)
      })
    });
  }

  if (hasSchedulePage) {
    jobs.push({
      kind: 'dom',
      element: createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        paperSize,
        drawingCode,
        drawingScale,
        pageNumber: pageCursor++,
        totalPages,
        title: 'Danh mục Thiết bị & Tuyến cáp',
        bodyHtml: buildScheduleAppendixHtml(project)
      })
    });
  }

  if (includeCadPage && cadDoc) {
    emitPdfProgress(
      onProgress,
      42,
      `Đang xử lý bản vẽ CAD Studio (${cadDoc.entities.length.toLocaleString('vi-VN')} thực thể)...`
    );
    await yieldForProgressUi(onProgress);
    const cadFit = computeSmartFitExtents(cadDoc);
    const spanX = Math.max(1e-3, cadFit.maxX - cadFit.minX);
    const spanY = Math.max(1e-3, cadFit.maxY - cadFit.minY);
    const aspect = spanX / spanY;
    const svgW = aspect >= 1 ? 2400 : Math.max(720, Math.round(2400 * aspect));
    const svgH = aspect >= 1 ? Math.max(720, Math.round(2400 / aspect)) : 2400;
    const svgPad = Math.max(36, Math.round(Math.min(svgW, svgH) * 0.035));
    const cadSvg = renderCADDocumentToSvg(cadDoc, {
      width: svgW,
      height: svgH,
      lightBackground: true,
      extents: cadFit,
      padding: svgPad,
      maxEntities: 150000,
      vectorEffectNonScalingStroke: true
    });
    const cadPng = await rasterizeSvgMarkupToPng(
      cadSvg,
      { minX: 0, minY: 0, width: svgW, height: svgH },
      '#f8fafc'
    );
    const cadMetersX = convertCADDistanceToMeters(spanX, cadDoc.header.$INSUNITS);
    const cadDenom = Math.max(1, Math.round((cadMetersX * 1000) / Math.max(50, paperDims.widthMm - margins.left - margins.right - 8)));
    const cadScaleText = autoFit
      ? `1 : ${cadDenom} (Auto-Fit ${paperSize})`
      : drawingScale || `1 : ${cadDenom}`;
    const cadPxPerMeter = Math.max(1, svgW - svgPad * 2) / Math.max(1e-4, cadMetersX);
    const cadPageEl = createCadPdfPageElement(cadDoc, cadFit, {
      paperSize,
      orientation,
      lightBackground: true,
      drawingCode: `${drawingCode}-CAD`,
      drawingScale: cadScaleText,
      pageWidthMm: paperDims.widthMm,
      pageHeightMm: paperDims.heightMm,
      margins,
      pageNumber: pageCursor++,
      totalPages
    });
    jobs.push({
      kind: 'cad_sheet',
      element: cadPageEl,
      diagramPngDataUrl: cadPng,
      srcW: svgW,
      srcH: svgH,
      cadPxPerMeter
    });
  }

  const stagingRoot = document.createElement('div');
  stagingRoot.style.position = 'fixed';
  stagingRoot.style.left = '-99999px';
  stagingRoot.style.top = '0';
  stagingRoot.style.zIndex = '-1';
  stagingRoot.style.background = '#ffffff';
  stagingRoot.setAttribute('aria-hidden', 'true');
  jobs.forEach(j => stagingRoot.appendChild(j.element));
  document.body.appendChild(stagingRoot);

  try {
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });

    const pixelRatio = options?.pixelRatio ?? 2;
    const pagePxW = mmToPx(scaleMetrics.pageWidthMm);
    const pagePxH = mmToPx(scaleMetrics.pageHeightMm);

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      emitPdfProgress(
        onProgress,
        48 + ((i + 0.5) / Math.max(1, jobs.length)) * 44,
        `Đang render trang PDF ${i + 1}/${jobs.length}...`,
        i + 1,
        jobs.length
      );
      await yieldForProgressUi(onProgress);
      const canvas = await html2canvas(job.element, {
        scale: pixelRatio,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        width: pagePxW,
        height: pagePxH,
        windowWidth: pagePxW,
        windowHeight: pagePxH,
        onclone: clonedDoc => sanitizeClonedDocForHtml2Canvas(clonedDoc)
      });

      const frameData = canvas.toDataURL('image/png');
      if (i > 0) {
        pdf.addPage(paperDims.format, orientation);
      }
      pdf.addImage(
        frameData,
        'PNG',
        0,
        0,
        scaleMetrics.pageWidthMm,
        scaleMetrics.pageHeightMm,
        undefined,
        'FAST'
      );

      if (job.kind === '2d_diagram') {
        stampDiagramIntoPdfViewport(
          pdf,
          job.element,
          '[data-pdf-diagram-viewport="true"]',
          job.diagramPngDataUrl,
          job.bounds.width,
          job.bounds.height,
          scaleMetrics.pageWidthMm,
          scaleMetrics.pageHeightMm,
          {
            autoFit,
            paddingMm: 2,
            targetScaleDenominator: targetScaleDenom,
            pxPerMeter: project.settings.scale
          }
        );
      } else if (job.kind === '3d_frame') {
        const fit = computePdfViewportFitScale(
          job.capture.width,
          job.capture.height,
          job.imageBoxMm.w,
          job.imageBoxMm.h,
          { autoFit: true, paddingMm: 1 }
        );
        pdf.addImage(
          job.capture.dataUrl,
          'PNG',
          job.imageBoxMm.x + fit.offsetX,
          job.imageBoxMm.y + fit.offsetY,
          fit.width,
          fit.height,
          undefined,
          'FAST'
        );
      } else if (job.kind === 'cad_sheet') {
        stampDiagramIntoPdfViewport(
          pdf,
          job.element,
          '[data-cad-pdf-viewport="true"]',
          job.diagramPngDataUrl,
          job.srcW,
          job.srcH,
          paperDims.widthMm,
          paperDims.heightMm,
          {
            autoFit,
            paddingMm: 1.5,
            targetScaleDenominator: targetScaleDenom,
            pxPerMeter: job.cadPxPerMeter
          }
        );
      }
    }

    emitPdfProgress(onProgress, 96, 'Đang tạo tệp PDF hoàn chỉnh...', jobs.length, jobs.length);
    const arrayBuffer = pdf.output('arraybuffer');
    const uint8 = new Uint8Array(arrayBuffer);
    const blob = new Blob([uint8], { type: 'application/pdf' });
    emitPdfProgress(onProgress, 100, `Đã tạo xong ${filename}`, jobs.length, jobs.length);

    return {
      blob,
      uint8,
      filename,
      pageCount: jobs.length,
      scaleMetrics
    };
  } finally {
    stagingRoot.remove();
  }
}

export async function exportTechnicalPdf(
  project: ProjectState,
  options?: ExportTechnicalPdfOptions
): Promise<ExportA4PdfResult> {
  const artifact = await buildTechnicalPdfArtifact(project, options);
  const urlApi = window.URL || window.webkitURL;
  const blobUrl = urlApi.createObjectURL(artifact.blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = artifact.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => urlApi.revokeObjectURL(blobUrl), 1500);
  return {
    filename: artifact.filename,
    pageCount: artifact.pageCount,
    scaleMetrics: artifact.scaleMetrics
  };
}

export interface ExportCadPdfOptions {
  paperSize?: PdfPaperSizeUpper;
  orientation?: A4Orientation | 'auto';
  autoFit?: boolean;
  margins?: Partial<PdfMarginsMm>;
  lightBackground?: boolean;
  drawingCode?: string;
  drawingScale?: string;
  pixelRatio?: number;
  onProgress?: PdfExportProgressCallback;
}

export interface CadPdfArtifact {
  blob: Blob;
  uint8: Uint8Array;
  filename: string;
  pageCount: number;
  paperSize: PdfPaperSizeUpper;
  orientation: A4Orientation;
}

function formatCadExtentSummary(
  doc: CADDocument,
  extents: BoundingBox2D
): {
  unitLabel: string;
  widthLabel: string;
  heightLabel: string;
  approxScaleLabel: string;
} {
  const unitMeta = getCADUnitMeta(doc.header.$INSUNITS);
  const spanX = Math.max(1e-3, extents.maxX - extents.minX);
  const spanY = Math.max(1e-3, extents.maxY - extents.minY);
  const metersX = convertCADDistanceToMeters(spanX, doc.header.$INSUNITS);
  const metersY = convertCADDistanceToMeters(spanY, doc.header.$INSUNITS);
  const fmtDim = (v: number, m: number) =>
    doc.header.$INSUNITS === 6 || doc.header.$INSUNITS === 0
      ? `${v.toFixed(1)} ${unitMeta.shortLabel}`
      : `${v.toFixed(0)} ${unitMeta.shortLabel} (${m.toFixed(2)}m)`;

  return {
    unitLabel: `${unitMeta.shortLabel} — ${unitMeta.labelVi}`,
    widthLabel: fmtDim(spanX, metersX),
    heightLabel: fmtDim(spanY, metersY),
    approxScaleLabel: `${metersX.toFixed(1)}m × ${metersY.toFixed(1)}m`
  };
}

function createCadPdfPageElement(
  doc: CADDocument,
  fitExtents: BoundingBox2D,
  options: {
    paperSize: PdfPaperSizeUpper;
    orientation: A4Orientation;
    lightBackground: boolean;
    drawingCode: string;
    drawingScale: string;
    pageWidthMm: number;
    pageHeightMm: number;
    margins?: PdfMarginsMm;
    pageNumber?: number;
    totalPages?: number;
  }
): HTMLDivElement {
  const pagePxW = mmToPx(options.pageWidthMm);
  const pagePxH = mmToPx(options.pageHeightMm);
  const margins = options.margins || normalizePdfMargins({ top: 7, right: 7, bottom: 7, left: 7 });
  const pageEl = document.createElement('div');
  pageEl.style.width = `${pagePxW}px`;
  pageEl.style.height = `${pagePxH}px`;
  pageEl.style.overflow = 'hidden';
  pageEl.style.background = '#ffffff';
  pageEl.style.padding = `${mmToPx(margins.top)}px ${mmToPx(margins.right)}px ${mmToPx(margins.bottom)}px ${mmToPx(margins.left)}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';
  pageEl.style.color = '#0f172a';

  const extInfo = formatCadExtentSummary(doc, fitExtents);
  const layerList = Object.values(doc.layers);
  const visibleLayers = layerList.filter(l => l.visible && !l.frozen).length;
  const exportDate = new Date().toLocaleDateString('vi-VN');
  const bgSurface = options.lightBackground ? '#f8fafc' : '#0b111e';
  const blockCount = Object.keys(doc.blocks).filter(
    name => !name.startsWith('*Model_Space') && !name.startsWith('*Paper_Space')
  ).length;
  const pageNumber = options.pageNumber ?? 1;
  const totalPages = options.totalPages ?? 1;

  pageEl.innerHTML = `
    <div style="border:1.5px solid #14213d;flex:1;display:flex;flex-direction:column;padding:8px;box-sizing:border-box;gap:8px;background:#ffffff;min-height:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #155eef;padding-bottom:5px;flex-shrink:0;">
        <div>
          <div style="font-size:8.5px;font-weight:700;color:#155eef;letter-spacing:0.06em;">BẢN VẼ KỸ THUẬT CAD VECTOR · ${escapeHtml(doc.metadata.acadVersion.split(' ')[0])}</div>
          <div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:1px;">${escapeHtml(doc.name || 'HACHIHI CAD Drawing')}</div>
        </div>
        <div style="text-align:right;font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;">
          <div>Phạm vi thực: <strong style="color:#0f172a;">${escapeHtml(extInfo.approxScaleLabel)}</strong> · Đơn vị: ${escapeHtml(getCADUnitMeta(doc.header.$INSUNITS).shortLabel)}</div>
          <div>Khổ giấy: ISO ${options.paperSize} (${options.orientation === 'landscape' ? 'Ngang' : 'Dọc'}) · Trang ${pageNumber}/${totalPages}</div>
        </div>
      </div>

      <div data-cad-pdf-viewport="true" style="flex:1;min-height:0;border:1px solid #cbd5e1;background:${bgSurface};box-sizing:border-box;"></div>

      <div style="border:1.5px solid #14213d;display:grid;grid-template-columns:1.5fr 2fr 1.6fr 1.2fr;background:#ffffff;font-size:9px;color:#0f172a;flex-shrink:0;">
        <div style="border-right:1px solid #14213d;padding:5px 7px;display:flex;align-items:center;gap:6px;">
          <div style="flex-shrink:0;">${getHachihiLogoSvgMarkup(22)}</div>
          <div>
            <div style="font-size:9px;font-weight:800;letter-spacing:0.05em;color:#14213d;">HACHIHI</div>
            <div style="font-size:7.5px;font-weight:600;color:#64748b;text-transform:uppercase;">CAD Studio Engineering</div>
            <div style="font-size:7px;color:#475569;font-family:'JetBrains Mono',monospace;">v${escapeHtml(APP_VERSION)} · #${escapeHtml(APP_BUILD_HASH)}</div>
          </div>
        </div>
        <div style="border-right:1px solid #14213d;padding:5px 8px;">
          <div style="font-size:7.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Tên tệp / Bản vẽ CAD</div>
          <div style="font-size:10.5px;font-weight:800;color:#0f172a;margin:2px 0;">${escapeHtml(doc.name || 'HACHIHI CAD')}</div>
          <div style="font-size:8px;color:#475569;">
            Kích thước W×H: <strong>${escapeHtml(extInfo.widthLabel)}</strong> × <strong>${escapeHtml(extInfo.heightLabel)}</strong>
          </div>
        </div>
        <div style="border-right:1px solid #14213d;padding:5px 8px;">
          <div style="font-size:7.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Thông số DXF / Layer</div>
          <div style="font-size:8px;color:#0f172a;margin-top:2px;">
            Đối tượng: <strong>${doc.entities.length.toLocaleString('vi-VN')}</strong> · Block: <strong>${blockCount}</strong>
          </div>
          <div style="font-size:8px;color:#475569;margin-top:1px;">
            Layer hiển thị: <strong>${visibleLayers}/${layerList.length}</strong> · $INSUNITS: ${doc.header.$INSUNITS}
          </div>
        </div>
        <div style="padding:5px 8px;font-family:'JetBrains Mono',monospace;">
          <div style="display:flex;justify-content:space-between;font-size:8px;">
            <span style="color:#64748b;">Mã BV:</span>
            <strong>${escapeHtml(options.drawingCode)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:8px;margin-top:1px;">
            <span style="color:#64748b;">Tỷ lệ:</span>
            <strong>${escapeHtml(options.drawingScale)}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:8px;margin-top:1px;">
            <span style="color:#64748b;">Khổ / Ngày:</span>
            <strong>${options.paperSize} · ${exportDate}</strong>
          </div>
        </div>
      </div>
    </div>
  `;

  return pageEl;
}

/**
 * Generates an ISO A3 or A4 print-ready PDF artifact directly from a CADDocument,
 * automatically fitting & centering the full visible CAD drawing cleanly onto the page.
 */
export async function buildCadDocumentPdfArtifact(
  doc: CADDocument,
  options?: ExportCadPdfOptions
): Promise<CadPdfArtifact> {
  const paperSize: PdfPaperSizeUpper = options?.paperSize || 'A4';
  const autoFit = options?.autoFit ?? true;
  const margins = normalizePdfMargins(options?.margins, { top: 7, right: 7, bottom: 7, left: 7 });
  const onProgress = options?.onProgress;

  emitPdfProgress(
    onProgress,
    10,
    `Đang tính BoundingBox CAD (${doc.entities.length.toLocaleString('vi-VN')} thực thể)...`
  );
  await yieldForProgressUi(onProgress);

  const fitExtents = computeSmartFitExtents(doc);
  const extSpanX = Math.max(1e-3, fitExtents.maxX - fitExtents.minX);
  const extSpanY = Math.max(1e-3, fitExtents.maxY - fitExtents.minY);

  const orientation: A4Orientation =
    options?.orientation === 'landscape' || options?.orientation === 'portrait'
      ? options.orientation
      : extSpanY > extSpanX * 1.15
      ? 'portrait'
      : 'landscape';

  const lightBackground = options?.lightBackground ?? true;
  const drawingCode = options?.drawingCode?.trim() || 'CAD-ELV-01';
  const paperDims = getPaperDimensionsMm(paperSize, orientation);

  const metersX = convertCADDistanceToMeters(extSpanX, doc.header.$INSUNITS);
  const availWmm = Math.max(50, paperDims.widthMm - margins.left - margins.right - 8);
  const autoScaleDenom = Math.max(1, Math.round((metersX * 1000) / availWmm));
  const drawingScale =
    options?.drawingScale?.trim() ||
    (autoFit ? `1 : ${autoScaleDenom} (Auto-Fit ${paperSize})` : `1 : ${autoScaleDenom}`);

  const safeName =
    (doc.name || 'hachihi_cad')
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'hachihi_cad';
  const filename = `${safeName}_${paperSize}.pdf`;

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: paperDims.format,
    compress: true
  });

  // Headless Node environment fallback (for automated tests without DOM/Canvas)
  if (typeof document === 'undefined') {
    const extInfo = formatCadExtentSummary(doc, fitExtents);
    pdf.setFontSize(13);
    pdf.text(`HACHIHI CAD Drawing (${paperSize}) - ${safeName}`, 12, 16);
    pdf.setFontSize(10);
    pdf.text(`Version: ${doc.metadata.acadVersion} | Units: ${extInfo.unitLabel}`, 12, 24);
    pdf.text(
      `Extents: ${extInfo.widthLabel} x ${extInfo.heightLabel} | Entities: ${doc.entities.length}`,
      12,
      31
    );
    const uint8 = new Uint8Array(pdf.output('arraybuffer'));
    emitPdfProgress(onProgress, 100, `Đã tạo xong ${filename}`, 1, 1);
    return {
      blob: new Blob([uint8], { type: 'application/pdf' }),
      uint8,
      filename,
      pageCount: 1,
      paperSize,
      orientation
    };
  }

  emitPdfProgress(onProgress, 26, `Đang kết xuất hình vector CAD (${paperSize})...`, 1, 1);
  await yieldForProgressUi(onProgress);

  const aspect = extSpanX / extSpanY;
  const svgW = aspect >= 1 ? 2400 : Math.max(720, Math.round(2400 * aspect));
  const svgH = aspect >= 1 ? Math.max(720, Math.round(2400 / aspect)) : 2400;
  const svgPad = Math.max(36, Math.round(Math.min(svgW, svgH) * 0.035));
  const svgMarkup = renderCADDocumentToSvg(doc, {
    width: svgW,
    height: svgH,
    lightBackground,
    extents: fitExtents,
    padding: svgPad,
    maxEntities: 150000,
    vectorEffectNonScalingStroke: true
  });

  emitPdfProgress(onProgress, 48, 'Đang chuyển đổi CAD SVG sang ảnh độ nét cao...', 1, 1);
  await yieldForProgressUi(onProgress);

  const bgSurface = lightBackground ? '#f8fafc' : '#0b111e';
  const diagramPngDataUrl = await rasterizeSvgMarkupToPng(
    svgMarkup,
    {
      minX: 0,
      minY: 0,
      width: svgW,
      height: svgH
    },
    bgSurface
  );

  emitPdfProgress(onProgress, 68, `Đang dựng khung trang ${paperSize} & lề giấy...`, 1, 1);
  await yieldForProgressUi(onProgress);

  const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
  const pageEl = createCadPdfPageElement(doc, fitExtents, {
    paperSize,
    orientation,
    lightBackground,
    drawingCode,
    drawingScale,
    pageWidthMm: paperDims.widthMm,
    pageHeightMm: paperDims.heightMm,
    margins
  });

  const stagingRoot = document.createElement('div');
  stagingRoot.style.position = 'fixed';
  stagingRoot.style.left = '-99999px';
  stagingRoot.style.top = '0';
  stagingRoot.style.zIndex = '-1';
  stagingRoot.style.background = '#ffffff';
  stagingRoot.setAttribute('aria-hidden', 'true');
  stagingRoot.appendChild(pageEl);
  document.body.appendChild(stagingRoot);

  try {
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });

    const pixelRatio = options?.pixelRatio ?? 2;
    const pagePxW = mmToPx(paperDims.widthMm);
    const pagePxH = mmToPx(paperDims.heightMm);

    const canvas = await html2canvas(pageEl, {
      scale: pixelRatio,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      width: pagePxW,
      height: pagePxH,
      windowWidth: pagePxW,
      windowHeight: pagePxH,
      onclone: clonedDoc => sanitizeClonedDocForHtml2Canvas(clonedDoc)
    });

    emitPdfProgress(onProgress, 86, 'Đang áp dụng tỷ lệ Viewport & đóng gói PDF...', 1, 1);
    await yieldForProgressUi(onProgress);

    const frameData = canvas.toDataURL('image/png');
    pdf.addImage(frameData, 'PNG', 0, 0, paperDims.widthMm, paperDims.heightMm, undefined, 'FAST');

    const svgContentW = Math.max(1, svgW - svgPad * 2);
    const cadPxPerMeter = svgContentW / Math.max(1e-4, metersX);
    stampDiagramIntoPdfViewport(
      pdf,
      pageEl,
      '[data-cad-pdf-viewport="true"]',
      diagramPngDataUrl,
      svgW,
      svgH,
      paperDims.widthMm,
      paperDims.heightMm,
      {
        autoFit,
        paddingMm: 1.5,
        targetScaleDenominator: parseDrawingScaleDenominator(options?.drawingScale),
        pxPerMeter: cadPxPerMeter
      }
    );

    const uint8 = new Uint8Array(pdf.output('arraybuffer'));
    emitPdfProgress(onProgress, 100, `Đã tạo xong ${filename}`, 1, 1);
    return {
      blob: new Blob([uint8], { type: 'application/pdf' }),
      uint8,
      filename,
      pageCount: 1,
      paperSize,
      orientation
    };
  } finally {
    stagingRoot.remove();
  }
}

export async function exportCadDocumentToPdf(
  doc: CADDocument,
  options?: ExportCadPdfOptions
): Promise<CadPdfArtifact> {
  const artifact = await buildCadDocumentPdfArtifact(doc, options);
  const urlApi = window.URL || window.webkitURL;
  const blobUrl = urlApi.createObjectURL(artifact.blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = artifact.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => urlApi.revokeObjectURL(blobUrl), 1500);
  return artifact;
}

