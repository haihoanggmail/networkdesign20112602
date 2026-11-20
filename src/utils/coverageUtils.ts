import type { DeviceAsset, DiagramNode } from '../types/infrastructure';
import { normalizeScalePxPerMeter } from './scaleUtils';

export const WIFI_MIN_RADIUS_M = 2;
export const WIFI_MAX_RADIUS_M = 80;
export const WIFI_DEFAULT_RADIUS_M = 18;
export const WIFI_MIN_ANGLE_DEG = 30;
export const WIFI_MAX_ANGLE_DEG = 360;
export const WIFI_DEFAULT_ANGLE_DEG = 360;

export const CAMERA_FOV_MIN_DEG = 15;
export const CAMERA_FOV_MAX_DEG = 360;
export const CAMERA_FOV_DEFAULT_DEG = 90;
export const CAMERA_RANGE_MIN_M = 3;
export const CAMERA_RANGE_MAX_M = 120;
export const CAMERA_RANGE_DEFAULT_M = 30;
export const CAMERA_FOV_SCALE_FACTOR = 0.4;

export interface ResolvedWifiCoverage {
  radiusMeters: number;
  angleDeg: number;
  isDirectional: boolean;
  areaSqm: number;
  scalePct: number;
}

export interface ResolvedCameraFov {
  fovAngle: number;
  rangeMeters: number;
  isOmnidirectional: boolean;
  areaSqm: number;
  scalePct: number;
}

/**
 * Normalizes any rotation angle into [0, 360) rounded to 1 decimal place
 * (integers stay integers, e.g. 45 -> 45, -15 -> 345, 360 -> 0).
 */
export function normalizeRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const mod = ((deg % 360) + 360) % 360;
  const rounded = Math.round(mod * 10) / 10;
  return rounded >= 360 ? 0 : rounded;
}

/**
 * Shortest signed angular difference from `fromDeg` to `toDeg` in [-180, 180].
 */
export function signedAngularDiffDeg(fromDeg: number, toDeg: number): number {
  const diff = (((toDeg - fromDeg) % 360) + 540) % 360 - 180;
  return diff;
}

export function clampWifiRadiusMeters(val: number): number {
  if (!Number.isFinite(val)) return WIFI_DEFAULT_RADIUS_M;
  const stepped = Math.round(val * 2) / 2;
  return Math.max(WIFI_MIN_RADIUS_M, Math.min(WIFI_MAX_RADIUS_M, stepped));
}

export function clampWifiAngleDeg(val: number): number {
  if (!Number.isFinite(val)) return WIFI_DEFAULT_ANGLE_DEG;
  const rounded = Math.round(val);
  return Math.max(WIFI_MIN_ANGLE_DEG, Math.min(WIFI_MAX_ANGLE_DEG, rounded));
}

export function clampCameraFovDeg(val: number): number {
  if (!Number.isFinite(val)) return CAMERA_FOV_DEFAULT_DEG;
  const rounded = Math.round(val);
  return Math.max(CAMERA_FOV_MIN_DEG, Math.min(CAMERA_FOV_MAX_DEG, rounded));
}

export function clampCameraRangeMeters(val: number): number {
  if (!Number.isFinite(val)) return CAMERA_RANGE_DEFAULT_M;
  const stepped = Math.round(val * 2) / 2;
  return Math.max(CAMERA_RANGE_MIN_M, Math.min(CAMERA_RANGE_MAX_M, stepped));
}

export function computeSectorAreaSqm(radiusMeters: number, angleDeg: number): number {
  const r = Math.max(0, radiusMeters);
  const clampedAngle = Math.max(0, Math.min(360, angleDeg));
  return Math.round(Math.PI * r * r * (clampedAngle / 360));
}

export function wifiRadiusFromScalePct(scalePct: number): number {
  if (!Number.isFinite(scalePct)) return WIFI_DEFAULT_RADIUS_M;
  return clampWifiRadiusMeters((scalePct / 100) * WIFI_DEFAULT_RADIUS_M);
}

export function wifiRadiusFromAreaSqm(areaSqm: number, angleDeg = WIFI_DEFAULT_ANGLE_DEG): number {
  if (!Number.isFinite(areaSqm)) return WIFI_DEFAULT_RADIUS_M;
  const angleFrac = clampWifiAngleDeg(angleDeg) / 360;
  const r = Math.sqrt(Math.max(1, areaSqm) / (Math.PI * angleFrac));
  return clampWifiRadiusMeters(r);
}

export function cameraRangeFromScalePct(scalePct: number): number {
  if (!Number.isFinite(scalePct)) return CAMERA_RANGE_DEFAULT_M;
  return clampCameraRangeMeters((scalePct / 100) * CAMERA_RANGE_DEFAULT_M);
}

export function cameraRangeFromAreaSqm(areaSqm: number, fovAngle = CAMERA_FOV_DEFAULT_DEG): number {
  if (!Number.isFinite(areaSqm)) return CAMERA_RANGE_DEFAULT_M;
  const angleFrac = clampCameraFovDeg(fovAngle) / 360;
  const r = Math.sqrt(Math.max(1, areaSqm) / (Math.PI * angleFrac));
  return clampCameraRangeMeters(r);
}

export function resolveWifiCoverage(
  node?: DiagramNode,
  asset?: DeviceAsset
): ResolvedWifiCoverage | null {
  const rawRadius =
    asset?.wifiSpecs?.coverageRadiusMeters ??
    (typeof node?.customData?.coverageRadiusMeters === 'number'
      ? node.customData.coverageRadiusMeters
      : undefined);

  if (typeof rawRadius !== 'number' || !Number.isFinite(rawRadius) || rawRadius <= 0) {
    return null;
  }

  const radiusMeters = clampWifiRadiusMeters(rawRadius);
  const rawAngle =
    asset?.wifiSpecs?.coverageAngleDeg ??
    (typeof node?.customData?.coverageAngleDeg === 'number'
      ? node.customData.coverageAngleDeg
      : WIFI_DEFAULT_ANGLE_DEG);
  const angleDeg = clampWifiAngleDeg(rawAngle);
  const isDirectional = angleDeg < 359.5;
  const areaSqm = computeSectorAreaSqm(radiusMeters, angleDeg);
  const scalePct = Math.max(1, Math.round((radiusMeters / WIFI_DEFAULT_RADIUS_M) * 100));

  return {
    radiusMeters,
    angleDeg,
    isDirectional,
    areaSqm,
    scalePct
  };
}

export function resolveCameraFov(
  node?: DiagramNode,
  asset?: DeviceAsset
): ResolvedCameraFov | null {
  const hasSpecs = Boolean(asset?.cameraSpecs);
  const hasCustom =
    typeof node?.customData?.fov === 'number' ||
    typeof node?.customData?.irDistance === 'number';

  if (!hasSpecs && !hasCustom) {
    return null;
  }

  const rawFov =
    asset?.cameraSpecs?.fovAngle ??
    (typeof node?.customData?.fov === 'number'
      ? node.customData.fov
      : CAMERA_FOV_DEFAULT_DEG);
  const rawRange =
    asset?.cameraSpecs?.irDistanceMeters ??
    (typeof node?.customData?.irDistance === 'number'
      ? node.customData.irDistance
      : CAMERA_RANGE_DEFAULT_M);

  const fovAngle = clampCameraFovDeg(rawFov);
  const rangeMeters = clampCameraRangeMeters(rawRange);
  const isOmnidirectional = fovAngle >= 359.5;
  const areaSqm = computeSectorAreaSqm(rangeMeters, fovAngle);
  const scalePct = Math.max(1, Math.round((rangeMeters / CAMERA_RANGE_DEFAULT_M) * 100));

  return {
    fovAngle,
    rangeMeters,
    isOmnidirectional,
    areaSqm,
    scalePct
  };
}

export function wifiRadiusMetersToCanvasPx(
  radiusMeters: number,
  projectScale: number | undefined
): number {
  return radiusMeters * normalizeScalePxPerMeter(projectScale);
}

export function cameraRangeMetersToCanvasPx(
  rangeMeters: number,
  projectScale: number | undefined
): number {
  return rangeMeters * normalizeScalePxPerMeter(projectScale) * CAMERA_FOV_SCALE_FACTOR;
}

/**
 * Builds an SVG circular sector path (`rotationDeg = 0` points toward +X, clockwise positive).
 * Supports angles from 1° up to 360° using accurate `largeArcFlag` (`angleDeg > 180 ? 1 : 0`).
 */
export function buildSectorSvgPath(
  cx: number,
  cy: number,
  radiusPx: number,
  rotationDeg: number,
  angleDeg: number
): string {
  const r = Math.max(0.5, radiusPx);
  const clampedAngle = Math.max(1, Math.min(360, angleDeg));
  if (clampedAngle >= 359.5) {
    return `M ${(cx + r).toFixed(1)} ${cy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(cx - r).toFixed(1)} ${cy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(cx + r).toFixed(1)} ${cy.toFixed(1)} Z`;
  }
  const rotRad = (rotationDeg * Math.PI) / 180;
  const halfRad = ((clampedAngle / 2) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rotRad - halfRad);
  const y1 = cy + r * Math.sin(rotRad - halfRad);
  const x2 = cx + r * Math.cos(rotRad + halfRad);
  const y2 = cy + r * Math.sin(rotRad + halfRad);
  const largeArc = clampedAngle > 180 ? 1 : 0;
  return `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

/**
 * Builds an SVG open arc path (without radial wedge lines) for perimeter hit/stroke rendering.
 */
export function buildArcSvgPath(
  cx: number,
  cy: number,
  radiusPx: number,
  rotationDeg: number,
  angleDeg: number
): string {
  const r = Math.max(0.5, radiusPx);
  const clampedAngle = Math.max(1, Math.min(360, angleDeg));
  if (clampedAngle >= 359.5) {
    return `M ${(cx + r).toFixed(1)} ${cy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(cx - r).toFixed(1)} ${cy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(cx + r).toFixed(1)} ${cy.toFixed(1)}`;
  }
  const rotRad = (rotationDeg * Math.PI) / 180;
  const halfRad = ((clampedAngle / 2) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rotRad - halfRad);
  const y1 = cy + r * Math.sin(rotRad - halfRad);
  const x2 = cx + r * Math.cos(rotRad + halfRad);
  const y2 = cy + r * Math.sin(rotRad + halfRad);
  const largeArc = clampedAngle > 180 ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}
