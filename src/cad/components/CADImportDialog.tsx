import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  FolderOpen,
  History,
  Layers,
  Lock,
  Pencil,
  ServerCog,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { createEmptyCADDocument } from '../core/CADDocument';
import type { CADDocument } from '../core/CADTypes';
import {
  DWGProviderConfig,
  loadDWGProviderConfig,
  saveDWGProviderConfig,
  validateDwgConverterUrl
} from '../dwg/DWGProviderConfig';
import {
  CAD_FORMAT_MEMORY_POLICIES,
  LARGE_CAD_STREAM_THRESHOLD_BYTES
} from '../import/CADImportValidator';
import { CADImportReport } from '../import/CADImportReport';
import {
  CADImportMode,
  CADImportProgressInfo,
  CADUnifiedImportResult,
  applyImportModeToDocument,
  cadImportService
} from '../import/CADImportService';
import type { StreamEntityFilterOptions } from '../import/parsers/RawEntityParser';
import { renderCADDocumentToSvg } from '../rendering/CADSVGRenderer';
import { CADDocumentSummary, cadRepository } from '../storage/CADRepository';

interface CADImportDialogProps {
  isOpen: boolean;
  projectId?: string;
  initialFile?: File | null;
  onClose: () => void;
  onOpenDocument: (doc: CADDocument, options?: { openInNetworkUnderlay?: boolean }) => void;
}

export const CADImportDialog: React.FC<CADImportDialogProps> = ({
  isOpen,
  projectId,
  initialFile,
  onClose,
  onOpenDocument
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsingFileInfo, setParsingFileInfo] = useState<{ name: string; sizeMB: string } | null>(null);
  const [progressInfo, setProgressInfo] = useState<CADImportProgressInfo>({
    percent: 0,
    stageVi: ''
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stream & Garbage Entity Filter configuration (Task 3)
  const [autoOptimizeLarge, setAutoOptimizeLarge] = useState(true);
  const [skipHatch, setSkipHatch] = useState(false);
  const [skipHeavy3DAndImages, setSkipHeavy3DAndImages] = useState(false);
  const [skipHiddenFrozenLayers, setSkipHiddenFrozenLayers] = useState(false);
  const [skipLockedLayers, setSkipLockedLayers] = useState(false);

  const [parsedDoc, setParsedDoc] = useState<CADDocument | null>(null);
  const [importReport, setImportReport] = useState<CADImportReport | null>(null);
  const [importMode, setImportMode] = useState<CADImportMode>('full-edit');
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(new Set());
  const [layerSearch, setLayerSearch] = useState('');

  // DWG Tier 1 / Tier 2 state
  const [pendingDwgFile, setPendingDwgFile] = useState<File | null>(null);
  const [dwgInspection, setDwgInspection] = useState<
    Extract<CADUnifiedImportResult, { kind: 'dwg' }>['outcome']['inspection'] | null
  >(null);
  const [dwgConfig, setDwgConfig] = useState<DWGProviderConfig>(() => loadDWGProviderConfig());
  const [showDwgBridgeConfig, setShowDwgBridgeConfig] = useState(false);

  // Saved IndexedDB drawings
  const [savedDocs, setSavedDocs] = useState<CADDocumentSummary[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    void cadRepository.listDocuments().then(setSavedDocs).catch(() => setSavedDocs([]));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && initialFile) {
      void handleFilePicked(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFile]);

  const svgPreviewDataUrl = useMemo(() => {
    if (!parsedDoc) return null;
    const svg = renderCADDocumentToSvg(parsedDoc, {
      width: 560,
      height: 300,
      lightBackground: false,
      maxEntities: 5000
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [parsedDoc]);

  const resetStaging = () => {
    setParsedDoc(null);
    setImportReport(null);
    setPendingDwgFile(null);
    setDwgInspection(null);
    setErrorMsg(null);
  };

  const handleFilePicked = async (file: File, overrideDwgConfig?: DWGProviderConfig) => {
    resetStaging();
    setIsParsing(true);
    const isLargeFile = file.size >= LARGE_CAD_STREAM_THRESHOLD_BYTES;
    setParsingFileInfo({
      name: file.name,
      sizeMB: (file.size / (1024 * 1024)).toFixed(1)
    });
    setProgressInfo({
      percent: 4,
      stageVi: isLargeFile
        ? 'Đang khởi tạo trình đọc luồng Streaming Web Worker (tệp lớn)...'
        : 'Đang khởi tạo trình phân tích CAD...'
    });

    const effectiveFilterOptions: StreamEntityFilterOptions = {
      skipHatch: skipHatch || (autoOptimizeLarge && isLargeFile),
      skipHeavy3DAndImages: skipHeavy3DAndImages || (autoOptimizeLarge && isLargeFile),
      skipHiddenLayers: skipHiddenFrozenLayers,
      skipFrozenLayers: skipHiddenFrozenLayers,
      skipLockedLayers
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const outcome = await cadImportService.importFile(file, {
        projectId,
        signal: controller.signal,
        dwgProviderConfig: overrideDwgConfig || dwgConfig,
        lowMemoryMode: autoOptimizeLarge && isLargeFile ? true : undefined,
        filterOptions: effectiveFilterOptions,
        onProgressDetail: info => {
          setProgressInfo(info);
        }
      });

      if (outcome.kind === 'dwg') {
        if (outcome.outcome.status === 'converted' && outcome.outcome.result) {
          const { document, report } = outcome.outcome.result;
          setParsedDoc(document);
          setImportReport(report);
          setSelectedLayers(new Set(Object.keys(document.layers)));
        } else {
          setPendingDwgFile(file);
          setDwgInspection(outcome.outcome.inspection);
        }
      } else {
        const { document, report } = outcome.importResult;
        setParsedDoc(document);
        setImportReport(report);
        setSelectedLayers(new Set(Object.keys(document.layers)));
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setErrorMsg('Đã hủy quá trình mở tệp AutoCAD.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Không thể đọc tệp AutoCAD.');
      }
    } finally {
      setIsParsing(false);
      setParsingFileInfo(null);
      abortRef.current = null;
    }
  };

  const handleCancelImport = () => {
    abortRef.current?.abort();
  };

  const handleConfirmOpen = () => {
    if (!parsedDoc) return;
    const finalDoc = applyImportModeToDocument(
      parsedDoc,
      importMode,
      importMode === 'filter-layers' ? Array.from(selectedLayers) : undefined
    );
    onOpenDocument(finalDoc, {
      openInNetworkUnderlay: importMode === 'locked-underlay'
    });
    onClose();
  };

  const handleCreateBlankDrawing = () => {
    const blank = createEmptyCADDocument('Bản vẽ AutoCAD mới', { projectId, insUnits: 4 });
    onOpenDocument(blank, { openInNetworkUnderlay: false });
    onClose();
  };

  const handleOpenSaved = async (docId: string) => {
    const loaded = await cadRepository.loadDocument(docId);
    if (!loaded) {
      setErrorMsg('Không tìm thấy dữ liệu bản vẽ trong bộ nhớ cục bộ.');
      return;
    }
    onOpenDocument(loaded, { openInNetworkUnderlay: false });
    onClose();
  };

  const handleDeleteSaved = async (docId: string) => {
    await cadRepository.deleteDocument(docId);
    setSavedDocs(prev => prev.filter(d => d.id !== docId));
  };

  const handleSaveAndRetryDwg = () => {
    if (dwgConfig.mode === 'http-converter') {
      const check = validateDwgConverterUrl(dwgConfig.endpointUrl);
      if (!check.ok) {
        setErrorMsg(check.error);
        return;
      }
    }
    saveDWGProviderConfig(dwgConfig);
    if (pendingDwgFile) {
      void handleFilePicked(pendingDwgFile, dwgConfig);
    }
  };

  const handleResetDwgToWasm = () => {
    const nextCfg: DWGProviderConfig = {
      ...dwgConfig,
      mode: 'wasm-local'
    };
    setDwgConfig(nextCfg);
    saveDWGProviderConfig(nextCfg);
    if (pendingDwgFile) {
      void handleFilePicked(pendingDwgFile, nextCfg);
    }
  };

  if (!isOpen) return null;

  const filteredLayerList = parsedDoc
    ? Object.values(parsedDoc.layers).filter(l =>
        l.name.toLowerCase().includes(layerSearch.trim().toLowerCase())
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <FileCode2 className="h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Mở & Nhập bản vẽ AutoCAD (.DXF / .DWG)
              </h2>
              <p className="text-xs text-slate-400">
                Xử lý 100% trong trình duyệt (Web Worker + IndexedDB), bảo toàn Handle & đối tượng gốc
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {/* Dropzone when no active staged document */}
          {!parsedDoc && !pendingDwgFile && !isParsing && (
            <>
              <div
                onDragOver={e => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => {
                  e.preventDefault();
                  setIsDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFilePicked(f);
                }}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-cyan-400 bg-cyan-950/30'
                    : 'border-slate-700 bg-slate-950/50 hover:border-slate-500'
                }`}
              >
                <Upload className="mb-3 h-9 w-9 text-cyan-400" />
                <p className="text-sm font-medium text-white">
                  Kéo thả tệp <span className="text-cyan-300">.DXF</span> (ASCII & Binary) hoặc{' '}
                  <span className="text-amber-300">.DWG</span> (giải mã ngoại tuyến LibreDWG WASM) vào đây
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Hỗ trợ AutoCAD R12 – 2025 (AC1009 – AC1032): DXF ASCII (Streaming tới{' '}
                  {Math.round(CAD_FORMAT_MEMORY_POLICIES['dxf-ascii'].hardMaxBytes / (1024 * 1024))} MB), Binary DXF &amp; DWG WASM (tối đa{' '}
                  {Math.round(CAD_FORMAT_MEMORY_POLICIES['dwg-wasm'].hardMaxBytes / (1024 * 1024))} MB)
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-500"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Chọn tệp từ máy tính
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateBlankDrawing}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    <Pencil className="h-4 w-4" />
                    Tạo bản vẽ AutoCAD trắng
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".dxf,.dwg"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void handleFilePicked(f);
                    e.target.value = '';
                  }}
                />
              </div>

              {/* Stream Filter & Memory Optimization Options */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs">
                <div className="mb-2 font-semibold text-slate-300">
                  Bộ lọc luồng Streaming & Tối ưu bộ nhớ (dành cho bản vẽ DXF lớn 60–300 MB+)
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={autoOptimizeLarge}
                      onChange={e => setAutoOptimizeLarge(e.target.checked)}
                    />
                    <span>Tự động lọc HATCH/3DSOLID/IMAGE khi tệp ≥ 24 MB</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={skipHatch}
                      onChange={e => setSkipHatch(e.target.checked)}
                    />
                    <span>Luôn bỏ qua HATCH (mẫu tô vật liệu)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={skipHeavy3DAndImages}
                      onChange={e => setSkipHeavy3DAndImages(e.target.checked)}
                    />
                    <span>Luôn bỏ qua 3DSOLID / IMAGE / Proxy</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={skipHiddenFrozenLayers}
                      onChange={e => setSkipHiddenFrozenLayers(e.target.checked)}
                    />
                    <span>Bỏ qua Layer đang ẩn hoặc đóng băng (Hidden/Frozen)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-slate-300 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={skipLockedLayers}
                      onChange={e => setSkipLockedLayers(e.target.checked)}
                    />
                    <span>Bỏ qua Layer đang khóa (Locked layers)</span>
                  </label>
                </div>
              </div>

              {/* Saved local CAD drawings */}
              {savedDocs.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-slate-300">
                    <History className="h-4 w-4 text-cyan-400" />
                    Bản vẽ AutoCAD đã lưu gần đây (IndexedDB)
                  </div>
                  <div className="divide-y divide-slate-800/80">
                    {savedDocs.slice(0, 6).map(item => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-2 text-xs"
                      >
                        <div className="min-w-0 pr-3">
                          <div className="truncate font-medium text-slate-100">{item.name}</div>
                          <div className="text-[11px] text-slate-400">
                            {item.acadVersion} • {item.entityCount.toLocaleString('vi-VN')} đối tượng •{' '}
                            {item.layerCount} lớp
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleOpenSaved(item.id)}
                            className="rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-cyan-300 hover:bg-slate-700"
                          >
                            Mở lại
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSaved(item.id)}
                            className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-400"
                            title="Xóa khỏi bộ nhớ cục bộ"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Parsing progress */}
          {isParsing && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-6 text-center">
              {parsingFileInfo && (
                <div className="mb-2 text-[11px] text-slate-400">
                  <span className="font-medium text-slate-200">{parsingFileInfo.name}</span> ({parsingFileInfo.sizeMB} MB)
                </div>
              )}
              <div className="mx-auto mb-3 h-3 w-full max-w-md overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-cyan-500 transition-all duration-150"
                  style={{ width: `${Math.max(4, Math.min(100, progressInfo.percent))}%` }}
                />
              </div>
              <p className="text-xs font-medium text-slate-200">
                {progressInfo.stageVi || 'Đang xử lý bản vẽ AutoCAD...'} ({progressInfo.percent}%)
              </p>
              {(progressInfo.entitiesParsed !== undefined || progressInfo.skippedCount !== undefined) && (
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-3 text-[11px] text-slate-400">
                  {progressInfo.pass && (
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-cyan-300">
                      Pass {progressInfo.pass}/2
                    </span>
                  )}
                  <span>
                    Đã đọc:{' '}
                    <strong className="text-slate-100">
                      {(progressInfo.entitiesParsed ?? 0).toLocaleString('vi-VN')}
                    </strong>{' '}
                    đối tượng
                  </span>
                  {(progressInfo.skippedCount ?? 0) > 0 && (
                    <span>
                      Đã lọc rác/ẩn:{' '}
                      <strong className="text-amber-300">
                        {(progressInfo.skippedCount ?? 0).toLocaleString('vi-VN')}
                      </strong>
                    </span>
                  )}
                  {progressInfo.heapUsedMB !== undefined && progressInfo.heapLimitMB !== undefined && (
                    <span>
                      V8 Heap: {progressInfo.heapUsedMB}/{progressInfo.heapLimitMB} MB
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={handleCancelImport}
                className="mt-4 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Hủy xử lý
              </button>
            </div>
          )}

          {/* DWG Two-Tier Adapter View */}
          {pendingDwgFile && dwgInspection && !isParsing && (
            <div className="space-y-4 rounded-xl border border-amber-500/40 bg-amber-950/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-amber-200">
                    Cần chuyển đổi bổ sung cho tệp DWG ({dwgInspection.versionLabel || 'DWG'})
                  </h3>
                  <p className="mt-1 text-xs text-amber-100/80">
                    {dwgInspection.wasmErrorVi
                      ? dwgInspection.wasmErrorVi
                      : 'Bộ giải mã DWG ngoại tuyến chưa đọc trọn vẹn tệp này. Bạn có thể chuyển sang DXF cục bộ hoặc dùng Endpoint chuyển đổi nội bộ:'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetStaging}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Chọn tệp khác
                </button>
              </div>

              <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-200">
                {dwgInspection.guideStepsVi.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>

              <div className="border-t border-amber-500/20 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDwgBridgeConfig(v => !v)}
                    className="inline-flex items-center gap-2 text-xs font-medium text-cyan-300 hover:text-cyan-200"
                  >
                    <ServerCog className="h-4 w-4" />
                    {showDwgBridgeConfig
                      ? 'Ẩn cấu hình Bộ chuyển đổi DWG -> DXF (HTTP Bridge)'
                      : 'Cấu hình Bộ chuyển đổi DWG -> DXF tự động (Tùy chọn doanh nghiệp)'}
                  </button>
                  {dwgConfig.mode === 'http-converter' && (
                    <button
                      type="button"
                      onClick={handleResetDwgToWasm}
                      className="text-xs font-medium text-emerald-300 hover:underline"
                    >
                      Dùng lại giải mã ngoại tuyến LibreDWG WASM
                    </button>
                  )}
                </div>

                {showDwgBridgeConfig && (
                  <div className="mt-3 space-y-2.5 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
                    <div>
                      <label className="mb-1 block text-slate-400">
                        URL Dịch vụ chuyển đổi (HTTPS hoặc http://localhost)
                      </label>
                      <input
                        type="url"
                        value={dwgConfig.endpointUrl}
                        onChange={e =>
                          setDwgConfig({
                            ...dwgConfig,
                            mode: 'http-converter',
                            endpointUrl: e.target.value
                          })
                        }
                        placeholder="https://cad-bridge.company.local/convert-dwg-to-dxf"
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100 outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-slate-400">
                        Authorization Header (tùy chọn, lưu cục bộ trên trình duyệt)
                      </label>
                      <input
                        type="password"
                        value={dwgConfig.authHeader || ''}
                        onChange={e => setDwgConfig({ ...dwgConfig, authHeader: e.target.value })}
                        placeholder="Bearer ..."
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100 outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleSaveAndRetryDwg}
                        className="rounded-md bg-cyan-600 px-3 py-1.5 font-medium text-white hover:bg-cyan-500"
                      >
                        Lưu & Chuyển đổi DWG ngay
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Parsed DXF Preview, Diagnostics & Mode Selection */}
          {parsedDoc && importReport && !isParsing && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                {/* Preview */}
                <div className="lg:col-span-3 rounded-xl border border-slate-800 bg-slate-950 p-2.5">
                  {svgPreviewDataUrl && (
                    <img
                      src={svgPreviewDataUrl}
                      alt="Xem trước bản vẽ AutoCAD"
                      className="h-56 w-full rounded-lg object-contain bg-[#0b111e]"
                    />
                  )}
                </div>

                {/* Stats */}
                <div className="lg:col-span-2 flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Đọc thành công ({importReport.parseDurationMs} ms)
                    </div>
                    <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
                      <span className="text-slate-400">Tệp:</span>
                      <span className="truncate font-medium text-slate-200">{importReport.fileName}</span>
                      <span className="text-slate-400">Phiên bản:</span>
                      <span className="text-slate-200">{importReport.acadVersion}</span>
                      <span className="text-slate-400">Đơn vị ($INSUNITS):</span>
                      <span className="text-cyan-300">{importReport.unitLabelVi}</span>
                      <span className="text-slate-400">Số Layer / Block:</span>
                      <span className="text-slate-200">
                        {importReport.layerCount} / {importReport.blockCount}
                      </span>
                      <span className="text-slate-400">Đọc được / Tổng gặp:</span>
                      <span className="font-semibold text-white">
                        {importReport.readableCount.toLocaleString('vi-VN')} /{' '}
                        {importReport.totalEncounteredCount.toLocaleString('vi-VN')}
                      </span>
                      <span className="text-slate-400">Chỉnh sửa được:</span>
                      <span className="font-medium text-emerald-300">
                        {importReport.editableCount.toLocaleString('vi-VN')}
                      </span>
                      <span className="text-slate-400">Chỉ đọc:</span>
                      <span className="text-slate-200">
                        {importReport.readonlyCount.toLocaleString('vi-VN')}
                      </span>
                      <span className="text-slate-400">Không hỗ trợ:</span>
                      <span className="text-amber-300">
                        {importReport.unsupportedCount.toLocaleString('vi-VN')}
                        {importReport.unsupportedCount > 0 && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            ({importReport.unknownCount} giữ / {importReport.dwgUnsupportedCount} DWG bỏ)
                          </span>
                        )}
                      </span>
                      <span className="text-slate-400">Bị bỏ qua (lọc/ngưỡng):</span>
                      <span className={importReport.skippedCount > 0 ? 'text-cyan-300' : 'text-slate-400'}>
                        {importReport.skippedCount.toLocaleString('vi-VN')}
                        {importReport.skippedCount > 0 && Object.keys(importReport.skippedTypes).length > 0 && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            (
                            {Object.entries(importReport.skippedTypes)
                              .slice(0, 3)
                              .map(([t, c]) => `${t}:${c}`)
                              .join(', ')}
                            )
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetStaging}
                    className="mt-3 w-full rounded-md border border-slate-700 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    Chọn tệp khác
                  </button>
                </div>
              </div>

              {/* Warnings */}
              {importReport.warnings.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs">
                  {importReport.warnings.map((w, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <div>
                        <div>{w.messageVi}</div>
                        {w.remediationVi && (
                          <div className="text-[11px] text-amber-300/75">{w.remediationVi}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Import mode choices */}
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setImportMode('full-edit')}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    importMode === 'full-edit'
                      ? 'border-cyan-500 bg-cyan-950/40'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Pencil className="h-3.5 w-3.5 text-cyan-400" />
                    Mở chỉnh sửa đầy đủ
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Nạp toàn bộ Layer, Block & đối tượng vào AutoCAD Studio để sửa & xuất Round-trip.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setImportMode('filter-layers')}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    importMode === 'filter-layers'
                      ? 'border-cyan-500 bg-cyan-950/40'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Layers className="h-3.5 w-3.5 text-emerald-400" />
                    Lọc chọn Layer
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Chỉ giữ các lớp cần dùng; tự động bảo toàn định nghĩa Block liên quan.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setImportMode('locked-underlay')}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    importMode === 'locked-underlay'
                      ? 'border-cyan-500 bg-cyan-950/40'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Lock className="h-3.5 w-3.5 text-amber-400" />
                    Khóa làm Nền Mạng 2D/3D
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Khóa toàn bộ lớp CAD để đặt tủ Rack, Switch, Camera, Cáp lên trên.
                  </p>
                </button>
              </div>

              {/* Layer Filter list */}
              {importMode === 'filter-layers' && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={layerSearch}
                      onChange={e => setLayerSearch(e.target.value)}
                      placeholder="Tìm tên Layer..."
                      className="w-56 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 outline-none focus:border-cyan-500"
                    />
                    <div className="flex gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setSelectedLayers(new Set(Object.keys(parsedDoc.layers)))}
                        className="text-cyan-400 hover:underline"
                      >
                        Chọn tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLayers(new Set(['0']))}
                        className="text-slate-400 hover:underline"
                      >
                        Chỉ giữ lớp 0
                      </button>
                    </div>
                  </div>
                  <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
                    {filteredLayerList.map(layer => {
                      const checked = selectedLayers.has(layer.name) || layer.name === '0';
                      return (
                        <label
                          key={layer.name}
                          className="flex cursor-pointer items-center gap-2 rounded border border-slate-800/80 bg-slate-900/60 px-2 py-1 text-[11px]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={layer.name === '0'}
                            onChange={e => {
                              const next = new Set(selectedLayers);
                              if (e.target.checked) next.add(layer.name);
                              else next.delete(layer.name);
                              setSelectedLayers(next);
                            }}
                          />
                          <span className="truncate text-slate-200">{layer.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/95 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            Hủy
          </button>
          {parsedDoc && (
            <button
              type="button"
              onClick={handleConfirmOpen}
              className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500"
            >
              {importMode === 'locked-underlay'
                ? 'Áp dụng làm Nền Mạng 2D/3D'
                : 'Mở trong AutoCAD Studio'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
