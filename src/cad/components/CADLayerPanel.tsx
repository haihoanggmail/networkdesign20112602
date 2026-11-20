import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  Plus,
  ShieldAlert,
  Snowflake,
  Trash2,
  Unlock,
  X
} from 'lucide-react';
import { QUICK_ACI_SWATCHES, resolveLayerColorHex } from '../core/CADColorPalette';
import { createDefaultLayer } from '../core/CADDocument';
import type { CADDocument, CADLayer, CADLayerFilterMode } from '../core/CADTypes';
import { decodeAutoCadText } from '../geometry/CADCurve';

interface CADLayerPanelProps {
  doc: CADDocument;
  activeLayerName: string;
  onSetActiveLayer: (name: string) => void;
  onUpdateLayer: (layer: CADLayer) => void;
  onCreateLayer: (layer: CADLayer) => void;
  onRenameLayer: (oldName: string, newName: string) => void;
  onDeleteLayer: (layerName: string) => void;
  onBatchLayers: (updater: (layers: Record<string, CADLayer>) => Record<string, CADLayer>, labelVi: string) => void;
  onShowAllLayers: () => void;
}

const LINE_WEIGHT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: -3, label: 'Mặc định (-3)' },
  { value: 0, label: '0.00 mm' },
  { value: 15, label: '0.15 mm' },
  { value: 25, label: '0.25 mm' },
  { value: 35, label: '0.35 mm' },
  { value: 50, label: '0.50 mm' },
  { value: 70, label: '0.70 mm' },
  { value: 100, label: '1.00 mm' }
];

export const CADLayerPanel: React.FC<CADLayerPanelProps> = ({
  doc,
  activeLayerName,
  onSetActiveLayer,
  onUpdateLayer,
  onCreateLayer,
  onRenameLayer,
  onDeleteLayer,
  onBatchLayers,
  onShowAllLayers
}) => {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<CADLayerFilterMode>('all');
  const [newName, setNewName] = useState('');
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const lineTypeNames = useMemo(() => {
    const names = new Set<string>(['CONTINUOUS', 'DASHED', 'CENTER', 'HIDDEN']);
    for (const k of Object.keys(doc.lineTypes)) names.add(k);
    return Array.from(names).sort();
  }, [doc.lineTypes]);

  const entityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of doc.entities) {
      counts[e.layer] = (counts[e.layer] || 0) + 1;
    }
    return counts;
  }, [doc.entities]);

  const layers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(doc.layers)
      .filter(l => {
        if (filterMode === 'used' && (entityCounts[l.name] || 0) === 0) return false;
        if (filterMode === 'locked' && !l.locked) return false;
        if (filterMode === 'hidden' && l.visible && !l.frozen) return false;
        if (!q) return true;
        const decoded = decodeAutoCadText(l.name).toLowerCase();
        return decoded.includes(q) || l.name.toLowerCase().includes(q);
      })
      .sort((a, b) =>
        a.name === '0'
          ? -1
          : b.name === '0'
            ? 1
            : decodeAutoCadText(a.name).localeCompare(decodeAutoCadText(b.name))
      );
  }, [doc.layers, search, filterMode, entityCounts]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newName.trim().replace(/[^\w\u00C0-\u1EF9-]/g, '_');
    if (!clean || doc.layers[clean]) return;
    const layer = createDefaultLayer(clean, 3);
    onCreateLayer(layer);
    onSetActiveLayer(clean);
    setNewName('');
  };

  const commitRename = (oldName: string) => {
    const clean = renameDraft.trim().replace(/[^\w\u00C0-\u1EF9-]/g, '_');
    if (clean && clean !== oldName && !doc.layers[clean]) {
      onRenameLayer(oldName, clean);
      if (activeLayerName === oldName) {
        onSetActiveLayer(clean);
      }
      if (expandedLayer === oldName) {
        setExpandedLayer(clean);
      }
    }
    setRenamingLayer(null);
  };

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="space-y-2 border-b border-slate-800 p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-200">
            Quản lý Lớp ({layers.length}/{Object.keys(doc.layers).length})
          </span>
          <button
            type="button"
            onClick={onShowAllLayers}
            className="text-[11px] text-cyan-400 hover:underline"
          >
            Hiện tất cả
          </button>
        </div>

        {/* Batch Floorplan/Layer Controls */}
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <button
            type="button"
            onClick={() =>
              onBatchLayers(prev => {
                const next: Record<string, CADLayer> = {};
                for (const [k, l] of Object.entries(prev)) {
                  next[k] = { ...l, locked: k !== activeLayerName };
                }
                return next;
              }, `Khóa tất cả lớp trừ "${activeLayerName}"`)
            }
            className="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-1 text-amber-300 hover:bg-slate-800"
            title="Khóa chỉnh sửa toàn bộ lớp khác trừ lớp hiện hành"
          >
            Khóa lớp khác
          </button>
          <button
            type="button"
            onClick={() =>
              onBatchLayers(prev => {
                const next: Record<string, CADLayer> = {};
                for (const [k, l] of Object.entries(prev)) {
                  next[k] = { ...l, locked: false };
                }
                return next;
              }, 'Mở khóa tất cả Layer')
            }
            className="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-1 text-slate-300 hover:bg-slate-800"
            title="Mở khóa toàn bộ lớp"
          >
            Mở khóa hết
          </button>
          <button
            type="button"
            onClick={() =>
              onBatchLayers(prev => {
                const next: Record<string, CADLayer> = {};
                for (const [k, l] of Object.entries(prev)) {
                  next[k] = { ...l, visible: k === activeLayerName, frozen: false };
                }
                return next;
              }, `Cô lập lớp "${activeLayerName}"`)
            }
            className="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-1 text-cyan-300 hover:bg-slate-800"
            title="Chỉ hiện lớp hiện hành (Isolate)"
          >
            Cô lập lớp
          </button>
        </div>

        {/* Filter pills */}
        <div className="grid grid-cols-4 gap-1 text-[10px]">
          {(
            [
              { id: 'all', label: 'Tất cả' },
              { id: 'used', label: 'Có nét' },
              { id: 'locked', label: 'Khóa' },
              { id: 'hidden', label: 'Đang ẩn' }
            ] as const
          ).map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterMode(f.id)}
              className={`rounded py-0.5 font-medium ${
                filterMode === f.id
                  ? 'bg-cyan-600/30 text-cyan-200 border border-cyan-500/40'
                  : 'bg-slate-950/70 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Tìm Layer..."
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-500"
        />
        <form onSubmit={handleAdd} className="flex gap-1">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Tên Layer mới..."
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded bg-cyan-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-cyan-500"
            title="Thêm Layer mới"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
        {layers.map(layer => {
          const isCurrent = layer.name === activeLayerName;
          const isExpanded = expandedLayer === layer.name;
          const isRenaming = renamingLayer === layer.name;
          const colorHex = resolveLayerColorHex(layer, false);

          return (
            <div key={layer.name} className={isCurrent ? 'bg-cyan-950/35' : ''}>
              <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-slate-800/40">
                <button
                  type="button"
                  onClick={() => setExpandedLayer(isExpanded ? null : layer.name)}
                  className="rounded p-0.5 text-slate-500 hover:text-slate-200"
                  title="Thuộc tính chi tiết Layer"
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>

                <button
                  type="button"
                  onClick={() => onSetActiveLayer(layer.name)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isCurrent
                      ? 'border-cyan-400 bg-cyan-600 text-white'
                      : 'border-slate-700 text-transparent hover:border-slate-500'
                  }`}
                  title="Đặt làm Layer hiện hành ($CLAYER)"
                >
                  <Check className="h-3 w-3" />
                </button>

                <div
                  className="relative h-4 w-4 shrink-0 overflow-hidden rounded border border-slate-600 shadow-inner"
                  style={{ backgroundColor: colorHex }}
                  title="Đổi màu ACI"
                >
                  <select
                    value={layer.colorIndex}
                    onChange={e =>
                      onUpdateLayer({ ...layer, colorIndex: Number(e.target.value) || 7 })
                    }
                    aria-label={`Màu ACI lớp ${decodeAutoCadText(layer.name)}`}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  >
                    {QUICK_ACI_SWATCHES.map(sw => (
                      <option key={sw.aci} value={sw.aci} className="bg-slate-900 text-slate-100">
                        {sw.label}
                      </option>
                    ))}
                  </select>
                </div>

                {isRenaming ? (
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      commitRename(layer.name);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1"
                  >
                    <input
                      autoFocus
                      type="text"
                      value={renameDraft}
                      onChange={e => setRenameDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') setRenamingLayer(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-cyan-500 bg-slate-950 px-1.5 py-0.5 text-[11px] text-white outline-none"
                    />
                    <button type="submit" className="text-emerald-400 hover:text-emerald-300" title="Lưu tên">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingLayer(null)}
                      className="text-slate-500 hover:text-slate-300"
                      title="Hủy"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetActiveLayer(layer.name)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[11px] font-medium text-slate-200" title={decodeAutoCadText(layer.name)}>
                      {decodeAutoCadText(layer.name)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {entityCounts[layer.name] || 0} nét • {layer.lineType}
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onUpdateLayer({ ...layer, visible: !layer.visible })}
                  className={`rounded p-1 ${
                    layer.visible ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-800'
                  }`}
                  title={layer.visible ? 'Tắt hiển thị (Off)' : 'Bật hiển thị (On)'}
                >
                  {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </button>

                <button
                  type="button"
                  onClick={() => onUpdateLayer({ ...layer, frozen: !layer.frozen })}
                  className={`rounded p-1 ${
                    layer.frozen ? 'text-sky-400 bg-sky-950/40' : 'text-slate-500 hover:bg-slate-800'
                  }`}
                  title={layer.frozen ? 'Rã đông (Thaw)' : 'Đóng băng (Freeze)'}
                >
                  <Snowflake className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onUpdateLayer({ ...layer, locked: !layer.locked })}
                  className={`rounded p-1 ${
                    layer.locked ? 'text-amber-400 bg-amber-950/40' : 'text-slate-500 hover:bg-slate-800'
                  }`}
                  title={layer.locked ? 'Mở khóa Layer' : 'Khóa chỉnh sửa Layer'}
                >
                  {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
              </div>

              {isExpanded && (
                <div className="space-y-1.5 border-t border-slate-800/60 bg-slate-950/60 px-3 py-2 text-[10px]">
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="text-slate-400">Kiểu nét (Linetype)</span>
                      <select
                        value={layer.lineType}
                        onChange={e => onUpdateLayer({ ...layer, lineType: e.target.value })}
                        className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-200"
                      >
                        {lineTypeNames.map(lt => (
                          <option key={lt} value={lt}>
                            {lt}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-400">Độ dày nét</span>
                      <select
                        value={layer.lineWeight}
                        onChange={e => onUpdateLayer({ ...layer, lineWeight: Number(e.target.value) })}
                        className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-200"
                      >
                        {LINE_WEIGHT_OPTIONS.map(lw => (
                          <option key={lw.value} value={lw.value}>
                            {lw.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <label className="inline-flex items-center gap-1.5 text-slate-300">
                      <input
                        type="checkbox"
                        checked={layer.plottable !== false}
                        onChange={e => onUpdateLayer({ ...layer, plottable: e.target.checked })}
                      />
                      Cho phép in (Plot)
                    </label>

                    {layer.name !== '0' ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingLayer(layer.name);
                            setRenameDraft(layer.name);
                          }}
                          className="inline-flex items-center gap-0.5 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
                        >
                          <Edit3 className="h-3 w-3" />
                          Đổi tên
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteLayer(layer.name)}
                          className="inline-flex items-center gap-0.5 rounded border border-rose-500/40 bg-rose-950/30 px-1.5 py-0.5 text-rose-300 hover:bg-rose-900/50"
                          title="Xóa Layer (đối tượng sẽ chuyển về lớp 0)"
                        >
                          <Trash2 className="h-3 w-3" />
                          Xóa
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <ShieldAlert className="h-3 w-3" /> Lớp hệ thống
                      </span>
                    )}
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
