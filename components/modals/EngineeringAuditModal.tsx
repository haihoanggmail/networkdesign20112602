import React, { useMemo, useRef, useState } from 'react';
import { ProjectState } from '../../types/infrastructure';
import { buildIpVlanMatrix, AuditIssue } from '../../utils/engineeringValidator';
import { useAsyncEngineeringAudit } from '../../utils/computeWorkerClient';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { X, AlertCircle, AlertTriangle, CheckCircle2, ArrowRight, Network, Zap } from 'lucide-react';

interface EngineeringAuditModalProps {
  isOpen: boolean;
  project: ProjectState;
  onClose: () => void;
  onNavigateToTarget: (targetType: AuditIssue['targetType'], targetId: string) => void;
}

export const EngineeringAuditModal: React.FC<EngineeringAuditModalProps> = ({
  isOpen,
  project,
  onClose,
  onNavigateToTarget
}) => {
  const [tab, setTab] = useState<'audit' | 'ipplan'>('audit');
  const [searchIp, setSearchIp] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  const report = useAsyncEngineeringAudit(project, 60);
  const ipMatrix = useMemo(() => buildIpVlanMatrix(project), [project]);

  const filteredIpRows = useMemo(() => {
    const q = searchIp.trim().toLowerCase();
    if (!q) return ipMatrix;
    return ipMatrix.filter(r =>
      `${r.name} ${r.ipAddress} ${r.vlan} ${r.rackLocation}`.toLowerCase().includes(q)
    );
  }, [ipMatrix, searchIp]);

  if (!isOpen) return null;

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print" role="dialog" aria-modal="true" aria-label="Kiểm Tra Kỹ Thuật & Quy Hoạch IP/VLAN">
      <div className="w-full h-dvh sm:h-auto sm:max-w-5xl sm:max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-100 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600 shrink-0" />
              <span className="truncate">Kiểm Tra Kỹ Thuật &amp; Bảng Quy Hoạch IP/VLAN</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Phát hiện trùng IP, xung đột cổng, lệch VLAN, quá tải tủ Rack, ngân sách nguồn PoE/UPS
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng bảng kiểm tra kỹ thuật"
            className="touch-target p-1.5 rounded-md text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary KPI Bar */}
        <div className="px-6 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Lỗi nghiêm trọng</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${report.summary.errorCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {report.summary.errorCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Cảnh báo</div>
            <div className={`text-lg font-bold font-mono tabular-nums ${report.summary.warningCount > 0 ? 'text-amber-600' : 'text-slate-700 dark:text-slate-200'}`}>
              {report.summary.warningCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Tổng công suất</div>
            <div className="text-lg font-bold font-mono tabular-nums text-blue-600">
              {report.summary.totalPowerWatts} W
            </div>
            <div className="text-[10px] text-slate-400 font-mono">~{report.summary.estimatedCurrentAmps220V} A (220V)</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Ước tính PoE</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
              {report.summary.totalPoeWattsEstimate} W
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Dự phòng UPS</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
              {report.summary.upsCapacityWatts <= 0
                ? 'Chưa có UPS'
                : report.summary.estimatedUpsRuntimeMinutes > 0
                ? `${report.summary.estimatedUpsRuntimeMinutes} phút`
                : 'Chưa khai báo pin'}
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/30">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            <button
              onClick={() => setTab('audit')}
              className={`px-3 py-1 rounded-md font-semibold ${
                tab === 'audit' ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Kết quả Kiểm tra ({report.issues.length})
            </button>
            <button
              onClick={() => setTab('ipplan')}
              className={`px-3 py-1 rounded-md font-semibold flex items-center gap-1.5 ${
                tab === 'ipplan' ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Bảng IP &amp; VLAN ({ipMatrix.length})</span>
            </button>
          </div>

          {tab === 'ipplan' && (
            <input
              type="text"
              value={searchIp}
              onChange={e => setSearchIp(e.target.value)}
              placeholder="Lọc theo tên, IP, VLAN..."
              className="px-3 py-1.5 w-64 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-blue-500"
            />
          )}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {tab === 'audit' ? (
            report.issues.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  Không phát hiện lỗi kỹ thuật hay xung đột cấu hình!
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mọi địa chỉ IP, cổng kết nối, VLAN, tủ Rack và tải điện đều đạt kiểm tra tự động.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {report.powerDomains && report.powerDomains.some(d => d.upsAssetIds.length > 0) && (
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 space-y-2">
                    <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
                      <span>Phân tích công suất &amp; lưu điện theo Miền UPS</span>
                      <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                        Tính theo công suất thực W = VA × PF
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {report.powerDomains
                        .filter(d => d.upsAssetIds.length > 0)
                        .map(dom => (
                          <div
                            key={dom.domainId}
                            className={`px-2.5 py-2 rounded-lg border text-[11px] bg-white dark:bg-slate-900 ${
                              dom.status === 'overload'
                                ? 'border-rose-300 dark:border-rose-800'
                                : dom.status === 'warning'
                                ? 'border-amber-300 dark:border-amber-800'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                              {dom.domainLabel}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                              Tải {dom.loadWatts}W / {dom.effectiveCapacityWatts}W
                              {dom.utilizationPct !== null ? ` (${dom.utilizationPct}%)` : ''}
                              {dom.runtimeMinutes > 0 ? ` · ~${dom.runtimeMinutes} phút` : ''}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {report.issues.map(issue => (
                  <div
                    key={issue.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 hover:border-blue-400 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {issue.severity === 'error' ? (
                        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white text-xs">
                          {issue.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {issue.description}
                        </div>
                      </div>
                    </div>

                    {issue.targetId && (
                      <button
                        onClick={() => {
                          onNavigateToTarget(issue.targetType, issue.targetId);
                          onClose();
                        }}
                        className="px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap"
                      >
                        <span>Chuyển tới</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Thiết bị</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Phân loại</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Địa chỉ IP</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Subnet Mask</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Gateway</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">VLAN</th>
                    <th className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">Vị trí Tủ Rack</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-[11px]">
                  {filteredIpRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        Không có thiết bị khớp bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredIpRows.map(row => (
                      <tr
                        key={row.assetId}
                        onClick={() => {
                          if (row.nodeId) {
                            onNavigateToTarget('node', row.nodeId);
                            onClose();
                          }
                        }}
                        className="hover:bg-blue-50/50 dark:hover:bg-slate-800/40 cursor-pointer"
                      >
                        <td className="px-3 py-2 font-semibold text-slate-900 dark:text-white">{row.name}</td>
                        <td className="px-3 py-2 text-slate-500">{row.category}</td>
                        <td className={`px-3 py-2 font-mono tabular-nums ${row.duplicateIp ? 'text-rose-600 font-bold' : ''}`}>
                          {row.ipAddress}{row.duplicateIp ? ' (Trùng)' : ''}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{row.subnetMask}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{row.gateway}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{row.vlan}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{row.rackLocation}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
