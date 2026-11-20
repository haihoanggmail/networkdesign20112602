import React from 'react';
import {
  Activity,
  Cpu,
  ExternalLink,
  Network,
  Thermometer,
  Weight,
  X,
  Zap
} from 'lucide-react';
import { DeviceAsset, RackSide } from '../../types/infrastructure';
import { ThermalRiskLevel } from '../../utils/rackAirflow';

export interface HoveredRackSubDeviceInfo {
  rackId: string;
  rackNodeId: string;
  rackName: string;
  asset: DeviceAsset;
  startU: number;
  uHeight: number;
  side: RackSide;
  tempC: number;
  zone: ThermalRiskLevel;
  heatBtuPerHour: number;
  clientX: number;
  clientY: number;
}

interface RackSubDeviceTooltipProps {
  info: HoveredRackSubDeviceInfo;
  containerRect: { left: number; top: number; width: number; height: number } | null;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onOpenDeepInspect?: (targetId: string) => void;
  onSelectDevice?: (assetId: string, rackId: string) => void;
  onClose?: () => void;
}

const ZONE_META: Record<
  ThermalRiskLevel,
  { label: string; badgeClass: string; barColor: string }
> = {
  cool: {
    label: 'Mát',
    badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-400/40',
    barColor: '#0ea5e9'
  },
  nominal: {
    label: 'Ổn định',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/40',
    barColor: '#10b981'
  },
  warm: {
    label: 'Ấm',
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/40',
    barColor: '#f59e0b'
  },
  hot: {
    label: 'Nóng',
    badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-400/40',
    barColor: '#ef4444'
  }
};

const STATUS_META: Record<
  DeviceAsset['status'],
  { label: string; dotClass: string; textClass: string }
> = {
  online: { label: 'Trực tuyến', dotClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' },
  standby: { label: 'Dự phòng', dotClass: 'bg-sky-500', textClass: 'text-sky-600 dark:text-sky-400' },
  maintenance: { label: 'Bảo trì', dotClass: 'bg-amber-500', textClass: 'text-amber-600 dark:text-amber-400' },
  offline: { label: 'Ngoại tuyến', dotClass: 'bg-rose-500', textClass: 'text-rose-600 dark:text-rose-400' }
};

export const RackSubDeviceTooltip: React.FC<RackSubDeviceTooltipProps> = ({
  info,
  containerRect,
  onMouseEnter,
  onMouseLeave,
  onOpenDeepInspect,
  onSelectDevice,
  onClose
}) => {
  const { asset, startU, uHeight, side, tempC, zone, heatBtuPerHour, rackName, rackId } = info;
  const zoneMeta = ZONE_META[zone];
  const statusMeta = STATUS_META[asset.status] || STATUS_META.online;

  const tooltipW = 286;
  const tooltipH = 264;
  const margin = 12;

  let left = info.clientX + 16;
  let top = info.clientY - 24;

  if (containerRect) {
    const relX = info.clientX - containerRect.left;
    const relY = info.clientY - containerRect.top;
    const maxW = Math.max(tooltipW + margin, containerRect.width - tooltipW - margin);
    const maxH = Math.max(tooltipH + margin, containerRect.height - tooltipH - margin);
    left = relX + 16;
    if (left > containerRect.width - tooltipW - margin) {
      left = relX - tooltipW - 16;
    }
    left = Math.max(margin, Math.min(maxW, left));
    top = Math.max(margin, Math.min(maxH, relY - 24));
  }

  const endU = startU + Math.max(1, uHeight) - 1;
  const uRangeLabel = uHeight > 1 ? `U${startU}–U${endU} (${uHeight}U)` : `U${startU} (1U)`;
  const totalPorts = asset.ports?.length ?? 0;
  const upPorts = asset.ports?.filter(p => p.status === 'up').length ?? 0;
  const poePorts = asset.ports?.filter(p => p.poe).length ?? 0;
  const powerWatts = Math.max(0, asset.powerWatts || 0);
  const weightKg = typeof asset.weightKg === 'number' ? asset.weightKg : 0;

  return (
    <div
      role="tooltip"
      data-testid="rack-subdevice-tooltip"
      data-asset-id={asset.id}
      data-rack-id={rackId}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={e => e.stopPropagation()}
      style={{
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${tooltipW}px`
      }}
      className="pointer-events-auto absolute z-40 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-2xl text-slate-800 dark:text-slate-100 overflow-hidden"
    >
      {/* Top thermal accent strip */}
      <div className="h-1 w-full" style={{ backgroundColor: zoneMeta.barColor }} />

      <div className="p-2.5 space-y-2 text-[11px]">
        {/* Header: Device identity + close */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotClass}`} />
              <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                {asset.name}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {asset.vendor ? `${asset.vendor} · ` : ''}Model: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{asset.model || asset.category.toUpperCase()}</span>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              data-testid="rack-subdevice-tooltip-close"
              onClick={onClose}
              aria-label="Đóng thông số thiết bị"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Location & Temperature Strip */}
        <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80">
          <div className="font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">
            {rackName} · {side === 'rear' ? 'Sau' : 'Trước'} · {uRangeLabel}
          </div>
          <span
            data-testid="rack-subdevice-tooltip-temp"
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold shrink-0 ${zoneMeta.badgeClass}`}
          >
            <Thermometer className="w-3 h-3" />
            {tempC.toFixed(1)}°C · {zoneMeta.label}
          </span>
        </div>

        {(zone === 'hot' || zone === 'warm') && (
          <div
            data-testid="rack-subdevice-thermal-warning"
            className={`px-2 py-1 rounded-md text-[10px] font-medium border ${
              zone === 'hot'
                ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-400/40'
                : 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-400/40'
            }`}
          >
            {zone === 'hot'
              ? 'Cảnh báo quá nhiệt: Cần tăng lưu lượng gió hoặc tách khe U tản nhiệt.'
              : 'Nhiệt độ tăng cao: Theo dõi lưu thông khí quanh khe U này.'}
          </div>
        )}

        {/* Technical Specs Grid */}
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div className="px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
            <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <Zap className="w-3 h-3 text-amber-500" />
              <span>Công suất / Nhiệt</span>
            </div>
            <div className="font-mono font-semibold text-slate-800 dark:text-slate-100 mt-0.5">
              {powerWatts}W · {heatBtuPerHour} BTU/h
            </div>
          </div>

          <div className="px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
            <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <Weight className="w-3 h-3 text-slate-500" />
              <span>Khối lượng / Trạng thái</span>
            </div>
            <div className={`font-semibold mt-0.5 ${statusMeta.textClass}`}>
              <span className="font-mono text-slate-800 dark:text-slate-100">{weightKg.toFixed(1)}kg</span> · {statusMeta.label}
            </div>
          </div>

          <div className="px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
            <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <Network className="w-3 h-3 text-blue-500" />
              <span>IP / VLAN</span>
            </div>
            <div className="font-mono font-semibold text-slate-800 dark:text-slate-100 truncate mt-0.5">
              {asset.ipAddress || 'Chưa gán IP'}{asset.vlan ? ` · V${asset.vlan}` : ''}
            </div>
          </div>

          <div className="px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
            <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <Cpu className="w-3 h-3 text-emerald-500" />
              <span>Cổng kết nối</span>
            </div>
            <div className="font-mono font-semibold text-slate-800 dark:text-slate-100 mt-0.5">
              {totalPorts > 0 ? `${upPorts}/${totalPorts} UP` : 'Không có cổng'}
              {poePorts > 0 ? ` (${poePorts} PoE)` : ''}
            </div>
          </div>
        </div>

        {/* Extra identifiers + PoE / Sensor specs if present */}
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 px-0.5">
          <span className="truncate">
            Tag: {asset.assetTag || '—'} · S/N: {asset.serialNumber || '—'}
          </span>
          {asset.poeBudgetWatts ? (
            <span className="text-sky-600 dark:text-sky-400 font-semibold">
              PoE Budget: {asset.poeBudgetWatts}W
            </span>
          ) : asset.sensorSpecs?.humidityPct !== undefined ? (
            <span className="inline-flex items-center gap-0.5 text-teal-600 dark:text-teal-400 font-semibold">
              <Activity className="w-3 h-3" /> RH {asset.sensorSpecs.humidityPct}%
            </span>
          ) : null}
        </div>

        {/* Interactive Actions */}
        {(onOpenDeepInspect || onSelectDevice) && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200 dark:border-slate-800">
            {onSelectDevice && (
              <button
                type="button"
                data-testid="rack-subdevice-tooltip-select"
                onClick={() => onSelectDevice(asset.id, rackId)}
                className="flex-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-[10px] transition-colors"
              >
                Chọn thiết bị
              </button>
            )}
            {onOpenDeepInspect && (
              <button
                type="button"
                data-testid="rack-subdevice-tooltip-inspect"
                onClick={() => onOpenDeepInspect(asset.id)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[10px] transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Chi tiết kỹ thuật</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
