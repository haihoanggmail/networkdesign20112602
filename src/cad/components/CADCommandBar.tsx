import React, { useState } from 'react';
import { History, Terminal } from 'lucide-react';
import type { CADCommandLogEntry } from '../commands/CADCommandManager';
import type { CADSnapSettings, CADToolId, CADUnitCode, Point2D } from '../core/CADTypes';
import { getCADUnitMeta } from '../core/CADUnits';

interface CADCommandBarProps {
  activeTool: CADToolId;
  promptVi: string;
  cursorWorld: Point2D;
  unitCode: CADUnitCode;
  snapSettings: CADSnapSettings;
  executionLog?: CADCommandLogEntry[];
  onUpdateSnapSettings: (next: CADSnapSettings) => void;
  onRunCommandLine: (input: string) => void;
}

export const CADCommandBar: React.FC<CADCommandBarProps> = ({
  activeTool,
  promptVi,
  cursorWorld,
  unitCode,
  snapSettings,
  executionLog = [],
  onUpdateSnapSettings,
  onRunCommandLine
}) => {
  const [cmdText, setCmdText] = useState('');
  const [enteredHistory, setEnteredHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const unitMeta = getCADUnitMeta(unitCode);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = cmdText.trim();
    if (!trimmed) return;
    setEnteredHistory(prev => [trimmed, ...prev.filter(x => x !== trimmed)].slice(0, 40));
    setHistoryCursor(-1);
    onRunCommandLine(trimmed);
    setCmdText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && enteredHistory.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(enteredHistory.length - 1, historyCursor + 1);
      setHistoryCursor(nextIdx);
      setCmdText(enteredHistory[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyCursor <= 0) {
        setHistoryCursor(-1);
        setCmdText('');
      } else {
        const nextIdx = historyCursor - 1;
        setHistoryCursor(nextIdx);
        setCmdText(enteredHistory[nextIdx]);
      }
    }
  };

  return (
    <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950 px-3 py-1.5 text-[11px]">
      {historyOpen && (
        <div className="absolute bottom-full left-3 z-30 mb-1 w-80 max-w-[90vw] rounded-lg border border-slate-700 bg-slate-900 p-2 text-[11px] shadow-2xl">
          <div className="mb-1.5 flex items-center justify-between border-b border-slate-800 pb-1 font-semibold text-slate-200">
            <span>Lịch sử lệnh CAD ({executionLog.length})</span>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="text-[10px] text-slate-400 hover:text-white"
            >
              Đóng
            </button>
          </div>
          {executionLog.length === 0 ? (
            <div className="py-2 text-center text-[10px] text-slate-500">Chưa có thao tác CAD nào.</div>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {executionLog.slice(0, 25).map(item => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded bg-slate-950/70 px-2 py-1 text-[10px]">
                  <span className="truncate text-slate-200">{item.labelVi}</span>
                  <span
                    className={`shrink-0 rounded px-1 uppercase ${
                      item.action === 'undo'
                        ? 'bg-amber-950 text-amber-300'
                        : item.action === 'redo'
                          ? 'bg-cyan-950 text-cyan-300'
                          : 'bg-emerald-950 text-emerald-300'
                    }`}
                  >
                    {item.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Command prompt */}
      <form onSubmit={handleSubmit} className="flex min-w-[260px] flex-1 items-center gap-2">
        <button
          type="button"
          onClick={() => setHistoryOpen(v => !v)}
          title="Xem lịch sử thao tác CAD (Command History)"
          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
            historyOpen ? 'bg-cyan-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-cyan-300'
          }`}
        >
          <History className="h-3 w-3" />
          <span>{executionLog.length}</span>
        </button>
        <Terminal className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
        <span className="hidden text-slate-400 sm:inline">{promptVi}</span>
        <input
          type="text"
          value={cmdText}
          onChange={e => setCmdText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Lệnh [${activeTool.toUpperCase()}]: L, PL, C, REC, M, CO, RO, SC, MI, O, TR, EX, DI, Z (↑/↓ lịch sử)...`}
          className="min-w-0 flex-1 rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-100 outline-none focus:border-cyan-500"
        />
      </form>

      {/* Live status toggles */}
      <div className="flex items-center gap-1.5">
        <span className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
          X: {cursorWorld.x.toFixed(1)} &nbsp; Y: {cursorWorld.y.toFixed(1)} {unitMeta.shortLabel}
        </span>

        <button
          type="button"
          onClick={() => onUpdateSnapSettings({ ...snapSettings, enabled: !snapSettings.enabled })}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            snapSettings.enabled
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
              : 'bg-slate-900 text-slate-500 border border-slate-800'
          }`}
          title="Bật/tắt OSNAP (F3)"
        >
          OSNAP
        </button>

        <button
          type="button"
          onClick={() => onUpdateSnapSettings({ ...snapSettings, ortho: !snapSettings.ortho })}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            snapSettings.ortho
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
              : 'bg-slate-900 text-slate-500 border border-slate-800'
          }`}
          title="Khóa thẳng góc Ngang/Dọc (F8)"
        >
          ORTHO
        </button>

        <button
          type="button"
          onClick={() => onUpdateSnapSettings({ ...snapSettings, polar: !snapSettings.polar })}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            snapSettings.polar
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
              : 'bg-slate-900 text-slate-500 border border-slate-800'
          }`}
          title="Bắt góc cực 45° (F10)"
        >
          POLAR
        </button>

        <button
          type="button"
          onClick={() => onUpdateSnapSettings({ ...snapSettings, gridSnap: !snapSettings.gridSnap })}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            snapSettings.gridSnap
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40'
              : 'bg-slate-900 text-slate-500 border border-slate-800'
          }`}
          title="Bắt lưới tọa độ (F9)"
        >
          GRID
        </button>
      </div>
    </div>
  );
};
