import React from 'react';
import {
  Check,
  Copy,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  GitBranch,
  GripVertical,
  Lock,
  Palette,
  Pencil,
  RotateCcw,
  RotateCw,
  Route,
  Sparkles,
  Table2,
  Tag,
  Trash2,
  Unlock,
  Upload,
  X,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert
} from 'lucide-react';
import { CableEdge, DiagramNode, ProjectState, SelectionState } from '../../types/infrastructure';
import type { MirrorAxis } from '../../store/slices/useNodesSlice';
import { useFloatingPanel } from '../../hooks/useFloatingPanel';
import {
  BRAND_LOGO_OPTIONS,
  DEVICE_ICON_OPTIONS,
  ISOMETRIC_ICON_OPTIONS,
  renderBrandLogoBadge,
  renderDeviceVisualIcon
} from '../../utils/deviceIcons';
import { CABLE_SIGNAL_COLOR_PRESETS, normalizeCableColor } from '../../utils/cableRouting';
import { validateAndConvertIconImage } from '../../utils/projectStorage';
import { sanitizeSafeImageUrl } from '../../utils/security';
import { evaluatePortPairCompatibility, pickBestCompatiblePortPair } from '../../utils/portCompatibility';
import { normalizeRotationDeg } from '../../utils/coverageUtils';
import { isNodeEffectivelyLocked } from '../../utils/layerPolicy';
import { CanvasCableGeometry, OpenInlineCableLabelFn } from './canvasTypes';

interface PendingConnectionState {
  sourceNodeId: string;
  targetNodeId: string;
  sourcePortId?: string;
  targetPortId?: string;
  screenX: number;
  screenY: number;
}

interface EditingCableLabelState {
  cableId: string;
  value: string;
  canvasX: number;
  canvasY: number;
}

interface CanvasSelectionOverlaysProps {
  containerRef: React.RefObject<HTMLElement | null>;
  showRulers?: boolean;
  project: ProjectState;
  selection: SelectionState;
  selectedNodeIds: string[];
  nodeMap: Map<string, DiagramNode>;
  zoom: number;
  pan: { x: number; y: number };
  viewportSize: { w: number; h: number };
  isDraggingOrResizing: boolean;
  isConnecting: boolean;
  isReadOnlyMode: boolean;
  iconPickerNodeId: string | null;
  iconPickerTab: 'icons' | 'isometric' | 'logos' | 'upload';
  nodeIconUploadError: string | null;
  confirmToolbarDelete: string | null;
  pendingConnection: PendingConnectionState | null;
  editingCableLabel: EditingCableLabelState | null;
  getCableGeometry: (cable: CableEdge) => CanvasCableGeometry | null;
  onSetIconPickerNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  onSetIconPickerTab: (tab: 'icons' | 'isometric' | 'logos' | 'upload') => void;
  onSetNodeIconUploadError: (err: string | null) => void;
  onSetConfirmToolbarDelete: (id: string | null) => void;
  onSetPendingConnection: React.Dispatch<React.SetStateAction<PendingConnectionState | null>>;
  onSetEditingCableLabel: React.Dispatch<React.SetStateAction<EditingCableLabelState | null>>;
  onCommitInlineCableLabel: () => void;
  onOpenInlineCableLabelEditor: OpenInlineCableLabelFn;
  onResizeLegendToFit?: (nodeId: string) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  onUpdateNode?: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onRotateNodes?: (nodeIds: string[], rotationDeg: number) => void;
  onMirrorNodes?: (nodeIds: string[], axis: MirrorAxis) => void;
  onSetNodeIconOrLogo?: (nodeId: string, payload: { customIcon?: string; customImageUrl?: string }) => void;
  onSetConnectingSource: (src: { nodeId: string; portId?: string } | null) => void;
  onSetCableColor?: (cableId: string, color: string) => void;
  onUpdateCable?: (cableId: string, partial: Partial<CableEdge>) => void;
  onAutoRouteCable?: (cableId: string) => void;
  onAddCable: (sourceNodeId: string, targetNodeId: string, sourcePortId?: string, targetPortId?: string) => void;
  onDeleteSelected: () => void;
}

export const CanvasSelectionOverlays: React.FC<CanvasSelectionOverlaysProps> = ({
  containerRef,
  showRulers = true,
  project,
  selection,
  selectedNodeIds,
  nodeMap,
  zoom,
  pan,
  viewportSize,
  isDraggingOrResizing,
  isConnecting,
  isReadOnlyMode,
  iconPickerNodeId,
  iconPickerTab,
  nodeIconUploadError,
  confirmToolbarDelete,
  pendingConnection,
  editingCableLabel,
  getCableGeometry,
  onSetIconPickerNodeId,
  onSetIconPickerTab,
  onSetNodeIconUploadError,
  onSetConfirmToolbarDelete,
  onSetPendingConnection,
  onSetEditingCableLabel,
  onCommitInlineCableLabel,
  onOpenInlineCableLabelEditor,
  onResizeLegendToFit,
  onToggleNodeLock,
  onToggleNodeVisibility,
  onDuplicateNodes,
  onUpdateNode,
  onRotateNodes,
  onMirrorNodes,
  onSetNodeIconOrLogo,
  onSetConnectingSource,
  onSetCableColor,
  onUpdateCable,
  onAutoRouteCable,
  onAddCable,
  onDeleteSelected
}) => {
  const isNodeToolbarVisible =
    !isReadOnlyMode &&
    selection.type === 'node' &&
    selectedNodeIds.length > 0 &&
    !isDraggingOrResizing &&
    !isConnecting;

  const objectToolbarPanel = useFloatingPanel({
    containerRef,
    storageKey: 'hachihi:2d-object-toolbar-pos',
    defaultCollapsed: false,
    padding: 12,
    isOpen: isNodeToolbarVisible
  });

  if (isReadOnlyMode) {
    return null;
  }

  return (
    <>
      {/* Outermost Top-Left Draggable Object Control Bar */}
      {(() => {
        if (!isNodeToolbarVisible) {
          return null;
        }

        const defaultAnchorLeft = showRulers ? 28 : 12;
        const defaultAnchorTop = showRulers ? 28 : 12;
        const barStyle: React.CSSProperties = {
          maxWidth: Math.max(280, viewportSize.w - (showRulers ? 40 : 24)),
          ...(objectToolbarPanel.position
            ? { left: objectToolbarPanel.position.x, top: objectToolbarPanel.position.y }
            : {})
        };
        const barPositionClass = objectToolbarPanel.position
          ? ''
          : showRulers
          ? 'top-7 left-7'
          : 'top-3 left-3';

        const dragGripButton = (
          <button
            type="button"
            data-testid="canvas-object-toolbar-drag-handle"
            onPointerDown={objectToolbarPanel.handleDragStart}
            onDoubleClick={objectToolbarPanel.resetPosition}
            aria-label="Kéo di chuyển thanh điều khiển đối tượng"
            title="Kéo để di chuyển thanh điều khiển · Nhấn đúp để đưa về góc trên bên trái"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        );

        // Multi-selection bar
        if (selectedNodeIds.length > 1) {
          const selectedNodes = selectedNodeIds
            .map(id => nodeMap.get(id))
            .filter((n): n is DiagramNode => Boolean(n));
          if (selectedNodes.length === 0) return null;
          const allLocked = selectedNodes.every(n =>
            isNodeEffectivelyLocked(n, project.settings, project.assets, false)
          );
          const multiRotationDeg = normalizeRotationDeg(selectedNodes[0]?.rotation || 0);
          const deleteKey = `multi_${selectedNodes.length}`;

          return (
            <div onPointerDown={e => e.stopPropagation()} className="no-print">
              <div
                ref={objectToolbarPanel.panelRef}
                data-testid="canvas-object-control-bar"
                style={barStyle}
                className={`canvas-floating-toolbar-enter absolute ${barPositionClass} z-30 flex items-center gap-1 px-1.5 py-1 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg backdrop-blur-xs text-[11px] overflow-x-auto whitespace-nowrap`}
              >
                {dragGripButton}
                <span className="px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold whitespace-nowrap shrink-0 tabular-nums">
                  {selectedNodes.length} đối tượng
                </span>

                {onMirrorNodes && (
                  <>
                    <button
                      type="button"
                      data-testid="toolbar-mirror-horizontal-btn"
                      disabled={allLocked}
                      onClick={() => onMirrorNodes(selectedNodeIds, 'horizontal')}
                      aria-label="Lật gương ngang"
                      title="Lật gương ngang (trái ⇄ phải)"
                      className="px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <FlipHorizontal2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Lật ngang</span>
                    </button>
                    <button
                      type="button"
                      data-testid="toolbar-mirror-vertical-btn"
                      disabled={allLocked}
                      onClick={() => onMirrorNodes(selectedNodeIds, 'vertical')}
                      aria-label="Lật gương dọc"
                      title="Lật gương dọc (trên ⇅ dưới)"
                      className="px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <FlipVertical2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Lật dọc</span>
                    </button>
                  </>
                )}

                {(onRotateNodes || onUpdateNode) && (
                  <button
                    type="button"
                    disabled={allLocked}
                    onClick={() => {
                      const nextDeg = normalizeRotationDeg(multiRotationDeg + 90);
                      if (onRotateNodes) onRotateNodes(selectedNodeIds, nextDeg);
                      else if (onUpdateNode) selectedNodeIds.forEach(id => onUpdateNode(id, { rotation: nextDeg }));
                    }}
                    aria-label="Xoay các đối tượng +90 độ"
                    title="Xoay +90°"
                    className="px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-mono text-[10px] font-semibold flex items-center gap-1 shrink-0 disabled:opacity-40"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-cyan-600" />
                    <span>+90°</span>
                  </button>
                )}

                {onToggleNodeLock && (
                  <button
                    type="button"
                    onClick={() => onToggleNodeLock(selectedNodeIds)}
                    aria-label={allLocked ? 'Mở khóa tất cả' : 'Khóa tất cả'}
                    className={`p-1 rounded-lg transition-colors shrink-0 ${
                      allLocked
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                    title={allLocked ? 'Mở khóa' : 'Khóa'}
                  >
                    {allLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                )}

                {onToggleNodeVisibility && (
                  <button
                    type="button"
                    onClick={() => onToggleNodeVisibility(selectedNodeIds, true)}
                    aria-label="Ẩn các đối tượng đã chọn"
                    className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
                    title="Ẩn các đối tượng đã chọn"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                )}

                {onDuplicateNodes && (
                  <button
                    type="button"
                    onClick={() => onDuplicateNodes(selectedNodeIds)}
                    aria-label="Nhân bản các đối tượng"
                    className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
                    title="Nhân bản (Ctrl+D)"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}

                {confirmToolbarDelete === deleteKey ? (
                  <div className="flex items-center gap-1 pl-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onSetConfirmToolbarDelete(null);
                        onDeleteSelected();
                      }}
                      className="px-2 py-0.5 rounded bg-rose-600 text-white font-semibold text-[10px]"
                    >
                      Xóa
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetConfirmToolbarDelete(null)}
                      className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px]"
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetConfirmToolbarDelete(deleteKey)}
                    aria-label="Xóa các đối tượng đã chọn"
                    className="p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 shrink-0"
                    title="Xóa các đối tượng đã chọn"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        }

        const activeNode = nodeMap.get(selectedNodeIds[0]);
        if (!activeNode || activeNode.type === 'rack') return null;

        const isActiveNodeLocked = isNodeEffectivelyLocked(activeNode, project.settings, project.assets, false);
        const currentRotationDeg = normalizeRotationDeg(activeNode.rotation || 0);
        const applyRotation = (nextDeg: number) => {
          const normalized = normalizeRotationDeg(nextDeg);
          if (onRotateNodes) {
            onRotateNodes([activeNode.id], normalized);
          } else if (onUpdateNode) {
            onUpdateNode(activeNode.id, { rotation: normalized });
          }
        };

        const renderInlineRotationControls = () =>
          (onRotateNodes || onUpdateNode) ? (
            <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
              <button
                type="button"
                disabled={isActiveNodeLocked}
                onClick={() => applyRotation(currentRotationDeg - 90)}
                aria-label="Xoay trái 90 độ"
                title="Xoay trái -90°"
                className="p-0.5 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <input
                type="number"
                min={0}
                max={359}
                step={1}
                disabled={isActiveNodeLocked}
                aria-label="Góc xoay 360 độ"
                value={Math.round(currentRotationDeg)}
                onChange={e => {
                  const parsed = parseFloat(e.target.value);
                  if (!Number.isNaN(parsed)) {
                    applyRotation(parsed);
                  }
                }}
                className="w-11 px-1 py-0.5 text-right rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold tabular-nums disabled:opacity-45"
              />
              <span className="text-[10px] font-mono text-slate-400">°</span>
              <button
                type="button"
                disabled={isActiveNodeLocked}
                onClick={() => applyRotation(currentRotationDeg + 90)}
                aria-label="Xoay phải 90 độ"
                title="Xoay phải +90° (hoặc kéo tay cầm xoay trên đối tượng)"
                className="p-0.5 rounded hover:bg-white dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCw className="w-3 h-3 text-cyan-600" />
              </button>
            </div>
          ) : null;

        const renderMirrorControls = () =>
          onMirrorNodes ? (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                data-testid="toolbar-mirror-horizontal-btn"
                disabled={isActiveNodeLocked}
                onClick={() => onMirrorNodes([activeNode.id], 'horizontal')}
                aria-label="Lật gương ngang"
                aria-pressed={Boolean(activeNode.flipX)}
                title="Lật gương ngang (trái ⇄ phải)"
                className={`p-1 rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                  activeNode.flipX
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                <FlipHorizontal2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="toolbar-mirror-vertical-btn"
                disabled={isActiveNodeLocked}
                onClick={() => onMirrorNodes([activeNode.id], 'vertical')}
                aria-label="Lật gương dọc"
                aria-pressed={Boolean(activeNode.flipY)}
                title="Lật gương dọc (trên ⇅ dưới)"
                className={`p-1 rounded-lg transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                  activeNode.flipY
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                <FlipVertical2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : null;

        if (activeNode.type === 'legend') {
          return (
            <div onPointerDown={e => e.stopPropagation()} className="no-print">
              <div
                ref={objectToolbarPanel.panelRef}
                data-testid="canvas-object-control-bar"
                style={barStyle}
                className={`canvas-floating-toolbar-enter absolute ${barPositionClass} z-30 flex items-center gap-1 px-2 py-1 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg backdrop-blur-xs text-[11px] overflow-x-auto whitespace-nowrap`}
              >
                {dragGripButton}
                <span className="flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300 px-1 whitespace-nowrap shrink-0">
                  <Table2 className="w-3.5 h-3.5" />
                  <span>Bảng Chú Giải</span>
                </span>
                {onResizeLegendToFit && (
                  <button
                    onClick={() => onResizeLegendToFit(activeNode.id)}
                    className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900 text-blue-700 dark:text-blue-300 font-semibold whitespace-nowrap shrink-0 transition-colors"
                    title="Tự động khớp kích thước vừa khít dữ liệu"
                  >
                    Khớp kích thước
                  </button>
                )}
                {renderMirrorControls()}
                {renderInlineRotationControls()}
                {onToggleNodeLock && (
                  <button
                    onClick={() => onToggleNodeLock([activeNode.id])}
                    aria-label={activeNode.locked ? 'Mở khóa bảng chú giải' : 'Khóa vị trí bảng chú giải'}
                    className={`p-1 rounded-lg transition-colors shrink-0 ${
                      activeNode.locked
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                    title={activeNode.locked ? 'Mở khóa bảng chú giải' : 'Khóa vị trí bảng chú giải'}
                  >
                    {activeNode.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                )}
                {onToggleNodeVisibility && (
                  <button
                    onClick={() => onToggleNodeVisibility([activeNode.id], true)}
                    aria-label="Ẩn bảng chú giải"
                    className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
                    title="Ẩn bảng chú giải"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                )}
                {confirmToolbarDelete === `node_${activeNode.id}` ? (
                  <div className="flex items-center gap-1 pl-1 shrink-0">
                    <button
                      onClick={() => {
                        onSetConfirmToolbarDelete(null);
                        onDeleteSelected();
                      }}
                      className="px-2 py-0.5 rounded bg-rose-600 text-white font-semibold text-[10px]"
                    >
                      Xóa
                    </button>
                    <button
                      onClick={() => onSetConfirmToolbarDelete(null)}
                      className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px]"
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onSetConfirmToolbarDelete(`node_${activeNode.id}`)}
                    aria-label="Xóa bảng chú giải"
                    className="p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 shrink-0"
                    title="Xóa bảng chú giải"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        }

        const asset = activeNode.assetId ? project.assets[activeNode.assetId] : undefined;
        const resolvedCustomIcon = activeNode.customIcon || asset?.customIcon;
        const resolvedCustomImage = sanitizeSafeImageUrl(activeNode.customImageUrl || asset?.customImageUrl);
        const showPicker = iconPickerNodeId === activeNode.id;
        const effectiveBarX = objectToolbarPanel.position?.x ?? defaultAnchorLeft;
        const effectiveBarY = objectToolbarPanel.position?.y ?? defaultAnchorTop;
        const pickerLeft = Math.max(12, Math.min(viewportSize.w - 316, effectiveBarX));
        const pickerTop =
          effectiveBarY + 290 < viewportSize.h
            ? effectiveBarY + 42
            : Math.max(12, effectiveBarY - 285);

        const applyIconPayload = (payload: { customIcon?: string; customImageUrl?: string }) => {
          if (onSetNodeIconOrLogo) {
            onSetNodeIconOrLogo(activeNode.id, payload);
          } else if (onUpdateNode) {
            onUpdateNode(activeNode.id, payload);
          }
        };

        return (
          <div onPointerDown={e => e.stopPropagation()} className="no-print">
            <div
              ref={objectToolbarPanel.panelRef}
              data-testid="canvas-object-control-bar"
              style={barStyle}
              className={`canvas-floating-toolbar-enter absolute ${barPositionClass} z-30 flex items-center gap-1 px-1.5 py-1 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg backdrop-blur-xs text-[11px] overflow-x-auto whitespace-nowrap`}
            >
              {dragGripButton}
              {activeNode.type !== 'text' && (
                <button
                  onClick={() => {
                    onSetNodeIconUploadError(null);
                    onSetIconPickerNodeId(prev => (prev === activeNode.id ? null : activeNode.id));
                  }}
                  aria-label="Đổi biểu tượng hoặc Logo hãng"
                  className={`px-2 py-1 rounded-lg font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                    showPicker
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900 text-blue-700 dark:text-blue-300'
                  }`}
                  title="Đổi biểu tượng hoặc Logo hãng"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Đổi Icon</span>
                </button>
              )}

              <button
                onClick={() => onSetConnectingSource({ nodeId: activeNode.id })}
                aria-label="Nối dây cáp từ thiết bị này"
                className="px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                title="Nối dây cáp từ thiết bị này"
              >
                <GitBranch className="w-3.5 h-3.5 text-blue-600" />
                <span>Nối dây</span>
              </button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {onUpdateNode && activeNode.type !== 'text' && (
                <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                  {(
                    [
                      { id: 'round', label: 'Bo' },
                      { id: 'rect', label: 'Vuông' },
                      { id: 'circle', label: 'Tròn' }
                    ] as const
                  ).map(sh => {
                    const isShapeActive = (activeNode.style.shape || 'round') === sh.id;
                    return (
                      <button
                        key={sh.id}
                        onClick={() =>
                          onUpdateNode(activeNode.id, {
                            style: { ...activeNode.style, shape: sh.id }
                          })
                        }
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                          isShapeActive
                            ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-2xs'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                        title={`Hình dạng: ${sh.label}`}
                      >
                        {sh.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {onUpdateNode && (
                <label
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex items-center gap-1 shrink-0"
                  title="Đổi màu khối"
                >
                  <span
                    className="w-4 h-4 rounded-xs border border-black/20"
                    style={{ backgroundColor: activeNode.style.backgroundColor || '#155eef' }}
                  />
                  <input
                    type="color"
                    value={normalizeCableColor(activeNode.style.backgroundColor || '#155eef')}
                    onChange={e =>
                      onUpdateNode(activeNode.id, {
                        style: { ...activeNode.style, backgroundColor: e.target.value }
                      })
                    }
                    className="sr-only"
                  />
                </label>
              )}

              {onToggleNodeLock && (
                <button
                  onClick={() => onToggleNodeLock([activeNode.id])}
                  aria-label={activeNode.locked ? 'Mở khóa vị trí' : 'Khóa vị trí'}
                  className={`p-1 rounded-lg transition-colors shrink-0 ${
                    activeNode.locked
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                  title={activeNode.locked ? 'Mở khóa vị trí' : 'Khóa vị trí'}
                >
                  {activeNode.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                </button>
              )}

              {onToggleNodeVisibility && (
                <button
                  onClick={() => onToggleNodeVisibility([activeNode.id], true)}
                  aria-label="Ẩn thiết bị khỏi trang vẽ"
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
                  title="Ẩn thiết bị khỏi trang vẽ"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>
              )}

              {onDuplicateNodes && (
                <button
                  onClick={() => onDuplicateNodes([activeNode.id])}
                  aria-label="Nhân bản thiết bị"
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
                  title="Nhân bản (Ctrl+D)"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}

              {renderMirrorControls()}
              {renderInlineRotationControls()}

              {confirmToolbarDelete === `node_${activeNode.id}` ? (
                <div className="flex items-center gap-1 pl-0.5 shrink-0">
                  <button
                    onClick={() => {
                      onSetConfirmToolbarDelete(null);
                      onDeleteSelected();
                    }}
                    className="px-2 py-0.5 rounded bg-rose-600 text-white font-semibold text-[10px]"
                  >
                    Xóa
                  </button>
                  <button
                    onClick={() => onSetConfirmToolbarDelete(null)}
                    className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px]"
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => onSetConfirmToolbarDelete(`node_${activeNode.id}`)}
                  aria-label="Xóa đối tượng"
                  className="p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 shrink-0"
                  title="Xóa đối tượng"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {showPicker && (
              <div
                style={{ left: pickerLeft, top: pickerTop }}
                className="absolute z-40 w-[304px] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 text-xs text-slate-800 dark:text-slate-100"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                      {renderDeviceVisualIcon({
                        customIcon: resolvedCustomIcon,
                        customImageUrl: resolvedCustomImage,
                        category: asset?.category || activeNode.type,
                        className: 'w-5 h-5 text-white'
                      })}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[11px] truncate">Đổi Icon &amp; Logo</div>
                      <div className="text-[10px] text-slate-500 truncate">{asset?.name || activeNode.label}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(resolvedCustomIcon || resolvedCustomImage) && (
                      <button
                        onClick={() => applyIconPayload({ customIcon: undefined, customImageUrl: undefined })}
                        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-blue-600"
                        title="Khôi phục icon mặc định"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onSetIconPickerNodeId(null)}
                      aria-label="Đóng bảng chọn icon"
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg my-2">
                  {(
                    [
                      { id: 'icons', label: 'Icon 2D' },
                      { id: 'isometric', label: 'Iso 2D' },
                      { id: 'logos', label: 'Logo' },
                      { id: 'upload', label: 'Tải ảnh' }
                    ] as const
                  ).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => onSetIconPickerTab(tab.id)}
                      className={`py-1 rounded-md text-[10px] font-semibold whitespace-nowrap transition-colors ${
                        iconPickerTab === tab.id
                          ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {iconPickerTab === 'icons' && (
                  <div className="grid grid-cols-5 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                    {DEVICE_ICON_OPTIONS.map(opt => {
                      const IconComp = opt.component;
                      const isActiveIcon = resolvedCustomIcon === opt.id && !resolvedCustomImage;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => applyIconPayload({ customIcon: opt.id, customImageUrl: undefined })}
                          className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${
                            isActiveIcon
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                          }`}
                          title={opt.label}
                        >
                          <IconComp className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {iconPickerTab === 'isometric' && (
                  <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {ISOMETRIC_ICON_OPTIONS.map(iso => {
                      const isActiveIso = resolvedCustomIcon === iso.id && !resolvedCustomImage;
                      return (
                        <button
                          key={iso.id}
                          onClick={() => applyIconPayload({ customIcon: iso.id, customImageUrl: undefined })}
                          className={`p-1.5 rounded-lg border flex items-center gap-2 transition-colors text-left ${
                            isActiveIso
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 ring-1 ring-blue-500'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-blue-400'
                          }`}
                          title={iso.label}
                        >
                          <img
                            src={iso.imageSrc}
                            alt={iso.label}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 object-contain rounded bg-white p-0.5 shrink-0 border border-slate-200"
                          />
                          <span className="text-[10px] font-semibold leading-tight">{iso.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {iconPickerTab === 'logos' && (
                  <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                    {BRAND_LOGO_OPTIONS.map(logo => {
                      const isActiveLogo = resolvedCustomIcon === logo.id && !resolvedCustomImage;
                      return (
                        <button
                          key={logo.id}
                          onClick={() => applyIconPayload({ customIcon: logo.id, customImageUrl: undefined })}
                          className={`p-1.5 rounded-lg border flex items-center gap-1.5 transition-colors text-left ${
                            isActiveLogo
                              ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 ring-1 ring-blue-500'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-blue-400'
                          }`}
                          title={logo.label}
                        >
                          {renderBrandLogoBadge(logo, 'w-6 h-6 shrink-0')}
                          <span className="text-[10px] font-semibold truncate">{logo.shortCode}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {iconPickerTab === 'upload' && (
                  <div className="space-y-2 py-1">
                    <label className="w-full py-4 px-3 rounded-lg border border-dashed border-blue-400 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-50 text-blue-700 dark:text-blue-300 font-medium flex flex-col items-center justify-center gap-1.5 cursor-pointer text-[11px] text-center">
                      <Upload className="w-5 h-5" />
                      <span>Chọn file PNG, JPG, WebP hoặc SVG</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">Tối đa 512KB · Tự động tối ưu độ nét</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          onSetNodeIconUploadError(null);
                          const res = await validateAndConvertIconImage(file);
                          if (!res.ok) {
                            onSetNodeIconUploadError(res.error);
                          } else {
                            applyIconPayload({ customImageUrl: sanitizeSafeImageUrl(res.dataUrl), customIcon: undefined });
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {nodeIconUploadError && (
                      <div className="text-[10.5px] text-rose-600 font-medium">{nodeIconUploadError}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Contextual Floating Cable Toolbar */}
      {selection.type === 'edge' && selection.id && (() => {
        const selectedCable = project.cables.find(c => c.id === selection.id);
        if (!selectedCable) return null;
        const activeColor = normalizeCableColor(selectedCable.color || '#155eef');
        const applyCableColor = (nextColor: string) => {
          if (onSetCableColor) onSetCableColor(selectedCable.id, nextColor);
          else onUpdateCable?.(selectedCable.id, { color: nextColor });
        };

        const cableGeom = getCableGeometry(selectedCable);
        const cableMidScreenX = cableGeom ? cableGeom.midX * zoom + pan.x : viewportSize.w / 2;
        const cableMidScreenY = cableGeom ? cableGeom.midY * zoom + pan.y : viewportSize.h - 70;
        const estimatedBarW = Math.min(540, Math.max(300, viewportSize.w - 24));
        const cableBarLeft = Math.max(
          12,
          Math.min(viewportSize.w - estimatedBarW - 12, cableMidScreenX - estimatedBarW / 2)
        );
        const cableBarTop =
          cableMidScreenY > 88
            ? Math.max(12, Math.min(viewportSize.h - 62, cableMidScreenY - 56))
            : Math.min(viewportSize.h - 62, cableMidScreenY + 18);

        return (
          <div
            onPointerDown={e => e.stopPropagation()}
            style={{ left: cableBarLeft, top: cableBarTop, maxWidth: viewportSize.w - 24 }}
            className="canvas-floating-toolbar-enter absolute z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-xl backdrop-blur-xs text-[11px] no-print overflow-x-auto"
          >
            <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200 dark:border-slate-700 shrink-0">
              <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: activeColor }} />
              <span className="font-mono font-bold text-slate-800 dark:text-slate-100 max-w-[120px] truncate">
                {selectedCable.label || selectedCable.cableCode}
              </span>
              {onUpdateCable && (
                <button
                  onClick={() => {
                    if (cableGeom) {
                      onOpenInlineCableLabelEditor(selectedCable, cableGeom.midX, cableGeom.midY);
                    }
                  }}
                  className="ml-0.5 px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900 text-blue-700 dark:text-blue-300 font-semibold text-[10px] flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                  title="Sửa nhãn văn bản trên dây cáp"
                >
                  <Pencil className="w-2.5 h-2.5" />
                  <span>{selectedCable.label ? 'Sửa nhãn' : 'Nhãn'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {CABLE_SIGNAL_COLOR_PRESETS.slice(0, 6).map(preset => {
                const isActive = activeColor.toLowerCase() === preset.color.toLowerCase();
                return (
                  <button
                    key={preset.color}
                    onClick={() => applyCableColor(preset.color)}
                    aria-label={`Chọn màu cáp ${preset.label}`}
                    className={`w-4.5 h-4.5 rounded-xs border transition-transform shrink-0 ${
                      isActive ? 'ring-2 ring-blue-500 scale-110 border-white' : 'border-black/15 hover:scale-110'
                    }`}
                    style={{ backgroundColor: preset.color }}
                    title={`${preset.label}: ${preset.signalRole}`}
                  />
                );
              })}
              <label
                className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 hover:border-blue-400 flex items-center gap-1 cursor-pointer bg-slate-50 dark:bg-slate-800 shrink-0"
                title="Chọn màu tùy chỉnh"
              >
                <Palette className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                <input
                  type="color"
                  value={activeColor.length === 7 ? activeColor : '#155eef'}
                  onChange={e => applyCableColor(e.target.value)}
                  className="sr-only"
                />
              </label>
            </div>

            {onUpdateCable && (
              <>
                <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 shrink-0" />
                <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg shrink-0">
                  <button
                    onClick={() =>
                      onUpdateCable(selectedCable.id, {
                        lineStyle: selectedCable.lineStyle === 'dashed' ? 'solid' : 'dashed'
                      })
                    }
                    className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 whitespace-nowrap"
                    title="Chuyển nét liền / nét đứt"
                  >
                    {selectedCable.lineStyle === 'dashed' ? 'Nét đứt' : 'Nét liền'}
                  </button>
                  <button
                    onClick={() => {
                      const order: CableEdge['routingType'][] = ['orthogonal', 'straight', 'curved'];
                      const next = order[(order.indexOf(selectedCable.routingType) + 1) % order.length];
                      onUpdateCable(selectedCable.id, { routingType: next });
                    }}
                    className="px-2 py-0.5 rounded text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 whitespace-nowrap"
                    title="Đổi kiểu đi dây"
                  >
                    {selectedCable.routingType === 'orthogonal'
                      ? 'Vuông góc'
                      : selectedCable.routingType === 'curved'
                      ? 'Cong'
                      : 'Thẳng'}
                  </button>
                  {onAutoRouteCable && (
                    <button
                      onClick={() => onAutoRouteCable(selectedCable.id)}
                      className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 whitespace-nowrap"
                      title="Auto-Route tránh vật cản"
                    >
                      <Route className="w-3 h-3" />
                      <span>Auto-Route</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {confirmToolbarDelete === `cable_${selectedCable.id}` ? (
              <div className="flex items-center gap-1 shrink-0 pl-0.5">
                <button
                  onClick={() => {
                    onSetConfirmToolbarDelete(null);
                    onDeleteSelected();
                  }}
                  className="px-2 py-0.5 rounded bg-rose-600 text-white font-semibold text-[10px]"
                >
                  Xóa
                </button>
                <button
                  onClick={() => onSetConfirmToolbarDelete(null)}
                  className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px]"
                >
                  Hủy
                </button>
              </div>
            ) : (
              <button
                onClick={() => onSetConfirmToolbarDelete(`cable_${selectedCable.id}`)}
                aria-label="Xóa dây cáp đang chọn"
                className="p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 shrink-0"
                title="Xóa dây cáp"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })()}

      {/* Port Picker Popover (UX #4: Guided Step 1 -> Step 2 with Port Compatibility Validation) */}
      {pendingConnection && (() => {
        const srcNode = nodeMap.get(pendingConnection.sourceNodeId);
        const tgtNode = nodeMap.get(pendingConnection.targetNodeId);
        if (!srcNode || !tgtNode) return null;
        const srcAsset = srcNode.assetId ? project.assets[srcNode.assetId] : undefined;
        const tgtAsset = tgtNode.assetId ? project.assets[tgtNode.assetId] : undefined;
        const srcPorts = srcAsset?.ports || [];
        const tgtPorts = tgtAsset?.ports || [];
        const srcPort = srcPorts.find(p => p.id === pendingConnection.sourcePortId);
        const tgtPort = tgtPorts.find(p => p.id === pendingConnection.targetPortId);
        const compat = evaluatePortPairCompatibility(srcAsset, srcPort, tgtAsset, tgtPort);
        const hasSuggestedFix = srcPorts.length > 0 && tgtPorts.length > 0 && compat.level !== 'ok';

        return (
          <div
            onPointerDown={e => e.stopPropagation()}
            style={{ left: pendingConnection.screenX, top: pendingConnection.screenY }}
            data-testid="port-picker-popover"
            className="absolute z-40 w-[356px] max-w-[calc(100%-24px)] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 text-xs text-slate-800 dark:text-slate-100 no-print"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                <GitBranch className="w-3.5 h-3.5 text-blue-600" />
                <span>Kết nối cổng thiết bị (A → B)</span>
              </div>
              <button
                onClick={() => onSetPendingConnection(null)}
                aria-label="Đóng chọn cổng"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="py-2.5 space-y-2.5">
              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 truncate">
                  Bước 1 · Thiết bị A:{' '}
                  <strong className="text-slate-800 dark:text-slate-100">{srcAsset?.name || srcNode.label}</strong>
                </div>
                {srcPorts.length > 0 ? (
                  <select
                    aria-label="Chọn cổng thiết bị nguồn"
                    value={pendingConnection.sourcePortId || ''}
                    onChange={e =>
                      onSetPendingConnection(prev =>
                        prev ? { ...prev, sourcePortId: e.target.value || undefined } : null
                      )
                    }
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                  >
                    {srcPorts.map(pt => (
                      <option key={pt.id} value={pt.id}>
                        {pt.name} · {pt.type} ({pt.speed}
                        {pt.poe ? ' · PoE' : ''}) — {pt.status === 'up' ? 'Đang nối' : 'Trống'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-[11px] text-slate-400 italic">Thiết bị nguồn không có danh sách cổng cố định</div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-medium text-slate-500 mb-1 truncate">
                  Bước 2 · Thiết bị B:{' '}
                  <strong className="text-slate-800 dark:text-slate-100">{tgtAsset?.name || tgtNode.label}</strong>
                </div>
                {tgtPorts.length > 0 ? (
                  <select
                    aria-label="Chọn cổng thiết bị đích"
                    value={pendingConnection.targetPortId || ''}
                    onChange={e =>
                      onSetPendingConnection(prev =>
                        prev ? { ...prev, targetPortId: e.target.value || undefined } : null
                      )
                    }
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                  >
                    {tgtPorts.map(pt => (
                      <option key={pt.id} value={pt.id}>
                        {pt.name} · {pt.type} ({pt.speed}
                        {pt.poe ? ' · PoE' : ''}) — {pt.status === 'up' ? 'Đang nối' : 'Trống'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-[11px] text-slate-400 italic">Thiết bị đích không có danh sách cổng cố định</div>
                )}
              </div>

              {/* Port Compatibility Feedback */}
              <div
                role="status"
                className={`p-2 rounded-lg border text-[11px] space-y-1 ${
                  compat.level === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
                    : compat.level === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                }`}
              >
                <div className="flex items-start gap-1.5 font-semibold">
                  {compat.level === 'error' ? (
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  ) : compat.level === 'warning' ? (
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <div className="min-w-0">
                    {compat.level === 'ok' ? (
                      <span>
                        Cổng tương thích ({compat.suggestedCableType || 'CAT6_UTP'}). Sẵn sàng nối dây.
                      </span>
                    ) : (
                      <span>{compat.reasons[0]}</span>
                    )}
                  </div>
                </div>
                {compat.reasons.slice(1).map((r, idx) => (
                  <div key={idx} className="pl-5 text-[10.5px] opacity-90">
                    {r}
                  </div>
                ))}
                {hasSuggestedFix && (
                  <button
                    type="button"
                    onClick={() => {
                      const best = pickBestCompatiblePortPair(srcPorts, tgtPorts);
                      onSetPendingConnection(prev =>
                        prev
                          ? {
                              ...prev,
                              sourcePortId: best.sourcePortId,
                              targetPortId: best.targetPortId
                            }
                          : null
                      );
                    }}
                    className="ml-5 text-[11px] font-semibold underline hover:no-underline cursor-pointer"
                  >
                    Tự chọn cặp cổng trống tương thích
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onSetPendingConnection(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={compat.level === 'error'}
                onClick={() => {
                  onAddCable(
                    pendingConnection.sourceNodeId,
                    pendingConnection.targetNodeId,
                    pendingConnection.sourcePortId,
                    pendingConnection.targetPortId
                  );
                  onSetPendingConnection(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold"
              >
                Kết nối ngay
              </button>
            </div>
          </div>
        );
      })()}

      {/* Direct On-Canvas Inline Cable Label Input */}
      {editingCableLabel && (() => {
        const inputScreenX = editingCableLabel.canvasX * zoom + pan.x;
        const inputScreenY = editingCableLabel.canvasY * zoom + pan.y;
        const clampedLeft = Math.max(12, Math.min(viewportSize.w - 232, inputScreenX - 105));
        const clampedTop = Math.max(12, Math.min(viewportSize.h - 46, inputScreenY - 18));
        return (
          <div
            onPointerDown={e => e.stopPropagation()}
            style={{ left: clampedLeft, top: clampedTop }}
            className="absolute z-40 w-[210px] flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border-2 border-blue-600 shadow-2xl no-print"
          >
            <Tag className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <input
              type="text"
              autoFocus
              value={editingCableLabel.value}
              onChange={e =>
                onSetEditingCableLabel(prev => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitInlineCableLabel();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onSetEditingCableLabel(null);
                }
              }}
              onBlur={onCommitInlineCableLabel}
              placeholder="Nhập nhãn dây cáp..."
              className="flex-1 min-w-0 bg-transparent text-xs font-semibold text-slate-900 dark:text-white outline-none"
            />
            <button
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                onCommitInlineCableLabel();
              }}
              aria-label="Lưu nhãn dây cáp"
              className="p-1 rounded bg-blue-600 text-white hover:bg-blue-700 shrink-0"
              title="Lưu nhãn (Enter)"
            >
              <Check className="w-3 h-3" />
            </button>
          </div>
        );
      })()}
    </>
  );
};
