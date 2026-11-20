import { CableEdge, CablePoint, RackSide } from '../../types/infrastructure';

export type ResizeHandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLE_DIRS: Array<{ dir: ResizeHandleDir; cursorClass: string }> = [
  { dir: 'nw', cursorClass: 'cursor-nwse-resize' },
  { dir: 'n', cursorClass: 'cursor-ns-resize' },
  { dir: 'ne', cursorClass: 'cursor-nesw-resize' },
  { dir: 'e', cursorClass: 'cursor-ew-resize' },
  { dir: 'se', cursorClass: 'cursor-nwse-resize' },
  { dir: 's', cursorClass: 'cursor-ns-resize' },
  { dir: 'sw', cursorClass: 'cursor-nesw-resize' },
  { dir: 'w', cursorClass: 'cursor-ew-resize' }
];

export interface RackDropHit {
  rackId: string;
  rackNodeId: string;
  side: RackSide;
  startU: number;
  uHeight: number;
  valid: boolean;
}

export interface DraggingRackDeviceState {
  sourceRackId: string;
  sourceSide: RackSide;
  assetId: string;
  uHeight: number;
  label: string;
  color: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  hasMoved: boolean;
}

export interface DraggingWaypointState {
  cableId: string;
  pointIndex: number;
}

export interface ReconnectingCableState {
  cableId: string;
  endpoint: 'source' | 'target';
  anchorX: number;
  anchorY: number;
}

export interface ResizeSessionState {
  targetKind: 'node' | 'room';
  targetId: string;
  handle: ResizeHandleDir;
  originClientX: number;
  originClientY: number;
  initialRect: { x: number; y: number; width: number; height: number };
  rotationDeg: number;
  minW: number;
  minH: number;
  currentRect: { x: number; y: number; width: number; height: number };
}

export interface DraggingRoomState {
  roomId: string;
  lastClientX: number;
  lastClientY: number;
}

export interface CanvasCableGeometry {
  pathD: string;
  pts: CablePoint[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  midY: number;
  midAngleDeg: number;
}

export type StartNodeResizeFn = (
  e: React.PointerEvent,
  nodeId: string,
  dir: ResizeHandleDir,
  rect: { x: number; y: number; width: number; height: number },
  rotationDeg: number,
  minW: number,
  minH: number
) => void;

export type OpenInlineCableLabelFn = (cable: CableEdge, canvasX: number, canvasY: number) => void;
