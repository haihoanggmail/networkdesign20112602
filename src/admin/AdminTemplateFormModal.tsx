import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  FolderUp,
  Loader2,
  Paintbrush,
  Sparkles,
  Upload,
  X
} from 'lucide-react';
import type { AdminTemplateDetail, AdminTemplateManifestInput, AdminTemplateUpsertPayload } from '../server/admin/adminTypes';
import type { DesignMode, ProjectState } from '../types/infrastructure';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { DESIGN_MODES } from '../utils/designModes';
import { migrateAndValidateProject } from '../utils/projectStorage';
import { generateTemplateSnapshotSvg, slugifyTemplateId } from '../services/templateLibrary';
import { parseImportedTemplateFiles } from '../services/adminApi';
import { createEmptyProject } from '../store/useProjectStore';

export interface AdminTemplateFormInitialState {
  mode: 'create' | 'edit' | 'duplicate';
  detail?: AdminTemplateDetail;
  overrideProject?: ProjectState;
}

interface AdminTemplateFormModalProps {
  isOpen: boolean;
  initialState: AdminTemplateFormInitialState | null;
  currentCanvasProject?: ProjectState;
  isSaving: boolean;
  serverError: string | null;
  onClose: () => void;
  onSubmit: (payload: AdminTemplateUpsertPayload) => Promise<void>;
  onOpenCanvasEditor: (draft: {
    slug: string;
    previousSlug?: string;
    manifest: AdminTemplateManifestInput;
    project: ProjectState;
    preview: AdminTemplateUpsertPayload['preview'];
  }) => void;
}

export const AdminTemplateFormModal: React.FC<AdminTemplateFormModalProps> = ({
  isOpen,
  initialState,
  currentCanvasProject,
  isSaving,
  serverError,
  onClose,
  onSubmit,
  onOpenCanvasEditor
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);
  const projectJsonInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'metadata' | 'project'>('metadata');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [previousSlug, setPreviousSlug] = useState<string | undefined>(undefined);
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Mạng LAN');
  const [designMode, setDesignMode] = useState<DesignMode>('topology');
  const [badge, setBadge] = useState('Custom');
  const [version, setVersion] = useState('1.0.0');
  const [author, setAuthor] = useState('HACHIHI');
  const [description, setDescription] = useState('');
  const [highlightsText, setHighlightsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [projectText, setProjectText] = useState('');
  const [previewPayload, setPreviewPayload] = useState<AdminTemplateUpsertPayload['preview']>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [isDraggingZip, setIsDraggingZip] = useState(false);

  useEffect(() => {
    if (!isOpen || !initialState) return;
    setActiveTab('metadata');
    setLocalError(null);
    setImportNotice(null);

    if (initialState.mode === 'create') {
      const baseProj = initialState.overrideProject || createEmptyProject('Mẫu thiết kế mới');
      const baseName = initialState.overrideProject?.name?.trim() || 'Mẫu thiết kế mới';
      const autoSlug = slugifyTemplateId(baseName);
      setSlug(autoSlug);
      setSlugTouched(false);
      setPreviousSlug(undefined);
      setId(autoSlug);
      setIdTouched(false);
      setName(baseName);
      setCategory('Mạng LAN');
      setDesignMode(baseProj.activeMode || 'topology');
      setBadge('Custom');
      setVersion('1.0.0');
      setAuthor(baseProj.author || 'HACHIHI');
      setDescription('');
      setHighlightsText(
        `${baseProj.floors.length} tầng\n${Object.keys(baseProj.assets).length} thiết bị\n${baseProj.cables.length} tuyến cáp`
      );
      setTagsText('LAN, HACHIHI');
      setProjectText(JSON.stringify(baseProj, null, 2));
      try {
        const svg = generateTemplateSnapshotSvg(baseProj);
        setPreviewPayload({ filename: 'preview.svg', content: svg, isBase64: false });
      } catch {
        setPreviewPayload(null);
      }
      return;
    }

    const detail = initialState.detail!;
    const isDuplicate = initialState.mode === 'duplicate';
    const baseSlug = isDuplicate ? `${detail.entry.slug}-copy` : detail.entry.slug;
    const baseId = isDuplicate ? `${detail.manifest.id}-copy` : detail.manifest.id;
    const baseName = isDuplicate ? `${detail.manifest.name} (Bản sao)` : detail.manifest.name;

    setSlug(baseSlug);
    setSlugTouched(true);
    setPreviousSlug(isDuplicate ? undefined : detail.entry.slug);
    setId(baseId);
    setIdTouched(true);
    setName(baseName);
    setCategory(detail.manifest.category || 'Mạng LAN');
    setDesignMode(detail.manifest.mode || 'topology');
    setBadge(detail.manifest.badge || detail.manifest.category || 'Custom');
    setVersion(detail.manifest.version || '1.0.0');
    setAuthor(detail.manifest.author || 'HACHIHI');
    setDescription(detail.manifest.description || '');
    setHighlightsText((detail.manifest.highlights || []).join('\n'));
    setTagsText((detail.manifest.tags || []).join(', '));

    const effectiveProj = initialState.overrideProject || detail.projectJson;
    setProjectText(
      effectiveProj
        ? JSON.stringify(effectiveProj, null, 2)
        : detail.projectRawText || JSON.stringify(createEmptyProject(baseName), null, 2)
    );

    if (initialState.overrideProject) {
      try {
        const svg = generateTemplateSnapshotSvg(initialState.overrideProject);
        setPreviewPayload({ filename: 'preview.svg', content: svg, isBase64: false });
      } catch {
        setPreviewPayload(
          detail.previewFilename && detail.previewContent
            ? {
                filename: detail.previewFilename,
                content: detail.previewContent,
                isBase64: detail.previewIsBase64
              }
            : null
        );
      }
    } else if (detail.previewFilename && detail.previewContent) {
      setPreviewPayload({
        filename: detail.previewFilename,
        content: detail.previewContent,
        isBase64: detail.previewIsBase64
      });
    } else {
      setPreviewPayload(null);
    }
  }, [isOpen, initialState]);

  const projectValidation = useMemo(() => {
    if (!projectText.trim()) {
      return { ok: false as const, error: 'Dữ liệu project.json đang trống.' };
    }
    try {
      const parsed = JSON.parse(projectText);
      const checked = migrateAndValidateProject(parsed);
      if (!checked.ok) return { ok: false as const, error: checked.error };
      return {
        ok: true as const,
        project: checked.project,
        stats: {
          nodes: checked.project.nodes.length,
          assets: Object.keys(checked.project.assets).length,
          racks: checked.project.racks.length,
          cables: checked.project.cables.length,
          floors: checked.project.floors.length
        }
      };
    } catch {
      return { ok: false as const, error: 'Lỗi cú pháp JSON trong project.json.' };
    }
  }, [projectText]);

  const previewImgSrc = useMemo(() => {
    if (!previewPayload?.content) return null;
    if (previewPayload.isBase64) return previewPayload.content;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewPayload.content)}`;
  }, [previewPayload]);

  if (!isOpen || !initialState) return null;

  const buildManifest = (): AdminTemplateManifestInput => ({
    id: id.trim() || slug.trim(),
    name: name.trim(),
    category: category.trim() || 'Mạng LAN',
    mode: designMode,
    badge: badge.trim() || category.trim() || 'Custom',
    version: version.trim() || '1.0.0',
    updatedAt: new Date().toISOString().slice(0, 10),
    author: author.trim() || 'HACHIHI',
    description: description.trim(),
    highlights: highlightsText
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean),
    tags: tagsText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  });

  const handleImportFiles = async (files: File[]) => {
    setLocalError(null);
    setImportNotice(null);
    try {
      const parsed = await parseImportedTemplateFiles(files);
      if (initialState.mode === 'create' || initialState.mode === 'duplicate') {
        setSlug(parsed.slug);
        setSlugTouched(true);
        setId(parsed.manifest.id || parsed.slug);
        setIdTouched(true);
      }
      if (parsed.manifest.name) setName(parsed.manifest.name);
      if (parsed.manifest.category) setCategory(parsed.manifest.category);
      if (parsed.manifest.mode) setDesignMode(parsed.manifest.mode);
      if (parsed.manifest.badge) setBadge(parsed.manifest.badge);
      if (parsed.manifest.version) setVersion(parsed.manifest.version);
      if (parsed.manifest.author) setAuthor(parsed.manifest.author);
      if (parsed.manifest.description !== undefined) setDescription(parsed.manifest.description);
      if (parsed.manifest.highlights?.length) setHighlightsText(parsed.manifest.highlights.join('\n'));
      if (parsed.manifest.tags?.length) setTagsText(parsed.manifest.tags.join(', '));
      setProjectText(parsed.projectRawText);
      if (parsed.preview) {
        setPreviewPayload(parsed.preview);
      } else {
        try {
          const valid = migrateAndValidateProject(JSON.parse(parsed.projectRawText));
          if (valid.ok) {
            setPreviewPayload({
              filename: 'preview.svg',
              content: generateTemplateSnapshotSvg(valid.project),
              isBase64: false
            });
          }
        } catch {
          // ignore snapshot error
        }
      }
      setImportNotice('Đã nạp dữ liệu từ tệp vừa chọn. Kiểm tra lại thông tin và nhấn Lưu.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Không thể đọc tệp đã chọn.');
    }
  };

  const handlePreviewFileUpload = async (file: File) => {
    setLocalError(null);
    const lower = file.name.toLowerCase();
    const ext = lower.endsWith('.png')
      ? 'png'
      : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'jpg'
      : lower.endsWith('.webp')
      ? 'webp'
      : lower.endsWith('.svg')
      ? 'svg'
      : null;

    if (!ext) {
      setLocalError('Ảnh preview chỉ hỗ trợ định dạng .svg, .png, .jpg hoặc .webp.');
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setLocalError('Ảnh preview vượt quá giới hạn 2.5MB.');
      return;
    }

    if (ext === 'svg') {
      const svgText = await file.text();
      setPreviewPayload({ filename: 'preview.svg', content: svgText, isBase64: false });
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Không đọc được ảnh tải lên.'));
      reader.readAsDataURL(file);
    });
    setPreviewPayload({
      filename: `preview.${ext}`,
      content: dataUrl,
      isBase64: true
    });
  };

  const handleAutoGenerateSvg = () => {
    setLocalError(null);
    if (!projectValidation.ok) {
      setLocalError('Cần dữ liệu project.json hợp lệ để tự sinh ảnh preview SVG.');
      return;
    }
    const svg = generateTemplateSnapshotSvg(projectValidation.project);
    setPreviewPayload({ filename: 'preview.svg', content: svg, isBase64: false });
    setImportNotice('Đã tạo lại ảnh preview.svg trực tiếp từ project.json.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!slug.trim()) {
      setLocalError('Vui lòng nhập slug thư mục cho template.');
      return;
    }
    if (!name.trim()) {
      setLocalError('Vui lòng nhập tên hiển thị của template.');
      return;
    }
    if (!projectValidation.ok) {
      setActiveTab('project');
      setLocalError(projectValidation.error);
      return;
    }

    await onSubmit({
      slug: slug.trim().toLowerCase(),
      previousSlug,
      manifest: buildManifest(),
      projectJson: projectValidation.project,
      preview: previewPayload
    });
  };

  const handleOpenCanvas = () => {
    setLocalError(null);
    if (!projectValidation.ok) {
      setActiveTab('project');
      setLocalError(projectValidation.error);
      return;
    }
    onOpenCanvasEditor({
      slug: slug.trim().toLowerCase() || slugifyTemplateId(name || 'template-moi'),
      previousSlug,
      manifest: buildManifest(),
      project: projectValidation.project,
      preview: previewPayload
    });
  };

  const titleText =
    initialState.mode === 'create'
      ? 'Thêm Template mới'
      : initialState.mode === 'duplicate'
      ? 'Nhân bản Template'
      : `Chỉnh sửa Template (${initialState.detail?.entry.slug || ''})`;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={titleText}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full h-dvh sm:h-auto sm:max-w-5xl sm:max-h-[92dvh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-none sm:rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-slate-800 dark:text-slate-200"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white truncate">
              {titleText}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Lưu trực tiếp template.json, project.json, preview và tự động cập nhật catalog.json.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenCanvas}
              disabled={!projectValidation.ok || isSaving}
              data-testid="admin-form-open-canvas-btn"
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Paintbrush className="w-3.5 h-3.5 text-[#155EEF]" />
              <span>Chỉnh sửa trên Canvas 2D/3D</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng biểu mẫu template"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Strip */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('metadata')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${
                activeTab === 'metadata'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              1. Thông tin &amp; Ảnh xem trước (template.json)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('project')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${
                activeTab === 'project'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              2. Dữ liệu thiết kế (project.json)
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] tabular-nums">
            {projectValidation.ok ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Hợp lệ ({projectValidation.stats.assets} thiết bị · {projectValidation.stats.cables} cáp · {projectValidation.stats.racks} rack)
                </span>
              </span>
            ) : (
              <span className="text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>project.json chưa hợp lệ</span>
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {(localError || serverError) && (
            <div
              role="alert"
              data-testid="admin-form-error"
              className="p-3 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{localError || serverError}</span>
            </div>
          )}

          {importNotice && (
            <div
              role="status"
              className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{importNotice}</span>
            </div>
          )}

          {/* Quick Import / Dropzone Bar */}
          <div
            onDragOver={e => {
              e.preventDefault();
              setIsDraggingZip(true);
            }}
            onDragLeave={() => setIsDraggingZip(false)}
            onDrop={e => {
              e.preventDefault();
              setIsDraggingZip(false);
              const dropped = Array.from(e.dataTransfer.files || []);
              if (dropped.length > 0) void handleImportFiles(dropped);
            }}
            className={`p-4 rounded-xl border border-dashed flex flex-wrap items-center justify-between gap-3 transition-colors ${
              isDraggingZip
                ? 'border-[#155EEF] bg-blue-50/70 dark:bg-blue-950/30'
                : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40'
            }`}
          >
            <div className="space-y-0.5">
              <div className="font-medium text-slate-900 dark:text-white">
                Nhập nhanh từ gói ZIP, thư mục mẫu hoặc bản vẽ đang mở
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Kéo thả tệp .zip (xuất từ HACHIHI) hoặc chọn cùng lúc template.json, project.json, preview.svg/png.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={zipInputRef}
                type="file"
                multiple
                accept=".zip,.json,.svg,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  if (files.length > 0) void handleImportFiles(files);
                }}
              />
              <button
                type="button"
                onClick={() => zipInputRef.current?.click()}
                className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <FolderUp className="w-3.5 h-3.5 text-[#155EEF]" />
                <span>Chọn ZIP / Tệp mẫu</span>
              </button>
              {currentCanvasProject && (
                <button
                  type="button"
                  onClick={() => {
                    setProjectText(JSON.stringify(currentCanvasProject, null, 2));
                    if (!name.trim() || name === 'Mẫu thiết kế mới') {
                      const nextName = currentCanvasProject.name || 'Mẫu từ Canvas';
                      setName(nextName);
                      if (!slugTouched) setSlug(slugifyTemplateId(nextName));
                      if (!idTouched) setId(slugifyTemplateId(nextName));
                    }
                    setDesignMode(currentCanvasProject.activeMode || 'topology');
                    try {
                      const svg = generateTemplateSnapshotSvg(currentCanvasProject);
                      setPreviewPayload({ filename: 'preview.svg', content: svg, isBase64: false });
                    } catch {
                      // ignore
                    }
                    setImportNotice('Đã lấy dữ liệu thiết kế & ảnh preview từ bản vẽ đang mở trên Canvas.');
                  }}
                  className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <FileUp className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Lấy từ bản vẽ hiện tại</span>
                </button>
              )}
            </div>
          </div>

          {activeTab === 'metadata' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Metadata Form Columns */}
              <div className="lg:col-span-7 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1 sm:col-span-2">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Tên mẫu thiết kế *
                    </label>
                    <input
                      type="text"
                      data-testid="admin-tpl-name-input"
                      value={name}
                      onChange={e => {
                        const val = e.target.value;
                        setName(val);
                        if (!slugTouched) setSlug(slugifyTemplateId(val));
                        if (!idTouched) setId(slugifyTemplateId(val));
                      }}
                      placeholder="VD: Hệ thống mạng văn phòng 3 tầng"
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Tên thư mục (Slug) *
                    </label>
                    <input
                      type="text"
                      data-testid="admin-tpl-slug-input"
                      value={slug}
                      onChange={e => {
                        setSlugTouched(true);
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
                      }}
                      placeholder="vd: 16-office-branch"
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono outline-none focus:border-[#155EEF]"
                    />
                    <div className="text-[11px] text-slate-500 font-mono">
                      public/templates/{slug || '...'}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      ID Template *
                    </label>
                    <input
                      type="text"
                      data-testid="admin-tpl-id-input"
                      value={id}
                      onChange={e => {
                        setIdTouched(true);
                        setId(e.target.value);
                      }}
                      placeholder="vd: office-branch-016"
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Danh mục
                    </label>
                    <input
                      type="text"
                      data-testid="admin-tpl-category-input"
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      placeholder="Mạng LAN, Camera, Rack, Wi-Fi..."
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Chế độ thiết kế
                    </label>
                    <select
                      value={designMode}
                      onChange={e => setDesignMode(e.target.value as DesignMode)}
                      className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    >
                      {DESIGN_MODES.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.label} ({m.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Phiên bản
                    </label>
                    <input
                      type="text"
                      value={version}
                      onChange={e => setVersion(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Tác giả
                    </label>
                    <input
                      type="text"
                      value={author}
                      onChange={e => setAuthor(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Nhãn phân loại (Badge)
                    </label>
                    <input
                      type="text"
                      value={badge}
                      onChange={e => setBadge(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Mô tả chi tiết
                    </label>
                    <textarea
                      rows={3}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Mô tả kiến trúc thiết bị, tuyến cáp và phạm vi sử dụng của mẫu..."
                      className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Điểm nổi bật (mỗi dòng 1 ý)
                    </label>
                    <textarea
                      rows={3}
                      value={highlightsText}
                      onChange={e => setHighlightsText(e.target.value)}
                      placeholder={'3 tầng · 4 phòng\n24 thiết bị · PoE'}
                      className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-700 dark:text-slate-300">
                      Tags tìm kiếm (phân tách bằng dấu phẩy)
                    </label>
                    <textarea
                      rows={3}
                      value={tagsText}
                      onChange={e => setTagsText(e.target.value)}
                      placeholder="LAN, VLAN, Rack, Office"
                      className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-[#155EEF]"
                    />
                  </div>
                </div>
              </div>

              {/* Preview Column */}
              <div className="lg:col-span-5 space-y-3">
                <div className="font-medium text-slate-700 dark:text-slate-300">
                  Ảnh xem trước ({previewPayload?.filename || 'chưa có'})
                </div>
                <div className="aspect-[16/10] rounded-xl border border-slate-200 dark:border-slate-800 bg-white overflow-hidden flex items-center justify-center">
                  {previewImgSrc ? (
                    <img
                      src={previewImgSrc}
                      alt="Xem trước template"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain p-2 bg-white"
                    />
                  ) : (
                    <div className="text-xs text-slate-400">Chưa có ảnh xem trước</div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={previewInputRef}
                    type="file"
                    accept=".svg,.png,.jpg,.jpeg,.webp"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void handlePreviewFileUpload(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => previewInputRef.current?.click()}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Tải ảnh lên</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAutoGenerateSvg}
                    disabled={!projectValidation.ok}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#155EEF]" />
                    <span>Tự tạo SVG từ project.json</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Nội dung JSON thiết kế (project.json)
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={projectJsonInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) {
                        const txt = await f.text();
                        setProjectText(txt);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => projectJsonInputRef.current?.click()}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    Tải file project.json
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setProjectText(JSON.stringify(JSON.parse(projectText), null, 2));
                      } catch {
                        setLocalError('Không thể định dạng vì JSON đang có lỗi cú pháp.');
                      }
                    }}
                    className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    Định dạng JSON
                  </button>
                </div>
              </div>
              <textarea
                rows={18}
                spellCheck={false}
                data-testid="admin-tpl-project-json-input"
                value={projectText}
                onChange={e => setProjectText(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono text-[11px] leading-relaxed outline-none focus:border-[#155EEF]"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Khi lưu, hệ thống sẽ cập nhật thư mục template và tự động tái tạo <span className="font-mono">catalog.json</span>.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="h-9 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              data-testid="admin-tpl-save-btn"
              disabled={isSaving}
              className="h-9 px-4 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap cursor-pointer"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              <span>{isSaving ? 'Đang lưu & cập nhật catalog...' : 'Lưu template & Cập nhật catalog.json'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
