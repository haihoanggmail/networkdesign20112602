import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ProjectState, DeviceAsset, DiagramNode, ServerRack, DesignMode } from '../../types/infrastructure';
import {
  X,
  Download,
  Image,
  FileCode,
  Printer,
  Table,
  Upload,
  Check,
  FileSpreadsheet,
  AlertCircle,
  FileText,
  Compass,
  Globe,
  Loader2,
  FileDown,
  Archive,
  ClipboardList,
  GitFork,
  Cuboid,
  FolderUp
} from 'lucide-react';
import { migrateAndValidateProject } from '../../utils/projectStorage';
import { createProjectPackage } from '../../utils/projectPackage';
import { getRackStatistics, getAssetUHeight } from '../../utils/rackGeometry';
import { exportProjectBomCsv } from '../../utils/bomCsvExporter';
import { computeProjectCableSummary } from '../../utils/cableRouting';
import { computePureDiagramBounds } from '../../utils/svgExport';
import { computeA4ScaleMetrics, DEFAULT_PDF_MARGINS_MM, normalizePdfMargins } from '../../utils/pdfScale';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { trackExport } from '../../services/tracker';
import type {
  CameraPresetId,
  Capture3DBackground,
  Capture3DRequestOptions,
  Capture3DResult
} from '../../contexts/ViewportContext';
import { generate2DSvgString } from '../../services/export/capture2D';
import {
  CAMERA_PRESET_LABELS,
  ExportContentScope,
  ExportProgressEvent,
  ExportScopeMode,
  ExportService,
  PdfMarginsMm
} from '../../services/export/exportService';
import type { CADDocument } from '../../cad/core/CADTypes';
import { buildSafeCadExportFileName, cadExportService } from '../../cad/export/CADExportService';
import {
  downloadTemplatePackageZipWithSnapshot,
  slugifyTemplateId
} from '../../services/templateLibrary';

const TEMPLATE_MODE_CATEGORY: Record<DesignMode, string> = {
  topology: 'Mạng LAN',
  floorplan: 'Mặt bằng',
  rack: 'Rack',
  cctv: 'Camera',
  wifi: 'Wi-Fi',
  fiber: 'Cáp quang',
  electrical: 'Điện kỹ thuật',
  multisite: 'Đa chi nhánh'
};

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1';
export type PrintOrientation = 'landscape' | 'portrait';
export type PrintScaleMode = 'fit' | 'tile2x2';
export type ExportCategoryTab = 'drawings' | 'bom' | 'report' | 'handover';

interface ExportModalProps {
  project: ProjectState;
  isOpen: boolean;
  is3DView?: boolean;
  isCapturing3D?: boolean;
  onCapture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
  onClose: () => void;
  onLoadProjectJson: (jsonState: ProjectState) => void;
  onRequestPackageImport?: (file: File) => Promise<void> | void;
  onOpenBomModal?: () => void;
  onAfterExportRouterTree?: () => void;
  onMergeExcelDevices?: (data: {
    newAssets: Record<string, DeviceAsset>;
    newNodes: DiagramNode[];
    updatedRacks: ServerRack[];
    importedCount?: number;
  }) => void;
  cadDocument?: CADDocument | null;
  workspaceMode?: 'network' | 'cad';
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  isOpen,
  is3DView = false,
  isCapturing3D = false,
  onCapture3D,
  onClose,
  onLoadProjectJson,
  onRequestPackageImport,
  onOpenBomModal,
  onAfterExportRouterTree,
  onMergeExcelDevices,
  cadDocument,
  workspaceMode = 'network'
}) => {
  const [statusBanner, setStatusBanner] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  // UX #7: 4 clear export categories & floor scope
  const [activeCategoryTab, setActiveCategoryTab] = useState<ExportCategoryTab>('drawings');
  const [floorScope, setFloorScope] = useState<string>(
    project.floors.length > 1 ? 'all' : project.activeFloorId || 'all'
  );
  const [exportScopeMode, setExportScopeMode] = useState<ExportScopeMode>(
    cadDocument && workspaceMode === 'cad' ? 'drawing_and_cad' : 'drawing_only'
  );

  // Content Scope & 3D Export Settings
  const [contentScope, setContentScope] = useState<ExportContentScope>(is3DView ? '3d' : '2d');
  const [background3D, setBackground3D] = useState<Capture3DBackground>('light');
  const [selected3DAngles, setSelected3DAngles] = useState<CameraPresetId[]>(['iso']);

  // PDF / Technical Print Settings & CAD Title Block
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<PrintOrientation>('landscape');
  const [autoFitPdf, setAutoFitPdf] = useState<boolean>(true);
  const [pdfMargins, setPdfMargins] = useState<PdfMarginsMm>(() => ({ ...DEFAULT_PDF_MARGINS_MM }));
  const [exportProgress, setExportProgress] = useState<ExportProgressEvent | null>(null);
  const [scaleMode, setScaleMode] = useState<PrintScaleMode>('fit');
  const [drawingCode, setDrawingCode] = useState('NET-ELV-01');
  const [drawingScale, setDrawingScale] = useState('1:100 / NTS');
  const [includeDiagram, setIncludeDiagram] = useState(true);
  const [includeLegendPanel, setIncludeLegendPanel] = useState(true);
  const [includeRackElevation, setIncludeRackElevation] = useState(true);
  const [includeTables, setIncludeTables] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingCadPdf, setIsExportingCadPdf] = useState(false);
  const [isExportingBundle, setIsExportingBundle] = useState(false);
  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const [isExportingTemplate, setIsExportingTemplate] = useState(false);
  const [pkgIncludeRevisions, setPkgIncludeRevisions] = useState(true);
  const [pkgIncludeCustomLibrary, setPkgIncludeCustomLibrary] = useState(true);
  const [svgTileBlobUrls, setSvgTileBlobUrls] = useState<Array<{ label: string; blobUrl: string }>>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const progressResetTimerRef = useRef<number | null>(null);

  useFocusTrap(dialogRef, isOpen && !isPrinting, onClose);

  const updatePdfMargin = (side: keyof PdfMarginsMm, rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    setPdfMargins(prev => normalizePdfMargins({ ...prev, [side]: parsed }, prev));
  };

  const clearProgressTimer = useCallback(() => {
    if (progressResetTimerRef.current !== null) {
      window.clearTimeout(progressResetTimerRef.current);
      progressResetTimerRef.current = null;
    }
  }, []);

  const beginExportProgress = useCallback(
    (stage: string) => {
      clearProgressTimer();
      setExportProgress({ percent: 2, stage });
    },
    [clearProgressTimer]
  );

  const endExportProgress = useCallback(
    (succeeded: boolean) => {
      clearProgressTimer();
      if (!succeeded) {
        setExportProgress(null);
        return;
      }
      progressResetTimerRef.current = window.setTimeout(() => {
        setExportProgress(null);
        progressResetTimerRef.current = null;
      }, 1400);
    },
    [clearProgressTimer]
  );

  useEffect(() => {
    if (isOpen) {
      setActiveCategoryTab('drawings');
      setFloorScope(project.floors.length > 1 ? 'all' : project.activeFloorId || 'all');
      setContentScope(is3DView ? '3d' : '2d');
      setBackground3D(project.settings?.isDarkMode ? 'dark' : 'light');
      setExportScopeMode(cadDocument && workspaceMode === 'cad' ? 'drawing_and_cad' : 'drawing_only');
      setStatusBanner(null);
      clearProgressTimer();
      setExportProgress(null);
    }
  }, [
    isOpen,
    is3DView,
    workspaceMode,
    cadDocument,
    project.settings?.isDarkMode,
    project.floors.length,
    project.activeFloorId,
    clearProgressTimer
  ]);

  const includeCadInOutputs = Boolean(cadDocument && exportScopeMode === 'drawing_and_cad');

  const toggle3DAngle = (preset: CameraPresetId) => {
    setSelected3DAngles(prev => {
      if (prev.includes(preset)) {
        return prev.length > 1 ? prev.filter(p => p !== preset) : prev;
      }
      return [...prev, preset];
    });
  };

  const revokeTileUrls = useCallback((tiles: Array<{ label: string; blobUrl: string }>) => {
    const urlApi = window.URL || window.webkitURL;
    tiles.forEach(t => {
      try {
        urlApi.revokeObjectURL(t.blobUrl);
      } catch {
        // ignore
      }
    });
  }, []);

  const bounds = useMemo(
    () =>
      computePureDiagramBounds(
        project,
        floorScope !== 'all' ? { floorScopeId: floorScope } : undefined
      ),
    [project, floorScope]
  );
  const a4ScalePreview = useMemo(
    () =>
      computeA4ScaleMetrics(bounds, project.settings.scale, orientation, {
        includeLegendPanel,
        paperSize,
        autoFit: autoFitPdf,
        margins: pdfMargins
      }),
    [bounds, project.settings.scale, orientation, includeLegendPanel, paperSize, autoFitPdf, pdfMargins]
  );
  const previewSvgDataUrl = useMemo(() => {
    if (!isOpen || contentScope === '3d') return '';
    try {
      const svgMarkup = generate2DSvgString(project, {
        darkTheme: project.settings.isDarkMode,
        includeTitleBlock: false,
        floorScope
      });
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    } catch {
      return '';
    }
  }, [isOpen, contentScope, project, floorScope]);
  const selectedFloorSummary = useMemo(() => {
    if (floorScope === 'all') {
      return `Toàn bộ tòa nhà (${project.floors.length} tầng)`;
    }
    return project.floors.find(f => f.id === floorScope)?.name || 'Tầng đang chọn';
  }, [floorScope, project.floors]);

  useEffect(() => {
    if (!isPrinting) return;

    const handleAfterPrint = () => {
      document.body.classList.remove('hachihi-printing');
      const existingStyle = document.getElementById('hachihi-dynamic-page-style');
      if (existingStyle) existingStyle.remove();
      setIsPrinting(false);
      setSvgTileBlobUrls(prev => {
        revokeTileUrls(prev);
        return [];
      });
    };

    window.addEventListener('afterprint', handleAfterPrint);
    const timer = window.setTimeout(() => {
      window.print();
    }, 140);

    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      window.clearTimeout(timer);
    };
  }, [isPrinting, revokeTileUrls]);

  // Safety cleanup if component unmounts mid-print
  useEffect(() => {
    return () => {
      clearProgressTimer();
      document.body.classList.remove('hachihi-printing');
      const existingStyle = document.getElementById('hachihi-dynamic-page-style');
      if (existingStyle) existingStyle.remove();
      setSvgTileBlobUrls(prev => {
        revokeTileUrls(prev);
        return [];
      });
    };
  }, [revokeTileUrls, clearProgressTimer]);

  if (!isOpen && !isPrinting) return null;

  // 1. Export High-Res PNG (2D Vector SVG, 3D WebGL Capture, or Both) via ExportService
  const handleExportPng = async () => {
    if (isExportingPng || isCapturing3D) return;
    setIsExportingPng(true);
    setStatusBanner({
      type: 'info',
      text:
        contentScope === '3d'
          ? 'Đang chụp ảnh mô hình 3D WebGL độ phân giải cao...'
          : contentScope === 'both'
          ? 'Đang kết xuất ảnh PNG 2D CAD và mô hình 3D...'
          : 'Đang kết xuất ảnh PNG 2D độ phân giải cao...'
    });
    try {
      const result = await ExportService.exportPng(project, {
        contentScope,
        floorScope,
        background3D,
        capture3D: onCapture3D
      });
      setStatusBanner({
        type: 'success',
        text: `Đã xuất ${result.exportedFiles.length} tệp ảnh PNG (${result.exportedFiles.join(', ')}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsExportingPng(false);
    }
  };

  // 2. Export Pure Vector SVG (2D CAD only)
  const handleExportSvg = async () => {
    try {
      const res = await ExportService.exportSvg(project, contentScope, floorScope);
      setStatusBanner({ type: 'success', text: `Đã xuất Vector SVG chuẩn CAD (${res.filename}) thành công!` });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2b. Export AutoCAD DXF (Design only or Combined CAD + Design depending on exportScopeMode)
  const handleExportDxf = async () => {
    try {
      const res = await ExportService.exportDxf(project, contentScope, floorScope, {
        includeCad: includeCadInOutputs,
        cadDocument
      });
      setStatusBanner({
        type: 'success',
        text: includeCadInOutputs
          ? `Đã xuất AutoCAD DXF gộp Bản vẽ & CAD (${res.filename}) thành công!`
          : `Đã xuất tệp AutoCAD DXF đa lớp (${res.filename}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2b-1. Export Round-trip AutoCAD DXF preserving original handles & unknown entities
  const handleExportCadRoundTripDxf = () => {
    if (!cadDocument) return;
    try {
      cadExportService.downloadRoundTripDxf(cadDocument);
      const filename = buildSafeCadExportFileName(cadDocument.name, '_roundtrip', 'dxf');
      setStatusBanner({
        type: 'success',
        text: `Đã xuất bản vẽ AutoCAD Round-trip (${filename}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2b-1b. Export Clean AC1015 DXF
  const handleExportCadCleanDxf = () => {
    if (!cadDocument) return;
    try {
      cadExportService.downloadCleanDxf(cadDocument);
      const filename = buildSafeCadExportFileName(cadDocument.name, '_clean', 'dxf');
      setStatusBanner({
        type: 'success',
        text: `Đã xuất tệp AutoCAD DXF AC1015 (${filename}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2b-2. Export Combined CAD Underlay + HACHIHI Network Overlay DXF
  const handleExportCombinedCadNetworkDxf = () => {
    if (!cadDocument) return;
    try {
      cadExportService.downloadCombinedDxf(cadDocument, project, { floorScope });
      const filename = buildSafeCadExportFileName(`${cadDocument.name}_${project.name}`, '_combined', 'dxf');
      setStatusBanner({
        type: 'success',
        text: `Đã xuất bản vẽ gộp AutoCAD + Hạ tầng mạng (${filename}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2b-3. Export CAD Studio SVG, HTML & PDF (A4/A3/auto-fit)
  const handleExportCadSvg = () => {
    if (!cadDocument) return;
    try {
      cadExportService.downloadSvg(cadDocument);
      const filename = buildSafeCadExportFileName(cadDocument.name, '', 'svg');
      setStatusBanner({
        type: 'success',
        text: `Đã xuất Vector CAD SVG (${filename}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleExportCadHtml = () => {
    if (!cadDocument) return;
    try {
      const useLight = background3D !== 'dark';
      cadExportService.downloadHtml(cadDocument, { lightBackground: useLight });
      const filename = buildSafeCadExportFileName(cadDocument.name, '_viewer', 'html');
      setStatusBanner({
        type: 'success',
        text: `Đã xuất trình xem CAD HTML tương tác (${filename}) — tự động canh vừa khung!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleExportCadPdf = async (targetSize: PaperSize = paperSize, useAutoOrientation = false) => {
    if (!cadDocument || isExportingCadPdf) return;
    setIsExportingCadPdf(true);
    beginExportProgress(`Đang chuẩn bị kết xuất bản vẽ CAD ra PDF ${targetSize}...`);
    setStatusBanner({
      type: 'info',
      text: `Đang kết xuất bản vẽ CAD Studio ra PDF khổ ${targetSize} (tự động canh giữa vừa giấy)...`
    });
    let succeeded = false;
    try {
      const artifact = await cadExportService.downloadPdf(cadDocument, {
        paperSize: targetSize,
        orientation: useAutoOrientation ? 'auto' : orientation,
        autoFit: autoFitPdf,
        margins: pdfMargins,
        lightBackground: true,
        drawingCode,
        drawingScale,
        onProgress: p => setExportProgress(p)
      });
      succeeded = true;
      setExportProgress({ percent: 100, stage: `Hoàn tất xuất PDF CAD ${targetSize}` });
      setStatusBanner({
        type: 'success',
        text: `Đã xuất bản vẽ CAD PDF ${targetSize} (${artifact.filename}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsExportingCadPdf(false);
      endExportProgress(succeeded);
    }
  };

  // 2c. Export Standalone Offline Interactive HTML Viewer (3D WebGL + 2D CAD + BOM)
  const handleExportHtmlViewer = async () => {
    try {
      const res = await ExportService.exportHtmlViewer(project, {
        contentScope,
        background3D,
        floorScope
      });
      const scopeLabel =
        contentScope === '3d'
          ? '3D WebGL xoay 360° đa hướng'
          : contentScope === 'both'
          ? '3D WebGL + Sơ đồ 2D & BOM'
          : 'Sơ đồ 2D + 3D WebGL & BOM';
      setStatusBanner({
        type: 'success',
        text: `Đã xuất trình xem HTML độc lập ${scopeLabel} (${res.filename}) — mở trực tiếp bằng trình duyệt, không cần cài phần mềm!`
      });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2d. Export BOM CSV (Assets, Cable Lengths, & Rack Components)
  const handleExportBomCsv = () => {
    try {
      const { filename, summary } = exportProjectBomCsv(project);
      setStatusBanner({
        type: 'success',
        text: `Đã xuất ${filename} (${summary.assetCount} thiết bị, ${summary.totalCableMeters}m cáp, ${summary.rackComponentCount} thành phần Rack)!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: `Lỗi xuất BOM CSV: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  };

  // 3. Handle Excel Import
  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatusBanner({ type: 'info', text: 'Đang đọc dữ liệu Excel...' });
      const { parseExcelDevices } = await import('../../utils/excelService');
      const result = await parseExcelDevices(file, project);
      if (onMergeExcelDevices) {
        onMergeExcelDevices(result);
        const count = result.importedCount ?? Object.keys(result.newAssets).length;
        setStatusBanner({ type: 'success', text: `Đã nhập thành công ${count} thiết bị từ Excel!` });
        setTimeout(() => {
          setStatusBanner(null);
          onClose();
        }, 1200);
      }
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: `Lỗi nhập Excel: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      e.target.value = '';
    }
  };

  // 4. Export Self-Contained Project Package (.hachihi.json)
  const handleExportPackage = async () => {
    if (isExportingPackage) return;
    setIsExportingPackage(true);
    setStatusBanner({
      type: 'info',
      text: 'Đang đóng gói Gói dự án (.hachihi.json), nhúng tài nguyên ảnh & tạo mã SHA-256...'
    });
    try {
      const { pkg, jsonString, warnings } = await createProjectPackage(project, {
        includeRevisions: pkgIncludeRevisions,
        includeFullCustomLibrary: pkgIncludeCustomLibrary,
        embedExternalImages: true
      });
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name.replace(/\s+/g, '_')}.hachihi.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      trackExport('project_package');

      const extras: string[] = [];
      if (pkg.manifest.counts.embeddedImages > 0) extras.push(`${pkg.manifest.counts.embeddedImages} ảnh nhúng`);
      if (pkg.manifest.counts.customDevices > 0) extras.push(`${pkg.manifest.counts.customDevices} TB tùy chỉnh`);
      if (pkg.manifest.counts.revisions > 0) extras.push(`${pkg.manifest.counts.revisions} mốc phiên bản`);
      const extrasText = extras.length > 0 ? ` (${extras.join(', ')})` : '';
      const warnText = warnings.length > 0 ? ` · Lưu ý: ${warnings[0]}` : '';
      setStatusBanner({
        type: 'success',
        text: `Đã xuất Gói dự án .hachihi.json kèm mã SHA-256${extrasText}!${warnText}`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: `Lỗi xuất Gói dự án: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsExportingPackage(false);
    }
  };

  // 5. Import Package (.hachihi.json) or JSON (routes to preview modal when available)
  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const { checkImportPayloadSize, MAX_IMPORT_JSON_BYTES } = await import('../../utils/security');
    const sizeCheck = checkImportPayloadSize(file, MAX_IMPORT_JSON_BYTES, file.name);
    if (!sizeCheck.ok) {
      setStatusBanner({ type: 'error', text: sizeCheck.error });
      return;
    }

    if (onRequestPackageImport) {
      onClose();
      await onRequestPackageImport(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed: unknown = JSON.parse(ev.target?.result as string);
        const migrated = migrateAndValidateProject(parsed);
        if (!migrated.ok) {
          setStatusBanner({ type: 'error', text: migrated.error });
          return;
        }
        onLoadProjectJson(migrated.project);
        const warnText = migrated.warnings.length > 0 ? ` (${migrated.warnings.join('; ')})` : '';
        setStatusBanner({ type: 'success', text: `Khôi phục dự án thành công!${warnText}` });
        setTimeout(() => {
          setStatusBanner(null);
          onClose();
        }, 900);
      } catch (err: unknown) {
        setStatusBanner({ type: 'error', text: `Lỗi đọc tệp JSON: ${err instanceof Error ? err.message : String(err)}` });
      }
    };
    reader.readAsText(file);
  };

  // 6. Export Technical PDF (A4-A1, supports 2D, 3D multi-angle, Auto-Fit, Custom Margins & optional CAD page)
  const handleExportTechnicalPdf = async () => {
    if (isExportingPdf || isCapturing3D) return;
    setIsExportingPdf(true);
    beginExportProgress(`Đang chuẩn bị kết xuất PDF ${paperSize}...`);
    setStatusBanner({
      type: 'info',
      text: includeCadInOutputs
        ? `Đang kết xuất PDF ${paperSize} gộp Bản vẽ thiết kế & CAD Studio (${autoFitPdf ? 'Auto-Fit vừa giấy' : 'theo tỷ lệ'})...`
        : contentScope === '2d'
        ? `Đang kết xuất bản vẽ kỹ thuật PDF ${paperSize} (${autoFitPdf ? 'Auto-Fit vừa giấy' : 'theo tỷ lệ'})...`
        : `Đang chụp góc nhìn 3D và đóng gói bản vẽ PDF ${paperSize}...`
    });
    let succeeded = false;
    try {
      const result = await ExportService.exportPdf(project, {
        contentScope,
        floorScope,
        paperSize,
        orientation,
        autoFit: autoFitPdf,
        margins: pdfMargins,
        drawingCode,
        drawingScale,
        includeDiagram,
        includeLegendPanel,
        includeRackElevation,
        includeTables,
        includeCad: includeCadInOutputs,
        cadDocument,
        background3D,
        cameraAngles3D: selected3DAngles,
        capture3D: onCapture3D,
        onProgress: p => setExportProgress(p)
      });
      succeeded = true;
      setExportProgress({
        percent: 100,
        stage: `Hoàn tất xuất PDF ${paperSize}`,
        currentPage: result.pageCount,
        totalPages: result.pageCount
      });
      setStatusBanner({
        type: 'success',
        text: `Đã xuất ${result.filename} (${result.pageCount} trang ${paperSize} · ${result.scaleMetrics.scaleRatioLabel})!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsExportingPdf(false);
      endExportProgress(succeeded);
    }
  };

  // 6b. 1-Click Unified Handover ZIP Bundle (adjusts structure based on Chỉ xuất bản vẽ vs Xuất cả bản vẽ & CAD)
  const handleExportHandoverBundle = async () => {
    if (isExportingBundle || isCapturing3D) return;
    setIsExportingBundle(true);
    beginExportProgress('Đang chuẩn bị đóng gói Gói Bàn Giao (.zip)...');
    setStatusBanner({
      type: 'info',
      text: includeCadInOutputs
        ? 'Đang đóng gói Gói Bàn Giao tổng hợp (Bản vẽ thiết kế + Bản vẽ CAD Studio .zip)...'
        : contentScope === '2d'
        ? 'Đang đóng gói Gói Bàn Giao Bản vẽ thiết kế (.zip)...'
        : 'Đang chụp ảnh 3D và đóng gói Gói Bàn Giao tổng hợp (.zip)...'
    });
    let succeeded = false;
    try {
      const res = await ExportService.exportBundle(project, {
        contentScope,
        floorScope,
        drawingCode,
        drawingScale,
        orientation,
        autoFit: autoFitPdf,
        margins: pdfMargins,
        includeLegendPanel,
        includeRackElevation,
        includeTables,
        includeCad: includeCadInOutputs,
        cadDocument,
        background3D,
        cameraAngles3D: selected3DAngles,
        capture3D: onCapture3D,
        onProgress: p => setExportProgress(p)
      });
      succeeded = true;
      setExportProgress({ percent: 100, stage: `Hoàn tất nén ${res.filename}` });
      const sizeKb = Math.max(1, Math.round(res.totalBytes / 1024));
      setStatusBanner({
        type: 'success',
        text: `Đã tạo ${res.filename} (${res.entries.length} tệp · ${sizeKb} KB)!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsExportingBundle(false);
      endExportProgress(succeeded);
    }
  };

  // 6c. Export active project state as reusable GitHub Template ZIP (project.json + template.json + snapshot image)
  const handleExportAsTemplate = async () => {
    if (isExportingTemplate) return;
    setIsExportingTemplate(true);
    beginExportProgress('Đang trích xuất project.json & tạo manifest template.json...');
    setStatusBanner({
      type: 'info',
      text: 'Đang dựng ảnh snapshot và đóng gói Template ZIP (project.json, template.json, snapshot)...'
    });
    let succeeded = false;
    try {
      const mode: DesignMode = project.activeMode || 'topology';
      const category = TEMPLATE_MODE_CATEGORY[mode] || 'Mạng LAN';
      const baseName = project.name?.trim() || 'HACHIHI Custom Template';
      setExportProgress({
        percent: 45,
        stage: 'Đang chụp ảnh snapshot & nén gói Template (.zip)...'
      });
      const pkg = await downloadTemplatePackageZipWithSnapshot(project, {
        slug: slugifyTemplateId(baseName),
        name: baseName,
        category,
        mode,
        badge: category,
        version: project.version || '1.0.0',
        author: project.author || 'HACHIHI',
        description: `Mẫu thiết kế ${baseName} gồm ${project.nodes.length} nút, ${Object.keys(project.assets).length} thiết bị, ${project.racks.length} tủ Rack và ${project.cables.length} tuyến cáp.`,
        highlights: [
          `${project.floors?.length || 1} tầng`,
          `${Object.keys(project.assets).length} thiết bị`,
          `${project.racks.length} tủ Rack`,
          `${project.cables.length} tuyến cáp`
        ],
        tags: [category, mode.toUpperCase(), 'HACHIHI']
      });
      succeeded = true;
      setExportProgress({ percent: 100, stage: `Hoàn tất đóng gói ${pkg.zipFilename}` });
      setStatusBanner({
        type: 'success',
        text: `Đã xuất ${pkg.zipFilename} (chứa project.json, template.json và ${pkg.previewFilename}). Giải nén vào public/templates/${pkg.slug}/ để cập nhật thư viện.`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsExportingTemplate(false);
      endExportProgress(succeeded);
    }
  };

  // Build Diagram Tiles for PDF Print
  const diagramTiles = (() => {
    if (scaleMode === 'fit') {
      return [
        {
          label: 'Toàn cảnh sơ đồ (Fit 1 trang)',
          viewBox: `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`
        }
      ];
    }
    const cols = 2;
    const rows = 2;
    const tileW = bounds.width / cols;
    const tileH = bounds.height / rows;
    const overlapX = tileW * 0.05;
    const overlapY = tileH * 0.05;
    const tiles: Array<{ label: string; viewBox: string }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const vx = bounds.minX + c * tileW - (c > 0 ? overlapX : 0);
        const vy = bounds.minY + r * tileH - (r > 0 ? overlapY : 0);
        const vw = tileW + overlapX;
        const vh = tileH + overlapY;
        tiles.push({
          label: `Mảnh ${r + 1}-${c + 1} (${cols}×${rows})`,
          viewBox: `${vx} ${vy} ${vw} ${vh}`
        });
      }
    }
    return tiles;
  })();

  // 7. Trigger Technical Multi-Page Browser Print (renders safe SVG Blob URLs inside <img>)
  const handleStartPdfPrint = () => {
    if (!includeDiagram && !includeRackElevation && !includeTables) {
      setStatusBanner({ type: 'error', text: 'Vui lòng chọn ít nhất một mục để xuất PDF.' });
      return;
    }

    const pureSvg = generate2DSvgString(project, {
      darkTheme: false,
      includeTitleBlock: false,
      floorScope
    });
    const urlApi = window.URL || window.webkitURL;
    const nextBlobTiles = diagramTiles.map(tile => {
      const tileSvg = pureSvg.replace(/viewBox="[^"]*"/i, `viewBox="${tile.viewBox}"`);
      const blob = new Blob([tileSvg], { type: 'image/svg+xml;charset=utf-8' });
      return {
        label: tile.label,
        blobUrl: urlApi.createObjectURL(blob)
      };
    });

    setSvgTileBlobUrls(prev => {
      revokeTileUrls(prev);
      return nextBlobTiles;
    });

    const existingStyle = document.getElementById('hachihi-dynamic-page-style');
    if (existingStyle) existingStyle.remove();

    const styleEl = document.createElement('style');
    styleEl.id = 'hachihi-dynamic-page-style';
    styleEl.textContent = `@page { size: ${paperSize} ${orientation}; margin: ${pdfMargins.top}mm ${pdfMargins.right}mm ${pdfMargins.bottom}mm ${pdfMargins.left}mm; }`;
    document.head.appendChild(styleEl);

    document.body.classList.add('hachihi-printing');
    setIsPrinting(true);
  };

  const allAssets = Object.values(project.assets);
  const bomCableSummary = useMemo(() => computeProjectCableSummary(project.cables || []), [project.cables]);
  const bomRackComponentCount = useMemo(
    () =>
      (project.racks || []).reduce((acc, r) => {
        const frontCount = Object.values(r.slots || {}).filter(id => Boolean(id && project.assets[id])).length;
        const rearCount = Object.values(r.rearSlots || {}).filter(id => Boolean(id && project.assets[id])).length;
        return acc + frontCount + rearCount;
      }, 0),
    [project.racks, project.assets]
  );

  return (
    <>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Xuất bản vẽ, PDF kỹ thuật và nhập xuất Excel"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print"
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="w-full h-dvh sm:h-auto sm:max-w-4xl sm:max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe outline-none"
          >
            {/* Header */}
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/50 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Download className="w-5 h-5 text-blue-600 shrink-0" />
                  <span>Xuất Bản Vẽ, PDF Kỹ Thuật & Nhập Xuất Excel</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Hỗ trợ Workbook Excel 6 sheet, In/Xuất PDF đa khổ giấy A4–A1, Ảnh PNG nét cao & Vector CAD SVG
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="export-modal-template-btn"
                  onClick={() => void handleExportAsTemplate()}
                  disabled={isExportingTemplate}
                  aria-busy={isExportingTemplate}
                  title="Đóng gói project.json, template.json và ảnh chụp snapshot thành file ZIP để thêm vào Thư viện Template"
                  className="px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-60 disabled:cursor-not-allowed text-emerald-700 dark:text-emerald-300 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  {isExportingTemplate ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <FolderUp className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{isExportingTemplate ? 'Đang xuất Template...' : 'Xuất thành Template'}</span>
                </button>
                <button
                  onClick={onClose}
                  aria-label="Đóng hộp thoại xuất bản vẽ"
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {statusBanner && (
              <div
                className={`px-6 py-2.5 border-b font-medium flex items-center gap-2 shrink-0 ${
                  statusBanner.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
                    : statusBanner.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                    : 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-300'
                }`}
              >
                {statusBanner.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <Check className="w-4 h-4 shrink-0" />
                )}
                <span>{statusBanner.text}</span>
              </div>
            )}

            {exportProgress && (
              <div
                data-testid="export-progress-banner"
                className="px-6 py-2.5 border-b border-blue-200 dark:border-blue-900/70 bg-blue-50/80 dark:bg-slate-800/90 shrink-0 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                  <div className="flex items-center gap-2 min-w-0">
                    {exportProgress.percent < 100 ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    <span className="truncate">{exportProgress.stage}</span>
                    {typeof exportProgress.currentPage === 'number' &&
                      typeof exportProgress.totalPages === 'number' &&
                      exportProgress.totalPages > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-[10px] font-mono shrink-0">
                          Trang {exportProgress.currentPage}/{exportProgress.totalPages}
                        </span>
                      )}
                  </div>
                  <span className="font-mono font-bold shrink-0">
                    {Math.max(0, Math.min(100, Math.round(exportProgress.percent)))}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-blue-100 dark:bg-slate-700 overflow-hidden">
                  <div
                    role="progressbar"
                    data-testid="export-progress-bar"
                    aria-label="Tiến độ xuất hồ sơ"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.max(0, Math.min(100, Math.round(exportProgress.percent)))}
                    className={`h-full transition-all duration-150 ease-out rounded-full ${
                      exportProgress.percent >= 100 ? 'bg-emerald-500' : 'bg-[#155EEF]'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, Math.round(exportProgress.percent)))}%` }}
                  />
                </div>
              </div>
            )}

            {/* 4-Group Navigation Tabs (Bản vẽ | Bảng vật tư | Báo cáo kỹ thuật | Hồ sơ bàn giao) */}
            <div className="px-4 sm:px-6 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
              <div
                role="tablist"
                aria-label="Nhóm hồ sơ xuất"
                className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl"
              >
                {(
                  [
                    { id: 'drawings', label: 'Bản vẽ', testId: 'export-tab-drawings' },
                    { id: 'bom', label: 'Bảng vật tư', testId: 'export-tab-bom' },
                    { id: 'report', label: 'Báo cáo kỹ thuật', testId: 'export-tab-report' },
                    { id: 'handover', label: 'Hồ sơ bàn giao', testId: 'export-tab-handover' }
                  ] as const
                ).map(tab => {
                  const selected = activeCategoryTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      data-testid={tab.testId}
                      aria-selected={selected}
                      onClick={() => setActiveCategoryTab(tab.id)}
                      className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        selected
                          ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
              {activeCategoryTab !== 'bom' && (
                <div
                  data-testid="export-structure-selector"
                  className="p-3.5 rounded-xl border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50/50 dark:bg-cyan-950/20 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Cấu trúc nội dung file xuất
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {cadDocument
                        ? exportScopeMode === 'drawing_and_cad'
                          ? `File xuất (PDF, DXF, Gói ZIP) sẽ gộp cả bản vẽ thiết kế & CAD Studio (${cadDocument.name})`
                          : 'Chỉ xuất bản vẽ thiết kế hạ tầng (không kèm dữ liệu CAD Studio)'
                        : 'Đang ở chế độ chỉ xuất bản vẽ thiết kế (nạp file DWG/DXF trong CAD Studio để mở tùy chọn gộp CAD)'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800 dark:text-slate-100 select-none">
                      <input
                        type="checkbox"
                        data-testid="export-toggle-design"
                        checked={exportScopeMode === 'drawing_only'}
                        onChange={e => {
                          if (e.target.checked) setExportScopeMode('drawing_only');
                          else if (cadDocument) setExportScopeMode('drawing_and_cad');
                        }}
                        className="w-4 h-4 rounded accent-[#155EEF]"
                      />
                      <span>Chỉ xuất bản vẽ</span>
                    </label>
                    <label
                      className={`flex items-center gap-2 text-xs font-semibold select-none ${
                        cadDocument
                          ? 'cursor-pointer text-cyan-700 dark:text-cyan-300'
                          : 'cursor-not-allowed text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-testid="export-toggle-cad"
                        disabled={!cadDocument}
                        checked={exportScopeMode === 'drawing_and_cad' && Boolean(cadDocument)}
                        onChange={e => {
                          if (!cadDocument) return;
                          setExportScopeMode(e.target.checked ? 'drawing_and_cad' : 'drawing_only');
                        }}
                        className="w-4 h-4 rounded accent-cyan-600 disabled:opacity-50"
                      />
                      <span>
                        Xuất cả bản vẽ &amp; CAD
                        {!cadDocument ? ' (Chưa nạp CAD)' : ''}
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {activeCategoryTab === 'drawings' && (
                <>
                  {/* Content Scope & Floor Scope Controls */}
                      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <Cuboid className="w-4 h-4 text-[#155EEF]" />
                              <span>Phạm vi nội dung xuất (Content Scope)</span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Chọn xuất bản vẽ thiết kế 2D, mô hình không gian 3D WebGL hoặc gộp cả hai
                            </p>
                          </div>
                          <div
                            role="group"
                            aria-label="Chọn phạm vi xuất dữ liệu"
                            className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 gap-0.5"
                          >
                            {(
                              [
                                { id: '2d', label: 'Bản vẽ 2D' },
                                { id: '3d', label: 'Mô hình 3D' },
                                { id: 'both', label: 'Cả 2D và 3D' }
                              ] as const
                            ).map(opt => (
                              <button
                                key={opt.id}
                                type="button"
                                data-testid={`export-scope-${opt.id}`}
                                onClick={() => setContentScope(opt.id)}
                                aria-pressed={contentScope === opt.id}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                                  contentScope === opt.id
                                    ? 'bg-[#155EEF] text-white shadow-2xs'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Multi-floor Selector */}
                        {project.floors.length > 1 && (
                          <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <label
                                htmlFor="export-floor-scope"
                                className="text-xs font-bold text-slate-800 dark:text-slate-200 block"
                              >
                                Phạm vi tầng tòa nhà ({project.floors.length} tầng)
                              </label>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                HTML Độc Lập luôn giữ thanh chuyển tầng tương tác; ảnh PNG/SVG/DXF kết xuất theo tầng đã chọn
                              </p>
                            </div>
                            <select
                              id="export-floor-scope"
                              data-testid="export-floor-scope"
                              value={floorScope}
                              onChange={e => setFloorScope(e.target.value)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-100 min-w-[200px]"
                            >
                              <option value="all">Toàn bộ tòa nhà ({project.floors.length} tầng)</option>
                              {[...project.floors]
                                .sort((a, b) => a.level - b.level)
                                .map(fl => (
                                  <option key={fl.id} value={fl.id}>
                                    {fl.name} (Tầng {fl.level})
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}

                        {contentScope !== '2d' && (
                          <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-700/70 space-y-2.5">
                            {!is3DView && (
                              <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-200 text-[11px] font-medium flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span>
                                  Hiện bạn đang ở chế độ 2D. Để chụp &amp; xuất hình 3D WebGL sắc nét, hãy chuyển sang chế độ 3D trước khi bấm xuất (hệ thống không thay thế bằng hình 2D).
                                </span>
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                                  Nền kết xuất 3D
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setBackground3D('light')}
                                    className={`py-1.5 px-2 rounded-md border text-[11px] font-semibold transition-colors ${
                                      background3D === 'light'
                                        ? 'bg-[#155EEF] text-white border-[#155EEF]'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                                    }`}
                                  >
                                    Nền sáng (Chuẩn in)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBackground3D('dark')}
                                    className={`py-1.5 px-2 rounded-md border text-[11px] font-semibold transition-colors ${
                                      background3D === 'dark'
                                        ? 'bg-[#155EEF] text-white border-[#155EEF]'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                                    }`}
                                  >
                                    Nền tối (Studio)
                                  </button>
                                </div>
                              </div>

                              <div>
                                <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                                  Góc camera 3D xuất PDF / ZIP
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {(['iso', 'top', 'front', 'side'] as CameraPresetId[]).map(preset => {
                                    const checked = selected3DAngles.includes(preset);
                                    return (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() => toggle3DAngle(preset)}
                                        aria-pressed={checked}
                                        title={CAMERA_PRESET_LABELS[preset]}
                                        className={`px-2 py-1 rounded-md border text-[11px] font-semibold transition-colors ${
                                          checked
                                            ? 'bg-blue-50 dark:bg-blue-950/60 border-[#155EEF] text-[#155EEF] dark:text-blue-300'
                                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                        }`}
                                      >
                                        {preset === 'iso'
                                          ? 'Isometric'
                                          : preset === 'top'
                                          ? 'Trên xuống'
                                          : preset === 'front'
                                          ? 'Trực diện'
                                          : 'Bên hông'}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Live Preview Card before Exporting */}
                      <div
                        data-testid="export-preview-card"
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 overflow-hidden"
                      >
                        <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900/70">
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                            Xem trước trước khi xuất · {selectedFloorSummary}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {allAssets.length} TB · {project.cables.length} Cáp · {project.rooms.length} Phòng
                          </span>
                        </div>
                        {contentScope === '3d' ? (
                          <div className="p-4 flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                            <Cuboid className="w-5 h-5 text-[#155EEF] shrink-0" />
                            <span>
                              Chế độ 3D sẽ chụp trực tiếp từ WebGL Three.js ({background3D === 'light' ? 'nền sáng chuẩn in' : 'nền tối Studio'}) hoặc đóng gói cảnh 3D xoay 360° tương tác vào HTML Độc Lập.
                            </span>
                          </div>
                        ) : previewSvgDataUrl ? (
                          <div className="p-3 bg-white dark:bg-slate-950 flex items-center justify-center">
                            <img
                              data-testid="export-preview-img"
                              src={previewSvgDataUrl}
                              referrerPolicy="no-referrer"
                              alt={`Xem trước bản vẽ ${selectedFloorSummary}`}
                              className="w-full max-h-44 object-contain rounded border border-slate-100 dark:border-slate-800"
                            />
                          </div>
                        ) : (
                          <div className="p-4 text-center text-xs text-slate-400">
                            Chưa có đối tượng để hiển thị xem trước trên bản vẽ hiện tại.
                          </div>
                        )}
                      </div>

                      {/* Design Drawing Export Format Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {/* PNG */}
                        <button
                          type="button"
                          onClick={() => void handleExportPng()}
                          disabled={isExportingPng || isCapturing3D}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-slate-50/50 hover:bg-blue-50/30 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3 text-left disabled:opacity-50 disabled:cursor-wait"
                        >
                          <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
                            {isExportingPng ? <Loader2 className="w-5 h-5 animate-spin" /> : <Image className="w-5 h-5" />}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-slate-900 dark:text-white">
                              {contentScope === '3d'
                                ? 'Ảnh PNG Mô Hình 3D Nét Cao'
                                : contentScope === 'both'
                                ? 'Ảnh PNG (2D Thiết kế + Mô Hình 3D)'
                                : 'Ảnh PNG Toàn Cảnh Nét Cao'}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {contentScope === '3d'
                                ? `Kết xuất trực tiếp từ Three.js WebGL (${background3D === 'light' ? 'nền trắng chuẩn in' : 'nền tối Studio'})`
                                : contentScope === 'both'
                                ? 'Tải cả ảnh vector 2D 2x và ảnh chụp WebGL 3D hiện tại'
                                : `Kết xuất vector thuần độ phân giải 2x (${selectedFloorSummary})`}
                            </div>
                            <div className="text-[10px] text-blue-600 font-semibold mt-1.5">
                              {isExportingPng ? 'Đang kết xuất PNG...' : 'Tải file PNG →'}
                            </div>
                          </div>
                        </button>

                        {/* Vector SVG */}
                        <button
                          type="button"
                          disabled={contentScope === '3d'}
                          onClick={handleExportSvg}
                          title={contentScope === '3d' ? 'Vector SVG chỉ hỗ trợ bản vẽ 2D' : 'Tải Vector SVG chuẩn kỹ thuật'}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-slate-50/50 hover:bg-blue-50/30 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3 text-left disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:border-slate-200"
                        >
                          <div className="w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-600 flex items-center justify-center shrink-0">
                            <FileCode className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-sm text-slate-900 dark:text-white">Vector SVG Chuẩn Kỹ Thuật</span>
                              {contentScope === '3d' && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                                  Chỉ 2D
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              Định dạng vector sắc nét vô hạn, tương thích Visio, Corel, Illustrator
                            </div>
                            <div className="text-[10px] text-sky-600 font-semibold mt-1.5">
                              {contentScope === '3d' ? 'Không áp dụng cho phạm vi 3D' : 'Tải file SVG →'}
                            </div>
                          </div>
                        </button>

                        {/* AutoCAD DXF (Network Design Only or Combined CAD + Network) */}
                        <button
                          type="button"
                          disabled={contentScope === '3d'}
                          onClick={handleExportDxf}
                          title={
                            contentScope === '3d'
                              ? 'AutoCAD DXF chỉ hỗ trợ bản vẽ 2D'
                              : includeCadInOutputs
                              ? 'Tải AutoCAD DXF gộp bản vẽ CAD nền + hạ tầng mạng'
                              : 'Tải AutoCAD DXF đa lớp từ bản vẽ thiết kế'
                          }
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 bg-slate-50/50 hover:bg-indigo-50/30 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3 text-left disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:border-slate-200"
                        >
                          <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 flex items-center justify-center shrink-0">
                            <Compass className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-sm text-slate-900 dark:text-white">
                                {includeCadInOutputs ? 'AutoCAD DXF Gộp Bản Vẽ & CAD (.dxf)' : 'AutoCAD DXF Thiết Kế (.dxf)'}
                              </span>
                              {contentScope === '3d' && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                                  Chỉ 2D
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {includeCadInOutputs
                                ? 'Gộp toàn bộ thực thể CAD Studio nền với các lớp ROOMS, RACKS, DEVICES & CABLES'
                                : 'Xuất bản vẽ thiết kế hạ tầng tách lớp ROOMS, RACKS, DEVICES, CABLES & LABELS'}
                            </div>
                            <div className="text-[10px] text-indigo-600 font-semibold mt-1.5">
                              {contentScope === '3d'
                                ? 'Không áp dụng cho phạm vi 3D'
                                : includeCadInOutputs
                                ? 'Tải DXF Gộp Bản Vẽ + CAD →'
                                : 'Tải file AutoCAD DXF →'}
                            </div>
                          </div>
                        </button>

                        {/* Standalone Interactive HTML Viewer */}
                        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-teal-500 bg-slate-50/50 hover:bg-teal-50/30 dark:bg-slate-800/30 transition-all flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-600 flex items-center justify-center shrink-0">
                            <Globe className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-sm text-slate-900 dark:text-white">Trình Xem HTML Độc Lập (.html)</span>
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 shrink-0">
                                {contentScope === '3d' ? '3D Xoay 360°' : '2D + 3D WebGL'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              {contentScope === '3d'
                                ? 'Mô hình 3D WebGL xoay ngang dọc 360°, thanh chọn tầng tương tác & kiểm tra thiết bị offline'
                                : 'Giữ nguyên bố cục 2D + Mô hình 3D WebGL, thanh chuyển tầng tương tác & Dark Mode'}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
                              <div
                                role="group"
                                aria-label="Giao diện mặc định khi mở HTML"
                                className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 gap-0.5"
                              >
                                <button
                                  type="button"
                                  onClick={() => setBackground3D('light')}
                                  aria-pressed={background3D === 'light'}
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                    background3D === 'light'
                                      ? 'bg-teal-600 text-white'
                                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Mặc định Sáng
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setBackground3D('dark')}
                                  aria-pressed={background3D === 'dark'}
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                    background3D === 'dark'
                                      ? 'bg-slate-800 text-amber-300 dark:bg-teal-600 dark:text-white'
                                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Mặc định Tối
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={handleExportHtmlViewer}
                                aria-label={
                                  contentScope === '3d'
                                    ? 'Trình Xem HTML Độc Lập 3D'
                                    : 'Trình Xem HTML Độc Lập 2D và 3D'
                                }
                                title={
                                  contentScope === '3d'
                                    ? 'Tải trình xem HTML 3D tương tác: xoay ngang dọc 360°, thanh chọn tầng & xem thông số thiết bị offline'
                                    : 'Tải trình xem HTML độc lập gồm mô hình 3D WebGL xoay 360° + sơ đồ 2D đa tầng & bảng BOM'
                                }
                                className="px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                              >
                                {contentScope === '3d' ? 'Tải HTML 3D →' : 'Tải file HTML →'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                  {/* Dedicated CAD Studio Export Section (shown when user selects "Xuất cả bản vẽ & CAD") */}
                  {cadDocument && includeCadInOutputs && (
                    <div
                      data-testid="export-cad-studio-section"
                      className="p-4 rounded-xl border border-cyan-200 dark:border-cyan-900/60 bg-slate-50/70 dark:bg-slate-900/60 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Compass className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                            <span>Xuất Bản Vẽ CAD Studio · {cadDocument.name}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {cadDocument.entities.length.toLocaleString('vi-VN')} đối tượng · {cadDocument.metadata.acadVersion}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* CAD HTML Interactive Viewer */}
                        <button
                          type="button"
                          onClick={handleExportCadHtml}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-cyan-500 bg-white dark:bg-slate-800/40 transition-all cursor-pointer flex items-start gap-3 text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 flex items-center justify-center shrink-0">
                            <Globe className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-900 dark:text-white">
                              Trình Xem CAD HTML (.html)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Tự canh vừa khung màn hình, bật/tắt lớp CAD, chữ &amp; phóng to mượt
                            </div>
                            <div className="text-[10px] text-cyan-600 font-semibold mt-1">Tải CAD HTML →</div>
                          </div>
                        </button>

                        {/* CAD PDF A4 & A3 */}
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 flex items-start gap-3">
                          <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-900 dark:text-white">
                              Bản In PDF CAD Studio (.pdf)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Tính BoundingBox &amp; canh giữa vừa khổ giấy kỹ thuật
                            </div>
                            <label className="flex items-center gap-1.5 mt-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 cursor-pointer">
                              <input
                                type="checkbox"
                                data-testid="export-cad-pdf-autofit"
                                checked={autoFitPdf}
                                onChange={e => setAutoFitPdf(e.target.checked)}
                                className="rounded text-[#155EEF]"
                              />
                              <span>Tự động canh vừa (Auto-Fit)</span>
                            </label>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                              <span>
                                Lề trang: Trên {pdfMargins.top} · Phải {pdfMargins.right} · Dưới {pdfMargins.bottom} · Trái {pdfMargins.left} mm
                              </span>
                              <button
                                type="button"
                                onClick={() => setActiveCategoryTab('report')}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                              >
                                Tùy chỉnh lề →
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              <button
                                type="button"
                                disabled={isExportingCadPdf}
                                onClick={() => void handleExportCadPdf('A4', true)}
                                className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[10px] font-semibold cursor-pointer"
                              >
                                {isExportingCadPdf ? 'Đang tạo...' : 'Tải PDF A4 →'}
                              </button>
                              <button
                                type="button"
                                disabled={isExportingCadPdf}
                                onClick={() => void handleExportCadPdf('A3', true)}
                                className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-900 dark:bg-amber-500 dark:hover:bg-amber-600 disabled:opacity-50 text-white text-[10px] font-semibold cursor-pointer"
                              >
                                {isExportingCadPdf ? 'Đang tạo...' : 'Tải PDF A3 →'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* AutoCAD DXF Round-trip */}
                        <button
                          type="button"
                          onClick={handleExportCadRoundTripDxf}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-sky-500 bg-white dark:bg-slate-800/40 transition-all cursor-pointer flex items-start gap-3 text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-600 flex items-center justify-center shrink-0">
                            <Compass className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-900 dark:text-white">
                              AutoCAD DXF Round-trip (Giữ bản gốc)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Giữ nguyên Handle gốc, bảng Style/Block &amp; thực thể nâng cao
                            </div>
                            <div className="text-[10px] text-sky-600 font-semibold mt-1">Xuất DXF Round-trip →</div>
                          </div>
                        </button>

                        {/* Combined CAD Underlay + Network Overlay */}
                        <button
                          type="button"
                          disabled={contentScope === '3d'}
                          onClick={handleExportCombinedCadNetworkDxf}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-white dark:bg-slate-800/40 transition-all cursor-pointer flex items-start gap-3 text-left disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                          <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 flex items-center justify-center shrink-0">
                            <Archive className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-900 dark:text-white">
                              Xuất Gộp CAD + Hạ tầng Mạng (.dxf)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Gộp bản vẽ AutoCAD nền với tủ Rack, thiết bị &amp; cáp mạng đúng tọa độ
                            </div>
                            <div className="text-[10px] text-emerald-600 font-semibold mt-1">
                              {contentScope === '3d' ? 'Chỉ hỗ trợ phạm vi 2D' : 'Tải DXF gộp →'}
                            </div>
                          </div>
                        </button>

                        {/* Clean DXF AC1015 */}
                        <button
                          type="button"
                          onClick={handleExportCadCleanDxf}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 bg-white dark:bg-slate-800/40 transition-all cursor-pointer flex items-start gap-3 text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 flex items-center justify-center shrink-0">
                            <FileCode className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-900 dark:text-white">
                              AutoCAD DXF Chuẩn AC1015 (Clean)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Tái tạo sạch hoàn toàn cho AutoCAD 2000+
                            </div>
                            <div className="text-[10px] text-indigo-600 font-semibold mt-1">Tải DXF Clean →</div>
                          </div>
                        </button>

                        {/* CAD Vector SVG */}
                        <button
                          type="button"
                          onClick={handleExportCadSvg}
                          className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-white dark:bg-slate-800/40 transition-all cursor-pointer flex items-start gap-3 text-left"
                        >
                          <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
                            <FileCode className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-900 dark:text-white">
                              Vector SVG CAD Studio (.svg)
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              Xuất SVG trực tiếp từ bản vẽ CAD Studio tự canh vừa khung
                            </div>
                            <div className="text-[10px] text-blue-600 font-semibold mt-1">Tải CAD SVG →</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeCategoryTab === 'bom' && (
                <div className="space-y-4">
                  {/* Live BOM Summary Preview */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-[#155EEF] dark:text-blue-300 flex items-center justify-center shrink-0">
                        <ClipboardList className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">
                            Bảng Kê Vật Tư &amp; Dự Toán (BOM)
                          </span>
                          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {allAssets.length} thiết bị · {bomCableSummary.totalMeters}m cáp · {bomRackComponentCount} thành phần Rack
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Xem bảng tổng hợp trực quan theo tầng/nhóm trước khi xuất, sao chép sang Excel hoặc tải tệp CSV chuẩn UTF-8 BOM.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-2.5">
                          {onOpenBomModal && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenBomModal();
                              }}
                              className="px-3 py-1.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
                            >
                              <ClipboardList className="w-3.5 h-3.5" />
                              <span>Xem Thống kê Vật tư (BOM)</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleExportBomCsv}
                            aria-label="Export BOM CSV summarizing assets, cable lengths, and rack components"
                            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Tải CSV BOM (.csv)</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Excel Workbooks & Router Tree */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div
                      onClick={async () => {
                        try {
                          setStatusBanner({ type: 'info', text: 'Đang nạp bộ xuất Excel & đóng gói 6 sheet...' });
                          const { exportProjectToExcel } = await import('../../utils/excelService');
                          await exportProjectToExcel(project);
                          setStatusBanner({ type: 'success', text: 'Đã xuất Workbook Excel 6 sheet thành công!' });
                        } catch (err: unknown) {
                          setStatusBanner({ type: 'error', text: `Lỗi xuất Excel: ${err instanceof Error ? err.message : String(err)}` });
                        }
                      }}
                      className="p-4 rounded-xl border-2 border-emerald-500/80 hover:border-emerald-600 bg-emerald-50/30 hover:bg-emerald-50/60 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40 transition-all cursor-pointer flex items-start gap-3 shadow-xs md:col-span-2"
                    >
                      <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-900 dark:text-white">
                          Xuất Excel Kỹ Thuật (.xlsx – 6 Sheet)
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Gồm: Tổng Quan, BOM Vật Tư, Thiết Bị, Danh Bạ Cáp, Chi Tiết Tủ Rack (Trước/Sau) &amp; Theo Khu Vực
                        </div>
                        <div className="text-xs text-emerald-700 dark:text-emerald-400 font-bold mt-1.5">
                          Tải Workbook Excel (.xlsx) &rarr;
                        </div>
                      </div>
                    </div>

                    <div
                      onClick={async () => {
                        try {
                          setStatusBanner({ type: 'info', text: 'Đang trích xuất cây Router Cha–Con ra Excel...' });
                          const { exportProjectRouterTreeToExcel } = await import('../../utils/excelTreeImporter');
                          await exportProjectRouterTreeToExcel(project);
                          setStatusBanner({ type: 'success', text: 'Đã xuất Cây Router Cha–Con (.xlsx) thành công!' });
                          onAfterExportRouterTree?.();
                        } catch (err: unknown) {
                          setStatusBanner({
                            type: 'error',
                            text: `Lỗi xuất cây Router: ${err instanceof Error ? err.message : String(err)}`
                          });
                        }
                      }}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/20 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3"
                    >
                      <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                        <GitFork className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-900 dark:text-white">
                          Xuất Cây Router Cha–Con (.xlsx)
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Xuất cấu trúc phân cấp thiết bị, Router Cha (Uplink), IP/VLAN, Cổng &amp; Loại cáp tương thích nhập ngược lại
                        </div>
                        <div className="text-[10px] text-emerald-600 font-semibold mt-1.5">
                          Tải file Cây Router (.xlsx) &rarr;
                        </div>
                      </div>
                    </div>

                    <div
                      onClick={async () => {
                        try {
                          const { downloadExcelTemplate } = await import('../../utils/excelService');
                          await downloadExcelTemplate();
                          setStatusBanner({ type: 'success', text: 'Đã tải xuống tệp Excel mẫu!' });
                        } catch (err: unknown) {
                          setStatusBanner({ type: 'error', text: `Lỗi tải mẫu: ${err instanceof Error ? err.message : String(err)}` });
                        }
                      }}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/20 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3"
                    >
                      <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                        <Table className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-900 dark:text-white">Tải Mẫu Excel Nhập Liệu</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Chuẩn cột Ultimate: Mã tài sản, Model, IP, VLAN, Tủ Rack, Vị trí U, Số U &amp; Mặt tủ (Trước/Sau)
                        </div>
                        <div className="text-[10px] text-emerald-600 font-semibold mt-1.5">
                          Tải file mẫu Excel (.xlsx) &rarr;
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeCategoryTab === 'report' && (
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-[#155EEF] text-white flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                          Báo Cáo &amp; Bản Vẽ PDF Kỹ Thuật ({paperSize})
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {selectedFloorSummary} · Tỷ lệ {a4ScalePreview.scaleRatioLabel} {autoFitPdf ? '(Auto-Fit)' : ''} · Thước {a4ScalePreview.scaleBar.totalMeters}m · Khung {a4ScalePreview.realWorldWidthMeters}×{a4ScalePreview.realWorldHeightMeters}m
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleExportTechnicalPdf()}
                        disabled={isExportingPdf || isCapturing3D}
                        className="px-3.5 py-2 bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap"
                      >
                        {isExportingPdf ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <FileDown className="w-4 h-4" />
                        )}
                        <span>
                          {isExportingPdf
                            ? `Đang tạo PDF ${paperSize}...`
                            : includeCadInOutputs
                            ? `Tải PDF Bản vẽ + CAD (${paperSize})`
                            : contentScope === '3d'
                            ? `Tải PDF 3D (${paperSize})`
                            : contentScope === 'both'
                            ? `Tải PDF 2D + 3D (${paperSize})`
                            : `Tải PDF ${paperSize} (Chuẩn kỹ thuật)`}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={contentScope === '3d'}
                        onClick={handleStartPdfPrint}
                        title={
                          contentScope === '3d'
                            ? 'In trình duyệt chỉ áp dụng cho bản vẽ 2D. Hãy chọn Tải PDF 3D ở bên cạnh.'
                            : `Mở hộp thoại in trình duyệt khổ ${paperSize}`
                        }
                        className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed"
                      >
                        <Printer className="w-4 h-4" />
                        <span>In trình duyệt ({paperSize})</span>
                      </button>

                      {cadDocument && includeCadInOutputs && (
                        <button
                          type="button"
                          onClick={() => void handleExportCadPdf(paperSize, false)}
                          disabled={isExportingCadPdf}
                          className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap"
                        >
                          {isExportingCadPdf ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Compass className="w-4 h-4" />
                          )}
                          <span>
                            {isExportingCadPdf
                              ? `Đang tạo PDF CAD ${paperSize}...`
                              : `Tải riêng PDF CAD (${paperSize})`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Khổ giấy (Paper Size)
                      </label>
                      <div className="grid grid-cols-4 gap-1">
                        {(['A4', 'A3', 'A2', 'A1'] as PaperSize[]).map(sz => (
                          <button
                            key={sz}
                            onClick={() => setPaperSize(sz)}
                            className={`py-1.5 rounded border font-bold text-[11px] transition-colors ${
                              paperSize === sz
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                            }`}
                          >
                            {sz}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Hướng giấy (Orientation)
                      </label>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() => setOrientation('landscape')}
                          className={`py-1.5 rounded border font-semibold text-[11px] ${
                            orientation === 'landscape'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          Ngang (Landscape)
                        </button>
                        <button
                          onClick={() => setOrientation('portrait')}
                          className={`py-1.5 rounded border font-semibold text-[11px] ${
                            orientation === 'portrait'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          Dọc (Portrait)
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Tỉ lệ trang bản vẽ
                      </label>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() => setScaleMode('fit')}
                          className={`py-1.5 rounded border font-semibold text-[11px] ${
                            scaleMode === 'fit'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          Vừa 1 Trang
                        </button>
                        <button
                          onClick={() => setScaleMode('tile2x2')}
                          className={`py-1.5 rounded border font-semibold text-[11px] ${
                            scaleMode === 'tile2x2'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          Chia 4 Mảnh (2×2)
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Số hiệu bản vẽ (Khung tên)
                      </label>
                      <input
                        type="text"
                        value={drawingCode}
                        onChange={e => setDrawingCode(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                        placeholder="NET-ELV-01"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                        Tỷ lệ bản vẽ (Scale)
                      </label>
                      <input
                        type="text"
                        value={drawingScale}
                        onChange={e => setDrawingScale(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                        placeholder="1:100 / NTS"
                      />
                    </div>
                  </div>

                  {/* Custom Margins (Left / Right / Top / Bottom in mm) */}
                  <div
                    data-testid="export-pdf-custom-margins"
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-white/80 dark:bg-slate-900/50 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
                        Lề trang PDF tùy chỉnh (Custom Margins · mm)
                      </span>
                      <button
                        type="button"
                        data-testid="export-margins-reset"
                        onClick={() => setPdfMargins({ ...DEFAULT_PDF_MARGINS_MM })}
                        className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Mặc định (8mm)
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div>
                        <label
                          htmlFor="export-margin-left"
                          className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5"
                        >
                          Lề trái (mm)
                        </label>
                        <input
                          id="export-margin-left"
                          data-testid="export-margin-left"
                          type="number"
                          min={0}
                          max={40}
                          step={1}
                          value={pdfMargins.left}
                          onChange={e => updatePdfMargin('left', e.target.value)}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="export-margin-right"
                          className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5"
                        >
                          Lề phải (mm)
                        </label>
                        <input
                          id="export-margin-right"
                          data-testid="export-margin-right"
                          type="number"
                          min={0}
                          max={40}
                          step={1}
                          value={pdfMargins.right}
                          onChange={e => updatePdfMargin('right', e.target.value)}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="export-margin-top"
                          className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5"
                        >
                          Lề trên (mm)
                        </label>
                        <input
                          id="export-margin-top"
                          data-testid="export-margin-top"
                          type="number"
                          min={0}
                          max={40}
                          step={1}
                          value={pdfMargins.top}
                          onChange={e => updatePdfMargin('top', e.target.value)}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="export-margin-bottom"
                          className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5"
                        >
                          Lề dưới (mm)
                        </label>
                        <input
                          id="export-margin-bottom"
                          data-testid="export-margin-bottom"
                          type="number"
                          min={0}
                          max={40}
                          step={1}
                          value={pdfMargins.bottom}
                          onChange={e => updatePdfMargin('bottom', e.target.value)}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px]">
                    <label
                      title="Tự tính BoundingBox bản vẽ và áp dụng tỷ lệ scale phù hợp vào PDF Viewport để vừa trọn khổ giấy"
                      className="flex items-center gap-1.5 cursor-pointer font-semibold text-blue-700 dark:text-blue-300"
                    >
                      <input
                        type="checkbox"
                        data-testid="export-pdf-autofit"
                        checked={autoFitPdf}
                        onChange={e => setAutoFitPdf(e.target.checked)}
                        className="rounded text-[#155EEF]"
                      />
                      <span>Tự động canh vừa</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={includeDiagram}
                        onChange={e => setIncludeDiagram(e.target.checked)}
                        className="rounded text-[#155EEF]"
                      />
                      <span>Bản vẽ sơ đồ hạ tầng</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={includeLegendPanel}
                        onChange={e => setIncludeLegendPanel(e.target.checked)}
                        className="rounded text-[#155EEF]"
                      />
                      <span>Bảng Chú giải &amp; Thước tỷ lệ A4</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={includeRackElevation}
                        onChange={e => setIncludeRackElevation(e.target.checked)}
                        className="rounded text-[#155EEF]"
                      />
                      <span>Hồ sơ Tủ Rack (Mặt Trước &amp; Sau)</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={includeTables}
                        onChange={e => setIncludeTables(e.target.checked)}
                        className="rounded text-[#155EEF]"
                      />
                      <span>Bảng tổng hợp thiết bị &amp; Cáp ({allAssets.length} TB / {project.cables.length} Cáp)</span>
                    </label>
                  </div>
                </div>
              )}

              {activeCategoryTab === 'handover' && (
                <div className="space-y-4">
                  {/* 1-Click Unified Handover Bundle Banner */}
                  <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-[#155EEF] text-white flex items-center justify-center shrink-0">
                        <Archive className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                          Gói Bàn Giao 1 Nút (.zip)
                        </h3>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                          {includeCadInOutputs
                            ? `Đóng gói Bản vẽ + CAD (${selectedFloorSummary}): PDF gộp bản vẽ & CAD + Excel 6 sheet + DXF Thiết kế/Gộp/Round-trip + SVG + Trình xem HTML 2D/3D & CAD Viewer + CSV + JSON.`
                            : contentScope === '2d'
                            ? `Đóng gói Chỉ Bản vẽ (${selectedFloorSummary}): PDF kỹ thuật + Workbook Excel 6 sheet + AutoCAD DXF + SVG + Trình xem HTML đa tầng + Bảng cáp CSV + JSON sao lưu.`
                            : `Đóng gói Chỉ Bản vẽ (${selectedFloorSummary}): PDF (kèm ảnh 3D đa góc nhìn) + Ảnh PNG 3D + Workbook Excel 6 sheet + AutoCAD DXF + SVG + Trình xem HTML đa tầng + JSON sao lưu.`}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleExportHandoverBundle()}
                      disabled={isExportingBundle || isCapturing3D}
                      aria-label="Tải gói bàn giao hồ sơ ZIP tổng hợp"
                      className="px-4 py-2 bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
                    >
                      {isExportingBundle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                      <span>{isExportingBundle ? 'Đang nén gói ZIP...' : 'Tải Gói Bàn Giao (.zip)'}</span>
                    </button>
                  </div>

                  {/* Portable Project Package (.hachihi.json) & Excel Import */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        Gói dự án di động (.hachihi.json · tự nhúng ảnh, thiết bị đang dùng &amp; SHA-256)
                      </span>
                      <div className="flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={pkgIncludeRevisions}
                            onChange={e => setPkgIncludeRevisions(e.target.checked)}
                            className="rounded accent-[#155EEF]"
                          />
                          <span>Kèm lịch sử phiên bản</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={pkgIncludeCustomLibrary}
                            onChange={e => setPkgIncludeCustomLibrary(e.target.checked)}
                            className="rounded accent-[#155EEF]"
                          />
                          <span>Kèm thư viện thiết bị tùy chỉnh</span>
                        </label>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Nhập từ File Excel (.xlsx / .csv)</span>
                          <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            onChange={handleExcelFileUpload}
                            className="hidden"
                          />
                        </label>

                        <button
                          type="button"
                          disabled={isExportingPackage}
                          onClick={() => void handleExportPackage()}
                          className="px-3.5 py-2 bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 text-white rounded-md font-semibold flex items-center gap-1.5 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{isExportingPackage ? 'Đang đóng gói...' : 'Xuất Gói dự án (.hachihi.json)'}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Nhập Gói / JSON (.hachihi.json)</span>
                          <input
                            type="file"
                            accept=".hachihi.json,.json"
                            onChange={handleImportJson}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PRINT PORTAL DOCUMENT (#hachihi-print-sheet) */}
      {isPrinting &&
        createPortal(
          <div id="hachihi-print-sheet" className="bg-white text-slate-900 font-sans">
            {/* 1. Diagram Pages */}
            {includeDiagram &&
              svgTileBlobUrls.map((tile, idx) => (
                <section key={`diag_page_${idx}`} className="hachihi-print-page p-4 flex flex-col">
                  <div className="flex items-center justify-between border-b-2 border-blue-700 pb-2 mb-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                        HACHIHI NETWORK DESIGNER · BẢN VẼ KỸ THUẬT HẠ TẦNG
                      </div>
                      <h1 className="text-lg font-bold text-slate-900">{project.name}</h1>
                    </div>
                    <div className="text-right text-[10px] text-slate-600 font-mono">
                      <div>Chế độ: {project.activeMode.toUpperCase()} · {tile.label}</div>
                      <div>Khổ giấy: {paperSize} ({orientation}) · Phiên bản: {project.version}</div>
                    </div>
                  </div>

                  <div className="border border-slate-300 rounded bg-slate-50 overflow-hidden flex-1 flex items-center justify-center">
                    <img
                      src={tile.blobUrl}
                      alt={`${project.name} — ${tile.label}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-[490px] object-contain"
                    />
                  </div>

                  {/* CAD Engineering Title Block (Khung Tên Bản Vẽ) */}
                  <table className="w-full border-collapse border border-slate-800 text-[9.5px] mt-2">
                    <tbody>
                      <tr>
                        <td className="border border-slate-800 px-2 py-1 font-bold text-blue-800 w-1/3" rowSpan={2}>
                          HACHIHI NETWORK &amp; ELECTRICAL DESIGNER
                          <div className="text-slate-900 text-[11px] mt-0.5">{project.name}</div>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Số hiệu bản vẽ:</span> <strong className="font-mono">{drawingCode}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Tỷ lệ:</span> <strong className="font-mono">{drawingScale}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Khổ giấy:</span> <strong>{paperSize} ({orientation})</strong>
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Kỹ sư thiết kế:</span> <strong>{project.author}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Ngày xuất:</span> <strong className="font-mono">{new Date().toLocaleDateString('vi-VN')}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Phiên bản:</span> <strong className="font-mono">{project.version}</strong> · Trang {idx + 1}/{diagramTiles.length}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </section>
              ))}

            {/* 2. Rack Elevation Pages (Front & Rear) */}
            {includeRackElevation && project.racks.length > 0 && (
              <section className="hachihi-print-page p-4 space-y-4">
                <div className="flex items-center justify-between border-b-2 border-blue-700 pb-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      HỒ SƠ BỐ TRÍ TỦ RACK (FRONT &amp; REAR ELEVATION)
                    </div>
                    <h2 className="text-base font-bold text-slate-900">{project.name} · {project.racks.length} Tủ Rack</h2>
                  </div>
                  <div className="text-[10px] font-mono text-slate-600">{paperSize} · {new Date().toLocaleDateString('vi-VN')}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {project.racks.map(rack => {
                    const stats = getRackStatistics(rack, project.assets);
                    const frontEntries = Object.entries(rack.slots || {}).sort((a, b) => Number(b[0]) - Number(a[0]));
                    const rearEntries = Object.entries(rack.rearSlots || {}).sort((a, b) => Number(b[0]) - Number(a[0]));

                    return (
                      <div key={rack.id} className="border border-slate-300 rounded-lg p-3 break-inside-avoid">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                          <div>
                            <div className="font-bold text-xs text-slate-900">{rack.name}</div>
                            <div className="text-[10px] text-slate-500">
                              {rack.totalUnits}U · Trước: {stats.frontUsedUnits}U · Sau: {stats.rearUsedUnits}U · Còn trống trước: {stats.frontFreeUnits}U
                            </div>
                          </div>
                          <div className="text-right font-mono text-[10px]">
                            <div className="font-bold text-blue-700">{stats.totalPowerWatts} W</div>
                            <div className="text-slate-600">{stats.totalWeightKg.toFixed(1)}/{rack.maxLoadKg || 1000} kg</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <div className="font-bold text-slate-700 mb-1">Mặt Trước ({frontEntries.length} TB)</div>
                            <table className="w-full border-collapse border border-slate-200">
                              <thead>
                                <tr className="bg-slate-100">
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Vị trí</th>
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Thiết bị</th>
                                </tr>
                              </thead>
                              <tbody>
                                {frontEntries.length === 0 ? (
                                  <tr><td colSpan={2} className="p-1 text-center text-slate-400">Trống</td></tr>
                                ) : (
                                  frontEntries.map(([uStr, assetId]) => {
                                    const asset = project.assets[assetId];
                                    const h = asset ? getAssetUHeight(asset) : 1;
                                    const u = parseInt(uStr, 10);
                                    return (
                                      <tr key={uStr}>
                                        <td className="border border-slate-200 px-1 py-0.5 font-mono">
                                          {h > 1 ? `U${u}-${u + h - 1}` : `U${u}`}
                                        </td>
                                        <td className="border border-slate-200 px-1 py-0.5 truncate max-w-[140px]">
                                          {asset?.name || assetId}
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>

                          <div>
                            <div className="font-bold text-slate-700 mb-1">Mặt Sau ({rearEntries.length} TB)</div>
                            <table className="w-full border-collapse border border-slate-200">
                              <thead>
                                <tr className="bg-slate-100">
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Vị trí</th>
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Thiết bị</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rearEntries.length === 0 ? (
                                  <tr><td colSpan={2} className="p-1 text-center text-slate-400">Trống</td></tr>
                                ) : (
                                  rearEntries.map(([uStr, assetId]) => {
                                    const asset = project.assets[assetId];
                                    const h = asset ? getAssetUHeight(asset) : 1;
                                    const u = parseInt(uStr, 10);
                                    return (
                                      <tr key={uStr}>
                                        <td className="border border-slate-200 px-1 py-0.5 font-mono">
                                          {h > 1 ? `U${u}-${u + h - 1}` : `U${u}`}
                                        </td>
                                        <td className="border border-slate-200 px-1 py-0.5 truncate max-w-[140px]">
                                          {asset?.name || assetId}
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. Equipment & Cable Summary Tables */}
            {includeTables && (
              <section className="hachihi-print-page p-4 space-y-4">
                <div className="flex items-center justify-between border-b-2 border-blue-700 pb-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      BẢNG TỔNG HỢP THIẾT BỊ &amp; ĐẤU NỐI CÁP KỸ THUẬT
                    </div>
                    <h2 className="text-base font-bold text-slate-900">{project.name}</h2>
                  </div>
                  <div className="text-[10px] font-mono text-slate-600">
                    {allAssets.length} Thiết bị · {project.cables.length} Tuyến cáp
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-xs text-slate-800 mb-1.5">1. Danh sách Thiết bị ({allAssets.length})</h3>
                  <table className="w-full border-collapse border border-slate-300 text-[10px]">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Mã TS</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Tên thiết bị</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Model / Hãng</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">IP / VLAN</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Rack / U</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-right">Công suất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allAssets.slice(0, 120).map(a => {
                        const rackName = project.racks.find(r => r.id === a.rackId)?.name || '—';
                        return (
                          <tr key={a.id}>
                            <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{a.assetTag}</td>
                            <td className="border border-slate-300 px-1.5 py-0.5 font-semibold">{a.name}</td>
                            <td className="border border-slate-300 px-1.5 py-0.5">{a.vendor} {a.model}</td>
                            <td className="border border-slate-300 px-1.5 py-0.5 font-mono">
                              {a.ipAddress || '—'}{a.vlan ? ` (VLAN ${a.vlan})` : ''}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5">
                              {a.rackId ? `${rackName} · U${a.rackUnitStart} (${a.rackSide === 'rear' ? 'Sau' : 'Trước'})` : '—'}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-right font-mono">{a.powerWatts || 0}W</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {project.cables.length > 0 && (
                  <div>
                    <h3 className="font-bold text-xs text-slate-800 mb-1.5">2. Danh bạ Đấu nối Cáp ({project.cables.length})</h3>
                    <table className="w-full border-collapse border border-slate-300 text-[10px]">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Mã cáp</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Thiết bị Nguồn</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Thiết bị Đích</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Chuẩn cáp</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Tốc độ / Dài</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.cables.slice(0, 120).map(c => {
                          const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
                          const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
                          return (
                            <tr key={c.id}>
                              <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{c.cableCode}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5">{src}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5">{tgt}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5">{c.cableType}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5 font-mono">
                                {c.bandwidth} · {c.lengthMeters || 0}m
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>,
          document.body
        )}
    </>
  );
};
