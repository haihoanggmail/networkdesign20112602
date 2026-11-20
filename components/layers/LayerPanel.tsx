import React, { useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  Grid,
  Layers,
  Lock,
  Magnet,
  Ruler,
  Unlock,
  X
} from 'lucide-react';
import { CanvasLayerId, ProjectState } from '../../types/infrastructure';
import {
  LAYER_CATALOG,
  computeLayerObjectCounts,
  getHiddenLayerSet,
  getLockedLayerSet
} from '../../utils/layerPolicy';
import { loadPanelCollapsed, savePanelCollapsed } from '../../utils/panelCollapseStorage';
import type { View3DDisplayOptions } from '../../contexts/ViewportContext';
import type { CADDocument } from '../../cad/core/CADTypes';
import { aciToHex } from '../../cad/core/CADColorPalette';
import { computeNetworkPxPerMeterFromCad, checkCadNetworkScaleConsistency } from '../../cad/core/CADUnderlayTransform';
import { getCADUnitMeta } from '../../cad/core/CADUnits';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';

export interface LayerPanelProps {
  project: ProjectState;
  is3DView: boolean;
  isReadOnlyMode?: boolean;
  onToggleLayerVisibility: (layer: CanvasLayerId) => void;
  onToggleLayerLock?: (layer: CanvasLayerId) => void;
  onSelectLayerObjects?: (layer: CanvasLayerId) => void;
  onAutoLayerDevices?: () => void;
  onToggleAutoLayering?: () => void;
  onUpdateSettings?: (partial: Partial<ProjectState['settings']>) => void;
  view3DOptions?: View3DDisplayOptions;
  onChangeView3DOptions?: (updater: (prev: View3DDisplayOptions) => View3DDisplayOptions) => void;
  onClose?: () => void;
  variant?: 'popover' | 'sheet';
  cadDocument?: CADDocument | null;
  onToggleCadUnderlayEnabled?: () => void;
  onChangeCadUnderlayOpacity?: (opacity: number) => void;
  onToggleCadUnderlay3D?: () => void;
  onToggleCadLayerVisible?: (layerName: string) => void;
  onToggleCadLayerLocked?: (layerName: string) => void;
  onLockAllCadLayers?: (lock: boolean) => void;
  onSyncScaleFromCad?: () => void;
  onOpenCadStudio?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  project,
  is3DView,
  isReadOnlyMode = false,
  onToggleLayerVisibility,
  onToggleLayerLock,
  onSelectLayerObjects,
  onAutoLayerDevices,
  onToggleAutoLayering,
  onUpdateSettings,
  view3DOptions,
  onChangeView3DOptions,
  onClose,
  variant = 'popover',
  cadDocument,
  onToggleCadUnderlayEnabled,
  onChangeCadUnderlayOpacity,
  onToggleCadUnderlay3D,
  onToggleCadLayerVisible,
  onToggleCadLayerLocked,
  onLockAllCadLayers,
  onSyncScaleFromCad,
  onOpenCadStudio,
  isCollapsed,
  onToggleCollapse
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(() =>
    loadPanelCollapsed('layers', false)
  );
  const effectiveCollapsed = isCollapsed ?? internalCollapsed;
  const handleToggleCollapse = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
      return;
    }
    setInternalCollapsed(prev => {
      const next = !prev;
      savePanelCollapsed('layers', next);
      return next;
    });
  };

  const hiddenLayerSet = useMemo(() => getHiddenLayerSet(project.settings), [project.settings]);
  const lockedLayerSet = useMemo(() => getLockedLayerSet(project.settings), [project.settings]);
  const layerCounts = useMemo(() => computeLayerObjectCounts(project), [project]);
  const canMultiFloorCutaway =
    project.floors.length > 1 && ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);

  // Layers that only affect 2D vector overlays (grid/wifi/fov/labels) are marked subtly in 3D mode
  const is2DOverlayOnlyLayer = (id: CanvasLayerId) =>
    id === 'wifi' || id === 'fov' || id === 'labels' || id === 'cable_labels';

  return (
    <div
      className={
        variant === 'sheet'
          ? 'w-full flex flex-col gap-2 text-xs text-slate-800 dark:text-slate-100'
          : 'w-[min(420px,calc(100vw-1.5rem))] max-h-[min(82dvh,calc(100dvh-6rem))] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-2.5 flex flex-col gap-2 text-xs text-slate-800 dark:text-slate-100 overflow-hidden'
      }
      role="region"
      aria-label="Quản lý lớp hiển thị và tùy chọn khung nhìn"
    >
      {/* Header */}
      <div
        className={`px-2 py-1 flex items-center justify-between gap-2 shrink-0 ${
          effectiveCollapsed ? '' : 'border-b border-slate-100 dark:border-slate-800'
        }`}
      >
        <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white min-w-0">
          <Layers className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
          <span className="truncate">Lớp thiết kế (2D &amp; 3D)</span>
          {effectiveCollapsed && cadDocument && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 shrink-0">
              CAD {Object.keys(cadDocument.layers).length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
            {is3DView ? '3D' : '2D'}
          </span>
          <button
            type="button"
            onClick={handleToggleCollapse}
            aria-label={effectiveCollapsed ? 'Mở rộng bảng lớp' : 'Thu gọn bảng lớp'}
            aria-expanded={!effectiveCollapsed}
            title={effectiveCollapsed ? 'Mở rộng bảng lớp' : 'Thu gọn bảng lớp'}
            className="p-1 rounded-md text-slate-500 hover:text-[#155EEF] dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {effectiveCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng bảng lớp"
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {!effectiveCollapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
          {/* Auto-Layering Controls */}
          {!isReadOnlyMode && (onAutoLayerDevices || onToggleAutoLayering) && (
            <div className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800 space-y-1.5">
              {onAutoLayerDevices && (
                <button
                  type="button"
                  data-testid="auto-layer-now-btn"
                  onClick={onAutoLayerDevices}
                  className="w-full h-7 px-2 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-[11px] flex items-center justify-center gap-1.5 transition-colors"
                  title="Tự động chuyển Switch/Router vào Network, Cảm biến/AP/Camera vào IoT, UPS/PDU vào Điện"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Phân lớp tự động ngay</span>
                </button>
              )}
              {onToggleAutoLayering && (
                <label className="flex items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer select-none px-0.5">
                  <span>Tự phân lớp khi thêm mới</span>
                  <input
                    type="checkbox"
                    checked={Boolean(project.settings.autoLayeringEnabled)}
                    onChange={onToggleAutoLayering}
                    className="rounded border-slate-300 dark:border-slate-600 text-[#155EEF] focus:ring-[#155EEF]"
                  />
                </label>
              )}
            </div>
          )}

          {/* Shared Design Layers */}
          <div className="space-y-0.5">
        {LAYER_CATALOG.map(item => {
          const visible = !hiddenLayerSet.has(item.id);
          const locked = lockedLayerSet.has(item.id);
          const count = layerCounts[item.id] ?? 0;
          const inactiveIn3D = is3DView && is2DOverlayOnlyLayer(item.id);
          const canSelect =
            Boolean(onSelectLayerObjects) && visible && count > 0 && item.id !== 'trays' && !inactiveIn3D;

          return (
            <div
              key={item.id}
              title={
                inactiveIn3D
                  ? `${item.label} chỉ hiển thị trên mặt bằng 2D CAD`
                  : item.description
              }
              className={`w-full px-2 py-1 rounded-lg flex items-center justify-between gap-1.5 transition-colors ${
                inactiveIn3D
                  ? 'opacity-40'
                  : visible
                  ? 'text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800'
                  : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <button
                type="button"
                disabled={inactiveIn3D}
                onClick={() => onToggleLayerVisibility(item.id)}
                className="flex-1 min-w-0 text-left font-medium py-0.5 flex items-center gap-1.5 disabled:cursor-not-allowed"
                title={
                  inactiveIn3D
                    ? 'Lớp 2D không áp dụng trong không gian 3D'
                    : visible
                    ? `Ẩn lớp ${item.label}`
                    : `Hiện lớp ${item.label}`
                }
              >
                {item.badgeColor && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.badgeColor }}
                  />
                )}
                <span className="truncate">{item.label}</span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                  ({count})
                </span>
              </button>

              <div className="flex items-center gap-0.5 shrink-0">
                {onSelectLayerObjects && (
                  <button
                    type="button"
                    disabled={!canSelect}
                    onClick={() => onSelectLayerObjects(item.id)}
                    aria-label={`Chọn đối tượng thuộc lớp ${item.label}`}
                    title={
                      inactiveIn3D
                        ? 'Chỉ chọn nhanh trên bản vẽ 2D'
                        : canSelect
                        ? `Chọn ${count} đối tượng thuộc lớp ${item.label}`
                        : `Không có đối tượng hiển thị trên lớp ${item.label}`
                    }
                    className="p-1 rounded text-slate-400 hover:text-[#155EEF] hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                  </button>
                )}
                {onToggleLayerLock && !isReadOnlyMode && (
                  <button
                    type="button"
                    disabled={inactiveIn3D}
                    onClick={() => onToggleLayerLock(item.id)}
                    aria-label={locked ? `Mở khóa lớp ${item.label}` : `Khóa lớp ${item.label}`}
                    aria-pressed={locked}
                    title={
                      inactiveIn3D
                        ? 'Lớp 2D không khả dụng trong 3D'
                        : locked
                        ? `Đang khóa lớp ${item.label} · Nhấn để mở khóa`
                        : `Khóa lớp ${item.label}`
                    }
                    className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      locked
                        ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400'
                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                )}
                <button
                  type="button"
                  disabled={inactiveIn3D}
                  onClick={() => onToggleLayerVisibility(item.id)}
                  aria-label={visible ? `Ẩn lớp ${item.label}` : `Hiện lớp ${item.label}`}
                  aria-pressed={visible}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {visible ? <Eye className="w-3.5 h-3.5 text-[#155EEF]" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* AutoCAD Underlay Section */}
      {cadDocument && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
          <div className="px-1 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1">
              <Compass className="w-3 h-3" />
              Lớp AutoCAD ({Object.keys(cadDocument.layers).length})
            </span>
            <div className="flex items-center gap-1">
              {onToggleCadUnderlayEnabled && (
                <button
                  type="button"
                  onClick={onToggleCadUnderlayEnabled}
                  aria-pressed={cadDocument.underlay.enabled}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    cadDocument.underlay.enabled
                      ? 'bg-[#155EEF] text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {cadDocument.underlay.enabled ? 'Đang bật' : 'Đang ẩn'}
                </button>
              )}
              {onOpenCadStudio && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenCadStudio();
                    onClose?.();
                  }}
                  className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 text-[10px] font-semibold hover:bg-sky-100 dark:hover:bg-sky-900/50"
                >
                  Studio
                </button>
              )}
            </div>
          </div>

          <div className="px-1 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="whitespace-nowrap">Độ mờ:</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={cadDocument.underlay.opacity}
              onChange={e => onChangeCadUnderlayOpacity?.(parseFloat(e.target.value))}
              className="flex-1 accent-[#155EEF] cursor-pointer"
            />
            <span className="font-mono w-8 text-right">{Math.round(cadDocument.underlay.opacity * 100)}%</span>
            {onToggleCadUnderlay3D && (
              <button
                type="button"
                onClick={onToggleCadUnderlay3D}
                aria-pressed={cadDocument.underlay.showIn3D}
                title="Hiển thị nền AutoCAD trong không gian 3D"
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                  cadDocument.underlay.showIn3D
                    ? 'border-[#155EEF] bg-blue-50 dark:bg-blue-950/50 text-[#155EEF] dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-400'
                }`}
              >
                3D
              </button>
            )}
          </div>

          {(() => {
            const cadLayers = Object.values(cadDocument.layers);
            const lockedCount = cadLayers.filter(l => l.locked).length;
            const allLocked = cadLayers.length > 0 && lockedCount === cadLayers.length;
            const cadPxPerMeter = computeNetworkPxPerMeterFromCad(cadDocument);
            const cadUnitMeta = getCADUnitMeta(cadDocument.header.$INSUNITS);
            const normalizedProjectScale = normalizeScalePxPerMeter(project.settings.scale);
            const scaleOutOfSync =
              cadPxPerMeter !== null &&
              !checkCadNetworkScaleConsistency(cadDocument, normalizedProjectScale).consistent;
            return (
              <div className="px-1.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5 text-[10px]">
                <span className="text-slate-600 dark:text-slate-300 truncate">
                  {cadUnitMeta.shortLabel} ·{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-100">
                    {cadPxPerMeter ? `${cadPxPerMeter} px/m` : 'Không đơn vị'}
                  </strong>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {onSyncScaleFromCad && !isReadOnlyMode && (
                    <button
                      type="button"
                      data-testid="sync-cad-scale-btn"
                      disabled={cadPxPerMeter === null}
                      onClick={onSyncScaleFromCad}
                      title="Đồng bộ tỉ lệ bản vẽ mạng & chiều dài cáp theo đơn vị CAD"
                      className={`px-1.5 py-0.5 rounded font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        scaleOutOfSync
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-[#155EEF]'
                      }`}
                    >
                      Đồng bộ tỉ lệ
                    </button>
                  )}
                  {onLockAllCadLayers && !isReadOnlyMode && (
                    <button
                      type="button"
                      data-testid="lock-all-cad-layers-btn"
                      onClick={() => onLockAllCadLayers(!allLocked)}
                      title={
                        allLocked
                          ? 'Mở khóa toàn bộ lớp nền AutoCAD'
                          : 'Khóa tất cả lớp mặt bằng AutoCAD để tránh sửa nhầm'
                      }
                      className={`px-1.5 py-0.5 rounded font-semibold border flex items-center gap-0.5 transition-colors ${
                        allLocked || lockedCount > 0
                          ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                      }`}
                    >
                      {allLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                      <span>{allLocked ? 'Mở nền' : `Khóa nền (${lockedCount}/${cadLayers.length})`}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="max-h-60 sm:max-h-72 overflow-y-auto space-y-0.5 pr-0.5">
            {Object.values(cadDocument.layers).map(layer => {
              const colorHex = layer.trueColor
                ? `#${layer.trueColor.toString(16).padStart(6, '0')}`
                : aciToHex(layer.colorIndex, false);
              return (
                <div
                  key={layer.name}
                  className="px-2 py-0.5 rounded flex items-center justify-between gap-2 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <button
                    type="button"
                    onClick={() => onToggleCadLayerVisible?.(layer.name)}
                    className={`flex-1 min-w-0 flex items-center gap-1.5 text-left ${
                      layer.visible ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colorHex }} />
                    <span className="truncate">{layer.name}</span>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onToggleCadLayerLocked && !isReadOnlyMode && (
                      <button
                        type="button"
                        onClick={() => onToggleCadLayerLocked(layer.name)}
                        aria-label={layer.locked ? `Mở khóa lớp CAD ${layer.name}` : `Khóa lớp CAD ${layer.name}`}
                        aria-pressed={layer.locked}
                        title={layer.locked ? `Đang khóa lớp CAD ${layer.name}` : `Khóa lớp CAD ${layer.name}`}
                        className={`p-0.5 rounded transition-colors ${
                          layer.locked
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        {layer.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onToggleCadLayerVisible?.(layer.name)}
                      aria-label={layer.visible ? `Ẩn lớp CAD ${layer.name}` : `Hiện lớp CAD ${layer.name}`}
                      className="p-0.5 text-slate-400 hover:text-[#155EEF]"
                    >
                      {layer.visible ? <Eye className="w-3 h-3 text-[#155EEF]" /> : <EyeOff className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mode-Specific Viewport Display Options (Cleanly separated from Design Layers) */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
        <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {is3DView ? 'Tùy chọn không gian 3D' : 'Tùy chọn bản vẽ 2D'}
        </div>

        {!is3DView ? (
          onUpdateSettings && (
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => onUpdateSettings({ showGrid: !project.settings.showGrid })}
                aria-pressed={project.settings.showGrid}
                className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                  project.settings.showGrid
                    ? 'border-[#155EEF] bg-blue-50 dark:bg-blue-950/50 text-[#155EEF] dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Grid className="w-3 h-3" />
                <span>Lưới</span>
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({ snapToGrid: !project.settings.snapToGrid })}
                aria-pressed={project.settings.snapToGrid}
                className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                  project.settings.snapToGrid
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Magnet className="w-3 h-3" />
                <span>Bám lưới</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ showRulers: project.settings.showRulers === false })
                }
                aria-pressed={project.settings.showRulers !== false}
                className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                  project.settings.showRulers !== false
                    ? 'border-[#155EEF] bg-blue-50 dark:bg-blue-950/50 text-[#155EEF] dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Ruler className="w-3 h-3" />
                <span>Thước</span>
              </button>
            </div>
          )
        ) : (
          view3DOptions &&
          onChangeView3DOptions && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                {canMultiFloorCutaway && (
                  <button
                    type="button"
                    data-testid="3d-multifloor-layer-toggle"
                    onClick={() =>
                      onChangeView3DOptions(prev => ({
                        ...prev,
                        viewAllFloors: !prev.viewAllFloors
                      }))
                    }
                    className={`flex-1 py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      view3DOptions.viewAllFloors
                        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{view3DOptions.viewAllFloors ? 'Toàn tòa nhà' : 'Chỉ tầng này'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onChangeView3DOptions(prev => ({
                      ...prev,
                      showAxes: !prev.showAxes
                    }))
                  }
                  className={`flex-1 py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    view3DOptions.showAxes
                      ? 'border-[#155EEF] bg-blue-50 dark:bg-blue-950/50 text-[#155EEF] dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5 shrink-0" />
                  <span>Trục XYZ</span>
                </button>
              </div>

              <label className="flex items-center justify-between gap-2 px-1 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                <span className="whitespace-nowrap">Tách lớp 3D:</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={view3DOptions.explodeSpread}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    onChangeView3DOptions(prev => ({ ...prev, explodeSpread: val }));
                  }}
                  className="flex-1 accent-[#155EEF] cursor-pointer"
                />
                <span className="font-mono tabular-nums w-8 text-right">
                  {view3DOptions.explodeSpread.toFixed(1)}m
                </span>
              </label>
            </div>
          )
        )}
      </div>
        </div>
      )}
    </div>
  );
};
