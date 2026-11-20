import React from 'react';
import { Lock } from 'lucide-react';
import { DiagramNode, ProjectState } from '../../types/infrastructure';
import { buildProjectLegendData, computeLegendLayoutMetrics } from '../../utils/legendGenerator';
import { renderDeviceVisualIcon } from '../../utils/deviceIcons';
import { sanitizeSafeImageUrl } from '../../utils/security';
import { RESIZE_HANDLE_DIRS, ResizeHandleDir, StartNodeResizeFn } from './canvasTypes';

interface CanvasLegendNodeProps {
  node: DiagramNode;
  project: ProjectState;
  isSelected: boolean;
  isSingleSelected: boolean;
  isOverlapping: boolean;
  isConnecting: boolean;
  isReadOnlyMode: boolean;
  framePad: number;
  handleSize: number;
  invZ: number;
  getNodeResizeHandlePos?: (dir: ResizeHandleDir) => { x: number; y: number };
  onNodePointerDown: (e: React.PointerEvent, node: DiagramNode) => void;
  onNodeClick: (e: React.MouseEvent | React.PointerEvent, node: DiagramNode) => void;
  onHoverChange: (nodeId: string | null) => void;
  onResizeLegendToFit?: (nodeId: string) => void;
  onStartResize: StartNodeResizeFn;
  onNodeContextMenu?: (e: React.MouseEvent, node: DiagramNode) => void;
}

export const CanvasLegendNode: React.FC<CanvasLegendNodeProps> = React.memo(({
  node,
  project,
  isSelected,
  isSingleSelected,
  isOverlapping,
  isConnecting,
  isReadOnlyMode,
  framePad,
  handleSize,
  invZ,
  getNodeResizeHandlePos,
  onNodePointerDown,
  onNodeClick,
  onHoverChange,
  onResizeLegendToFit,
  onStartResize,
  onNodeContextMenu
}) => {
  const resolveResizeHandlePos = (dir: ResizeHandleDir) => {
    if (getNodeResizeHandlePos) return getNodeResizeHandlePos(dir);
    const left = -framePad;
    const right = node.width + framePad;
    const top = -framePad;
    const bottom = node.height + framePad;
    const cx = node.width / 2;
    const cy = node.height / 2;
    switch (dir) {
      case 'nw': return { x: left, y: top };
      case 'n': return { x: cx, y: top };
      case 'ne': return { x: right, y: top };
      case 'e': return { x: right, y: cy };
      case 'se': return { x: right, y: bottom };
      case 's': return { x: cx, y: bottom };
      case 'sw': return { x: left, y: bottom };
      case 'w': return { x: left, y: cy };
    }
  };
  const legendData = buildProjectLegendData(project, {
    scope: node.customData?.legendScope || 'all',
    includeCables: node.customData?.legendIncludeCables ?? true,
    title: node.customData?.legendTitle || node.label
  });
  const borderHex = node.style.borderColor || '#1d4ed8';
  const explicitScale =
    typeof node.customData?.legendScale === 'number' ? node.customData.legendScale : undefined;
  const metrics = computeLegendLayoutMetrics(
    node.width,
    node.height,
    legendData.components.length,
    explicitScale
  );
  const s = metrics.scale;
  const scalePx = (base: number) => `${(base * s).toFixed(1)}px`;
  const iconBoxPx = Math.max(16, Math.round(24 * s));
  const iconInnerPx = Math.max(11, Math.round(16 * s));

  return (
    <g
      data-testid={`legend-node-${node.id}`}
      transform={`translate(${node.x}, ${node.y}) rotate(${node.rotation || 0}, ${node.width / 2}, ${node.height / 2})`}
      onPointerDown={(e) => onNodePointerDown(e, node)}
      onClick={(e) => onNodeClick(e, node)}
      onContextMenu={(e) => onNodeContextMenu?.(e, node)}
      onPointerEnter={() => onHoverChange(node.id)}
      onPointerLeave={() => onHoverChange(null)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isReadOnlyMode) {
          onResizeLegendToFit?.(node.id);
        }
      }}
      className={`select-none ${isReadOnlyMode ? 'cursor-pointer' : node.locked ? 'cursor-not-allowed' : 'cursor-move'}`}
    >
      {isOverlapping && (
        <g className="pointer-events-none">
          <rect
            x={-4.5}
            y={-4.5}
            width={node.width + 9}
            height={node.height + 9}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.4"
            strokeDasharray="6 3"
            rx="11"
          />
          <rect x={0} y={-18} width="80" height="15" rx="3" fill="#dc2626" />
          <text x="40" y="-7.5" textAnchor="middle" fill="#ffffff" fontSize="8.5" fontWeight="700">
            ! Trùng vị trí
          </text>
        </g>
      )}

      <g
        aria-hidden="true"
        className={`pointer-events-none canvas-selection-halo${isSelected ? ' is-selected' : ''}`}
      >
        <rect
          x={-framePad - 3 * invZ}
          y={-framePad - 3 * invZ}
          width={node.width + (framePad + 3 * invZ) * 2}
          height={node.height + (framePad + 3 * invZ) * 2}
          fill="#3b82f6"
          fillOpacity={0.07}
          stroke="#60a5fa"
          strokeWidth={1.5 * invZ}
          rx="13"
          className="canvas-selection-pulse-ring-lg"
        />
        <rect
          x={isSingleSelected && !node.locked && !isReadOnlyMode ? -framePad : -3}
          y={isSingleSelected && !node.locked && !isReadOnlyMode ? -framePad : -3}
          width={node.width + (isSingleSelected && !node.locked && !isReadOnlyMode ? framePad * 2 : 6)}
          height={node.height + (isSingleSelected && !node.locked && !isReadOnlyMode ? framePad * 2 : 6)}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={isSingleSelected ? 1.5 * invZ : 2}
          strokeDasharray={isSingleSelected && !node.locked && !isReadOnlyMode ? `${3.5 * invZ} ${2.5 * invZ}` : undefined}
          rx="10"
        />
      </g>

      <rect
        width={node.width}
        height={node.height}
        fill={node.style.backgroundColor || '#ffffff'}
        stroke={isOverlapping ? '#ef4444' : isSelected ? '#2563eb' : borderHex}
        strokeWidth={isOverlapping ? 2.6 : isSelected ? 2 : 1.5}
        rx="8"
        className="canvas-node-surface"
        filter={
          isOverlapping
            ? 'drop-shadow(0 0 10px rgba(239,68,68,0.45))'
            : isSelected
            ? 'drop-shadow(0 6px 14px rgba(37,99,235,0.25))'
            : 'drop-shadow(0 3px 8px rgba(15,23,42,0.12))'
        }
      />

      {node.locked && (
        <g transform={`translate(${node.width - 18}, 6)`} className="pointer-events-none">
          <rect width="12" height="12" rx="2" fill="#0f172a" fillOpacity="0.65" />
          <Lock x="2.5" y="2.5" width="7" height="7" color="#fbbf24" />
        </g>
      )}

      <foreignObject x="0" y="0" width={node.width} height={node.height} className="pointer-events-none">
        <div
          className="w-full h-full flex flex-col rounded-[8px] overflow-hidden bg-white text-slate-900"
          data-legend-scale={s}
        >
          {/* CAD Legend Table Header */}
          <div
            className="bg-blue-700 text-white shrink-0"
            style={{
              padding: `${Math.round((metrics.isCompact ? 5 : 8) * s)}px ${Math.round(11 * s)}px`
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="font-bold tracking-wide uppercase truncate"
                style={{ fontSize: scalePx(11) }}
              >
                {legendData.title}
              </span>
              <span
                className="font-mono tabular-nums text-blue-100 shrink-0"
                style={{ fontSize: scalePx(9.5) }}
              >
                {legendData.totalDevices} TB · {legendData.totalCables} Cáp
              </span>
            </div>
            {!metrics.isCompact && (
              <div
                className="text-blue-100 mt-0.5 truncate"
                style={{ fontSize: scalePx(9) }}
              >
                {legendData.scopeLabel}
              </div>
            )}
          </div>

          {/* Table Column Header */}
          {metrics.columns === 1 && (
            <div
              className="grid items-center bg-slate-100 border-b border-slate-200 font-bold uppercase tracking-wider text-slate-600 shrink-0"
              style={{
                gridTemplateColumns: `${iconBoxPx + 4}px 1fr ${Math.round(48 * s)}px`,
                padding: `${Math.round(4 * s)}px ${Math.round(10 * s)}px`,
                fontSize: scalePx(9)
              }}
            >
              <span>Ký hiệu</span>
              <span className="pl-1.5">Thiết bị / Model</span>
              <span className="text-right">SL</span>
            </div>
          )}

          {/* Component Rows */}
          <div
            className="flex-1 overflow-hidden divide-y divide-slate-100"
            style={{ fontSize: scalePx(10.5) }}
          >
            {legendData.components.length === 0 ? (
              <div
                className="px-3 py-4 text-center text-slate-400"
                style={{ fontSize: scalePx(10) }}
              >
                Chưa có thiết bị trong phạm vi đã chọn.
              </div>
            ) : metrics.columns === 2 ? (
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
                {legendData.components.map(item => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-1.5 min-w-0"
                    style={{
                      padding: `${Math.round(5 * s)}px ${Math.round(8 * s)}px`
                    }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div
                        className="rounded flex items-center justify-center text-white shrink-0 overflow-hidden"
                        style={{
                          width: iconBoxPx,
                          height: iconBoxPx,
                          backgroundColor: item.accentColor
                        }}
                      >
                        <span
                          className="flex items-center justify-center"
                          style={{ width: iconInnerPx, height: iconInnerPx }}
                        >
                          {renderDeviceVisualIcon({
                            customIcon: item.customIcon,
                            customImageUrl: sanitizeSafeImageUrl(item.customImageUrl),
                            category: item.category,
                            className: 'w-full h-full'
                          })}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate leading-tight">
                          {item.label}
                        </div>
                        <div
                          className="text-slate-500 truncate"
                          style={{ fontSize: scalePx(8.5) }}
                        >
                          {item.subLabel}
                        </div>
                      </div>
                    </div>
                    <div
                      className="text-right font-mono font-bold text-blue-700 tabular-nums shrink-0"
                      style={{ fontSize: scalePx(10.5) }}
                    >
                      ×{item.count}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              legendData.components.map(item => (
                <div
                  key={item.key}
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: `${iconBoxPx + 4}px 1fr ${Math.round(48 * s)}px`,
                    padding: `${Math.round((metrics.isCompact ? 3.5 : 5.5) * s)}px ${Math.round(10 * s)}px`
                  }}
                >
                  <div
                    className="rounded flex items-center justify-center text-white shrink-0 overflow-hidden"
                    style={{
                      width: iconBoxPx,
                      height: iconBoxPx,
                      backgroundColor: item.accentColor
                    }}
                  >
                    <span
                      className="flex items-center justify-center"
                      style={{ width: iconInnerPx, height: iconInnerPx }}
                    >
                      {renderDeviceVisualIcon({
                        customIcon: item.customIcon,
                        customImageUrl: sanitizeSafeImageUrl(item.customImageUrl),
                        category: item.category,
                        className: 'w-full h-full'
                      })}
                    </span>
                  </div>
                  <div className="pl-1.5 min-w-0">
                    <div className="font-semibold text-slate-900 truncate leading-tight">
                      {item.label}
                    </div>
                    <div
                      className="text-slate-500 truncate"
                      style={{ fontSize: scalePx(8.8) }}
                    >
                      {item.subLabel}
                    </div>
                  </div>
                  <div className="text-right font-mono font-bold text-blue-700 tabular-nums">
                    ×{item.count}
                  </div>
                </div>
              ))
            )}

            {legendData.cables.length > 0 && (
              <div className="bg-slate-50/70">
                <div
                  className="border-t border-slate-200 font-bold uppercase tracking-wider text-slate-500"
                  style={{
                    padding: `${Math.round(3.5 * s)}px ${Math.round(10 * s)}px`,
                    fontSize: scalePx(8.5)
                  }}
                >
                  Quy ước tuyến cáp
                </div>
                {legendData.cables.map(cab => (
                  <div
                    key={cab.key}
                    className="grid items-center border-t border-slate-100"
                    style={{
                      gridTemplateColumns: `${iconBoxPx + 4}px 1fr ${Math.round(74 * s)}px`,
                      padding: `${Math.round(3.5 * s)}px ${Math.round(10 * s)}px`
                    }}
                  >
                    <div className="flex items-center justify-center">
                      <span
                        className="block rounded-xs"
                        style={{
                          width: Math.max(14, Math.round(20 * s)),
                          height: Math.max(3, Math.round(4 * s)),
                          backgroundColor: cab.color
                        }}
                      />
                    </div>
                    <div
                      className="pl-1.5 font-medium text-slate-700 truncate"
                      style={{ fontSize: scalePx(9.2) }}
                    >
                      {cab.label}
                    </div>
                    <div
                      className="text-right font-mono font-semibold text-slate-700 tabular-nums"
                      style={{ fontSize: scalePx(9.2) }}
                    >
                      ×{cab.count} · {cab.totalMeters}m
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="bg-slate-50 border-t border-slate-200 flex items-center justify-between text-slate-500 shrink-0"
            style={{
              padding: `${Math.round(3.5 * s)}px ${Math.round(10 * s)}px`,
              fontSize: scalePx(8.5)
            }}
          >
            <span className="truncate">
              Tự đồng bộ · {Math.round(s * 100)}%{metrics.columns === 2 ? ' · 2 cột' : ''}
            </span>
            <span className="font-mono tabular-nums shrink-0 ml-1">Kéo góc co giãn · Nhấp đúp: Khớp</span>
          </div>
        </div>
      </foreignObject>

      {/* 8 Interactive Resize Handles for Single Selected Unlocked Legend */}
      {isSingleSelected && !node.locked && !isConnecting && !isReadOnlyMode && (
        <g className="canvas-resize-handles">
          {RESIZE_HANDLE_DIRS.map(({ dir, cursorClass }) => {
            const pos = resolveResizeHandlePos(dir);
            return (
              <rect
                key={`nd_h_${dir}`}
                data-testid={dir === 'se' ? `legend-resize-se-${node.id}` : undefined}
                x={pos.x - handleSize / 2}
                y={pos.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={1.5 * invZ}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.5 * invZ}
                pointerEvents="all"
                className={cursorClass}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (node.locked) return;
                  onStartResize(
                    e,
                    node.id,
                    dir,
                    { x: node.x, y: node.y, width: node.width, height: node.height },
                    node.rotation || 0,
                    220,
                    120
                  );
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <title>Kéo để co giãn kích thước bảng chú giải</title>
              </rect>
            );
          })}
        </g>
      )}
    </g>
  );
}, (prev, next) => {
  if (
    prev.node !== next.node ||
    prev.isSelected !== next.isSelected ||
    prev.isSingleSelected !== next.isSingleSelected ||
    prev.isOverlapping !== next.isOverlapping ||
    prev.isConnecting !== next.isConnecting ||
    prev.isReadOnlyMode !== next.isReadOnlyMode ||
    prev.framePad !== next.framePad ||
    prev.handleSize !== next.handleSize ||
    prev.invZ !== next.invZ ||
    prev.onNodePointerDown !== next.onNodePointerDown ||
    prev.onNodeClick !== next.onNodeClick ||
    prev.onHoverChange !== next.onHoverChange ||
    prev.onResizeLegendToFit !== next.onResizeLegendToFit ||
    prev.onStartResize !== next.onStartResize
  ) {
    return false;
  }

  if (
    prev.project.activeFloorId !== next.project.activeFloorId ||
    prev.project.floors !== next.project.floors ||
    prev.project.assets !== next.project.assets ||
    prev.project.cables !== next.project.cables
  ) {
    return false;
  }

  if (prev.project.nodes !== next.project.nodes) {
    if (prev.project.nodes.length !== next.project.nodes.length) return false;
    for (let i = 0; i < prev.project.nodes.length; i++) {
      const pn = prev.project.nodes[i];
      const nn = next.project.nodes[i];
      if (pn === nn) continue;
      if (
        pn.type !== nn.type ||
        pn.floorId !== nn.floorId ||
        pn.assetId !== nn.assetId ||
        pn.customIcon !== nn.customIcon ||
        pn.customImageUrl !== nn.customImageUrl ||
        pn.style?.backgroundColor !== nn.style?.backgroundColor
      ) {
        return false;
      }
    }
  }

  return true;
});
