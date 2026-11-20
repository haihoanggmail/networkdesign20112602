import { CableEdge, CablePoint, CableTray, ProjectState } from '../types/infrastructure';
import { normalizeScalePxPerMeter } from './scaleUtils';

export interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CablePathResult {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  d: string;
  pts: CablePoint[];
  midPoint: CablePoint;
  midAngleDeg: number;
  lengthPx: number;
}

/**
 * Converts a tangent vector (dx, dy) into a readable label angle in [-90, 90) degrees
 * so cable labels always align along the wire without rendering upside-down.
 * Vertical lines consistently orient bottom-to-top (-90 deg) per CAD convention.
 */
export function normalizeReadableAngleDeg(dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < 0.001) return 0;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  else if (deg <= -90) deg += 180;
  if (Math.abs(deg - 90) < 0.05) deg = -90;
  return Math.round(deg * 10) / 10;
}

/**
 * Finds the exact 50% arc-length midpoint and segment tangent angle along a polyline.
 */
function samplePolylineMidpointAndAngle(polyPts: CablePoint[]): {
  midPoint: CablePoint;
  midAngleDeg: number;
  lengthPx: number;
} {
  if (polyPts.length === 0) {
    return { midPoint: { x: 0, y: 0 }, midAngleDeg: 0, lengthPx: 0 };
  }
  if (polyPts.length === 1) {
    return { midPoint: polyPts[0], midAngleDeg: 0, lengthPx: 0 };
  }
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < polyPts.length - 1; i++) {
    const l = Math.hypot(polyPts[i + 1].x - polyPts[i].x, polyPts[i + 1].y - polyPts[i].y);
    segLens.push(l);
    totalLen += l;
  }
  if (totalLen < 0.001) {
    return { midPoint: polyPts[0], midAngleDeg: 0, lengthPx: 0 };
  }
  const halfLen = totalLen / 2;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const segLen = segLens[i];
    if (acc + segLen >= halfLen || i === segLens.length - 1) {
      const a = polyPts[i];
      const b = polyPts[i + 1];
      const ratio = segLen > 0.001 ? Math.max(0, Math.min(1, (halfLen - acc) / segLen)) : 0;
      const midPoint = {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio
      };
      // If midpoint lands on a tiny <28px connector jog, fall back to longest segment orientation
      let angleDx = b.x - a.x;
      let angleDy = b.y - a.y;
      if (segLen < 28) {
        let bestIdx = i;
        let bestLen = segLen;
        for (let j = 0; j < segLens.length; j++) {
          if (segLens[j] > bestLen) {
            bestLen = segLens[j];
            bestIdx = j;
          }
        }
        angleDx = polyPts[bestIdx + 1].x - polyPts[bestIdx].x;
        angleDy = polyPts[bestIdx + 1].y - polyPts[bestIdx].y;
      }
      return {
        midPoint,
        midAngleDeg: normalizeReadableAngleDeg(angleDx, angleDy),
        lengthPx: totalLen
      };
    }
    acc += segLen;
  }
  return {
    midPoint: polyPts[Math.floor(polyPts.length / 2)],
    midAngleDeg: normalizeReadableAngleDeg(
      polyPts[polyPts.length - 1].x - polyPts[0].x,
      polyPts[polyPts.length - 1].y - polyPts[0].y
    ),
    lengthPx: totalLen
  };
}

/**
 * Approximates cubic Bezier arc length by sampling `steps` chord segments.
 */
function sampleCubicBezierLength(
  p0: CablePoint,
  c1: CablePoint,
  c2: CablePoint,
  p3: CablePoint,
  steps = 16
): number {
  let len = 0;
  let prevX = p0.x;
  let prevY = p0.y;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p0.x +
      3 * mt * mt * t * c1.x +
      3 * mt * t * t * c2.x +
      t * t * t * p3.x;
    const y =
      mt * mt * mt * p0.y +
      3 * mt * mt * t * c1.y +
      3 * mt * t * t * c2.y +
      t * t * t * p3.y;
    len += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return len;
}

/**
 * Approximates quadratic Bezier arc length by sampling `steps` chord segments.
 */
function sampleQuadraticBezierLength(
  p0: CablePoint,
  c: CablePoint,
  p2: CablePoint,
  steps = 16
): number {
  let len = 0;
  let prevX = p0.x;
  let prevY = p0.y;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * c.x + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * c.y + t * t * p2.y;
    len += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return len;
}

/**
 * Computes SVG path, anchor points, control points, label midpoint, and geometric pixel length
 * for straight, orthogonal, and curved cable routes (including multi-waypoint Bezier splines).
 */
export function computeCablePath(cable: CableEdge, r1: RectBox, r2: RectBox): CablePathResult {
  const x1 = r1.x + r1.width / 2;
  const y1 = r1.y + r1.height / 2;
  const x2 = r2.x + r2.width / 2;
  const y2 = r2.y + r2.height / 2;

  const cps = cable.controlPoints && cable.controlPoints.length > 0 ? cable.controlPoints : null;

  let d = '';
  let pts: CablePoint[] = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  let midPoint: CablePoint = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  let midAngleDeg = normalizeReadableAngleDeg(x2 - x1, y2 - y1);
  let lengthPx = 0;

  if (cps) {
    pts = [{ x: x1, y: y1 }, ...cps, { x: x2, y: y2 }];
    if (cable.routingType === 'curved') {
      if (cps.length === 1) {
        // Quadratic Bezier where dragging control point visibly bends curve through/near handle
        const cx = 2 * cps[0].x - 0.5 * (x1 + x2);
        const cy = 2 * cps[0].y - 0.5 * (y1 + y2);
        d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
        midPoint = cps[0];
        midAngleDeg = normalizeReadableAngleDeg(x2 - x1, y2 - y1);
        lengthPx = sampleQuadraticBezierLength({ x: x1, y: y1 }, { x: cx, y: cy }, { x: x2, y: y2 });
      } else {
        // Smooth Catmull-Rom to cubic Bezier spline passing smoothly through all waypoints
        d = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[Math.max(0, i - 1)];
          const p1 = pts[i];
          const p2 = pts[i + 1];
          const p3 = pts[Math.min(pts.length - 1, i + 2)];
          const c1x = p1.x + (p2.x - p0.x) / 6;
          const c1y = p1.y + (p2.y - p0.y) / 6;
          const c2x = p2.x - (p3.x - p1.x) / 6;
          const c2y = p2.y - (p3.y - p1.y) / 6;
          d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
          lengthPx += sampleCubicBezierLength(p1, { x: c1x, y: c1y }, { x: c2x, y: c2y }, p2, 12);
        }
        const midIdx = Math.floor(pts.length / 2);
        midPoint = pts[midIdx];
        const prevPt = pts[Math.max(0, midIdx - 1)];
        const nextPt = pts[Math.min(pts.length - 1, midIdx + 1)];
        midAngleDeg = normalizeReadableAngleDeg(nextPt.x - prevPt.x, nextPt.y - prevPt.y);
      }
    } else if (cable.routingType === 'orthogonal') {
      const polyPts: CablePoint[] = [{ x: x1, y: y1 }];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) {
          polyPts.push({ x: b.x, y: a.y });
        }
        polyPts.push(b);
      }
      d = `M ${polyPts.map(p => `${p.x} ${p.y}`).join(' L ')}`;
      const sampled = samplePolylineMidpointAndAngle(polyPts);
      midPoint = sampled.midPoint;
      midAngleDeg = sampled.midAngleDeg;
      lengthPx = sampled.lengthPx;
    } else {
      d = `M ${pts.map(p => `${p.x} ${p.y}`).join(' L ')}`;
      const sampled = samplePolylineMidpointAndAngle(pts);
      midPoint = sampled.midPoint;
      midAngleDeg = sampled.midAngleDeg;
      lengthPx = sampled.lengthPx;
    }
  } else if (cable.routingType === 'straight') {
    d = `M ${x1} ${y1} L ${x2} ${y2}`;
    lengthPx = Math.hypot(x2 - x1, y2 - y1);
    midAngleDeg = normalizeReadableAngleDeg(x2 - x1, y2 - y1);
  } else if (cable.routingType === 'curved') {
    const dx = Math.abs(x2 - x1) * 0.5;
    d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    lengthPx = sampleCubicBezierLength(
      { x: x1, y: y1 },
      { x: x1 + dx, y: y1 },
      { x: x2 - dx, y: y2 },
      { x: x2, y: y2 },
      16
    );
    // Exact cubic Bezier derivative B'(0.5) = 0.75 * [2*(p3 - p0) - 2*(dx, 0)]
    const tdx = 0.75 * (2 * (x2 - x1) - 2 * dx);
    const tdy = 1.5 * (y2 - y1);
    midAngleDeg = normalizeReadableAngleDeg(tdx, tdy);
  } else {
    const midX = (x1 + x2) / 2;
    d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
    lengthPx = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    // Middle segment is vertical when |y2 - y1| >= 32; otherwise orient horizontally along dominant run
    midAngleDeg = Math.abs(y2 - y1) >= 32 ? -90 : 0;
  }

  return { x1, y1, x2, y2, d, pts, midPoint, midAngleDeg, lengthPx };
}

export interface CableLabelTransform {
  x: number;
  y: number;
  angleDeg: number;
  autoAngleDeg: number;
  isAutoOriented: boolean;
  fontSize: number;
  text: string;
  badgeWidth: number;
  badgeHeight: number;
}

/**
 * Resolves position, path-aligned or manually overridden rotation, font size, and box dimensions
 * for a cable's label on the Cable Labeling overlay layer.
 */
export function resolveCableLabelTransform(
  cable: CableEdge,
  pathResult: Pick<CablePathResult, 'midPoint' | 'midAngleDeg'>
): CableLabelTransform {
  const autoAngleDeg = pathResult.midAngleDeg;
  const isAutoOriented = cable.labelAutoOrient !== false && cable.labelRotation === undefined;
  const rawAngle = isAutoOriented
    ? autoAngleDeg
    : Number.isFinite(cable.labelRotation)
    ? Number(cable.labelRotation)
    : autoAngleDeg;
  const angleDeg = Math.round(Math.max(-180, Math.min(180, rawAngle)) * 10) / 10;
  const fontSize = Math.round(Math.max(7, Math.min(24, Number(cable.labelFontSize) || 9.5)) * 10) / 10;
  const text = (cable.label && cable.label.trim().length > 0 ? cable.label.trim() : cable.cableCode) || '';
  const badgeHeight = Math.max(16, Math.round(fontSize * 1.95));
  const badgeWidth = Math.max(
    54,
    Math.min(360, Math.round(text.length * fontSize * 0.64 + fontSize * 2.2 + 8))
  );

  return {
    x: pathResult.midPoint.x,
    y: pathResult.midPoint.y,
    angleDeg,
    autoAngleDeg,
    isAutoOriented,
    fontSize,
    text,
    badgeWidth,
    badgeHeight
  };
}

/**
 * Estimates real physical cable length (in meters) from canvas geometry plus installation slack.
 */
export function estimateCableLengthMeters(
  cable: CableEdge,
  r1: RectBox,
  r2: RectBox,
  pxPerMeter = 30,
  slackFactor = 1.15
): number {
  const { lengthPx } = computeCablePath(cable, r1, r2);
  const effectiveScale = normalizeScalePxPerMeter(pxPerMeter);
  const meters = (lengthPx / effectiveScale) * slackFactor;
  return Math.max(1, Math.round(meters));
}

export interface CableLengthBreakdown {
  pathPixels: number;
  scalePxPerMeter: number;
  horizontalMeters: number;
  verticalRiseMeters: number;
  slackFactor: number;
  slackMeters: number;
  totalEstimatedMeters: number;
  waypointCount: number;
  isCrossFloor: boolean;
}

/**
 * Real-time detailed length calculation combining exact routed path coordinates,
 * building/project scale (px/m), cross-floor vertical riser height, and slack factor.
 */
export function computeRealTimeCableLengthBreakdown(
  cable: CableEdge,
  r1: RectBox,
  r2: RectBox,
  options?: {
    pxPerMeter?: number;
    slackFactor?: number;
    floorLevelDiff?: number;
    floorHeightMeters?: number;
  }
): CableLengthBreakdown {
  const scalePxPerMeter = normalizeScalePxPerMeter(options?.pxPerMeter);
  const slackFactor = Math.max(1, options?.slackFactor ?? 1.15);
  const floorDiff = Math.max(0, Math.abs(options?.floorLevelDiff || 0));
  const floorHeight = Math.max(2, options?.floorHeightMeters || 3.8);

  const pathRes = computeCablePath(cable, r1, r2);
  const pathPixels = Math.round(pathRes.lengthPx);
  const horizontalMeters = Number((pathRes.lengthPx / scalePxPerMeter).toFixed(2));
  const verticalRiseMeters = Number((floorDiff * floorHeight).toFixed(2));
  const baseMeters = horizontalMeters + verticalRiseMeters;
  const slackMeters = Number((baseMeters * (slackFactor - 1)).toFixed(2));
  const totalEstimatedMeters = Math.max(0.5, Number((baseMeters * slackFactor).toFixed(1)));

  return {
    pathPixels,
    scalePxPerMeter,
    horizontalMeters,
    verticalRiseMeters,
    slackFactor,
    slackMeters,
    totalEstimatedMeters,
    waypointCount: cable.controlPoints?.length || 0,
    isCrossFloor: floorDiff > 0
  };
}

export interface CableSignalColorPreset {
  color: string;
  label: string;
  signalRole: string;
}

export const CABLE_SIGNAL_COLOR_PRESETS: CableSignalColorPreset[] = [
  { color: '#155eef', label: 'LAN', signalRole: 'Dữ liệu LAN (Cat6 / Access)' },
  { color: '#0891b2', label: 'Uplink', signalRole: 'Uplink 10G–100G / Trunk' },
  { color: '#f59e0b', label: 'PoE', signalRole: 'Cấp nguồn PoE+ / Camera / Wi-Fi' },
  { color: '#7c3aed', label: 'Fiber', signalRole: 'Cáp quang Fiber OS2 / OM4' },
  { color: '#16a34a', label: 'WAN', signalRole: 'Đường truyền WAN / Internet' },
  { color: '#dc2626', label: 'Nguồn / Lỗi', signalRole: 'Nguồn AC / Tuyến cảnh báo' },
  { color: '#64748b', label: 'Dự phòng', signalRole: 'Backup / Console (nét đứt)' },
  { color: '#ec4899', label: 'HA Heartbeat', signalRole: 'Cluster / HA Sync' }
];

export function getDefaultCableColorForType(cableType: CableEdge['cableType']): string {
  switch (cableType) {
    case 'CAT6_UTP': return '#0284c7';
    case 'CAT6A_STP': return '#2563eb';
    case 'FIBER_SM_OS2': return '#f59e0b';
    case 'FIBER_MM_OM4': return '#06b6d4';
    case 'DAC_10G': return '#6366f1';
    case 'POWER_AC': return '#dc2626';
    default: return '#0284c7';
  }
}

export function normalizeCableColor(color: string, fallback = '#0284c7'): string {
  const trimmed = String(color || '').trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^(rgb|hsl)a?\([^)]+\)$/i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export interface CableBundleInfo {
  bundleId: string;
  cables: CableEdge[];
  midPoint: CablePoint;
  tangent: CablePoint;
  normal: CablePoint;
  spanWidthPx: number;
  primaryColor: string;
  distinctColors: string[];
  summaryLabel: string;
  totalMeters: number;
}

export interface CableBundleLayout {
  bundles: CableBundleInfo[];
  cableToBundleId: Map<string, string>;
  cableOffsets: Map<string, number>;
  cablePaths: Map<string, CablePathResult>;
}

/**
 * Computes a cable path shifted cleanly in parallel by `offsetPx` along a canonical corridor normal
 * so multiple cables sharing the same approximate route stay visually distinct without crossing.
 */
export function computeBundledCablePath(
  cable: CableEdge,
  r1: RectBox,
  r2: RectBox,
  offsetPx: number,
  canonicalNormal: CablePoint
): CablePathResult {
  if (!offsetPx || (cable.controlPoints && cable.controlPoints.length > 0)) {
    return computeCablePath(cable, r1, r2);
  }

  const x1Center = r1.x + r1.width / 2;
  const y1Center = r1.y + r1.height / 2;
  const x2Center = r2.x + r2.width / 2;
  const y2Center = r2.y + r2.height / 2;

  if (cable.routingType === 'orthogonal') {
    const dxAbs = Math.abs(x2Center - x1Center);
    const dyAbs = Math.abs(y2Center - y1Center);

    if (dxAbs >= dyAbs * 0.45) {
      // Predominantly horizontal run: offset entry/exit Y and midX in opposite directions to form nested parallel tracks
      const x1 = x1Center;
      const y1 = y1Center + offsetPx * 0.65;
      const x2 = x2Center;
      const y2 = y2Center + offsetPx * 0.65;
      const dirSign = x2 >= x1 ? 1 : -1;
      const midX = (x1 + x2) / 2 + offsetPx * 0.7 * dirSign;
      const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
      const pts: CablePoint[] = [
        { x: x1, y: y1 },
        { x: midX, y: y1 },
        { x: midX, y: y2 },
        { x: x2, y: y2 }
      ];
      const midPoint = { x: midX, y: (y1 + y2) / 2 };
      const lengthPx = Math.abs(midX - x1) + Math.abs(y2 - y1) + Math.abs(x2 - midX);
      const midAngleDeg = Math.abs(y2 - y1) >= 32 ? -90 : 0;
      return { x1, y1, x2, y2, d, pts, midPoint, midAngleDeg, lengthPx };
    } else {
      // Predominantly vertical run: offset X cleanly
      const x1 = x1Center + offsetPx;
      const y1 = y1Center;
      const x2 = x2Center + offsetPx;
      const y2 = y2Center;
      const midY = (y1 + y2) / 2;
      const d = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
      const pts: CablePoint[] = [
        { x: x1, y: y1 },
        { x: x1, y: midY },
        { x: x2, y: midY },
        { x: x2, y: y2 }
      ];
      const midPoint = { x: (x1 + x2) / 2, y: midY };
      const lengthPx = Math.abs(midY - y1) + Math.abs(x2 - x1) + Math.abs(y2 - midY);
      const midAngleDeg = Math.abs(x2 - x1) >= 32 ? 0 : -90;
      return { x1, y1, x2, y2, d, pts, midPoint, midAngleDeg, lengthPx };
    }
  }

  if (cable.routingType === 'curved') {
    const x1 = x1Center + canonicalNormal.x * offsetPx * 0.45;
    const y1 = y1Center + canonicalNormal.y * offsetPx * 0.45;
    const x2 = x2Center + canonicalNormal.x * offsetPx * 0.45;
    const y2 = y2Center + canonicalNormal.y * offsetPx * 0.45;
    const midBaseX = (x1 + x2) / 2;
    const midBaseY = (y1 + y2) / 2;
    const ctrlX = midBaseX + canonicalNormal.x * offsetPx * 2.1;
    const ctrlY = midBaseY + canonicalNormal.y * offsetPx * 2.1;
    const d = `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
    const midPoint = {
      x: 0.25 * x1 + 0.5 * ctrlX + 0.25 * x2,
      y: 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2
    };
    const lengthPx = Math.hypot(x2 - x1, y2 - y1) * 1.05;
    const midAngleDeg = normalizeReadableAngleDeg(x2 - x1, y2 - y1);
    return {
      x1,
      y1,
      x2,
      y2,
      d,
      pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
      midPoint,
      midAngleDeg,
      lengthPx
    };
  }

  // Straight cable: shift endpoints strictly along canonicalNormal
  const nx = canonicalNormal.x * offsetPx;
  const ny = canonicalNormal.y * offsetPx;
  return computeCablePath(
    cable,
    { ...r1, x: r1.x + nx, y: r1.y + ny },
    { ...r2, x: r2.x + nx, y: r2.y + ny }
  );
}

/**
 * Detects cables sharing the same approximate corridor/path and groups them into parallel
 * 'Cable Bundles' with consistent normal offsets and consolidated summary metadata.
 */
export function computeCableBundleLayout(
  cables: CableEdge[],
  getRect: (nodeId: string) => RectBox | null,
  options?: { spacingPx?: number; corridorGridPx?: number }
): CableBundleLayout {
  const baseSpacing = options?.spacingPx ?? 6.5;
  const gridPx = options?.corridorGridPx ?? 48;

  const cableToBundleId = new Map<string, string>();
  const cableOffsets = new Map<string, number>();
  const cablePaths = new Map<string, CablePathResult>();
  const bundles: CableBundleInfo[] = [];

  interface GroupEntry {
    corridorKey: string;
    canonicalA: CablePoint;
    canonicalB: CablePoint;
    items: Array<{ cable: CableEdge; r1: RectBox; r2: RectBox }>;
  }

  const corridorGroups = new Map<string, GroupEntry>();

  for (const cable of cables) {
    const r1 = getRect(cable.sourceNodeId);
    const r2 = getRect(cable.targetNodeId);
    if (!r1 || !r2) continue;

    // Cables with user-defined manual waypoints keep their exact path untouched
    if (cable.controlPoints && cable.controlPoints.length > 0) {
      cablePaths.set(cable.id, computeCablePath(cable, r1, r2));
      cableOffsets.set(cable.id, 0);
      continue;
    }

    const c1: CablePoint = { x: r1.x + r1.width / 2, y: r1.y + r1.height / 2 };
    const c2: CablePoint = { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };

    const q1 = `${Math.round(c1.x / gridPx)},${Math.round(c1.y / gridPx)}`;
    const q2 = `${Math.round(c2.x / gridPx)},${Math.round(c2.y / gridPx)}`;

    // Normalize endpoint order so A->B and B->A always fall into the same bundle
    const isForward = q1 <= q2;
    const keyA = isForward ? q1 : q2;
    const keyB = isForward ? q2 : q1;
    const corridorKey = `${keyA}|${keyB}`;

    const existing = corridorGroups.get(corridorKey);
    if (existing) {
      existing.items.push({ cable, r1, r2 });
    } else {
      corridorGroups.set(corridorKey, {
        corridorKey,
        canonicalA: isForward ? c1 : c2,
        canonicalB: isForward ? c2 : c1,
        items: [{ cable, r1, r2 }]
      });
    }
  }

  corridorGroups.forEach(group => {
    const { corridorKey, canonicalA, canonicalB, items } = group;
    if (items.length === 1) {
      const { cable, r1, r2 } = items[0];
      cableOffsets.set(cable.id, 0);
      cablePaths.set(cable.id, computeCablePath(cable, r1, r2));
      return;
    }

    // Sort deterministically by cable id so strand positions stay stable across renders
    const sorted = [...items].sort((a, b) => a.cable.id.localeCompare(b.cable.id));
    const count = sorted.length;
    const effectiveSpacing = count > 6 ? Math.max(4, 38 / count) : baseSpacing;

    const dx = canonicalB.x - canonicalA.x;
    const dy = canonicalB.y - canonicalA.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const tangent: CablePoint = { x: dx / len, y: dy / len };
    const normal: CablePoint = { x: -dy / len, y: dx / len };

    const bundleId = `bundle_${corridorKey}`;
    const midIndex = (count - 1) / 2;
    const midPoints: CablePoint[] = [];
    let totalMeters = 0;

    sorted.forEach(({ cable, r1, r2 }, idx) => {
      const offsetPx = Number(((idx - midIndex) * effectiveSpacing).toFixed(1));
      const pathRes = computeBundledCablePath(cable, r1, r2, offsetPx, normal);
      cableToBundleId.set(cable.id, bundleId);
      cableOffsets.set(cable.id, offsetPx);
      cablePaths.set(cable.id, pathRes);
      midPoints.push(pathRes.midPoint);
      totalMeters += cable.lengthMeters || 0;
    });

    const avgMidX = midPoints.reduce((s, p) => s + p.x, 0) / midPoints.length;
    const avgMidY = midPoints.reduce((s, p) => s + p.y, 0) / midPoints.length;

    const bandwidths = Array.from(new Set(sorted.map(s => s.cable.bandwidth).filter(Boolean)));
    const bwText = bandwidths.slice(0, 2).join('/');
    const spanWidthPx = Math.max(10, (count - 1) * effectiveSpacing + 6);
    const distinctColors = Array.from(
      new Set(sorted.map(s => normalizeCableColor(s.cable.color || '#0284c7')))
    );

    bundles.push({
      bundleId,
      cables: sorted.map(s => s.cable),
      midPoint: { x: avgMidX, y: avgMidY },
      tangent,
      normal,
      spanWidthPx,
      primaryColor: distinctColors[0] || '#0284c7',
      distinctColors,
      summaryLabel: bwText ? `×${count} Cáp · ${bwText}` : `×${count} Cáp`,
      totalMeters
    });
  });

  return {
    bundles,
    cableToBundleId,
    cableOffsets,
    cablePaths
  };
}

export interface AutoRouteObstacle extends RectBox {
  id: string;
}

export interface AutoRouteOptions {
  gridSize?: number;
  clearancePx?: number;
  turnPenalty?: number;
  corridorPenalty?: number;
  occupiedSegments?: Array<{ a: CablePoint; b: CablePoint }>;
  preferredTrays?: CableTray[];
  maxExpandedNodes?: number;
}

export interface AutoRouteResult {
  controlPoints: CablePoint[];
  routingType: 'orthogonal';
  avoidedObstacles: number;
  usedFallback: boolean;
}

function segmentIntersectsOpenRect(
  a: CablePoint,
  b: CablePoint,
  rx1: number,
  ry1: number,
  rx2: number,
  ry2: number
): boolean {
  const eps = 0.5;
  if (Math.abs(a.y - b.y) <= 0.5) {
    // Horizontal
    const y = (a.y + b.y) / 2;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return y > ry1 + eps && y < ry2 - eps && maxX > rx1 + eps && minX < rx2 - eps;
  }
  if (Math.abs(a.x - b.x) <= 0.5) {
    // Vertical
    const x = (a.x + b.x) / 2;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return x > rx1 + eps && x < rx2 - eps && maxY > ry1 + eps && minY < ry2 - eps;
  }
  // Diagonal fallback check (bounding box + midpoint)
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX <= rx1 + eps || minX >= rx2 - eps || maxY <= ry1 + eps || minY >= ry2 - eps) {
    return false;
  }
  // Liang-Barsky parametric segment vs open rect
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks: Array<[number, number]> = [
    [-dx, a.x - (rx1 + eps)],
    [dx, (rx2 - eps) - a.x],
    [-dy, a.y - (ry1 + eps)],
    [dy, (ry2 - eps) - a.y]
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-6) {
      if (q <= 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 < t1;
}

function pointStrictlyInsideRect(p: CablePoint, rx1: number, ry1: number, rx2: number, ry2: number): boolean {
  return p.x > rx1 + 0.5 && p.x < rx2 - 0.5 && p.y > ry1 + 0.5 && p.y < ry2 - 0.5;
}

function segmentOverlapsCorridor(
  a: CablePoint,
  b: CablePoint,
  occupied: Array<{ a: CablePoint; b: CablePoint }>,
  tolerance = 7
): boolean {
  if (occupied.length === 0) return false;
  const isHoriz = Math.abs(a.y - b.y) <= 0.5;
  const minAx = Math.min(a.x, b.x);
  const maxAx = Math.max(a.x, b.x);
  const minAy = Math.min(a.y, b.y);
  const maxAy = Math.max(a.y, b.y);

  for (const seg of occupied) {
    if (isHoriz && Math.abs(seg.a.y - seg.b.y) <= 0.5) {
      if (Math.abs(a.y - seg.a.y) <= tolerance) {
        const minBx = Math.min(seg.a.x, seg.b.x);
        const maxBx = Math.max(seg.a.x, seg.b.x);
        if (Math.min(maxAx, maxBx) - Math.max(minAx, minBx) > 8) return true;
      }
    } else if (!isHoriz && Math.abs(seg.a.x - seg.b.x) <= 0.5) {
      if (Math.abs(a.x - seg.a.x) <= tolerance) {
        const minBy = Math.min(seg.a.y, seg.b.y);
        const maxBy = Math.max(seg.a.y, seg.b.y);
        if (Math.min(maxAy, maxBy) - Math.max(minAy, minBy) > 8) return true;
      }
    }
  }
  return false;
}

function simplifyOrthogonalPoints(pts: CablePoint[]): CablePoint[] {
  if (pts.length <= 2) return pts;
  const deduped: CablePoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.5) {
      deduped.push(pts[i]);
    }
  }
  if (deduped.length <= 2) return deduped;

  const cleaned: CablePoint[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const a = cleaned[cleaned.length - 1];
    const b = deduped[i];
    const c = deduped[i + 1];
    const sameX = Math.abs(a.x - b.x) <= 0.5 && Math.abs(b.x - c.x) <= 0.5;
    const sameY = Math.abs(a.y - b.y) <= 0.5 && Math.abs(b.y - c.y) <= 0.5;
    if (!sameX && !sameY) {
      cleaned.push({
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10
      });
    }
  }
  cleaned.push(deduped[deduped.length - 1]);
  return cleaned;
}

function dedupeSortedCoords(raw: number[], pinned: number[], minGap = 4): number[] {
  const sorted = [...raw].sort((a, b) => a - b);
  const out: number[] = [];
  for (const val of sorted) {
    const rounded = Math.round(val * 10) / 10;
    const isPinned = pinned.some(p => Math.abs(p - rounded) < 0.6);
    if (out.length === 0) {
      out.push(rounded);
      continue;
    }
    const last = out[out.length - 1];
    if (Math.abs(rounded - last) < 0.6) continue;
    if (!isPinned && !pinned.some(p => Math.abs(p - last) < 0.6) && Math.abs(rounded - last) < minGap) {
      continue;
    }
    out.push(rounded);
  }
  return out;
}

function buildTrayCorridorSegments(trays: CableTray[]): Array<{ a: CablePoint; b: CablePoint; halfWidth: number }> {
  const segs: Array<{ a: CablePoint; b: CablePoint; halfWidth: number }> = [];
  for (const t of trays) {
    const pts = t.points || [];
    const halfWidth = Math.max(18, (t.widthPx || 24) * 0.8);
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push({ a: pts[i], b: pts[i + 1], halfWidth });
    }
  }
  return segs;
}

function isStepAlongTray(
  p1: CablePoint,
  p2: CablePoint,
  traySegs: Array<{ a: CablePoint; b: CablePoint; halfWidth: number }>
): boolean {
  if (traySegs.length === 0) return false;
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  for (const seg of traySegs) {
    const minX = Math.min(seg.a.x, seg.b.x) - seg.halfWidth;
    const maxX = Math.max(seg.a.x, seg.b.x) + seg.halfWidth;
    const minY = Math.min(seg.a.y, seg.b.y) - seg.halfWidth;
    const maxY = Math.max(seg.a.y, seg.b.y) + seg.halfWidth;
    if (mx >= minX && mx <= maxX && my >= minY && my <= maxY) {
      return true;
    }
  }
  return false;
}

function runOrthogonalEscapeAStar(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  obstacles: AutoRouteObstacle[],
  pad: number,
  turnPenalty: number,
  corridorPenalty: number,
  occupiedSegments: Array<{ a: CablePoint; b: CablePoint }>,
  maxExpandedNodes: number,
  preferredTrays: CableTray[] = []
): CablePoint[] | null {
  const inflated = obstacles.map(o => ({
    x1: o.x - pad,
    y1: o.y - pad,
    x2: o.x + o.width + pad,
    y2: o.y + o.height + pad
  }));

  const worldMinX = Math.min(sx, tx, ...inflated.map(b => b.x1)) - 40;
  const worldMaxX = Math.max(sx, tx, ...inflated.map(b => b.x2)) + 40;
  const worldMinY = Math.min(sy, ty, ...inflated.map(b => b.y1)) - 40;
  const worldMaxY = Math.max(sy, ty, ...inflated.map(b => b.y2)) + 40;

  const trayAnchors = extractTrayGridAnchors(preferredTrays);
  const traySegs = buildTrayCorridorSegments(preferredTrays);

  const rawXs: number[] = [sx, tx, (sx + tx) / 2, worldMinX, worldMaxX, ...trayAnchors.xs];
  const rawYs: number[] = [sy, ty, (sy + ty) / 2, worldMinY, worldMaxY, ...trayAnchors.ys];

  for (const b of inflated) {
    rawXs.push(b.x1, b.x2);
    rawYs.push(b.y1, b.y2);
    if (corridorPenalty > 0 && occupiedSegments.length > 0) {
      rawXs.push(b.x1 - 12, b.x2 + 12);
      rawYs.push(b.y1 - 12, b.y2 + 12);
    }
  }

  const xs = dedupeSortedCoords(rawXs, [sx, tx]);
  const ys = dedupeSortedCoords(rawYs, [sy, ty]);

  const startXi = xs.findIndex(v => Math.abs(v - sx) < 0.6);
  const startYi = ys.findIndex(v => Math.abs(v - sy) < 0.6);
  const goalXi = xs.findIndex(v => Math.abs(v - tx) < 0.6);
  const goalYi = ys.findIndex(v => Math.abs(v - ty) < 0.6);
  if (startXi < 0 || startYi < 0 || goalXi < 0 || goalYi < 0) return null;

  // Allow start/goal endpoint segments to exit even if endpoint sits slightly inside an inflated halo
  const endpointAllowedBoxes = inflated.map(b => ({
    blockStartExit: pointStrictlyInsideRect({ x: sx, y: sy }, b.x1, b.y1, b.x2, b.y2),
    blockGoalEntry: pointStrictlyInsideRect({ x: tx, y: ty }, b.x1, b.y1, b.x2, b.y2),
    box: b
  }));

  const isStepBlocked = (
    p1: CablePoint,
    p2: CablePoint,
    xi1: number,
    yi1: number,
    xi2: number,
    yi2: number
  ): boolean => {
    const touchesStart = xi1 === startXi && yi1 === startYi;
    const touchesGoal = xi2 === goalXi && yi2 === goalYi;
    for (const entry of endpointAllowedBoxes) {
      if ((touchesStart && entry.blockStartExit) || (touchesGoal && entry.blockGoalEntry)) {
        continue;
      }
      if (segmentIntersectsOpenRect(p1, p2, entry.box.x1, entry.box.y1, entry.box.x2, entry.box.y2)) {
        return true;
      }
    }
    return false;
  };

  // dir: 0=R, 1=D, 2=L, 3=U, 4=start
  const cols = xs.length;
  const encode = (xi: number, yi: number, dir: number) => ((yi * cols + xi) << 3) | dir;

  interface PQNode {
    xi: number;
    yi: number;
    dir: number;
    g: number;
    f: number;
  }

  const bestG = new Map<number, number>();
  const parent = new Map<number, number>();
  const startKey = encode(startXi, startYi, 4);
  bestG.set(startKey, 0);

  const heap: PQNode[] = [
    {
      xi: startXi,
      yi: startYi,
      dir: 4,
      g: 0,
      f: Math.abs(sx - tx) + Math.abs(sy - ty)
    }
  ];

  const pushHeap = (node: PQNode) => {
    heap.push(node);
    let idx = heap.length - 1;
    while (idx > 0) {
      const pIdx = (idx - 1) >> 1;
      if (heap[pIdx].f <= heap[idx].f) break;
      const tmp = heap[pIdx];
      heap[pIdx] = heap[idx];
      heap[idx] = tmp;
      idx = pIdx;
    }
  };

  const popHeap = (): PQNode | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let idx = 0;
      const len = heap.length;
      while (true) {
        let smallest = idx;
        const l = (idx << 1) + 1;
        const r = l + 1;
        if (l < len && heap[l].f < heap[smallest].f) smallest = l;
        if (r < len && heap[r].f < heap[smallest].f) smallest = r;
        if (smallest === idx) break;
        const tmp = heap[idx];
        heap[idx] = heap[smallest];
        heap[smallest] = tmp;
        idx = smallest;
      }
    }
    return top;
  };

  const deltas: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 1],
    [-1, 0, 2],
    [0, -1, 3]
  ];

  let expanded = 0;
  let goalKey: number | null = null;

  while (heap.length > 0 && expanded < maxExpandedNodes) {
    const cur = popHeap()!;
    const curKey = encode(cur.xi, cur.yi, cur.dir);
    if (cur.g > (bestG.get(curKey) ?? Infinity)) continue;

    if (cur.xi === goalXi && cur.yi === goalYi) {
      goalKey = curKey;
      break;
    }

    expanded++;
    const p1: CablePoint = { x: xs[cur.xi], y: ys[cur.yi] };

    for (const [dxi, dyi, ndir] of deltas) {
      const nxi = cur.xi + dxi;
      const nyi = cur.yi + dyi;
      if (nxi < 0 || nxi >= xs.length || nyi < 0 || nyi >= ys.length) continue;

      const p2: CablePoint = { x: xs[nxi], y: ys[nyi] };
      if (isStepBlocked(p1, p2, cur.xi, cur.yi, nxi, nyi)) continue;

      const stepDist = Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
      const effectiveDist = isStepAlongTray(p1, p2, traySegs) ? stepDist * 0.55 : stepDist;
      const bendCost = cur.dir !== 4 && cur.dir !== ndir ? turnPenalty : 0;
      const corridorCost =
        corridorPenalty > 0 && segmentOverlapsCorridor(p1, p2, occupiedSegments) ? corridorPenalty : 0;
      const ng = cur.g + effectiveDist + bendCost + corridorCost;

      const nKey = encode(nxi, nyi, ndir);
      if (ng < (bestG.get(nKey) ?? Infinity)) {
        bestG.set(nKey, ng);
        parent.set(nKey, curKey);
        const h = Math.abs(p2.x - tx) + Math.abs(p2.y - ty);
        pushHeap({ xi: nxi, yi: nyi, dir: ndir, g: ng, f: ng + h });
      }
    }
  }

  if (goalKey === null) return null;

  const fullPts: CablePoint[] = [];
  let trace: number | undefined = goalKey;
  while (trace !== undefined) {
    const cellIdx = trace >> 3;
    const yi = Math.floor(cellIdx / cols);
    const xi = cellIdx % cols;
    fullPts.push({ x: xs[xi], y: ys[yi] });
    trace = parent.get(trace);
  }
  fullPts.reverse();
  const simplified = simplifyOrthogonalPoints(fullPts);
  // Return strictly interior vertices (strip source center & target center)
  return simplified.slice(1, -1);
}

/**
 * Intelligent 'Auto-Route' algorithm that navigates orthogonal cables cleanly around
 * obstacle nodes and racks on the canvas using an escape-line A* router with turn minimization.
 */
export function computeAutoRoutedWaypoints(
  sourceRect: RectBox,
  targetRect: RectBox,
  obstacles: AutoRouteObstacle[],
  options?: AutoRouteOptions
): AutoRouteResult {
  const sx = sourceRect.x + sourceRect.width / 2;
  const sy = sourceRect.y + sourceRect.height / 2;
  const tx = targetRect.x + targetRect.width / 2;
  const ty = targetRect.y + targetRect.height / 2;

  const clearancePx = Math.max(6, options?.clearancePx ?? 22);
  const turnPenalty = Math.max(0, options?.turnPenalty ?? 28);
  const corridorPenalty = Math.max(0, options?.corridorPenalty ?? 18);
  const occupiedSegments = options?.occupiedSegments ?? [];
  const preferredTrays = options?.preferredTrays ?? [];
  const maxExpandedNodes = options?.maxExpandedNodes ?? 6000;

  // Count how many obstacles would intersect a default L-shape route (midX)
  const midX = (sx + tx) / 2;
  const defaultSegments: Array<[CablePoint, CablePoint]> = [
    [{ x: sx, y: sy }, { x: midX, y: sy }],
    [{ x: midX, y: sy }, { x: midX, y: ty }],
    [{ x: midX, y: ty }, { x: tx, y: ty }]
  ];
  let obstaclesOnDefaultPath = 0;
  for (const obs of obstacles) {
    const hits = defaultSegments.some(([a, b]) =>
      segmentIntersectsOpenRect(a, b, obs.x, obs.y, obs.x + obs.width, obs.y + obs.height)
    );
    if (hits) obstaclesOnDefaultPath++;
  }

  // Try preferred clearance first, then tighter clearance if tightly packed
  const passClearances = [clearancePx, Math.max(8, Math.round(clearancePx * 0.4))];
  for (const pad of passClearances) {
    const interior = runOrthogonalEscapeAStar(
      sx,
      sy,
      tx,
      ty,
      obstacles,
      pad,
      turnPenalty,
      corridorPenalty,
      occupiedSegments,
      maxExpandedNodes,
      preferredTrays
    );
    if (interior !== null) {
      return {
        controlPoints: interior,
        routingType: 'orthogonal',
        avoidedObstacles: obstaclesOnDefaultPath,
        usedFallback: false
      };
    }
  }

  // Safe perimeter fallback outside bounding box of blocking obstacles
  const minY = Math.min(sy, ty, ...obstacles.map(o => o.y)) - clearancePx - 24;
  const fallbackY = Math.max(20, Math.round(minY));
  return {
    controlPoints: simplifyOrthogonalPoints([
      { x: sx, y: sy },
      { x: sx, y: fallbackY },
      { x: tx, y: fallbackY },
      { x: tx, y: ty }
    ]).slice(1, -1),
    routingType: 'orthogonal',
    avoidedObstacles: obstaclesOnDefaultPath,
    usedFallback: true
  };
}

export interface CableTypeBomRow {
  cableType: CableEdge['cableType'];
  label: string;
  shortLabel: string;
  color: string;
  count: number;
  totalMeters: number;
  percentage: number;
  estimatedRolls305m?: number;
}

export interface ProjectCableBomSummary {
  totalCount: number;
  totalMeters: number;
  totalWithReserveMeters: number;
  byType: CableTypeBomRow[];
}

export const CABLE_TYPE_META: Record<
  CableEdge['cableType'],
  { label: string; shortLabel: string; supports305mBox?: boolean }
> = {
  CAT6_UTP: { label: 'Cáp mạng Cat6 UTP', shortLabel: 'Cat6 UTP', supports305mBox: true },
  CAT6A_STP: { label: 'Cáp mạng Cat6A STP', shortLabel: 'Cat6A STP', supports305mBox: true },
  FIBER_SM_OS2: { label: 'Cáp quang Single-mode OS2', shortLabel: 'Quang OS2' },
  FIBER_MM_OM4: { label: 'Cáp quang Multi-mode OM4', shortLabel: 'Quang OM4' },
  DAC_10G: { label: 'Cáp đồng DAC 10G/40G', shortLabel: 'DAC 10G/40G' },
  POWER_AC: { label: 'Dây nguồn AC 220V', shortLabel: 'Nguồn AC' }
};

/**
 * Computes project-wide cable count, total length, +10% installation reserve,
 * and grouped breakdown by cable type for BOM / material estimation.
 */
export function computeProjectCableSummary(cables: CableEdge[]): ProjectCableBomSummary {
  const groups = new Map<CableEdge['cableType'], { count: number; totalMeters: number; color?: string }>();
  let totalMeters = 0;

  for (const cable of cables) {
    const len = Number.isFinite(Number(cable.lengthMeters)) ? Math.max(0, Number(cable.lengthMeters)) : 0;
    totalMeters += len;
    const existing = groups.get(cable.cableType);
    if (existing) {
      existing.count += 1;
      existing.totalMeters += len;
    } else {
      groups.set(cable.cableType, {
        count: 1,
        totalMeters: len,
        color: cable.color
      });
    }
  }

  const roundedTotal = Math.round(totalMeters * 10) / 10;
  const totalWithReserveMeters = Math.round(roundedTotal * 1.1 * 10) / 10;

  const byType: CableTypeBomRow[] = Array.from(groups.entries())
    .map(([cableType, stats]) => {
      const meta = CABLE_TYPE_META[cableType] || { label: cableType, shortLabel: cableType };
      const meters = Math.round(stats.totalMeters * 10) / 10;
      const percentage = roundedTotal > 0 ? Math.round((meters / roundedTotal) * 100) : 0;
      return {
        cableType,
        label: meta.label,
        shortLabel: meta.shortLabel,
        color: getDefaultCableColorForType(cableType),
        count: stats.count,
        totalMeters: meters,
        percentage,
        estimatedRolls305m: meta.supports305mBox && meters > 0 ? Math.ceil(meters / 305) : undefined
      };
    })
    .sort((a, b) => b.totalMeters - a.totalMeters || b.count - a.count);

  return {
    totalCount: cables.length,
    totalMeters: roundedTotal,
    totalWithReserveMeters,
    byType
  };
}

export interface OpticalLinkBudgetInput {
  cableType: 'FIBER_SM_OS2' | 'FIBER_MM_OM4';
  lengthMeters: number;
  connectorCount?: number;
  spliceCount?: number;
  transceiverBudgetDb?: number;
}

export interface OpticalLinkBudgetResult {
  fiberAttenuationDbPerKm: number;
  fiberLossDb: number;
  connectorLossDb: number;
  spliceLossDb: number;
  totalLossDb: number;
  transceiverBudgetDb: number;
  marginDb: number;
  status: 'nominal' | 'marginal' | 'exceeded';
}

/**
 * E4: Computes optical power budget / dB link loss per TIA-568 / IEEE 802.3 fiber standards.
 */
export function computeOpticalLinkBudget(input: OpticalLinkBudgetInput): OpticalLinkBudgetResult {
  const isSm = input.cableType === 'FIBER_SM_OS2';
  const dbPerKm = isSm ? 0.35 : 3.0;
  const km = Math.max(0, input.lengthMeters || 0) / 1000;
  const connectors = Math.max(0, Math.round(input.connectorCount ?? 2));
  const splices = Math.max(0, Math.round(input.spliceCount ?? 2));
  const budgetDb = input.transceiverBudgetDb ?? (isSm ? 9.4 : 4.5);

  const fiberLossDb = Math.round(km * dbPerKm * 100) / 100;
  const connectorLossDb = Math.round(connectors * 0.5 * 100) / 100;
  const spliceLossDb = Math.round(splices * 0.1 * 100) / 100;
  const totalLossDb = Math.round((fiberLossDb + connectorLossDb + spliceLossDb) * 100) / 100;
  const marginDb = Math.round((budgetDb - totalLossDb) * 100) / 100;

  const status: OpticalLinkBudgetResult['status'] =
    marginDb < 0 ? 'exceeded' : marginDb < 1.5 ? 'marginal' : 'nominal';

  return {
    fiberAttenuationDbPerKm: dbPerKm,
    fiberLossDb,
    connectorLossDb,
    spliceLossDb,
    totalLossDb,
    transceiverBudgetDb: budgetDb,
    marginDb,
    status
  };
}

export function extractTrayGridAnchors(trays: CableTray[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of trays) {
    for (const pt of t.points || []) {
      xs.push(Math.round(pt.x));
      ys.push(Math.round(pt.y));
    }
  }
  return { xs, ys };
}

export interface BatchCableRouteUpdate {
  id: string;
  controlPoints: CablePoint[];
  lengthMeters: number;
}

/**
 * Pure batch obstacle-avoiding router for all eligible cables in the active mode/floor.
 * Shared between the Web Worker compute pipeline and synchronous fallback paths.
 */
export function computeBatchProjectCableRoutes(project: ProjectState): BatchCableRouteUpdate[] {
  const modeCables = project.cables.filter(c => c.diagramMode === project.activeMode);
  if (modeCables.length === 0) return [];

  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const occupiedSegments: Array<{ a: CablePoint; b: CablePoint }> = [];
  const preferredTrays = (project.cableTrays || []).filter(
    t => !project.activeFloorId || !t.floorId || t.floorId === project.activeFloorId
  );

  const updates: BatchCableRouteUpdate[] = [];
  for (const cable of modeCables) {
    const src = nodeMap.get(cable.sourceNodeId);
    const tgt = nodeMap.get(cable.targetNodeId);
    if (!src || !tgt) continue;
    if (project.activeFloorId) {
      if (src.floorId && src.floorId !== project.activeFloorId && tgt.floorId && tgt.floorId !== project.activeFloorId) {
        continue;
      }
    }

    const obstacles: AutoRouteObstacle[] = project.nodes
      .filter(n => {
        if (n.id === src.id || n.id === tgt.id) return false;
        if (n.type === 'zone' || n.type === 'text') return false;
        if (n.diagramMode !== cable.diagramMode) return false;
        if (project.activeFloorId && n.floorId && n.floorId !== project.activeFloorId) return false;
        return true;
      })
      .map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));

    const route = computeAutoRoutedWaypoints(src, tgt, obstacles, {
      gridSize: project.settings.gridSize || 20,
      clearancePx: 22,
      occupiedSegments,
      preferredTrays
    });

    const sCenter = { x: src.x + src.width / 2, y: src.y + src.height / 2 };
    const tCenter = { x: tgt.x + tgt.width / 2, y: tgt.y + tgt.height / 2 };
    const pts = [sCenter, ...route.controlPoints, tCenter];
    for (let i = 0; i < pts.length - 1; i++) {
      occupiedSegments.push({ a: pts[i], b: pts[i + 1] });
    }

    const updatedCable: CableEdge = {
      ...cable,
      routingType: 'orthogonal',
      controlPoints: route.controlPoints
    };
    const lengthMeters = estimateCableLengthMeters(updatedCable, src, tgt, normalizeScalePxPerMeter(project.settings.scale));
    updates.push({
      id: cable.id,
      controlPoints: route.controlPoints,
      lengthMeters
    });
  }

  return updates;
}

function projectPointOnSegment(p: CablePoint, a: CablePoint, b: CablePoint): { point: CablePoint; dist: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-6) {
    return { point: a, dist: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const proj = { x: a.x + t * abx, y: a.y + t * aby };
  return { point: proj, dist: Math.hypot(p.x - proj.x, p.y - proj.y) };
}

function nearestPointOnTray(
  p: CablePoint,
  tray: CableTray
): { point: CablePoint; dist: number; segDistAlongTray: number } | null {
  if (tray.points.length < 2) return null;
  let bestDist = Infinity;
  let bestPoint = tray.points[0];
  let bestAlong = 0;
  let accumulated = 0;

  for (let i = 0; i < tray.points.length - 1; i++) {
    const a = tray.points[i];
    const b = tray.points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const { point, dist } = projectPointOnSegment(p, a, b);
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = point;
      bestAlong = accumulated + Math.hypot(point.x - a.x, point.y - a.y);
    }
    accumulated += segLen;
  }

  return { point: bestPoint, dist: bestDist, segDistAlongTray: bestAlong };
}

export function computeCableTrayLengthMeters(tray: CableTray, pxPerMeter = 30): number {
  if (!tray.points || tray.points.length < 2) return 0;
  let px = 0;
  for (let i = 0; i < tray.points.length - 1; i++) {
    px += Math.hypot(tray.points[i + 1].x - tray.points[i].x, tray.points[i + 1].y - tray.points[i].y);
  }
  const effectiveScale = normalizeScalePxPerMeter(pxPerMeter);
  return Math.round((px / effectiveScale) * 10) / 10;
}

/**
 * Calculates real cable length (meters) routed through the nearest compatible Cable Tray / Conduit
 * when present on the floor, or falls back to geometric cable routing.
 */
export function calculateTrayAwareCableLengthMeters(
  cable: CableEdge,
  r1: RectBox,
  r2: RectBox,
  trays: CableTray[],
  pxPerMeter = 30
): { meters: number; routedViaTrayName?: string } {
  const scale = normalizeScalePxPerMeter(pxPerMeter);
  const p1: CablePoint = { x: r1.x + r1.width / 2, y: r1.y + r1.height / 2 };
  const p2: CablePoint = { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };

  const compatibleTrays = trays.filter(t => {
    if (t.points.length < 2) return false;
    if (cable.cableType === 'POWER_AC') return t.kind === 'power_tray' || t.kind === 'conduit';
    return t.kind === 'network_tray' || t.kind === 'conduit';
  });

  let bestMeters = Infinity;
  let bestTrayName: string | undefined;

  for (const tray of compatibleTrays) {
    const hit1 = nearestPointOnTray(p1, tray);
    const hit2 = nearestPointOnTray(p2, tray);
    if (!hit1 || !hit2) continue;

    // Only route via tray if both endpoints are within reasonable drop radius (~14m)
    const maxDropPx = 14 * scale;
    if (hit1.dist <= maxDropPx && hit2.dist <= maxDropPx) {
      const trayRunPx = Math.abs(hit2.segDistAlongTray - hit1.segDistAlongTray);
      const totalPx = hit1.dist + trayRunPx + hit2.dist;
      // Add +3m vertical drop/termination allowance per TCVN installation practice
      const meters = Math.max(2, Math.round((totalPx / scale) * 1.12 + 3));
      if (meters < bestMeters) {
        bestMeters = meters;
        bestTrayName = tray.name;
      }
    }
  }

  if (Number.isFinite(bestMeters) && bestTrayName) {
    return { meters: bestMeters, routedViaTrayName: bestTrayName };
  }

  return {
    meters: estimateCableLengthMeters(cable, r1, r2, scale, 1.15)
  };
}

