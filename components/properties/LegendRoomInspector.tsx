import React, { useState } from 'react';
import {
  Building2,
  ChevronRight,
  EyeOff,
  Layers,
  Lock,
  Maximize2,
  Plus,
  RotateCw,
  Table2,
  Trash2,
  Unlock,
  X
} from 'lucide-react';
import { DiagramNode, Floor, ProjectState, Room } from '../../types/infrastructure';
import { buildProjectLegendData } from '../../utils/legendGenerator';
import { normalizeRotationDeg } from '../../utils/coverageUtils';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import { ReadOnlyInspectorBanner, renderInlineDeleteBanner } from './propertiesShared';

type LegendTab = 'config' | 'size';

interface LegendNodeInspectorProps {
  project: ProjectState;
  selectedNode: DiagramNode;
  isReadOnlyMode: boolean;
  layoutTier: LayoutTier;
  confirmDeleteKey: string | null;
  setConfirmDeleteKey: (key: string | null) => void;
  onUpdateNode: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onDeleteNode: (nodeId: string) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onResizeLegendToFit?: (nodeId: string) => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
}

export const LegendNodeInspector: React.FC<LegendNodeInspectorProps> = ({
  project,
  selectedNode,
  isReadOnlyMode,
  layoutTier,
  confirmDeleteKey,
  setConfirmDeleteKey,
  onUpdateNode,
  onDeleteNode,
  onToggleNodeLock,
  onToggleNodeVisibility,
  onResizeLegendToFit,
  onToggleCollapse,
  onClosePanel
}) => {
  const [legendTab, setLegendTab] = useState<LegendTab>('config');
  const scope = selectedNode.customData?.legendScope || 'all';
  const includeCables = selectedNode.customData?.legendIncludeCables ?? true;
  const legendTitle = selectedNode.customData?.legendTitle || selectedNode.label;
  const legendData = buildProjectLegendData(project, {
    scope,
    includeCables,
    title: legendTitle
  });

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#155EEF] text-white shrink-0">
            <Table2 className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              Bảng Chú Giải
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Ký hiệu &amp; thống kê tự động
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!isReadOnlyMode && onToggleNodeLock && (
            <button
              onClick={() => onToggleNodeLock([selectedNode.id])}
              className={`p-1.5 rounded-md transition-colors ${
                selectedNode.locked
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
              title={selectedNode.locked ? 'Mở khóa' : 'Khóa vị trí'}
            >
              {selectedNode.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          )}
          {!isReadOnlyMode && onToggleNodeVisibility && (
            <button
              onClick={() => onToggleNodeVisibility([selectedNode.id], true)}
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
              title="Ẩn bảng chú giải"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}
          {!isReadOnlyMode && (
            <button
              onClick={() => setConfirmDeleteKey(`node_${selectedNode.id}`)}
              className="p-1.5 hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-950/40 rounded-md transition-colors"
              title="Xóa bảng chú giải"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
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

      <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="grid grid-cols-2 gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md">
          <button
            onClick={() => setLegendTab('config')}
            className={`py-1 rounded text-xs font-medium transition-colors ${
              legendTab === 'config'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-2xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            Cấu hình
          </button>
          <button
            onClick={() => setLegendTab('size')}
            className={`py-1 rounded text-xs font-medium transition-colors ${
              legendTab === 'size'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-2xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
            }`}
          >
            Kích thước
          </button>
        </div>
      </div>

      {isReadOnlyMode && <ReadOnlyInspectorBanner />}
      {renderInlineDeleteBanner(
        confirmDeleteKey,
        setConfirmDeleteKey,
        `node_${selectedNode.id}`,
        'Bảng chú giải',
        () => onDeleteNode(selectedNode.id),
        isReadOnlyMode
      )}

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        <fieldset disabled={isReadOnlyMode} className="space-y-3.5">
          {legendTab === 'config' ? (
            <>
              <div>
                <label className="ent-label">Tiêu đề bảng chú giải</label>
                <input
                  type="text"
                  value={legendTitle}
                  onChange={e =>
                    onUpdateNode(selectedNode.id, {
                      label: e.target.value,
                      customData: { ...selectedNode.customData, legendTitle: e.target.value }
                    })
                  }
                  className="ent-input font-medium"
                />
              </div>

              <div>
                <label className="ent-label">Phạm vi thống kê</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() =>
                      onUpdateNode(selectedNode.id, {
                        customData: { ...selectedNode.customData, legendScope: 'all' }
                      })
                    }
                    className={`h-8 px-2 rounded-md border text-xs font-medium whitespace-nowrap transition-colors ${
                      scope === 'all'
                        ? 'bg-[#155EEF] text-white border-[#155EEF] font-semibold'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    Toàn bộ dự án
                  </button>
                  <button
                    onClick={() =>
                      onUpdateNode(selectedNode.id, {
                        customData: { ...selectedNode.customData, legendScope: 'activeFloor' }
                      })
                    }
                    className={`h-8 px-2 rounded-md border text-xs font-medium whitespace-nowrap transition-colors ${
                      scope === 'activeFloor'
                        ? 'bg-[#155EEF] text-white border-[#155EEF] font-semibold'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    Tầng đang chọn
                  </button>
                </div>
              </div>

              <label className="flex items-center justify-between gap-2 py-1.5 border-y border-slate-100 dark:border-slate-800 cursor-pointer">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Hiển thị quy ước màu dây cáp
                </span>
                <input
                  type="checkbox"
                  checked={includeCables}
                  onChange={e =>
                    onUpdateNode(selectedNode.id, {
                      customData: { ...selectedNode.customData, legendIncludeCables: e.target.checked }
                    })
                  }
                  className="accent-[#155EEF] w-4 h-4"
                />
              </label>

              <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-slate-800/30 text-center">
                <div className="py-2">
                  <div className="text-sm font-semibold text-[#155EEF] dark:text-blue-400 font-mono tabular-nums">
                    {legendData.components.length}
                  </div>
                  <div className="text-xs text-slate-500">Loại TB</div>
                </div>
                <div className="py-2">
                  <div className="text-sm font-semibold text-[#155EEF] dark:text-blue-400 font-mono tabular-nums">
                    {legendData.totalDevices}
                  </div>
                  <div className="text-xs text-slate-500">Tổng TB</div>
                </div>
                <div className="py-2">
                  <div className="text-sm font-semibold text-[#155EEF] dark:text-blue-400 font-mono tabular-nums">
                    {legendData.totalCables}
                  </div>
                  <div className="text-xs text-slate-500">Tuyến cáp</div>
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <RotateCw className="w-3.5 h-3.5 text-cyan-600" />
                    <span>Hướng xoay 360°</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={359}
                      step={1}
                      aria-label="Hướng xoay bảng chú giải (độ)"
                      value={Math.round(normalizeRotationDeg(selectedNode.rotation || 0))}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        if (!Number.isNaN(val)) {
                          onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(val) });
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
                  aria-label="Thanh trượt góc xoay bảng chú giải 360°"
                  value={Math.round(normalizeRotationDeg(selectedNode.rotation || 0))}
                  onChange={e =>
                    onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(parseFloat(e.target.value)) })
                  }
                  className="w-full accent-cyan-600"
                />
                <div className="grid grid-cols-6 gap-1 text-[10px] font-mono">
                  {[
                    { label: '-45°', val: normalizeRotationDeg((selectedNode.rotation || 0) - 45) },
                    { label: '-15°', val: normalizeRotationDeg((selectedNode.rotation || 0) - 15) },
                    { label: '0°', val: 0 },
                    { label: '+15°', val: normalizeRotationDeg((selectedNode.rotation || 0) + 15) },
                    { label: '+45°', val: normalizeRotationDeg((selectedNode.rotation || 0) + 45) },
                    { label: '+90°', val: normalizeRotationDeg((selectedNode.rotation || 0) + 90) }
                  ].map(btn => (
                    <button
                      key={btn.label}
                      type="button"
                      onClick={() => onUpdateNode(selectedNode.id, { rotation: btn.val })}
                      className="py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-cyan-500 font-semibold transition-colors"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {!isReadOnlyMode && onResizeLegendToFit && (
                <button
                  onClick={() => onResizeLegendToFit(selectedNode.id)}
                  className="w-full py-2 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-1.5"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Tự động khớp kích thước bảng</span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Chiều rộng (W)</label>
                  <input
                    type="number"
                    min={220}
                    value={selectedNode.width}
                    onChange={e =>
                      onUpdateNode(selectedNode.id, {
                        width: Math.max(220, parseInt(e.target.value, 10) || 220)
                      })
                    }
                    className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums disabled:opacity-65"
                  />
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Chiều cao (H)</label>
                  <input
                    type="number"
                    min={120}
                    value={selectedNode.height}
                    onChange={e =>
                      onUpdateNode(selectedNode.id, {
                        height: Math.max(120, parseInt(e.target.value, 10) || 120)
                      })
                    }
                    className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums disabled:opacity-65"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Co giãn cỡ chữ &amp; biểu tượng
                  </span>
                  <span className="font-mono font-semibold text-[#155EEF] tabular-nums">
                    {typeof selectedNode.customData?.legendScale === 'number'
                      ? `${Math.round(selectedNode.customData.legendScale * 100)}%`
                      : `Tự động (${Math.round(Math.min(1.65, Math.max(0.76, selectedNode.width / 340)) * 100)}%)`}
                  </span>
                </div>
                <input
                  type="range"
                  min={70}
                  max={180}
                  step={5}
                  value={Math.round(
                    (typeof selectedNode.customData?.legendScale === 'number'
                      ? selectedNode.customData.legendScale
                      : Math.min(1.65, Math.max(0.76, selectedNode.width / 340))) * 100
                  )}
                  onChange={e =>
                    onUpdateNode(selectedNode.id, {
                      customData: {
                        ...selectedNode.customData,
                        legendScale: Number(e.target.value) / 100
                      }
                    })
                  }
                  className="w-full accent-[#155EEF]"
                />
                <div className="flex items-center justify-between gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateNode(selectedNode.id, {
                        customData: { ...selectedNode.customData, legendScale: undefined }
                      })
                    }
                    className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium hover:border-[#155EEF]"
                  >
                    Tự động theo khung
                  </button>
                  <div className="flex items-center gap-1">
                    {[
                      { label: 'Gọn', w: 260, h: 240 },
                      { label: 'Chuẩn', w: 340, h: 320 },
                      { label: '2 cột', w: 580, h: 280 }
                    ].map(preset => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          onUpdateNode(selectedNode.id, {
                            width: preset.w,
                            height: preset.h
                          })
                        }
                        className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium hover:border-[#155EEF]"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
};

interface RoomInspectorProps {
  project: ProjectState;
  selectedRoom: Room;
  isReadOnlyMode: boolean;
  confirmDeleteKey: string | null;
  setConfirmDeleteKey: (key: string | null) => void;
  onUpdateRoom: (roomId: string, partial: Partial<Room>) => void;
  onDeleteRoom: (roomId: string) => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
}

export const RoomInspector: React.FC<RoomInspectorProps> = ({
  project,
  selectedRoom,
  isReadOnlyMode,
  confirmDeleteKey,
  setConfirmDeleteKey,
  onUpdateRoom,
  onDeleteRoom,
  onToggleCollapse,
  onClosePanel
}) => {
  const floor = project.floors.find(f => f.id === selectedRoom.floorId);
  const devicesInRoom = project.nodes.filter(n => {
    const asset = n.assetId ? project.assets[n.assetId] : undefined;
    return asset?.roomId === selectedRoom.id;
  });
  const safeScale = normalizeScalePxPerMeter(project.settings.scale);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text overflow-y-auto">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0">
            <Building2 className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              {selectedRoom.name}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {floor?.name || 'Chưa gán tầng'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!isReadOnlyMode && (
            <button
              onClick={() => setConfirmDeleteKey(`room_${selectedRoom.id}`)}
              aria-label="Xóa phòng"
              className="p-1.5 hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-950/40 rounded-md transition-colors"
              title="Xóa phòng"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
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
        `room_${selectedRoom.id}`,
        `phòng "${selectedRoom.name}"`,
        () => onDeleteRoom(selectedRoom.id),
        isReadOnlyMode
      )}

      <div className="p-3.5 space-y-3.5">
        <fieldset disabled={isReadOnlyMode} className="space-y-3.5">
          <div>
            <label className="ent-label">Tên phòng / Khu vực</label>
            <input
              type="text"
              value={selectedRoom.name}
              onChange={e => onUpdateRoom(selectedRoom.id, { name: e.target.value })}
              className="ent-input font-medium"
            />
          </div>

          <div>
            <label className="ent-label">Loại không gian</label>
            <select
              value={selectedRoom.type}
              onChange={e => onUpdateRoom(selectedRoom.id, { type: e.target.value as Room['type'] })}
              className="ent-select"
            >
              <option value="server_room">Phòng Server / MDF / IDF</option>
              <option value="office">Văn phòng làm việc</option>
              <option value="meeting">Phòng họp hội thảo</option>
              <option value="reception">Sảnh Lễ tân &amp; Showroom</option>
              <option value="utility_riser">Trục Riser Kỹ thuật đứng</option>
              <option value="corridor">Hành lang &amp; Lưu thông</option>
              <option value="warehouse">Kho lưu trữ thiết bị</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="ent-label">Chiều rộng (m)</label>
                    <input
                      type="number"
                      value={(selectedRoom.width / safeScale).toFixed(1)}
                      onChange={e =>
                        onUpdateRoom(selectedRoom.id, {
                          width: (parseFloat(e.target.value) || 1) * safeScale
                        })
                      }
                      className="ent-input font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="ent-label">Chiều dài (m)</label>
                    <input
                      type="number"
                      value={(selectedRoom.height / safeScale).toFixed(1)}
                      onChange={e =>
                        onUpdateRoom(selectedRoom.id, {
                          height: (parseFloat(e.target.value) || 1) * safeScale
                        })
                      }
                      className="ent-input font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-slate-800/30">
                  <div className="px-3 py-2">
                    <div className="text-xs text-slate-500">Diện tích sàn</div>
                    <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                      {((selectedRoom.width * selectedRoom.height) / (safeScale * safeScale)).toFixed(1)} m²
                    </div>
                  </div>
            <div className="px-3 py-2">
              <div className="text-xs text-slate-500">Thiết bị trong phòng</div>
              <div className="font-semibold font-mono tabular-nums text-[#155EEF] dark:text-blue-400 mt-0.5">
                {devicesInRoom.length} TB
              </div>
            </div>
          </div>

          <div>
            <label className="text-slate-500 text-xs block mb-1">Màu nền phòng</label>
            <div className="flex items-center gap-1.5">
              {['#f8fafc', '#f0fdf4', '#fef3c7', '#eff6ff', '#faf5ff', '#fff1f2'].map(c => (
                <button
                  key={c}
                  onClick={() => onUpdateRoom(selectedRoom.id, { color: c })}
                  aria-label={`Chọn màu nền phòng ${c}`}
                  className={`w-6 h-6 rounded border ${
                    selectedRoom.color === c ? 'ring-2 ring-blue-500 scale-110' : 'border-slate-300'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
};

interface FloorInspectorProps {
  project: ProjectState;
  selectedFloor: Floor;
  isReadOnlyMode: boolean;
  onUpdateFloor: (floorId: string, partial: Partial<Floor>) => void;
  onCloneFloor: (floorId: string, newLevel: number, newName: string) => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
}

export const FloorInspector: React.FC<FloorInspectorProps> = ({
  project,
  selectedFloor,
  isReadOnlyMode,
  onUpdateFloor,
  onCloneFloor,
  onToggleCollapse,
  onClosePanel
}) => {
  const building = project.buildings.find(b => b.id === selectedFloor.buildingId);
  const roomsOnFloor = project.rooms.filter(r => r.floorId === selectedFloor.id);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text overflow-y-auto">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[#155EEF] text-white flex items-center justify-center shrink-0">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              {selectedFloor.name}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {building?.name || 'HACHIHI Building'}
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

      <div className="p-3.5 space-y-3.5">
        <fieldset disabled={isReadOnlyMode} className="space-y-3.5">
          <div>
            <label className="ent-label">Tên tầng</label>
            <input
              type="text"
              value={selectedFloor.name}
              onChange={e => onUpdateFloor(selectedFloor.id, { name: e.target.value })}
              className="ent-input font-medium"
            />
          </div>
          <div>
            <label className="ent-label">Mô tả chức năng</label>
            <input
              type="text"
              value={selectedFloor.description}
              onChange={e => onUpdateFloor(selectedFloor.id, { description: e.target.value })}
              className="ent-input"
            />
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/40 dark:bg-slate-800/20 text-xs">
            <div className="px-3 py-2 flex justify-between">
              <span className="text-slate-500">Cấp tầng</span>
              <span className="font-semibold font-mono text-slate-900 dark:text-white">
                {selectedFloor.level > 0 ? `Tầng ${selectedFloor.level}` : `Hầm B${Math.abs(selectedFloor.level)}`}
              </span>
            </div>
            <div className="px-3 py-2 flex justify-between">
              <span className="text-slate-500">Mặt bằng</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                {selectedFloor.widthMeters}m × {selectedFloor.depthMeters}m
              </span>
            </div>
            <div className="px-3 py-2 flex justify-between">
              <span className="text-slate-500">Số phòng</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-white">{roomsOnFloor.length}</span>
            </div>
          </div>
          {!isReadOnlyMode && (
            <button
              onClick={() => {
                const newLevel = Math.max(...project.floors.map(f => f.level)) + 1;
                onCloneFloor(selectedFloor.id, newLevel, `Tầng ${newLevel} (Bản sao từ ${selectedFloor.name})`);
              }}
              className="ent-btn-primary w-full"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nhân bản sang tầng mới</span>
            </button>
          )}
        </fieldset>
      </div>
    </div>
  );
};
