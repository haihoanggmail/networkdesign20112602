import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { useProjectStore } from './store/useProjectStore';
import { TopBar } from './components/topbar/TopBar';
import { LeftLibrary } from './components/sidebar/LeftLibrary';
import { DesignCanvas } from './components/canvas/DesignCanvas';
import { PropertiesPanel } from './components/properties/PropertiesPanel';
import { StatusBar } from './components/statusbar/StatusBar';
import { QuickAccessBar } from './components/toolbar/QuickAccessBar';
import { QUICK_TOUR_STORAGE_KEY } from './config/appInfo';
import { DESIGN_MODES, DESIGN_MODE_GROUPS } from './utils/designModes';
import {
  WorkspacePresetId,
  getWorkspacePresetMeta,
  computeNextHiddenLayersForPreset,
  loadSavedWorkspacePresetId,
  saveWorkspacePresetId
} from './utils/workspacePresets';
import { ErrorBoundary } from './components/modals/ErrorBoundary';
import type { AuditIssue } from './utils/engineeringValidator';
import { runBatchAutoRouteOffThread, useAsyncEngineeringAudit } from './utils/computeWorkerClient';
import { importNetworkScannerData, diffMergeNetworkScannerData } from './utils/scannerImport';
import { ProjectState, DesignMode, CanvasLayerId } from './types/infrastructure';
import { useWorkspaceLayout, BottomSheetSnap } from './hooks/useWorkspaceLayout';
import { formatShortcutDisplay, useShortcutKeymap, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useCADController } from './hooks/useCADController';
import type { BomTab } from './components/modals/BomStatisticsModal';
import {
  normalizeCanvasPerformanceMode,
  resolveCanvasPerformancePolicy
} from './utils/canvasPerformance';
import {
  LAYER_CATALOG,
  resolveSelectableTargetForLayer
} from './utils/layerPolicy';
import { layoutRackNodesForElevationMode } from './utils/rackGeometry';
import { ViewportProvider, useViewport } from './contexts/ViewportContext';
import { ViewportController } from './components/viewport/ViewportController';
import { LayerPanel } from './components/layers/LayerPanel';
import { loadPanelCollapsed, savePanelCollapsed } from './utils/panelCollapseStorage';
import {
  RecentActionEntry,
  ReplayableActionId,
  clearRecentActionsStorage,
  loadRecentActions,
  pushRecentAction,
  saveRecentActions
} from './utils/recentActions';
import {
  inspectProjectImportPayload,
  PackagePreviewInspection
} from './utils/projectPackage';
import {
  Layers,
  ShieldCheck,
  Download,
  GripHorizontal,
  X,
  PenTool,
  PlusSquare,
  SlidersHorizontal,
  MoreHorizontal,
  MousePointer,
  Hand,
  GitBranch,
  Square,
  Type,
  Table2,
  Ruler,
  FolderOpen,
  FolderKanban,
  Sun,
  Moon,
  Compass,
  FileArchive,
  Lock,
  Unlock,
  Info,
  MessageSquarePlus,
  ClipboardList,
  Sparkles,
  CheckCircle2,
  Cuboid,
  Box,
  Route
} from 'lucide-react';
import {
  APP_VERSION,
  CHANGELOG_HIGHLIGHTS_310,
  buildFeedbackFormUrl,
  isFeedbackFormConfigured
} from './config/appInfo';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { trackVisit } from './services/tracker';

interface LaunchQueueFileHandleLike {
  name?: string;
  getFile?: () => Promise<File>;
}

interface LaunchParamsLike {
  files?: LaunchQueueFileHandleLike[];
}

interface WindowWithLaunchQueue extends Window {
  launchQueue?: {
    setConsumer: (consumer: (launchParams: LaunchParamsLike) => void | Promise<void>) => void;
  };
}

// Lazy-loaded heavy modules & modals for optimal bundle splitting
const Network3DScene = lazy(() =>
  import('./components/canvas/Network3DScene').then(m => ({ default: m.Network3DScene }))
);
const NetworkAssistantChat = lazy(() =>
  import('./components/chat/NetworkAssistantChat').then(m => ({ default: m.NetworkAssistantChat }))
);
const BuildingGeneratorModal = lazy(() =>
  import('./components/modals/BuildingGeneratorModal').then(m => ({ default: m.BuildingGeneratorModal }))
);
const TemplateGalleryModal = lazy(() =>
  import('./components/modals/TemplateGalleryModal').then(m => ({ default: m.TemplateGalleryModal }))
);
const ExportModal = lazy(() =>
  import('./components/modals/ExportModal').then(m => ({ default: m.ExportModal }))
);
const DeepInspectModal = lazy(() =>
  import('./components/modals/DeepInspectModal').then(m => ({ default: m.DeepInspectModal }))
);
const GuideModal = lazy(() =>
  import('./components/modals/GuideModal').then(m => ({ default: m.GuideModal }))
);
const ProjectHubModal = lazy(() =>
  import('./components/modals/ProjectHubModal').then(m => ({ default: m.ProjectHubModal }))
);
const EngineeringAuditModal = lazy(() =>
  import('./components/modals/EngineeringAuditModal').then(m => ({ default: m.EngineeringAuditModal }))
);
const CommandPaletteModal = lazy(() =>
  import('./components/modals/CommandPaletteModal').then(m => ({ default: m.CommandPaletteModal }))
);
const ShortcutSettingsModal = lazy(() =>
  import('./components/modals/ShortcutSettingsModal').then(m => ({ default: m.ShortcutSettingsModal }))
);
const InfrastructureDirectoryModal = lazy(() =>
  import('./components/modals/InfrastructureDirectoryModal').then(m => ({
    default: m.InfrastructureDirectoryModal
  }))
);
const QuickTourOverlay = lazy(() =>
  import('./components/modals/QuickTourOverlay').then(m => ({ default: m.QuickTourOverlay }))
);
const PackageImportModal = lazy(() =>
  import('./components/modals/PackageImportModal').then(m => ({ default: m.PackageImportModal }))
);
const BomStatisticsModal = lazy(() =>
  import('./components/modals/BomStatisticsModal').then(m => ({ default: m.BomStatisticsModal }))
);
const AboutModal = lazy(() =>
  import('./components/modals/AboutModal').then(m => ({ default: m.AboutModal }))
);
const ExcelTreeImportModal = lazy(() =>
  import('./components/modals/ExcelTreeImportModal').then(m => ({ default: m.ExcelTreeImportModal }))
);
const CADWorkspace = lazy(() =>
  import('./cad/components/CADWorkspace').then(m => ({ default: m.CADWorkspace }))
);
const CADImportDialog = lazy(() =>
  import('./cad/components/CADImportDialog').then(m => ({ default: m.CADImportDialog }))
);
const AdminPortal = lazy(() =>
  import('./admin/AdminPortal').then(m => ({ default: m.AdminPortal }))
);
import type { AdminCanvasDraftSession } from './admin/AdminPortal';

function isAdminLocationActive(): boolean {
  if (typeof window === 'undefined') return false;
  const { pathname, hash, search } = window.location;
  const active = pathname === '/admin' || hash === '#/admin';
  if (!active && (pathname.startsWith('/admin') || hash.startsWith('#/admin'))) {
    console.log('[AdminRouting][Conflict] URL starts with /admin but did not match exact /admin or #/admin', {
      pathname,
      hash,
      search,
      active
    });
  }
  return active;
}

type ProjectStore = ReturnType<typeof useProjectStore>;

export default function App() {
  const store = useProjectStore();
  return (
    <ViewportProvider defaultViewAllFloors={store.project.floors.length > 1}>
      <AppContent store={store} />
    </ViewportProvider>
  );
}

function AppContent({ store }: { store: ProjectStore }) {
  const viewport = useViewport();
  const workspaceShellRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLElement>(null);
  const layout = useWorkspaceLayout(workspaceShellRef);

  // Modals state
  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isBomModalOpen, setIsBomModalOpen] = useState(false);
  const [bomInitialTab, setBomInitialTab] = useState<BomTab>('devices');
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [isProjectHubOpen, setIsProjectHubOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutModalOpen, setIsShortcutModalOpen] = useState(false);
  const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);
  const [isQuickTourOpen, setIsQuickTourOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isExcelTreeModalOpen, setIsExcelTreeModalOpen] = useState(false);
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false);
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => isAdminLocationActive());
  const [adminCanvasDraft, setAdminCanvasDraft] = useState<AdminCanvasDraftSession | null>(null);
  const [pendingAdminCanvasDraft, setPendingAdminCanvasDraft] = useState<AdminCanvasDraftSession | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [narrowSubDrawer, setNarrowSubDrawer] = useState<'none' | 'draw' | 'more'>('none');
  const isOnline = useOnlineStatus();

  const { keymap, updateShortcut, swapShortcuts, resetSingleShortcut, resetShortcuts } = useShortcutKeymap();

  // Viewport & Layout modes (shared 2D/3D viewport state lives in ViewportContext)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(() => loadPanelCollapsed('left', false));
  const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(() =>
    loadPanelCollapsed('properties', false)
  );
  useEffect(() => {
    savePanelCollapsed('left', isLeftCollapsed);
  }, [isLeftCollapsed]);
  useEffect(() => {
    savePanelCollapsed('properties', isPropertiesCollapsed);
  }, [isPropertiesCollapsed]);
  const [activePresetId, setActivePresetId] = useState<WorkspacePresetId>(() => loadSavedWorkspacePresetId());
  const [requestedPropertiesTab, setRequestedPropertiesTab] = useState<
    { tab: 'inspector' | 'power'; nonce: number } | undefined
  >(undefined);
  const [isZenMode, setIsZenMode] = useState(false);
  const [isReadOnlyMode, setIsReadOnlyMode] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showBgMenu, setShowBgMenu] = useState(false);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [isQuickExporting, setIsQuickExporting] = useState(false);
  const [draggedPresetName, setDraggedPresetName] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [packagePreview, setPackagePreview] = useState<PackagePreviewInspection | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [recentActions, setRecentActions] = useState<RecentActionEntry[]>(() => loadRecentActions());
  const [deepInspectRackView, setDeepInspectRackView] = useState<'2d' | '3d'>('2d');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const packageFileInputRef = useRef<HTMLInputElement>(null);
  const fileDragDepthRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const focusLibraryTimerRef = useRef<number | null>(null);
  const splitterCleanupRef = useRef<(() => void) | null>(null);
  const prevTierRef = useRef(layout.layoutTier);
  const prevOrientationRef = useRef<'landscape' | 'portrait'>(
    layout.containerSize.width >= layout.containerSize.height ? 'landscape' : 'portrait'
  );
  const sheetDragStartRef = useRef<{ y: number; snap: BottomSheetSnap } | null>(null);

  const prevPerfModeRef = useRef(normalizeCanvasPerformanceMode(store.project.settings.canvasPerformanceMode));
  const { setView3DOptions } = viewport;
  const prevViewportProjectIdRef = useRef(store.project.id);
  useEffect(() => {
    if (prevViewportProjectIdRef.current !== store.project.id) {
      prevViewportProjectIdRef.current = store.project.id;
      setView3DOptions(prev => ({
        ...prev,
        viewAllFloors: store.project.floors.length > 1
      }));
    }
  }, [store.project.id, store.project.floors.length, setView3DOptions]);

  useEffect(() => {
    const nextMode = normalizeCanvasPerformanceMode(store.project.settings.canvasPerformanceMode);
    if (prevPerfModeRef.current === nextMode) return;
    prevPerfModeRef.current = nextMode;
    const policy = resolveCanvasPerformancePolicy(nextMode, {
      nodeCount: store.project.nodes.length,
      cableCount: store.project.cables.length,
      rackCount: store.project.racks.length,
      roomCount: store.project.rooms.length,
      trayCount: store.project.cableTrays?.length || 0,
      cadEntityCount: 0,
      zoom: store.zoom,
      isPanning: false
    });
    viewport.setView3DOptions(prev => ({
      ...prev,
      renderQuality: policy.threeRenderQuality,
      shadowsEnabled: policy.threeShadowsEnabled
    }));
  }, [
    store.project.settings.canvasPerformanceMode,
    store.project.nodes.length,
    store.project.cables.length,
    store.project.racks.length,
    store.project.rooms.length,
    store.project.cableTrays?.length,
    store.zoom,
    viewport.setView3DOptions
  ]);

  useEffect(() => {
    const syncRoute = (event?: Event) => {
      const nextActive = isAdminLocationActive();
      console.log('[AdminRouting] route event -> syncRoute', {
        eventType: event?.type || 'unknown',
        pathname: window.location.pathname,
        hash: window.location.hash,
        nextIsAdminRoute: nextActive
      });
      setIsAdminRoute(nextActive);
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      if (focusLibraryTimerRef.current !== null) {
        window.clearTimeout(focusLibraryTimerRef.current);
        focusLibraryTimerRef.current = null;
      }
      splitterCleanupRef.current?.();
      splitterCleanupRef.current = null;
    };
  }, []);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info', durationMs = 3500) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ text, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  const handleCadNotify = useCallback(
    (msg: string, type?: 'info' | 'success' | 'error') => showToast(msg, type || 'info', 2800),
    [showToast]
  );
  const cad = useCADController({
    project: store.project,
    onNotify: handleCadNotify,
    onSyncProjectScale: store.syncProjectScaleFromCad
  });

  const openDeepInspect = useCallback((id: string, rackView: '2d' | '3d' = '2d') => {
    setDeepInspectRackView(rackView);
    store.setDeepInspectId(id);
  }, [store]);

  const recordAction = useCallback((actionId: ReplayableActionId, customLabel?: string) => {
    setRecentActions(prev => {
      const next = pushRecentAction(prev, actionId, customLabel);
      saveRecentActions(next);
      return next;
    });
  }, []);

  const handleClearRecentActions = useCallback(() => {
    clearRecentActionsStorage();
    setRecentActions([]);
    showToast('Đã xóa lịch sử thao tác gần đây.', 'info', 2000);
  }, [showToast]);

  // Check AI assistant backend configuration once on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(res => {
        const contentType = res.headers.get('content-type') || '';
        return res.ok && contentType.includes('application/json') ? res.json() : null;
      })
      .then((data: { aiConfigured?: boolean } | null) => {
        if (!cancelled) {
          setAiConfigured(Boolean(data?.aiConfigured));
        }
      })
      .catch(() => {
        if (!cancelled) setAiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    trackVisit();
  }, []);

  const isAiAvailable = aiConfigured && isOnline;

  useEffect(() => {
    if (!isAiAvailable && isAiChatOpen) {
      setIsAiChatOpen(false);
    }
  }, [isAiAvailable, isAiChatOpen]);

  // Show 60-second onboarding tour once on first visit, or one-time What's New banner on upgrade
  useEffect(() => {
    if (store.showWelcomeModal) return;
    try {
      if (localStorage.getItem(QUICK_TOUR_STORAGE_KEY) !== '1') {
        const id = window.setTimeout(() => setIsQuickTourOpen(true), 250);
        return () => window.clearTimeout(id);
      }
      const seenVersionKey = 'hachihi_last_seen_version';
      if (localStorage.getItem(seenVersionKey) !== APP_VERSION) {
        const id = window.setTimeout(() => setShowWhatsNewModal(true), 300);
        return () => window.clearTimeout(id);
      }
    } catch {
      // ignore storage access issues
    }
  }, [store.showWelcomeModal]);

  // Sync dark mode class and native color-scheme onto <html> for modals, scrollbars, and charts
  useEffect(() => {
    const isDark = Boolean(store.project.settings.isDarkMode);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [store.project.settings.isDarkMode]);

  // Open mobile properties bottom sheet to half height when selecting an element
  useEffect(() => {
    if (layout.layoutTier === 'narrow') {
      if (store.selection.type !== 'none' && store.selection.type !== 'canvas' && store.selection.id) {
        if (layout.bottomSheetSnap === 'collapsed') {
          layout.setBottomSheetSnap('half');
        }
      }
    }
  }, [layout.layoutTier, store.selection.type, store.selection.id]);

  // Fit active design to actual visible canvas area
  const handleFitToScreen = useCallback(() => {
    const mode = store.project.activeMode;
    const floorId = store.project.activeFloorId;
    const rawVisNodes = store.project.nodes.filter(n => {
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(mode) && n.floorId && floorId && n.floorId !== floorId) {
        return false;
      }
      if (mode === 'topology' && n.diagramMode === 'rack') return false;
      if (mode === 'rack' && n.type !== 'rack') return false;
      return true;
    });
    const visNodes =
      mode === 'rack' ? layoutRackNodesForElevationMode(rawVisNodes, store.project.racks) : rawVisNodes;
    const visRooms = mode === 'rack' ? [] : store.project.rooms.filter(r => !floorId || r.floorId === floorId);

    if (visNodes.length === 0 && visRooms.length === 0) {
      store.setZoom(1);
      store.setPan({ x: 40, y: 40 });
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of visNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    for (const r of visRooms) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    const hostRect = canvasHostRef.current?.getBoundingClientRect();
    const viewW = Math.max(260, hostRect?.width || layout.containerSize.width);
    const viewH = Math.max(240, hostRect?.height || layout.containerSize.height - 100);
    const padding = layout.layoutTier === 'narrow' ? 32 : 56;
    const contentW = Math.max(120, maxX - minX);
    const contentH = Math.max(120, maxY - minY);

    const nextZoom = Math.min(1.35, Math.max(0.25, Math.min((viewW - padding * 2) / contentW, (viewH - padding * 2) / contentH)));
    const roundedZoom = Number(nextZoom.toFixed(2));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    store.setZoom(roundedZoom);
    store.setPan({
      x: Math.round(viewW / 2 - cx * roundedZoom),
      y: Math.round(viewH / 2 - cy * roundedZoom)
    });
  }, [store, layout.containerSize.width, layout.containerSize.height, layout.layoutTier]);

  // Auto-fit diagram gracefully on device rotation / layout tier change
  useEffect(() => {
    const orientation: 'landscape' | 'portrait' =
      layout.containerSize.width >= layout.containerSize.height ? 'landscape' : 'portrait';
    const tierChanged = prevTierRef.current !== layout.layoutTier;
    const orientationChanged = prevOrientationRef.current !== orientation;
    prevTierRef.current = layout.layoutTier;
    prevOrientationRef.current = orientation;

    if ((tierChanged || orientationChanged) && (store.project.nodes.length > 0 || store.project.rooms.length > 0)) {
      const id = window.setTimeout(() => {
        handleFitToScreen();
      }, 120);
      return () => window.clearTimeout(id);
    }
  }, [layout.layoutTier, layout.containerSize.width, layout.containerSize.height, handleFitToScreen, store.project.nodes.length, store.project.rooms.length]);

  // 2D Viewport Snapshot & Handlers registered into shared ViewportContext
  const getViewportSnapshot = useCallback(() => {
    const rect = canvasHostRef.current?.getBoundingClientRect();
    const fallbackW = Math.max(
      300,
      layout.containerSize.width - (layout.layoutTier === 'wide' ? layout.leftWidth + layout.rightWidth : 0)
    );
    const fallbackH = Math.max(240, layout.containerSize.height - 100);
    return {
      pan: store.pan,
      zoom: store.zoom,
      viewportSize: {
        w: Math.max(1, Math.round(rect?.width || fallbackW)),
        h: Math.max(1, Math.round(rect?.height || fallbackH))
      }
    };
  }, [
    store.pan,
    store.zoom,
    layout.containerSize.width,
    layout.containerSize.height,
    layout.layoutTier,
    layout.leftWidth,
    layout.rightWidth
  ]);

  const handleZoomIn2D = useCallback(() => {
    store.setZoom(Math.min(store.zoom + 0.15, 3.0));
  }, [store]);

  const handleZoomOut2D = useCallback(() => {
    store.setZoom(Math.max(store.zoom - 0.15, 0.2));
  }, [store]);

  const handleResetZoom2D = useCallback(() => {
    store.setZoom(1);
    store.setPan({ x: 50, y: 50 });
  }, [store]);

  useEffect(() => {
    viewport.update2DHandlers({
      zoomIn: handleZoomIn2D,
      zoomOut: handleZoomOut2D,
      resetZoom: handleResetZoom2D,
      fitToScreen: handleFitToScreen,
      getViewportSnapshot
    });
  }, [
    viewport.update2DHandlers,
    handleZoomIn2D,
    handleZoomOut2D,
    handleResetZoom2D,
    handleFitToScreen,
    getViewportSnapshot
  ]);

  // Delete current selected item(s) — supports multi-select nodes
  const handleDeleteSelected = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
      store.deleteNodes(allIds);
    } else if (store.selection.type === 'edge' && store.selection.id) {
      store.deleteCable(store.selection.id);
    } else if (store.selection.type === 'room' && store.selection.id) {
      store.deleteRoom(store.selection.id);
    } else if (store.selection.type === 'tray' && store.selection.id) {
      store.deleteCableTray(store.selection.id);
    } else if (store.selection.type === 'rack' && store.selection.id) {
      store.deleteRack(store.selection.id);
    }
  }, [store]);

  const handleUserFitToScreen = useCallback(() => {
    recordAction('fit_screen');
    viewport.fitToScreen();
  }, [recordAction, viewport]);

  // Auto-Route single & batch cable wrappers with feedback toast
  const handleAutoRouteCable = useCallback((cableId: string) => {
    store.autoRouteCable(cableId);
    showToast('Đã tự động định tuyến dây cáp tránh vật cản!', 'success', 2000);
  }, [store, showToast]);

  const handleAutoRouteAllCables = useCallback(() => {
    recordAction('auto_route_all');
    const activeCables = store.project.cables.filter(c => c.diagramMode === store.project.activeMode);
    if (activeCables.length > 15) {
      showToast(`Đang định tuyến ${activeCables.length} tuyến cáp trên luồng nền...`, 'info', 2000);
      void runBatchAutoRouteOffThread(store.project).then(updates => {
        if (updates.length > 0) {
          store.applyBatchCableRoutes(updates);
          showToast(`Đã Auto-Route thông minh ${updates.length} tuyến cáp tránh vật cản!`, 'success', 2600);
        } else {
          showToast('Không có tuyến cáp khả dụng trên chế độ/tầng hiện tại.', 'info', 2200);
        }
      });
      return;
    }

    const { routedCount } = store.autoRouteAllCables();
    if (routedCount > 0) {
      showToast(`Đã Auto-Route thông minh ${routedCount} tuyến cáp tránh vật cản!`, 'success', 2600);
    } else {
      showToast('Không có tuyến cáp khả dụng trên chế độ/tầng hiện tại.', 'info', 2200);
    }
  }, [recordAction, store, showToast]);

  const handleAutoAssignIps = useCallback(
    (options?: { preserveExistingValid?: boolean }) => {
      recordAction('auto_assign_ip');
      const res = store.autoAssignIps(options);
      if (!res.ok) {
        showToast(res.error || 'Không thể gán IP tự động.', 'error', 4000);
      } else if (res.totalAssignable === 0) {
        showToast('Chưa có thiết bị mạng nào cần gán IP trên sơ đồ.', 'info', 2600);
      } else {
        const suffix =
          res.unassignedCount > 0 ? ` (${res.unassignedCount} thiết bị thiếu IP do hết dải)` : '';
        showToast(
          `Đã gán ${res.assignedCount} IP mới${
            res.preservedCount > 0 ? `, giữ ${res.preservedCount} IP hợp lệ` : ''
          } theo topology (${res.cidrNotation})${suffix}!`,
          res.unassignedCount > 0 ? 'info' : 'success',
          3400
        );
      }
      return res;
    },
    [recordAction, store, showToast]
  );

  const handleQuickExportA4Pdf = useCallback(async () => {
    recordAction('export_pdf_a4');
    showToast(
      viewport.is3DView
        ? 'Đang chụp góc nhìn 3D hiện tại và xuất PDF A4...'
        : 'Đang kết xuất bản vẽ PDF A4 (giữ tỷ lệ & chú giải)...',
      'info',
      3000
    );
    try {
      const { ExportService } = await import('./services/export/exportService');
      const res = await ExportService.exportPdf(store.project, {
        contentScope: viewport.is3DView ? '3d' : '2d',
        paperSize: 'A4',
        orientation: 'landscape',
        drawingCode: 'NET-01',
        drawingScale: 'NTS',
        includeDiagram: true,
        includeLegendPanel: true,
        includeRackElevation: true,
        includeTables: true,
        background3D: 'light',
        capture3D: viewport.capture3DImage
      });
      showToast(
        `Đã xuất ${res.filename} (${res.pageCount} trang A4 · ${res.scaleMetrics.scaleRatioLabel})!`,
        'success',
        3200
      );
    } catch (err: unknown) {
      showToast(
        'Lỗi xuất PDF A4: ' + (err instanceof Error ? err.message : String(err)),
        'error',
        5000
      );
    }
  }, [recordAction, viewport.is3DView, viewport.capture3DImage, store.project, showToast]);

  const handleExportRouterTreeExcel = useCallback(async () => {
    try {
      const { exportProjectRouterTreeToExcel } = await import('./utils/excelTreeImporter');
      await exportProjectRouterTreeToExcel(store.project);
      recordAction('export_excel_tree');
      showToast('Đã xuất sơ đồ Cây Router Cha–Con (.xlsx) từ dự án hiện tại!', 'success', 3200);
    } catch (err: unknown) {
      showToast(
        'Không thể xuất cây Router Excel: ' + (err instanceof Error ? err.message : String(err)),
        'error',
        4200
      );
    }
  }, [store.project, recordAction, showToast]);

  const handleQuickExportViewPng = useCallback(async () => {
    if (isQuickExporting || viewport.isCapturing3D) return;
    setIsQuickExporting(true);
    try {
      const { ExportService } = await import('./services/export/exportService');
      const res = await ExportService.exportPng(store.project, {
        contentScope: viewport.is3DView ? '3d' : '2d',
        quickView: true,
        whiteBackground2D: true,
        background3D: 'light',
        viewport2D: getViewportSnapshot(),
        capture3D: viewport.capture3DImage
      });
      showToast(
        viewport.is3DView
          ? `Đã chụp nhanh ảnh PNG 3D (${res.exportedFiles[0]})!`
          : `Đã xuất nhanh ảnh PNG góc nhìn hiện tại (${res.exportedFiles[0]})!`,
        'success',
        2800
      );
    } catch (err: unknown) {
      showToast(
        'Lỗi xuất ảnh PNG: ' + (err instanceof Error ? err.message : String(err)),
        'error',
        4500
      );
    } finally {
      setIsQuickExporting(false);
    }
  }, [
    isQuickExporting,
    viewport.isCapturing3D,
    viewport.is3DView,
    viewport.capture3DImage,
    store.project,
    getViewportSnapshot,
    showToast
  ]);

  // Drag-resize handlers for Wide desktop sidebars
  const startSplitterDrag = useCallback(
    (side: 'left' | 'right', e: React.PointerEvent) => {
      e.preventDefault();
      splitterCleanupRef.current?.();
      const startX = e.clientX;
      const startW = side === 'left' ? layout.leftWidth : layout.rightWidth;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (side === 'left') {
          layout.setLeftWidth(startW + dx);
        } else {
          layout.setRightWidth(startW - dx);
        }
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        if (splitterCleanupRef.current === cleanup) {
          splitterCleanupRef.current = null;
        }
      };
      splitterCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    },
    [layout]
  );

  // Center of viewport in canvas coordinates for quick addition
  const canvasCenter = useMemo(
    () => ({
      x: Math.round((-store.pan.x + (canvasHostRef.current?.clientWidth || 720) * 0.45) / store.zoom),
      y: Math.round((-store.pan.y + (canvasHostRef.current?.clientHeight || 480) * 0.45) / store.zoom)
    }),
    [store.pan.x, store.pan.y, store.zoom]
  );

  // Customizable Global Keyboard Shortcuts
  const shortcutHandlers = useMemo(
    () => ({
      tool_select: () => {
        if (viewport.is3DView && viewport.is3DDragLocked) return;
        store.setActiveTool('select');
      },
      tool_pan: () => {
        if (viewport.is3DView && viewport.is3DDragLocked) return;
        store.setActiveTool('pan');
      },
      tool_connect: () => {
        if (viewport.is3DView && viewport.is3DDragLocked) return;
        store.setActiveTool('connect');
      },
      tool_rack: () => {
        if (isReadOnlyMode) {
          showToast('Đang ở chế độ Chỉ xem — hãy tắt Chỉ xem để thêm tủ Rack.', 'info', 2200);
          return;
        }
        if (viewport.is3DView && viewport.is3DDragLocked) {
          showToast('Mở khóa kéo 3D ở thanh điều khiển để thêm Tủ Rack mới.', 'info', 2200);
          return;
        }
        const offset = (store.project.racks.length % 5) * 32;
        store.addRack('Tủ Server Rack 42U', 42, canvasCenter.x + offset, canvasCenter.y + offset);
        recordAction('add_rack');
        showToast('Đã thêm Tủ Server Rack 42U vào bản vẽ!', 'success', 2000);
      },
      tool_text: () => {
        if (viewport.is3DView) return;
        store.setActiveTool('text');
        showToast('Nhấp lên bản vẽ để đặt ghi chú văn bản', 'info', 1800);
      },
      tool_room: () => {
        if (viewport.is3DView) return;
        store.setActiveTool('room');
      },
      tool_tray: () => {
        if (viewport.is3DView) return;
        store.setActiveTool('tray');
        showToast('Nhấp từng điểm để vẽ máng cáp (Enter/Nhấp đúp để hoàn tất)', 'info', 2400);
      },
      tool_measure: () => {
        if (viewport.is3DView) return;
        store.setActiveTool('measure');
        showToast('Kéo trên bản vẽ để đo khoảng cách thực tế (m / px)', 'info', 2000);
      },
      action_legend: () => {
        if (viewport.is3DView) return;
        store.generateOrUpdateLegendNode();
        recordAction('generate_legend');
        showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2200);
      },
      auto_route: () => {
        if (isReadOnlyMode) {
          showToast('Đang ở chế độ Chỉ xem — hãy tắt Chỉ xem để tự định tuyến cáp.', 'info', 2200);
          return;
        }
        handleAutoRouteAllCables();
      },
      auto_assign_ip: () => {
        if (isReadOnlyMode) {
          showToast('Đang ở chế độ Chỉ xem — hãy tắt Chỉ xem để gán IP tự động.', 'info', 2200);
          return;
        }
        handleAutoAssignIps({ preserveExistingValid: true });
      },
      export_project: () => {
        recordAction('open_export');
        setIsExportModalOpen(true);
      },
      undo: () => {
        if (store.historyIndex > 0) {
          recordAction('undo');
          store.undo();
        }
      },
      redo: () => {
        if (store.historyIndex < store.history.length - 1) {
          recordAction('redo');
          store.redo();
        }
      },
      duplicate: () => {
        if (store.selection.type === 'node' && store.selection.id) {
          const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
          store.duplicateNodes(allIds);
          showToast(`Đã nhân bản ${allIds.length} thiết bị`, 'info', 1800);
        }
      },
      save: () => {
        recordAction('save_now');
        void store.markSaved().then(() => {
          showToast('Đã lưu dự án vào IndexedDB!', 'success', 2200);
        });
      },
      delete: () => {
        if (store.selection.type !== 'none') {
          handleDeleteSelected();
        }
      },
      select_all: () => {
        const mode = store.project.activeMode;
        const floorId = store.project.activeFloorId;
        const visibleIds = store.project.nodes
          .filter(n => {
            if (n.hidden) return false;
            if (n.type === 'rack') return false;
            if (mode === 'rack') return false;
            if (mode === 'topology' && n.diagramMode === 'rack') return false;
            if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(mode) && n.floorId && floorId && n.floorId !== floorId) {
              return false;
            }
            return true;
          })
          .map(n => n.id);
        if (visibleIds.length > 0) {
          store.selectMultipleNodes(visibleIds);
        }
      },
      group: () => {
        if (store.selection.type === 'node' && store.selection.id) {
          const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
          if (allIds.length >= 2) {
            store.groupNodes(allIds);
            showToast(`Đã nhóm ${allIds.length} đối tượng`, 'info', 1800);
          }
        }
      },
      ungroup: () => {
        if (store.selection.type === 'node' && store.selection.id) {
          const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
          store.ungroupNodes(allIds);
          showToast('Đã tách nhóm đối tượng', 'info', 1800);
        }
      },
      zoom_in: () => viewport.zoomIn(),
      zoom_out: () => viewport.zoomOut(),
      zoom_reset: () => viewport.resetZoom(),
      command_palette: () => setIsCommandPaletteOpen(prev => !prev),
      onEscape: () => {
        if (isShortcutModalOpen) {
          setIsShortcutModalOpen(false);
        } else if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
        } else if (layout.activeDrawer !== 'none') {
          layout.setActiveDrawer('none');
        } else if (store.connectingSource) {
          store.setConnectingSource(null);
        } else if (store.activeTool !== 'select') {
          store.setActiveTool('select');
        } else {
          store.clearSelection();
        }
      }
    }),
    [
      store,
      viewport,
      canvasCenter.x,
      canvasCenter.y,
      handleDeleteSelected,
      handleAutoRouteAllCables,
      handleAutoAssignIps,
      isReadOnlyMode,
      showToast,
      recordAction,
      isCommandPaletteOpen,
      isShortcutModalOpen,
      layout
    ]
  );

  useKeyboardShortcuts(keymap, shortcutHandlers, isShortcutModalOpen);

  // Jump to node from TopBar search or Command Palette
  const handleJumpToNode = useCallback((nodeId: string) => {
    const target = store.project.nodes.find(n => n.id === nodeId);
    if (!target) return;

    if (viewport.is3DView) {
      viewport.setMode('2d');
    }
    if (target.floorId && target.floorId !== store.project.activeFloorId) {
      store.setActiveFloor(target.floorId);
    }
    if (target.diagramMode && target.diagramMode !== store.project.activeMode) {
      store.setDesignMode(target.diagramMode);
    }

    const hostRect = canvasHostRef.current?.getBoundingClientRect();
    const viewportW = hostRect?.width || Math.max(300, layout.containerSize.width - (layout.layoutTier === 'wide' ? layout.leftWidth + layout.rightWidth : 0));
    const viewportH = hostRect?.height || Math.max(240, layout.containerSize.height - 100);
    const targetPanX = Math.round(viewportW / 2 - (target.x + target.width / 2) * store.zoom);
    const targetPanY = Math.round(viewportH / 2 - (target.y + target.height / 2) * store.zoom);
    store.setPan({ x: targetPanX, y: targetPanY });

    if (target.type === 'rack' && target.customData?.rackId) {
      store.selectItem('rack', target.customData.rackId);
    } else {
      store.selectItem('node', target.id);
    }
  }, [store, viewport, layout.containerSize.height, layout.containerSize.width, layout.layoutTier, layout.leftWidth, layout.rightWidth]);

  const auditReport = useAsyncEngineeringAudit(store.project, 140);

  const handleNavigateToAuditTarget = useCallback((targetType: AuditIssue['targetType'], targetId: string) => {
    if (targetType === 'node') {
      handleJumpToNode(targetId);
      return;
    }

    if (viewport.is3DView) {
      viewport.setMode('2d');
    }

    const hostRect = canvasHostRef.current?.getBoundingClientRect();
    const viewportW = hostRect?.width || Math.max(300, layout.containerSize.width - (layout.layoutTier === 'wide' ? layout.leftWidth + layout.rightWidth : 0));
    const viewportH = hostRect?.height || Math.max(240, layout.containerSize.height - 100);

    if (targetType === 'edge') {
      const edge = store.project.cables.find(c => c.id === targetId);
      if (edge) {
        const srcNode = store.project.nodes.find(n => n.id === edge.sourceNodeId);
        const dstNode = store.project.nodes.find(n => n.id === edge.targetNodeId);
        const anchorNode = srcNode || dstNode;
        if (anchorNode?.floorId && anchorNode.floorId !== store.project.activeFloorId) {
          store.setActiveFloor(anchorNode.floorId);
        }
        if (anchorNode?.diagramMode && anchorNode.diagramMode !== store.project.activeMode) {
          store.setDesignMode(anchorNode.diagramMode);
        }
        if (srcNode && dstNode) {
          const midX = (srcNode.x + srcNode.width / 2 + dstNode.x + dstNode.width / 2) / 2;
          const midY = (srcNode.y + srcNode.height / 2 + dstNode.y + dstNode.height / 2) / 2;
          store.setPan({
            x: Math.round(viewportW / 2 - midX * store.zoom),
            y: Math.round(viewportH / 2 - midY * store.zoom)
          });
        } else if (anchorNode) {
          store.setPan({
            x: Math.round(viewportW / 2 - (anchorNode.x + anchorNode.width / 2) * store.zoom),
            y: Math.round(viewportH / 2 - (anchorNode.y + anchorNode.height / 2) * store.zoom)
          });
        }
      }
      store.selectItem('edge', targetId);
      return;
    }

    if (targetType === 'rack') {
      const rackNode = store.project.nodes.find(
        n => n.customData?.rackId === targetId || n.id === targetId
      );
      if (rackNode) {
        if (rackNode.floorId && rackNode.floorId !== store.project.activeFloorId) {
          store.setActiveFloor(rackNode.floorId);
        }
        if (rackNode.diagramMode && rackNode.diagramMode !== store.project.activeMode) {
          store.setDesignMode(rackNode.diagramMode);
        }
        store.setPan({
          x: Math.round(viewportW / 2 - (rackNode.x + rackNode.width / 2) * store.zoom),
          y: Math.round(viewportH / 2 - (rackNode.y + rackNode.height / 2) * store.zoom)
        });
      }
      store.selectItem('rack', targetId);
    }
  }, [handleJumpToNode, store, viewport, layout.containerSize.height, layout.containerSize.width, layout.layoutTier, layout.leftWidth, layout.rightWidth]);

  // Handle direct Excel upload from toolbar using lazy import for ExcelJS splitting
  const handleExcelQuickUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { parseExcelDevices } = await import('./utils/excelService');
      const result = await parseExcelDevices(file, store.project);
      store.updateProject(prev => ({
        ...prev,
        assets: result.newAssets,
        nodes: result.newNodes,
        racks: result.updatedRacks
      }));
      showToast(`Đã nhập ${result.importedCount ?? Object.keys(result.newAssets).length} thiết bị từ Excel!`, 'success');
    } catch (err: unknown) {
      showToast('Lỗi nhập Excel: ' + (err instanceof Error ? err.message : String(err)), 'error', 5000);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle NetworkScanner CSV/JSON import from ProjectHubModal
  const handleImportScannerFile = useCallback(async (file: File, options?: { diffMerge?: boolean }) => {
    const { checkImportPayloadSize, MAX_SCANNER_FILE_BYTES } = await import('./utils/security');
    const sizeCheck = checkImportPayloadSize(file, MAX_SCANNER_FILE_BYTES, file.name);
    if (!sizeCheck.ok) {
      throw new Error(sizeCheck.error);
    }
    const text = await file.text();
    if (options?.diffMerge && Object.keys(store.project.assets).length > 0) {
      const res = diffMergeNetworkScannerData(text, store.project);
      store.updateProject(prev => ({
        ...prev,
        assets: res.assets,
        nodes: res.nodes,
        cables: res.cables
      }));
      showToast(
        `Đã đối chiếu NetworkScanner: ${res.addedCount} mới, ${res.updatedCount} cập nhật, ${res.unchangedCount} giữ nguyên.`,
        'success'
      );
      return;
    }
    const res = importNetworkScannerData(text, store.project);
    store.updateProject(prev => ({
      ...prev,
      assets: res.assets,
      nodes: res.nodes,
      cables: res.cables
    }));
    showToast(`Đã nhập ${res.importedCount} thiết bị & tự nối sơ đồ từ NetworkScanner!`, 'success');
  }, [store, showToast]);

  // Unified handler for `.hachihi.json` project packages, raw project JSON, or workspace bundles
  const handleRequestPackageImport = useCallback(
    async (file: File) => {
      try {
        const { checkImportPayloadSize, MAX_IMPORT_JSON_BYTES } = await import('./utils/security');
        const sizeCheck = checkImportPayloadSize(file, MAX_IMPORT_JSON_BYTES, file.name);
        if (!sizeCheck.ok) {
          showToast(sizeCheck.error, 'error', 5000);
          return;
        }
        const text = await file.text();
        const inspection = await inspectProjectImportPayload(text, store.projectList, file.name);
        if (!inspection.ok) {
          showToast(inspection.error, 'error', 5000);
          return;
        }
        if (inspection.kind === 'workspace_bundle') {
          let importedCount = 0;
          for (const proj of inspection.projects) {
            const res = store.importValidatedProject(proj);
            if (res.ok) importedCount++;
          }
          if (importedCount > 0) {
            const failNote =
              inspection.failedCount > 0 ? ` (${inspection.failedCount} mục lỗi bị bỏ qua)` : '';
            showToast(
              `Đã khôi phục ${importedCount}/${inspection.projects.length} dự án từ gói sao lưu${failNote}!`,
              'success',
              4500
            );
          } else {
            showToast('Không thể nhập dự án nào từ gói sao lưu này.', 'error', 5000);
          }
          return;
        }
        setPackagePreview(inspection);
      } catch (err: unknown) {
        showToast(
          'Không thể đọc tệp gói dự án: ' + (err instanceof Error ? err.message : String(err)),
          'error',
          5000
        );
      }
    },
    [store, showToast]
  );

  const handlePackageQuickUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      await handleRequestPackageImport(file);
    },
    [handleRequestPackageImport]
  );

  // Global drag-and-drop support for `.hachihi.json` / `.json` files (without interfering with device catalog drag)
  useEffect(() => {
    const hasFilesTransfer = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types || []).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      e.preventDefault();
      fileDragDepthRef.current += 1;
      setIsFileDragOver(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) {
        setIsFileDragOver(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      e.preventDefault();
      fileDragDepthRef.current = 0;
      setIsFileDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      const cadFile = files.find(f => /\.(dxf|dwg)$/i.test(f.name));
      if (cadFile) {
        cad.openImportDialog(cadFile);
        return;
      }
      const target = files.find(f => /\.(hachihi\.json|json)$/i.test(f.name));
      if (!target) {
        showToast('Chỉ hỗ trợ kéo thả .hachihi.json, .json hoặc bản vẽ AutoCAD (.dxf / .dwg).', 'info', 3500);
        return;
      }
      void handleRequestPackageImport(target);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleRequestPackageImport, showToast, cad.openImportDialog]);

  // PWA File Handling API: open `.hachihi.json` files directly via OS double-click when installed
  useEffect(() => {
    const win = window as WindowWithLaunchQueue;
    if (!win.launchQueue?.setConsumer) return;
    win.launchQueue.setConsumer(async (launchParams: LaunchParamsLike) => {
      const handles = launchParams?.files;
      if (!handles || handles.length === 0) return;
      const targetHandle =
        handles.find(h => typeof h.name === 'string' && /\.(hachihi\.json|json)$/i.test(h.name)) ||
        handles[0];
      if (!targetHandle?.getFile) return;
      try {
        const file = await targetHandle.getFile();
        await handleRequestPackageImport(file);
      } catch {
        showToast('Không thể mở tệp được truyền từ hệ điều hành.', 'error', 4000);
      }
    });
  }, [handleRequestPackageImport, showToast]);



  const handleAutoLayerDevices = useCallback(() => {
    if (isReadOnlyMode) return;
    recordAction('auto_layer');
    const summary = store.autoAssignDeviceLayers();
    if (summary.updatedCount > 0) {
      showToast(
        `Đã phân lớp ${summary.updatedCount} đối tượng (${summary.counts.network} Network, ${summary.counts.iot} IoT, ${summary.counts.electrical} Điện).`,
        'success',
        3400
      );
    } else {
      showToast('Tất cả thiết bị đã nằm đúng lớp Network / IoT / Điện.', 'info', 2600);
    }
  }, [isReadOnlyMode, recordAction, store, showToast]);

  const handleSelectLayerObjects = useCallback(
    (layerId: CanvasLayerId) => {
      const resolved = resolveSelectableTargetForLayer(store.project, layerId);
      const layerLabel = LAYER_CATALOG.find(item => item.id === layerId)?.label || layerId;
      if (resolved.type === 'none') {
        showToast(`Không có đối tượng hiển thị nào thuộc lớp "${layerLabel}".`, 'info', 2200);
        return;
      }
      if (resolved.type === 'node' && resolved.id) {
        const allIds = [resolved.id, ...(resolved.additionalIds || [])];
        if (allIds.length > 1) {
          store.selectMultipleNodes(allIds);
        } else {
          store.selectItem('node', resolved.id);
        }
        showToast(`Đã chọn ${allIds.length} đối tượng thuộc lớp "${layerLabel}".`, 'info', 2000);
        return;
      }
      if (resolved.id) {
        store.selectItem(resolved.type, resolved.id);
        showToast(`Đã chọn đối tượng đại diện thuộc lớp "${layerLabel}".`, 'info', 2000);
      }
    },
    [store, showToast]
  );

  const handleGenerateLegend = useCallback(() => {
    store.generateOrUpdateLegendNode();
    recordAction('generate_legend');
    showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2400);
  }, [store, recordAction, showToast]);

  const handleSaveNow = useCallback(() => {
    recordAction('save_now');
    void store.markSaved().then(() => {
      showToast('Đã lưu dự án vào IndexedDB!', 'success', 2200);
    });
  }, [recordAction, store, showToast]);

  const handleUndo = useCallback(() => {
    if (store.historyIndex > 0) {
      recordAction('undo');
      store.undo();
    }
  }, [recordAction, store]);

  const handleRedo = useCallback(() => {
    if (store.historyIndex < store.history.length - 1) {
      recordAction('redo');
      store.redo();
    }
  }, [recordAction, store]);

  const handleDuplicateSelected = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
      store.duplicateNodes(allIds);
      showToast(`Đã nhân bản ${allIds.length} thiết bị`, 'info', 1800);
    }
  }, [store, showToast]);

  const handleSelectAll = useCallback(() => {
    const mode = store.project.activeMode;
    const floorId = store.project.activeFloorId;
    const visibleIds = store.project.nodes
      .filter(n => {
        if (n.hidden) return false;
        if (n.type === 'rack') return false;
        if (mode === 'rack') return false;
        if (mode === 'topology' && n.diagramMode === 'rack') return false;
        if (
          ['floorplan', 'cctv', 'wifi', 'fiber'].includes(mode) &&
          n.floorId &&
          floorId &&
          n.floorId !== floorId
        ) {
          return false;
        }
        return true;
      })
      .map(n => n.id);
    if (visibleIds.length > 0) {
      store.selectMultipleNodes(visibleIds);
    }
  }, [store]);

  const handleCopySelectedStyle = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      if (store.copyNodeStyle(store.selection.id)) {
        showToast('Đã sao chép kiểu đối tượng!', 'info', 1800);
      }
    }
  }, [store, showToast]);

  const handlePasteSelectedStyle = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
      if (store.pasteNodeStyle(allIds)) {
        showToast('Đã dán kiểu cho đối tượng!', 'success', 1800);
      }
    }
  }, [store, showToast]);

  const handleFocusDeviceLibrary = useCallback(() => {
    if (layout.layoutTier === 'wide') {
      setIsLeftCollapsed(false);
    } else {
      layout.setActiveDrawer('library');
    }
    if (focusLibraryTimerRef.current !== null) {
      window.clearTimeout(focusLibraryTimerRef.current);
    }
    focusLibraryTimerRef.current = window.setTimeout(() => {
      focusLibraryTimerRef.current = null;
      window.dispatchEvent(new CustomEvent('hachihi:focus-library'));
    }, 60);
  }, [layout]);

  const handleToggle3D = useCallback(() => {
    recordAction('toggle_3d');
    viewport.toggleMode();
  }, [recordAction, viewport]);

  const handleToggleTheme = useCallback(() => {
    recordAction('toggle_theme');
    store.updateSettings({ isDarkMode: !store.project.settings.isDarkMode });
  }, [recordAction, store]);

  const handleToggleGrid = useCallback(() => {
    store.updateSettings({ showGrid: !store.project.settings.showGrid });
  }, [store]);

  const handleToggleSnap = useCallback(() => {
    store.updateSettings({ snapToGrid: !store.project.settings.snapToGrid });
  }, [store]);

  const handleApplyWorkspacePreset = useCallback(
    (presetId: WorkspacePresetId) => {
      saveWorkspacePresetId(presetId);
      setActivePresetId(presetId);
      const preset = getWorkspacePresetMeta(presetId);
      if (preset.targetMode && preset.targetMode !== store.project.activeMode) {
        viewport.setMode('2d');
        store.setDesignMode(preset.targetMode);
      }
      const nextHiddenLayers = computeNextHiddenLayersForPreset(
        store.project.settings.hiddenLayers,
        preset
      );
      store.updateSettings({
        hiddenLayers: nextHiddenLayers,
        ...(typeof preset.showGrid === 'boolean' ? { showGrid: preset.showGrid } : {}),
        ...(typeof preset.showIpAddresses === 'boolean' ? { showIpAddresses: preset.showIpAddresses } : {}),
        ...(typeof preset.showCableCodes === 'boolean' ? { showCableCodes: preset.showCableCodes } : {})
      });
      setIsLeftCollapsed(preset.leftCollapsed);
      setIsPropertiesCollapsed(preset.rightCollapsed);
      setRequestedPropertiesTab({ tab: preset.preferredRightTab, nonce: Date.now() });
      showToast(`Đã áp dụng bố cục "${preset.label}"`, 'info', 2200);
    },
    [store, viewport, showToast]
  );

  const handleAddRack = useCallback(
    (rackName = 'Tủ Server Rack 42U') => {
      recordAction('add_rack');
      store.addRack(rackName);
    },
    [recordAction, store]
  );

  const openAuditModal = useCallback(() => {
    recordAction('open_audit');
    setIsAuditModalOpen(true);
  }, [recordAction]);

  const openBomModal = useCallback((tab?: BomTab | unknown) => {
    const nextTab: BomTab = typeof tab === 'string' ? (tab as BomTab) : 'devices';
    setBomInitialTab(nextTab);
    recordAction('open_bom');
    setIsBomModalOpen(true);
  }, [recordAction]);

  const openBomSubnetsTab = useCallback(() => {
    openBomModal('subnets');
  }, [openBomModal]);

  const openExportModal = useCallback(() => {
    recordAction('open_export');
    setIsExportModalOpen(true);
  }, [recordAction]);

  const openExcelTreeModal = useCallback(() => {
    recordAction('open_excel_tree');
    setIsExcelTreeModalOpen(true);
  }, [recordAction]);

  const openTemplateModal = useCallback(() => {
    recordAction('open_templates');
    setIsTemplateModalOpen(true);
  }, [recordAction]);

  const openBuildingModal = useCallback(() => {
    recordAction('open_building');
    setIsBuildingModalOpen(true);
  }, [recordAction]);

  const openGuideModal = useCallback(() => {
    recordAction('open_guide');
    setIsGuideModalOpen(true);
  }, [recordAction]);

  const openShortcutsModal = useCallback(() => {
    recordAction('open_shortcuts');
    setIsShortcutModalOpen(true);
  }, [recordAction]);

  const openDirectoryModal = useCallback(() => {
    recordAction('open_directory');
    setIsDirectoryOpen(true);
  }, [recordAction]);

  const replayRecentAction = useCallback(
    (entry: RecentActionEntry) => {
      switch (entry.id) {
        case 'auto_route_all':
          handleAutoRouteAllCables();
          break;
        case 'fit_screen':
          handleUserFitToScreen();
          break;
        case 'generate_legend':
          handleGenerateLegend();
          break;
        case 'auto_assign_ip':
          handleAutoAssignIps({ preserveExistingValid: true });
          break;
        case 'auto_layer':
          handleAutoLayerDevices();
          break;
        case 'open_audit':
          openAuditModal();
          break;
        case 'open_bom':
          openBomModal();
          break;
        case 'open_export':
          openExportModal();
          break;
        case 'export_pdf_a4':
          void handleQuickExportA4Pdf();
          break;
        case 'open_excel_tree':
          openExcelTreeModal();
          break;
        case 'export_excel_tree':
          void handleExportRouterTreeExcel();
          break;
        case 'toggle_3d':
          handleToggle3D();
          break;
        case 'toggle_theme':
          handleToggleTheme();
          break;
        case 'add_rack':
          handleAddRack();
          break;
        case 'open_directory':
          openDirectoryModal();
          break;
        case 'open_shortcuts':
          openShortcutsModal();
          break;
        case 'open_guide':
          openGuideModal();
          break;
        case 'open_templates':
          openTemplateModal();
          break;
        case 'open_building':
          openBuildingModal();
          break;
        case 'save_now':
          handleSaveNow();
          break;
        case 'undo':
          handleUndo();
          break;
        case 'redo':
          handleRedo();
          break;
      }
    },
    [
      handleAutoRouteAllCables,
      handleUserFitToScreen,
      handleGenerateLegend,
      handleAutoAssignIps,
      handleAutoLayerDevices,
      openAuditModal,
      openBomModal,
      openExportModal,
      handleQuickExportA4Pdf,
      openExcelTreeModal,
      handleExportRouterTreeExcel,
      handleToggle3D,
      handleToggleTheme,
      handleAddRack,
      openDirectoryModal,
      openShortcutsModal,
      openGuideModal,
      openTemplateModal,
      openBuildingModal,
      handleSaveNow,
      handleUndo,
      handleRedo
    ]
  );

  const handleSelectCable = useCallback(
    (cableId: string) => store.selectItem('edge', cableId),
    [store]
  );

  const handleUpdateFloor = useCallback(
    (flId: string, partial: Partial<ProjectState['floors'][number]>) => {
      store.updateProject(prev => ({
        ...prev,
        floors: prev.floors.map(f => (f.id === flId ? { ...f, ...partial } : f))
      }));
    },
    [store]
  );

  const handleDuplicateProject = useCallback(() => {
    void store.duplicateProject().then(() => {
      showToast('Đã nhân bản thành dự án mới!', 'success');
    });
  }, [store, showToast]);

  const handleCopyNodeStyleById = useCallback(
    (id: string) => {
      if (store.copyNodeStyle(id)) {
        showToast('Đã sao chép kiểu đối tượng!', 'info', 1800);
      }
    },
    [store, showToast]
  );

  const handlePasteNodeStyleByIds = useCallback(
    (ids: string[]) => {
      if (store.pasteNodeStyle(ids)) {
        showToast('Đã dán kiểu cho đối tượng!', 'success', 1800);
      }
    },
    [store, showToast]
  );

  const handleTogglePropertiesCollapse = useCallback(() => {
    setIsPropertiesCollapsed(prev => !prev);
  }, []);

  const handleOpenPowerTab = useCallback(() => {
    setIsPropertiesCollapsed(false);
    setRequestedPropertiesTab({ tab: 'power', nonce: Date.now() });
  }, []);

  const handleAutoAssignIpsPreserve = useCallback(
    () => handleAutoAssignIps({ preserveExistingValid: true }),
    [handleAutoAssignIps]
  );

  const handleOpenProjectHub = useCallback(() => setIsProjectHubOpen(true), []);
  const handleOpenQuickTour = useCallback(() => setIsQuickTourOpen(true), []);
  const handleOpenAbout = useCallback(() => setIsAboutModalOpen(true), []);
  const handleOpenCommandPalette = useCallback(() => setIsCommandPaletteOpen(true), []);
  const openAdminPortal = useCallback(() => {
    const before =
      typeof window !== 'undefined'
        ? { pathname: window.location.pathname, hash: window.location.hash }
        : null;
    if (typeof window !== 'undefined' && !isAdminLocationActive()) {
      window.history.pushState({}, '', '/admin');
    }
    console.log('[AdminRouting] openAdminPortal', {
      before,
      after:
        typeof window !== 'undefined'
          ? { pathname: window.location.pathname, hash: window.location.hash }
          : null
    });
    setIsAdminRoute(true);
  }, []);
  const closeAdminPortal = useCallback(() => {
    const before =
      typeof window !== 'undefined'
        ? { pathname: window.location.pathname, hash: window.location.hash }
        : null;
    if (typeof window !== 'undefined' && isAdminLocationActive()) {
      window.history.pushState({}, '', '/');
    }
    console.log('[AdminRouting] closeAdminPortal', {
      before,
      after:
        typeof window !== 'undefined'
          ? { pathname: window.location.pathname, hash: window.location.hash }
          : null
    });
    setIsAdminRoute(false);
  }, []);
  const handleEditTemplateInCanvas = useCallback(
    (draft: AdminCanvasDraftSession) => {
      setAdminCanvasDraft(draft);
      setPendingAdminCanvasDraft(null);
      void store.enterAdminTemplateEdit(draft.project);
      if (typeof window !== 'undefined' && isAdminLocationActive()) {
        window.history.pushState({}, '', '/');
      }
      setIsAdminRoute(false);
      showToast(`Đang mở mẫu "${draft.manifest.name}" trên Canvas để chỉnh sửa.`, 'info', 3600);
    },
    [store, showToast]
  );
  const handleReturnAdminCanvasToPortal = useCallback(() => {
    if (adminCanvasDraft) {
      setPendingAdminCanvasDraft({
        ...adminCanvasDraft,
        project: structuredClone(store.project),
        preview: null
      });
    }
    setAdminCanvasDraft(null);
    store.exitAdminTemplateEdit();
    openAdminPortal();
  }, [adminCanvasDraft, store, openAdminPortal]);
  const handleCancelAdminCanvasEdit = useCallback(() => {
    setAdminCanvasDraft(null);
    setPendingAdminCanvasDraft(null);
    store.exitAdminTemplateEdit();
    openAdminPortal();
  }, [store, openAdminPortal]);
  const handleAddStandardRack = useCallback(() => handleAddRack('Tủ Server Rack 42U'), [handleAddRack]);
  const handleAddIdfRack = useCallback(() => handleAddRack('Tủ Rack Phân Phối IDF'), [handleAddRack]);

  const handleNewProject = useCallback(() => {
    void store.resetCanvas().then(() => {
      showToast('Đã tạo bản vẽ trống mới', 'info');
    });
  }, [store, showToast]);

  const handleOpenJsonOrPackageImport = useCallback(() => {
    packageFileInputRef.current?.click();
  }, []);

  const handleToggleAiChat = useCallback(() => setIsAiChatOpen(v => !v), []);

  const handleShowToast2800 = useCallback(
    (msg: string, type?: 'success' | 'error' | 'info') => showToast(msg, type || 'info', 2800),
    [showToast]
  );

  const handleExportA4PdfAction = useCallback(() => {
    void handleQuickExportA4Pdf();
  }, [handleQuickExportA4Pdf]);

  const handleToggleLeftDrawer = useCallback(() => {
    setNarrowSubDrawer('none');
    layout.setActiveDrawer(d => (d === 'library' ? 'none' : 'library'));
  }, [layout]);

  const handleToggleRightDrawer = useCallback(() => {
    setNarrowSubDrawer('none');
    if (layout.layoutTier === 'narrow') {
      layout.setBottomSheetSnap(s => (s === 'collapsed' ? 'half' : 'collapsed'));
    } else {
      layout.setActiveDrawer(d => (d === 'properties' ? 'none' : 'properties'));
    }
  }, [layout]);

  const handleToggleCoverageOverlay = useCallback(() => {
    store.updateSettings({ showCoverageRadius: !store.project.settings.showCoverageRadius });
  }, [store]);

  const handleToggleReadOnly = useCallback(() => setIsReadOnlyMode(v => !v), []);

  const handleAddDeviceAt = useCallback(
    (presetName: string, x?: number, y?: number) => {
      store.addDeviceFromCatalog(presetName, x, y);
    },
    [store]
  );

  const handleAddCustomDeviceAt = useCallback(
    (preset: Parameters<typeof store.addCustomDevicePresetToCanvas>[0], x?: number, y?: number) => {
      store.addCustomDevicePresetToCanvas(preset, x, y);
    },
    [store]
  );

  const handleAddTextNodeAt = useCallback(
    (x?: number, y?: number) => {
      store.addTextNode(x, y);
    },
    [store]
  );

  const handleAddShapeNodeAt = useCallback(
    (kind: Parameters<typeof store.addShapeNode>[0], x?: number, y?: number) => {
      store.addShapeNode(kind, x, y);
    },
    [store]
  );

  const handleDrawerAddDeviceAt = useCallback(
    (presetName: string, x?: number, y?: number) => {
      store.addDeviceFromCatalog(presetName, x, y);
      layout.setActiveDrawer('none');
    },
    [store, layout]
  );

  const handleDrawerAddCustomDeviceAt = useCallback(
    (preset: Parameters<typeof store.addCustomDevicePresetToCanvas>[0], x?: number, y?: number) => {
      store.addCustomDevicePresetToCanvas(preset, x, y);
      layout.setActiveDrawer('none');
    },
    [store, layout]
  );

  const handleDrawerAddTextNodeAt = useCallback(
    (x?: number, y?: number) => {
      store.addTextNode(x, y);
      layout.setActiveDrawer('none');
    },
    [store, layout]
  );

  const handleDrawerAddShapeNodeAt = useCallback(
    (kind: Parameters<typeof store.addShapeNode>[0], x?: number, y?: number) => {
      store.addShapeNode(kind, x, y);
      layout.setActiveDrawer('none');
    },
    [store, layout]
  );

  const handleDrawerGenerateLegend = useCallback(() => {
    store.generateOrUpdateLegendNode();
    layout.setActiveDrawer('none');
    showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2400);
  }, [store, layout, showToast]);

  const handleDrawerAddIdfRack = useCallback(() => {
    store.addRack('Tủ Rack Phân Phối IDF');
    layout.setActiveDrawer('none');
  }, [store, layout]);

  const handlePlaceExistingAssetAt = useCallback(
    (assetId: string, x?: number, y?: number) => {
      store.placeExistingAssetOnCanvas(assetId, x, y);
    },
    [store]
  );

  const handleDrawerPlaceExistingAssetAt = useCallback(
    (assetId: string, x?: number, y?: number) => {
      store.placeExistingAssetOnCanvas(assetId, x, y);
      layout.setActiveDrawer('none');
    },
    [store, layout]
  );

  const handleCloseLibraryDrawer = useCallback(() => {
    layout.setActiveDrawer('none');
  }, [layout]);

  const handleOpenDeepInspectById = useCallback(
    (id: string) => store.setDeepInspectId(id),
    [store]
  );

  const handleDropDevice = useCallback(
    (presetName: string, x: number, y: number, options?: { elevationZ?: number }) => {
      store.addDeviceFromCatalog(presetName, x, y, options);
    },
    [store]
  );

  const handleDropDeviceIntoRack = useCallback(
    (presetName: string, rackId: string, preferredU: number, side?: 'front' | 'rear') => {
      store.addDeviceFromCatalogToRack(presetName, rackId, preferredU, side);
    },
    [store]
  );

  const handleAddQuickDevice = useCallback(() => {
    store.addDeviceFromCatalog('Access Switch 24-PoE+', canvasCenter.x, canvasCenter.y);
  }, [store, canvasCenter.x, canvasCenter.y]);

  // Properties Panel shared props builder
  const propertiesPanelProps = useMemo(
    () => ({
      project: store.project,
      selection: store.selection,
      auditIssues: auditReport.issues,
      is3DView: viewport.is3DView,
      isReadOnlyMode,
      onUpdateAsset: store.updateDeviceAsset,
      onUpdateNode: store.updateNode,
      onRotateNodes: store.rotateNodes,
      onMirrorNodes: store.mirrorNodes,
      onUpdateWifiCoverage: store.updateWifiCoverage,
      onUpdateCameraFov: store.updateCameraFov,
      onSetNodeIconOrLogo: store.setNodeIconOrLogo,
      onToggleNodeLock: store.toggleNodeLock,
      onToggleNodeVisibility: store.toggleNodeVisibility,
      onSelectCable: handleSelectCable,
      onSelectNode: handleJumpToNode,
      onUpdateCable: store.updateCable,
      onSetCableColor: store.setCableColor,
      onSetCablesColorByType: store.setCablesColorByType,
      onReconnectCableEndpoint: store.reconnectCableEndpoint,
      onUpdateRoom: store.updateRoom,
      onUpdateTray: store.updateCableTray,
      onUpdateRack: store.updateRack,
      onAssignDeviceToRackSlot: store.assignDeviceToRackSlot,
      onRemoveDeviceFromRackSlot: store.removeDeviceFromRackSlot,
      onUpdateFloor: handleUpdateFloor,
      onUpdateSettings: store.updateSettings,
      onAutoAssignIps: handleAutoAssignIps,
      onUpdateProjectMeta: store.updateProjectMeta,
      onDuplicateProject: handleDuplicateProject,
      onDeleteNode: store.deleteNode,
      onDeleteNodes: store.deleteNodes,
      onDuplicateNodes: store.duplicateNodes,
      onGroupNodes: store.groupNodes,
      onUngroupNodes: store.ungroupNodes,
      onAlignNodes: store.alignNodes,
      onDistributeNodes: store.distributeNodes,
      onAutoAlignSnapToGrid: store.autoAlignNodesSnapToGrid,
      onDeleteCable: store.deleteCable,
      onDeleteRoom: store.deleteRoom,
      onDeleteTray: store.deleteCableTray,
      onDeleteRack: store.deleteRack,
      onOpenDeepInspect: openDeepInspect,
      onCloneFloor: store.cloneFloor,
      onResizeLegendToFit: store.resizeLegendToFit,
      onAutoRouteCable: handleAutoRouteCable,
      onAutoRouteAllCables: handleAutoRouteAllCables,
      hasCopiedStyle: store.hasCopiedStyle,
      onCopyNodeStyle: handleCopyNodeStyleById,
      onPasteNodeStyle: handlePasteNodeStyleByIds,
      layoutTier: layout.layoutTier,
      density: layout.density,
      highContrast: layout.highContrast,
      reducedMotion: layout.reducedMotion,
      onToggleDensity: layout.toggleDensity,
      onToggleHighContrast: layout.toggleHighContrast,
      onToggleReducedMotion: layout.toggleReducedMotion,
      onOpenBomModal: openBomModal,
      onOpenBomSubnetsTab: openBomSubnetsTab,
      onAutoLayerDevices: handleAutoLayerDevices,
      requestedTab: requestedPropertiesTab,
      experienceMode: store.project.settings.experienceMode ?? ('advanced' as const),
      cadDocument: cad.cadDoc,
      onSyncScaleFromCad: cad.syncScaleToNetworkProject,
      onLockAllCadLayers: cad.lockAllCadFloorplanLayers
    }),
    [
      store.project,
      store.selection,
      auditReport.issues,
      viewport.is3DView,
      isReadOnlyMode,
      store.updateDeviceAsset,
      store.updateNode,
      store.rotateNodes,
      store.mirrorNodes,
      store.updateWifiCoverage,
      store.updateCameraFov,
      store.setNodeIconOrLogo,
      store.toggleNodeLock,
      store.toggleNodeVisibility,
      handleSelectCable,
      handleJumpToNode,
      store.updateCable,
      store.setCableColor,
      store.setCablesColorByType,
      store.reconnectCableEndpoint,
      store.updateRoom,
      store.updateCableTray,
      store.updateRack,
      store.assignDeviceToRackSlot,
      store.removeDeviceFromRackSlot,
      handleUpdateFloor,
      store.updateSettings,
      handleAutoAssignIps,
      store.updateProjectMeta,
      handleDuplicateProject,
      store.deleteNode,
      store.deleteNodes,
      store.duplicateNodes,
      store.groupNodes,
      store.ungroupNodes,
      store.alignNodes,
      store.distributeNodes,
      store.autoAlignNodesSnapToGrid,
      store.deleteCable,
      store.deleteRoom,
      store.deleteCableTray,
      store.deleteRack,
      openDeepInspect,
      store.cloneFloor,
      store.resizeLegendToFit,
      handleAutoRouteCable,
      handleAutoRouteAllCables,
      store.hasCopiedStyle,
      handleCopyNodeStyleById,
      handlePasteNodeStyleByIds,
      layout.layoutTier,
      layout.density,
      layout.highContrast,
      layout.reducedMotion,
      layout.toggleDensity,
      layout.toggleHighContrast,
      layout.toggleReducedMotion,
      openBomModal,
      openBomSubnetsTab,
      handleAutoLayerDevices,
      requestedPropertiesTab,
      cad.cadDoc,
      cad.syncScaleToNetworkProject,
      cad.lockAllCadFloorplanLayers
    ]
  );

  const sheetHeightClass =
    layout.bottomSheetSnap === 'full'
      ? 'h-[90dvh]'
      : layout.bottomSheetSnap === 'half'
      ? 'h-[58dvh]'
      : 'h-[48px]';

  const cycleBottomSheetSnap = () => {
    const order: BottomSheetSnap[] = ['collapsed', 'half', 'full'];
    const next = order[(order.indexOf(layout.bottomSheetSnap) + 1) % order.length];
    layout.setBottomSheetSnap(next);
  };

  if (isAdminRoute) {
    return (
      <ErrorBoundary>
        <div
          className={`min-h-dvh w-screen bg-slate-50 dark:bg-slate-950 ${
            store.project.settings.isDarkMode ? 'dark' : ''
          }`}
        >
          <Suspense
            fallback={
              <div className="min-h-dvh w-full flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-xs font-medium">
                Đang tải trang quản trị Admin...
              </div>
            }
          >
            <AdminPortal
              currentCanvasProject={store.project}
              pendingCanvasDraft={pendingAdminCanvasDraft}
              onClearPendingCanvasDraft={() => setPendingAdminCanvasDraft(null)}
              onEditTemplateInCanvas={handleEditTemplateInCanvas}
              onBackToApp={closeAdminPortal}
            />
          </Suspense>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div
        ref={workspaceShellRef}
        className={`workspace-shell w-screen h-dvh flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 ${
          store.project.settings.isDarkMode ? 'dark' : ''
        } ${layout.density === 'comfortable' ? 'density-comfortable' : ''} ${
          layout.highContrast ? 'high-contrast' : ''
        } ${layout.reducedMotion ? 'reduce-motion' : ''}`}
      >
        {store.isAdminTemplateMode && adminCanvasDraft && (
          <div className="h-10 px-4 bg-[#155EEF] text-white text-xs flex items-center justify-between gap-3 shrink-0 no-print">
            <div className="flex items-center gap-2 min-w-0 truncate">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="truncate font-medium">
                Chế độ Admin sửa mẫu: <strong>{adminCanvasDraft.manifest.name}</strong>{' '}
                <span className="opacity-80 font-mono">({adminCanvasDraft.slug})</span>
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleReturnAdminCanvasToPortal}
                className="px-3 py-1 rounded-md bg-white text-[#155EEF] hover:bg-blue-50 font-semibold whitespace-nowrap cursor-pointer"
              >
                Lưu về Admin
              </button>
              <button
                type="button"
                onClick={handleCancelAdminCanvasEdit}
                className="px-2.5 py-1 rounded-md border border-white/40 hover:bg-white/10 text-white font-medium whitespace-nowrap cursor-pointer"
              >
                Hủy sửa mẫu
              </button>
            </div>
          </div>
        )}
        {/* Hidden Excel File Input for quick toolbar button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleExcelQuickUpload}
          className="hidden"
        />
        {/* Hidden JSON / .hachihi.json Package File Input for top-left Tệp menu */}
        <input
          ref={packageFileInputRef}
          type="file"
          accept=".hachihi.json,.json"
          onChange={handlePackageQuickUpload}
          className="hidden"
        />

        {/* Global File Drag-and-Drop Overlay */}
        {isFileDragOver && (
          <div
            className="fixed inset-0 z-50 bg-[#155EEF]/15 dark:bg-[#155EEF]/25 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none no-print"
            aria-hidden="true"
          >
            <div className="bg-white dark:bg-slate-900 border-2 border-dashed border-[#155EEF] rounded-2xl px-8 py-7 shadow-2xl flex flex-col items-center text-center gap-2.5 max-w-md">
              <div className="w-12 h-12 rounded-xl bg-[#155EEF]/10 text-[#155EEF] dark:text-blue-400 flex items-center justify-center">
                <FileArchive className="w-6 h-6" />
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-white">
                Thả tệp dự án hoặc bản vẽ AutoCAD để xem trước &amp; nhập
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Hỗ trợ <span className="font-semibold text-[#155EEF]">.hachihi.json</span>, <span className="font-semibold">.json</span> và bản vẽ <span className="font-semibold text-sky-600">.dxf / .dwg</span>.
              </p>
            </div>
          </div>
        )}

        {/* 1. ADAPTIVE TOP BAR */}
        {!isZenMode && (
          <TopBar
            project={store.project}
            keymap={keymap}
            hasUnsavedChanges={store.hasUnsavedChanges}
            isSaving={store.isSaving}
            storageError={store.storageError}
            lastSavedAt={store.lastSavedAt}
            auditIssueCount={auditReport.issues.length}
            isAiAvailable={isAiAvailable}
            activePresetId={activePresetId}
            canUndo={store.historyIndex > 0}
            canRedo={store.historyIndex < store.history.length - 1}
            hasSelection={store.selection.type !== 'none'}
            hasNodeSelection={store.selection.type === 'node' && Boolean(store.selection.id)}
            hasCopiedStyle={store.hasCopiedStyle}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDuplicateSelected={handleDuplicateSelected}
            onDeleteSelected={handleDeleteSelected}
            onSelectAll={handleSelectAll}
            onCopySelectedStyle={handleCopySelectedStyle}
            onPasteSelectedStyle={handlePasteSelectedStyle}
            onApplyWorkspacePreset={handleApplyWorkspacePreset}
            onSaveNow={handleSaveNow}
            onDuplicateProject={handleDuplicateProject}
            onSetMode={store.setDesignMode}
            onAutoAssignIps={handleAutoAssignIpsPreserve}
            onOpenProjectHub={handleOpenProjectHub}
            onOpenEngineeringAudit={openAuditModal}
            onOpenPowerTab={handleOpenPowerTab}
            onOpenTemplates={openTemplateModal}
            onOpenBuildingGenerator={openBuildingModal}
            onOpenExport={openExportModal}
            onOpenBomModal={openBomModal}
            onOpenGuide={openGuideModal}
            onOpenQuickTour={handleOpenQuickTour}
            onOpenAbout={handleOpenAbout}
            onAddRack={handleAddStandardRack}
            onNewProject={handleNewProject}
            onOpenExcelImport={openExcelTreeModal}
            onOpenJsonImport={handleOpenJsonOrPackageImport}
            onOpenPackageImport={handleOpenJsonOrPackageImport}
            isDarkMode={store.project.settings.isDarkMode}
            onToggleTheme={handleToggleTheme}
            is3DView={viewport.is3DView}
            onToggle3DView={handleToggle3D}
            isAiChatOpen={isAiChatOpen}
            onToggleAiChat={isAiAvailable ? handleToggleAiChat : undefined}
            onAutoRouteAllCables={handleAutoRouteAllCables}
            onAutoLayerDevices={handleAutoLayerDevices}
            onOpenCommandPalette={handleOpenCommandPalette}
            onOpenShortcuts={openShortcutsModal}
            onExportA4Pdf={handleExportA4PdfAction}
            onOpenDirectory={openDirectoryModal}
            isReadOnlyMode={isReadOnlyMode}
            layoutTier={layout.layoutTier}
            onShowToast={handleShowToast2800}
            onToggleLeftDrawer={handleToggleLeftDrawer}
            onToggleRightDrawer={handleToggleRightDrawer}
            workspaceMode={cad.workspaceMode}
            hasCadDocument={Boolean(cad.cadDoc)}
            cadDocName={cad.cadDoc?.name}
            onSwitchWorkspaceMode={cad.setWorkspaceMode}
            onOpenCadImport={() => cad.openImportDialog()}
            onOpenAdmin={openAdminPortal}
          />
        )}

        {cad.workspaceMode === 'cad' && cad.cadDoc ? (
          <div className="flex-1 flex overflow-hidden relative">
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-200 text-sm font-medium">
                  Đang khởi động AutoCAD Studio...
                </div>
              }
            >
              <CADWorkspace
                doc={cad.cadDoc}
                canUndo={cad.canUndo}
                canRedo={cad.canRedo}
                undoLabel={cad.undoLabel}
                redoLabel={cad.redoLabel}
                executionLog={cad.executionLog}
                performanceMode={store.project.settings.canvasPerformanceMode}
                onExecuteCommand={cad.executeCadCommand}
                onUndo={cad.undoCad}
                onRedo={cad.redoCad}
                onUpdateDocumentSettings={cad.updateCadDocumentSettings}
                onAutoFitUnderlay={cad.autoFitUnderlayToProject}
                onOpenImportDialog={() => cad.openImportDialog()}
                onSaveSnapshot={() => void cad.saveCadRevision()}
                onApplyToNetworkDesign={cad.applyToNetworkDesign}
              />
            </Suspense>
          </div>
        ) : (
        <>
        {/* 1b. QUICK ACCESS BAR (Frequent Tools, Mode Context & Consolidated Nâng cao) */}
        {!isZenMode && layout.layoutTier !== 'narrow' && (
          <QuickAccessBar
            project={store.project}
            activeTool={store.activeTool}
            keymap={keymap}
            canUndo={store.historyIndex > 0}
            canRedo={store.historyIndex < store.history.length - 1}
            hasUnsavedChanges={store.hasUnsavedChanges}
            isSaving={store.isSaving}
            is3DView={viewport.is3DView}
            is3DDragLocked={viewport.is3DDragLocked}
            isReadOnlyMode={isReadOnlyMode}
            recentActions={recentActions}
            onSetTool={store.setActiveTool}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSaveNow={handleSaveNow}
            onAddDeviceFocus={handleFocusDeviceLibrary}
            onOpenExcelTree={openExcelTreeModal}
            onAutoRouteAllCables={handleAutoRouteAllCables}
            onAutoAssignIps={handleAutoAssignIpsPreserve}
            onAddRack={handleAddStandardRack}
            onOpenPowerTab={handleOpenPowerTab}
            onToggleCoverageOverlay={handleToggleCoverageOverlay}
            onToggleReadOnly={handleToggleReadOnly}
            onAutoLayerDevices={handleAutoLayerDevices}
            onReplayRecentAction={replayRecentAction}
            onClearRecentActions={handleClearRecentActions}
            experienceMode={store.project.settings.experienceMode ?? 'advanced'}
            onToggleExperienceMode={mode => {
              store.updateSettings({ experienceMode: mode });
              showToast(
                mode === 'basic'
                  ? 'Đã bật chế độ Cơ bản: chỉ hiển thị thao tác vẽ & cấu hình thiết yếu.'
                  : 'Đã bật chế độ Kỹ sư: mở đầy đủ công cụ IP/VLAN, PoE/UPS & Tủ Rack.',
                'info',
                2200
              );
            }}
          />
        )}

        {/* MAIN WORKSPACE CONTAINER (Adaptive 3-Tier Layout) */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* WIDE TIER: Docked Resizable Left Library */}
          {!isZenMode && layout.layoutTier === 'wide' && (
            <>
              <LeftLibrary
                project={store.project}
                is3DView={viewport.is3DView}
                is3DDragLocked={viewport.is3DDragLocked}
                isReadOnlyMode={isReadOnlyMode}
                onAddDevice={handleAddDeviceAt}
                onAddCustomDevice={handleAddCustomDeviceAt}
                onAddTextNode={handleAddTextNodeAt}
                onAddShapeNode={handleAddShapeNodeAt}
                onGenerateLegend={handleGenerateLegend}
                onAddRack={handleAddIdfRack}
                onPlaceExistingAsset={handlePlaceExistingAssetAt}
                onDragPresetChange={setDraggedPresetName}
                canvasCenter={canvasCenter}
                widthPx={layout.leftWidth}
                isCollapsed={isLeftCollapsed}
                onToggleCollapse={setIsLeftCollapsed}
              />
              {!isLeftCollapsed && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Kéo đổi chiều rộng thư viện"
                  onPointerDown={e => startSplitterDrag('left', e)}
                  className="w-1.5 h-full cursor-col-resize hover:bg-blue-500/40 active:bg-blue-600/60 transition-colors shrink-0 no-print z-10"
                />
              )}
            </>
          )}

          {/* MEDIUM & NARROW TIERS: Slide-Over Left Library Drawer */}
          {!isZenMode && layout.layoutTier !== 'wide' && layout.activeDrawer === 'library' && (
            <>
              <div
                onClick={handleCloseLibraryDrawer}
                className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] no-print"
                aria-hidden="true"
              />
              <div className="fixed inset-y-0 left-0 z-40 pt-safe pb-safe shadow-2xl no-print">
                <LeftLibrary
                  project={store.project}
                  is3DView={viewport.is3DView}
                  is3DDragLocked={viewport.is3DDragLocked}
                  isReadOnlyMode={isReadOnlyMode}
                  onAddDevice={handleDrawerAddDeviceAt}
                  onAddCustomDevice={handleDrawerAddCustomDeviceAt}
                  onAddTextNode={handleDrawerAddTextNodeAt}
                  onAddShapeNode={handleDrawerAddShapeNodeAt}
                  onGenerateLegend={handleDrawerGenerateLegend}
                  onAddRack={handleDrawerAddIdfRack}
                  onPlaceExistingAsset={handleDrawerPlaceExistingAssetAt}
                  onDragPresetChange={setDraggedPresetName}
                  canvasCenter={canvasCenter}
                  widthPx={296}
                  isOverlayDrawer
                  onCloseDrawer={handleCloseLibraryDrawer}
                />
              </div>
            </>
          )}

          {/* CENTRAL DESIGN CANVAS */}
          <main ref={canvasHostRef} className="flex-1 h-full relative overflow-hidden bg-[#F1F5F9] dark:bg-[#0B1120]">
            {toast && (
              <div
                role="status"
                aria-live="polite"
                className={`absolute top-14 right-4 z-40 px-3.5 py-2 rounded-lg text-white text-xs font-semibold shadow-lg transition-all no-print ${
                  toast.type === 'error'
                    ? 'bg-rose-600'
                    : toast.type === 'success'
                    ? 'bg-emerald-600'
                    : 'bg-blue-600'
                }`}
              >
                {toast.text}
              </div>
            )}

            {viewport.is3DView ? (
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-200 text-sm font-medium">
                    Đang tải mô hình không gian 3D...
                  </div>
                }
              >
                <Network3DScene
                  ref={viewport.register3DHandle}
                  project={store.project}
                  selection={store.selection}
                  activeTool={store.activeTool}
                  isReadOnlyMode={isReadOnlyMode}
                  isSceneDragLocked={viewport.is3DDragLocked}
                  draggedPresetName={draggedPresetName}
                  view3DOptions={viewport.view3DOptions}
                  onChangeView3DOptions={viewport.setView3DOptions}
                  onContextLostChange={viewport.setIs3DContextLost}
                  onSelect={store.selectItem}
                  onSetTool={store.setActiveTool}
                  onToggleNodeLock={store.toggleNodeLock}
                  onUpdateNode={store.updateNode}
                  onAddCable={store.addCable}
                  onUpdateCable={store.updateCable}
                  onAutoRouteCable={handleAutoRouteCable}
                  onAutoRouteAllCables={handleAutoRouteAllCables}
                  onDeleteCable={store.deleteCable}
                  onBeginDragSnapshot={store.beginDragSnapshot}
                  onMoveNodesTransient={store.moveNodesTransient}
                  onSnapNodesAndCommitDrag={store.snapNodesAndCommitDrag}
                  onRotateNodesTransient={store.rotateNodesTransient}
                  onRotateNodes={store.rotateNodes}
                  onMirrorNodes={store.mirrorNodes}
                  onUpdateWifiCoverageTransient={store.updateWifiCoverageTransient}
                  onUpdateWifiCoverage={store.updateWifiCoverage}
                  onUpdateCameraFovTransient={store.updateCameraFovTransient}
                  onUpdateCameraFov={store.updateCameraFov}
                  onToggleSceneDragLocked={() => viewport.setIs3DDragLocked(v => !v)}
                  onUpdateSettings={store.updateSettings}
                  onDropDevice={handleDropDevice}
                  onDropDeviceIntoRack={handleDropDeviceIntoRack}
                  onOpenDeepInspect={handleOpenDeepInspectById}
                  onExit3D={() => viewport.setMode('2d')}
                  onSetActiveFloor={store.setActiveFloor}
                  onSetActiveFloorId={store.setActiveFloorId}
                  onCloneFloor={store.cloneFloor}
                  cadUnderlayDoc={cad.cadDoc}
                />
              </Suspense>
            ) : (
              <DesignCanvas
                  project={store.project}
                  selection={store.selection}
                  activeTool={store.activeTool}
                  zoom={store.zoom}
                  pan={store.pan}
                  connectingSource={store.connectingSource}
                  draggedPresetName={draggedPresetName}
                  isReadOnlyMode={isReadOnlyMode}
                  onSelect={store.selectItem}
                  onToggleNodeSelection={store.toggleNodeSelection}
                  onSelectMultipleNodes={store.selectMultipleNodes}
                  onBeginDragSnapshot={store.beginDragSnapshot}
                  onMoveNodesTransient={store.moveNodesTransient}
                  onSnapNodesAndCommitDrag={store.snapNodesAndCommitDrag}
                  onMoveNode={store.moveNode}
                  onResizeNodeTransient={store.resizeNodeTransient}
                  onSnapNodeResizeAndCommit={store.snapNodeResizeAndCommit}
                  onMoveRoomTransient={store.moveRoomTransient}
                  onResizeRoomTransient={store.resizeRoomTransient}
                  onSnapRoomAndCommit={store.snapRoomAndCommit}
                  onUpdateNode={store.updateNode}
                  onSetNodeIconOrLogo={store.setNodeIconOrLogo}
                  onDuplicateNodes={store.duplicateNodes}
                  smartClipboardNodeIds={store.smartClipboardNodeIds}
                  onSmartCopyPasteNodes={store.smartCopyPasteNodes}
                  onCopyNodesToClipboard={store.copyNodesToClipboard}
                  onToggleNodeLock={store.toggleNodeLock}
                  onToggleNodeVisibility={store.toggleNodeVisibility}
                  onAddTextNode={handleAddTextNodeAt}
                  onSetTool={store.setActiveTool}
                  onAddCable={store.addCable}
                  onUpdateCableControlPoints={store.updateCableControlPointsTransient}
                  onUpdateCable={store.updateCable}
                  onSetCableColor={store.setCableColor}
                  onReconnectCableEndpoint={store.reconnectCableEndpoint}
                  onSetConnectingSource={store.setConnectingSource}
                  onPanChange={store.setPan}
                  onZoomChange={store.setZoom}
                  onOpenDeepInspect={handleOpenDeepInspectById}
                  onAddRoom={store.addRoom}
                  onAddCableTray={store.addCableTray}
                  onMoveCableTrayVertexTransient={store.moveCableTrayVertexTransient}
                  onMoveCableTrayTransient={store.moveCableTrayTransient}
                  onSnapCableTrayAndCommit={store.snapCableTrayAndCommit}
                  onDeleteSelected={handleDeleteSelected}
                  onDropDevice={handleDropDevice}
                  onDropDeviceIntoRack={handleDropDeviceIntoRack}
                  onAssignDeviceToRackSlot={store.assignDeviceToRackSlot}
                  onRemoveDeviceFromRackSlot={store.removeDeviceFromRackSlot}
                  onUpdateSettings={store.updateSettings}
                  onUpdateWifiCoverageRadiusTransient={store.updateWifiCoverageRadiusTransient}
                  onUpdateWifiCoverageTransient={store.updateWifiCoverageTransient}
                  onUpdateCameraFovTransient={store.updateCameraFovTransient}
                  onRotateNodesTransient={store.rotateNodesTransient}
                  onRotateNodes={store.rotateNodes}
                  onMirrorNodes={store.mirrorNodes}
                  onResizeLegendToFit={store.resizeLegendToFit}
                  onAutoRouteCable={handleAutoRouteCable}
                  onOpenCommandPalette={handleOpenCommandPalette}
                  onOpenTemplates={openTemplateModal}
                  onAddQuickDevice={handleAddQuickDevice}
                  onOpenBuildingGenerator={openBuildingModal}
                  onSetActiveFloor={store.setActiveFloor}
                  onCloneFloor={store.cloneFloor}
                  onNudgeNodes={store.nudgeNodes}
                  showMinimap={showMinimap}
                  showBgMenu={showBgMenu}
                  onSetShowBgMenu={setShowBgMenu}
                  cadUnderlayDoc={cad.cadDoc}
                />
            )}

            {/* Shared Floating Viewport Controller (Unified 2D & 3D HUD) */}
            <ViewportController
              containerRef={canvasHostRef}
              project={store.project}
              zoom2D={store.zoom}
              isReadOnlyMode={isReadOnlyMode}
              isZenMode={isZenMode}
              onToggleZenMode={() => setIsZenMode(v => !v)}
              isAiAvailable={isAiAvailable}
              isAiChatOpen={isAiChatOpen}
              onToggleAiChat={isAiAvailable ? () => setIsAiChatOpen(v => !v) : undefined}
              isQuickExporting={isQuickExporting}
              onQuickExportPng={() => void handleQuickExportViewPng()}
              showBgMenu={showBgMenu}
              onToggleBgMenu={() => setShowBgMenu(v => !v)}
              onCloseBgMenu={() => setShowBgMenu(false)}
              showMinimap={showMinimap}
              onToggleMinimap={() => setShowMinimap(v => !v)}
              onToggleLayerVisibility={store.toggleLayerVisibility}
              onToggleLayerLock={store.toggleLayerLock}
              onSelectLayerObjects={handleSelectLayerObjects}
              onAutoLayerDevices={handleAutoLayerDevices}
              onToggleAutoLayering={() =>
                store.updateSettings({
                  autoLayeringEnabled: !store.project.settings.autoLayeringEnabled
                })
              }
              onUpdateSettings={store.updateSettings}
              onOpenMobileLayers={() => layout.setActiveDrawer('layers')}
              cadDocument={cad.cadDoc}
              onToggleCadUnderlayEnabled={cad.toggleCadUnderlayEnabled}
              onChangeCadUnderlayOpacity={cad.changeCadUnderlayOpacity}
              onToggleCadUnderlay3D={cad.toggleCadUnderlay3D}
              onToggleCadLayerVisible={cad.toggleCadLayerVisibility}
              onToggleCadLayerLocked={cad.toggleCadLayerLocked}
              onLockAllCadLayers={cad.lockAllCadFloorplanLayers}
              onSyncScaleFromCad={cad.syncScaleToNetworkProject}
              onOpenCadStudio={() => cad.setWorkspaceMode('cad')}
            />
          </main>

          {/* WIDE TIER: Resizable Docked Right Properties Panel */}
          {!isZenMode && layout.layoutTier === 'wide' && (
            <>
              {!isPropertiesCollapsed && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Kéo đổi chiều rộng bảng thuộc tính"
                  onPointerDown={e => startSplitterDrag('right', e)}
                  className="w-1.5 h-full cursor-col-resize hover:bg-blue-500/40 active:bg-blue-600/60 transition-colors shrink-0 no-print z-10"
                />
              )}
              <div
                style={{ width: isPropertiesCollapsed ? 48 : layout.rightWidth }}
                className="h-full shrink-0 transition-[width] duration-150 no-print"
              >
                <PropertiesPanel
                  {...propertiesPanelProps}
                  isCollapsed={isPropertiesCollapsed}
                  onToggleCollapse={handleTogglePropertiesCollapse}
                />
              </div>
            </>
          )}

          {/* MEDIUM TIER: Slide-Over Properties Drawer */}
          {!isZenMode && layout.layoutTier === 'medium' && layout.activeDrawer === 'properties' && (
            <>
              <div
                onClick={() => layout.setActiveDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] no-print"
                aria-hidden="true"
              />
              <div
                className={`fixed inset-y-0 right-0 z-40 ${
                  isPropertiesCollapsed ? 'w-12' : 'w-[min(440px,94vw)]'
                } h-full shadow-2xl pt-safe pb-safe transition-[width] duration-150 no-print`}
              >
                <PropertiesPanel
                  {...propertiesPanelProps}
                  isCollapsed={isPropertiesCollapsed}
                  onToggleCollapse={handleTogglePropertiesCollapse}
                  onClosePanel={() => layout.setActiveDrawer('none')}
                />
              </div>
            </>
          )}

          {/* NARROW TIER: Mobile Unified Layer Sheet */}
          {!isZenMode && layout.layoutTier === 'narrow' && layout.activeDrawer === 'layers' && (
            <>
              <div
                onClick={() => layout.setActiveDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 no-print"
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Lớp hiển thị bản vẽ"
                className="fixed inset-x-0 bottom-14 z-40 mx-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 max-h-[84dvh] flex flex-col overflow-hidden no-print"
              >
                <LayerPanel
                  variant="sheet"
                  project={store.project}
                  is3DView={viewport.is3DView}
                  isReadOnlyMode={isReadOnlyMode}
                  onToggleLayerVisibility={store.toggleLayerVisibility}
                  onToggleLayerLock={store.toggleLayerLock}
                  onSelectLayerObjects={handleSelectLayerObjects}
                  onAutoLayerDevices={handleAutoLayerDevices}
                  onToggleAutoLayering={() =>
                    store.updateSettings({
                      autoLayeringEnabled: !store.project.settings.autoLayeringEnabled
                    })
                  }
                  onUpdateSettings={store.updateSettings}
                  view3DOptions={viewport.view3DOptions}
                  onChangeView3DOptions={viewport.setView3DOptions}
                  onClose={() => layout.setActiveDrawer('none')}
                  cadDocument={cad.cadDoc}
                  onToggleCadUnderlayEnabled={cad.toggleCadUnderlayEnabled}
                  onChangeCadUnderlayOpacity={cad.changeCadUnderlayOpacity}
                  onToggleCadUnderlay3D={cad.toggleCadUnderlay3D}
                  onToggleCadLayerVisible={cad.toggleCadLayerVisibility}
                  onToggleCadLayerLocked={cad.toggleCadLayerLocked}
                  onLockAllCadLayers={cad.lockAllCadFloorplanLayers}
                  onSyncScaleFromCad={cad.syncScaleToNetworkProject}
                  onOpenCadStudio={() => cad.setWorkspaceMode('cad')}
                />
              </div>
            </>
          )}

          {/* NARROW TIER: Mobile "Vẽ" Tools Drawer */}
          {!isZenMode && layout.layoutTier === 'narrow' && narrowSubDrawer === 'draw' && (
            <>
              <div
                onClick={() => setNarrowSubDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 no-print"
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Công cụ vẽ bản vẽ"
                className="fixed inset-x-0 bottom-14 z-40 mx-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 space-y-2 no-print"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white">
                    Công cụ vẽ {viewport.is3DView ? '(3D)' : '(2D)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNarrowSubDrawer('none')}
                    aria-label="Đóng công cụ vẽ"
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: 'select' as const, label: 'Chọn', shortcut: formatShortcutDisplay(keymap.tool_select), icon: MousePointer },
                    { id: 'pan' as const, label: 'Kéo', shortcut: formatShortcutDisplay(keymap.tool_pan), icon: Hand },
                    { id: 'connect' as const, label: 'Nối dây', shortcut: formatShortcutDisplay(keymap.tool_connect), icon: GitBranch },
                    { id: 'room' as const, label: 'Phòng', shortcut: formatShortcutDisplay(keymap.tool_room), icon: Square },
                    { id: 'tray' as const, label: 'Máng cáp', shortcut: formatShortcutDisplay(keymap.tool_tray), icon: Route },
                    { id: 'text' as const, label: 'Chữ', shortcut: formatShortcutDisplay(keymap.tool_text), icon: Type },
                    { id: 'measure' as const, label: 'Đo', shortcut: formatShortcutDisplay(keymap.tool_measure), icon: Ruler }
                  ].map(tool => {
                    const Icon = tool.icon;
                    const supportsUnlocked3D =
                      tool.id === 'select' || tool.id === 'pan' || tool.id === 'connect';
                    const unlockedIn3D =
                      viewport.is3DView && !viewport.is3DDragLocked && supportsUnlocked3D;
                    const active = store.activeTool === tool.id && (!viewport.is3DView || unlockedIn3D);
                    const disabled =
                      (viewport.is3DView && !unlockedIn3D) ||
                      (isReadOnlyMode &&
                        tool.id !== 'select' &&
                        tool.id !== 'pan' &&
                        tool.id !== 'measure');
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          store.setActiveTool(tool.id);
                          setNarrowSubDrawer('none');
                        }}
                        title={`${tool.label} (${tool.shortcut})`}
                        className={`py-2.5 px-1 rounded-xl border flex flex-col items-center gap-1 text-xs font-medium disabled:opacity-35 disabled:cursor-not-allowed ${
                          active
                            ? 'bg-[#155EEF] text-white border-[#155EEF] font-semibold'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{tool.label}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={isReadOnlyMode || (viewport.is3DView && viewport.is3DDragLocked)}
                    onClick={() => {
                      const offset = (store.project.racks.length % 5) * 32;
                      store.addRack('Tủ Server Rack 42U', 42, canvasCenter.x + offset, canvasCenter.y + offset);
                      recordAction('add_rack');
                      setNarrowSubDrawer('none');
                      showToast('Đã thêm Tủ Server Rack 42U vào bản vẽ!', 'success', 2000);
                    }}
                    title={`Tủ Rack (${formatShortcutDisplay(keymap.tool_rack)})`}
                    className="py-2.5 px-1 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex flex-col items-center gap-1 text-xs font-medium disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <Box className="w-4 h-4" />
                    <span>Tủ Rack</span>
                  </button>
                  <button
                    type="button"
                    disabled={isReadOnlyMode || viewport.is3DView}
                    onClick={() => {
                      store.generateOrUpdateLegendNode();
                      setNarrowSubDrawer('none');
                      showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2200);
                    }}
                    title={`Chú giải (${formatShortcutDisplay(keymap.action_legend)})`}
                    className="py-2.5 px-1 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex flex-col items-center gap-1 text-xs font-medium disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <Table2 className="w-4 h-4" />
                    <span>Chú giải</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* NARROW TIER: Mobile "Khác" Menu Drawer (Kiểm tra, Xuất, Dự án, Chế độ, Lớp, Sáng/Tối) */}
          {!isZenMode && layout.layoutTier === 'narrow' && narrowSubDrawer === 'more' && (
            <>
              <div
                onClick={() => setNarrowSubDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 no-print"
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Tính năng & Hồ sơ dự án"
                className="fixed inset-x-0 bottom-14 z-40 mx-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 space-y-2.5 max-h-[70dvh] overflow-y-auto no-print"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white">
                    Dự án &amp; Công cụ khác
                  </span>
                  <button
                    type="button"
                    onClick={() => setNarrowSubDrawer('none')}
                    aria-label="Đóng menu khác"
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
                    Chế độ thiết kế
                  </label>
                  <select
                    value={store.project.activeMode}
                    onChange={e => {
                      store.setDesignMode(e.target.value as DesignMode);
                      setNarrowSubDrawer('none');
                    }}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100"
                  >
                    {DESIGN_MODE_GROUPS.map(group => (
                      <optgroup key={group.id} label={group.label}>
                        {DESIGN_MODES.filter(m => m.group === group.id).map(m => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsBomModalOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                  >
                    <ClipboardList className="w-4 h-4 text-[#155EEF]" />
                    <span>Vật tư (BOM)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsAuditModalOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#155EEF]" />
                    <span>Kiểm tra ({auditReport.issues.length})</span>
                  </button>
                  {viewport.is3DView && (
                    <button
                      type="button"
                      onClick={() => {
                        viewport.setIs3DDragLocked(v => !v);
                      }}
                      aria-pressed={!viewport.is3DDragLocked}
                      aria-label={viewport.is3DDragLocked ? 'Mở khóa kéo thả 3D' : 'Khóa kéo thả 3D'}
                      className={`col-span-2 px-3 py-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                        viewport.is3DDragLocked
                          ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                          : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {viewport.is3DDragLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      <span>{viewport.is3DDragLocked ? 'Khóa kéo 3D (Nhấn mở khóa)' : 'Đã mở khóa kéo thả 3D'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      handleToggle3D();
                    }}
                    aria-pressed={viewport.is3DView}
                    aria-label="Chuyển đổi 2D / 3D"
                    className="col-span-2 px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center gap-2 text-xs font-mono"
                  >
                    <Cuboid className="w-4 h-4 text-[#155EEF] dark:text-blue-400" />
                    <span className={!viewport.is3DView ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100' : 'text-slate-400 opacity-45'}>
                      2D
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <span className={viewport.is3DView ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100' : 'text-slate-400 opacity-45'}>
                      3D
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsExportModalOpen(true);
                    }}
                    className="col-span-2 px-3 py-2.5 rounded-xl bg-[#155EEF] text-white flex items-center justify-center gap-2 text-xs font-semibold"
                  >
                    <Download className="w-4 h-4" />
                    <span>Xuất hồ sơ bản vẽ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsProjectHubOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <FolderKanban className="w-4 h-4 text-slate-500" />
                    <span>Trung tâm dự án</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsTemplateModalOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <FolderOpen className="w-4 h-4 text-slate-500" />
                    <span>Thư viện mẫu</span>
                  </button>
                  {!viewport.is3DView && (
                    <button
                      type="button"
                      onClick={() => {
                        setNarrowSubDrawer('none');
                        layout.setActiveDrawer('layers');
                      }}
                      className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                    >
                      <Layers className="w-4 h-4 text-slate-500" />
                      <span>Lớp hiển thị</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const nextMode =
                        (store.project.settings.experienceMode ?? 'advanced') === 'basic'
                          ? 'advanced'
                          : 'basic';
                      store.updateSettings({ experienceMode: nextMode });
                      setNarrowSubDrawer('none');
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <SlidersHorizontal className="w-4 h-4 text-[#155EEF]" />
                    <span>
                      {(store.project.settings.experienceMode ?? 'advanced') === 'basic'
                        ? 'Chế độ: Cơ bản'
                        : 'Chế độ: Kỹ sư'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      store.updateSettings({ isDarkMode: !store.project.settings.isDarkMode });
                      setNarrowSubDrawer('none');
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    {store.project.settings.isDarkMode ? (
                      <Sun className="w-4 h-4 text-amber-500" />
                    ) : (
                      <Moon className="w-4 h-4 text-slate-500" />
                    )}
                    <span>{store.project.settings.isDarkMode ? 'Giao diện Sáng' : 'Giao diện Tối'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsQuickTourOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-[#155EEF] dark:text-blue-400"
                  >
                    <Compass className="w-4 h-4" />
                    <span>Hướng dẫn 60s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsAboutModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <Info className="w-4 h-4 text-[#155EEF]" />
                    <span>Giới thiệu v{APP_VERSION}</span>
                  </button>
                  {isFeedbackFormConfigured() ? (
                    <a
                      href={buildFeedbackFormUrl({ activeMode: store.project.activeMode }) || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => {
                        if (!isOnline) {
                          e.preventDefault();
                          showToast('Cần kết nối Internet để mở biểu mẫu góp ý trực tuyến.', 'info');
                        }
                        setNarrowSubDrawer('none');
                      }}
                      className="col-span-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center gap-2 text-xs font-semibold text-[#155EEF] dark:text-blue-400"
                    >
                      <MessageSquarePlus className="w-4 h-4" />
                      <span>Gửi góp ý sản phẩm</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="col-span-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 flex items-center justify-center gap-2 text-xs font-medium text-slate-400 cursor-not-allowed"
                    >
                      <MessageSquarePlus className="w-4 h-4" />
                      <span>Góp ý</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* NARROW TIER: 3-Snap Draggable Bottom Sheet for Properties */}
          {!isZenMode && layout.layoutTier === 'narrow' && (
            <div
              className={`fixed inset-x-0 bottom-12 z-30 ${sheetHeightClass} bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl shadow-2xl flex flex-col overflow-hidden transition-[height] duration-200 no-print`}
            >
              {/* Drag / Tap Header Bar */}
              <div
                onPointerDown={e => {
                  sheetDragStartRef.current = { y: e.clientY, snap: layout.bottomSheetSnap };
                }}
                onPointerUp={e => {
                  const start = sheetDragStartRef.current;
                  sheetDragStartRef.current = null;
                  if (!start) return;
                  const dy = e.clientY - start.y;
                  if (dy < -40) {
                    layout.setBottomSheetSnap(start.snap === 'collapsed' ? 'half' : 'full');
                  } else if (dy > 40) {
                    layout.setBottomSheetSnap(start.snap === 'full' ? 'half' : 'collapsed');
                  } else {
                    cycleBottomSheetSnap();
                  }
                }}
                className="h-12 px-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 cursor-pointer shrink-0 select-none"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GripHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {store.selection.type === 'node'
                      ? 'Thuộc tính thiết bị'
                      : store.selection.type === 'edge'
                      ? 'Thuộc tính dây cáp'
                      : store.selection.type === 'rack'
                      ? 'Thuộc tính tủ Rack'
                      : 'Thuộc tính & Cấu hình'}
                  </span>
                </div>
                <span className="text-xs font-semibold text-[#155EEF] dark:text-blue-400 shrink-0">
                  {layout.bottomSheetSnap === 'collapsed'
                    ? 'Mở bảng'
                    : layout.bottomSheetSnap === 'half'
                    ? 'Mở rộng'
                    : 'Thu gọn'}
                </span>
              </div>
              {layout.bottomSheetSnap !== 'collapsed' && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PropertiesPanel
                    {...propertiesPanelProps}
                    isCollapsed={false}
                    onToggleCollapse={() => layout.setBottomSheetSnap('collapsed')}
                    onClosePanel={() => layout.setBottomSheetSnap('collapsed')}
                  />
                </div>
              )}
            </div>
          )}

          {/* Lazy-Loaded AI Engineering Assistant */}
          {isAiChatOpen && isAiAvailable && (
            <Suspense fallback={null}>
              <NetworkAssistantChat
                project={store.project}
                isOpen={isAiChatOpen}
                onClose={() => setIsAiChatOpen(false)}
              />
            </Suspense>
          )}
        </div>

        {/* WIDE & MEDIUM TIERS: Desktop Status Bar */}
        {!isZenMode && (
          <StatusBar
            project={store.project}
            selection={store.selection}
            is3DView={viewport.is3DView}
            lastSavedAt={store.lastSavedAt}
            hasUnsavedChanges={store.hasUnsavedChanges}
            isSaving={store.isSaving}
            storageError={store.storageError}
            auditIssueCount={auditReport.issues.length}
            onOpenAudit={openAuditModal}
            onOpenAbout={handleOpenAbout}
            onToggleSnap={handleToggleSnap}
            onToggleGrid={handleToggleGrid}
          />
        )}

        {/* NARROW TIER: 4-Tab Mobile Bottom Navigation Bar (Vẽ | Thêm | Thuộc tính | Khác) */}
        {!isZenMode && layout.layoutTier === 'narrow' && (
          <nav
            aria-label="Thanh điều hướng nhanh"
            className="h-12 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center shrink-0 z-40 pb-safe no-print"
          >
            <button
              type="button"
              onClick={() => {
                layout.setActiveDrawer('none');
                layout.setBottomSheetSnap('collapsed');
                setNarrowSubDrawer(d => (d === 'draw' ? 'none' : 'draw'));
              }}
              aria-label="Công cụ vẽ"
              aria-pressed={narrowSubDrawer === 'draw'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                narrowSubDrawer === 'draw'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <PenTool className="w-4 h-4" />
              <span>Vẽ</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setNarrowSubDrawer('none');
                layout.setBottomSheetSnap('collapsed');
                layout.setActiveDrawer(d => (d === 'library' ? 'none' : 'library'));
              }}
              aria-label="Thêm thiết bị từ thư viện"
              aria-pressed={layout.activeDrawer === 'library'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                layout.activeDrawer === 'library'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <PlusSquare className="w-4 h-4" />
              <span>Thêm</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setNarrowSubDrawer('none');
                layout.setActiveDrawer('none');
                layout.setBottomSheetSnap(s => (s === 'collapsed' ? 'half' : 'collapsed'));
              }}
              aria-label="Mở bảng thuộc tính"
              aria-pressed={layout.bottomSheetSnap !== 'collapsed'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                layout.bottomSheetSnap !== 'collapsed'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Thuộc tính</span>
            </button>

            <button
              type="button"
              onClick={() => {
                layout.setActiveDrawer('none');
                layout.setBottomSheetSnap('collapsed');
                setNarrowSubDrawer(d => (d === 'more' ? 'none' : 'more'));
              }}
              aria-label="Kiểm tra, Xuất và Dự án"
              aria-pressed={narrowSubDrawer === 'more'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold relative ${
                narrowSubDrawer === 'more'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <MoreHorizontal className="w-4 h-4" />
              <span>Khác</span>
              {auditReport.issues.length > 0 && (
                <span className="absolute top-1 right-4 w-2 h-2 rounded-full bg-rose-600" />
              )}
            </button>
          </nav>
        )}
        </>
        )}

        {/* LAZY-LOADED MODALS */}
        <Suspense fallback={null}>
          {(store.showWelcomeModal || isProjectHubOpen) && (
            <ProjectHubModal
              isOpen={store.showWelcomeModal || isProjectHubOpen}
              isWelcomeMode={store.showWelcomeModal}
              currentProjectId={store.project.id}
              projectList={store.projectList}
              lastBackupAt={store.lastBackupAt}
              snapshots={store.snapshots}
              lastAutoSnapshotAt={store.lastAutoSnapshotAt}
              onCreateSnapshot={store.createProjectSnapshot}
              onRestoreSnapshot={store.restoreProjectSnapshot}
              onDeleteSnapshot={store.deleteProjectSnapshot}
              onRefreshSnapshots={store.refreshSnapshots}
              onClose={() => {
                setIsProjectHubOpen(false);
                if (store.showWelcomeModal) {
                  void store.dismissWelcomeModal();
                }
              }}
              onCreateBlank={(name) => {
                void store.createBlankProject(name).then(() => {
                  showToast(`Đã tạo dự án "${name}"`, 'success');
                });
              }}
              onOpenTemplates={() => setIsTemplateModalOpen(true)}
              onOpenExcelImport={openExcelTreeModal}
              onSwitchProject={(id) => {
                void store.switchProject(id);
              }}
              onDuplicateCurrent={() => {
                void store.duplicateProject().then(() => {
                  showToast('Đã nhân bản dự án hiện tại!', 'success');
                });
              }}
              onTrashProject={(id) => {
                void store.trashProject(id);
              }}
              onRestoreProject={(id) => {
                void store.restoreProject(id);
              }}
              onDeletePermanently={(id) => {
                void store.deleteProjectPermanently(id);
              }}
              onImportProjectJson={store.importValidatedProject}
              onRequestPackageImport={handleRequestPackageImport}
              onImportScannerFile={handleImportScannerFile}
              onRecordFullBackup={store.recordFullBackup}
              onOpenAbout={() => setIsAboutModalOpen(true)}
            />
          )}

          {isAuditModalOpen && (
            <EngineeringAuditModal
              isOpen={isAuditModalOpen}
              project={store.project}
              onClose={() => setIsAuditModalOpen(false)}
              onNavigateToTarget={handleNavigateToAuditTarget}
            />
          )}

          {isBuildingModalOpen && (
            <BuildingGeneratorModal
              existingBuilding={store.project.buildings[0]}
              isOpen={isBuildingModalOpen}
              onClose={() => setIsBuildingModalOpen(false)}
              onGenerate={store.generateOrUpdateBuilding}
            />
          )}

          {isTemplateModalOpen && (
            <TemplateGalleryModal
              isOpen={isTemplateModalOpen}
              onClose={() => setIsTemplateModalOpen(false)}
              currentProject={store.project}
              onSelectExternalTemplate={async (entry) => {
                const res = await store.loadExternalTemplate(entry);
                if (res.ok) {
                  const warnSuffix =
                    res.warnings && res.warnings.length > 0 ? ` (${res.warnings[0]})` : '';
                  showToast(`Đã tải mẫu "${entry.name}" thành bản dự án độc lập!${warnSuffix}`, 'success');
                } else if (res.error) {
                  showToast(res.error, 'error', 5000);
                }
                return res;
              }}
              onSelectTemplate={(tplId) => {
                void store.loadTemplate(tplId).then(() => {
                  showToast('Đã tải mẫu thiết kế thành công!', 'success');
                });
              }}
            />
          )}

          {isExportModalOpen && (
            <ExportModal
              project={store.project}
              isOpen={isExportModalOpen}
              is3DView={viewport.is3DView}
              isCapturing3D={viewport.isCapturing3D}
              onCapture3D={viewport.capture3DImage}
              onClose={() => setIsExportModalOpen(false)}
              onOpenBomModal={openBomModal}
              onAfterExportRouterTree={() => recordAction('export_excel_tree')}
              onRequestPackageImport={handleRequestPackageImport}
              onLoadProjectJson={(importedProj: ProjectState) => {
                const res = store.importValidatedProject(importedProj);
                if (!res.ok) {
                  showToast(res.error, 'error', 5000);
                } else {
                  showToast('Khôi phục dự án JSON thành công!', 'success');
                }
              }}
              onMergeExcelDevices={(data) => {
                store.updateProject(prev => ({
                  ...prev,
                  assets: data.newAssets,
                  nodes: data.newNodes,
                  racks: data.updatedRacks
                }));
                showToast(`Đã nhập ${data.importedCount ?? Object.keys(data.newAssets).length} thiết bị từ Excel!`, 'success');
              }}
              cadDocument={cad.cadDoc}
              workspaceMode={cad.workspaceMode}
            />
          )}

          {cad.isImportDialogOpen && (
            <CADImportDialog
              isOpen={cad.isImportDialogOpen}
              projectId={store.project.id}
              initialFile={cad.pendingImportFile}
              onClose={cad.closeImportDialog}
              onOpenDocument={cad.openCadDocument}
            />
          )}

          {isBomModalOpen && (
            <BomStatisticsModal
              project={store.project}
              cadDocument={cad.cadDoc}
              isOpen={isBomModalOpen}
              initialTab={bomInitialTab}
              onClose={() => setIsBomModalOpen(false)}
              onShowToast={(msg, type) => showToast(msg, type || 'info', 2800)}
              onSelectOnCanvas={({ type, ids, label }) => {
                if (type === 'floor' && ids[0]) {
                  store.setActiveFloor(ids[0]);
                  showToast(`Đã chuyển bản vẽ sang ${label}.`, 'info', 2600);
                  return;
                }
                if (type === 'node' && ids.length > 0) {
                  handleJumpToNode(ids[0]);
                  if (ids.length > 1) {
                    store.selectMultipleNodes(ids);
                  }
                  showToast(`Đã chọn ${ids.length} đối tượng "${label}" trên bản vẽ.`, 'info', 2800);
                  return;
                }
                if (type === 'edge' && ids.length > 0) {
                  const firstCable = store.project.cables.find(c => c.id === ids[0]);
                  if (firstCable) {
                    handleJumpToNode(firstCable.sourceNodeId);
                  }
                  store.selectItem('edge', ids[0]);
                  showToast(`Đã chọn tuyến cáp thuộc nhóm "${label}" (${ids.length} tuyến).`, 'info', 2800);
                }
              }}
            />
          )}

          {Boolean(store.deepInspectId) && (
            <DeepInspectModal
              inspectId={store.deepInspectId}
              project={store.project}
              isOpen={Boolean(store.deepInspectId)}
              onClose={() => store.setDeepInspectId(null)}
              onUpdateAsset={store.updateDeviceAsset}
              onUpdateRack={store.updateRack}
              onAssignDeviceToRackSlot={store.assignDeviceToRackSlot}
              onRemoveDeviceFromRackSlot={store.removeDeviceFromRackSlot}
              onDropPresetIntoRack={store.addDeviceFromCatalogToRack}
              initialRackView={deepInspectRackView}
              isDark={Boolean(store.project.settings.isDarkMode)}
            />
          )}

          {isGuideModalOpen && (
            <GuideModal
              isOpen={isGuideModalOpen}
              keymap={keymap}
              onClose={() => setIsGuideModalOpen(false)}
              onOpenTemplates={() => {
                setIsGuideModalOpen(false);
                openTemplateModal();
              }}
              onOpenBuildingGenerator={() => {
                setIsGuideModalOpen(false);
                openBuildingModal();
              }}
              onOpenExcelTree={() => {
                setIsGuideModalOpen(false);
                openExcelTreeModal();
              }}
              onOpenBomModal={() => {
                setIsGuideModalOpen(false);
                openBomModal();
              }}
              onOpenShortcuts={() => {
                setIsGuideModalOpen(false);
                openShortcutsModal();
              }}
            />
          )}

          {isCommandPaletteOpen && (
            <CommandPaletteModal
              isOpen={isCommandPaletteOpen}
              project={store.project}
              density={layout.density}
              highContrast={layout.highContrast}
              reducedMotion={layout.reducedMotion}
              is3DView={viewport.is3DView}
              isAiAvailable={isAiAvailable}
              isReadOnlyMode={isReadOnlyMode}
              recentActions={recentActions}
              onReplayRecentAction={replayRecentAction}
              keymap={keymap}
              onClose={() => setIsCommandPaletteOpen(false)}
              onAutoRouteAllCables={handleAutoRouteAllCables}
              onFitToScreen={handleUserFitToScreen}
              onGenerateLegend={handleGenerateLegend}
              onOpenAudit={openAuditModal}
              onOpenExport={openExportModal}
              onOpenBomModal={openBomModal}
              onToggle3D={handleToggle3D}
              onToggleAiChat={() => setIsAiChatOpen(v => !v)}
              onToggleTheme={handleToggleTheme}
              onToggleDensity={layout.toggleDensity}
              onToggleHighContrast={layout.toggleHighContrast}
              onToggleReducedMotion={layout.toggleReducedMotion}
              onToggleReadOnly={() => setIsReadOnlyMode(v => !v)}
              onOpenDirectory={openDirectoryModal}
              onSaveNow={handleSaveNow}
              onJumpToNode={handleJumpToNode}
              onSelectCable={(cableId) => store.selectItem('edge', cableId)}
              onOpenShortcuts={openShortcutsModal}
              onExportA4Pdf={() => void handleQuickExportA4Pdf()}
              onAutoAssignIps={() => handleAutoAssignIps({ preserveExistingValid: true })}
              onAutoLayerDevices={handleAutoLayerDevices}
              onOpenExcelTree={openExcelTreeModal}
              onOpenTemplates={openTemplateModal}
              onOpenBuildingGenerator={openBuildingModal}
              onDuplicateSelected={handleDuplicateSelected}
              onSelectAll={handleSelectAll}
              onOpenAbout={() => setIsAboutModalOpen(true)}
              onOpenGuide={openGuideModal}
            />
          )}

          {isShortcutModalOpen && (
            <ShortcutSettingsModal
              isOpen={isShortcutModalOpen}
              onClose={() => setIsShortcutModalOpen(false)}
              keymap={keymap}
              onUpdateShortcut={updateShortcut}
              onSwapShortcuts={swapShortcuts}
              onResetSingleShortcut={resetSingleShortcut}
              onResetShortcuts={resetShortcuts}
            />
          )}

          {isDirectoryOpen && (
            <InfrastructureDirectoryModal
              isOpen={isDirectoryOpen}
              project={store.project}
              revisions={store.revisions}
              isReadOnlyMode={isReadOnlyMode}
              onClose={() => setIsDirectoryOpen(false)}
              onUpsertVlan={store.upsertVlan}
              onDeleteVlan={store.deleteVlan}
              onUpsertSubnet={store.upsertSubnet}
              onDeleteSubnet={store.deleteSubnet}
              onUpsertPatchLink={store.upsertPatchLink}
              onDeletePatchLink={store.deletePatchLink}
              onCreateRevision={store.createNamedRevision}
              onRestoreRevision={store.restoreNamedRevision}
              onDeleteRevision={store.deleteNamedRevision}
              onApplyBulkStaticIps={(updatedAssets) => {
                store.updateProject(prev => ({ ...prev, assets: updatedAssets }));
                showToast('Đã cập nhật IP tĩnh hàng loạt!', 'success');
              }}
              onSelectTarget={(targetType, targetId) => {
                setIsDirectoryOpen(false);
                if (targetType === 'node') handleJumpToNode(targetId);
                else store.selectItem('edge', targetId);
              }}
            />
          )}

          {isQuickTourOpen && (
            <QuickTourOverlay
              isOpen={isQuickTourOpen}
              onClose={(markCompleted) => {
                setIsQuickTourOpen(false);
                if (markCompleted) {
                  try {
                    localStorage.setItem(QUICK_TOUR_STORAGE_KEY, '1');
                    localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                  } catch {
                    // ignore
                  }
                }
              }}
            />
          )}

          {isAboutModalOpen && (
            <AboutModal
              isOpen={isAboutModalOpen}
              activeMode={store.project.activeMode}
              onClose={() => setIsAboutModalOpen(false)}
              onOpenQuickGuide={() => setIsQuickTourOpen(true)}
            />
          )}

          {isExcelTreeModalOpen && (
            <ExcelTreeImportModal
              isOpen={isExcelTreeModalOpen}
              existingProject={store.project}
              onClose={() => setIsExcelTreeModalOpen(false)}
              onAfterExportProjectTree={() => recordAction('export_excel_tree')}
              onApplyProject={(nextProject, summary) => {
                if (summary.applyMode === 'new_project') {
                  const res = store.importValidatedProject(nextProject);
                  if (!res.ok) {
                    showToast(res.error, 'error', 4500);
                    return;
                  }
                  showToast(
                    `Đã tạo sơ đồ mới gồm ${summary.createdNodesCount} thiết bị và ${summary.createdCablesCount} tuyến cáp trên ${summary.floorCount} tầng!`,
                    'success',
                    4200
                  );
                } else {
                  store.updateProject(() => nextProject);
                  showToast(
                    `Đã gộp ${summary.createdNodesCount} thiết bị và ${summary.createdCablesCount} tuyến cáp vào bản vẽ hiện tại!`,
                    'success',
                    4200
                  );
                }
                window.requestAnimationFrame(() => handleFitToScreen());
              }}
            />
          )}

          {Boolean(packagePreview) && (
            <PackageImportModal
              isOpen={Boolean(packagePreview)}
              inspection={packagePreview}
              onClose={() => setPackagePreview(null)}
              onCommitProject={async (proj) => {
                await store.commitImportedProject(proj);
              }}
              onImportCompleted={(outcome) => {
                void store.refreshRevisions();
                setIsProjectHubOpen(false);
                setIsExportModalOpen(false);
                const verb = outcome.mode === 'new' ? 'Nhập bản mới' : 'Ghi đè';
                const extraParts: string[] = [];
                if (outcome.restoredCustomDevices > 0) {
                  extraParts.push(`${outcome.restoredCustomDevices} thiết bị mẫu`);
                }
                if (outcome.restoredRevisions > 0) {
                  extraParts.push(`${outcome.restoredRevisions} mốc lịch sử`);
                }
                if (outcome.restoredCadDocuments > 0) {
                  extraParts.push(`${outcome.restoredCadDocuments} bản vẽ CAD`);
                }
                const extraNote = extraParts.length > 0 ? ` (+ ${extraParts.join(', ')})` : '';
                showToast(`${verb} "${outcome.projectName}" thành công${extraNote}!`, 'success', 4200);
              }}
            />
          )}
        </Suspense>

        {/* One-time What's New v3.1.0 notice for returning users */}
        {showWhatsNewModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Có gì mới trên phiên bản ${APP_VERSION}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 no-print"
          >
            <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#155EEF] text-white flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                      Có gì mới trên HACHIHI v{APP_VERSION}
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Nâng cấp điều hướng gọn, dự toán BOM &amp; thương hiệu HACHIHI
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowWhatsNewModal(false);
                    try {
                      localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                    } catch {
                      // ignore
                    }
                  }}
                  aria-label="Đóng thông báo phiên bản mới"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-2.5">
                {CHANGELOG_HIGHLIGHTS_310.map((line, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowWhatsNewModal(false);
                    try {
                      localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                    } catch {
                      // ignore
                    }
                    setIsAboutModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#155EEF]"
                >
                  Giới thiệu HACHIHI
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWhatsNewModal(false);
                    try {
                      localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                    } catch {
                      // ignore
                    }
                  }}
                  className="px-4 py-1.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white text-xs font-semibold"
                >
                  Bắt đầu thiết kế
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
