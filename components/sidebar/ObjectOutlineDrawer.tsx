import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Building2,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  ListTree,
  Lock,
  Search,
  Server,
  Unlock,
  X
} from 'lucide-react';
import { ProjectState, SelectionState } from '../../types/infrastructure';

type OutlineCategory = 'all' | 'device' | 'rack' | 'cable' | 'space';
type OutlineTargetType = 'floor' | 'room' | 'rack' | 'node' | 'edge';

interface OutlineItem {
  key: string;
  targetType: OutlineTargetType;
  id: string;
  category: Exclude<OutlineCategory, 'all'>;
  title: string;
  subtitle: string;
  locked?: boolean;
  hidden?: boolean;
  accentColor?: string;
}

interface ObjectOutlineDrawerProps {
  isOpen: boolean;
  project: ProjectState;
  selection: SelectionState;
  isReadOnlyMode?: boolean;
  onClose: () => void;
  onSelectAndPanToItem: (targetType: OutlineTargetType, id: string) => void;
  onNudgeNode?: (nodeId: string, dx: number, dy: number) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
}

export const ObjectOutlineDrawer: React.FC<ObjectOutlineDrawerProps> = ({
  isOpen,
  project,
  selection,
  isReadOnlyMode = false,
  onClose,
  onSelectAndPanToItem,
  onNudgeNode,
  onToggleNodeLock,
  onToggleNodeVisibility
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<OutlineCategory>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  const items: OutlineItem[] = useMemo(() => {
    const floorItems: OutlineItem[] = project.floors.map(fl => ({
      key: `floor:${fl.id}`,
      targetType: 'floor',
      id: fl.id,
      category: 'space',
      title: fl.name,
      subtitle: `${fl.widthMeters}m × ${fl.depthMeters}m · Tầng ${fl.level}`
    }));

    const roomItems: OutlineItem[] = project.rooms.map(rm => {
      const floor = project.floors.find(f => f.id === rm.floorId);
      return {
        key: `room:${rm.id}`,
        targetType: 'room',
        id: rm.id,
        category: 'space',
        title: rm.name,
        subtitle: `${rm.type}${floor ? ` · ${floor.name}` : ''}`,
        locked: rm.locked
      };
    });

    const rackItems: OutlineItem[] = project.racks.map(rk => {
      const mountedCount = Object.keys(rk.slots || {}).length + Object.keys(rk.rearSlots || {}).length;
      return {
        key: `rack:${rk.id}`,
        targetType: 'rack',
        id: rk.id,
        category: 'rack',
        title: rk.name,
        subtitle: `${rk.totalUnits}U · ${mountedCount} TB gá`
      };
    });

    const nodeItems: OutlineItem[] = project.nodes
      .filter(n => n.type !== 'rack')
      .map(n => {
        const asset = n.assetId ? project.assets[n.assetId] : undefined;
        return {
          key: `node:${n.id}`,
          targetType: 'node',
          id: n.id,
          category: 'device',
          title: asset?.name || n.label,
          subtitle: `${asset?.ipAddress ? `${asset.ipAddress} · ` : ''}${asset?.model || n.type} · ${n.diagramMode}`,
          locked: n.locked,
          hidden: n.hidden,
          accentColor: n.style.backgroundColor
        };
      });

    const cableItems: OutlineItem[] = project.cables.map(c => ({
      key: `edge:${c.id}`,
      targetType: 'edge',
      id: c.id,
      category: 'cable',
      title: `${c.cableCode}${c.label ? ` · ${c.label}` : ''}`,
      subtitle: `${c.cableType} · ${c.bandwidth} · ${c.lengthMeters}m`,
      accentColor: c.color
    }));

    return [...floorItems, ...roomItems, ...rackItems, ...nodeItems, ...cableItems];
  }, [project]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (category !== 'all' && it.category !== category) return false;
      if (!q) return true;
      return `${it.title} ${it.subtitle}`.toLowerCase().includes(q);
    });
  }, [items, category, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, category]);

  useEffect(() => {
    if (!isOpen || filtered.length === 0) return;
    const clamped = Math.max(0, Math.min(activeIndex, filtered.length - 1));
    const el = listRef.current?.querySelector<HTMLElement>(`[data-outline-idx="${clamped}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, filtered.length, isOpen]);

  if (!isOpen) return null;

  const activeItem = filtered[activeIndex];

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown' && !e.altKey) {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % filtered.length);
      return;
    }

    if (e.key === 'ArrowUp' && !e.altKey) {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + filtered.length) % filtered.length);
      return;
    }

    if (e.key === 'Enter' && activeItem && document.activeElement?.tagName !== 'BUTTON') {
      e.preventDefault();
      onSelectAndPanToItem(activeItem.targetType, activeItem.id);
      return;
    }

    if (
      e.altKey &&
      !isReadOnlyMode &&
      activeItem?.targetType === 'node' &&
      !activeItem.locked &&
      onNudgeNode
    ) {
      const step = 10;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onNudgeNode(activeItem.id, -step, 0);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNudgeNode(activeItem.id, step, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onNudgeNode(activeItem.id, 0, -step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onNudgeNode(activeItem.id, 0, step);
      }
    }
  };

  const renderCategoryIcon = (it: OutlineItem) => {
    if (it.targetType === 'floor') return <Layers className="w-3.5 h-3.5 text-indigo-600 shrink-0" />;
    if (it.targetType === 'room') return <Building2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300 shrink-0" />;
    if (it.targetType === 'rack') return <Box className="w-3.5 h-3.5 text-slate-800 dark:text-slate-200 shrink-0" />;
    if (it.targetType === 'edge') return <GitBranch className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
    return <Server className="w-3.5 h-3.5 text-blue-600 shrink-0" />;
  };

  return (
    <aside
      role="region"
      aria-label="Danh sách đối tượng bản vẽ"
      onKeyDown={handlePanelKeyDown}
      className="fixed md:relative left-0 top-0 bottom-0 z-40 w-[300px] max-w-[88vw] h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-xl md:shadow-none flex flex-col text-xs text-slate-800 dark:text-slate-200 shrink-0 no-print"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ListTree className="w-4 h-4 text-blue-600 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 dark:text-white truncate">
              Danh sách Đối tượng
            </h2>
            <p className="text-[10.5px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {filtered.length}/{items.length} phần tử
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng danh sách đối tượng"
          className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search + Category Filter */}
      <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm tên, IP, mã cáp..."
            aria-label="Lọc danh sách đối tượng"
            aria-controls="hachihi-outline-listbox"
            aria-activedescendant={activeItem ? `outline-row-${activeItem.id}` : undefined}
            className="w-full pl-8 pr-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-5 gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md">
          {(
            [
              { id: 'all', label: 'Tất' },
              { id: 'device', label: 'TB' },
              { id: 'rack', label: 'Rack' },
              { id: 'cable', label: 'Cáp' },
              { id: 'space', label: 'Phòng' }
            ] as const
          ).map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`py-1 rounded text-[10.5px] font-semibold whitespace-nowrap ${
                category === c.id
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accessible Listbox */}
      <div
        id="hachihi-outline-listbox"
        ref={listRef}
        role="listbox"
        aria-label="Các đối tượng trên bản vẽ"
        className="flex-1 overflow-y-auto p-1.5 space-y-1"
      >
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-[11px]">
            Không có đối tượng khớp điều kiện lọc.
          </div>
        ) : (
          filtered.map((item, idx) => {
            const isSelected =
              (item.targetType === selection.type && item.id === selection.id) ||
              (item.targetType === 'node' && selection.additionalIds?.includes(item.id));
            const isActive = idx === activeIndex;

            return (
              <div
                key={item.key}
                id={`outline-row-${item.id}`}
                data-outline-idx={idx}
                role="option"
                aria-selected={Boolean(isSelected)}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`group rounded-md border px-2 py-1.5 flex items-center justify-between gap-1.5 transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/50'
                    : isActive
                    ? 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/70'
                    : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveIndex(idx);
                    onSelectAndPanToItem(item.targetType, item.id);
                  }}
                  className="flex-1 min-w-0 text-left flex items-center gap-2"
                >
                  {renderCategoryIcon(item)}
                  <div className="min-w-0 flex-1">
                    <div
                      className={`font-semibold truncate ${
                        item.hidden
                          ? 'text-slate-400 line-through'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {item.title}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono">
                      {item.subtitle}
                    </div>
                  </div>
                </button>

                {!isReadOnlyMode && item.targetType === 'node' && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    {onToggleNodeLock && (
                      <button
                        type="button"
                        onClick={() => onToggleNodeLock([item.id])}
                        aria-label={`${item.locked ? 'Mở khóa' : 'Khóa'} ${item.title}`}
                        title={item.locked ? 'Mở khóa vị trí' : 'Khóa vị trí'}
                        className={`p-1 rounded ${
                          item.locked
                            ? 'text-amber-600 bg-amber-100/70 dark:bg-amber-950/60'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                        }`}
                      >
                        {item.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                    )}
                    {onToggleNodeVisibility && (
                      <button
                        type="button"
                        onClick={() => onToggleNodeVisibility([item.id])}
                        aria-label={`${item.hidden ? 'Hiện' : 'Ẩn'} ${item.title}`}
                        title={item.hidden ? 'Hiện trên sơ đồ' : 'Ẩn khỏi sơ đồ'}
                        className={`p-1 rounded ${
                          item.hidden
                            ? 'text-rose-600 bg-rose-50 dark:bg-rose-950/40'
                            : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                        }`}
                      >
                        {item.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer keyboard guide */}
      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
        {isReadOnlyMode
          ? '↑↓ Chọn · Enter Đi tới đối tượng · Esc Đóng'
          : '↑↓ Chọn · Enter Đi tới · Alt+Mũi tên Dịch 10px'}
      </div>
    </aside>
  );
};
