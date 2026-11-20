import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Link2Off, ShieldCheck } from 'lucide-react';
import type { CADBlock, CADDocument } from '../core/CADTypes';
import { decodeAutoCadText } from '../geometry/CADCurve';

interface CADXrefPanelProps {
  doc: CADDocument;
  onSetXrefPath: (blockName: string, xrefPath: string) => void;
  onBindXrefLocal: (blockName: string) => void;
  onClearMissingXrefNotice: (blockOrPath: string) => void;
}

export const CADXrefPanel: React.FC<CADXrefPanelProps> = ({
  doc,
  onSetXrefPath,
  onBindXrefLocal,
  onClearMissingXrefNotice
}) => {
  const [pathDrafts, setPathDrafts] = useState<Record<string, string>>({});

  const xrefItems = useMemo(() => {
    const items: Array<{
      name: string;
      block?: CADBlock;
      path: string;
      status: 'unresolved' | 'attached' | 'cached';
      insertCount: number;
    }> = [];

    const refCounts: Record<string, number> = {};
    for (const ent of doc.entities) {
      if (ent.type === 'INSERT') {
        refCounts[ent.blockName] = (refCounts[ent.blockName] || 0) + 1;
      }
    }

    const missingSet = new Set(doc.metadata.missingXrefs.map(m => m.toLowerCase()));
    const seenKeys = new Set<string>();

    for (const blk of Object.values(doc.blocks)) {
      const path = blk.xrefPath || '';
      const isMissing =
        missingSet.has(blk.name.toLowerCase()) ||
        (path ? missingSet.has(path.toLowerCase()) : false);
      if (!blk.isXref && !path && !isMissing) continue;

      seenKeys.add(blk.name.toLowerCase());
      if (path) seenKeys.add(path.toLowerCase());

      items.push({
        name: blk.name,
        block: blk,
        path,
        status: blk.entities.length > 0 ? 'cached' : isMissing ? 'unresolved' : 'attached',
        insertCount: refCounts[blk.name] || 0
      });
    }

    for (const missing of doc.metadata.missingXrefs) {
      if (seenKeys.has(missing.toLowerCase())) continue;
      items.push({
        name: missing,
        path: missing,
        status: 'unresolved',
        insertCount: refCounts[missing] || 0
      });
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [doc.blocks, doc.entities, doc.metadata.missingXrefs]);

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="space-y-1 border-b border-slate-800 p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-200">Quản lý XREF ({xrefItems.length})</span>
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
            <ShieldCheck className="h-3 w-3 text-emerald-400" />
            An toàn
          </span>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-400">
          Tham chiếu ngoài (XREF) được bảo toàn đường dẫn gốc để xuất DXF không mất liên kết; không tự động đọc tệp ổ đĩa ngoài vì lý do bảo mật.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
        {xrefItems.length === 0 && (
          <div className="p-4 text-center text-[11px] text-slate-500">
            Bản vẽ hiện tại không có Block tham chiếu ngoài (XREF).
          </div>
        )}

        {xrefItems.map(item => {
          const draft = pathDrafts[item.name] ?? item.path;
          return (
            <div key={item.name} className="space-y-2 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-slate-100">
                    {item.status === 'unresolved' ? (
                      <Link2Off className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    )}
                    <span className="truncate">{decodeAutoCadText(item.name)}</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {item.block
                      ? `${item.block.entities.length} nét nội bộ • ${item.insertCount} chèn`
                      : `${item.insertCount} chèn`}
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${
                    item.status === 'cached'
                      ? 'bg-emerald-950/70 text-emerald-300'
                      : item.status === 'unresolved'
                        ? 'bg-amber-950/70 text-amber-300'
                        : 'bg-cyan-950/70 text-cyan-300'
                  }`}
                >
                  {item.status === 'cached'
                    ? 'Có hình đệm'
                    : item.status === 'unresolved'
                      ? 'Chưa nạp tệp'
                      : 'Liên kết ngoài'}
                </span>
              </div>

              {item.block ? (
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    onSetXrefPath(item.name, draft);
                  }}
                  className="space-y-1"
                >
                  <label className="block text-[10px] text-slate-400">Đường dẫn tệp tham chiếu (Path)</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={draft}
                      onChange={e =>
                        setPathDrafts(prev => ({ ...prev, [item.name]: e.target.value }))
                      }
                      placeholder="vd: ./xref/tang1.dwg"
                      className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200 outline-none focus:border-cyan-500"
                    />
                    <button
                      type="submit"
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-cyan-300 hover:bg-slate-700"
                    >
                      Lưu
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-950/20 px-2 py-1 text-[10px] text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="truncate">Đường dẫn: {item.path}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {item.block && item.block.entities.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onBindXrefLocal(item.name)}
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-900/50"
                    title="Chuyển XREF có sẵn hình đệm thành Block nội bộ"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Gắn nội bộ (Bind)
                  </button>
                )}
                {item.status === 'unresolved' && (
                  <button
                    type="button"
                    onClick={() => onClearMissingXrefNotice(item.name)}
                    className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700"
                  >
                    Đã hiểu / Ẩn cảnh báo
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
