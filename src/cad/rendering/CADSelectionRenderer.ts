import type { CADEntity, Point2D } from '../core/CADTypes';
import type { CADSnapResult } from '../geometry/CADSnap';
import { getArcEndpoints } from '../geometry/CADCurve';
import { cadWorldToScreen, CADViewportState } from './CADViewport';

export interface CADMarqueeBox {
  startScreen: Point2D;
  endScreen: Point2D;
  mode: 'window' | 'crossing';
}

export interface CADInteractionOverlay {
  marquee?: CADMarqueeBox | null;
  snap?: CADSnapResult | null;
  rubberBandPoints?: Point2D[];
  liveCircle?: { center: Point2D; radius: number } | null;
  liveArc?: { center: Point2D; radius: number; startAngle: number; endAngle: number } | null;
  liveRect?: { a: Point2D; b: Point2D } | null;
  measureSegment?: { start: Point2D; end: Point2D; label: string } | null;
}

function collectEntityGrips(entity: CADEntity): Point2D[] {
  switch (entity.type) {
    case 'LINE':
      return [
        entity.start,
        { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 },
        entity.end
      ];
    case 'POINT':
      return [entity.position];
    case 'CIRCLE':
      return [
        entity.center,
        { x: entity.center.x + entity.radius, y: entity.center.y },
        { x: entity.center.x - entity.radius, y: entity.center.y },
        { x: entity.center.x, y: entity.center.y + entity.radius },
        { x: entity.center.x, y: entity.center.y - entity.radius }
      ];
    case 'ARC': {
      const ends = getArcEndpoints(entity);
      return [entity.center, ends.start, ends.mid, ends.end];
    }
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return entity.vertices.slice(0, 64).map(v => ({ x: v.x, y: v.y }));
    case 'TEXT':
    case 'MTEXT':
    case 'ATTRIB':
    case 'ATTDEF':
    case 'INSERT':
      return [entity.position];
    case 'DIMENSION':
      return [entity.defPoint, entity.textMidPoint];
    case 'UNKNOWN':
      return entity.previewPoint ? [entity.previewPoint] : [];
    default:
      return [];
  }
}

export function renderCADSelectionAndOverlays(
  ctx: CanvasRenderingContext2D,
  selectedEntities: CADEntity[],
  vp: CADViewportState,
  overlay?: CADInteractionOverlay
): void {
  // 1. Selected grips
  if (selectedEntities.length > 0 && selectedEntities.length <= 200) {
    ctx.save();
    for (const ent of selectedEntities) {
      const grips = collectEntityGrips(ent);
      for (let i = 0; i < grips.length; i++) {
        const sp = cadWorldToScreen(grips[i], vp);
        ctx.fillStyle = i === 0 ? '#38bdf8' : '#2563eb';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.25;
        ctx.fillRect(sp.x - 4, sp.y - 4, 8, 8);
        ctx.strokeRect(sp.x - 4, sp.y - 4, 8, 8);
      }
    }
    ctx.restore();
  }

  if (!overlay) return;

  // 2. Rubber-band polyline / measure
  if (overlay.rubberBandPoints && overlay.rubberBandPoints.length >= 2) {
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    overlay.rubberBandPoints.forEach((pt, idx) => {
      const sp = cadWorldToScreen(pt, vp);
      if (idx === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  if (overlay.liveCircle && overlay.liveCircle.radius > 0) {
    const c = cadWorldToScreen(overlay.liveCircle.center, vp);
    const rPx = overlay.liveCircle.radius * vp.scale;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (overlay.liveArc && overlay.liveArc.radius > 0) {
    const c = cadWorldToScreen(overlay.liveArc.center, vp);
    const rPx = overlay.liveArc.radius * vp.scale;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(
      c.x,
      c.y,
      rPx,
      (-overlay.liveArc.startAngle * Math.PI) / 180,
      (-overlay.liveArc.endAngle * Math.PI) / 180,
      true
    );
    ctx.stroke();
    ctx.restore();
  }

  if (overlay.liveRect) {
    const sa = cadWorldToScreen(overlay.liveRect.a, vp);
    const sb = cadWorldToScreen(overlay.liveRect.b, vp);
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      Math.min(sa.x, sb.x),
      Math.min(sa.y, sb.y),
      Math.abs(sb.x - sa.x),
      Math.abs(sb.y - sa.y)
    );
    ctx.restore();
  }

  if (overlay.measureSegment) {
    const s = cadWorldToScreen(overlay.measureSegment.start, vp);
    const e = cadWorldToScreen(overlay.measureSegment.end, vp);
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.stroke();

    const mx = (s.x + e.x) / 2;
    const my = (s.y + e.y) / 2;
    ctx.setLineDash([]);
    ctx.font = '600 12px Inter, sans-serif';
    const textW = ctx.measureText(overlay.measureSegment.label).width;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(mx - textW / 2 - 8, my - 22, textW + 16, 22);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - textW / 2 - 8, my - 22, textW + 16, 22);
    ctx.fillStyle = '#fde68a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(overlay.measureSegment.label, mx, my - 11);
    ctx.restore();
  }

  // 3. Marquee Window (blue solid) vs Crossing (green dashed)
  if (overlay.marquee) {
    const { startScreen, endScreen, mode } = overlay.marquee;
    const x = Math.min(startScreen.x, endScreen.x);
    const y = Math.min(startScreen.y, endScreen.y);
    const w = Math.abs(endScreen.x - startScreen.x);
    const h = Math.abs(endScreen.y - startScreen.y);
    ctx.save();
    if (mode === 'window') {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
      ctx.strokeStyle = '#60a5fa';
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.14)';
      ctx.strokeStyle = '#4ade80';
      ctx.setLineDash([6, 4]);
    }
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // 4. OSNAP Glyph Marker
  if (overlay.snap) {
    const sp = cadWorldToScreen(overlay.snap.point, vp);
    ctx.save();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    const r = 6;
    switch (overlay.snap.mode) {
      case 'endpoint':
      case 'grid':
        ctx.strokeRect(sp.x - r, sp.y - r, r * 2, r * 2);
        break;
      case 'midpoint':
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - r);
        ctx.lineTo(sp.x + r, sp.y + r);
        ctx.lineTo(sp.x - r, sp.y + r);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'center':
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'intersection':
        ctx.beginPath();
        ctx.moveTo(sp.x - r, sp.y - r);
        ctx.lineTo(sp.x + r, sp.y + r);
        ctx.moveTo(sp.x + r, sp.y - r);
        ctx.lineTo(sp.x - r, sp.y + r);
        ctx.stroke();
        break;
      default:
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - r);
        ctx.lineTo(sp.x + r, sp.y);
        ctx.lineTo(sp.x, sp.y + r);
        ctx.lineTo(sp.x - r, sp.y);
        ctx.closePath();
        ctx.stroke();
        break;
    }

    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    const lbl = overlay.snap.labelVi.split(' (')[0];
    const tw = ctx.measureText(lbl).width;
    ctx.fillRect(sp.x + 10, sp.y - 18, tw + 8, 16);
    ctx.fillStyle = '#4ade80';
    ctx.fillText(lbl, sp.x + 14, sp.y - 6);
    ctx.restore();
  }
}
