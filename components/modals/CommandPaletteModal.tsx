import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ProjectState } from '../../types/infrastructure';
import { UIDensity } from '../../hooks/useWorkspaceLayout';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  ShortcutKeymap,
  formatShortcutDisplay,
  getDefaultShortcutKeymap
} from '../../hooks/useKeyboardShortcuts';
import {
  matchesAccentInsensitiveQuery,
  searchHelpCatalog,
  searchHelpShortcuts
} from '../../utils/helpCatalog';
import { RecentActionEntry, formatRecentActionAge } from '../../utils/recentActions';
import {
  RotateCcw,
  Search,
  Command,
  Route,
  Maximize,
  Table2,
  ShieldCheck,
  Download,
  Cuboid,
  Bot,
  Sun,
  Moon,
  Save,
  Contrast,
  SlidersHorizontal,
  Activity,
  Server,
  GitBranch,
  Keyboard,
  FileDown,
  Eye,
  ListTree,
  Network,
  Wand2,
  ClipboardList,
  Info,
  BookOpen,
  Layers,
  FileSpreadsheet,
  LayoutTemplate,
  Building2,
  Copy,
  CheckSquare,
  X
} from 'lucide-react';

export interface CommandPaletteAction {
  id: string;
  title: string;
  subtitle: string;
  category:
    | 'Thao tác gần đây'
    | 'Thao tác nhanh'
    | 'Giao diện & Trợ năng'
    | 'Thiết bị & Tủ Rack'
    | 'Tuyến cáp'
    | 'Hướng dẫn & Tra cứu';
  keywords?: string[];
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  project: ProjectState;
  density: UIDensity;
  highContrast: boolean;
  reducedMotion: boolean;
  is3DView: boolean;
  isAiAvailable?: boolean;
  isReadOnlyMode?: boolean;
  recentActions?: RecentActionEntry[];
  onReplayRecentAction?: (entry: RecentActionEntry) => void;
  keymap?: ShortcutKeymap;
  onClose: () => void;
  onAutoRouteAllCables: () => void;
  onFitToScreen: () => void;
  onGenerateLegend: () => void;
  onOpenAudit: () => void;
  onOpenExport: () => void;
  onOpenBomModal?: () => void;
  onToggle3D: () => void;
  onToggleAiChat: () => void;
  onToggleTheme: () => void;
  onToggleDensity: () => void;
  onToggleHighContrast: () => void;
  onToggleReducedMotion: () => void;
  onToggleReadOnly?: () => void;
  onToggleOutline?: () => void;
  onOpenDirectory?: () => void;
  onSaveNow: () => void;
  onJumpToNode: (nodeId: string) => void;
  onSelectCable: (cableId: string) => void;
  onOpenShortcuts?: () => void;
  onExportA4Pdf?: () => void;
  onAutoAssignIps?: () => void;
  onAutoLayerDevices?: () => void;
  onOpenExcelTree?: () => void;
  onOpenTemplates?: () => void;
  onOpenBuildingGenerator?: () => void;
  onDuplicateSelected?: () => void;
  onSelectAll?: () => void;
  onOpenAbout?: () => void;
  onOpenGuide?: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  project,
  density,
  highContrast,
  reducedMotion,
  is3DView,
  isAiAvailable = false,
  isReadOnlyMode = false,
  recentActions = [],
  onReplayRecentAction,
  keymap,
  onClose,
  onAutoRouteAllCables,
  onFitToScreen,
  onGenerateLegend,
  onOpenAudit,
  onOpenExport,
  onOpenBomModal,
  onToggle3D,
  onToggleAiChat,
  onToggleTheme,
  onToggleDensity,
  onToggleHighContrast,
  onToggleReducedMotion,
  onToggleReadOnly,
  onToggleOutline,
  onOpenDirectory,
  onSaveNow,
  onJumpToNode,
  onSelectCable,
  onOpenShortcuts,
  onExportA4Pdf,
  onAutoAssignIps,
  onAutoLayerDevices,
  onOpenExcelTree,
  onOpenTemplates,
  onOpenBuildingGenerator,
  onDuplicateSelected,
  onSelectAll,
  onOpenAbout,
  onOpenGuide
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  const activeKeymap = useMemo(() => keymap || getDefaultShortcutKeymap(), [keymap]);

  const actions: CommandPaletteAction[] = useMemo(() => {
    const base: CommandPaletteAction[] = [
      {
        id: 'cmd-autoroute-all',
        title: 'Tự định tuyến toàn bộ tuyến cáp (Tránh vật cản)',
        subtitle: 'Tự động đi dây vuông góc vòng qua thiết bị và tủ Rack trên trang vẽ',
        category: 'Thao tác nhanh',
        shortcut: formatShortcutDisplay(activeKeymap.auto_route),
        keywords: ['auto route', 'tu dinh tuyen', 'di day', 'tranh vat can', 'cap'],
        icon: <Route className="w-4 h-4 text-blue-600" />,
        run: onAutoRouteAllCables
      },
      ...(onAutoAssignIps && !isReadOnlyMode
        ? [
            {
              id: 'cmd-auto-assign-ips',
              title: 'Tự động gán địa chỉ IP theo sơ đồ',
              subtitle: 'Đánh số IP, Subnet Mask & Gateway từ Router/Core xuống thiết bị theo sơ đồ kết nối',
              category: 'Thao tác nhanh' as const,
              shortcut: formatShortcutDisplay(activeKeymap.auto_assign_ip),
              keywords: ['tu gan ip', 'cap phat ip', 'subnet', 'gateway', 'ipam'],
              icon: <Wand2 className="w-4 h-4 text-blue-600" />,
              run: onAutoAssignIps
            }
          ]
        : []),
      ...(onAutoLayerDevices && !isReadOnlyMode
        ? [
            {
              id: 'cmd-auto-layer-devices',
              title: 'Tự động phân lớp thiết bị (Network / IoT / Điện)',
              subtitle: 'Chuyển Switch/Router vào lớp Network, Cảm biến/AP/Camera vào IoT, UPS/PDU vào Điện',
              category: 'Thao tác nhanh' as const,
              keywords: ['phan lop', 'auto layer', 'layer', 'iot', 'network', 'dien', 'switch', 'sensor'],
              icon: <Layers className="w-4 h-4 text-teal-600" />,
              run: onAutoLayerDevices
            }
          ]
        : []),
      {
        id: 'cmd-fit-view',
        title: 'Thu gọn vừa khung nhìn',
        subtitle: 'Căn toàn bộ sơ đồ vào giữa màn hình hiện tại',
        category: 'Thao tác nhanh',
        keywords: ['fit', 'thu gon', 'vua khung', 'zoom'],
        icon: <Maximize className="w-4 h-4 text-blue-600" />,
        run: onFitToScreen
      },
      ...(!is3DView
        ? [
            {
              id: 'cmd-legend',
              title: 'Tạo / Đồng bộ Bảng chú giải',
              subtitle: 'Thống kê số lượng thiết bị, ký hiệu và quy chuẩn màu dây cáp',
              category: 'Thao tác nhanh' as const,
              keywords: ['chu giai', 'legend', 'ky hieu'],
              icon: <Table2 className="w-4 h-4 text-emerald-600" />,
              run: onGenerateLegend
            }
          ]
        : []),
      {
        id: 'cmd-audit',
        title: 'Kiểm tra kỹ thuật',
        subtitle: 'Kiểm tra trùng IP, VLAN, quá tải PoE/Rack và trùng đè thiết bị',
        category: 'Thao tác nhanh',
        keywords: ['ip trung', 'trung ip', 'audit', 'kiem tra loi', 'poe', 'rack', 'tia-568'],
        icon: <ShieldCheck className="w-4 h-4 text-amber-600" />,
        run: onOpenAudit
      },
      ...(onExportA4Pdf
        ? [
            {
              id: 'cmd-export-pdf-a4',
              title: is3DView ? 'Xuất nhanh bản vẽ PDF A4 (Góc nhìn 3D)' : 'In / Xuất bản vẽ PDF A4',
              subtitle: is3DView
                ? 'Chụp mô hình 3D hiện tại và đóng gói vào hồ sơ PDF A4'
                : 'Xuất sơ đồ hiện tại sang PDF A4 giữ nguyên thước tỷ lệ và bảng chú giải',
              category: 'Thao tác nhanh' as const,
              keywords: ['xuat pdf', 'in pdf', 'pdf a4', 'ban ve', '3d'],
              icon: <FileDown className="w-4 h-4 text-[#155EEF]" />,
              run: onExportA4Pdf
            }
          ]
        : []),
      ...(onOpenBomModal
        ? [
            {
              id: 'cmd-bom-modal',
              title: 'Xem Thống kê Vật tư & Dự toán (BOM)',
              subtitle: 'Tổng hợp thiết bị, chiều dài cáp (+dự phòng), tải UPS/kg theo tầng & xuất Excel/CSV',
              category: 'Thao tác nhanh' as const,
              keywords: ['bom', 'vat tu', 'bang ke', 'du toan', 'hao hut', 'ups', 'xuat excel bom'],
              icon: <ClipboardList className="w-4 h-4 text-[#155EEF]" />,
              run: onOpenBomModal
            }
          ]
        : []),
      ...(onOpenExcelTree
        ? [
            {
              id: 'cmd-excel-tree',
              title: 'Nhập / Xuất Cây Router Excel (.xlsx)',
              subtitle: 'Tải mẫu Excel, dán văn bản cây thư mục hoặc xuất sơ đồ phân cấp từ dự án',
              category: 'Thao tác nhanh' as const,
              keywords: ['excel', 'cay router', 'import excel', 'export excel', 'mau excel'],
              icon: <FileSpreadsheet className="w-4 h-4 text-[#16A34A]" />,
              run: onOpenExcelTree
            }
          ]
        : []),
      ...(onOpenTemplates && !isReadOnlyMode
        ? [
            {
              id: 'cmd-templates',
              title: 'Mở Thư viện mẫu chuẩn',
              subtitle: 'Chọn sơ đồ mẫu LAN/WAN, văn phòng 3 tầng, tủ Rack hoặc CCTV',
              category: 'Thao tác nhanh' as const,
              keywords: ['mau', 'template', 'thu vien mau'],
              icon: <LayoutTemplate className="w-4 h-4 text-indigo-600" />,
              run: onOpenTemplates
            }
          ]
        : []),
      ...(onOpenBuildingGenerator && !isReadOnlyMode
        ? [
            {
              id: 'cmd-building',
              title: 'Cấu hình tòa nhà nhiều tầng',
              subtitle: 'Khởi tạo nhanh mặt bằng nhiều tầng và trục riser',
              category: 'Thao tác nhanh' as const,
              keywords: ['toa nha', 'building', 'nhieu tang'],
              icon: <Building2 className="w-4 h-4 text-slate-600" />,
              run: onOpenBuildingGenerator
            }
          ]
        : []),
      ...(onDuplicateSelected && !isReadOnlyMode
        ? [
            {
              id: 'cmd-duplicate-selected',
              title: 'Sao chép / Nhân bản đối tượng đang chọn',
              subtitle: 'Tạo bản sao thiết bị giữ nguyên thông số kỹ thuật',
              category: 'Thao tác nhanh' as const,
              shortcut: formatShortcutDisplay(activeKeymap.duplicate),
              keywords: ['sao chep', 'nhan ban', 'duplicate', 'copy'],
              icon: <Copy className="w-4 h-4 text-slate-600" />,
              run: onDuplicateSelected
            }
          ]
        : []),
      ...(onSelectAll
        ? [
            {
              id: 'cmd-select-all',
              title: 'Chọn tất cả đối tượng trên trang',
              subtitle: 'Chọn toàn bộ thiết bị trên chế độ/tầng đang mở',
              category: 'Thao tác nhanh' as const,
              shortcut: formatShortcutDisplay(activeKeymap.select_all),
              keywords: ['chon tat ca', 'select all'],
              icon: <CheckSquare className="w-4 h-4 text-slate-600" />,
              run: onSelectAll
            }
          ]
        : []),
      {
        id: 'cmd-export',
        title: 'Xuất bản vẽ (Excel / PDF / SVG / DXF)',
        subtitle: 'Mở hộp thoại xuất hồ sơ thi công và sao lưu JSON',
        category: 'Thao tác nhanh',
        shortcut: formatShortcutDisplay(activeKeymap.export_project),
        keywords: ['xuat ho so', 'dxf', 'svg', 'png', 'html', 'excel', 'csv', 'goi du an'],
        icon: <Download className="w-4 h-4 text-blue-600" />,
        run: onOpenExport
      },
      {
        id: 'cmd-save',
        title: 'Lưu ngay dự án vào IndexedDB',
        subtitle: 'Ghi bản lưu an toàn trong trình duyệt',
        category: 'Thao tác nhanh',
        shortcut: formatShortcutDisplay(activeKeymap.save),
        icon: <Save className="w-4 h-4 text-emerald-600" />,
        run: onSaveNow
      },
      {
        id: 'cmd-3d',
        title: is3DView ? 'Quay lại bản vẽ 2D' : 'Mở không gian mô phỏng 3D',
        subtitle: 'Chuyển đổi giữa sơ đồ 2D và phối cảnh 3D',
        category: 'Thao tác nhanh',
        icon: <Cuboid className="w-4 h-4 text-indigo-600" />,
        run: onToggle3D
      },
      ...(isAiAvailable
        ? [
            {
              id: 'cmd-ai-chat',
              title: 'Mở Trợ lý Kỹ thuật Hạ tầng',
              subtitle: 'Tư vấn topology, công suất UPS, PoE & chuẩn TIA-606',
              category: 'Thao tác nhanh' as const,
              icon: <Bot className="w-4 h-4 text-indigo-600" />,
              run: onToggleAiChat
            }
          ]
        : []),
      ...(onToggleReadOnly
        ? [
            {
              id: 'cmd-readonly',
              title: isReadOnlyMode ? 'Thoát chế độ Chỉ xem (Mở chỉnh sửa)' : 'Bật chế độ Chỉ xem / Trình bày',
              subtitle: 'Khóa di chuyển và chỉnh sửa ngoài ý muốn khi kiểm tra hoặc thuyết trình',
              category: 'Giao diện & Trợ năng' as const,
              icon: <Eye className="w-4 h-4 text-sky-600" />,
              run: onToggleReadOnly
            }
          ]
        : []),
      ...(onToggleOutline
        ? [
            {
              id: 'cmd-outline',
              title: 'Bật / Tắt Danh sách đối tượng',
              subtitle: 'Duyệt nhanh tầng, phòng, tủ Rack, thiết bị, cáp bằng bàn phím',
              category: 'Giao diện & Trợ năng' as const,
              shortcut: 'Alt+O',
              icon: <ListTree className="w-4 h-4 text-blue-600" />,
              run: onToggleOutline
            }
          ]
        : []),
      ...(onOpenDirectory
        ? [
            {
              id: 'cmd-directory',
              title: 'Mở Danh bạ Subnet/VLAN, Bảng Cáp & Phiên bản',
              subtitle: 'Quản lý IPAM, Patch Panel, lịch sử phiên bản và gói bàn giao ZIP',
              category: 'Thao tác nhanh' as const,
              icon: <Network className="w-4 h-4 text-emerald-600" />,
              run: onOpenDirectory
            }
          ]
        : []),
      {
        id: 'cmd-theme',
        title: project.settings.isDarkMode ? 'Chuyển sang Giao diện Sáng' : 'Chuyển sang Giao diện Tối',
        subtitle: 'Đổi tông màu nền làm việc',
        category: 'Giao diện & Trợ năng',
        icon: project.settings.isDarkMode ? (
          <Sun className="w-4 h-4 text-amber-500" />
        ) : (
          <Moon className="w-4 h-4 text-blue-600" />
        ),
        run: onToggleTheme
      },
      {
        id: 'cmd-density',
        title: `Đổi mật độ giao diện (Hiện tại: ${density === 'compact' ? 'Gọn' : 'Thoải mái'})`,
        subtitle: 'Chuyển giữa Gọn (nhiều không gian) và Thoải mái (vùng chạm lớn)',
        category: 'Giao diện & Trợ năng',
        icon: <SlidersHorizontal className="w-4 h-4 text-blue-600" />,
        run: onToggleDensity
      },
      {
        id: 'cmd-contrast',
        title: highContrast ? 'Tắt chế độ Tương phản cao' : 'Bật chế độ Tương phản cao',
        subtitle: 'Tăng độ đậm viền và chữ để dễ đọc ngoài công trường',
        category: 'Giao diện & Trợ năng',
        icon: <Contrast className="w-4 h-4 text-slate-700 dark:text-slate-200" />,
        run: onToggleHighContrast
      },
      {
        id: 'cmd-motion',
        title: reducedMotion ? 'Bật lại hiệu ứng chuyển động' : 'Giảm chuyển động',
        subtitle: 'Tắt hiệu ứng trượt/phóng to cho thiết bị yếu hoặc nhạy cảm chuyển động',
        category: 'Giao diện & Trợ năng',
        icon: <Activity className="w-4 h-4 text-slate-500" />,
        run: onToggleReducedMotion
      },
      ...(onOpenShortcuts
        ? [
            {
              id: 'cmd-shortcuts',
              title: 'Cài đặt phím tắt bàn phím',
              subtitle: 'Xem và gán lại tổ hợp phím cho công cụ, chỉnh sửa & thu phóng',
              category: 'Giao diện & Trợ năng' as const,
              icon: <Keyboard className="w-4 h-4 text-[#155EEF]" />,
              run: onOpenShortcuts
            }
          ]
        : []),
      ...(onOpenGuide
        ? [
            {
              id: 'cmd-guide',
              title: 'Tài liệu hướng dẫn & Tìm kiếm trợ giúp',
              subtitle: 'Tra cứu thao tác vẽ, khóa lớp, tủ Rack, BOM và phím tắt',
              category: 'Giao diện & Trợ năng' as const,
              keywords: ['huong dan', 'tro giup', 'help', 'an layer', 'khoa lop'],
              icon: <BookOpen className="w-4 h-4 text-[#155EEF]" />,
              run: onOpenGuide
            }
          ]
        : []),
      ...(onOpenAbout
        ? [
            {
              id: 'cmd-about',
              title: 'Giới thiệu HACHIHI & Liên hệ hỗ trợ',
              subtitle: 'Thông tin phiên bản, hachihi.vn, hotline kỹ thuật & gửi góp ý',
              category: 'Giao diện & Trợ năng' as const,
              keywords: ['gioi thieu', 'hachihi', 'hotline', 'gop y', 'phien ban'],
              icon: <Info className="w-4 h-4 text-[#155EEF]" />,
              run: onOpenAbout
            }
          ]
        : [])
    ];

    const nodeItems: CommandPaletteAction[] = project.nodes.slice(0, 60).map(n => {
      const asset = n.assetId ? project.assets[n.assetId] : undefined;
      return {
        id: `node-${n.id}`,
        title: n.label,
        subtitle: `${asset?.ipAddress ? `${asset.ipAddress} · ` : ''}${asset?.model || n.type} (${n.diagramMode})`,
        category: 'Thiết bị & Tủ Rack',
        keywords: [asset?.category || '', asset?.vendor || '', asset?.vlan ? `vlan ${asset.vlan}` : ''],
        icon: <Server className="w-4 h-4 text-sky-600" />,
        run: () => onJumpToNode(n.id)
      };
    });

    const cableItems: CommandPaletteAction[] = project.cables.slice(0, 40).map(c => ({
      id: `cable-${c.id}`,
      title: `${c.cableCode}${c.label ? ` · ${c.label}` : ''}`,
      subtitle: `${c.cableType} · ${c.bandwidth} · ${c.lengthMeters}m`,
      category: 'Tuyến cáp',
      keywords: [c.cableType, c.bandwidth, c.vlan ? `vlan ${c.vlan}` : ''],
      icon: <GitBranch className="w-4 h-4 text-emerald-600" />,
      run: () => onSelectCable(c.id)
    }));

    return [...base, ...nodeItems, ...cableItems];
  }, [
    project,
    density,
    highContrast,
    reducedMotion,
    is3DView,
    isAiAvailable,
    isReadOnlyMode,
    onAutoRouteAllCables,
    onFitToScreen,
    onGenerateLegend,
    onOpenAudit,
    onOpenExport,
    onOpenBomModal,
    onToggle3D,
    onToggleAiChat,
    onToggleTheme,
    onToggleDensity,
    onToggleHighContrast,
    onToggleReducedMotion,
    onToggleReadOnly,
    onToggleOutline,
    onOpenDirectory,
    onSaveNow,
    onJumpToNode,
    onSelectCable,
    onOpenShortcuts,
    onExportA4Pdf,
    onAutoAssignIps,
    onAutoLayerDevices,
    onOpenExcelTree,
    onOpenTemplates,
    onOpenBuildingGenerator,
    onDuplicateSelected,
    onSelectAll,
    onOpenAbout,
    onOpenGuide,
    activeKeymap
  ]);

  const recentItems: CommandPaletteAction[] = useMemo(() => {
    if (!onReplayRecentAction || recentActions.length === 0) return [];
    return recentActions.slice(0, 10).map(entry => ({
      id: `recent-${entry.id}`,
      title: entry.label,
      subtitle: `Gần đây (${entry.category}) · ${formatRecentActionAge(entry.timestamp)}${
        entry.count > 1 ? ` · ×${entry.count}` : ''
      }`,
      category: 'Thao tác gần đây' as const,
      keywords: ['gan day', 'recent', entry.category],
      icon: <RotateCcw className="w-4 h-4 text-[#155EEF]" />,
      run: () => onReplayRecentAction(entry)
    }));
  }, [recentActions, onReplayRecentAction]);

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return [...recentItems, ...actions].slice(0, 18);
    }

    const matchedRecent = recentItems.filter(a => {
      const haystack = [a.title, a.subtitle, a.category, ...(a.keywords || [])].join(' ');
      return matchesAccentInsensitiveQuery(haystack, trimmed);
    });

    const matchedActions = actions.filter(a => {
      const haystack = [a.title, a.subtitle, a.category, ...(a.keywords || [])].join(' ');
      return matchesAccentInsensitiveQuery(haystack, trimmed);
    });

    const matchedHelp: CommandPaletteAction[] = onOpenGuide
      ? searchHelpCatalog(trimmed)
          .slice(0, 4)
          .map(topic => ({
            id: `help-topic-${topic.id}`,
            title: topic.title,
            subtitle: `${topic.categoryLabel} · ${topic.summary}`,
            category: 'Hướng dẫn & Tra cứu' as const,
            icon: <BookOpen className="w-4 h-4 text-amber-600" />,
            run: onOpenGuide
          }))
      : [];

    const matchedShortcuts: CommandPaletteAction[] = onOpenShortcuts
      ? searchHelpShortcuts(trimmed, activeKeymap)
          .slice(0, 3)
          .map(sc => ({
            id: `help-shortcut-${sc.id}`,
            title: `Phím tắt: ${sc.label}`,
            subtitle: `${sc.category} · Tổ hợp ${formatShortcutDisplay(sc.combo)}`,
            category: 'Hướng dẫn & Tra cứu' as const,
            shortcut: sc.displayCombo,
            icon: <Keyboard className="w-4 h-4 text-[#155EEF]" />,
            run: onOpenShortcuts
          }))
      : [];

    return [...matchedRecent, ...matchedActions, ...matchedHelp, ...matchedShortcuts].slice(0, 24);
  }, [recentItems, actions, query, onOpenGuide, onOpenShortcuts, activeKeymap]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Bảng lệnh nhanh Ctrl+K"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-xs pt-6 sm:pt-16 px-3 sm:px-4 no-print"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100"
      >
        <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Search className="w-4 h-4 text-blue-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex(i => (filtered.length > 0 ? (i + 1) % filtered.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex(i => (filtered.length > 0 ? (i - 1 + filtered.length) % filtered.length : 0));
              } else if (e.key === 'Enter' && filtered[activeIndex]) {
                e.preventDefault();
                filtered[activeIndex].run();
                onClose();
              }
            }}
            placeholder="Tìm không dấu: bom vat tu, xuat pdf, tu dinh tuyen, ip trung, khoa lop, ten thiet bi..."
            aria-label="Tìm kiếm lệnh hoặc thiết bị"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <button
            onClick={onClose}
            aria-label="Đóng bảng lệnh"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[65dvh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Không có lệnh hoặc thiết bị khớp với "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => {
              const selected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                  className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors ${
                    selected
                      ? 'bg-blue-50 dark:bg-blue-950/60'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline text-xs text-slate-400">
                      {item.category}
                    </span>
                    {item.shortcut && (
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-xs">
                        {item.shortcut}
                      </kbd>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Command className="w-3.5 h-3.5" /> Dùng ↑↓ để chọn, Enter để chạy, Esc để đóng
          </span>
          <span className="hidden sm:inline font-mono">Ctrl+K</span>
        </div>
      </div>
    </div>
  );
};
