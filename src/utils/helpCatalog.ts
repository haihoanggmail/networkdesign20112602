import {
  SHORTCUT_DEFINITIONS,
  ShortcutActionId,
  ShortcutKeymap,
  formatShortcutDisplay,
  getDefaultShortcutKeymap
} from '../hooks/useKeyboardShortcuts';

export type HelpTopicCategory =
  | 'bat-dau'
  | 've-so-do'
  | 'tu-rack'
  | 'cap-va-bom'
  | 'kiem-tra'
  | 'xuat-ho-so'
  | 'phim-tat';

export type HelpGuideTabId = 'intro' | 'quickstart' | 'rack' | 'building' | 'excel' | 'shortcuts';

export type HelpQuickActionId = 'excel_tree' | 'bom' | 'shortcuts' | 'templates' | 'building';

export interface HelpTopic {
  id: string;
  category: HelpTopicCategory;
  categoryLabel: string;
  title: string;
  summary: string;
  steps: string[];
  keywords: string[];
  guideTab?: HelpGuideTabId;
  quickActionId?: HelpQuickActionId;
  quickActionLabel?: string;
}

export interface HelpShortcutMatch {
  id: ShortcutActionId;
  label: string;
  category: string;
  combo: string;
  displayCombo: string;
}

export const HELP_SUGGESTIONS: string[] = [
  'cây excel',
  'dán văn bản',
  'xuất cây router',
  'khóa lớp',
  'bom vật tư',
  'tủ rack',
  'tỉ lệ',
  'phím tắt',
  'gần đây'
];

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'help-modes',
    category: 'bat-dau',
    categoryLabel: 'Bắt đầu nhanh',
    title: '8 chế độ thiết kế trên một dữ liệu thống nhất',
    summary: 'Chuyển đổi giữa Sơ đồ logic, Đa chi nhánh, Mặt bằng, Tủ rack, Cáp quang, Camera, Wi-Fi và Hệ thống điện.',
    steps: [
      'Chọn chế độ thiết kế từ ô chọn ngay trên thanh trên cùng.',
      'Thiết bị đã đặt giữ nguyên tài sản (IP, VLAN, hãng, model, công suất) xuyên suốt mọi góc nhìn.',
      'Mỗi chế độ hiển thị thêm lớp thông tin chuyên sâu tương ứng như góc Camera FOV hay bán kính sóng Wi-Fi.'
    ],
    keywords: ['che do', 'so do logic', 'mat bang', 'tu rack', 'camera', 'wifi', 'dien', 'da chi nhanh'],
    guideTab: 'intro',
    quickActionId: 'templates',
    quickActionLabel: 'Mở Thư viện mẫu'
  },
  {
    id: 'help-quick-access-recent',
    category: 'bat-dau',
    categoryLabel: 'Bắt đầu nhanh',
    title: 'Thanh Truy cập nhanh & Lịch sử 10 thao tác gần đây',
    summary: 'Truy cập nhanh các lệnh kỹ thuật hay dùng và chạy lại 10 thao tác gần nhất chỉ với 1 lần nhấn.',
    steps: [
      'Thanh Truy cập nhanh nằm ngay dưới thanh trên cùng (tự ẩn khi vào chế độ Tập trung Zen).',
      'Mở Nâng cao → Tiện ích → Lịch sử thao tác trên Thanh Truy cập nhanh hoặc bấm Ctrl+K khi ô tìm trống để xem 10 thao tác gần nhất.',
      'Nhấp vào bất kỳ mục nào trong danh sách để thực thi lại tức thì (1-click replay).'
    ],
    keywords: ['truy cap nhanh', 'quick access', 'gan day', 'lich su', 'recent', '10 thao tac', 'lap lai', 'replay'],
    guideTab: 'intro'
  },
  {
    id: 'help-drag-connect',
    category: 've-so-do',
    categoryLabel: 'Vẽ & Nối cáp',
    title: 'Thêm thiết bị, vẽ phòng và nối cáp thông minh',
    summary: 'Kéo thả từ thư viện bên trái hoặc nhấp đúp để đặt thiết bị và nối cáp vuông góc tránh vật cản.',
    steps: [
      'Kéo thiết bị từ cột Thư viện bên trái vào bản vẽ, hoặc nhấp vào biểu tượng để đặt nhanh.',
      'Nhấn phím C hoặc bấm công cụ Nối dây ở thanh công cụ dọc bên trái, sau đó chọn cổng nguồn và thiết bị đích.',
      'Dùng phím R để vẽ khung phòng kỹ thuật và phím V để chọn, di chuyển hoặc chọn nhiều đối tượng.'
    ],
    keywords: ['keo tha', 'thiet bi', 'noi day', 'cap', 'cong', 've phong', 'cong cu ve'],
    guideTab: 'quickstart'
  },
  {
    id: 'help-layer-lock',
    category: 've-so-do',
    categoryLabel: 'Vẽ & Nối cáp',
    title: 'Quản lý Lớp thiết kế: Ẩn/hiện, khóa lớp & phân lớp tự động',
    summary: 'Đồng bộ hoàn toàn giữa HUD Lớp trên bản vẽ, Thanh Truy cập nhanh và Bảng thuộc tính dự án bên phải.',
    steps: [
      'Mở mục Lớp thiết kế & Hiển thị ở cột Thuộc tính bên phải, nút Lớp trên Thanh Truy cập nhanh hoặc HUD góc dưới phải.',
      'Bấm Mắt để ẩn/hiện, bấm Ổ khóa để khóa/mở chỉnh sửa và bấm Chọn để chọn nhanh toàn bộ đối tượng trên lớp.',
      'Dùng Phân lớp tự động để đưa Switch/Router vào Network, AP/Camera/Sensor vào IoT và UPS/PDU vào Điện.'
    ],
    keywords: ['lop', 'layer', 'khoa lop', 'an hien', 'lock', 'phong ban', 'phan lop tu dong', 'design layers'],
    guideTab: 'quickstart'
  },
  {
    id: 'help-rack',
    category: 'tu-rack',
    categoryLabel: 'Tủ Rack & Điện',
    title: 'Sắp xếp tủ Server Rack 19 inch (mặt trước & mặt sau)',
    summary: 'Nhấp đúp vào tủ Rack để mở mặt dựng U1–U42, kéo thả thiết bị và tính phụ tải điện/nhiệt.',
    steps: [
      'Nhấp đúp vào biểu tượng Tủ Rack trên canvas để mở bảng mặt dựng 19 inch.',
      'Gắn thiết bị vào khe U mặt trước (Switch, Server, Patch Panel) hoặc mặt sau (PDU, UPS).',
      'Hệ thống tự kiểm tra va chạm khe U và cộng tổng công suất (W), tải trọng (kg) và nhiệt lượng (BTU/h).'
    ],
    keywords: ['tu rack', '19 inch', 'khe u', '42u', 'mat truoc', 'mat sau', 'ups', 'pdu', 'server'],
    guideTab: 'rack'
  },
  {
    id: 'help-poe-power',
    category: 'tu-rack',
    categoryLabel: 'Tủ Rack & Điện',
    title: 'Tính toán ngân sách PoE và công suất UPS',
    summary: 'Theo dõi trực quan tổng công suất PoE từng switch so với hạn mức và đề xuất UPS dự phòng 30%.',
    steps: [
      'Chuyển sang tab Điện/Năng lượng bên phải hoặc chọn thiết bị để xem mức tiêu thụ PoE chi tiết.',
      'Trong Vật tư (BOM), thẻ Tổng tải điện & UPS tự tính tổng W thực tế và đề xuất dung lượng UPS (VA) kèm hệ số an toàn 30%.',
      'Kiểm tra kỹ thuật sẽ cảnh báo ngay nếu tổng công suất thiết bị cấp nguồn vượt quá PoE budget của switch.'
    ],
    keywords: ['poe', 'cong suat', 'ups', 'nguon dien', 'ngan sach', 'switch poe', 'watt', 'va'],
    guideTab: 'rack',
    quickActionId: 'bom',
    quickActionLabel: 'Mở Bảng BOM'
  },
  {
    id: 'help-excel-tree',
    category: 'cap-va-bom',
    categoryLabel: 'Cáp & Vật tư (BOM)',
    title: 'Nhập / Xuất Cây Router Excel & Dán văn bản trực tiếp',
    summary: 'Dựng sơ đồ tự động từ file Excel, bảng dán từ Excel hoặc cây thư mục ASCII (Tầng 1 -> Router -> Switch -> PC) và xuất ngược ra Excel.',
    steps: [
      'Mở Nhập / Xuất Cây Excel từ Tệp, Hồ sơ hoặc Nâng cao → Excel trên Thanh Truy cập nhanh.',
      'Chọn Dán văn bản để dán bảng Excel (TSV/CSV) hoặc cây phân cấp dạng ├── / └──, rồi bấm Phân tích & Xem trước.',
      'Tải file mẫu, lọc theo tầng, tìm kiếm thiết bị đồng bộ 3 chế độ Cây / Sơ đồ / Bảng, hoặc bấm Xuất cây từ dự án (.xlsx).'
    ],
    keywords: [
      'cay excel',
      'excel',
      'router cha con',
      'dan van ban',
      'paste',
      'ascii tree',
      'xuat cay router',
      'topology import'
    ],
    guideTab: 'excel',
    quickActionId: 'excel_tree',
    quickActionLabel: 'Mở Cây Excel'
  },
  {
    id: 'help-bom',
    category: 'cap-va-bom',
    categoryLabel: 'Cáp & Vật tư (BOM)',
    title: 'Bảng vật tư (BOM) chi tiết, hao hụt & quy cách cuộn',
    summary: 'Tổng hợp thiết bị, chiều dài cáp thực tế + dự phòng đầu cáp + hao hụt, phụ kiện suy ra và xuất Excel.',
    steps: [
      'Bấm nút Vật tư (BOM) trên thanh trên hoặc trong cột Thuộc tính bên phải.',
      'Điều chỉnh giả định hao hụt cáp đồng/quang, dự phòng mỗi đầu cáp (service loop) và quy cách cuộn (305m/1000m).',
      'Kiểm tra tab Phụ kiện suy ra và Giả định & Đối soát trước khi bấm Xuất Excel (đa sheet công thức sống) hoặc Sao chép BOM.'
    ],
    keywords: ['bom', 'vat tu', 'bang ke', 'du toan', 'hao hut', 'du phong', 'cuon cap', 'phu kien', 'keystone', 'patch cord'],
    guideTab: 'excel',
    quickActionId: 'bom',
    quickActionLabel: 'Mở Bảng BOM'
  },
  {
    id: 'help-scale-measure',
    category: 'cap-va-bom',
    categoryLabel: 'Cáp & Vật tư (BOM)',
    title: 'Đo khoảng cách và đặt tỉ lệ bản vẽ (px/mét)',
    summary: 'Đảm bảo chiều dài cáp trong BOM khớp với kích thước mặt bằng thực tế.',
    steps: [
      'Chọn công cụ Đo (phím M) trên thanh công cụ dọc bên trái để đo khoảng cách giữa hai điểm.',
      'Điều chỉnh tỉ lệ bản vẽ (px / mét) trong phần Thuộc tính dự án nếu chiều dài thực tế khác mặc định.',
      'Chiều dài tuyến cáp dùng cho BOM tự động cập nhật theo tỉ lệ mới.'
    ],
    keywords: ['ti le', 'do khoang cach', 'thuoc do', 'met', 'chieu dai cap', 'scale'],
    guideTab: 'quickstart'
  },
  {
    id: 'help-audit-ip',
    category: 'kiem-tra',
    categoryLabel: 'Kiểm tra & Hạ tầng',
    title: 'Kiểm tra kỹ thuật, tự gán IP và Danh bạ VLAN/Subnet',
    summary: 'Phát hiện trùng IP, sai subnet, vượt chiều dài cáp, quá tải rack và tự đánh số IP theo cây mạng.',
    steps: [
      'Bấm nút Kiểm tra trên thanh trên để xem danh sách lỗi và cảnh báo theo mức độ.',
      'Mở menu Kỹ thuật → Danh bạ Subnet, VLAN & Cáp hoặc chạy Tự động gán IP / VLAN.',
      'Nhập kết quả quét từ NetworkScanner hoặc tệp Excel mẫu để dựng nhanh danh sách thiết bị.'
    ],
    keywords: ['kiem tra ky thuat', 'audit', 'ip', 'vlan', 'subnet', 'trung ip', 'patch panel', 'scanner'],
    guideTab: 'building',
    quickActionId: 'building',
    quickActionLabel: 'Tạo tòa nhà'
  },
  {
    id: 'help-export-backup',
    category: 'xuat-ho-so',
    categoryLabel: 'Xuất hồ sơ & Sao lưu',
    title: 'Xuất PDF khung tên, Excel BOM, Cây Router, DXF, HTML và Gói dự án',
    summary: 'Xuất bộ hồ sơ thi công đầy đủ và sao lưu toàn bộ bản vẽ kèm ảnh nền sang máy khác.',
    steps: [
      'Bấm nút Xuất hồ sơ trên thanh trên hoặc mở menu Hồ sơ.',
      'Chọn PDF khung tên A4, Excel BOM, Cây Router Cha–Con (.xlsx), AutoCAD DXF, SVG/PNG hoặc HTML xem offline.',
      'Để chuyển bản vẽ sang máy tính khác giữ nguyên thiết bị tùy chỉnh và ảnh nền, dùng Gói dự án (.hachihi.json).'
    ],
    keywords: ['xuat ho so', 'pdf', 'excel', 'dxf', 'svg', 'png', 'html', 'sao luu', 'goi du an', 'chuyen may', 'cay router'],
    guideTab: 'excel'
  },
  {
    id: 'help-shortcuts',
    category: 'phim-tat',
    categoryLabel: 'Phím tắt',
    title: 'Phím tắt thao tác nhanh CAD & Bảng lệnh',
    summary: 'Dùng Ctrl+K để mở bảng lệnh tìm kiếm mọi chức năng, thiết bị, thao tác gần đây và phím tắt đang hiệu lực.',
    steps: [
      'Ctrl+K: Mở bảng lệnh tìm kiếm nhanh thiết bị, IP, cáp, hướng dẫn và 10 thao tác gần đây.',
      'V / H / C / R / T / M: Chọn · Kéo vùng nhìn · Nối dây · Vẽ phòng · Chữ · Đo.',
      'Ctrl+Z / Ctrl+Y: Hoàn tác / Làm lại · Ctrl+S: Lưu ngay vào IndexedDB · L: Đồng bộ bảng chú giải.'
    ],
    keywords: ['phim tat', 'ctrl+k', 'bang lenh', 'hoan tac', 'lam lai', 'luu', 'shortcut'],
    guideTab: 'shortcuts',
    quickActionId: 'shortcuts',
    quickActionLabel: 'Tùy chỉnh phím tắt'
  }
];

export function stripVietnameseDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function matchesAccentInsensitiveQuery(haystack: string, query: string): boolean {
  const normalizedQuery = stripVietnameseDiacritics(query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const normalizedHaystack = stripVietnameseDiacritics(haystack);
  return terms.every(term => normalizedHaystack.includes(term));
}

export function searchHelpCatalog(query: string, category?: HelpTopicCategory | 'all'): HelpTopic[] {
  return HELP_TOPICS.filter(topic => {
    if (category && category !== 'all' && topic.category !== category) {
      return false;
    }
    const haystack = [
      'huong dan',
      topic.categoryLabel,
      topic.title,
      topic.summary,
      ...topic.steps,
      ...topic.keywords
    ].join(' ');
    return matchesAccentInsensitiveQuery(haystack, query);
  });
}

export function searchHelpShortcuts(
  query: string,
  keymap: ShortcutKeymap = getDefaultShortcutKeymap()
): HelpShortcutMatch[] {
  const trimmed = query.trim();
  return SHORTCUT_DEFINITIONS.map(def => {
    const combo = keymap[def.id] || def.defaultCombo;
    const displayCombo = formatShortcutDisplay(combo);
    return {
      id: def.id,
      label: def.label,
      category: def.category,
      combo,
      displayCombo
    };
  }).filter(item => {
    if (!trimmed) return true;
    const haystack = `phim tat shortcut ${item.category} ${item.label} ${item.combo} ${item.displayCombo}`;
    return matchesAccentInsensitiveQuery(haystack, trimmed);
  });
}
