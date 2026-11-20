import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileSpreadsheet,
  GitBranch,
  Hand,
  History,
  MousePointer,
  Network,
  Plus,
  Radio,
  Redo2,
  RotateCcw,
  Route,
  Ruler,
  Save,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Undo2,
  Video,
  Wand2,
  Zap
} from 'lucide-react';
import { ProjectState } from '../../types/infrastructure';
import { CanvasTool } from '../../store/useProjectStore';
import { RecentActionEntry, formatRecentActionAge } from '../../utils/recentActions';
import {
  ShortcutActionId,
  ShortcutKeymap,
  formatShortcutDisplay,
  getDefaultShortcutKeymap
} from '../../hooks/useKeyboardShortcuts';

interface QuickAccessBarProps {
  project: ProjectState;
  activeTool: CanvasTool;
  keymap?: ShortcutKeymap;
  canUndo: boolean;
  canRedo: boolean;
  hasUnsavedChanges: boolean;
  isSaving?: boolean;
  is3DView: boolean;
  is3DDragLocked?: boolean;
  isReadOnlyMode: boolean;
  recentActions: RecentActionEntry[];
  onSetTool: (tool: CanvasTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveNow: () => void;
  onAddDeviceFocus?: () => void;
  onOpenExcelTree: () => void;
  onAutoRouteAllCables: () => void;
  onAutoAssignIps: () => void;
  onAddRack?: () => void;
  onOpenPowerTab?: () => void;
  onToggleCoverageOverlay?: () => void;
  onToggleReadOnly?: () => void;
  onAutoLayerDevices: () => void;
  onReplayRecentAction: (entry: RecentActionEntry) => void;
  onClearRecentActions: () => void;
  experienceMode?: 'basic' | 'advanced';
  onToggleExperienceMode?: (mode: 'basic' | 'advanced') => void;
}

export const QuickAccessBar: React.FC<QuickAccessBarProps> = React.memo(({
  project,
  activeTool,
  keymap,
  canUndo,
  canRedo,
  hasUnsavedChanges,
  isSaving = false,
  is3DView,
  is3DDragLocked = true,
  isReadOnlyMode,
  recentActions,
  onSetTool,
  onUndo,
  onRedo,
  onSaveNow,
  onAddDeviceFocus,
  onOpenExcelTree,
  onAutoRouteAllCables,
  onAutoAssignIps,
  onAddRack,
  onOpenPowerTab,
  onToggleCoverageOverlay,
  onToggleReadOnly,
  onAutoLayerDevices,
  onReplayRecentAction,
  onClearRecentActions,
  experienceMode,
  onToggleExperienceMode
}) => {
  const activeKeymap = keymap || getDefaultShortcutKeymap();
  const resolvedExperienceMode = experienceMode ?? project.settings?.experienceMode ?? 'advanced';
  const isBasicMode = resolvedExperienceMode === 'basic';
  const [openMenu, setOpenMenu] = useState<'more' | null>(null);
  const [showRecentInMore, setShowRecentInMore] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  const cableCount = project.cables.length;
  const deviceCount = project.nodes.length;

  const btnBase =
    'h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors disabled:opacity-35 disabled:cursor-not-allowed';
  const btnGhost = `${btnBase} text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800`;
  const groupTitleCls =
    'px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500';
  const moreItemCls =
    'w-full px-3 py-1.5 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-2 transition-colors disabled:opacity-35 disabled:cursor-not-allowed';

  const coreTools: Array<{
    id: CanvasTool;
    actionId: ShortcutActionId;
    label: string;
    shortcut: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'select', actionId: 'tool_select', label: 'Chọn', shortcut: formatShortcutDisplay(activeKeymap.tool_select), icon: MousePointer },
    { id: 'pan', actionId: 'tool_pan', label: 'Kéo', shortcut: formatShortcutDisplay(activeKeymap.tool_pan), icon: Hand },
    { id: 'connect', actionId: 'tool_connect', label: 'Nối dây', shortcut: formatShortcutDisplay(activeKeymap.tool_connect), icon: GitBranch },
    { id: 'room', actionId: 'tool_room', label: 'Phòng', shortcut: formatShortcutDisplay(activeKeymap.tool_room), icon: Square },
    { id: 'tray', actionId: 'tool_tray', label: 'Máng cáp', shortcut: formatShortcutDisplay(activeKeymap.tool_tray), icon: Route },
    { id: 'text', actionId: 'tool_text', label: 'Chữ', shortcut: formatShortcutDisplay(activeKeymap.tool_text), icon: Type },
    { id: 'measure', actionId: 'tool_measure', label: 'Đo', shortcut: formatShortcutDisplay(activeKeymap.tool_measure), icon: Ruler }
  ];

  const undoShortcutLabel = formatShortcutDisplay(activeKeymap.undo);
  const redoShortcutLabel = formatShortcutDisplay(activeKeymap.redo);
  const saveShortcutLabel = formatShortcutDisplay(activeKeymap.save);
  const rackShortcutLabel = formatShortcutDisplay(activeKeymap.tool_rack);
  const autoIpShortcutLabel = formatShortcutDisplay(activeKeymap.auto_assign_ip);
  const autoRouteShortcutLabel = formatShortcutDisplay(activeKeymap.auto_route);

  return (
    <div
      ref={barRef}
      className="h-11 bg-slate-50/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between gap-2 select-none shrink-0 relative z-20 no-print"
      aria-label="Thanh công cụ thao tác nhanh"
    >
      {/* Left: Frequent Drawing Tools · Undo/Redo · Save · Fit · Layers · Thêm thiết bị · Adaptive Mode Actions */}
      <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
        {/* Core Drawing Tools */}
        <div className="flex items-center gap-0.5 bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-0.5 shrink-0">
          {coreTools.map(tool => {
            const Icon = tool.icon;
            const supportsUnlocked3D = tool.id === 'select' || tool.id === 'pan' || tool.id === 'connect';
            const unlockedIn3D = is3DView && !is3DDragLocked && supportsUnlocked3D;
            const active = activeTool === tool.id && (!is3DView || unlockedIn3D);
            const disabled =
              (is3DView && !unlockedIn3D) ||
              (isReadOnlyMode &&
                tool.id !== 'select' &&
                tool.id !== 'pan' &&
                tool.id !== 'measure');
            return (
              <button
                key={tool.id}
                type="button"
                disabled={disabled}
                onClick={() => onSetTool(tool.id)}
                aria-pressed={active}
                aria-label={`${tool.label} (${tool.shortcut})`}
                title={
                  is3DView && !unlockedIn3D
                    ? `${tool.label} — ${
                        supportsUnlocked3D
                          ? 'Mở khóa kéo 3D để sử dụng trực tiếp trong 3D'
                          : 'Công cụ này chỉ khả dụng trong chế độ 2D CAD'
                      }`
                    : `${tool.label} (${tool.shortcut})`
                }
                className={`h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                  active
                    ? 'bg-[#155EEF] text-white font-semibold shadow-2xs'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline">{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 shrink-0 pl-0.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo || isReadOnlyMode}
            aria-label={`Hoàn tác (${undoShortcutLabel})`}
            title={`Hoàn tác (${undoShortcutLabel})`}
            className="h-7 w-7 rounded-md flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo || isReadOnlyMode}
            aria-label={`Làm lại (${redoShortcutLabel})`}
            title={`Làm lại (${redoShortcutLabel})`}
            className="h-7 w-7 rounded-md flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Lưu */}
        <button
          type="button"
          onClick={onSaveNow}
          disabled={isSaving}
          className={`${btnBase} ${
            hasUnsavedChanges
              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          title={`Lưu dự án ngay (${saveShortcutLabel})`}
        >
          <Save className={`w-3.5 h-3.5 shrink-0 ${hasUnsavedChanges ? 'text-amber-600' : 'text-[#16A34A]'}`} />
          <span className="hidden lg:inline">Lưu</span>
        </button>

        {/* Thêm thiết bị (focus library search / open drawer) */}
        {onAddDeviceFocus && !isReadOnlyMode && (
          <button
            type="button"
            disabled={is3DView && is3DDragLocked}
            onClick={onAddDeviceFocus}
            className="h-7 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 bg-[#155EEF]/10 hover:bg-[#155EEF]/15 text-[#155EEF] dark:text-blue-300 border border-[#155EEF]/25 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
            title={
              is3DView && is3DDragLocked
                ? 'Mở khóa kéo 3D để thêm thiết bị từ thư viện'
                : is3DView
                ? 'Tìm và thêm thiết bị vào không gian 3D (Ctrl+F)'
                : 'Tìm và thêm thiết bị từ thư viện bên trái (Ctrl+F)'
            }
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>Thêm thiết bị</span>
          </button>
        )}

        {/* Adaptive Contextual Action by Active Mode (lean, hidden in Basic Mode) */}
        {!isBasicMode && (
          <>
            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0" />

            {project.activeMode === 'topology' && (
              <button
                type="button"
                onClick={onAutoAssignIps}
                disabled={isReadOnlyMode || deviceCount === 0}
                className={btnGhost}
                title={`Tự động gán địa chỉ IP theo cây kết nối (${autoIpShortcutLabel})`}
              >
                <Network className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>Tự gán IP</span>
              </button>
            )}

            {project.activeMode === 'cctv' && onToggleCoverageOverlay && (
              <button
                type="button"
                onClick={onToggleCoverageOverlay}
                aria-pressed={project.settings.showCoverageRadius}
                className={`${btnBase} ${
                  project.settings.showCoverageRadius
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Bật/tắt góc quan sát Camera (FOV) trên cả 2D & 3D"
              >
                <Video className="w-3.5 h-3.5 shrink-0" />
                <span>Góc FOV</span>
              </button>
            )}

            {project.activeMode === 'wifi' && onToggleCoverageOverlay && (
              <button
                type="button"
                onClick={onToggleCoverageOverlay}
                aria-pressed={project.settings.showCoverageRadius}
                className={`${btnBase} ${
                  project.settings.showCoverageRadius
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Bật/tắt vùng phủ sóng Wi-Fi trên cả 2D & 3D"
              >
                <Radio className="w-3.5 h-3.5 shrink-0" />
                <span>Sóng Wi-Fi</span>
              </button>
            )}

            {project.activeMode === 'floorplan' && onToggleCoverageOverlay && (
              <button
                type="button"
                onClick={onToggleCoverageOverlay}
                aria-pressed={project.settings.showCoverageRadius}
                className={`${btnBase} ${
                  project.settings.showCoverageRadius
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Bật/tắt vùng phủ sóng Wi-Fi & góc Camera FOV trên 2D & 3D"
              >
                <Radio className="w-3.5 h-3.5 shrink-0" />
                <span>Vùng phủ</span>
              </button>
            )}

            {project.activeMode === 'rack' && onAddRack && (
              <button
                type="button"
                onClick={onAddRack}
                disabled={isReadOnlyMode}
                className={btnGhost}
                title={`Thêm tủ Rack 42U mới (${rackShortcutLabel})`}
              >
                <Box className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
                <span>Thêm Rack 42U</span>
              </button>
            )}

            {project.activeMode === 'electrical' && onOpenPowerTab && (
              <button
                type="button"
                onClick={onOpenPowerTab}
                className={btnGhost}
                title="Mở bảng tính phụ tải PoE, Điện AC & UPS"
              >
                <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Tính tải PoE/UPS</span>
              </button>
            )}

            {/* Single Adaptive Cable Routing Button across modes */}
            <button
              type="button"
              onClick={onAutoRouteAllCables}
              disabled={isReadOnlyMode || cableCount === 0}
              className={btnGhost}
              title={
                project.activeMode === 'electrical'
                  ? `Định tuyến cáp nguồn & tín hiệu tránh vật cản (${autoRouteShortcutLabel})`
                  : project.activeMode === 'cctv'
                  ? `Định tuyến dây Camera tránh tường (${autoRouteShortcutLabel})`
                  : `Tự định tuyến toàn bộ tuyến cáp theo chế độ hiện tại (${autoRouteShortcutLabel})`
              }
            >
              <Route className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
              <span>Định tuyến cáp</span>
            </button>
          </>
        )}
      </div>

      {/* Right: Basic / Advanced Switch + Nâng cao (Consolidated Engineering Popover) */}
      <div className="flex items-center gap-1.5 shrink-0 relative">
        {onToggleExperienceMode && (
          <div
            role="group"
            aria-label="Chế độ giao diện làm việc"
            className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/70 p-0.5 gap-0.5 shrink-0"
          >
            <button
              type="button"
              data-testid="experience-mode-basic"
              aria-pressed={isBasicMode}
              onClick={() => onToggleExperienceMode('basic')}
              title="Chế độ Cơ bản: chỉ giữ công cụ vẽ, nối dây và thông số thiết yếu"
              className={`h-6 px-2 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                isBasicMode
                  ? 'bg-[#155EEF] text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Cơ bản
            </button>
            <button
              type="button"
              data-testid="experience-mode-advanced"
              aria-pressed={!isBasicMode}
              onClick={() => onToggleExperienceMode('advanced')}
              title="Chế độ Kỹ sư: mở đầy đủ IP/VLAN, PoE/UPS, Tủ Rack & tự động hóa"
              className={`h-6 px-2 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                !isBasicMode
                  ? 'bg-[#155EEF] text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Kỹ sư
            </button>
          </div>
        )}

        {/* Nâng cao Popover — 6 Clear Engineering Groups (shown in Kỹ sư mode) */}
        {!isBasicMode && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu(prev => (prev === 'more' ? null : 'more'))}
            aria-expanded={openMenu === 'more'}
            className={`${btnBase} ${
              openMenu === 'more'
                ? 'bg-blue-50 dark:bg-blue-950/60 text-[#155EEF] dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Công cụ nâng cao: Tự động hóa, Camera, Điện, Excel, Hiển thị & Tiện ích"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span>Nâng cao</span>
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </button>

          {openMenu === 'more' && (
            <div className="absolute right-0 top-full mt-1.5 w-72 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl py-1.5 z-40 max-h-[78dvh] overflow-y-auto">
              {/* 1. TỰ ĐỘNG HÓA (còn lại ngoài nút chính) */}
              <div className={groupTitleCls}>Tự động hóa</div>
              <button
                type="button"
                disabled={isReadOnlyMode}
                onClick={() => {
                  setOpenMenu(null);
                  onAutoLayerDevices();
                }}
                className={moreItemCls}
              >
                <span className="flex items-center gap-2">
                  <Wand2 className="w-3.5 h-3.5 text-teal-600" />
                  <span>Tự phân lớp thiết bị</span>
                </span>
              </button>
              {project.activeMode !== 'topology' && (
                <button
                  type="button"
                  disabled={isReadOnlyMode || deviceCount === 0}
                  onClick={() => {
                    setOpenMenu(null);
                    onAutoAssignIps();
                  }}
                  className={moreItemCls}
                >
                  <span className="flex items-center gap-2">
                    <Network className="w-3.5 h-3.5 text-sky-600" />
                    <span>Tự gán địa chỉ IP / VLAN</span>
                  </span>
                </button>
              )}

              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

              {/* 2. CAMERA & SÓNG (đồng bộ 2D & 3D) */}
              <div className={groupTitleCls}>Camera &amp; Vùng phủ</div>
              {onToggleCoverageOverlay && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    onToggleCoverageOverlay();
                  }}
                  title="Bật/tắt vùng phủ FOV Camera & sóng Wi-Fi (đồng bộ 2D & 3D)"
                  className={moreItemCls}
                >
                  <span className="flex items-center gap-2">
                    <Video className="w-3.5 h-3.5 text-amber-600" />
                    <span>Góc quan sát FOV &amp; vùng phủ</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#155EEF]">
                    {project.settings.showCoverageRadius ? 'Bật' : 'Tắt'}
                  </span>
                </button>
              )}

              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

              {/* 3. ĐIỆN */}
              <div className={groupTitleCls}>Điện &amp; Nguồn dự phòng</div>
              {onOpenPowerTab && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenPowerTab();
                  }}
                  className={moreItemCls}
                >
                  <span className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-600" />
                    <span>Tính tải PoE, Điện AC &amp; UPS</span>
                  </span>
                </button>
              )}

              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

              {/* 4. EXCEL */}
              <div className={groupTitleCls}>Excel</div>
              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null);
                  onOpenExcelTree();
                }}
                className={moreItemCls}
              >
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#16A34A]" />
                  <span>Nhập / Xuất Cây Router Excel</span>
                </span>
              </button>

              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

              {/* 5. CHẾ ĐỘ XEM */}
              {onToggleReadOnly && (
                <>
                  <div className={groupTitleCls}>Chế độ trình bày</div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(null);
                      onToggleReadOnly();
                    }}
                    className={moreItemCls}
                  >
                    <span className="flex items-center gap-2">
                      {isReadOnlyMode ? (
                        <EyeOff className="w-3.5 h-3.5 text-amber-600" />
                      ) : (
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      <span>{isReadOnlyMode ? 'Thoát chế độ Chỉ xem' : 'Chế độ Chỉ xem (Read-only)'}</span>
                    </span>
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                </>
              )}

              {/* 6. LỊCH SỬ THAO TÁC */}
              <div className={groupTitleCls}>Tiện ích</div>
              <button
                type="button"
                onClick={() => setShowRecentInMore(v => !v)}
                className={moreItemCls}
              >
                <span className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  <span>Lịch sử thao tác ({recentActions.length})</span>
                </span>
                <ChevronRight
                  className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                    showRecentInMore ? 'rotate-90' : ''
                  }`}
                />
              </button>

              {showRecentInMore && (
                <div className="mx-2 mb-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 overflow-hidden">
                  <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">10 lệnh gần nhất</span>
                    {recentActions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onClearRecentActions()}
                        className="text-rose-600 hover:underline flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa</span>
                      </button>
                    )}
                  </div>
                  {recentActions.length === 0 ? (
                    <div className="px-2.5 py-2 text-[11px] text-slate-400">
                      Chưa có thao tác gần đây.
                    </div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-200/60 dark:divide-slate-700/60">
                      {recentActions.map(entry => (
                        <button
                          key={`${entry.id}_${entry.timestamp}`}
                          type="button"
                          onClick={() => {
                            setOpenMenu(null);
                            onReplayRecentAction(entry);
                          }}
                          className="w-full px-2.5 py-1.5 text-left hover:bg-blue-50/70 dark:hover:bg-blue-950/40 flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="flex items-center gap-1.5 min-w-0 truncate text-slate-700 dark:text-slate-200">
                            <RotateCcw className="w-3 h-3 text-[#155EEF] shrink-0" />
                            <span className="truncate">{entry.label}</span>
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {formatRecentActionAge(entry.timestamp)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
});
