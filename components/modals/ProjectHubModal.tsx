import React, { useEffect, useMemo, useState } from 'react';
import { ProjectSummary, ProjectState, ProjectSnapshot } from '../../types/infrastructure';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  X,
  FolderPlus,
  LayoutTemplate,
  Upload,
  Trash2,
  RotateCcw,
  Copy,
  FolderOpen,
  Download,
  Radar,
  ShieldAlert,
  Check,
  Info,
  MessageSquarePlus,
  History,
  Camera,
  Clock,
  Eye,
  HardDrive,
  Layers,
  Server,
  FileSpreadsheet
} from 'lucide-react';
import {
  computeSnapshotByteSize,
  exportAllProjectsBundle,
  formatByteSize,
  migrateAndValidateProject
} from '../../utils/projectStorage';
import { generatePureSvgMarkup } from '../../utils/svgExport';
import {
  APP_PRODUCT_NAME,
  APP_VERSION,
  BRAND_INFO,
  buildFeedbackFormUrl,
  isFeedbackFormConfigured
} from '../../config/appInfo';
import { HachihiLogo } from '../HachihiLogo';

interface ProjectHubModalProps {
  isOpen: boolean;
  isWelcomeMode?: boolean;
  currentProjectId: string;
  projectList: ProjectSummary[];
  lastBackupAt: string | null;
  snapshots?: ProjectSnapshot[];
  lastAutoSnapshotAt?: string | null;
  onCreateSnapshot?: (label?: string) => Promise<ProjectSnapshot | null>;
  onRestoreSnapshot?: (
    snapshotId: string
  ) => Promise<{ ok: boolean; restoredName?: string; error?: string }>;
  onDeleteSnapshot?: (snapshotId: string) => Promise<boolean>;
  onRefreshSnapshots?: () => Promise<ProjectSnapshot[] | void>;
  onClose: () => void;
  onCreateBlank: (name: string) => void;
  onOpenTemplates: () => void;
  onSwitchProject: (id: string) => void;
  onDuplicateCurrent: () => void;
  onTrashProject: (id: string) => void;
  onRestoreProject: (id: string) => void;
  onDeletePermanently: (id: string) => void;
  onImportProjectJson: (raw: unknown) => { ok: boolean; error?: string };
  onRequestPackageImport?: (file: File) => Promise<void> | void;
  onImportScannerFile: (file: File, options?: { diffMerge?: boolean }) => Promise<void>;
  onRecordFullBackup: () => Promise<void>;
  onOpenExcelImport?: () => void;
  onOpenAbout?: () => void;
}

function formatRelativeAge(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 60_000) return 'Vừa xong';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

export const ProjectHubModal: React.FC<ProjectHubModalProps> = ({
  isOpen,
  isWelcomeMode = false,
  currentProjectId,
  projectList,
  lastBackupAt,
  snapshots = [],
  lastAutoSnapshotAt = null,
  onCreateSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onRefreshSnapshots,
  onClose,
  onCreateBlank,
  onOpenTemplates,
  onSwitchProject,
  onDuplicateCurrent,
  onTrashProject,
  onRestoreProject,
  onDeletePermanently,
  onImportProjectJson,
  onRequestPackageImport,
  onImportScannerFile,
  onRecordFullBackup,
  onOpenExcelImport,
  onOpenAbout
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'snapshots' | 'trash'>('active');
  const [showFullHubInWelcome, setShowFullHubInWelcome] = useState(false);
  const [newName, setNewName] = useState('');
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [previewSnapshotId, setPreviewSnapshotId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [scannerDiffMerge, setScannerDiffMerge] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      setConfirmRestoreId(null);
      setPreviewSnapshotId(null);
      setShowFullHubInWelcome(false);
      void onRefreshSnapshots?.();
    }
  }, [isOpen, onRefreshSnapshots]);

  const snapshotSizeById = useMemo(() => {
    const map = new Map<string, number>();
    for (const snap of snapshots) {
      map.set(
        snap.id,
        typeof snap.byteSize === 'number' && snap.byteSize > 0
          ? snap.byteSize
          : computeSnapshotByteSize(snap.snapshot)
      );
    }
    return map;
  }, [snapshots]);

  const totalSnapshotBytes = useMemo(() => {
    let total = 0;
    snapshotSizeById.forEach(size => {
      total += size;
    });
    return total;
  }, [snapshotSizeById]);

  const previewSnapshot = useMemo(
    () => snapshots.find(s => s.id === previewSnapshotId) || null,
    [snapshots, previewSnapshotId]
  );

  const previewSvgDataUrl = useMemo(() => {
    if (!previewSnapshot) return null;
    try {
      const markup = generatePureSvgMarkup(previewSnapshot.snapshot, {
        whiteBackground: true,
        includeTitleBlock: false
      });
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    } catch {
      return null;
    }
  }, [previewSnapshot]);

  if (!isOpen) return null;

  const activeProjects = projectList.filter(p => !p.isTrashed);
  const trashedProjects = projectList.filter(p => p.isTrashed);

  const daysSinceBackup = (() => {
    if (!lastBackupAt) return 999;
    return (Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60 * 24);
  })();

  const handleBackupAll = async () => {
    try {
      const bundle = await exportAllProjectsBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `HACHIHI_All_Projects_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      await onRecordFullBackup();
      setBanner({ type: 'success', text: `Đã sao lưu ${bundle.projects.length} dự án thành tệp JSON!` });
    } catch (err) {
      setBanner({ type: 'error', text: `Lỗi sao lưu: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const { checkImportPayloadSize, MAX_BUNDLE_PROJECTS, MAX_IMPORT_JSON_BYTES } = await import('../../utils/security');
      const sizeCheck = checkImportPayloadSize(file, MAX_IMPORT_JSON_BYTES, file.name);
      if (!sizeCheck.ok) {
        setBanner({ type: 'error', text: sizeCheck.error });
        return;
      }

      if (onRequestPackageImport) {
        onClose();
        await onRequestPackageImport(file);
        return;
      }

      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      // Multi-project workspace bundle restores directly across projects
      if (
        parsed &&
        typeof parsed === 'object' &&
        'projects' in parsed &&
        Array.isArray((parsed as { projects: unknown[] }).projects)
      ) {
        const list = (parsed as { projects: ProjectState[] }).projects;
        if (list.length > MAX_BUNDLE_PROJECTS) {
          setBanner({ type: 'error', text: `Gói sao lưu vượt quá giới hạn (${MAX_BUNDLE_PROJECTS} dự án).` });
          return;
        }
        let imported = 0;
        for (const proj of list) {
          const mig = migrateAndValidateProject(proj);
          if (mig.ok) {
            onImportProjectJson(mig.project);
            imported++;
          }
        }
        setBanner({ type: 'success', text: `Đã khôi phục ${imported} dự án từ gói sao lưu!` });
        return;
      }

      const res = onImportProjectJson(parsed);
      if (res.ok) {
        onClose();
      } else {
        setBanner({ type: 'error', text: res.error || 'Tệp JSON không hợp lệ.' });
      }
    } catch {
      setBanner({ type: 'error', text: 'Không thể đọc tệp .hachihi.json / .json.' });
    }
  };

  const handleScannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await onImportScannerFile(file, { diffMerge: scannerDiffMerge });
      onClose();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = '';
    }
  };

  const handleCaptureSnapshotNow = async () => {
    if (!onCreateSnapshot || isSavingSnapshot) return;
    setIsSavingSnapshot(true);
    try {
      const created = await onCreateSnapshot(snapshotLabel.trim() || undefined);
      if (created) {
        setSnapshotLabel('');
        setBanner({
          type: 'success',
          text: `Đã lưu Snapshot "${created.label}" vào IndexedDB.`
        });
      } else {
        setBanner({
          type: 'error',
          text: 'Không thể ghi Snapshot vào IndexedDB.'
        });
      }
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleConfirmRestoreSnapshot = async (snap: ProjectSnapshot) => {
    if (!onRestoreSnapshot || restoringId) return;
    setRestoringId(snap.id);
    try {
      const res = await onRestoreSnapshot(snap.id);
      if (res.ok) {
        setConfirmRestoreId(null);
        setPreviewSnapshotId(null);
        setBanner({
          type: 'success',
          text: `Đã phục hồi dự án về "${res.restoredName || snap.label}" (đã tự động sao lưu trạng thái trước khi phục hồi).`
        });
      } else {
        setBanner({
          type: 'error',
          text: res.error || 'Không thể phục hồi bản Snapshot này.'
        });
      }
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print" role="dialog" aria-modal="true" aria-label="Quản lý dự án & sao lưu">
      <div className="w-full h-dvh sm:h-auto sm:max-w-4xl sm:max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-100 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <HachihiLogo size={36} />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                {isWelcomeMode ? 'Chào mừng đến với HACHIHI Network & Electrical Designer' : 'Quản Lý Nhiều Bản Vẽ & Sao Lưu'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                Lưu trữ cục bộ an toàn bằng IndexedDB · Hỗ trợ nhiều dự án, thùng rác khôi phục & nhập quét mạng
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng quản lý dự án"
            className="touch-target p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Backup Reminder Banner */}
        {daysSinceBackup >= 7 && activeProjects.length > 0 && (
          <div className="px-6 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                {lastBackupAt
                  ? `Đã hơn ${Math.floor(daysSinceBackup)} ngày kể từ lần sao lưu toàn bộ gần nhất. Dữ liệu chỉ lưu tại trình duyệt này.`
                  : 'Chưa có bản sao lưu toàn bộ nào. Hãy tải file JSON dự phòng định kỳ để tránh mất dữ liệu khi xóa bộ nhớ trình duyệt.'}
              </span>
            </div>
            <button
              onClick={handleBackupAll}
              className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Sao lưu ngay</span>
            </button>
          </div>
        )}

        {banner && (
          <div
            className={`px-6 py-2 border-b font-medium flex items-center gap-2 ${
              banner.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
            }`}
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{banner.text}</span>
          </div>
        )}

        <div className="p-6 overflow-y-auto space-y-5">
          {isWelcomeMode && !showFullHubInWelcome ? (
            <div data-testid="welcome-quick-start" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 1. Tạo dự án mới */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2.5 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                      <FolderPlus className="w-4 h-4 text-[#155EEF]" />
                      <span>Tạo dự án mới</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Bắt đầu từ trang vẽ trống gọn gàng, sẵn sàng kéo thả thiết bị.
                    </p>
                    <input
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="Tên dự án mới (VD: Văn phòng A)..."
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-[#155EEF]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onCreateBlank(newName.trim() || 'HACHIHI Dự án Mới');
                      setNewName('');
                      onClose();
                    }}
                    className="w-full py-2 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold transition-colors"
                  >
                    Tạo dự án mới
                  </button>
                </div>

                {/* 2. Mở dự án gần đây */}
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col justify-between space-y-2.5">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                      <FolderOpen className="w-4 h-4 text-sky-600" />
                      <span>Mở dự án gần đây ({activeProjects.length})</span>
                    </div>
                    {activeProjects.length === 0 ? (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Chưa có dự án nào được lưu trên máy.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {activeProjects.slice(0, 3).map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              if (p.id !== currentProjectId) {
                                onSwitchProject(p.id);
                              }
                              onClose();
                            }}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#155EEF] text-left flex items-center justify-between gap-2 transition-colors"
                          >
                            <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                              {p.name}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                              {p.assetCount} TB · Mở
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFullHubInWelcome(true)}
                    className="text-[11px] font-semibold text-[#155EEF] dark:text-blue-400 hover:underline text-left"
                  >
                    Xem toàn bộ danh sách dự án &amp; Snapshot →
                  </button>
                </div>

                {/* 3. Chọn mẫu có sẵn */}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenTemplates();
                  }}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-[#155EEF] bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between transition-colors"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                      <LayoutTemplate className="w-4 h-4 text-indigo-600" />
                      <span>Chọn mẫu có sẵn</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Mạng LAN văn phòng, Tòa nhà 3 tầng, Tủ Rack 42U, CCTV &amp; Wi-Fi dựng sẵn.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#155EEF] dark:text-blue-400 mt-3">
                    Mở thư viện mẫu →
                  </span>
                </button>

                {/* 4. Nhập dự án Excel */}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenExcelImport?.();
                  }}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-[#16A34A] bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between transition-colors"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                      <FileSpreadsheet className="w-4 h-4 text-[#16A34A]" />
                      <span>Nhập dự án Excel</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Nạp file bảng tính (.xlsx / .csv) hoặc tạo nhanh sơ đồ cây Router Cha–Con.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#16A34A] dark:text-emerald-400 mt-3">
                    Mở trình nhập Excel →
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowFullHubInWelcome(true)}
                  className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#155EEF] dark:hover:text-blue-400 hover:underline"
                >
                  Mở tất cả công cụ quản lý (JSON, NetworkScanner, Sao lưu, Thùng rác)
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Tiếp tục bản vẽ hiện tại
                </button>
              </div>
            </div>
          ) : (
          <>
          {/* Quick Start Actions */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <FolderPlus className="w-4 h-4 text-blue-600" />
                <span>Bản vẽ trống mới</span>
              </div>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Tên dự án mới..."
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  onCreateBlank(newName.trim() || 'HACHIHI Dự án Mới');
                  setNewName('');
                  onClose();
                }}
                className="w-full py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Tạo bản vẽ trống
              </button>
            </div>

            <button
              onClick={() => {
                onClose();
                onOpenTemplates();
              }}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between transition-colors"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <LayoutTemplate className="w-4 h-4 text-indigo-600" />
                  <span>Tạo từ Mẫu chuyên ngành</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mạng văn phòng, Tòa nhà 5 tầng, Phòng Server Rack, CCTV &amp; Wi-Fi.
                </p>
              </div>
              <span className="text-[11px] font-semibold text-blue-600 mt-2">Mở thư viện mẫu &rarr;</span>
            </button>

            <label className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between cursor-pointer transition-colors">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  <span>Nhập Gói / JSON dự án</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mở Gói dự án (.hachihi.json), tệp JSON sao lưu đơn lẻ, gói toàn bộ dự án hoặc bản V3.
                </p>
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 mt-2">Chọn .hachihi.json / .json &rarr;</span>
              <input type="file" accept=".hachihi.json,.json" onChange={handleJsonUpload} className="hidden" />
            </label>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-sky-500 bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between transition-colors">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Radar className="w-4 h-4 text-sky-600" />
                  <span>Nhập từ NetworkScanner</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Dựng nhanh sơ đồ từ kết quả quét IP/MAC/Vendor (CSV hoặc JSON).
                </p>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={scannerDiffMerge}
                    onChange={e => setScannerDiffMerge(e.target.checked)}
                    className="rounded accent-sky-600"
                  />
                  <span>Gộp đối chiếu (tránh trùng MAC/IP)</span>
                </label>
              </div>
              <label className="text-[11px] font-semibold text-sky-600 mt-2 cursor-pointer hover:underline inline-block">
                <span>Chọn file quét (.csv/.json) &rarr;</span>
                <input type="file" accept=".csv,.json" onChange={handleScannerUpload} className="hidden" />
              </label>
            </div>
          </div>

          {/* Saved Projects List, Snapshots & Trash Tabs */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveTab('active')}
                  className={`px-3 py-1 rounded-md font-semibold text-xs ${
                    activeTab === 'active' ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Bản vẽ đang lưu ({activeProjects.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('snapshots');
                    void onRefreshSnapshots?.();
                  }}
                  className={`px-3 py-1 rounded-md font-semibold text-xs inline-flex items-center gap-1.5 ${
                    activeTab === 'snapshots'
                      ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Lịch sử Snapshot ({snapshots.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('trash')}
                  className={`px-3 py-1 rounded-md font-semibold text-xs ${
                    activeTab === 'trash' ? 'bg-white dark:bg-slate-900 text-rose-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Thùng rác ({trashedProjects.length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onDuplicateCurrent}
                  className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5 text-blue-600" />
                  <span>Nhân bản bản đang mở</span>
                </button>
                <button
                  type="button"
                  onClick={handleBackupAll}
                  className="px-3 py-1.5 rounded-md bg-slate-900 dark:bg-blue-600 hover:opacity-90 text-white font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Sao lưu toàn bộ (.json)</span>
                </button>
              </div>
            </div>

            {activeTab === 'active' ? (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {activeProjects.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">Chưa có dự án nào được lưu.</div>
                ) : (
                  activeProjects.map(p => {
                    const isCurrent = p.id === currentProjectId;
                    return (
                      <div
                        key={p.id}
                        className={`px-4 py-3 flex items-center justify-between gap-3 ${
                          isCurrent ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {p.name} {isCurrent ? '· Đang mở' : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                            {p.assetCount} Thiết bị · {p.cableCount} Cáp · {p.rackCount} Rack · Cập nhật {new Date(p.lastModified).toLocaleString('vi-VN')}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isCurrent && (
                            <button
                              onClick={() => {
                                onSwitchProject(p.id);
                                onClose();
                              }}
                              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>Mở</span>
                            </button>
                          )}
                          <button
                            onClick={() => onTrashProject(p.id)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            title="Chuyển vào thùng rác"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : activeTab === 'snapshots' ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-xs">
                      <Clock className="w-4 h-4 text-[#155EEF] dark:text-blue-400 shrink-0" />
                      <span>Tự động lưu Snapshot vào IndexedDB mỗi 10 phút</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {lastAutoSnapshotAt
                        ? `Bản gần nhất: ${new Date(lastAutoSnapshotAt).toLocaleString('vi-VN')} (${formatRelativeAge(lastAutoSnapshotAt)})`
                        : 'Chụp tự động mỗi 10 phút khi bản vẽ có thay đổi'}
                      {snapshots.length > 0 && (
                        <>
                          {' '}
                          · Đang lưu <span className="font-semibold text-slate-700 dark:text-slate-200">{snapshots.length}/24</span> bản (
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                            {formatByteSize(totalSnapshotBytes)}
                          </span>
                          )
                        </>
                      )}
                    </p>
                  </div>

                  {onCreateSnapshot && (
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        value={snapshotLabel}
                        onChange={e => setSnapshotLabel(e.target.value)}
                        placeholder="Tên snapshot (tùy chọn)..."
                        aria-label="Tên snapshot tùy chọn"
                        className="w-44 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-[#155EEF]"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCaptureSnapshotNow()}
                        disabled={isSavingSnapshot}
                        className="px-3 py-1.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>{isSavingSnapshot ? 'Đang lưu...' : 'Tạo Snapshot ngay'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {previewSnapshot && (
                  <div className="rounded-xl border border-blue-200 dark:border-blue-800/80 bg-blue-50/40 dark:bg-slate-800/70 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-blue-100 dark:border-slate-700 pb-2.5">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Eye className="w-4 h-4 text-[#155EEF] dark:text-blue-400 shrink-0" />
                          <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                            Xem trước: {previewSnapshot.label}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-mono text-slate-600 dark:text-slate-300">
                            {formatByteSize(snapshotSizeById.get(previewSnapshot.id) ?? 0)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          {new Date(previewSnapshot.createdAt).toLocaleString('vi-VN')} ({formatRelativeAge(previewSnapshot.createdAt)}) · Checksum #{previewSnapshot.checksum.slice(-6)} · Chế độ: {previewSnapshot.snapshot.activeMode}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {onRestoreSnapshot && (
                          <button
                            type="button"
                            disabled={restoringId === previewSnapshot.id}
                            onClick={() => void handleConfirmRestoreSnapshot(previewSnapshot)}
                            className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>
                              {restoringId === previewSnapshot.id ? 'Đang khôi phục...' : 'Khôi phục bản này'}
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPreviewSnapshotId(null)}
                          className="px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                        >
                          Đóng xem trước
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-stretch">
                      <div className="md:col-span-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-white overflow-hidden flex items-center justify-center min-h-[170px] max-h-[240px] p-2">
                        {previewSvgDataUrl ? (
                          <img
                            src={previewSvgDataUrl}
                            alt={`Xem trước sơ đồ ${previewSnapshot.label}`}
                            className="max-w-full max-h-[220px] w-auto h-auto object-contain"
                          />
                        ) : (
                          <div className="text-[11px] text-slate-400">Không thể tạo ảnh xem trước cho snapshot này.</div>
                        )}
                      </div>

                      <div className="md:col-span-5 space-y-2 text-[11px]">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                            <div className="text-slate-400">Thiết bị / Nút vẽ</div>
                            <div className="font-bold text-slate-900 dark:text-white font-mono">
                              {previewSnapshot.assetCount} TB · {previewSnapshot.nodeCount} nút
                            </div>
                          </div>
                          <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                            <div className="text-slate-400">Tuyến cáp / Tủ Rack</div>
                            <div className="font-bold text-slate-900 dark:text-white font-mono">
                              {previewSnapshot.cableCount} cáp · {previewSnapshot.rackCount} Rack
                            </div>
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                            <Layers className="w-3.5 h-3.5 text-[#155EEF]" />
                            <span>Tầng ({previewSnapshot.floorCount}) &amp; Mạng</span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 truncate">
                            {(previewSnapshot.snapshot.floors || []).map(f => f.name).join(', ') || 'Mặt bằng mặc định'}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 font-mono">
                            VLAN: {(previewSnapshot.snapshot.vlans || []).length} · Subnet: {(previewSnapshot.snapshot.subnets || []).length}
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                            <Server className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Thiết bị tiêu biểu</span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 line-clamp-2">
                            {Object.values(previewSnapshot.snapshot.assets || {})
                              .slice(0, 6)
                              .map(a => a.name)
                              .join(', ') || 'Chưa có thiết bị'}
                            {Object.keys(previewSnapshot.snapshot.assets || {}).length > 6
                              ? ` (+${Object.keys(previewSnapshot.snapshot.assets || {}).length - 6} thiết bị khác)`
                              : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  {snapshots.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 space-y-1">
                      <div>Chưa có Snapshot nào cho dự án đang mở.</div>
                      <div className="text-[11px]">
                        Nhấn &ldquo;Tạo Snapshot ngay&rdquo; để lưu mốc hiện tại hoặc chờ chu kỳ tự động 10 phút.
                      </div>
                    </div>
                  ) : (
                    snapshots.map(snap => {
                      const isConfirming = confirmRestoreId === snap.id;
                      const isPreviewing = previewSnapshotId === snap.id;
                      const isRestoring = restoringId === snap.id;
                      const snapBytes = snapshotSizeById.get(snap.id) ?? 0;
                      const triggerBadge =
                        snap.trigger === 'auto_interval'
                          ? {
                              text: 'Tự động 10 phút',
                              cls: 'bg-blue-50 text-[#155EEF] border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                            }
                          : snap.trigger === 'pre_restore'
                          ? {
                              text: 'Trước khi khôi phục',
                              cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                            }
                          : {
                              text: 'Thủ công',
                              cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                            };
                      return (
                        <div
                          key={snap.id}
                          className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isPreviewing
                              ? 'bg-blue-50/60 dark:bg-blue-950/30'
                              : 'bg-white dark:bg-slate-900 hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                                {snap.label}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${triggerBadge.cls}`}
                              >
                                {triggerBadge.text}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span>{new Date(snap.createdAt).toLocaleString('vi-VN')}</span>
                              <span>·</span>
                              <span>{formatRelativeAge(snap.createdAt)}</span>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                                <HardDrive className="w-3 h-3" />
                                {formatByteSize(snapBytes)}
                              </span>
                              <span>·</span>
                              <span>
                                {snap.assetCount} Thiết bị · {snap.cableCount} Cáp · {snap.rackCount} Rack · {snap.floorCount} Tầng
                              </span>
                              <span>·</span>
                              <span className="opacity-75">#{snap.checksum.slice(-6)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewSnapshotId(prev => (prev === snap.id ? null : snap.id))
                              }
                              className={`px-2.5 py-1.5 rounded-md border font-semibold text-xs flex items-center gap-1 ${
                                isPreviewing
                                  ? 'bg-[#155EEF] text-white border-[#155EEF]'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-[#155EEF] hover:text-[#155EEF] dark:hover:text-blue-400'
                              }`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{isPreviewing ? 'Đang xem' : 'Xem trước'}</span>
                            </button>
                            {onRestoreSnapshot &&
                              (isConfirming ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={isRestoring}
                                    onClick={() => void handleConfirmRestoreSnapshot(snap)}
                                    className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>{isRestoring ? 'Đang khôi phục...' : 'Xác nhận khôi phục'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isRestoring}
                                    onClick={() => setConfirmRestoreId(null)}
                                    className="px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                                  >
                                    Hủy
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmRestoreId(snap.id)}
                                  className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:border-emerald-600 hover:text-emerald-700 dark:hover:text-emerald-400 font-semibold text-xs flex items-center gap-1.5"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Khôi phục</span>
                                </button>
                              ))}
                            {onDeleteSnapshot && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirmRestoreId === snap.id) setConfirmRestoreId(null);
                                  if (previewSnapshotId === snap.id) setPreviewSnapshotId(null);
                                  void onDeleteSnapshot(snap.id);
                                }}
                                aria-label={`Xóa snapshot ${snap.label}`}
                                title="Xóa Snapshot này"
                                className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {trashedProjects.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">Thùng rác trống.</div>
                ) : (
                  trashedProjects.map(p => (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 bg-white dark:bg-slate-900">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {p.assetCount} Thiết bị · Xóa lúc {p.trashedAt ? new Date(p.trashedAt).toLocaleString('vi-VN') : '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => onRestoreProject(p.id)}
                          className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Khôi phục</span>
                        </button>
                        <button
                          onClick={() => onDeletePermanently(p.id)}
                          className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                        >
                          Xóa vĩnh viễn
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span>
            {APP_PRODUCT_NAME} v{APP_VERSION} · {BRAND_INFO.websiteLabel} · Hotline {BRAND_INFO.hotlineDisplay}
          </span>
          <div className="flex items-center gap-3">
            {onOpenAbout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAbout();
                }}
                className="inline-flex items-center gap-1 font-semibold text-[#155EEF] dark:text-blue-400 hover:underline"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Giới thiệu &amp; Hỗ trợ</span>
              </button>
            )}
            {isFeedbackFormConfigured() ? (
              <a
                href={buildFeedbackFormUrl() || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200 hover:text-[#155EEF] hover:underline"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Góp ý</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-400" title="Chưa cấu hình liên kết biểu mẫu góp ý">
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Góp ý</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
