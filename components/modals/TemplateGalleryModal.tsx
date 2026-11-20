import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Download,
  Eye,
  FolderOpen,
  FolderUp,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Server,
  Star,
  Video,
  Wifi,
  X
} from 'lucide-react';
import type { DesignMode, ProjectState } from '../../types/infrastructure';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  downloadTemplatePackageZipWithSnapshot,
  downloadTemplateProjectJson,
  downloadTemplateSingleFiles,
  fetchTemplateCatalog,
  generateTemplateSnapshotSvg,
  getFavoriteTemplateIds,
  refreshTemplateCatalog,
  slugifyTemplateId,
  toggleFavoriteTemplateId,
  type TemplateCatalogEntry,
  type TemplateCatalogFile
} from '../../services/templateLibrary';

export interface TemplateGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject?: ProjectState;
  onSelectExternalTemplate?: (
    entry: TemplateCatalogEntry
  ) => Promise<{ ok: boolean; error?: string; warnings?: string[] } | void>;
  onSelectTemplate?: (templateId: string) => void;
}

type GalleryView = 'list' | 'preview' | 'export';

const MODE_LABELS: Record<DesignMode, string> = {
  topology: 'Sơ đồ mạng logic',
  floorplan: 'Mặt bằng tòa nhà',
  rack: 'Tủ Server Rack 19"',
  cctv: 'Camera CCTV',
  wifi: 'Phủ sóng Wi-Fi',
  fiber: 'Cáp quang ODF',
  electrical: 'Điện kỹ thuật',
  multisite: 'Đa chi nhánh WAN'
};

function normalizeVi(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function formatDateDisplay(iso: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('vi-VN');
}

function formatTimeDisplay(iso: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderModeIcon(mode: DesignMode, className = 'w-5 h-5') {
  switch (mode) {
    case 'floorplan':
      return <Building2 className={className} />;
    case 'rack':
      return <Server className={className} />;
    case 'cctv':
      return <Video className={className} />;
    case 'wifi':
      return <Wifi className={className} />;
    case 'fiber':
      return <GitBranch className={className} />;
    case 'multisite':
      return <Globe className={className} />;
    case 'electrical':
      return <Layers className={className} />;
    default:
      return <Network className={className} />;
  }
}

export const TemplateGalleryModal: React.FC<TemplateGalleryModalProps> = ({
  isOpen,
  onClose,
  currentProject,
  onSelectExternalTemplate,
  onSelectTemplate
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  const [catalog, setCatalog] = useState<TemplateCatalogFile | null>(null);
  const [catalogSource, setCatalogSource] = useState<'online' | 'cache'>('online');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const [activeCategory, setActiveCategory] = useState<string>('Tất cả');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getFavoriteTemplateIds());
  const [brokenPreviewIds, setBrokenPreviewIds] = useState<Record<string, boolean>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [downloadingTemplateId, setDownloadingTemplateId] = useState<string | null>(null);

  const [view, setView] = useState<GalleryView>('list');
  const [previewEntry, setPreviewEntry] = useState<TemplateCatalogEntry | null>(null);
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Export current project as template form state
  const [expName, setExpName] = useState<string>('');
  const [expSlug, setExpSlug] = useState<string>('');
  const [expSlugEdited, setExpSlugEdited] = useState<boolean>(false);
  const [expCategory, setExpCategory] = useState<string>('Mạng LAN');
  const [expMode, setExpMode] = useState<DesignMode>('topology');
  const [expBadge, setExpBadge] = useState<string>('Custom');
  const [expVersion, setExpVersion] = useState<string>('1.0.0');
  const [expAuthor, setExpAuthor] = useState<string>('HACHIHI');
  const [expDescription, setExpDescription] = useState<string>('');
  const [expHighlights, setExpHighlights] = useState<string>('');
  const [expTags, setExpTags] = useState<string>('');
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [exportSnapshotDataUrl, setExportSnapshotDataUrl] = useState<string | null>(null);

  const applyCatalogResult = useCallback(
    (res: { catalog: TemplateCatalogFile; source: 'online' | 'cache'; fetchedAt: string }) => {
      setCatalog(res.catalog);
      setCatalogSource(res.source);
      setLastRefreshedAt(res.fetchedAt);
      setActiveCategory(prev =>
        prev === 'Tất cả' || prev === 'Yêu thích' || res.catalog.categories.includes(prev)
          ? prev
          : 'Tất cả'
      );
      setPreviewEntry(prev =>
        prev ? (res.catalog.templates.find(t => t.id === prev.id) ?? prev) : null
      );
    },
    []
  );

  const loadCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    setCatalogError(null);
    try {
      const res = await fetchTemplateCatalog({ forceRefresh: false });
      applyCatalogResult(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể tải danh sách template.';
      setCatalogError(message);
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [applyCatalogResult]);

  const handleRefreshLibrary = useCallback(async () => {
    if (isRefreshing || isLoadingCatalog) return;
    setIsRefreshing(true);
    setCatalogError(null);
    setActionBanner(null);
    try {
      const res = await refreshTemplateCatalog();
      applyCatalogResult(res);
      setBrokenPreviewIds({});
      setCardErrors({});
      setRefreshNonce(n => n + 1);
      if (res.source === 'online') {
        setActionBanner({
          type: 'success',
          text: `Đã làm mới thư viện mẫu (${res.catalog.totalTemplates} mẫu sẵn sàng).`
        });
      } else {
        setActionBanner({
          type: 'warning',
          text: `Không kết nối được máy chủ để làm mới — đang hiển thị ${res.catalog.totalTemplates} mẫu từ cache cục bộ.`
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể làm mới thư viện template.';
      setCatalogError(message);
      setActionBanner({ type: 'error', text: message });
    } finally {
      setIsRefreshing(false);
    }
  }, [applyCatalogResult, isLoadingCatalog, isRefreshing]);

  useEffect(() => {
    if (!isOpen) return;
    setView('list');
    setPreviewEntry(null);
    setActionBanner(null);
    setFavoriteIds(getFavoriteTemplateIds());
    void loadCatalog();
  }, [isOpen, loadCatalog]);

  const openExportView = useCallback(() => {
    if (!currentProject) return;
    const baseName = currentProject.name?.trim() || 'Mẫu thiết kế mới';
    setExpName(baseName);
    setExpSlug(slugifyTemplateId(baseName));
    setExpSlugEdited(false);
    setExpMode(currentProject.activeMode || 'topology');
    setExpCategory(
      currentProject.activeMode === 'cctv'
        ? 'Camera'
        : currentProject.activeMode === 'wifi'
        ? 'Wi-Fi'
        : currentProject.activeMode === 'rack'
        ? 'Rack'
        : currentProject.activeMode === 'floorplan'
        ? 'Mặt bằng'
        : currentProject.activeMode === 'fiber'
        ? 'Cáp quang'
        : currentProject.activeMode === 'multisite'
        ? 'Đa chi nhánh'
        : 'Mạng LAN'
    );
    setExpBadge(MODE_LABELS[currentProject.activeMode || 'topology'] || 'Custom');
    setExpVersion(currentProject.version || '1.0.0');
    setExpAuthor(currentProject.author || 'HACHIHI');
    setExpDescription(
      `Mẫu hạ tầng ${baseName} gồm ${Object.keys(currentProject.assets).length} thiết bị, ${currentProject.racks.length} tủ Rack và ${currentProject.cables.length} tuyến cáp.`
    );
    setExpHighlights(
      [
        `${currentProject.floors?.length || 1} tầng`,
        `${Object.keys(currentProject.assets).length} thiết bị`,
        `${currentProject.racks.length} tủ Rack`,
        `${currentProject.cables.length} cáp`
      ].join(', ')
    );
    setExpTags(`${currentProject.activeMode || 'topology'}, HACHIHI`);
    try {
      const svg = generateTemplateSnapshotSvg(currentProject);
      setExportSnapshotDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    } catch {
      setExportSnapshotDataUrl(null);
    }
    setActionBanner(null);
    setView('export');
  }, [currentProject]);

  const templates = catalog?.templates || [];

  const categories = useMemo(() => {
    const baseCats = catalog?.categories || Array.from(new Set(templates.map(t => t.category)));
    return ['Tất cả', 'Yêu thích', ...baseCats];
  }, [catalog?.categories, templates]);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const filteredTemplates = useMemo(() => {
    const q = normalizeVi(searchQuery.trim());
    return templates.filter(t => {
      if (activeCategory === 'Yêu thích') {
        if (!favoriteSet.has(t.id)) return false;
      } else if (activeCategory !== 'Tất cả' && t.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      const hay = normalizeVi(
        [
          t.name,
          t.category,
          t.badge,
          t.mode,
          t.description,
          t.author,
          ...t.highlights,
          ...t.tags
        ].join(' ')
      );
      return hay.includes(q);
    });
  }, [templates, activeCategory, favoriteSet, searchQuery]);

  const handleToggleFavorite = (id: string) => {
    setFavoriteIds(toggleFavoriteTemplateId(id));
  };

  const handleUseTemplate = async (entry: TemplateCatalogEntry) => {
    if (loadingTemplateId) return;
    if (entry.validationError || !entry.hasProjectData) {
      setCardErrors(prev => ({
        ...prev,
        [entry.id]: entry.validationError || 'Template không có dữ liệu dự án hợp lệ.'
      }));
      return;
    }

    setCardErrors(prev => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });

    if (onSelectExternalTemplate) {
      setLoadingTemplateId(entry.id);
      try {
        const res = await onSelectExternalTemplate(entry);
        if (res && !res.ok) {
          setCardErrors(prev => ({
            ...prev,
            [entry.id]: res.error || `Không thể nạp mẫu "${entry.name}".`
          }));
          return;
        }
        onClose();
      } catch (err) {
        setCardErrors(prev => ({
          ...prev,
          [entry.id]: err instanceof Error ? err.message : `Lỗi nạp mẫu "${entry.name}".`
        }));
      } finally {
        setLoadingTemplateId(null);
      }
      return;
    }

    if (onSelectTemplate) {
      onSelectTemplate(entry.id);
      onClose();
    }
  };

  const handleDownloadJson = async (entry: TemplateCatalogEntry) => {
    if (downloadingTemplateId) return;
    setDownloadingTemplateId(entry.id);
    try {
      const res = await downloadTemplateProjectJson(entry);
      if (!res.ok) {
        setCardErrors(prev => ({ ...prev, [entry.id]: res.error }));
      } else {
        setActionBanner({
          type: 'success',
          text: `Đã tải xuống tệp dự án ${entry.slug || entry.id}.project.json.`
        });
      }
    } finally {
      setDownloadingTemplateId(null);
    }
  };

  const handleExportTemplateZip = async () => {
    if (!currentProject || isExportingZip) return;
    setIsExportingZip(true);
    try {
      const pkg = await downloadTemplatePackageZipWithSnapshot(currentProject, {
        slug: expSlug,
        name: expName,
        category: expCategory,
        mode: expMode,
        badge: expBadge,
        version: expVersion,
        author: expAuthor,
        description: expDescription,
        highlights: expHighlights.split(','),
        tags: expTags.split(',')
      });
      setActionBanner({
        type: 'success',
        text: `Đã tạo gói ${pkg.zipFilename} (chứa template.json, project.json, ${pkg.previewFilename}). Giải nén vào public/templates/${pkg.slug}/ rồi đẩy lên GitHub.`
      });
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể đóng gói Template ZIP.'
      });
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleExportTemplateFiles = () => {
    if (!currentProject) return;
    const pkg = downloadTemplateSingleFiles(currentProject, {
      slug: expSlug,
      name: expName,
      category: expCategory,
      mode: expMode,
      badge: expBadge,
      version: expVersion,
      author: expAuthor,
      description: expDescription,
      highlights: expHighlights.split(','),
      tags: expTags.split(',')
    });
    setActionBanner({
      type: 'success',
      text: `Đã tải template.json và project.json cho thư mục public/templates/${pkg.slug}/.`
    });
  };

  if (!isOpen) return null;

  const totalCount = templates.length;
  const categoryCount = (catalog?.categories || []).length;
  const favoriteCount = templates.filter(t => favoriteSet.has(t.id)).length;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Thư viện Template"
    >
      <div className="w-full h-dvh sm:h-auto sm:max-w-5xl sm:max-h-[92dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 dark:bg-slate-900 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <FolderOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <h2 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900 dark:text-white truncate">
                Thư viện Template
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
              <span>{catalogSource === 'online' ? 'Online' : 'Cache cục bộ'}</span>
              <span aria-hidden="true">·</span>
              <span>
                Tổng template: <strong className="text-slate-800 dark:text-slate-200">{totalCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Danh mục: <strong className="text-slate-800 dark:text-slate-200">{categoryCount}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Yêu thích: <strong className="text-slate-800 dark:text-slate-200">{favoriteCount}</strong>
              </span>
              {lastRefreshedAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Đồng bộ: {formatTimeDisplay(lastRefreshedAt)}</span>
                </>
              ) : catalog?.generatedAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Cập nhật: {formatDateDisplay(catalog.generatedAt)}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {currentProject && view !== 'export' && (
              <button
                type="button"
                data-testid="template-export-open-btn"
                onClick={openExportView}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <FolderUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Xuất dự án thành Template</span>
              </button>
            )}

            <button
              type="button"
              data-testid="template-refresh-btn"
              onClick={() => void handleRefreshLibrary()}
              disabled={isRefreshing || isLoadingCatalog}
              aria-label="Làm mới thư viện"
              aria-busy={isRefreshing}
              title="Tải lại danh sách mẫu mới nhất từ catalog.json"
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                  isRefreshing ? 'animate-spin text-blue-600 dark:text-blue-400' : ''
                }`}
              />
              <span>{isRefreshing ? 'Đang làm mới...' : 'Làm mới thư viện'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng thư viện mẫu"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white shrink-0 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action notification banner */}
        {actionBanner && (
          <div
            role={actionBanner.type === 'error' ? 'alert' : 'status'}
            className={`px-4 sm:px-6 py-2.5 border-b text-xs font-medium flex items-center justify-between gap-2 shrink-0 ${
              actionBanner.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                : actionBanner.type === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {actionBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate">{actionBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionBanner(null)}
              aria-label="Đóng thông báo"
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Search & Category Filter Row (List view only) */}
        {view === 'list' && (
          <div className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
            <div className="relative w-full sm:w-64 shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                data-testid="template-search-input"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tìm LAN, Camera, Rack, Wi-Fi..."
                aria-label="Tìm kiếm mẫu thiết kế"
                className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
              />
            </div>

            <div
              className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto flex-1"
              role="tablist"
              aria-label="Danh mục thư viện template"
            >
              {categories.map(cat => {
                const isSelected = activeCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {cat === 'Yêu thích' ? `Yêu thích (${favoriteCount})` : cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Main Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* 1. LIST VIEW */}
          {view === 'list' && (
            <>
              {catalogError && templates.length === 0 ? (
                <div className="py-12 px-4 text-center space-y-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
                  <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Không tải được thư viện Template
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                    {catalogError}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleRefreshLibrary()}
                    disabled={isRefreshing || isLoadingCatalog}
                    className="px-4 py-2 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                  >
                    Thử lại
                  </button>
                </div>
              ) : (isLoadingCatalog || isRefreshing) && templates.length === 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[0, 1, 2, 3, 4, 5].map(idx => (
                    <div
                      key={idx}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900 animate-pulse"
                    >
                      <div className="aspect-[16/10] bg-slate-100 dark:bg-slate-800" />
                      <div className="p-4 space-y-2.5">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                        <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
                        <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-full" />
                        <div className="h-8 bg-slate-100 dark:bg-slate-800 rounded w-full mt-2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="py-14 text-center space-y-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/40 dark:bg-slate-800/20">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Không tìm thấy mẫu phù hợp
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeCategory === 'Yêu thích'
                      ? 'Bạn chưa đánh dấu mẫu nào vào danh sách Yêu thích.'
                      : 'Thử từ khóa khác hoặc đặt lại bộ lọc danh mục để xem tất cả mẫu.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCategory('Tất cả');
                      setSearchQuery('');
                    }}
                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    Xem tất cả mẫu
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {(isRefreshing || isLoadingCatalog) && (
                    <div
                      role="status"
                      aria-live="polite"
                      data-testid="template-refresh-loading-strip"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs font-medium"
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>Đang tải lại danh sách mẫu mới nhất...</span>
                    </div>
                  )}
                  <div
                    className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 transition-opacity duration-150 ${
                      isRefreshing || isLoadingCatalog ? 'opacity-60 pointer-events-none' : ''
                    }`}
                  >
                  {filteredTemplates.map(tpl => {
                    const isFav = favoriteSet.has(tpl.id);
                    const isPreviewBroken = Boolean(brokenPreviewIds[tpl.id] || !tpl.previewUrl);
                    const isolatedError = cardErrors[tpl.id] || tpl.validationError;
                    const isApplying = loadingTemplateId === tpl.id;
                    const isDownloading = downloadingTemplateId === tpl.id;
                    const canApply = tpl.hasProjectData && !tpl.validationError && !isApplying;
                    const previewSrc =
                      tpl.previewUrl && refreshNonce > 0
                        ? `${tpl.previewUrl}${tpl.previewUrl.includes('?') ? '&' : '?'}r=${refreshNonce}`
                        : tpl.previewUrl;

                    return (
                      <article
                        key={tpl.id}
                        data-testid={`template-card-${tpl.id}`}
                        className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden transition-colors hover:border-blue-400 dark:hover:border-blue-700"
                      >
                        {/* Thumbnail preview */}
                        <div>
                          <div className="relative aspect-[16/10] bg-slate-50 dark:bg-slate-950/70 border-b border-slate-100 dark:border-slate-800 overflow-hidden flex items-center justify-center">
                            {!isPreviewBroken && previewSrc ? (
                              <img
                                src={previewSrc}
                                alt={`Bản vẽ xem trước ${tpl.name}`}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setBrokenPreviewIds(prev => ({ ...prev, [tpl.id]: true }))
                                }
                                className="w-full h-full object-contain p-2 bg-white"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-1.5 text-slate-400 dark:text-slate-500 p-4 text-center">
                                {renderModeIcon(tpl.mode, 'w-7 h-7')}
                                <span className="text-[11px]">
                                  {tpl.previewError || 'Chưa có ảnh xem trước'}
                                </span>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => handleToggleFavorite(tpl.id)}
                              aria-label={isFav ? `Bỏ yêu thích ${tpl.name}` : `Yêu thích ${tpl.name}`}
                              aria-pressed={isFav}
                              title={isFav ? 'Bỏ khỏi Yêu thích' : 'Thêm vào Yêu thích'}
                              className={`absolute top-2.5 right-2.5 w-8 h-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                                isFav
                                  ? 'bg-amber-50 dark:bg-amber-950/80 border-amber-300 dark:border-amber-700 text-amber-500'
                                  : 'bg-white/90 dark:bg-slate-900/90 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-amber-500'
                              }`}
                            >
                              <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400 text-amber-500' : ''}`} />
                            </button>
                          </div>

                          {/* Card Info */}
                          <div className="p-4 space-y-2">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                              {tpl.name}
                            </h3>

                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                              <span className="font-medium text-slate-700 dark:text-slate-300">{tpl.category}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">v{tpl.version}</span>
                              {tpl.stats && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{tpl.stats.assets} TB</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{tpl.stats.cables} cáp</span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  tpl.hasProjectData && !isolatedError
                                    ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                    : 'text-rose-600 dark:text-rose-400 font-medium'
                                }
                              >
                                {tpl.hasProjectData && !isolatedError ? 'Có dữ liệu' : 'Lỗi dữ liệu'}
                              </span>
                            </div>

                            {isolatedError && (
                              <div
                                role="alert"
                                className="flex items-start gap-1.5 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-lg px-2.5 py-1.5"
                              >
                                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>{isolatedError}</span>
                              </div>
                            )}

                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                              {tpl.description}
                            </p>

                            {tpl.highlights.length > 0 && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {tpl.highlights.join(' · ')}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions Footer */}
                        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/40 dark:bg-slate-900/60">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              data-testid={`template-preview-btn-${tpl.id}`}
                              onClick={() => {
                                setPreviewEntry(tpl);
                                setView('preview');
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              <span>Xem trước</span>
                            </button>

                            <button
                              type="button"
                              disabled={!tpl.hasProjectData || isDownloading}
                              onClick={() => void handleDownloadJson(tpl)}
                              title="Tải file project.json về máy"
                              aria-label={`Tải tệp JSON của ${tpl.name}`}
                              className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-600 dark:text-slate-300 text-[11px] font-medium flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors"
                            >
                              {isDownloading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                              ) : (
                                <Download className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>Tải về</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            data-testid={`template-use-btn-${tpl.id}`}
                            disabled={!canApply}
                            onClick={() => void handleUseTemplate(tpl)}
                            className="px-3 py-1.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                          >
                            {isApplying ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            ) : (
                              <>
                                <span>Sử dụng mẫu</span>
                                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                              </>
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 2. PREVIEW DETAIL VIEW */}
          {view === 'preview' && previewEntry && (
            <div data-testid="template-preview-panel" className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewEntry(null);
                    setView('list');
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                  <span>Quay lại thư viện</span>
                </button>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(previewEntry.id)}
                    aria-pressed={favoriteSet.has(previewEntry.id)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        favoriteSet.has(previewEntry.id) ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                      }`}
                    />
                    <span>{favoriteSet.has(previewEntry.id) ? 'Đã thích' : 'Yêu thích'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={!previewEntry.hasProjectData || downloadingTemplateId === previewEntry.id}
                    onClick={() => void handleDownloadJson(previewEntry)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>Tải JSON</span>
                  </button>

                  <button
                    type="button"
                    disabled={
                      !previewEntry.hasProjectData ||
                      Boolean(previewEntry.validationError) ||
                      loadingTemplateId === previewEntry.id
                    }
                    onClick={() => void handleUseTemplate(previewEntry)}
                    className="px-4 py-1.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {loadingTemplateId === previewEntry.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>Sử dụng mẫu này</span>
                  </button>
                </div>
              </div>

              {(cardErrors[previewEntry.id] || previewEntry.validationError) && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl px-4 py-3"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{cardErrors[previewEntry.id] || previewEntry.validationError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 overflow-hidden flex items-center justify-center min-h-[280px] sm:min-h-[360px]">
                  {!brokenPreviewIds[previewEntry.id] && previewEntry.previewUrl ? (
                    <img
                      src={previewEntry.previewUrl}
                      alt={`Xem trước cấu trúc ${previewEntry.name}`}
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setBrokenPreviewIds(prev => ({ ...prev, [previewEntry.id]: true }))
                      }
                      className="w-full h-full max-h-[440px] object-contain p-3 bg-white"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500 p-8 text-center">
                      {renderModeIcon(previewEntry.mode, 'w-10 h-10')}
                      <span className="text-xs">
                        {previewEntry.previewError || 'Không có hình ảnh xem trước cho mẫu này.'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="lg:col-span-5 space-y-4">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {previewEntry.category} · {MODE_LABELS[previewEntry.mode] || previewEntry.mode}
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5">
                      {previewEntry.name}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-2">
                      {previewEntry.description}
                    </p>
                  </div>

                  <div className="border-t border-b border-slate-200 dark:border-slate-800 py-3 grid grid-cols-2 gap-y-2 gap-x-4 text-xs tabular-nums">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Phiên bản: </span>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        v{previewEntry.version}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Cập nhật: </span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {formatDateDisplay(previewEntry.updatedAt)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Tác giả: </span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {previewEntry.author}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Thư mục: </span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {previewEntry.slug}
                      </span>
                    </div>
                    {previewEntry.stats && (
                      <>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Thiết bị: </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {previewEntry.stats.assets}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Nút sơ đồ: </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {previewEntry.stats.nodes}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Tủ Rack: </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {previewEntry.stats.racks}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Tuyến cáp: </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {previewEntry.stats.cables}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {previewEntry.highlights.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Thành phần chính
                      </div>
                      <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc pl-4">
                        {previewEntry.highlights.map(item => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {previewEntry.tags.length > 0 && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Từ khóa: {previewEntry.tags.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 3. EXPORT CURRENT PROJECT AS TEMPLATE VIEW */}
          {view === 'export' && currentProject && (
            <div data-testid="template-export-panel" className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                  <span>Quay lại thư viện</span>
                </button>

                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Xuất bộ tệp chuẩn cho thư mục GitHub <span className="font-mono text-slate-800 dark:text-slate-200">public/templates/{slugifyTemplateId(expSlug || expName)}/</span>
                </div>
              </div>

              {exportSnapshotDataUrl && (
                <div
                  data-testid="template-export-snapshot-preview"
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-3 flex flex-col sm:flex-row items-center gap-4"
                >
                  <div className="w-full sm:w-56 aspect-[16/10] rounded-lg border border-slate-200 dark:border-slate-700 bg-white overflow-hidden flex items-center justify-center shrink-0">
                    <img
                      src={exportSnapshotDataUrl}
                      alt={`Ảnh chụp xem trước ${expName || currentProject.name}`}
                      className="w-full h-full object-contain p-1.5"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1 text-xs">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      Ảnh chụp xem trước tự động (Snapshot)
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                      Hệ thống tự động dựng ảnh chụp sơ đồ kèm tệp{' '}
                      <span className="font-mono text-slate-800 dark:text-slate-200">template.json</span> và{' '}
                      <span className="font-mono text-slate-800 dark:text-slate-200">project.json</span> trong gói ZIP để bạn đóng góp vào thư viện mẫu.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tên Template
                  </label>
                  <input
                    type="text"
                    value={expName}
                    onChange={e => {
                      const val = e.target.value;
                      setExpName(val);
                      if (!expSlugEdited) setExpSlug(slugifyTemplateId(val));
                    }}
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tên thư mục (Slug)
                  </label>
                  <input
                    type="text"
                    value={expSlug}
                    onChange={e => {
                      setExpSlugEdited(true);
                      setExpSlug(e.target.value);
                    }}
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs outline-none focus:border-blue-500"
                    placeholder="16-network-custom"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Danh mục
                  </label>
                  <input
                    type="text"
                    value={expCategory}
                    onChange={e => setExpCategory(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                    placeholder="Mạng LAN, Camera, Wi-Fi..."
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Chế độ thiết kế
                  </label>
                  <select
                    value={expMode}
                    onChange={e => setExpMode(e.target.value as DesignMode)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                  >
                    {Object.entries(MODE_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl} ({k})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Phiên bản
                    </label>
                    <input
                      type="text"
                      value={expVersion}
                      onChange={e => setExpVersion(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Tác giả
                    </label>
                    <input
                      type="text"
                      value={expAuthor}
                      onChange={e => setExpAuthor(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Nhãn ngắn
                    </label>
                    <input
                      type="text"
                      value={expBadge}
                      onChange={e => setExpBadge(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tags tìm kiếm (phân cách bởi dấu phẩy)
                  </label>
                  <input
                    type="text"
                    value={expTags}
                    onChange={e => setExpTags(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Điểm nổi bật (phân cách bởi dấu phẩy)
                  </label>
                  <input
                    type="text"
                    value={expHighlights}
                    onChange={e => setExpHighlights(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Mô tả chi tiết
                  </label>
                  <textarea
                    rows={3}
                    value={expDescription}
                    onChange={e => setExpDescription(e.target.value)}
                    className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Gồm <span className="font-mono text-slate-700 dark:text-slate-200">template.json</span> ·{' '}
                  <span className="font-mono text-slate-700 dark:text-slate-200">project.json</span> ·{' '}
                  <span className="font-mono text-slate-700 dark:text-slate-200">preview.png / preview.svg</span> ·{' '}
                  <span className="font-mono text-slate-700 dark:text-slate-200">README.txt</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportTemplateFiles}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    Tải lẻ JSON
                  </button>
                  <button
                    type="button"
                    data-testid="template-export-zip-btn"
                    disabled={isExportingZip}
                    onClick={() => void handleExportTemplateZip()}
                    className="px-4 py-2 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {isExportingZip ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : (
                      <Download className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{isExportingZip ? 'Đang đóng gói...' : 'Tải gói Template (.zip)'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
