import React from 'react';
import { ChevronRight, Lock, Route, Trash2, Unlock, X } from 'lucide-react';
import { CableTray, CableTrayKind, ProjectState } from '../../types/infrastructure';
import { calculateTrayAwareCableLengthMeters, computeCableTrayLengthMeters } from '../../utils/cableRouting';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import { ReadOnlyInspectorBanner, renderInlineDeleteBanner } from './propertiesShared';

interface CableTrayInspectorProps {
  project: ProjectState;
  selectedTray: CableTray;
  isReadOnlyMode: boolean;
  confirmDeleteKey: string | null;
  setConfirmDeleteKey: (key: string | null) => void;
  onUpdateTray: (trayId: string, partial: Partial<CableTray>) => void;
  onDeleteTray: (trayId: string) => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
}

const TRAY_COLOR_SWATCHES = ['#0284c7', '#0d9488', '#e11d48', '#d97706', '#4f46e5', '#475569'];

const TRAY_KIND_LABEL: Record<CableTrayKind, string> = {
  network_tray: 'Máng cáp mạng / ELV',
  power_tray: 'Máng cáp điện lực',
  conduit: 'Ống luồn dây PVC / Thép'
};

export const CableTrayInspector: React.FC<CableTrayInspectorProps> = ({
  project,
  selectedTray,
  isReadOnlyMode,
  confirmDeleteKey,
  setConfirmDeleteKey,
  onUpdateTray,
  onDeleteTray,
  onToggleCollapse,
  onClosePanel
}) => {
  const scale = normalizeScalePxPerMeter(project.settings.scale);
  const lengthMeters = computeCableTrayLengthMeters(selectedTray, scale);
  const floor = project.floors.find(f => f.id === selectedTray.floorId);

  const routedCablesCount = React.useMemo(() => {
    const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
    let count = 0;
    for (const cable of project.cables) {
      const src = nodeMap.get(cable.sourceNodeId);
      const tgt = nodeMap.get(cable.targetNodeId);
      if (!src || !tgt) continue;
      const info = calculateTrayAwareCableLengthMeters(
        cable,
        { x: src.x, y: src.y, width: src.width, height: src.height },
        { x: tgt.x, y: tgt.y, width: tgt.width, height: tgt.height },
        [selectedTray],
        scale
      );
      if (info.routedViaTrayName) count += 1;
    }
    return count;
  }, [project.cables, project.nodes, selectedTray, scale]);

  const isLocked = Boolean(selectedTray.locked);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text overflow-y-auto">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-md text-white flex items-center justify-center shrink-0"
            style={{
              backgroundColor:
                selectedTray.color ||
                (selectedTray.kind === 'power_tray'
                  ? '#e11d48'
                  : selectedTray.kind === 'conduit'
                  ? '#0d9488'
                  : '#0284c7')
            }}
          >
            <Route className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              {selectedTray.name}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {TRAY_KIND_LABEL[selectedTray.kind]} · {floor?.name || 'Toàn dự án'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!isReadOnlyMode && (
            <button
              type="button"
              onClick={() => onUpdateTray(selectedTray.id, { locked: !isLocked })}
              aria-label={isLocked ? 'Mở khóa tuyến máng' : 'Khóa tuyến máng'}
              className={`p-1.5 rounded-md transition-colors ${
                isLocked
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
              title={isLocked ? 'Mở khóa' : 'Khóa vị trí'}
            >
              {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          )}
          {!isReadOnlyMode && (
            <button
              type="button"
              onClick={() => setConfirmDeleteKey(`tray_${selectedTray.id}`)}
              aria-label="Xóa máng cáp"
              className="p-1.5 hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-950/40 rounded-md transition-colors"
              title="Xóa máng cáp"
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
              type="button"
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
        `tray_${selectedTray.id}`,
        `tuyến "${selectedTray.name}"`,
        () => onDeleteTray(selectedTray.id),
        isReadOnlyMode
      )}

      <div className="p-3.5 space-y-3.5">
        <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-slate-800/30">
          <div className="px-2.5 py-2">
            <div className="text-[11px] text-slate-500">Chiều dài</div>
            <div className="font-semibold font-mono tabular-nums text-[#155EEF] dark:text-blue-400 mt-0.5">
              {lengthMeters} m
            </div>
          </div>
          <div className="px-2.5 py-2">
            <div className="text-[11px] text-slate-500">Điểm gãy</div>
            <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
              {selectedTray.points.length} điểm
            </div>
          </div>
          <div className="px-2.5 py-2">
            <div className="text-[11px] text-slate-500">Cáp đi qua</div>
            <div className="font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
              {routedCablesCount} tuyến
            </div>
          </div>
        </div>

        <fieldset disabled={isReadOnlyMode || isLocked} className="space-y-3.5 disabled:opacity-70">
          <div>
            <label className="ent-label">Tên tuyến máng / Ống gen</label>
            <input
              type="text"
              value={selectedTray.name}
              onChange={e => onUpdateTray(selectedTray.id, { name: e.target.value })}
              className="ent-input font-medium"
            />
          </div>

          <div>
            <label className="ent-label">Phân loại hạ tầng</label>
            <select
              value={selectedTray.kind}
              onChange={e => onUpdateTray(selectedTray.id, { kind: e.target.value as CableTrayKind })}
              className="ent-select"
            >
              <option value="network_tray">Máng cáp mạng / ELV (Network Tray)</option>
              <option value="power_tray">Máng cáp điện lực (Power Tray)</option>
              <option value="conduit">Ống luồn dây PVC / Thép (Conduit)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="ent-label">Bề rộng hiển thị (px)</label>
              <input
                type="number"
                min={8}
                max={64}
                step={2}
                value={selectedTray.widthPx}
                onChange={e =>
                  onUpdateTray(selectedTray.id, {
                    widthPx: Math.max(8, Math.min(64, parseInt(e.target.value, 10) || 16))
                  })
                }
                className="ent-input font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="ent-label">Thuộc tầng</label>
              <select
                value={selectedTray.floorId || ''}
                onChange={e =>
                  onUpdateTray(selectedTray.id, {
                    floorId: e.target.value || undefined
                  })
                }
                className="ent-select"
              >
                <option value="">Toàn dự án</option>
                {project.floors.map(fl => (
                  <option key={fl.id} value={fl.id}>
                    {fl.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-slate-500 text-xs block mb-1">Màu hiển thị tuyến</label>
            <div className="flex items-center gap-1.5">
              {TRAY_COLOR_SWATCHES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateTray(selectedTray.id, { color: c })}
                  aria-label={`Chọn màu máng ${c}`}
                  className={`w-6 h-6 rounded border ${
                    (selectedTray.color || '') === c
                      ? 'ring-2 ring-blue-500 scale-110 border-white'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {selectedTray.points.length >= 2 && (
            <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Chỉnh sửa điểm tuyến
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const lastIdx = selectedTray.points.length - 1;
                    const a = selectedTray.points[lastIdx - 1];
                    const b = selectedTray.points[lastIdx];
                    const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
                    const nextPts = [
                      ...selectedTray.points.slice(0, lastIdx),
                      mid,
                      selectedTray.points[lastIdx]
                    ];
                    onUpdateTray(selectedTray.id, { points: nextPts });
                  }}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium hover:border-[#155EEF]"
                >
                  + Chèn điểm giữa
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Kéo trực tiếp các chấm tròn trên bản vẽ 2D để bẻ góc hoặc mở rộng tuyến máng.
              </p>
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
};
