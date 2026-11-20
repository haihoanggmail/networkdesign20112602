import React from 'react';
import { ProjectState, SelectionState } from '../../types/infrastructure';
import { getDesignModeMeta } from '../../utils/designModes';
import {
  Grid,
  Cpu,
  GitBranch,
  Compass,
  Clock,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { OfflineIndicator } from '../topbar/PWAInstallButton';
import { APP_BUILD_HASH, APP_VERSION } from '../../config/appInfo';

interface StatusBarProps {
  project: ProjectState;
  selection: SelectionState;
  zoom?: number;
  is3DView?: boolean;
  lastSavedAt?: string;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  storageError?: string | null;
  auditIssueCount?: number;
  onOpenAudit?: () => void;
  onOpenAbout?: () => void;
  onToggleSnap: () => void;
  onToggleGrid: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = React.memo(({
  project,
  selection,
  zoom = 1,
  is3DView = false,
  lastSavedAt,
  hasUnsavedChanges,
  isSaving = false,
  storageError = null,
  auditIssueCount = 0,
  onOpenAudit,
  onOpenAbout,
  onToggleSnap,
  onToggleGrid
}) => {
  const selectedNode = selection.type === 'node'
    ? project.nodes.find(n => n.id === selection.id)
    : undefined;

  const selectedCount = selection.type === 'node' && selection.id
    ? 1 + (selection.additionalIds?.length || 0)
    : 0;

  const activeFloor = project.floors.find(f => f.id === project.activeFloorId);
  const modeMeta = getDesignModeMeta(project.activeMode);
  const totalObjects = project.nodes.length + project.rooms.length;
  const totalCables = project.cables.length;

  const savedClock = (() => {
    if (!lastSavedAt) return '';
    try {
      return new Date(lastSavedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();

  return (
    <footer className="hidden md:flex h-8 px-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 items-center justify-between shrink-0 select-none tabular-nums no-print">
      {/* Left: Spatial Context & Coordinates */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium truncate">
          <Compass className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[#155EEF] dark:text-blue-400 font-semibold">{modeMeta.label}</span>
          {activeFloor && (
            <span className="text-slate-500 dark:text-slate-400 truncate">· {activeFloor.name}</span>
          )}
        </div>

        {selectedCount > 1 ? (
          <div className="hidden sm:flex items-center gap-2 border-l border-slate-200 dark:border-slate-800 pl-3 text-[#155EEF] dark:text-blue-400 font-semibold">
            <span>Đã chọn {selectedCount} đối tượng</span>
          </div>
        ) : selectedNode ? (
          <div className="hidden sm:flex items-center gap-2.5 border-l border-slate-200 dark:border-slate-800 pl-3 text-slate-500 dark:text-slate-400 font-mono">
            <span>X:{Math.round(selectedNode.x)}</span>
            <span>Y:{Math.round(selectedNode.y)}</span>
            <span>{selectedNode.width}×{selectedNode.height}px</span>
          </div>
        ) : null}
      </div>

      {/* Right: Sync Status, Object/Cable Counts, Audit Status, Grid/Snap, Version, 2D / 3D Switch */}
      <div className="flex items-center gap-3 shrink-0">
        <OfflineIndicator />

        {storageError ? (
          <span
            role="status"
            data-testid="statusbar-save-status"
            className="flex items-center gap-1 text-[#DC2626] font-semibold"
            title={storageError}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Lỗi lưu</span>
          </span>
        ) : isSaving ? (
          <span
            role="status"
            data-testid="statusbar-save-status"
            className="flex items-center gap-1 font-mono text-[#155EEF] dark:text-blue-400 font-medium"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>Đang lưu...</span>
          </span>
        ) : hasUnsavedChanges ? (
          <span
            role="status"
            data-testid="statusbar-save-status"
            className="flex items-center gap-1 font-mono text-[#D97706] dark:text-amber-400 font-medium"
            title={savedClock ? `Lần lưu gần nhất lúc ${savedClock}` : 'Có thay đổi chưa lưu'}
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Chưa lưu</span>
          </span>
        ) : (
          <span
            role="status"
            data-testid="statusbar-save-status"
            className="flex items-center gap-1 font-mono text-[#16A34A] dark:text-emerald-400 font-medium"
            title={savedClock ? `Đã tự động lưu lúc ${savedClock}` : 'Mọi thay đổi đã được lưu'}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{savedClock ? `Đã lưu ${savedClock}` : 'Đã lưu'}</span>
          </span>
        )}

        <div className="hidden md:flex items-center gap-3 border-l border-slate-200 dark:border-slate-800 pl-3 font-mono">
          <span className="flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-slate-400" />
            <span>{totalObjects} đối tượng</span>
          </span>
          <span className="flex items-center gap-1">
            <GitBranch className="w-3.5 h-3.5 text-slate-400" />
            <span>{totalCables} tuyến cáp</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => onOpenAudit?.()}
          data-testid="statusbar-audit-btn"
          aria-label={auditIssueCount > 0 ? `Xem ${auditIssueCount} cảnh báo kỹ thuật` : 'Kiểm tra kỹ thuật: 0 cảnh báo'}
          className={`flex items-center gap-1 border-l border-slate-200 dark:border-slate-800 pl-3 font-medium whitespace-nowrap hover:underline underline-offset-2 cursor-pointer transition-colors ${
            auditIssueCount > 0
              ? 'text-amber-700 dark:text-amber-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}
          title="Nhấn để mở danh sách kiểm tra lỗi & nhảy đến đúng đối tượng"
        >
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>{auditIssueCount > 0 ? `${auditIssueCount} cảnh báo` : '0 cảnh báo'}</span>
        </button>

        <div className="flex items-center gap-2 border-l border-slate-200 dark:border-slate-800 pl-3 font-mono">
          <span
            className="hidden lg:inline text-slate-400 dark:text-slate-500"
            title="Tỷ lệ quy đổi pixel sang đơn vị thực tế"
          >
            {project.settings.scale}px/{project.settings.unit}
          </span>
          <button
            type="button"
            disabled={is3DView}
            onClick={onToggleGrid}
            aria-label="Bật tắt lưới tọa độ"
            aria-pressed={!is3DView && project.settings.showGrid}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
              !is3DView && project.settings.showGrid
                ? 'text-[#155EEF] dark:text-blue-400 font-semibold'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
            title={is3DView ? 'Lưới tọa độ 2D không khả dụng trong chế độ 3D' : 'Bật/tắt lưới tọa độ 2D'}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Lưới {project.settings.gridSize}px</span>
          </button>

          <button
            type="button"
            disabled={is3DView}
            onClick={onToggleSnap}
            aria-label="Bật tắt bám lưới"
            aria-pressed={!is3DView && project.settings.snapToGrid}
            className={`px-1.5 py-0.5 rounded transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
              !is3DView && project.settings.snapToGrid
                ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
            title={is3DView ? 'Bám lưới 2D không khả dụng trong chế độ 3D' : 'Bật/tắt bám lưới 2D'}
          >
            Bám lưới: {project.settings.snapToGrid ? 'Bật' : 'Tắt'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => onOpenAbout?.()}
          aria-label="Phiên bản ứng dụng HACHIHI"
          className="border-l border-slate-200 dark:border-slate-800 pl-3 font-mono text-[11px] text-slate-500 dark:text-slate-400 hover:text-[#155EEF] dark:hover:text-blue-400 transition-colors whitespace-nowrap"
          title="Xem thông tin phiên bản và liên hệ HACHIHI"
        >
          v{APP_VERSION} · {APP_BUILD_HASH}
        </button>
      </div>
    </footer>
  );
});
