import { useEffect, useState, useCallback } from 'react';

export type ShortcutActionId =
  | 'tool_select'
  | 'tool_pan'
  | 'tool_connect'
  | 'tool_rack'
  | 'tool_text'
  | 'tool_room'
  | 'tool_tray'
  | 'tool_measure'
  | 'action_legend'
  | 'auto_route'
  | 'auto_assign_ip'
  | 'export_project'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'save'
  | 'delete'
  | 'select_all'
  | 'group'
  | 'ungroup'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_reset'
  | 'command_palette';

export type ShortcutCategory = 'Tác vụ nhanh' | 'Công cụ' | 'Chỉnh sửa' | 'Khung nhìn';

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  category: ShortcutCategory;
  defaultCombo: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'auto_route',
    label: 'Auto-Route (Định tuyến cáp thông minh)',
    category: 'Tác vụ nhanh',
    defaultCombo: 'ctrl+shift+r'
  },
  {
    id: 'auto_assign_ip',
    label: 'Auto-Assign IP (Gán IP tự động theo topology)',
    category: 'Tác vụ nhanh',
    defaultCombo: 'ctrl+shift+i'
  },
  {
    id: 'export_project',
    label: 'Export (Mở hộp thoại Xuất hồ sơ bản vẽ)',
    category: 'Tác vụ nhanh',
    defaultCombo: 'ctrl+e'
  },
  { id: 'tool_select', label: 'Công cụ Chọn / Di chuyển (Chọn)', category: 'Công cụ', defaultCombo: 'v' },
  { id: 'tool_pan', label: 'Công cụ Kéo khung nhìn (Pan)', category: 'Công cụ', defaultCombo: 'h' },
  { id: 'tool_connect', label: 'Công cụ Nối dây cáp (Nối dây)', category: 'Công cụ', defaultCombo: 'c' },
  { id: 'tool_rack', label: 'Công cụ Tủ Rack (Thêm Tủ Rack 42U)', category: 'Công cụ', defaultCombo: 'shift+r' },
  { id: 'tool_text', label: 'Thêm ghi chú chữ', category: 'Công cụ', defaultCombo: 't' },
  { id: 'tool_room', label: 'Vẽ phòng / khu vực', category: 'Công cụ', defaultCombo: 'r' },
  { id: 'tool_tray', label: 'Vẽ máng cáp / Ống gen (Cable Tray)', category: 'Công cụ', defaultCombo: 'k' },
  { id: 'action_legend', label: 'Tạo / cập nhật bảng chú giải', category: 'Công cụ', defaultCombo: 'l' },
  { id: 'tool_measure', label: 'Thước đo khoảng cách', category: 'Công cụ', defaultCombo: 'm' },
  { id: 'undo', label: 'Hoàn tác (Undo)', category: 'Chỉnh sửa', defaultCombo: 'ctrl+z' },
  { id: 'redo', label: 'Làm lại (Redo)', category: 'Chỉnh sửa', defaultCombo: 'ctrl+y' },
  { id: 'duplicate', label: 'Nhân bản đối tượng', category: 'Chỉnh sửa', defaultCombo: 'ctrl+d' },
  { id: 'save', label: 'Lưu nhanh dự án', category: 'Chỉnh sửa', defaultCombo: 'ctrl+s' },
  { id: 'delete', label: 'Xóa đối tượng đang chọn', category: 'Chỉnh sửa', defaultCombo: 'delete' },
  { id: 'select_all', label: 'Chọn tất cả trên tầng hiện tại', category: 'Chỉnh sửa', defaultCombo: 'ctrl+a' },
  { id: 'group', label: 'Nhóm đối tượng', category: 'Chỉnh sửa', defaultCombo: 'ctrl+g' },
  { id: 'ungroup', label: 'Bỏ nhóm đối tượng', category: 'Chỉnh sửa', defaultCombo: 'ctrl+shift+g' },
  { id: 'zoom_in', label: 'Phóng to bản vẽ', category: 'Khung nhìn', defaultCombo: 'ctrl+=' },
  { id: 'zoom_out', label: 'Thu nhỏ bản vẽ', category: 'Khung nhìn', defaultCombo: 'ctrl+-' },
  { id: 'zoom_reset', label: 'Đặt lại Zoom 100%', category: 'Khung nhìn', defaultCombo: 'ctrl+0' },
  { id: 'command_palette', label: 'Mở Bảng lệnh nhanh', category: 'Khung nhìn', defaultCombo: 'ctrl+k' }
];

export type ShortcutKeymap = Record<ShortcutActionId, string>;

const STORAGE_KEY = 'hachihi_shortcuts_v1';

export function getDefaultShortcutKeymap(): ShortcutKeymap {
  const map = {} as ShortcutKeymap;
  for (const def of SHORTCUT_DEFINITIONS) {
    map[def.id] = def.defaultCombo;
  }
  return map;
}

export function loadShortcutKeymap(): ShortcutKeymap {
  const defaults = getDefaultShortcutKeymap();
  if (typeof window === 'undefined' || !window.localStorage) return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    const merged = { ...defaults };
    for (const def of SHORTCUT_DEFINITIONS) {
      if (typeof parsed[def.id] === 'string' && parsed[def.id].trim()) {
        merged[def.id] = parsed[def.id].trim().toLowerCase();
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveShortcutKeymap(keymap: ShortcutKeymap): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keymap));
  } catch {
    // Ignore storage errors
  }
}

export function findShortcutConflict(
  keymap: ShortcutKeymap,
  targetActionId: ShortcutActionId,
  combo: string
): ShortcutDefinition | undefined {
  const normalized = combo.trim().toLowerCase();
  if (!normalized) return undefined;
  return SHORTCUT_DEFINITIONS.find(
    d =>
      d.id !== targetActionId &&
      (keymap[d.id] || d.defaultCombo).trim().toLowerCase() === normalized
  );
}

export function normalizeKeyboardEventToCombo(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');

  if (key === '+') parts.push('=');
  else if (key === ' ') parts.push('space');
  else parts.push(key);

  return parts.join('+');
}

export function matchesShortcutCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const normalizedTarget = combo.trim().toLowerCase();
  const actual = normalizeKeyboardEventToCombo(e);
  if (!actual) return false;
  if (actual === normalizedTarget) return true;
  if (normalizedTarget === 'delete' && actual === 'backspace') return true;
  if (normalizedTarget === 'ctrl+y' && actual === 'ctrl+shift+z') return true;
  return false;
}

export function formatShortcutDisplay(combo: string): string {
  if (!combo) return '';
  return combo
    .split('+')
    .map(part => {
      if (part === 'ctrl') return 'Ctrl';
      if (part === 'shift') return 'Shift';
      if (part === 'alt') return 'Alt';
      if (part === 'delete') return 'Del';
      if (part === 'backspace') return 'Backspace';
      if (part === 'escape') return 'Esc';
      if (part === '=') return '+';
      return part.toUpperCase();
    })
    .join('+');
}

export function useShortcutKeymap() {
  const [keymap, setKeymap] = useState<ShortcutKeymap>(() => loadShortcutKeymap());

  const updateShortcut = useCallback((actionId: ShortcutActionId, combo: string) => {
    setKeymap(prev => {
      const next = { ...prev, [actionId]: combo.trim().toLowerCase() };
      saveShortcutKeymap(next);
      return next;
    });
  }, []);

  const swapShortcuts = useCallback((actionA: ShortcutActionId, actionB: ShortcutActionId) => {
    setKeymap(prev => {
      const next = {
        ...prev,
        [actionA]: prev[actionB],
        [actionB]: prev[actionA]
      };
      saveShortcutKeymap(next);
      return next;
    });
  }, []);

  const resetSingleShortcut = useCallback((actionId: ShortcutActionId) => {
    const def = SHORTCUT_DEFINITIONS.find(d => d.id === actionId);
    if (!def) return;
    setKeymap(prev => {
      const next = { ...prev, [actionId]: def.defaultCombo };
      saveShortcutKeymap(next);
      return next;
    });
  }, []);

  const resetShortcuts = useCallback(() => {
    const defaults = getDefaultShortcutKeymap();
    saveShortcutKeymap(defaults);
    setKeymap(defaults);
  }, []);

  return { keymap, updateShortcut, swapShortcuts, resetSingleShortcut, resetShortcuts };
}

export function useKeyboardShortcuts(
  keymap: ShortcutKeymap,
  handlers: Partial<Record<ShortcutActionId, () => void>> & { onEscape?: () => void },
  disabled = false
) {
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        handlers.onEscape?.();
        return;
      }

      if (isTyping) {
        if (matchesShortcutCombo(e, keymap.save)) {
          e.preventDefault();
          handlers.save?.();
        }
        return;
      }

      for (const def of SHORTCUT_DEFINITIONS) {
        const combo = keymap[def.id];
        if (!combo) continue;
        if (matchesShortcutCombo(e, combo)) {
          const fn = handlers[def.id];
          if (fn) {
            e.preventDefault();
            fn();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keymap, handlers, disabled]);
}
