import type { BoundingBox2D, Point2D } from '../core/CADTypes';

export interface CADViewportState {
  centerX: number;
  centerY: number;
  scale: number; // Screen CSS px per CAD world unit
  width: number;
  height: number;
}

export function createDefaultCADViewport(width = 1000, height = 700): CADViewportState {
  return {
    centerX: 5000,
    centerY: 4000,
    scale: 0.08,
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

export function fitViewportToExtents(
  extents: BoundingBox2D,
  width: number,
  height: number,
  paddingPx = 48
): CADViewportState {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const spanX = Math.max(1e-3, extents.maxX - extents.minX);
  const spanY = Math.max(1e-3, extents.maxY - extents.minY);
  const availW = Math.max(20, safeW - paddingPx * 2);
  const availH = Math.max(20, safeH - paddingPx * 2);
  const scale = Math.min(availW / spanX, availH / spanY);

  return {
    centerX: (extents.minX + extents.maxX) / 2,
    centerY: (extents.minY + extents.maxY) / 2,
    scale: Number.isFinite(scale) && scale > 0 ? Math.min(5000, Math.max(1e-6, scale)) : 0.1,
    width: safeW,
    height: safeH
  };
}

export function cadWorldToScreen(pt: Point2D, vp: CADViewportState): Point2D {
  return {
    x: vp.width / 2 + (pt.x - vp.centerX) * vp.scale,
    y: vp.height / 2 - (pt.y - vp.centerY) * vp.scale
  };
}

export function screenToCadWorld(pt: Point2D, vp: CADViewportState): Point2D {
  return {
    x: vp.centerX + (pt.x - vp.width / 2) / vp.scale,
    y: vp.centerY - (pt.y - vp.height / 2) / vp.scale
  };
}

export function zoomViewportAtScreenPoint(
  vp: CADViewportState,
  factor: number,
  screenX: number,
  screenY: number
): CADViewportState {
  const nextScale = Math.min(5000, Math.max(1e-6, vp.scale * factor));
  const worldUnderCursor = screenToCadWorld({ x: screenX, y: screenY }, vp);
  const nextCenterX = worldUnderCursor.x - (screenX - vp.width / 2) / nextScale;
  const nextCenterY = worldUnderCursor.y + (screenY - vp.height / 2) / nextScale;
  return {
    ...vp,
    centerX: nextCenterX,
    centerY: nextCenterY,
    scale: nextScale
  };
}

export function getVisibleWorldBounds(vp: CADViewportState, bufferPx = 60): BoundingBox2D {
  const topLeft = screenToCadWorld({ x: -bufferPx, y: -bufferPx }, vp);
  const bottomRight = screenToCadWorld({ x: vp.width + bufferPx, y: vp.height + bufferPx }, vp);
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, bottomRight.y)
  };
}
