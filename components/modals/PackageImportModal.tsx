import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  CopyPlus,
  FileArchive,
  FileCode2,
  History,
  Image as ImageIcon,
  Package,
  Replace,
  ShieldAlert,
  ShieldCheck,
  X
} from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { notifyCadProjectSync } from '../../hooks/useCADController';
import { cadRepository } from '../../cad/storage/CADRepository';
import {
  cloneProjectForNewImport,
  mergeImportedCustomDevices,
  PackagePreviewInspection
} from '../../utils/projectPackage';
import { saveRevisionToDB } from '../../utils/projectStorage';
import { ProjectState } from '../../types/infrastructure';

export interface PackageImportOutcome {
  mode: 'new' | 'overwrite';
  projectName: string;
  restoredRevisions: number;
  restoredCustomDevices: number;
  restoredCadDocuments: number;
  skippedFields: string[];
  migrationWarnings: string[];
}

interface PackageImportModalProps {
  isOpen: boolean;
  inspection: PackagePreviewInspection | null;
  onClose: () => void;
  onCommitProject: (project: ProjectState) => Promise<void> | void;
  onImportCompleted?: (outcome: PackageImportOutcome) => void;
}

export const PackageImportModal: React.FC<PackageImportModalProps> = ({
  isOpen,
  inspection,
  onClose,
  onCommitProject,
  onImportCompleted
}) => {
  const [importRevisions, setImportRevisions] = useState(true);
  const [importCustomDevices, setImportCustomDevices] = useState(true);
  const [importFullLibrary, setImportFullLibrary] = useState(false);
  const [importCadDocuments, setImportCadDocuments] = useState(true);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedReport, setCompletedReport] = useState<PackageImportOutcome | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, isOpen, onClose);

  useEffect(() => {
    setConfirmOverwrite(false);
    setCompletedReport(null);
    setIsProcessing(false);
    setImportRevisions(Boolean(inspection?.revisions.length));
    setImportCustomDevices(Boolean(inspection?.usedCustomDevices.length));
    setImportFullLibrary(false);
    setImportCadDocuments(Boolean(inspection?.cadDocuments.length));
  }, [inspection]);

  if (!isOpen || !inspection) return null;

  const {
    manifest,
    integrityStatus,
    isNewerFormat,
    isNewerSchema,
    newerVersionReason,
    project,
    revisions,
    usedCustomDevices,
    fullCustomLibrary,
    cadDocuments,
    embeddedImageCount,
    conflictingProject,
    skippedFields,
    migrationWarnings
  } = inspection;

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  };

  const handleExecuteImport = async (mode: 'new' | 'overwrite') => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      let targetProject = structuredClone(project);
      let targetRevisions = importRevisions ? structuredClone(revisions) : [];
      let targetCadDocs = importCadDocuments ? structuredClone(cadDocuments) : [];

      if (mode === 'new') {
        const cloned = cloneProjectForNewImport(targetProject, targetRevisions, targetCadDocs);
        targetProject = cloned.project;
        targetRevisions = cloned.revisions;
        targetCadDocs = cloned.cadDocuments;
      } else {
        const now = new Date().toISOString();
        targetProject.lastModified = now;
        targetProject.lastSavedAt = now;
        targetCadDocs = targetCadDocs.map(doc => ({
          ...doc,
          projectId: targetProject.id
        }));
      }

      let restoredCadDocuments = 0;
      if (mode === 'overwrite') {
        await cadRepository.deleteDocumentsForProject(targetProject.id).catch(() => 0);
      }
      for (const cadDoc of targetCadDocs) {
        try {
          await cadRepository.saveDocument(cadDoc);
          restoredCadDocuments++;
        } catch {
          // Non-fatal if CAD storage fails
        }
      }

      await onCommitProject(targetProject);
      notifyCadProjectSync(targetProject.id);

      let restoredRevisions = 0;
      for (const rev of targetRevisions) {
        const saved = await saveRevisionToDB(rev);
        if (saved) restoredRevisions++;
      }

      let restoredCustomDevices = 0;
      const presetsToMerge = [
        ...(importCustomDevices ? usedCustomDevices : []),
        ...(importFullLibrary ? fullCustomLibrary : [])
      ];
      if (presetsToMerge.length > 0) {
        restoredCustomDevices = mergeImportedCustomDevices(presetsToMerge);
      }

      const outcome: PackageImportOutcome = {
        mode,
        projectName: targetProject.name,
        restoredRevisions,
        restoredCustomDevices,
        restoredCadDocuments,
        skippedFields,
        migrationWarnings
      };

      setCompletedReport(outcome);
      onImportCompleted?.(outcome);
    } finally {
      setIsProcessing(false);
    }
  };

  const integrityBanner = (() => {
    switch (integrityStatus) {
      case 'valid':
        return {
          cls: 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200',
          icon: <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />,
          title: 'Xác thực SHA-256 toàn vẹn',
          detail: 'Nội dung tệp khớp 100% với mã kiểm tra, không bị hỏng hoặc chỉnh sửa.'
        };
      case 'tampered':
        return {
          cls: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200',
          icon: <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />,
          title: 'Cảnh báo: Mã kiểm tra SHA-256 không khớp',
          detail: 'Tệp có dấu hiệu bị sửa thủ công hoặc hỏng dữ liệu. Hãy kiểm tra kỹ trước khi nhập.'
        };
      case 'legacy_raw':
        return {
          cls: 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
          icon: <Package className="w-4 h-4 text-slate-500 shrink-0" />,
          title: 'Tệp JSON thô (định dạng cũ)',
          detail: 'Tệp không có mã SHA-256 và gói tài nguyên nhúng, sẽ tự động nâng cấp cấu trúc khi nhập.'
        };
      default:
        return {
          cls: 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200',
          icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
          title: 'Thiếu chữ ký kiểm tra SHA-256',
          detail: 'Không thể xác minh tính nguyên vẹn của gói dự án.'
        };
    }
  })();

  const modalNode = (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Xem trước và nhập gói dự án"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print"
    >
      <div className="w-full h-dvh sm:h-auto sm:max-w-xl sm:max-h-[90dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-100 text-xs pb-safe">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#155EEF] text-white flex items-center justify-center shrink-0">
              <FileArchive className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {completedReport ? 'Báo cáo kết quả nhập dự án' : 'Xem trước Gói dự án (.hachihi.json)'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {inspection.fileName || `${manifest.projectName}.hachihi.json`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp nhập dự án"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {completedReport ? (
          <div className="p-5 overflow-y-auto space-y-4">
            <div
              className={`p-3.5 rounded-lg border flex items-start gap-2.5 ${
                completedReport.skippedFields.length === 0 &&
                completedReport.migrationWarnings.length === 0
                  ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                  : 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-[13px]">
                  {completedReport.skippedFields.length === 0 &&
                  completedReport.migrationWarnings.length === 0
                    ? 'Đã khôi phục đầy đủ dự án'
                    : 'Đã khôi phục dự án (có mục được chuẩn hóa / bỏ qua)'}
                </div>
                <p className="text-xs leading-relaxed">
                  Dự án <strong>{completedReport.projectName}</strong> đã được nhập{' '}
                  {completedReport.mode === 'new' ? 'thành bản sao mới độc lập' : 'và ghi đè bản hiện có'}.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
              <div className="px-3.5 py-2.5">
                <div className="text-xs text-slate-500 dark:text-slate-400">Lịch sử phiên bản</div>
                <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                  {completedReport.restoredRevisions} mốc
                </div>
              </div>
              <div className="px-3.5 py-2.5">
                <div className="text-xs text-slate-500 dark:text-slate-400">Thiết bị tùy chỉnh</div>
                <div className="font-semibold font-mono tabular-nums text-[#155EEF] dark:text-blue-400 mt-0.5">
                  {completedReport.restoredCustomDevices} mẫu
                </div>
              </div>
              <div className="px-3.5 py-2.5">
                <div className="text-xs text-slate-500 dark:text-slate-400">Bản vẽ AutoCAD</div>
                <div className="font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {completedReport.restoredCadDocuments} tệp
                </div>
              </div>
            </div>

            {completedReport.skippedFields.length > 0 && (
              <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 space-y-1.5">
                <div className="font-semibold text-amber-800 dark:text-amber-300">
                  Trường dữ liệu lạ bị bỏ qua ({completedReport.skippedFields.length})
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-xs font-mono text-amber-700 dark:text-amber-200">
                  {completedReport.skippedFields.map(f => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {completedReport.migrationWarnings.length > 0 && (
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1.5">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Ghi chú chuẩn hóa ({completedReport.migrationWarnings.length})
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                  {completedReport.migrationWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                className="ent-btn-primary px-5"
              >
                Mở bản vẽ ngay
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Integrity status */}
              <div className={`p-3 rounded-lg border flex items-start gap-2.5 ${integrityBanner.cls}`}>
                {integrityBanner.icon}
                <div className="space-y-0.5 min-w-0">
                  <div className="font-semibold">{integrityBanner.title}</div>
                  <div className="text-xs leading-relaxed opacity-90">{integrityBanner.detail}</div>
                </div>
              </div>

              {/* Newer version warning */}
              {(isNewerFormat || isNewerSchema) && (
                <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-semibold">Tệp được tạo từ phiên bản ứng dụng mới hơn</div>
                    <div className="text-xs leading-relaxed">
                      {newerVersionReason} Một số thuộc tính mới có thể chưa được hỗ trợ đầy đủ trên phiên bản hiện tại.
                    </div>
                  </div>
                </div>
              )}

              {/* Metadata & Counts */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[13px] text-slate-900 dark:text-white truncate">
                      {project.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      Người xuất: {manifest.exportedBy} · Ngày xuất: {formatDate(manifest.exportedAt)}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    <div>App v{manifest.appVersion}</div>
                    <div>Schema v{manifest.schemaVersion}</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 divide-x divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  <div className="px-3 py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Thiết bị</div>
                    <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                      {Object.keys(project.assets).length}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Tuyến cáp</div>
                    <div className="font-semibold font-mono tabular-nums text-[#155EEF] dark:text-blue-400 mt-0.5">
                      {project.cables.length}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Tủ Rack</div>
                    <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                      {project.racks.length}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Tầng / Phòng</div>
                    <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                      {project.floors.length}/{project.rooms.length}
                    </div>
                  </div>
                </div>
              </div>

              {/* Embedded Extras Selection */}
              {(revisions.length > 0 ||
                usedCustomDevices.length > 0 ||
                fullCustomLibrary.length > 0 ||
                cadDocuments.length > 0 ||
                embeddedImageCount > 0) && (
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    Tài nguyên &amp; dữ liệu đi kèm trong gói
                  </div>

                  {embeddedImageCount > 0 && (
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <ImageIcon className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
                      <span>
                        Đã nhúng sẵn <strong className="font-mono">{embeddedImageCount}</strong> ảnh nền / biểu tượng (tự khôi phục offline).
                      </span>
                    </div>
                  )}

                  {cadDocuments.length > 0 && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer py-0.5">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                        <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>Khôi phục bản vẽ AutoCAD đính kèm ({cadDocuments.length} tệp DXF/CAD)</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={importCadDocuments}
                        onChange={e => setImportCadDocuments(e.target.checked)}
                        className="rounded accent-[#155EEF] w-4 h-4"
                      />
                    </label>
                  )}

                  {usedCustomDevices.length > 0 && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer py-0.5">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                        <Package className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>Nạp {usedCustomDevices.length} thiết bị tùy chỉnh dùng trong bản vẽ</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={importCustomDevices}
                        onChange={e => setImportCustomDevices(e.target.checked)}
                        className="rounded accent-[#155EEF] w-4 h-4"
                      />
                    </label>
                  )}

                  {fullCustomLibrary.length > 0 && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer py-0.5">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                        <Package className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>Nạp toàn bộ thư viện thiết bị tùy chỉnh ({fullCustomLibrary.length} mẫu)</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={importFullLibrary}
                        onChange={e => setImportFullLibrary(e.target.checked)}
                        className="rounded accent-[#155EEF] w-4 h-4"
                      />
                    </label>
                  )}

                  {revisions.length > 0 && (
                    <label className="flex items-center justify-between gap-2 cursor-pointer py-0.5">
                      <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                        <History className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>Khôi phục lịch sử phiên bản có tên ({revisions.length} mốc)</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={importRevisions}
                        onChange={e => setImportRevisions(e.target.checked)}
                        className="rounded accent-[#155EEF] w-4 h-4"
                      />
                    </label>
                  )}
                </div>
              )}

              {/* Conflict Warning */}
              {conflictingProject && (
                <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 space-y-2">
                  <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-semibold">
                        Phát hiện dự án trùng mã ID trên máy này
                      </div>
                      <p className="text-xs leading-relaxed">
                        Bản hiện có: <strong>{conflictingProject.name}</strong> (cập nhật lúc{' '}
                        {formatDate(conflictingProject.lastModified)}). Nên chọn{' '}
                        <strong>Nhập thành bản mới</strong> để tránh mất thay đổi đang làm dở.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Action Bar */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="ent-btn-secondary"
              >
                Hủy
              </button>

              <div className="flex flex-wrap items-center gap-2">
                {conflictingProject && !confirmOverwrite && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => setConfirmOverwrite(true)}
                    className="h-8 px-3 rounded-md border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Replace className="w-3.5 h-3.5" />
                    <span>Ghi đè bản hiện có</span>
                  </button>
                )}

                {conflictingProject && confirmOverwrite && (
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={() => void handleExecuteImport('overwrite')}
                    className="h-8 px-3 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Replace className="w-3.5 h-3.5" />
                    <span>Xác nhận ghi đè</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => void handleExecuteImport('new')}
                  className="ent-btn-primary"
                >
                  <CopyPlus className="w-3.5 h-3.5" />
                  <span>{conflictingProject ? 'Nhập thành bản mới' : 'Nhập dự án'}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modalNode, document.body);
};
