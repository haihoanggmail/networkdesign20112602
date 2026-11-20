import React from 'react';
import { Lock } from 'lucide-react';
import { DiagramNode, DeviceAsset } from '../../types/infrastructure';
import { renderDeviceVisualIcon } from '../../utils/deviceIcons';
import { getCategoryAccentColor, isStandardCatalogNodeColor } from '../../data/deviceCatalog';
import { resolveCameraFov, resolveWifiCoverage } from '../../utils/coverageUtils';
import { sanitizeSafeImageUrl } from '../../utils/security';
import { RESIZE_HANDLE_DIRS, ResizeHandleDir, StartNodeResizeFn } from './canvasTypes';

export interface CanvasDeviceNodeProps {
  node: DiagramNode;
  asset?: DeviceAsset;
  isSelected: boolean;
  isSingleSelected: boolean;
  isHovered: boolean;
  isOverlapping: boolean;
  isConnecting: boolean;
  isConnectingFromThis: boolean;
  isTargetCandidate: boolean;
  isDarkCanvas: boolean;
  showIpAddresses: boolean;
  hideLabels: boolean;
  isReadOnlyMode: boolean;
  zoom: number;
  lowDetailMode?: boolean;
  enableShadows?: boolean;
  onNodePointerDown: (e: React.PointerEvent, node: DiagramNode) => void;
  onNodeClick: (e: React.MouseEvent | React.PointerEvent, node: DiagramNode) => void;
  onNodeContextMenu: (e: React.MouseEvent, node: DiagramNode) => void;
  onHoverChange: (nodeId: string | null) => void;
  onDoubleClickNode: (nodeId: string, assetId?: string) => void;
  onToggleIconPicker: (nodeId: string) => void;
  onPortClick: (e: React.MouseEvent, nodeId: string) => void;
  onStartResize: StartNodeResizeFn;
}

export const CanvasDeviceNode: React.FC<CanvasDeviceNodeProps> = React.memo(({
  node,
  asset,
  isSelected,
  isSingleSelected,
  isHovered,
  isOverlapping,
  isConnecting,
  isConnectingFromThis,
  isTargetCandidate,
  isDarkCanvas,
  showIpAddresses,
  hideLabels,
  isReadOnlyMode,
  zoom,
  lowDetailMode = false,
  enableShadows = true,
  onNodePointerDown,
  onNodeClick,
  onNodeContextMenu,
  onHoverChange,
  onDoubleClickNode,
  onToggleIconPicker,
  onPortClick,
  onStartResize
}) => {
  const resolvedCustomIcon = node.customIcon || asset?.customIcon;
  const resolvedCustomImage = sanitizeSafeImageUrl(node.customImageUrl || asset?.customImageUrl);
  const isBrandLogo = Boolean(resolvedCustomIcon && resolvedCustomIcon.startsWith('logo_'));
  const shapeRx =
    node.style.shape === 'circle'
      ? Math.max(node.width, node.height) / 2
      : node.style.shape === 'rect'
      ? 2
      : 8;

  const minDim = Math.min(node.width, node.height);
  const isExpandedLayout = node.height >= 72 || (node.width <= 96 && node.height >= 56);
  const iconBoxPx = isExpandedLayout
    ? Math.min(58, Math.max(24, Math.round(minDim * 0.44)))
    : Math.min(40, Math.max(22, Math.round(node.height * 0.54)));
  const iconInnerPx = Math.max(14, Math.round(iconBoxPx * (resolvedCustomImage || isBrandLogo ? 0.88 : 0.62)));
  const showIpPill = Boolean(
    showIpAddresses &&
    !hideLabels &&
    (asset?.ipAddress || asset?.vlan) &&
    node.height >= 46
  );

  const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
  const handleSize = 7.5 * invZ;
  const framePad = 5 * invZ;

  const getNodeResizeHandlePos = (dir: ResizeHandleDir) => {
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

  const isTextNode = node.type === 'text';
  const isZoneNode = node.type === 'zone';
  const isWallNode = node.type === 'wall';
  const isNeutralCatalogCard =
    !isTextNode &&
    !isZoneNode &&
    !isWallNode &&
    isStandardCatalogNodeColor(node.style.backgroundColor);

  const cardFill = isTextNode
    ? isDarkCanvas
      ? '#1e293b'
      : '#ffffff'
    : isNeutralCatalogCard
    ? isDarkCanvas
      ? '#1e293b'
      : '#ffffff'
    : node.style.backgroundColor || '#155eef';

  const cardStroke = isOverlapping
    ? '#dc2626'
    : isSelected || isConnectingFromThis
    ? '#155eef'
    : isNeutralCatalogCard
    ? isDarkCanvas
      ? '#334155'
      : '#cbd5e1'
    : node.style.borderColor || '#334155';

  const iconAccent = getCategoryAccentColor(asset?.category || node.type);
  const camHeading = !isTextNode && !isZoneNode && !isWallNode ? resolveCameraFov(node, asset) : null;
  const wifiHeading = !isTextNode && !isZoneNode && !isWallNode ? resolveWifiCoverage(node, asset) : null;
  const headingColor = camHeading ? '#f59e0b' : wifiHeading?.isDirectional ? '#10b981' : null;
  const isVisualFlipX = !headingColor && Boolean(node.flipX);
  const isVisualFlipY = !headingColor && Boolean(node.flipY);

  return (
    <g
      transform={`translate(${node.x}, ${node.y}) rotate(${node.rotation || 0}, ${node.width / 2}, ${node.height / 2})`}
      onPointerDown={(e) => onNodePointerDown(e, node)}
      onClick={(e) => onNodeClick(e, node)}
      onContextMenu={(e) => onNodeContextMenu(e, node)}
      onPointerEnter={() => onHoverChange(node.id)}
      onPointerLeave={() => onHoverChange(null)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClickNode(node.id, asset?.id);
      }}
      className={`select-none group ${
        isConnecting && !isReadOnlyMode
          ? 'cursor-pointer'
          : isReadOnlyMode
          ? 'cursor-pointer'
          : node.locked
          ? 'cursor-not-allowed'
          : 'cursor-move'
      }`}
    >
      {isTargetCandidate && (
        <rect
          x="-4"
          y="-4"
          width={node.width + 8}
          height={node.height + 8}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2.5"
          strokeDasharray="4 4"
          rx={shapeRx + 4}
        />
      )}

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
            strokeDasharray="5 3"
            rx={shapeRx + 4}
          />
          <rect x={0} y={-17} width="78" height="14" rx="3" fill="#dc2626" />
          <text x="39" y="-7" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="700">
            ! Chồng lấn
          </text>
          <title>Cảnh báo: Thiết bị đang chồng lấn vị trí với đối tượng khác</title>
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
          fillOpacity={0.08}
          stroke="#60a5fa"
          strokeWidth={1.5 * invZ}
          rx={node.style.shape === 'circle' ? shapeRx + 7 : shapeRx + 6}
          className="canvas-selection-pulse-ring"
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
          rx={node.style.shape === 'circle' ? shapeRx + 4 : shapeRx + 3}
        />
      </g>

      {isTextNode ? (
        <>
          <rect
            width={node.width}
            height={node.height}
            fill={cardFill}
            fillOpacity={0.94}
            stroke={isOverlapping ? '#dc2626' : isSelected ? '#155eef' : isDarkCanvas ? '#475569' : '#cbd5e1'}
            strokeWidth={isSelected ? 1.8 : 1}
            strokeDasharray={isSelected ? undefined : '4 3'}
            rx={shapeRx}
            className="canvas-node-surface"
          />
          <foreignObject x="0" y="0" width={node.width} height={node.height} className="pointer-events-none">
            <div
              style={{ fontSize: node.style.fontSize || 12 }}
              className={`w-full h-full px-2.5 py-1.5 flex items-center font-medium leading-snug break-words ${
                isDarkCanvas ? 'text-slate-100' : 'text-slate-800'
              }`}
            >
              {node.label}
            </div>
          </foreignObject>
        </>
      ) : isZoneNode ? (
        <>
          <rect
            width={node.width}
            height={node.height}
            fill={node.style.backgroundColor || '#EFF6FF'}
            fillOpacity={0.42}
            stroke={isOverlapping ? '#dc2626' : isSelected ? '#155eef' : node.style.borderColor || '#155EEF'}
            strokeWidth={isSelected ? 2 : 1.5}
            strokeDasharray="6 4"
            rx={shapeRx}
            className="canvas-node-surface"
          />
          <foreignObject x="0" y="0" width={node.width} height={28} className="pointer-events-none">
            <div className="px-2.5 py-1 text-[11px] font-bold tracking-tight text-blue-900 dark:text-blue-200 truncate">
              {node.label}
            </div>
          </foreignObject>
        </>
      ) : (
        <>
          <rect
            width={node.width}
            height={node.height}
            fill={cardFill}
            stroke={cardStroke}
            strokeWidth={isOverlapping ? 2.4 : isSelected ? 2 : 1.25}
            rx={shapeRx}
            className="canvas-node-surface"
            filter={
              enableShadows
                ? isOverlapping
                  ? 'drop-shadow(0 0 8px rgba(220,38,38,0.45))'
                  : isSelected
                  ? 'drop-shadow(0 0 8px rgba(21,94,239,0.35))'
                  : 'drop-shadow(0 1px 3px rgba(15,23,42,0.08))'
                : undefined
            }
          />

          {(!lowDetailMode || isSelected || isHovered) && (
            <circle
              cx={
                isVisualFlipX
                  ? node.style.shape === 'circle'
                    ? Math.max(12, node.width * 0.16)
                    : 9
                  : node.width - (node.style.shape === 'circle' ? Math.max(12, node.width * 0.16) : 9)
              }
              cy={
                isVisualFlipY
                  ? node.height - (node.style.shape === 'circle' ? Math.max(10, node.height * 0.16) : 9)
                  : node.style.shape === 'circle'
                  ? Math.max(10, node.height * 0.16)
                  : 9
              }
              r="3"
              fill={asset?.status === 'online' ? '#16a34a' : asset?.status === 'standby' ? '#f59e0b' : '#dc2626'}
            />
          )}
          {headingColor && (!lowDetailMode || isSelected || isHovered) && (
            <polygon
              points={`${node.width + 0.5},${node.height / 2 - 4} ${node.width + 6.5},${node.height / 2} ${node.width + 0.5},${node.height / 2 + 4}`}
              fill={headingColor}
              stroke="#ffffff"
              strokeWidth="0.9"
              className="pointer-events-none"
            />
          )}
          {node.locked && (
            <g
              transform={`translate(${isVisualFlipX ? 11 : node.width - 21}, ${isVisualFlipY ? node.height - 13 : 3})`}
              className="pointer-events-none"
            >
              <rect width="10" height="10" rx="2" fill="#0f172a" fillOpacity="0.7" />
              <Lock x="2" y="2" width="6" height="6" color="#fbbf24" />
            </g>
          )}

          <foreignObject x="0" y="0" width={node.width} height={node.height} className="pointer-events-none">
            <div
              className={`w-full h-full flex ${
                isNeutralCatalogCard
                  ? isDarkCanvas
                    ? 'text-slate-100'
                    : 'text-slate-900'
                  : 'text-white'
              } ${
                isExpandedLayout
                  ? `${isVisualFlipY ? 'flex-col-reverse' : 'flex-col'} items-center justify-center gap-1 p-1.5 text-center`
                  : `${isVisualFlipY ? 'flex-col-reverse' : 'flex-col'} justify-between p-1.5`
              }`}
            >
              <div
                className={`flex items-center overflow-hidden ${
                  isExpandedLayout
                    ? `${isVisualFlipY ? 'flex-col-reverse' : 'flex-col'} justify-center gap-1 w-full`
                    : isVisualFlipX
                    ? 'gap-1.5 flex-row-reverse justify-between w-full'
                    : 'gap-1.5'
                }`}
              >
                <div
                  onPointerDown={isSingleSelected && !isConnecting && !isReadOnlyMode ? (e) => e.stopPropagation() : undefined}
                  onClick={
                    isSingleSelected && !isConnecting && !isReadOnlyMode
                      ? (e) => {
                          e.stopPropagation();
                          onToggleIconPicker(node.id);
                        }
                      : undefined
                  }
                  style={{
                    width: iconBoxPx,
                    height: iconBoxPx,
                    backgroundColor: isNeutralCatalogCard ? iconAccent : 'rgba(0,0,0,0.24)'
                  }}
                  className={`rounded-md flex items-center justify-center text-white shrink-0 overflow-hidden transition-transform ${
                    isSingleSelected && !isConnecting && !isReadOnlyMode
                      ? 'pointer-events-auto cursor-pointer ring-1 ring-blue-400/70 hover:ring-2 hover:ring-blue-500 hover:scale-105'
                      : ''
                  }`}
                  title={isSingleSelected && !isReadOnlyMode ? 'Nhấn để đổi Icon / Logo' : undefined}
                >
                  <span
                    style={{
                      width: iconInnerPx,
                      height: iconInnerPx,
                      transform:
                        isVisualFlipX || isVisualFlipY
                          ? `scale(${isVisualFlipX ? -1 : 1}, ${isVisualFlipY ? -1 : 1})`
                          : undefined
                    }}
                    className="flex items-center justify-center"
                  >
                    {renderDeviceVisualIcon({
                      customIcon: resolvedCustomIcon,
                      customImageUrl: resolvedCustomImage,
                      category: asset?.category || node.type,
                      className: 'w-full h-full'
                    })}
                  </span>
                </div>
                <div
                  className={`truncate font-semibold leading-tight ${
                    isExpandedLayout
                      ? 'w-full px-1 text-center text-[11px]'
                      : isVisualFlipX
                      ? 'text-[11px] pl-3 text-right'
                      : 'text-[11px] pr-3'
                  }`}
                >
                  {asset?.name || node.label}
                </div>
              </div>

              {showIpPill && (!lowDetailMode || isSelected || isHovered) && (
                <div
                  className={`flex items-center justify-between gap-1 font-mono text-[8.5px] px-1.5 py-0.5 rounded truncate tabular-nums ${
                    isNeutralCatalogCard
                      ? isDarkCanvas
                        ? 'bg-slate-800 text-slate-300'
                        : 'bg-slate-100 text-slate-600'
                      : 'bg-black/25 text-white/95'
                  } ${isExpandedLayout ? 'max-w-[90%]' : ''}`}
                >
                  <span className="truncate">{asset?.ipAddress || ''}</span>
                  {asset?.vlan && (
                    <span
                      className={`text-[7.5px] shrink-0 ${
                        isNeutralCatalogCard ? 'text-blue-600 dark:text-blue-400' : 'text-sky-200'
                      }`}
                    >
                      V{asset.vlan.split(',')[0]}
                    </span>
                  )}
                </div>
              )}
            </div>
          </foreignObject>
        </>
      )}

      {!isReadOnlyMode && (!lowDetailMode || isHovered || isConnecting || isSelected) && ['top', 'bottom', 'left', 'right'].map(pos => {
        let px = node.width / 2;
        let py = 0;
        if (pos === 'bottom') py = node.height;
        if (pos === 'left') { px = 0; py = node.height / 2; }
        if (pos === 'right') { px = node.width; py = node.height / 2; }

        return (
          <circle
            key={pos}
            cx={px}
            cy={py}
            r={isHovered || isConnecting ? 4.5 : 3.2}
            fill="#155eef"
            stroke="#ffffff"
            strokeWidth="1.5"
            className={`transition-all ${
              isHovered || isConnecting
                ? 'opacity-100 hover:scale-125 cursor-crosshair'
                : 'opacity-0 group-hover:opacity-100'
            }`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => onPortClick(e, node.id)}
          />
        );
      })}

      {isSingleSelected && !node.locked && !isConnecting && !isReadOnlyMode && (
        <g className="canvas-resize-handles">
          {RESIZE_HANDLE_DIRS.map(({ dir, cursorClass }) => {
            const pos = getNodeResizeHandlePos(dir);
            return (
              <rect
                key={`nd_h_${dir}`}
                x={pos.x - handleSize / 2}
                y={pos.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={1.5 * invZ}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.5 * invZ}
                className={cursorClass}
                onPointerDown={(e) => {
                  if (node.locked) return;
                  onStartResize(
                    e,
                    node.id,
                    dir,
                    { x: node.x, y: node.y, width: node.width, height: node.height },
                    node.rotation || 0,
                    44,
                    36
                  );
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <title>Kéo để thay đổi kích thước (giữ Shift để giữ tỷ lệ)</title>
              </rect>
            );
          })}
        </g>
      )}
    </g>
  );
}, (prev, next) => (
  prev.node === next.node &&
  prev.asset === next.asset &&
  prev.isSelected === next.isSelected &&
  prev.isSingleSelected === next.isSingleSelected &&
  prev.isHovered === next.isHovered &&
  prev.isOverlapping === next.isOverlapping &&
  prev.isConnecting === next.isConnecting &&
  prev.isConnectingFromThis === next.isConnectingFromThis &&
  prev.isTargetCandidate === next.isTargetCandidate &&
  prev.isDarkCanvas === next.isDarkCanvas &&
  prev.showIpAddresses === next.showIpAddresses &&
  prev.hideLabels === next.hideLabels &&
  prev.isReadOnlyMode === next.isReadOnlyMode &&
  prev.lowDetailMode === next.lowDetailMode &&
  prev.enableShadows === next.enableShadows &&
  (!next.isSelected || prev.zoom === next.zoom)
));

CanvasDeviceNode.displayName = 'CanvasDeviceNode';
