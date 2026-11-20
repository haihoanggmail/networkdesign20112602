import { DiagramBounds } from './svgExport';
import { normalizeScalePxPerMeter } from './scaleUtils';

export type A4Orientation = 'landscape' | 'portrait';
export type PdfPaperSizeUpper = 'A4' | 'A3' | 'A2' | 'A1';

export interface PdfMarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_PDF_MARGINS_MM: PdfMarginsMm = {
  top: 8,
  right: 8,
  bottom: 8,
  left: 8
};

export function normalizePdfMargins(
  margins?: Partial<PdfMarginsMm>,
  fallback: PdfMarginsMm = DEFAULT_PDF_MARGINS_MM
): PdfMarginsMm {
  const clamp = (val: unknown, fb: number) => {
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return fb;
    return Math.round(Math.max(0, Math.min(40, n)) * 10) / 10;
  };
  return {
    top: clamp(margins?.top, fallback.top),
    right: clamp(margins?.right, fallback.right),
    bottom: clamp(margins?.bottom, fallback.bottom),
    left: clamp(margins?.left, fallback.left)
  };
}

export interface A4ScaleBarSpec {
  totalMeters: number;
  segmentMeters: number;
  segments: number;
  barWidthMm: number;
  ticks: number[];
}

export interface PdfViewportFitOptions {
  autoFit?: boolean;
  paddingMm?: number;
  targetScaleDenominator?: number;
  pxPerMeter?: number;
}

export interface PdfViewportFitResult {
  scale: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  clipped: boolean;
}

/**
 * Computes the exact scaled dimensions & centered offsets to fit a drawing
 * into a PDF viewport box without cropping top, bottom, left, or right edges.
 */
export function computePdfViewportFitScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidthMm: number,
  viewportHeightMm: number,
  options?: PdfViewportFitOptions
): PdfViewportFitResult {
  const autoFit = options?.autoFit ?? true;
  const paddingMm = Math.max(0, options?.paddingMm ?? 2);
  const safeContentW = Math.max(1e-3, contentWidth);
  const safeContentH = Math.max(1e-3, contentHeight);
  const safeVpW = Math.max(10, viewportWidthMm);
  const safeVpH = Math.max(10, viewportHeightMm);
  const availW = Math.max(4, safeVpW - paddingMm * 2);
  const availH = Math.max(4, safeVpH - paddingMm * 2);

  const fitScale = Math.min(availW / safeContentW, availH / safeContentH);
  let appliedScale = fitScale;

  if (!autoFit && options?.targetScaleDenominator && options.targetScaleDenominator > 0) {
    const pxPerMeter = normalizeScalePxPerMeter(options.pxPerMeter);
    const mmPerMeter = 1000 / options.targetScaleDenominator;
    const requestedScale = mmPerMeter / pxPerMeter;
    if (Number.isFinite(requestedScale) && requestedScale > 0) {
      appliedScale = requestedScale;
    }
  }

  const width = Number((safeContentW * appliedScale).toFixed(2));
  const height = Number((safeContentH * appliedScale).toFixed(2));
  const offsetX = Number(((safeVpW - width) / 2).toFixed(2));
  const offsetY = Number(((safeVpH - height) / 2).toFixed(2));
  const clipped = width > safeVpW + 0.05 || height > safeVpH + 0.05;

  return {
    scale: appliedScale,
    width,
    height,
    offsetX,
    offsetY,
    clipped
  };
}

export interface A4ScaleMetrics {
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  marginsMm: PdfMarginsMm;
  drawAreaWidthMm: number;
  drawAreaHeightMm: number;
  renderedDrawWidthMm: number;
  renderedDrawHeightMm: number;
  mmPerWorldPx: number;
  pxPerMeter: number;
  printedMmPerMeter: number;
  realWorldWidthMeters: number;
  realWorldHeightMeters: number;
  engineeringRatioDenominator: number;
  scaleRatioLabel: string;
  autoFitApplied: boolean;
  scaleBar: A4ScaleBarSpec;
}

export function getPaperDimensionsMm(
  paperSize: PdfPaperSizeUpper,
  orientation: A4Orientation
): { widthMm: number; heightMm: number; format: 'a4' | 'a3' | 'a2' | 'a1' } {
  const baseMap: Record<PdfPaperSizeUpper, { short: number; long: number; format: 'a4' | 'a3' | 'a2' | 'a1' }> = {
    A4: { short: 210, long: 297, format: 'a4' },
    A3: { short: 297, long: 420, format: 'a3' },
    A2: { short: 420, long: 594, format: 'a2' },
    A1: { short: 594, long: 841, format: 'a1' }
  };
  const spec = baseMap[paperSize] || baseMap.A4;
  return orientation === 'landscape'
    ? { widthMm: spec.long, heightMm: spec.short, format: spec.format }
    : { widthMm: spec.short, heightMm: spec.long, format: spec.format };
}

/**
 * Pure scale calculator for ISO A4-A1 technical drawings.
 * Maintains exact 1:1 world aspect ratio and computes physical mm-per-meter
 * plus a calibrated metric scale bar for the target sheet.
 */
export function computeA4ScaleMetrics(
  bounds: DiagramBounds,
  pxPerMeterRaw: number | undefined,
  orientation: A4Orientation = 'landscape',
  options?: {
    includeLegendPanel?: boolean;
    paperSize?: PdfPaperSizeUpper;
    autoFit?: boolean;
    targetScaleDenominator?: number;
    margins?: Partial<PdfMarginsMm>;
  }
): A4ScaleMetrics {
  const dims = getPaperDimensionsMm(options?.paperSize || 'A4', orientation);
  const pageWidthMm = dims.widthMm;
  const pageHeightMm = dims.heightMm;
  const marginsMm = normalizePdfMargins(options?.margins);
  const marginMm = Number(
    ((marginsMm.top + marginsMm.right + marginsMm.bottom + marginsMm.left) / 4).toFixed(2)
  );
  const framePaddingMm = 5;
  const headerHeightMm = 15;
  const scaleStripHeightMm = 9;
  const titleBlockHeightMm = 23;
  const includeLegendPanel = options?.includeLegendPanel ?? true;
  const autoFit = options?.autoFit ?? true;

  const contentW = Math.max(60, pageWidthMm - marginsMm.left - marginsMm.right - framePaddingMm);
  const contentH = Math.max(
    60,
    pageHeightMm -
      marginsMm.top -
      marginsMm.bottom -
      framePaddingMm -
      headerHeightMm -
      scaleStripHeightMm -
      titleBlockHeightMm
  );

  const legendReserveW = includeLegendPanel && orientation === 'landscape' ? 66 : 0;
  const legendReserveH = includeLegendPanel && orientation === 'portrait' ? 54 : 0;

  const drawAreaWidthMm = Math.max(60, contentW - legendReserveW - (legendReserveW > 0 ? 3 : 0));
  const drawAreaHeightMm = Math.max(60, contentH - legendReserveH - (legendReserveH > 0 ? 3 : 0));

  const safeW = Math.max(100, bounds.width);
  const safeH = Math.max(100, bounds.height);
  const pxPerMeter = normalizeScalePxPerMeter(pxPerMeterRaw);

  const fit = computePdfViewportFitScale(safeW, safeH, drawAreaWidthMm, drawAreaHeightMm, {
    autoFit,
    paddingMm: 2,
    targetScaleDenominator: options?.targetScaleDenominator,
    pxPerMeter
  });

  const mmPerWorldPx = fit.scale;
  const renderedDrawWidthMm = fit.width;
  const renderedDrawHeightMm = fit.height;

  const printedMmPerMeter = mmPerWorldPx * pxPerMeter;
  const realWorldWidthMeters = Number((safeW / pxPerMeter).toFixed(2));
  const realWorldHeightMeters = Number((safeH / pxPerMeter).toFixed(2));

  const engineeringRatioDenominator = Math.max(1, Math.round(1000 / Math.max(0.05, printedMmPerMeter)));
  const scaleRatioLabel = `1:${engineeringRatioDenominator}`;

  const candidateTotals = [0.5, 1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 500];
  let chosenTotal = 5;
  let bestDist = Infinity;
  for (const m of candidateTotals) {
    const wMm = m * printedMmPerMeter;
    if (wMm >= 22 && wMm <= 56) {
      chosenTotal = m;
      bestDist = 0;
      break;
    }
    const dist = Math.abs(wMm - 38);
    if (dist < bestDist) {
      bestDist = dist;
      chosenTotal = m;
    }
  }

  const rawBarWidthMm = chosenTotal * printedMmPerMeter;
  const clampedBarWidthMm = Number(Math.max(18, Math.min(64, rawBarWidthMm)).toFixed(2));
  const segments = 4;
  const segmentMeters = Number((chosenTotal / segments).toFixed(2));
  const ticks = [0, Number((chosenTotal / 2).toFixed(2)), chosenTotal];

  return {
    pageWidthMm,
    pageHeightMm,
    marginMm,
    marginsMm,
    drawAreaWidthMm: Number(drawAreaWidthMm.toFixed(2)),
    drawAreaHeightMm: Number(drawAreaHeightMm.toFixed(2)),
    renderedDrawWidthMm,
    renderedDrawHeightMm,
    mmPerWorldPx,
    pxPerMeter,
    printedMmPerMeter: Number(printedMmPerMeter.toFixed(3)),
    realWorldWidthMeters,
    realWorldHeightMeters,
    engineeringRatioDenominator,
    scaleRatioLabel,
    autoFitApplied: autoFit,
    scaleBar: {
      totalMeters: chosenTotal,
      segmentMeters,
      segments,
      barWidthMm: clampedBarWidthMm,
      ticks
    }
  };
}
