import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Download,
  Eye,
  FileSpreadsheet,
  GitFork,
  Layers,
  Network,
  Search,
  Sparkles,
  Table2,
  Upload,
  X
} from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { ProjectState } from '../../types/infrastructure';
import {
  buildProjectFromRouterTree,
  buildSampleRouterTreePreview,
  computeRouterTreeLayout,
  downloadRouterTreeExcelTemplate,
  exportProjectRouterTreeToExcel,
  extractRouterTreeFromProject,
  ParsedRouterTreeResult,
  parseRouterTreeTextPayload,
  RouterTreeNodeInfo,
  TreeApplyMode,
  TreeLayoutMode
} from '../../utils/excelTreeImporter';

interface ExcelTreeImportModalProps {
  isOpen: boolean;
  existingProject: ProjectState;
  onClose: () => void;
  onAfterExportProjectTree?: () => void;
  onApplyProject: (
    nextProject: ProjectState,
    summary: {
      applyMode: TreeApplyMode;
      createdNodesCount: number;
      createdCablesCount: number;
      floorCount: number;
    }
  ) => void;
}

type InspectionTab = 'tree' | 'diagram' | 'table';

function getTierBadgeStyle(depth: number): { bg: string; iconBg: string; pill: string } {
  if (depth === 1) {
    return {
      bg: '#1d4ed8',
      iconBg: 'bg-blue-600 text-white',
      pill: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800'
    };
  }
  if (depth === 2) {
    return {
      bg: '#0284c7',
      iconBg: 'bg-sky-600 text-white',
      pill: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800'
    };
  }
  if (depth === 3) {
    return {
      bg: '#0d9488',
      iconBg: 'bg-emerald-600 text-white',
      pill: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
    };
  }
  return {
    bg: '#4f46e5',
    iconBg: 'bg-indigo-600 text-white',
    pill: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800'
  };
}

function getPreviewCableColor(cableType: string): string {
  if (cableType === 'FIBER_SM_OS2') return '#f59e0b';
  if (cableType === 'FIBER_MM_OM4') return '#06b6d4';
  if (cableType === 'CAT6A_STP') return '#2563eb';
  if (cableType === 'DAC_10G') return '#7c3aed';
  return '#0ea5e9';
}

const SAMPLE_ASCII_TREE_TEXT = `Tầng 1
 └── Router 01 (10.0.0.1, VLAN 10)
      ├── Switch 01 (10.0.1.1)
      │    ├── PC 01 (10.0.1.11)
      │    ├── PC 02 (10.0.1.12)
      │    └── Camera 01 (10.0.1.21)
      └── Switch 02 (10.0.2.1)
           ├── AP 01 (10.0.2.11)
           └── Camera 02 (10.0.2.22)`;

const SAMPLE_TSV_TEXT = `Tên Thiết Bị\tRouter Cha\tLoại Thiết Bị\tĐịa Chỉ IP\tVLAN\tTầng / Khu Vực\tLoại Cáp
Router-A1\t\trouter\t10.0.0.1\t10\tTầng 1\tQuang OS2 (10G)
Switch-T2-01\tRouter-A1\tswitch\t10.0.10.2\t10\tTầng 2\tQuang OS2 (10G)
AP-T2-01\tSwitch-T2-01\tap\t10.0.10.11\t30\tTầng 2\tCat6 UTP (1G)
Camera-T2-01\tSwitch-T2-01\tcamera\t10.0.20.11\t20\tTầng 2\tCat6 UTP (1G)`;

export const ExcelTreeImportModal: React.FC<ExcelTreeImportModalProps> = ({
  isOpen,
  existingProject,
  onClose,
  onAfterExportProjectTree,
  onApplyProject
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  const [parsed, setParsed] = useState<ParsedRouterTreeResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isParsing, setIsParsing] = useState(false);

  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');

  const [layoutMode, setLayoutMode] = useState<TreeLayoutMode>('horizontal');
  const [applyMode, setApplyMode] = useState<TreeApplyMode>('new_project');
  const [projectName, setProjectName] = useState('');
  const [activeTab, setActiveTab] = useState<InspectionTab>('tree');

  const [searchQuery, setSearchQuery] = useState('');
  const [floorFilter, setFloorFilter] = useState<string>('ALL');
  const [collapsedNames, setCollapsedNames] = useState<Set<string>>(() => new Set());
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);

  const existingDeviceCount = useMemo(
    () =>
      (existingProject.nodes || []).filter(
        n => n.type === 'device' || n.type === 'cloud' || n.type === 'telecom_tower'
      ).length,
    [existingProject.nodes]
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, RouterTreeNodeInfo>();
    parsed?.nodes.forEach(n => map.set(n.name, n));
    return map;
  }, [parsed]);

  const applyParsedResult = (result: ParsedRouterTreeResult) => {
    setParsed(result);
    setParseError(null);
    setStatusMessage(null);
    setProjectName(result.suggestedProjectName);
    setSearchQuery('');
    setFloorFilter('ALL');
    setCollapsedNames(new Set());
    setSelectedNodeName(result.rootNames[0] || result.nodes[0]?.name || null);
  };

  const handleFileSelected = async (file: File) => {
    setIsParsing(true);
    setParseError(null);
    setStatusMessage(null);
    try {
      const { parseRouterTreeExcelFile } = await import('../../utils/excelTreeImporter');
      const result = await parseRouterTreeExcelFile(file);
      applyParsedResult(result);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Không thể đọc tệp Excel.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleParsePastedText = () => {
    setParseError(null);
    setStatusMessage(null);
    try {
      const result = parseRouterTreeTextPayload(pasteText, 'So_Do_Dan_Truc_Tiep');
      applyParsedResult(result);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Không thể phân tích văn bản đã dán.');
    }
  };

  const handleLoadFromExistingProject = () => {
    setParseError(null);
    setStatusMessage(null);
    try {
      const result = extractRouterTreeFromProject(existingProject);
      applyParsedResult(result);
      setStatusMessage(`Đã trích xuất ${result.nodes.length} thiết bị và ${result.links.length} liên kết từ dự án hiện tại.`);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Không thể trích xuất cây từ dự án hiện tại.');
    }
  };

  const handleExportProjectTree = async () => {
    setParseError(null);
    try {
      await exportProjectRouterTreeToExcel(existingProject);
      setStatusMessage('Đã xuất tệp Cây Router Cha–Con (.xlsx) từ dự án hiện tại.');
      onAfterExportProjectTree?.();
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Không thể xuất cây Router ra Excel.');
    }
  };

  const handleLoadBuiltInSample = () => {
    const sample = buildSampleRouterTreePreview();
    applyParsedResult(sample);
  };

  const handleDownloadSample = async () => {
    try {
      await downloadRouterTreeExcelTemplate();
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Không thể tạo tệp Excel mẫu.');
    }
  };

  const previewLayout = useMemo(() => {
    if (!parsed) return null;
    return computeRouterTreeLayout(parsed, layoutMode);
  }, [parsed, layoutMode]);

  // Unified search & floor filtering shared across Tree, Diagram (SVG), and Table views
  const { directMatchNames, visibleTreeNames } = useMemo(() => {
    if (!parsed) {
      return { directMatchNames: new Set<string>(), visibleTreeNames: new Set<string>() };
    }
    const q = searchQuery.trim().toLowerCase();
    const hasQuery = q.length > 0;
    const hasFloor = floorFilter !== 'ALL';
    if (!hasQuery && !hasFloor) {
      const all = new Set(parsed.nodes.map(n => n.name));
      return { directMatchNames: all, visibleTreeNames: all };
    }

    const directMatch = new Set<string>();
    parsed.nodes.forEach(n => {
      const floorOk = !hasFloor || n.floorName === floorFilter;
      const queryOk =
        !hasQuery ||
        n.name.toLowerCase().includes(q) ||
        n.parents.some(p => p.toLowerCase().includes(q)) ||
        n.ipAddress.toLowerCase().includes(q) ||
        n.vlan.toLowerCase().includes(q) ||
        n.cableLabel.toLowerCase().includes(q) ||
        n.floorName.toLowerCase().includes(q);
      if (floorOk && queryOk) directMatch.add(n.name);
    });

    // Include ancestors of matching nodes so tree path stays coherent
    const visible = new Set<string>(directMatch);
    const parentLookup = new Map<string, string[]>();
    parsed.nodes.forEach(n => parentLookup.set(n.name, n.parentLinks.map(l => l.parentName)));
    const stack = Array.from(directMatch);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const p of parentLookup.get(cur) || []) {
        if (!visible.has(p)) {
          visible.add(p);
          stack.push(p);
        }
      }
    }
    return { directMatchNames: directMatch, visibleTreeNames: visible };
  }, [parsed, searchQuery, floorFilter]);

  const selectedBreadcrumb = useMemo(() => {
    if (!parsed || !selectedNodeName) return [] as string[];
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = selectedNodeName;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.unshift(cur);
      const info = nodeMap.get(cur);
      cur = info?.parentLinks[0]?.parentName;
    }
    return path;
  }, [parsed, selectedNodeName, nodeMap]);

  if (!isOpen) return null;

  const toggleExpand = (name: string) => {
    setCollapsedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const expandAll = () => setCollapsedNames(new Set());
  const collapseAll = () => {
    if (!parsed) return;
    setCollapsedNames(new Set(parsed.nodes.filter(n => n.childNames.length > 0).map(n => n.name)));
  };

  const renderTreeNodes = (names: string[], depthLevel = 0, visited = new Set<string>()): React.ReactNode => {
    return names.map(name => {
      if (!visibleTreeNames.has(name) || visited.has(name)) return null;
      const node = nodeMap.get(name);
      if (!node) return null;

      const nextVisited = new Set(visited);
      nextVisited.add(name);

      const visibleKids = node.childNames.filter(k => visibleTreeNames.has(k) && !nextVisited.has(k));
      const hasKids = visibleKids.length > 0;
      const isCollapsed = collapsedNames.has(name);
      const isSelected = selectedNodeName === name;
      const tierStyle = getTierBadgeStyle(node.depth);
      const firstLink = node.parentLinks[0];

      return (
        <div key={`${depthLevel}_${name}`} className={depthLevel > 0 ? 'ml-6 pl-3 border-l border-slate-200 dark:border-slate-700 mt-1.5' : 'mt-1.5'}>
          <div
            onClick={() => setSelectedNodeName(name)}
            className={`px-3 py-2 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
              isSelected
                ? 'border-[#155EEF] bg-blue-50/40 dark:bg-blue-950/25 shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {hasKids ? (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    toggleExpand(name);
                  }}
                  aria-label={isCollapsed ? `Mở rộng ${name}` : `Thu gọn ${name}`}
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 shrink-0"
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              ) : (
                <span className="w-5 flex items-center justify-center shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                </span>
              )}

              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tierStyle.iconBg}`}>
                <Network className="w-3.5 h-3.5" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-xs text-slate-900 dark:text-white">{node.name}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                    Cấp T{node.depth}
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {node.floorName}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    {node.ipAddress}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-1">
                  {firstLink ? (
                    <>
                      <span>
                        Nối từ <strong className="text-slate-700 dark:text-slate-200">{firstLink.parentName}</strong>
                      </span>
                      <span>·</span>
                      <span className="text-[#155EEF] dark:text-blue-400 font-medium">{firstLink.cableLabel}</span>
                      <span>·</span>
                      <span className="font-mono">{firstLink.parentPort} → {firstLink.localPort}</span>
                      {firstLink.isCrossFloor && (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">(Liên tầng)</span>
                      )}
                      {node.parentLinks.length > 1 && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-medium">
                          +{node.parentLinks.length - 1} uplink dự phòng
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[#155EEF] dark:text-blue-400 font-medium">
                      {node.notes || 'Router Gốc (Uplink Trung tâm)'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-[11px] text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap shrink-0 tabular-nums">
              {node.childNames.length > 0
                ? `${node.childNames.length} con · ${node.totalDescendantCount} nhánh`
                : 'Nút cuối'}
            </div>
          </div>

          {hasKids && !isCollapsed && renderTreeNodes(visibleKids, depthLevel + 1, nextVisited)}
        </div>
      );
    });
  };

  const handleConfirmCreate = () => {
    if (!parsed) return;
    const built = buildProjectFromRouterTree(parsed, {
      layoutMode,
      applyMode,
      projectName,
      existingProject
    });
    onApplyProject(built.project, {
      applyMode,
      createdNodesCount: built.createdNodesCount,
      createdCablesCount: built.createdCablesCount,
      floorCount: built.floorCount
    });
    onClose();
  };

  const selectedNodeInfo = selectedNodeName ? nodeMap.get(selectedNodeName) : undefined;
  const layoutSubtitle =
    layoutMode === 'horizontal'
      ? 'Cây ngang (Trái → Phải)'
      : layoutMode === 'vertical'
      ? 'Cây dọc (Trên → Dưới)'
      : 'Theo tầng (Phân khu từng tầng)';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="excel-tree-modal-title"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-5xl max-h-[92dvh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 outline-none"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <GitFork className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="excel-tree-modal-title" className="text-base font-bold text-slate-900 dark:text-white truncate">
                Tạo Sơ Đồ Router Đa Tầng Từ Excel (Quan Hệ Cha – Con)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Tải file Excel mẫu có cột Router Cha, kiểm tra trực quan cây phân cấp rồi dựng sơ đồ hoàn chỉnh
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ nhập sơ đồ từ Excel"
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
              e.target.value = '';
            }}
          />

          {/* Step 1 & Step 2 Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step 1 Card */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-3">
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  BƯỚC 1 - FILE MẪU &amp; XUẤT CÂY DỰ ÁN
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  Mẫu Bảng Router Đa Tầng &amp; Đồng Bộ Dự Án (.xlsx)
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tệp gồm 2 sheet: <strong className="text-slate-700 dark:text-slate-200">So_Do_Router_Cay</strong> và{' '}
                  <strong className="text-slate-700 dark:text-slate-200">Huong_Dan_Nhap</strong>. Có thể xuất trực tiếp từ bản vẽ hiện tại.
                </p>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                  <div>Tầng 1: Router-A1 (Gốc) → B1, B2</div>
                  <div>Tầng 2 → Tầng 3: Router-B1 → C1, C2, C3, C4</div>
                  <div>Tầng 3 → Tầng 4: Router-C2 → D1, D2, D3</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDownloadSample()}
                    className="flex-1 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Tải Mẫu Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadBuiltInSample}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-xs font-semibold text-[#155EEF] dark:text-blue-400 whitespace-nowrap transition-colors"
                    title="Nạp nhanh dữ liệu mẫu 4 tầng để xem trước cây và sơ đồ"
                  >
                    Xem thử mẫu
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={existingDeviceCount === 0}
                    onClick={() => void handleExportProjectTree()}
                    className="flex-1 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:border-emerald-600 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                    title="Xuất hệ thống phân cấp cha-con từ sơ đồ hiện tại ra file Excel"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Xuất cây từ dự án ({existingDeviceCount})</span>
                  </button>
                  <button
                    type="button"
                    disabled={existingDeviceCount === 0}
                    onClick={handleLoadFromExistingProject}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap transition-colors"
                    title="Nạp cây thiết bị từ bản vẽ hiện tại vào khung xem trước"
                  >
                    Xem cây dự án
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2 Card: File Upload OR Direct Text Paste */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#155EEF] dark:text-blue-400">
                  BƯỚC 2 - NHẬP FILE HOẶC DÁN VĂN BẢN
                </div>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setInputMode('file')}
                    className={`h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors ${
                      inputMode === 'file'
                        ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Upload className="w-3 h-3" />
                    <span>Tải file (.xlsx/.csv)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('paste')}
                    className={`h-7 px-2.5 rounded-md text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-colors ${
                      inputMode === 'paste'
                        ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    <span>Dán văn bản</span>
                  </button>
                </div>
              </div>

              {inputMode === 'file' ? (
                <div
                  onDragOver={e => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) void handleFileSelected(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`flex-1 min-h-[168px] rounded-xl border-2 border-dashed p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                    isDraggingFile
                      ? 'border-[#155EEF] bg-blue-50/70 dark:bg-blue-950/30'
                      : 'border-slate-300 dark:border-slate-700 hover:border-[#155EEF] bg-slate-50/50 dark:bg-slate-800/30'
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#155EEF] dark:text-blue-400 flex items-center justify-center mb-2">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {isParsing
                      ? 'Đang phân tích file Excel...'
                      : parsed
                      ? `Đã nạp: ${parsed.fileName}`
                      : 'Nhấp hoặc kéo thả tệp .xlsx / .csv vào đây'}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                    Hỗ trợ nhiều đường uplink cách nhau dấu phẩy, hoặc chuyển sang tab Dán văn bản để dán cây thư mục / bảng Excel.
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col gap-2">
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    rows={6}
                    placeholder={`Dán bảng từ Excel (Ctrl+C -> Ctrl+V), CSV hoặc cây văn bản:\nTầng 1\n └── Router 01\n      ├── Switch 01\n      │    ├── PC 01\n      │    └── Camera 01`}
                    aria-label="Dán văn bản cây thiết bị hoặc bảng Excel"
                    className="w-full flex-1 min-h-[126px] p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-[11px] text-slate-800 dark:text-slate-100 outline-none focus:border-[#155EEF] resize-y"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPasteText(SAMPLE_ASCII_TREE_TEXT)}
                        className="h-7 px-2 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-[#155EEF] whitespace-nowrap"
                      >
                        Chèn mẫu Cây ASCII
                      </button>
                      <button
                        type="button"
                        onClick={() => setPasteText(SAMPLE_TSV_TEXT)}
                        className="h-7 px-2 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-[#155EEF] whitespace-nowrap"
                      >
                        Chèn mẫu Bảng Excel
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={!pasteText.trim()}
                      onClick={handleParsePastedText}
                      className="h-8 px-3 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-45 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Phân tích &amp; Xem trước</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {statusMessage && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
              {statusMessage}
            </div>
          )}

          {parseError && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Step 3: KPIs + Layout / Apply Config + Interactive Tree / Diagram / Table */}
          {parsed && (
            <>
              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">SỐ THIẾT BỊ</div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {parsed.nodes.length}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">TUYẾN KẾT NỐI</div>
                  <div className="text-xl font-extrabold text-[#155EEF] dark:text-blue-400 tabular-nums mt-0.5">
                    {parsed.links.length}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">SỐ TẦNG / KHU VỰC</div>
                  <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                    {parsed.floors.length}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ĐỘ SÂU CÂY (CẤP)</div>
                  <div className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400 tabular-nums mt-0.5">
                    {parsed.maxDepth}
                  </div>
                </div>
              </div>

              {/* Config Bar: Layout + Apply Mode + New Name */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                <div className="lg:col-span-4 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    KIỂU BỐ CỤC SƠ ĐỒ
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'vertical', label: 'Cây dọc', icon: <ArrowDownUp className="w-3.5 h-3.5" /> },
                        { id: 'horizontal', label: 'Cây ngang', icon: <ArrowLeftRight className="w-3.5 h-3.5" /> },
                        { id: 'by_floor', label: 'Theo tầng', icon: <Layers className="w-3.5 h-3.5" /> }
                      ] as const
                    ).map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setLayoutMode(opt.id)}
                        aria-pressed={layoutMode === opt.id}
                        className={`h-9 px-2 rounded-lg text-xs font-semibold flex flex-col items-center justify-center gap-0.5 border transition-colors ${
                          layoutMode === opt.id
                            ? 'bg-[#155EEF] border-[#155EEF] text-white shadow-xs'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-[#155EEF]'
                        }`}
                      >
                        {opt.icon}
                        <span className="text-[11px]">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    CÁCH ÁP DỤNG VÀO BẢN VẼ
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setApplyMode('new_project')}
                      aria-pressed={applyMode === 'new_project'}
                      className={`h-9 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                        applyMode === 'new_project'
                          ? 'bg-[#155EEF] border-[#155EEF] text-white shadow-xs'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-[#155EEF]'
                      }`}
                    >
                      Tạo mẫu sơ đồ mới
                    </button>
                    <button
                      type="button"
                      onClick={() => setApplyMode('merge')}
                      aria-pressed={applyMode === 'merge'}
                      className={`h-9 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                        applyMode === 'merge'
                          ? 'bg-[#155EEF] border-[#155EEF] text-white shadow-xs'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-[#155EEF]'
                      }`}
                    >
                      Gộp vào bản vẽ hiện tại
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-1.5">
                  <label
                    htmlFor="excel-tree-project-name"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                  >
                    TÊN MẪU / DỰ ÁN MỚI
                  </label>
                  <input
                    id="excel-tree-project-name"
                    type="text"
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    disabled={applyMode === 'merge'}
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:border-[#155EEF] disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Step 3 Inspection Header & Tabs */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    <GitFork className="w-4 h-4 text-emerald-600" />
                    <span>
                      Kiểm tra hệ thống phân cấp Router ({parsed.nodes.length} nút · {parsed.links.length} liên kết)
                    </span>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                    {(
                      [
                        { id: 'tree', label: 'Cây phân cấp (Tree View)', icon: <GitFork className="w-3.5 h-3.5" /> },
                        { id: 'diagram', label: 'Xem trước sơ đồ', icon: <Eye className="w-3.5 h-3.5" /> },
                        { id: 'table', label: 'Bảng dữ liệu', icon: <Table2 className="w-3.5 h-3.5" /> }
                      ] as const
                    ).map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        aria-pressed={activeTab === tab.id}
                        className={`h-7 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                          activeTab === tab.id
                            ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {tab.icon}
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Unified Search & Floor Filter across ALL 3 Tabs */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Tìm Router, Cha, IP, VLAN, Cáp..."
                        className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-[#155EEF]"
                      />
                    </div>
                    <select
                      value={floorFilter}
                      onChange={e => setFloorFilter(e.target.value)}
                      aria-label="Lọc theo tầng"
                      className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium outline-none"
                    >
                      <option value="ALL">Tất cả tầng ({parsed.floors.length})</option>
                      {parsed.floors.map(fl => (
                        <option key={fl} value={fl}>
                          {fl}
                        </option>
                      ))}
                    </select>
                    {(searchQuery.trim() || floorFilter !== 'ALL') && (
                      <span className="text-[11px] font-medium text-[#155EEF] dark:text-blue-400 tabular-nums">
                        Khớp {directMatchNames.size}/{parsed.nodes.length} nút
                      </span>
                    )}
                  </div>

                  {activeTab === 'tree' && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400 font-medium tabular-nums">
                        {parsed.rootNames.length} gốc · {parsed.floors.length} tầng
                      </span>
                      <button
                        type="button"
                        onClick={expandAll}
                        className="h-7 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#155EEF] text-xs font-medium"
                      >
                        Mở rộng tất cả
                      </button>
                      <button
                        type="button"
                        onClick={collapseAll}
                        className="h-7 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-[#155EEF] text-xs font-medium"
                      >
                        Thu gọn
                      </button>
                    </div>
                  )}
                </div>

                {/* Tab 1: Tree View */}
                {activeTab === 'tree' && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-3 space-y-2.5">
                    <div className="max-h-72 overflow-y-auto pr-1">
                      {renderTreeNodes(parsed.rootNames)}
                    </div>
                  </div>
                )}

                {/* Tab 2: Diagram Preview (Interactive selection & filter dimming) */}
                {activeTab === 'diagram' && previewLayout && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
                    <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>
                        Bản xem trước bố cục: <strong className="text-slate-900 dark:text-white">{layoutSubtitle}</strong> (Nhấp nút để chọn nhánh)
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Cam: Cáp quang OS2 · Xanh dương: Cat6/6A
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50/30 dark:bg-slate-950">
                      <svg
                        viewBox={`${previewLayout.bounds.minX - 40} ${previewLayout.bounds.minY - 35} ${Math.max(300, previewLayout.bounds.maxX - previewLayout.bounds.minX + 80)} ${Math.max(200, previewLayout.bounds.maxY - previewLayout.bounds.minY + 70)}`}
                        className="w-full h-72 rounded-lg bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800"
                        aria-label="Bản xem trước sơ đồ cây Router"
                      >
                        {/* Floor Swimlanes in Theo tầng mode */}
                        {previewLayout.floorBands.map(b => (
                          <g
                            key={`band_${b.floorName}`}
                            opacity={floorFilter === 'ALL' || floorFilter === b.floorName ? 1 : 0.28}
                          >
                            <rect
                              x={b.x}
                              y={b.y}
                              width={b.width}
                              height={b.height}
                              rx="10"
                              fill="#eff6ff"
                              fillOpacity="0.6"
                              stroke="#93c5fd"
                              strokeWidth="1.5"
                              strokeDasharray="6 4"
                            />
                            <text
                              x={b.x + 14}
                              y={b.y + 22}
                              fontSize="13"
                              fontWeight="700"
                              fill="#1d4ed8"
                            >
                              {b.floorName}
                            </text>
                          </g>
                        ))}

                        {/* Orthogonal Links */}
                        {parsed.links.map(link => {
                          const p1 = previewLayout.positions.get(link.parentName);
                          const p2 = previewLayout.positions.get(link.childName);
                          if (!p1 || !p2) return null;
                          const color = getPreviewCableColor(link.cableType);
                          const isVisibleLink =
                            visibleTreeNames.has(link.parentName) && visibleTreeNames.has(link.childName);
                          let pathD = '';
                          let midX = 0;
                          let midY = 0;

                          if (layoutMode === 'horizontal') {
                            const x1 = p1.x + p1.width;
                            const y1 = p1.y + p1.height / 2;
                            const x2 = p2.x;
                            const y2 = p2.y + p2.height / 2;
                            const mx = (x1 + x2) / 2;
                            pathD = `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
                            midX = mx;
                            midY = (y1 + y2) / 2;
                          } else {
                            const x1 = p1.x + p1.width / 2;
                            const y1 = p1.y + p1.height;
                            const x2 = p2.x + p2.width / 2;
                            const y2 = p2.y;
                            const my = (y1 + y2) / 2;
                            pathD = `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`;
                            midX = (x1 + x2) / 2;
                            midY = my;
                          }

                          return (
                            <g key={link.id} opacity={isVisibleLink ? 1 : 0.16}>
                              <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
                              <text
                                x={midX}
                                y={midY - 4}
                                textAnchor="middle"
                                fontSize="8"
                                fontWeight="600"
                                fill={color}
                              >
                                {link.parentPort} → {link.localPort}
                              </text>
                            </g>
                          );
                        })}

                        {/* Nodes */}
                        {parsed.nodes.map(n => {
                          const pos = previewLayout.positions.get(n.name);
                          if (!pos) return null;
                          const style = getTierBadgeStyle(n.depth);
                          const isSelected = selectedNodeName === n.name;
                          const isVisible = visibleTreeNames.has(n.name);
                          const isDirect = directMatchNames.has(n.name);
                          return (
                            <g
                              key={`pv_${n.name}`}
                              transform={`translate(${pos.x}, ${pos.y})`}
                              opacity={isVisible ? (isDirect ? 1 : 0.68) : 0.18}
                              onClick={() => setSelectedNodeName(n.name)}
                              className="cursor-pointer"
                            >
                              <rect
                                width={pos.width}
                                height={pos.height}
                                rx="8"
                                fill={style.bg}
                                stroke={isSelected ? '#f59e0b' : '#0f172a'}
                                strokeOpacity={isSelected ? 1 : 0.25}
                                strokeWidth={isSelected ? 3 : 1.5}
                              />
                              <text
                                x={pos.width / 2}
                                y={25}
                                textAnchor="middle"
                                fontSize="12"
                                fontWeight="700"
                                fill="#ffffff"
                              >
                                {n.name}
                              </text>
                              <text
                                x={pos.width / 2}
                                y={42}
                                textAnchor="middle"
                                fontSize="9.5"
                                fontFamily="ui-monospace, monospace"
                                fill="#e2e8f0"
                              >
                                {n.floorName} · {n.ipAddress}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>
                )}

                {/* Tab 3: Data Table */}
                {activeTab === 'table' && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div className="max-h-72 overflow-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="px-3 py-2 font-semibold w-10">#</th>
                            <th className="px-3 py-2 font-semibold">Thiết bị</th>
                            <th className="px-3 py-2 font-semibold">Router Cha (Uplink)</th>
                            <th className="px-3 py-2 font-semibold">Tầng / Khu Vực</th>
                            <th className="px-3 py-2 font-semibold">Cấp</th>
                            <th className="px-3 py-2 font-semibold">IP / VLAN</th>
                            <th className="px-3 py-2 font-semibold">Loại cáp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                          {parsed.nodes
                            .filter(n => visibleTreeNames.has(n.name))
                            .map((n, idx) => {
                              const isSelected = selectedNodeName === n.name;
                              return (
                                <tr
                                  key={n.name}
                                  onClick={() => setSelectedNodeName(n.name)}
                                  className={`cursor-pointer transition-colors ${
                                    isSelected
                                      ? 'bg-blue-50/70 dark:bg-blue-950/35'
                                      : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                                  }`}
                                >
                                  <td className="px-3 py-2 text-slate-400 font-mono tabular-nums">{idx + 1}</td>
                                  <td className="px-3 py-2 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                    <span style={{ paddingLeft: `${Math.max(0, n.depth - 1) * 14}px` }}>
                                      {n.depth > 1 ? '└─ ' : ''}
                                      {n.name}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-[#155EEF] dark:text-blue-400 whitespace-nowrap">
                                    {n.parents.length > 0 ? n.parents.join(', ') : '– (Gốc)'}
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                    {n.floorName}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-slate-500 dark:text-slate-400">T{n.depth}</td>
                                  <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                    {n.ipAddress} · VLAN {n.vlan}
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                    {n.parents.length > 0 ? n.cableLabel : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Unified Selected Breadcrumb Footer across ALL 3 tabs */}
                {selectedNodeInfo && (
                  <div className="px-3 py-2 rounded-lg bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">Đường dẫn nhánh:</span>
                      {selectedBreadcrumb.map((b, i) => (
                        <React.Fragment key={b}>
                          {i > 0 && <span className="text-slate-400">›</span>}
                          <span className="px-2 py-0.5 rounded bg-[#155EEF] text-white font-bold text-[11px]">
                            {b}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                    <span className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                      {selectedNodeInfo.vendor} {selectedNodeInfo.model} · VLAN {selectedNodeInfo.vlan} · {selectedNodeInfo.powerWatts}W
                    </span>
                  </div>
                )}
              </div>

              {parsed.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Lưu ý dữ liệu ({parsed.warnings.length}):</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                    {parsed.warnings.slice(0, 4).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {parsed
              ? `Sẵn sàng tạo ${parsed.nodes.length} thiết bị và ${parsed.links.length} dây nối trên ${parsed.floors.length} tầng.`
              : 'Bước 1: Tải file Excel mẫu · Bước 2: Nhập cột Router Cha và kéo thả lại vào đây.'}
          </div>
          <div className="flex items-center gap-2">
            {parsed && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#155EEF] text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
              >
                Chọn file khác
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={!parsed}
              onClick={handleConfirmCreate}
              className="h-9 px-4 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2 transition-colors shadow-xs"
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span>{applyMode === 'merge' ? 'Gộp Vào Bản Vẽ' : 'Tạo Sơ Đồ Từ Excel'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
