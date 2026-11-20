import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Network,
  Server
} from 'lucide-react';
import { DeviceCategory, ProjectState } from '../../types/infrastructure';
import {
  SubnetDeviceIpEntry,
  SubnetIpStatRow,
  computeProjectSubnetIpStats
} from '../../utils/ipAutoAssign';
import { matchesAccentInsensitiveQuery } from '../../utils/helpCatalog';

interface SubnetIpStatsPanelProps {
  project: ProjectState;
  variant?: 'full' | 'compact';
  searchQuery?: string;
  floorFilter?: string;
  onSelectNode?: (nodeId: string) => void;
  onOpenFullInBom?: () => void;
}

const CATEGORY_LABEL_MAP: Partial<Record<DeviceCategory, string>> = {
  router: 'Router',
  gateway: 'Gateway',
  firewall: 'Firewall',
  core_switch: 'Core Switch',
  switch: 'Switch',
  server: 'Server',
  storage: 'Storage / NAS',
  nvr: 'NVR / Đầu ghi',
  ap: 'Wi-Fi AP',
  camera: 'Camera IP',
  workstation: 'Máy trạm / PC',
  printer: 'Máy in',
  ups: 'UPS',
  pdu: 'PDU',
  sensor: 'Cảm biến',
  iot: 'IoT'
};

const STATUS_BADGE_MAP: Record<
  SubnetDeviceIpEntry['status'],
  { label: string; cls: string }
> = {
  online: {
    label: 'Online',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
  },
  standby: {
    label: 'Dự phòng',
    cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
  },
  maintenance: {
    label: 'Bảo trì',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
  },
  offline: {
    label: 'Offline',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
  }
};

function formatCategoryLabel(category: DeviceCategory): string {
  return CATEGORY_LABEL_MAP[category] || category;
}

function getUtilizationBarColor(pct: number, hasDuplicate: boolean): string {
  if (hasDuplicate || pct >= 90) return 'bg-rose-500';
  if (pct >= 75) return 'bg-amber-500';
  return 'bg-[#155EEF]';
}

export const SubnetIpStatsPanel: React.FC<SubnetIpStatsPanelProps> = ({
  project,
  variant = 'full',
  searchQuery = '',
  floorFilter = 'all',
  onSelectNode,
  onOpenFullInBom
}) => {
  const stats = useMemo(() => computeProjectSubnetIpStats(project), [project]);
  const [expandedSubnetIds, setExpandedSubnetIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (stats.subnets.length > 0 && stats.subnets.length <= 3) {
      initial[stats.subnets[0].id] = true;
    }
    return initial;
  });
  const [showUnassigned, setShowUnassigned] = useState(false);

  const trimmedQuery = searchQuery.trim();
  const isFilteredByFloor = floorFilter !== 'all';

  const filteredSubnets = useMemo(() => {
    return stats.subnets
      .map(row => {
        const floorDevices = isFilteredByFloor
          ? row.devices.filter(d => d.floorId === floorFilter)
          : row.devices;

        if (!trimmedQuery) {
          if (isFilteredByFloor && floorDevices.length === 0) return null;
          return { ...row, visibleDevices: floorDevices };
        }

        const subnetMetaHaystack = `${row.name} ${row.cidr} ${row.vlanId !== undefined ? `VLAN ${row.vlanId}` : ''} ${row.gateway || ''}`;
        const subnetMatches = matchesAccentInsensitiveQuery(subnetMetaHaystack, trimmedQuery);
        const matchingDevices = floorDevices.filter(d => {
          const devHaystack = `${d.name} ${d.ipAddress} ${d.macAddress} ${d.vlan} ${d.floorName} ${formatCategoryLabel(d.category)}`;
          return matchesAccentInsensitiveQuery(devHaystack, trimmedQuery);
        });

        if (subnetMatches) {
          if (isFilteredByFloor && floorDevices.length === 0) return null;
          return {
            ...row,
            visibleDevices: matchingDevices.length > 0 ? matchingDevices : floorDevices
          };
        }
        if (matchingDevices.length > 0) {
          return { ...row, visibleDevices: matchingDevices };
        }
        return null;
      })
      .filter((item): item is SubnetIpStatRow & { visibleDevices: SubnetDeviceIpEntry[] } =>
        Boolean(item)
      );
  }, [stats.subnets, isFilteredByFloor, floorFilter, trimmedQuery]);

  const filteredUnassigned = useMemo(() => {
    return stats.unassignedDevices.filter(d => {
      if (isFilteredByFloor && d.floorId !== floorFilter) return false;
      if (!trimmedQuery) return true;
      const haystack = `${d.name} ${d.vlan} ${d.floorName} ${formatCategoryLabel(d.category)}`;
      return matchesAccentInsensitiveQuery(haystack, trimmedQuery);
    });
  }, [stats.unassignedDevices, isFilteredByFloor, floorFilter, trimmedQuery]);

  const toggleSubnet = (id: string) => {
    setExpandedSubnetIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const allExpanded =
    filteredSubnets.length > 0 && filteredSubnets.every(s => Boolean(expandedSubnetIds[s.id]));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedSubnetIds({});
    } else {
      const next: Record<string, boolean> = {};
      for (const s of filteredSubnets) next[s.id] = true;
      setExpandedSubnetIds(next);
    }
  };

  if (variant === 'compact') {
    return (
      <div className="space-y-2.5">
        {/* Compact KPI Strip */}
        <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 text-center">
          <div className="px-2 py-1.5">
            <div className="text-[10px] text-slate-500 dark:text-slate-400">Subnet</div>
            <div className="font-mono font-bold text-xs text-slate-900 dark:text-white tabular-nums">
              {stats.totals.subnetCount}
            </div>
          </div>
          <div className="px-2 py-1.5">
            <div className="text-[10px] text-slate-500 dark:text-slate-400">IP đã dùng</div>
            <div className="font-mono font-bold text-xs text-[#155EEF] dark:text-blue-400 tabular-nums">
              {stats.totals.usedIpCount}
            </div>
          </div>
          <div className="px-2 py-1.5">
            <div className="text-[10px] text-slate-500 dark:text-slate-400">Còn trống</div>
            <div className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
              {stats.totals.freeIpCount}
            </div>
          </div>
        </div>

        {/* Compact Subnet Table */}
        {filteredSubnets.length === 0 ? (
          <div className="px-2.5 py-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 text-center">
            Chưa có Subnet hoặc thiết bị được cấu hình IPv4.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
            <div className="grid grid-cols-[minmax(0,1fr)_50px_54px_40px] gap-1 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              <span>Subnet / CIDR</span>
              <span className="text-right">Dùng</span>
              <span className="text-right">Trống</span>
              <span className="text-right">%</span>
            </div>
            {filteredSubnets.map(row => {
              const isExpanded = Boolean(expandedSubnetIds[row.id]);
              return (
                <div key={row.id} className="bg-white dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => toggleSubnet(row.id)}
                    aria-expanded={isExpanded}
                    className="w-full grid grid-cols-[minmax(0,1fr)_50px_54px_40px] gap-1 items-center px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="min-w-0 flex items-start gap-1.5">
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1">
                          <span className="truncate">{row.name}</span>
                          {row.duplicateIpCount > 0 && (
                            <span title={`Có ${row.duplicateIpCount} thiết bị trùng IP`} className="shrink-0 inline-flex">
                              <AlertTriangle className="w-3 h-3 text-rose-500" />
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-[#155EEF] dark:text-blue-400 truncate">
                          {row.cidr}
                          {row.vlanId !== undefined ? ` · V${row.vlanId}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className="text-right font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                      {row.usedIpCount}
                    </span>
                    <span className="text-right font-mono text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {row.source === 'unmatched' ? '—' : row.freeIpCount}
                    </span>
                    <span className="text-right font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {row.source === 'unmatched' ? '—' : `${row.utilizationPct}%`}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-2.5 pb-2 pt-1 bg-slate-50/70 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                        <span>Thiết bị ({row.visibleDevices.length})</span>
                        {row.gateway && (
                          <span className="font-mono">GW: {row.gateway}</span>
                        )}
                      </div>
                      {row.visibleDevices.length === 0 ? (
                        <div className="text-[10px] text-slate-400 italic py-1">
                          Chưa có thiết bị nào dùng IP trong dải này.
                        </div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto divide-y divide-slate-200/60 dark:divide-slate-800 rounded border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                          {row.visibleDevices.map(dev => {
                            const clickable = Boolean(dev.nodeId && onSelectNode);
                            return (
                              <div
                                key={dev.assetId}
                                className="px-2 py-1 flex items-center justify-between gap-2 text-[11px]"
                              >
                                <div className="min-w-0 flex-1">
                                  {clickable ? (
                                    <button
                                      type="button"
                                      onClick={() => dev.nodeId && onSelectNode?.(dev.nodeId)}
                                      className="font-medium text-slate-800 dark:text-slate-200 hover:text-[#155EEF] dark:hover:text-blue-400 truncate block text-left w-full"
                                      title="Nhấp để chọn thiết bị trên bản vẽ"
                                    >
                                      {dev.name}
                                    </button>
                                  ) : (
                                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                                      {dev.name}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-slate-400 truncate block">
                                    {formatCategoryLabel(dev.category)}
                                  </span>
                                </div>
                                <span
                                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                    dev.isDuplicateIp
                                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold'
                                      : 'text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {dev.ipAddress}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Compact Unassigned Section */}
        {filteredUnassigned.length > 0 && (
          <div className="rounded-lg border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/15 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowUnassigned(v => !v)}
              className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-medium text-amber-800 dark:text-amber-300"
            >
              <span>Thiết bị chưa gán IP ({filteredUnassigned.length})</span>
              {showUnassigned ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
            {showUnassigned && (
              <div className="px-2 pb-2 max-h-32 overflow-y-auto space-y-1">
                {filteredUnassigned.map(dev => (
                  <div
                    key={dev.assetId}
                    className="px-2 py-1 rounded bg-white dark:bg-slate-900 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between gap-2 text-[10px]"
                  >
                    {dev.nodeId && onSelectNode ? (
                      <button
                        type="button"
                        onClick={() => dev.nodeId && onSelectNode(dev.nodeId)}
                        className="font-medium text-slate-800 dark:text-slate-200 hover:text-[#155EEF] truncate text-left"
                      >
                        {dev.name}
                      </button>
                    ) : (
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                        {dev.name}
                      </span>
                    )}
                    <span className="text-slate-400 shrink-0">
                      {formatCategoryLabel(dev.category)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {onOpenFullInBom && (
          <button
            type="button"
            onClick={onOpenFullInBom}
            className="ent-btn-secondary w-full text-[11px]"
          >
            <Network className="w-3.5 h-3.5 text-[#155EEF]" />
            <span>Mở bảng IP chi tiết trong BOM</span>
          </button>
        )}
      </div>
    );
  }

  // FULL VARIANT (BOM Statistics Modal)
  return (
    <div className="p-4 sm:p-5 space-y-4">
      {/* 4-Card Subnet IP Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Tổng số Subnet
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
            {stats.totals.subnetCount} Subnet
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {stats.totals.assignedDeviceCount} thiết bị đã có IP
          </div>
        </div>

        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Tổng IP khả dụng (Host)
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
            {stats.totals.totalUsableIps.toLocaleString('vi-VN')} IP
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Không tính Network &amp; Broadcast
          </div>
        </div>

        <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20">
          <div className="text-[11px] font-semibold text-[#155EEF] dark:text-blue-400">
            Số IP đã dùng
          </div>
          <div className="text-lg font-bold text-[#155EEF] dark:text-blue-300 font-mono tabular-nums mt-0.5">
            {stats.totals.usedIpCount.toLocaleString('vi-VN')} IP
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 flex items-center gap-1.5 tabular-nums">
            <span>Tỷ lệ: {stats.totals.overallUtilizationPct}%</span>
            {stats.totals.duplicateIpCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold text-[10px]">
                {stats.totals.duplicateIpCount} trùng IP
              </span>
            )}
          </div>
        </div>

        <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
          <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            Số IP còn trống
          </div>
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300 font-mono tabular-nums mt-0.5">
            {stats.totals.freeIpCount.toLocaleString('vi-VN')} IP
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">
            {stats.totals.unassignedDeviceCount} thiết bị chưa gán IP
          </div>
        </div>
      </div>

      {/* Section Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <Network className="w-4 h-4 text-[#155EEF] dark:text-blue-400 shrink-0" />
          <span>
            Nhấp vào từng hàng Subnet để mở rộng danh sách thiết bị &amp; địa chỉ IP thuộc dải mạng đó.
          </span>
        </div>
        {filteredSubnets.length > 0 && (
          <button
            type="button"
            onClick={toggleExpandAll}
            className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap"
          >
            {allExpanded ? 'Thu gọn tất cả' : 'Mở rộng tất cả'}
          </button>
        )}
      </div>

      {/* Main Subnet Statistics Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <th className="py-2.5 px-3 w-8" />
              <th className="py-2.5 px-3">Tên Subnet / CIDR</th>
              <th className="py-2.5 px-3 whitespace-nowrap">VLAN</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Gateway / DHCP</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">IP khả dụng</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">IP đã dùng</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">IP còn trống</th>
              <th className="py-2.5 px-3 w-36 whitespace-nowrap">Mức sử dụng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
            {filteredSubnets.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="py-10 px-4 text-center text-slate-500 dark:text-slate-400"
                >
                  {trimmedQuery || isFilteredByFloor
                    ? 'Không tìm thấy Subnet hoặc thiết bị nào khớp bộ lọc hiện tại.'
                    : 'Chưa có dải Subnet hay thiết bị gán IPv4 nào trong dự án.'}
                </td>
              </tr>
            ) : (
              filteredSubnets.map(row => {
                const isExpanded = Boolean(expandedSubnetIds[row.id]);
                const barColor = getUtilizationBarColor(
                  row.utilizationPct,
                  row.duplicateIpCount > 0
                );
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      onClick={() => toggleSubnet(row.id)}
                      className={`cursor-pointer transition-colors ${
                        isExpanded
                          ? 'bg-blue-50/50 dark:bg-blue-950/25'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-3 text-slate-400">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-[#155EEF]" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </td>
                      <td className="py-2.5 px-3 min-w-[200px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {row.name}
                          </span>
                          {row.source === 'project_plan' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-[#155EEF] dark:bg-blue-950/60 dark:text-blue-300">
                              Quy hoạch dự án
                            </span>
                          )}
                          {row.source === 'inferred' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              Tự nhận diện
                            </span>
                          )}
                          {row.source === 'unmatched' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              Ngoài Subnet
                            </span>
                          )}
                          {row.overlaps.length > 0 && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                              title={`Chồng lấn với: ${row.overlaps.join(', ')}`}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Chồng dải
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-[#155EEF] dark:text-blue-400 mt-0.5">
                          {row.cidr}
                          {row.subnetMask !== '—' && (
                            <span className="text-slate-400 dark:text-slate-500">
                              {' '}
                              · Mask {row.subnetMask}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {row.vlanId !== undefined ? (
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                            VLAN {row.vlanId}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                          {row.gateway || '—'}
                        </div>
                        {row.dhcpRange && (
                          <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                            DHCP: {row.dhcpRange}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.source === 'unmatched'
                          ? '—'
                          : row.totalUsableIps.toLocaleString('vi-VN')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        <span className="font-bold text-[#155EEF] dark:text-blue-400">
                          {row.usedIpCount.toLocaleString('vi-VN')}
                        </span>
                        <div className="text-[10px] text-slate-400">
                          {row.visibleDevices.length} TB
                          {row.duplicateIpCount > 0 && (
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">
                              {' '}
                              · {row.duplicateIpCount} trùng
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                        {row.source === 'unmatched'
                          ? '—'
                          : row.freeIpCount.toLocaleString('vi-VN')}
                      </td>
                      <td className="py-2.5 px-3">
                        {row.source === 'unmatched' ? (
                          <span className="text-[11px] text-slate-400">—</span>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                              <span className="font-semibold text-slate-700 dark:text-slate-200">
                                {row.utilizationPct}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${Math.min(100, row.utilizationPct)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Expanded Device List per Subnet */}
                    {isExpanded && (
                      <tr className="bg-slate-50/80 dark:bg-slate-950/50">
                        <td colSpan={8} className="p-3 sm:px-6">
                          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/40">
                              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                                <Server className="w-3.5 h-3.5 text-[#155EEF]" />
                                <span>
                                  Danh sách thiết bị thuộc {row.name} ({row.visibleDevices.length})
                                </span>
                              </span>
                              {row.notes && (
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {row.notes}
                                </span>
                              )}
                            </div>

                            {row.visibleDevices.length === 0 ? (
                              <div className="py-5 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                                Chưa có thiết bị nào sử dụng địa chỉ IP trong Subnet này.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                      <th className="py-2 px-3">Thiết bị</th>
                                      <th className="py-2 px-3">Loại</th>
                                      <th className="py-2 px-3">Địa chỉ IP</th>
                                      <th className="py-2 px-3">Subnet Mask</th>
                                      <th className="py-2 px-3">VLAN</th>
                                      <th className="py-2 px-3">MAC</th>
                                      <th className="py-2 px-3">Tầng</th>
                                      <th className="py-2 px-3">Trạng thái</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-[11px]">
                                    {row.visibleDevices.map(dev => {
                                      const statusInfo = STATUS_BADGE_MAP[dev.status] || STATUS_BADGE_MAP.online;
                                      return (
                                        <tr
                                          key={dev.assetId}
                                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                                        >
                                          <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                                            {dev.nodeId && onSelectNode ? (
                                              <button
                                                type="button"
                                                onClick={() => dev.nodeId && onSelectNode(dev.nodeId)}
                                                className="inline-flex items-center gap-1 text-left hover:text-[#155EEF] dark:hover:text-blue-400 hover:underline"
                                                title="Chọn thiết bị trên bản vẽ"
                                              >
                                                <span>{dev.name}</span>
                                                <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                                              </button>
                                            ) : (
                                              <span>{dev.name}</span>
                                            )}
                                          </td>
                                          <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                            {formatCategoryLabel(dev.category)}
                                          </td>
                                          <td className="py-2 px-3 font-mono whitespace-nowrap">
                                            <span
                                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                                                dev.isDuplicateIp
                                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-bold'
                                                  : 'text-slate-800 dark:text-slate-200'
                                              }`}
                                            >
                                              <span>{dev.ipAddress}</span>
                                              {dev.isGatewayIp && (
                                                <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-[#155EEF] dark:bg-blue-950 dark:text-blue-300">
                                                  GW
                                                </span>
                                              )}
                                              {dev.isDuplicateIp && (
                                                <span className="text-[9px] font-bold">TRÙNG</span>
                                              )}
                                            </span>
                                          </td>
                                          <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                            {dev.subnetMask || '—'}
                                          </td>
                                          <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                            {dev.vlan || '—'}
                                          </td>
                                          <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                            {dev.macAddress || '—'}
                                          </td>
                                          <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                            {dev.floorName}
                                          </td>
                                          <td className="py-2 px-3 whitespace-nowrap">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${statusInfo.cls}`}>
                                              {statusInfo.label}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Collapsible Unassigned Devices List */}
      {filteredUnassigned.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowUnassigned(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Thiết bị mạng chưa gán địa chỉ IPv4 ({filteredUnassigned.length})</span>
            </span>
            {showUnassigned ? (
              <ChevronDown className="w-4 h-4 text-amber-700" />
            ) : (
              <ChevronRight className="w-4 h-4 text-amber-700" />
            )}
          </button>
          {showUnassigned && (
            <div className="border-t border-amber-200/80 dark:border-amber-900/50 bg-white dark:bg-slate-900 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-3">Thiết bị</th>
                    <th className="py-2 px-3">Loại</th>
                    <th className="py-2 px-3">VLAN</th>
                    <th className="py-2 px-3">Tầng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-[11px]">
                  {filteredUnassigned.map(dev => (
                    <tr key={dev.assetId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                        {dev.nodeId && onSelectNode ? (
                          <button
                            type="button"
                            onClick={() => dev.nodeId && onSelectNode(dev.nodeId)}
                            className="inline-flex items-center gap-1 hover:text-[#155EEF] dark:hover:text-blue-400 hover:underline"
                          >
                            <span>{dev.name}</span>
                            <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                          </button>
                        ) : (
                          <span>{dev.name}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                        {formatCategoryLabel(dev.category)}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-500">
                        {dev.vlan || '—'}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                        {dev.floorName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
