import { useState, useEffect, useCallback, RefObject } from 'react';

export type LayoutTier = 'wide' | 'medium' | 'narrow';
export type DeviceClass = 'desktop' | 'tablet' | 'mobile';
export type UIDensity = 'compact' | 'comfortable';
export type ActiveDrawer = 'none' | 'library' | 'properties' | 'layers';
export type BottomSheetSnap = 'collapsed' | 'half' | 'full';

interface DeviceLayoutPrefs {
  leftWidth: number;
  rightWidth: number;
  density: UIDensity;
  highContrast: boolean;
  reducedMotion: boolean;
}

const STORAGE_KEY = 'hachihi_workspace_layout_v1';

function detectDeviceClass(width: number): DeviceClass {
  const isCoarse =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  if (width < 768) return 'mobile';
  if (width < 1280 || isCoarse) return 'tablet';
  return 'desktop';
}

function defaultPrefsForDevice(device: DeviceClass): DeviceLayoutPrefs {
  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    leftWidth: 272,
    rightWidth: device === 'desktop' ? 320 : 304,
    density: device === 'desktop' ? 'compact' : 'comfortable',
    highContrast: false,
    reducedMotion: prefersReduced
  };
}

function readStoredPrefs(device: DeviceClass): DeviceLayoutPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<DeviceClass, Partial<DeviceLayoutPrefs>>>;
      const entry = parsed[device];
      if (entry) {
        return {
          ...defaultPrefsForDevice(device),
          ...entry,
          leftWidth: Math.min(360, Math.max(240, Number(entry.leftWidth) || 272)),
          rightWidth: Math.min(520, Math.max(272, Number(entry.rightWidth) || 320))
        };
      }
    }
  } catch {
    // ignore storage errors
  }
  return defaultPrefsForDevice(device);
}

function saveStoredPrefs(device: DeviceClass, prefs: DeviceLayoutPrefs): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, DeviceLayoutPrefs>) : {};
    parsed[device] = prefs;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage errors
  }
}

export function useWorkspaceLayout(shellRef: RefObject<HTMLElement | null>) {
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    height: typeof window !== 'undefined' ? window.innerHeight : 900
  }));

  const layoutTier: LayoutTier =
    containerSize.width >= 1280 ? 'wide' : containerSize.width >= 768 ? 'medium' : 'narrow';

  const deviceClass: DeviceClass = detectDeviceClass(containerSize.width);

  const [prefs, setPrefs] = useState<DeviceLayoutPrefs>(() => readStoredPrefs(deviceClass));
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>('none');
  const [bottomSheetSnap, setBottomSheetSnap] = useState<BottomSheetSnap>('collapsed');

  // Re-load device-specific layout memory when transitioning across device classes
  useEffect(() => {
    setPrefs(readStoredPrefs(deviceClass));
    if (layoutTier === 'wide') {
      setActiveDrawer('none');
    }
  }, [deviceClass, layoutTier]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const updateFromRect = (w: number, h: number) => {
      if (w > 0 && h > 0) {
        setContainerSize({ width: Math.round(w), height: Math.round(h) });
      }
    };

    const rect = el.getBoundingClientRect();
    updateFromRect(rect.width, rect.height);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
          updateFromRect(entry.contentRect.width, entry.contentRect.height);
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }

    const onWinResize = () => updateFromRect(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', onWinResize);
    return () => window.removeEventListener('resize', onWinResize);
  }, [shellRef]);

  const updatePrefs = useCallback(
    (updater: (prev: DeviceLayoutPrefs) => DeviceLayoutPrefs) => {
      setPrefs(prev => {
        const next = updater(prev);
        saveStoredPrefs(deviceClass, next);
        return next;
      });
    },
    [deviceClass]
  );

  const setLeftWidth = useCallback(
    (width: number) => {
      const clamped = Math.min(360, Math.max(240, Math.round(width)));
      updatePrefs(p => ({ ...p, leftWidth: clamped }));
    },
    [updatePrefs]
  );

  const setRightWidth = useCallback(
    (width: number) => {
      const clamped = Math.min(520, Math.max(272, Math.round(width)));
      updatePrefs(p => ({ ...p, rightWidth: clamped }));
    },
    [updatePrefs]
  );

  const setDensity = useCallback(
    (density: UIDensity) => updatePrefs(p => ({ ...p, density })),
    [updatePrefs]
  );

  const toggleDensity = useCallback(
    () => updatePrefs(p => ({ ...p, density: p.density === 'compact' ? 'comfortable' : 'compact' })),
    [updatePrefs]
  );

  const toggleHighContrast = useCallback(
    () => updatePrefs(p => ({ ...p, highContrast: !p.highContrast })),
    [updatePrefs]
  );

  const toggleReducedMotion = useCallback(
    () => updatePrefs(p => ({ ...p, reducedMotion: !p.reducedMotion })),
    [updatePrefs]
  );

  return {
    containerSize,
    layoutTier,
    deviceClass,
    leftWidth: prefs.leftWidth,
    rightWidth: prefs.rightWidth,
    density: prefs.density,
    highContrast: prefs.highContrast,
    reducedMotion: prefs.reducedMotion,
    activeDrawer,
    setActiveDrawer,
    bottomSheetSnap,
    setBottomSheetSnap,
    setLeftWidth,
    setRightWidth,
    setDensity,
    toggleDensity,
    toggleHighContrast,
    toggleReducedMotion
  };
}
