export const MAX_RECENT_ACTIONS = 10;
const RECENT_ACTIONS_STORAGE_KEY = 'hachihi_recent_actions_v1';

export type ReplayableActionId =
  | 'auto_route_all'
  | 'fit_screen'
  | 'generate_legend'
  | 'auto_assign_ip'
  | 'auto_layer'
  | 'open_audit'
  | 'open_bom'
  | 'open_export'
  | 'export_pdf_a4'
  | 'open_excel_tree'
  | 'export_excel_tree'
  | 'toggle_3d'
  | 'toggle_theme'
  | 'add_rack'
  | 'open_directory'
  | 'open_shortcuts'
  | 'open_guide'
  | 'open_templates'
  | 'open_building'
  | 'save_now'
  | 'undo'
  | 'redo';

export interface RecentActionMeta {
  id: ReplayableActionId;
  defaultLabel: string;
  category: string;
}

export const ACTION_CATALOG_META: Record<ReplayableActionId, RecentActionMeta> = {
  auto_route_all: {
    id: 'auto_route_all',
    defaultLabel: 'Tự định tuyến tất cả cáp',
    category: 'Tuyến cáp'
  },
  fit_screen: {
    id: 'fit_screen',
    defaultLabel: 'Thu gọn vừa khung nhìn',
    category: 'Khung nhìn'
  },
  generate_legend: {
    id: 'generate_legend',
    defaultLabel: 'Tạo / Đồng bộ Bảng chú giải',
    category: 'Bản vẽ'
  },
  auto_assign_ip: {
    id: 'auto_assign_ip',
    defaultLabel: 'Tự động gán IP theo sơ đồ',
    category: 'Hạ tầng'
  },
  auto_layer: {
    id: 'auto_layer',
    defaultLabel: 'Phân lớp tự động thiết bị',
    category: 'Lớp thiết kế'
  },
  open_audit: {
    id: 'open_audit',
    defaultLabel: 'Kiểm tra kỹ thuật (Audit)',
    category: 'Kiểm tra'
  },
  open_bom: {
    id: 'open_bom',
    defaultLabel: 'Xem Thống kê Vật tư (BOM)',
    category: 'Dự toán'
  },
  open_export: {
    id: 'open_export',
    defaultLabel: 'Mở hộp thoại Xuất hồ sơ',
    category: 'Xuất hồ sơ'
  },
  export_pdf_a4: {
    id: 'export_pdf_a4',
    defaultLabel: 'Xuất nhanh PDF A4',
    category: 'Xuất hồ sơ'
  },
  open_excel_tree: {
    id: 'open_excel_tree',
    defaultLabel: 'Nhập / Dán sơ đồ cây Router',
    category: 'Excel Topology'
  },
  export_excel_tree: {
    id: 'export_excel_tree',
    defaultLabel: 'Xuất cây Router Cha–Con (.xlsx)',
    category: 'Excel Topology'
  },
  toggle_3d: {
    id: 'toggle_3d',
    defaultLabel: 'Chuyển đổi góc nhìn 2D / 3D',
    category: 'Khung nhìn'
  },
  toggle_theme: {
    id: 'toggle_theme',
    defaultLabel: 'Đổi giao diện Sáng / Tối',
    category: 'Giao diện'
  },
  add_rack: {
    id: 'add_rack',
    defaultLabel: 'Thêm tủ Rack 42U',
    category: 'Thiết bị'
  },
  open_directory: {
    id: 'open_directory',
    defaultLabel: 'Mở Danh bạ Subnet, Cáp & Phiên bản',
    category: 'Hạ tầng'
  },
  open_shortcuts: {
    id: 'open_shortcuts',
    defaultLabel: 'Mở cài đặt phím tắt',
    category: 'Hệ thống'
  },
  open_guide: {
    id: 'open_guide',
    defaultLabel: 'Tìm kiếm hướng dẫn sử dụng',
    category: 'Trợ giúp'
  },
  open_templates: {
    id: 'open_templates',
    defaultLabel: 'Mở thư viện mẫu thiết kế',
    category: 'Dự án'
  },
  open_building: {
    id: 'open_building',
    defaultLabel: 'Cấu hình tòa nhà nhiều tầng',
    category: 'Mặt bằng'
  },
  save_now: {
    id: 'save_now',
    defaultLabel: 'Lưu dự án vào IndexedDB',
    category: 'Lưu trữ'
  },
  undo: {
    id: 'undo',
    defaultLabel: 'Hoàn tác thao tác (Undo)',
    category: 'Chỉnh sửa'
  },
  redo: {
    id: 'redo',
    defaultLabel: 'Làm lại thao tác (Redo)',
    category: 'Chỉnh sửa'
  }
};

export interface RecentActionEntry {
  id: ReplayableActionId;
  label: string;
  category: string;
  timestamp: number;
  count: number;
}

const VALID_ACTION_ID_SET = new Set<string>(Object.keys(ACTION_CATALOG_META));

export function isValidReplayableActionId(value: unknown): value is ReplayableActionId {
  return typeof value === 'string' && VALID_ACTION_ID_SET.has(value);
}

/**
 * Inserts or promotes an action to the top of the recent history (MRU), capped at MAX_RECENT_ACTIONS (10).
 */
export function pushRecentAction(
  current: RecentActionEntry[],
  id: ReplayableActionId,
  customLabel?: string,
  timestamp = Date.now()
): RecentActionEntry[] {
  const meta = ACTION_CATALOG_META[id];
  if (!meta) return current;
  const existing = current.find(item => item.id === id);
  const nextEntry: RecentActionEntry = {
    id,
    label: (customLabel && customLabel.trim()) || meta.defaultLabel,
    category: meta.category,
    timestamp,
    count: (existing?.count || 0) + 1
  };
  const filtered = current.filter(item => item.id !== id);
  return [nextEntry, ...filtered].slice(0, MAX_RECENT_ACTIONS);
}

export function loadRecentActions(): RecentActionEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_ACTIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: RecentActionEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const rawId = rec.id;
      if (!isValidReplayableActionId(rawId)) continue;
      const meta = ACTION_CATALOG_META[rawId];
      valid.push({
        id: rawId,
        label: typeof rec.label === 'string' && rec.label.trim() ? rec.label : meta.defaultLabel,
        category: typeof rec.category === 'string' && rec.category.trim() ? rec.category : meta.category,
        timestamp: typeof rec.timestamp === 'number' && Number.isFinite(rec.timestamp) ? rec.timestamp : Date.now(),
        count: typeof rec.count === 'number' && rec.count > 0 ? Math.floor(rec.count) : 1
      });
      if (valid.length >= MAX_RECENT_ACTIONS) break;
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveRecentActions(entries: RecentActionEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      RECENT_ACTIONS_STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_RECENT_ACTIONS))
    );
  } catch {
    // Ignore storage quota or security errors
  }
}

export function clearRecentActionsStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(RECENT_ACTIONS_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function formatRecentActionAge(timestamp: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 15) return 'Vừa xong';
  if (diffSec < 60) return `${diffSec}s trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}p trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h trước`;
  return new Date(timestamp).toLocaleDateString('vi-VN');
}
