import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CADCommand } from '../commands/CADCommand';
import {
  AddEntitiesCommand,
  CopyEntitiesCommand,
  MirrorCommand,
  MoveCommand,
  ReplaceEntitiesCommand,
  RotateCommand,
  ScaleCommand
} from '../commands/CADCommands';
import { isCADEntityInSpace, isCADLayerLocked } from '../core/CADDocument';
import { createCadId } from '../core/CADRegistry';
import type {
  CADDocument,
  CADEntity,
  CADSnapSettings,
  CADToolId,
  Point2D
} from '../core/CADTypes';
import { formatCADMeasurement } from '../core/CADUnits';
import { computeSmartFitExtents } from '../geometry/CADBounds';
import {
  doesEntityMatchSelectionBox,
  isEntityGeometryEditable,
  pickTopEntityAtPoint
} from '../geometry/CADGeometry';
import {
  extendLineToBoundaries,
  offsetSimpleEntity,
  trimLineAgainstCutters
} from '../geometry/CADIntersection';
import { CADSnapResult, findBestSnapPoint } from '../geometry/CADSnap';
import type { CanvasPerformanceMode } from '../../types/infrastructure';
import { resolveCanvasPerformancePolicy } from '../../utils/canvasPerformance';
import { sharedCadCanvasRenderer } from '../rendering/CADCanvasRenderer';
import { CADInteractionOverlay, CADMarqueeBox } from '../rendering/CADSelectionRenderer';
import {
  CADViewportState,
  createDefaultCADViewport,
  fitViewportToExtents,
  screenToCadWorld,
  zoomViewportAtScreenPoint
} from '../rendering/CADViewport';

export interface CADCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitView: () => void;
  panToWorldCenter: (center: Point2D) => void;
}

interface CADCanvasProps {
  doc: CADDocument;
  activeLayerName: string;
  activeSpace?: 'model' | 'paper';
  activeLayoutKey?: string;
  activeTool: CADToolId;
  activeInsertBlockName: string | null;
  selectedIds: Set<string>;
  snapSettings: CADSnapSettings;
  lightBg: boolean;
  fitTrigger: number;
  performanceMode?: CanvasPerformanceMode;
  onSelectIds: (ids: Set<string>) => void;
  onExecuteCommand: (cmd: CADCommand) => void;
  onCursorMove: (pt: Point2D) => void;
  onStatusPrompt: (msg: string) => void;
  onFinishToolToSelect: () => void;
  onViewportChange?: (vp: CADViewportState) => void;
}

export const CADCanvas = forwardRef<CADCanvasHandle, CADCanvasProps>(({
  doc,
  activeLayerName,
  activeSpace = 'model',
  activeLayoutKey = 'Model',
  activeTool,
  activeInsertBlockName,
  selectedIds,
  snapSettings,
  lightBg,
  fitTrigger,
  performanceMode,
  onSelectIds,
  onExecuteCommand,
  onCursorMove,
  onStatusPrompt,
  onFinishToolToSelect,
  onViewportChange
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [vp, setVp] = useState<CADViewportState>(() => createDefaultCADViewport(1000, 680));
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [snapResult, setSnapResult] = useState<CADSnapResult | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 });
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [marquee, setMarquee] = useState<CADMarqueeBox | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  // Floating prompt for TEXT / OFFSET distance without window.prompt
  const [textModalPos, setTextModalPos] = useState<Point2D | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [offsetTarget, setOffsetTarget] = useState<CADEntity | null>(null);
  const [offsetDist, setOffsetDist] = useState('200');

  const panStateRef = useRef<{ startScreen: Point2D; startCenter: Point2D } | null>(null);
  const panJustEndedRef = useRef<boolean>(false);
  const marqueeStartRef = useRef<Point2D | null>(null);
  const lastFittedDocIdRef = useRef<string | null>(null);
  const lastLayoutKeyRef = useRef<string>(activeLayoutKey);
  const layoutViewportsRef = useRef<Record<string, CADViewportState>>({});
  const lastCadDrawTimeRef = useRef<number>(0);
  const hasUserInteractedRef = useRef<boolean>(false);
  const latestDocRef = useRef<CADDocument>(doc);
  latestDocRef.current = doc;
  const latestSpaceRef = useRef<'model' | 'paper'>(activeSpace);
  latestSpaceRef.current = activeSpace;
  const latestVpRef = useRef<CADViewportState>(vp);
  latestVpRef.current = vp;

  // Emit viewport updates to workspace HUD (Minimap & Zoom toolbar)
  useEffect(() => {
    onViewportChange?.(vp);
  }, [vp, onViewportChange]);

  // Invalidate bitmap pan cache when document or space changes
  useEffect(() => {
    sharedCadCanvasRenderer.invalidatePanCache();
  }, [doc.id, doc.updatedAt, doc.entities.length, activeSpace, activeLayoutKey]);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => {
        hasUserInteractedRef.current = true;
        setVp(prev => zoomViewportAtScreenPoint(prev, 1.25, prev.width / 2, prev.height / 2));
      },
      zoomOut: () => {
        hasUserInteractedRef.current = true;
        setVp(prev => zoomViewportAtScreenPoint(prev, 1 / 1.25, prev.width / 2, prev.height / 2));
      },
      resetZoom: () => {
        hasUserInteractedRef.current = false;
        const el = containerRef.current;
        const w = el?.clientWidth || vp.width || 1000;
        const h = el?.clientHeight || vp.height || 680;
        const smart = computeSmartFitExtents(latestDocRef.current, { space: latestSpaceRef.current });
        setVp(fitViewportToExtents(smart, w, h, 24));
      },
      fitView: () => {
        hasUserInteractedRef.current = false;
        const el = containerRef.current;
        const w = el?.clientWidth || vp.width || 1000;
        const h = el?.clientHeight || vp.height || 680;
        const smart = computeSmartFitExtents(latestDocRef.current, { space: latestSpaceRef.current });
        setVp(fitViewportToExtents(smart, w, h, 24));
      },
      panToWorldCenter: (center: Point2D) => {
        hasUserInteractedRef.current = true;
        setVp(prev => ({ ...prev, centerX: center.x, centerY: center.y }));
      }
    }),
    [vp.width, vp.height]
  );

  // Reset tool draft points when switching tool or space
  useEffect(() => {
    setDraftPoints([]);
    setTextModalPos(null);
    setOffsetTarget(null);
  }, [activeTool, activeLayoutKey]);

  // Fit viewport when document changes, Fit button pressed, or Layout tab switched
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth || 1000;
    const h = el.clientHeight || 680;

    if (lastFittedDocIdRef.current !== doc.id) {
      layoutViewportsRef.current = {};
      lastFittedDocIdRef.current = doc.id;
      lastLayoutKeyRef.current = activeLayoutKey;
      hasUserInteractedRef.current = false;
      const smart = computeSmartFitExtents(doc, { space: activeSpace });
      setVp(fitViewportToExtents(smart, w, h, 24));
      return;
    }

    if (lastLayoutKeyRef.current !== activeLayoutKey) {
      layoutViewportsRef.current[lastLayoutKeyRef.current] = { ...latestVpRef.current };
      lastLayoutKeyRef.current = activeLayoutKey;
      const saved = layoutViewportsRef.current[activeLayoutKey];
      if (saved) {
        hasUserInteractedRef.current = true;
        setVp({ ...saved, width: w, height: h });
      } else {
        hasUserInteractedRef.current = false;
        const smart = computeSmartFitExtents(doc, { space: activeSpace });
        setVp(fitViewportToExtents(smart, w, h, 24));
      }
      return;
    }

    if (fitTrigger > 0) {
      hasUserInteractedRef.current = false;
      const smart = computeSmartFitExtents(doc, { space: activeSpace });
      setVp(fitViewportToExtents(smart, w, h, 24));
    }
  }, [doc, fitTrigger, activeLayoutKey, activeSpace]);

  // ResizeObserver — keeps drawing crisp & centered while layout panels open/collapse
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(100, Math.round(entry.contentRect.width));
        const h = Math.max(100, Math.round(entry.contentRect.height));
        setVp(prev => {
          if (prev.width === w && prev.height === h) return prev;
          if (!hasUserInteractedRef.current) {
            return fitViewportToExtents(
              computeSmartFitExtents(latestDocRef.current, { space: latestSpaceRef.current }),
              w,
              h,
              24
            );
          }
          return { ...prev, width: w, height: h };
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Keyboard spacebar pan, Ctrl+A Select All, & Esc/Enter finish polyline
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const curDoc = latestDocRef.current;
        const space = latestSpaceRef.current;
        const allIds = new Set<string>();
        for (const ent of curDoc.entities) {
          if (ent.visible === false || !isCADEntityInSpace(ent, space)) continue;
          const layer = curDoc.layers[ent.layer];
          if (layer && (!layer.visible || layer.frozen)) continue;
          allIds.add(ent.id);
        }
        onSelectIds(allIds);
        onStatusPrompt(`Đã chọn toàn bộ ${allIds.size} đối tượng hiển thị trong không gian hiện tại.`);
        return;
      }
      if (e.code === 'Space') setSpacePressed(true);
      if (e.key === 'Escape') {
        setDraftPoints([]);
        setTextModalPos(null);
        setOffsetTarget(null);
        onFinishToolToSelect();
      }
      if (e.key === 'Enter' && activeTool === 'polyline' && draftPoints.length >= 2) {
        commitPolyline(draftPoints, false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, draftPoints]);

  const commitPolyline = (pts: Point2D[], closed: boolean) => {
    if (pts.length < 2) return;
    onExecuteCommand(
      new AddEntitiesCommand(
        [
          {
            id: createCadId('ent'),
            handle: '',
            type: 'LWPOLYLINE',
            layer: activeLayerName,
            space: activeSpace,
            vertices: pts.map(p => ({ x: p.x, y: p.y })),
            closed,
            elevation: 0,
            preservationTier: 'supported',
            dirty: true
          }
        ],
        'Vẽ đa tuyến (Polyline)'
      )
    );
    setDraftPoints([]);
    onStatusPrompt('Đã tạo đa tuyến. Tiếp tục vẽ hoặc nhấn ESC.');
  };

  // Render canvas loop (respecting CanvasPerformanceMode DPR, bitmap pan cache & redraw throttle)
  useEffect(() => {
    const perfPolicy = resolveCanvasPerformancePolicy(performanceMode, {
      nodeCount: 0,
      cableCount: 0,
      rackCount: 0,
      roomCount: 0,
      trayCount: 0,
      cadEntityCount: doc.entities.length,
      zoom: vp.scale,
      isPanning
    });

    const performRender = () => {
      panJustEndedRef.current = false;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(perfPolicy.maxDpr, window.devicePixelRatio || 1);
      const targetW = Math.round(vp.width * dpr);
      const targetH = Math.round(vp.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      const overlay: CADInteractionOverlay = {
        marquee,
        snap: snapResult
      };

      const activePt = snapResult?.point || cursorWorld;
      if (draftPoints.length >= 1) {
        if (activeTool === 'line' || activeTool === 'polyline' || activeTool === 'move' || activeTool === 'copy' || activeTool === 'mirror' || activeTool === 'dimension') {
          overlay.rubberBandPoints = [...draftPoints, activePt];
        } else if (activeTool === 'circle') {
          const c = draftPoints[0];
          overlay.liveCircle = { center: c, radius: Math.hypot(activePt.x - c.x, activePt.y - c.y) };
        } else if (activeTool === 'rect') {
          overlay.liveRect = { a: draftPoints[0], b: activePt };
        } else if (activeTool === 'measure') {
          const s = draftPoints[0];
          const dist = Math.hypot(activePt.x - s.x, activePt.y - s.y);
          overlay.measureSegment = {
            start: s,
            end: activePt,
            label: formatCADMeasurement(dist, doc.header.$INSUNITS)
          };
        } else if (activeTool === 'arc' && draftPoints.length === 2) {
          const c = draftPoints[0];
          const r = Math.hypot(draftPoints[1].x - c.x, draftPoints[1].y - c.y);
          const sa = (Math.atan2(draftPoints[1].y - c.y, draftPoints[1].x - c.x) * 180) / Math.PI;
          const ea = (Math.atan2(activePt.y - c.y, activePt.x - c.x) * 180) / Math.PI;
          overlay.liveArc = { center: c, radius: r, startAngle: sa, endAngle: ea };
        }
      }

      const renderStats = sharedCadCanvasRenderer.render(ctx, doc, vp, {
        lightBackground: lightBg,
        showGrid: true,
        selectedIds,
        hoveredId,
        overlay,
        performanceMode,
        activeSpace,
        isPanning
      });
      ctx.restore();

      // Capture crisp vector snapshot for smooth bitmap panning once non-panning frame settles
      if (!isPanning && !renderStats.usedPanCache && !marquee && draftPoints.length === 0) {
        sharedCadCanvasRenderer.updateBitmapCacheFromCanvas(canvas, doc, vp, lightBg, dpr, activeSpace);
      }
    };

    if (isPanning || panJustEndedRef.current || perfPolicy.redrawThrottleMs <= 0) {
      performRender();
      return;
    }

    const now = performance.now();
    const elapsed = now - lastCadDrawTimeRef.current;
    if (elapsed >= perfPolicy.redrawThrottleMs) {
      lastCadDrawTimeRef.current = now;
      performRender();
      return;
    }

    const timer = window.setTimeout(() => {
      lastCadDrawTimeRef.current = performance.now();
      performRender();
    }, Math.max(1, perfPolicy.redrawThrottleMs - elapsed));
    return () => window.clearTimeout(timer);
  }, [doc, vp, lightBg, selectedIds, hoveredId, marquee, snapResult, cursorWorld, draftPoints, activeTool, performanceMode, isPanning, activeSpace]);

  const getLocalScreenPoint = (e: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>): Point2D => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const resolveSnappedWorld = (screenPt: Point2D): { world: Point2D; snap: CADSnapResult | null } => {
    const rawWorld = screenToCadWorld(screenPt, vp);
    const tolWorld = 12 / Math.max(vp.scale, 1e-6);
    const tree = sharedCadCanvasRenderer.getSpatialTree(doc);
    const near = tree
      .queryRect({
        x: rawWorld.x - tolWorld * 3,
        y: rawWorld.y - tolWorld * 3,
        width: tolWorld * 6,
        height: tolWorld * 6
      })
      .filter(ent => isCADEntityInSpace(ent, activeSpace));
    const snap = findBestSnapPoint(doc, rawWorld, tolWorld, snapSettings, {
      candidateEntities:
        near.length > 0
          ? near
          : doc.entities.filter(ent => isCADEntityInSpace(ent, activeSpace)).slice(0, 120),
      basePoint: draftPoints.length > 0 ? draftPoints[draftPoints.length - 1] : undefined
    });
    return { world: snap ? snap.point : rawWorld, snap };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sp = getLocalScreenPoint(e);

    // Middle click or Pan tool or Space+Drag
    if (e.button === 1 || activeTool === 'pan' || spacePressed) {
      hasUserInteractedRef.current = true;
      panStateRef.current = { startScreen: sp, startCenter: { x: vp.centerX, y: vp.centerY } };
      setIsPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const { world } = resolveSnappedWorld(sp);
    const tolWorld = 10 / Math.max(vp.scale, 1e-6);

    if (activeTool === 'select') {
      const hit = pickTopEntityAtPoint(doc, world, tolWorld, undefined, activeSpace);
      if (hit) {
        if (e.shiftKey) {
          const next = new Set(selectedIds);
          if (next.has(hit.id)) next.delete(hit.id);
          else next.add(hit.id);
          onSelectIds(next);
        } else {
          onSelectIds(new Set([hit.id]));
        }
        return;
      }
      marqueeStartRef.current = sp;
      setMarquee({ startScreen: sp, endScreen: sp, mode: 'window' });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'line') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('LINE: Chọn điểm cuối đoạn thẳng...');
      } else {
        const start = draftPoints[0];
        onExecuteCommand(
          new AddEntitiesCommand(
            [
              {
                id: createCadId('ent'),
                handle: '',
                type: 'LINE',
                layer: activeLayerName,
                space: activeSpace,
                start: { x: start.x, y: start.y, z: 0 },
                end: { x: world.x, y: world.y, z: 0 },
                preservationTier: 'supported',
                dirty: true
              }
            ],
            'Vẽ đoạn thẳng (Line)'
          )
        );
        setDraftPoints([world]); // Continuous chaining like AutoCAD
      }
      return;
    }

    if (activeTool === 'polyline') {
      setDraftPoints(prev => [...prev, world]);
      onStatusPrompt('POLYLINE: Chọn đỉnh tiếp theo (Enter để kết thúc, Click đúp để đóng).');
      return;
    }

    if (activeTool === 'rect') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('RECT: Chọn góc đối diện hình chữ nhật...');
      } else {
        const a = draftPoints[0];
        onExecuteCommand(
          new AddEntitiesCommand(
            [
              {
                id: createCadId('ent'),
                handle: '',
                type: 'LWPOLYLINE',
                layer: activeLayerName,
                space: activeSpace,
                vertices: [
                  { x: a.x, y: a.y },
                  { x: world.x, y: a.y },
                  { x: world.x, y: world.y },
                  { x: a.x, y: world.y }
                ],
                closed: true,
                elevation: 0,
                preservationTier: 'supported',
                dirty: true
              }
            ],
            'Vẽ hình chữ nhật'
          )
        );
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'circle') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('CIRCLE: Chọn điểm xác định bán kính...');
      } else {
        const c = draftPoints[0];
        const r = Math.hypot(world.x - c.x, world.y - c.y);
        if (r > 0.1) {
          onExecuteCommand(
            new AddEntitiesCommand(
              [
                {
                  id: createCadId('ent'),
                  handle: '',
                  type: 'CIRCLE',
                  layer: activeLayerName,
                  space: activeSpace,
                  center: { x: c.x, y: c.y, z: 0 },
                  radius: r,
                  preservationTier: 'supported',
                  dirty: true
                }
              ],
              'Vẽ đường tròn'
            )
          );
        }
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'arc') {
      if (draftPoints.length < 2) {
        setDraftPoints(prev => [...prev, world]);
        onStatusPrompt(
          draftPoints.length === 0
            ? 'ARC: Chọn điểm bắt đầu cung tròn...'
            : 'ARC: Chọn góc kết thúc cung tròn...'
        );
      } else {
        const c = draftPoints[0];
        const p1 = draftPoints[1];
        const r = Math.hypot(p1.x - c.x, p1.y - c.y);
        const startAngle = (Math.atan2(p1.y - c.y, p1.x - c.x) * 180) / Math.PI;
        const endAngle = (Math.atan2(world.y - c.y, world.x - c.x) * 180) / Math.PI;
        if (r > 0.1) {
          onExecuteCommand(
            new AddEntitiesCommand(
              [
                {
                  id: createCadId('ent'),
                  handle: '',
                  type: 'ARC',
                  layer: activeLayerName,
                  space: activeSpace,
                  center: { x: c.x, y: c.y, z: 0 },
                  radius: r,
                  startAngle: (startAngle + 360) % 360,
                  endAngle: (endAngle + 360) % 360,
                  preservationTier: 'supported',
                  dirty: true
                }
              ],
              'Vẽ cung tròn (Arc)'
            )
          );
        }
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'text') {
      setTextModalPos(world);
      setTextDraft('');
      return;
    }

    if (activeTool === 'dimension') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('DIM: Chọn điểm đo thứ hai...');
      } else {
        const p1 = draftPoints[0];
        const dist = Math.hypot(world.x - p1.x, world.y - p1.y);
        const mid = { x: (p1.x + world.x) / 2, y: (p1.y + world.y) / 2 + Math.max(120, dist * 0.08), z: 0 };
        onExecuteCommand(
          new AddEntitiesCommand(
            [
              {
                id: createCadId('ent'),
                handle: '',
                type: 'DIMENSION',
                layer: activeLayerName,
                space: activeSpace,
                dimensionType: 'aligned',
                subTypeCode: 1,
                defPoint: { x: p1.x, y: mid.y, z: 0 },
                defPoint2: { x: p1.x, y: p1.y, z: 0 },
                defPoint3: { x: world.x, y: world.y, z: 0 },
                textMidPoint: mid,
                text: '<>',
                measuredValue: dist,
                style: 'STANDARD',
                preservationTier: 'supported',
                dirty: true
              }
            ],
            'Ghi kích thước (Dimension)'
          )
        );
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'insert') {
      const targetBlock =
        activeInsertBlockName ||
        Object.keys(doc.blocks).find(n => !n.startsWith('*Model_Space') && !n.startsWith('*Paper_Space'));
      if (!targetBlock) {
        onStatusPrompt('Chưa có Block nào để chèn.');
        return;
      }
      onExecuteCommand(
        new AddEntitiesCommand(
          [
            {
              id: createCadId('ent'),
              handle: '',
              type: 'INSERT',
              layer: activeLayerName,
              space: activeSpace,
              blockName: targetBlock,
              position: { x: world.x, y: world.y, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              rotation: 0,
              preservationTier: 'supported',
              dirty: true
            }
          ],
          `Chèn Block "${targetBlock}"`
        )
      );
      return;
    }

    if (activeTool === 'measure') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('MEASURE: Chọn điểm thứ hai để đo khoảng cách...');
      } else {
        const d = Math.hypot(world.x - draftPoints[0].x, world.y - draftPoints[0].y);
        onStatusPrompt(`Kết quả đo: ${formatCADMeasurement(d, doc.header.$INSUNITS)}`);
        setDraftPoints([]);
      }
      return;
    }

    // Modification tools
    const selList = doc.entities.filter(ent => selectedIds.has(ent.id) && isCADEntityInSpace(ent, activeSpace));
    if (
      (activeTool === 'move' ||
        activeTool === 'copy' ||
        activeTool === 'rotate' ||
        activeTool === 'scale' ||
        activeTool === 'mirror') &&
      selList.length === 0
    ) {
      const hit = pickTopEntityAtPoint(doc, world, tolWorld, undefined, activeSpace);
      if (hit) {
        onSelectIds(new Set([hit.id]));
        setDraftPoints([world]);
        onStatusPrompt('Đã chọn đối tượng — hãy chọn điểm đích...');
      } else {
        onStatusPrompt('Vui lòng chọn ít nhất 1 đối tượng trước khi thực hiện lệnh.');
      }
      return;
    }

    const editableCount = selList.filter(s => isEntityGeometryEditable(s)).length;
    const protectedCount = selList.length - editableCount;

    if (activeTool === 'move' || activeTool === 'copy') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt(`${activeTool.toUpperCase()}: Chọn điểm đích...`);
      } else {
        if (editableCount === 0) {
          onStatusPrompt(
            `Không thể ${activeTool === 'move' ? 'di chuyển' : 'sao chép'}: ${protectedCount} đối tượng chọn là dữ liệu chỉ đọc/nguyên bản AutoCAD.`
          );
          setDraftPoints([]);
          return;
        }
        const dx = world.x - draftPoints[0].x;
        const dy = world.y - draftPoints[0].y;
        const ids = selList.map(s => s.id);
        onExecuteCommand(
          activeTool === 'move'
            ? new MoveCommand(ids, dx, dy)
            : new CopyEntitiesCommand(selList, dx, dy)
        );
        if (protectedCount > 0) {
          onStatusPrompt(
            `Đã áp dụng cho ${editableCount} đối tượng; bỏ qua ${protectedCount} đối tượng chỉ đọc/đặc thù gốc.`
          );
        }
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'rotate') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('ROTATE: Chọn điểm thứ hai xác định góc xoay (hoặc nhập độ ở dòng lệnh)...');
      } else {
        if (editableCount === 0) {
          onStatusPrompt(`Bỏ qua xoay: đối tượng chỉ đọc/đặc thù được bảo toàn nguyên trạng.`);
          setDraftPoints([]);
          return;
        }
        const origin = draftPoints[0];
        const angleDeg = (Math.atan2(world.y - origin.y, world.x - origin.x) * 180) / Math.PI;
        onExecuteCommand(new RotateCommand(selList.map(s => s.id), origin, angleDeg));
        if (protectedCount > 0) {
          onStatusPrompt(`Đã xoay ${editableCount} đối tượng; bỏ qua ${protectedCount} đối tượng được bảo toàn.`);
        }
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'scale') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('SCALE: Kéo ra xa/gần tâm gốc để chọn hệ số tỉ lệ...');
      } else {
        if (editableCount === 0) {
          onStatusPrompt(`Bỏ qua tỉ lệ: đối tượng chỉ đọc/đặc thù được bảo toàn nguyên trạng.`);
          setDraftPoints([]);
          return;
        }
        const origin = draftPoints[0];
        const dist = Math.hypot(world.x - origin.x, world.y - origin.y);
        const factor = Math.max(0.05, Math.min(20, dist / Math.max(100, (doc.extents.maxX - doc.extents.minX) * 0.05)));
        onExecuteCommand(new ScaleCommand(selList.map(s => s.id), origin, factor));
        if (protectedCount > 0) {
          onStatusPrompt(`Đã thu phóng ${editableCount} đối tượng; bỏ qua ${protectedCount} đối tượng được bảo toàn.`);
        }
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'mirror') {
      if (draftPoints.length === 0) {
        setDraftPoints([world]);
        onStatusPrompt('MIRROR: Chọn điểm thứ hai của trục đối xứng...');
      } else {
        if (editableCount === 0) {
          onStatusPrompt(`Bỏ qua đối xứng: đối tượng chỉ đọc/đặc thù được bảo toàn nguyên trạng.`);
          setDraftPoints([]);
          return;
        }
        onExecuteCommand(new MirrorCommand(selList.map(s => s.id), draftPoints[0], world));
        if (protectedCount > 0) {
          onStatusPrompt(`Đã đối xứng ${editableCount} đối tượng; bỏ qua ${protectedCount} đối tượng được bảo toàn.`);
        }
        setDraftPoints([]);
      }
      return;
    }

    if (activeTool === 'offset') {
      const hit = pickTopEntityAtPoint(doc, world, tolWorld, undefined, activeSpace);
      if (hit && (hit.type === 'LINE' || hit.type === 'LWPOLYLINE')) {
        setOffsetTarget(hit);
      } else {
        onStatusPrompt('OFFSET: Hãy click vào LINE hoặc LWPOLYLINE cần tạo bản song song.');
      }
      return;
    }

    if (activeTool === 'trim' || activeTool === 'extend') {
      const hit = pickTopEntityAtPoint(doc, world, tolWorld, undefined, activeSpace);
      if (!hit || hit.type !== 'LINE' || isCADLayerLocked(doc, hit.layer)) {
        onStatusPrompt(`${activeTool.toUpperCase()}: Hãy click vào đoạn LINE không bị khóa.`);
        return;
      }
      const others = doc.entities.filter(e => e.id !== hit.id && isCADEntityInSpace(e, activeSpace));
      if (activeTool === 'trim') {
        const res = trimLineAgainstCutters(hit, others, world);
        if (!res) {
          onStatusPrompt('TRIM: Không tìm thấy giao điểm cắt phù hợp.');
          return;
        }
        const replacements = res.extra ? [res.updated, res.extra] : [res.updated];
        onExecuteCommand(new ReplaceEntitiesCommand([hit.id], replacements, 'Cắt đoạn thẳng (Trim)'));
      } else {
        const extended = extendLineToBoundaries(hit, others, world);
        if (!extended) {
          onStatusPrompt('EXTEND: Không tìm thấy biên kéo dài phía trước.');
          return;
        }
        onExecuteCommand(new ReplaceEntitiesCommand([hit.id], [extended], 'Kéo dài đoạn thẳng (Extend)'));
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sp = getLocalScreenPoint(e);
    if (panStateRef.current) {
      const dx = sp.x - panStateRef.current.startScreen.x;
      const dy = sp.y - panStateRef.current.startScreen.y;
      setVp(prev => ({
        ...prev,
        centerX: panStateRef.current!.startCenter.x - dx / prev.scale,
        centerY: panStateRef.current!.startCenter.y + dy / prev.scale
      }));
      return;
    }

    if (marqueeStartRef.current) {
      const mode = sp.x >= marqueeStartRef.current.x ? 'window' : 'crossing';
      setMarquee({ startScreen: marqueeStartRef.current, endScreen: sp, mode });
      return;
    }

    const { world, snap } = resolveSnappedWorld(sp);
    setCursorWorld(world);
    setSnapResult(snap);
    onCursorMove(world);

    if (activeTool === 'select') {
      const tolWorld = 10 / Math.max(vp.scale, 1e-6);
      const hit = pickTopEntityAtPoint(doc, world, tolWorld, undefined, activeSpace);
      setHoveredId(hit ? hit.id : null);
    } else if (hoveredId) {
      setHoveredId(null);
    }
  };

  const endPan = () => {
    if (panStateRef.current) {
      panStateRef.current = null;
      panJustEndedRef.current = true;
      setIsPanning(false);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panStateRef.current) {
      endPan();
      return;
    }
    if (marqueeStartRef.current && marquee) {
      const w1 = screenToCadWorld(marquee.startScreen, vp);
      const w2 = screenToCadWorld(marquee.endScreen, vp);
      const box = {
        minX: Math.min(w1.x, w2.x),
        minY: Math.min(w1.y, w2.y),
        maxX: Math.max(w1.x, w2.x),
        maxY: Math.max(w1.y, w2.y)
      };
      const nextIds = new Set<string>(e.shiftKey ? selectedIds : []);
      if (Math.abs(marquee.endScreen.x - marquee.startScreen.x) > 4) {
        for (const ent of doc.entities) {
          if (ent.visible === false || !isCADEntityInSpace(ent, activeSpace)) continue;
          const layer = doc.layers[ent.layer];
          if (layer && (!layer.visible || layer.frozen)) continue;
          if (doesEntityMatchSelectionBox(ent, box, marquee.mode, doc.blocks)) {
            nextIds.add(ent.id);
          }
        }
      }
      onSelectIds(nextIds);
      marqueeStartRef.current = null;
      setMarquee(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    hasUserInteractedRef.current = true;
    const sp = getLocalScreenPoint(e);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setVp(prev => zoomViewportAtScreenPoint(prev, factor, sp.x, sp.y));
  };

  const handleCommitTextModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textModalPos || !textDraft.trim()) {
      setTextModalPos(null);
      return;
    }
    onExecuteCommand(
      new AddEntitiesCommand(
        [
          {
            id: createCadId('ent'),
            handle: '',
            type: 'TEXT',
            layer: activeLayerName,
            space: activeSpace,
            position: { x: textModalPos.x, y: textModalPos.y, z: 0 },
            height: doc.header.$TEXTSIZE || 200,
            rotation: 0,
            text: textDraft.trim(),
            style: 'STANDARD',
            hAlign: 0,
            vAlign: 0,
            widthFactor: 1,
            obliqueAngle: 0,
            preservationTier: 'supported',
            dirty: true
          }
        ],
        'Thêm chữ (TEXT)'
      )
    );
    setTextModalPos(null);
    setTextDraft('');
  };

  const handleCommitOffset = (e: React.FormEvent) => {
    e.preventDefault();
    const d = Math.abs(parseFloat(offsetDist));
    if (!offsetTarget || !Number.isFinite(d) || d <= 0) {
      setOffsetTarget(null);
      return;
    }
    if (offsetTarget.type === 'LINE' || offsetTarget.type === 'LWPOLYLINE') {
      const created = offsetSimpleEntity(offsetTarget, d, cursorWorld);
      created.id = createCadId('ent');
      onExecuteCommand(new AddEntitiesCommand([created], `Offset (${d})`));
    }
    setOffsetTarget(null);
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        onDoubleClick={() => {
          if (activeTool === 'polyline' && draftPoints.length >= 2) {
            commitPolyline(draftPoints, true);
          }
        }}
        onWheel={handleWheel}
        onContextMenu={e => {
          e.preventDefault();
          if (activeTool === 'polyline' && draftPoints.length >= 2) {
            commitPolyline(draftPoints, false);
          } else {
            setDraftPoints([]);
          }
        }}
        className={`block h-full w-full ${
          activeTool === 'pan' || spacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
        }`}
      />

      {/* Inline TEXT entry modal */}
      {textModalPos && (
        <form
          onSubmit={handleCommitTextModal}
          className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-cyan-500/50 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
        >
          <span className="text-cyan-300 font-medium">Nội dung TEXT:</span>
          <input
            autoFocus
            type="text"
            value={textDraft}
            onChange={e => setTextDraft(e.target.value)}
            placeholder="Nhập nhãn CAD..."
            className="w-52 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-cyan-500"
          />
          <button type="submit" className="rounded bg-cyan-600 px-2.5 py-1 font-medium text-white hover:bg-cyan-500">
            Đặt
          </button>
          <button
            type="button"
            onClick={() => setTextModalPos(null)}
            className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            Hủy
          </button>
        </form>
      )}

      {/* Inline OFFSET distance modal */}
      {offsetTarget && (
        <form
          onSubmit={handleCommitOffset}
          className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-cyan-500/50 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
        >
          <span className="text-cyan-300 font-medium">Khoảng cách Offset:</span>
          <input
            autoFocus
            type="number"
            min={0.1}
            step="any"
            value={offsetDist}
            onChange={e => setOffsetDist(e.target.value)}
            className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-cyan-500"
          />
          <button type="submit" className="rounded bg-cyan-600 px-2.5 py-1 font-medium text-white hover:bg-cyan-500">
            Áp dụng
          </button>
          <button
            type="button"
            onClick={() => setOffsetTarget(null)}
            className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            Hủy
          </button>
        </form>
      )}
    </div>
  );
});

CADCanvas.displayName = 'CADCanvas';

