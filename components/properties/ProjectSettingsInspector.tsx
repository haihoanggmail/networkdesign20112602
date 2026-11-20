import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Contrast,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  Layers,
  Network,
  Route,
  Sliders,
  X
} from 'lucide-react';
import { CanvasPerformanceMode, ProjectState } from '../../types/infrastructure';
import type { CADDocument } from '../../cad/core/CADTypes';
import { checkCadNetworkScaleConsistency } from '../../cad/core/CADUnderlayTransform';
import { MAX_SCALE_PX_PER_METER, MIN_SCALE_PX_PER_METER, normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import { CANVAS_BACKGROUND_PRESETS, resolveCanvasAppearance } from '../../utils/canvasBackgrounds';
import {
  CANVAS_PERFORMANCE_MODES,
  normalizeCanvasPerformanceMode,
  resolveCanvasPerformancePolicy
} from '../../utils/canvasPerformance';
import { LayoutTier, UIDensity } from '../../hooks/useWorkspaceLayout';
import {
  AutoAssignIpResult,
  DEFAULT_IP_PLAN_CONFIG,
  SUBNET_MASK_PRESETS,
  computeProjectSubnetIpStats,
  getTopologyOrderedAssetIds,
  resolveProjectIpPlanConfig,
  validateIpPlanConfig
} from '../../utils/ipAutoAssign';
import { ReadOnlyInspectorBanner } from './propertiesShared';
import { SubnetIpStatsPanel } from './SubnetIpStatsPanel';

interface ProjectSettingsInspectorProps {
  project: ProjectState;
  is3DView?: boolean;
  isReadOnlyMode: boolean;
  layoutTier: LayoutTier;
  density: UIDensity;
  highContrast: boolean;
  reducedMotion: boolean;
  onUpdateSettings: (partial: Partial<ProjectState['settings']>) => void;
  onAutoAssignIps?: (options?: { preserveExistingValid?: boolean }) => AutoAssignIpResult;
  onUpdateProjectMeta?: (meta: Partial<Pick<ProjectState, 'name' | 'author' | 'version'>>) => void;
  onDuplicateProject?: () => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onAutoRouteAllCables?: () => void;
  onSelectNode?: (nodeId: string) => void;
  onToggleDensity?: () => void;
  onToggleHighContrast?: () => void;
  onToggleReducedMotion?: () => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
  onOpenBomModal?: () => void;
  onOpenBomSubnetsTab?: () => void;
  cadDocument?: CADDocument | null;
  onSyncScaleFromCad?: () => void;
  onLockAllCadLayers?: (lock?: boolean) => void;
}

export const ProjectSettingsInspector: React.FC<ProjectSettingsInspectorProps> = ({
  project,
  is3DView = false,
  isReadOnlyMode,
  layoutTier,
  density,
  highContrast,
  reducedMotion,
  onUpdateSettings,
  onAutoAssignIps,
  onUpdateProjectMeta,
  onDuplicateProject,
  onToggleNodeVisibility,
  onAutoRouteAllCables,
  onSelectNode,
  onToggleDensity,
  onToggleHighContrast,
  onToggleReducedMotion,
  onToggleCollapse,
  onClosePanel,
  onOpenBomModal,
  onOpenBomSubnetsTab,
  cadDocument,
  onSyncScaleFromCad,
  onLockAllCadLayers
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [preserveExistingValid, setPreserveExistingValid] = useState(false);
  const [lastAssignFeedback, setLastAssignFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const toggleSection = (sec: string) => {
    setCollapsedSections(prev => ({ ...prev, [sec]: !prev[sec] }));
  };

  const totalAssets = Object.keys(project.assets).length;
  const totalCables = project.cables.length;
  const totalRooms = project.rooms.length;
  const totalPowerW = Object.values(project.assets).reduce((acc, a) => acc + (a.powerWatts || 0), 0);
  const hiddenNodes = project.nodes.filter(n => n.hidden === true);

  const ipConfig = resolveProjectIpPlanConfig(project);
  const ipValidation = validateIpPlanConfig(ipConfig);
  const assignableAssetCount = getTopologyOrderedAssetIds(project).length;
  const subnetStatsSummary = computeProjectSubnetIpStats(project);

  const handleRunAutoAssignIps = () => {
    if (!onAutoAssignIps || isReadOnlyMode) return;
    const res = onAutoAssignIps({ preserveExistingValid });
    if (!res.ok) {
      setLastAssignFeedback({ ok: false, message: res.error || 'Không thể gán IP tự động.' });
      return;
    }
    if (res.totalAssignable === 0) {
      setLastAssignFeedback({ ok: false, message: 'Chưa có thiết bị mạng nào cần gán IP trên sơ đồ.' });
      return;
    }
    const warnSuffix =
      res.unassignedCount > 0 ? ` (${res.unassignedCount} thiết bị thiếu IP do hết dải)` : '';
    setLastAssignFeedback({
      ok: res.unassignedCount === 0,
      message: `Đã gán ${res.assignedCount} IP mới${
        res.preservedCount > 0 ? `, giữ ${res.preservedCount} IP hợp lệ` : ''
      } theo topology (${res.cidrNotation})${warnSuffix}.`
    });
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text overflow-y-auto">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shrink-0">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              Thuộc tính bản vẽ
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Cấu hình dự án &amp; tham số kỹ thuật
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

      {/* Unified 4-column tabular KPI bar */}
      <div className="grid grid-cols-4 divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 shrink-0">
        <div className="px-2.5 py-2">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Thiết bị</div>
          <div className="font-semibold text-[13px] text-slate-900 dark:text-white font-mono tabular-nums">
            {totalAssets}
          </div>
        </div>
        <div className="px-2.5 py-2">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Tuyến</div>
          <div className="font-semibold text-[13px] text-[#155EEF] dark:text-blue-400 font-mono tabular-nums">
            {totalCables}
          </div>
        </div>
        <div className="px-2.5 py-2">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Phòng</div>
          <div className="font-semibold text-[13px] text-slate-900 dark:text-white font-mono tabular-nums">
            {totalRooms}
          </div>
        </div>
        <div className="px-2.5 py-2">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Công suất</div>
          <div className="font-semibold text-[13px] text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
            {(totalPowerW / 1000).toFixed(2)}kW
          </div>
        </div>
      </div>

      {isReadOnlyMode && <ReadOnlyInspectorBanner />}

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {/* Prominent BOM Statistics & Estimation Button */}
        {onOpenBomModal && (
          <div className="px-3.5 py-3">
            <button
              type="button"
              onClick={onOpenBomModal}
              className="w-full py-2.5 px-3 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              <span>Xem Thống kê Vật tư (BOM)</span>
            </button>
          </div>
        )}

        {/* Quick Auto-Route Action */}
        {!isReadOnlyMode && onAutoRouteAllCables && project.cables.length > 0 && (
          <div className="px-3.5 py-3">
            <button
              type="button"
              onClick={onAutoRouteAllCables}
              className="ent-btn-primary w-full"
            >
              <Route className="w-3.5 h-3.5 shrink-0" />
              <span>Tự định tuyến tất cả cáp ({project.cables.length})</span>
            </button>
          </div>
        )}

        {/* Hidden Nodes Recovery */}
        {hiddenNodes.length > 0 && onToggleNodeVisibility && (
          <div className="px-3.5 py-3 bg-amber-50/40 dark:bg-amber-950/15 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5" />
                <span>Đối tượng đang ẩn ({hiddenNodes.length})</span>
              </span>
              {!isReadOnlyMode && (
                <button
                  type="button"
                  onClick={() => onToggleNodeVisibility(hiddenNodes.map(n => n.id), false)}
                  className="text-xs font-semibold text-[#155EEF] dark:text-blue-400 hover:underline"
                >
                  Hiện tất cả
                </button>
              )}
            </div>
            <div className="divide-y divide-amber-200/60 dark:divide-amber-900/40 max-h-36 overflow-y-auto border border-amber-200/80 dark:border-amber-900/60 rounded-md bg-white dark:bg-slate-900">
              {hiddenNodes.map(hn => (
                <div key={hn.id} className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">{hn.label}</span>
                  {!isReadOnlyMode && (
                    <button
                      type="button"
                      onClick={() => onToggleNodeVisibility([hn.id], false)}
                      className="text-xs font-medium text-[#155EEF] dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0"
                    >
                      <Eye className="w-3 h-3" /> Hiện lại
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Project Metadata */}
        <fieldset disabled={isReadOnlyMode} className="contents">
          <div className="px-3.5 py-3 space-y-2.5">
            <div>
              <label className="ent-label">Tên dự án thiết kế</label>
              <input
                type="text"
                value={project.name}
                onChange={e => onUpdateProjectMeta?.({ name: e.target.value })}
                className="ent-input font-medium"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="ent-label">Kỹ sư phụ trách</label>
                <input
                  type="text"
                  value={project.author}
                  onChange={e => onUpdateProjectMeta?.({ author: e.target.value })}
                  className="ent-input"
                />
              </div>
              <div>
                <label className="ent-label">Phiên bản</label>
                <input
                  type="text"
                  value={project.version}
                  onChange={e => onUpdateProjectMeta?.({ version: e.target.value })}
                  className="ent-input font-mono"
                />
              </div>
            </div>
            {!isReadOnlyMode && onDuplicateProject && (
              <button
                type="button"
                onClick={onDuplicateProject}
                className="ent-btn-secondary w-full"
              >
                <Copy className="w-3.5 h-3.5 text-slate-500" />
                <span>Tạo bản sao dự án</span>
              </button>
            )}
          </div>
        </fieldset>

        {/* IP Range, Subnet Mask & Topology Auto-Assign */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('ip_planning')}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Network className="w-3.5 h-3.5 text-[#155EEF] dark:text-blue-400" />
              <span>Quy hoạch Dải IP &amp; Subnet</span>
            </span>
            {collapsedSections['ip_planning'] ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
          {!collapsedSections['ip_planning'] && (
            <fieldset disabled={isReadOnlyMode} className="contents">
              <div className="px-3.5 pb-3.5 pt-1 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="ent-label">IP bắt đầu</label>
                    <input
                      type="text"
                      value={project.settings.ipRangeStart ?? DEFAULT_IP_PLAN_CONFIG.ipRangeStart}
                      onChange={e => {
                        setLastAssignFeedback(null);
                        onUpdateSettings({ ipRangeStart: e.target.value });
                      }}
                      placeholder="192.168.10.10"
                      className="ent-input font-mono"
                    />
                  </div>
                  <div>
                    <label className="ent-label">IP kết thúc</label>
                    <input
                      type="text"
                      value={project.settings.ipRangeEnd ?? DEFAULT_IP_PLAN_CONFIG.ipRangeEnd}
                      onChange={e => {
                        setLastAssignFeedback(null);
                        onUpdateSettings({ ipRangeEnd: e.target.value });
                      }}
                      placeholder="192.168.10.250"
                      className="ent-input font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="ent-label">Subnet Mask</label>
                    <input
                      type="text"
                      value={project.settings.ipSubnetMask ?? DEFAULT_IP_PLAN_CONFIG.ipSubnetMask}
                      onChange={e => {
                        setLastAssignFeedback(null);
                        onUpdateSettings({ ipSubnetMask: e.target.value });
                      }}
                      placeholder="255.255.255.0"
                      className="ent-input font-mono"
                    />
                  </div>
                  <div>
                    <label className="ent-label">Default Gateway</label>
                    <input
                      type="text"
                      value={project.settings.ipGateway ?? ''}
                      onChange={e => {
                        setLastAssignFeedback(null);
                        onUpdateSettings({ ipGateway: e.target.value });
                      }}
                      placeholder={ipValidation.valid ? ipValidation.resolvedGateway : '192.168.10.1'}
                      className="ent-input font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="ent-label">Chọn nhanh Subnet Mask</label>
                  <select
                    value={
                      SUBNET_MASK_PRESETS.some(p => p.mask === ipConfig.ipSubnetMask)
                        ? ipConfig.ipSubnetMask
                        : 'custom'
                    }
                    onChange={e => {
                      if (e.target.value !== 'custom') {
                        setLastAssignFeedback(null);
                        onUpdateSettings({ ipSubnetMask: e.target.value });
                      }
                    }}
                    className="ent-select font-mono"
                  >
                    {SUBNET_MASK_PRESETS.map(p => (
                      <option key={p.mask} value={p.mask}>
                        {p.label}
                      </option>
                    ))}
                    {!SUBNET_MASK_PRESETS.some(p => p.mask === ipConfig.ipSubnetMask) && (
                      <option value="custom">Tùy chỉnh ({ipConfig.ipSubnetMask || '—'})</option>
                    )}
                  </select>
                </div>

                {ipValidation.valid ? (
                  <div className="py-1.5 border-y border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                    <span className="font-semibold text-[#155EEF] dark:text-blue-400">
                      {ipValidation.cidrNotation}
                    </span>
                    <span
                      className={
                        assignableAssetCount > ipValidation.availableHostCount
                          ? 'text-amber-600 dark:text-amber-400 font-medium'
                          : 'text-slate-600 dark:text-slate-300'
                      }
                    >
                      {ipValidation.availableHostCount} IP khả dụng / {assignableAssetCount} TB
                    </span>
                  </div>
                ) : (
                  <div className="px-2.5 py-1.5 rounded-md bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
                    {ipValidation.error}
                  </div>
                )}

                <label className="flex items-center justify-between cursor-pointer text-xs py-0.5">
                  <span className="text-slate-700 dark:text-slate-300">Giữ nguyên IP hợp lệ đang có</span>
                  <input
                    type="checkbox"
                    checked={preserveExistingValid}
                    onChange={e => setPreserveExistingValid(e.target.checked)}
                    className="rounded accent-[#155EEF] w-4 h-4"
                  />
                </label>

                {!isReadOnlyMode && onAutoAssignIps && (
                  <button
                    type="button"
                    disabled={!ipValidation.valid || assignableAssetCount === 0}
                    onClick={handleRunAutoAssignIps}
                    className="ent-btn-primary w-full"
                  >
                    <Network className="w-3.5 h-3.5 shrink-0" />
                    <span>Gán IP theo Topology ({assignableAssetCount})</span>
                  </button>
                )}

                {lastAssignFeedback && (
                  <div
                    className={`px-2.5 py-1.5 rounded-md border text-xs font-medium ${
                      lastAssignFeedback.ok
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {lastAssignFeedback.message}
                  </div>
                )}
              </div>
            </fieldset>
          )}
        </div>

        {/* Per-Subnet IP Statistics & Device List */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('subnet_ip_stats')}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100 min-w-0">
              <Network className="w-3.5 h-3.5 text-[#155EEF] dark:text-blue-400 shrink-0" />
              <span className="truncate">Thống kê IP theo Subnet ({subnetStatsSummary.totals.subnetCount})</span>
            </span>
            {collapsedSections['subnet_ip_stats'] ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
          </button>
          {!collapsedSections['subnet_ip_stats'] && (
            <div className="px-3.5 pb-3.5 pt-1">
              <SubnetIpStatsPanel
                project={project}
                variant="compact"
                onSelectNode={onSelectNode}
                onOpenFullInBom={onOpenBomSubnetsTab || onOpenBomModal}
              />
            </div>
          )}
        </div>

        {/* Canvas Performance & Render Customization */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('canvas_performance')}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100 min-w-0">
              <Gauge className="w-3.5 h-3.5 text-[#155EEF] dark:text-blue-400 shrink-0" />
              <span className="truncate">Hiển thị &amp; Hiệu năng Canvas</span>
            </span>
            {collapsedSections['canvas_performance'] ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
          </button>
          {!collapsedSections['canvas_performance'] && (() => {
            const activeMode = normalizeCanvasPerformanceMode(project.settings.canvasPerformanceMode);
            const resolvedPolicy = resolveCanvasPerformancePolicy(activeMode, {
              nodeCount: project.nodes.length,
              cableCount: project.cables.length,
              rackCount: project.racks.length,
              roomCount: project.rooms.length,
              trayCount: project.cableTrays?.length || 0,
              cadEntityCount: 0,
              zoom: 1,
              isPanning: false
            });
            return (
              <div className="px-3.5 pb-3.5 pt-1 space-y-2">
                <div className="space-y-1.5" role="radiogroup" aria-label="Chế độ hiệu năng render Canvas">
                  {CANVAS_PERFORMANCE_MODES.map(preset => {
                    const selected = activeMode === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={isReadOnlyMode}
                        onClick={() =>
                          onUpdateSettings({
                            canvasPerformanceMode: preset.id as CanvasPerformanceMode
                          })
                        }
                        className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                          selected
                            ? 'border-[#155EEF] bg-blue-50/70 dark:bg-blue-950/35 text-slate-900 dark:text-white'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-semibold ${selected ? 'text-[#155EEF] dark:text-blue-300' : ''}`}>
                            {preset.label}
                          </span>
                          {selected && (
                            <span className="text-[10px] font-mono font-semibold text-[#155EEF] dark:text-blue-300 shrink-0">
                              Đang chọn
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-1">
                          {preset.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="px-2.5 py-2 rounded-md bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5 font-mono tabular-nums">
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Quy mô bản vẽ:</span>
                    <span>{project.nodes.length} node · {project.cables.length} cáp</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Spatial Culling:</span>
                    <span>
                      {activeMode === 'high_quality'
                        ? 'Tắt (Full Vector)'
                        : resolvedPolicy.spatialCullingActive
                        ? 'Đang kích hoạt'
                        : 'Chờ vượt ngưỡng'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Chất lượng 3D:</span>
                    <span>
                      {resolvedPolicy.threeRenderQuality === 'high'
                        ? 'Cao + Bóng đổ'
                        : resolvedPolicy.threeRenderQuality === 'medium'
                        ? 'Trung bình'
                        : 'Nhẹ (Tối ưu FPS)'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Display Overlays & CAD Toggles (Layer management lives exclusively in unified Lớp menu) */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('canvas_overlays')}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
          >
            <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100 min-w-0">
              <Layers className="w-3.5 h-3.5 text-[#155EEF] dark:text-blue-400 shrink-0" />
              <span className="truncate">Hiển thị &amp; Lưới CAD</span>
            </span>
            {collapsedSections['canvas_overlays'] ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
          </button>
          {!collapsedSections['canvas_overlays'] && (
            <div className="px-3.5 pb-3.5 pt-1 space-y-2">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Quản lý ẩn/hiện &amp; khóa lớp thiết kế tại nút <strong className="text-slate-700 dark:text-slate-200">Lớp</strong> trên thanh điều khiển góc dưới phải.
              </div>
              <div className="pt-1 border-t border-slate-100 dark:border-slate-800 space-y-2">
                {[
                  { label: 'Lưới tọa độ (CAD Grid)', checked: project.settings.showGrid, only2D: true, onChange: (v: boolean) => onUpdateSettings({ showGrid: v }) },
                  { label: 'Bám lưới tự động (Snap)', checked: project.settings.snapToGrid, only2D: true, onChange: (v: boolean) => onUpdateSettings({ snapToGrid: v }) },
                  { label: 'Thước đo (Rulers)', checked: project.settings.showRulers, only2D: true, onChange: (v: boolean) => onUpdateSettings({ showRulers: v }) },
                  { label: 'Hiển thị địa chỉ IP', checked: project.settings.showIpAddresses, only2D: false, onChange: (v: boolean) => onUpdateSettings({ showIpAddresses: v }) },
                  { label: 'Hiển thị mã cáp', checked: project.settings.showCableCodes, only2D: false, onChange: (v: boolean) => onUpdateSettings({ showCableCodes: v }) },
                  { label: 'Vùng Wi-Fi / Camera FOV', checked: project.settings.showCoverageRadius, only2D: false, onChange: (v: boolean) => onUpdateSettings({ showCoverageRadius: v }) }
                ].map(row => {
                  const disabled = isReadOnlyMode || (is3DView && row.only2D);
                  return (
                    <label
                      key={row.label}
                      title={is3DView && row.only2D ? 'Tùy chọn này chỉ khả dụng trong chế độ 2D CAD' : undefined}
                      className={`flex items-center justify-between py-0.5 ${
                        disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <span className="text-slate-700 dark:text-slate-300">{row.label}</span>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={row.checked}
                        onChange={e => row.onChange(e.target.checked)}
                        className="rounded accent-[#155EEF] w-4 h-4 disabled:cursor-not-allowed"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Canvas Backgrounds */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('canvas_bg')}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
          >
            <span className="font-semibold text-slate-900 dark:text-slate-100">Hình nền bản vẽ</span>
            {collapsedSections['canvas_bg'] ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
          {!collapsedSections['canvas_bg'] && (() => {
            const appearance = resolveCanvasAppearance(project.settings);
            return (
              <fieldset disabled={isReadOnlyMode || is3DView} className="contents">
                <div className={`px-3.5 pb-3.5 pt-0.5 grid grid-cols-2 gap-1.5 ${is3DView ? 'opacity-45' : ''}`}>
                  {CANVAS_BACKGROUND_PRESETS.map(p => {
                    const active = appearance.presetId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            backgroundPreset: p.id,
                            backgroundColor: p.backgroundColor,
                            backgroundPattern: p.pattern,
                            showGrid: true
                          })
                        }
                        title={is3DView ? 'Hình nền 2D không khả dụng trong chế độ 3D' : p.name}
                        className={`px-2 py-1.5 rounded-md border text-left flex items-center gap-2 text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                          active
                            ? 'border-[#155EEF] bg-blue-50/70 dark:bg-blue-950/40 font-semibold text-[#155EEF] dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-[2px] border border-black/15 shrink-0"
                          style={{ backgroundColor: p.backgroundColor }}
                        />
                        <span className="truncate">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })()}
        </div>

        {/* Scale & Grid */}
        <div>
          <button
            type="button"
            onClick={() => toggleSection('canvas_scale')}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
          >
            <span className="font-semibold text-slate-900 dark:text-slate-100">Tỷ lệ &amp; Kích thước lưới</span>
            {collapsedSections['canvas_scale'] ? (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
          {!collapsedSections['canvas_scale'] && (
            <fieldset disabled={isReadOnlyMode} className="contents">
              <div className="px-3.5 pb-3.5 pt-0.5 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="ent-label">Đơn vị đo</label>
                    <select
                      value={project.settings.unit}
                      onChange={e => onUpdateSettings({ unit: e.target.value as ProjectState['settings']['unit'] })}
                      className="ent-select"
                    >
                      <option value="m">Mét (m)</option>
                      <option value="cm">Centimét (cm)</option>
                      <option value="mm">Milimét (mm)</option>
                    </select>
                  </div>
                  <div>
                    <label className="ent-label">Lưới (px)</label>
                    <select
                      value={project.settings.gridSize}
                      onChange={e => onUpdateSettings({ gridSize: parseInt(e.target.value, 10) })}
                      className="ent-select font-mono"
                    >
                      <option value="10">10 px</option>
                      <option value="20">20 px</option>
                      <option value="40">40 px</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Tỷ lệ (px / mét)
                    </label>
                    <span className="text-xs font-mono text-slate-400 tabular-nums">
                      100px = {(100 / normalizeScalePxPerMeter(project.settings.scale)).toFixed(1)}m
                    </span>
                  </div>
                  <input
                    type="number"
                    min={MIN_SCALE_PX_PER_METER}
                    max={MAX_SCALE_PX_PER_METER}
                    step="any"
                    value={normalizeScalePxPerMeter(project.settings.scale)}
                    onChange={e => onUpdateSettings({ scale: normalizeScalePxPerMeter(Number(e.target.value)) })}
                    className="ent-input font-mono tabular-nums"
                  />
                </div>
                {cadDocument && (() => {
                  const consistency = checkCadNetworkScaleConsistency(
                    cadDocument,
                    normalizeScalePxPerMeter(project.settings.scale)
                  );
                  const cadLayers = Object.values(cadDocument.layers);
                  const lockedCount = cadLayers.filter(l => l.locked).length;
                  const allLocked = cadLayers.length > 0 && lockedCount === cadLayers.length;
                  return (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-2 space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-600 dark:text-slate-300">
                          Nền CAD ({consistency.unitShortLabel}):
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            !consistency.hasUnit
                              ? 'text-amber-600 dark:text-amber-400'
                              : consistency.consistent
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {!consistency.hasUnit
                            ? 'Chưa rõ đơn vị'
                            : consistency.consistent
                            ? `Khớp (${consistency.cadPxPerMeter} px/m)`
                            : `Lệch (${consistency.cadPxPerMeter} px/m)`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {onSyncScaleFromCad && consistency.hasUnit && !consistency.consistent && (
                          <button
                            type="button"
                            onClick={onSyncScaleFromCad}
                            className="flex-1 px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 font-semibold hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
                          >
                            Đồng bộ từ CAD
                          </button>
                        )}
                        {onLockAllCadLayers && (
                          <button
                            type="button"
                            onClick={() => onLockAllCadLayers(!allLocked)}
                            className="flex-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium hover:border-[#155EEF] transition-colors"
                          >
                            {allLocked ? 'Mở khóa nền CAD' : `Khóa nền (${lockedCount}/${cadLayers.length})`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </fieldset>
          )}
        </div>

        {/* Accessibility & Density — always interactive even in read-only mode */}
        {(onToggleDensity || onToggleHighContrast || onToggleReducedMotion) && (
          <div className="px-3.5 py-3 space-y-2">
            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-slate-500" />
              <span>Mật độ &amp; Trợ năng</span>
            </div>
            <div className="space-y-2 pt-0.5">
              {onToggleDensity && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-700 dark:text-slate-300">Mật độ nút</span>
                  <button
                    type="button"
                    onClick={onToggleDensity}
                    className="ent-btn-secondary h-7 px-2.5 text-xs"
                  >
                    {density === 'compact' ? 'Gọn' : 'Thoải mái'}
                  </button>
                </div>
              )}
              {onToggleHighContrast && (
                <label className="flex items-center justify-between cursor-pointer py-0.5">
                  <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Contrast className="w-3.5 h-3.5 text-slate-500" />
                    <span>Tương phản cao</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={highContrast}
                    onChange={onToggleHighContrast}
                    className="rounded accent-[#155EEF] w-4 h-4"
                  />
                </label>
              )}
              {onToggleReducedMotion && (
                <label className="flex items-center justify-between cursor-pointer py-0.5">
                  <span className="text-slate-700 dark:text-slate-300">Giảm chuyển động</span>
                  <input
                    type="checkbox"
                    checked={reducedMotion}
                    onChange={onToggleReducedMotion}
                    className="rounded accent-[#155EEF] w-4 h-4"
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {/* Quiet Enterprise Hint Footer */}
        <div className="px-3.5 py-2.5 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
          Nhấn đúp vào thiết bị để mở cấu hình chuyên sâu, hoặc nhấn đúp vào dây cáp để sửa nhãn trực tiếp trên bản vẽ.
        </div>
      </div>
    </div>
  );
};
