import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Keyboard, RotateCcw, X, Check, Search, Sparkles, AlertTriangle } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  SHORTCUT_DEFINITIONS,
  ShortcutActionId,
  ShortcutCategory,
  ShortcutDefinition,
  ShortcutKeymap,
  findShortcutConflict,
  formatShortcutDisplay,
  normalizeKeyboardEventToCombo
} from '../../hooks/useKeyboardShortcuts';
import { matchesAccentInsensitiveQuery } from '../../utils/helpCatalog';

interface ShortcutSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  keymap: ShortcutKeymap;
  onUpdateShortcut: (actionId: ShortcutActionId, combo: string) => void;
  onSwapShortcuts?: (actionA: ShortcutActionId, actionB: ShortcutActionId) => void;
  onResetSingleShortcut?: (actionId: ShortcutActionId) => void;
  onResetShortcuts: () => void;
}

interface ShortcutConflictState {
  combo: string;
  targetId: ShortcutActionId;
  conflictDef: ShortcutDefinition;
}

const CATEGORY_ORDER: ShortcutCategory[] = ['Tác vụ nhanh', 'Công cụ', 'Chỉnh sửa', 'Khung nhìn'];

export const ShortcutSettingsModal: React.FC<ShortcutSettingsModalProps> = ({
  isOpen,
  onClose,
  keymap,
  onUpdateShortcut,
  onSwapShortcuts,
  onResetSingleShortcut,
  onResetShortcuts
}) => {
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [conflictState, setConflictState] = useState<ShortcutConflictState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | ShortcutCategory>('all');
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, isOpen, recordingId ? undefined : onClose);

  useEffect(() => {
    if (!isOpen) {
      setRecordingId(null);
      setConflictState(null);
      setSearchQuery('');
      setActiveCategory('all');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!recordingId) return;
    const handleKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecordingId(null);
        setConflictState(null);
        return;
      }
      const combo = normalizeKeyboardEventToCombo(e);
      if (!combo) return;

      const conflict = findShortcutConflict(keymap, recordingId, combo);
      if (conflict) {
        setConflictState({ combo, targetId: recordingId, conflictDef: conflict });
        return;
      }
      onUpdateShortcut(recordingId, combo);
      setRecordingId(null);
      setConflictState(null);
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [recordingId, keymap, onUpdateShortcut]);

  const customizedCount = useMemo(
    () =>
      SHORTCUT_DEFINITIONS.filter(
        def => (keymap[def.id] || def.defaultCombo).toLowerCase() !== def.defaultCombo.toLowerCase()
      ).length,
    [keymap]
  );

  const filteredDefinitions = useMemo(() => {
    const trimmed = searchQuery.trim();
    return SHORTCUT_DEFINITIONS.filter(def => {
      if (activeCategory !== 'all' && def.category !== activeCategory) return false;
      if (!trimmed) return true;
      const activeCombo = formatShortcutDisplay(keymap[def.id] || def.defaultCombo);
      const haystack = `${def.label} ${def.category} ${def.id} ${activeCombo}`;
      return matchesAccentInsensitiveQuery(haystack, trimmed);
    });
  }, [activeCategory, searchQuery, keymap]);

  const visibleCategories = useMemo(
    () =>
      CATEGORY_ORDER.filter(cat => filteredDefinitions.some(def => def.category === cat)),
    [filteredDefinitions]
  );

  if (!isOpen) return null;

  const handleResetOne = (actionId: ShortcutActionId, defaultCombo: string) => {
    setConflictState(null);
    if (recordingId === actionId) {
      setRecordingId(null);
    }
    if (onResetSingleShortcut) {
      onResetSingleShortcut(actionId);
    } else {
      onUpdateShortcut(actionId, defaultCombo);
    }
  };

  const handleSwapConflict = () => {
    if (!conflictState) return;
    const { targetId, conflictDef } = conflictState;
    if (onSwapShortcuts) {
      onSwapShortcuts(targetId, conflictDef.id);
    } else {
      const targetCurrentCombo = keymap[targetId];
      const conflictCurrentCombo = keymap[conflictDef.id] || conflictDef.defaultCombo;
      onUpdateShortcut(targetId, conflictCurrentCombo);
      onUpdateShortcut(conflictDef.id, targetCurrentCombo);
    }
    setConflictState(null);
    setRecordingId(null);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Quản lý & Tùy chỉnh Phím tắt Hệ thống"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#155EEF]/10 text-[#155EEF] dark:text-blue-400 flex items-center justify-center shrink-0">
              <Keyboard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  Quản lý Phím tắt &amp; Keybinding
                </h2>
                {customizedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-[#155EEF] dark:bg-blue-950/70 dark:text-blue-300 shrink-0">
                    {customizedCount} đã tùy chỉnh
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Nhấp vào phím hiện tại rồi nhấn tổ hợp mới (Chọn, Nối dây, Tủ Rack, Auto-Route, Export)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                onResetShortcuts();
                setRecordingId(null);
                setConflictState(null);
              }}
              disabled={customizedCount === 0}
              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Khôi phục tất cả</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng cửa sổ phím tắt"
              className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search + Category Filter Bar */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm công cụ hoặc phím tắt (vd: Chọn, Nối dây, Tủ Rack, Auto-Route)..."
              aria-label="Tìm kiếm phím tắt"
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 outline-none focus:border-[#155EEF] focus:bg-white dark:focus:bg-slate-900"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                activeCategory === 'all'
                  ? 'bg-[#155EEF] text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Tất cả ({SHORTCUT_DEFINITIONS.length})
            </button>
            {CATEGORY_ORDER.map(cat => {
              const count = SHORTCUT_DEFINITIONS.filter(d => d.category === cat).length;
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors inline-flex items-center gap-1 ${
                    isActive
                      ? 'bg-[#155EEF] text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat === 'Tác vụ nhanh' && <Sparkles className="w-3 h-3" />}
                  <span>{cat}</span>
                  <span className="opacity-75">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {conflictState && (
          <div
            role="alert"
            className="px-5 py-2.5 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-medium flex flex-wrap items-center justify-between gap-2 shrink-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Tổ hợp <span className="font-mono font-bold">{formatShortcutDisplay(conflictState.combo)}</span> đang dùng cho &ldquo;{conflictState.conflictDef.label}&rdquo;.
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleSwapConflict}
                className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold transition-colors"
              >
                Hoán đổi phím
              </button>
              <button
                type="button"
                onClick={() => setConflictState(null)}
                aria-label="Đóng thông báo trùng phím"
                className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Shortcut List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {visibleCategories.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Không tìm thấy tác vụ phù hợp với &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            visibleCategories.map(cat => (
              <div key={cat} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                    {cat === 'Tác vụ nhanh' && (
                      <Sparkles className="w-3.5 h-3.5 text-[#155EEF] dark:text-blue-400" />
                    )}
                    <span>{cat}</span>
                  </div>
                  {cat === 'Tác vụ nhanh' && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      Thao tác kỹ thuật thường dùng
                    </span>
                  )}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  {filteredDefinitions
                    .filter(d => d.category === cat)
                    .map(def => {
                      const isRecording = recordingId === def.id;
                      const currentCombo = keymap[def.id] || def.defaultCombo;
                      const isCustomized =
                        currentCombo.toLowerCase() !== def.defaultCombo.toLowerCase();
                      return (
                        <div
                          key={def.id}
                          className={`px-3.5 py-2.5 flex items-center justify-between gap-3 ${
                            isRecording
                              ? 'bg-blue-50/70 dark:bg-blue-950/30'
                              : 'bg-white dark:bg-slate-900 hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                              {def.label}
                            </span>
                            {isCustomized && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 shrink-0"
                                title={`Mặc định: ${formatShortcutDisplay(def.defaultCombo)}`}
                              >
                                Đã đổi
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isCustomized && (
                              <button
                                type="button"
                                onClick={() => handleResetOne(def.id, def.defaultCombo)}
                                title={`Đặt lại mặc định (${formatShortcutDisplay(def.defaultCombo)})`}
                                aria-label={`Đặt lại phím tắt mặc định cho ${def.label}`}
                                className="p-1.5 rounded-md text-slate-400 hover:text-[#155EEF] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setConflictState(null);
                                setRecordingId(prev => (prev === def.id ? null : def.id));
                              }}
                              aria-label={`Tùy chỉnh phím tắt cho ${def.label}`}
                              className={`min-w-[126px] px-2.5 py-1 rounded-md text-xs font-mono font-semibold border transition-colors text-center ${
                                isRecording
                                  ? 'bg-[#155EEF] text-white border-[#155EEF] animate-pulse'
                                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-[#155EEF]'
                              }`}
                            >
                              {isRecording
                                ? 'Nhấn tổ hợp...'
                                : formatShortcutDisplay(currentCombo)}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 shrink-0">
          <span>Tự động lưu vào localStorage giữa các phiên · Nhấn Esc để hủy ghi phím</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Xong</span>
          </button>
        </div>
      </div>
    </div>
  );
};
