import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CableEdge, CableTray, SelectionState } from '../../types/infrastructure';
import {
  CableBundleInfo,
  CableBundleLayout,
  normalizeCableColor,
  RectBox,
  resolveCableLabelTransform
} from '../../utils/cableRouting';
import { computePolylineBounds, rectsOverlap, SpatialRect } from '../../utils/spatialIndex';
import type { CableRenderWorkerMessage } from '../../workers/cableRender.worker';
import { CanvasCableGeometry } from './canvasTypes';

export const RASTER_CABLE_DENSE_THRESHOLD = 100;
export const RASTER_CABLE_PAN_THRESHOLD = 25;

// Bounded Path2D LRU-like cache keyed by SVG path string so pan/zoom doesn't re-parse SVG path commands
const path2dCache = new Map<string, Path2D>();
const MAX_PATH2D_CACHE = 4000;

function getCachedPath2D(pathD: string): Path2D | null {
  if (typeof Path2D === 'undefined' || !pathD) return null;
  let cached = path2dCache.get(pathD);
  if (!cached) {
    if (path2dCache.size >= MAX_PATH2D_CACHE) {
      path2dCache.clear();
    }
    cached = new Path2D(pathD);
    path2dCache.set(pathD, cached);
  }
  return cached;
}

export function shouldUseRasterCableLayer(
  culledCableCount: number,
  isPanning: boolean,
  isTransformingNodes = false,
  thresholds?: { dense?: number; pan?: number }
): boolean {
  const denseLimit = thresholds?.dense ?? RASTER_CABLE_DENSE_THRESHOLD;
  const panLimit = thresholds?.pan ?? RASTER_CABLE_PAN_THRESHOLD;
  return (
    culledCableCount >= denseLimit ||
    ((isPanning || isTransformingNodes) && culledCableCount >= panLimit)
  );
}

export function filterCableBundlesInViewport(
  bundles: readonly CableBundleInfo[],
  viewRect: SpatialRect,
  getCableGeometry: (cable: CableEdge) => CanvasCableGeometry | null,
  activeBundleId: string | null,
  selectedEdgeId?: string
): CableBundleInfo[] {
  if (bundles.length <= 12) {
    return bundles as CableBundleInfo[];
  }
  return bundles.filter(bundle => {
    if (bundle.bundleId === activeBundleId) return true;
    if (selectedEdgeId && bundle.cables.some(c => c.id === selectedEdgeId)) return true;

    const midInView =
      bundle.midPoint.x >= viewRect.x &&
      bundle.midPoint.x <= viewRect.x + viewRect.width &&
      bundle.midPoint.y >= viewRect.y &&
      bundle.midPoint.y <= viewRect.y + viewRect.height;
    if (midInView) return true;

    const first = bundle.cables[0];
    const geom = first ? getCableGeometry(first) : null;
    if (!geom) return false;
    const bounds = computePolylineBounds(geom.pts, Math.max(24, bundle.spanWidthPx + 12));
    return bounds ? rectsOverlap(bounds, viewRect) : false;
  });
}

/* --------------------------------------------------------------------------
 * 1. Independent Worker + OffscreenCanvas Raster Layer for Static Cables
 * -------------------------------------------------------------------------- */

export interface CanvasCableRasterLayerProps {
  active: boolean;
  viewportSize: { w: number; h: number };
  pan: { x: number; y: number };
  zoom: number;
  culledCables: CableEdge[];
  culledBundles: CableBundleInfo[];
  cableToBundleId: Map<string, string>;
  collapsedBundleIds: Set<string>;
  interactiveCableIds: Set<string>;
  staticNodeRectEntries?: Array<[string, RectBox]>;
  getCableGeometry: (cable: CableEdge) => CanvasCableGeometry | null;
  showCableLabels: boolean;
  showCableCodes: boolean;
  isPanning: boolean;
  isTransformingNodes?: boolean;
}

function createOffscreenBuffer(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const el = document.createElement('canvas');
    el.width = width;
    el.height = height;
    return el;
  }
  return null;
}

function canTransferOffscreenToWorker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
  );
}

export const CanvasCableRasterLayer: React.FC<CanvasCableRasterLayerProps> = React.memo(({
  active,
  viewportSize,
  pan,
  zoom,
  culledCables,
  culledBundles,
  cableToBundleId,
  collapsedBundleIds,
  interactiveCableIds,
  staticNodeRectEntries,
  getCableGeometry,
  showCableLabels,
  showCableCodes,
  isPanning,
  isTransformingNodes = false
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  const [workerFallbackMode, setWorkerFallbackMode] = useState<boolean>(() => !canTransferOffscreenToWorker());
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  const lastWorkerSyncRef = useRef<{
    active: boolean;
    culledCables: CableEdge[];
    staticNodeRectEntries: Array<[string, RectBox]> | undefined;
    interactiveCableIds: Set<string>;
    collapsedBundleIds: Set<string>;
    hasSyncedOnce: boolean;
  } | null>(null);

  const lastStaticCacheDepsRef = useRef<{
    targetW: number;
    targetH: number;
    panX: number;
    panY: number;
    zoom: number;
    culledCables: CableEdge[];
    culledBundles: CableBundleInfo[];
    cableToBundleId: Map<string, string>;
    collapsedBundleIds: Set<string>;
    interactiveCableIds: Set<string>;
    getCableGeometry: (cable: CableEdge) => CanvasCableGeometry | null;
    showCableLabels: boolean;
    showCableCodes: boolean;
    isPanning: boolean;
  } | null>(null);

  // Imperatively mount <canvas> inside hostRef so React StrictMode remounts never reuse a transferred canvas
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvasEl = document.createElement('canvas');
    canvasEl.className = 'w-full h-full block pointer-events-none';
    host.appendChild(canvasEl);

    if (!workerFallbackMode && canTransferOffscreenToWorker() && staticNodeRectEntries) {
      let worker: Worker | null = null;
      try {
        worker = new Worker(new URL('../../workers/cableRender.worker.ts', import.meta.url), {
          type: 'module'
        });
        const offscreen = canvasEl.transferControlToOffscreen();
        const initMsg: CableRenderWorkerMessage = { type: 'INIT_CANVAS', canvas: offscreen };
        worker.postMessage(initMsg, [offscreen]);
        worker.onerror = () => {
          workerRef.current = null;
          setWorkerFallbackMode(true);
        };
        workerRef.current = worker;
        canvasRef.current = null;
        lastWorkerSyncRef.current = null;
        setCanvasEpoch(e => e + 1);

        return () => {
          workerRef.current = null;
          lastWorkerSyncRef.current = null;
          try {
            worker?.terminate();
          } catch {
            // ignore worker termination failure
          }
          canvasEl.remove();
        };
      } catch {
        if (worker) {
          try {
            worker.terminate();
          } catch {
            // ignore
          }
        }
        workerRef.current = null;
        canvasRef.current = canvasEl;
        setWorkerFallbackMode(true);
        setCanvasEpoch(e => e + 1);
        return () => {
          canvasRef.current = null;
          canvasEl.remove();
        };
      }
    }

    workerRef.current = null;
    canvasRef.current = canvasEl;
    setCanvasEpoch(e => e + 1);
    return () => {
      canvasRef.current = null;
      canvasEl.remove();
    };
    // Intentionally mount/remount worker only when fallback mode flips or rect feed initializes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerFallbackMode, Boolean(staticNodeRectEntries)]);

  useEffect(() => {
    const worker = workerRef.current;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const targetW = Math.max(1, Math.round(viewportSize.w * dpr));
    const targetH = Math.max(1, Math.round(viewportSize.h * dpr));

    if (worker && staticNodeRectEntries) {
      const prev = lastWorkerSyncRef.current;
      if (!active) {
        if (prev?.active) {
          worker.postMessage({ type: 'CLEAR' } satisfies CableRenderWorkerMessage);
          lastWorkerSyncRef.current = { ...prev, active: false };
        }
        return;
      }

      const geometryChanged =
        !prev ||
        !prev.hasSyncedOnce ||
        prev.culledCables !== culledCables ||
        prev.staticNodeRectEntries !== staticNodeRectEntries;
      const membershipChanged =
        !prev ||
        prev.interactiveCableIds !== interactiveCableIds ||
        prev.collapsedBundleIds !== collapsedBundleIds;

      const viewport = {
        width: viewportSize.w,
        height: viewportSize.h,
        dpr,
        panX: pan.x,
        panY: pan.y,
        zoom
      };
      const options = {
        active: true,
        showCableLabels,
        showCableCodes,
        isPanning,
        isTransformingNodes
      };

      if (geometryChanged || membershipChanged) {
        const msg: CableRenderWorkerMessage = {
          type: 'SYNC_SCENE',
          scene: {
            cables: culledCables,
            nodeRectEntries: staticNodeRectEntries,
            interactiveCableIds: Array.from(interactiveCableIds),
            collapsedBundleIds: Array.from(collapsedBundleIds),
            recomputeRouting: geometryChanged
          },
          viewport,
          options
        };
        worker.postMessage(msg);
      } else {
        const msg: CableRenderWorkerMessage = {
          type: 'RENDER_VIEWPORT',
          viewport,
          options
        };
        worker.postMessage(msg);
      }

      lastWorkerSyncRef.current = {
        active: true,
        culledCables,
        staticNodeRectEntries,
        interactiveCableIds,
        collapsedBundleIds,
        hasSyncedOnce: true
      };
      return;
    }

    // Fallback: main-thread OffscreenCanvas backing buffer
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!active) {
      return;
    }

    const prevDeps = lastStaticCacheDepsRef.current;
    const staticGeometrySame = Boolean(
      prevDeps &&
      prevDeps.targetW === targetW &&
      prevDeps.targetH === targetH &&
      prevDeps.panX === pan.x &&
      prevDeps.panY === pan.y &&
      prevDeps.zoom === zoom &&
      prevDeps.culledCables === culledCables &&
      prevDeps.culledBundles === culledBundles &&
      prevDeps.cableToBundleId === cableToBundleId &&
      prevDeps.collapsedBundleIds === collapsedBundleIds &&
      prevDeps.interactiveCableIds === interactiveCableIds &&
      prevDeps.showCableLabels === showCableLabels &&
      prevDeps.showCableCodes === showCableCodes &&
      prevDeps.isPanning === isPanning &&
      (prevDeps.getCableGeometry === getCableGeometry || isTransformingNodes)
    );

    if (!offscreenRef.current) {
      offscreenRef.current = createOffscreenBuffer(targetW, targetH);
    } else if (offscreenRef.current.width !== targetW || offscreenRef.current.height !== targetH) {
      offscreenRef.current.width = targetW;
      offscreenRef.current.height = targetH;
    }

    const offscreen = offscreenRef.current;
    const drawTarget = (offscreen?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null) || ctx;
    const usingOffscreen = Boolean(offscreen && drawTarget !== ctx);

    if (!usingOffscreen || !staticGeometrySame) {
      drawTarget.setTransform(1, 0, 0, 1, 0, 0);
      drawTarget.clearRect(0, 0, targetW, targetH);
      drawTarget.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y);
      drawTarget.lineCap = 'round';
      drawTarget.lineJoin = 'round';

      // 1. Collapsed bundle trunk sheaths (static)
      for (const bundle of culledBundles) {
        if (!collapsedBundleIds.has(bundle.bundleId)) continue;
        const firstCable = bundle.cables[0];
        const trunkGeom = firstCable ? getCableGeometry(firstCable) : null;
        if (!trunkGeom) continue;

        const p2d = getCachedPath2D(trunkGeom.pathD);
        const baseWidth = Math.min(10, 3.5 + bundle.cables.length * 0.9);
        drawTarget.save();
        drawTarget.globalAlpha = 0.92;
        drawTarget.strokeStyle = bundle.primaryColor;
        drawTarget.lineWidth = baseWidth;
        drawTarget.setLineDash([]);
        if (p2d) {
          drawTarget.stroke(p2d as Path2D);
        } else {
          drawTarget.beginPath();
          trunkGeom.pts.forEach((pt, idx) => (idx === 0 ? drawTarget.moveTo(pt.x, pt.y) : drawTarget.lineTo(pt.x, pt.y)));
          drawTarget.stroke();
        }
        drawTarget.globalAlpha = 0.65;
        drawTarget.strokeStyle = '#ffffff';
        drawTarget.lineWidth = 1.2;
        drawTarget.setLineDash([4, 6]);
        if (p2d) {
          drawTarget.stroke(p2d as Path2D);
        } else {
          drawTarget.stroke();
        }
        drawTarget.restore();
      }

      // 2. Non-interactive cables (selected / hovered / dragging-endpoint cables stay in SVG)
      for (const cable of culledCables) {
        if (interactiveCableIds.has(cable.id)) continue;
        const bundleId = cableToBundleId.get(cable.id);
        if (bundleId && collapsedBundleIds.has(bundleId)) continue;

        const geom = getCableGeometry(cable);
        if (!geom) continue;

        const cableColor = normalizeCableColor(cable.color || '#0284c7');
        const p2d = getCachedPath2D(geom.pathD);

        drawTarget.strokeStyle = cableColor;
        drawTarget.lineWidth = cable.strokeWidth || 2;
        drawTarget.setLineDash(cable.lineStyle === 'dashed' ? [6, 4] : []);
        if (p2d) {
          drawTarget.stroke(p2d as Path2D);
        } else {
          drawTarget.beginPath();
          geom.pts.forEach((pt, idx) => (idx === 0 ? drawTarget.moveTo(pt.x, pt.y) : drawTarget.lineTo(pt.x, pt.y)));
          drawTarget.stroke();
        }
      }

      // 3. Static cable label badges (skipped mid-pan when zoom < 0.7 or ultra-dense to hold 60 FPS)
      if (showCableLabels && !isPanning && zoom >= 0.6 && culledCables.length <= 260) {
        drawTarget.setLineDash([]);
        for (const cable of culledCables) {
          if (interactiveCableIds.has(cable.id)) continue;
          const bundleId = cableToBundleId.get(cable.id);
          const isBundled = Boolean(bundleId);
          if (bundleId && collapsedBundleIds.has(bundleId)) continue;

          const hasCustomLabel = Boolean(cable.label && cable.label.trim().length > 0);
          if (!((showCableCodes || hasCustomLabel) && (!isBundled || hasCustomLabel))) continue;

          const geom = getCableGeometry(cable);
          if (!geom || geom.midX === 0) continue;

          const cableColor = normalizeCableColor(cable.color || '#0284c7');
          const lt = resolveCableLabelTransform(cable, {
            midPoint: { x: geom.midX, y: geom.midY },
            midAngleDeg: geom.midAngleDeg
          });

          const halfH = lt.badgeHeight / 2;
          const badgeLeft = -lt.badgeWidth / 2;
          const dotR = Math.max(2.4, Math.min(4.2, lt.fontSize * 0.28));
          const dotCx = badgeLeft + dotR + 5.5;
          const textOffsetX = dotR * 0.9 + 2;

          drawTarget.save();
          drawTarget.translate(lt.x, lt.y);
          if (lt.angleDeg) {
            drawTarget.rotate((lt.angleDeg * Math.PI) / 180);
          }

          drawTarget.fillStyle = 'rgba(255, 255, 255, 0.94)';
          drawTarget.strokeStyle = cableColor;
          drawTarget.lineWidth = 1.1;
          drawTarget.beginPath();
          if (typeof drawTarget.roundRect === 'function') {
            drawTarget.roundRect(badgeLeft, -halfH, lt.badgeWidth, lt.badgeHeight, 4);
          } else {
            drawTarget.rect(badgeLeft, -halfH, lt.badgeWidth, lt.badgeHeight);
          }
          drawTarget.fill();
          drawTarget.stroke();

          drawTarget.fillStyle = cableColor;
          drawTarget.beginPath();
          drawTarget.arc(dotCx, 0, dotR, 0, Math.PI * 2);
          drawTarget.fill();

          drawTarget.fillStyle = '#0f172a';
          drawTarget.font = `${hasCustomLabel ? '700' : '600'} ${lt.fontSize}px ${
            hasCustomLabel ? 'system-ui, sans-serif' : 'monospace'
          }`;
          drawTarget.textAlign = 'center';
          drawTarget.textBaseline = 'middle';
          drawTarget.fillText(lt.text, textOffsetX, 0.5);
          drawTarget.restore();
        }
      }

      lastStaticCacheDepsRef.current = {
        targetW,
        targetH,
        panX: pan.x,
        panY: pan.y,
        zoom,
        culledCables,
        culledBundles,
        cableToBundleId,
        collapsedBundleIds,
        interactiveCableIds,
        getCableGeometry,
        showCableLabels,
        showCableCodes,
        isPanning
      };
    }

    if (usingOffscreen && offscreen) {
      ctx.drawImage(offscreen as CanvasImageSource, 0, 0);
    }
  }, [
    active,
    canvasEpoch,
    viewportSize.w,
    viewportSize.h,
    pan.x,
    pan.y,
    zoom,
    culledCables,
    culledBundles,
    cableToBundleId,
    collapsedBundleIds,
    interactiveCableIds,
    staticNodeRectEntries,
    getCableGeometry,
    showCableLabels,
    showCableCodes,
    isPanning,
    isTransformingNodes
  ]);

  return (
    <div
      ref={hostRef}
      data-layer="cables-raster"
      aria-hidden="true"
      className="w-full h-full absolute inset-0 pointer-events-none"
    />
  );
});

CanvasCableRasterLayer.displayName = 'CanvasCableRasterLayer';

/* --------------------------------------------------------------------------
 * 2. Per-Cable Memoized SVG Item
 * -------------------------------------------------------------------------- */

interface MemoizedCableItemProps {
  cable: CableEdge;
  geom: CanvasCableGeometry;
  isSelected: boolean;
  isHovered: boolean;
  isBundled: boolean;
  isReadOnlyMode: boolean;
  onSelectEdge: (cableId: string) => void;
  onScheduleLongPress: (clientX: number, clientY: number, type: 'edge', id: string) => void;
  onContextMenu: (e: React.MouseEvent, cable: CableEdge) => void;
  onOpenInlineLabelEditor: (cable: CableEdge, x: number, y: number) => void;
  onHoverCable: (cableId: string | null) => void;
  onBeginDragSnapshot?: () => void;
  onStartWaypointDrag: (cableId: string, pointIndex: number) => void;
  onUpdateCable?: (cableId: string, updates: Partial<CableEdge>) => void;
  onUpdateCableControlPoints?: (cableId: string, controlPoints: { x: number; y: number }[]) => void;
  onStartReconnect: (cableId: string, endpoint: 'source' | 'target', anchorX: number, anchorY: number) => void;
}

const MemoizedCableItem = React.memo<MemoizedCableItemProps>(({
  cable,
  geom,
  isSelected,
  isHovered,
  isBundled,
  isReadOnlyMode,
  onSelectEdge,
  onScheduleLongPress,
  onContextMenu,
  onOpenInlineLabelEditor,
  onHoverCable,
  onBeginDragSnapshot,
  onStartWaypointDrag,
  onUpdateCable,
  onUpdateCableControlPoints,
  onStartReconnect
}) => {
  const { pathD, pts, x1, y1, x2, y2, midX, midY } = geom;
  const cableColor = normalizeCableColor(cable.color || '#0284c7');

  return (
    <g
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') {
          onScheduleLongPress(e.clientX, e.clientY, 'edge', cable.id);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, cable)}
      onClick={(e) => {
        e.stopPropagation();
        onSelectEdge(cable.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isReadOnlyMode && midX !== 0) {
          onOpenInlineLabelEditor(cable, midX, midY);
        }
      }}
      onPointerEnter={() => onHoverCable(cable.id)}
      onPointerLeave={() => onHoverCable(null)}
      className="cursor-pointer group"
    >
      <path d={pathD} fill="none" stroke="transparent" strokeWidth={isBundled ? 9 : 14} />

      {(isSelected || isHovered) && (
        <path
          d={pathD}
          fill="none"
          stroke={cableColor}
          strokeOpacity={isSelected ? 0.3 : 0.18}
          strokeWidth={cable.strokeWidth + (isSelected ? 8 : 5)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      <path
        d={pathD}
        fill="none"
        stroke={cableColor}
        strokeWidth={isSelected ? cable.strokeWidth + 1.5 : isHovered ? cable.strokeWidth + 0.75 : cable.strokeWidth}
        strokeDasharray={cable.lineStyle === 'dashed' ? '6 4' : 'none'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {isSelected && !isReadOnlyMode && (
        <g>
          {(cable.controlPoints || []).map((cp, idx) => (
            <circle
              key={`wp_${idx}`}
              cx={cp.x}
              cy={cp.y}
              r={6}
              fill="#f59e0b"
              stroke="#ffffff"
              strokeWidth="2"
              className="cursor-move"
              onPointerDown={(e) => {
                e.stopPropagation();
                onBeginDragSnapshot?.();
                onStartWaypointDrag(cable.id, idx);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (onUpdateCable) {
                  const nextPts = (cable.controlPoints || []).filter((_, i) => i !== idx);
                  onUpdateCable(cable.id, { controlPoints: nextPts.length ? nextPts : undefined });
                }
              }}
            >
              <title>Kéo để chỉnh điểm uốn · Nhấp đúp để xóa điểm uốn</title>
            </circle>
          ))}

          {pts.slice(0, -1).map((pA, segIdx) => {
            const pB = pts[segIdx + 1];
            const sx = (pA.x + pB.x) / 2;
            const sy = (pA.y + pB.y) / 2;
            return (
              <g
                key={`add_wp_${segIdx}`}
                transform={`translate(${sx}, ${sy})`}
                className="cursor-pointer opacity-75 hover:opacity-100"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (onUpdateCableControlPoints) {
                    onBeginDragSnapshot?.();
                    const existing = [...(cable.controlPoints || [])];
                    existing.splice(segIdx, 0, { x: sx, y: sy });
                    onUpdateCableControlPoints(cable.id, existing);
                    onStartWaypointDrag(cable.id, segIdx);
                  }
                }}
              >
                <circle r={5} fill="#eff6ff" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="2 1" />
                <text x="0" y="3" textAnchor="middle" fill="#1d4ed8" fontSize="9" fontWeight="bold">+</text>
                <title>Kéo để thêm điểm uốn mới</title>
              </g>
            );
          })}

          <circle
            cx={x1}
            cy={y1}
            r={6.5}
            fill="#10b981"
            stroke="#ffffff"
            strokeWidth="2"
            className="cursor-crosshair"
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartReconnect(cable.id, 'source', x2, y2);
            }}
          >
            <title>Kéo đầu cáp nguồn sang thiết bị khác</title>
          </circle>

          <circle
            cx={x2}
            cy={y2}
            r={6.5}
            fill="#06b6d4"
            stroke="#ffffff"
            strokeWidth="2"
            className="cursor-crosshair"
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartReconnect(cable.id, 'target', x1, y1);
            }}
          >
            <title>Kéo đầu cáp đích sang thiết bị khác</title>
          </circle>
        </g>
      )}
    </g>
  );
}, (prev, next) => {
  if (
    prev.cable !== next.cable ||
    prev.isSelected !== next.isSelected ||
    prev.isHovered !== next.isHovered ||
    prev.isBundled !== next.isBundled ||
    prev.isReadOnlyMode !== next.isReadOnlyMode
  ) {
    return false;
  }
  if (
    prev.geom.pathD !== next.geom.pathD ||
    prev.geom.x1 !== next.geom.x1 ||
    prev.geom.y1 !== next.geom.y1 ||
    prev.geom.x2 !== next.geom.x2 ||
    prev.geom.y2 !== next.geom.y2
  ) {
    return false;
  }
  return true;
});

MemoizedCableItem.displayName = 'MemoizedCableItem';

/* --------------------------------------------------------------------------
 * 3. Culled Trays SVG Layer (for Bottom Backdrop SVG)
 * -------------------------------------------------------------------------- */

export interface CanvasTraysLayerProps {
  trays: CableTray[];
  hideLabels: boolean;
  selectedTrayId?: string | null;
  lockedLayerTrays?: boolean;
  isReadOnlyMode?: boolean;
  isPointerPassthrough?: boolean;
  onSelectTray?: (trayId: string, e: React.PointerEvent) => void;
  onStartDragTrayVertex?: (trayId: string, vertexIndex: number, e: React.PointerEvent) => void;
}

export const CanvasTraysLayer: React.FC<CanvasTraysLayerProps> = React.memo(
  ({
    trays,
    hideLabels,
    selectedTrayId,
    lockedLayerTrays = false,
    isReadOnlyMode = false,
    isPointerPassthrough = false,
    onSelectTray,
    onStartDragTrayVertex
  }) => {
    return (
      <g data-layer="cable-trays">
        {trays.map(tray => {
          const ptsStr = tray.points.map(p => `${p.x},${p.y}`).join(' ');
          const trayW = Math.max(8, tray.widthPx || 16);
          const baseColor =
            tray.color ||
            (tray.kind === 'power_tray' ? '#e11d48' : tray.kind === 'conduit' ? '#0d9488' : '#0284c7');
          const midPt = tray.points[Math.floor(tray.points.length / 2)] || tray.points[0];
          const prevPt = tray.points[Math.max(0, Math.floor(tray.points.length / 2) - 1)] || midPt;
          const labelX = (prevPt.x + midPt.x) / 2;
          const labelY = (prevPt.y + midPt.y) / 2;
          const isSelected = selectedTrayId === tray.id;
          const isLocked = Boolean(isReadOnlyMode || tray.locked || lockedLayerTrays);

          return (
            <g
              key={tray.id}
              data-tray-id={tray.id}
              className={isPointerPassthrough ? 'pointer-events-none' : 'cursor-pointer'}
              opacity={isSelected ? 1 : 0.88}
              onPointerDown={
                !isPointerPassthrough && onSelectTray
                  ? e => {
                      e.stopPropagation();
                      onSelectTray(tray.id, e);
                    }
                  : undefined
              }
            >
              {/* Wide invisible hit target for easy tray clicking/dragging */}
              {!isPointerPassthrough && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(18, trayW + 10)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {isSelected && (
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke="#155EEF"
                  strokeWidth={trayW + 8}
                  strokeOpacity={0.22}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              )}

              <polyline
                points={ptsStr}
                fill="none"
                stroke={baseColor}
                strokeWidth={trayW}
                strokeOpacity={isSelected ? 0.24 : 0.14}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={ptsStr}
                fill="none"
                stroke={baseColor}
                strokeWidth={Math.max(2, trayW * 0.72)}
                strokeOpacity={isSelected ? 0.45 : 0.32}
                strokeDasharray={tray.kind === 'conduit' ? 'none' : '4 5'}
                strokeLinecap="butt"
                strokeLinejoin="round"
              />
              <polyline
                points={ptsStr}
                fill="none"
                stroke={isSelected ? '#155EEF' : baseColor}
                strokeWidth={isSelected ? 2 : 1.4}
                strokeOpacity={isSelected ? 0.95 : 0.75}
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {!hideLabels && (
                <g transform={`translate(${labelX}, ${labelY - trayW / 2 - 8})`}>
                  <rect
                    x={-Math.min(90, tray.name.length * 3.1 + 8)}
                    y={-8}
                    width={Math.min(180, tray.name.length * 6.2 + 16)}
                    height={14}
                    rx="3"
                    fill="#ffffff"
                    fillOpacity={0.94}
                    stroke={isSelected ? '#155EEF' : baseColor}
                    strokeOpacity={isSelected ? 0.95 : 0.6}
                    strokeWidth={isSelected ? '1.3' : '0.9'}
                  />
                  <text
                    x={0}
                    y={2}
                    textAnchor="middle"
                    fill={isSelected ? '#155EEF' : baseColor}
                    fontSize="8"
                    fontWeight="700"
                  >
                    {tray.locked ? `🔒 ${tray.name}` : tray.name}
                  </text>
                </g>
              )}

              {isSelected &&
                !isPointerPassthrough &&
                tray.points.map((pt, idx) => (
                  <circle
                    key={`${tray.id}_v_${idx}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={5.5}
                    fill={isLocked ? '#f59e0b' : '#ffffff'}
                    stroke="#155EEF"
                    strokeWidth={2}
                    className={isLocked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}
                    onPointerDown={
                      !isLocked && onStartDragTrayVertex
                        ? e => {
                            e.stopPropagation();
                            onStartDragTrayVertex(tray.id, idx, e);
                          }
                        : e => {
                            e.stopPropagation();
                          }
                    }
                  />
                ))}
            </g>
          );
        })}
      </g>
    );
  }
);

CanvasTraysLayer.displayName = 'CanvasTraysLayer';

/* --------------------------------------------------------------------------
 * 4. Interactive Cables + Bundles + Cable Labels SVG Layer
 * -------------------------------------------------------------------------- */

export interface CanvasCablesLayerProps {
  rasterActive: boolean;
  culledCables: CableEdge[];
  culledBundles: CableBundleInfo[];
  cableBundleLayout: CableBundleLayout;
  interactiveCableIds: Set<string>;
  collapsedBundleIds: Set<string>;
  activeBundleId: string | null;
  selection: SelectionState;
  hoveredCableId: string | null;
  editingCableLabelId: string | null;
  isDarkMode: boolean;
  isReadOnlyMode: boolean;
  hideLabels: boolean;
  showCableCodes: boolean;
  getCableGeometry: (cable: CableEdge) => CanvasCableGeometry | null;
  onToggleActiveBundle: (bundleId: string) => void;
  onSelectEdge: (cableId: string) => void;
  onScheduleLongPress: (clientX: number, clientY: number, type: 'edge', id: string) => void;
  onCableContextMenu: (e: React.MouseEvent, cable: CableEdge) => void;
  onOpenInlineCableLabelEditor: (cable: CableEdge, x: number, y: number) => void;
  onHoverCable: (cableId: string | null) => void;
  onBeginDragSnapshot?: () => void;
  onStartWaypointDrag: (cableId: string, pointIndex: number) => void;
  onUpdateCable?: (cableId: string, updates: Partial<CableEdge>) => void;
  onUpdateCableControlPoints?: (cableId: string, controlPoints: { x: number; y: number }[]) => void;
  onStartReconnect: (cableId: string, endpoint: 'source' | 'target', anchorX: number, anchorY: number) => void;
}

export const CanvasCablesLayer: React.FC<CanvasCablesLayerProps> = React.memo(({
  rasterActive,
  culledCables,
  culledBundles,
  cableBundleLayout,
  interactiveCableIds,
  collapsedBundleIds,
  activeBundleId,
  selection,
  hoveredCableId,
  editingCableLabelId,
  isDarkMode,
  isReadOnlyMode,
  hideLabels,
  showCableCodes,
  getCableGeometry,
  onToggleActiveBundle,
  onSelectEdge,
  onScheduleLongPress,
  onCableContextMenu,
  onOpenInlineCableLabelEditor,
  onHoverCable,
  onBeginDragSnapshot,
  onStartWaypointDrag,
  onUpdateCable,
  onUpdateCableControlPoints,
  onStartReconnect
}) => {
  const svgCables = useMemo(() => {
    if (!rasterActive) return culledCables;
    return culledCables.filter(c => interactiveCableIds.has(c.id));
  }, [rasterActive, culledCables, interactiveCableIds]);

  const svgLabelCables = useMemo(() => {
    if (hideLabels) return [];
    if (!rasterActive) return culledCables;
    return culledCables.filter(c => interactiveCableIds.has(c.id));
  }, [hideLabels, rasterActive, culledCables, interactiveCableIds]);

  return (
    <g data-layer="cables-interactive">
      {/* Cable bundle couplers & interactive collapsed trunks */}
      {culledBundles.map(bundle => {
        const isCollapsed = collapsedBundleIds.has(bundle.bundleId);
        const isBundleActive = activeBundleId === bundle.bundleId;
        const angleDeg = (Math.atan2(bundle.tangent.y, bundle.tangent.x) * 180) / Math.PI;
        const firstCable = bundle.cables[0];
        const trunkGeom = isCollapsed && firstCable ? getCableGeometry(firstCable) : null;
        const hasSelectedMember = selection.type === 'edge' && bundle.cables.some(c => c.id === selection.id);

        return (
          <g key={`sheath_${bundle.bundleId}`}>
            {isCollapsed && trunkGeom && (
              <g
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleActiveBundle(bundle.bundleId);
                }}
                className="cursor-pointer"
              >
                <path d={trunkGeom.pathD} fill="none" stroke="transparent" strokeWidth={18} />
                {(isBundleActive || hasSelectedMember) && (
                  <path
                    d={trunkGeom.pathD}
                    fill="none"
                    stroke="#3b82f6"
                    strokeOpacity={0.35}
                    strokeWidth={Math.min(10, 3.5 + bundle.cables.length * 0.9) + 6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {(!rasterActive || isBundleActive || hasSelectedMember) && (
                  <>
                    <path
                      d={trunkGeom.pathD}
                      fill="none"
                      stroke={bundle.primaryColor}
                      strokeWidth={Math.min(10, 3.5 + bundle.cables.length * 0.9)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.92}
                    />
                    <path
                      d={trunkGeom.pathD}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={1.2}
                      strokeDasharray="4 6"
                      strokeLinecap="round"
                      opacity={0.65}
                    />
                  </>
                )}
              </g>
            )}

            <g
              transform={`translate(${bundle.midPoint.x}, ${bundle.midPoint.y}) rotate(${angleDeg})`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleActiveBundle(bundle.bundleId);
              }}
              className="cursor-pointer"
            >
              <rect
                x={-11}
                y={-(bundle.spanWidthPx / 2 + 4)}
                width={22}
                height={bundle.spanWidthPx + 8}
                rx="6"
                fill={isBundleActive ? '#dbeafe' : '#eff6ff'}
                fillOpacity={isDarkMode ? 0.2 : 0.85}
                stroke={isBundleActive || hasSelectedMember ? '#2563eb' : '#60a5fa'}
                strokeWidth={isBundleActive ? 1.8 : 1.1}
                strokeDasharray={isCollapsed ? 'none' : '3 2'}
              />
              <line
                x1={-5}
                y1={-(bundle.spanWidthPx / 2 + 2)}
                x2={-5}
                y2={bundle.spanWidthPx / 2 + 2}
                stroke={isBundleActive ? '#1d4ed8' : '#3b82f6'}
                strokeWidth="1.5"
              />
              <line
                x1={5}
                y1={-(bundle.spanWidthPx / 2 + 2)}
                x2={5}
                y2={bundle.spanWidthPx / 2 + 2}
                stroke={isBundleActive ? '#1d4ed8' : '#3b82f6'}
                strokeWidth="1.5"
              />
            </g>
          </g>
        );
      })}

      {/* Interactive / memoized SVG cables */}
      {svgCables.map(cable => {
        const isSelected = selection.type === 'edge' && selection.id === cable.id;
        const isHovered = hoveredCableId === cable.id;
        const bundleId = cableBundleLayout.cableToBundleId.get(cable.id);
        const isBundled = Boolean(bundleId);
        const isBundleCollapsed = Boolean(bundleId && collapsedBundleIds.has(bundleId));
        if (isBundleCollapsed && !isSelected) return null;

        const geom = getCableGeometry(cable);
        if (!geom) return null;

        return (
          <MemoizedCableItem
            key={cable.id}
            cable={cable}
            geom={geom}
            isSelected={isSelected}
            isHovered={isHovered}
            isBundled={isBundled}
            isReadOnlyMode={isReadOnlyMode}
            onSelectEdge={onSelectEdge}
            onScheduleLongPress={onScheduleLongPress}
            onContextMenu={onCableContextMenu}
            onOpenInlineLabelEditor={onOpenInlineCableLabelEditor}
            onHoverCable={onHoverCable}
            onBeginDragSnapshot={onBeginDragSnapshot}
            onStartWaypointDrag={onStartWaypointDrag}
            onUpdateCable={onUpdateCable}
            onUpdateCableControlPoints={onUpdateCableControlPoints}
            onStartReconnect={onStartReconnect}
          />
        );
      })}

      {/* Bundle summary badges */}
      {!hideLabels && culledBundles.map(bundle => {
        const isBundleActive = activeBundleId === bundle.bundleId;
        const isCollapsed = collapsedBundleIds.has(bundle.bundleId);
        const colorDots = (bundle.distinctColors || [bundle.primaryColor]).slice(0, 4);
        const dotsW = colorDots.length * 7 + 4;
        const badgeW = Math.max(82, bundle.summaryLabel.length * 5.8 + 14 + dotsW);
        const labelYOffset = -(bundle.spanWidthPx / 2 + 17);

        return (
          <g
            key={`badge_${bundle.bundleId}`}
            transform={`translate(${bundle.midPoint.x}, ${bundle.midPoint.y + labelYOffset})`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleActiveBundle(bundle.bundleId);
            }}
            className="cursor-pointer"
          >
            <rect
              x={-badgeW / 2}
              y={-9.5}
              width={badgeW}
              height={19}
              rx="4"
              fill={isBundleActive ? '#1d4ed8' : isCollapsed ? '#0f172a' : '#ffffff'}
              stroke={isBundleActive ? '#1e40af' : bundle.primaryColor}
              strokeWidth="1.3"
            />
            {colorDots.map((cColor, idx) => (
              <circle
                key={`bdot_${idx}`}
                cx={-badgeW / 2 + 9 + idx * 7}
                cy={0}
                r="2.6"
                fill={cColor}
                stroke={isBundleActive || isCollapsed ? '#ffffff' : '#0f172a'}
                strokeOpacity="0.25"
                strokeWidth="0.6"
              />
            ))}
            <text
              x={dotsW / 2 - 2}
              y="3"
              textAnchor="middle"
              fill={isBundleActive || isCollapsed ? '#ffffff' : '#1e3a8a'}
              fontSize="8.5"
              fontWeight="700"
              fontFamily="monospace"
            >
              {bundle.summaryLabel}
            </text>
            <title>Nhấn để xem danh sách cáp trong bó hoặc gộp/tách đường dây</title>
          </g>
        );
      })}

      {/* Cable Labels */}
      {!hideLabels && (
        <g data-layer="cable-labeling">
          {svgLabelCables.map(cable => {
            const isSelected = selection.type === 'edge' && selection.id === cable.id;
            const isHovered = hoveredCableId === cable.id;
            const bundleId = cableBundleLayout.cableToBundleId.get(cable.id);
            const isBundled = Boolean(bundleId);
            const isBundleCollapsed = Boolean(bundleId && collapsedBundleIds.has(bundleId));

            if (isBundleCollapsed && !isSelected) {
              return null;
            }

            const geom = getCableGeometry(cable);
            if (!geom || geom.midX === 0 || editingCableLabelId === cable.id) {
              return null;
            }

            const cableColor = normalizeCableColor(cable.color || '#0284c7');
            const hasCustomLabel = Boolean(cable.label && cable.label.trim().length > 0);
            const showBadge =
              (showCableCodes || hasCustomLabel) &&
              (!isBundled || isSelected || isHovered || hasCustomLabel);

            const lt = resolveCableLabelTransform(cable, {
              midPoint: { x: geom.midX, y: geom.midY },
              midAngleDeg: geom.midAngleDeg
            });

            if (!showBadge) {
              if (!isSelected || isBundled || isReadOnlyMode) return null;
              return (
                <g
                  key={`lbl_add_${cable.id}`}
                  transform={`translate(${lt.x}, ${lt.y}) rotate(${lt.angleDeg})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenInlineCableLabelEditor(cable, lt.x, lt.y);
                  }}
                  className="cursor-text"
                >
                  <rect
                    x="-38"
                    y="-10"
                    width="76"
                    height="20"
                    rx="4"
                    fill="#f8fafc"
                    stroke={cableColor}
                    strokeWidth="1.1"
                    strokeDasharray="3 2"
                  />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fill="#334155"
                    fontSize="8.5"
                    fontWeight="600"
                  >
                    + Thêm nhãn
                  </text>
                </g>
              );
            }

            const halfH = lt.badgeHeight / 2;
            const badgeLeft = -lt.badgeWidth / 2;
            const dotR = Math.max(2.4, Math.min(4.2, lt.fontSize * 0.28));
            const dotCx = badgeLeft + dotR + 5.5;
            const textOffsetX = dotR * 0.9 + 2;

            return (
              <g
                key={`lbl_${cable.id}`}
                transform={`translate(${lt.x}, ${lt.y}) rotate(${lt.angleDeg})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdge(cable.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isReadOnlyMode) {
                    onOpenInlineCableLabelEditor(cable, lt.x, lt.y);
                  }
                }}
                onPointerEnter={() => onHoverCable(cable.id)}
                onPointerLeave={() => onHoverCable(null)}
                className="cursor-pointer"
              >
                <rect
                  x={badgeLeft}
                  y={-halfH}
                  width={lt.badgeWidth}
                  height={lt.badgeHeight}
                  rx="4"
                  fill="#ffffff"
                  fillOpacity={isSelected ? 0.99 : 0.95}
                  stroke={cableColor}
                  strokeWidth={isSelected ? 1.8 : 1.1}
                  filter={
                    isSelected
                      ? 'drop-shadow(0 2px 5px rgba(37,99,235,0.22))'
                      : 'drop-shadow(0 1px 2px rgba(15,23,42,0.10))'
                  }
                />
                <circle cx={dotCx} cy="0" r={dotR} fill={cableColor} />
                <text
                  x={textOffsetX}
                  y={lt.fontSize * 0.35}
                  textAnchor="middle"
                  fill="#0f172a"
                  fontSize={lt.fontSize}
                  fontWeight={hasCustomLabel ? '700' : '600'}
                  fontFamily={hasCustomLabel ? 'system-ui, sans-serif' : 'monospace'}
                >
                  {lt.text}
                </text>
                <title>
                  {`${lt.text} (${lt.angleDeg}° · ${lt.fontSize}px)${isReadOnlyMode ? '' : ' — Nhấp đúp để sửa nhanh'}`}
                </title>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
});

CanvasCablesLayer.displayName = 'CanvasCablesLayer';
