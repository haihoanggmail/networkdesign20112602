import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Ruler, Trash2, X } from 'lucide-react';
import { CanvasGuideLine } from '../../types/infrastructure';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';

const RULER_SIZE = 20;

interface CanvasGuideOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewportSize: { w: number; h: number };
  zoom: number;
  pan: { x: number; y: number };
  scale: number;
  unit: 'm' | 'cm' | 'mm';
  isDarkSurface: boolean;
  showRulers: boolean;
  isReadOnlyMode: boolean;
  activeFloorId: string;
  guideLines: CanvasGuideLine[];
  onChangeGuideLines: (nextGuideLines: CanvasGuideLine[]) => void;
}

interface ActiveGuideDrag {
  guideId: string | null; // null when creating a brand-new guide from ruler edge
  orientation: 'horizontal' | 'vertical';
  worldPos: number;
  screenPos: number;
  cursorScreenX: number;
  cursorScreenY: number;
  willDelete: boolean;
}

function pickTickStep(zoom: number): { major: number; minor: number } {
  const candidates = [20, 50, 100, 200, 500, 1000, 2000];
  for (const major of candidates) {
    if (major * zoom >= 68) {
      return { major, minor: major >= 100 ? major / 5 : major / 4 };
    }
  }
  return { major: 2000, minor: 400 };
}

function formatWorldMetric(worldPx: number, scale: number, unit: 'm' | 'cm' | 'mm'): string {
  const safeScale = normalizeScalePxPerMeter(scale);
  const meters = worldPx / safeScale;
  if (unit === 'mm') return `${Math.round(meters * 1000)}mm`;
  if (unit === 'cm') return `${Math.round(meters * 100)}cm`;
  return `${meters.toFixed(1)}m`;
}

export const CanvasGuideOverlay: React.FC<CanvasGuideOverlayProps> = ({
  containerRef,
  viewportSize,
  zoom,
  pan,
  scale,
  unit,
  isDarkSurface,
  showRulers,
  isReadOnlyMode,
  activeFloorId,
  guideLines,
  onChangeGuideLines
}) => {
  const [activeDrag, setActiveDrag] = useState<ActiveGuideDrag | null>(null);
  const [hoveredGuideId, setHoveredGuideId] = useState<string | null>(null);
  const [showCornerMenu, setShowCornerMenu] = useState(false);

  const dragRef = useRef<ActiveGuideDrag | null>(null);
  const allGuidesRef = useRef(guideLines);
  allGuidesRef.current = guideLines;
  const onChangeRef = useRef(onChangeGuideLines);
  onChangeRef.current = onChangeGuideLines;

  const visibleGuides = useMemo(
    () => guideLines.filter(g => !g.floorId || !activeFloorId || g.floorId === activeFloorId),
    [guideLines, activeFloorId]
  );

  const { major: majorStep, minor: minorStep } = useMemo(() => pickTickStep(zoom), [zoom]);

  const horizontalTicks = useMemo(() => {
    if (!showRulers) return { majors: [] as Array<{ pos: number; label: number }>, minors: [] as number[] };
    const startWorld = Math.floor((-pan.x / zoom) / minorStep) * minorStep;
    const endWorld = Math.ceil(((viewportSize.w - pan.x) / zoom) / minorStep) * minorStep;
    const majors: Array<{ pos: number; label: number }> = [];
    const minors: number[] = [];
    for (let w = startWorld; w <= endWorld; w += minorStep) {
      const screenX = w * zoom + pan.x;
      if (screenX < RULER_SIZE - 4 || screenX > viewportSize.w + 4) continue;
      const isMajor = Math.abs(Math.round(w / majorStep) * majorStep - w) < 0.01;
      if (isMajor) majors.push({ pos: screenX, label: Math.round(w) });
      else minors.push(screenX);
    }
    return { majors, minors };
  }, [showRulers, pan.x, zoom, viewportSize.w, majorStep, minorStep]);

  const verticalTicks = useMemo(() => {
    if (!showRulers) return { majors: [] as Array<{ pos: number; label: number }>, minors: [] as number[] };
    const startWorld = Math.floor((-pan.y / zoom) / minorStep) * minorStep;
    const endWorld = Math.ceil(((viewportSize.h - pan.y) / zoom) / minorStep) * minorStep;
    const majors: Array<{ pos: number; label: number }> = [];
    const minors: number[] = [];
    for (let w = startWorld; w <= endWorld; w += minorStep) {
      const screenY = w * zoom + pan.y;
      if (screenY < RULER_SIZE - 4 || screenY > viewportSize.h + 4) continue;
      const isMajor = Math.abs(Math.round(w / majorStep) * majorStep - w) < 0.01;
      if (isMajor) majors.push({ pos: screenY, label: Math.round(w) });
      else minors.push(screenY);
    }
    return { majors, minors };
  }, [showRulers, pan.y, zoom, viewportSize.h, majorStep, minorStep]);

  const computeDragState = (
    guideId: string | null,
    orientation: 'horizontal' | 'vertical',
    clientX: number,
    clientY: number,
    snapStep = 1
  ): ActiveGuideDrag => {
    const rect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: viewportSize.w, height: viewportSize.h };
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const rawScreen = orientation === 'horizontal' ? relY : relX;
    const rawWorld =
      orientation === 'horizontal'
        ? (relY - pan.y) / zoom
        : (relX - pan.x) / zoom;
    const snappedWorld = Math.round(rawWorld / snapStep) * snapStep;
    const snappedScreen = orientation === 'horizontal' ? snappedWorld * zoom + pan.y : snappedWorld * zoom + pan.x;
    const minValidEdge = showRulers ? RULER_SIZE : 4;
    const willDelete = rawScreen < minValidEdge;

    return {
      guideId,
      orientation,
      worldPos: snappedWorld,
      screenPos: snappedScreen,
      cursorScreenX: relX,
      cursorScreenY: relY,
      willDelete
    };
  };

  useEffect(() => {
    if (!activeDrag) return;

    const handleMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const step = e.shiftKey ? 20 : 1;
      const next = computeDragState(dragRef.current.guideId, dragRef.current.orientation, e.clientX, e.clientY, step);
      dragRef.current = next;
      setActiveDrag(next);
    };

    const handleUp = () => {
      const finished = dragRef.current;
      dragRef.current = null;
      setActiveDrag(null);
      if (!finished) return;

      const current = allGuidesRef.current;
      if (finished.willDelete) {
        if (finished.guideId) {
          onChangeRef.current(current.filter(g => g.id !== finished.guideId));
        }
        return;
      }

      if (finished.guideId) {
        onChangeRef.current(
          current.map(g => (g.id === finished.guideId ? { ...g, pos: finished.worldPos } : g))
        );
      } else {
        const newGuide: CanvasGuideLine = {
          id: `guide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          orientation: finished.orientation,
          pos: finished.worldPos,
          floorId: activeFloorId || undefined
        };
        onChangeRef.current([...current, newGuide]);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  });

  const startGuideDrag = (
    e: React.PointerEvent,
    orientation: 'horizontal' | 'vertical',
    guideId: string | null
  ) => {
    if (isReadOnlyMode || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setShowCornerMenu(false);
    const initial = computeDragState(guideId, orientation, e.clientX, e.clientY, e.shiftKey ? 20 : 1);
    dragRef.current = initial;
    setActiveDrag(initial);
  };

  const deleteGuide = (guideId: string) => {
    if (isReadOnlyMode) return;
    onChangeGuideLines(guideLines.filter(g => g.id !== guideId));
    setHoveredGuideId(prev => (prev === guideId ? null : prev));
  };

  const addCenterGuide = (orientation: 'horizontal' | 'vertical') => {
    if (isReadOnlyMode) return;
    const centerWorld =
      orientation === 'horizontal'
        ? Math.round((viewportSize.h / 2 - pan.y) / zoom)
        : Math.round((viewportSize.w / 2 - pan.x) / zoom);
    const newGuide: CanvasGuideLine = {
      id: `guide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      orientation,
      pos: centerWorld,
      floorId: activeFloorId || undefined
    };
    onChangeGuideLines([...guideLines, newGuide]);
    setShowCornerMenu(false);
  };

  const clearFloorGuides = () => {
    if (isReadOnlyMode) return;
    onChangeGuideLines(
      guideLines.filter(g => g.floorId && activeFloorId && g.floorId !== activeFloorId)
    );
    setShowCornerMenu(false);
  };

  const rulerBgClass = isDarkSurface
    ? 'bg-slate-900/95 border-slate-700 text-slate-400'
    : 'bg-white/95 border-slate-200 text-slate-500';

  const tickStroke = isDarkSurface ? '#475569' : '#cbd5e1';
  const majorTickStroke = isDarkSurface ? '#94a3b8' : '#64748b';

  return (
    <div className="absolute inset-0 pointer-events-none z-15 no-print">
      {/* Placed Reference Guide Lines */}
      {visibleGuides.map(g => {
        const isBeingDragged = activeDrag?.guideId === g.id;
        const effectivePos = isBeingDragged && activeDrag ? activeDrag.worldPos : g.pos;
        const screenPos =
          g.orientation === 'horizontal'
            ? effectivePos * zoom + pan.y
            : effectivePos * zoom + pan.x;

        if (g.orientation === 'horizontal') {
          if (screenPos < -20 || screenPos > viewportSize.h + 20) return null;
          const isActive = hoveredGuideId === g.id || isBeingDragged;
          const isPendingDelete = isBeingDragged && activeDrag?.willDelete;
          return (
            <div
              key={g.id}
              data-testid={`canvas-guide-line-h-${g.id}`}
              style={{ top: `${screenPos}px` }}
              onMouseEnter={() => setHoveredGuideId(g.id)}
              onMouseLeave={() => setHoveredGuideId(prev => (prev === g.id ? null : prev))}
              onPointerDown={e => startGuideDrag(e, 'horizontal', g.id)}
              onDoubleClick={e => {
                e.stopPropagation();
                deleteGuide(g.id);
              }}
              className={`absolute left-0 right-0 h-[11px] -translate-y-1/2 pointer-events-auto ${
                isReadOnlyMode ? 'pointer-events-none' : 'cursor-ns-resize'
              }`}
              title="Đường gióng ngang · Kéo để di chuyển, kéo lên thước hoặc nhấp đúp để xóa"
            >
              <div
                className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t transition-colors ${
                  isPendingDelete
                    ? 'border-rose-500 border-dashed'
                    : isActive
                    ? 'border-cyan-400 border-solid shadow-[0_0_6px_rgba(6,182,212,0.5)]'
                    : 'border-cyan-500/80 border-dashed'
                }`}
              />
              {isActive && !isBeingDragged && (
                <div
                  className="absolute left-7 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/95 text-cyan-300 border border-cyan-500/60 shadow-sm text-[10px] font-mono tabular-nums"
                  onPointerDown={e => e.stopPropagation()}
                >
                  <span>Y:{Math.round(g.pos)}px</span>
                  {!isReadOnlyMode && (
                    <button
                      type="button"
                      onClick={() => deleteGuide(g.id)}
                      aria-label="Xóa đường gióng ngang"
                      className="text-slate-400 hover:text-rose-400 p-0.5"
                      title="Xóa đường gióng"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        }

        if (screenPos < -20 || screenPos > viewportSize.w + 20) return null;
        const isActive = hoveredGuideId === g.id || isBeingDragged;
        const isPendingDelete = isBeingDragged && activeDrag?.willDelete;
        return (
          <div
            key={g.id}
            data-testid={`canvas-guide-line-v-${g.id}`}
            style={{ left: `${screenPos}px` }}
            onMouseEnter={() => setHoveredGuideId(g.id)}
            onMouseLeave={() => setHoveredGuideId(prev => (prev === g.id ? null : prev))}
            onPointerDown={e => startGuideDrag(e, 'vertical', g.id)}
            onDoubleClick={e => {
              e.stopPropagation();
              deleteGuide(g.id);
            }}
            className={`absolute top-0 bottom-0 w-[11px] -translate-x-1/2 pointer-events-auto ${
              isReadOnlyMode ? 'pointer-events-none' : 'cursor-ew-resize'
            }`}
            title="Đường gióng dọc · Kéo để di chuyển, kéo sang thước hoặc nhấp đúp để xóa"
          >
            <div
              className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 border-l transition-colors ${
                isPendingDelete
                  ? 'border-rose-500 border-dashed'
                  : isActive
                  ? 'border-cyan-400 border-solid shadow-[0_0_6px_rgba(6,182,212,0.5)]'
                  : 'border-cyan-500/80 border-dashed'
              }`}
            />
            {isActive && !isBeingDragged && (
              <div
                className="absolute top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900/95 text-cyan-300 border border-cyan-500/60 shadow-sm text-[10px] font-mono tabular-nums whitespace-nowrap"
                onPointerDown={e => e.stopPropagation()}
              >
                <span>X:{Math.round(g.pos)}px</span>
                {!isReadOnlyMode && (
                  <button
                    type="button"
                    onClick={() => deleteGuide(g.id)}
                    aria-label="Xóa đường gióng dọc"
                    className="text-slate-400 hover:text-rose-400 p-0.5"
                    title="Xóa đường gióng"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Live Drag Preview when pulling a new guide from ruler edge (or repositioning) */}
      {activeDrag && !activeDrag.guideId && (
        activeDrag.orientation === 'horizontal' ? (
          <div
            style={{ top: `${activeDrag.screenPos}px` }}
            className={`absolute left-0 right-0 border-t-2 pointer-events-none ${
              activeDrag.willDelete ? 'border-rose-500 border-dashed' : 'border-cyan-400 border-dashed'
            }`}
          />
        ) : (
          <div
            style={{ left: `${activeDrag.screenPos}px` }}
            className={`absolute top-0 bottom-0 border-l-2 pointer-events-none ${
              activeDrag.willDelete ? 'border-rose-500 border-dashed' : 'border-cyan-400 border-dashed'
            }`}
          />
        )
      )}

      {/* Live Drag Coordinate Badge */}
      {activeDrag && (
        <div
          style={{
            left: `${Math.min(Math.max(28, activeDrag.cursorScreenX + 14), viewportSize.w - 150)}px`,
            top: `${Math.min(Math.max(28, activeDrag.cursorScreenY + 14), viewportSize.h - 40)}px`
          }}
          className={`absolute px-2 py-1 rounded-md shadow-lg text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap pointer-events-none z-30 ${
            activeDrag.willDelete
              ? 'bg-rose-600 text-white'
              : 'bg-slate-900/95 text-cyan-300 border border-cyan-500/70'
          }`}
        >
          {activeDrag.willDelete
            ? 'Thả trên thước để xóa'
            : `${activeDrag.orientation === 'horizontal' ? 'Y' : 'X'}: ${Math.round(activeDrag.worldPos)}px · ${formatWorldMetric(activeDrag.worldPos, scale, unit)}`}
        </div>
      )}

      {/* Viewport Edge Rulers (Drag Horizontal from Top, Vertical from Left) */}
      {showRulers && (
        <>
          {/* Top Horizontal Ruler */}
          <div
            data-testid="canvas-top-ruler"
            role="slider"
            aria-label="Thước ngang — Kéo xuống để tạo đường gióng ngang"
            aria-valuenow={0}
            onPointerDown={e => startGuideDrag(e, 'horizontal', null)}
            className={`absolute top-0 left-5 right-0 h-5 border-b pointer-events-auto overflow-hidden select-none ${rulerBgClass} ${
              isReadOnlyMode ? 'cursor-default' : 'cursor-ns-resize'
            }`}
            title="Kéo từ thước ngang xuống vùng vẽ để tạo đường gióng ngang (Giữ Shift để bắt lưới 20px)"
          >
            <svg width="100%" height={RULER_SIZE} className="block">
              {horizontalTicks.minors.map((sx, i) => (
                <line key={`hm_${i}`} x1={sx - RULER_SIZE} y1={14} x2={sx - RULER_SIZE} y2={20} stroke={tickStroke} strokeWidth={1} />
              ))}
              {horizontalTicks.majors.map((t, i) => (
                <g key={`hM_${i}`}>
                  <line x1={t.pos - RULER_SIZE} y1={6} x2={t.pos - RULER_SIZE} y2={20} stroke={majorTickStroke} strokeWidth={1} />
                  <text
                    x={t.pos - RULER_SIZE + 3}
                    y={11}
                    fontSize="9"
                    fontFamily="ui-monospace, monospace"
                    fill="currentColor"
                  >
                    {t.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Left Vertical Ruler */}
          <div
            data-testid="canvas-left-ruler"
            role="slider"
            aria-label="Thước dọc — Kéo sang phải để tạo đường gióng dọc"
            aria-valuenow={0}
            onPointerDown={e => startGuideDrag(e, 'vertical', null)}
            className={`absolute top-5 left-0 bottom-0 w-5 border-r pointer-events-auto overflow-hidden select-none ${rulerBgClass} ${
              isReadOnlyMode ? 'cursor-default' : 'cursor-ew-resize'
            }`}
            title="Kéo từ thước dọc sang phải vào vùng vẽ để tạo đường gióng dọc (Giữ Shift để bắt lưới 20px)"
          >
            <svg width={RULER_SIZE} height="100%" className="block">
              {verticalTicks.minors.map((sy, i) => (
                <line key={`vm_${i}`} x1={14} y1={sy - RULER_SIZE} x2={20} y2={sy - RULER_SIZE} stroke={tickStroke} strokeWidth={1} />
              ))}
              {verticalTicks.majors.map((t, i) => (
                <g key={`vM_${i}`}>
                  <line x1={6} y1={t.pos - RULER_SIZE} x2={20} y2={t.pos - RULER_SIZE} stroke={majorTickStroke} strokeWidth={1} />
                  <text
                    x={11}
                    y={t.pos - RULER_SIZE + 3}
                    fontSize="9"
                    fontFamily="ui-monospace, monospace"
                    fill="currentColor"
                    transform={`rotate(-90, 11, ${t.pos - RULER_SIZE + 3})`}
                    textAnchor="end"
                  >
                    {t.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Top-Left Ruler Origin Corner & Quick Guide Controls */}
          <div
            className="absolute top-0 left-0 w-5 h-5 pointer-events-auto z-20"
            onPointerDown={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowCornerMenu(prev => !prev)}
              aria-label="Quản lý đường gióng và thước đo"
              aria-expanded={showCornerMenu}
              title={`Đường gióng căn chỉnh (${visibleGuides.length})`}
              className={`w-5 h-5 border-r border-b flex items-center justify-center transition-colors ${rulerBgClass} ${
                visibleGuides.length > 0
                  ? 'text-cyan-500 font-bold'
                  : 'hover:text-[#155EEF]'
              }`}
            >
              {visibleGuides.length > 0 ? (
                <span className="text-[9px] font-mono tabular-nums">{visibleGuides.length}</span>
              ) : (
                <Ruler className="w-2.5 h-2.5" />
              )}
            </button>

            {showCornerMenu && (
              <div className="absolute top-6 left-1 w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-2 text-xs text-slate-800 dark:text-slate-100 space-y-1.5 z-30">
                <div className="flex items-center justify-between px-1.5 pb-1 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-bold text-slate-900 dark:text-white">
                    Đường gióng căn chỉnh ({visibleGuides.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowCornerMenu(false)}
                    className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {!isReadOnlyMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => addCenterGuide('horizontal')}
                      className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center gap-2 font-medium"
                    >
                      <Plus className="w-3.5 h-3.5 text-cyan-500" />
                      <span>Thêm đường gióng ngang (giữa khung)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => addCenterGuide('vertical')}
                      className="w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center gap-2 font-medium"
                    >
                      <Plus className="w-3.5 h-3.5 text-cyan-500" />
                      <span>Thêm đường gióng dọc (giữa khung)</span>
                    </button>
                  </>
                )}

                {visibleGuides.length > 0 && !isReadOnlyMode && (
                  <button
                    type="button"
                    onClick={clearFloorGuides}
                    className="w-full px-2 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-left flex items-center gap-2 font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa tất cả đường gióng ({visibleGuides.length})</span>
                  </button>
                )}

                <p className="px-1.5 pt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800">
                  Kéo từ thước ngang/dọc để đặt đường gióng; thiết bị khi kéo sẽ tự bắt dính theo đường gióng. Kéo trả về mép thước hoặc nhấp đúp để xóa.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
