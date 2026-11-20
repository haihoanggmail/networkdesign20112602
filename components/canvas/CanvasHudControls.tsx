import React, { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  Compass,
  Copy,
  Eye,
  FolderOpen,
  GitBranch,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RotateCcw,
  Route,
  SlidersHorizontal,
  Trash2,
  Unlock,
  Upload,
  X
} from 'lucide-react';
import {
  CableEdge,
  DiagramNode,
  ProjectState,
  Room,
  SelectionState
} from '../../types/infrastructure';
import { CANVAS_BACKGROUND_PRESETS, ResolvedCanvasAppearance } from '../../utils/canvasBackgrounds';
import { CableBundleInfo } from '../../utils/cableRouting';
import { CanvasCableGeometry, OpenInlineCableLabelFn } from './canvasTypes';
import { useFloatingPanel } from '../../hooks/useFloatingPanel';

import { SmartCopyPasteOptions } from '../../store/useProjectStore';

export interface TouchContextMenuState {
  kind: 'node' | 'edge' | 'canvas';
  id: string;
  x: number;
  y: number;
  targetNodeIds?: string[];
  canvasX?: number;
  canvasY?: number;
}

interface CanvasHudControlsProps {
  containerRef?: React.RefObject<HTMLDivElement | null>;
  project: ProjectState;
  selection: SelectionState;
  visibleNodes: DiagramNode[];
  visibleRooms: Room[];
  nodeMap: Map<string, DiagramNode>;
  selectedNodeIdSet: Set<string>;
  overlappingNodeIds: Set<string>;
  canvasAppearance: ResolvedCanvasAppearance;
  showBgMenu: boolean;
  bgUploadError: string | null;
  bgFileInputRef: React.RefObject<HTMLInputElement | null>;
  connectingSource: { nodeId: string; portId?: string } | null;
  connectingSourceNode?: DiagramNode;
  reconnectingCableEndpoint?: 'source' | 'target' | null;
  activeBundleInfo?: CableBundleInfo;
  collapsedBundleIds: Set<string>;
  touchContextMenu: TouchContextMenuState | null;
  showMinimap: boolean;
  minimapBounds: { minX: number; minY: number; width: number; height: number };
  viewportSize: { w: number; h: number };
  zoom: number;
  pan: { x: number; y: number };
  isReadOnlyMode: boolean;
  onSetActiveFloor?: (floorId: string) => void;
  onCloneFloor?: (floorId: string, newLevel: number, newName: string) => void;
  onOpenBuildingGenerator?: () => void;
  onSetShowBgMenu: React.Dispatch<React.SetStateAction<boolean>>;
  onSetBgUploadError: (err: string | null) => void;
  onSetActiveBundleId: React.Dispatch<React.SetStateAction<string | null>>;
  onSetCollapsedBundleIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetHoveredCableId: React.Dispatch<React.SetStateAction<string | null>>;
  onSetTouchContextMenu: React.Dispatch<React.SetStateAction<TouchContextMenuState | null>>;
  onSetIconPickerNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  onUpdateSettings?: (partial: Partial<ProjectState['settings']>) => void;
  onSelect: (type: SelectionState['type'], id?: string, additionalIds?: string[]) => void;
  onSelectMultipleNodes?: (nodeIds: string[]) => void;
  onSetConnectingSource: (src: { nodeId: string; portId?: string } | null) => void;
  onOpenTemplates?: () => void;
  onAddQuickDevice?: () => void;
  onOpenCommandPalette?: () => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  smartClipboardNodeIds?: string[];
  onSmartCopyPasteNodes?: (nodeIds?: string[], options?: SmartCopyPasteOptions) => void;
  onCopyNodesToClipboard?: (nodeIds: string[]) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onOpenDeepInspect: (id: string) => void;
  onDeleteSelected: () => void;
  onAutoRouteCable?: (cableId: string) => void;
  onUpdateCable?: (cableId: string, partial: Partial<CableEdge>) => void;
  getCableGeometry: (cable: CableEdge) => CanvasCableGeometry | null;
  onOpenInlineCableLabelEditor: OpenInlineCableLabelFn;
  onPanChange: (pan: { x: number; y: number }) => void;
}

export const CanvasHudControls: React.FC<CanvasHudControlsProps> = ({
  containerRef,
  project,
  selection,
  visibleNodes,
  visibleRooms,
  nodeMap,
  selectedNodeIdSet,
  overlappingNodeIds,
  canvasAppearance,
  showBgMenu,
  bgUploadError,
  bgFileInputRef,
  connectingSource,
  connectingSourceNode,
  reconnectingCableEndpoint,
  activeBundleInfo,
  collapsedBundleIds,
  touchContextMenu,
  showMinimap,
  minimapBounds,
  viewportSize,
  zoom,
  pan,
  isReadOnlyMode,
  onSetActiveFloor,
  onCloneFloor,
  onOpenBuildingGenerator,
  onSetShowBgMenu,
  onSetBgUploadError,
  onSetActiveBundleId,
  onSetCollapsedBundleIds,
  onSetHoveredCableId,
  onSetTouchContextMenu,
  onSetIconPickerNodeId,
  onUpdateSettings,
  onSelect,
  onSelectMultipleNodes,
  onSetConnectingSource,
  onOpenTemplates,
  onAddQuickDevice,
  onDuplicateNodes,
  smartClipboardNodeIds = [],
  onSmartCopyPasteNodes,
  onCopyNodesToClipboard,
  onToggleNodeLock,
  onOpenDeepInspect,
  onDeleteSelected,
  onAutoRouteCable,
  onUpdateCable,
  getCableGeometry,
  onOpenInlineCableLabelEditor,
  onPanChange
}) => {
  const fallbackHostRef = useRef<HTMLDivElement>(null);
  const hostRef = containerRef ?? fallbackHostRef;
  const bgPopoverRef = useRef<HTMLDivElement>(null);

  const floorPanel = useFloatingPanel({
    containerRef: hostRef,
    storageKey: 'hachihi:2d-floor-panel',
    defaultCollapsed: false
  });

  useEffect(() => {
    if (!showBgMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSetShowBgMenu(false);
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-testid="unified-viewport-controller"]')) {
        return;
      }
      if (bgPopoverRef.current && !bgPopoverRef.current.contains(target)) {
        onSetShowBgMenu(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [showBgMenu, onSetShowBgMenu]);

  const activeFloorName =
    project.floors.find(fl => fl.id === project.activeFloorId)?.name || 'Tầng';

  return (
    <>
      {/* Movable & Collapsible Top-Right Context: Floor Switcher + ReadOnly / Overlap Status */}
      <div
        ref={floorPanel.panelRef}
        data-testid="2d-floor-hud-panel"
        style={
          floorPanel.position
            ? { left: `${floorPanel.position.x}px`, top: `${floorPanel.position.y}px` }
            : undefined
        }
        className={`absolute z-20 flex flex-wrap items-center justify-end gap-1.5 no-print ${
          floorPanel.position
            ? ''
            : `${project.settings.showRulers !== false ? 'top-7' : 'top-3'} right-3`
        }`}
        onPointerDown={e => e.stopPropagation()}
      >
        {floorPanel.collapsed ? (
          <div className="flex items-center gap-1 h-7 px-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-sm text-xs">
            <button
              type="button"
              data-testid="2d-floor-drag-handle"
              onPointerDown={floorPanel.handleDragStart}
              onDoubleClick={floorPanel.resetPosition}
              title="Kéo để di chuyển thanh tầng · Nhấp đúp về góc mặc định"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="2d-floor-collapse-btn"
              onClick={floorPanel.toggleCollapsed}
              title="Mở rộng thanh chọn tầng"
              className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Building2 className="w-3 h-3 text-[#155EEF]" />
              <span className="max-w-[90px] truncate">{activeFloorName}</span>
              {overlappingNodeIds.size > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
              )}
              <Maximize2 className="w-3 h-3 text-slate-400 shrink-0" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1 h-8 px-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-sm text-xs">
              <button
                type="button"
                data-testid="2d-floor-drag-handle"
                onPointerDown={floorPanel.handleDragStart}
                onDoubleClick={floorPanel.resetPosition}
                title="Kéo để di chuyển thanh tầng · Nhấp đúp về góc mặc định"
                className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>

              {isReadOnlyMode && (
                <div
                  role="status"
                  className="flex items-center gap-1 h-6 px-2 rounded-md bg-slate-900 text-white text-[11px] font-semibold whitespace-nowrap"
                >
                  <Eye className="w-3 h-3 text-sky-400" />
                  <span>Chỉ xem</span>
                </div>
              )}

              {project.floors.length >= 1 && onSetActiveFloor && (
                <div className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
                  <select
                    value={project.activeFloorId}
                    onChange={e => onSetActiveFloor(e.target.value)}
                    aria-label="Chọn tầng hiển thị"
                    className="bg-transparent text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none cursor-pointer max-w-[160px]"
                  >
                    {project.floors.map(fl => (
                      <option key={fl.id} value={fl.id} className="dark:bg-slate-900">
                        {fl.name}
                      </option>
                    ))}
                  </select>
                  {!isReadOnlyMode && onCloneFloor && (
                    <button
                      type="button"
                      onClick={() => {
                        const nextLevel = Math.max(0, ...project.floors.map(f => f.level)) + 1;
                        onCloneFloor(project.activeFloorId, nextLevel, `Tầng ${nextLevel}`);
                      }}
                      aria-label="Nhân bản tầng hiện tại"
                      title="Nhân bản tầng hiện tại sang tầng mới"
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                data-testid="2d-floor-collapse-btn"
                onClick={floorPanel.toggleCollapsed}
                title="Thu gọn thanh tầng để không che hình vẽ"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {overlappingNodeIds.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  const ids = Array.from(overlappingNodeIds);
                  if (ids.length > 0) {
                    if (onSelectMultipleNodes) {
                      onSelectMultipleNodes(ids);
                    } else {
                      onSelect('node', ids[0], ids.slice(1));
                    }
                  }
                }}
                aria-label={`Chọn ${overlappingNodeIds.size} thiết bị đang chồng lấn`}
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white border border-rose-500 shadow-sm text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                title="Phát hiện thiết bị hoặc tủ Rack đang chồng lấn lên nhau. Nhấp để chọn tất cả."
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="tabular-nums">Chồng lấn ({overlappingNodeIds.size})</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Connecting / Reconnecting Banners */}
      {connectingSource && !isReadOnlyMode && (
        <div className={`absolute ${project.settings.showRulers !== false ? 'top-7' : 'top-3'} left-1/2 -translate-x-1/2 z-30 bg-[#155EEF] text-white px-3.5 py-2 rounded-lg shadow-lg text-xs font-semibold flex items-center gap-2`}>
          <GitBranch className="w-3.5 h-3.5 shrink-0" />
          <span>
            Đang nối dây từ <strong>{connectingSourceNode?.label || 'Thiết bị'}</strong>. Nhấp vào thiết bị đích để kết nối.
          </span>
          <button
            type="button"
            onClick={() => onSetConnectingSource(null)}
            aria-label="Hủy nối dây"
            className="ml-1 hover:bg-[#124CC7] p-0.5 rounded"
            title="Hủy kết nối (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {reconnectingCableEndpoint && !isReadOnlyMode && (
        <div className={`absolute ${project.settings.showRulers !== false ? 'top-7' : 'top-3'} left-1/2 -translate-x-1/2 z-30 bg-emerald-600 text-white px-3.5 py-2 rounded-lg shadow-lg text-xs font-semibold flex items-center gap-2`}>
          <GitBranch className="w-3.5 h-3.5 shrink-0" />
          <span>
            Kéo đầu cáp vào thiết bị mới để chuyển kết nối ({reconnectingCableEndpoint === 'source' ? 'Đầu nguồn' : 'Đầu đích'}).
          </span>
        </div>
      )}

      {/* Active Cable Bundle Inspector */}
      {activeBundleInfo && (
        <div
          className="absolute bottom-3 left-3 md:left-40 z-30 w-72 bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-3 text-xs backdrop-blur-xs no-print"
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 dark:text-white truncate">
                Bó cáp ({activeBundleInfo.cables.length} tuyến)
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                Tổng chiều dài ~{activeBundleInfo.totalMeters}m
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onSetCollapsedBundleIds(prev => {
                    const next = new Set(prev);
                    if (next.has(activeBundleInfo.bundleId)) next.delete(activeBundleInfo.bundleId);
                    else next.add(activeBundleInfo.bundleId);
                    return next;
                  });
                }}
                className="px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900 text-[#155EEF] dark:text-blue-300 font-semibold text-xs flex items-center gap-1 transition-colors"
                title={
                  collapsedBundleIds.has(activeBundleInfo.bundleId)
                    ? 'Tách hiển thị từng sợi cáp song song'
                    : 'Gộp các sợi thành 1 đường trục gọn gàng'
                }
              >
                {collapsedBundleIds.has(activeBundleInfo.bundleId) ? (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Tách sợi</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Gộp trục</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onSetActiveBundleId(null)}
                aria-label="Đóng bảng bó cáp"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                title="Đóng bảng bó cáp"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-2 max-h-44 overflow-y-auto space-y-1 pr-0.5">
            {activeBundleInfo.cables.map(c => {
              const isCableSel = selection.type === 'edge' && selection.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect('edge', c.id)}
                  onMouseEnter={() => onSetHoveredCableId(c.id)}
                  onMouseLeave={() => onSetHoveredCableId(prev => (prev === c.id ? null : prev))}
                  className={`w-full px-2 py-1.5 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors ${
                    isCableSel
                      ? 'bg-[#155EEF] text-white border-[#155EEF]'
                      : 'bg-slate-50/70 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: c.color || '#155EEF' }}
                    />
                    <span className="font-mono font-semibold text-xs truncate">
                      {c.label || c.cableCode}
                    </span>
                  </div>
                  <span
                    className={`text-xs font-mono tabular-nums shrink-0 ${
                      isCableSel ? 'text-blue-100' : 'text-slate-500'
                    }`}
                  >
                    {c.bandwidth} · {c.lengthMeters}m
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Helpful Empty State */}
      {visibleNodes.length === 0 && visibleRooms.length === 0 && !isReadOnlyMode && (
        <div
          onPointerDown={e => e.stopPropagation()}
          className="absolute inset-0 z-10 flex items-center justify-center p-4 pointer-events-none no-print"
        >
          <div className="pointer-events-auto max-w-md w-full rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 backdrop-blur-xs text-slate-800 dark:text-slate-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#155EEF] text-white flex items-center justify-center shrink-0">
                <Compass className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Trang vẽ đang trống — Bắt đầu thiết kế nhanh
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Kéo thiết bị từ thư viện bên trái thả vào bản vẽ, nạp nhanh mẫu có sẵn hoặc khởi tạo mặt bằng tòa nhà nhiều tầng.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {onOpenTemplates && (
                <button
                  type="button"
                  onClick={onOpenTemplates}
                  aria-label="Chọn mẫu thiết kế có sẵn"
                  className="touch-target px-3 py-2 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <FolderOpen className="w-4 h-4 shrink-0" />
                  <span>Chọn mẫu</span>
                </button>
              )}
              {onAddQuickDevice && (
                <button
                  type="button"
                  onClick={onAddQuickDevice}
                  aria-label="Thêm nhanh Switch lên trang vẽ"
                  className="touch-target px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4 shrink-0 text-[#155EEF]" />
                  <span>Thêm thiết bị</span>
                </button>
              )}
              {onOpenBuildingGenerator && (
                <button
                  type="button"
                  onClick={onOpenBuildingGenerator}
                  aria-label="Tạo cấu trúc tòa nhà nhiều tầng"
                  className="touch-target px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Building2 className="w-4 h-4 shrink-0 text-[#155EEF]" />
                  <span>Tạo tòa nhà</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contextual Menu (Right-click & Touch Long-Press) */}
      {touchContextMenu && (
        <div
          onPointerDown={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
          style={{ left: touchContextMenu.x, top: touchContextMenu.y }}
          role="menu"
          aria-label="Menu thao tác nhanh"
          className="absolute z-40 w-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-1.5 space-y-1 text-xs no-print"
        >
          {touchContextMenu.kind === 'canvas' ? (() => {
            const pasteTargets =
              smartClipboardNodeIds.length > 0
                ? smartClipboardNodeIds
                : Array.from(selectedNodeIdSet);
            return (
              <>
                <div className="px-2 py-1 text-xs font-bold text-slate-500 truncate border-b border-slate-100 dark:border-slate-800">
                  Thao tác Canvas
                </div>
                {!isReadOnlyMode && onSmartCopyPasteNodes && (
                  <button
                    type="button"
                    disabled={pasteTargets.length === 0}
                    onClick={() => {
                      if (pasteTargets.length > 0) {
                        onSmartCopyPasteNodes(pasteTargets, {
                          targetCanvasPos:
                            touchContextMenu.canvasX !== undefined && touchContextMenu.canvasY !== undefined
                              ? { x: touchContextMenu.canvasX, y: touchContextMenu.canvasY }
                              : undefined
                        });
                      }
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-between gap-2 font-medium"
                  >
                    <span className="flex items-center gap-2">
                      <Copy className="w-4 h-4 text-[#155EEF]" />
                      <span>Dán thông minh tại đây</span>
                    </span>
                    {pasteTargets.length > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-[#155EEF] dark:text-blue-300">
                        {pasteTargets.length}
                      </span>
                    )}
                  </button>
                )}
                {onSelectMultipleNodes && visibleNodes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectMultipleNodes(visibleNodes.map(n => n.id));
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                  >
                    <Check className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                    <span>Chọn tất cả ({visibleNodes.length})</span>
                  </button>
                )}
                {!isReadOnlyMode && onAddQuickDevice && (
                  <button
                    type="button"
                    onClick={() => {
                      onAddQuickDevice();
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                  >
                    <Plus className="w-4 h-4 text-emerald-600" />
                    <span>Thêm thiết bị mới</span>
                  </button>
                )}
              </>
            );
          })() : touchContextMenu.kind === 'node' ? (() => {
            const targetNode = nodeMap.get(touchContextMenu.id);
            if (!targetNode) return null;
            const contextNodeIds =
              touchContextMenu.targetNodeIds && touchContextMenu.targetNodeIds.length > 0
                ? touchContextMenu.targetNodeIds
                : [targetNode.id];
            const isMultiContext = contextNodeIds.length > 1;
            return (
              <>
                <div className="px-2 py-1 text-xs font-bold text-slate-500 truncate border-b border-slate-100 dark:border-slate-800">
                  {targetNode.label}
                  {isMultiContext ? ` (+${contextNodeIds.length - 1} nút)` : ''}
                </div>
                {!isReadOnlyMode && (
                  <button
                    type="button"
                    onClick={() => {
                      onSetIconPickerNodeId(targetNode.id);
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                  >
                    <ImageIcon className="w-4 h-4 text-[#155EEF]" />
                    <span>Đổi biểu tượng / Logo</span>
                  </button>
                )}
                {!isReadOnlyMode && onSmartCopyPasteNodes && (
                  <button
                    type="button"
                    data-testid="ctx-smart-copy-paste"
                    onClick={() => {
                      onSmartCopyPasteNodes(contextNodeIds);
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center justify-between gap-2 font-semibold text-[#155EEF] dark:text-blue-400"
                    title="Nhân bản thông minh, giữ nguyên liên kết cáp tương đối, cổng kết nối và customData"
                  >
                    <span className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 shrink-0" />
                      <span>Sao chép &amp; Dán thông minh</span>
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60">
                      +Cáp
                    </span>
                  </button>
                )}
                {!isReadOnlyMode && onCopyNodesToClipboard && (
                  <button
                    type="button"
                    data-testid="ctx-smart-copy"
                    onClick={() => {
                      onCopyNodesToClipboard(contextNodeIds);
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                    title="Sao chép vào bộ nhớ tạm để dán tại vị trí bất kỳ trên Canvas"
                  >
                    <Copy className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                    <span>Sao chép thông minh ({contextNodeIds.length})</span>
                  </button>
                )}
                {!isReadOnlyMode && onDuplicateNodes && !onSmartCopyPasteNodes && (
                  <button
                    type="button"
                    onClick={() => {
                      onDuplicateNodes(contextNodeIds);
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                  >
                    <Copy className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                    <span>Nhân bản</span>
                  </button>
                )}
                {!isReadOnlyMode && onToggleNodeLock && (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleNodeLock(contextNodeIds);
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                  >
                    {targetNode.locked ? (
                      <Unlock className="w-4 h-4 text-amber-600" />
                    ) : (
                      <Lock className="w-4 h-4 text-amber-600" />
                    )}
                    <span>{targetNode.locked ? 'Mở khóa vị trí' : 'Khóa vị trí'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onOpenDeepInspect(targetNode.assetId || targetNode.id);
                    onSetTouchContextMenu(null);
                  }}
                  className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                >
                  <SlidersHorizontal className="w-4 h-4 text-[#155EEF]" />
                  <span>{isReadOnlyMode ? 'Xem thông số chi tiết' : 'Cấu hình chuyên sâu'}</span>
                </button>
                {!isReadOnlyMode && (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteSelected();
                      onSetTouchContextMenu(null);
                    }}
                    className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 flex items-center gap-2 font-semibold"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Xóa</span>
                  </button>
                )}
              </>
            );
          })() : (() => {
            const targetCable = project.cables.find(c => c.id === touchContextMenu.id);
            if (!targetCable) return null;
            return (
              <>
                <div className="px-2 py-1 text-xs font-bold text-slate-500 truncate border-b border-slate-100 dark:border-slate-800">
                  {targetCable.label || targetCable.cableCode}
                </div>
                {isReadOnlyMode ? (
                  <div className="px-2.5 py-2 text-xs text-slate-600 dark:text-slate-300 space-y-0.5 font-mono tabular-nums">
                    <div>
                      Loại: {targetCable.cableType} ({targetCable.bandwidth})
                    </div>
                    <div>
                      Dài: {targetCable.lengthMeters}m
                      {targetCable.vlan ? ` · VLAN ${targetCable.vlan}` : ''}
                    </div>
                  </div>
                ) : (
                  <>
                    {onAutoRouteCable && (
                      <button
                        type="button"
                        onClick={() => {
                          onAutoRouteCable(targetCable.id);
                          onSetTouchContextMenu(null);
                        }}
                        className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-2 font-semibold"
                      >
                        <Route className="w-4 h-4" />
                        <span>Tự định tuyến tránh vật cản</span>
                      </button>
                    )}
                    {onUpdateCable && (
                      <button
                        type="button"
                        onClick={() => {
                          const geom = getCableGeometry(targetCable);
                          if (geom) onOpenInlineCableLabelEditor(targetCable, geom.midX, geom.midY);
                          onSetTouchContextMenu(null);
                        }}
                        className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-blue-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
                      >
                        <Pencil className="w-4 h-4 text-[#155EEF]" />
                        <span>Sửa nhãn dây cáp</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteSelected();
                        onSetTouchContextMenu(null);
                      }}
                      className="touch-target w-full px-2.5 py-2 rounded-lg text-left hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 flex items-center gap-2 font-semibold"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Xóa dây cáp</span>
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* 2D-Only Minimap Preview & Background Popover (anchored clear above Unified ViewportController) */}
      {(showMinimap || (showBgMenu && onUpdateSettings && !isReadOnlyMode)) && (
        <div
          className="hidden sm:flex absolute bottom-24 right-3 z-20 flex-col items-end gap-2 no-print"
          onPointerDown={e => e.stopPropagation()}
        >
          {showBgMenu && onUpdateSettings && !isReadOnlyMode && (
            <div
              ref={bgPopoverRef}
              className="w-72 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl p-3 space-y-3 text-xs text-slate-800 dark:text-slate-100 z-30"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-xs text-slate-900 dark:text-white">Nền &amp; Kiểu lưới</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Chọn mẫu nền hoặc ảnh mặt bằng</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onSetBgUploadError(null);
                      onUpdateSettings({
                        backgroundPreset: 'classic_light',
                        backgroundColor: '#f8fafc',
                        backgroundPattern: 'dots',
                        backgroundImageUrl: undefined,
                        showGrid: true
                      });
                    }}
                    aria-label="Khôi phục nền mặc định"
                    className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-[#155EEF]"
                    title="Khôi phục nền mặc định"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetShowBgMenu(false)}
                    aria-label="Đóng bảng nền"
                    className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {CANVAS_BACKGROUND_PRESETS.map(preset => {
                  const isActive = canvasAppearance.presetId === preset.id && !canvasAppearance.imageUrl;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          backgroundPreset: preset.id,
                          backgroundColor: preset.backgroundColor,
                          backgroundPattern: preset.pattern,
                          showGrid: true
                        })
                      }
                      className={`p-2 rounded-lg border text-left transition-all flex items-center gap-2 ${
                        isActive
                          ? 'border-[#155EEF] bg-blue-50/70 dark:bg-blue-950/40'
                          : 'border-slate-200 dark:border-slate-700 hover:border-[#155EEF] bg-slate-50/40 dark:bg-slate-800/40'
                      }`}
                      title={preset.subtitle}
                    >
                      <div
                        className="w-6 h-6 rounded-md border border-black/15 shrink-0 flex items-center justify-center relative overflow-hidden"
                        style={{ backgroundColor: preset.backgroundColor }}
                      >
                        {isActive && (
                          <Check className={`w-3.5 h-3.5 relative z-10 ${preset.isDarkSurface ? 'text-white' : 'text-[#155EEF]'}`} />
                        )}
                      </div>
                      <span className="font-semibold text-xs truncate">{preset.name}</span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Kiểu lưới &amp; Màu</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {canvasAppearance.backgroundColor.toUpperCase()}
                    </span>
                    <input
                      type="color"
                      value={canvasAppearance.backgroundColor}
                      onChange={e =>
                        onUpdateSettings({
                          backgroundPreset: 'custom_color',
                          backgroundColor: e.target.value
                        })
                      }
                      className="w-6 h-5 rounded border border-slate-300 dark:border-slate-600 cursor-pointer bg-transparent p-0"
                      title="Chọn màu nền tùy chỉnh"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-4 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                  {(
                    [
                      { id: 'dots', label: 'Chấm' },
                      { id: 'lines', label: 'Ô kẻ' },
                      { id: 'cross', label: 'Dấu +' },
                      { id: 'none', label: 'Trơn' }
                    ] as const
                  ).map(pat => {
                    const activePat = project.settings.showGrid === false ? 'none' : canvasAppearance.pattern;
                    return (
                      <button
                        key={pat.id}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            showGrid: pat.id !== 'none',
                            backgroundPattern: pat.id
                          })
                        }
                        className={`py-1 rounded-md text-xs font-semibold transition-colors ${
                          activePat === pat.id
                            ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {pat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-xs text-slate-600 dark:text-slate-300">
                    Ảnh nền mặt bằng
                  </span>
                  <button
                    type="button"
                    onClick={() => bgFileInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Tải ảnh</span>
                  </button>
                </div>

                {bgUploadError && (
                  <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">{bgUploadError}</div>
                )}

                {canvasAppearance.imageUrl && (
                  <div className="space-y-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Độ rõ ảnh nền</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {Math.round(canvasAppearance.imageOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={Math.round(canvasAppearance.imageOpacity * 100)}
                      onChange={e =>
                        onUpdateSettings({ backgroundImageOpacity: Number(e.target.value) / 100 })
                      }
                      className="w-full accent-[#155EEF]"
                    />
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md p-0.5 text-xs flex-1">
                        <button
                          type="button"
                          onClick={() => onUpdateSettings({ backgroundImageMode: 'cover' })}
                          className={`flex-1 py-0.5 rounded font-semibold ${
                            canvasAppearance.imageMode === 'cover' ? 'bg-[#155EEF] text-white' : 'text-slate-500'
                          }`}
                        >
                          Phủ khung
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateSettings({ backgroundImageMode: 'world' })}
                          className={`flex-1 py-0.5 rounded font-semibold ${
                            canvasAppearance.imageMode === 'world' ? 'bg-[#155EEF] text-white' : 'text-slate-500'
                          }`}
                        >
                          Tỷ lệ 1:1
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ backgroundImageUrl: undefined })}
                        className="px-2 py-1 rounded-md border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold"
                      >
                        Xóa ảnh
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {showMinimap && (
            <div className="bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-1.5 backdrop-blur-xs">
              <svg
                width="164"
                height="108"
                viewBox={`${minimapBounds.minX} ${minimapBounds.minY} ${minimapBounds.width} ${minimapBounds.height}`}
                aria-label="Bản đồ thu nhỏ sơ đồ"
                className="bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200/80 dark:border-slate-800 cursor-pointer"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratioX = (e.clientX - rect.left) / rect.width;
                  const ratioY = (e.clientY - rect.top) / rect.height;
                  const targetX = minimapBounds.minX + ratioX * minimapBounds.width;
                  const targetY = minimapBounds.minY + ratioY * minimapBounds.height;
                  onPanChange({
                    x: Math.round(viewportSize.w / 2 - targetX * zoom),
                    y: Math.round(viewportSize.h / 2 - targetY * zoom)
                  });
                }}
              >
                {visibleRooms.map(r => (
                  <rect
                    key={`mm_r_${r.id}`}
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    fill="#cbd5e1"
                    fillOpacity="0.45"
                    stroke="#94a3b8"
                    strokeWidth={Math.max(4, minimapBounds.width / 120)}
                  />
                ))}
                {visibleNodes.map(n => (
                  <rect
                    key={`mm_n_${n.id}`}
                    x={n.x}
                    y={n.y}
                    width={Math.max(24, n.width)}
                    height={Math.max(18, n.height)}
                    fill={
                      overlappingNodeIds.has(n.id)
                        ? '#ef4444'
                        : selectedNodeIdSet.has(n.id)
                        ? '#155EEF'
                        : n.type === 'rack'
                        ? '#0f172a'
                        : '#38bdf8'
                    }
                    rx="4"
                  />
                ))}
                <rect
                  x={-pan.x / zoom}
                  y={-pan.y / zoom}
                  width={viewportSize.w / zoom}
                  height={viewportSize.h / zoom}
                  fill="#155EEF"
                  fillOpacity="0.08"
                  stroke="#155EEF"
                  strokeWidth={Math.max(6, minimapBounds.width / 90)}
                />
              </svg>
            </div>
          )}
        </div>
      )}
    </>
  );
};
