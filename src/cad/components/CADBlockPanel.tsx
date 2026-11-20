import React, { useMemo, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Link2Off,
  PackagePlus,
  PlusCircle,
  Sparkles,
  Tag
} from 'lucide-react';
import type { CADDocument, Point3D } from '../core/CADTypes';
import { decodeAutoCadText } from '../geometry/CADCurve';

interface CADBlockPanelProps {
  doc: CADDocument;
  activeInsertBlockName: string | null;
  selectedCount: number;
  onStartInsertBlock: (blockName: string) => void;
  onCreateBlockFromSelection: (blockName: string) => void;
  onUpdateBlock: (blockName: string, patch: { newName?: string; basePoint?: Point3D }) => void;
  onPurgeUnusedBlocks: () => void;
}

export const CADBlockPanel: React.FC<CADBlockPanelProps> = ({
  doc,
  activeInsertBlockName,
  selectedCount,
  onStartInsertBlock,
  onCreateBlockFromSelection,
  onUpdateBlock,
  onPurgeUnusedBlocks
}) => {
  const [search, setSearch] = useState('');
  const [newBlockName, setNewBlockName] = useState('');
  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const insertCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ent of doc.entities) {
      if (ent.type === 'INSERT') {
        counts[ent.blockName] = (counts[ent.blockName] || 0) + 1;
      }
    }
    return counts;
  }, [doc.entities]);

  const blocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(doc.blocks)
      .filter(
        b =>
          !b.name.startsWith('*Model_Space') &&
          !b.name.startsWith('*Paper_Space') &&
          (!q || decodeAutoCadText(b.name).toLowerCase().includes(q) || b.name.toLowerCase().includes(q))
      )
      .sort((a, b) => decodeAutoCadText(a.name).localeCompare(decodeAutoCadText(b.name)));
  }, [doc.blocks, search]);

  const unusedCount = useMemo(
    () => blocks.filter(b => (insertCounts[b.name] || 0) === 0).length,
    [blocks, insertCounts]
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newBlockName.trim().replace(/[^\w\u00C0-\u1EF9-]/g, '_');
    if (!clean || doc.blocks[clean] || selectedCount === 0) return;
    onCreateBlockFromSelection(clean);
    setNewBlockName('');
  };

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="space-y-2 border-b border-slate-800 p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-200">Thư viện Block ({blocks.length})</span>
          {unusedCount > 0 && (
            <button
              type="button"
              onClick={onPurgeUnusedBlocks}
              className="inline-flex items-center gap-1 text-[10px] text-amber-300 hover:underline"
              title={`Xóa ${unusedCount} Block không có INSERT nào`}
            >
              <Sparkles className="h-3 w-3" />
              Dọn ({unusedCount})
            </button>
          )}
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Tìm tên Block..."
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-500"
        />

        {/* Create block from current canvas selection */}
        <form onSubmit={handleCreate} className="space-y-1 rounded border border-slate-800 bg-slate-950/60 p-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>Tạo Block từ vùng chọn</span>
            <span className={selectedCount > 0 ? 'text-cyan-300' : 'text-slate-600'}>
              {selectedCount} đối tượng
            </span>
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={newBlockName}
              onChange={e => setNewBlockName(e.target.value)}
              placeholder="Tên Block mới..."
              disabled={selectedCount === 0}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={selectedCount === 0 || !newBlockName.trim()}
              className="inline-flex items-center gap-1 rounded bg-cyan-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
              title="Đóng gói đối tượng đang chọn thành Block"
            >
              <PackagePlus className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
        {blocks.length === 0 && (
          <div className="p-4 text-center text-[11px] text-slate-500">
            Bản vẽ chưa có định nghĩa Block nào.
          </div>
        )}
        {blocks.map(blk => {
          const isActive = activeInsertBlockName === blk.name;
          const isExpanded = expandedBlock === blk.name;
          const attdefCount = blk.entities.filter(e => e.type === 'ATTDEF').length;
          const refCount = insertCounts[blk.name] || 0;

          return (
            <div key={blk.name} className={isActive ? 'bg-cyan-950/40' : ''}>
              <div className="flex items-center justify-between gap-1.5 px-2 py-2 hover:bg-slate-800/40">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedBlock(isExpanded ? null : blk.name);
                    setRenameDraft(blk.name);
                  }}
                  className="rounded p-0.5 text-slate-500 hover:text-slate-200"
                  title="Chỉnh sửa định nghĩa Block"
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium text-slate-200">
                    <Box className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span className="truncate" title={decodeAutoCadText(blk.name)}>
                      {decodeAutoCadText(blk.name)}
                    </span>
                    {(blk.xrefPath || blk.isXref) && (
                      <span title={`Xref ngoài: ${blk.xrefPath || blk.name}`}>
                        <Link2Off className="h-3 w-3 text-amber-400" />
                      </span>
                    )}
                    {attdefCount > 0 && (
                      <span
                        title={`${attdefCount} định nghĩa Attribute (ATTDEF)`}
                        className="inline-flex items-center gap-0.5 rounded bg-emerald-950/60 px-1 text-[9px] text-emerald-300"
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {attdefCount}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {blk.entities.length} nét • {refCount} lần chèn
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onStartInsertBlock(blk.name)}
                  className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-cyan-300 hover:bg-cyan-600 hover:text-white"
                >
                  <PlusCircle className="h-3 w-3" />
                  Chèn
                </button>
              </div>

              {isExpanded && (
                <div className="space-y-1.5 border-t border-slate-800/60 bg-slate-950/60 px-3 py-2 text-[10px]">
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      const clean = renameDraft.trim().replace(/[^\w\u00C0-\u1EF9-]/g, '_');
                      if (clean && clean !== blk.name && !doc.blocks[clean]) {
                        onUpdateBlock(blk.name, { newName: clean });
                        setExpandedBlock(clean);
                      }
                    }}
                    className="flex gap-1"
                  >
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={e => setRenameDraft(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-200"
                    />
                    <button
                      type="submit"
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 hover:border-cyan-500"
                    >
                      Đổi tên
                    </button>
                  </form>

                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="text-slate-400">Điểm gốc X</span>
                      <input
                        type="number"
                        value={Number(blk.basePoint.x.toFixed(2))}
                        onChange={e =>
                          onUpdateBlock(blk.name, {
                            basePoint: { ...blk.basePoint, x: Number(e.target.value) || 0 }
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-200"
                      />
                    </label>
                    <label className="block">
                      <span className="text-slate-400">Điểm gốc Y</span>
                      <input
                        type="number"
                        value={Number(blk.basePoint.y.toFixed(2))}
                        onChange={e =>
                          onUpdateBlock(blk.name, {
                            basePoint: { ...blk.basePoint, y: Number(e.target.value) || 0 }
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-200"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
