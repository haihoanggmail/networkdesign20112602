import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ProjectState, DesignMode } from '../../types/infrastructure';
import { DESIGN_MODES, DESIGN_MODE_GROUPS } from '../../utils/designModes';
import {
  WORKSPACE_PRESETS,
  WorkspacePresetId
} from '../../utils/workspacePresets';
import {
  Download,
  FolderOpen,
  Building2,
  Box,
  BookOpen,
  Sun,
  Moon,
  Search,
  Save,
  Copy,
  CheckCircle2,
  FolderKanban,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Bot,
  PanelLeft,
  SlidersHorizontal,
  Route,
  ChevronDown,
  FilePlus2,
  Keyboard,
  FileDown,
  FileSpreadsheet,
  Upload,
  Menu,
  Compass,
  Network,
  ClipboardList,
  Info,
  MessageSquarePlus,
  FileArchive,
  LayoutTemplate,
  FolderPlus,
  Layers,
  Undo2,
  Redo2,
  Trash2,
  CheckSquare,
  Zap,
  Check,
  Paintbrush,
  FileUp
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';
import { HachihiLogo } from '../HachihiLogo';
import {
  APP_VERSION,
  buildFeedbackFormUrl,
  isFeedbackFormConfigured
} from '../../config/appInfo';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  ShortcutKeymap,
  formatShortcutDisplay,
  getDefaultShortcutKeymap
} from '../../hooks/useKeyboardShortcuts';

type TopMenuKey =
  | 'file'
  | 'edit'
  | 'design'
  | 'engineering'
  | 'documents'
  | 'help'
  | 'compact_menu';

interface TopBarProps {
  project: ProjectState;
  keymap?: ShortcutKeymap;
  hasUnsavedChanges: boolean;
  isSaving?: boolean;
  storageError?: string | null;
  lastSavedAt: string;
  auditIssueCount?: number;
  isAiAvailable?: boolean;
  activePresetId?: WorkspacePresetId;
  canUndo?: boolean;
  canRedo?: boolean;
  hasSelection?: boolean;
  hasNodeSelection?: boolean;
  hasCopiedStyle?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicateSelected?: () => void;
  onDeleteSelected?: () => void;
  onSelectAll?: () => void;
  onCopySelectedStyle?: () => void;
  onPasteSelectedStyle?: () => void;
  onApplyWorkspacePreset?: (presetId: WorkspacePresetId) => void;
  onAutoAssignIps?: () => void;
  onSaveNow: () => void;
  onDuplicateProject: () => void;
  onSetMode: (mode: DesignMode) => void;
  onOpenProjectHub: () => void;
  onOpenEngineeringAudit: () => void;
  onOpenPowerTab?: () => void;
  onOpenTemplates: () => void;
  onOpenBuildingGenerator: () => void;
  onOpenExport: () => void;
  onOpenBomModal?: () => void;
  onOpenGuide: () => void;
  onOpenQuickTour?: () => void;
  onOpenAbout?: () => void;
  onAddRack: () => void;
  onNewProject: () => void;
  onOpenExcelImport?: () => void;
  onOpenJsonImport?: () => void;
  onOpenPackageImport?: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  is3DView?: boolean;
  onToggle3DView?: () => void;
  isAiChatOpen?: boolean;
  onToggleAiChat?: () => void;
  onAutoRouteAllCables?: () => void;
  onAutoLayerDevices?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenShortcuts?: () => void;
  onExportA4Pdf?: () => void;
  onOpenDirectory?: () => void;
  isReadOnlyMode?: boolean;
  layoutTier?: LayoutTier;
  onToggleLeftDrawer?: () => void;
  onToggleRightDrawer?: () => void;
  onShowToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
  workspaceMode?: 'network' | 'cad';
  hasCadDocument?: boolean;
  cadDocName?: string;
  onSwitchWorkspaceMode?: (mode: 'network' | 'cad') => void;
  onOpenCadImport?: () => void;
  onOpenAdmin?: () => void;
}

export const TopBar: React.FC<TopBarProps> = React.memo(({
  project,
  keymap,
  hasUnsavedChanges,
  isSaving = false,
  storageError = null,
  lastSavedAt,
  auditIssueCount = 0,
  isAiAvailable = false,
  activePresetId = 'network_design',
  canUndo = false,
  canRedo = false,
  hasSelection = false,
  hasNodeSelection = false,
  hasCopiedStyle = false,
  onUndo,
  onRedo,
  onDuplicateSelected,
  onDeleteSelected,
  onSelectAll,
  onCopySelectedStyle,
  onPasteSelectedStyle,
  onApplyWorkspacePreset,
  onAutoAssignIps,
  onSaveNow,
  onDuplicateProject,
  onSetMode,
  onOpenProjectHub,
  onOpenEngineeringAudit,
  onOpenPowerTab,
  onOpenTemplates,
  onOpenBuildingGenerator,
  onOpenExport,
  onOpenBomModal,
  onOpenGuide,
  onOpenQuickTour,
  onOpenAbout,
  onAddRack,
  onNewProject,
  onOpenExcelImport,
  onOpenJsonImport,
  onOpenPackageImport,
  isDarkMode,
  onToggleTheme,
  is3DView = false,
  onToggle3DView,
  isAiChatOpen = false,
  onToggleAiChat,
  onAutoRouteAllCables,
  onAutoLayerDevices,
  onOpenCommandPalette,
  onOpenShortcuts,
  onExportA4Pdf,
  onOpenDirectory,
  isReadOnlyMode = false,
  layoutTier = 'wide',
  onToggleLeftDrawer,
  onToggleRightDrawer,
  onShowToast,
  workspaceMode = 'network',
  hasCadDocument = false,
  cadDocName,
  onSwitchWorkspaceMode,
  onOpenCadImport,
  onOpenAdmin
}) => {
  const activeKeymap = keymap || getDefaultShortcutKeymap();
  const [openMenu, setOpenMenu] = useState<TopMenuKey | null>(null);
  const [fileMenuTab, setFileMenuTab] = useState<'new' | 'open'>('new');
  const headerRef = useRef<HTMLElement>(null);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const savedTimeText = useMemo(() => {
    try {
      return new Date(lastSavedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '--:--';
    }
  }, [lastSavedAt]);

  const closeAndRun = (fn?: () => void) => {
    setOpenMenu(null);
    fn?.();
  };

  const toggleMenu = (key: TopMenuKey) => {
    setOpenMenu(prev => (prev === key ? null : key));
  };

  const menuTriggerCls = (active: boolean) =>
    `h-8 px-2 rounded-md text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1 transition-colors ${
      active
        ? 'bg-[#155EEF]/12 text-[#155EEF] dark:text-blue-300 font-semibold'
        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`;

  const menuItemCls =
    'w-full px-3 py-1.5 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  const groupHeaderCls =
    'px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500';

  const handleModeSelect = (nextMode: DesignMode) => {
    if (is3DView && onToggle3DView) {
      onToggle3DView();
    }
    onSetMode(nextMode);
  };

  const feedbackConfigured = isFeedbackFormConfigured();
  const feedbackUrl = buildFeedbackFormUrl({ activeMode: project.activeMode });
  const canShowAiTrigger = Boolean(isAiAvailable && isOnline && onToggleAiChat);

  const handleFeedbackOfflineClick = (e: React.MouseEvent) => {
    if (!isOnline) {
      e.preventDefault();
      setOpenMenu(null);
      onShowToast?.('Cần kết nối Internet để mở biểu mẫu góp ý trực tuyến.', 'info');
      return;
    }
    setOpenMenu(null);
  };

  const renderEditMenuItems = () => (
    <>
      <button
        type="button"
        disabled={!canUndo || isReadOnlyMode}
        onClick={() => closeAndRun(onUndo)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <Undo2 className="w-3.5 h-3.5 text-slate-500" />
          <span>Hoàn tác</span>
        </span>
        <span className="text-xs font-mono text-slate-400">{formatShortcutDisplay(activeKeymap.undo)}</span>
      </button>
      <button
        type="button"
        disabled={!canRedo || isReadOnlyMode}
        onClick={() => closeAndRun(onRedo)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <Redo2 className="w-3.5 h-3.5 text-slate-500" />
          <span>Làm lại</span>
        </span>
        <span className="text-xs font-mono text-slate-400">{formatShortcutDisplay(activeKeymap.redo)}</span>
      </button>
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <button
        type="button"
        disabled={!hasNodeSelection || isReadOnlyMode}
        onClick={() => closeAndRun(onDuplicateSelected)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <Copy className="w-3.5 h-3.5 text-slate-500" />
          <span>Sao chép / Nhân bản</span>
        </span>
        <span className="text-xs font-mono text-slate-400">{formatShortcutDisplay(activeKeymap.duplicate)}</span>
      </button>
      {onCopySelectedStyle && (
        <button
          type="button"
          disabled={is3DView || !hasNodeSelection || isReadOnlyMode}
          onClick={() => closeAndRun(onCopySelectedStyle)}
          title={is3DView ? 'Sao chép kiểu hiển thị 2D không khả dụng trong chế độ 3D' : 'Sao chép kiểu hiển thị của đối tượng'}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Paintbrush className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>Sao chép kiểu hiển thị</span>
          </span>
        </button>
      )}
      {onPasteSelectedStyle && (
        <button
          type="button"
          disabled={is3DView || !hasCopiedStyle || !hasNodeSelection || isReadOnlyMode}
          onClick={() => closeAndRun(onPasteSelectedStyle)}
          title={is3DView ? 'Dán kiểu hiển thị 2D không khả dụng trong chế độ 3D' : 'Dán kiểu hiển thị đã sao chép'}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Paintbrush className="w-3.5 h-3.5 text-emerald-600" />
            <span>Dán kiểu hiển thị</span>
          </span>
        </button>
      )}
      <button
        type="button"
        disabled={!hasSelection || isReadOnlyMode}
        onClick={() => closeAndRun(onDeleteSelected)}
        className={`${menuItemCls} text-rose-600 dark:text-rose-400`}
      >
        <span className="flex items-center gap-2">
          <Trash2 className="w-3.5 h-3.5" />
          <span>Xóa đối tượng</span>
        </span>
        <span className="text-xs font-mono opacity-75">{formatShortcutDisplay(activeKeymap.delete)}</span>
      </button>
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <button
        type="button"
        onClick={() => closeAndRun(onSelectAll)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <CheckSquare className="w-3.5 h-3.5 text-slate-500" />
          <span>Chọn tất cả</span>
        </span>
        <span className="text-xs font-mono text-slate-400">{formatShortcutDisplay(activeKeymap.select_all)}</span>
      </button>
    </>
  );

  const renderDesignMenuItems = () => (
    <>
      {DESIGN_MODE_GROUPS.map(group => (
        <React.Fragment key={group.id}>
          <div className={groupHeaderCls}>{group.label}</div>
          {DESIGN_MODES.filter(m => m.group === group.id).map(mode => {
            const active = project.activeMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => closeAndRun(() => handleModeSelect(mode.id))}
                className={menuItemCls}
              >
                <span className={`truncate ${active ? 'text-[#155EEF] dark:text-blue-400 font-semibold' : ''}`}>
                  {mode.label}
                </span>
                {active && <Check className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />}
              </button>
            );
          })}
        </React.Fragment>
      ))}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <button
        type="button"
        disabled={isReadOnlyMode}
        onClick={() => closeAndRun(onOpenTemplates)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <LayoutTemplate className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>Thư viện mẫu chuẩn</span>
        </span>
      </button>
      <button
        type="button"
        disabled={isReadOnlyMode}
        onClick={() => closeAndRun(onOpenBuildingGenerator)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5 text-slate-500" />
          <span>Tạo cấu trúc tòa nhà nhiều tầng</span>
        </span>
      </button>
      {onApplyWorkspacePreset && (
        <>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <div className={groupHeaderCls}>Bố cục làm việc</div>
          <div className="px-3 pb-1.5 grid grid-cols-2 gap-1">
            {WORKSPACE_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => closeAndRun(() => onApplyWorkspacePreset(p.id))}
                className={`px-2 py-1 rounded text-[11px] font-medium text-left truncate border transition-colors ${
                  activePresetId === p.id
                    ? 'border-[#155EEF] bg-blue-50/70 dark:bg-blue-950/40 text-[#155EEF] dark:text-blue-300 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-[#155EEF]'
                }`}
              >
                {p.shortLabel}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );

  const renderEngineeringMenuItems = () => (
    <>
      <div className={groupHeaderCls}>IP / VLAN &amp; Hạ tầng</div>
      {onAutoAssignIps && (
        <button
          type="button"
          disabled={isReadOnlyMode}
          onClick={() => closeAndRun(onAutoAssignIps)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Network className="w-3.5 h-3.5 text-sky-600" />
            <span>Tự động gán IP / VLAN</span>
          </span>
          <span className="text-[11px] font-mono text-slate-400 shrink-0">{formatShortcutDisplay(activeKeymap.auto_assign_ip)}</span>
        </button>
      )}
      {onOpenDirectory && (
        <button
          type="button"
          onClick={() => closeAndRun(onOpenDirectory)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Network className="w-3.5 h-3.5 text-slate-500" />
            <span>Danh bạ Subnet, VLAN &amp; Cáp</span>
          </span>
        </button>
      )}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <div className={groupHeaderCls}>Kiểm tra &amp; Công suất</div>
      <button
        type="button"
        onClick={() => closeAndRun(onOpenEngineeringAudit)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-[#155EEF]" />
          <span>Kiểm tra kỹ thuật (Audit)</span>
        </span>
        {auditIssueCount > 0 && (
          <span className="font-mono text-rose-600 dark:text-rose-400 font-semibold">
            {auditIssueCount}
          </span>
        )}
      </button>
      {onOpenPowerTab && (
        <button
          type="button"
          onClick={() => closeAndRun(onOpenPowerTab)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-600" />
            <span>Tính tải PoE, Điện AC &amp; UPS</span>
          </span>
        </button>
      )}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <div className={groupHeaderCls}>Rack &amp; Quản lý cáp</div>
      <button
        type="button"
        disabled={isReadOnlyMode}
        onClick={() => closeAndRun(onAddRack)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <Box className="w-3.5 h-3.5 text-slate-500" />
          <span>Thêm tủ Rack 42U</span>
        </span>
        <span className="text-[11px] font-mono text-slate-400 shrink-0">{formatShortcutDisplay(activeKeymap.tool_rack)}</span>
      </button>
      {onAutoRouteAllCables && (
        <button
          type="button"
          disabled={isReadOnlyMode}
          onClick={() => closeAndRun(onAutoRouteAllCables)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Route className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>Định tuyến cáp toàn sơ đồ</span>
          </span>
          <span className="text-[11px] font-mono text-slate-400 shrink-0">{formatShortcutDisplay(activeKeymap.auto_route)}</span>
        </button>
      )}
      {onAutoLayerDevices && (
        <button
          type="button"
          disabled={isReadOnlyMode}
          onClick={() => closeAndRun(onAutoLayerDevices)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>Phân lớp thiết bị tự động</span>
          </span>
        </button>
      )}
      {onOpenBomModal && (
        <>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button
            type="button"
            onClick={() => closeAndRun(onOpenBomModal)}
            className={menuItemCls}
          >
            <span className="flex items-center gap-2">
              <ClipboardList className="w-3.5 h-3.5 text-[#155EEF]" />
              <span>Bảng vật tư (BOM / BOQ)</span>
            </span>
          </button>
        </>
      )}
    </>
  );

  const renderDocumentsMenuItems = () => (
    <>
      {onExportA4Pdf && (
        <button
          type="button"
          onClick={() => closeAndRun(onExportA4Pdf)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <FileDown className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>{is3DView ? 'Xuất nhanh PDF A4 (Góc nhìn 3D)' : 'Xuất nhanh PDF A4'}</span>
          </span>
        </button>
      )}
      {onOpenExcelImport && (
        <button
          type="button"
          onClick={() => closeAndRun(onOpenExcelImport)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#16A34A]" />
            <span>Nhập / Xuất Cây Excel (.xlsx)</span>
          </span>
        </button>
      )}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <button
        type="button"
        onClick={() => closeAndRun(onOpenExport)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <FileArchive className="w-3.5 h-3.5 text-[#155EEF]" />
          <span>Xuất hồ sơ (PDF, 3D PNG, DXF, SVG, ZIP)</span>
        </span>
      </button>
    </>
  );

  const renderHelpMenuItems = () => (
    <>
      {onOpenQuickTour && (
        <button
          type="button"
          onClick={() => closeAndRun(onOpenQuickTour)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Compass className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>Hướng dẫn nhanh 60 giây</span>
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => closeAndRun(onOpenGuide)}
        className={menuItemCls}
      >
        <span className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-slate-500" />
          <span>Tài liệu hướng dẫn</span>
        </span>
      </button>
      {onOpenShortcuts && (
        <button
          type="button"
          onClick={() => closeAndRun(onOpenShortcuts)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Keyboard className="w-3.5 h-3.5 text-slate-500" />
            <span>Phím tắt bàn phím</span>
          </span>
        </button>
      )}
      {canShowAiTrigger && (
        <button
          type="button"
          onClick={() => closeAndRun(onToggleAiChat)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>Trợ lý kỹ thuật AI</span>
          </span>
        </button>
      )}
      {(feedbackConfigured && feedbackUrl) || onOpenAbout ? (
        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      ) : null}
      {feedbackConfigured && feedbackUrl && (
        <a
          href={feedbackUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleFeedbackOfflineClick}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <MessageSquarePlus className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>Góp ý sản phẩm</span>
          </span>
        </a>
      )}
      {onOpenAbout && (
        <button
          type="button"
          onClick={() => closeAndRun(onOpenAbout)}
          className={menuItemCls}
        >
          <span className="flex items-center gap-2">
            <Info className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>Giới thiệu HACHIHI</span>
          </span>
          <span className="text-[11px] font-mono text-slate-400">v{APP_VERSION}</span>
        </button>
      )}
    </>
  );

  return (
    <header
      ref={headerRef}
      className="h-12 pt-safe px-3 flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 text-xs shrink-0 select-none z-40 relative no-print"
    >
      {/* Left Zone: Drawer Trigger (medium) · 6 Business Menus (Tệp, Chỉnh sửa, Thiết kế, Kỹ thuật, Hồ sơ, Trợ giúp) · Project Name · Save Status */}
      <div className="flex items-center gap-1 min-w-0">
        {layoutTier === 'medium' && onToggleLeftDrawer && (
          <button
            type="button"
            onClick={onToggleLeftDrawer}
            aria-label="Mở thư viện thiết bị"
            className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0"
            title="Thư viện thiết bị"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {/* Primary Menu Bar */}
        <nav aria-label="Menu nghiệp vụ chính" className="flex items-center gap-0.5 pr-2 border-r border-slate-200 dark:border-slate-800 shrink-0">
          {/* 1. TỆP */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setFileMenuTab('new');
                toggleMenu('file');
              }}
              aria-expanded={openMenu === 'file'}
              aria-label="Mở menu Tệp và Tạo mới"
              className={`h-8 flex items-center gap-1 px-2.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                openMenu === 'file'
                  ? 'bg-[#155EEF] text-white shadow-xs'
                  : 'bg-[#155EEF]/10 hover:bg-[#155EEF]/15 text-[#155EEF] dark:text-blue-300 border border-[#155EEF]/25'
              }`}
              title="Tệp: Tạo mới, Mở, Lưu, Lưu thành & Nhập dự án"
            >
              <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
              <span>Tệp</span>
            </button>

            {openMenu === 'file' && (
              <div
                role="menu"
                aria-label="Menu Tệp và Tạo mới"
                className="absolute left-0 top-full mt-1.5 w-[min(380px,calc(100vw-1.5rem))] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl z-50 overflow-hidden max-h-[86dvh] flex flex-col"
              >
                <div className="p-2 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setFileMenuTab('new')}
                    aria-pressed={fileMenuTab === 'new'}
                    className={`h-9 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                      fileMenuTab === 'new'
                        ? 'bg-[#155EEF] text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-[#155EEF]'
                    }`}
                  >
                    <FolderPlus className="w-4 h-4 shrink-0" />
                    <span>Tạo mới</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFileMenuTab('open')}
                    aria-pressed={fileMenuTab === 'open'}
                    className={`h-9 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                      fileMenuTab === 'open'
                        ? 'bg-[#155EEF] text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-[#155EEF]'
                    }`}
                  >
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span>Mở</span>
                  </button>
                </div>

                <div className="overflow-y-auto py-1.5">
                  {fileMenuTab === 'new' ? (
                    <div className="px-2 space-y-1">
                      <div className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Tạo mới &amp; Nhập dự án
                      </div>
                      <button
                        type="button"
                        onClick={() => closeAndRun(onNewProject)}
                        className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                      >
                        <FilePlus2 className="w-4 h-4 text-[#155EEF] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">Mẫu trống</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Tạo bản vẽ mới hoàn toàn để tự thiết kế từ đầu
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => closeAndRun(onOpenTemplates)}
                        className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                      >
                        <LayoutTemplate className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                            Chọn mẫu có sẵn
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Thư viện mẫu LAN/WAN, văn phòng 3 tầng, tủ Rack, CCTV
                          </div>
                        </div>
                      </button>
                      {onOpenExcelImport && (
                        <button
                          type="button"
                          onClick={() => closeAndRun(onOpenExcelImport)}
                          className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              Nhập / Xuất Cây Excel
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Tải file mẫu, dán bảng hoặc dựng sơ đồ cây Router Cha–Con (.xlsx)
                            </div>
                          </div>
                        </button>
                      )}
                      {onOpenJsonImport && (
                        <button
                          type="button"
                          onClick={() => closeAndRun(onOpenJsonImport)}
                          className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                        >
                          <Upload className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              Nhập từ file JSON
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Khôi phục dự án hoặc bản sao lưu từ tệp .json
                            </div>
                          </div>
                        </button>
                      )}
                      {onOpenPackageImport && (
                        <button
                          type="button"
                          onClick={() => closeAndRun(onOpenPackageImport)}
                          className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                        >
                          <FileArchive className="w-4 h-4 text-[#155EEF] shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              Từ file đồng nghiệp đã lưu &amp; gửi
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Mở gói dự án (.hachihi.json) kèm ảnh, lịch sử &amp; kiểm tra toàn vẹn
                            </div>
                          </div>
                        </button>
                      )}
                      {onOpenCadImport && (
                        <button
                          type="button"
                          onClick={() => closeAndRun(onOpenCadImport)}
                          className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                        >
                          <FileUp className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              Nhập tệp CAD (.dxf / .dwg)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Đọc, chỉnh sửa trên AutoCAD Studio hoặc lồng làm lớp nền 2D/3D
                            </div>
                          </div>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="px-2 space-y-1">
                      <div className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Mở dự án &amp; tệp hiện có
                      </div>
                      <button
                        type="button"
                        onClick={() => closeAndRun(onOpenProjectHub)}
                        className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                      >
                        <FolderKanban className="w-4 h-4 text-[#155EEF] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                            Mở dự án đã lưu trên máy
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Chuyển đổi các bản vẽ trong trình duyệt, thùng rác &amp; sao lưu
                          </div>
                        </div>
                      </button>
                      {onOpenPackageImport && (
                        <button
                          type="button"
                          onClick={() => closeAndRun(onOpenPackageImport)}
                          className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                        >
                          <FileArchive className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              Mở file từ máy (.hachihi.json / .json)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Xem trước và mở file bản vẽ do người khác gửi hoặc đã sao lưu
                            </div>
                          </div>
                        </button>
                      )}
                      {onOpenExcelImport && (
                        <button
                          type="button"
                          onClick={() => closeAndRun(onOpenExcelImport)}
                          className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              Nhập / Xuất Cây Excel (.xlsx / .csv)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Tải mẫu, xem trước cây phân cấp hoặc xuất từ bản vẽ đang mở
                            </div>
                          </div>
                        </button>
                      )}
                      {onOpenCadImport && (
                        <button
                          type="button"
                          onClick={() => closeAndRun(onOpenCadImport)}
                          className="w-full px-2.5 py-2 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-start gap-2.5 transition-colors"
                        >
                          <FileUp className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              Nhập tệp CAD (.dxf / .dwg)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Mở trực tiếp DXF ASCII/Binary, kiểm tra DWG hoặc khôi phục từ IndexedDB
                            </div>
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 dark:border-slate-800 py-1.5 px-2 space-y-0.5 shrink-0 bg-slate-50/40 dark:bg-slate-900">
                  {onOpenCadImport && (
                    <button
                      type="button"
                      onClick={() => closeAndRun(onOpenCadImport)}
                      aria-label="Nhập tệp CAD"
                      className={menuItemCls}
                    >
                      <span className="flex items-center gap-2 font-semibold text-sky-700 dark:text-sky-300">
                        <FileUp className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" /> Nhập tệp CAD
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">DXF / DWG</span>
                    </button>
                  )}
                  <button type="button" onClick={() => closeAndRun(onSaveNow)} className={menuItemCls}>
                    <span className="flex items-center gap-2">
                      <Save className="w-3.5 h-3.5 text-[#16A34A]" /> Lưu dự án ngay
                    </span>
                    <span className="text-xs font-mono text-slate-400">{formatShortcutDisplay(activeKeymap.save)}</span>
                  </button>
                  <button type="button" onClick={() => closeAndRun(onDuplicateProject)} className={menuItemCls}>
                    <span className="flex items-center gap-2">
                      <Copy className="w-3.5 h-3.5 text-slate-500" /> Lưu thành bản sao
                    </span>
                  </button>
                  <button type="button" onClick={() => closeAndRun(onOpenProjectHub)} className={menuItemCls}>
                    <span className="flex items-center gap-2">
                      <FolderKanban className="w-3.5 h-3.5 text-slate-500" /> Trung tâm dự án
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2–6. Desktop Individual Business Menus (Chỉnh sửa · Thiết kế · Kỹ thuật · Hồ sơ · Trợ giúp) */}
          <div className="hidden lg:flex items-center gap-0.5">
            {/* 2. CHỈNH SỬA */}
            <div className="relative">
              <button
                type="button"
                onClick={() => toggleMenu('edit')}
                aria-expanded={openMenu === 'edit'}
                aria-label="Mở menu Chỉnh sửa"
                className={menuTriggerCls(openMenu === 'edit')}
              >
                <span>Chỉnh sửa</span>
              </button>
              {openMenu === 'edit' && (
                <div
                  role="menu"
                  aria-label="Menu Chỉnh sửa"
                  className="absolute left-0 top-full mt-1.5 w-64 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50"
                >
                  {renderEditMenuItems()}
                </div>
              )}
            </div>

            {/* 3. THIẾT KẾ */}
            <div className="relative">
              <button
                type="button"
                onClick={() => toggleMenu('design')}
                aria-expanded={openMenu === 'design'}
                aria-label="Mở menu Thiết kế"
                className={menuTriggerCls(openMenu === 'design')}
              >
                <span>Thiết kế</span>
              </button>
              {openMenu === 'design' && (
                <div
                  role="menu"
                  aria-label="Menu Thiết kế"
                  className="absolute left-0 top-full mt-1.5 w-72 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50 max-h-[80dvh] overflow-y-auto"
                >
                  {renderDesignMenuItems()}
                </div>
              )}
            </div>

            {/* 4. KỸ THUẬT */}
            <div className="relative">
              <button
                type="button"
                onClick={() => toggleMenu('engineering')}
                aria-expanded={openMenu === 'engineering'}
                aria-label="Mở menu Kỹ thuật"
                className={menuTriggerCls(openMenu === 'engineering')}
              >
                <span>Kỹ thuật</span>
              </button>
              {openMenu === 'engineering' && (
                <div
                  role="menu"
                  aria-label="Menu Kỹ thuật"
                  className="absolute left-0 top-full mt-1.5 w-72 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50 max-h-[80dvh] overflow-y-auto"
                >
                  {renderEngineeringMenuItems()}
                </div>
              )}
            </div>

            {/* 5. HỒ SƠ */}
            <div className="relative">
              <button
                type="button"
                onClick={() => toggleMenu('documents')}
                aria-expanded={openMenu === 'documents'}
                aria-label="Mở menu Hồ sơ"
                className={menuTriggerCls(openMenu === 'documents')}
              >
                <span>Hồ sơ</span>
              </button>
              {openMenu === 'documents' && (
                <div
                  role="menu"
                  aria-label="Menu Hồ sơ"
                  className="absolute left-0 top-full mt-1.5 w-72 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50"
                >
                  {renderDocumentsMenuItems()}
                </div>
              )}
            </div>

            {/* 6. TRỢ GIÚP */}
            <div className="relative">
              <button
                type="button"
                onClick={() => toggleMenu('help')}
                aria-expanded={openMenu === 'help'}
                aria-label="Mở menu Trợ giúp"
                className={menuTriggerCls(openMenu === 'help')}
              >
                <span>Trợ giúp</span>
              </button>
              {openMenu === 'help' && (
                <div
                  role="menu"
                  aria-label="Menu Trợ giúp"
                  className="absolute left-0 top-full mt-1.5 w-64 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50"
                >
                  {renderHelpMenuItems()}
                </div>
              )}
            </div>
          </div>

          {/* Medium/Tablet (< 1024px) Consolidated Business Menu Dropdown so 960px never wraps/clips */}
          <div className="relative hidden sm:block lg:hidden shrink-0">
            <button
              type="button"
              onClick={() => toggleMenu('compact_menu')}
              aria-expanded={openMenu === 'compact_menu'}
              aria-label="Mở Menu nghiệp vụ"
              className={`h-8 flex items-center gap-1.5 px-2.5 rounded-md border text-xs font-semibold whitespace-nowrap transition-colors ${
                openMenu === 'compact_menu'
                  ? 'border-[#155EEF] bg-slate-100 dark:bg-slate-800 text-[#155EEF] dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Chỉnh sửa · Thiết kế · Kỹ thuật · Hồ sơ · Trợ giúp"
            >
              <Menu className="w-3.5 h-3.5" />
              <span>Menu</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {openMenu === 'compact_menu' && (
              <div
                role="menu"
                aria-label="Menu nghiệp vụ"
                className="absolute left-0 top-full mt-1.5 w-[min(320px,calc(100vw-2rem))] rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50 max-h-[82dvh] overflow-y-auto"
              >
                <div className={groupHeaderCls}>Chỉnh sửa</div>
                {renderEditMenuItems()}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className={groupHeaderCls}>Thiết kế</div>
                {renderDesignMenuItems()}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className={groupHeaderCls}>Kỹ thuật</div>
                {renderEngineeringMenuItems()}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className={groupHeaderCls}>Hồ sơ</div>
                {renderDocumentsMenuItems()}
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <div className={groupHeaderCls}>Trợ giúp</div>
                {renderHelpMenuItems()}
              </div>
            )}
          </div>
        </nav>

        {/* Project Name + Saved / Unsaved Status */}
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={onOpenProjectHub}
            aria-label="Mở Trung tâm dự án"
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-w-0"
            title="Mở Trung tâm dự án"
          >
            <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[96px] sm:max-w-[130px] xl:max-w-[180px]">
              {project.name}
            </span>
          </button>

          <div
            role="status"
            aria-label={
              storageError ? 'Lỗi lưu trữ' : isSaving ? 'Đang lưu' : hasUnsavedChanges ? 'Chưa lưu' : 'Đã lưu'
            }
            className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 ${
              storageError
                ? 'text-rose-600 dark:text-rose-400'
                : hasUnsavedChanges
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-slate-500 dark:text-slate-400'
            }`}
            title={
              storageError
                ? `Lỗi lưu trữ: ${storageError}`
                : `Trạng thái lưu tự động · Lưu lúc ${savedTimeText} (dùng nút Lưu trên thanh công cụ hoặc Ctrl+S)`
            }
          >
            {storageError ? (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            ) : isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#155EEF] shrink-0" />
            ) : hasUnsavedChanges ? (
              <Save className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
            )}
            <span className="hidden md:inline">
              {storageError ? 'Lỗi lưu' : isSaving ? 'Đang lưu' : hasUnsavedChanges ? 'Chưa lưu' : 'Đã lưu'}
            </span>
          </div>
        </div>
      </div>

      {/* Right Zone: Workspace Switcher · Ctrl+K Tìm lệnh · Kiểm tra · Vật tư · Xuất hồ sơ · Trợ lý AI · PWA · Sáng/Tối · About */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasCadDocument && onSwitchWorkspaceMode ? (
          <div
            role="group"
            aria-label="Chuyển không gian làm việc"
            className="hidden sm:flex items-center h-8 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 shrink-0"
          >
            <button
              type="button"
              onClick={() => onSwitchWorkspaceMode('network')}
              aria-pressed={workspaceMode === 'network'}
              className={`h-7 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap ${
                workspaceMode === 'network'
                  ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="Chế độ Thiết kế Mạng & Hạ tầng 2D/3D"
            >
              <Network className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">Thiết kế Mạng</span>
            </button>
            <button
              type="button"
              onClick={() => onSwitchWorkspaceMode('cad')}
              aria-pressed={workspaceMode === 'cad'}
              className={`h-7 px-2 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap ${
                workspaceMode === 'cad'
                  ? 'bg-[#155EEF] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
              title={cadDocName ? `Mở AutoCAD Studio (${cadDocName})` : 'Chế độ AutoCAD Studio'}
            >
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">AutoCAD Studio</span>
            </button>
          </div>
        ) : (
          onOpenCadImport && (
            <button
              type="button"
              onClick={onOpenCadImport}
              aria-label="Mở hoặc nhập bản vẽ AutoCAD"
              className="hidden sm:flex h-8 items-center gap-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-sky-500 bg-slate-50/70 dark:bg-slate-800/70 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
              title="Mở, chỉnh sửa DXF/DWG hoặc lồng nền AutoCAD"
            >
              <Compass className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="hidden xl:inline">AutoCAD</span>
            </button>
          )
        )}

        {onOpenCommandPalette && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Tìm kiếm và mở bảng lệnh"
            className="h-8 flex items-center gap-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/70 hover:border-[#155EEF] text-xs text-slate-600 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            title={`Tìm thiết bị, IP hoặc chạy lệnh nhanh (${formatShortcutDisplay(activeKeymap.command_palette)})`}
          >
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="hidden xl:inline">Tìm lệnh</span>
            <kbd className="hidden xl:inline font-mono text-[11px] text-slate-400">{formatShortcutDisplay(activeKeymap.command_palette)}</kbd>
          </button>
        )}

        {layoutTier !== 'narrow' && (
          <button
            type="button"
            onClick={onOpenEngineeringAudit}
            className="h-8 flex items-center gap-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
            title="Kiểm tra kỹ thuật, xung đột IP/VLAN và PoE"
          >
            <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${auditIssueCount > 0 ? 'text-amber-600' : 'text-[#16A34A]'}`} />
            <span>Kiểm tra</span>
            {auditIssueCount > 0 && (
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                ({auditIssueCount})
              </span>
            )}
          </button>
        )}

        {layoutTier !== 'narrow' && onOpenBomModal && (
          <button
            type="button"
            onClick={onOpenBomModal}
            aria-label="Mở Bảng vật tư (BOM)"
            className="h-8 flex items-center gap-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
            title="Bảng vật tư (BOM), hao hụt cáp & xuất Excel dự toán"
          >
            <ClipboardList className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
            <span className="hidden md:inline">Vật tư</span>
          </button>
        )}

        {layoutTier !== 'narrow' && (
          <button
            type="button"
            onClick={onOpenExport}
            aria-label="Xuất hồ sơ bản vẽ"
            className="h-8 flex items-center gap-1.5 px-3 text-xs font-semibold text-white bg-[#155EEF] hover:bg-[#124CC7] rounded-md transition-colors whitespace-nowrap shrink-0"
            title="Xuất PDF, Excel, SVG, AutoCAD DXF & ZIP"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>Xuất hồ sơ</span>
          </button>
        )}

        {canShowAiTrigger && (
          <button
            type="button"
            onClick={onToggleAiChat}
            aria-label={isAiChatOpen ? 'Ẩn Trợ lý AI' : 'Mở Trợ lý AI'}
            aria-pressed={isAiChatOpen}
            className={`h-8 flex items-center gap-1.5 px-2 rounded-md border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              isAiChatOpen
                ? 'bg-[#155EEF] border-[#155EEF] text-white'
                : 'border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/40 text-[#155EEF] dark:text-blue-300 hover:bg-blue-100/80 dark:hover:bg-blue-900/50'
            }`}
            title={isAiChatOpen ? 'Đang mở Trợ lý kỹ thuật · Nhấn để ẩn' : 'Mở Trợ lý kỹ thuật hạ tầng'}
          >
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden 2xl:inline">Trợ lý</span>
          </button>
        )}

        <PWAInstallButton />

        {layoutTier === 'medium' && onToggleRightDrawer && (
          <button
            type="button"
            onClick={onToggleRightDrawer}
            aria-label="Mở bảng thuộc tính"
            className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 shrink-0"
            title="Thuộc tính đối tượng"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        )}

        {/* Chế độ Sáng / Tối */}
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDarkMode ? 'Chuyển sang chế độ Sáng' : 'Chuyển sang chế độ Tối'}
          aria-pressed={isDarkMode}
          className={`h-8 flex items-center gap-1.5 px-2 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
            isDarkMode
              ? 'border-slate-700 bg-slate-800 text-amber-300 hover:border-slate-600 hover:bg-slate-700/80'
              : 'border-slate-200 bg-white text-slate-700 hover:border-[#155EEF] hover:bg-slate-50'
          }`}
          title={isDarkMode ? 'Đang bật chế độ Tối · Nhấn để chuyển Sáng' : 'Đang bật chế độ Sáng · Nhấn để chuyển Tối'}
        >
          {isDarkMode ? (
            <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          )}
          <span className="hidden 2xl:inline">{isDarkMode ? 'Sáng' : 'Tối'}</span>
        </button>

        {/* Nút Giới thiệu HACHIHI */}
        <button
          type="button"
          onClick={() => onOpenAbout?.()}
          aria-label="Giới thiệu HACHIHI"
          className="h-8 flex items-center gap-1.5 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 hover:border-[#155EEF] hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          title={`Giới thiệu HACHIHI v${APP_VERSION}`}
        >
          <HachihiLogo size={18} />
          <span className="hidden sm:inline font-mono text-[11px] text-[#155EEF] dark:text-blue-300">
            v{APP_VERSION}
          </span>
        </button>

        {/* Nút Đăng nhập Quản trị Admin (Góc trên cùng bên phải) */}
        {onOpenAdmin && (
          <button
            type="button"
            data-testid="topbar-admin-login-btn"
            onClick={onOpenAdmin}
            aria-label="Đăng nhập quản trị Admin"
            className="h-8 flex items-center gap-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#155EEF] hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Đăng nhập Admin & Quản trị thư viện mẫu (/admin)"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
            <span className="hidden sm:inline">Đăng nhập Admin</span>
          </button>
        )}
      </div>
    </header>
  );
});
