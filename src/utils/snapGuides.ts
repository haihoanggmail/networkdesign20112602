export interface AlignRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceKind?: 'node' | 'container';
  label?: string;
}

export interface AlignmentGuideLine {
  orientation: 'vertical' | 'horizontal';
  pos: number;
  from: number;
  to: number;
  kind: 'center' | 'edge';
  sourceKind: 'node' | 'container' | 'guide';
  alignLabel: string;
}

export interface SmartSnapResult {
  dx: number;
  dy: number;
  guides: AlignmentGuideLine[];
}

export interface ReferenceGuideInput {
  orientation: 'horizontal' | 'vertical';
  pos: number;
}

/**
 * Computes AutoCAD/Visio-style Smart Snap offsets and alignment guide lines
 * when dragging node(s) near the center or edges of neighboring nodes, container boundaries,
 * or user-placed draggable reference guide lines.
 */
export function computeSmartSnap(
  draggedRect: { x: number; y: number; width: number; height: number },
  targetRects: AlignRect[],
  threshold = 7,
  referenceGuides: ReferenceGuideInput[] = []
): SmartSnapResult {
  const dragLeft = draggedRect.x;
  const dragCenterX = draggedRect.x + draggedRect.width / 2;
  const dragRight = draggedRect.x + draggedRect.width;

  const dragTop = draggedRect.y;
  const dragCenterY = draggedRect.y + draggedRect.height / 2;
  const dragBottom = draggedRect.y + draggedRect.height;

  interface MatchMeta {
    pos: number;
    minSpan: number;
    maxSpan: number;
    kind: 'center' | 'edge';
    sourceKind: 'node' | 'container' | 'guide';
    alignLabel: string;
  }

  let bestDx = 0;
  let bestDistX = threshold + 1;
  let bestXMatch: MatchMeta | null = null;

  let bestDy = 0;
  let bestDistY = threshold + 1;
  let bestYMatch: MatchMeta | null = null;

  for (const r of targetRects) {
    const rLeft = r.x;
    const rCenterX = r.x + r.width / 2;
    const rRight = r.x + r.width;

    const rTop = r.y;
    const rCenterY = r.y + r.height / 2;
    const rBottom = r.y + r.height;

    const srcKind: 'node' | 'container' = r.sourceKind || 'node';

    const xCandidates: Array<{ delta: number; pos: number; kind: 'center' | 'edge'; label: string }> = [
      { delta: rCenterX - dragCenterX, pos: rCenterX, kind: 'center', label: srcKind === 'container' ? 'Tâm khung' : 'Căn tâm' },
      { delta: rLeft - dragLeft, pos: rLeft, kind: 'edge', label: srcKind === 'container' ? 'Biên trái' : 'Cạnh trái' },
      { delta: rRight - dragRight, pos: rRight, kind: 'edge', label: srcKind === 'container' ? 'Biên phải' : 'Cạnh phải' },
      { delta: rLeft - dragRight, pos: rLeft, kind: 'edge', label: srcKind === 'container' ? 'Sát biên' : 'Tiếp giáp' },
      { delta: rRight - dragLeft, pos: rRight, kind: 'edge', label: srcKind === 'container' ? 'Sát biên' : 'Tiếp giáp' }
    ];

    for (const c of xCandidates) {
      const dist = Math.abs(c.delta);
      const minY = Math.min(dragTop, rTop) - 24;
      const maxY = Math.max(dragBottom, rBottom) + 24;
      if (dist <= threshold && dist < bestDistX - 0.25) {
        bestDistX = dist;
        bestDx = c.delta;
        bestXMatch = {
          pos: c.pos,
          minSpan: minY,
          maxSpan: maxY,
          kind: c.kind,
          sourceKind: srcKind,
          alignLabel: c.label
        };
      } else if (bestXMatch && Math.abs(c.pos - bestXMatch.pos) < 0.5 && Math.abs(dist - bestDistX) <= 0.25) {
        bestXMatch.minSpan = Math.min(bestXMatch.minSpan, minY);
        bestXMatch.maxSpan = Math.max(bestXMatch.maxSpan, maxY);
      }
    }

    const yCandidates: Array<{ delta: number; pos: number; kind: 'center' | 'edge'; label: string }> = [
      { delta: rCenterY - dragCenterY, pos: rCenterY, kind: 'center', label: srcKind === 'container' ? 'Tâm khung' : 'Căn giữa' },
      { delta: rTop - dragTop, pos: rTop, kind: 'edge', label: srcKind === 'container' ? 'Biên trên' : 'Cạnh trên' },
      { delta: rBottom - dragBottom, pos: rBottom, kind: 'edge', label: srcKind === 'container' ? 'Biên dưới' : 'Cạnh dưới' },
      { delta: rTop - dragBottom, pos: rTop, kind: 'edge', label: srcKind === 'container' ? 'Sát biên' : 'Tiếp giáp' },
      { delta: rBottom - dragTop, pos: rBottom, kind: 'edge', label: srcKind === 'container' ? 'Sát biên' : 'Tiếp giáp' }
    ];

    for (const c of yCandidates) {
      const dist = Math.abs(c.delta);
      const minX = Math.min(dragLeft, rLeft) - 24;
      const maxX = Math.max(dragRight, rRight) + 24;
      if (dist <= threshold && dist < bestDistY - 0.25) {
        bestDistY = dist;
        bestDy = c.delta;
        bestYMatch = {
          pos: c.pos,
          minSpan: minX,
          maxSpan: maxX,
          kind: c.kind,
          sourceKind: srcKind,
          alignLabel: c.label
        };
      } else if (bestYMatch && Math.abs(c.pos - bestYMatch.pos) < 0.5 && Math.abs(dist - bestDistY) <= 0.25) {
        bestYMatch.minSpan = Math.min(bestYMatch.minSpan, minX);
        bestYMatch.maxSpan = Math.max(bestYMatch.maxSpan, maxX);
      }
    }
  }

  for (const g of referenceGuides) {
    if (!Number.isFinite(g.pos)) continue;
    if (g.orientation === 'vertical') {
      const candidates: Array<{ delta: number; kind: 'center' | 'edge'; label: string }> = [
        { delta: g.pos - dragCenterX, kind: 'center', label: 'Đường gióng (Tâm)' },
        { delta: g.pos - dragLeft, kind: 'edge', label: 'Đường gióng (Trái)' },
        { delta: g.pos - dragRight, kind: 'edge', label: 'Đường gióng (Phải)' }
      ];
      for (const c of candidates) {
        const dist = Math.abs(c.delta);
        if (dist <= threshold && dist < bestDistX - 0.25) {
          bestDistX = dist;
          bestDx = c.delta;
          bestXMatch = {
            pos: g.pos,
            minSpan: dragTop - 32,
            maxSpan: dragBottom + 32,
            kind: c.kind,
            sourceKind: 'guide',
            alignLabel: c.label
          };
        }
      }
    } else {
      const candidates: Array<{ delta: number; kind: 'center' | 'edge'; label: string }> = [
        { delta: g.pos - dragCenterY, kind: 'center', label: 'Đường gióng (Giữa)' },
        { delta: g.pos - dragTop, kind: 'edge', label: 'Đường gióng (Trên)' },
        { delta: g.pos - dragBottom, kind: 'edge', label: 'Đường gióng (Dưới)' }
      ];
      for (const c of candidates) {
        const dist = Math.abs(c.delta);
        if (dist <= threshold && dist < bestDistY - 0.25) {
          bestDistY = dist;
          bestDy = c.delta;
          bestYMatch = {
            pos: g.pos,
            minSpan: dragLeft - 32,
            maxSpan: dragRight + 32,
            kind: c.kind,
            sourceKind: 'guide',
            alignLabel: c.label
          };
        }
      }
    }
  }

  const guides: AlignmentGuideLine[] = [];
  if (bestXMatch) {
    guides.push({
      orientation: 'vertical',
      pos: bestXMatch.pos,
      from: bestXMatch.minSpan,
      to: bestXMatch.maxSpan,
      kind: bestXMatch.kind,
      sourceKind: bestXMatch.sourceKind,
      alignLabel: bestXMatch.alignLabel
    });
  }
  if (bestYMatch) {
    guides.push({
      orientation: 'horizontal',
      pos: bestYMatch.pos,
      from: bestYMatch.minSpan,
      to: bestYMatch.maxSpan,
      kind: bestYMatch.kind,
      sourceKind: bestYMatch.sourceKind,
      alignLabel: bestYMatch.alignLabel
    });
  }

  return { dx: bestDx, dy: bestDy, guides };
}

export interface SnapToGridAlignNodeInput {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
}

export type SnapToGridAlignMode = 'horizontal' | 'vertical' | 'grid-only';

/**
 * Computes Snap-to-Grid auto-aligned (x, y) coordinates for a selection of nodes.
 * - 'horizontal': Aligns selected nodes onto a single horizontal row snapped to gridSize,
 *   optionally enforcing uniform grid-snapped spacing along X without overlapping.
 * - 'vertical': Aligns selected nodes onto a single vertical column snapped to gridSize,
 *   optionally enforcing uniform grid-snapped spacing along Y without overlapping.
 * - 'grid-only': Snaps each node's current (x, y) independently to nearest grid intersection.
 */
export function computeSnapToGridAutoAlign(
  nodes: SnapToGridAlignNodeInput[],
  mode: SnapToGridAlignMode,
  gridSize: number,
  options?: { evenSpacing?: boolean; minPadding?: number }
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const unlocked = nodes.filter(n => !n.locked);
  if (unlocked.length === 0) return result;

  const snap = Math.max(5, Math.round(gridSize || 20));
  const snapCoord = (v: number) => Math.max(10, Math.round(v / snap) * snap);
  const evenSpacing = options?.evenSpacing ?? true;
  const minGap = Math.max(snap, Math.round((options?.minPadding ?? 40) / snap) * snap);

  if (mode === 'grid-only') {
    for (const n of unlocked) {
      result.set(n.id, { x: snapCoord(n.x), y: snapCoord(n.y) });
    }
    return result;
  }

  if (mode === 'horizontal') {
    const avgCenterY =
      unlocked.reduce((sum, n) => sum + n.y + n.height / 2, 0) / unlocked.length;
    const snappedLineCenterY = snapCoord(avgCenterY);
    const sorted = [...unlocked].sort((a, b) => a.x - b.x || a.y - b.y);

    if (evenSpacing && sorted.length >= 2) {
      let cursorX = snapCoord(sorted[0].x);
      for (const n of sorted) {
        const alignedY = snapCoord(snappedLineCenterY - n.height / 2);
        result.set(n.id, { x: cursorX, y: alignedY });
        cursorX = snapCoord(cursorX + n.width + minGap);
      }
    } else {
      for (const n of sorted) {
        result.set(n.id, {
          x: snapCoord(n.x),
          y: snapCoord(snappedLineCenterY - n.height / 2)
        });
      }
    }
    return result;
  }

  // mode === 'vertical'
  const avgCenterX =
    unlocked.reduce((sum, n) => sum + n.x + n.width / 2, 0) / unlocked.length;
  const snappedLineCenterX = snapCoord(avgCenterX);
  const sorted = [...unlocked].sort((a, b) => a.y - b.y || a.x - b.x);

  if (evenSpacing && sorted.length >= 2) {
    let cursorY = snapCoord(sorted[0].y);
    for (const n of sorted) {
      const alignedX = snapCoord(snappedLineCenterX - n.width / 2);
      result.set(n.id, { x: alignedX, y: cursorY });
      cursorY = snapCoord(cursorY + n.height + minGap);
    }
  } else {
    for (const n of sorted) {
      result.set(n.id, {
        x: snapCoord(snappedLineCenterX - n.width / 2),
        y: snapCoord(n.y)
      });
    }
  }

  return result;
}

export interface OverlapRectInput {
  id: string;
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeOverlapPair {
  aId: string;
  bId: string;
  overlapRect: { x: number; y: number; width: number; height: number };
}

export interface NodeOverlapReport {
  overlappingNodeIds: Set<string>;
  overlapCountByNodeId: Map<string, number>;
  pairs: NodeOverlapPair[];
}

/**
 * Detects pairs of visible nodes/racks whose bounding boxes overlap beyond `minOverlapPx`
 * (ignoring exact edge-touching / snapped-adjacent placement where intersection <= minOverlapPx).
 */
export function detectOverlappingNodes(
  nodes: OverlapRectInput[],
  minOverlapPx = 2
): NodeOverlapReport {
  const overlappingNodeIds = new Set<string>();
  const overlapCountByNodeId = new Map<string, number>();
  const pairs: NodeOverlapPair[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a.width <= 0 || a.height <= 0) continue;

    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (b.width <= 0 || b.height <= 0) continue;

      const ix1 = Math.max(a.x, b.x);
      const iy1 = Math.max(a.y, b.y);
      const ix2 = Math.min(a.x + a.width, b.x + b.width);
      const iy2 = Math.min(a.y + a.height, b.y + b.height);

      const iw = ix2 - ix1;
      const ih = iy2 - iy1;

      if (iw > minOverlapPx && ih > minOverlapPx) {
        overlappingNodeIds.add(a.id);
        overlappingNodeIds.add(b.id);
        overlapCountByNodeId.set(a.id, (overlapCountByNodeId.get(a.id) || 0) + 1);
        overlapCountByNodeId.set(b.id, (overlapCountByNodeId.get(b.id) || 0) + 1);
        pairs.push({
          aId: a.id,
          bId: b.id,
          overlapRect: { x: ix1, y: iy1, width: iw, height: ih }
        });
      }
    }
  }

  return {
    overlappingNodeIds,
    overlapCountByNodeId,
    pairs
  };
}

