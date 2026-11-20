import React from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Box,
  Circle,
  Copy,
  FlipHorizontal,
  GitBranch,
  Hand,
  Layers,
  Magnet,
  Maximize,
  Maximize2,
  Minus,
  Moon,
  MousePointer,
  Redo2,
  RotateCw,
  Ruler,
  Scissors,
  Spline,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  Move
} from 'lucide-react';
import type { CADSnapSettings, CADToolId } from '../core/CADTypes';

interface CADToolbarProps {
  activeTool: CADToolId;
  onSelectTool: (tool: CADToolId) => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string | null;
  redoLabel?: string | null;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  onFitView: () => void;
  lightBg: boolean;
  onToggleBg: () => void;
  snapSettings: CADSnapSettings;
  onToggleSnap: () => void;
}

const TOOL_GROUPS: Array<{
  title: string;
  items: Array<{ id: CADToolId; label: string; shortcut: string; icon: React.ReactNode }>;
}> = [
  {
    title: 'Điều hướng & Đo',
    items: [
      { id: 'select', label: 'Chọn đối tượng (ESC)', shortcut: 'S', icon: <MousePointer className="h-4 w-4" /> },
      { id: 'pan', label: 'Kéo vùng nhìn (Pan)', shortcut: 'H', icon: <Hand className="h-4 w-4" /> },
      { id: 'measure', label: 'Đo khoảng cách (DI)', shortcut: 'DI', icon: <Ruler className="h-4 w-4" /> }
    ]
  },
  {
    title: 'Vẽ Hình học (Draw)',
    items: [
      { id: 'line', label: 'Đoạn thẳng (L)', shortcut: 'L', icon: <Minus className="h-4 w-4" /> },
      { id: 'polyline', label: 'Đa tuyến (PL)', shortcut: 'PL', icon: <GitBranch className="h-4 w-4" /> },
      { id: 'rect', label: 'Hình chữ nhật (REC)', shortcut: 'REC', icon: <Square className="h-4 w-4" /> },
      { id: 'circle', label: 'Đường tròn (C)', shortcut: 'C', icon: <Circle className="h-4 w-4" /> },
      { id: 'arc', label: 'Cung tròn 3 điểm (A)', shortcut: 'A', icon: <Spline className="h-4 w-4" /> },
      { id: 'text', label: 'Văn bản (T)', shortcut: 'T', icon: <Type className="h-4 w-4" /> },
      { id: 'dimension', label: 'Ghi kích thước (DIM)', shortcut: 'DIM', icon: <ArrowLeftRight className="h-4 w-4" /> },
      { id: 'insert', label: 'Chèn Block (I)', shortcut: 'I', icon: <Box className="h-4 w-4" /> }
    ]
  },
  {
    title: 'Chỉnh sửa (Modify)',
    items: [
      { id: 'move', label: 'Di chuyển (M)', shortcut: 'M', icon: <Move className="h-4 w-4" /> },
      { id: 'copy', label: 'Sao chép (CO)', shortcut: 'CO', icon: <Copy className="h-4 w-4" /> },
      { id: 'rotate', label: 'Xoay (RO)', shortcut: 'RO', icon: <RotateCw className="h-4 w-4" /> },
      { id: 'scale', label: 'Tỉ lệ (SC)', shortcut: 'SC', icon: <Maximize2 className="h-4 w-4" /> },
      { id: 'mirror', label: 'Đối xứng (MI)', shortcut: 'MI', icon: <FlipHorizontal className="h-4 w-4" /> },
      { id: 'offset', label: 'Song song (O)', shortcut: 'O', icon: <Layers className="h-4 w-4" /> },
      { id: 'trim', label: 'Cắt đoạn (TR)', shortcut: 'TR', icon: <Scissors className="h-4 w-4" /> },
      { id: 'extend', label: 'Kéo dài tới biên (EX)', shortcut: 'EX', icon: <ArrowRight className="h-4 w-4" /> }
    ]
  }
];

export const CADToolbar: React.FC<CADToolbarProps> = ({
  activeTool,
  onSelectTool,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  hasSelection,
  onDeleteSelected,
  onFitView,
  lightBg,
  onToggleBg,
  snapSettings,
  onToggleSnap
}) => {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-slate-800 bg-slate-900 py-2">
      {/* History & quick actions */}
      <div className="flex flex-col items-center gap-1 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title={undoLabel ? `Hoàn tác: ${undoLabel} (Ctrl+Z)` : 'Hoàn tác (Ctrl+Z)'}
          className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title={redoLabel ? `Làm lại: ${redoLabel} (Ctrl+Y)` : 'Làm lại (Ctrl+Y)'}
          className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
        >
          <Redo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onFitView}
          title="Vừa màn hình (Zoom Extents - Z)"
          className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800"
        >
          <Maximize className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleSnap}
          title={snapSettings.enabled ? 'Tắt bắt điểm OSNAP (F3)' : 'Bật bắt điểm OSNAP (F3)'}
          className={`rounded-lg p-1.5 ${
            snapSettings.enabled ? 'bg-emerald-950/60 text-emerald-400' : 'text-slate-500 hover:bg-slate-800'
          }`}
        >
          <Magnet className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleBg}
          title={lightBg ? 'Đổi nền Tối (Model Space)' : 'Đổi nền Sáng (Blueprint)'}
          className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800"
        >
          {lightBg ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
        {hasSelection && (
          <button
            type="button"
            onClick={onDeleteSelected}
            title="Xóa đối tượng đã chọn (Del)"
            className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-950/50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* CAD Tool groups */}
      {TOOL_GROUPS.map(group => (
        <div key={group.title} className="flex flex-col items-center gap-1 border-b border-slate-800/80 pb-2 last:border-b-0">
          {group.items.map(item => {
            const active = activeTool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTool(item.id)}
                title={`${item.label} [${item.shortcut}]`}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.icon}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
