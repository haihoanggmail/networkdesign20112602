import React, { useMemo } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Maximize2,
  Minimize2
} from 'lucide-react';
import type { Floor } from '../../types/infrastructure';
import type { FloatingPanelPosition } from '../../hooks/useFloatingPanel';

export interface FloorPanelHookState {
  panelRef: React.RefObject<HTMLDivElement | null>;
  position: FloatingPanelPosition | null;
  collapsed: boolean;
  toggleCollapsed: () => void;
  resetPosition: () => void;
  handleDragStart: (e: React.PointerEvent<HTMLElement>) => void;
}

export interface FloorSwitcher3DOverlayProps {
  floors: Floor[];
  activeFloorId: string;
  isFloorBasedMode: boolean;
  viewAllFloors: boolean;
  isReadOnlyMode: boolean;
  showAxes: boolean;
  isXyzPanelFreePositioned: boolean;
  panel: FloorPanelHookState;
  onSelectFloor: (value: string) => void;
  onStepFloor: (direction: 'up' | 'down') => void;
  onToggleViewAllFloors: () => void;
  onCloneFloor?: (floorId: string, newLevel: number, newName: string) => void;
}

/**
 * Persistent 3D viewport floor switcher overlay.
 * Links directly to project.activeFloorId via onSelectFloor / onStepFloor and
 * supports toggling between whole-building cutaway and single-floor isolation.
 * Note: Intentionally avoids CSS backdrop-filter over active WebGL canvases.
 */
export const FloorSwitcher3DOverlay: React.FC<FloorSwitcher3DOverlayProps> = ({
  floors,
  activeFloorId,
  isFloorBasedMode,
  viewAllFloors,
  isReadOnlyMode,
  showAxes,
  isXyzPanelFreePositioned,
  panel,
  onSelectFloor,
  onStepFloor,
  onToggleViewAllFloors,
  onCloneFloor
}) => {
  const hasMultiFloorCutaway = isFloorBasedMode && floors.length > 1;

  const sortedFloorsDesc = useMemo(
    () => [...floors].sort((a, b) => b.level - a.level),
    [floors]
  );

  const resolvedActiveFloorId = useMemo(() => {
    if (floors.some(fl => fl.id === activeFloorId)) return activeFloorId;
    return sortedFloorsDesc[sortedFloorsDesc.length - 1]?.id || floors[0]?.id || '';
  }, [activeFloorId, floors, sortedFloorsDesc]);

  const activeFloorIndexDesc = useMemo(
    () => sortedFloorsDesc.findIndex(fl => fl.id === resolvedActiveFloorId),
    [sortedFloorsDesc, resolvedActiveFloorId]
  );

  const activeFloorName =
    floors.find(fl => fl.id === resolvedActiveFloorId)?.name || 'Tầng';

  if (floors.length === 0) return null;

  return (
    <div
      ref={panel.panelRef}
      data-testid="3d-floor-hud-panel"
      style={
        panel.position
          ? { left: `${panel.position.x}px`, top: `${panel.position.y}px` }
          : undefined
      }
      className={`pointer-events-auto absolute z-20 flex items-center gap-1 no-print ${
        panel.position
          ? ''
          : showAxes && !isXyzPanelFreePositioned
          ? 'top-3 right-[108px] max-w-[calc(100%-120px)]'
          : 'top-3 right-3 max-w-[calc(100%-24px)]'
      }`}
      onPointerDown={e => e.stopPropagation()}
    >
      {panel.collapsed ? (
        <div className="flex items-center gap-1 h-7 px-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-md text-xs text-slate-800 dark:text-slate-100">
          <button
            type="button"
            data-testid="3d-floor-drag-handle"
            onPointerDown={panel.handleDragStart}
            onDoubleClick={panel.resetPosition}
            title="Kéo để di chuyển thanh chọn tầng 3D · Nhấp đúp về góc mặc định"
            className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-testid="3d-floor-collapse-btn"
            onClick={panel.toggleCollapsed}
            title="Mở rộng thanh chọn tầng 3D"
            className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold whitespace-nowrap"
          >
            <Building2 className="w-3.5 h-3.5 text-[#155EEF] dark:text-sky-400 shrink-0" />
            <span className="max-w-[140px] truncate tabular-nums">
              {hasMultiFloorCutaway && viewAllFloors
                ? `Toàn bộ (${floors.length} tầng)`
                : activeFloorName}
            </span>
            <Maximize2 className="w-3 h-3 text-slate-400 shrink-0" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 h-8 px-1.5 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-md text-xs text-slate-800 dark:text-slate-100 overflow-x-auto flex-nowrap">
          <button
            type="button"
            data-testid="3d-floor-drag-handle"
            onPointerDown={panel.handleDragStart}
            onDoubleClick={panel.resetPosition}
            title="Kéo để di chuyển thanh chọn tầng 3D · Nhấp đúp về góc mặc định"
            className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>

          <Building2 className="w-3.5 h-3.5 text-[#155EEF] dark:text-sky-400 shrink-0" />

          <select
            data-testid="3d-floor-select"
            value={hasMultiFloorCutaway && viewAllFloors ? '__ALL__' : resolvedActiveFloorId}
            onChange={e => onSelectFloor(e.target.value)}
            aria-label="Chọn tầng hiển thị trong 3D"
            title="Chọn xem toàn bộ tòa nhà hoặc tách riêng từng tầng trong chế độ 3D"
            className="bg-transparent text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none cursor-pointer max-w-[185px] min-w-[96px]"
          >
            {hasMultiFloorCutaway && (
              <option value="__ALL__" className="dark:bg-slate-900">
                Toàn bộ tòa nhà ({floors.length} tầng)
              </option>
            )}
            {sortedFloorsDesc.map(fl => (
              <option key={fl.id} value={fl.id} className="dark:bg-slate-900">
                {fl.name}
              </option>
            ))}
          </select>

          {floors.length > 1 && (
            <div className="flex items-center gap-0.5 shrink-0 border-l border-slate-200 dark:border-slate-700 pl-1">
              <button
                type="button"
                data-testid="3d-floor-up-btn"
                disabled={!viewAllFloors && activeFloorIndexDesc <= 0}
                onClick={() => onStepFloor('up')}
                title="Lên tầng trên"
                aria-label="Chuyển lên tầng trên"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-35 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="3d-floor-down-btn"
                disabled={!viewAllFloors && activeFloorIndexDesc >= sortedFloorsDesc.length - 1}
                onClick={() => onStepFloor('down')}
                title="Xuống tầng dưới"
                aria-label="Chuyển xuống tầng dưới"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-35 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {hasMultiFloorCutaway && (
            <button
              type="button"
              data-testid="3d-floor-all-btn"
              aria-pressed={viewAllFloors}
              onClick={onToggleViewAllFloors}
              title={
                viewAllFloors
                  ? 'Thu gọn về chế độ xem riêng tầng đang chọn'
                  : 'Hiển thị mặt cắt toàn bộ các tầng trong tòa nhà'
              }
              className={`px-2 h-6 rounded-md text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                viewAllFloors
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              Toàn nhà
            </button>
          )}

          {!isReadOnlyMode && onCloneFloor && !(hasMultiFloorCutaway && viewAllFloors) && resolvedActiveFloorId && (
            <button
              type="button"
              data-testid="3d-floor-clone-btn"
              onClick={() => {
                const nextLevel = Math.max(0, ...floors.map(f => f.level)) + 1;
                onCloneFloor(resolvedActiveFloorId, nextLevel, `Tầng ${nextLevel}`);
              }}
              aria-label="Nhân bản tầng hiện tại"
              title="Nhân bản tầng hiện tại sang tầng mới"
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            data-testid="3d-floor-collapse-btn"
            onClick={panel.toggleCollapsed}
            title="Thu gọn thanh chọn tầng 3D"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
