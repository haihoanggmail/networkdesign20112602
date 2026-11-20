import React, { useMemo, useRef, useState } from 'react';
import { Code2, Edit3, Eye, Paintbrush, X } from 'lucide-react';
import type { AdminTemplateDetail } from '../server/admin/adminTypes';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface AdminTemplatePreviewModalProps {
  detail: AdminTemplateDetail | null;
  onClose: () => void;
  onEdit: (detail: AdminTemplateDetail) => void;
  onEditCanvas: (detail: AdminTemplateDetail) => void;
}

export const AdminTemplatePreviewModal: React.FC<AdminTemplatePreviewModalProps> = ({
  detail,
  onClose,
  onEdit,
  onEditCanvas
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, Boolean(detail), onClose);
  const [tab, setTab] = useState<'overview' | 'templateJson' | 'projectJson'>('overview');

  const previewImageSrc = useMemo(() => {
    if (!detail?.previewContent) return detail?.entry.previewUrl || null;
    if (detail.previewIsBase64) return detail.previewContent;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(detail.previewContent)}`;
  }, [detail]);

  if (!detail) return null;

  const { entry, manifest } = detail;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Xem chi tiết mẫu ${entry.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
    >
      <div className="w-full h-dvh sm:h-auto sm:max-w-5xl sm:max-h-[90dvh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-none sm:rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-slate-800 dark:text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
              {entry.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              <span className="font-mono">public/templates/{entry.slug}</span>
              <span aria-hidden="true">·</span>
              <span>ID: {entry.id}</span>
              <span aria-hidden="true">·</span>
              <span>{entry.category}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">v{entry.version}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {detail.projectJson && (
              <button
                type="button"
                onClick={() => onEditCanvas(detail)}
                className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Paintbrush className="w-3.5 h-3.5 text-[#155EEF]" />
                <span>Sửa Canvas 2D/3D</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onEdit(detail)}
              className="h-9 px-3.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Chỉnh sửa mẫu</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng xem chi tiết"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-nav tabs */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setTab('overview')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              tab === 'overview'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Tổng quan &amp; Ảnh xem trước</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('templateJson')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              tab === 'templateJson'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>template.json</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('projectJson')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              tab === 'projectJson'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>project.json</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white overflow-hidden flex items-center justify-center min-h-[280px]">
                {previewImageSrc ? (
                  <img
                    src={previewImageSrc}
                    alt={`Preview ${entry.name}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full max-h-[420px] object-contain p-3 bg-white"
                  />
                ) : (
                  <div className="p-8 text-xs text-slate-400">Chưa có ảnh preview</div>
                )}
              </div>

              <div className="lg:col-span-5 space-y-4">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Mô tả mẫu
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {manifest.description || 'Chưa có mô tả.'}
                  </p>
                </div>

                <div className="border-t border-b border-slate-200 dark:border-slate-800 py-3 grid grid-cols-2 gap-3 tabular-nums">
                  <div>
                    <div className="text-[11px] text-slate-500">Nút sơ đồ (Nodes)</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                      {entry.stats?.nodes ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Thiết bị (Assets)</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                      {entry.stats?.assets ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Tuyến cáp (Cables)</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                      {entry.stats?.cables ?? 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Tủ Rack / Tầng</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                      {entry.stats?.racks ?? 0} / {entry.stats?.floors ?? 0}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div>
                    <span className="text-slate-500">Chế độ thiết kế: </span>
                    <span className="font-mono font-medium">{manifest.mode}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Tác giả: </span>
                    <span className="font-medium">{manifest.author || 'HACHIHI'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Badge: </span>
                    <span className="font-medium">{manifest.badge || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Tags: </span>
                    <span className="text-slate-700 dark:text-slate-300">
                      {(manifest.tags || []).length > 0 ? (manifest.tags || []).join(' · ') : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'templateJson' && (
            <pre className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-[11px] leading-relaxed overflow-x-auto text-slate-800 dark:text-slate-200">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          )}

          {tab === 'projectJson' && (
            <pre className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-[60vh] text-slate-800 dark:text-slate-200">
              {detail.projectRawText || '// Không có dữ liệu project.json'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
