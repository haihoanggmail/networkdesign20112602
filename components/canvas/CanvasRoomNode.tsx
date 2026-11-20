import React from 'react';
import { Room } from '../../types/infrastructure';
import { RESIZE_HANDLE_DIRS, ResizeHandleDir } from './canvasTypes';

export interface CanvasRoomNodeProps {
  room: Room;
  isSelected: boolean;
  roomLocked: boolean;
  zoom: number;
  scale: number;
  isPointerPassthrough: boolean;
  onSelectAndDragStart: (e: React.PointerEvent, room: Room) => void;
  onSelectRoom: (e: React.MouseEvent, roomId: string) => void;
  onStartResize: (e: React.PointerEvent, room: Room, dir: ResizeHandleDir) => void;
}

export const CanvasRoomNode: React.FC<CanvasRoomNodeProps> = React.memo(({
  room,
  isSelected,
  roomLocked,
  zoom,
  scale,
  isPointerPassthrough,
  onSelectAndDragStart,
  onSelectRoom,
  onStartResize
}) => {
  const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
  const handleSize = 8 * invZ;
  const areaSqm = ((room.width * room.height) / (scale * scale)).toFixed(0);

  const getRoomHandlePos = (dir: ResizeHandleDir) => {
    const cx = room.x + room.width / 2;
    const cy = room.y + room.height / 2;
    switch (dir) {
      case 'nw': return { x: room.x, y: room.y };
      case 'n': return { x: cx, y: room.y };
      case 'ne': return { x: room.x + room.width, y: room.y };
      case 'e': return { x: room.x + room.width, y: cy };
      case 'se': return { x: room.x + room.width, y: room.y + room.height };
      case 's': return { x: cx, y: room.y + room.height };
      case 'sw': return { x: room.x, y: room.y + room.height };
      case 'w': return { x: room.x, y: cy };
    }
  };

  return (
    <g
      onPointerDown={(e) => {
        e.stopPropagation();
        if (isPointerPassthrough) return;
        onSelectAndDragStart(e, room);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelectRoom(e, room.id);
      }}
      className={roomLocked ? 'cursor-pointer' : 'cursor-move'}
    >
      <g
        aria-hidden="true"
        className={`pointer-events-none canvas-selection-halo${isSelected ? ' is-selected' : ''}`}
      >
        <rect
          x={room.x - 5}
          y={room.y - 5}
          width={room.width + 10}
          height={room.height + 10}
          fill="#3b82f6"
          fillOpacity={0.06}
          stroke="#60a5fa"
          strokeWidth={1.5 * invZ}
          rx="8"
          className="canvas-selection-pulse-ring-lg"
        />
        <rect
          x={room.x - 2}
          y={room.y - 2}
          width={room.width + 4}
          height={room.height + 4}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.2 * invZ}
          strokeDasharray={`${4 * invZ} ${3 * invZ}`}
          rx="5"
        />
      </g>

      <rect
        x={room.x}
        y={room.y}
        width={room.width}
        height={room.height}
        fill={room.color || '#f8fafc'}
        stroke={isSelected ? '#2563eb' : '#94a3b8'}
        strokeWidth={isSelected ? 2.5 : room.wallThickness}
        strokeDasharray={room.type === 'utility_riser' ? '6 4' : 'none'}
        rx="4"
        className="canvas-node-surface"
        filter={isSelected ? 'drop-shadow(0 0 8px rgba(37,99,235,0.22))' : undefined}
      />
      <rect
        x={room.x}
        y={room.y}
        width={room.width}
        height={22}
        fill={isSelected ? '#3b82f6' : '#e2e8f0'}
        opacity={0.85}
        rx="4"
        className="canvas-node-surface"
      />
      <text
        x={room.x + 8}
        y={room.y + 15}
        fill={isSelected ? '#ffffff' : '#334155'}
        fontSize="10"
        fontWeight="600"
        className="pointer-events-none canvas-node-surface"
      >
        {room.name} · {areaSqm}m²
      </text>

      {isSelected && !roomLocked && (
        <g className="canvas-resize-handles">
          {RESIZE_HANDLE_DIRS.map(({ dir, cursorClass }) => {
            const pos = getRoomHandlePos(dir);
            return (
              <rect
                key={`rm_h_${dir}`}
                x={pos.x - handleSize / 2}
                y={pos.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={1.5 * invZ}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={1.5 * invZ}
                className={cursorClass}
                onPointerDown={(e) => onStartResize(e, room, dir)}
              />
            );
          })}
        </g>
      )}
    </g>
  );
}, (prev, next) => (
  prev.room === next.room &&
  prev.isSelected === next.isSelected &&
  prev.roomLocked === next.roomLocked &&
  prev.scale === next.scale &&
  prev.isPointerPassthrough === next.isPointerPassthrough &&
  (!next.isSelected || prev.zoom === next.zoom)
));

CanvasRoomNode.displayName = 'CanvasRoomNode';
