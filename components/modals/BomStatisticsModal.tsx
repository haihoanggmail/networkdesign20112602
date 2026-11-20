import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Cable,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  GitCompare,
  Globe,
  Info,
  Layers,
  Loader2,
  Network,
  Package,
  RotateCcw,
  Scissors,
  Search,
  Server,
  Sliders,
  Upload,
  Wrench,
  X,
  Zap
} from 'lucide-react';
import type { CADDocument } from '../../cad/core/CADTypes';
import { ProjectRevision, ProjectState } from '../../types/infrastructure';
import {
  BomComparisonResult,
  BomFilterOptions,
  compareProjectBoms,
  computeProjectBomStats,
  DEFAULT_BOM_ASSUMPTIONS,
  optimizeCableSpools
} from '../../utils/bomAggregator';
import {
  BomPricingCatalogData,
  clearBomPriceOverrides,
  clearCustomPricingCatalog,
  exportPricingCatalogJson,
  fetchPricingCatalogFromApi,
  formatVnd,
  getDefaultBomPricingCatalog,
  loadActivePricingCatalog,
  loadBomPriceOverrides,
  saveBomPriceOverrides,
  saveCustomPricingCatalog,
  validateAndMergePricingCatalog
} from '../../utils/bomPricingCatalog';
import {
  CAD_BOM_TARGET_LABELS,
  CadBomTargetKind
} from '../../utils/cadBomExtractor';
import { exportProjectBomCsv, formatBomTsvForClipboard } from '../../utils/bomCsvExporter';
import { computeProjectSubnetIpStats } from '../../utils/ipAutoAssign';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { APP_VERSION } from '../../config/appInfo';
import { listRevisionsFromDB, migrateAndValidateProject, saveRevisionToDB } from '../../utils/projectStorage';
import { SubnetIpStatsPanel } from '../properties/SubnetIpStatsPanel';

export type BomTab = 'devices' | 'cables' | 'accessories' | 'multiview' | 'subnets' | 'compare' | 'assumptions';
type MultiViewMode = 'floors' | 'rooms' | 'systems' | 'racks';

interface BomStatisticsModalProps {
  project: ProjectState;
  cadDocument?: CADDocument | null;
  isOpen: boolean;
  initialTab?: BomTab;
  onClose: () => void;
  onShowToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
  onSelectOnCanvas?: (target: { type: 'node' | 'edge' | 'floor'; ids: string[]; label: string }) => void;
}

export const BomStatisticsModal: React.FC<BomStatisticsModalProps> = ({
  project,
  cadDocument = null,
  isOpen,
  initialTab,
  onClose,
  onShowToast,
  onSelectOnCanvas
}) => {
  const defaultBuildingFloorHeight = project.buildings?.[0]?.floorHeightMeters || DEFAULT_BOM_ASSUMPTIONS.floorHeightMeters;
  const [activeTab, setActiveTab] = useState<BomTab>(initialTab || 'devices');
  const [multiViewMode, setMultiViewMode] = useState<MultiViewMode>('floors');
  const [showSpoolPlan, setShowSpoolPlan] = useState(false);

  const [copperLossPct, setCopperLossPct] = useState<number>(DEFAULT_BOM_ASSUMPTIONS.copperLossPct);
  const [fiberLossPct, setFiberLossPct] = useState<number>(DEFAULT_BOM_ASSUMPTIONS.fiberLossPct);
  const [serviceLoopMetersPerEnd, setServiceLoopMetersPerEnd] = useState<number>(
    DEFAULT_BOM_ASSUMPTIONS.serviceLoopMetersPerEnd
  );
  const [dropHeightMeters, setDropHeightMeters] = useState<number>(DEFAULT_BOM_ASSUMPTIONS.dropHeightMeters);
  const [floorHeightMeters, setFloorHeightMeters] = useState<number>(defaultBuildingFloorHeight);
  const [copperSpoolMeters, setCopperSpoolMeters] = useState<number>(
    DEFAULT_BOM_ASSUMPTIONS.copperSpoolMeters
  );
  const [fiberSpoolMeters, setFiberSpoolMeters] = useState<number>(
    DEFAULT_BOM_ASSUMPTIONS.fiberSpoolMeters
  );
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>(() => loadBomPriceOverrides());

  // Dynamic Pricing Catalog (JSON + Open API)
  const [pricingCatalog, setPricingCatalog] = useState<BomPricingCatalogData>(() => loadActivePricingCatalog());
  const [catalogApiUrl, setCatalogApiUrl] = useState<string>('');
  const [isSyncingCatalog, setIsSyncingCatalog] = useState(false);

  // CAD Auto-Extract Options
  const [cadExtractEnabled, setCadExtractEnabled] = useState<boolean>(true);
  const [cadLayerMappings, setCadLayerMappings] = useState<Record<string, CadBomTargetKind>>({});
  const [showCadLayerConfig, setShowCadLayerConfig] = useState<boolean>(false);

  // Extended Quotation Calculator (Auxiliary Materials % & Labor Cost)
  const [auxMaterialPct, setAuxMaterialPct] = useState<number>(
    () => loadActivePricingCatalog().quotationDefaults?.defaultAuxMaterialPct ?? 5
  );
  const [laborWorkdays, setLaborWorkdays] = useState<number>(0);
  const [laborUnitPriceVnd, setLaborUnitPriceVnd] = useState<number>(
    () => loadActivePricingCatalog().quotationDefaults?.defaultLaborUnitPriceVnd ?? 650_000
  );

  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>('');
  const [uploadedBaselineProject, setUploadedBaselineProject] = useState<ProjectState | null>(null);
  const [uploadedBaselineName, setUploadedBaselineName] = useState<string>('');

  const [copied, setCopied] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const baselineFileRef = useRef<HTMLInputElement>(null);
  const catalogFileRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    listRevisionsFromDB(project.id)
      .then((list: ProjectRevision[]) => {
        if (!active) return;
        setRevisions(list);
        if (list.length > 0 && !selectedRevisionId) {
          setSelectedRevisionId(list[0].id);
        }
      })
      .catch(() => {
        if (active) setRevisions([]);
      });
    return () => {
      active = false;
    };
  }, [isOpen, project.id, selectedRevisionId]);

  const bomOptions: BomFilterOptions = useMemo(
    () => ({
      copperLossPct,
      fiberLossPct,
      serviceLoopMetersPerEnd,
      dropHeightMeters,
      floorHeightMeters,
      copperSpoolMeters,
      fiberSpoolMeters,
      floorId: floorFilter,
      category: categoryFilter,
      searchQuery,
      priceOverrides,
      pricingCatalog,
      cadDocument,
      cadExtractEnabled,
      cadLayerMappings,
      auxMaterialPct,
      laborWorkdays,
      laborUnitPriceVnd
    }),
    [
      copperLossPct,
      fiberLossPct,
      serviceLoopMetersPerEnd,
      dropHeightMeters,
      floorHeightMeters,
      copperSpoolMeters,
      fiberSpoolMeters,
      floorFilter,
      categoryFilter,
      searchQuery,
      priceOverrides,
      pricingCatalog,
      cadDocument,
      cadExtractEnabled,
      cadLayerMappings,
      auxMaterialPct,
      laborWorkdays,
      laborUnitPriceVnd
    ]
  );

  const bomStats = useMemo(
    () => computeProjectBomStats(project, bomOptions),
    [project, bomOptions]
  );

  const subnetIpStats = useMemo(
    () => computeProjectSubnetIpStats(project),
    [project]
  );

  const spoolPlans = useMemo(() => {
    if (!showSpoolPlan || activeTab !== 'cables') return [];
    return optimizeCableSpools(project, bomOptions);
  }, [project, bomOptions, showSpoolPlan, activeTab]);

  const baselineComparison: BomComparisonResult | null = useMemo(() => {
    if (activeTab !== 'compare') return null;
    const revSnapshot = revisions.find(r => r.id === selectedRevisionId)?.snapshot;
    const baselineProject = uploadedBaselineProject || revSnapshot;
    if (!baselineProject) return null;
    const baseStats = computeProjectBomStats(baselineProject, { ...bomOptions, floorId: 'all', category: 'all', searchQuery: '' });
    const currentUnfiltered = computeProjectBomStats(project, { ...bomOptions, floorId: 'all', category: 'all', searchQuery: '' });
    return compareProjectBoms(baseStats, currentUnfiltered);
  }, [activeTab, revisions, selectedRevisionId, uploadedBaselineProject, project, bomOptions]);

  if (!isOpen) return null;

  const { kpis, precision } = bomStats;
  const hasActiveFilters = floorFilter !== 'all' || categoryFilter !== 'all' || searchQuery.trim().length > 0;

  const handleUpdateUnitPrice = (key: string, nextValue: string) => {
    const num = Math.max(0, Math.round(Number(nextValue) || 0));
    const updated = { ...priceOverrides, [key]: num };
    setPriceOverrides(updated);
    saveBomPriceOverrides(updated);
  };

  const handleResetPrices = () => {
    clearBomPriceOverrides();
    setPriceOverrides({});
    onShowToast?.('Đã khôi phục đơn giá tham chiếu từ danh mục đang kích hoạt.', 'info');
  };

  const handleUploadPricingCatalogJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const res = validateAndMergePricingCatalog(parsed, `JSON: ${file.name}`);
      if (!res.ok) {
        onShowToast?.(res.error, 'error');
        return;
      }
      saveCustomPricingCatalog(res.catalog);
      setPricingCatalog(res.catalog);
      onShowToast?.(`Đã nạp danh mục giá động "${res.catalog.catalogVersion}" từ ${file.name}.`, 'success');
    } catch {
      onShowToast?.('Không đọc được tệp JSON danh mục giá.', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleExportPricingCatalogJson = () => {
    const content = exportPricingCatalogJson(pricingCatalog);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `HACHIHI_PricingCatalog_${pricingCatalog.catalogVersion || 'custom'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    onShowToast?.('Đã xuất tệp cấu hình danh mục giá (JSON).', 'success');
  };

  const handleSyncCatalogFromApi = async () => {
    if (isSyncingCatalog) return;
    setIsSyncingCatalog(true);
    try {
      const res = await fetchPricingCatalogFromApi(catalogApiUrl);
      if (!res.ok) {
        onShowToast?.(res.error, 'error');
        return;
      }
      setPricingCatalog(res.catalog);
      onShowToast?.(`Đã đồng bộ bảng giá phiên bản ${res.catalog.catalogVersion} từ API.`, 'success');
    } finally {
      setIsSyncingCatalog(false);
    }
  };

  const handleResetPricingCatalog = () => {
    clearCustomPricingCatalog();
    const def = getDefaultBomPricingCatalog();
    setPricingCatalog(def);
    onShowToast?.('Đã khôi phục danh mục giá JSON mặc định của hệ thống.', 'info');
  };

  const handleEstimateLaborWorkdays = () => {
    const suggested = Math.max(
      1,
      Math.ceil(
        (bomStats.kpis.deviceCount + bomStats.kpis.rackCount * 2) * 0.25 +
          bomStats.kpis.rawCableMeters / 120
      )
    );
    setLaborWorkdays(suggested);
    onShowToast?.(`Đã ước tính ${suggested} ngày công theo quy mô thiết bị & mét cáp.`, 'info');
  };

  const handleUploadBaselineJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const res = migrateAndValidateProject(parsed);
      if (!res.ok) {
        onShowToast?.(res.error || 'Tệp JSON so sánh không hợp lệ.', 'error');
        return;
      }
      setUploadedBaselineProject(res.project);
      setUploadedBaselineName(file.name);
      onShowToast?.(`Đã nạp mốc so sánh từ tệp ${file.name}.`, 'success');
    } catch {
      onShowToast?.('Không đọc được tệp JSON dự án so sánh.', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleLockBomSnapshot = async () => {
    const nowIso = new Date().toISOString();
    const stampLabel = `Chốt BOM (${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    })})`;
    const snapshot = structuredClone(project);
    const rev: ProjectRevision = {
      id: `rev_bom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      projectId: project.id,
      label: stampLabel,
      note: `${bomStats.kpis.deviceCount} TB · ${bomStats.kpis.totalCableWithReserveMeters}m cáp · ${formatVnd(bomStats.kpis.estimatedGrandTotalVnd)}`,
      createdAt: nowIso,
      author: project.author || 'Kỹ sư hệ thống',
      nodeCount: snapshot.nodes.length,
      assetCount: Object.keys(snapshot.assets).length,
      rackCount: snapshot.racks.length,
      cableCount: snapshot.cables.length,
      snapshot
    };
    const ok = await saveRevisionToDB(rev);
    if (ok) {
      setRevisions(prev => [rev, ...prev]);
      setUploadedBaselineProject(null);
      setUploadedBaselineName('');
      setSelectedRevisionId(rev.id);
      onShowToast?.(`Đã chốt mốc "${stampLabel}" để đối chiếu chênh lệch BOM.`, 'success');
    } else {
      onShowToast?.('Không thể lưu mốc chốt BOM vào IndexedDB.', 'error');
    }
  };

  const handleCopyBom = async () => {
    try {
      const tsv = formatBomTsvForClipboard(project, bomOptions);
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      onShowToast?.('Đã sao chép bảng vật tư BOM vào clipboard (dán trực tiếp vào Excel)!', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onShowToast?.('Không thể truy cập clipboard trong trình duyệt này.', 'error');
    }
  };

  const handleExportCsv = () => {
    try {
      const { filename, summary } = exportProjectBomCsv(project, bomOptions);
      onShowToast?.(
        `Đã xuất ${filename} (${summary.assetCount} TB, ${summary.totalCableWithReserveMeters} m cáp kèm dự phòng)!`,
        'success'
      );
    } catch (err: unknown) {
      onShowToast?.(`Lỗi xuất CSV: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleExportDetailedExcel = async () => {
    if (isExportingExcel) return;
    setIsExportingExcel(true);
    try {
      const { exportBomDetailedExcel } = await import('../../utils/excelService');
      await exportBomDetailedExcel(project, bomOptions);
      onShowToast?.(
        'Đã xuất Workbook Excel Dự toán BOM (kèm SKU, đơn giá VNĐ & công thức sống)!',
        'success'
      );
    } catch (err: unknown) {
      onShowToast?.(`Lỗi xuất Excel: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const resetFilters = () => {
    setFloorFilter('all');
    setCategoryFilter('all');
    setSearchQuery('');
  };

  const resetAssumptions = () => {
    setCopperLossPct(DEFAULT_BOM_ASSUMPTIONS.copperLossPct);
    setFiberLossPct(DEFAULT_BOM_ASSUMPTIONS.fiberLossPct);
    setServiceLoopMetersPerEnd(DEFAULT_BOM_ASSUMPTIONS.serviceLoopMetersPerEnd);
    setDropHeightMeters(DEFAULT_BOM_ASSUMPTIONS.dropHeightMeters);
    setFloorHeightMeters(defaultBuildingFloorHeight);
    setCopperSpoolMeters(DEFAULT_BOM_ASSUMPTIONS.copperSpoolMeters);
    setFiberSpoolMeters(DEFAULT_BOM_ASSUMPTIONS.fiberSpoolMeters);
    onShowToast?.('Đã khôi phục thông số giả định BOM mặc định.', 'info');
  };

  const formatDelta = (n: number, suffix = '') => {
    if (n === 0) return `0${suffix}`;
    return `${n > 0 ? '+' : ''}${n}${suffix}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Thống kê Vật tư và Dự toán Hạ tầng BOM"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4 no-print"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full h-dvh sm:h-auto sm:max-w-6xl sm:max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-100 text-xs outline-none pb-safe"
      >
        {/* Header Bar */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-[#155EEF] text-white flex items-center justify-center shrink-0">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                Bảng vật tư (BOM) &amp; Dự toán chi phí (VNĐ)
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="truncate max-w-[220px]">{project.name}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">HACHIHI v{APP_VERSION}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                  Báo giá hoàn thiện: {formatVnd(bomStats.quotation.finalQuotationTotalVnd)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyBom()}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                  <span className="text-[#16A34A] dark:text-emerald-400">Đã sao chép</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Sao chép BOM</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Xuất CSV</span>
            </button>

            <button
              type="button"
              onClick={() => void handleExportDetailedExcel()}
              disabled={isExportingExcel}
              className="h-9 px-3.5 rounded-lg bg-[#16A34A] hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap transition-colors"
              title="Xuất workbook BOM dự toán kèm SKU, đơn giá VNĐ và công thức sống"
            >
              {isExportingExcel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5" />
              )}
              <span>Xuất Excel Dự toán</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng bảng thống kê vật tư BOM"
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50/40 dark:bg-slate-950/30">
          {/* 4-Card KPI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Thiết bị &amp; Tủ Rack
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                  {kpis.deviceCount} TB · {kpis.rackCount} Tủ
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                  {kpis.usedRackU}/{kpis.totalRackU}U · {formatVnd(kpis.devicesTotalVnd)}
                </div>
              </div>
              <Server className="w-4 h-4 text-[#155EEF] dark:text-blue-400 shrink-0 mt-0.5" />
            </div>

            <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Cáp đặt hàng &amp; Máng
                </div>
                <div className="text-lg font-bold text-[#155EEF] dark:text-blue-400 font-mono tabular-nums mt-0.5">
                  {kpis.totalCableWithReserveMeters} m
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                  {kpis.cableCount} tuyến · Máng {kpis.trayTotalMeters} m
                </div>
              </div>
              <Cable className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
            </div>

            <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  Tải điện &amp; UPS đề xuất
                </div>
                <div className="text-lg font-bold text-[#16A34A] dark:text-emerald-400 font-mono tabular-nums mt-0.5">
                  {kpis.totalPowerKw} kW ({kpis.totalPowerWatts} W)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                  UPS ≥ {kpis.recommendedUpsVa} VA (+30%)
                </div>
              </div>
              <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            </div>

            <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Tổng báo giá hoàn thiện
                </div>
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300 font-mono tabular-nums mt-0.5 truncate" title={formatVnd(bomStats.quotation.finalQuotationTotalVnd)}>
                  {formatVnd(bomStats.quotation.finalQuotationTotalVnd)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                  Vật tư: {formatVnd(kpis.estimatedGrandTotalVnd)}
                </div>
              </div>
              <Package className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            </div>
          </div>

          {/* Extended Quotation Calculator (Auxiliary Materials % + Labor Cost) */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-[#155EEF] dark:text-blue-400 shrink-0" />
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    Bảng tính Báo giá Thi công (Vật tư + Vật tư phụ + Nhân công)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    Tổng báo giá = {formatVnd(bomStats.quotation.materialSubtotalVnd)} + {auxMaterialPct}% ({formatVnd(bomStats.quotation.auxMaterialCostVnd)}) + ({laborWorkdays} công × {formatVnd(laborUnitPriceVnd)})
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEstimateLaborWorkdays}
                  className="h-7 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap"
                >
                  Ước tính công
                </button>
                <div className="text-right pl-2 border-l border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Chốt báo giá (chưa VAT)</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                    {formatVnd(bomStats.quotation.finalQuotationTotalVnd)}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <label className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                  % Vật tư phụ (hạt, thít, ruột gà)
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    aria-label="Phần trăm vật tư phụ"
                    value={auxMaterialPct}
                    onChange={e => setAuxMaterialPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    className="w-20 h-8 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs text-right outline-none focus:border-[#155EEF]"
                  />
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                    = {formatVnd(bomStats.quotation.auxMaterialCostVnd)}
                  </span>
                </div>
              </label>

              <label className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                  Số công thi công (ngày công)
                </span>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={0.5}
                  aria-label="Số công thi công"
                  value={laborWorkdays}
                  onChange={e => setLaborWorkdays(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs text-right outline-none focus:border-[#155EEF]"
                />
              </label>

              <label className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 block">
                  Đơn giá nhân công (VNĐ/công)
                </span>
                <input
                  type="number"
                  min={0}
                  step={50000}
                  aria-label="Đơn giá nhân công"
                  value={laborUnitPriceVnd}
                  onChange={e => setLaborUnitPriceVnd(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs text-right outline-none focus:border-[#155EEF]"
                />
              </label>

              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col justify-between">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Thành tiền nhân công
                </span>
                <div className="text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatVnd(bomStats.quotation.laborTotalVnd)}
                </div>
              </div>
            </div>
          </div>

          {/* Accuracy Notice Strip */}
          {precision.warnings.length > 0 && activeTab !== 'assumptions' && (
            <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/25 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="truncate">{precision.warnings[0].message}</span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('assumptions')}
                className="font-semibold text-[#155EEF] dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                Xem đối soát &amp; giả định ({precision.warnings.length}) &rarr;
              </button>
            </div>
          )}

          {/* Sub-tabs & Filters */}
          <div className="space-y-3">
            <div
              role="tablist"
              aria-label="Nhóm bảng kê vật tư"
              className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'devices'}
                onClick={() => setActiveTab('devices')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === 'devices'
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Thiết bị &amp; SKU ({bomStats.deviceRows.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'cables'}
                onClick={() => setActiveTab('cables')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === 'cables'
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Dây cáp &amp; Cắt cuộn ({bomStats.cableRows.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'accessories'}
                onClick={() => setActiveTab('accessories')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'accessories'
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Phụ kiện &amp; Máng ({bomStats.inferredAccessories.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'multiview'}
                onClick={() => setActiveTab('multiview')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'multiview'
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Đa góc nhìn (Tầng / Phòng / Hệ)</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'subnets'}
                onClick={() => setActiveTab('subnets')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'subnets'
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Network className="w-3.5 h-3.5" />
                <span>Thống kê IP / Subnet ({subnetIpStats.subnets.length})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'compare'}
                onClick={() => setActiveTab('compare')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'compare'
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>So sánh BOM</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'assumptions'}
                onClick={() => setActiveTab('assumptions')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                  activeTab === 'assumptions'
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>
                  Giả định &amp; Đối soát
                  {precision.warnings.length > 0 ? ` (${precision.warnings.length})` : ''}
                </span>
              </button>
            </div>

            {/* Filter Strip */}
            {activeTab !== 'assumptions' && activeTab !== 'accessories' && activeTab !== 'compare' && (
              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={floorFilter}
                  onChange={e => setFloorFilter(e.target.value)}
                  aria-label="Lọc theo tầng"
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 outline-none focus:border-[#155EEF] min-w-[180px]"
                >
                  <option value="all">Tất cả các tầng ({project.floors.length})</option>
                  {project.floors
                    .slice()
                    .sort((a, b) => a.level - b.level)
                    .map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>

                {activeTab !== 'subnets' && (
                  <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    aria-label="Lọc theo phân nhóm vật tư"
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 outline-none focus:border-[#155EEF] min-w-[160px]"
                  >
                    <option value="all">Mọi phân nhóm</option>
                    {bomStats.availableCategories.map(cat => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                )}

                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={
                      activeTab === 'subnets'
                        ? 'Tìm tên Subnet, CIDR, VLAN, tên thiết bị, địa chỉ IP...'
                        : 'Lọc mã SKU, hãng, model, loại cáp...'
                    }
                    aria-label="Tìm kiếm trong bảng kê vật tư"
                    className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-[#155EEF]"
                  />
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap"
                  >
                    Xóa bộ lọc
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Data Content Container */}
          {activeTab === 'assumptions' ? (
            <div className="space-y-4">
              {/* Editable BOM Assumptions */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Thông số giả định tính dự toán cáp &amp; bảng giá
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Thay đổi trực tiếp được áp dụng ngay vào toàn bộ bảng BOM, CSV và công thức Excel.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResetPrices}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Đặt lại đơn giá VNĐ</span>
                    </button>
                    <button
                      type="button"
                      onClick={resetAssumptions}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Khôi phục giả định</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <label className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                      Hao hụt cáp đồng (%)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={copperLossPct}
                      onChange={e => setCopperLossPct(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                      className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Áp dụng cho Cat6, Cat6A, cáp nguồn
                    </span>
                  </label>

                  <label className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                      Hao hụt cáp quang (%)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={fiberLossPct}
                      onChange={e => setFiberLossPct(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                      className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Áp dụng cho quang OS2 và OM4
                    </span>
                  </label>

                  <label className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                      Dự phòng mỗi đầu cáp (m)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={15}
                      step={0.5}
                      value={serviceLoopMetersPerEnd}
                      onChange={e =>
                        setServiceLoopMetersPerEnd(Math.max(0, Math.min(15, Number(e.target.value) || 0)))
                      }
                      className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Service loop 2 đầu/tuyến trước khi nhân hao hụt
                    </span>
                  </label>

                  <label className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                      Quy cách cuộn cáp đồng (m)
                    </span>
                    <input
                      type="number"
                      min={50}
                      max={2000}
                      value={copperSpoolMeters}
                      onChange={e =>
                        setCopperSpoolMeters(Math.max(50, Math.min(2000, Number(e.target.value) || 305)))
                      }
                      className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Chuẩn thùng Cat6 thường 305 m / cuộn
                    </span>
                  </label>

                  <label className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                      Quy cách cuộn cáp quang (m)
                    </span>
                    <input
                      type="number"
                      min={100}
                      max={5000}
                      value={fiberSpoolMeters}
                      onChange={e =>
                        setFiberSpoolMeters(Math.max(100, Math.min(5000, Number(e.target.value) || 1000)))
                      }
                      className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Chuẩn rulo quang 1000 m hoặc 2000 m
                    </span>
                  </label>

                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Chiều cao thả trần / đầu (m)
                      </span>
                      <button
                        type="button"
                        onClick={() => setDropHeightMeters(dropHeightMeters === 1.5 ? 0 : 1.5)}
                        className="text-[11px] font-semibold text-[#155EEF] dark:text-blue-400 hover:underline"
                      >
                        {dropHeightMeters === 1.5 ? 'Đặt 0m' : 'Chuẩn 1.5m/đầu'}
                      </button>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={15}
                      step={0.5}
                      aria-label="Chiều cao thả trần mỗi đầu (m)"
                      value={dropHeightMeters}
                      onChange={e =>
                        setDropHeightMeters(Math.max(0, Math.min(15, Number(e.target.value) || 0)))
                      }
                      className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Đoạn đi đứng từ máng trần xuống tủ/ổ cắm (×2 đầu)
                    </span>
                  </div>

                  <label className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
                      Chiều cao thông tầng (m/tầng)
                    </span>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      step={0.1}
                      value={floorHeightMeters}
                      onChange={e =>
                        setFloorHeightMeters(Math.max(2, Math.min(12, Number(e.target.value) || 3.8)))
                      }
                      className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      Tự cộng trục đứng cho tuyến cáp đi liên tầng
                    </span>
                  </label>
                </div>
                <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/70 rounded-lg px-3 py-2">
                  Công thức: L_đặt = (L_ngang + L_vượt_tầng + 2×Thả_trần + 2×Đầu_cáp) × (1 + Hao_hụt%)
                </div>
              </div>

              {/* Dynamic Pricing Catalog Loader (JSON / Open API) */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileJson className="w-4 h-4 text-[#155EEF] shrink-0" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Danh mục giá vật tư động (JSON / API mở)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        Đang dùng: <span className="font-mono font-semibold">{pricingCatalog.catalogVersion}</span> · {pricingCatalog.sourceLabel} (cập nhật {pricingCatalog.updatedAt})
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={catalogFileRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={e => void handleUploadPricingCatalogJson(e)}
                    />
                    <button
                      type="button"
                      onClick={() => catalogFileRef.current?.click()}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Nạp bảng giá JSON</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportPricingCatalogJson}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Xuất JSON chuẩn</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetPricingCatalog}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Catalog mặc định</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[240px]">
                    <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="url"
                      value={catalogApiUrl}
                      onChange={e => setCatalogApiUrl(e.target.value)}
                      placeholder="Nhập URL API bảng giá JSON (vd: https://example.com/pricing.json hoặc /api/pricing)"
                      aria-label="URL API danh mục giá JSON"
                      className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono outline-none focus:border-[#155EEF]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSyncCatalogFromApi()}
                    disabled={isSyncingCatalog || !catalogApiUrl.trim()}
                    className="h-9 px-3.5 rounded-lg bg-[#155EEF] hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {isSyncingCatalog && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Đồng bộ API</span>
                  </button>
                </div>
              </div>

              {/* Precision Cross-Check */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Đối soát chéo tổng mét cáp gốc (3 chiều tính toán)
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                      precision.isConsistent
                        ? 'text-[#16A34A] dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {precision.isConsistent ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Khớp tuyệt đối (Sai lệch {precision.deltaMeters} m)</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        <span>Sai lệch {precision.deltaMeters} m</span>
                      </>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">Tổng theo từng tuyến</div>
                    <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      {precision.routeTotalMeters} m
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">Tổng theo chủng loại cáp</div>
                    <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      {precision.typeTotalMeters} m
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans">Tổng quy về theo tầng</div>
                    <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      {precision.floorTotalMeters} m
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  {precision.warnings.length === 0 ? (
                    <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Không phát hiện bất thường về cự ly cáp TIA-568 hay dữ liệu chiều dài bằng 0.</span>
                    </div>
                  ) : (
                    precision.warnings.map(w => (
                      <div
                        key={w.code}
                        className={`p-3 rounded-lg border flex items-start gap-2.5 text-xs ${
                          w.severity === 'warning'
                            ? 'border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/25 text-amber-900 dark:text-amber-200'
                            : 'border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/25 text-blue-900 dark:text-blue-200'
                        }`}
                      >
                        {w.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        ) : (
                          <Info className="w-4 h-4 text-[#155EEF] shrink-0 mt-0.5" />
                        )}
                        <span>{w.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === 'compare' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                    Mốc so sánh:
                  </span>
                  <select
                    value={uploadedBaselineProject ? '__uploaded__' : selectedRevisionId}
                    onChange={e => {
                      setUploadedBaselineProject(null);
                      setUploadedBaselineName('');
                      setSelectedRevisionId(e.target.value);
                    }}
                    aria-label="Chọn mốc phiên bản để so sánh BOM"
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-[#155EEF] min-w-[240px]"
                  >
                    {uploadedBaselineProject && (
                      <option value="__uploaded__">Tệp JSON: {uploadedBaselineName}</option>
                    )}
                    {revisions.length === 0 ? (
                      <option value="">(Chưa có mốc Revision lưu trong dự án)</option>
                    ) : (
                      revisions.map(rev => (
                        <option key={rev.id} value={rev.id}>
                          {rev.label} ({new Date(rev.createdAt).toLocaleString('vi-VN')})
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={baselineFileRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={e => void handleUploadBaselineJson(e)}
                  />
                  <button
                    type="button"
                    onClick={() => void handleLockBomSnapshot()}
                    className="h-9 px-3 rounded-lg bg-[#155EEF] hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Chốt mốc BOM hiện tại</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => baselineFileRef.current?.click()}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Nạp tệp JSON khác để so sánh</span>
                  </button>
                </div>
              </div>

              {!baselineComparison ? (
                <div className="p-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-slate-500 dark:text-slate-400">
                  Hãy lưu ít nhất 1 mốc Lịch sử phiên bản (trong Quản lý Dự án) hoặc nạp 1 tệp JSON dự án bất kỳ để so sánh chênh lệch vật tư &amp; chi phí (B6).
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Chênh lệch Thiết bị</div>
                      <div className="text-base font-bold font-mono mt-0.5">{formatDelta(baselineComparison.kpis.deviceCountDelta, ' TB')}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Chênh lệch Cáp</div>
                      <div className="text-base font-bold font-mono mt-0.5">{formatDelta(baselineComparison.kpis.cableMetersDelta, ' m')}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Chênh lệch Tải điện</div>
                      <div className="text-base font-bold font-mono mt-0.5">{formatDelta(baselineComparison.kpis.powerWattsDelta, ' W')}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">Chênh lệch Dự toán</div>
                      <div className={`text-base font-bold font-mono mt-0.5 ${baselineComparison.kpis.estimatedCostDeltaVnd > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {baselineComparison.kpis.estimatedCostDeltaVnd >= 0 ? '+' : ''}
                        {formatVnd(baselineComparison.kpis.estimatedCostDeltaVnd)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                          <th className="py-2.5 px-3">Hạng mục so sánh</th>
                          <th className="py-2.5 px-3">Nhóm</th>
                          <th className="py-2.5 px-3 text-right">Mốc cũ</th>
                          <th className="py-2.5 px-3 text-right">Hiện tại</th>
                          <th className="py-2.5 px-3 text-right">Chênh lệch</th>
                          <th className="py-2.5 px-3 text-right">Chênh lệch VNĐ</th>
                          <th className="py-2.5 px-3 text-center">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                        {[...baselineComparison.deviceDiffs, ...baselineComparison.cableDiffs, ...baselineComparison.accessoryDiffs].map(diff => (
                          <tr key={diff.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">{diff.label}</td>
                            <td className="py-2.5 px-3 text-slate-500">{diff.categoryLabel}</td>
                            <td className="py-2.5 px-3 text-right font-mono">{diff.baselineQty} {diff.unit}</td>
                            <td className="py-2.5 px-3 text-right font-mono">{diff.currentQty} {diff.unit}</td>
                            <td className={`py-2.5 px-3 text-right font-mono font-bold ${diff.qtyDelta > 0 ? 'text-blue-600' : diff.qtyDelta < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                              {formatDelta(diff.qtyDelta, ` ${diff.unit}`)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {diff.costDeltaVnd >= 0 ? '+' : ''}{formatVnd(diff.costDeltaVnd)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                diff.status === 'added'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                  : diff.status === 'removed'
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                                  : diff.status === 'changed'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                              }`}>
                                {diff.status === 'added' ? 'Thêm mới' : diff.status === 'removed' ? 'Đã xóa' : diff.status === 'changed' ? 'Thay đổi' : 'Giữ nguyên'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              {activeTab === 'devices' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3 w-10 text-center">STT</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">Mã SKU</th>
                        <th className="py-2.5 px-3">Hãng / Model</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">SL</th>
                        <th className="py-2.5 px-3 text-center whitespace-nowrap">U / W</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đơn giá (VNĐ)</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Thành tiền (VNĐ)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                      {bomStats.deviceRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-10 px-4 text-center text-slate-500 dark:text-slate-400">
                            <div>Chưa có thiết bị hoặc tủ Rack phù hợp bộ lọc hiện tại.</div>
                            {hasActiveFilters && (
                              <button
                                type="button"
                                onClick={resetFilters}
                                className="mt-2 px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-[#155EEF] dark:text-blue-400"
                              >
                                Hiển thị tất cả vật tư
                              </button>
                            )}
                          </td>
                        </tr>
                      ) : (
                        bomStats.deviceRows.map((row, idx) => {
                          const canJump = Boolean(onSelectOnCanvas && row.nodeIds.length > 0);
                          return (
                            <tr
                              key={row.key}
                              className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                            >
                              <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-400">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                <div>{row.sku}</div>
                                <div className="text-[10px] font-sans font-normal text-slate-400">{row.categoryLabel}</div>
                              </td>
                              <td
                                className={`py-2.5 px-3 min-w-[220px] ${canJump ? 'cursor-pointer' : ''}`}
                                onClick={
                                  canJump
                                    ? () => {
                                        onSelectOnCanvas?.({
                                          type: 'node',
                                          ids: row.nodeIds,
                                          label: `${row.vendor} · ${row.model}`
                                        });
                                        onClose();
                                      }
                                    : undefined
                                }
                              >
                                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                  <span>
                                    {row.vendor} · {row.model}
                                  </span>
                                  {canJump && (
                                    <span className="text-[10px] font-medium text-[#155EEF] dark:text-blue-400">
                                      [Chọn]
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[340px] mt-0.5"
                                  title={row.devicePreviews.join(', ')}
                                >
                                  {row.devicePreviews.join(', ')}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#155EEF] dark:text-blue-400 whitespace-nowrap">
                                {row.quantity} {row.unit}
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                <div>{row.uSizeLabel}</div>
                                <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                  {row.totalWatts > 0 ? `${row.totalWatts} W` : '—'}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                <input
                                  type="number"
                                  min={0}
                                  step={50000}
                                  aria-label={`Đơn giá ${row.model}`}
                                  value={row.unitPriceVnd}
                                  onChange={e => handleUpdateUnitPrice(row.key, e.target.value)}
                                  className="w-28 h-7 px-2 text-right rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                {formatVnd(row.totalPriceVnd)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'cables' && (
                <div>
                  <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-600 dark:text-slate-300">
                        {kpis.trayRoutedCableCount > 0
                          ? `Đã phát hiện ${kpis.trayRoutedCableCount} tuyến đi dọc theo máng cáp trên mặt bằng (B2).`
                          : 'Cự ly cáp đồng bộ theo chiều dài tuyến + vượt tầng + đầu cáp + hao hụt.'}
                      </div>
                      {cadDocument ? (
                        <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-800 dark:text-slate-200">
                            <input
                              type="checkbox"
                              checked={cadExtractEnabled}
                              onChange={e => setCadExtractEnabled(e.target.checked)}
                              className="rounded accent-[#155EEF] w-3.5 h-3.5"
                            />
                            <span>
                              Tự động bóc mét từ CAD ({cadDocument.name} · +{bomStats.cadExtraction?.totalExtractedMeters || 0} m)
                            </span>
                          </label>
                          {cadExtractEnabled && (
                            <button
                              type="button"
                              onClick={() => setShowCadLayerConfig(v => !v)}
                              className="text-[#155EEF] dark:text-blue-400 font-semibold hover:underline whitespace-nowrap"
                            >
                              {showCadLayerConfig
                                ? 'Ẩn ánh xạ Layer CAD'
                                : `Ánh xạ Layer CAD (${bomStats.cadExtraction?.layers.length || 0})`}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">
                          Mở bản vẽ DXF/CAD trong AutoCAD Studio để tự động bóc tách mét dây &amp; máng cáp từ các lớp curve CAD.
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSpoolPlan(v => !v)}
                      className={`h-8 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                        showSpoolPlan
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <Scissors className="w-3.5 h-3.5" />
                      <span>{showSpoolPlan ? 'Ẩn kế hoạch cắt cuộn FFD' : 'Tối ưu cắt cuộn (B8)'}</span>
                    </button>
                  </div>

                  {cadDocument && cadExtractEnabled && showCadLayerConfig && bomStats.cadExtraction && (
                    <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/40 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          Ánh xạ Layer bản vẽ CAD ({bomStats.cadExtraction.unitLabel}) sang hạng mục BOM
                        </span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {bomStats.cadExtraction.totalLinearEntities} thực thể đường/curve
                        </span>
                      </div>
                      {bomStats.cadExtraction.layers.length === 0 ? (
                        <div className="text-[11px] text-slate-500">Bản vẽ CAD chưa có thực thể đường/curve khả kiến.</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                          {bomStats.cadExtraction.layers.map(layer => (
                            <div
                              key={layer.layerName}
                              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="min-w-0">
                                <div className="font-mono font-semibold text-slate-800 dark:text-slate-100 truncate">
                                  {layer.layerName}
                                </div>
                                <div className="text-[10px] font-mono tabular-nums text-slate-500">
                                  {layer.entityCount} nét · {layer.meters} m
                                </div>
                              </div>
                              <select
                                aria-label={`Ánh xạ layer ${layer.layerName}`}
                                value={layer.effectiveTarget}
                                onChange={e =>
                                  setCadLayerMappings(prev => ({
                                    ...prev,
                                    [layer.layerName]: e.target.value as CadBomTargetKind
                                  }))
                                }
                                className="h-7 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] max-w-[180px]"
                              >
                                {(Object.keys(CAD_BOM_TARGET_LABELS) as CadBomTargetKind[]).map(kind => (
                                  <option key={kind} value={kind}>
                                    {CAD_BOM_TARGET_LABELS[kind]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                          <th className="py-2.5 px-3 w-10 text-center">STT</th>
                          <th className="py-2.5 px-3">Loại cáp &amp; Mã SKU</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Số tuyến</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Dài gốc</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Phụ trội</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Đặt hàng</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Cuộn</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Đơn giá</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                        {bomStats.cableRows.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="py-10 px-4 text-center text-slate-500 dark:text-slate-400">
                              Chưa có tuyến cáp nào phù hợp bộ lọc hiện tại.
                            </td>
                          </tr>
                        ) : (
                          bomStats.cableRows.map((cb, idx) => {
                            const canJump = Boolean(onSelectOnCanvas && cb.cableIds.length > 0);
                            const extraM = Math.round((cb.verticalRiseMeters + cb.dropHeightMeters + cb.serviceLoopMeters) * 10) / 10;
                            return (
                              <tr
                                key={cb.cableType}
                                className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                              >
                                <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-400">
                                  {idx + 1}
                                </td>
                                <td
                                  className={`py-2.5 px-3 min-w-[200px] ${canJump ? 'cursor-pointer' : ''}`}
                                  onClick={
                                    canJump
                                      ? () => {
                                          onSelectOnCanvas?.({
                                            type: 'edge',
                                            ids: cb.cableIds,
                                            label: cb.label
                                          });
                                          onClose();
                                        }
                                      : undefined
                                  }
                                >
                                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                    <span
                                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                                      style={{ backgroundColor: cb.color }}
                                    />
                                    <span>{cb.label}</span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                    {cb.sku} · +{cb.lossPct}% hao hụt
                                    {(cb.cadRawMeters || 0) > 0 && (
                                      <span className="ml-1.5 text-[#155EEF] dark:text-blue-400">
                                        · CAD +{cb.cadRawMeters}m ({cb.cadEntityCount} nét)
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                                  {cb.count}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                  {cb.rawMeters} m
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                  {extraM > 0 ? `+${extraM} m` : '—'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#155EEF] dark:text-blue-400 whitespace-nowrap">
                                  {cb.totalWithReserveMeters} m
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">
                                  {cb.estimatedSpools && cb.spoolLengthMeters
                                    ? `${cb.estimatedSpools} (${cb.spoolLengthMeters}m)`
                                    : `${cb.percentage}%`}
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  <input
                                    type="number"
                                    min={0}
                                    step={500}
                                    aria-label={`Đơn giá ${cb.label}`}
                                    value={cb.unitPriceVnd}
                                    onChange={e => handleUpdateUnitPrice(`cable::${cb.cableType}`, e.target.value)}
                                    className="w-24 h-7 px-2 text-right rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                  {formatVnd(cb.totalPriceVnd)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {showSpoolPlan && (
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/30 space-y-3">
                      <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Scissors className="w-4 h-4 text-blue-600" />
                        <span>Phương án tối ưu cắt cuộn cáp (First-Fit Decreasing)</span>
                      </div>
                      {spoolPlans.length === 0 ? (
                        <div className="text-xs text-slate-500">Không có tuyến cáp cuộn nào cần lập sơ đồ cắt.</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {spoolPlans.map(plan => (
                            <div
                              key={plan.cableType}
                              className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-xs">{plan.label}</span>
                                <span className="text-[11px] font-mono font-semibold text-blue-600 dark:text-blue-400">
                                  {plan.optimizedSpools} cuộn ({plan.spoolLengthMeters}m) · Hiệu suất {plan.overallUtilizationPct}%
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Tổng nhu cầu: {plan.totalDemandMeters}m · Dư thừa (scrap): {plan.totalScrapMeters}m
                              </div>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {plan.spools.map(sp => (
                                  <div
                                    key={sp.spoolNumber}
                                    className="p-2 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-[11px]"
                                  >
                                    <div className="flex justify-between font-mono font-semibold">
                                      <span>Cuộn #{sp.spoolNumber}</span>
                                      <span>
                                        Dùng {sp.usedMeters}m / Dư {sp.scrapMeters}m ({sp.utilizationPct}%)
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                      {sp.segments.map(s => `${s.cableCode}: ${s.cutMeters}m`).join(' · ')}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'accessories' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3 w-10 text-center">STT</th>
                        <th className="py-2.5 px-3 whitespace-nowrap">SKU / Nhóm</th>
                        <th className="py-2.5 px-3">Tên phụ kiện &amp; Quy cách</th>
                        <th className="py-2.5 px-3 text-center whitespace-nowrap">ĐVT</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đề xuất đặt</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Đơn giá</th>
                        <th className="py-2.5 px-3 text-right whitespace-nowrap">Thành tiền</th>
                        <th className="py-2.5 px-3">Quy tắc truy vết</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                      {bomStats.inferredAccessories.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-10 px-4 text-center text-slate-500 dark:text-slate-400">
                            Chưa có phụ kiện suy ra (hãy thêm dây cáp, máng cáp hoặc tủ Rack lên bản vẽ).
                          </td>
                        </tr>
                      ) : (
                        bomStats.inferredAccessories.map((acc, idx) => (
                          <tr
                            key={acc.id}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">{acc.sku}</div>
                              <div className="text-[10px] text-slate-500">{acc.group}</div>
                            </td>
                            <td className="py-2.5 px-3 min-w-[200px]">
                              <div className="font-semibold text-slate-900 dark:text-white">{acc.name}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {acc.spec}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {acc.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#155EEF] dark:text-blue-400 whitespace-nowrap">
                              {acc.orderQty}
                              {acc.calculatedQty !== acc.orderQty && (
                                <div className="text-[10px] font-normal text-slate-400">gốc {acc.calculatedQty}</div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <input
                                type="number"
                                min={0}
                                step={1000}
                                aria-label={`Đơn giá ${acc.name}`}
                                value={acc.unitPriceVnd}
                                onChange={e => handleUpdateUnitPrice(`acc::${acc.id}`, e.target.value)}
                                className="w-24 h-7 px-2 text-right rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums text-xs outline-none focus:border-[#155EEF]"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {formatVnd(acc.totalPriceVnd)}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-slate-600 dark:text-slate-300 min-w-[180px]">
                              {acc.sourceRule}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'multiview' && (
                <div>
                  <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Góc nhìn tổng hợp:</span>
                    {([
                      { id: 'floors', label: `Theo Tầng (${bomStats.floorRows.length})` },
                      { id: 'rooms', label: `Theo Phòng (${bomStats.roomRows.length})` },
                      { id: 'systems', label: `Theo Hệ thống (${bomStats.systemRows.length})` },
                      { id: 'racks', label: `Theo Tủ Rack (${bomStats.rackSummaryRows.length})` }
                    ] as Array<{ id: MultiViewMode; label: string }>).map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMultiViewMode(m.id)}
                        className={`px-3 py-1 rounded-md text-xs font-semibold border transition-colors ${
                          multiViewMode === m.id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {multiViewMode === 'floors' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            <th className="py-2.5 px-3 w-12 text-center">STT</th>
                            <th className="py-2.5 px-3">Tầng / Khu vực</th>
                            <th className="py-2.5 px-3 text-right">Phòng</th>
                            <th className="py-2.5 px-3 text-right">Diện tích (m²)</th>
                            <th className="py-2.5 px-3 text-right">Thiết bị</th>
                            <th className="py-2.5 px-3 text-right">Tủ Rack</th>
                            <th className="py-2.5 px-3 text-right">Công suất (W)</th>
                            <th className="py-2.5 px-3 text-right">Dự toán TB (VNĐ)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                          {bomStats.floorRows.map((fl, idx) => (
                            <tr
                              key={fl.floorId}
                              onClick={
                                onSelectOnCanvas
                                  ? () => {
                                      onSelectOnCanvas({
                                        type: 'floor',
                                        ids: [fl.floorId],
                                        label: fl.floorName
                                      });
                                      onClose();
                                    }
                                  : undefined
                              }
                              className={onSelectOnCanvas ? 'cursor-pointer hover:bg-blue-50/70 dark:hover:bg-blue-950/30' : ''}
                            >
                              <td className="py-2.5 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">{fl.floorName}</td>
                              <td className="py-2.5 px-3 text-right font-mono">{fl.roomCount}</td>
                              <td className="py-2.5 px-3 text-right font-mono">{fl.areaM2}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-[#155EEF]">{fl.deviceCount}</td>
                              <td className="py-2.5 px-3 text-right font-mono">{fl.rackCount}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-600">{fl.totalPowerWatts} W</td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatVnd(fl.estimatedCostVnd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {multiViewMode === 'rooms' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            <th className="py-2.5 px-3">Phòng / Khu vực</th>
                            <th className="py-2.5 px-3">Thuộc tầng</th>
                            <th className="py-2.5 px-3 text-right">Diện tích (m²)</th>
                            <th className="py-2.5 px-3 text-right">Thiết bị</th>
                            <th className="py-2.5 px-3 text-right">Tủ Rack</th>
                            <th className="py-2.5 px-3 text-right">Điện (W)</th>
                            <th className="py-2.5 px-3 text-right">Dự toán TB (VNĐ)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                          {bomStats.roomRows.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-slate-500">Chưa có phòng nào trên bản vẽ mặt bằng.</td>
                            </tr>
                          ) : (
                            bomStats.roomRows.map(rm => (
                              <tr key={rm.roomId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-900 dark:text-white">{rm.roomName}</div>
                                  {rm.devicePreviews.length > 0 && (
                                    <div className="text-[11px] text-slate-500 truncate max-w-[260px]">{rm.devicePreviews.join(', ')}</div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{rm.floorName}</td>
                                <td className="py-2.5 px-3 text-right font-mono">{rm.areaM2}</td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-[#155EEF]">{rm.deviceCount}</td>
                                <td className="py-2.5 px-3 text-right font-mono">{rm.rackCount}</td>
                                <td className="py-2.5 px-3 text-right font-mono text-emerald-600">{rm.totalPowerWatts} W</td>
                                <td className="py-2.5 px-3 text-right font-mono font-semibold">{formatVnd(rm.estimatedCostVnd)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {multiViewMode === 'systems' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            <th className="py-2.5 px-3">Phân hệ kỹ thuật</th>
                            <th className="py-2.5 px-3 text-right">Thiết bị</th>
                            <th className="py-2.5 px-3 text-right">Cáp (tuyến / m)</th>
                            <th className="py-2.5 px-3 text-right">Công suất (W)</th>
                            <th className="py-2.5 px-3 text-right">Dự toán (VNĐ)</th>
                            <th className="py-2.5 px-3">Hạng mục chính</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                          {bomStats.systemRows.map(sys => (
                            <tr key={sys.systemKey} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                              <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">{sys.systemLabel}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-[#155EEF]">{sys.deviceCount}</td>
                              <td className="py-2.5 px-3 text-right font-mono">{sys.cableCount} / {sys.cableMeters}m</td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-600">{sys.totalPowerWatts} W</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold">{formatVnd(sys.estimatedCostVnd)}</td>
                              <td className="py-2.5 px-3 text-[11px] text-slate-500 max-w-[280px] truncate">{sys.itemSummaries.join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {multiViewMode === 'racks' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            <th className="py-2.5 px-3">Tủ Rack</th>
                            <th className="py-2.5 px-3">Tầng</th>
                            <th className="py-2.5 px-3 text-right">Sử dụng U</th>
                            <th className="py-2.5 px-3 text-right">Số TB gắn tủ</th>
                            <th className="py-2.5 px-3 text-right">Công suất (W)</th>
                            <th className="py-2.5 px-3 text-right">Tải trọng (kg)</th>
                            <th className="py-2.5 px-3 text-right">Dự toán (VNĐ)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                          {bomStats.rackSummaryRows.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-slate-500">Chưa có tủ Rack nào trong dự án.</td>
                            </tr>
                          ) : (
                            bomStats.rackSummaryRows.map(rk => (
                              <tr key={rk.rackId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                                <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">{rk.rackName}</td>
                                <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{rk.floorName}</td>
                                <td className="py-2.5 px-3 text-right font-mono">{rk.usedUnits}/{rk.totalUnits}U ({rk.utilizationPct}%)</td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-[#155EEF]">{rk.componentCount}</td>
                                <td className="py-2.5 px-3 text-right font-mono text-emerald-600">{rk.totalPowerWatts} W</td>
                                <td className="py-2.5 px-3 text-right font-mono">{rk.totalWeightKg}</td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold">{formatVnd(rk.estimatedCostVnd)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'subnets' && (
                <SubnetIpStatsPanel
                  project={project}
                  variant="full"
                  searchQuery={searchQuery}
                  floorFilter={floorFilter}
                  onSelectNode={
                    onSelectOnCanvas
                      ? nodeId => {
                          const node = project.nodes.find(n => n.id === nodeId);
                          onSelectOnCanvas({
                            type: 'node',
                            ids: [nodeId],
                            label: node?.label || 'Thiết bị'
                          });
                          onClose();
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
