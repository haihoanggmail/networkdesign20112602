import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronRight,
  Eye,
  GitBranch,
  RotateCcw,
  RotateCw,
  Route,
  Ruler,
  Tag,
  Trash2,
  Type,
  X
} from 'lucide-react';
import { CableEdge, ProjectState } from '../../types/infrastructure';
import {
  CABLE_SIGNAL_COLOR_PRESETS,
  RectBox,
  computeCablePath,
  computeOpticalLinkBudget,
  computeRealTimeCableLengthBreakdown,
  normalizeCableColor,
  resolveCableLabelTransform
} from '../../utils/cableRouting';
import { AuditIssue } from '../../utils/engineeringValidator';
import { MAX_SCALE_PX_PER_METER, MIN_SCALE_PX_PER_METER, normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import { evaluatePortPairCompatibility, pickBestCompatiblePortPair } from '../../utils/portCompatibility';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';
import { formatVnd, loadBomPriceOverrides, resolveCableSkuAndPrice } from '../../utils/bomPricingCatalog';
import { ReadOnlyInspectorBanner, renderInlineDeleteBanner } from './propertiesShared';

type CableTab = 'overview' | 'endpoints' | 'display' | 'advanced';

interface CableInspectorProps {
  project: ProjectState;
  selectedCable: CableEdge;
  auditIssues: AuditIssue[];
  isReadOnlyMode: boolean;
  layoutTier: LayoutTier;
  confirmDeleteKey: string | null;
  setConfirmDeleteKey: (key: string | null) => void;
  onUpdateCable: (cableId: string, partial: Partial<CableEdge>) => void;
  onSetCableColor?: (cableId: string, color: string) => void;
  onSetCablesColorByType?: (cableType: CableEdge['cableType'], color: string) => void;
  onReconnectCableEndpoint?: (cableId: string, endpoint: 'source' | 'target', newNodeId: string) => void;
  onUpdateSettings: (partial: Partial<ProjectState['settings']>) => void;
  onDeleteCable: (cableId: string) => void;
  onAutoRouteCable?: (cableId: string) => void;
  onAutoRouteAllCables?: () => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
}

export const CableInspector: React.FC<CableInspectorProps> = ({
  project,
  selectedCable,
  auditIssues,
  isReadOnlyMode,
  layoutTier,
  confirmDeleteKey,
  setConfirmDeleteKey,
  onUpdateCable,
  onSetCableColor,
  onSetCablesColorByType,
  onReconnectCableEndpoint,
  onUpdateSettings,
  onDeleteCable,
  onAutoRouteCable,
  onAutoRouteAllCables,
  onToggleCollapse,
  onClosePanel
}) => {
  const [cableTab, setCableTab] = useState<CableTab>('overview');
  const cableSlackFactor = selectedCable.slackFactor ?? 1.15;
  const fiberConnectors = selectedCable.fiberConnectors ?? 2;
  const fiberSplices = selectedCable.fiberSplices ?? 2;

  const cableIssues = auditIssues.filter(i => i.targetId === selectedCable.id);

  const resolveEndpoint = (nodeId: string): { rect: RectBox | null; floorId?: string } => {
    const directNode = project.nodes.find(n => n.id === nodeId);
    if (directNode) {
      return {
        rect: { x: directNode.x, y: directNode.y, width: directNode.width, height: directNode.height },
        floorId: directNode.floorId
      };
    }
    const assetRackId = project.assets[nodeId]?.rackId;
    const rackNode = project.nodes.find(
      n => n.type === 'rack' && (n.customData?.rackId === nodeId || n.customData?.rackId === assetRackId || n.id === nodeId)
    );
    if (rackNode) {
      return {
        rect: { x: rackNode.x, y: rackNode.y, width: rackNode.width, height: rackNode.height },
        floorId: rackNode.floorId
      };
    }
    return { rect: null };
  };

  const sourceInfo = resolveEndpoint(selectedCable.sourceNodeId);
  const targetInfo = resolveEndpoint(selectedCable.targetNodeId);
  const sourceNode = project.nodes.find(n => n.id === selectedCable.sourceNodeId);
  const targetNode = project.nodes.find(n => n.id === selectedCable.targetNodeId);
  const sourceAsset = sourceNode?.assetId ? project.assets[sourceNode.assetId] : undefined;
  const targetAsset = targetNode?.assetId ? project.assets[targetNode.assetId] : undefined;

  const sourceFloor = project.floors.find(f => f.id === sourceInfo.floorId);
  const targetFloor = project.floors.find(f => f.id === targetInfo.floorId);
  const floorLevelDiff =
    sourceFloor && targetFloor && sourceFloor.id !== targetFloor.id
      ? Math.abs(sourceFloor.level - targetFloor.level)
      : 0;
  const buildingFloorHeightMeters = project.buildings[0]?.floorHeightMeters || 3.8;
  const scalePxPerMeter = normalizeScalePxPerMeter(project.settings.scale);

  const liveLengthBreakdown =
    sourceInfo.rect && targetInfo.rect
      ? computeRealTimeCableLengthBreakdown(selectedCable, sourceInfo.rect, targetInfo.rect, {
          pxPerMeter: scalePxPerMeter,
          slackFactor: cableSlackFactor,
          floorLevelDiff,
          floorHeightMeters: buildingFloorHeightMeters
        })
      : null;

  const isLengthSynced =
    liveLengthBreakdown !== null &&
    Math.abs(selectedCable.lengthMeters - liveLengthBreakdown.totalEstimatedMeters) < 0.05;

  const livePathInfo =
    sourceInfo.rect && targetInfo.rect
      ? computeCablePath(selectedCable, sourceInfo.rect, targetInfo.rect)
      : { midPoint: { x: 0, y: 0 }, midAngleDeg: 0 };
  const liveLabelTransform = resolveCableLabelTransform(selectedCable, livePathInfo);
  const isCableLabelsHidden = Boolean(
    project.settings.hiddenLayers?.includes('cable_labels') ||
      project.settings.hiddenLayers?.includes('labels')
  );
  const activeColor = normalizeCableColor(selectedCable.color || '#155eef');

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text">
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
            style={{ backgroundColor: activeColor }}
          >
            <GitBranch className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold font-mono text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              {selectedCable.label || selectedCable.cableCode}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
              {selectedCable.cableCode} · {selectedCable.bandwidth} · {selectedCable.lengthMeters}m
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!isReadOnlyMode && (
            <button
              type="button"
              onClick={() => setConfirmDeleteKey(`cable_${selectedCable.id}`)}
              aria-label="Xóa tuyến cáp"
              className="p-1.5 hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-950/40 rounded-md transition-colors"
              title="Xóa tuyến cáp"
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

      {/* 4 Segmented Tabs */}
      <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="grid grid-cols-4 gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md">
          {(
            [
              { id: 'overview', label: 'Tổng quan' },
              { id: 'endpoints', label: 'Kết nối' },
              { id: 'display', label: 'Hiển thị' },
              { id: 'advanced', label: 'Nâng cao' }
            ] as const
          ).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCableTab(t.id)}
              className={`py-1 px-1 rounded text-xs font-medium whitespace-nowrap truncate transition-colors ${
                cableTab === t.id
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
        `cable_${selectedCable.id}`,
        `tuyến cáp ${selectedCable.cableCode}`,
        () => onDeleteCable(selectedCable.id),
        isReadOnlyMode
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {cableIssues.length > 0 && (
          <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 space-y-1 text-xs">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Cảnh báo tuyến cáp ({cableIssues.length})</span>
            </div>
            {cableIssues.map(iss => (
              <div key={iss.id} className="text-xs leading-snug">
                • {iss.title}
              </div>
            ))}
          </div>
        )}

        {/* TAB: TỔNG QUAN */}
        {cableTab === 'overview' && (
          <div className="space-y-3">
            {!isReadOnlyMode && onAutoRouteCable && (
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    <Route className="w-3.5 h-3.5 text-blue-600" />
                    <span>Định tuyến tránh vật cản</span>
                  </span>
                  <span className="text-xs font-mono text-slate-400">A* Orthogonal</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAutoRouteCable(selectedCable.id)}
                    className="py-1.5 px-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Route className="w-3.5 h-3.5" />
                    <span>Tự định tuyến</span>
                  </button>
                  {onAutoRouteAllCables && (
                    <button
                      type="button"
                      onClick={onAutoRouteAllCables}
                      className="py-1.5 px-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
                    >
                      Tất cả cáp
                    </button>
                  )}
                </div>
              </div>
            )}

            <fieldset disabled={isReadOnlyMode} className="contents">
              <div>
                <label className="text-slate-500 text-xs block mb-1">Mã định danh cáp</label>
                <input
                  type="text"
                  value={selectedCable.cableCode}
                  onChange={e => onUpdateCable(selectedCable.id, { cableCode: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-semibold disabled:opacity-70"
                />
              </div>

              <div>
                <label className="text-slate-500 text-xs block mb-1">Loại cáp truyền dẫn</label>
                <select
                  value={selectedCable.cableType}
                  onChange={e =>
                    onUpdateCable(selectedCable.id, { cableType: e.target.value as CableEdge['cableType'] })
                  }
                  className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-70"
                >
                  <option value="CAT6_UTP">Cat6 UTP (1Gbps)</option>
                  <option value="CAT6A_STP">Cat6A STP bọc kim (10Gbps)</option>
                  <option value="FIBER_SM_OS2">Cáp quang Single-mode OS2</option>
                  <option value="FIBER_MM_OM4">Cáp quang Multi-mode OM4</option>
                  <option value="DAC_10G">Cáp đồng DAC 10G/40G</option>
                  <option value="POWER_AC">Dây nguồn AC 220V</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Băng thông</label>
                  <select
                    value={selectedCable.bandwidth}
                    onChange={e =>
                      onUpdateCable(selectedCable.id, { bandwidth: e.target.value as CableEdge['bandwidth'] })
                    }
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-70"
                  >
                    <option value="1G">1 Gbps</option>
                    <option value="10G">10 Gbps</option>
                    <option value="25G">25 Gbps</option>
                    <option value="40G">40 Gbps</option>
                    <option value="100G">100 Gbps</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Chiều dài BOM (m)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={selectedCable.lengthMeters}
                    onChange={e => onUpdateCable(selectedCable.id, { lengthMeters: parseFloat(e.target.value) || 1 })}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums disabled:opacity-70"
                  />
                </div>
              </div>
            </fieldset>

            {(() => {
              const cablePricing = resolveCableSkuAndPrice(selectedCable.cableType, loadBomPriceOverrides());
              const estimatedCableCost = Math.round((selectedCable.lengthMeters || 0) * cablePricing.unitPriceVnd);
              return (
                <div className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Mã vật tư (SKU)</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-100 truncate block">
                      {cablePricing.sku}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Dự toán tạm</span>
                    <span className="font-mono font-semibold tabular-nums text-[#155EEF] dark:text-blue-400">
                      {formatVnd(estimatedCableCost)}
                    </span>
                  </div>
                </div>
              );
            })()}

            {liveLengthBreakdown && (
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold flex items-center gap-1">
                    <Ruler className="w-3.5 h-3.5 text-blue-600" />
                    <span>Ước tính chiều dài thực tế</span>
                  </span>
                  <span className="text-sm font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
                    {liveLengthBreakdown.totalEstimatedMeters} m
                  </span>
                </div>

                <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300 border-t border-slate-200 dark:border-slate-700 pt-1.5">
                  <div className="flex justify-between">
                    <span>Theo tuyến ({liveLengthBreakdown.pathPixels} px):</span>
                    <span className="font-mono tabular-nums font-medium">
                      {liveLengthBreakdown.horizontalMeters} m
                    </span>
                  </div>
                  {liveLengthBreakdown.isCrossFloor && (
                    <div className="flex justify-between text-amber-700 dark:text-amber-400">
                      <span>Thông tầng ({floorLevelDiff} × {buildingFloorHeightMeters}m):</span>
                      <span className="font-mono tabular-nums">+{liveLengthBreakdown.verticalRiseMeters} m</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Độ chùng (+{Math.round((liveLengthBreakdown.slackFactor - 1) * 100)}%):</span>
                    <span className="font-mono tabular-nums">+{liveLengthBreakdown.slackMeters} m</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                  <div>
                    <label className="text-xs text-slate-500 block mb-0.5">Tỷ lệ (px/m)</label>
                    <input
                      type="number"
                      min={MIN_SCALE_PX_PER_METER}
                      max={MAX_SCALE_PX_PER_METER}
                      step="any"
                      disabled={isReadOnlyMode}
                      value={scalePxPerMeter}
                      onChange={e => onUpdateSettings({ scale: normalizeScalePxPerMeter(Number(e.target.value)) })}
                      className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs disabled:opacity-70"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-0.5">Dự phòng</label>
                    <div className="grid grid-cols-4 gap-0.5 bg-white dark:bg-slate-900 p-0.5 rounded border border-slate-200 dark:border-slate-700">
                      {[1.0, 1.1, 1.15, 1.2].map(factor => {
                        const pct = Math.round((factor - 1) * 100);
                        const active = Math.abs(cableSlackFactor - factor) < 0.005;
                        return (
                          <button
                            key={factor}
                            type="button"
                            disabled={isReadOnlyMode}
                            onClick={() => onUpdateCable(selectedCable.id, { slackFactor: factor })}
                            className={`py-0.5 rounded text-xs font-mono font-semibold ${
                              active ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {pct}%
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  {isLengthSynced ? (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      Đã khớp BOM ({selectedCable.lengthMeters} m)
                    </span>
                  ) : (
                    <>
                      <span className="text-xs text-slate-500 font-mono">
                        Lệch: {(liveLengthBreakdown.totalEstimatedMeters - selectedCable.lengthMeters) >= 0 ? '+' : ''}
                        {(liveLengthBreakdown.totalEstimatedMeters - selectedCable.lengthMeters).toFixed(1)} m
                      </span>
                      {!isReadOnlyMode && (
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateCable(selectedCable.id, {
                              lengthMeters: liveLengthBreakdown.totalEstimatedMeters
                            })
                          }
                          className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                        >
                          Áp dụng {liveLengthBreakdown.totalEstimatedMeters} m
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {(selectedCable.cableType === 'FIBER_SM_OS2' || selectedCable.cableType === 'FIBER_MM_OM4') && (() => {
              const budget = computeOpticalLinkBudget({
                cableType: selectedCable.cableType,
                lengthMeters: selectedCable.lengthMeters || 0,
                connectorCount: fiberConnectors,
                spliceCount: fiberSplices
              });
              return (
                <div className="p-2.5 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs text-amber-900 dark:text-amber-200">
                      Quỹ suy hao quang (Optical Link Budget)
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold ${
                        budget.status === 'nominal'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : budget.status === 'marginal'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                      }`}
                    >
                      {budget.status === 'nominal'
                        ? 'Đạt chuẩn'
                        : budget.status === 'marginal'
                        ? 'Sát ngưỡng'
                        : 'Vượt ngưỡng'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-0.5">Số đầu nối (0.5 dB/đầu)</label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        disabled={isReadOnlyMode}
                        value={fiberConnectors}
                        onChange={e =>
                          onUpdateCable(selectedCable.id, {
                            fiberConnectors: Math.max(0, parseInt(e.target.value, 10) || 0)
                          })
                        }
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-0.5">Số mối hàn (0.1 dB/mối)</label>
                      <input
                        type="number"
                        min={0}
                        max={40}
                        disabled={isReadOnlyMode}
                        value={fiberSplices}
                        onChange={e =>
                          onUpdateCable(selectedCable.id, {
                            fiberSplices: Math.max(0, parseInt(e.target.value, 10) || 0)
                          })
                        }
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs disabled:opacity-70"
                      />
                    </div>
                  </div>
                  <div className="space-y-1 text-xs pt-1 border-t border-amber-200/70 dark:border-amber-900/50 font-mono tabular-nums">
                    <div className="flex justify-between">
                      <span className="font-sans text-slate-600 dark:text-slate-300">
                        Suy hao sợi ({budget.fiberAttenuationDbPerKm} dB/km):
                      </span>
                      <span>{budget.fiberLossDb} dB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-sans text-slate-600 dark:text-slate-300">Đầu nối + Mối hàn:</span>
                      <span>{(budget.connectorLossDb + budget.spliceLossDb).toFixed(2)} dB</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 dark:text-white">
                      <span className="font-sans">Tổng suy hao / Hạn mức:</span>
                      <span>
                        {budget.totalLossDb} / {budget.transceiverBudgetDb} dB (Dư {budget.marginDb} dB)
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB: KẾT NỐI (SOURCE & TARGET NODES + PORTS) */}
        {cableTab === 'endpoints' && (
          <fieldset disabled={isReadOnlyMode} className="contents">
            <div className="space-y-3">
              {/* Source */}
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Điểm đầu (Nguồn)
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-0.5">Thiết bị nguồn</label>
                  <select
                    value={selectedCable.sourceNodeId}
                    onChange={e => {
                      if (onReconnectCableEndpoint) {
                        onReconnectCableEndpoint(selectedCable.id, 'source', e.target.value);
                      } else {
                        onUpdateCable(selectedCable.id, { sourceNodeId: e.target.value, sourcePortId: undefined });
                      }
                    }}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs disabled:opacity-70"
                  >
                    {project.nodes
                      .filter(n => n.id !== selectedCable.targetNodeId && n.type !== 'legend')
                      .map(n => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))}
                  </select>
                </div>
                {sourceAsset && sourceAsset.ports.length > 0 && (
                  <div>
                    <label className="text-xs text-slate-500 block mb-0.5">Cổng trên thiết bị nguồn</label>
                    <select
                      value={selectedCable.sourcePortId || ''}
                      onChange={e =>
                        onUpdateCable(selectedCable.id, {
                          sourcePortId: e.target.value || undefined
                        })
                      }
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs disabled:opacity-70"
                    >
                      <option value="">-- Tự động / Chưa gán cổng --</option>
                      {sourceAsset.ports.map(pt => {
                        const usedByOther =
                          pt.status === 'up' && pt.connectedCableId && pt.connectedCableId !== selectedCable.id;
                        return (
                          <option key={pt.id} value={pt.id}>
                            {pt.name} ({pt.speed}
                            {pt.poe ? ' · PoE' : ''}){usedByOther ? ' [Đang bận]' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>

              {/* Swap Source/Target quick button */}
              {!isReadOnlyMode && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateCable(selectedCable.id, {
                      sourceNodeId: selectedCable.targetNodeId,
                      targetNodeId: selectedCable.sourceNodeId,
                      sourcePortId: selectedCable.targetPortId,
                      targetPortId: selectedCable.sourcePortId
                    })
                  }
                  className="w-full py-1.5 px-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-blue-600" />
                  <span>Đảo chiều Nguồn ↔ Đích</span>
                </button>
              )}

              {/* Target */}
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Điểm cuối (Đích)
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-0.5">Thiết bị đích</label>
                  <select
                    value={selectedCable.targetNodeId}
                    onChange={e => {
                      if (onReconnectCableEndpoint) {
                        onReconnectCableEndpoint(selectedCable.id, 'target', e.target.value);
                      } else {
                        onUpdateCable(selectedCable.id, { targetNodeId: e.target.value, targetPortId: undefined });
                      }
                    }}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs disabled:opacity-70"
                  >
                    {project.nodes
                      .filter(n => n.id !== selectedCable.sourceNodeId && n.type !== 'legend')
                      .map(n => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))}
                  </select>
                </div>
                {targetAsset && targetAsset.ports.length > 0 && (
                  <div>
                    <label className="text-xs text-slate-500 block mb-0.5">Cổng trên thiết bị đích</label>
                    <select
                      value={selectedCable.targetPortId || ''}
                      onChange={e =>
                        onUpdateCable(selectedCable.id, {
                          targetPortId: e.target.value || undefined
                        })
                      }
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs disabled:opacity-70"
                    >
                      <option value="">-- Tự động / Chưa gán cổng --</option>
                      {targetAsset.ports.map(pt => {
                        const usedByOther =
                          pt.status === 'up' && pt.connectedCableId && pt.connectedCableId !== selectedCable.id;
                        return (
                          <option key={pt.id} value={pt.id}>
                            {pt.name} ({pt.speed}
                            {pt.poe ? ' · PoE' : ''}){usedByOther ? ' [Đang bận]' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>
              {/* Port Compatibility Diagnostics for Endpoints */}
              {(() => {
                const normalizeSelfPort = (
                  p: NonNullable<typeof sourceAsset>['ports'][number] | undefined
                ) =>
                  p && p.connectedCableId === selectedCable.id
                    ? { ...p, status: 'unlinked' as const, connectedCableId: undefined, connectedTarget: undefined }
                    : p;
                const srcPort = sourceAsset?.ports.find(
                  p => p.id === selectedCable.sourcePortId || p.name === selectedCable.sourcePortId
                );
                const tgtPort = targetAsset?.ports.find(
                  p => p.id === selectedCable.targetPortId || p.name === selectedCable.targetPortId
                );
                const compat = evaluatePortPairCompatibility(
                  sourceAsset,
                  normalizeSelfPort(srcPort),
                  targetAsset,
                  normalizeSelfPort(tgtPort)
                );
                if (!srcPort && !tgtPort && compat.level === 'ok') return null;
                return (
                  <div
                    className={`p-2.5 rounded-lg border text-xs space-y-1.5 ${
                      compat.level === 'error'
                        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
                        : compat.level === 'warning'
                        ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
                        : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                    }`}
                  >
                    <div className="font-semibold">
                      {compat.level === 'ok'
                        ? `Cặp cổng tương thích (${compat.suggestedCableType || selectedCable.cableType})`
                        : compat.reasons[0]}
                    </div>
                    {!isReadOnlyMode &&
                      sourceAsset &&
                      targetAsset &&
                      sourceAsset.ports.length > 0 &&
                      targetAsset.ports.length > 0 &&
                      compat.level !== 'ok' && (
                        <button
                          type="button"
                          onClick={() => {
                            const freeSrc = sourceAsset.ports.map(p =>
                              p.connectedCableId === selectedCable.id
                                ? { ...p, status: 'unlinked' as const, connectedCableId: undefined, connectedTarget: undefined }
                                : p
                            );
                            const freeTgt = targetAsset.ports.map(p =>
                              p.connectedCableId === selectedCable.id
                                ? { ...p, status: 'unlinked' as const, connectedCableId: undefined, connectedTarget: undefined }
                                : p
                            );
                            const picked = pickBestCompatiblePortPair(freeSrc, freeTgt);
                            const pSrc = freeSrc.find(p => p.id === picked.sourcePortId);
                            const pTgt = freeTgt.find(p => p.id === picked.targetPortId);
                            const nextCompat = evaluatePortPairCompatibility(sourceAsset, pSrc, targetAsset, pTgt);
                            onUpdateCable(selectedCable.id, {
                              sourcePortId: picked.sourcePortId,
                              targetPortId: picked.targetPortId,
                              ...(nextCompat.suggestedCableType ? { cableType: nextCompat.suggestedCableType } : {})
                            });
                          }}
                          className="w-full py-1 px-2 rounded bg-white dark:bg-slate-900 border border-current/25 font-semibold hover:opacity-90"
                        >
                          Tự chọn cặp cổng tương thích
                        </button>
                      )}
                  </div>
                );
              })()}
            </div>
          </fieldset>
        )}

        {/* TAB: HIỂN THỊ (MÀU, NÉT, NHÃN CÁP) */}
        {cableTab === 'display' && (
          <fieldset disabled={isReadOnlyMode} className="contents">
            <div className="space-y-3">
              {/* Signal Colors */}
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Màu tuyến tín hiệu</span>
                  <span className="font-mono text-xs text-slate-500 uppercase tabular-nums">{activeColor}</span>
                </div>
                <div className="flex items-center flex-wrap gap-1.5">
                  {CABLE_SIGNAL_COLOR_PRESETS.map(preset => {
                    const isActive = activeColor.toLowerCase() === preset.color.toLowerCase();
                    return (
                      <button
                        key={preset.color}
                        type="button"
                        aria-label={`Màu cáp ${preset.label}`}
                        onClick={() =>
                          onSetCableColor
                            ? onSetCableColor(selectedCable.id, preset.color)
                            : onUpdateCable(selectedCable.id, { color: preset.color })
                        }
                        className={`w-6 h-6 rounded border transition-transform disabled:opacity-60 ${
                          isActive ? 'ring-2 ring-blue-500 scale-110 border-white' : 'border-black/15'
                        }`}
                        style={{ backgroundColor: preset.color }}
                        title={`${preset.label}: ${preset.signalRole}`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="flex items-center gap-1.5 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer shrink-0">
                    <span
                      className="w-4 h-4 rounded-xs border border-black/15"
                      style={{ backgroundColor: activeColor }}
                    />
                    <span className="text-xs">Chọn màu</span>
                    <input
                      type="color"
                      value={activeColor.slice(0, 7)}
                      onChange={e =>
                        onSetCableColor
                          ? onSetCableColor(selectedCable.id, e.target.value)
                          : onUpdateCable(selectedCable.id, { color: e.target.value })
                      }
                      className="sr-only"
                    />
                  </label>
                  <input
                    type="text"
                    value={selectedCable.color || '#155eef'}
                    onChange={e =>
                      onSetCableColor
                        ? onSetCableColor(selectedCable.id, e.target.value)
                        : onUpdateCable(selectedCable.id, { color: e.target.value })
                    }
                    className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs disabled:opacity-70"
                  />
                </div>
                {!isReadOnlyMode && onSetCablesColorByType && (
                  <button
                    type="button"
                    onClick={() => onSetCablesColorByType(selectedCable.cableType, activeColor)}
                    className="w-full py-1 px-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-400 text-xs font-medium"
                  >
                    Áp dụng cho toàn bộ cáp {selectedCable.cableType}
                  </button>
                )}
              </div>

              {/* Routing & Line Style */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Kiểu đi dây</label>
                  <select
                    value={selectedCable.routingType}
                    onChange={e =>
                      onUpdateCable(selectedCable.id, { routingType: e.target.value as CableEdge['routingType'] })
                    }
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-70"
                  >
                    <option value="orthogonal">Góc vuông (CAD)</option>
                    <option value="straight">Đường thẳng</option>
                    <option value="curved">Đường cong Bezier</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-xs block mb-1">Kiểu nét</label>
                  <select
                    value={selectedCable.lineStyle}
                    onChange={e =>
                      onUpdateCable(selectedCable.id, { lineStyle: e.target.value as CableEdge['lineStyle'] })
                    }
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-70"
                  >
                    <option value="solid">Nét liền (Solid)</option>
                    <option value="dashed">Nét đứt (Dashed)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <label className="text-slate-500 text-xs">Độ dày nét</label>
                <div className="flex items-center gap-1">
                  {[1.5, 2, 3, 4, 5].map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => onUpdateCable(selectedCable.id, { strokeWidth: w })}
                      className={`px-1.5 py-0.5 rounded border text-xs font-mono disabled:opacity-60 ${
                        selectedCable.strokeWidth === w
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {w}px
                    </button>
                  ))}
                </div>
              </div>

              {/* Cable Labeling */}
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5 text-blue-600" />
                    <span>Nhãn dây cáp</span>
                  </span>
                  {!isReadOnlyMode && (
                    <div className="flex items-center gap-2">
                      {isCableLabelsHidden && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextHidden = (project.settings.hiddenLayers || []).filter(
                              l => l !== 'cable_labels' && l !== 'labels'
                            );
                            onUpdateSettings({ hiddenLayers: nextHidden });
                          }}
                          className="text-xs font-semibold text-amber-600 hover:underline flex items-center gap-0.5"
                        >
                          <Eye className="w-3 h-3" /> Bật lớp nhãn
                        </button>
                      )}
                      {selectedCable.label && (
                        <button
                          type="button"
                          onClick={() => onUpdateCable(selectedCable.id, { label: undefined })}
                          className="text-xs text-slate-500 hover:text-rose-600"
                        >
                          Xóa nhãn
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  value={selectedCable.label || ''}
                  onChange={e => onUpdateCable(selectedCable.id, { label: e.target.value || undefined })}
                  placeholder="VD: Uplink 10G · VLAN 20"
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold disabled:opacity-70"
                />

                <div className="flex flex-wrap gap-1">
                  {['Uplink 10G', 'Trunk VLAN', 'PoE Camera', 'Wi-Fi 6 AP', 'Backup HA', 'Nguồn UPS'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => onUpdateCable(selectedCable.id, { label: preset })}
                      className={`px-1.5 py-0.5 rounded border text-xs font-medium disabled:opacity-60 ${
                        selectedCable.label === preset
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1">
                      <RotateCw className="w-3 h-3 text-blue-600" />
                      <span>Hướng nhãn</span>
                    </span>
                    <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400">
                      {liveLabelTransform.angleDeg}°
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 bg-white dark:bg-slate-900 p-0.5 rounded border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCable(selectedCable.id, { labelAutoOrient: true, labelRotation: undefined })
                      }
                      className={`py-1 rounded text-xs font-semibold disabled:opacity-60 ${
                        liveLabelTransform.isAutoOriented ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Theo dây ({liveLabelTransform.autoAngleDeg}°)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCable(selectedCable.id, {
                          labelAutoOrient: false,
                          labelRotation: liveLabelTransform.angleDeg
                        })
                      }
                      className={`py-1 rounded text-xs font-semibold disabled:opacity-60 ${
                        !liveLabelTransform.isAutoOriented ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Xoay thủ công
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={liveLabelTransform.angleDeg}
                      onChange={e =>
                        onUpdateCable(selectedCable.id, {
                          labelAutoOrient: false,
                          labelRotation: Math.max(-180, Math.min(180, Number(e.target.value) || 0))
                        })
                      }
                      className="flex-1 accent-blue-600"
                    />
                    <input
                      type="number"
                      min={-180}
                      max={180}
                      value={liveLabelTransform.angleDeg}
                      onChange={e =>
                        onUpdateCable(selectedCable.id, {
                          labelAutoOrient: false,
                          labelRotation: Math.max(-180, Math.min(180, Number(e.target.value) || 0))
                        })
                      }
                      className="w-14 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-right tabular-nums disabled:opacity-70"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1">
                      <Type className="w-3 h-3 text-blue-600" />
                      <span>Cỡ chữ nhãn</span>
                    </span>
                    <span className="font-mono tabular-nums">{liveLabelTransform.fontSize} px</span>
                  </div>
                  <input
                    type="range"
                    min={7}
                    max={20}
                    step={0.5}
                    value={liveLabelTransform.fontSize}
                    onChange={e =>
                      onUpdateCable(selectedCable.id, {
                        labelFontSize: Math.max(7, Math.min(24, Number(e.target.value) || 9.5))
                      })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            </div>
          </fieldset>
        )}

        {/* TAB: NÂNG CAO */}
        {cableTab === 'advanced' && (
          <fieldset disabled={isReadOnlyMode} className="contents">
            <div className="space-y-3">
              <div>
                <label className="text-slate-500 text-xs block mb-1">VLAN / Ghi chú kỹ thuật</label>
                <input
                  type="text"
                  value={selectedCable.vlan || ''}
                  onChange={e => onUpdateCable(selectedCable.id, { vlan: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-70"
                  placeholder="Trunk VLAN 10,20..."
                />
              </div>

              <div>
                <label className="text-slate-500 text-xs block mb-1">Trạng thái tuyến cáp</label>
                <select
                  value={selectedCable.status}
                  onChange={e =>
                    onUpdateCable(selectedCable.id, { status: e.target.value as CableEdge['status'] })
                  }
                  className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-70"
                >
                  <option value="active">Đang hoạt động (Active)</option>
                  <option value="planned">Dự kiến thi công (Planned)</option>
                  <option value="faulty">Sự cố / Đứt tín hiệu (Faulty)</option>
                </select>
              </div>

              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Điểm uốn tùy chỉnh</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {selectedCable.controlPoints?.length || 0} điểm
                  </span>
                </div>
                {!isReadOnlyMode && selectedCable.controlPoints && selectedCable.controlPoints.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => onUpdateCable(selectedCable.id, { controlPoints: undefined })}
                    className="w-full py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-400 font-medium flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
                    <span>Đặt lại toàn bộ điểm uốn</span>
                  </button>
                ) : (
                  <div className="text-xs text-slate-400">
                    {isReadOnlyMode
                      ? 'Điểm uốn thủ công được bảo toàn ở chế độ Chỉ xem.'
                      : 'Chọn dây cáp trên trang vẽ rồi kéo nút + ở đoạn dây để uốn tuyến thủ công.'}
                  </div>
                )}
              </div>
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
};
