import { DesignMode } from '../types/infrastructure';

declare const __APP_VERSION__: string | undefined;
declare const __BUILD_HASH__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export const APP_PRODUCT_NAME = 'HACHIHI Network & Electrical Designer';
export const APP_SHORT_NAME = 'HACHIHI';
export const QUICK_TOUR_STORAGE_KEY = 'hachihi_quick_tour_done_v1';

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '3.1.1';

export const APP_BUILD_HASH: string =
  typeof __BUILD_HASH__ !== 'undefined' && __BUILD_HASH__ ? __BUILD_HASH__ : 'local';

export const APP_BUILD_DATE: string =
  typeof __BUILD_DATE__ !== 'undefined' && __BUILD_DATE__ ? __BUILD_DATE__ : '2026-11-16';

export const BRAND_INFO = {
  websiteUrl: 'https://hachihi.vn',
  websiteLabel: 'hachihi.vn',
  hotlineDisplay: '093 384 2126',
  hotlineHref: 'tel:0933842126',
  supportDisplay: '09-1800-1944',
  supportHref: 'tel:0918001944',
  copyright: '© 2026 HACHIHI',
  localStorageNotice: 'Dữ liệu thiết kế được lưu cục bộ trong trình duyệt của bạn (IndexedDB).'
} as const;

export const ABOUT_FEATURES: string[] = [
  'Thiết kế sơ đồ logic, mặt bằng nhiều tầng, tủ rack 19 inch, camera, Wi-Fi, cáp quang, điện trong một công cụ.',
  'Tự động đi tuyến cáp tránh vật cản; đấu nối theo cổng và patch panel.',
  'Kiểm tra kỹ thuật tự động: IP/VLAN, PoE, công suất, chiều dài cáp, rack, thiết bị chưa đấu nối.',
  'Bảng vật tư (BOM) chi tiết, tính hao hụt và quy cách đóng gói, xuất Excel.',
  'Xuất hồ sơ thi công: PDF khung tên, DXF, SVG/PNG, HTML xem độc lập, nhãn cáp, gói bàn giao.',
  'Chạy offline (PWA), dữ liệu lưu trong trình duyệt, sao lưu và chuyển sang máy khác bằng gói dự án.',
  'Điểm lưu phiên bản và so sánh thay đổi.'
];

export const CHANGELOG_HIGHLIGHTS_310: string[] = [
  'Nút Mô hình 3D hiển thị trực tiếp trên thanh thao tác nhanh để chuyển 2D/3D chỉ với 1 nhấp.',
  'Đánh giá công suất UPS & thời gian lưu điện theo đúng thông số W và dung lượng ắc quy (Ah/V/số bình).',
  'Menu chính gom 6 nhóm rõ ràng, thống nhất thuật ngữ tiếng Việt 100%, Tab Giới thiệu HACHIHI & số phiên bản v3.1.1 đồng bộ.',
  'Nâng cấp BOM: chiều đứng thả trần/thông tầng, hao hụt đồng/quang, đối soát chéo và công thức Excel sống.'
];

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};

export const DEFAULT_FEEDBACK_FORM_URL = 'https://forms.gle/qEkFLC1sCtZmRRcU8';

export const FEEDBACK_FORM_URL: string = (
  viteEnv.VITE_FEEDBACK_FORM_URL || DEFAULT_FEEDBACK_FORM_URL
).trim();

export interface FeedbackPrefillEntries {
  version: string;
  build: string;
  mode: string;
  device: string;
}

const FEEDBACK_PREFILL_ENTRIES: FeedbackPrefillEntries = {
  version: (viteEnv.VITE_FEEDBACK_ENTRY_VERSION || '').trim(),
  build: (viteEnv.VITE_FEEDBACK_ENTRY_BUILD || '').trim(),
  mode: (viteEnv.VITE_FEEDBACK_ENTRY_MODE || '').trim(),
  device: (viteEnv.VITE_FEEDBACK_ENTRY_DEVICE || '').trim()
};

export function isFeedbackFormConfigured(baseUrl: string = FEEDBACK_FORM_URL): boolean {
  return /^https?:\/\//i.test((baseUrl || '').trim());
}

export function detectFeedbackDeviceLabel(): string {
  if (typeof window === 'undefined') return 'Desktop';
  const w = window.innerWidth;
  if (w < 768) return 'Mobile';
  if (w < 1180) return 'Tablet';
  return 'Desktop';
}

export function formatFeedbackPrefillUrl(
  baseUrl: string,
  entries: Partial<FeedbackPrefillEntries>,
  context?: {
    activeMode?: DesignMode | string;
    deviceType?: string;
    version?: string;
    buildHash?: string;
  }
): string | null {
  const trimmedBase = (baseUrl || '').trim();
  if (!isFeedbackFormConfigured(trimmedBase)) return null;
  try {
    const hasAnyEntry = Boolean(
      entries.version?.trim() ||
      entries.build?.trim() ||
      (entries.mode?.trim() && context?.activeMode) ||
      entries.device?.trim()
    );
    const url = new URL(trimmedBase);
    if (!hasAnyEntry && url.hostname === 'forms.gle') {
      return trimmedBase;
    }
    url.searchParams.set('usp', 'pp_url');
    if (entries.version?.trim()) {
      url.searchParams.set(entries.version.trim(), context?.version || APP_VERSION);
    }
    if (entries.build?.trim()) {
      url.searchParams.set(entries.build.trim(), context?.buildHash || APP_BUILD_HASH);
    }
    if (entries.mode?.trim() && context?.activeMode) {
      url.searchParams.set(entries.mode.trim(), String(context.activeMode));
    }
    if (entries.device?.trim()) {
      url.searchParams.set(
        entries.device.trim(),
        context?.deviceType || detectFeedbackDeviceLabel()
      );
    }
    return url.toString();
  } catch {
    return trimmedBase;
  }
}

export function buildFeedbackFormUrl(context?: {
  activeMode?: DesignMode | string;
  deviceType?: string;
}): string | null {
  return formatFeedbackPrefillUrl(FEEDBACK_FORM_URL, FEEDBACK_PREFILL_ENTRIES, context);
}
