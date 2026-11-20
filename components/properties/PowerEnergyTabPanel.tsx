import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Zap
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { ProjectState, SelectionState } from '../../types/infrastructure';
import {
  computeProjectPoeSummary,
  computeSwitchPoeBreakdown,
  computeUpsBatteryRuntime,
  simulateBranchOutage,
  SwitchPoeBreakdownItem
} from '../../utils/poeCalculator';

interface PowerEnergyTabPanelProps {
  project: ProjectState;
  selection: SelectionState;
  onSelectNode?: (nodeId: string) => void;
}

interface ChartDatum {
  assetId: string;
  nodeId?: string;
  name: string;
  shortName: string;
  model: string;
  consumedWatts: number;
  budgetWatts: number;
  headroomWatts: number;
  utilizationPct: number | null;
  status: SwitchPoeBreakdownItem['status'];
  pdCount: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ChartDatum }>;
  isDarkMode: boolean;
}

const SwitchPoeTooltip: React.FC<CustomTooltipProps> = ({ active, payload, isDarkMode }) => {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }

  const item = payload[0].payload;
  const isOverload = item.status === 'overload';
  const isWarning = item.status === 'warning';

  const statusText = isOverload
    ? item.budgetWatts === 0
      ? 'Chưa khai báo hạn mức'
      : `Vượt ngưỡng ${Math.abs(item.headroomWatts)} W`
    : isWarning
    ? `Tải cao · dư ${item.headroomWatts} W`
    : item.consumedWatts === 0
    ? `Chưa có tải · dư ${item.budgetWatts} W`
    : `An toàn · dư ${item.headroomWatts} W`;

  return (
    <div
      className={`rounded-lg border px-3 py-2 shadow-lg text-xs max-w-[230px] ${
        isDarkMode
          ? 'bg-slate-900 border-slate-700 text-slate-100'
          : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      <div className="font-semibold truncate">{item.name}</div>
      {item.model && (
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate mb-1.5">
          {item.model}
        </div>
      )}
      <div className="space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400 font-sans">Tiêu thụ PoE:</span>
          <span className="font-semibold text-[#155EEF] dark:text-blue-400">
            {item.consumedWatts} W
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400 font-sans">Hạn mức (Budget):</span>
          <span className="font-semibold">{item.budgetWatts} W</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400 font-sans">Mức tải:</span>
          <span className="font-semibold">
            {item.utilizationPct !== null ? `${item.utilizationPct}%` : '—'} · {item.pdCount} TB
          </span>
        </div>
      </div>
      <div
        className={`mt-1.5 pt-1.5 border-t font-medium ${
          isDarkMode ? 'border-slate-800' : 'border-slate-100'
        } ${
          isOverload
            ? 'text-rose-600 dark:text-rose-400'
            : isWarning
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-emerald-600 dark:text-emerald-400'
        }`}
      >
        {statusText}
      </div>
    </div>
  );
};

export const PowerEnergyTabPanel: React.FC<PowerEnergyTabPanelProps> = ({
  project,
  selection,
  onSelectNode
}) => {
  const [copied, setCopied] = useState(false);
  const [expandedSwitchIds, setExpandedSwitchIds] = useState<Record<string, boolean>>({});
  const [breakdownTab, setBreakdownTab] = useState<'switches' | 'devices' | 'category'>('switches');
  const primaryUpsSpecs = useMemo(() => {
    const upsAsset = Object.values(project.assets).find(
      a => a.category === 'ups' && a.upsSpecs && a.upsSpecs.batteryAh > 0
    );
    return upsAsset?.upsSpecs;
  }, [project.assets]);

  const [upsBatteryAh, setUpsBatteryAh] = useState<number>(() => primaryUpsSpecs?.batteryAh ?? 100);
  const [upsBatteryVoltage, setUpsBatteryVoltage] = useState<number>(() => primaryUpsSpecs?.batteryVoltageV ?? 12);
  const [upsBatteryCount, setUpsBatteryCount] = useState<number>(() => primaryUpsSpecs?.batteryCount ?? 4);
  const [outageNodeId, setOutageNodeId] = useState<string>('');

  const isDarkMode = Boolean(project.settings.isDarkMode);
  const projectSummary = useMemo(() => computeProjectPoeSummary(project), [project]);
  const switchSummary = useMemo(() => computeSwitchPoeBreakdown(project), [project]);

  const totalSystemWatts = useMemo(
    () => Object.values(project.assets).reduce((acc, a) => acc + (a.powerWatts || 0), 0),
    [project.assets]
  );

  const selectedAssetId = useMemo(() => {
    if (selection.type !== 'node' || !selection.id) return null;
    return project.nodes.find(n => n.id === selection.id)?.assetId || null;
  }, [project.nodes, selection.id, selection.type]);

  const chartData: ChartDatum[] = useMemo(
    () =>
      switchSummary.switches.map(sw => ({
        assetId: sw.assetId,
        nodeId: sw.nodeId,
        name: sw.name,
        shortName: sw.shortName,
        model: sw.model,
        consumedWatts: sw.consumedWatts,
        budgetWatts: sw.budgetWatts,
        headroomWatts: sw.headroomWatts,
        utilizationPct: sw.utilizationPct,
        status: sw.status,
        pdCount: sw.connectedPds.length
      })),
    [switchSummary.switches]
  );

  const toggleSwitchRow = (assetId: string) => {
    setExpandedSwitchIds(prev => ({ ...prev, [assetId]: !prev[assetId] }));
  };

  const getConsumedBarColor = (status: SwitchPoeBreakdownItem['status']) => {
    if (status === 'overload') return '#DC2626';
    if (status === 'warning') return '#D97706';
    return isDarkMode ? '#3B82F6' : '#155EEF';
  };

  const budgetBarColor = isDarkMode ? '#475569' : '#CBD5E1';
  const axisTickColor = isDarkMode ? '#94A3B8' : '#64748B';
  const gridStrokeColor = isDarkMode ? '#1E293B' : '#E2E8F0';

  const handleCopyReport = async () => {
    const switchLines = switchSummary.switches.map(
      sw =>
        `- ${sw.name} (${sw.model}): ${sw.consumedWatts} W / ${sw.budgetWatts} W (${
          sw.utilizationPct !== null ? `${sw.utilizationPct}%` : 'Chưa đặt hạn mức'
        }) · ${sw.connectedPds.length} thiết bị PoE`
    );
    const lines = [
      `BÁO CÁO TRỰC QUAN HÓA CÔNG SUẤT POE (${project.name})`,
      `Tổng tiêu thụ PoE: ${projectSummary.totalPoeWatts} W · Ngân sách PSE: ${projectSummary.totalPoeBudgetWatts} W · Tổng tải AC: ${(totalSystemWatts / 1000).toFixed(2)} kW`,
      ...(switchLines.length > 0 ? ['Chi tiết theo Switch / PSE:', ...switchLines] : []),
      ...(switchSummary.unassignedPds.length > 0
        ? [
            `Thiết bị PoE chưa nối dây vào Switch (${switchSummary.unassignedWatts} W):`,
            ...switchSummary.unassignedPds.map(d => `- ${d.name}: ${d.watts} W`)
          ]
        : [])
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures in restricted environments
    }
  };

  const overallStatusText = (() => {
    switch (projectSummary.status) {
      case 'idle':
        return 'Chưa có tải tiêu thụ PoE';
      case 'no_pse':
        return 'Chưa có Switch/NVR cấp nguồn PoE';
      case 'overload':
        return `Quá tải vượt ${Math.abs(projectSummary.headroomWatts)} W`;
      case 'warning':
        return `Tải cao ≥80% · dư ${projectSummary.headroomWatts} W`;
      default:
        return `An toàn · còn dư ${projectSummary.headroomWatts} W`;
    }
  })();

  const minChartWidthPx = Math.max(260, chartData.length * 74);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text overflow-y-auto">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 shrink-0">
        <div className="px-3 py-2.5">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Tiêu thụ PoE</div>
          <div
            className={`font-semibold text-[13px] font-mono tabular-nums mt-0.5 ${
              projectSummary.status === 'overload'
                ? 'text-rose-600 dark:text-rose-400'
                : projectSummary.status === 'warning'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-[#155EEF] dark:text-blue-400'
            }`}
          >
            {projectSummary.totalPoeWatts} W
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Hạn mức PSE</div>
          <div className="font-semibold text-[13px] font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
            {projectSummary.totalPoeBudgetWatts > 0 ? `${projectSummary.totalPoeBudgetWatts} W` : '—'}
          </div>
        </div>
        <div className="px-3 py-2.5">
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Tổng tải AC</div>
          <div className="font-semibold text-[13px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
            {(totalSystemWatts / 1000).toFixed(2)} kW
          </div>
        </div>
      </div>

      {/* Overall Status Strip */}
      <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <span className="flex items-center gap-1.5 font-medium truncate">
          {projectSummary.status === 'overload' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-[#155EEF] dark:text-blue-400 shrink-0" />
          )}
          <span
            className={
              projectSummary.status === 'overload'
                ? 'text-rose-600 dark:text-rose-400'
                : projectSummary.status === 'warning' || projectSummary.status === 'no_pse'
                ? 'text-amber-600 dark:text-amber-400'
                : projectSummary.status === 'nominal'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-500 dark:text-slate-400'
            }
          >
            {overallStatusText}
          </span>
        </span>
        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
          {projectSummary.utilizationPct !== null ? `${projectSummary.utilizationPct}%` : '—'}
        </span>
      </div>

      {/* Section 1: Recharts Bar Chart - Trực quan hóa công suất PoE */}
      <section
        aria-label="Trực quan hóa công suất PoE theo từng Switch"
        className="px-3.5 py-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-[13px] text-slate-900 dark:text-white">
            Trực quan hóa công suất PoE
          </h3>
          <span className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400">
            {chartData.length} Switch / PSE
          </span>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          So sánh công suất PoE thực tế qua cáp với hạn mức cho phép (Budget) của từng switch.
        </p>

        {chartData.length === 0 ? (
          <div className="py-6 px-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center space-y-1.5">
            <div className="font-medium text-slate-700 dark:text-slate-200">
              Chưa có Switch / thiết bị cấp nguồn PoE
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Thêm Access Switch PoE hoặc NVR PoE từ Thư viện thiết bị để xem biểu đồ so sánh tải và hạn mức.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto pb-1">
            <div style={{ width: '100%', minWidth: `${minChartWidthPx}px`, height: 224 }}>
              <ResponsiveContainer width="100%" height={224}>
                <BarChart
                  data={chartData}
                  margin={{ top: 10, right: 8, left: -12, bottom: 4 }}
                  barGap={4}
                  barCategoryGap="22%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={gridStrokeColor}
                  />
                  <XAxis
                    dataKey="shortName"
                    tick={{ fontSize: 12, fill: axisTickColor }}
                    axisLine={{ stroke: gridStrokeColor }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: axisTickColor }}
                    axisLine={false}
                    tickLine={false}
                    unit="W"
                    width={50}
                  />
                  <Tooltip
                    cursor={{ fill: isDarkMode ? 'rgba(51, 65, 85, 0.3)' : 'rgba(226, 232, 240, 0.45)' }}
                    content={<SwitchPoeTooltip isDarkMode={isDarkMode} />}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '12px', paddingTop: '6px' }}
                    iconSize={10}
                  />
                  <Bar
                    name="Tiêu thụ (W)"
                    dataKey="consumedWatts"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    onClick={entry => {
                      const nodeId = (entry as unknown as ChartDatum)?.nodeId;
                      if (nodeId && onSelectNode) onSelectNode(nodeId);
                    }}
                    className="cursor-pointer"
                  >
                    {chartData.map(entry => (
                      <Cell
                        key={`cell-${entry.assetId}`}
                        fill={getConsumedBarColor(entry.status)}
                        stroke={
                          selectedAssetId === entry.assetId
                            ? isDarkMode
                              ? '#F8FAFC'
                              : '#0F172A'
                            : 'none'
                        }
                        strokeWidth={selectedAssetId === entry.assetId ? 1.5 : 0}
                      />
                    ))}
                  </Bar>
                  <Bar
                    name="Hạn mức (W)"
                    dataKey="budgetWatts"
                    fill={budgetBarColor}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    onClick={entry => {
                      const nodeId = (entry as unknown as ChartDatum)?.nodeId;
                      if (nodeId && onSelectNode) onSelectNode(nodeId);
                    }}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* Section 2: Segmented Breakdown (Theo Switch | Theo Thiết bị | Theo Nhóm) */}
      <div className="px-3.5 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
          {(
            [
              { id: 'switches', label: `Switch (${switchSummary.switches.length})` },
              { id: 'devices', label: `Thiết bị (${projectSummary.poweredDeviceCount})` },
              { id: 'category', label: 'Nhóm tải' }
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBreakdownTab(tab.id)}
              className={`py-1.5 px-1 rounded-md text-xs font-semibold truncate transition-colors ${
                breakdownTab === tab.id
                  ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Breakdown Content */}
      <div className="flex-1 min-h-0">
        {breakdownTab === 'switches' && (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {switchSummary.switches.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có Switch cấp nguồn PoE trong sơ đồ.
              </div>
            ) : (
              switchSummary.switches.map(sw => {
                const isOpen = Boolean(expandedSwitchIds[sw.assetId]);
                const isSelected = selectedAssetId === sw.assetId;
                const barWidth =
                  sw.utilizationPct !== null
                    ? Math.max(sw.consumedWatts > 0 ? 4 : 0, Math.min(100, sw.utilizationPct))
                    : sw.consumedWatts > 0
                    ? 100
                    : 0;

                return (
                  <div
                    key={sw.assetId}
                    className={`px-3.5 py-2.5 space-y-2 transition-colors ${
                      isSelected ? 'bg-blue-50/50 dark:bg-blue-950/25' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSwitchRow(sw.assetId)}
                        className="flex items-start gap-1.5 min-w-0 text-left flex-1"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-white truncate">
                            {sw.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {sw.model} · {sw.connectedPds.length} thiết bị PoE
                          </div>
                        </div>
                      </button>

                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div
                          className={`font-semibold ${
                            sw.status === 'overload'
                              ? 'text-rose-600 dark:text-rose-400'
                              : sw.status === 'warning'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {sw.consumedWatts} / {sw.budgetWatts} W
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {sw.utilizationPct !== null ? `${sw.utilizationPct}% tải` : 'Chưa đặt hạn mức'}
                        </div>
                      </div>
                    </div>

                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          sw.status === 'overload'
                            ? 'bg-rose-500'
                            : sw.status === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-[#155EEF] dark:bg-blue-500'
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>

                    {isOpen && (
                      <div className="pt-1 pl-4 space-y-1.5">
                        {sw.nodeId && onSelectNode && (
                          <button
                            type="button"
                            onClick={() => onSelectNode(sw.nodeId!)}
                            className="text-xs font-medium text-[#155EEF] dark:text-blue-400 hover:underline"
                          >
                            Chọn {sw.name} trên bản vẽ →
                          </button>
                        )}
                        {sw.connectedPds.length === 0 ? (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Chưa có thiết bị PoE nào nối dây vào switch này.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                            {sw.connectedPds.map(pd => (
                              <button
                                key={pd.assetId}
                                type="button"
                                onClick={() => pd.nodeId && onSelectNode?.(pd.nodeId)}
                                className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-100/70 dark:hover:bg-slate-800 transition-colors"
                              >
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                                    {pd.name}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono">
                                    {pd.categoryLabel} · {pd.poeStandardLabel}
                                  </div>
                                </div>
                                <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white shrink-0">
                                  {pd.watts} W
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {switchSummary.unassignedPds.length > 0 && (
              <div className="px-3.5 py-2.5 bg-amber-50/40 dark:bg-amber-950/15 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-800 dark:text-amber-300">
                    Chưa nối vào Switch ({switchSummary.unassignedPds.length} TB)
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-300">
                    {switchSummary.unassignedWatts} W
                  </span>
                </div>
                <div className="space-y-1">
                  {switchSummary.unassignedPds.map(pd => (
                    <button
                      key={pd.assetId}
                      type="button"
                      onClick={() => pd.nodeId && onSelectNode?.(pd.nodeId)}
                      className="w-full flex items-center justify-between gap-2 text-left py-1 hover:underline"
                    >
                      <span className="truncate text-slate-700 dark:text-slate-200">{pd.name}</span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300 shrink-0">
                        {pd.watts} W
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {breakdownTab === 'devices' && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {projectSummary.devices.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có thiết bị tiêu thụ PoE (Camera IP, Wi-Fi AP hoặc thiết bị bật PoE).
              </div>
            ) : (
              projectSummary.devices.map(item => (
                <button
                  key={item.assetId}
                  type="button"
                  onClick={() => item.nodeId && onSelectNode?.(item.nodeId)}
                  className="w-full px-3.5 py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 dark:text-slate-100 truncate">
                      {item.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
                      {item.categoryLabel} · {item.poeStandardLabel}
                      {item.ipAddress ? ` · ${item.ipAddress}` : ''}
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white shrink-0">
                    {item.watts} W
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {breakdownTab === 'category' && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {projectSummary.byCategory.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có dữ liệu nhóm thiết bị tiêu thụ PoE.
              </div>
            ) : (
              projectSummary.byCategory.map(cat => (
                <div key={cat.key} className="px-3.5 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                      {cat.label}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                      <span className="text-slate-500 dark:text-slate-400">{cat.count} TB</span>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {cat.totalWatts} W
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-[#155EEF] dark:bg-blue-500 transition-all"
                        style={{ width: `${Math.max(4, cat.percentage)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                      {cat.percentage}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Section 3: UPS Battery Runtime & Branch Outage Simulation */}
      <div className="px-3.5 py-3 border-t border-slate-200 dark:border-slate-800 space-y-3 shrink-0 bg-slate-50/40 dark:bg-slate-800/20">
        {(() => {
          const loadW = totalSystemWatts > 0 ? totalSystemWatts : projectSummary.totalPoeWatts;
          const upsResult = computeUpsBatteryRuntime({
            totalLoadWatts: loadW,
            batteryAh: upsBatteryAh,
            batteryVoltageV: upsBatteryVoltage,
            batteryCount: upsBatteryCount
          });
          const candidateUpstreamNodes = project.nodes.filter(n => {
            const a = n.assetId ? project.assets[n.assetId] : undefined;
            return a && ['switch', 'core_switch', 'router', 'ups', 'pdu', 'electrical_panel'].includes(a.category);
          });
          const outageSim = outageNodeId ? simulateBranchOutage(project, [outageNodeId]) : null;
          return (
            <>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white">
                    Dự toán ắc quy UPS (Ah)
                  </span>
                  <div className="flex items-center gap-2">
                    {primaryUpsSpecs && (
                      <button
                        type="button"
                        onClick={() => {
                          setUpsBatteryAh(primaryUpsSpecs.batteryAh);
                          setUpsBatteryVoltage(primaryUpsSpecs.batteryVoltageV);
                          setUpsBatteryCount(primaryUpsSpecs.batteryCount);
                        }}
                        className="text-[10.5px] font-medium text-[#155EEF] dark:text-blue-400 hover:underline"
                        title="Đồng bộ thông số từ UPS trong dự án"
                      >
                        Theo UPS
                      </button>
                    )}
                    <span
                      className={`font-mono font-bold text-xs ${
                        upsResult.status === 'adequate'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : upsResult.status === 'short'
                          ? 'text-amber-600 dark:text-amber-400'
                          : upsResult.status === 'critical'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {upsResult.runtimeMinutes > 0
                        ? `${upsResult.runtimeMinutes} phút (${upsResult.runtimeHours}h)`
                        : 'Chưa có tải'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <label className="text-[10.5px] text-slate-500 block mb-0.5">Dung lượng (Ah)</label>
                    <input
                      type="number"
                      min={5}
                      value={upsBatteryAh}
                      onChange={e => setUpsBatteryAh(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10.5px] text-slate-500 block mb-0.5">Điện áp (V)</label>
                    <select
                      value={upsBatteryVoltage}
                      onChange={e => setUpsBatteryVoltage(parseInt(e.target.value, 10) || 12)}
                      className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                    >
                      <option value={12}>12V</option>
                      <option value={24}>24V</option>
                      <option value={48}>48V</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10.5px] text-slate-500 block mb-0.5">Số bình</label>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={upsBatteryCount}
                      onChange={e => setUpsBatteryCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 font-mono flex justify-between">
                  <span>Khả dụng: {upsResult.usableEnergyWh} Wh</span>
                  <span>Tải: {loadW} W</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2">
                <div className="font-semibold text-xs text-slate-900 dark:text-white">
                  Mô phỏng mất nhánh Switch / UPS
                </div>
                <select
                  aria-label="Chọn Switch hoặc UPS để mô phỏng mất nguồn"
                  value={outageNodeId}
                  onChange={e => setOutageNodeId(e.target.value)}
                  className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                >
                  <option value="">-- Chọn Switch / UPS cần kiểm tra --</option>
                  {candidateUpstreamNodes.map(n => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
                {outageSim && (
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between font-mono">
                      <span className="font-sans text-slate-600 dark:text-slate-300">Thiết bị gián đoạn:</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">
                        {outageSim.affectedDownstreamDevices.length} TB · {outageSim.lostPoeWatts}W PoE
                      </span>
                    </div>
                    {outageSim.affectedDownstreamDevices.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {outageSim.affectedDownstreamDevices.slice(0, 6).map(d => (
                          <button
                            key={d.nodeId}
                            type="button"
                            onClick={() => onSelectNode?.(d.nodeId)}
                            className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-[10.5px] hover:underline"
                          >
                            {d.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* Footer Copy Report CTA */}
      <div className="px-3.5 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 shrink-0">
        <button
          type="button"
          onClick={handleCopyReport}
          className="ent-btn-secondary w-full h-8 text-xs"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-600 dark:text-emerald-400">
                Đã sao chép báo cáo PoE
              </span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-500" />
              <span>Sao chép báo cáo PoE</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
