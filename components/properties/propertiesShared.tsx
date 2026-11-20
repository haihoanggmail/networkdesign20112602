import React from 'react';
import { Eye } from 'lucide-react';

export const ReadOnlyInspectorBanner: React.FC = () => (
  <div
    role="status"
    className="mx-3 mt-2.5 px-2.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 flex items-center gap-2 text-xs"
  >
    <Eye className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
    <span className="font-medium leading-snug">
      Chế độ Chỉ xem — Đang khóa chỉnh sửa thuộc tính và thao tác xóa.
    </span>
  </div>
);

export function renderInlineDeleteBanner(
  confirmDeleteKey: string | null,
  setConfirmDeleteKey: (key: string | null) => void,
  key: string,
  label: string,
  onConfirm: () => void,
  isReadOnlyMode = false
) {
  if (isReadOnlyMode || confirmDeleteKey !== key) return null;
  return (
    <div className="mx-3 mt-2.5 p-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/50 flex items-center justify-between gap-2 text-xs">
      <span className="font-semibold text-rose-800 dark:text-rose-200 truncate">
        Xác nhận xóa {label}?
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            setConfirmDeleteKey(null);
            onConfirm();
          }}
          className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold"
        >
          Xóa
        </button>
        <button
          type="button"
          onClick={() => setConfirmDeleteKey(null)}
          className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium"
        >
          Hủy
        </button>
      </div>
    </div>
  );
}
