import type { CableEdge } from '../types/infrastructure';
import {
  CableBundleInfo,
  CableBundleLayout,
  CablePathResult,
  computeCableBundleLayout,
  normalizeCableColor,
  RectBox,
  resolveCableLabelTransform
} from '../utils/cableRouting';

export interface WorkerViewportState {
  width: number;
  height: number;
  dpr: number;
  panX: number;
  panY: number;
  zoom: number;
}

export interface WorkerRenderOptions {
  active: boolean;
  showCableLabels: boolean;
  showCableCodes: boolean;
  isPanning: boolean;
  isTransformingNodes: boolean;
}

export interface WorkerStaticSceneInput {
  cables: CableEdge[];
  nodeRectEntries: Array<[string, RectBox]>;
  interactiveCableIds: string[];
  collapsedBundleIds: string[];
  recomputeRouting?: boolean;
}

export type CableRenderWorkerMessage =
  | {
      type: 'INIT_CANVAS';
      canvas: OffscreenCanvas;
    }
  | {
      type: 'SYNC_SCENE';
      scene: WorkerStaticSceneInput;
      viewport: WorkerViewportState;
      options: WorkerRenderOptions;
    }
  | {
      type: 'RENDER_VIEWPORT';
      viewport: WorkerViewportState;
      options: WorkerRenderOptions;
    }
  | {
      type: 'CLEAR';
    };

export interface DrawCableSceneParams {
  cables: readonly CableEdge[];
  bundles: readonly CableBundleInfo[];
  cableToBundleId: ReadonlyMap<string, string>;
  cablePaths: ReadonlyMap<string, CablePathResult>;
  collapsedBundleIds: ReadonlySet<string>;
  interactiveCableIds: ReadonlySet<string>;
  viewport: WorkerViewportState;
  options: WorkerRenderOptions;
  getPath2D?: (pathD: string) => Path2D | null;
}

const MAX_WORKER_PATH2D_CACHE = 4000;

export function createWorkerPath2DCache(): (pathD: string) => Path2D | null {
  const cache = new Map<string, Path2D>();
  return (pathD: string) => {
    if (typeof Path2D === 'undefined' || !pathD) return null;
    let cached = cache.get(pathD);
    if (!cached) {
      if (cache.size >= MAX_WORKER_PATH2D_CACHE) {
        cache.clear();
      }
      cached = new Path2D(pathD);
      cache.set(pathD, cached);
    }
    return cached;
  };
}

export function computeStaticWorkerBundleLayout(
  cables: CableEdge[],
  nodeRectEntries: Array<[string, RectBox]>
): CableBundleLayout {
  const rectMap = new Map<string, RectBox>(nodeRectEntries);
  return computeCableBundleLayout(cables, nodeId => rectMap.get(nodeId) ?? null);
}

export function drawCableSceneToContext(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  params: DrawCableSceneParams
): void {
  const {
    cables,
    bundles,
    cableToBundleId,
    cablePaths,
    collapsedBundleIds,
    interactiveCableIds,
    viewport,
    options,
    getPath2D
  } = params;

  const targetW = Math.max(1, Math.round(viewport.width * viewport.dpr));
  const targetH = Math.max(1, Math.round(viewport.height * viewport.dpr));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, targetW, targetH);

  if (!options.active) return;

  ctx.setTransform(
    viewport.dpr * viewport.zoom,
    0,
    0,
    viewport.dpr * viewport.zoom,
    viewport.dpr * viewport.panX,
    viewport.dpr * viewport.panY
  );
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Collapsed bundle trunk sheaths (static)
  for (const bundle of bundles) {
    if (!collapsedBundleIds.has(bundle.bundleId)) continue;
    const firstCable = bundle.cables[0];
    const trunkGeom = firstCable ? cablePaths.get(firstCable.id) : undefined;
    if (!trunkGeom) continue;

    const p2d = getPath2D ? getPath2D(trunkGeom.d) : null;
    const baseWidth = Math.min(10, 3.5 + bundle.cables.length * 0.9);
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = bundle.primaryColor;
    ctx.lineWidth = baseWidth;
    ctx.setLineDash([]);
    if (p2d) {
      ctx.stroke(p2d as Path2D);
    } else {
      ctx.beginPath();
      trunkGeom.pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
    }
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 6]);
    if (p2d) {
      ctx.stroke(p2d as Path2D);
    } else {
      ctx.stroke();
    }
    ctx.restore();
  }

  // 2. Non-interactive cables (interactive / dragging-endpoint cables stay in SVG overlay)
  for (const cable of cables) {
    if (interactiveCableIds.has(cable.id)) continue;
    const bundleId = cableToBundleId.get(cable.id);
    if (bundleId && collapsedBundleIds.has(bundleId)) continue;

    const geom = cablePaths.get(cable.id);
    if (!geom) continue;

    const cableColor = normalizeCableColor(cable.color || '#0284c7');
    const p2d = getPath2D ? getPath2D(geom.d) : null;

    ctx.strokeStyle = cableColor;
    ctx.lineWidth = cable.strokeWidth || 2;
    ctx.setLineDash(cable.lineStyle === 'dashed' ? [6, 4] : []);
    if (p2d) {
      ctx.stroke(p2d as Path2D);
    } else {
      ctx.beginPath();
      geom.pts.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
    }
  }

  // 3. Static cable label badges (skipped mid-pan or when ultra-dense to preserve 60 FPS)
  if (
    options.showCableLabels &&
    !options.isPanning &&
    viewport.zoom >= 0.6 &&
    cables.length <= 260
  ) {
    ctx.setLineDash([]);
    for (const cable of cables) {
      if (interactiveCableIds.has(cable.id)) continue;
      const bundleId = cableToBundleId.get(cable.id);
      const isBundled = Boolean(bundleId);
      if (bundleId && collapsedBundleIds.has(bundleId)) continue;

      const hasCustomLabel = Boolean(cable.label && cable.label.trim().length > 0);
      if (!((options.showCableCodes || hasCustomLabel) && (!isBundled || hasCustomLabel))) continue;

      const geom = cablePaths.get(cable.id);
      if (!geom || geom.midPoint.x === 0) continue;

      const cableColor = normalizeCableColor(cable.color || '#0284c7');
      const lt = resolveCableLabelTransform(cable, {
        midPoint: geom.midPoint,
        midAngleDeg: geom.midAngleDeg
      });

      const halfH = lt.badgeHeight / 2;
      const badgeLeft = -lt.badgeWidth / 2;
      const dotR = Math.max(2.4, Math.min(4.2, lt.fontSize * 0.28));
      const dotCx = badgeLeft + dotR + 5.5;
      const textOffsetX = dotR * 0.9 + 2;

      ctx.save();
      ctx.translate(lt.x, lt.y);
      if (lt.angleDeg) {
        ctx.rotate((lt.angleDeg * Math.PI) / 180);
      }

      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.strokeStyle = cableColor;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(badgeLeft, -halfH, lt.badgeWidth, lt.badgeHeight, 4);
      } else {
        ctx.rect(badgeLeft, -halfH, lt.badgeWidth, lt.badgeHeight);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = cableColor;
      ctx.beginPath();
      ctx.arc(dotCx, 0, dotR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.font = `${hasCustomLabel ? '700' : '600'} ${lt.fontSize}px ${
        hasCustomLabel ? 'system-ui, sans-serif' : 'monospace'
      }`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lt.text, textOffsetX, 0.5);
      ctx.restore();
    }
  }
}

interface CableWorkerScopeLike {
  onmessage: ((ev: MessageEvent<CableRenderWorkerMessage>) => void) | null;
  postMessage?: (msg: unknown) => void;
  requestAnimationFrame?: (cb: () => void) => number;
}

const workerScope = globalThis as unknown as CableWorkerScopeLike;

if (typeof workerScope.postMessage === 'function' && typeof self !== 'undefined') {
  let targetCanvas: OffscreenCanvas | null = null;
  let targetCtx: OffscreenCanvasRenderingContext2D | null = null;
  let backBuffer: OffscreenCanvas | null = null;
  let backCtx: OffscreenCanvasRenderingContext2D | null = null;

  let cachedCables: CableEdge[] = [];
  let cachedBundleLayout: CableBundleLayout | null = null;
  let cachedInteractiveIds = new Set<string>();
  let cachedCollapsedBundleIds = new Set<string>();
  let latestViewport: WorkerViewportState | null = null;
  let latestOptions: WorkerRenderOptions | null = null;
  let rafScheduled = false;

  const getPath2D = createWorkerPath2DCache();

  const flushRender = () => {
    rafScheduled = false;
    if (!targetCanvas || !targetCtx || !latestViewport || !latestOptions) return;

    const targetW = Math.max(1, Math.round(latestViewport.width * latestViewport.dpr));
    const targetH = Math.max(1, Math.round(latestViewport.height * latestViewport.dpr));

    if (targetCanvas.width !== targetW || targetCanvas.height !== targetH) {
      targetCanvas.width = targetW;
      targetCanvas.height = targetH;
    }

    if (!latestOptions.active || !cachedBundleLayout) {
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.clearRect(0, 0, targetW, targetH);
      return;
    }

    if (!backBuffer) {
      backBuffer = new OffscreenCanvas(targetW, targetH);
      backCtx = backBuffer.getContext('2d');
    } else if (backBuffer.width !== targetW || backBuffer.height !== targetH) {
      backBuffer.width = targetW;
      backBuffer.height = targetH;
    }

    const drawTarget = backCtx || targetCtx;
    drawCableSceneToContext(drawTarget, {
      cables: cachedCables,
      bundles: cachedBundleLayout.bundles,
      cableToBundleId: cachedBundleLayout.cableToBundleId,
      cablePaths: cachedBundleLayout.cablePaths,
      collapsedBundleIds: cachedCollapsedBundleIds,
      interactiveCableIds: cachedInteractiveIds,
      viewport: latestViewport,
      options: latestOptions,
      getPath2D
    });

    if (backBuffer && backCtx && drawTarget === backCtx) {
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.clearRect(0, 0, targetW, targetH);
      targetCtx.drawImage(backBuffer, 0, 0);
    }
  };

  const scheduleRender = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    if (typeof workerScope.requestAnimationFrame === 'function') {
      workerScope.requestAnimationFrame(flushRender);
    } else {
      setTimeout(flushRender, 0);
    }
  };

  workerScope.onmessage = (event: MessageEvent<CableRenderWorkerMessage>) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === 'INIT_CANVAS') {
      targetCanvas = msg.canvas;
      targetCtx = targetCanvas.getContext('2d');
      scheduleRender();
      return;
    }

    if (msg.type === 'CLEAR') {
      if (latestOptions) {
        latestOptions = { ...latestOptions, active: false };
      }
      if (targetCanvas && targetCtx) {
        targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      }
      return;
    }

    if (msg.type === 'SYNC_SCENE') {
      const { scene, viewport, options } = msg;
      cachedCables = scene.cables;
      cachedInteractiveIds = new Set(scene.interactiveCableIds);
      cachedCollapsedBundleIds = new Set(scene.collapsedBundleIds);

      if (scene.recomputeRouting !== false || !cachedBundleLayout) {
        cachedBundleLayout = computeStaticWorkerBundleLayout(scene.cables, scene.nodeRectEntries);
      }

      latestViewport = viewport;
      latestOptions = options;
      scheduleRender();
      return;
    }

    if (msg.type === 'RENDER_VIEWPORT') {
      latestViewport = msg.viewport;
      latestOptions = msg.options;
      scheduleRender();
    }
  };
}
