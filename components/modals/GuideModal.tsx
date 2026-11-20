import React, { useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  X,
  BookOpen,
  Layers,
  MousePointer,
  GitBranch,
  Box,
  Building2,
  FileSpreadsheet,
  Video,
  Wifi,
  Server,
  Keyboard,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Download,
  Search,
  ArrowRight
} from 'lucide-react';
import { downloadExcelTemplate } from '../../utils/excelService';
import { APP_VERSION, BRAND_INFO } from '../../config/appInfo';
import {
  HELP_SUGGESTIONS,
  HelpQuickActionId,
  HelpTopicCategory,
  searchHelpCatalog,
  searchHelpShortcuts
} from '../../utils/helpCatalog';
import {
  SHORTCUT_DEFINITIONS,
  ShortcutKeymap,
  formatShortcutDisplay,
  getDefaultShortcutKeymap
} from '../../hooks/useKeyboardShortcuts';

interface GuideModalProps {
  isOpen: boolean;
  keymap?: ShortcutKeymap;
  onClose: () => void;
  onOpenTemplates: () => void;
  onOpenBuildingGenerator: () => void;
  onOpenExcelTree?: () => void;
  onOpenBomModal?: () => void;
  onOpenShortcuts?: () => void;
}

const HELP_CATEGORY_OPTIONS: Array<{ id: HelpTopicCategory | 'all'; label: string }> = [
  { id: 'all', label: 'Tất cả chủ đề' },
  { id: 'bat-dau', label: 'Bắt đầu nhanh' },
  { id: 've-so-do', label: 'Vẽ & Nối cáp' },
  { id: 'tu-rack', label: 'Tủ Rack & Điện' },
  { id: 'cap-va-bom', label: 'Cáp & Vật tư (BOM)' },
  { id: 'kiem-tra', label: 'Kiểm tra & IP' },
  { id: 'xuat-ho-so', label: 'Xuất hồ sơ' },
  { id: 'phim-tat', label: 'Phím tắt' }
];

export const GuideModal: React.FC<GuideModalProps> = ({
  isOpen,
  keymap,
  onClose,
  onOpenTemplates,
  onOpenBuildingGenerator,
  onOpenExcelTree,
  onOpenBomModal,
  onOpenShortcuts
}) => {
  const [activeTab, setActiveTab] = useState<'intro' | 'quickstart' | 'rack' | 'building' | 'excel' | 'shortcuts'>('intro');
  const [searchQuery, setSearchQuery] = useState('');
  const [helpCategory, setHelpCategory] = useState<HelpTopicCategory | 'all'>('all');
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  const activeKeymap = useMemo(() => keymap || getDefaultShortcutKeymap(), [keymap]);
  const isSearchMode = searchQuery.trim().length > 0 || helpCategory !== 'all';
  const matchedTopics = useMemo(
    () => searchHelpCatalog(searchQuery, helpCategory),
    [searchQuery, helpCategory]
  );
  const matchedShortcuts = useMemo(
    () =>
      searchQuery.trim().length > 0 || helpCategory === 'phim-tat'
        ? searchHelpShortcuts(searchQuery, activeKeymap)
        : [],
    [searchQuery, helpCategory, activeKeymap]
  );

  const runQuickAction = (actionId: HelpQuickActionId) => {
    onClose();
    if (actionId === 'templates') onOpenTemplates();
    else if (actionId === 'building') onOpenBuildingGenerator();
    else if (actionId === 'excel_tree') onOpenExcelTree?.();
    else if (actionId === 'bom') onOpenBomModal?.();
    else if (actionId === 'shortcuts') onOpenShortcuts?.();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-label="Hướng dẫn sử dụng HACHIHI"
    >
      <div className="w-full h-dvh sm:h-auto sm:max-w-4xl sm:max-h-[90dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-gradient-to-r from-[#155EEF] via-blue-700 to-indigo-700 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center text-white shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight truncate">
                  HACHIHI Network &amp; Electrical Designer – Hướng dẫn sử dụng
                </h2>
                <span className="text-[11px] font-mono text-blue-100 shrink-0">
                  v{APP_VERSION}
                </span>
              </div>
              <p className="text-[11px] text-blue-100 mt-0.5 truncate">
                Cẩm nang thiết kế hạ tầng: Sơ đồ logic, Mặt bằng nhiều tầng, Tủ Rack 19&quot; &amp; Dự toán BOM
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hướng dẫn sử dụng"
            className="p-1.5 hover:bg-white/20 rounded-lg text-white/80 hover:text-white transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Searchable Quick Help Strip */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm nhanh hướng dẫn (hỗ trợ không dấu: bom vat tu, khoa lop, ti le, tu rack...)"
              aria-label="Tìm kiếm trong tài liệu hướng dẫn"
              className="w-full h-9 pl-8 pr-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-[#155EEF]"
            />
            {isSearchMode && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setHelpCategory('all');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-[11px] font-semibold text-[#155EEF] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700"
              >
                Xóa tìm
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {HELP_CATEGORY_OPTIONS.map(cat => {
              const active = helpCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setHelpCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-[#155EEF] text-white font-semibold'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {!searchQuery.trim() && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium shrink-0">Gợi ý nhanh:</span>
              {HELP_SUGGESTIONS.map(sug => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setSearchQuery(sug)}
                  className="px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-[#155EEF] hover:text-[#155EEF] dark:hover:text-blue-400 transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tab Navigation (Shown when not filtering search catalog) */}
        {!isSearchMode && (
          <div className="px-4 sm:px-6 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 flex items-center gap-1.5 overflow-x-auto shrink-0">
            {[
              { id: 'intro', label: '01. Tổng quan', icon: Sparkles },
              { id: 'quickstart', label: '02. Kéo thả & Nối cáp', icon: MousePointer },
              { id: 'rack', label: '03. Tủ Server Rack 19"', icon: Box },
              { id: 'building', label: '04. Tòa nhà nhiều tầng', icon: Building2 },
              { id: 'excel', label: '05. Nhập / Xuất Excel', icon: FileSpreadsheet },
              { id: 'shortcuts', label: '06. Phím tắt CAD', icon: Keyboard }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-[#155EEF] text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-[#155EEF] hover:bg-blue-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {isSearchMode ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  Tìm thấy <strong className="text-slate-900 dark:text-white">{matchedTopics.length}</strong> chủ đề hướng dẫn
                  {matchedShortcuts.length > 0 && (
                    <>
                      {' · '}
                      <strong className="text-slate-900 dark:text-white">{matchedShortcuts.length}</strong> phím tắt
                    </>
                  )}
                </span>
              </div>

              {matchedTopics.length === 0 && matchedShortcuts.length === 0 ? (
                <div className="p-8 rounded-xl border border-slate-200 dark:border-slate-800 text-center space-y-2">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Không tìm thấy chủ đề phù hợp với &ldquo;{searchQuery}&rdquo;
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Thử từ khóa khác như: <em>cay excel</em>, <em>bom vat tu</em>, <em>khoa lop</em>, <em>ti le</em>, <em>tu rack</em>.
                  </p>
                </div>
              ) : (
                <>
                  {matchedTopics.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {matchedTopics.map(topic => (
                        <div
                          key={topic.id}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex flex-col justify-between gap-2.5"
                        >
                          <div className="space-y-2">
                            <div className="text-[11px] font-semibold text-[#155EEF] dark:text-blue-400">
                              {topic.categoryLabel}
                            </div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                              {topic.title}
                            </h3>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                              {topic.summary}
                            </p>
                            <ul className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                              {topic.steps.map((step, idx) => (
                                <li key={idx} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          {(topic.guideTab || topic.quickActionId) && (
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                              {topic.guideTab && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSearchQuery('');
                                    setHelpCategory('all');
                                    setActiveTab(topic.guideTab!);
                                  }}
                                  className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1"
                                >
                                  <span>Xem mục hướng dẫn</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              )}
                              {topic.quickActionId &&
                                (topic.quickActionId !== 'excel_tree' || onOpenExcelTree) &&
                                (topic.quickActionId !== 'bom' || onOpenBomModal) &&
                                (topic.quickActionId !== 'shortcuts' || onOpenShortcuts) && (
                                  <button
                                    type="button"
                                    onClick={() => runQuickAction(topic.quickActionId!)}
                                    className="px-2.5 py-1 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white text-[11px] font-semibold"
                                  >
                                    {topic.quickActionLabel || 'Mở nhanh'}
                                  </button>
                                )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {matchedShortcuts.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Keyboard className="w-3.5 h-3.5 text-[#155EEF]" />
                        <span>Phím tắt liên quan</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {matchedShortcuts.map(sc => (
                          <div
                            key={sc.id}
                            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 flex items-center justify-between gap-2"
                          >
                            <span className="text-xs text-slate-700 dark:text-slate-200 truncate">{sc.label}</span>
                            <kbd className="font-mono font-bold text-[#155EEF] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 text-[11px] shrink-0">
                              {sc.displayCombo}
                            </kbd>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {/* TAB 1: INTRO */}
              {activeTab === 'intro' && (
                <div className="space-y-6">
                  <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2.5">
                    <div className="text-[11px] font-bold tracking-wider text-[#155EEF] dark:text-blue-400 uppercase">
                      Một nguồn dữ liệu duy nhất
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Từ bản vẽ kỹ thuật đến dự toán vật tư chính xác
                    </h3>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs">
                      HACHIHI Network &amp; Electrical Designer v{APP_VERSION} kết hợp vẽ sơ đồ logic, mặt bằng CAD nhiều tầng và mô phỏng tủ Rack 19 inch trên cùng một hệ thống dữ liệu. Mọi thiết bị giữ nguyên thông số (IP, VLAN, hãng, model, công suất) xuyên suốt 8 chế độ và mọi báo cáo BOM/PDF/Excel đều truy ngược trực tiếp về đối tượng trên bản vẽ.
                    </p>
                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenTemplates();
                        }}
                        className="px-3 py-1.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs"
                      >
                        Mở thư viện mẫu
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenBuildingGenerator();
                        }}
                        className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs"
                      >
                        Tạo tòa nhà nhiều tầng
                      </button>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-3">
                      8 chế độ thiết kế tích hợp
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { title: 'Sơ đồ logic', desc: 'Sơ đồ mạng LAN/WAN, Core/Phân phối, Firewall HA, VLAN', icon: Layers, color: '#0284c7' },
                        { title: 'Mặt bằng tầng', desc: 'Mặt bằng 2D nhiều tầng, phòng ban, trục kỹ thuật đứng', icon: Building2, color: '#4f46e5' },
                        { title: 'Tủ Rack 19"', desc: 'Mặt đứng tủ rack từ U1 đến U42 (trước/sau), tính tải điện', icon: Server, color: '#0f172a' },
                        { title: 'Camera CCTV', desc: 'Bố trí camera AI, nón góc quan sát FOV 95°, đầu ghi NVR', icon: Video, color: '#f59e0b' },
                        { title: 'Phủ sóng Wi-Fi', desc: 'Mô phỏng bán kính phủ sóng 2.4/5GHz theo tỷ lệ mét', icon: Wifi, color: '#10b981' },
                        { title: 'Cáp quang', desc: 'Trục cáp quang ODF, Patch Panel Cat6A và đấu nối cổng', icon: GitBranch, color: '#06b6d4' },
                        { title: 'Hệ thống điện & UPS', desc: 'Tủ điện nguồn, UPS Online, thanh nguồn PDU & tải W/VA', icon: Box, color: '#e11d48' },
                        { title: 'Đa chi nhánh', desc: 'Liên kết diện rộng SD-WAN / IPsec giữa các văn phòng', icon: Layers, color: '#6366f1' }
                      ].map(m => (
                        <div
                          key={m.title}
                          className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 space-y-1 hover:border-[#155EEF] transition-colors"
                        >
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white mb-2"
                            style={{ backgroundColor: m.color }}
                          >
                            <m.icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="font-bold text-slate-900 dark:text-white text-[11px]">{m.title}</div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{m.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: QUICKSTART & CABLING */}
              {activeTab === 'quickstart' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 space-y-2">
                      <div className="w-8 h-8 rounded-lg bg-[#155EEF] text-white flex items-center justify-center font-bold">1</div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm">Thêm thiết bị cực nhanh</h4>
                      <ul className="space-y-1.5 text-slate-600 dark:text-slate-300 text-xs">
                        <li className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#155EEF] shrink-0 mt-0.5" />
                          <span><strong>Nhấp đúp hoặc nhấp</strong> vào biểu tượng trong thư viện bên trái để đặt nhanh vào giữa vùng nhìn.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#155EEF] shrink-0 mt-0.5" />
                          <span><strong>Kéo thả trực tiếp</strong>: Giữ chuột vào thiết bị và kéo thả vào đúng vị trí hoặc vào thẳng khe U tủ Rack.</span>
                        </li>
                      </ul>
                    </div>

                    <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2">
                      <div className="w-8 h-8 rounded-lg bg-[#16A34A] text-white flex items-center justify-center font-bold">2</div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm">Nối dây cáp &amp; khóa lớp</h4>
                      <ul className="space-y-1.5 text-slate-600 dark:text-slate-300 text-xs">
                        <li className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />
                          <span>Nhấn phím <strong>C</strong> hoặc chọn cổng tròn trên thiết bị nguồn &rarr; chọn thiết bị đích để nối cáp vuông góc tự động tránh vật cản.</span>
                        </li>
                        <li className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A] shrink-0 mt-0.5" />
                          <span>Mở <strong>Điều khiển khung nhìn &rarr; Lớp</strong> để ẩn/hiện hoặc khóa lớp phòng/cáp, tránh kéo nhầm khi thao tác.</span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/30 space-y-2">
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">Bảng thuộc tính bên phải – Trung tâm chỉnh sửa</h4>
                    <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                      Nhấp vào thiết bị, dây cáp, phòng hoặc vùng trống để chỉnh trực tiếp Địa chỉ IP, Subnet, VLAN, Kích thước, Màu dây, Bán kính sóng Wi-Fi, Góc quét camera FOV và trực quan hóa công suất PoE từng switch.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: SERVER RACK */}
              {activeTab === 'rack' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2">
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                      Tùy ý kéo thả vị trí trong tủ Rack (U1 đến U42 – Mặt trước &amp; Mặt sau)
                    </h4>
                    <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                      Bố trí thiết bị theo tiêu chuẩn phòng máy chủ với phát hiện va chạm khe U tự động:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                      <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800">
                        <span className="font-bold text-indigo-600 block">Đỉnh tủ (U36 – U42)</span>
                        <span className="text-[11px] text-slate-500">ODF quang, Patch Panel và Switch Core</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800">
                        <span className="font-bold text-[#155EEF] block">Giữa tủ (U15 – U35)</span>
                        <span className="text-[11px] text-slate-500">Máy chủ 1U/2U, lưu trữ SAN/NAS</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800">
                        <span className="font-bold text-rose-600 block">Đáy &amp; Mặt sau tủ</span>
                        <span className="text-[11px] text-slate-500">Bộ lưu điện UPS nặng (đáy) &amp; thanh nguồn PDU (mặt sau)</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/30 space-y-2">
                    <h5 className="font-bold text-slate-900 dark:text-white">Cách thao tác tủ Rack:</h5>
                    <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-300 text-xs">
                      <li><strong>Nhấp đúp vào tủ Rack</strong> trên bản vẽ để mở mặt đứng 19 inch (Mặt trước / Mặt sau).</li>
                      <li>Kéo thả thiết bị vào đúng khoang U mong muốn; tự động kiểm tra đủ số U và tải trọng tối đa (kg).</li>
                      <li>Hệ thống cộng tổng công suất (W), tải trọng (kg) và liệt kê từng thiết bị theo vị trí U trong bảng BOM &amp; Excel.</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* TAB 4: BUILDING */}
              {activeTab === 'building' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20 space-y-2">
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                      Thiết kế tòa nhà nhiều tầng &amp; bảo toàn dữ liệu
                    </h4>
                    <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                      Cấu hình số tầng nổi, số tầng hầm, kích thước thực tế (Dài × Rộng × Cao tầng) và kiểu mặt bằng kiến trúc.
                    </p>
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenBuildingGenerator();
                        }}
                        className="px-3 py-1.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs flex items-center gap-1.5"
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Mở cấu hình tòa nhà nhiều tầng</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                      <strong className="text-[#155EEF] block mb-1">Đổi số tầng không mất dữ liệu:</strong>
                      <span className="text-slate-600 dark:text-slate-300 text-xs">
                        Thêm tầng hoặc chỉnh diện tích mà mọi phòng ban, tủ Rack và thiết bị trên các tầng hiện hữu vẫn giữ nguyên vẹn.
                      </span>
                    </div>
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
                      <strong className="text-indigo-600 block mb-1">Nhân bản mặt bằng tầng:</strong>
                      <span className="text-slate-600 dark:text-slate-300 text-xs">
                        Sao chép toàn bộ bố trí phòng và thiết bị từ tầng điển hình sang tầng mới chỉ với 1 lần nhấn.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: EXCEL & BOM */}
              {activeTab === 'excel' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                      <FileSpreadsheet className="w-4 h-4 text-[#16A34A]" />
                      <span>Nhập danh sách thiết bị &amp; Xuất Excel BOM công thức sống</span>
                    </h4>
                    <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                      Mọi số liệu vật tư, chiều dài cáp kèm dự phòng đầu cáp và phụ kiện suy ra đều đồng bộ trực tiếp từ bản vẽ sang file Excel đa sheet (.xlsx).
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={downloadExcelTemplate}
                        className="px-3 py-1.5 rounded-md bg-[#16A34A] hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải tệp mẫu Excel (.xlsx)</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h5 className="font-bold text-slate-900 dark:text-white">Cấu trúc cột nhập thiết bị:</h5>
                    <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 font-mono text-[11px] text-slate-700 dark:text-slate-300 leading-loose">
                      Mã Tài Sản · Tên Thiết Bị · Loại Thiết Bị · Hãng · Model · Địa Chỉ IP · Subnet Mask · VLAN · Tầng · Phòng · Tủ Rack · Vị Trí U · Công Suất W · Trạng Thái
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: SHORTCUTS (Reads live ShortcutKeymap) */}
              {activeTab === 'shortcuts' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                      Bảng phím tắt thao tác nhanh (Đang hiệu lực)
                    </h4>
                    {onOpenShortcuts && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenShortcuts();
                        }}
                        className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-xs font-semibold text-[#155EEF] dark:text-blue-400"
                      >
                        Tùy chỉnh phím tắt
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SHORTCUT_DEFINITIONS.map(def => (
                      <div
                        key={def.id}
                        className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 flex items-center justify-between gap-2"
                      >
                        <span className="font-mono font-bold text-[#155EEF] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 text-[11px] shrink-0">
                          {formatShortcutDisplay(activeKeymap[def.id] || def.defaultCombo)}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300 text-[11px] text-right">{def.label}</span>
                      </div>
                    ))}
                    {[
                      { key: 'Space + Kéo chuột', desc: 'Di chuyển bản vẽ (Pan canvas)' },
                      { key: 'Nhấp đúp tủ rack', desc: 'Mở mặt dựng tủ Rack 19 inch (U1–U42)' }
                    ].map(sc => (
                      <div
                        key={sc.key}
                        className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 flex items-center justify-between gap-2"
                      >
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[11px] shrink-0">
                          {sc.key}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300 text-[11px] text-right">{sc.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>
              {BRAND_INFO.copyright} · {BRAND_INFO.websiteLabel} · v{APP_VERSION}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            Đóng hướng dẫn
          </button>
        </div>
      </div>
    </div>
  );
};
