import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

export type ViewportMode = '2d' | '3d';
export type CameraPresetId = 'iso' | 'top' | 'front' | 'side';
export type Capture3DBackground = 'light' | 'dark';
export type RenderQualityLevel = 'low' | 'medium' | 'high';

export interface Capture3DRequestOptions {
  width?: number;
  height?: number;
  background?: Capture3DBackground;
  preset?: CameraPresetId;
}

export interface Capture3DResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  preset: CameraPresetId;
  background: Capture3DBackground;
}

export interface View3DDisplayOptions {
  showAxes: boolean;
  explodeSpread: number;
  viewAllFloors: boolean;
  activePreset: CameraPresetId;
  wireframeMode: boolean;
  renderQuality: RenderQualityLevel;
  shadowsEnabled: boolean;
  showThermalHeatmap: boolean;
}

export interface Network3DSceneHandle {
  captureImage: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
  setCameraPreset: (preset: CameraPresetId) => void;
  fitToScreen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  isContextLost: () => boolean;
}

interface Viewport2DHandlers {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToScreen: () => void;
  getViewportSnapshot: () => {
    pan: { x: number; y: number };
    zoom: number;
    viewportSize: { w: number; h: number };
  };
}

interface ViewportContextValue {
  mode: ViewportMode;
  is3DView: boolean;
  isFullscreen: boolean;
  is3DDragLocked: boolean;
  is3DContextLost: boolean;
  isCapturing3D: boolean;
  last3DCaptureError: string | null;
  view3DOptions: View3DDisplayOptions;
  setMode: (next: ViewportMode) => void;
  toggleMode: () => void;
  setIs3DDragLocked: React.Dispatch<React.SetStateAction<boolean>>;
  toggleFullscreen: () => void;
  setView3DOptions: React.Dispatch<React.SetStateAction<View3DDisplayOptions>>;
  setCameraPreset: (preset: CameraPresetId) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToScreen: () => void;
  register3DHandle: (handle: Network3DSceneHandle | null) => void;
  setIs3DContextLost: (lost: boolean) => void;
  clear3DCaptureError: () => void;
  capture3DImage: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
  update2DHandlers: (handlers: Viewport2DHandlers) => void;
}

const ViewportContext = createContext<ViewportContextValue | null>(null);

interface ViewportProviderProps {
  children: React.ReactNode;
  defaultViewAllFloors?: boolean;
  onBeforeExit3D?: () => void;
  onAfterEnter3D?: () => void;
}

export const ViewportProvider: React.FC<ViewportProviderProps> = ({
  children,
  defaultViewAllFloors = false,
  onBeforeExit3D,
  onAfterEnter3D
}) => {
  const [mode, setModeState] = useState<ViewportMode>('2d');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [is3DDragLocked, setIs3DDragLocked] = useState(true);
  const [is3DContextLost, setIs3DContextLost] = useState(false);
  const [isCapturing3D, setIsCapturing3D] = useState(false);
  const [last3DCaptureError, setLast3DCaptureError] = useState<string | null>(null);
  const [view3DOptions, setView3DOptions] = useState<View3DDisplayOptions>({
    showAxes: true,
    explodeSpread: 0,
    viewAllFloors: defaultViewAllFloors,
    activePreset: 'iso',
    wireframeMode: false,
    renderQuality: 'high',
    shadowsEnabled: true,
    showThermalHeatmap: true
  });

  const handle3DRef = useRef<Network3DSceneHandle | null>(null);
  const handlers2DRef = useRef<Viewport2DHandlers | null>(null);
  const capturePromiseRef = useRef<Promise<Capture3DResult> | null>(null);

  // Sync isFullscreen cleanly with native fullscreenchange (handles ESC & browser chrome exits)
  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const setMode = useCallback(
    (next: ViewportMode) => {
      setModeState(prev => {
        if (prev === next) return prev;
        if (next === '2d') {
          onBeforeExit3D?.();
        } else {
          setIs3DDragLocked(true);
          onAfterEnter3D?.();
        }
        return next;
      });
    },
    [onAfterEnter3D, onBeforeExit3D]
  );

  const toggleMode = useCallback(() => {
    setModeState(prev => {
      const next: ViewportMode = prev === '3d' ? '2d' : '3d';
      if (next === '2d') {
        onBeforeExit3D?.();
      } else {
        setIs3DDragLocked(true);
        onAfterEnter3D?.();
      }
      return next;
    });
  }, [onAfterEnter3D, onBeforeExit3D]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  }, []);

  const register3DHandle = useCallback((handle: Network3DSceneHandle | null) => {
    handle3DRef.current = handle;
    if (!handle) {
      setIs3DContextLost(false);
    }
  }, []);

  const update2DHandlers = useCallback((handlers: Viewport2DHandlers) => {
    handlers2DRef.current = handlers;
  }, []);

  const zoomIn = useCallback(() => {
    if (mode === '3d') {
      handle3DRef.current?.zoomIn();
    } else {
      handlers2DRef.current?.zoomIn();
    }
  }, [mode]);

  const zoomOut = useCallback(() => {
    if (mode === '3d') {
      handle3DRef.current?.zoomOut();
    } else {
      handlers2DRef.current?.zoomOut();
    }
  }, [mode]);

  const resetZoom = useCallback(() => {
    if (mode === '3d') {
      handle3DRef.current?.resetZoom();
    } else {
      handlers2DRef.current?.resetZoom();
    }
  }, [mode]);

  const fitToScreen = useCallback(() => {
    if (mode === '3d') {
      handle3DRef.current?.fitToScreen();
    } else {
      handlers2DRef.current?.fitToScreen();
    }
  }, [mode]);

  const setCameraPreset = useCallback((preset: CameraPresetId) => {
    setView3DOptions(prev => ({ ...prev, activePreset: preset }));
    handle3DRef.current?.setCameraPreset(preset);
  }, []);

  const clear3DCaptureError = useCallback(() => {
    setLast3DCaptureError(null);
  }, []);

  const capture3DImage = useCallback(
    async (options?: Capture3DRequestOptions): Promise<Capture3DResult> => {
      if (capturePromiseRef.current) {
        return capturePromiseRef.current;
      }
      const handle = handle3DRef.current;
      if (!handle) {
        const msg =
          'Không thể chụp mô hình 3D vì không gian 3D chưa sẵn sàng. Vui lòng chuyển sang chế độ 3D trước khi xuất.';
        setLast3DCaptureError(msg);
        throw new Error(msg);
      }
      if (handle.isContextLost() || is3DContextLost) {
        const msg =
          'WebGL Context của khung nhìn 3D đang bị mất hoặc tạm gián đoạn. Vui lòng khôi phục khung nhìn 3D rồi thử lại.';
        setLast3DCaptureError(msg);
        throw new Error(msg);
      }

      setIsCapturing3D(true);
      setLast3DCaptureError(null);

      const job = handle
        .captureImage(options)
        .catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          setLast3DCaptureError(msg);
          throw err;
        })
        .finally(() => {
          capturePromiseRef.current = null;
          setIsCapturing3D(false);
        });

      capturePromiseRef.current = job;
      return job;
    },
    [is3DContextLost]
  );

  const value = useMemo<ViewportContextValue>(
    () => ({
      mode,
      is3DView: mode === '3d',
      isFullscreen,
      is3DDragLocked,
      is3DContextLost,
      isCapturing3D,
      last3DCaptureError,
      view3DOptions,
      setMode,
      toggleMode,
      setIs3DDragLocked,
      toggleFullscreen,
      setView3DOptions,
      setCameraPreset,
      zoomIn,
      zoomOut,
      resetZoom,
      fitToScreen,
      register3DHandle,
      setIs3DContextLost,
      clear3DCaptureError,
      capture3DImage,
      update2DHandlers
    }),
    [
      mode,
      isFullscreen,
      is3DDragLocked,
      is3DContextLost,
      isCapturing3D,
      last3DCaptureError,
      view3DOptions,
      setMode,
      toggleMode,
      toggleFullscreen,
      setCameraPreset,
      zoomIn,
      zoomOut,
      resetZoom,
      fitToScreen,
      register3DHandle,
      clear3DCaptureError,
      capture3DImage,
      update2DHandlers
    ]
  );

  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
};

export function useViewport(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (!ctx) {
    throw new Error('useViewport must be used within a ViewportProvider');
  }
  return ctx;
}
