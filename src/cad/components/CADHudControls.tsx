import React, { useMemo, useRef, useState } from 'react';
import { Map as MapIcon, Maximize, X, ZoomIn, ZoomOut } from 'lucide-react';
import { resolveEntityColorHex } from '../core/CADColorPalette';
import { isCADLayerVisible } from '../core/CADDocument';
import type { BoundingBox2D, CADDocument, CADEntity, Point2D } from '../core/CADTypes';
import {
  computeEntityBounds2D,
  computeSmartFitExtents,
  isValidBounds
} from '../geometry/CADBounds';
import {
  CADViewportState,
  fitViewportToExtents,
  getVisibleWorldBounds
} from '../rendering/CADViewport';

interface CADHudControlsProps {
  doc: CADDocument;
  viewport: CADViewportState;
  lightBg: boolean;
  selectedIds: Set<string>;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitView: () => void;
  onPanToWorldCenter: (center: Point2D) => void;
}

const MINIMAP_WIDTH_PX = 172;
const MINIMAP_HEIGHT_PX = 108;
const MAX_MINIMAP_ENTITIES = 520;

function computeSafeMinimapBounds(smartExtents: BoundingBox2D): BoundingBox2D {
  if (!isValidBounds(smartExtents)) {
    return { minX: -500, minY: -500, maxX: 10500, maxY: 8500 };
  }
  const spanX = Math.max(10, smartExtents.maxX - smartExtents.minX);
  const spanY = Math.max(10, smartExtents.maxY - smartExtents.minY);
  const padX = spanX * 0.08;
  const padY = spanY * 0.08;
  return {
    minX: smartExtents.minX - padX,
    minY: smartExtents.minY - padY,
    maxX: smartExtents.maxX + padX,
    maxY: smartExtents.maxY + padY
  };
}

function sampleEntitiesForMinimap(entities: CADEntity[], doc: CADDocument): CADEntity[] {
  const visible = entities.filter(e => e.visible !== false && isCADLayerVisible(doc, e.layer));
  if (visible.length <= MAX_MINIMAP_ENTITIES) return visible;
  const step = Math.ceil(visible.length / MAX_MINIMAP_ENTITIES);
  const sampled: CADEntity[] = [];
  for (let i = 0; i < visible.length; i += step) {
    sampled.push(visible[i]);
  }
  return sampled;
}

export const CADHudControls: React.FC<CADHudControlsProps> = ({
  doc,
  viewport,
  lightBg,
  selectedIds,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitView,
  onPanToWorldCenter
}) => {
  const [showMinimap, setShowMinimap] = useState(true);
  const minimapDraggingRef = useRef(false);

  const smartExtents = useMemo(() => computeSmartFitExtents(doc), [doc]);

  const mmBounds = useMemo(() => computeSafeMinimapBounds(smartExtents), [smartExtents]);

  const mmSpanX = Math.max(1, mmBounds.maxX - mmBounds.minX);
  const mmSpanY = Math.max(1, mmBounds.maxY - mmBounds.minY);
  const strokeUnit = Math.max(mmSpanX / MINIMAP_WIDTH_PX, mmSpanY / MINIMAP_HEIGHT_PX);

  const sampledEntities = useMemo(
    () => sampleEntitiesForMinimap(doc.entities, doc),
    [doc]
  );

  // Relative Zoom % anchored at Smart Fit-View = 100%
  const zoomPercent = useMemo(() => {
    const baseVp = fitViewportToExtents(smartExtents, viewport.width, viewport.height, 24);
    const ratio = (viewport.scale / Math.max(1e-6, baseVp.scale)) * 100;
    return Math.max(1, Math.min(99999, Math.round(ratio)));
  }, [smartExtents, viewport.width, viewport.height, viewport.scale]);

  const visWorld = useMemo(() => getVisibleWorldBounds(viewport, 0), [viewport]);
  const visW = Math.max(strokeUnit * 4, visWorld.maxX - visWorld.minX);
  const visH = Math.max(strokeUnit * 4, visWorld.maxY - visWorld.minY);

  const panMinimapPointer = (svgEl: SVGSVGElement, clientX: number, clientY: number) => {
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const ratioX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ratioY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

    // ViewBox preserves aspect ratio (meet) centered inside SVG rect; compute exact SVG mapping
    const scaleX = rect.width / mmSpanX;
    const scaleY = rect.height / mmSpanY;
    const uniformScale = Math.min(scaleX, scaleY);
    const renderedW = mmSpanX * uniformScale;
    const renderedH = mmSpanY * uniformScale;
    const padLeft = (rect.width - renderedW) / 2;
    const padTop = (rect.height - renderedH) / 2;

    const normX = Math.max(0, Math.min(1, (clientX - rect.left - padLeft) / Math.max(1, renderedW)));
    const normY = Math.max(0, Math.min(1, (clientY - rect.top - padTop) / Math.max(1, renderedH)));

    const worldX = mmBounds.minX + (Number.isFinite(normX) ? normX : ratioX) * mmSpanX;
    const worldY = mmBounds.maxY - (Number.isFinite(normY) ? normY : ratioY) * mmSpanY;
    onPanToWorldCenter({ x: worldX, y: worldY });
  };

  return (
    <div
      data-testid="cad-hud-controls"
      onPointerDown={e => e.stopPropagation()}
      className="pointer-events-auto absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2 select-none"
    >
      {showMinimap && (
        <div
          data-testid="cad-minimap-panel"
          className="hidden sm:block rounded-xl border border-slate-700/90 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-md"
        >
          <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[10px] font-medium text-slate-400">
            <span>Bản đồ thu nhỏ CAD</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono tabular-nums text-cyan-300">
                {doc.entities.length.toLocaleString('vi-VN')} đt
              </span>
              <button
                type="button"
                onClick={() => setShowMinimap(false)}
                title="Thu gọn bản đồ thu nhỏ"
                aria-label="Thu gọn bản đồ thu nhỏ"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          <svg
            width={MINIMAP_WIDTH_PX}
            height={MINIMAP_HEIGHT_PX}
            viewBox={`${mmBounds.minX} ${-mmBounds.maxY} ${mmSpanX} ${mmSpanY}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="Bản đồ thu nhỏ bản vẽ CAD"
            onPointerDown={e => {
              e.stopPropagation();
              minimapDraggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              panMinimapPointer(e.currentTarget, e.clientX, e.clientY);
            }}
            onPointerMove={e => {
              if (!minimapDraggingRef.current) return;
              panMinimapPointer(e.currentTarget, e.clientX, e.clientY);
            }}
            onPointerUp={() => {
              minimapDraggingRef.current = false;
            }}
            onPointerCancel={() => {
              minimapDraggingRef.current = false;
            }}
            className={`cursor-pointer rounded-lg border border-slate-800 ${
              lightBg ? 'bg-slate-100' : 'bg-slate-950'
            }`}
          >
            {sampledEntities.map(ent => {
              const isSelected = selectedIds.has(ent.id);
              const color = isSelected
                ? '#38bdf8'
                : resolveEntityColorHex(ent, doc, { lightBackground: lightBg });
              const sw = strokeUnit * (isSelected ? 1.8 : 1.1);

              if (ent.type === 'LINE') {
                return (
                  <line
                    key={ent.id}
                    x1={ent.start.x}
                    y1={-ent.start.y}
                    x2={ent.end.x}
                    y2={-ent.end.y}
                    stroke={color}
                    strokeWidth={sw}
                    strokeOpacity={0.85}
                  />
                );
              }
              if (ent.type === 'CIRCLE') {
                return (
                  <circle
                    key={ent.id}
                    cx={ent.center.x}
                    cy={-ent.center.y}
                    r={Math.max(strokeUnit, ent.radius)}
                    fill="none"
                    stroke={color}
                    strokeWidth={sw}
                    strokeOpacity={0.85}
                  />
                );
              }
              if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices.length >= 2) {
                const pts = ent.vertices.map(v => `${v.x},${-v.y}`).join(' ');
                return ent.closed ? (
                  <polygon
                    key={ent.id}
                    points={pts}
                    fill="none"
                    stroke={color}
                    strokeWidth={sw}
                    strokeOpacity={0.85}
                  />
                ) : (
                  <polyline
                    key={ent.id}
                    points={pts}
                    fill="none"
                    stroke={color}
                    strokeWidth={sw}
                    strokeOpacity={0.85}
                  />
                );
              }
              const eb =
                ent.bounds && isValidBounds(ent.bounds)
                  ? ent.bounds
                  : computeEntityBounds2D(ent, doc.blocks);
              if (!isValidBounds(eb)) return null;
              return (
                <rect
                  key={ent.id}
                  x={eb.minX}
                  y={-eb.maxY}
                  width={Math.max(strokeUnit * 2, eb.maxX - eb.minX)}
                  height={Math.max(strokeUnit * 2, eb.maxY - eb.minY)}
                  fill="none"
                  stroke={color}
                  strokeWidth={sw}
                  strokeOpacity={0.7}
                />
              );
            })}

            {/* Live Viewport Bounds Rectangle */}
            <rect
              x={visWorld.minX}
              y={-visWorld.maxY}
              width={visW}
              height={visH}
              fill="#06b6d4"
              fillOpacity={0.12}
              stroke="#22d3ee"
              strokeWidth={strokeUnit * 1.8}
            />
          </svg>
        </div>
      )}

      {/* Compact Zoom & Fit Toolbar */}
      <div
        data-testid="cad-zoom-toolbar"
        className="flex items-center gap-1 rounded-xl border border-slate-700/90 bg-slate-900/95 px-1.5 py-1 text-xs shadow-2xl backdrop-blur-md"
      >
        <button
          type="button"
          onClick={() => setShowMinimap(v => !v)}
          aria-pressed={showMinimap}
          aria-label={showMinimap ? 'Ẩn bản đồ thu nhỏ CAD' : 'Hiện bản đồ thu nhỏ CAD'}
          title={showMinimap ? 'Ẩn bản đồ thu nhỏ' : 'Hiện bản đồ thu nhỏ'}
          className={`hidden sm:inline-flex items-center justify-center rounded-lg p-1.5 transition-colors ${
            showMinimap
              ? 'bg-cyan-500/20 text-cyan-300'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
          }`}
        >
          <MapIcon className="h-3.5 w-3.5" />
        </button>

        <div className="hidden sm:block h-4 w-px bg-slate-700/80" />

        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Thu nhỏ bản vẽ CAD"
          title="Thu nhỏ (-)"
          className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onResetZoom}
          title="Đưa tỷ lệ về 100% vừa khung bản vẽ"
          className="min-w-[46px] rounded-md px-1.5 py-1 text-center font-mono text-[11px] font-semibold tabular-nums text-cyan-300 hover:bg-slate-800 transition-colors"
        >
          {zoomPercent}%
        </button>

        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Phóng to bản vẽ CAD"
          title="Phóng to (+)"
          className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>

        <div className="h-4 w-px bg-slate-700/80" />

        <button
          type="button"
          onClick={onFitView}
          aria-label="Thu phóng vừa khung bản vẽ CAD"
          title="Zoom Fit — Đưa toàn bộ bản vẽ về giữa màn hình (Z)"
          className="inline-flex items-center gap-1 rounded-lg bg-cyan-600/20 px-2 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-600/35 hover:text-white transition-colors"
        >
          <Maximize className="h-3.5 w-3.5" />
          <span>Vừa khung</span>
        </button>
      </div>
    </div>
  );
};
