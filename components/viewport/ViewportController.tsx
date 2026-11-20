import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  ImageDown,
  Layers,
  Loader2,
  Lock,
  Map as MapIcon,
  Maximize,
  Maximize2,
  Minimize2,
  RotateCcw,
  Unlock,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { CanvasLayerId, ProjectState } from '../../types/infrastructure';
import { useViewport } from '../../contexts/ViewportContext';
import { useFloatingPanel } from '../../hooks/useFloatingPanel';
import { LayerPanel } from '../layers/LayerPanel';
import type { CADDocument } from '../../cad/core/CADTypes';

interface ViewportControllerProps {
  containerRef: React.RefObject<HTMLElement | null>;
  project: ProjectState;
  zoom2D: number;
  isReadOnlyMode?: boolean;
  isZenMode: boolean;
  onToggleZenMode: () => void;
  isAiAvailable?: boolean;
  isAiChatOpen?: boolean;
  onToggleAiChat?: () => void;
  isQuickExporting?: boolean;
  onQuickExportPng: () => void;
  showBgMenu: boolean;
  onToggleBgMenu: () => void;
  onCloseBgMenu: () => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  onToggleLayerVisibility: (layer: CanvasLayerId) => void;
  onToggleLayerLock?: (layer: CanvasLayerId) => void;
  onSelectLayerObjects?: (layer: CanvasLayerId) => void;
  onAutoLayerDevices?: () => void;
  onToggleAutoLayering?: () => void;
  onUpdateSettings?: (partial: Partial<ProjectState['settings']>) => void;
  onOpenMobileLayers?: () => void;
  cadDocument?: CADDocument | null;
  onToggleCadUnderlayEnabled?: () => void;
  onChangeCadUnderlayOpacity?: (opacity: number) => void;
  onToggleCadUnderlay3D?: () => void;
  onToggleCadLayerVisible?: (layerName: string) => void;
  onToggleCadLayerLocked?: (layerName: string) => void;
  onLockAllCadLayers?: (lock: boolean) => void;
  onSyncScaleFromCad?: () => void;
  onOpenCadStudio?: () => void;
}

export const ViewportController: React.FC<ViewportControllerProps> = ({
  containerRef,
  project,
  zoom2D,
  isReadOnlyMode = false,
  isZenMode,
  onToggleZenMode,
  isAiAvailable = false,
  isAiChatOpen = false,
  onToggleAiChat,
  isQuickExporting = false,
  onQuickExportPng,
  showBgMenu,
  onToggleBgMenu,
  onCloseBgMenu,
  showMinimap,
  onToggleMinimap,
  onToggleLayerVisibility,
  onToggleLayerLock,
  onSelectLayerObjects,
  onAutoLayerDevices,
  onToggleAutoLayering,
  onUpdateSettings,
  onOpenMobileLayers,
  cadDocument,
  onToggleCadUnderlayEnabled,
  onChangeCadUnderlayOpacity,
  onToggleCadUnderlay3D,
  onToggleCadLayerVisible,
  onToggleCadLayerLocked,
  onLockAllCadLayers,
  onSyncScaleFromCad,
  onOpenCadStudio
}) => {
  const {
    is3DView,
    setMode,
    toggleMode,
    is3DDragLocked,
    setIs3DDragLocked,
    isFullscreen,
    toggleFullscreen,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToScreen,
    view3DOptions,
    setView3DOptions,
    isCapturing3D
  } = useViewport();

  const [showLayersPopover, setShowLayersPopover] = useState(false);
  const layersPopoverWrapRef = useRef<HTMLDivElement>(null);

  const panel = useFloatingPanel({
    containerRef,
    storageKey: 'hachihi:unified-viewport-panel',
    defaultCollapsed: false
  });

  // Close layers popover on Escape (capture phase so canvas doesn't lose selection) or outside click
  useEffect(() => {
    if (!showLayersPopover) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setShowLayersPopover(false);
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (
        panel.panelRef.current &&
        !panel.panelRef.current.contains(e.target as Node)
      ) {
        setShowLayersPopover(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [showLayersPopover, panel.panelRef]);

  // Close 2D-only background popover automatically when entering 3D
  useEffect(() => {
    if (is3DView && showBgMenu) {
      onCloseBgMenu();
    }
  }, [is3DView, showBgMenu, onCloseBgMenu]);

  const hostW = containerRef.current?.clientWidth || 1200;
  const hostH = containerRef.current?.clientHeight || 720;
  const popoverOpenDown = Boolean(panel.position && panel.position.y < hostH * 0.45);
  const popoverAlignLeft = Boolean(panel.position && panel.position.x < hostW * 0.45);
  const popoverPosClass = `${popoverOpenDown ? 'top-full mt-2' : 'bottom-full mb-2'} ${
    popoverAlignLeft ? 'left-0' : 'right-0'
  }`;

  const layerBadgeCount =
    (project.settings.hiddenLayers?.length || 0) + (project.settings.lockedLayers?.length || 0);
  const busyPngExport = isQuickExporting || isCapturing3D;

  return (
    <>
      {/* Desktop & Tablet Unified Viewport Controller (>= 768px) */}
      <div
        ref={panel.panelRef}
        data-testid="unified-viewport-controller"
        style={
          panel.position
            ? { left: `${panel.position.x}px`, top: `${panel.position.y}px` }
            : undefined
        }
        className={`hidden md:flex absolute z-20 flex-col gap-2 no-print ${
          panel.position
            ? popoverAlignLeft
              ? 'items-start'
              : 'items-end'
            : 'bottom-3 right-3 items-end'
        }`}
        onPointerDown={e => e.stopPropagation()}
      >
        {panel.collapsed ? (
          <div className="flex items-center gap-1 h-9 px-2 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-lg text-xs">
            <button
              type="button"
              data-testid="viewport-drag-handle"
              onPointerDown={panel.handleDragStart}
              onDoubleClick={panel.resetPosition}
              title="Kéo để di chuyển thanh điều khiển · Nhấp đúp về góc dưới phải"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              data-testid="viewport-collapse-btn"
              onClick={panel.toggleCollapsed}
              title="Mở rộng thanh điều khiển khung nhìn"
              className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <span className="font-mono tabular-nums text-[#155EEF] dark:text-blue-400">
                {is3DView ? '3D' : `${Math.round(zoom2D * 100)}%`}
              </span>
              <span>Điều khiển</span>
              <Maximize2 className="w-3 h-3 text-slate-400 shrink-0" />
            </button>

            {is3DView && (
              <button
                type="button"
                data-testid="toggle-3d-drag-lock-btn"
                onClick={() => setIs3DDragLocked(v => !v)}
                aria-pressed={!is3DDragLocked}
                aria-label={
                  is3DDragLocked
                    ? 'Đang khóa di chuyển 3D · Nhấn để mở khóa kéo thả đối tượng'
                    : 'Đang mở khóa kéo thả 3D · Nhấn để khóa lại'
                }
                className={`h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  is3DDragLocked
                    ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                    : 'border-emerald-300 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                }`}
              >
                {is3DDragLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                <span>{is3DDragLocked ? 'Khóa kéo 3D' : 'Mở khóa'}</span>
              </button>
            )}

            <button
              type="button"
              data-testid="toggle-3d-btn"
              onClick={toggleMode}
              aria-pressed={is3DView}
              aria-label={
                is3DView ? 'Chuyển đổi 2D / 3D (đang ở 3D)' : 'Chuyển đổi 2D / 3D (đang ở 2D)'
              }
              className="h-7 px-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:border-[#155EEF]/70 flex items-center font-mono text-[11px] tracking-tight whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <span
                data-testid="toggle-3d-label-2d"
                className={
                  !is3DView
                    ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100'
                    : 'font-medium text-slate-400 dark:text-slate-500 opacity-45'
                }
              >
                2D
              </span>
              <span className="mx-1 text-slate-300 dark:text-slate-600 font-normal">/</span>
              <span
                data-testid="toggle-3d-label-3d"
                className={
                  is3DView
                    ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100'
                    : 'font-medium text-slate-400 dark:text-slate-500 opacity-45'
                }
              >
                3D
              </span>
            </button>
          </div>
        ) : (
          <>
            {/* Quick Export PNG (2D & 3D) & AI Assistant Row */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="quick-export-png-fab"
                disabled={busyPngExport}
                onClick={onQuickExportPng}
                aria-label={
                  is3DView
                    ? 'Quick Export: Chụp góc nhìn 3D hiện tại thành ảnh PNG'
                    : 'Quick Export: Xuất góc nhìn hiện tại thành ảnh PNG nền trắng'
                }
                title={
                  is3DView
                    ? 'Quick Export 3D — Chụp ngay góc nhìn 3D WebGL hiện tại thành ảnh PNG nét cao'
                    : 'Quick Export 2D — Xuất ngay góc nhìn hiện tại ra ảnh PNG nền trắng'
                }
                className="touch-target h-9 px-3 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-slate-800 dark:text-slate-100 shadow-lg flex items-center gap-1.5 text-xs font-semibold transition-all disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
              >
                {busyPngExport ? (
                  <Loader2 className="w-4 h-4 text-[#155EEF] animate-spin shrink-0" />
                ) : (
                  <ImageDown className="w-4 h-4 text-[#155EEF] shrink-0" />
                )}
                <span>
                  {busyPngExport
                    ? is3DView
                      ? 'Đang chụp 3D...'
                      : 'Đang xuất PNG...'
                    : is3DView
                    ? 'Chụp PNG 3D'
                    : 'Quick Export PNG'}
                </span>
              </button>

              {isAiAvailable && onToggleAiChat && (
                <button
                  type="button"
                  data-testid="chatbot-fab"
                  onClick={onToggleAiChat}
                  aria-label={isAiChatOpen ? 'Đóng Trợ lý AI' : 'Mở Trợ lý kỹ thuật AI'}
                  aria-pressed={isAiChatOpen}
                  title={
                    isAiChatOpen
                      ? 'Đang mở Trợ lý AI · Nhấn để thu gọn'
                      : 'Mở Chatbot Trợ lý kỹ thuật hạ tầng'
                  }
                  className={`touch-target h-9 px-3 rounded-xl shadow-lg flex items-center gap-1.5 text-xs font-semibold transition-all whitespace-nowrap border ${
                    isAiChatOpen
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-800 dark:border-slate-200'
                      : 'bg-[#155EEF] hover:bg-[#124CC7] text-white border-[#124CC7]'
                  }`}
                >
                  <Bot className="w-4 h-4 shrink-0" />
                  <span>{isAiChatOpen ? 'Đang mở Trợ lý' : 'Trợ lý AI'}</span>
                </button>
              )}
            </div>

            {/* Unified Viewport Control Bar */}
            <div
              ref={layersPopoverWrapRef}
              className="relative flex items-center gap-0.5 h-9 px-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-800 shadow-lg text-xs"
            >
              {/* Drag Handle */}
              <button
                type="button"
                data-testid="viewport-drag-handle"
                onPointerDown={panel.handleDragStart}
                onDoubleClick={panel.resetPosition}
                title="Kéo để di chuyển thanh điều khiển · Nhấp đúp về góc mặc định"
                className="h-7 px-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>

              {/* Unified LayerPanel Popover */}
              {showLayersPopover && (
                <div className={`absolute ${popoverPosClass} z-30 max-w-[calc(100vw-1.5rem)]`}>
                  <LayerPanel
                    project={project}
                    is3DView={is3DView}
                    isReadOnlyMode={isReadOnlyMode}
                    onToggleLayerVisibility={onToggleLayerVisibility}
                    onToggleLayerLock={onToggleLayerLock}
                    onSelectLayerObjects={onSelectLayerObjects}
                    onAutoLayerDevices={onAutoLayerDevices}
                    onToggleAutoLayering={onToggleAutoLayering}
                    onUpdateSettings={onUpdateSettings}
                    view3DOptions={view3DOptions}
                    onChangeView3DOptions={setView3DOptions}
                    onClose={() => setShowLayersPopover(false)}
                    cadDocument={cadDocument}
                    onToggleCadUnderlayEnabled={onToggleCadUnderlayEnabled}
                    onChangeCadUnderlayOpacity={onChangeCadUnderlayOpacity}
                    onToggleCadUnderlay3D={onToggleCadUnderlay3D}
                    onToggleCadLayerVisible={onToggleCadLayerVisible}
                    onToggleCadLayerLocked={onToggleCadLayerLocked}
                    onLockAllCadLayers={onLockAllCadLayers}
                    onSyncScaleFromCad={onSyncScaleFromCad}
                    onOpenCadStudio={onOpenCadStudio}
                  />
                </div>
              )}

              {/* 1. Shared Lớp Trigger (preserving aria-label for E2E) */}
              <button
                type="button"
                onClick={() => {
                  setShowLayersPopover(prev => !prev);
                  if (showBgMenu) onCloseBgMenu();
                }}
                aria-label="Quản lý lớp hiển thị & khóa"
                aria-expanded={showLayersPopover}
                className={`h-7 px-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap ${
                  showLayersPopover
                    ? 'bg-[#155EEF] text-white'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Quản lý lớp hiển thị & khóa (đồng bộ 2D & 3D)"
              >
                <Layers className={`w-3.5 h-3.5 ${showLayersPopover ? 'text-white' : 'text-[#155EEF]'}`} />
                <span>Lớp</span>
                {layerBadgeCount > 0 && (
                  <span
                    className={`text-[11px] font-mono tabular-nums ${
                      showLayersPopover ? 'text-blue-100' : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    ({layerBadgeCount})
                  </span>
                )}
              </button>

              {/* 2. 2D-only Nền (dimmed & disabled in 3D) */}
              <button
                type="button"
                disabled={is3DView || isReadOnlyMode}
                onClick={() => {
                  setShowLayersPopover(false);
                  onToggleBgMenu();
                }}
                aria-expanded={!is3DView && showBgMenu}
                className={`h-7 px-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed ${
                  !is3DView && showBgMenu
                    ? 'bg-[#155EEF] text-white'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={
                  is3DView
                    ? 'Nền mặt bằng & lưới 2D không khả dụng trong chế độ 3D'
                    : isReadOnlyMode
                    ? 'Không thể đổi nền ở chế độ Chỉ xem'
                    : 'Chọn màu nền, kiểu lưới & ảnh mặt bằng 2D'
                }
              >
                <ImageIcon
                  className={`w-3.5 h-3.5 ${!is3DView && showBgMenu ? 'text-white' : 'text-[#155EEF]'}`}
                />
                <span>Nền</span>
              </button>

              {/* 3. 2D-only Bản đồ thu nhỏ (dimmed & disabled in 3D) */}
              <button
                type="button"
                disabled={is3DView}
                onClick={onToggleMinimap}
                aria-label={showMinimap ? 'Ẩn bản đồ thu nhỏ' : 'Hiện bản đồ thu nhỏ'}
                aria-pressed={!is3DView && showMinimap}
                className={`h-7 px-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed ${
                  !is3DView && showMinimap
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-[#155EEF] dark:text-blue-300'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={
                  is3DView
                    ? 'Bản đồ thu nhỏ 2D không khả dụng trong chế độ 3D'
                    : 'Bật / tắt bản đồ thu nhỏ 2D'
                }
              >
                <MapIcon className="w-3.5 h-3.5 text-[#155EEF]" />
                <span className="hidden lg:inline">Bản đồ</span>
              </button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* 4. Shared Zoom & Fit Controls */}
              <button
                type="button"
                onClick={zoomOut}
                aria-label="Thu nhỏ"
                className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={is3DView ? 'Thu nhỏ camera 3D' : 'Thu nhỏ bản vẽ (Ctrl+-)'}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={resetZoom}
                className="h-7 px-1.5 rounded-lg font-mono text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
                title={is3DView ? 'Đặt lại góc camera 3D Isometric' : 'Đặt lại tỷ lệ 100% (Ctrl+0)'}
              >
                {is3DView ? (
                  <>
                    <RotateCcw className="w-3 h-3 text-[#155EEF]" />
                    <span className="hidden xl:inline">100%</span>
                  </>
                ) : (
                  <span>{Math.round(zoom2D * 100)}%</span>
                )}
              </button>

              <button
                type="button"
                onClick={zoomIn}
                aria-label="Phóng to"
                className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={is3DView ? 'Phóng to camera 3D' : 'Phóng to bản vẽ (Ctrl+=)'}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={fitToScreen}
                aria-label="Thu gọn vừa khung nhìn"
                className="h-7 px-2 rounded-lg flex items-center gap-1 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors whitespace-nowrap"
                title="Thu gọn toàn bộ mô hình vừa khung nhìn"
              >
                <Maximize className="w-3.5 h-3.5 text-[#155EEF]" />
                <span className="hidden xl:inline">Vừa khung</span>
              </button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* 5. Shared Zen Mode & Fullscreen */}
              <button
                type="button"
                onClick={onToggleZenMode}
                aria-label={isZenMode ? 'Hiện thanh công cụ bên' : 'Chế độ tập trung'}
                aria-pressed={isZenMode}
                className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${
                  isZenMode
                    ? 'bg-[#155EEF] text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={isZenMode ? 'Hiện lại thanh công cụ bên' : 'Chế độ tập trung (Zen)'}
              >
                {isZenMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
                aria-pressed={isFullscreen}
                className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${
                  isFullscreen
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-[#155EEF] dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
              >
                {isFullscreen ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

              {/* 6. 3D Drag Lock (3D-only, directly left of 2D / 3D toggle) */}
              {is3DView && (
                <button
                  type="button"
                  data-testid="toggle-3d-drag-lock-btn"
                  onClick={() => setIs3DDragLocked(v => !v)}
                  aria-pressed={!is3DDragLocked}
                  aria-label={
                    is3DDragLocked
                      ? 'Đang khóa di chuyển 3D · Nhấn để mở khóa kéo thả đối tượng'
                      : 'Đang mở khóa kéo thả 3D · Nhấn để khóa lại'
                  }
                  title={
                    is3DDragLocked
                      ? 'Mặc định đang khóa kéo thả trong 3D · Nhấn để mở khóa và kéo thả đối tượng'
                      : 'Đang cho phép kéo thả đối tượng trong 3D · Nhấn để khóa lại'
                  }
                  className={`h-7 px-2 rounded-lg border flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    is3DDragLocked
                      ? 'border-amber-300 dark:border-amber-700/80 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                      : 'border-emerald-300 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                  }`}
                >
                  {is3DDragLocked ? (
                    <>
                      <Lock className="w-3 h-3 shrink-0" />
                      <span>Khóa kéo 3D</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3 h-3 shrink-0" />
                      <span>Mở khóa</span>
                    </>
                  )}
                </button>
              )}

              {/* 7. Unified 2D / 3D Switch */}
              <button
                type="button"
                data-testid="toggle-3d-btn"
                onClick={toggleMode}
                aria-pressed={is3DView}
                aria-label={
                  is3DView ? 'Chuyển đổi 2D / 3D (đang ở 3D)' : 'Chuyển đổi 2D / 3D (đang ở 2D)'
                }
                title={
                  is3DView
                    ? 'Đang ở chế độ Mô hình 3D · Nhấn để chuyển về 2D CAD'
                    : 'Đang ở chế độ 2D CAD · Nhấn để chuyển sang Mô hình 3D'
                }
                className="h-7 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:border-[#155EEF]/70 dark:hover:border-blue-500/70 flex items-center font-mono text-[11px] tracking-tight whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <span
                  data-testid="toggle-3d-label-2d"
                  className={
                    !is3DView
                      ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100'
                      : 'font-medium text-slate-400 dark:text-slate-500 opacity-45'
                  }
                >
                  2D
                </span>
                <span className="mx-1 text-slate-300 dark:text-slate-600 font-normal">/</span>
                <span
                  data-testid="toggle-3d-label-3d"
                  className={
                    is3DView
                      ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100'
                      : 'font-medium text-slate-400 dark:text-slate-500 opacity-45'
                  }
                >
                  3D
                </span>
              </button>

              {/* Collapse Bar */}
              <button
                type="button"
                data-testid="viewport-collapse-btn"
                onClick={panel.toggleCollapsed}
                title="Thu gọn thanh điều khiển khung nhìn"
                className="h-7 px-1.5 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Narrow Mobile 3D Floating Action Pill (< 768px when in 3D) */}
      {is3DView && (
        <div
          onPointerDown={e => e.stopPropagation()}
          className="md:hidden fixed bottom-[104px] right-3 z-30 flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-xl text-xs no-print"
        >
          {onOpenMobileLayers && (
            <button
              type="button"
              onClick={onOpenMobileLayers}
              aria-label="Lớp hiển thị"
              className="h-8 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1 font-medium"
            >
              <Layers className="w-3.5 h-3.5 text-[#155EEF]" />
              <span>Lớp</span>
            </button>
          )}
          <button
            type="button"
            disabled={busyPngExport}
            onClick={onQuickExportPng}
            aria-label="Chụp ảnh PNG 3D"
            className="h-8 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1 font-medium disabled:opacity-50"
          >
            {busyPngExport ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#155EEF]" />
            ) : (
              <ImageDown className="w-3.5 h-3.5 text-[#155EEF]" />
            )}
            <span>PNG</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('2d')}
            aria-label="Về 2D CAD"
            className="h-8 px-2.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold flex items-center gap-1 whitespace-nowrap"
          >
            <span>Về 2D CAD</span>
          </button>
        </div>
      )}
    </>
  );
};
