import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  History,
  RotateCcw,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react';
import {
  listRecoverySnapshots,
  PRIMARY_STORAGE_KEY,
  RecoveryInspectEntry,
  safeSaveToStorage
} from '../../utils/projectStorage';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  snapshots: RecoveryInspectEntry[];
  selectedIndex: number;
  statusBanner: string | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      snapshots: [],
      selectedIndex: 0,
      statusBanner: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const snapshots = listRecoverySnapshots();
    const firstValidIdx = snapshots.findIndex(s => s.ok);
    return {
      hasError: true,
      errorMessage: error?.message || 'Lỗi không xác định trong giao diện.',
      snapshots,
      selectedIndex: firstValidIdx >= 0 ? firstValidIdx : 0,
      statusBanner: null
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('HACHIHI ErrorBoundary caught error:', error, info);
  }

  private getSelectedValidEntry() {
    const entry = this.state.snapshots[this.state.selectedIndex];
    if (entry && entry.ok) return entry;
    return this.state.snapshots.find((s): s is Extract<RecoveryInspectEntry, { ok: true }> => s.ok) || null;
  }

  handleDownloadRecoveryBackup = () => {
    const selected = this.getSelectedValidEntry();
    if (!selected) {
      this.setState({
        statusBanner: 'Không có bản sao lưu hợp lệ nào trong bộ nhớ phục hồi để tải xuống.'
      });
      return;
    }

    try {
      const payload = JSON.stringify(selected.envelope.project, null, 2);
      const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const safeName = (selected.envelope.projectName || 'HACHIHI_Project')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .slice(0, 48);
      link.download = `${safeName}_Recovery_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.setState({
        statusBanner: `Đã xuất bản sao lưu hợp lệ "${selected.envelope.projectName}" (${selected.envelope.counts.assets} thiết bị, ${selected.envelope.counts.cables} cáp).`
      });
    } catch {
      this.setState({
        statusBanner: 'Trình duyệt chặn thao tác tạo tệp sao lưu.'
      });
    }
  };

  handleRestoreSelectedSnapshot = () => {
    const selected = this.getSelectedValidEntry();
    if (!selected) {
      this.setState({
        statusBanner: 'Không thể khôi phục vì không tìm thấy snapshot đạt kiểm tra toàn vẹn.'
      });
      return;
    }

    const saved = safeSaveToStorage(PRIMARY_STORAGE_KEY, selected.envelope.project);
    if (!saved) {
      this.setState({
        statusBanner: 'Không thể ghi bản khôi phục vào bộ nhớ trình duyệt. Hãy tải tệp .json về máy trước.'
      });
      return;
    }

    this.setState({
      hasError: false,
      errorMessage: '',
      statusBanner: null
    });
  };

  handleRecoverWorkspace = () => {
    this.setState({ hasError: false, errorMessage: '', statusBanner: null });
  };

  render() {
    if (this.state.hasError) {
      const { snapshots, selectedIndex, statusBanner } = this.state;
      const selectedValid = this.getSelectedValidEntry();
      const validCount = snapshots.filter(s => s.ok).length;

      return (
        <div className="w-screen h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4 sm:p-6 text-slate-800 dark:text-slate-100 overflow-y-auto">
          <div className="max-w-2xl w-full bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 rounded-2xl shadow-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start gap-3 text-rose-600 dark:text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold">Đã xảy ra sự cố hiển thị đột xuất</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {validCount > 0
                    ? `Tìm thấy ${validCount} bản snapshot đã xác thực checksum trong bộ nhớ phục hồi. Hãy kiểm tra thông số bên dưới trước khi tải hoặc khôi phục.`
                    : 'Chưa có bản snapshot phục hồi hợp lệ trong bộ nhớ trình duyệt (localStorage). Không thể tạo tệp sao lưu trống.'}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-rose-700 dark:text-rose-300 break-words">
              {this.state.errorMessage}
            </div>

            {/* Verified Snapshot List & Preview */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <History className="w-4 h-4 text-blue-600" />
                  Danh sách bản phục hồi gần nhất (tối đa 3 snapshot)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {validCount}/{snapshots.length} hợp lệ
                </span>
              </div>

              {snapshots.length === 0 ? (
                <div className="p-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>
                    Không có snapshot phục hồi nào được lưu trước thời điểm lỗi (có thể dự án chưa từng hoàn tất lần lưu nào hoặc trình duyệt đang ở chế độ riêng tư).
                  </span>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {snapshots.map((entry, idx) => {
                    const isSelected = idx === selectedIndex;
                    if (!entry.ok) {
                      return (
                        <div
                          key={`bad_${idx}`}
                          className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-xs flex items-start gap-2"
                        >
                          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="font-semibold text-rose-700 dark:text-rose-300">
                              {entry.projectName || 'Bản snapshot không hợp lệ'}
                            </div>
                            <div className="text-[11px] text-rose-600 dark:text-rose-400">{entry.error}</div>
                          </div>
                        </div>
                      );
                    }

                    const env = entry.envelope;
                    const savedLabel = (() => {
                      const d = new Date(env.savedAt);
                      return Number.isNaN(d.getTime()) ? env.savedAt : d.toLocaleString('vi-VN');
                    })();

                    return (
                      <button
                        key={env.snapshotId}
                        type="button"
                        onClick={() => this.setState({ selectedIndex: idx, statusBanner: null })}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors flex items-start justify-between gap-2 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                              {env.projectName}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 shrink-0">
                              v{env.schemaVersion} · Checksum OK
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                            {savedLabel} · {env.counts.assets} thiết bị · {env.counts.nodes} nút · {env.counts.racks} rack · {env.counts.cables} cáp
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {statusBanner && (
              <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200">
                {statusBanner}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={!selectedValid}
                onClick={this.handleDownloadRecoveryBackup}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-4 h-4 text-blue-600" />
                <span>Tải bản sao lưu khẩn cấp (.json)</span>
              </button>
              {selectedValid && (
                <button
                  type="button"
                  onClick={this.handleRestoreSelectedSnapshot}
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Khôi phục bản lưu này</span>
                </button>
              )}
              <button
                type="button"
                onClick={this.handleRecoverWorkspace}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Thử mở lại giao diện</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
