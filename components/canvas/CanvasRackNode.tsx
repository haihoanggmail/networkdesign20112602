import React from 'react';
import {
  DiagramNode,
  ProjectState,
  RackSide,
  SelectionState,
  ServerRack
} from '../../types/infrastructure';
import { CanvasTool } from '../../store/useProjectStore';
import {
  CANVAS_RACK_COLLAPSED_BODY_H,
  CANVAS_RACK_FOOTER_H,
  CANVAS_RACK_HEADER_H,
  CANVAS_RACK_RAIL_W,
  getAssetUHeight,
  getEffectiveRackDisplayHeight,
  getRackCanvasMetrics,
  getRackStatistics,
  getRackSlotsForSide,
  getSlotSpanRect,
  isRackNodeCollapsed
} from '../../utils/rackGeometry';
import { resolveNodePivotCenter } from '../../engineering';
import {
  computeRackThermalOverlayData,
  getSubDeviceThermalReading
} from '../../utils/rackAirflow';
import { HoveredRackSubDeviceInfo } from './RackSubDeviceTooltip';
import {
  DraggingRackDeviceState,
  RESIZE_HANDLE_DIRS,
  RackDropHit,
  ResizeHandleDir,
  StartNodeResizeFn
} from './canvasTypes';

interface CanvasRackNodeProps {
  rackNode: DiagramNode;
  project: ProjectState;
  selection: SelectionState;
  activeTool: CanvasTool;
  zoom: number;
  rackSides: Record<string, RackSide>;
  connectingSource: { nodeId: string; portId?: string } | null;
  draggingRackDevice: DraggingRackDeviceState | null;
  rackDropPreview: RackDropHit | null;
  selectedNodeIdSet: Set<string>;
  isOverlapping: boolean;
  isReadOnlyMode: boolean;
  hoveredSubDeviceAssetId?: string | null;
  showFineSubDetails?: boolean;
  enableShadows?: boolean;
  resolveRackForNode: (rackNode: DiagramNode) => ServerRack | undefined;
  getDeviceColor: (cat?: string) => string;
  clientToCanvasCoord: (clientX: number, clientY: number) => { x: number; y: number };
  onNodePointerDown: (e: React.PointerEvent, node: DiagramNode) => void;
  onNodeClick: (e: React.MouseEvent | React.PointerEvent, node: DiagramNode) => void;
  onSelect: (type: SelectionState['type'], id?: string, additionalIds?: string[]) => void;
  onOpenDeepInspect: (id: string) => void;
  onToggleRackSide: (rackId: string, nextSide: RackSide) => void;
  onStartDraggingRackDevice: (state: DraggingRackDeviceState) => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onToggleRackCollapse?: (rackNode: DiagramNode) => void;
  onToggleRackThermalOverlay?: (rackNode: DiagramNode) => void;
  onHoverSubDevice?: (info: HoveredRackSubDeviceInfo | null) => void;
  onStartResize: StartNodeResizeFn;
  onNodeContextMenu?: (e: React.MouseEvent, node: DiagramNode) => void;
}

export const CanvasRackNode: React.FC<CanvasRackNodeProps> = React.memo(({
  rackNode,
  project,
  selection,
  activeTool,
  zoom,
  rackSides,
  connectingSource,
  draggingRackDevice,
  rackDropPreview,
  selectedNodeIdSet,
  isOverlapping,
  isReadOnlyMode,
  hoveredSubDeviceAssetId,
  showFineSubDetails,
  enableShadows = true,
  resolveRackForNode,
  getDeviceColor,
  clientToCanvasCoord,
  onNodePointerDown,
  onNodeClick,
  onSelect,
  onOpenDeepInspect,
  onToggleRackSide,
  onStartDraggingRackDevice,
  onRemoveDeviceFromRackSlot,
  onToggleRackCollapse,
  onToggleRackThermalOverlay,
  onHoverSubDevice,
  onStartResize,
  onNodeContextMenu
}) => {
  const asset = rackNode.assetId ? project.assets[rackNode.assetId] : undefined;
  const rack = resolveRackForNode(rackNode);
  const targetRackId = rack?.id || rackNode.customData?.rackId || asset?.id || rackNode.id;
  const rackDisplayName = rack?.name || rackNode.label;
  const totalUnits = rack?.totalUnits || rackNode.customData?.totalUnits || 42;
  const isCollapsed = isRackNodeCollapsed(rackNode);
  const showThermalOverlay = rackNode.customData?.showThermalOverlay !== false;
  const displayHeight = getEffectiveRackDisplayHeight(rackNode);
  const metrics = getRackCanvasMetrics(rackNode, totalUnits);
  const activeSide: RackSide = rack ? (rackSides[rack.id] || 'front') : 'front';
  const isSelected =
    (selection.type === 'rack' && selection.id === targetRackId) ||
    (selection.type === 'node' && selection.id === rackNode.id);

  const slotMap = rack ? getRackSlotsForSide(rack, activeSide) : {};
  const mountedEntries = Object.entries(slotMap)
    .map(([uStr, devId]) => ({
      startU: parseInt(uStr, 10),
      devId,
      dev: project.assets[devId],
      uHeight: getAssetUHeight(project.assets[devId])
    }))
    .filter(e => !Number.isNaN(e.startU) && Boolean(e.dev));

  const thermalData = React.useMemo(
    () => computeRackThermalOverlayData(rack, project.assets, rackNode),
    [rack, project.assets, rackNode]
  );

  const stats = rack ? getRackStatistics(rack, project.assets) : null;
  const hasRackWarning = Boolean(stats && (stats.overflowItems.length > 0 || stats.isOverweight));
  const usedUnitsDisplay = activeSide === 'rear' ? (stats?.rearUsedUnits || 0) : (stats?.frontUsedUnits || 0);
  const freeUnitsDisplay = Math.max(0, totalUnits - usedUnitsDisplay);

  const showEverySlotLabel = metrics.slotH >= 11;
  const labelStep = showEverySlotLabel ? 1 : metrics.slotH >= 7 ? 2 : 5;
  const activePreview = !isCollapsed && rackDropPreview && rackDropPreview.rackId === targetRackId ? rackDropPreview : null;
  const showFineSubDeviceDetails = showFineSubDetails ?? zoom >= 0.45;
  const collapseBtnX = rack ? rackNode.width - 126 : rackNode.width - 78;
  const thermalBtnX = onToggleRackCollapse ? collapseBtnX - 30 : collapseBtnX;
  const titleEdgeX = onToggleRackThermalOverlay ? thermalBtnX : onToggleRackCollapse ? collapseBtnX : rackNode.width - 106;
  const maxTitleChars = Math.max(6, Math.floor((titleEdgeX - 16) / 6.1));

  const thermalGradId = `rack-thermal-grad-${rackNode.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const thermalIsoDx = 24;
  const thermalIsoDy = -12;

  const rackRot = rackNode.rotation || 0;
  const pivot = resolveNodePivotCenter(rackNode);
  const rackCx = pivot.canonicalCenter.x;
  const rackCy = isCollapsed ? pivot.display2DCenter.y : pivot.canonicalCenter.y;

  return (
    <g
      transform={rackRot ? `rotate(${rackRot}, ${rackCx}, ${rackCy})` : undefined}
      onPointerDown={(e) => onNodePointerDown(e, rackNode)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect('rack', targetRackId);
      }}
      onContextMenu={(e) => onNodeContextMenu?.(e, rackNode)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenDeepInspect(targetRackId);
      }}
      data-collapsed={isCollapsed ? 'true' : 'false'}
      data-thermal-overlay={showThermalOverlay ? 'true' : 'false'}
      className={`rack-node-container select-none${isCollapsed ? ' rack-node-collapsed' : ''}`}
    >
      {/* Overlap Red Warning Halo */}
      {isOverlapping && (
        <g className="pointer-events-none">
          <rect
            x={rackNode.x - 5}
            y={rackNode.y - 5}
            width={rackNode.width + 10}
            height={displayHeight + 10}
            rx="8"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeDasharray="6 3"
          />
          <rect x={rackNode.x} y={rackNode.y - 18} width="82" height="15" rx="3" fill="#dc2626" />
          <text
            x={rackNode.x + 41}
            y={rackNode.y - 7.5}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.5"
            fontWeight="700"
          >
            ! Trùng vị trí
          </text>
        </g>
      )}

      {/* Rack Selection Halo & Subtle Pulse */}
      <g
        aria-hidden="true"
        className={`pointer-events-none canvas-selection-halo${isSelected ? ' is-selected' : ''}`}
      >
        <rect
          x={rackNode.x - 6}
          y={rackNode.y - 6}
          width={rackNode.width + 12}
          height={displayHeight + 12}
          rx="10"
          fill="#3b82f6"
          fillOpacity={0.07}
          stroke="#60a5fa"
          strokeWidth="1.5"
          className="canvas-selection-pulse-ring-lg"
        />
        <rect
          x={rackNode.x - 3}
          y={rackNode.y - 3}
          width={rackNode.width + 6}
          height={displayHeight + 6}
          rx="8"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="1.5"
          strokeDasharray={rackNode.locked || isReadOnlyMode ? undefined : '5 3'}
        />
      </g>

      {/* Rack Steel Enclosure Frame */}
      <rect
        x={rackNode.x}
        y={rackNode.y}
        width={rackNode.width}
        height={displayHeight}
        fill="#0b1120"
        stroke={hasRackWarning || isOverlapping ? '#ef4444' : isSelected ? '#3b82f6' : activePreview ? '#60a5fa' : '#334155'}
        strokeWidth={isSelected || hasRackWarning || isOverlapping ? 3.5 : 2}
        rx="6"
        className="canvas-node-surface"
        filter={
          enableShadows
            ? isOverlapping
              ? 'drop-shadow(0 0 10px rgba(239,68,68,0.55))'
              : isSelected
              ? 'drop-shadow(0 0 10px rgba(59,130,246,0.45))'
              : 'drop-shadow(0 4px 10px rgba(0,0,0,0.2))'
            : undefined
        }
      />

      {/* Rack Header Bar */}
      <rect
        x={rackNode.x + 1}
        y={rackNode.y + 1}
        width={rackNode.width - 2}
        height={CANVAS_RACK_HEADER_H}
        fill="#1e293b"
        rx="5"
        className={isReadOnlyMode ? 'cursor-pointer' : 'cursor-move'}
      />
      <text
        x={rackNode.x + 10}
        y={rackNode.y + 21}
        fill="#f8fafc"
        fontSize="10.5"
        fontWeight="bold"
        className="pointer-events-none"
      >
        {rackDisplayName.slice(0, maxTitleChars)}
      </text>

      {/* 3D Thermal Heatmap Overlay Toggle */}
      {onToggleRackThermalOverlay && (
        <g
          data-testid={`rack-thermal-3d-toggle-${rackNode.id}`}
          role="button"
          aria-pressed={showThermalOverlay}
          aria-label={showThermalOverlay ? 'Ẩn bản đồ nhiệt 3D' : 'Hiện bản đồ nhiệt 3D'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleRackThermalOverlay(rackNode);
          }}
          className="cursor-pointer"
        >
          <title>
            {showThermalOverlay
              ? 'Ẩn lớp phủ bản đồ nhiệt 3D & cảm biến tủ Rack'
              : 'Hiện lớp phủ bản đồ nhiệt 3D & nhiệt độ cảm biến tủ Rack'}
          </title>
          <rect
            x={rackNode.x + thermalBtnX}
            y={rackNode.y + 8}
            width={26}
            height={18}
            rx="4"
            fill={
              showThermalOverlay
                ? thermalData.peakTempC >= 37
                  ? '#dc2626'
                  : thermalData.peakTempC >= 30.5
                  ? '#d97706'
                  : '#0284c7'
                : '#334155'
            }
          />
          <text
            x={rackNode.x + thermalBtnX + 13}
            y={rackNode.y + 20}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.5"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {Math.round(thermalData.peakTempC)}°
          </text>
        </g>
      )}

      {/* Collapse / Expand Rack Detail (LOD) Toggle */}
      {onToggleRackCollapse && (
        <g
          data-testid={`rack-collapse-btn-${rackNode.id}`}
          role="button"
          aria-label={isCollapsed ? 'Mở rộng tủ Rack' : 'Thu gọn tủ Rack'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleRackCollapse(rackNode);
          }}
          className="cursor-pointer"
        >
          <title>
            {isCollapsed
              ? 'Mở rộng tủ Rack (hiển thị chi tiết các khe U & thiết bị)'
              : 'Thu gọn tủ Rack (giảm chi tiết thiết bị để tối ưu hiệu năng)'}
          </title>
          <rect
            x={rackNode.x + collapseBtnX}
            y={rackNode.y + 8}
            width={20}
            height={18}
            rx="4"
            fill={isCollapsed ? '#0284c7' : '#334155'}
          />
          <text
            x={rackNode.x + collapseBtnX + 10}
            y={rackNode.y + 20.5}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="11"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {isCollapsed ? '+' : '−'}
          </text>
        </g>
      )}

      {/* Front / Rear Side Toggle Button on Rack Header */}
      {rack && (
        <g
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleRackSide(rack.id, activeSide === 'front' ? 'rear' : 'front');
          }}
          className="cursor-pointer"
        >
          <rect
            x={rackNode.x + rackNode.width - 102}
            y={rackNode.y + 8}
            width={44}
            height={18}
            rx="4"
            fill={activeSide === 'rear' ? '#7c3aed' : '#0f766e'}
          />
          <text
            x={rackNode.x + rackNode.width - 80}
            y={rackNode.y + 20}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.5"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {activeSide === 'rear' ? 'SAU' : 'TRƯỚC'}
          </text>
        </g>
      )}

      {/* Open 19" Elevation Modal Button */}
      <g
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpenDeepInspect(targetRackId);
        }}
        className="cursor-pointer"
      >
        <rect
          x={rackNode.x + rackNode.width - 54}
          y={rackNode.y + 8}
          width={46}
          height={18}
          rx="4"
          fill="#2563eb"
        />
        <text
          x={rackNode.x + rackNode.width - 31}
          y={rackNode.y + 20}
          textAnchor="middle"
          fill="#ffffff"
          fontSize="9"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {totalUnits}U ↗
        </text>
      </g>

      {isCollapsed ? (
        /* Collapsed Rack Proxy Body — Omits individual U-slot ticks & sub-device plates for high performance */
        <g data-testid="rack-collapsed-summary" className="pointer-events-none">
          <rect
            x={rackNode.x + 8}
            y={rackNode.y + CANVAS_RACK_HEADER_H + 5}
            width={rackNode.width - 16}
            height={CANVAS_RACK_COLLAPSED_BODY_H - 10}
            rx="4"
            fill="#0f172a"
            stroke="#1e293b"
            strokeWidth="1"
          />
          <rect
            x={rackNode.x + 14}
            y={rackNode.y + CANVAS_RACK_HEADER_H + 11}
            width={Math.max(24, rackNode.width - 28)}
            height={6}
            rx="3"
            fill="#1e293b"
          />
          <rect
            x={rackNode.x + 14}
            y={rackNode.y + CANVAS_RACK_HEADER_H + 11}
            width={Math.round(
              Math.max(24, rackNode.width - 28) *
                Math.min(1, usedUnitsDisplay / Math.max(1, totalUnits))
            )}
            height={6}
            rx="3"
            fill={hasRackWarning ? '#ef4444' : '#0ea5e9'}
          />
          <text
            x={rackNode.x + 14}
            y={rackNode.y + CANVAS_RACK_HEADER_H + 27}
            fill="#cbd5e1"
            fontSize="8.5"
            fontFamily="monospace"
          >
            {mountedEntries.length} thiết bị ({activeSide === 'rear' ? 'Sau' : 'Trước'}) · Chi tiết thu gọn
          </text>
        </g>
      ) : (
        <>
          {/* Left 19" U-Rail Background */}
          <rect
            x={rackNode.x + 4}
            y={metrics.slotsY}
            width={CANVAS_RACK_RAIL_W - 6}
            height={metrics.availableSlotsHeight}
            fill="#0f172a"
            rx="2"
          />

          {/* Inner Bay Background */}
          <rect
            x={metrics.slotsX}
            y={metrics.slotsY}
            width={metrics.slotsWidth}
            height={metrics.availableSlotsHeight}
            fill={activeSide === 'rear' ? '#090d1f' : '#020617'}
            stroke="#1e293b"
            strokeWidth="1"
          />

          {/* Individual U-Slot Grid Lines & U Labels (omitted in Field Mode / zoomed-out LOD for speed) */}
          {(showFineSubDeviceDetails || isSelected || Boolean(activePreview)) &&
            Array.from({ length: totalUnits }, (_, idx) => {
              const uNum = totalUnits - idx;
              const rowY = metrics.slotsY + idx * metrics.slotH;
              const shouldLabel = uNum === totalUnits || uNum === 1 || uNum % labelStep === 0;

              return (
                <g key={`u_${uNum}`} className="pointer-events-none">
                  <line
                    x1={metrics.slotsX}
                    y1={rowY + metrics.slotH}
                    x2={metrics.slotsX + metrics.slotsWidth}
                    y2={rowY + metrics.slotH}
                    stroke="#1e293b"
                    strokeWidth="0.6"
                  />
                  {shouldLabel && metrics.slotH >= 6 && (
                    <text
                      x={rackNode.x + CANVAS_RACK_RAIL_W - 6}
                      y={rowY + metrics.slotH * 0.72}
                      textAnchor="end"
                      fill="#64748b"
                      fontSize={metrics.slotH >= 12 ? '8' : '6.5'}
                      fontFamily="monospace"
                      fontWeight="600"
                    >
                      U{uNum < 10 ? `0${uNum}` : uNum}
                    </text>
                  )}
                </g>
              );
            })}

          {/* Mounted Device Plates */}
          {mountedEntries.map(({ startU, devId, dev, uHeight }) => {
            if (!dev) return null;
            const isBeingDragged = draggingRackDevice?.assetId === dev.id && draggingRackDevice.hasMoved;
            const isOverflow = startU < 1 || startU + uHeight - 1 > totalUnits;
            const clampedVisStart = Math.max(1, Math.min(totalUnits, startU));
            const spanRect = getSlotSpanRect(clampedVisStart, uHeight, totalUnits, metrics.slotH);
            const plateX = metrics.slotsX + 2;
            const plateY = metrics.slotsY + spanRect.top + 0.8;
            const plateW = Math.max(20, metrics.slotsWidth - 4);
            const plateH = Math.max(4, spanRect.height - 1.6);
            const color = isOverflow ? '#ef4444' : getDeviceColor(dev.category);
            const linkedNode = project.nodes.find(n => n.assetId === dev.id);
            const isPlateSelected = linkedNode && selectedNodeIdSet.has(linkedNode.id);
            const isSubDeviceHovered = hoveredSubDeviceAssetId === dev.id;
            const subThermal = getSubDeviceThermalReading(thermalData, clampedVisStart, uHeight);
            const heatBtuPerHour =
              dev.heatBtu && dev.heatBtu > 0
                ? Math.round(dev.heatBtu)
                : Math.round(Math.max(0, dev.powerWatts || 0) * 3.412);

            const emitHoverInfo = (clientX: number, clientY: number) => {
              if (!onHoverSubDevice || draggingRackDevice?.hasMoved) return;
              onHoverSubDevice({
                rackId: targetRackId,
                rackNodeId: rackNode.id,
                rackName: rackDisplayName,
                asset: dev,
                startU,
                uHeight,
                side: activeSide,
                tempC: subThermal.tempC,
                zone: subThermal.zone,
                heatBtuPerHour,
                clientX,
                clientY
              });
            };

            return (
              <g
                key={`plate_${devId}`}
                data-testid={`rack-subdevice-${dev.id}`}
                data-asset-id={dev.id}
                opacity={isBeingDragged ? 0.35 : 1}
                onMouseEnter={(e) => emitHoverInfo(e.clientX, e.clientY)}
                onPointerEnter={(e) => emitHoverInfo(e.clientX, e.clientY)}
                onMouseMove={(e) => emitHoverInfo(e.clientX, e.clientY)}
                onMouseLeave={() => onHoverSubDevice?.(null)}
                onPointerLeave={() => onHoverSubDevice?.(null)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
                  if (!isPrimary) return;
                  if (!isReadOnlyMode && (activeTool === 'connect' || connectingSource)) {
                    if (linkedNode) {
                      onNodeClick(e, linkedNode);
                    }
                    return;
                  }
                  if (isReadOnlyMode) {
                    if (linkedNode) {
                      onSelect('node', linkedNode.id);
                    } else {
                      onSelect('rack', targetRackId);
                    }
                    return;
                  }
                  onHoverSubDevice?.(null);
                  const coord = clientToCanvasCoord(e.clientX, e.clientY);
                  onStartDraggingRackDevice({
                    sourceRackId: targetRackId,
                    sourceSide: activeSide,
                    assetId: dev.id,
                    uHeight,
                    label: dev.name,
                    color,
                    startX: coord.x,
                    startY: coord.y,
                    currentX: coord.x,
                    currentY: coord.y,
                    hasMoved: false
                  });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onOpenDeepInspect(dev.id);
                }}
                className={`rack-subdevice-item ${isReadOnlyMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} group`}
              >
                <rect
                  x={plateX}
                  y={plateY}
                  width={plateW}
                  height={plateH}
                  rx="2"
                  fill={isOverflow ? '#450a0a' : showThermalOverlay && subThermal.zone === 'hot' ? '#3b0a14' : '#1e293b'}
                  stroke={
                    isSubDeviceHovered
                      ? '#38bdf8'
                      : isPlateSelected
                      ? '#ffffff'
                      : showThermalOverlay && subThermal.zone === 'hot'
                      ? '#ef4444'
                      : showThermalOverlay && subThermal.zone === 'warm'
                      ? '#f59e0b'
                      : color
                  }
                  strokeWidth={
                    isSubDeviceHovered
                      ? 2
                      : isPlateSelected || (showThermalOverlay && subThermal.zone === 'hot')
                      ? 1.8
                      : 1.1
                  }
                  className="canvas-node-surface"
                />
                {linkedNode && (
                  <rect
                    x={plateX - 1.5}
                    y={plateY - 1.5}
                    width={plateW + 3}
                    height={plateH + 3}
                    rx="3"
                    fill="#3b82f6"
                    fillOpacity={0.12}
                    stroke="#60a5fa"
                    strokeWidth="1.2"
                    className={`pointer-events-none canvas-subdevice-pulse-ring${isPlateSelected ? ' is-selected' : ''}`}
                  />
                )}
                <rect x={plateX} y={plateY} width={4} height={plateH} rx="1" fill={showThermalOverlay ? subThermal.color : color} />
                {showFineSubDeviceDetails && plateH >= 8 && (
                  <circle
                    cx={plateX + 10}
                    cy={plateY + plateH / 2}
                    r={Math.min(2.5, plateH / 4)}
                    fill={isOverflow ? '#ef4444' : dev.status === 'online' ? '#22c55e' : '#f59e0b'}
                  />
                )}
                {plateH >= 8 && (
                  <text
                    x={plateX + (showFineSubDeviceDetails ? 16 : 8)}
                    y={plateY + plateH / 2 + 3}
                    fill="#f8fafc"
                    fontSize={Math.min(9.5, Math.max(6.5, plateH * 0.55))}
                    fontWeight="600"
                    className="pointer-events-none"
                  >
                    {dev.name.slice(0, showThermalOverlay && (subThermal.zone === 'hot' || subThermal.zone === 'warm') ? 15 : 19)}{isOverflow ? ' ⚠' : ''}
                  </text>
                )}
                {showThermalOverlay && showFineSubDeviceDetails && plateH >= 10 && plateW >= 150 && (subThermal.zone === 'hot' || subThermal.zone === 'warm') && (
                  <text
                    x={plateX + plateW - 50}
                    y={plateY + plateH / 2 + 2.5}
                    textAnchor="end"
                    fill={subThermal.zone === 'hot' ? '#fca5a5' : '#fde68a'}
                    fontSize="7.5"
                    fontWeight="700"
                    fontFamily="monospace"
                    className="pointer-events-none"
                  >
                    {subThermal.tempC.toFixed(0)}°C
                  </text>
                )}
                {showFineSubDeviceDetails && plateH >= 10 && plateW >= 150 && (
                  <text
                    x={plateX + plateW - 22}
                    y={plateY + plateH / 2 + 2.5}
                    textAnchor="end"
                    fill="#94a3b8"
                    fontSize="7.5"
                    fontFamily="monospace"
                    className="pointer-events-none"
                  >
                    {uHeight > 1 ? `U${startU}-${startU + uHeight - 1}` : `U${startU}`}
                  </text>
                )}
                {showFineSubDeviceDetails && !isReadOnlyMode && plateH >= 10 && onRemoveDeviceFromRackSlot && (
                  <g
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveDeviceFromRackSlot(targetRackId, startU, activeSide);
                    }}
                    className="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <rect x={plateX + plateW - 15} y={plateY + plateH / 2 - 5} width={12} height={10} rx="2" fill="#ef4444" />
                    <text x={plateX + plateW - 9} y={plateY + plateH / 2 + 2.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="bold">
                      ×
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Accurate Drop-Zone Preview Overlay */}
          {activePreview && (() => {
            const spanRect = getSlotSpanRect(activePreview.startU, activePreview.uHeight, totalUnits, metrics.slotH);
            const py = metrics.slotsY + spanRect.top + 0.5;
            const ph = Math.max(8, spanRect.height - 1);
            return (
              <g className="pointer-events-none">
                <rect
                  x={metrics.slotsX + 1}
                  y={py}
                  width={metrics.slotsWidth - 2}
                  height={ph}
                  rx="2"
                  fill={activePreview.valid ? '#22c55e' : '#ef4444'}
                  fillOpacity="0.28"
                  stroke={activePreview.valid ? '#4ade80' : '#f87171'}
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />
                <rect
                  x={metrics.slotsX + metrics.slotsWidth / 2 - 36}
                  y={py + ph / 2 - 7}
                  width={72}
                  height={14}
                  rx="3"
                  fill={activePreview.valid ? '#15803d' : '#b91c1c'}
                />
                <text
                  x={metrics.slotsX + metrics.slotsWidth / 2}
                  y={py + ph / 2 + 3}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="8"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {activePreview.valid
                    ? `${activePreview.uHeight > 1 ? `U${activePreview.startU}-${activePreview.startU + activePreview.uHeight - 1}` : `U${activePreview.startU}`} OK`
                    : 'ĐÃ CHIẾM'}
                </text>
              </g>
            );
          })()}
        </>
      )}

      {/* Rack Footer Power / U Usage Status */}
      <rect
        x={rackNode.x + 1}
        y={rackNode.y + displayHeight - CANVAS_RACK_FOOTER_H - 1}
        width={rackNode.width - 2}
        height={CANVAS_RACK_FOOTER_H}
        fill={hasRackWarning ? '#450a0a' : '#111827'}
        rx="4"
        className="pointer-events-none"
      />
      <text
        x={rackNode.x + 10}
        y={rackNode.y + displayHeight - 8}
        fill={hasRackWarning ? '#fca5a5' : '#94a3b8'}
        fontSize="8"
        fontFamily="monospace"
        className="pointer-events-none"
      >
        {usedUnitsDisplay}U dùng · {freeUnitsDisplay}U trống
      </text>
      <text
        x={rackNode.x + rackNode.width - 10}
        y={rackNode.y + displayHeight - 8}
        textAnchor="end"
        fill={stats?.isOverweight ? '#f87171' : '#34d399'}
        fontSize="8.5"
        fontWeight="bold"
        fontFamily="monospace"
        className="pointer-events-none"
      >
        {stats?.totalPowerWatts || 0}W · {(stats?.totalWeightKg || 0).toFixed(0)}kg
      </text>

      {/* 8 Interactive Resize Handles for Selected Unlocked Rack */}
      {!isCollapsed && isSelected && !rackNode.locked && !isReadOnlyMode && (() => {
        const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
        const hSize = 8 * invZ;
        const getRackHandlePos = (dir: ResizeHandleDir) => {
          const cx = rackNode.x + rackNode.width / 2;
          const cy = rackNode.y + rackNode.height / 2;
          switch (dir) {
            case 'nw': return { x: rackNode.x, y: rackNode.y };
            case 'n': return { x: cx, y: rackNode.y };
            case 'ne': return { x: rackNode.x + rackNode.width, y: rackNode.y };
            case 'e': return { x: rackNode.x + rackNode.width, y: cy };
            case 'se': return { x: rackNode.x + rackNode.width, y: rackNode.y + rackNode.height };
            case 's': return { x: cx, y: rackNode.y + rackNode.height };
            case 'sw': return { x: rackNode.x, y: rackNode.y + rackNode.height };
            case 'w': return { x: rackNode.x, y: cy };
          }
        };
        return (
          <g className="canvas-resize-handles">
            {RESIZE_HANDLE_DIRS.map(({ dir, cursorClass }) => {
              const pos = getRackHandlePos(dir);
              return (
                <rect
                  key={`rk_h_${dir}`}
                  x={pos.x - hSize / 2}
                  y={pos.y - hSize / 2}
                  width={hSize}
                  height={hSize}
                  rx={1.5 * invZ}
                  fill="#ffffff"
                  stroke="#3b82f6"
                  strokeWidth={1.5 * invZ}
                  className={cursorClass}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onStartResize(
                      e,
                      rackNode.id,
                      dir,
                      { x: rackNode.x, y: rackNode.y, width: rackNode.width, height: rackNode.height },
                      rackRot,
                      210,
                      120
                    );
                  }}
                />
              );
            })}
          </g>
        );
      })()}

      {/* 3D Isometric Thermal Heatmap & Sensor Telemetry Overlay for .rack-node-container */}
      {showThermalOverlay && (
        <g
          data-testid="rack-3d-thermal-overlay"
          className="rack-thermal-3d-overlay pointer-events-none"
        >
          <defs>
            <linearGradient id={thermalGradId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={thermalData.unitReadings[thermalData.unitReadings.length - 1]?.color || '#f59e0b'}
                stopOpacity="0.85"
              />
              <stop
                offset="50%"
                stopColor={
                  thermalData.unitReadings[Math.floor(thermalData.unitReadings.length / 2)]?.color || '#10b981'
                }
                stopOpacity="0.72"
              />
              <stop
                offset="100%"
                stopColor={thermalData.unitReadings[0]?.color || '#0ea5e9'}
                stopOpacity="0.8"
              />
            </linearGradient>
          </defs>

          {isCollapsed ? (
            /* Compact 3D Thermal Side Prism when Rack is Collapsed */
            <g data-testid="rack-collapsed-thermal-badge">
              <polygon
                points={`${rackNode.x + rackNode.width},${rackNode.y + 4} ${rackNode.x + rackNode.width + 16},${rackNode.y - 4} ${rackNode.x + rackNode.width + 16},${rackNode.y + displayHeight - 10} ${rackNode.x + rackNode.width},${rackNode.y + displayHeight - 2}`}
                fill={`url(#${thermalGradId})`}
                stroke="#0f172a"
                strokeWidth="1"
              />
              <rect
                x={rackNode.x + rackNode.width + 20}
                y={rackNode.y + displayHeight / 2 - 11}
                width={82}
                height={22}
                rx="5"
                fill="#0f172a"
                fillOpacity="0.94"
                stroke={thermalData.peakTempC >= 37 ? '#ef4444' : thermalData.peakTempC >= 30.5 ? '#f59e0b' : '#0ea5e9'}
                strokeWidth="1.2"
              />
              <text
                x={rackNode.x + rackNode.width + 61}
                y={rackNode.y + displayHeight / 2 + 3}
                textAnchor="middle"
                fill="#f8fafc"
                fontSize="8.5"
                fontWeight="700"
                fontFamily="monospace"
              >
                {thermalData.peakTempC.toFixed(1)}°C · {thermalData.exhaustTempC.toFixed(0)}°
              </text>
            </g>
          ) : (
            /* Full 3D Isometric Depth Thermal Curtain + Per-U Strata + Sensor Readouts */
            <>
              {/* Subtle translucent thermal wash over inner bay */}
              <rect
                x={metrics.slotsX}
                y={metrics.slotsY}
                width={metrics.slotsWidth}
                height={metrics.availableSlotsHeight}
                fill={`url(#${thermalGradId})`}
                fillOpacity="0.14"
              />

              {/* 3D Isometric Top Cap bevel on thermal column */}
              <polygon
                points={`${rackNode.x + rackNode.width},${metrics.slotsY} ${rackNode.x + rackNode.width + thermalIsoDx},${metrics.slotsY + thermalIsoDy} ${rackNode.x + rackNode.width + thermalIsoDx - 14},${metrics.slotsY + thermalIsoDy} ${rackNode.x + rackNode.width - 14},${metrics.slotsY}`}
                fill={thermalData.unitReadings[thermalData.unitReadings.length - 1]?.color || '#f59e0b'}
                fillOpacity="0.45"
                stroke="#0f172a"
                strokeOpacity="0.5"
                strokeWidth="0.8"
              />

              {/* Per-U 3D Isometric Extruded Heat Map Strata along right depth face */}
              {thermalData.unitReadings.map((reading) => {
                const idxFromTop = totalUnits - reading.u;
                const yTop = metrics.slotsY + idxFromTop * metrics.slotH;
                const yBot = yTop + metrics.slotH;
                const xFront = rackNode.x + rackNode.width;
                const xBack = xFront + thermalIsoDx;
                return (
                  <polygon
                    key={`heat3d_u_${reading.u}`}
                    points={`${xFront},${yTop} ${xBack},${yTop + thermalIsoDy} ${xBack},${yBot + thermalIsoDy} ${xFront},${yBot}`}
                    fill={reading.color}
                    fillOpacity="0.82"
                    stroke="#020617"
                    strokeOpacity="0.22"
                    strokeWidth="0.4"
                  />
                );
              })}

              {/* 3D Depth Border Frame */}
              <polygon
                points={`${rackNode.x + rackNode.width},${metrics.slotsY} ${rackNode.x + rackNode.width + thermalIsoDx},${metrics.slotsY + thermalIsoDy} ${rackNode.x + rackNode.width + thermalIsoDx},${metrics.slotsY + metrics.availableSlotsHeight + thermalIsoDy} ${rackNode.x + rackNode.width},${metrics.slotsY + metrics.availableSlotsHeight}`}
                fill="none"
                stroke="#334155"
                strokeWidth="1"
              />

              {/* Summary Header Tag on 3D Thermal Overlay */}
              <g>
                <rect
                  x={rackNode.x + rackNode.width + thermalIsoDx - 12}
                  y={metrics.slotsY + thermalIsoDy - 22}
                  width={98}
                  height={17}
                  rx="4"
                  fill="#0f172a"
                  fillOpacity="0.94"
                  stroke={thermalData.hasHardwareSensors ? '#14b8a6' : '#38bdf8'}
                  strokeWidth="1"
                />
                <text
                  x={rackNode.x + rackNode.width + thermalIsoDx + 37}
                  y={metrics.slotsY + thermalIsoDy - 10.5}
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="8"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {thermalData.hasHardwareSensors ? 'SENSOR' : 'NHIỆT 3D'} · {thermalData.peakTempC.toFixed(1)}°C
                </text>
              </g>

              {/* Individual Rack Sensor Temperature Probes & Readouts */}
              {thermalData.sensors.map((sensor) => {
                const idxFromTop = totalUnits - sensor.u;
                const sy =
                  metrics.slotsY +
                  (idxFromTop + 0.5) * metrics.slotH +
                  thermalIsoDy * 0.65;
                const sx = rackNode.x + rackNode.width + thermalIsoDx * 0.65;
                const badgeX = rackNode.x + rackNode.width + thermalIsoDx + 8;
                const badgeColor =
                  sensor.status === 'hot'
                    ? '#ef4444'
                    : sensor.status === 'warm'
                    ? '#f59e0b'
                    : sensor.status === 'nominal'
                    ? '#10b981'
                    : '#0ea5e9';
                const shortZone =
                  sensor.source === 'hardware_sensor'
                    ? sensor.label.slice(0, 7)
                    : `U${sensor.u}`;
                return (
                  <g
                    key={`sensor_badge_${sensor.id}`}
                    data-testid={`rack-sensor-readout-${sensor.id}`}
                    className="rack-sensor-readout"
                  >
                    <line
                      x1={sx}
                      y1={sy}
                      x2={badgeX}
                      y2={sy}
                      stroke={badgeColor}
                      strokeWidth="1.2"
                      strokeDasharray={sensor.source === 'calculated_probe' ? '2 1.5' : undefined}
                    />
                    <circle
                      cx={sx}
                      cy={sy}
                      r="3.2"
                      fill={badgeColor}
                      stroke="#ffffff"
                      strokeWidth="1"
                    />
                    <rect
                      x={badgeX}
                      y={sy - 9}
                      width={74}
                      height={18}
                      rx="4"
                      fill="#0f172a"
                      fillOpacity="0.94"
                      stroke={badgeColor}
                      strokeWidth="1.1"
                    />
                    <text
                      x={badgeX + 37}
                      y={sy + 3}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="8"
                      fontWeight="700"
                      fontFamily="monospace"
                    >
                      {shortZone} {sensor.temperatureC.toFixed(1)}°C
                    </text>
                  </g>
                );
              })}
            </>
          )}
        </g>
      )}
    </g>
  );
}, (prev, next) => {
  if (
    prev.rackNode !== next.rackNode ||
    prev.activeTool !== next.activeTool ||
    prev.zoom !== next.zoom ||
    prev.isOverlapping !== next.isOverlapping ||
    prev.isReadOnlyMode !== next.isReadOnlyMode ||
    prev.showFineSubDetails !== next.showFineSubDetails ||
    prev.enableShadows !== next.enableShadows ||
    (prev.connectingSource?.nodeId ?? null) !== (next.connectingSource?.nodeId ?? null) ||
    (prev.connectingSource?.portId ?? null) !== (next.connectingSource?.portId ?? null) ||
    prev.onNodePointerDown !== next.onNodePointerDown ||
    prev.onNodeClick !== next.onNodeClick ||
    prev.onSelect !== next.onSelect ||
    prev.onOpenDeepInspect !== next.onOpenDeepInspect ||
    prev.onToggleRackSide !== next.onToggleRackSide ||
    prev.onStartDraggingRackDevice !== next.onStartDraggingRackDevice ||
    prev.onRemoveDeviceFromRackSlot !== next.onRemoveDeviceFromRackSlot ||
    prev.onToggleRackCollapse !== next.onToggleRackCollapse ||
    prev.onToggleRackThermalOverlay !== next.onToggleRackThermalOverlay ||
    prev.onHoverSubDevice !== next.onHoverSubDevice ||
    prev.onStartResize !== next.onStartResize ||
    prev.getDeviceColor !== next.getDeviceColor ||
    prev.clientToCanvasCoord !== next.clientToCanvasCoord
  ) {
    return false;
  }

  const prevRack = prev.resolveRackForNode(prev.rackNode);
  const nextRack = next.resolveRackForNode(next.rackNode);
  if (prevRack !== nextRack) return false;

  const prevRackAsset = prev.rackNode.assetId ? prev.project.assets[prev.rackNode.assetId] : undefined;
  const nextRackAsset = next.rackNode.assetId ? next.project.assets[next.rackNode.assetId] : undefined;
  if (prevRackAsset !== nextRackAsset) return false;

  const targetRackId =
    nextRack?.id || next.rackNode.customData?.rackId || nextRackAsset?.id || next.rackNode.id;

  const prevSide: RackSide = prevRack ? (prev.rackSides[prevRack.id] || 'front') : 'front';
  const nextSide: RackSide = nextRack ? (next.rackSides[nextRack.id] || 'front') : 'front';
  if (prevSide !== nextSide) return false;

  const wasRackSelected =
    (prev.selection.type === 'rack' && prev.selection.id === targetRackId) ||
    (prev.selection.type === 'node' && prev.selection.id === prev.rackNode.id);
  const isRackSelected =
    (next.selection.type === 'rack' && next.selection.id === targetRackId) ||
    (next.selection.type === 'node' && next.selection.id === next.rackNode.id);
  if (wasRackSelected !== isRackSelected) return false;

  const prevPreview = prev.rackDropPreview?.rackId === targetRackId ? prev.rackDropPreview : null;
  const nextPreview = next.rackDropPreview?.rackId === targetRackId ? next.rackDropPreview : null;
  if (
    (prevPreview === null) !== (nextPreview === null) ||
    (prevPreview &&
      nextPreview &&
      (prevPreview.startU !== nextPreview.startU ||
        prevPreview.uHeight !== nextPreview.uHeight ||
        prevPreview.valid !== nextPreview.valid ||
        prevPreview.side !== nextPreview.side))
  ) {
    return false;
  }

  if (nextRack) {
    const slotDevIds = new Set<string>([
      ...Object.values(nextRack.slots || {}),
      ...Object.values(nextRack.rearSlots || {})
    ]);
    for (const devId of slotDevIds) {
      if (prev.project.assets[devId] !== next.project.assets[devId]) return false;

      const prevDragging =
        prev.draggingRackDevice?.assetId === devId && Boolean(prev.draggingRackDevice.hasMoved);
      const nextDragging =
        next.draggingRackDevice?.assetId === devId && Boolean(next.draggingRackDevice.hasMoved);
      if (prevDragging !== nextDragging) return false;

      const prevHovered = prev.hoveredSubDeviceAssetId === devId;
      const nextHovered = next.hoveredSubDeviceAssetId === devId;
      if (prevHovered !== nextHovered) return false;

      if (prev.project.nodes !== next.project.nodes || prev.selectedNodeIdSet !== next.selectedNodeIdSet) {
        const prevLinked = prev.project.nodes.find(n => n.assetId === devId);
        const nextLinked = next.project.nodes.find(n => n.assetId === devId);
        if ((prevLinked?.id ?? null) !== (nextLinked?.id ?? null)) return false;
        const prevPlateSel = Boolean(prevLinked && prev.selectedNodeIdSet.has(prevLinked.id));
        const nextPlateSel = Boolean(nextLinked && next.selectedNodeIdSet.has(nextLinked.id));
        if (prevPlateSel !== nextPlateSel) return false;
      }
    }
  }

  return true;
});
