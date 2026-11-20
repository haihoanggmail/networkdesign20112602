import type {
  CADArcEntity,
  CADEllipseEntity,
  CADPolylineVertex,
  CADSplineEntity,
  Point2D,
  Point3D
} from '../core/CADTypes';

export function normalizeAngleDeg(deg: number): number {
  let res = deg % 360;
  if (res < 0) res += 360;
  return res;
}

export function normalizeAngleRad(rad: number): number {
  const twoPi = Math.PI * 2;
  let res = rad % twoPi;
  if (res < 0) res += twoPi;
  return res;
}

/**
 * Check if angle (deg) lies on counter-clockwise arc from startDeg to endDeg.
 */
export function isAngleInCcwArc(angleDeg: number, startDeg: number, endDeg: number): boolean {
  const a = normalizeAngleDeg(angleDeg);
  const s = normalizeAngleDeg(startDeg);
  const e = normalizeAngleDeg(endDeg);
  if (Math.abs(s - e) < 1e-6) return true;
  if (s < e) {
    return a >= s - 1e-6 && a <= e + 1e-6;
  }
  return a >= s - 1e-6 || a <= e + 1e-6;
}

export function tessellateArc(
  center: Point2D,
  radius: number,
  startDeg: number,
  endDeg: number,
  segmentsPerFullCircle = 48
): Point2D[] {
  if (!(radius > 0)) return [{ x: center.x, y: center.y }];
  const s = normalizeAngleDeg(startDeg);
  const e = normalizeAngleDeg(endDeg);
  let sweep = e - s;
  if (sweep <= 0) sweep += 360;
  const count = Math.max(4, Math.ceil((sweep / 360) * segmentsPerFullCircle));
  const pts: Point2D[] = [];
  for (let i = 0; i <= count; i++) {
    const aRad = ((s + (sweep * i) / count) * Math.PI) / 180;
    pts.push({
      x: center.x + radius * Math.cos(aRad),
      y: center.y + radius * Math.sin(aRad)
    });
  }
  return pts;
}

/**
 * Convert a DXF polyline bulge segment (p1 -> p2) into sampled 2D points.
 */
export function tessellateBulgeSegment(
  p1: Point2D,
  p2: Point2D,
  bulge: number,
  maxChordSegments = 24
): Point2D[] {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-6) {
    return [p1, p2];
  }
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-8) return [p1];

  const theta = 4 * Math.atan(bulge); // Signed sweep angle (rad)
  const sinHalf = Math.sin(Math.abs(theta) / 2);
  if (sinHalf < 1e-8) return [p1, p2];

  const radius = chord / (2 * sinHalf);
  const sagitta = Math.abs(bulge) * (chord / 2);
  const distToCenter = radius - sagitta;

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const ux = dx / chord;
  const uy = dy / chord;
  // Normal pointing left of p1 -> p2
  const nx = -uy;
  const ny = ux;
  // Sign depends on whether bulge > 0 (CCW) and theta <= PI
  const sign = bulge > 0 ? (Math.abs(theta) <= Math.PI ? 1 : -1) : (Math.abs(theta) <= Math.PI ? -1 : 1);
  const cx = midX + sign * nx * distToCenter;
  const cy = midY + sign * ny * distToCenter;

  const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
  const steps = Math.max(3, Math.min(maxChordSegments, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * 36)));
  const pts: Point2D[] = [p1];
  for (let i = 1; i < steps; i++) {
    const a = startAngle + (theta * i) / steps;
    pts.push({
      x: cx + radius * Math.cos(a),
      y: cy + radius * Math.sin(a)
    });
  }
  pts.push(p2);
  return pts;
}

export function tessellatePolyline(
  vertices: CADPolylineVertex[],
  closed: boolean,
  segmentsPerBulge = 20
): Point2D[] {
  if (vertices.length === 0) return [];
  if (vertices.length === 1) return [{ x: vertices[0].x, y: vertices[0].y }];

  const out: Point2D[] = [];
  const segCount = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segCount; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    const bulge = v1.bulge ?? 0;
    const pts = tessellateBulgeSegment({ x: v1.x, y: v1.y }, { x: v2.x, y: v2.y }, bulge, segmentsPerBulge);
    for (let j = 0; j < pts.length; j++) {
      if (i > 0 && j === 0) continue;
      out.push(pts[j]);
    }
  }
  return out;
}

export function tessellateEllipse(entity: CADEllipseEntity, segments = 48): Point2D[] {
  const cx = entity.center.x;
  const cy = entity.center.y;
  const mx = entity.majorAxisEndPoint.x;
  const my = entity.majorAxisEndPoint.y;
  const majorLen = Math.hypot(mx, my);
  if (majorLen < 1e-8) return [{ x: cx, y: cy }];

  const angle = Math.atan2(my, mx);
  const minorLen = majorLen * (entity.axisRatio || 1);
  const cosRot = Math.cos(angle);
  const sinRot = Math.sin(angle);

  let start = entity.startParam ?? 0;
  let end = entity.endParam ?? Math.PI * 2;
  if (end <= start) end += Math.PI * 2;
  const sweep = Math.min(Math.PI * 2, end - start);
  const steps = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * segments));

  const pts: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + (sweep * i) / steps;
    const lx = majorLen * Math.cos(t);
    const ly = minorLen * Math.sin(t);
    pts.push({
      x: cx + lx * cosRot - ly * sinRot,
      y: cy + lx * sinRot + ly * cosRot
    });
  }
  return pts;
}

/**
 * Evaluate B-Spline curve using Cox-de Boor algorithm, falling back safely to fit/control points.
 */
export function tessellateSpline(entity: CADSplineEntity, samples = 48): Point2D[] {
  const ctrl = entity.controlPoints;
  if (!ctrl || ctrl.length === 0) {
    return (entity.fitPoints || []).map(p => ({ x: p.x, y: p.y }));
  }
  if (ctrl.length <= 2) {
    return ctrl.map(p => ({ x: p.x, y: p.y }));
  }

  const degree = Math.max(1, Math.min(entity.degree || 3, ctrl.length - 1));
  const n = ctrl.length - 1;
  let knots = entity.knots;
  const expectedKnots = n + degree + 2;

  if (!knots || knots.length < expectedKnots) {
    // Synthesize clamped uniform knot vector
    knots = [];
    for (let i = 0; i < expectedKnots; i++) {
      if (i <= degree) knots.push(0);
      else if (i >= expectedKnots - degree - 1) knots.push(n - degree + 1);
      else knots.push(i - degree);
    }
  }

  const uMin = knots[degree];
  const uMax = knots[n + 1];
  if (!(uMax > uMin)) {
    return ctrl.map(p => ({ x: p.x, y: p.y }));
  }

  const evaluateAt = (u: number): Point2D => {
    const clampedU = Math.min(uMax - 1e-9, Math.max(uMin, u));
    // Find knot span k such that knots[k] <= u < knots[k+1]
    let k = degree;
    for (let i = degree; i <= n; i++) {
      if (clampedU >= knots[i] && clampedU < knots[i + 1]) {
        k = i;
        break;
      }
    }
    const d: Array<Point3D & { w: number }> = [];
    for (let j = 0; j <= degree; j++) {
      const idx = Math.max(0, Math.min(n, k - degree + j));
      const p = ctrl[idx];
      const w = entity.weights?.[idx] ?? 1;
      d.push({ x: p.x * w, y: p.y * w, z: p.z * w, w });
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const leftIdx = k - degree + j;
        const rightIdx = k + 1 + j - r;
        const denom = knots[rightIdx] - knots[leftIdx];
        const alpha = denom > 1e-10 ? (clampedU - knots[leftIdx]) / denom : 0;
        d[j] = {
          x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
          y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
          z: (1 - alpha) * d[j - 1].z + alpha * d[j].z,
          w: (1 - alpha) * d[j - 1].w + alpha * d[j].w
        };
      }
    }
    const res = d[degree];
    const invW = Math.abs(res.w) > 1e-9 ? 1 / res.w : 1;
    return { x: res.x * invW, y: res.y * invW };
  };

  const pts: Point2D[] = [];
  const stepCount = Math.max(16, Math.min(160, samples));
  for (let i = 0; i <= stepCount; i++) {
    const u = uMin + ((uMax - uMin) * i) / stepCount;
    pts.push(evaluateAt(u));
  }
  if (entity.closed && pts.length > 2) {
    pts.push({ ...pts[0] });
  }
  return pts;
}

export function getArcEndpoints(arc: Pick<CADArcEntity, 'center' | 'radius' | 'startAngle' | 'endAngle'>): {
  start: Point2D;
  end: Point2D;
  mid: Point2D;
} {
  const sRad = (arc.startAngle * Math.PI) / 180;
  const eRad = (arc.endAngle * Math.PI) / 180;
  let sweep = normalizeAngleDeg(arc.endAngle) - normalizeAngleDeg(arc.startAngle);
  if (sweep <= 0) sweep += 360;
  const mRad = ((normalizeAngleDeg(arc.startAngle) + sweep / 2) * Math.PI) / 180;
  return {
    start: {
      x: arc.center.x + arc.radius * Math.cos(sRad),
      y: arc.center.y + arc.radius * Math.sin(sRad)
    },
    end: {
      x: arc.center.x + arc.radius * Math.cos(eRad),
      y: arc.center.y + arc.radius * Math.sin(eRad)
    },
    mid: {
      x: arc.center.x + arc.radius * Math.cos(mRad),
      y: arc.center.y + arc.radius * Math.sin(mRad)
    }
  };
}

/**
 * Decodes AutoCAD `\U+XXXX` Unicode escape sequences and standard `%%d`/`%%p`/`%%c` glyph tokens.
 */
export function decodeAutoCadText(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/\\U\+([0-9A-Fa-f]{4})/gi, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _m;
    })
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, '∅')
    .replace(/%%[uUoO]/g, '');
}

/**
 * Strips AutoCAD MTEXT formatting codes (`\P`, `{\fArial|...;Text}`, `\H1.5x;`, `\A1;`, etc.)
 * into clean multi-line plain text without any HTML or unsafe evaluation.
 */
export function stripMTextFormatting(rawText: string): string {
  if (!rawText) return '';
  let text = rawText
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\\{/g, '__LBRACE__')
    .replace(/\\\}/g, '__RBRACE__')
    .replace(/\\\\/g, '__BSLASH__');

  // Decode \U+XXXX Unicode escapes before stripping braces/control sequences
  text = text.replace(/\\U\+([0-9A-Fa-f]{4})/gi, (_m, hex: string) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : _m;
  });

  // Remove MTEXT inline control sequences like \fArial|b0|i0|c0|p34; or \H2.5; or \C1; or \W0.8; or \A1; or \S1/2;
  text = text.replace(/\\[fFCcHhWwQqTtAa]\s*[^;{}]*;/g, '');
  text = text.replace(/\\S([^;{}]*);/g, (_m, frac: string) => frac.replace('^', '/').replace('#', '/'));
  text = text.replace(/\\[LlOoKk]/g, '');
  text = text.replace(/[{}]/g, '');

  // Decode %%d (degree), %%p (+/-), %%c (diameter)
  text = text
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, '∅')
    .replace(/%%[uUoO]/g, '');

  return text
    .replace(/__LBRACE__/g, '{')
    .replace(/__RBRACE__/g, '}')
    .replace(/__BSLASH__/g, '\\')
    .trim();
}

