import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  FilePlus2,
  FolderSync,
  Loader2,
  LogOut,
  Paintbrush,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import type {
  AdminAuthStatusPayload,
  AdminListTemplatesPayload,
  AdminTemplateDetail,
  AdminTemplateManifestInput,
  AdminTemplateUpsertPayload
} from '../server/admin/adminTypes';
import type { BuiltTemplateCatalogEntry } from '../../scripts/build-template-catalog';
import type { ProjectState } from '../types/infrastructure';
import {
  adminLogout,
  deleteAdminTemplate,
  fetchAdminAuthStatus,
  fetchAdminTemplateDetail,
  fetchAdminTemplates,
  rebuildAdminCatalog,
  saveAdminTemplate
} from '../services/adminApi';
import { invalidateTemplateCatalogCache } from '../services/templateLibrary';
import { HachihiLogo } from '../components/HachihiLogo';
import { AdminLoginPage } from './AdminLoginPage';
import { AdminTemplateFormInitialState, AdminTemplateFormModal } from './AdminTemplateFormModal';
import { AdminTemplatePreviewModal } from './AdminTemplatePreviewModal';

export interface AdminCanvasDraftSession {
  slug: string;
  previousSlug?: string;
  manifest: AdminTemplateManifestInput;
  project: ProjectState;
  preview: AdminTemplateUpsertPayload['preview'];
}

interface AdminPortalProps {
  currentCanvasProject: ProjectState;
  pendingCanvasDraft?: AdminCanvasDraftSession | null;
  onClearPendingCanvasDraft?: () => void;
  onEditTemplateInCanvas: (draft: AdminCanvasDraftSession) => void;
  onBackToApp: () => void;
}

const STORAGE_MODE_LABELS: Record<string, string> = {
  local_and_github: 'Đồng bộ Local + GitHub Repo',
  github: 'Lưu trực tiếp GitHub Repo',
  local: 'Lưu trên thư mục public/templates',
  readonly_unconfigured: 'Chế độ chỉ đọc (thiếu GITHUB_TOKEN)'
};

export const AdminPortal: React.FC<AdminPortalProps> = ({
  currentCanvasProject,
  pendingCanvasDraft = null,
  onClearPendingCanvasDraft,
  onEditTemplateInCanvas,
  onBackToApp
}) => {
  const [authStatus, setAuthStatus] = useState<AdminAuthStatusPayload | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [listPayload, setListPayload] = useState<AdminListTemplatesPayload | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmDeleteSlug, setConfirmDeleteSlug] = useState<string | null>(null);

  const [previewDetail, setPreviewDetail] = useState<AdminTemplateDetail | null>(null);
  const [formInitialState, setFormInitialState] = useState<AdminTemplateFormInitialState | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formServerError, setFormServerError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    console.log('[AdminPortal] loadTemplates:start');
    setListLoading(true);
    try {
      const data = await fetchAdminTemplates();
      console.log('[AdminPortal] loadTemplates:success', {
        totalTemplates: data.catalog.totalTemplates,
        storageMode: data.storageMode,
        categories: data.catalog.categories
      });
      setListPayload(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không tải được danh sách mẫu template.';
      console.log('[AdminPortal] loadTemplates:error', {
        message,
        failureHint: message.includes('401')
          ? 'SESSION_VALIDATION_FAILED (401 from /api/admin/templates)'
          : message.includes('503')
          ? 'MISSING_ENV_VARS (503)'
          : 'API_OR_ROUTING_ERROR'
      });
      setBanner({
        type: 'error',
        text: message
      });
    } finally {
      setListLoading(false);
    }
  }, []);

  const refreshAuthAndData = useCallback(
    async (options?: { afterLoginUsername?: string }) => {
      const locationSnapshot =
        typeof window !== 'undefined'
          ? {
              pathname: window.location.pathname,
              hash: window.location.hash,
              search: window.location.search,
              origin: window.location.origin,
              isInIframe: (() => {
                try {
                  return window.self !== window.top;
                } catch {
                  return true;
                }
              })()
            }
          : null;

      console.log('[AdminPortal] refreshAuthAndData:start', {
        afterLoginUsername: options?.afterLoginUsername ?? null,
        location: locationSnapshot
      });

      setAuthLoading(true);
      try {
        const status = await fetchAdminAuthStatus();
        console.log('[AdminPortal] refreshAuthAndData:status_received', {
          configured: status.configured,
          authenticated: status.authenticated,
          user: status.user,
          storageMode: status.storageMode,
          missingVars: status.missingVars,
          githubConfigured: status.githubConfigured,
          writableLocalFs: status.writableLocalFs
        });

        if (!status.configured || status.missingVars.length > 0) {
          console.log('[AdminPortal][AuthDiagnosis] MISSING_ENV_VARS', {
            missingVars: status.missingVars,
            detail:
              'Server reports configured=false. Configure ADMIN_USERNAME and ADMIN_PASSWORD in .env.local or deployment Environment Variables.'
          });
        } else if (options?.afterLoginUsername && !status.authenticated) {
          console.log('[AdminPortal][AuthDiagnosis] SESSION_VALIDATION_FAILED', {
            expectedUser: options.afterLoginUsername,
            authenticated: status.authenticated,
            location: locationSnapshot,
            detail:
              'POST /api/admin/auth succeeded, but subsequent GET /api/admin/auth returned authenticated=false. The HttpOnly cookie hachihi_admin_session was likely dropped (third-party cookie blocked in iframe or SameSite/Secure mismatch).'
          });
        } else if (!status.authenticated) {
          console.log('[AdminPortal][AuthDiagnosis] NO_ACTIVE_SESSION', {
            configured: status.configured,
            authenticated: status.authenticated,
            location: locationSnapshot
          });
        }

        if (
          locationSnapshot &&
          locationSnapshot.pathname !== '/admin' &&
          locationSnapshot.hash !== '#/admin'
        ) {
          console.log('[AdminPortal][AuthDiagnosis] CLIENT_ROUTING_CONFLICT', {
            pathname: locationSnapshot.pathname,
            hash: locationSnapshot.hash,
            detail: 'AdminPortal is mounted while browser URL is neither /admin nor #/admin.'
          });
        }

        setAuthStatus(status);
        if (status.authenticated) {
          await loadTemplates();
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Không kiểm tra được kết nối máy chủ Admin.';
        console.log('[AdminPortal] refreshAuthAndData:error', {
          message,
          location: locationSnapshot,
          failureHint:
            message.includes('404') || message.includes('JSON') || message.includes('HTML')
              ? 'CLIENT_ROUTING_OR_MISSING_API (/api/admin/auth unreachable or returned SPA HTML)'
              : 'AUTH_STATUS_REQUEST_FAILED'
        });
        setBanner({
          type: 'error',
          text: message
        });
      } finally {
        setAuthLoading(false);
        console.log('[AdminPortal] refreshAuthAndData:complete');
      }
    },
    [loadTemplates]
  );

  useEffect(() => {
    console.log('[AdminPortal] mounted -> triggering initial refreshAuthAndData', {
      pathname: typeof window !== 'undefined' ? window.location.pathname : 'ssr',
      hash: typeof window !== 'undefined' ? window.location.hash : ''
    });
    void refreshAuthAndData();
  }, [refreshAuthAndData]);

  // Resume form modal automatically when returning from live 2D/3D Canvas edit
  useEffect(() => {
    if (!pendingCanvasDraft || !authStatus?.authenticated) return;
    const draftDetail: AdminTemplateDetail = {
      entry: {
        id: pendingCanvasDraft.manifest.id,
        slug: pendingCanvasDraft.slug,
        name: pendingCanvasDraft.manifest.name,
        category: pendingCanvasDraft.manifest.category,
        mode: pendingCanvasDraft.manifest.mode,
        badge: pendingCanvasDraft.manifest.badge || pendingCanvasDraft.manifest.category,
        version: pendingCanvasDraft.manifest.version || '1.0.0',
        updatedAt: new Date().toISOString().slice(0, 10),
        author: pendingCanvasDraft.manifest.author || 'HACHIHI',
        description: pendingCanvasDraft.manifest.description || '',
        highlights: pendingCanvasDraft.manifest.highlights || [],
        tags: pendingCanvasDraft.manifest.tags || [],
        projectUrl: `/templates/${pendingCanvasDraft.slug}/project.json`,
        previewUrl: `/templates/${pendingCanvasDraft.slug}/preview.svg`,
        hasProjectData: true
      },
      manifest: pendingCanvasDraft.manifest,
      projectJson: pendingCanvasDraft.project,
      projectRawText: JSON.stringify(pendingCanvasDraft.project, null, 2),
      previewFilename: pendingCanvasDraft.preview?.filename || 'preview.svg',
      previewContent: pendingCanvasDraft.preview?.content || null,
      previewIsBase64: Boolean(pendingCanvasDraft.preview?.isBase64),
      source: 'local'
    };

    setFormServerError(null);
    setFormInitialState({
      mode: pendingCanvasDraft.previousSlug ? 'edit' : 'create',
      detail: pendingCanvasDraft.previousSlug ? draftDetail : undefined,
      overrideProject: pendingCanvasDraft.project
    });
    setIsFormOpen(true);
    onClearPendingCanvasDraft?.();
  }, [pendingCanvasDraft, authStatus?.authenticated, onClearPendingCanvasDraft]);

  const templates = useMemo(() => listPayload?.catalog.templates || [], [listPayload]);
  const categories = useMemo(() => {
    const set = new Set<string>(listPayload?.catalog.categories || []);
    templates.forEach(t => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set);
  }, [listPayload, templates]);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return templates.filter(t => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
      if (modeFilter !== 'all' && t.mode !== modeFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      );
    });
  }, [templates, searchQuery, categoryFilter, modeFilter]);

  const handleOpenCreate = () => {
    setFormServerError(null);
    setFormInitialState({ mode: 'create' });
    setIsFormOpen(true);
  };

  const handleOpenCreateFromCanvas = () => {
    setFormServerError(null);
    setFormInitialState({ mode: 'create', overrideProject: currentCanvasProject });
    setIsFormOpen(true);
  };

  const handleOpenDetailAction = async (
    entry: BuiltTemplateCatalogEntry,
    action: 'preview' | 'edit' | 'duplicate' | 'canvas'
  ) => {
    setBusyAction(`${action}:${entry.slug}`);
    setBanner(null);
    try {
      const detail = await fetchAdminTemplateDetail(entry.slug);
      if (action === 'preview') {
        setPreviewDetail(detail);
      } else if (action === 'edit' || action === 'duplicate') {
        setFormServerError(null);
        setFormInitialState({ mode: action, detail });
        setIsFormOpen(true);
      } else if (action === 'canvas') {
        if (!detail.projectJson) {
          setBanner({
            type: 'error',
            text: `Mẫu "${entry.name}" chưa có project.json hợp lệ để sửa trên Canvas.`
          });
          return;
        }
        onEditTemplateInCanvas({
          slug: detail.entry.slug,
          previousSlug: detail.entry.slug,
          manifest: detail.manifest,
          project: detail.projectJson,
          preview:
            detail.previewFilename && detail.previewContent
              ? {
                  filename: detail.previewFilename,
                  content: detail.previewContent,
                  isBase64: detail.previewIsBase64
                }
              : null
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : `Không đọc được mẫu "${entry.slug}".`
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveTemplate = async (payload: AdminTemplateUpsertPayload) => {
    setFormSaving(true);
    setFormServerError(null);
    try {
      const res = await saveAdminTemplate(payload);
      invalidateTemplateCatalogCache();
      setIsFormOpen(false);
      setFormInitialState(null);
      setBanner({ type: 'success', text: res.message || `Đã lưu mẫu "${payload.manifest.name}" và cập nhật catalog.json.` });
      await loadTemplates();
    } catch (err) {
      setFormServerError(err instanceof Error ? err.message : 'Lưu mẫu template thất bại.');
    } finally {
      setFormSaving(false);
    }
  };

  const handleConfirmDelete = async (slug: string) => {
    setBusyAction(`delete:${slug}`);
    setBanner(null);
    try {
      const res = await deleteAdminTemplate(slug);
      invalidateTemplateCatalogCache();
      setConfirmDeleteSlug(null);
      setBanner({ type: 'success', text: res.message || `Đã xóa mẫu "${slug}" và đồng bộ catalog.json.` });
      await loadTemplates();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : `Không xóa được mẫu "${slug}".`
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRebuildCatalog = async () => {
    setBusyAction('rebuild');
    setBanner(null);
    try {
      const res = await rebuildAdminCatalog();
      invalidateTemplateCatalogCache();
      setBanner({ type: 'success', text: res.message || 'Đã đồng bộ lại catalog.json.' });
      await loadTemplates();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Đồng bộ catalog.json thất bại.'
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = async () => {
    console.log('[AdminPortal] handleLogout:start');
    setBusyAction('logout');
    try {
      await adminLogout();
      console.log('[AdminPortal] handleLogout:success');
      setAuthStatus(prev => (prev ? { ...prev, authenticated: false, user: null } : null));
      setListPayload(null);
    } catch (err) {
      console.log('[AdminPortal] handleLogout:error', {
        message: err instanceof Error ? err.message : String(err)
      });
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Đăng xuất thất bại.'
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh w-full bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-slate-600 dark:text-slate-300 text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-[#155EEF]" />
        <span>Đang kiểm tra phiên đăng nhập Admin...</span>
      </div>
    );
  }

  if (!authStatus?.authenticated) {
    console.log('[AdminPortal] rendering AdminLoginPage', {
      authStatusReceived: Boolean(authStatus),
      configured: authStatus?.configured ?? null,
      authenticated: authStatus?.authenticated ?? false,
      missingVars: authStatus?.missingVars ?? []
    });
    return (
      <AdminLoginPage
        authStatus={authStatus}
        onLoginSuccess={loggedInUsername => {
          console.log('[AdminPortal] onLoginSuccess -> revalidating session', {
            loggedInUsername
          });
          void refreshAuthAndData({ afterLoginUsername: loggedInUsername });
        }}
        onBackToApp={onBackToApp}
      />
    );
  }

  return (
    <div className="min-h-dvh w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Admin Top Header */}
      <header className="min-h-14 px-4 sm:px-6 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
            <HachihiLogo size={22} />
            <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
              Quản trị mẫu Template
            </span>
          </div>
          <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
            <ShieldCheck className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>{STORAGE_MODE_LABELS[authStatus.storageMode] || authStatus.storageMode}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-xs text-slate-500 dark:text-slate-400 px-2 whitespace-nowrap">
            Admin: <strong className="font-semibold text-slate-800 dark:text-slate-200">{authStatus.user?.username}</strong>
          </span>

          <button
            type="button"
            onClick={handleRebuildCatalog}
            disabled={busyAction !== null}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            title="Quét lại public/templates và cập nhật public/templates/catalog.json"
          >
            {busyAction === 'rebuild' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderSync className="w-3.5 h-3.5 text-[#155EEF]" />
            )}
            <span className="hidden sm:inline">Đồng bộ catalog.json</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreateFromCanvas}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#155EEF] text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            title="Lưu sơ đồ hiện tại trên Canvas thành mẫu mới"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-emerald-600" />
            <span className="hidden lg:inline">Lưu từ Canvas đang mở</span>
          </button>

          <button
            type="button"
            data-testid="admin-create-template-btn"
            onClick={handleOpenCreate}
            className="h-9 px-3.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Thêm mẫu mới</span>
          </button>

          <button
            type="button"
            data-testid="admin-back-to-app-btn"
            onClick={onBackToApp}
            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Trình thiết kế</span>
          </button>

          <button
            type="button"
            data-testid="admin-logout-btn"
            onClick={() => void handleLogout()}
            disabled={busyAction === 'logout'}
            className="h-9 px-3 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Đăng xuất</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        {banner && (
          <div
            role="alert"
            className={`px-4 py-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
              banner.type === 'success'
                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                : 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {banner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{banner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-[11px] font-semibold underline cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tìm theo tên mẫu, thư mục slug, ID, danh mục..."
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none focus:border-[#155EEF]"
              />
            </div>

            <select
              aria-label="Lọc theo danh mục"
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            >
              <option value="all">Tất cả danh mục</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <select
              aria-label="Lọc theo chế độ thiết kế"
              value={modeFilter}
              onChange={e => setModeFilter(e.target.value)}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            >
              <option value="all">Tất cả chế độ</option>
              <option value="topology">Topology</option>
              <option value="floorplan">Mặt bằng</option>
              <option value="cctv">CCTV</option>
              <option value="wifi">Wi-Fi</option>
              <option value="rack">Tủ Rack</option>
              <option value="fiber">Cáp quang</option>
              <option value="multisite">Đa chi nhánh</option>
              <option value="electrical">Điện nhẹ</option>
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            <span>
              Hiển thị <strong className="text-slate-900 dark:text-white">{filteredTemplates.length}</strong> /{' '}
              {templates.length} mẫu
            </span>
            <button
              type="button"
              onClick={() => void loadTemplates()}
              disabled={listLoading}
              aria-label="Làm mới danh sách mẫu"
              className="h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              title="Làm mới danh sách"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${listLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Template List Table */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          {listLoading && templates.length === 0 ? (
            <div className="py-16 flex items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-[#155EEF]" />
              <span>Đang tải thư viện template...</span>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Không tìm thấy mẫu template phù hợp
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Thử xóa bộ lọc tìm kiếm hoặc nhấn Thêm mẫu mới.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Mẫu thiết kế</th>
                    <th className="py-2.5 px-3">Thư mục / ID</th>
                    <th className="py-2.5 px-3">Danh mục</th>
                    <th className="py-2.5 px-3">Quy mô</th>
                    <th className="py-2.5 px-3">Phiên bản</th>
                    <th className="py-2.5 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredTemplates.map(entry => {
                    const isBusy = busyAction?.endsWith(`:${entry.slug}`);
                    return (
                      <tr
                        key={entry.slug}
                        data-testid={`admin-template-row-${entry.slug}`}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3 min-w-[220px]">
                            <div className="w-16 h-11 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                              {entry.previewUrl ? (
                                <img
                                  src={`${entry.previewUrl}?v=${encodeURIComponent(entry.updatedAt || entry.version)}`}
                                  alt={entry.name}
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <span className="text-[10px] text-slate-400">No SVG</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 dark:text-white truncate max-w-[260px]">
                                {entry.name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                                {entry.description || 'Chưa có mô tả'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          <div className="text-slate-800 dark:text-slate-200">{entry.slug}</div>
                          <div className="text-slate-400">#{entry.id}</div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-medium text-slate-800 dark:text-slate-200">{entry.category}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{entry.mode}</div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                          {entry.stats
                            ? `${entry.stats.nodes} node · ${entry.stats.cables} cáp · ${entry.stats.floors} tầng`
                            : entry.hasProjectData
                            ? 'Có dữ liệu JSON'
                            : 'Thiếu JSON'}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] tabular-nums">
                          <div>v{entry.version}</div>
                          <div className="text-slate-400">{entry.updatedAt}</div>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {confirmDeleteSlug === entry.slug ? (
                            <div className="inline-flex items-center gap-1.5">
                              <span className="text-[11px] text-rose-600 font-semibold">Xác nhận xóa?</span>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleConfirmDelete(entry.slug)}
                                className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                              >
                                Xóa hẳn
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteSlug(null)}
                                className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] cursor-pointer"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleOpenDetailAction(entry, 'preview')}
                                aria-label={`Xem chi tiết ${entry.name}`}
                                title="Xem trước & JSON"
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleOpenDetailAction(entry, 'canvas')}
                                aria-label={`Sửa Canvas ${entry.name}`}
                                title="Mở & sửa trực tiếp trên Canvas 2D/3D"
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-[#155EEF] cursor-pointer"
                              >
                                <Paintbrush className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleOpenDetailAction(entry, 'edit')}
                                aria-label={`Sửa ${entry.name}`}
                                title="Sửa thông tin, project.json & preview"
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-slate-700 dark:text-slate-200 cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleOpenDetailAction(entry, 'duplicate')}
                                aria-label={`Nhân bản ${entry.name}`}
                                title="Nhân bản thành mẫu mới"
                                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteSlug(entry.slug)}
                                aria-label={`Xóa ${entry.name}`}
                                title="Xóa mẫu này"
                                className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <AdminTemplatePreviewModal
        detail={previewDetail}
        onClose={() => setPreviewDetail(null)}
        onEdit={detail => {
          setPreviewDetail(null);
          setFormServerError(null);
          setFormInitialState({ mode: 'edit', detail });
          setIsFormOpen(true);
        }}
        onEditCanvas={detail => {
          setPreviewDetail(null);
          if (!detail.projectJson) return;
          onEditTemplateInCanvas({
            slug: detail.entry.slug,
            previousSlug: detail.entry.slug,
            manifest: detail.manifest,
            project: detail.projectJson,
            preview:
              detail.previewFilename && detail.previewContent
                ? {
                    filename: detail.previewFilename,
                    content: detail.previewContent,
                    isBase64: detail.previewIsBase64
                  }
                : null
          });
        }}
      />

      <AdminTemplateFormModal
        isOpen={isFormOpen}
        initialState={formInitialState}
        currentCanvasProject={currentCanvasProject}
        isSaving={formSaving}
        serverError={formServerError}
        onClose={() => {
          setIsFormOpen(false);
          setFormInitialState(null);
          setFormServerError(null);
        }}
        onSubmit={handleSaveTemplate}
        onOpenCanvasEditor={draft => {
          setIsFormOpen(false);
          onEditTemplateInCanvas(draft);
        }}
      />
    </div>
  );
};
