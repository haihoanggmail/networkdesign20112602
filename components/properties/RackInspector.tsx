import React, { useState } from 'react';
import {
  AlertTriangle,
  Box,
  ChevronRight,
  Maximize2,
  RotateCw,
  Trash2,
  Wind,
  X
} from 'lucide-react';
import {
  DiagramNode,
  ProjectState,
  RackSide,
  STANDARD_RACK_UNITS,
  ServerRack
} from '../../types/infrastructure';
import { normalizeRotationDeg } from '../../utils/coverageUtils';
import {
  clampRackUnits,
  computeRackPduOutletSummary,
  findContiguousFreeUBlocks,
  getAssetUHeight,
  getRackStatistics
} from '../../utils/rackGeometry';
import { analyzeRackAirflow } from '../../utils/rackAirflow';
import { AuditIssue } from '../../utils/engineeringValidator';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';
import { ReadOnlyInspectorBanner, renderInlineDeleteBanner } from './propertiesShared';

type RackTab = 'overview' | 'mounting' | 'stats';

interface RackInspectorProps {
  project: ProjectState;
  selectedRack: ServerRack;
  selectedNode?: DiagramNode;
  auditIssues: AuditIssue[];
  isReadOnlyMode: boolean;
  layoutTier: LayoutTier;
  confirmDeleteKey: string | null;
  setConfirmDeleteKey: (key: string | null) => void;
  onUpdateRack: (rackId: string, partial: Partial<ServerRack>) => void;
  onUpdateNode?: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onDeleteRack: (rackId: string) => void;
  onOpenDeepInspect: (id: string, rackView?: '2d' | '3d') => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
}

export const RackInspector: React.FC<RackInspectorProps> = ({
  project,
  selectedRack,
  selectedNode,
  auditIssues,
  isReadOnlyMode,
  layoutTier,
  confirmDeleteKey,
  setConfirmDeleteKey,
  onUpdateRack,
  onUpdateNode,
  onDeleteRack,
  onOpenDeepInspect,
  onRemoveDeviceFromRackSlot,
  onToggleCollapse,
  onClosePanel
}) => {
  const [rackTab, setRackTab] = useState<RackTab>('overview');
  const rackStats = getRackStatistics(selectedRack, project.assets);
  const rackIssues = auditIssues.filter(i => i.targetId === selectedRack.id);
  const frontEntries = Object.entries(selectedRack.slots || {})
    .map(([u, devId]) => ({ startU: parseInt(u, 10), devId, side: 'front' as RackSide }))
    .filter(e => !Number.isNaN(e.startU));
  const rearEntries = Object.entries(selectedRack.rearSlots || {})
    .map(([u, devId]) => ({ startU: parseInt(u, 10), devId, side: 'rear' as RackSide }))
    .filter(e => !Number.isNaN(e.startU));
  const allMounted = [...frontEntries, ...rearEntries].sort((a, b) => b.startU - a.startU);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0">
            <Box className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              {selectedRack.name}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Rack {selectedRack.totalUnits}U · 19&quot;
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => onOpenDeepInspect(selectedRack.id)}
            aria-label='Mở mặt dựng 19"'
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-[#155EEF] dark:text-blue-400 transition-colors"
            title='Mở mặt dựng 19"'
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {!isReadOnlyMode && (
            <button
              onClick={() => setConfirmDeleteKey(`rack_${selectedRack.id}`)}
              aria-label="Xóa tủ rack"
              className="p-1.5 hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-950/40 rounded-md transition-colors"
              title="Xóa tủ rack"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Thu gọn bảng thuộc tính"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              title="Thu gọn bảng thuộc tính"
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

      {/* Segmented Tabs */}
      <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="grid grid-cols-3 gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md">
          {(
            [
              { id: 'overview', label: 'Tổng quan' },
              { id: 'mounting', label: `Gá TB (${allMounted.length})` },
              { id: 'stats', label: 'Thống kê' }
            ] as const
          ).map(t => (
            <button
              key={t.id}
              onClick={() => setRackTab(t.id)}
              className={`py-1 px-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                rackTab === t.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-semibold shadow-2xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isReadOnlyMode && <ReadOnlyInspectorBanner />}
      {renderInlineDeleteBanner(
        confirmDeleteKey,
        setConfirmDeleteKey,
        `rack_${selectedRack.id}`,
        `tủ "${selectedRack.name}"`,
        () => onDeleteRack(selectedRack.id),
        isReadOnlyMode
      )}

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        <div className="grid grid-cols-1 gap-1.5">
          <button
            onClick={() => onOpenDeepInspect(selectedRack.id, '3d')}
            className="w-full py-2 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
          >
            <Wind className="w-3.5 h-3.5" />
            <span>Mở Tủ Rack 3D &amp; Thông Gió</span>
          </button>
          <button
            onClick={() => onOpenDeepInspect(selectedRack.id, '2d')}
            className="ent-btn-primary w-full"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Mở Mặt Dựng 19&quot; (2D Trước / Sau)</span>
          </button>
        </div>

        {(rackStats.overflowItems.length > 0 || rackStats.isOverweight || rackIssues.length > 0) && (
          <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-200 flex items-start gap-2 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {rackStats.overflowItems.length > 0 && (
                <div>Vượt chiều cao tủ: {rackStats.overflowItems.map(i => `${i.name} (U${i.startU})`).join(', ')}</div>
              )}
              {rackStats.isOverweight && (
                <div>
                  Quá tải trọng ({rackStats.totalWeightKg.toFixed(1)}kg &gt; {rackStats.maxLoadKg}kg)
                </div>
              )}
              {rackIssues.map(iss => (
                <div key={iss.id}>{iss.title}</div>
              ))}
            </div>
          </div>
        )}

        {rackTab === 'overview' && (
          <fieldset disabled={isReadOnlyMode} className="space-y-3">
            <div>
              <label className="ent-label">Tên tủ Rack</label>
              <input
                type="text"
                value={selectedRack.name}
                onChange={e => onUpdateRack(selectedRack.id, { name: e.target.value })}
                className="ent-input font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="ent-label">Chiều cao chuẩn U</label>
                <select
                  value={(STANDARD_RACK_UNITS as readonly number[]).includes(selectedRack.totalUnits) ? String(selectedRack.totalUnits) : 'custom'}
                  onChange={e => {
                    if (e.target.value !== 'custom') {
                      onUpdateRack(selectedRack.id, { totalUnits: parseInt(e.target.value, 10) });
                    }
                  }}
                  className="ent-select font-semibold font-mono"
                >
                  {STANDARD_RACK_UNITS.map(u => (
                    <option key={u} value={u}>
                      {u}U
                    </option>
                  ))}
                  {!(STANDARD_RACK_UNITS as readonly number[]).includes(selectedRack.totalUnits) && (
                    <option value="custom">Tùy chỉnh ({selectedRack.totalUnits}U)</option>
                  )}
                </select>
              </div>
              <div>
                <label className="ent-label">U Tùy chỉnh (4–60U)</label>
                <input
                  type="number"
                  min={4}
                  max={60}
                  value={selectedRack.totalUnits}
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      onUpdateRack(selectedRack.id, { totalUnits: clampRackUnits(val) });
                    }
                  }}
                  className="ent-input font-mono font-semibold tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="ent-label">Độ sâu (Depth)</label>
                <select
                  value={selectedRack.depthMm}
                  onChange={e => onUpdateRack(selectedRack.id, { depthMm: parseInt(e.target.value, 10) })}
                  className="ent-select"
                >
                  <option value="600">600mm (Network)</option>
                  <option value="800">800mm (Switch + Server)</option>
                  <option value="1000">1000mm (Server sâu)</option>
                  <option value="1200">1200mm (Enterprise)</option>
                </select>
              </div>
              <div>
                <label className="ent-label">Tải tối đa (kg)</label>
                <input
                  type="number"
                  min={50}
                  max={3000}
                  value={selectedRack.maxLoadKg}
                  onChange={e => onUpdateRack(selectedRack.id, { maxLoadKg: parseInt(e.target.value, 10) || 1000 })}
                  className="ent-input font-mono tabular-nums"
                />
              </div>
            </div>

            {selectedNode && onUpdateNode && (
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
                      aria-label="Hướng xoay tủ Rack (độ)"
                      value={Math.round(normalizeRotationDeg(selectedNode.rotation || 0))}
                      onChange={e => {
                        const parsed = parseFloat(e.target.value);
                        if (!Number.isNaN(parsed)) {
                          onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(parsed) });
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
                  aria-label="Thanh trượt góc xoay tủ Rack"
                  value={Math.round(normalizeRotationDeg(selectedNode.rotation || 0))}
                  onChange={e =>
                    onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(parseFloat(e.target.value)) })
                  }
                  className="w-full accent-cyan-600"
                />
                <div className="grid grid-cols-5 gap-1 text-[10px] font-mono">
                  {[
                    { label: '-45°', val: normalizeRotationDeg((selectedNode.rotation || 0) - 45) },
                    { label: '-15°', val: normalizeRotationDeg((selectedNode.rotation || 0) - 15) },
                    { label: '0°', val: 0 },
                    { label: '+15°', val: normalizeRotationDeg((selectedNode.rotation || 0) + 15) },
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
            )}
          </fieldset>
        )}

        {rackTab === 'mounting' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 text-xs font-medium">
                Thiết bị đang gá ({allMounted.length})
              </span>
              <span className="text-xs text-slate-400">Trước &amp; Sau</span>
            </div>
            <div className="space-y-1">
              {allMounted.map(({ startU, devId, side }) => {
                const dev = project.assets[devId];
                const uH = getAssetUHeight(dev);
                return (
                  <div
                    key={`${side}_${startU}_${devId}`}
                    className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-xs font-bold px-1 rounded ${
                          side === 'rear'
                            ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'
                            : 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400'
                        }`}
                      >
                        {side === 'rear' ? 'S' : 'T'}
                      </span>
                      <span className="font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                        {uH > 1 ? `U${startU}-${startU + uH - 1}` : `U${startU}`}
                      </span>
                      <span className="truncate font-medium">{dev?.name || devId}</span>
                    </div>
                    {!isReadOnlyMode && (
                      <button
                        onClick={() => onRemoveDeviceFromRackSlot?.(selectedRack.id, startU, side)}
                        aria-label={`Tháo ${dev?.name || devId} khỏi tủ`}
                        className="text-rose-500 hover:text-rose-700 p-1 shrink-0"
                        title="Tháo thiết bị khỏi tủ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {allMounted.length === 0 && (
                <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                  Chưa gá thiết bị nào. Kéo thiết bị vào khe U trên bản vẽ hoặc mở Mặt Dựng 19&quot;.
                </div>
              )}
            </div>
          </div>
        )}

        {rackTab === 'stats' && (() => {
          const freeBlocksFront = findContiguousFreeUBlocks(selectedRack, project.assets, 2, 'front');
          const freeBlocksRear = findContiguousFreeUBlocks(selectedRack, project.assets, 2, 'rear');
          const pduSummary = computeRackPduOutletSummary(selectedRack, project.assets);
          const airflow = analyzeRackAirflow(selectedRack, project.assets);
          return (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex justify-between">
                  <span>Tỷ lệ sử dụng không gian U</span>
                  <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
                    {rackStats.utilizationPct}%
                  </span>
                </div>
                <div className="w-full h-2 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full bg-blue-600" style={{ width: `${rackStats.utilizationPct}%` }} />
                </div>
                <div className="space-y-1.5 pt-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mặt Trước (Dùng / Trống):</span>
                    <span className="font-semibold font-mono tabular-nums">
                      {rackStats.frontUsedUnits}U / {rackStats.frontFreeUnits}U
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mặt Sau (Dùng / Trống):</span>
                    <span className="font-semibold font-mono tabular-nums">
                      {rackStats.rearUsedUnits}U / {rackStats.rearFreeUnits}U
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tổng công suất tiêu thụ:</span>
                    <span className="font-semibold font-mono tabular-nums text-amber-600">
                      {rackStats.totalPowerWatts} W ({(rackStats.totalPowerWatts / 1000).toFixed(2)} kW)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tổng tải trọng:</span>
                    <span className={`font-semibold font-mono tabular-nums ${rackStats.isOverweight ? 'text-rose-600' : ''}`}>
                      {rackStats.totalWeightKg.toFixed(1)} / {rackStats.maxLoadKg} kg
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Khối U trống liên tiếp (≥2U)
                </div>
                <div className="space-y-1.5 text-xs">
                  <div>
                    <div className="text-slate-500 mb-1">Mặt trước:</div>
                    {freeBlocksFront.length === 0 ? (
                      <span className="text-slate-400">Không còn dải ≥2U trống</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {freeBlocksFront.slice(0, 5).map(b => (
                          <span
                            key={`f_${b.startU}_${b.endU}`}
                            className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 font-mono text-[11px] text-emerald-700 dark:text-emerald-300"
                          >
                            U{b.startU}–U{b.endU} ({b.size}U)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">Mặt sau:</div>
                    {freeBlocksRear.length === 0 ? (
                      <span className="text-slate-400">Không còn dải ≥2U trống</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {freeBlocksRear.slice(0, 5).map(b => (
                          <span
                            key={`r_${b.startU}_${b.endU}`}
                            className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 font-mono text-[11px] text-sky-700 dark:text-sky-300"
                          >
                            U{b.startU}–U{b.endU} ({b.size}U)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    Tổng ổ cắm PDU (C13/C19)
                  </span>
                  <span
                    className={`font-mono font-semibold tabular-nums ${
                      pduSummary.isOverCapacity ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {pduSummary.usedOutlets} / {pduSummary.totalOutlets} ổ
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between">
                  <span>Số thanh PDU: {pduSummary.pduCount}</span>
                  <span>TB cần nguồn: {pduSummary.poweredDeviceCount}</span>
                </div>
                {pduSummary.isOverCapacity && (
                  <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                    {pduSummary.pduCount === 0
                      ? 'Chưa gắn thanh nguồn PDU cho thiết bị trong tủ.'
                      : 'Số thiết bị dùng điện vượt quá số ổ cắm PDU khả dụng.'}
                  </div>
                )}
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1">
                    <Wind className="w-3.5 h-3.5 text-cyan-600" />
                    Thông gió &amp; Tải nhiệt
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      airflow.status === 'critical'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : airflow.status === 'warning'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}
                  >
                    {airflow.status === 'critical'
                      ? 'Quá nhiệt'
                      : airflow.status === 'warning'
                        ? 'Cần tối ưu'
                        : 'Đạt chuẩn'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between font-mono">
                  <span>{airflow.totalBtuPerHour} BTU/h</span>
                  <span>
                    {airflow.effectiveCoolingCfm}/{airflow.requiredCfm} CFM ({airflow.estimatedExhaustTempC}°C)
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
