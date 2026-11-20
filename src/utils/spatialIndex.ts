export interface SpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QuadtreeEntry<T> {
  item: T;
  rect: SpatialRect;
}

function rectsIntersect(a: SpatialRect, b: SpatialRect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/**
 * Lightweight 2D Quadtree for O(log N + K) viewport culling & spatial queries
 * on large infrastructure topologies (thousands of nodes, rooms, and cable segments).
 */
export class Quadtree<T> {
  private readonly bounds: SpatialRect;
  private readonly maxItems: number;
  private readonly maxDepth: number;
  private readonly depth: number;
  private entries: Array<QuadtreeEntry<T>> = [];
  private children: [Quadtree<T>, Quadtree<T>, Quadtree<T>, Quadtree<T>] | null = null;

  constructor(bounds: SpatialRect, maxItems = 12, maxDepth = 7, depth = 0) {
    this.bounds = bounds;
    this.maxItems = Math.max(4, maxItems);
    this.maxDepth = Math.max(1, maxDepth);
    this.depth = depth;
  }

  private subdivide(): [Quadtree<T>, Quadtree<T>, Quadtree<T>, Quadtree<T>] {
    const halfW = this.bounds.width / 2;
    const halfH = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;
    const nextDepth = this.depth + 1;

    const children: [Quadtree<T>, Quadtree<T>, Quadtree<T>, Quadtree<T>] = [
      new Quadtree<T>({ x: x + halfW, y, width: halfW, height: halfH }, this.maxItems, this.maxDepth, nextDepth),
      new Quadtree<T>({ x, y, width: halfW, height: halfH }, this.maxItems, this.maxDepth, nextDepth),
      new Quadtree<T>({ x, y: y + halfH, width: halfW, height: halfH }, this.maxItems, this.maxDepth, nextDepth),
      new Quadtree<T>({ x: x + halfW, y: y + halfH, width: halfW, height: halfH }, this.maxItems, this.maxDepth, nextDepth)
    ];
    this.children = children;
    return children;
  }

  private getChildIndices(rect: SpatialRect): number[] {
    const midX = this.bounds.x + this.bounds.width / 2;
    const midY = this.bounds.y + this.bounds.height / 2;
    const top = rect.y <= midY;
    const bottom = rect.y + rect.height >= midY;
    const left = rect.x <= midX;
    const right = rect.x + rect.width >= midX;

    const indices: number[] = [];
    if (top && right) indices.push(0);
    if (top && left) indices.push(1);
    if (bottom && left) indices.push(2);
    if (bottom && right) indices.push(3);
    return indices;
  }

  insert(item: T, rect: SpatialRect): void {
    if (!rectsIntersect(this.bounds, rect)) {
      // Keep items slightly outside nominal bounds attached at root so nothing is dropped
      if (this.depth === 0) {
        this.entries.push({ item, rect });
      }
      return;
    }

    if (this.children) {
      const indices = this.getChildIndices(rect);
      if (indices.length === 1) {
        this.children[indices[0]].insert(item, rect);
        return;
      }
      this.entries.push({ item, rect });
      return;
    }

    this.entries.push({ item, rect });

    if (
      this.entries.length > this.maxItems &&
      this.depth < this.maxDepth &&
      this.bounds.width > 16 &&
      this.bounds.height > 16
    ) {
      const subdivided = this.subdivide();
      const retained: Array<QuadtreeEntry<T>> = [];
      for (const entry of this.entries) {
        const indices = this.getChildIndices(entry.rect);
        if (indices.length === 1) {
          subdivided[indices[0]].insert(entry.item, entry.rect);
        } else {
          retained.push(entry);
        }
      }
      this.entries = retained;
    }
  }

  queryRect(range: SpatialRect, result: T[] = []): T[] {
    if (!rectsIntersect(this.bounds, range) && this.depth > 0) {
      return result;
    }
    for (const entry of this.entries) {
      if (rectsIntersect(entry.rect, range)) {
        result.push(entry.item);
      }
    }
    if (this.children) {
      for (const child of this.children) {
        if (rectsIntersect(child.bounds, range)) {
          child.queryRect(range, result);
        }
      }
    }
    return result;
  }

  static fromItems<T>(
    items: readonly T[],
    getRect: (item: T) => SpatialRect | null | undefined,
    options?: { maxItems?: number; maxDepth?: number }
  ): Quadtree<T> {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const valid: Array<{ item: T; rect: SpatialRect }> = [];
    for (const item of items) {
      const r = getRect(item);
      if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
      const w = Math.max(1, Number.isFinite(r.width) ? r.width : 1);
      const h = Math.max(1, Number.isFinite(r.height) ? r.height : 1);
      const rect: SpatialRect = { x: r.x, y: r.y, width: w, height: h };
      valid.push({ item, rect });
      if (rect.x < minX) minX = rect.x;
      if (rect.y < minY) minY = rect.y;
      if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
      if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
    }

    const bounds: SpatialRect =
      valid.length > 0
        ? {
            x: minX - 32,
            y: minY - 32,
            width: Math.max(128, maxX - minX + 64),
            height: Math.max(128, maxY - minY + 64)
          }
        : { x: -2000, y: -2000, width: 4000, height: 4000 };

    const tree = new Quadtree<T>(bounds, options?.maxItems ?? 12, options?.maxDepth ?? 7);
    for (const entry of valid) {
      tree.insert(entry.item, entry.rect);
    }
    return tree;
  }
}

export function computeWorldViewportRect(
  pan: { x: number; y: number },
  zoom: number,
  viewportSize: { w: number; h: number },
  bufferPx = 350
): SpatialRect {
  const safeZoom = Math.max(0.05, zoom || 1);
  const minX = -pan.x / safeZoom - bufferPx;
  const minY = -pan.y / safeZoom - bufferPx;
  const maxX = (viewportSize.w - pan.x) / safeZoom + bufferPx;
  const maxY = (viewportSize.h - pan.y) / safeZoom + bufferPx;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

/**
 * Computes the proportional pan coordinates needed so the world point beneath
 * `(pointerX, pointerY)` stays pixel-locked when zoom changes from `prevZoom` to `nextZoom`.
 */
export function computeZoomToPointerPan(
  pan: { x: number; y: number },
  prevZoom: number,
  nextZoom: number,
  pointerX: number,
  pointerY: number
): { x: number; y: number } {
  const safePrev = Math.max(0.05, prevZoom || 1);
  const safeNext = Math.max(0.05, nextZoom || 1);
  if (safePrev === safeNext) {
    return { x: pan.x, y: pan.y };
  }
  const worldX = (pointerX - pan.x) / safePrev;
  const worldY = (pointerY - pan.y) / safePrev;
  return {
    x: pointerX - worldX * safeNext,
    y: pointerY - worldY * safeNext
  };
}

export function rectsOverlap(a: SpatialRect, b: SpatialRect): boolean {
  return rectsIntersect(a, b);
}

export function computePolylineBounds(
  points: readonly { x: number; y: number }[],
  paddingPx = 24
): SpatialRect | null {
  if (!points || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  if (!Number.isFinite(minX)) return null;
  const pad = Math.max(0, paddingPx);
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2)
  };
}

export function distancePointToSegmentSq(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-6) {
    const ox = px - x1;
    const oy = py - y1;
    return ox * ox + oy * oy;
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const ox = px - projX;
  const oy = py - projY;
  return ox * ox + oy * oy;
}

export function hitTestCablePolyline(
  px: number,
  py: number,
  points: readonly { x: number; y: number }[],
  tolerancePx = 8
): boolean {
  if (!points || points.length < 2) return false;
  const maxDistSq = tolerancePx * tolerancePx;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (distancePointToSegmentSq(px, py, a.x, a.y, b.x, b.y) <= maxDistSq) {
      return true;
    }
  }
  return false;
}

/**
 * Queries entities intersecting the visible viewport via Quadtree while preserving
 * pinned entities (e.g. selected, hovered, connecting, or legend nodes).
 */
export function cullEntitiesWithQuadtree<T extends { id: string }>(
  tree: Quadtree<T>,
  allItems: readonly T[],
  viewRect: SpatialRect,
  shouldAlwaysInclude?: (item: T) => boolean
): T[] {
  const hits = tree.queryRect(viewRect);
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of hits) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }

  if (shouldAlwaysInclude) {
    for (const item of allItems) {
      if (!seen.has(item.id) && shouldAlwaysInclude(item)) {
        seen.add(item.id);
        result.push(item);
      }
    }
  }

  return result;
}
