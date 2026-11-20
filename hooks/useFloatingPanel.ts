import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface FloatingPanelPosition {
  x: number;
  y: number;
}

export type DockSideOrFree = 'bottom' | 'left' | 'right' | 'free';

export interface EdgeOrFreeDropResult {
  mode: DockSideOrFree;
  freePos?: FloatingPanelPosition;
}

/**
 * Clamps a floating panel's top-left coordinate cleanly inside its host container.
 */
export function clampFloatingPosition(
  pos: FloatingPanelPosition,
  panelWidth: number,
  panelHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding = 8
): FloatingPanelPosition {
  const safePad = Math.max(0, padding);
  const maxX = Math.max(safePad, containerWidth - panelWidth - safePad);
  const maxY = Math.max(safePad, containerHeight - panelHeight - safePad);
  return {
    x: Math.round(Math.max(safePad, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(safePad, Math.min(maxY, pos.y)))
  };
}

/**
 * Resolves whether a dragged dock panel should snap to Left / Right / Bottom edge
 * or stay freely placed anywhere in the viewport.
 */
export function resolveEdgeOrFreeDrop(
  pointerRelX: number,
  pointerRelY: number,
  panelWidth: number,
  panelHeight: number,
  containerWidth: number,
  containerHeight: number
): EdgeOrFreeDropResult {
  const w = Math.max(1, containerWidth);
  const h = Math.max(1, containerHeight);
  const nx = pointerRelX / w;
  const ny = pointerRelY / h;

  if (nx <= 0.16 && ny <= 0.88) {
    return { mode: 'left' };
  }
  if (nx >= 0.84 && ny <= 0.88) {
    return { mode: 'right' };
  }
  if (ny >= 0.84) {
    return { mode: 'bottom' };
  }

  return {
    mode: 'free',
    freePos: clampFloatingPosition(
      {
        x: pointerRelX - panelWidth / 2,
        y: pointerRelY - panelHeight / 2
      },
      panelWidth,
      panelHeight,
      containerWidth,
      containerHeight,
      8
    )
  };
}

interface StoredFloatingState {
  collapsed?: boolean;
  position?: FloatingPanelPosition | null;
}

function loadStoredPanelState(
  storageKey: string,
  defaultCollapsed: boolean
): { collapsed: boolean; position: FloatingPanelPosition | null } {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { collapsed: defaultCollapsed, position: null };
    const parsed = JSON.parse(raw) as StoredFloatingState;
    const collapsed = typeof parsed.collapsed === 'boolean' ? parsed.collapsed : defaultCollapsed;
    const pos =
      parsed.position &&
      typeof parsed.position.x === 'number' &&
      Number.isFinite(parsed.position.x) &&
      typeof parsed.position.y === 'number' &&
      Number.isFinite(parsed.position.y)
        ? { x: parsed.position.x, y: parsed.position.y }
        : null;
    return { collapsed, position: pos };
  } catch {
    return { collapsed: defaultCollapsed, position: null };
  }
}

export function useFloatingPanel(options: {
  containerRef: React.RefObject<HTMLElement | null>;
  storageKey: string;
  defaultCollapsed?: boolean;
  padding?: number;
  isOpen?: boolean;
}) {
  const { containerRef, storageKey, defaultCollapsed = false, padding = 8, isOpen = true } = options;
  const panelRef = useRef<HTMLDivElement>(null);

  const [initial] = useState(() => loadStoredPanelState(storageKey, defaultCollapsed));
  const [collapsed, setCollapsed] = useState<boolean>(initial.collapsed);
  const [position, setPosition] = useState<FloatingPanelPosition | null>(initial.position);
  const [isDragging, setIsDragging] = useState(false);

  const positionRef = useRef(position);
  positionRef.current = position;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ collapsed, position } satisfies StoredFloatingState)
      );
    } catch {
      // ignore storage errors
    }
  }, [storageKey, collapsed, position]);

  const clampCurrentPosition = useCallback(() => {
    const curr = positionRef.current;
    const containerEl = containerRef.current;
    const panelEl = panelRef.current;
    if (!curr || !containerEl || !panelEl) return;

    const cRect = containerEl.getBoundingClientRect();
    const pRect = panelEl.getBoundingClientRect();
    if (cRect.width <= 0 || cRect.height <= 0) return;

    const next = clampFloatingPosition(
      curr,
      pRect.width,
      pRect.height,
      cRect.width,
      cRect.height,
      padding
    );
    if (next.x !== curr.x || next.y !== curr.y) {
      setPosition(next);
    }
  }, [containerRef, padding]);

  useLayoutEffect(() => {
    if (isOpen) {
      clampCurrentPosition();
    }
  }, [collapsed, isOpen, clampCurrentPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const containerEl = containerRef.current;
    const panelEl = panelRef.current;
    if (!containerEl && !panelEl) return;

    const ro = new ResizeObserver(() => {
      clampCurrentPosition();
    });
    if (containerEl) ro.observe(containerEl);
    if (panelEl) ro.observe(panelEl);
    return () => ro.disconnect();
  }, [containerRef, isOpen, clampCurrentPosition]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(v => !v);
  }, []);

  const resetPosition = useCallback(() => {
    setPosition(null);
  }, []);

  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const containerEl = containerRef.current;
      const panelEl = panelRef.current;
      if (!containerEl || !panelEl) return;

      dragCleanupRef.current?.();

      const cRect = containerEl.getBoundingClientRect();
      const pRect = panelEl.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const baseLeft = pRect.left - cRect.left;
      const baseTop = pRect.top - cRect.top;
      let started = false;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!started && Math.hypot(dx, dy) < 4) return;
        if (!started) {
          started = true;
          setIsDragging(true);
        }
        const liveContainerRect = containerEl.getBoundingClientRect();
        const livePanelRect = panelEl.getBoundingClientRect();
        const clamped = clampFloatingPosition(
          { x: baseLeft + dx, y: baseTop + dy },
          livePanelRect.width,
          livePanelRect.height,
          liveContainerRect.width,
          liveContainerRect.height,
          padding
        );
        setPosition(clamped);
      };

      const cleanupListeners = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (dragCleanupRef.current === cleanupListeners) {
          dragCleanupRef.current = null;
        }
      };

      const onUp = () => {
        cleanupListeners();
        if (started) {
          setIsDragging(false);
        }
      };

      dragCleanupRef.current = cleanupListeners;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [containerRef, padding]
  );

  return {
    panelRef,
    position,
    collapsed,
    isDragging,
    setCollapsed,
    toggleCollapsed,
    resetPosition,
    handleDragStart
  };
}
