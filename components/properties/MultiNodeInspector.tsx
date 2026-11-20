import React, { useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ChevronRight,
  Copy,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Grid,
  Group,
  Lock,
  Paintbrush,
  RotateCw,
  Trash2,
  Ungroup,
  Unlock,
  X
} from 'lucide-react';
import { DiagramNode, ProjectState } from '../../types/infrastructure';
import { SnapToGridAlignMode } from '../../utils/snapGuides';
import { normalizeRotationDeg } from '../../utils/coverageUtils';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';
import { ReadOnlyInspectorBanner, renderInlineDeleteBanner } from './propertiesShared';

interface MultiNodeInspectorProps {
  project: ProjectState;
  selectedNodeIds: string[];
  selectedNodes: DiagramNode[];
  isReadOnlyMode: boolean;
  layoutTier: LayoutTier;
  confirmDeleteKey: string | null;
  setConfirmDeleteKey: (key: string | null) => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onGroupNodes?: (nodeIds: string[]) => void;
  onUngroupNodes?: (nodeIds: string[]) => void;
  onAlignNodes?: (nodeIds: string[], alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistributeNodes?: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  onAutoAlignSnapToGrid?: (nodeIds: string[], mode: SnapToGridAlignMode, options?: { evenSpacing?: boolean }) => void;
  onRotateNodes?: (nodeIds: string[], rotationDeg: number) => void;
  onMirrorNodes?: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  hasCopiedStyle?: boolean;
  onPasteNodeStyle?: (nodeIds: string[]) => void;
}

export const MultiNodeInspector: React.FC<MultiNodeInspectorProps> = ({
  project,
  selectedNodeIds,
  selectedNodes,
  isReadOnlyMode,
  layoutTier,
  confirmDeleteKey,
  setConfirmDeleteKey,
  onToggleCollapse,
  onClosePanel,
  onDeleteNodes,
  onDuplicateNodes,
  onToggleNodeLock,
  onToggleNodeVisibility,
  onGroupNodes,
  onUngroupNodes,
  onAlignNodes,
  onDistributeNodes,
  onAutoAlignSnapToGrid,
  onRotateNodes,
  onMirrorNodes,
  hasCopiedStyle = false,
  onPasteNodeStyle
}) => {
  const [evenGridSpacing, setEvenGridSpacing] = useState(true);
  const hasGrouped = selectedNodes.some(n => Boolean(n.groupId));
  const primaryRotation = normalizeRotationDeg(selectedNodes[0]?.rotation || 0);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text overflow-y-auto">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[#155EEF] text-white flex items-center justify-center shrink-0">
            <Group className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              Đã chọn {selectedNodes.length} đối tượng
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Căn chỉnh &amp; thao tác hàng loạt
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Thu gọn bảng thuộc tính"
              title="Thu gọn bảng thuộc tính"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {onClosePanel && (
            <button
              onClick={onClosePanel}
              aria-label="Đóng bảng thuộc tính"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {isReadOnlyMode && <ReadOnlyInspectorBanner />}
      {renderInlineDeleteBanner(
        confirmDeleteKey,
        setConfirmDeleteKey,
        'multi_nodes',
        `${selectedNodes.length} đối tượng`,
        () => onDeleteNodes?.(selectedNodeIds),
        isReadOnlyMode
      )}

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        <fieldset disabled={isReadOnlyMode} className="contents">
          {!isReadOnlyMode && onAutoAlignSnapToGrid && (
            <div className="px-3.5 py-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white text-xs">
                  <Grid className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
                  <span>Căn lưới tự động</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Bước {project.settings.gridSize}px
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => onAutoAlignSnapToGrid(selectedNodeIds, 'horizontal', { evenSpacing: evenGridSpacing })}
                  className="ent-btn-primary"
                >
                  <AlignCenterVertical className="w-3.5 h-3.5 shrink-0" />
                  <span>Căn ngang + Lưới</span>
                </button>
                <button
                  onClick={() => onAutoAlignSnapToGrid(selectedNodeIds, 'vertical', { evenSpacing: evenGridSpacing })}
                  className="ent-btn-secondary"
                >
                  <AlignCenterHorizontal className="w-3.5 h-3.5 shrink-0 text-slate-600 dark:text-slate-300" />
                  <span>Căn dọc + Lưới</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={evenGridSpacing}
                    onChange={e => setEvenGridSpacing(e.target.checked)}
                    className="rounded accent-[#155EEF]"
                  />
                  <span>Dàn đều bước lưới</span>
                </label>
                <button
                  onClick={() => onAutoAlignSnapToGrid(selectedNodeIds, 'grid-only')}
                  className="text-xs font-semibold text-[#155EEF] dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  Bám lưới tại chỗ
                </button>
              </div>
            </div>
          )}

          {!isReadOnlyMode && onAlignNodes && (
            <div className="px-3.5 py-3 space-y-2">
              <label className="ent-label mb-0">Căn chỉnh &amp; Phân bố</label>
              <div className="grid grid-cols-6 gap-1">
                <button onClick={() => onAlignNodes(selectedNodeIds, 'left')} className="h-8 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors" title="Căn trái">
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onAlignNodes(selectedNodeIds, 'center')} className="h-8 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors" title="Căn giữa ngang">
                  <AlignCenterHorizontal className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onAlignNodes(selectedNodeIds, 'right')} className="h-8 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors" title="Căn phải">
                  <AlignRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onAlignNodes(selectedNodeIds, 'top')} className="h-8 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors" title="Căn trên">
                  <AlignStartVertical className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onAlignNodes(selectedNodeIds, 'middle')} className="h-8 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors" title="Căn giữa dọc">
                  <AlignCenterVertical className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onAlignNodes(selectedNodeIds, 'bottom')} className="h-8 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors" title="Căn dưới">
                  <AlignEndVertical className="w-3.5 h-3.5" />
                </button>
              </div>
              {onDistributeNodes && selectedNodes.length >= 3 && (
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    onClick={() => onDistributeNodes(selectedNodeIds, 'horizontal')}
                    className="ent-btn-secondary"
                  >
                    <AlignHorizontalSpaceAround className="w-3.5 h-3.5 text-[#155EEF]" />
                    <span>Dàn đều ngang</span>
                  </button>
                  <button
                    onClick={() => onDistributeNodes(selectedNodeIds, 'vertical')}
                    className="ent-btn-secondary"
                  >
                    <AlignVerticalSpaceAround className="w-3.5 h-3.5 text-[#155EEF]" />
                    <span>Dàn đều dọc</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {!isReadOnlyMode && onRotateNodes && (
            <div className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <RotateCw className="w-3.5 h-3.5 text-cyan-600" />
                  <span>Xoay hàng loạt 360°</span>
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={359}
                    step={1}
                    aria-label="Xoay hàng loạt đối tượng (độ)"
                    value={Math.round(primaryRotation)}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      if (!Number.isNaN(val)) {
                        onRotateNodes(selectedNodeIds, normalizeRotationDeg(val));
                      }
                    }}
                    className="w-16 px-2 py-0.5 text-right rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs font-semibold tabular-nums"
                  />
                  <span className="text-xs font-mono text-slate-400">°</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                aria-label="Thanh trượt xoay hàng loạt 360°"
                value={Math.round(primaryRotation)}
                onChange={e => onRotateNodes(selectedNodeIds, normalizeRotationDeg(parseFloat(e.target.value)))}
                className="w-full accent-cyan-600"
              />
              <div className="grid grid-cols-6 gap-1 text-[10px] font-mono">
                {[
                  { label: '-45°', val: normalizeRotationDeg(primaryRotation - 45) },
                  { label: '-15°', val: normalizeRotationDeg(primaryRotation - 15) },
                  { label: '0°', val: 0 },
                  { label: '+15°', val: normalizeRotationDeg(primaryRotation + 15) },
                  { label: '+45°', val: normalizeRotationDeg(primaryRotation + 45) },
                  { label: '+90°', val: normalizeRotationDeg(primaryRotation + 90) }
                ].map(btn => (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={() => onRotateNodes(selectedNodeIds, btn.val)}
                    className="py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-cyan-500 font-semibold transition-colors"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isReadOnlyMode && onMirrorNodes && (
            <div className="px-3.5 py-2.5 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onMirrorNodes(selectedNodeIds, 'horizontal')}
                className="ent-btn-secondary"
              >
                <FlipHorizontal2 className="w-3.5 h-3.5 text-[#155EEF]" />
                <span>Lật ngang</span>
              </button>
              <button
                type="button"
                onClick={() => onMirrorNodes(selectedNodeIds, 'vertical')}
                className="ent-btn-secondary"
              >
                <FlipVertical2 className="w-3.5 h-3.5 text-[#155EEF]" />
                <span>Lật dọc</span>
              </button>
            </div>
          )}

          {!isReadOnlyMode && (
            <div className="px-3.5 py-3 grid grid-cols-2 gap-1.5">
              {onGroupNodes && (
                <button
                  onClick={() => onGroupNodes(selectedNodeIds)}
                  className="ent-btn-primary"
                >
                  <Group className="w-3.5 h-3.5" />
                  <span>Gom nhóm</span>
                </button>
              )}
              {onUngroupNodes && hasGrouped && (
                <button
                  onClick={() => onUngroupNodes(selectedNodeIds)}
                  className="ent-btn-secondary"
                >
                  <Ungroup className="w-3.5 h-3.5" />
                  <span>Tách nhóm</span>
                </button>
              )}
              {onToggleNodeLock && (
                <button
                  onClick={() => onToggleNodeLock(selectedNodeIds)}
                  className="ent-btn-secondary"
                >
                  {selectedNodes.every(n => n.locked) ? <Unlock className="w-3.5 h-3.5 text-amber-600" /> : <Lock className="w-3.5 h-3.5 text-amber-600" />}
                  <span>{selectedNodes.every(n => n.locked) ? 'Mở khóa' : 'Khóa vị trí'}</span>
                </button>
              )}
              {onToggleNodeVisibility && (
                <button
                  onClick={() => onToggleNodeVisibility(selectedNodeIds, true)}
                  className="ent-btn-secondary"
                >
                  <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                  <span>Ẩn khỏi sơ đồ</span>
                </button>
              )}
              {onDuplicateNodes && (
                <button
                  onClick={() => onDuplicateNodes(selectedNodeIds)}
                  className="ent-btn-secondary"
                >
                  <Copy className="w-3.5 h-3.5 text-[#155EEF]" />
                  <span>Nhân bản</span>
                </button>
              )}
              {onPasteNodeStyle && (
                <button
                  type="button"
                  disabled={!hasCopiedStyle}
                  onClick={() => onPasteNodeStyle(selectedNodeIds)}
                  className="ent-btn-secondary disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Paintbrush className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Dán kiểu</span>
                </button>
              )}
              {onDeleteNodes && (
                <button
                  onClick={() => setConfirmDeleteKey('multi_nodes')}
                  className="h-8 px-3 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Xóa ({selectedNodes.length})</span>
                </button>
              )}
            </div>
          )}
        </fieldset>

        <div className="px-3.5 py-3">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Danh sách đang chọn ({selectedNodes.length})
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md">
            {selectedNodes.map(n => (
              <div
                key={n.id}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-900 flex items-center justify-between gap-2"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{n.label}</span>
                {n.groupId && (
                  <span className="text-xs font-mono text-[#155EEF] dark:text-blue-400 shrink-0">
                    Nhóm
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
