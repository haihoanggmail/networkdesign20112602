import React, { useMemo, useState } from 'react';
import type { CADDocument, CADEntity } from '../core/CADTypes';
import { decodeAutoCadText } from '../geometry/CADCurve';

interface CADEntityTreeProps {
  doc: CADDocument;
  selectedIds: Set<string>;
  onSelectEntity: (entity: CADEntity) => void;
}

export const CADEntityTree: React.FC<CADEntityTreeProps> = ({
  doc,
  selectedIds,
  onSelectEntity
}) => {
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'supported' | 'readonly' | 'unknown'>('all');

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: CADEntity[] = [];
    for (const e of doc.entities) {
      if (tierFilter !== 'all' && e.preservationTier !== tierFilter) continue;
      if (q) {
        const label = `${e.type} ${decodeAutoCadText(e.layer)} ${e.handle}`.toLowerCase();
        if (!label.includes(q)) continue;
      }
      out.push(e);
      if (out.length >= 300) break;
    }
    return out;
  }, [doc.entities, search, tierFilter]);

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="space-y-2 border-b border-slate-800 p-2.5">
        <div className="font-semibold text-slate-200">
          Đối tượng ({doc.entities.length.toLocaleString('vi-VN')})
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Lọc theo loại, Layer, Handle..."
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-500"
        />
        <select
          value={tierFilter}
          onChange={e => setTierFilter(e.target.value as typeof tierFilter)}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none"
        >
          <option value="all">Tất cả mức hỗ trợ</option>
          <option value="supported">Có thể sửa (Supported)</option>
          <option value="readonly">Chỉ đọc (Hatch / Solid / Leader)</option>
          <option value="unknown">Nguyên bản đặc thù (Unknown)</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
        {items.map(ent => {
          const active = selectedIds.has(ent.id);
          return (
            <button
              key={ent.id}
              type="button"
              onClick={() => onSelectEntity(ent)}
              className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] ${
                active ? 'bg-cyan-950/50 text-cyan-200' : 'text-slate-300 hover:bg-slate-800/40'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {ent.type === 'UNKNOWN' ? ent.dxfType : ent.type}
                  {ent.type === 'INSERT' ? ` (${decodeAutoCadText(ent.blockName)})` : ''}
                </div>
                <div className="truncate text-[10px] text-slate-500">
                  Layer: {decodeAutoCadText(ent.layer)} • #{ent.handle}
                </div>
              </div>
              <span
                className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase ${
                  ent.preservationTier === 'supported'
                    ? 'bg-emerald-950 text-emerald-300'
                    : ent.preservationTier === 'readonly'
                      ? 'bg-slate-800 text-slate-300'
                      : 'bg-amber-950 text-amber-300'
                }`}
              >
                {ent.preservationTier === 'supported'
                  ? 'Sửa'
                  : ent.preservationTier === 'readonly'
                    ? 'Đọc'
                    : 'Gốc'}
              </span>
            </button>
          );
        })}
        {doc.entities.length > 300 && (
          <div className="p-2 text-center text-[10px] text-slate-500">
            Hiển thị tối đa 300 kết quả đầu. Hãy dùng ô lọc để tìm nhanh hơn.
          </div>
        )}
      </div>
    </div>
  );
};
