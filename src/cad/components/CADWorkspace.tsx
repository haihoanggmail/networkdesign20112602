import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightCircle,
  Box,
  Download,
  FileCode2,
  FolderOpen,
  Layers,
  Layout,
  Link2,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Save,
  Sparkles
} from 'lucide-react';
import type { CADCommand } from '../commands/CADCommand';
import type { CADCommandLogEntry } from '../commands/CADCommandManager';
import {
  BatchModifyEntitiesCommand,
  BatchUpdateLayersCommand,
  CreateBlockFromSelectionCommand,
  DeleteEntitiesCommand,
  DeleteLayerCommand,
  EditInsertAttributesCommand,
  ModifyEntityCommand,
  PurgeUnusedBlocksCommand,
  RenameLayerCommand,
  UpdateBlockCommand,
  UpdateXrefBlockCommand,
  UpsertDimStyleCommand,
  UpsertLayerCommand,
  UpsertTextStyleCommand,
  buildExplodeInsertCommand
} from '../commands/CADCommands';
import { DEFAULT_CAD_SNAP_SETTINGS, isCADEntityInSpace } from '../core/CADDocument';
import type {
  CADDocument,
  CADEntity,
  CADLayer,
  CADLayout,
  CADSnapSettings,
  CADToolId,
  Point2D
} from '../core/CADTypes';
import type { CanvasPerformanceMode } from '../../types/infrastructure';
import { loadPanelCollapsed, savePanelCollapsed } from '../../utils/panelCollapseStorage';
import { cadExportService } from '../export/CADExportService';
import { computeEntitiesBoundingBox } from '../geometry/CADBounds';
import { decodeAutoCadText } from '../geometry/CADCurve';
import { getSimilarEntityIds, isEntityGeometryEditable } from '../geometry/CADGeometry';
import { CADViewportState, createDefaultCADViewport } from '../rendering/CADViewport';
import { CADBlockPanel } from './CADBlockPanel';
import { CADCanvas, CADCanvasHandle } from './CADCanvas';
import { CADCommandBar } from './CADCommandBar';
import { CADEntityTree } from './CADEntityTree';
import { CADHudControls } from './CADHudControls';
import { CADLayerPanel } from './CADLayerPanel';
import { CADPropertiesPanel } from './CADPropertiesPanel';
import { CADToolbar } from './CADToolbar';
import { CADXrefPanel } from './CADXrefPanel';

interface CADWorkspaceProps {
  doc: CADDocument;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string | null;
  redoLabel?: string | null;
  executionLog?: CADCommandLogEntry[];
  performanceMode?: CanvasPerformanceMode;
  onExecuteCommand: (cmd: CADCommand) => void;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateDocumentSettings: (updater: (doc: CADDocument) => CADDocument) => void;
  onAutoFitUnderlay: () => void;
  onOpenImportDialog: () => void;
  onSaveSnapshot: () => void;
  onApplyToNetworkDesign: () => void;
}

const COMMAND_ALIAS_MAP: Record<string, CADToolId> = {
  S: 'select',
  SEL: 'select',
  H: 'pan',
  PAN: 'pan',
  DI: 'measure',
  DIST: 'measure',
  L: 'line',
  LINE: 'line',
  PL: 'polyline',
  PLINE: 'polyline',
  REC: 'rect',
  RECT: 'rect',
  C: 'circle',
  CIRCLE: 'circle',
  A: 'arc',
  ARC: 'arc',
  T: 'text',
  TEXT: 'text',
  DIM: 'dimension',
  I: 'insert',
  INSERT: 'insert',
  M: 'move',
  MOVE: 'move',
  CO: 'copy',
  CP: 'copy',
  COPY: 'copy',
  RO: 'rotate',
  ROTATE: 'rotate',
  SC: 'scale',
  SCALE: 'scale',
  MI: 'mirror',
  MIRROR: 'mirror',
  O: 'offset',
  OFFSET: 'offset',
  TR: 'trim',
  TRIM: 'trim',
  EX: 'extend',
  EXTEND: 'extend'
};

export const CADWorkspace: React.FC<CADWorkspaceProps> = ({
  doc,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  executionLog = [],
  performanceMode,
  onExecuteCommand,
  onUndo,
  onRedo,
  onUpdateDocumentSettings,
  onAutoFitUnderlay,
  onOpenImportDialog,
  onSaveSnapshot,
  onApplyToNetworkDesign
}) => {
  const cadCanvasRef = useRef<CADCanvasHandle | null>(null);
  const [activeTool, setActiveTool] = useState<CADToolId>('select');
  const [activeLayerName, setActiveLayerName] = useState<string>(() => doc.header.$CLAYER || '0');
  const [activeInsertBlockName, setActiveInsertBlockName] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [leftTab, setLeftTab] = useState<'layers' | 'blocks' | 'xrefs' | 'entities'>('layers');
  const [activeLayoutName, setActiveLayoutName] = useState<string>('Model');
  const [lightBg, setLightBg] = useState(false);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [viewportState, setViewportState] = useState<CADViewportState>(() =>
    createDefaultCADViewport(1000, 680)
  );
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 });
  const [promptVi, setPromptVi] = useState('Sẵn sàng.');
  const [snapSettings, setSnapSettings] = useState<CADSnapSettings>(DEFAULT_CAD_SNAP_SETTINGS);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingPdfSize, setExportingPdfSize] = useState<'A4' | 'A3' | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => !loadPanelCollapsed('cad_left', false));
  const [rightPanelOpen, setRightPanelOpen] = useState(() =>
    !loadPanelCollapsed('cad_right', typeof window !== 'undefined' ? window.innerWidth < 1180 : false)
  );
  useEffect(() => {
    savePanelCollapsed('cad_left', !leftPanelOpen);
  }, [leftPanelOpen]);
  useEffect(() => {
    savePanelCollapsed('cad_right', !rightPanelOpen);
  }, [rightPanelOpen]);

  // Build layout tabs cleanly (Model Space + Paper Space layouts)
  const availableLayouts = useMemo<CADLayout[]>(() => {
    const modelLayout = doc.layouts.find(l => l.isModelSpace) ?? {
      name: 'Model',
      tabOrder: 0,
      isModelSpace: true
    };
    const paperLayouts = doc.layouts
      .filter(l => !l.isModelSpace)
      .sort((a, b) => a.tabOrder - b.tabOrder);
    const hasPaperEntities = doc.entities.some(e => e.space === 'paper');
    if (paperLayouts.length === 0 && hasPaperEntities) {
      paperLayouts.push({ name: 'Layout1', tabOrder: 1, isModelSpace: false });
    }
    return [modelLayout, ...paperLayouts];
  }, [doc.layouts, doc.entities]);

  const activeLayout = useMemo<CADLayout>(
    () => availableLayouts.find(l => l.name === activeLayoutName) ?? availableLayouts[0],
    [availableLayouts, activeLayoutName]
  );

  const activeSpace: 'model' | 'paper' = activeLayout?.isModelSpace === false ? 'paper' : 'model';

  // Reset layout & selection when opening a different document
  useEffect(() => {
    const modelLayout = doc.layouts.find(l => l.isModelSpace);
    setActiveLayoutName(modelLayout?.name || 'Model');
    setSelectedIds(new Set());
  }, [doc.id, doc.layouts]);

  // Sync active layer when doc changes
  useEffect(() => {
    if (!doc.layers[activeLayerName]) {
      setActiveLayerName(doc.layers['0'] ? '0' : Object.keys(doc.layers)[0] || '0');
    }
  }, [doc.id, doc.layers, activeLayerName]);

  // Global CAD studio shortcuts (Ctrl+Z, Ctrl+Y, Delete, F3, F8)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        onRedo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          onExecuteCommand(new DeleteEntitiesCommand(Array.from(selectedIds)));
          setSelectedIds(new Set());
        }
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setSnapSettings(prev => ({ ...prev, enabled: !prev.enabled }));
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setSnapSettings(prev => ({ ...prev, ortho: !prev.ortho }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onUndo, onRedo, onExecuteCommand, selectedIds]);

  const selectedEntities = useMemo(
    () => doc.entities.filter(e => selectedIds.has(e.id)),
    [doc.entities, selectedIds]
  );

  const xrefCount = useMemo(() => {
    const keys = new Set<string>(doc.metadata.missingXrefs.map(x => x.toLowerCase()));
    for (const blk of Object.values(doc.blocks)) {
      if (blk.isXref || blk.xrefPath) {
        keys.add(blk.name.toLowerCase());
      }
    }
    return keys.size;
  }, [doc.blocks, doc.metadata.missingXrefs]);

  const spaceEntityCount = useMemo(
    () => doc.entities.filter(e => isCADEntityInSpace(e, activeSpace)).length,
    [doc.entities, activeSpace]
  );

  const handleSwitchLayout = (layout: CADLayout) => {
    if (layout.name === activeLayout.name) return;
    const nextSpace: 'model' | 'paper' = layout.isModelSpace ? 'model' : 'paper';
    setActiveLayoutName(layout.name);
    if (nextSpace !== activeSpace) {
      setSelectedIds(new Set());
    }
    setPromptVi(
      layout.isModelSpace
        ? `Đã chuyển sang không gian Model (${layout.name}).`
        : `Đã chuyển sang bố cục Paper Space: ${layout.name}.`
    );
  };

  const handleRunCommandLine = (input: string) => {
    const upper = input.trim().toUpperCase();
    if (upper === 'Z' || upper === 'ZE') {
      setFitTrigger(v => v + 1);
      setPromptVi('Đã thu phóng vừa toàn bộ bản vẽ.');
      return;
    }
    if (upper === 'ESC' || upper === 'CANCEL') {
      setActiveTool('select');
      setSelectedIds(new Set());
      setPromptVi('Đã hủy lệnh.');
      return;
    }
    if (upper === 'U' || upper === 'UNDO') {
      onUndo();
      setPromptVi('Đã hoàn tác bước gần nhất.');
      return;
    }
    if (upper === 'REDO') {
      onRedo();
      setPromptVi('Đã làm lại bước vừa hoàn tác.');
      return;
    }
    if (upper === 'PURGE' || upper === 'PU') {
      onExecuteCommand(new PurgeUnusedBlocksCommand());
      setPromptVi('Đã dọn dẹp các Block chưa dùng (PURGE).');
      return;
    }
    if (upper === 'MODEL') {
      const m = availableLayouts.find(l => l.isModelSpace);
      if (m) handleSwitchLayout(m);
      return;
    }
    if (upper === 'PAPER' || upper === 'LAYOUT') {
      const p = availableLayouts.find(l => !l.isModelSpace);
      if (p) handleSwitchLayout(p);
      else setPromptVi('Bản vẽ chưa có Layout Paper Space nào.');
      return;
    }
    const mapped = COMMAND_ALIAS_MAP[upper];
    if (mapped) {
      setActiveTool(mapped);
      setPromptVi(`Đang dùng công cụ: ${mapped.toUpperCase()}`);
    } else {
      setPromptVi(
        `Không nhận diện lệnh "${input}". Thử: L, PL, C, A, REC, T, M, CO, RO, SC, MI, O, TR, EX, DI, Z, U, REDO, PU.`
      );
    }
  };

  const handleShowAllLayers = () => {
    onExecuteCommand(
      new BatchUpdateLayersCommand(layers => {
        const next: Record<string, CADLayer> = {};
        for (const [k, l] of Object.entries(layers)) {
          next[k] = { ...l, visible: true, frozen: false };
        }
        return next;
      }, 'Hiện & rã băng tất cả Layer')
    );
  };

  const handleCreateBlockFromSelection = (blockName: string) => {
    const editableSelected = selectedEntities.filter(isEntityGeometryEditable);
    if (editableSelected.length === 0) {
      setPromptVi('Không có đối tượng hỗ trợ chỉnh sửa nào trong vùng chọn để tạo Block.');
      return;
    }
    const bbox = computeEntitiesBoundingBox(editableSelected);
    const basePoint = {
      x: Number(((bbox.minX + bbox.maxX) / 2).toFixed(4)),
      y: Number(((bbox.minY + bbox.maxY) / 2).toFixed(4)),
      z: 0
    };
    onExecuteCommand(
      new CreateBlockFromSelectionCommand(
        editableSelected.map(e => e.id),
        blockName,
        basePoint,
        activeLayerName
      )
    );
    setSelectedIds(new Set());
    setPromptVi(`Đã tạo Block "${blockName}" từ ${editableSelected.length} đối tượng.`);
  };

  const handleSelectSimilar = (seeds: CADEntity[]) => {
    const similar = new Set(getSimilarEntityIds(doc, seeds, activeSpace));
    setSelectedIds(similar);
    setPromptVi(`SELECT SIMILAR: Đã chọn ${similar.size} đối tượng cùng loại / Layer.`);
  };

  const handleDownloadCadPdf = async (paperSize: 'A4' | 'A3') => {
    if (exportingPdfSize) return;
    setExportMenuOpen(false);
    setExportingPdfSize(paperSize);
    setPromptVi(`Đang kết xuất bản vẽ CAD ra PDF khổ ${paperSize}...`);
    try {
      const artifact = await cadExportService.downloadPdf(doc, {
        paperSize,
        orientation: 'auto',
        lightBackground: true
      });
      setPromptVi(`Đã xuất thành công PDF ${paperSize}: ${artifact.filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Lỗi kết xuất PDF CAD.';
      setPromptVi(`Không thể xuất PDF ${paperSize}: ${msg}`);
    } finally {
      setExportingPdfSize(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Studio Sub-header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
            <FileCode2 className="h-4 w-4" />
            <span className="max-w-[240px] truncate">{doc.name}</span>
          </div>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
            {doc.metadata.acadVersion.split(' ')[0]}
          </span>
          <span className="hidden text-[11px] text-slate-400 md:inline">
            {spaceEntityCount.toLocaleString('vi-VN')} / {doc.entities.length.toLocaleString('vi-VN')} đối tượng • Layer hiện hành:{' '}
            <strong className="text-white">{decodeAutoCadText(activeLayerName)}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(v => !v)}
            title={leftPanelOpen ? 'Thu gọn bảng Lớp / Block / XREF' : 'Mở bảng Lớp / Block / XREF'}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              leftPanelOpen
                ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {leftPanelOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Lớp</span>
          </button>

          <button
            type="button"
            onClick={() => setRightPanelOpen(v => !v)}
            title={rightPanelOpen ? 'Thu gọn bảng Thuộc tính' : 'Mở bảng Thuộc tính'}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
              rightPanelOpen
                ? 'border-cyan-500/40 bg-cyan-950/40 text-cyan-300'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {rightPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Thuộc tính</span>
          </button>
          <button
            type="button"
            onClick={onOpenImportDialog}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
          >
            <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
            Mở DXF / DWG
          </button>

          <button
            type="button"
            onClick={() => {
              onSaveSnapshot();
              setPromptVi('Đã lưu bản sao lịch sử CAD trong IndexedDB.');
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
          >
            <Save className="h-3.5 w-3.5 text-emerald-400" />
            Lưu điểm khôi phục
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setExportMenuOpen(v => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5 text-amber-400" />
              Xuất CAD
            </button>
            {exportMenuOpen && (
              <div
                onMouseLeave={() => setExportMenuOpen(false)}
                className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 p-1 text-xs shadow-2xl"
              >
                <button
                  type="button"
                  onClick={() => {
                    cadExportService.downloadRoundTripDxf(doc);
                    setExportMenuOpen(false);
                  }}
                  className="flex w-full flex-col rounded px-2.5 py-1.5 text-left hover:bg-slate-800"
                >
                  <span className="font-semibold text-cyan-300">Xuất DXF Round-trip (Bảo toàn gốc)</span>
                  <span className="text-[10px] text-slate-400">Giữ nguyên Handle, Block & đối tượng đặc thù</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cadExportService.downloadCleanDxf(doc);
                    setExportMenuOpen(false);
                  }}
                  className="flex w-full flex-col rounded px-2.5 py-1.5 text-left hover:bg-slate-800"
                >
                  <span className="font-medium text-slate-200">Xuất DXF Chuẩn AC1015 (Clean)</span>
                  <span className="text-[10px] text-slate-400">Tái tạo sạch hoàn toàn cho AutoCAD 2000+</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cadExportService.downloadSvg(doc);
                    setExportMenuOpen(false);
                  }}
                  className="flex w-full flex-col rounded px-2.5 py-1.5 text-left hover:bg-slate-800"
                >
                  <span className="font-medium text-slate-200">Xuất Vector SVG (.svg)</span>
                  <span className="text-[10px] text-slate-400">Dùng cho tài liệu & in ấn độ nét cao</span>
                </button>
                <div className="my-1 h-px bg-slate-800" />
                <button
                  type="button"
                  onClick={() => {
                    cadExportService.downloadHtml(doc, { lightBackground: lightBg });
                    setExportMenuOpen(false);
                    setPromptVi('Đã xuất trình xem CAD HTML độc lập (hỗ trợ Pan/Zoom).');
                  }}
                  className="flex w-full flex-col rounded px-2.5 py-1.5 text-left hover:bg-slate-800"
                >
                  <span className="font-semibold text-emerald-300">Xuất Trình Xem HTML (.html)</span>
                  <span className="text-[10px] text-slate-400">Tích hợp sẵn Pan/Zoom xem trên mọi trình duyệt</span>
                </button>
                <button
                  type="button"
                  disabled={exportingPdfSize !== null}
                  onClick={() => handleDownloadCadPdf('A4')}
                  className="flex w-full flex-col rounded px-2.5 py-1.5 text-left hover:bg-slate-800 disabled:opacity-50"
                >
                  <span className="font-medium text-amber-300">
                    {exportingPdfSize === 'A4' ? 'Đang tạo PDF A4...' : 'Xuất Bản In PDF Khổ A4 (.pdf)'}
                  </span>
                  <span className="text-[10px] text-slate-400">Tự canh vừa khổ A4 kèm khung tên kỹ thuật</span>
                </button>
                <button
                  type="button"
                  disabled={exportingPdfSize !== null}
                  onClick={() => handleDownloadCadPdf('A3')}
                  className="flex w-full flex-col rounded px-2.5 py-1.5 text-left hover:bg-slate-800 disabled:opacity-50"
                >
                  <span className="font-medium text-amber-300">
                    {exportingPdfSize === 'A3' ? 'Đang tạo PDF A3...' : 'Xuất Bản In PDF Khổ A3 (.pdf)'}
                  </span>
                  <span className="text-[10px] text-slate-400">Tự canh vừa khổ A3 bản lớn cho thi công</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onApplyToNetworkDesign}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
            title="Chuyển về Thiết kế Mạng 2D/3D với bản vẽ CAD làm nền"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Dùng làm Nền Mạng 2D/3D
            <ArrowRightCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main 4-pane Studio area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CADToolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          canUndo={canUndo}
          canRedo={canRedo}
          undoLabel={undoLabel}
          redoLabel={redoLabel}
          onUndo={onUndo}
          onRedo={onRedo}
          hasSelection={selectedIds.size > 0}
          onDeleteSelected={() => {
            if (selectedIds.size > 0) {
              onExecuteCommand(new DeleteEntitiesCommand(Array.from(selectedIds)));
              setSelectedIds(new Set());
            }
          }}
          onFitView={() => setFitTrigger(v => v + 1)}
          lightBg={lightBg}
          onToggleBg={() => setLightBg(v => !v)}
          snapSettings={snapSettings}
          onToggleSnap={() => setSnapSettings(s => ({ ...s, enabled: !s.enabled }))}
        />

        {/* Collapsible Left CAD Sidebar: Layers / Blocks / XREF / Entity Tree */}
        {leftPanelOpen && (
          <div className="flex w-64 sm:w-72 max-w-[44vw] shrink-0 flex-col border-r border-slate-800 bg-slate-900/90">
            <div className="flex items-center border-b border-slate-800 text-[11px]">
              <div className="grid flex-1 grid-cols-4">
                <button
                  type="button"
                  onClick={() => setLeftTab('layers')}
                  className={`flex flex-col items-center py-2 font-medium ${
                    leftTab === 'layers' ? 'border-b-2 border-cyan-400 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers className="mb-0.5 h-3.5 w-3.5" />
                  Lớp
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab('blocks')}
                  className={`flex flex-col items-center py-2 font-medium ${
                    leftTab === 'blocks' ? 'border-b-2 border-cyan-400 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Box className="mb-0.5 h-3.5 w-3.5" />
                  Block
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab('xrefs')}
                  className={`relative flex flex-col items-center py-2 font-medium ${
                    leftTab === 'xrefs' ? 'border-b-2 border-cyan-400 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Link2 className="mb-0.5 h-3.5 w-3.5" />
                  <span>XREF</span>
                  {xrefCount > 0 && (
                    <span className="absolute right-1.5 top-1 rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">
                      {xrefCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab('entities')}
                  className={`flex flex-col items-center py-2 font-medium ${
                    leftTab === 'entities' ? 'border-b-2 border-cyan-400 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ListTree className="mb-0.5 h-3.5 w-3.5" />
                  Cây
                </button>
              </div>
              <button
                type="button"
                onClick={() => setLeftPanelOpen(false)}
                title="Thu gọn bảng Lớp / Block / XREF / Đối tượng"
                aria-label="Thu gọn bảng trái CAD"
                className="mr-1.5 rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {leftTab === 'layers' && (
                <CADLayerPanel
                  doc={doc}
                  activeLayerName={activeLayerName}
                  onSetActiveLayer={name => {
                    setActiveLayerName(name);
                    onUpdateDocumentSettings(prev => ({
                      ...prev,
                      header: { ...prev.header, $CLAYER: name }
                    }));
                  }}
                  onUpdateLayer={layer => onExecuteCommand(new UpsertLayerCommand(layer))}
                  onCreateLayer={layer => onExecuteCommand(new UpsertLayerCommand(layer, `Tạo Layer "${layer.name}"`))}
                  onRenameLayer={(oldName, newName) => {
                    onExecuteCommand(new RenameLayerCommand(oldName, newName));
                    if (activeLayerName === oldName) {
                      setActiveLayerName(newName.trim());
                    }
                    setPromptVi(`Đã đổi tên Layer "${oldName}" thành "${newName.trim()}".`);
                  }}
                  onDeleteLayer={layerName => {
                    onExecuteCommand(new DeleteLayerCommand(layerName, '0'));
                    if (activeLayerName === layerName) {
                      setActiveLayerName('0');
                    }
                    setPromptVi(`Đã xóa Layer "${layerName}" (đối tượng chuyển về Layer "0").`);
                  }}
                  onBatchLayers={(updater, labelVi) => {
                    onExecuteCommand(new BatchUpdateLayersCommand(updater, labelVi));
                    setPromptVi(labelVi);
                  }}
                  onShowAllLayers={handleShowAllLayers}
                />
              )}
              {leftTab === 'blocks' && (
                <CADBlockPanel
                  doc={doc}
                  activeInsertBlockName={activeInsertBlockName}
                  selectedCount={selectedEntities.filter(isEntityGeometryEditable).length}
                  onStartInsertBlock={name => {
                    setActiveInsertBlockName(name);
                    setActiveTool('insert');
                    setPromptVi(`INSERT: Click trên bản vẽ để đặt Block "${decodeAutoCadText(name)}"...`);
                  }}
                  onCreateBlockFromSelection={handleCreateBlockFromSelection}
                  onUpdateBlock={(blockName, patch) => {
                    onExecuteCommand(new UpdateBlockCommand(blockName, patch));
                    if (patch.newName && activeInsertBlockName === blockName) {
                      setActiveInsertBlockName(patch.newName);
                    }
                    setPromptVi(`Đã cập nhật Block "${patch.newName || blockName}".`);
                  }}
                  onPurgeUnusedBlocks={() => {
                    onExecuteCommand(new PurgeUnusedBlocksCommand());
                    setPromptVi('Đã dọn dẹp các Block chưa dùng (PURGE).');
                  }}
                />
              )}
              {leftTab === 'xrefs' && (
                <CADXrefPanel
                  doc={doc}
                  onSetXrefPath={(blockName, xrefPath) => {
                    onExecuteCommand(new UpdateXrefBlockCommand(blockName, { mode: 'setPath', xrefPath }));
                    setPromptVi(`Đã cập nhật đường dẫn XREF "${blockName}".`);
                  }}
                  onBindXrefLocal={blockName => {
                    onExecuteCommand(new UpdateXrefBlockCommand(blockName, { mode: 'bindLocal' }));
                    setPromptVi(`Đã chuyển XREF "${blockName}" thành Block nội bộ.`);
                  }}
                  onClearMissingXrefNotice={blockOrPath => {
                    onExecuteCommand(new UpdateXrefBlockCommand(blockOrPath, { mode: 'clearMissingNotice' }));
                    setPromptVi(`Đã đánh dấu bỏ qua cảnh báo XREF "${blockOrPath}".`);
                  }}
                />
              )}
              {leftTab === 'entities' && (
                <CADEntityTree
                  doc={doc}
                  selectedIds={selectedIds}
                  onSelectEntity={ent => setSelectedIds(new Set([ent.id]))}
                />
              )}
            </div>
          </div>
        )}

        {/* Center Canvas + Layout Tabs + Command Line */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1">
            {!leftPanelOpen && (
              <button
                type="button"
                onClick={() => setLeftPanelOpen(true)}
                title="Mở bảng Lớp / Block / XREF / Đối tượng"
                className="absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-lg border border-slate-700/90 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 shadow-lg backdrop-blur hover:border-cyan-500/60 hover:text-cyan-300"
              >
                <PanelLeftOpen className="h-3.5 w-3.5 text-cyan-400" />
                Lớp / Block
              </button>
            )}

            {!rightPanelOpen && (
              <button
                type="button"
                onClick={() => setRightPanelOpen(true)}
                title="Mở bảng Thuộc tính"
                className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-lg border border-slate-700/90 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 shadow-lg backdrop-blur hover:border-cyan-500/60 hover:text-cyan-300"
              >
                <PanelRightOpen className="h-3.5 w-3.5 text-cyan-400" />
                Thuộc tính
                {selectedEntities.length > 0 && (
                  <span className="rounded bg-cyan-500/20 px-1 text-[10px] text-cyan-300">
                    {selectedEntities.length}
                  </span>
                )}
              </button>
            )}

            <CADCanvas
              ref={cadCanvasRef}
              doc={doc}
              activeLayerName={activeLayerName}
              activeSpace={activeSpace}
              activeLayoutKey={activeLayout.name}
              activeTool={activeTool}
              activeInsertBlockName={activeInsertBlockName}
              selectedIds={selectedIds}
              snapSettings={snapSettings}
              lightBg={lightBg}
              fitTrigger={fitTrigger}
              performanceMode={performanceMode}
              onSelectIds={setSelectedIds}
              onExecuteCommand={onExecuteCommand}
              onCursorMove={setCursorWorld}
              onStatusPrompt={setPromptVi}
              onFinishToolToSelect={() => setActiveTool('select')}
              onViewportChange={setViewportState}
            />
            <CADHudControls
              doc={doc}
              viewport={viewportState}
              lightBg={lightBg}
              selectedIds={selectedIds}
              onZoomIn={() => cadCanvasRef.current?.zoomIn()}
              onZoomOut={() => cadCanvasRef.current?.zoomOut()}
              onResetZoom={() => cadCanvasRef.current?.resetZoom()}
              onFitView={() => setFitTrigger(v => v + 1)}
              onPanToWorldCenter={pt => cadCanvasRef.current?.panToWorldCenter(pt)}
            />
          </div>

          {/* Model Space / Paper Space Layout Switcher */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/95 px-2.5 py-1 text-[11px]">
            <div className="flex items-center gap-1 overflow-x-auto">
              <span className="mr-1 inline-flex items-center gap-1 text-[10px] text-slate-400">
                <Layout className="h-3 w-3 text-cyan-400" />
                Không gian:
              </span>
              {availableLayouts.map(layout => {
                const isActive = layout.name === activeLayout.name;
                return (
                  <button
                    key={layout.name}
                    type="button"
                    onClick={() => handleSwitchLayout(layout)}
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      isActive
                        ? layout.isModelSpace
                          ? 'bg-cyan-600 text-white'
                          : 'bg-amber-600 text-white'
                        : 'border border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {layout.isModelSpace ? `Model (${layout.name})` : `Paper: ${layout.name}`}
                  </button>
                );
              })}
            </div>
            <span className="shrink-0 text-[10px] text-slate-400">
              {activeSpace === 'paper'
                ? 'Paper Space & Khung Viewport'
                : 'Model Space (Tọa độ thực)'}
            </span>
          </div>

          <CADCommandBar
            activeTool={activeTool}
            promptVi={promptVi}
            cursorWorld={cursorWorld}
            unitCode={doc.header.$INSUNITS}
            snapSettings={snapSettings}
            executionLog={executionLog}
            onUpdateSnapSettings={setSnapSettings}
            onRunCommandLine={handleRunCommandLine}
          />
        </div>

        {/* Collapsible Right CAD Properties Panel */}
        {rightPanelOpen && (
          <div className="flex w-64 sm:w-72 max-w-[44vw] shrink-0 flex-col border-l border-slate-800 bg-slate-900/90">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 text-[11px]">
              <span className="font-semibold text-slate-300">Thuộc tính CAD</span>
              <button
                type="button"
                onClick={() => setRightPanelOpen(false)}
                title="Thu gọn bảng Thuộc tính"
                aria-label="Thu gọn bảng phải CAD"
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <CADPropertiesPanel
                doc={doc}
                selectedEntities={selectedEntities}
                onPatchEntity={(id, patcher, labelVi) =>
                  onExecuteCommand(new ModifyEntityCommand(id, patcher, labelVi))
                }
                onBatchPatchEntities={(entityIds, patch, labelVi) =>
                  onExecuteCommand(new BatchModifyEntitiesCommand(entityIds, patch, labelVi))
                }
                onEditInsertAttributes={(entityId, attributes) =>
                  onExecuteCommand(new EditInsertAttributesCommand(entityId, attributes))
                }
                onSelectSimilar={handleSelectSimilar}
                onUpsertTextStyle={style => onExecuteCommand(new UpsertTextStyleCommand(style))}
                onUpsertDimStyle={style => onExecuteCommand(new UpsertDimStyleCommand(style))}
                onDeleteSelected={() => {
                  if (selectedIds.size > 0) {
                    onExecuteCommand(new DeleteEntitiesCommand(Array.from(selectedIds)));
                    setSelectedIds(new Set());
                  }
                }}
                onExplodeInsert={id => {
                  const cmd = buildExplodeInsertCommand(doc, id);
                  if (cmd) {
                    onExecuteCommand(cmd);
                    setSelectedIds(new Set());
                  }
                }}
                onUpdateDocumentSettings={onUpdateDocumentSettings}
                onAutoFitUnderlay={onAutoFitUnderlay}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
