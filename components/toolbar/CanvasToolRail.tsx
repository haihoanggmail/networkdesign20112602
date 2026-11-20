import React from 'react';
import {
  MousePointer,
  Hand,
  GitBranch,
  Square,
  Type,
  Table2,
  Route,
  Ruler,
  type LucideIcon
} from 'lucide-react';
import { DesignMode } from '../../types/infrastructure';
import { CanvasTool } from '../../store/useProjectStore';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';
import {
  ShortcutActionId,
  ShortcutKeymap,
  formatShortcutDisplay,
  getDefaultShortcutKeymap
} from '../../hooks/useKeyboardShortcuts';

interface CanvasToolRailProps {
  activeTool: CanvasTool;
  activeMode: DesignMode;
  layoutTier: LayoutTier;
  keymap?: ShortcutKeymap;
  isReadOnlyMode?: boolean;
  onSetTool: (tool: CanvasTool) => void;
  onGenerateLegend?: () => void;
}

type ToolItem =
  | {
      kind: 'tool';
      id: CanvasTool;
      actionId: ShortcutActionId;
      label: string;
      icon: LucideIcon;
    }
  | {
      kind: 'action';
      id: 'legend';
      actionId: ShortcutActionId;
      label: string;
      icon: LucideIcon;
    };

const CANVAS_TOOLS: ToolItem[] = [
  { kind: 'tool', id: 'select', actionId: 'tool_select', label: 'Chọn', icon: MousePointer },
  { kind: 'tool', id: 'pan', actionId: 'tool_pan', label: 'Kéo', icon: Hand },
  { kind: 'tool', id: 'connect', actionId: 'tool_connect', label: 'Nối dây', icon: GitBranch },
  { kind: 'tool', id: 'room', actionId: 'tool_room', label: 'Phòng', icon: Square },
  { kind: 'tool', id: 'tray', actionId: 'tool_tray', label: 'Máng cáp', icon: Route },
  { kind: 'tool', id: 'text', actionId: 'tool_text', label: 'Chữ', icon: Type },
  { kind: 'action', id: 'legend', actionId: 'action_legend', label: 'Chú giải', icon: Table2 },
  { kind: 'tool', id: 'measure', actionId: 'tool_measure', label: 'Đo', icon: Ruler }
];

const RECOMMENDED_BY_MODE: Record<DesignMode, string[]> = {
  topology: ['select', 'connect'],
  multisite: ['select', 'connect'],
  floorplan: ['room', 'tray', 'measure', 'connect'],
  rack: ['select', 'measure'],
  fiber: ['connect', 'tray', 'measure'],
  cctv: ['room', 'tray', 'connect', 'measure'],
  wifi: ['room', 'measure'],
  electrical: ['connect', 'tray', 'measure']
};

export const CanvasToolRail: React.FC<CanvasToolRailProps> = ({
  activeTool,
  activeMode,
  layoutTier,
  keymap,
  isReadOnlyMode = false,
  onSetTool,
  onGenerateLegend
}) => {
  if (layoutTier === 'narrow') return null;

  const activeKeymap = keymap || getDefaultShortcutKeymap();
  const isCompactRail = layoutTier === 'medium';
  const recommendedIds = RECOMMENDED_BY_MODE[activeMode] || ['select'];

  return (
    <aside
      aria-label="Thanh công cụ vẽ"
      onPointerDown={e => e.stopPropagation()}
      className="hidden md:flex flex-col gap-1 absolute top-3 left-3 z-20 p-1.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-800 shadow-md select-none no-print"
    >
      {CANVAS_TOOLS.map(item => {
        const Icon = item.icon;
        const shortcut = formatShortcutDisplay(activeKeymap[item.actionId]);
        const isActive = item.kind === 'tool' && activeTool === item.id;
        const isRecommended = recommendedIds.includes(item.id);
        const disabled =
          isReadOnlyMode &&
          item.id !== 'select' &&
          item.id !== 'pan' &&
          item.id !== 'measure';

        const handleClick = () => {
          if (disabled) return;
          if (item.kind === 'action') {
            onGenerateLegend?.();
          } else {
            onSetTool(item.id);
          }
        };

        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={handleClick}
            aria-pressed={item.kind === 'tool' ? isActive : undefined}
            aria-label={`${item.label} (${shortcut})`}
            title={`${item.label} (${shortcut})${isRecommended ? ' · Phù hợp chế độ hiện tại' : ''}`}
            className={`group relative flex items-center justify-between gap-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
              isCompactRail ? 'w-9 h-9 justify-center px-0' : 'h-8 px-2.5 min-w-[116px]'
            } ${
              isActive
                ? 'bg-[#155EEF] text-white font-semibold'
                : isRecommended
                ? 'text-slate-800 dark:text-slate-100 hover:bg-blue-50 dark:hover:bg-slate-800'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive
                    ? 'text-white'
                    : isRecommended
                    ? 'text-[#155EEF] dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              />
              {!isCompactRail && <span>{item.label}</span>}
            </span>
            {!isCompactRail && (
              <kbd
                className={`font-mono text-xs ${
                  isActive ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {shortcut}
              </kbd>
            )}
          </button>
        );
      })}
    </aside>
  );
};
