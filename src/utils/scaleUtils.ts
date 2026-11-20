export const MIN_SCALE_PX_PER_METER = 0.05;
export const MAX_SCALE_PX_PER_METER = 500;
export const DEFAULT_SCALE_PX_PER_METER = 30;

/**
 * Canonical normalization for `project.settings.scale` (pixels per 1 meter).
 * Enforces the unified [0.05, 500] range across canvas, inspectors, BOM, routing, PDF, SVG, and CAD sync.
 */
export function normalizeScalePxPerMeter(
  rawScale: number | null | undefined,
  fallback = DEFAULT_SCALE_PX_PER_METER
): number {
  const safeFallback =
    typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0
      ? Math.max(MIN_SCALE_PX_PER_METER, Math.min(MAX_SCALE_PX_PER_METER, fallback))
      : DEFAULT_SCALE_PX_PER_METER;
  if (typeof rawScale !== 'number' || !Number.isFinite(rawScale) || rawScale <= 0) {
    return safeFallback;
  }
  return Math.max(MIN_SCALE_PX_PER_METER, Math.min(MAX_SCALE_PX_PER_METER, rawScale));
}

export function roundScalePxPerMeter(
  rawScale: number | null | undefined,
  decimals = 4,
  fallback = DEFAULT_SCALE_PX_PER_METER
): number {
  const clamped = normalizeScalePxPerMeter(rawScale, fallback);
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

export function pixelsToMeters(
  pixels: number,
  rawScale: number | null | undefined,
  fallback = DEFAULT_SCALE_PX_PER_METER
): number {
  const scale = normalizeScalePxPerMeter(rawScale, fallback);
  if (!Number.isFinite(pixels)) return 0;
  return pixels / scale;
}

export function metersToPixels(
  meters: number,
  rawScale: number | null | undefined,
  fallback = DEFAULT_SCALE_PX_PER_METER
): number {
  const scale = normalizeScalePxPerMeter(rawScale, fallback);
  if (!Number.isFinite(meters)) return 0;
  return meters * scale;
}
