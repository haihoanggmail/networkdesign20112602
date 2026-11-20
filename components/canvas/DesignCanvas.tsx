import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  ProjectState,
  SelectionState,
  DiagramNode,
  CableEdge,
  CablePoint,
  Room,
  ServerRack,
  RackSide,
  CableTray
} from '../../types/infrastructure';
import { CanvasTool, SmartCopyPasteOptions } from '../../store/useProjectStore';
import {
  computeCablePath,
  computeBundledCablePath,
  computeCableBundleLayout,
  CableBundleInfo,
  CableBundleLayout,
  RectBox
} from '../../utils/cableRouting';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import {
  CAMERA_FOV_SCALE_FACTOR,
  buildArcSvgPath,
  buildSectorSvgPath,
  cameraRangeMetersToCanvasPx,
  clampCameraFovDeg,
  clampCameraRangeMeters,
  clampWifiAngleDeg,
  clampWifiRadiusMeters,
  computeSectorAreaSqm,
  normalizeRotationDeg,
  resolveCameraFov,
  resolveWifiCoverage,
  signedAngularDiffDeg,
  wifiRadiusMetersToCanvasPx
} from '../../utils/coverageUtils';
import {
  computeSmartSnap,
  detectOverlappingNodes,
  AlignRect,
  AlignmentGuideLine
} from '../../utils/snapGuides';
import { resolveCanvasAppearance, processCanvasBackgroundImage } from '../../utils/canvasBackgrounds';
import { pickBestCompatiblePortPair } from '../../utils/portCompatibility';
import {
  getLockedLayerSet,
  isNodeEffectivelyLocked,
  isRoomEffectivelyLocked,
  isTrayEffectivelyLocked,
  resolveNodeLayer
} from '../../utils/layerPolicy';
import {
  CANVAS_RACK_HEADER_H,
  getAssetUHeight,
  getEffectiveRackDisplayHeight,
  getPresetUHeight,
  getRackCanvasMetrics,
  isRackNodeCollapsed,
  pixelYToRackU,
  canPlaceDeviceAtU,
  getSlotSpanRect,
  isRackMountedTopologyShadowNode,
  layoutRackNodesForElevationMode
} from '../../utils/rackGeometry';
import {
  CanvasCableGeometry,
  DraggingRackDeviceState,
  DraggingRoomState,
  DraggingWaypointState,
  RackDropHit,
  ReconnectingCableState,
  ResizeHandleDir,
  ResizeSessionState
} from './canvasTypes';
import {
  Quadtree,
  computePolylineBounds,
  computeWorldViewportRect,
  computeZoomToPointerPan,
  cullEntitiesWithQuadtree,
  hitTestCablePolyline
} from '../../utils/spatialIndex';
import {
  CanvasCableRasterLayer,
  CanvasCablesLayer,
  CanvasTraysLayer,
  filterCableBundlesInViewport,
  shouldUseRasterCableLayer
} from './CanvasCablesLayer';
import { CanvasRackNode } from './CanvasRackNode';
import { CanvasLegendNode } from './CanvasLegendNode';
import { CanvasDeviceNode } from './CanvasDeviceNode';
import { CanvasRoomNode } from './CanvasRoomNode';
import { CanvasSelectionOverlays } from './CanvasSelectionOverlays';
import { CanvasHudControls, TouchContextMenuState } from './CanvasHudControls';
import { CanvasGuideOverlay } from './CanvasGuideOverlay';
import { RackSubDeviceTooltip, HoveredRackSubDeviceInfo } from './RackSubDeviceTooltip';
import type { CADDocument } from '../../cad/core/CADTypes';
import { computeCadUnderlayDistance } from '../../cad/core/CADUnderlayTransform';
import { snapCanvasPointToCadUnderlay } from '../../cad/geometry/CADUnderlaySnap';
import { renderCadUnderlayOnNetworkCanvas } from '../../cad/rendering/CADCanvasRenderer';
import { resolveCanvasPerformancePolicy } from '../../utils/canvasPerformance';

interface DesignCanvasProps {
  project: ProjectState;
  selection: SelectionState;
  activeTool: CanvasTool;
  zoom: number;
  pan: { x: number; y: number };
  connectingSource: { nodeId: string; portId?: string } | null;
  draggedPresetName?: string | null;
  isReadOnlyMode?: boolean;
  onSelect: (type: SelectionState['type'], id?: string, additionalIds?: string[]) => void;
  onToggleNodeSelection?: (nodeId: string) => void;
  onSelectMultipleNodes?: (nodeIds: string[]) => void;
  onBeginDragSnapshot?: () => void;
  onMoveNodesTransient?: (nodeIds: string[], dx: number, dy: number) => void;
  onSnapNodesAndCommitDrag?: (nodeIds: string[], options?: { snapX?: boolean; snapY?: boolean }) => void;
  onMoveNode: (nodeId: string, dx: number, dy: number) => void;
  onResizeNodeTransient?: (nodeId: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onSnapNodeResizeAndCommit?: (nodeId: string) => void;
  onMoveRoomTransient?: (roomId: string, dx: number, dy: number) => void;
  onResizeRoomTransient?: (roomId: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onSnapRoomAndCommit?: (roomId: string) => void;
  onUpdateNode?: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onSetNodeIconOrLogo?: (nodeId: string, payload: { customIcon?: string; customImageUrl?: string }) => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  smartClipboardNodeIds?: string[];
  onSmartCopyPasteNodes?: (nodeIds?: string[], options?: SmartCopyPasteOptions) => void;
  onCopyNodesToClipboard?: (nodeIds: string[]) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onAddTextNode?: (x: number, y: number) => void;
  onSetTool?: (tool: CanvasTool) => void;
  onAddCable: (sourceNodeId: string, targetNodeId: string, sourcePortId?: string, targetPortId?: string) => void;
  onUpdateCableControlPoints?: (cableId: string, controlPoints: CablePoint[]) => void;
  onUpdateCable?: (cableId: string, partial: Partial<CableEdge>) => void;
  onSetCableColor?: (cableId: string, color: string) => void;
  onReconnectCableEndpoint?: (cableId: string, endpoint: 'source' | 'target', newNodeId: string) => void;
  onSetConnectingSource: (src: { nodeId: string; portId?: string } | null) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onOpenDeepInspect: (id: string) => void;
  onAddRoom: (room: Omit<Room, 'id'>) => void;
  onAddCableTray?: (tray: Omit<CableTray, 'id'>) => void;
  onMoveCableTrayVertexTransient?: (trayId: string, vertexIndex: number, pos: { x: number; y: number }) => void;
  onMoveCableTrayTransient?: (trayId: string, dx: number, dy: number) => void;
  onSnapCableTrayAndCommit?: (trayId: string) => void;
  onDeleteSelected: () => void;
  onDropDevice: (presetName: string, x: number, y: number) => void;
  onDropDeviceIntoRack?: (presetName: string, rackId: string, preferredU: number, side?: RackSide) => void;
  onAssignDeviceToRackSlot?: (rackId: string, assetId: string, preferredU: number, side?: RackSide) => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onUpdateWifiCoverageRadiusTransient?: (nodeId: string, radiusMeters: number) => void;
  onUpdateWifiCoverageTransient?: (nodeId: string, partial: { radiusMeters?: number; angleDeg?: number }) => void;
  onUpdateCameraFovTransient?: (nodeId: string, partial: { fovAngle?: number; irDistanceMeters?: number }) => void;
  onRotateNodesTransient?: (nodeIds: string[], rotationDeg: number) => void;
  onRotateNodes?: (nodeIds: string[], rotationDeg: number) => void;
  onMirrorNodes?: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  onUpdateSettings?: (partial: Partial<ProjectState['settings']>) => void;
  onResizeLegendToFit?: (nodeId: string) => void;
  onAutoRouteCable?: (cableId: string) => void;
  onOpenCommandPalette?: () => void;
  onOpenTemplates?: () => void;
  onAddQuickDevice?: () => void;
  onOpenBuildingGenerator?: () => void;
  onSetActiveFloor?: (floorId: string) => void;
  onCloneFloor?: (floorId: string, newLevel: number, newName: string) => void;
  onNudgeNodes?: (nodeIds: string[], dx: number, dy: number) => void;
  showMinimap?: boolean;
  showBgMenu?: boolean;
  onSetShowBgMenu?: React.Dispatch<React.SetStateAction<boolean>>;
  cadUnderlayDoc?: CADDocument | null;
}

export const DesignCanvas: React.FC<DesignCanvasProps> = ({
  project,
  selection,
  activeTool,
  zoom,
  pan,
  connectingSource,
  draggedPresetName,
  isReadOnlyMode = false,
  onSelect,
  onToggleNodeSelection,
  onSelectMultipleNodes,
  onBeginDragSnapshot,
  onMoveNodesTransient,
  onSnapNodesAndCommitDrag,
  onMoveNode,
  onResizeNodeTransient,
  onSnapNodeResizeAndCommit,
  onMoveRoomTransient,
  onResizeRoomTransient,
  onSnapRoomAndCommit,
  onUpdateNode,
  onSetNodeIconOrLogo,
  onDuplicateNodes,
  smartClipboardNodeIds,
  onSmartCopyPasteNodes,
  onCopyNodesToClipboard,
  onToggleNodeLock,
  onToggleNodeVisibility,
  onAddTextNode,
  onSetTool,
  onAddCable,
  onUpdateCableControlPoints,
  onUpdateCable,
  onSetCableColor,
  onReconnectCableEndpoint,
  onSetConnectingSource,
  onPanChange,
  onZoomChange,
  onOpenDeepInspect,
  onAddRoom,
  onAddCableTray,
  onMoveCableTrayVertexTransient,
  onMoveCableTrayTransient,
  onSnapCableTrayAndCommit,
  onDeleteSelected,
  onDropDevice,
  onDropDeviceIntoRack,
  onAssignDeviceToRackSlot,
  onRemoveDeviceFromRackSlot,
  onUpdateWifiCoverageRadiusTransient,
  onUpdateWifiCoverageTransient,
  onUpdateCameraFovTransient,
  onRotateNodesTransient,
  onRotateNodes,
  onMirrorNodes,
  onUpdateSettings,
  onResizeLegendToFit,
  onAutoRouteCable,
  onOpenCommandPalette,
  onOpenTemplates,
  onAddQuickDevice,
  onOpenBuildingGenerator,
  onSetActiveFloor,
  onCloneFloor,
  onNudgeNodes,
  showMinimap: controlledShowMinimap,
  showBgMenu: controlledShowBgMenu,
  onSetShowBgMenu: controlledOnSetShowBgMenu,
  cadUnderlayDoc
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const cadUnderlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 1200, h: 720 });
  const [internalShowBgMenu, setInternalShowBgMenu] = useState(false);
  const showMinimap = controlledShowMinimap ?? true;
  const showBgMenu = controlledShowBgMenu ?? internalShowBgMenu;
  const setShowBgMenu = controlledOnSetShowBgMenu ?? setInternalShowBgMenu;
  const [bgUploadError, setBgUploadError] = useState<string | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const cadUnderlayLastDrawRef = useRef<number>(0);
  const perfPolicy = useMemo(
    () =>
      resolveCanvasPerformancePolicy(project.settings.canvasPerformanceMode, {
        nodeCount: project.nodes.length,
        cableCount: project.cables.length,
        rackCount: project.racks.length,
        roomCount: project.rooms.length,
        trayCount: project.cableTrays?.length || 0,
        cadEntityCount: cadUnderlayDoc?.entities.length || 0,
        zoom,
        isPanning
      }),
    [
      project.settings.canvasPerformanceMode,
      project.nodes.length,
      project.cables.length,
      project.racks.length,
      project.rooms.length,
      project.cableTrays?.length,
      cadUnderlayDoc?.entities.length,
      zoom,
      isPanning
    ]
  );

  // Render AutoCAD Underlay on locked background canvas layer (throttled in Field Mode)
  useEffect(() => {
    const drawUnderlay = () => {
      const canvas = cadUnderlayCanvasRef.current;
      if (!canvas) return;
      const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const dpr = Math.min(perfPolicy.maxDpr, rawDpr);
      const w = Math.max(1, viewportSize.w);
      const h = Math.max(1, viewportSize.h);
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (cadUnderlayDoc && cadUnderlayDoc.underlay.enabled) {
        renderCadUnderlayOnNetworkCanvas(ctx, cadUnderlayDoc, pan, zoom, w, h);
      }
    };

    if (perfPolicy.redrawThrottleMs <= 0) {
      drawUnderlay();
      return;
    }

    const now = performance.now();
    const elapsed = now - cadUnderlayLastDrawRef.current;
    if (elapsed >= perfPolicy.redrawThrottleMs) {
      cadUnderlayLastDrawRef.current = now;
      drawUnderlay();
      return;
    }

    const timer = window.setTimeout(() => {
      cadUnderlayLastDrawRef.current = performance.now();
      drawUnderlay();
    }, Math.max(1, perfPolicy.redrawThrottleMs - elapsed));
    return () => window.clearTimeout(timer);
  }, [cadUnderlayDoc, pan, zoom, viewportSize.w, viewportSize.h, perfPolicy.maxDpr, perfPolicy.redrawThrottleMs]);

  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const activePointerIdRef = useRef<number | null>(null);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    dist: number;
    midX: number;
    midY: number;
    zoom: number;
    panX: number;
    panY: number;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [touchContextMenu, setTouchContextMenu] = useState<TouchContextMenuState | null>(null);

  const [draggingNodeIds, setDraggingNodeIds] = useState<string[] | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuideLine[]>([]);
  const nodeDragSessionRef = useRef<{
    originClientX: number;
    originClientY: number;
    initialPositions: Map<string, { x: number; y: number }>;
  } | null>(null);

  const [resizingSession, setResizingSession] = useState<ResizeSessionState | null>(null);
  const [wifiResizeSession, setWifiResizeSession] = useState<{
    nodeId: string;
    centerX: number;
    centerY: number;
    mode: 'radius' | 'angle';
    currentMeters: number;
    currentAngleDeg: number;
    nodeRotationDeg: number;
  } | null>(null);
  const [cameraFovSession, setCameraFovSession] = useState<{
    nodeId: string;
    centerX: number;
    centerY: number;
    mode: 'range' | 'angle';
    currentRangeMeters: number;
    currentFovAngle: number;
    nodeRotationDeg: number;
  } | null>(null);
  const [rotationDragSession, setRotationDragSession] = useState<{
    nodeId: string;
    centerX: number;
    centerY: number;
    currentDeg: number;
  } | null>(null);
  const [draggingRoom, setDraggingRoom] = useState<DraggingRoomState | null>(null);

  const [hoveredRackSubDevice, setHoveredRackSubDevice] = useState<HoveredRackSubDeviceInfo | null>(null);
  const rackTooltipCloseTimerRef = useRef<number | null>(null);
  const clearRackTooltipTimer = useCallback(() => {
    if (rackTooltipCloseTimerRef.current !== null) {
      window.clearTimeout(rackTooltipCloseTimerRef.current);
      rackTooltipCloseTimerRef.current = null;
    }
  }, []);
  const handleHoverRackSubDevice = useCallback(
    (info: HoveredRackSubDeviceInfo | null) => {
      clearRackTooltipTimer();
      if (info) {
        setHoveredRackSubDevice(info);
      } else {
        rackTooltipCloseTimerRef.current = window.setTimeout(() => {
          setHoveredRackSubDevice(null);
          rackTooltipCloseTimerRef.current = null;
        }, 140);
      }
    },
    [clearRackTooltipTimer]
  );
  useEffect(() => {
    return () => {
      clearRackTooltipTimer();
    };
  }, [clearRackTooltipTimer]);

  const [iconPickerNodeId, setIconPickerNodeId] = useState<string | null>(null);
  const [iconPickerTab, setIconPickerTab] = useState<'icons' | 'isometric' | 'logos' | 'upload'>('icons');
  const [nodeIconUploadError, setNodeIconUploadError] = useState<string | null>(null);

  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [rackSides, setRackSides] = useState<Record<string, RackSide>>({});
  const [draggingRackDevice, setDraggingRackDevice] = useState<DraggingRackDeviceState | null>(null);
  const [rackDropPreview, setRackDropPreview] = useState<RackDropHit | null>(null);

  const [draggingWaypoint, setDraggingWaypoint] = useState<DraggingWaypointState | null>(null);
  const [reconnectingCable, setReconnectingCable] = useState<ReconnectingCableState | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredCableId, setHoveredCableId] = useState<string | null>(null);
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [collapsedBundleIds, setCollapsedBundleIds] = useState<Set<string>>(() => new Set());
  const [editingCableLabel, setEditingCableLabel] = useState<{
    cableId: string;
    value: string;
    canvasX: number;
    canvasY: number;
  } | null>(null);

  const [isDrawingRoom, setIsDrawingRoom] = useState(false);
  const [roomStartPos, setRoomStartPos] = useState<{ x: number; y: number } | null>(null);
  const [trayDraftPoints, setTrayDraftPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [draggingTrayVertex, setDraggingTrayVertex] = useState<{
    trayId: string;
    vertexIndex: number;
  } | null>(null);
  const [draggingTray, setDraggingTray] = useState<{
    trayId: string;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  const [measureSession, setMeasureSession] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
    locked: boolean;
  } | null>(null);
  const [cadSnapHit, setCadSnapHit] = useState<{
    point: { x: number; y: number };
    mode: string;
    labelVi: string;
  } | null>(null);
  const [currentMouseCanvas, setCurrentMouseCanvas] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [pendingConnection, setPendingConnection] = useState<{
    sourceNodeId: string;
    targetNodeId: string;
    sourcePortId?: string;
    targetPortId?: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [confirmToolbarDelete, setConfirmToolbarDelete] = useState<string | null>(null);

  const isSpacePressed = useRef(false);

  useEffect(() => {
    if (activeTool !== 'tray') {
      setTrayDraftPoints([]);
    }
  }, [activeTool]);

  const commitTrayDraft = useCallback(
    (overridePoints?: Array<{ x: number; y: number }>) => {
      const pts = overridePoints ?? trayDraftPoints;
      if (pts.length >= 2 && onAddCableTray) {
        onAddCableTray({
          name: `Máng cáp #${(project.cableTrays?.length || 0) + 1}`,
          floorId: project.activeFloorId || undefined,
          kind: project.activeMode === 'electrical' ? 'power_tray' : 'network_tray',
          widthPx: 18,
          points: pts
        });
      }
      setTrayDraftPoints([]);
    },
    [onAddCableTray, project.activeFloorId, project.activeMode, project.cableTrays?.length, trayDraftPoints]
  );

  // Clear edit-only overlays if Read-Only mode is turned on
  useEffect(() => {
    if (isReadOnlyMode) {
      setIconPickerNodeId(null);
      setPendingConnection(null);
      setEditingCableLabel(null);
      setConfirmToolbarDelete(null);
      setDraggingNodeIds(null);
      setResizingSession(null);
      setWifiResizeSession(null);
      setDraggingRoom(null);
      setDraggingTrayVertex(null);
      setDraggingTray(null);
      setTrayDraftPoints([]);
      setDraggingWaypoint(null);
      setReconnectingCable(null);
      setIsDrawingRoom(false);
      setShowBgMenu(false);
    }
  }, [isReadOnlyMode]);

  useEffect(() => {
    setConfirmToolbarDelete(null);
    if (iconPickerNodeId && (selection.type !== 'node' || selection.id !== iconPickerNodeId)) {
      setIconPickerNodeId(null);
      setNodeIconUploadError(null);
    }
  }, [iconPickerNodeId, selection.type, selection.id]);

  useEffect(() => {
    if (editingCableLabel && (selection.type !== 'edge' || selection.id !== editingCableLabel.cableId)) {
      setEditingCableLabel(null);
    }
  }, [editingCableLabel, selection.type, selection.id]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  const openContextMenuAt = useCallback(
    (
      clientX: number,
      clientY: number,
      kind: 'node' | 'edge' | 'canvas',
      id: string,
      targetNodeIds?: string[]
    ) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const localX = rect ? clientX - rect.left : clientX;
      const localY = rect ? clientY - rect.top : clientY;
      setTouchContextMenu({
        kind,
        id,
        x: Math.max(12, Math.min(viewportSize.w - 268, localX - 24)),
        y: Math.max(12, Math.min(viewportSize.h - 280, localY - 12)),
        targetNodeIds,
        canvasX: (localX - pan.x) / zoom,
        canvasY: (localY - pan.y) / zoom
      });
    },
    [pan.x, pan.y, viewportSize.h, viewportSize.w, zoom]
  );

  const scheduleLongPress = useCallback(
    (clientX: number, clientY: number, kind: 'node' | 'edge', id: string) => {
      clearLongPressTimer();
      longPressOriginRef.current = { x: clientX, y: clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressOriginRef.current = null;
        setDraggingNodeIds(null);
        nodeDragSessionRef.current = null;
        setAlignmentGuides([]);
        onSelect(kind, id);
        openContextMenuAt(clientX, clientY, kind, id, kind === 'node' ? [id] : undefined);
      }, 480);
    },
    [clearLongPressTimer, onSelect, openContextMenuAt]
  );

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const openInlineCableLabelEditor = useCallback((cable: CableEdge, canvasX: number, canvasY: number) => {
    if (isReadOnlyMode || !onUpdateCable) return;
    onSelect('edge', cable.id);
    setEditingCableLabel({
      cableId: cable.id,
      value: cable.label || '',
      canvasX,
      canvasY
    });
  }, [isReadOnlyMode, onSelect, onUpdateCable]);

  const commitInlineCableLabel = useCallback(() => {
    if (!editingCableLabel) return;
    const trimmed = editingCableLabel.value.trim();
    onUpdateCable?.(editingCableLabel.cableId, { label: trimmed || undefined });
    setEditingCableLabel(null);
  }, [editingCableLabel, onUpdateCable]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      setViewportSize({ w: el.clientWidth || 1200, h: el.clientHeight || 720 });
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const obs = new ResizeObserver(updateSize);
      obs.observe(el);
      return () => obs.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const selectedNodeIds = useMemo(() => {
    if (selection.type !== 'node' || !selection.id) return [];
    return [selection.id, ...(selection.additionalIds || [])];
  }, [selection]);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, DiagramNode>();
    for (const n of project.nodes) m.set(n.id, n);
    return m;
  }, [project.nodes]);

  const floorplanRackNodes = useMemo(() => {
    return project.nodes.filter(n => !n.hidden && n.type === 'rack' && n.diagramMode === 'floorplan');
  }, [project.nodes]);

  const visibleNodes = useMemo(() => {
    const raw = project.nodes.filter(n => {
      if (n.hidden) return false;
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
        if (n.floorId && project.activeFloorId && n.floorId !== project.activeFloorId) {
          return false;
        }
        if (isRackMountedTopologyShadowNode(n, project.assets, floorplanRackNodes, project.racks)) {
          return false;
        }
      }
      if (project.activeMode === 'rack') {
        return n.diagramMode === 'rack' || n.type === 'rack';
      }
      return true;
    });
    if (project.activeMode === 'rack') {
      const rackNodes = raw.filter(
        n => n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack')
      );
      const nonRackNodes = raw.filter(
        n => !(n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack'))
      );
      return [...layoutRackNodesForElevationMode(rackNodes, project.racks), ...nonRackNodes];
    }
    return raw;
  }, [project.nodes, project.activeMode, project.activeFloorId, project.assets, project.racks, floorplanRackNodes]);

  const hiddenLayerSet = useMemo(
    () => new Set(project.settings.hiddenLayers || []),
    [project.settings.hiddenLayers]
  );

  const lockedLayerSet = useMemo(
    () => getLockedLayerSet(project.settings),
    [project.settings.lockedLayers]
  );

  const visibleRackNodes = useMemo(() => {
    if (hiddenLayerSet.has('racks')) return [];
    return visibleNodes.filter(
      n => n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack')
    );
  }, [visibleNodes, project.assets, hiddenLayerSet]);

  const visibleDeviceNodes = useMemo(() => {
    return visibleNodes.filter(n => {
      if (n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack')) {
        return false;
      }
      const layer = resolveNodeLayer(n, project.assets);
      return !hiddenLayerSet.has(layer);
    });
  }, [visibleNodes, project.assets, hiddenLayerSet]);

  const visibleCableTrays = useMemo(() => {
    if (hiddenLayerSet.has('trays') || project.activeMode === 'rack') return [];
    return (project.cableTrays || []).filter(t => {
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
        if (t.floorId && project.activeFloorId && t.floorId !== project.activeFloorId) {
          return false;
        }
      }
      return t.points && t.points.length >= 2;
    });
  }, [project.cableTrays, project.activeMode, project.activeFloorId, hiddenLayerSet]);

  const lastOverlapReportRef = useRef<ReturnType<typeof detectOverlappingNodes> | null>(null);
  const isGeometryTransforming = Boolean((draggingNodeIds && draggingNodeIds.length > 0) || resizingSession);
  const overlapReport = useMemo(() => {
    if (isGeometryTransforming && lastOverlapReportRef.current) {
      return lastOverlapReportRef.current;
    }
    const activeRects = [...visibleRackNodes, ...visibleDeviceNodes]
      .filter(n => n.type !== 'text')
      .map(n => ({
        id: n.id,
        label: n.label,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.type === 'rack' ? getEffectiveRackDisplayHeight(n) : n.height
      }));
    const report = detectOverlappingNodes(activeRects, 2);
    lastOverlapReportRef.current = report;
    return report;
  }, [visibleRackNodes, visibleDeviceNodes, isGeometryTransforming]);

  const deviceQuadtree = useMemo(() => {
    if (visibleDeviceNodes.length <= perfPolicy.cullingThresholds.devices) return null;
    return Quadtree.fromItems(visibleDeviceNodes, n => ({
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height
    }));
  }, [visibleDeviceNodes, perfPolicy.cullingThresholds.devices]);

  const worldViewportRect = useMemo(
    () => computeWorldViewportRect(pan, zoom, viewportSize, perfPolicy.cullBufferPx),
    [pan.x, pan.y, zoom, viewportSize.w, viewportSize.h, perfPolicy.cullBufferPx]
  );

  const trayQuadtree = useMemo(() => {
    if (visibleCableTrays.length <= perfPolicy.cullingThresholds.trays) return null;
    return Quadtree.fromItems(visibleCableTrays, t =>
      computePolylineBounds(t.points, Math.max(24, (t.widthPx || 16) + 12))
    );
  }, [visibleCableTrays, perfPolicy.cullingThresholds.trays]);

  const culledVisibleCableTrays = useMemo(() => {
    if (!trayQuadtree || visibleCableTrays.length <= perfPolicy.cullingThresholds.trays) return visibleCableTrays;
    return cullEntitiesWithQuadtree(trayQuadtree, visibleCableTrays, worldViewportRect);
  }, [trayQuadtree, visibleCableTrays, worldViewportRect, perfPolicy.cullingThresholds.trays]);

  const culledDeviceNodes = useMemo(() => {
    if (!deviceQuadtree || visibleDeviceNodes.length <= perfPolicy.cullingThresholds.devices) return visibleDeviceNodes;
    return cullEntitiesWithQuadtree(
      deviceQuadtree,
      visibleDeviceNodes,
      worldViewportRect,
      n =>
        n.type === 'legend' ||
        selectedNodeIdSet.has(n.id) ||
        connectingSource?.nodeId === n.id ||
        hoveredNodeId === n.id
    );
  }, [deviceQuadtree, visibleDeviceNodes, worldViewportRect, perfPolicy.cullingThresholds.devices, selectedNodeIdSet, connectingSource, hoveredNodeId]);

  const rackByIdMap = useMemo(() => {
    const map = new Map<string, ServerRack>();
    for (const r of project.racks) {
      map.set(r.id, r);
    }
    return map;
  }, [project.racks]);

  const rackByNameMap = useMemo(() => {
    const map = new Map<string, ServerRack>();
    for (const r of project.racks) {
      if (r.name && !map.has(r.name)) {
        map.set(r.name, r);
      }
    }
    return map;
  }, [project.racks]);

  const resolveRackForNode = useCallback((rackNode: DiagramNode): ServerRack | undefined => {
    const customRackId = rackNode.customData?.rackId;
    if (customRackId) {
      const byCustom = rackByIdMap.get(customRackId);
      if (byCustom) return byCustom;
    }
    const byNodeId = rackByIdMap.get(rackNode.id);
    if (byNodeId) return byNodeId;
    if (rackNode.assetId) {
      const asset = project.assets[rackNode.assetId];
      if (asset) {
        const byAsset = rackByIdMap.get(asset.id);
        if (byAsset) return byAsset;
      }
    }
    return rackNode.label ? rackByNameMap.get(rackNode.label) : undefined;
  }, [rackByIdMap, rackByNameMap, project.assets]);

  const visibleNodeMap = useMemo(() => {
    const map = new Map<string, DiagramNode>();
    for (const n of visibleNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [visibleNodes]);

  const rackNodeByRackIdMap = useMemo(() => {
    const map = new Map<string, DiagramNode>();
    for (const rn of visibleRackNodes) {
      const resolved = resolveRackForNode(rn);
      if (resolved && !map.has(resolved.id)) {
        map.set(resolved.id, rn);
      }
      if (rn.customData?.rackId && !map.has(rn.customData.rackId)) {
        map.set(rn.customData.rackId, rn);
      }
      if (!map.has(rn.id)) {
        map.set(rn.id, rn);
      }
    }
    return map;
  }, [visibleRackNodes, resolveRackForNode]);

  const visibleRooms = useMemo(() => {
    if (hiddenLayerSet.has('rooms')) return [];
    return project.rooms.filter(r => {
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
        if (r.floorId && project.activeFloorId && r.floorId !== project.activeFloorId) {
          return false;
        }
      }
      return true;
    });
  }, [project.rooms, project.activeMode, project.activeFloorId, hiddenLayerSet]);

  const rackQuadtree = useMemo(() => {
    if (visibleRackNodes.length <= perfPolicy.cullingThresholds.racks) return null;
    return Quadtree.fromItems(visibleRackNodes, rn => ({
      x: rn.x,
      y: rn.y,
      width: rn.width,
      height: getEffectiveRackDisplayHeight(rn)
    }));
  }, [visibleRackNodes, perfPolicy.cullingThresholds.racks]);

  const culledRackNodes = useMemo(() => {
    if (!rackQuadtree || visibleRackNodes.length <= perfPolicy.cullingThresholds.racks) return visibleRackNodes;
    return cullEntitiesWithQuadtree(
      rackQuadtree,
      visibleRackNodes,
      worldViewportRect,
      rn =>
        selectedNodeIdSet.has(rn.id) ||
        (selection.type === 'rack' && resolveRackForNode(rn)?.id === selection.id) ||
        connectingSource?.nodeId === rn.id ||
        hoveredNodeId === rn.id ||
        Boolean(draggingNodeIds?.includes(rn.id)) ||
        Boolean(resizingSession?.targetKind === 'node' && resizingSession.targetId === rn.id)
    );
  }, [
    rackQuadtree,
    visibleRackNodes,
    worldViewportRect,
    perfPolicy.cullingThresholds.racks,
    selectedNodeIdSet,
    selection.type,
    selection.id,
    resolveRackForNode,
    connectingSource,
    hoveredNodeId,
    draggingNodeIds,
    resizingSession
  ]);

  const roomQuadtree = useMemo(() => {
    if (visibleRooms.length <= perfPolicy.cullingThresholds.rooms) return null;
    return Quadtree.fromItems(visibleRooms, r => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height
    }));
  }, [visibleRooms, perfPolicy.cullingThresholds.rooms]);

  const culledVisibleRooms = useMemo(() => {
    if (!roomQuadtree || visibleRooms.length <= perfPolicy.cullingThresholds.rooms) return visibleRooms;
    return cullEntitiesWithQuadtree(
      roomQuadtree,
      visibleRooms,
      worldViewportRect,
      r =>
        (selection.type === 'room' && selection.id === r.id) ||
        draggingRoom?.roomId === r.id ||
        Boolean(resizingSession?.targetKind === 'room' && resizingSession.targetId === r.id)
    );
  }, [
    roomQuadtree,
    visibleRooms,
    worldViewportRect,
    perfPolicy.cullingThresholds.rooms,
    selection.type,
    selection.id,
    draggingRoom,
    resizingSession
  ]);

  const groupBounds = useMemo(() => {
    const groups = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();
    for (const n of visibleDeviceNodes) {
      if (!n.groupId) continue;
      const g = groups.get(n.groupId);
      if (!g) {
        groups.set(n.groupId, {
          minX: n.x,
          minY: n.y,
          maxX: n.x + n.width,
          maxY: n.y + n.height,
          count: 1
        });
      } else {
        g.minX = Math.min(g.minX, n.x);
        g.minY = Math.min(g.minY, n.y);
        g.maxX = Math.max(g.maxX, n.x + n.width);
        g.maxY = Math.max(g.maxY, n.y + n.height);
        g.count++;
      }
    }
    return Array.from(groups.entries()).filter(([, b]) => b.count >= 2);
  }, [visibleDeviceNodes]);

  const getNodeEffectiveRect = useCallback((nodeId: string): { x: number; y: number; width: number; height: number } | null => {
    const visibleDirect = visibleNodeMap.get(nodeId);
    if (visibleDirect) {
      return {
        x: visibleDirect.x,
        y: visibleDirect.y,
        width: visibleDirect.width,
        height: visibleDirect.type === 'rack' ? getEffectiveRackDisplayHeight(visibleDirect) : visibleDirect.height
      };
    }

    const anyNode = nodeMap.get(nodeId);
    if (anyNode?.assetId) {
      const asset = project.assets[anyNode.assetId];
      if (asset?.rackId && asset.rackUnitStart) {
        const rackNode = rackNodeByRackIdMap.get(asset.rackId);
        const rack = rackNode ? resolveRackForNode(rackNode) : undefined;
        if (rackNode && rack) {
          if (isRackNodeCollapsed(rackNode)) {
            return {
              x: rackNode.x + 8,
              y: rackNode.y + CANVAS_RACK_HEADER_H + 6,
              width: Math.max(40, rackNode.width - 16),
              height: 24
            };
          }
          const metrics = getRackCanvasMetrics(rackNode, rack.totalUnits || 42);
          const uH = getAssetUHeight(asset);
          const spanRect = getSlotSpanRect(asset.rackUnitStart, uH, metrics.units, metrics.slotH);
          return {
            x: metrics.slotsX + 2,
            y: metrics.slotsY + spanRect.top + 1,
            width: metrics.slotsWidth - 4,
            height: Math.max(8, spanRect.height - 2)
          };
        }
      }
    }
    return null;
  }, [visibleNodeMap, nodeMap, project.assets, rackNodeByRackIdMap, resolveRackForNode]);

  const resizingNodeId = resizingSession?.targetKind === 'node' ? resizingSession.targetId : null;
  const transformingNodeIdSet = useMemo(() => {
    const set = new Set<string>(draggingNodeIds || []);
    if (resizingNodeId) set.add(resizingNodeId);
    return set;
  }, [draggingNodeIds, resizingNodeId]);
  const isTransformingNodes = transformingNodeIdSet.size > 0;
  const lastVisibleCablesRef = useRef<CableEdge[] | null>(null);
  const lastCableQuadtreeRef = useRef<{ tree: Quadtree<CableEdge> | null } | null>(null);

  const visibleCables = useMemo(() => {
    if (isTransformingNodes && lastVisibleCablesRef.current) {
      return lastVisibleCablesRef.current;
    }
    const next = hiddenLayerSet.has('cables')
      ? []
      : project.cables.filter(c => Boolean(getNodeEffectiveRect(c.sourceNodeId) && getNodeEffectiveRect(c.targetNodeId)));
    lastVisibleCablesRef.current = next;
    return next;
  }, [isTransformingNodes, project.cables, getNodeEffectiveRect, hiddenLayerSet]);

  const cableQuadtree = useMemo(() => {
    if (isTransformingNodes && lastCableQuadtreeRef.current) {
      return lastCableQuadtreeRef.current.tree;
    }
    const next =
      visibleCables.length <= perfPolicy.cullingThresholds.cables
        ? null
        : Quadtree.fromItems(visibleCables, c => {
            const src = getNodeEffectiveRect(c.sourceNodeId);
            const tgt = getNodeEffectiveRect(c.targetNodeId);
            if (!src || !tgt) return null;
            let minX = Math.min(src.x, tgt.x);
            let minY = Math.min(src.y, tgt.y);
            let maxX = Math.max(src.x + src.width, tgt.x + tgt.width);
            let maxY = Math.max(src.y + src.height, tgt.y + tgt.height);
            if (c.controlPoints) {
              for (const pt of c.controlPoints) {
                if (pt.x < minX) minX = pt.x;
                if (pt.y < minY) minY = pt.y;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.y > maxY) maxY = pt.y;
              }
            }
            return {
              x: minX - 24,
              y: minY - 24,
              width: Math.max(48, maxX - minX + 48),
              height: Math.max(48, maxY - minY + 48)
            };
          });
    lastCableQuadtreeRef.current = { tree: next };
    return next;
  }, [isTransformingNodes, visibleCables, getNodeEffectiveRect, perfPolicy.cullingThresholds.cables]);

  const culledVisibleCables = useMemo(() => {
    if (!cableQuadtree || visibleCables.length <= perfPolicy.cullingThresholds.cables) return visibleCables;
    return cullEntitiesWithQuadtree(
      cableQuadtree,
      visibleCables,
      worldViewportRect,
      c =>
        (selection.type === 'edge' && selection.id === c.id) ||
        hoveredCableId === c.id ||
        transformingNodeIdSet.has(c.sourceNodeId) ||
        transformingNodeIdSet.has(c.targetNodeId)
    );
  }, [cableQuadtree, visibleCables, worldViewportRect, perfPolicy.cullingThresholds.cables, selection.type, selection.id, hoveredCableId, transformingNodeIdSet]);

  const clientToCanvasCoord = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom
    };
  }, [pan.x, pan.y, zoom]);

  const hitTestRackSlot = useCallback((
    canvasX: number,
    canvasY: number,
    unitHeight: number,
    excludeAssetId?: string
  ): RackDropHit | null => {
    for (let i = visibleRackNodes.length - 1; i >= 0; i--) {
      const rackNode = visibleRackNodes[i];
      if (isRackNodeCollapsed(rackNode)) continue;
      const rack = resolveRackForNode(rackNode);
      if (!rack) continue;

      const totalUnits = rack.totalUnits || 42;
      const metrics = getRackCanvasMetrics(rackNode, totalUnits);
      const activeSide: RackSide = rackSides[rack.id] || 'front';

      const withinX = canvasX >= rackNode.x && canvasX <= rackNode.x + rackNode.width;
      const withinY = canvasY >= metrics.slotsY - 4 && canvasY <= metrics.slotsBottomY + 4;

      if (withinX && withinY) {
        const relY = canvasY - metrics.slotsY;
        const startU = pixelYToRackU(relY, metrics.slotH, totalUnits, unitHeight);
        const valid = canPlaceDeviceAtU(rack, project.assets, startU, unitHeight, excludeAssetId, activeSide);
        return {
          rackId: rack.id,
          rackNodeId: rackNode.id,
          side: activeSide,
          startU,
          uHeight: unitHeight,
          valid
        };
      }
    }
    return null;
  }, [visibleRackNodes, resolveRackForNode, rackSides, project.assets]);

  const handleDragOver = (e: React.DragEvent) => {
    if (isReadOnlyMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    const coord = clientToCanvasCoord(e.clientX, e.clientY);
    const presetName = draggedPresetName || '';
    if (presetName && !presetName.toLowerCase().includes('rack')) {
      const uHeight = getPresetUHeight(presetName);
      setRackDropPreview(hitTestRackSlot(coord.x, coord.y, uHeight));
    } else {
      setRackDropPreview(hitTestRackSlot(coord.x, coord.y, 1));
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setRackDropPreview(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (isReadOnlyMode) return;
    e.preventDefault();
    const coord = clientToCanvasCoord(e.clientX, e.clientY);
    const presetName = e.dataTransfer.getData('presetName') || e.dataTransfer.getData('text/plain') || draggedPresetName;
    setRackDropPreview(null);

    if (!presetName) return;

    const isRackPreset = presetName.toLowerCase().includes('rack');
    if (!isRackPreset && onDropDeviceIntoRack) {
      const uHeight = getPresetUHeight(presetName);
      const hit = hitTestRackSlot(coord.x, coord.y, uHeight);
      if (hit) {
        onDropDeviceIntoRack(presetName, hit.rackId, hit.startU, hit.side);
        return;
      }
    }

    let dropX = coord.x;
    let dropY = coord.y;
    if (cadUnderlayDoc?.underlay.enabled && project.settings.snapToGrid) {
      const cadHit = snapCanvasPointToCadUnderlay(coord, cadUnderlayDoc, 12 / Math.max(0.5, zoom));
      if (cadHit) {
        dropX = cadHit.point.x;
        dropY = cadHit.point.y;
      }
    }
    onDropDevice(presetName, dropX, dropY);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      if (e.deltaY === 0) return;
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = Math.min(Math.max(0.2, zoom * zoomFactor), 3.0);
      if (nextZoom === zoom) return;

      const rect = containerRef.current?.getBoundingClientRect();
      const pointerX = rect ? e.clientX - rect.left : viewportSize.w / 2;
      const pointerY = rect ? e.clientY - rect.top : viewportSize.h / 2;
      const nextPan = computeZoomToPointerPan(pan, zoom, nextZoom, pointerX, pointerY);

      onZoomChange(nextZoom);
      onPanChange(nextPan);
    } else {
      onPanChange({
        x: pan.x - e.deltaX,
        y: pan.y - e.deltaY
      });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        isSpacePressed.current = true;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isReadOnlyMode) {
        onDeleteSelected();
      } else if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !isReadOnlyMode &&
        onNudgeNodes &&
        selectedNodeIds.length > 0
      ) {
        const unlockedIds = selectedNodeIds.filter(id => {
          const n = nodeMap.get(id);
          return n && !isNodeEffectivelyLocked(n, project.settings, project.assets, isReadOnlyMode);
        });
        if (unlockedIds.length > 0) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          onNudgeNodes(unlockedIds, dx, dy);
        }
      } else if (e.key === 'Enter' && !isReadOnlyMode && activeTool === 'tray' && trayDraftPoints.length >= 2) {
        e.preventDefault();
        commitTrayDraft();
      } else if (e.key === 'Escape') {
        onSetConnectingSource(null);
        setIsDrawingRoom(false);
        setRoomStartPos(null);
        setTrayDraftPoints([]);
        setDraggingTrayVertex(null);
        setDraggingTray(null);
        setMeasureSession(null);
        setMarqueeStart(null);
        setDraggingRackDevice(null);
        setDraggingWaypoint(null);
        setReconnectingCable(null);
        setRackDropPreview(null);
        setAlignmentGuides([]);
        nodeDragSessionRef.current = null;
        setActiveBundleId(null);
        setShowBgMenu(false);
        setIconPickerNodeId(null);
        setResizingSession(null);
        setWifiResizeSession(null);
        setCameraFovSession(null);
        setRotationDragSession(null);
        setDraggingRoom(null);
        setTouchContextMenu(null);
        setCadSnapHit(null);
        onSelect('none');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressed.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isReadOnlyMode, activeTool, trayDraftPoints.length, commitTrayDraft, onDeleteSelected, onSetConnectingSource, onSelect, onNudgeNodes, selectedNodeIds, nodeMap, project.settings, project.assets]);

  const handlePointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touchPointersRef.current.size >= 2) {
      clearLongPressTimer();
      setTouchContextMenu(null);
      setDraggingNodeIds(null);
      nodeDragSessionRef.current = null;
      setAlignmentGuides([]);
      setMarqueeStart(null);
      setDraggingWaypoint(null);
      setDraggingRoom(null);
      setResizingSession(null);
      setWifiResizeSession(null);
      setCameraFovSession(null);
      setRotationDragSession(null);

      const pts = Array.from(touchPointersRef.current.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      pinchStateRef.current = {
        dist: Math.max(12, dist),
        midX,
        midY,
        zoom,
        panX: pan.x,
        panY: pan.y
      };
    }
  };

  const handlePointerUpCapture = (e: React.PointerEvent) => {
    clearLongPressTimer();
    if (e.pointerType !== 'touch') return;
    touchPointersRef.current.delete(e.pointerId);
    if (touchPointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touchPointersRef.current.size >= 2) {
      return;
    }
    if (activePointerIdRef.current !== null && e.pointerType === 'touch') return;
    activePointerIdRef.current = e.pointerId;
    setTouchContextMenu(null);

    const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
    if (
      e.button === 1 ||
      isSpacePressed.current ||
      (isPrimary && (e.altKey || activeTool === 'pan' || isReadOnlyMode))
    ) {
      const targetTag = (e.target as HTMLElement).tagName;
      const isCanvasBackdrop =
        e.target === containerRef.current ||
        targetTag === 'svg' ||
        (e.target as HTMLElement).getAttribute('data-canvas-bg') === 'true';

      if (isReadOnlyMode && isPrimary && isCanvasBackdrop) {
        setShowBgMenu(false);
        setActiveBundleId(null);
        onSelect('canvas');
      }
      clearRackTooltipTimer();
      setHoveredRackSubDevice(null);
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (isPrimary) {
      const canvasCoord = clientToCanvasCoord(e.clientX, e.clientY);

      if (activeTool === 'measure') {
        let startPt = canvasCoord;
        if (cadUnderlayDoc?.underlay.enabled && project.settings.snapToGrid) {
          const hit = snapCanvasPointToCadUnderlay(canvasCoord, cadUnderlayDoc, 10 / Math.max(0.5, zoom));
          if (hit) {
            startPt = hit.point;
            setCadSnapHit({ point: hit.point, mode: hit.mode, labelVi: hit.labelVi });
          } else {
            setCadSnapHit(null);
          }
        }
        setMeasureSession({ start: startPt, current: startPt, locked: false });
        return;
      }

      if (!isReadOnlyMode && activeTool === 'text' && onAddTextNode) {
        onAddTextNode(canvasCoord.x, canvasCoord.y);
        onSetTool?.('select');
        return;
      }

      if (!isReadOnlyMode && activeTool === 'room') {
        setIsDrawingRoom(true);
        setRoomStartPos(canvasCoord);
        return;
      }

      if (!isReadOnlyMode && activeTool === 'tray') {
        const cadHit =
          cadUnderlayDoc?.underlay.enabled && project.settings.snapToGrid
            ? snapCanvasPointToCadUnderlay(canvasCoord, cadUnderlayDoc, 10 / Math.max(0.5, zoom))
            : null;
        const snapStep = project.settings.snapToGrid ? Math.max(5, Math.round((project.settings.gridSize || 20) / 2)) : 1;
        const snappedPt = cadHit
          ? { x: cadHit.point.x, y: cadHit.point.y }
          : {
              x: Math.round(canvasCoord.x / snapStep) * snapStep,
              y: Math.round(canvasCoord.y / snapStep) * snapStep
            };
        setCadSnapHit(cadHit ? { point: cadHit.point, mode: cadHit.mode, labelVi: cadHit.labelVi } : null);
        if (e.detail >= 2 && trayDraftPoints.length >= 1) {
          const last = trayDraftPoints[trayDraftPoints.length - 1];
          const finalPts =
            Math.hypot(snappedPt.x - last.x, snappedPt.y - last.y) > 6
              ? [...trayDraftPoints, snappedPt]
              : trayDraftPoints;
          commitTrayDraft(finalPts);
          setCadSnapHit(null);
        } else {
          setTrayDraftPoints(prev => [...prev, snappedPt]);
        }
        return;
      }

      const targetTag = (e.target as HTMLElement).tagName;
      const isCanvasBackdrop =
        e.target === containerRef.current ||
        targetTag === 'svg' ||
        (e.target as HTMLElement).getAttribute('data-canvas-bg') === 'true';

      if (isCanvasBackdrop) {
        setShowBgMenu(false);
        setIconPickerNodeId(null);
        setPendingConnection(null);
        setConfirmToolbarDelete(null);
        if (connectingSource) {
          onSetConnectingSource(null);
          return;
        }
        if (rasterCableMode) {
          const hitCable = findRasterCableAtCoord(canvasCoord.x, canvasCoord.y);
          if (hitCable) {
            onSelect('edge', hitCable.id);
            return;
          }
        }
        if (activeTool === 'select') {
          setMarqueeStart(canvasCoord);
        }
        setActiveBundleId(null);
        onSelect('canvas');
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (longPressOriginRef.current) {
        const moveDist = Math.hypot(e.clientX - longPressOriginRef.current.x, e.clientY - longPressOriginRef.current.y);
        if (moveDist > 8) {
          clearLongPressTimer();
        }
      }
      if (touchPointersRef.current.size >= 2 && pinchStateRef.current) {
        const pts = Array.from(touchPointersRef.current.values());
        const p1 = pts[0];
        const p2 = pts[1];
        const nextDist = Math.max(12, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        const nextMidX = (p1.x + p2.x) / 2;
        const nextMidY = (p1.y + p2.y) / 2;
        const start = pinchStateRef.current;
        const scale = nextDist / start.dist;
        const nextZoom = Math.min(3.0, Math.max(0.2, start.zoom * scale));

        const rect = containerRef.current?.getBoundingClientRect();
        const originLocalX = rect ? start.midX - rect.left : start.midX;
        const originLocalY = rect ? start.midY - rect.top : start.midY;
        const worldMidX = (originLocalX - start.panX) / start.zoom;
        const worldMidY = (originLocalY - start.panY) / start.zoom;
        const nextLocalX = rect ? nextMidX - rect.left : nextMidX;
        const nextLocalY = rect ? nextMidY - rect.top : nextMidY;

        const clampedZoom = Number(nextZoom.toFixed(3));
        onZoomChange(clampedZoom);
        onPanChange({
          x: nextLocalX - worldMidX * clampedZoom,
          y: nextLocalY - worldMidY * clampedZoom
        });
        return;
      }
    }

    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current && e.pointerType === 'touch') {
      return;
    }
    const canvasCoord = clientToCanvasCoord(e.clientX, e.clientY);
    setCurrentMouseCanvas(canvasCoord);

    if (isPanning) {
      onPanChange({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    if (measureSession && !measureSession.locked) {
      let currentPt = canvasCoord;
      if (cadUnderlayDoc?.underlay.enabled && project.settings.snapToGrid) {
        const hit = snapCanvasPointToCadUnderlay(canvasCoord, cadUnderlayDoc, 10 / Math.max(0.5, zoom));
        if (hit) {
          currentPt = hit.point;
          setCadSnapHit({ point: hit.point, mode: hit.mode, labelVi: hit.labelVi });
        } else {
          setCadSnapHit(null);
        }
      } else if (cadSnapHit) {
        setCadSnapHit(null);
      }
      setMeasureSession(prev => (prev ? { ...prev, current: currentPt } : null));
      return;
    }

    if (isReadOnlyMode) return;

    if (resizingSession) {
      const { initialRect, handle, originClientX, originClientY, rotationDeg, minW, minH, targetKind, targetId } = resizingSession;
      const rawDx = (e.clientX - originClientX) / zoom;
      const rawDy = (e.clientY - originClientY) / zoom;
      const radNeg = (-rotationDeg * Math.PI) / 180;
      const localDx = rotationDeg ? rawDx * Math.cos(radNeg) - rawDy * Math.sin(radNeg) : rawDx;
      const localDy = rotationDeg ? rawDx * Math.sin(radNeg) + rawDy * Math.cos(radNeg) : rawDy;

      let nextW = initialRect.width;
      let nextH = initialRect.height;
      let shiftX = 0;
      let shiftY = 0;

      if (handle.includes('e')) {
        nextW = Math.max(minW, initialRect.width + localDx);
      }
      if (handle.includes('w')) {
        nextW = Math.max(minW, initialRect.width - localDx);
        shiftX = initialRect.width - nextW;
      }
      if (handle.includes('s')) {
        nextH = Math.max(minH, initialRect.height + localDy);
      }
      if (handle.includes('n')) {
        nextH = Math.max(minH, initialRect.height - localDy);
        shiftY = initialRect.height - nextH;
      }

      if (e.shiftKey && handle.length === 2 && initialRect.height > 0) {
        const aspect = initialRect.width / initialRect.height;
        if (Math.abs(nextW - initialRect.width) >= Math.abs(nextH - initialRect.height) * aspect) {
          const targetH = Math.max(minH, nextW / aspect);
          if (handle.includes('n')) shiftY = initialRect.height - targetH;
          nextH = targetH;
        } else {
          const targetW = Math.max(minW, nextH * aspect);
          if (handle.includes('w')) shiftX = initialRect.width - targetW;
          nextW = targetW;
        }
      }

      let nextX = initialRect.x + shiftX;
      let nextY = initialRect.y + shiftY;
      if (rotationDeg) {
        const radPos = (rotationDeg * Math.PI) / 180;
        const dxCenter = shiftX + (nextW - initialRect.width) / 2;
        const dyCenter = shiftY + (nextH - initialRect.height) / 2;
        const worldCenterX = initialRect.x + initialRect.width / 2 + dxCenter * Math.cos(radPos) - dyCenter * Math.sin(radPos);
        const worldCenterY = initialRect.y + initialRect.height / 2 + dxCenter * Math.sin(radPos) + dyCenter * Math.cos(radPos);
        nextX = worldCenterX - nextW / 2;
        nextY = worldCenterY - nextH / 2;
      }

      const nextRect = {
        x: Math.max(10, Math.round(nextX)),
        y: Math.max(10, Math.round(nextY)),
        width: Math.max(minW, Math.round(nextW)),
        height: Math.max(minH, Math.round(nextH))
      };

      setResizingSession(prev => prev ? { ...prev, currentRect: nextRect } : null);
      if (targetKind === 'node') {
        onResizeNodeTransient?.(targetId, nextRect);
      } else {
        onResizeRoomTransient?.(targetId, nextRect);
      }
      return;
    }

    if (rotationDragSession) {
      const rawAngle =
        (Math.atan2(
          canvasCoord.y - rotationDragSession.centerY,
          canvasCoord.x - rotationDragSession.centerX
        ) *
          180) /
          Math.PI +
        90;
      const stepped = e.shiftKey ? Math.round(rawAngle / 15) * 15 : Math.round(rawAngle);
      const nextDeg = normalizeRotationDeg(stepped);
      setRotationDragSession(prev => (prev ? { ...prev, currentDeg: nextDeg } : null));
      if (onRotateNodesTransient) {
        onRotateNodesTransient([rotationDragSession.nodeId], nextDeg);
      } else {
        onUpdateNode?.(rotationDragSession.nodeId, { rotation: nextDeg });
      }
      return;
    }

    if (cameraFovSession) {
      if (cameraFovSession.mode === 'range') {
        const distPx = Math.hypot(
          canvasCoord.x - cameraFovSession.centerX,
          canvasCoord.y - cameraFovSession.centerY
        );
        const scale = normalizeScalePxPerMeter(project.settings.scale);
        const rawMeters = distPx / Math.max(0.01, scale * CAMERA_FOV_SCALE_FACTOR);
        const stepPrecision = e.ctrlKey ? 1 : 0.5;
        const nextMeters = clampCameraRangeMeters(
          Math.round(rawMeters / stepPrecision) * stepPrecision
        );
        setCameraFovSession(prev =>
          prev ? { ...prev, currentRangeMeters: nextMeters } : null
        );
        onUpdateCameraFovTransient?.(cameraFovSession.nodeId, {
          irDistanceMeters: nextMeters
        });
      } else {
        const pointerAngleDeg =
          (Math.atan2(
            canvasCoord.y - cameraFovSession.centerY,
            canvasCoord.x - cameraFovSession.centerX
          ) *
            180) /
          Math.PI;
        const halfDiff = Math.abs(
          signedAngularDiffDeg(cameraFovSession.nodeRotationDeg, pointerAngleDeg)
        );
        const rawFov = halfDiff * 2;
        const nextFov = clampCameraFovDeg(
          e.shiftKey ? Math.round(rawFov / 5) * 5 : Math.round(rawFov)
        );
        setCameraFovSession(prev =>
          prev ? { ...prev, currentFovAngle: nextFov } : null
        );
        onUpdateCameraFovTransient?.(cameraFovSession.nodeId, {
          fovAngle: nextFov
        });
      }
      return;
    }

    if (wifiResizeSession) {
      if (wifiResizeSession.mode === 'radius') {
        const distPx = Math.hypot(
          canvasCoord.x - wifiResizeSession.centerX,
          canvasCoord.y - wifiResizeSession.centerY
        );
        const scale = normalizeScalePxPerMeter(project.settings.scale);
        const rawMeters = distPx / scale;
        const stepPrecision = e.ctrlKey ? 1 : 0.5;
        const nextMeters = clampWifiRadiusMeters(
          Math.round(rawMeters / stepPrecision) * stepPrecision
        );
        setWifiResizeSession(prev =>
          prev ? { ...prev, currentMeters: nextMeters } : null
        );
        if (onUpdateWifiCoverageTransient) {
          onUpdateWifiCoverageTransient(wifiResizeSession.nodeId, {
            radiusMeters: nextMeters
          });
        } else {
          onUpdateWifiCoverageRadiusTransient?.(wifiResizeSession.nodeId, nextMeters);
        }
      } else {
        const pointerAngleDeg =
          (Math.atan2(
            canvasCoord.y - wifiResizeSession.centerY,
            canvasCoord.x - wifiResizeSession.centerX
          ) *
            180) /
          Math.PI;
        const halfDiff = Math.abs(
          signedAngularDiffDeg(wifiResizeSession.nodeRotationDeg, pointerAngleDeg)
        );
        const rawAngle = halfDiff * 2;
        const nextAngle = clampWifiAngleDeg(
          e.shiftKey ? Math.round(rawAngle / 15) * 15 : Math.round(rawAngle)
        );
        setWifiResizeSession(prev =>
          prev ? { ...prev, currentAngleDeg: nextAngle } : null
        );
        onUpdateWifiCoverageTransient?.(wifiResizeSession.nodeId, {
          angleDeg: nextAngle
        });
      }
      return;
    }

    if (draggingRoom) {
      const dx = (e.clientX - draggingRoom.lastClientX) / zoom;
      const dy = (e.clientY - draggingRoom.lastClientY) / zoom;
      onMoveRoomTransient?.(draggingRoom.roomId, dx, dy);
      setDraggingRoom(prev => prev ? { ...prev, lastClientX: e.clientX, lastClientY: e.clientY } : null);
      return;
    }

    if (draggingTrayVertex && onMoveCableTrayVertexTransient) {
      const cadHit =
        cadUnderlayDoc?.underlay.enabled && project.settings.snapToGrid
          ? snapCanvasPointToCadUnderlay(canvasCoord, cadUnderlayDoc, 10 / Math.max(0.5, zoom))
          : null;
      if (cadHit) {
        setCadSnapHit({ point: cadHit.point, mode: cadHit.mode, labelVi: cadHit.labelVi });
        onMoveCableTrayVertexTransient(draggingTrayVertex.trayId, draggingTrayVertex.vertexIndex, {
          x: cadHit.point.x,
          y: cadHit.point.y
        });
      } else {
        if (cadSnapHit) setCadSnapHit(null);
        const snap = project.settings.snapToGrid ? Math.max(5, Math.round((project.settings.gridSize || 20) / 2)) : 1;
        onMoveCableTrayVertexTransient(draggingTrayVertex.trayId, draggingTrayVertex.vertexIndex, {
          x: Math.round(canvasCoord.x / snap) * snap,
          y: Math.round(canvasCoord.y / snap) * snap
        });
      }
      return;
    }

    if (draggingTray && onMoveCableTrayTransient) {
      const dx = (e.clientX - draggingTray.lastClientX) / zoom;
      const dy = (e.clientY - draggingTray.lastClientY) / zoom;
      onMoveCableTrayTransient(draggingTray.trayId, dx, dy);
      setDraggingTray(prev => (prev ? { ...prev, lastClientX: e.clientX, lastClientY: e.clientY } : null));
      return;
    }

    if (draggingWaypoint && onUpdateCableControlPoints) {
      const cable = project.cables.find(c => c.id === draggingWaypoint.cableId);
      if (cable) {
        const cadHit =
          cadUnderlayDoc?.underlay.enabled && project.settings.snapToGrid
            ? snapCanvasPointToCadUnderlay(canvasCoord, cadUnderlayDoc, 10 / Math.max(0.5, zoom))
            : null;
        let sx: number;
        let sy: number;
        if (cadHit) {
          sx = cadHit.point.x;
          sy = cadHit.point.y;
          setCadSnapHit({ point: cadHit.point, mode: cadHit.mode, labelVi: cadHit.labelVi });
        } else {
          if (cadSnapHit) setCadSnapHit(null);
          const snap = project.settings.snapToGrid ? Math.max(5, Math.round(project.settings.gridSize / 2)) : 1;
          sx = Math.round(canvasCoord.x / snap) * snap;
          sy = Math.round(canvasCoord.y / snap) * snap;
        }
        const nextPts = [...(cable.controlPoints || [])];
        nextPts[draggingWaypoint.pointIndex] = { x: sx, y: sy };
        onUpdateCableControlPoints(cable.id, nextPts);
      }
      return;
    }

    if (reconnectingCable) {
      const hitNode = visibleDeviceNodes.find(
        n =>
          canvasCoord.x >= n.x &&
          canvasCoord.x <= n.x + n.width &&
          canvasCoord.y >= n.y &&
          canvasCoord.y <= n.y + n.height
      );
      setHoveredNodeId(hitNode ? hitNode.id : null);
      return;
    }

    if (draggingRackDevice) {
      const movedDist = Math.hypot(canvasCoord.x - draggingRackDevice.startX, canvasCoord.y - draggingRackDevice.startY);
      setDraggingRackDevice(prev => prev ? {
        ...prev,
        currentX: canvasCoord.x,
        currentY: canvasCoord.y,
        hasMoved: prev.hasMoved || movedDist > 4
      } : null);

      const hit = hitTestRackSlot(canvasCoord.x, canvasCoord.y, draggingRackDevice.uHeight, draggingRackDevice.assetId);
      setRackDropPreview(hit);
      return;
    }

    if (draggingNodeIds && draggingNodeIds.length > 0) {
      const session = nodeDragSessionRef.current;
      let stepDx = (e.clientX - dragStartPos.x) / zoom;
      let stepDy = (e.clientY - dragStartPos.y) / zoom;

      if (session && session.initialPositions.size > 0) {
        const rawTotalDx = (e.clientX - session.originClientX) / zoom;
        const rawTotalDy = (e.clientY - session.originClientY) / zoom;
        const draggedSet = new Set(draggingNodeIds);
        const draggedGroupIds = new Set<string>();

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let anchorId: string | null = null;

        for (const id of draggingNodeIds) {
          const n = nodeMap.get(id);
          const initPos = session.initialPositions.get(id);
          if (!n || n.locked || !initPos) continue;
          if (!anchorId) anchorId = id;
          if (n.groupId) draggedGroupIds.add(n.groupId);
          const rx = Math.max(10, initPos.x + rawTotalDx);
          const ry = Math.max(10, initPos.y + rawTotalDy);
          minX = Math.min(minX, rx);
          minY = Math.min(minY, ry);
          maxX = Math.max(maxX, rx + n.width);
          maxY = Math.max(maxY, ry + n.height);
        }

        if (anchorId && Number.isFinite(minX)) {
          const targetRects: AlignRect[] = [];
          for (const other of visibleNodes) {
            if (draggedSet.has(other.id)) continue;
            targetRects.push({
              id: other.id,
              x: other.x,
              y: other.y,
              width: other.width,
              height: other.height,
              sourceKind: 'node',
              label: other.label
            });
          }
          for (const room of visibleRooms) {
            targetRects.push({
              id: room.id,
              x: room.x,
              y: room.y,
              width: room.width,
              height: room.height,
              sourceKind: 'container',
              label: room.name
            });
          }
          for (const [grpId, b] of groupBounds) {
            if (draggedGroupIds.has(grpId)) continue;
            targetRects.push({
              id: `grp_${grpId}`,
              x: b.minX - 10,
              y: b.minY - 14,
              width: b.maxX - b.minX + 20,
              height: b.maxY - b.minY + 24,
              sourceKind: 'container',
              label: 'Nhóm'
            });
          }

          const activeFloorGuides = (project.settings.guideLines || []).filter(
            g => !g.floorId || !project.activeFloorId || g.floorId === project.activeFloorId
          );
          const snapThreshold = 8 / Math.max(0.5, Math.min(zoom, 1.5));
          const snapRes = computeSmartSnap(
            { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            targetRects,
            snapThreshold,
            activeFloorGuides
          );
          setAlignmentGuides(snapRes.guides);

          let cadDx = 0;
          let cadDy = 0;
          if (
            snapRes.dx === 0 &&
            snapRes.dy === 0 &&
            cadUnderlayDoc?.underlay.enabled &&
            project.settings.snapToGrid
          ) {
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const cadHit = snapCanvasPointToCadUnderlay(
              { x: centerX, y: centerY },
              cadUnderlayDoc,
              8 / Math.max(0.5, Math.min(zoom, 1.5))
            );
            if (cadHit) {
              cadDx = cadHit.point.x - centerX;
              cadDy = cadHit.point.y - centerY;
              setCadSnapHit({ point: cadHit.point, mode: cadHit.mode, labelVi: cadHit.labelVi });
            } else if (cadSnapHit) {
              setCadSnapHit(null);
            }
          } else if (cadSnapHit) {
            setCadSnapHit(null);
          }

          const anchorInit = session.initialPositions.get(anchorId)!;
          const anchorCurr = nodeMap.get(anchorId)!;
          const desiredAnchorX = Math.max(10, anchorInit.x + rawTotalDx + snapRes.dx + cadDx);
          const desiredAnchorY = Math.max(10, anchorInit.y + rawTotalDy + snapRes.dy + cadDy);
          stepDx = desiredAnchorX - anchorCurr.x;
          stepDy = desiredAnchorY - anchorCurr.y;
        }
      }

      if (onMoveNodesTransient) {
        onMoveNodesTransient(draggingNodeIds, stepDx, stepDy);
      } else if (draggingNodeIds.length === 1) {
        onMoveNode(draggingNodeIds[0], stepDx, stepDy);
      }
      setDragStartPos({ x: e.clientX, y: e.clientY });

      if (draggingNodeIds.length === 1) {
        const draggedNode = nodeMap.get(draggingNodeIds[0]);
        if (draggedNode && draggedNode.type !== 'rack' && draggedNode.assetId) {
          const asset = project.assets[draggedNode.assetId];
          if (asset && !['rack', 'cloud', 'telecom_tower'].includes(asset.category)) {
            const uH = getAssetUHeight(asset);
            const hit = hitTestRackSlot(canvasCoord.x, canvasCoord.y, uH, asset.id);
            setRackDropPreview(hit);
          }
        }
      }

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const margin = 36;
        let edgePanX = 0;
        let edgePanY = 0;
        if (e.clientX - rect.left < margin) edgePanX = 10;
        else if (rect.right - e.clientX < margin) edgePanX = -10;
        if (e.clientY - rect.top < margin) edgePanY = 10;
        else if (rect.bottom - e.clientY < margin) edgePanY = -10;
        if (edgePanX !== 0 || edgePanY !== 0) {
          onPanChange({ x: pan.x + edgePanX, y: pan.y + edgePanY });
        }
      }
      return;
    }

    if (
      rasterCableMode &&
      !marqueeStart &&
      !draggingRoom &&
      !draggingWaypoint &&
      !reconnectingCable &&
      !draggingRackDevice &&
      !wifiResizeSession &&
      !cameraFovSession &&
      !rotationDragSession &&
      !isDrawingRoom
    ) {
      const targetEl = e.target as HTMLElement | null;
      const isBackdropHit =
        e.target === containerRef.current ||
        targetEl?.tagName === 'svg' ||
        targetEl?.getAttribute('data-canvas-bg') === 'true';
      if (isBackdropHit) {
        const hitCable = findRasterCableAtCoord(canvasCoord.x, canvasCoord.y);
        setHoveredCableId(prev => {
          const nextId = hitCable ? hitCable.id : null;
          return prev === nextId ? prev : nextId;
        });
      }
    }
  };

  const finishPointerInteraction = (clientX: number, clientY: number) => {
    activePointerIdRef.current = null;
    const canvasCoord = clientToCanvasCoord(clientX, clientY);

    if (isPanning) {
      setIsPanning(false);
    }

    if (measureSession && !measureSession.locked) {
      let finalPt = canvasCoord;
      if (cadUnderlayDoc?.underlay.enabled && project.settings.snapToGrid) {
        const hit = snapCanvasPointToCadUnderlay(canvasCoord, cadUnderlayDoc, 10 / Math.max(0.5, zoom));
        if (hit) finalPt = hit.point;
      }
      setCadSnapHit(null);
      const distPx = Math.hypot(finalPt.x - measureSession.start.x, finalPt.y - measureSession.start.y);
      if (distPx < 6) {
        setMeasureSession(null);
      } else {
        setMeasureSession({ start: measureSession.start, current: finalPt, locked: true });
      }
      return;
    }

    if (resizingSession) {
      if (resizingSession.targetKind === 'node') {
        onSnapNodeResizeAndCommit?.(resizingSession.targetId);
      } else {
        onSnapRoomAndCommit?.(resizingSession.targetId);
      }
      setResizingSession(null);
      return;
    }

    if (rotationDragSession) {
      setRotationDragSession(null);
      onSnapNodesAndCommitDrag?.([]);
      return;
    }

    if (cameraFovSession) {
      setCameraFovSession(null);
      onSnapNodesAndCommitDrag?.([]);
      return;
    }

    if (wifiResizeSession) {
      setWifiResizeSession(null);
      onSnapNodesAndCommitDrag?.([]);
      return;
    }

    if (draggingRoom) {
      onSnapRoomAndCommit?.(draggingRoom.roomId);
      setDraggingRoom(null);
      return;
    }

    if (draggingTrayVertex) {
      setCadSnapHit(null);
      onSnapCableTrayAndCommit?.(draggingTrayVertex.trayId);
      setDraggingTrayVertex(null);
      return;
    }

    if (draggingTray) {
      onSnapCableTrayAndCommit?.(draggingTray.trayId);
      setDraggingTray(null);
      return;
    }

    if (draggingWaypoint) {
      setCadSnapHit(null);
      setDraggingWaypoint(null);
      onSnapNodesAndCommitDrag?.([]);
      return;
    }

    if (reconnectingCable) {
      const targetNode = visibleDeviceNodes.find(
        n =>
          canvasCoord.x >= n.x &&
          canvasCoord.x <= n.x + n.width &&
          canvasCoord.y >= n.y &&
          canvasCoord.y <= n.y + n.height
      );
      if (targetNode && onReconnectCableEndpoint) {
        onReconnectCableEndpoint(reconnectingCable.cableId, reconnectingCable.endpoint, targetNode.id);
      }
      setReconnectingCable(null);
      setHoveredNodeId(null);
      return;
    }

    if (marqueeStart) {
      const rx = Math.min(marqueeStart.x, canvasCoord.x);
      const ry = Math.min(marqueeStart.y, canvasCoord.y);
      const rw = Math.abs(canvasCoord.x - marqueeStart.x);
      const rh = Math.abs(canvasCoord.y - marqueeStart.y);
      setMarqueeStart(null);

      if (rw > 8 && rh > 8 && onSelectMultipleNodes) {
        const hitIds = visibleDeviceNodes
          .filter(n => n.x + n.width >= rx && n.x <= rx + rw && n.y + n.height >= ry && n.y <= ry + rh)
          .map(n => n.id);
        if (hitIds.length > 0) {
          onSelectMultipleNodes(hitIds);
        }
      }
      return;
    }

    if (draggingRackDevice) {
      if (draggingRackDevice.hasMoved) {
        const hit = hitTestRackSlot(canvasCoord.x, canvasCoord.y, draggingRackDevice.uHeight, draggingRackDevice.assetId);
        if (hit && hit.valid && onAssignDeviceToRackSlot) {
          onAssignDeviceToRackSlot(hit.rackId, draggingRackDevice.assetId, hit.startU, hit.side);
        }
      } else {
        const linkedNode = project.nodes.find(n => n.assetId === draggingRackDevice.assetId);
        if (linkedNode) {
          onSelect('node', linkedNode.id);
        } else {
          onSelect('rack', draggingRackDevice.sourceRackId);
        }
      }
      setDraggingRackDevice(null);
      setRackDropPreview(null);
      return;
    }

    if (draggingNodeIds && draggingNodeIds.length > 0) {
      const hadCadSnap = Boolean(cadSnapHit);
      setCadSnapHit(null);
      if (draggingNodeIds.length === 1 && rackDropPreview?.valid && onAssignDeviceToRackSlot) {
        const draggedNode = nodeMap.get(draggingNodeIds[0]);
        if (draggedNode && draggedNode.type !== 'rack' && draggedNode.assetId) {
          onAssignDeviceToRackSlot(rackDropPreview.rackId, draggedNode.assetId, rackDropPreview.startU, rackDropPreview.side);
        }
      }
      const hasVerticalGuide = alignmentGuides.some(g => g.orientation === 'vertical');
      const hasHorizontalGuide = alignmentGuides.some(g => g.orientation === 'horizontal');
      onSnapNodesAndCommitDrag?.(draggingNodeIds, {
        snapX: !hasVerticalGuide && !hadCadSnap,
        snapY: !hasHorizontalGuide && !hadCadSnap
      });
      setDraggingNodeIds(null);
      setAlignmentGuides([]);
      nodeDragSessionRef.current = null;
      setRackDropPreview(null);
    }

    if (isDrawingRoom && roomStartPos) {
      const width = Math.abs(currentMouseCanvas.x - roomStartPos.x);
      const height = Math.abs(currentMouseCanvas.y - roomStartPos.y);
      if (width > 40 && height > 40) {
        const roomScale = normalizeScalePxPerMeter(project.settings.scale);
        onAddRoom({
          floorId: project.activeFloorId || 'flr_1',
          name: `Phòng (${Math.round(width / roomScale)}x${Math.round(height / roomScale)}m)`,
          type: 'office',
          x: Math.min(roomStartPos.x, currentMouseCanvas.x),
          y: Math.min(roomStartPos.y, currentMouseCanvas.y),
          width,
          height,
          color: '#f8fafc',
          wallThickness: 6
        });
      }
      setIsDrawingRoom(false);
      setRoomStartPos(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    clearLongPressTimer();
    finishPointerInteraction(e.clientX, e.clientY);
  };

  const handlePointerCancel = () => {
    clearLongPressTimer();
    touchPointersRef.current.clear();
    pinchStateRef.current = null;
    activePointerIdRef.current = null;
    setIsPanning(false);
    setResizingSession(null);
    setDraggingRoom(null);
    setDraggingTrayVertex(null);
    setDraggingTray(null);
    setDraggingWaypoint(null);
    setReconnectingCable(null);
    setMarqueeStart(null);
    setDraggingRackDevice(null);
    setRackDropPreview(null);
    setDraggingNodeIds(null);
    setAlignmentGuides([]);
    nodeDragSessionRef.current = null;
    setIsDrawingRoom(false);
    setRoomStartPos(null);
    setMeasureSession(null);
    setCadSnapHit(null);
  };

  const initiateConnectionOrOpenPortPicker = useCallback(
    (sourceNodeId: string, targetNodeId: string, clientX?: number, clientY?: number) => {
      if (isReadOnlyMode) return;
      const srcNode = nodeMap.get(sourceNodeId);
      const tgtNode = nodeMap.get(targetNodeId);
      const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
      const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;
      const srcPorts = srcAsset?.ports || [];
      const tgtPorts = tgtAsset?.ports || [];

      if (srcPorts.length === 0 && tgtPorts.length === 0) {
        onAddCable(sourceNodeId, targetNodeId);
        onSetConnectingSource(null);
        return;
      }

      const bestPair = pickBestCompatiblePortPair(srcPorts, tgtPorts);
      const defaultSrcPort = bestPair.sourcePortId;
      const defaultTgtPort = bestPair.targetPortId;

      const rect = containerRef.current?.getBoundingClientRect();
      const rawX =
        clientX !== undefined && rect
          ? clientX - rect.left
          : tgtNode
          ? (tgtNode.x + tgtNode.width / 2) * zoom + pan.x
          : viewportSize.w / 2;
      const rawY =
        clientY !== undefined && rect
          ? clientY - rect.top
          : tgtNode
          ? (tgtNode.y + tgtNode.height) * zoom + pan.y
          : viewportSize.h / 2;

      setPendingConnection({
        sourceNodeId,
        targetNodeId,
        sourcePortId: defaultSrcPort,
        targetPortId: defaultTgtPort,
        screenX: Math.max(12, Math.min(viewportSize.w - 368, rawX - 160)),
        screenY: Math.max(12, Math.min(viewportSize.h - 330, rawY + 14))
      });
      onSetConnectingSource(null);
    },
    [isReadOnlyMode, nodeMap, project.assets, onAddCable, onSetConnectingSource, zoom, pan.x, pan.y, viewportSize.w, viewportSize.h]
  );

  const handleNodeClick = useCallback((e: React.MouseEvent | React.PointerEvent, node: DiagramNode) => {
    if (activeTool === 'pan' || activeTool === 'text') return;
    e.stopPropagation();

    if (!isReadOnlyMode && connectingSource) {
      if (connectingSource.nodeId !== node.id) {
        initiateConnectionOrOpenPortPicker(connectingSource.nodeId, node.id, e.clientX, e.clientY);
      } else {
        onSetConnectingSource(null);
      }
      return;
    }

    if (!isReadOnlyMode && activeTool === 'connect') {
      onSetConnectingSource({ nodeId: node.id });
      return;
    }

    if (e.shiftKey && onToggleNodeSelection && node.type !== 'rack') {
      onToggleNodeSelection(node.id);
      return;
    }

    if (node.type === 'rack' || node.customData?.rackId) {
      const rackId = node.customData?.rackId || project.racks.find(r => r.id === node.id || r.name === node.label)?.id || node.id;
      onSelect('rack', rackId);
      return;
    }

    if (node.assetId && project.assets[node.assetId]?.category === 'rack') {
      const rackId = project.racks.find(r => r.id === node.assetId || r.name === node.label)?.id || node.assetId;
      onSelect('rack', rackId);
      return;
    }

    onSelect('node', node.id);
  }, [activeTool, connectingSource, initiateConnectionOrOpenPortPicker, isReadOnlyMode, onSelect, onSetConnectingSource, onToggleNodeSelection, project.assets, project.racks]);

  const handleNodePointerDown = useCallback((e: React.PointerEvent, node: DiagramNode) => {
    if (activeTool === 'pan' || activeTool === 'text') {
      return;
    }
    if (e.pointerType === 'touch' && touchPointersRef.current.size >= 2) {
      return;
    }
    e.stopPropagation();
    const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
    if (!isPrimary) return;

    if (e.pointerType === 'touch' && node.type !== 'rack') {
      scheduleLongPress(e.clientX, e.clientY, 'node', node.id);
    }

    if (!isReadOnlyMode && (activeTool === 'connect' || connectingSource)) {
      return;
    }

    if (e.shiftKey) {
      return;
    }

    if (isNodeEffectivelyLocked(node, project.settings, project.assets, isReadOnlyMode)) {
      if (node.type === 'rack' || node.customData?.rackId) {
        onSelect('rack', node.customData?.rackId || node.id);
      } else {
        onSelect('node', node.id);
      }
      return;
    }

    onBeginDragSnapshot?.();

    const beginDragIds = (ids: string[]) => {
      const initialPositions = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const target = nodeMap.get(id);
        if (target && !isNodeEffectivelyLocked(target, project.settings, project.assets, isReadOnlyMode)) {
          initialPositions.set(id, { x: target.x, y: target.y });
        }
      }
      nodeDragSessionRef.current = {
        originClientX: e.clientX,
        originClientY: e.clientY,
        initialPositions
      };
      setDraggingNodeIds(ids);
      setDragStartPos({ x: e.clientX, y: e.clientY });
    };

    if (node.type === 'rack' || node.customData?.rackId) {
      const rackId = node.customData?.rackId || node.id;
      onSelect('rack', rackId);
      beginDragIds([node.id]);
    } else if (selectedNodeIdSet.has(node.id) && selectedNodeIds.length > 1) {
      beginDragIds(
        selectedNodeIds.filter(id => {
          const n = nodeMap.get(id);
          return n ? !isNodeEffectivelyLocked(n, project.settings, project.assets, isReadOnlyMode) : false;
        })
      );
    } else if (node.groupId) {
      const groupMembers = project.nodes.filter(n => n.groupId === node.groupId).map(n => n.id);
      if (groupMembers.length > 1) {
        onSelect('node', node.id, groupMembers.filter(id => id !== node.id));
        beginDragIds(
          groupMembers.filter(id => {
            const n = nodeMap.get(id);
            return n ? !isNodeEffectivelyLocked(n, project.settings, project.assets, isReadOnlyMode) : false;
          })
        );
      } else {
        onSelect('node', node.id);
        beginDragIds([node.id]);
      }
    } else {
      onSelect('node', node.id);
      beginDragIds([node.id]);
    }
  }, [activeTool, connectingSource, isReadOnlyMode, nodeMap, onBeginDragSnapshot, onSelect, project.assets, project.nodes, project.settings, scheduleLongPress, selectedNodeIdSet, selectedNodeIds]);

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: DiagramNode) => {
      e.preventDefault();
      e.stopPropagation();
      clearLongPressTimer();
      setHoveredRackSubDevice(null);

      let targetIds: string[];
      if (selectedNodeIdSet.has(node.id) && selectedNodeIds.length > 1) {
        targetIds = selectedNodeIds;
      } else if (node.groupId) {
        const groupMembers = project.nodes.filter(n => n.groupId === node.groupId).map(n => n.id);
        if (groupMembers.length > 1) {
          onSelect('node', node.id, groupMembers.filter(id => id !== node.id));
          targetIds = groupMembers;
        } else {
          if (node.type === 'rack' || node.customData?.rackId) {
            onSelect('rack', node.customData?.rackId || node.id);
          } else {
            onSelect('node', node.id);
          }
          targetIds = [node.id];
        }
      } else {
        if (node.type === 'rack' || node.customData?.rackId) {
          onSelect('rack', node.customData?.rackId || node.id);
        } else {
          onSelect('node', node.id);
        }
        targetIds = [node.id];
      }

      openContextMenuAt(e.clientX, e.clientY, 'node', node.id, targetIds);
    },
    [clearLongPressTimer, onSelect, openContextMenuAt, project.nodes, selectedNodeIdSet, selectedNodeIds]
  );

  const handleCableContextMenu = useCallback(
    (e: React.MouseEvent, cable: CableEdge) => {
      e.preventDefault();
      e.stopPropagation();
      clearLongPressTimer();
      onSelect('edge', cable.id);
      openContextMenuAt(e.clientX, e.clientY, 'edge', cable.id);
    },
    [clearLongPressTimer, onSelect, openContextMenuAt]
  );

  const lastCableBundleLayoutRef = useRef<CableBundleLayout | null>(null);
  const cableBundleLayout = useMemo(() => {
    if (isTransformingNodes && lastCableBundleLayoutRef.current) {
      return lastCableBundleLayoutRef.current;
    }
    const next = computeCableBundleLayout(visibleCables, getNodeEffectiveRect);
    lastCableBundleLayoutRef.current = next;
    return next;
  }, [isTransformingNodes, visibleCables, getNodeEffectiveRect]);

  const activeBundleInfo: CableBundleInfo | undefined = useMemo(
    () => (activeBundleId ? cableBundleLayout.bundles.find(b => b.bundleId === activeBundleId) : undefined),
    [activeBundleId, cableBundleLayout.bundles]
  );

  const getCableGeometry = useCallback((cable: CableEdge): CanvasCableGeometry | null => {
    const isMovingCable =
      isTransformingNodes &&
      (transformingNodeIdSet.has(cable.sourceNodeId) || transformingNodeIdSet.has(cable.targetNodeId));
    let info = isMovingCable ? undefined : cableBundleLayout.cablePaths.get(cable.id);
    if (!info) {
      const src = getNodeEffectiveRect(cable.sourceNodeId);
      const tgt = getNodeEffectiveRect(cable.targetNodeId);
      if (!src || !tgt) return null;
      const offsetPx = cableBundleLayout.cableOffsets.get(cable.id);
      if (offsetPx) {
        const bundleId = cableBundleLayout.cableToBundleId.get(cable.id);
        const bundle = bundleId ? cableBundleLayout.bundles.find(b => b.bundleId === bundleId) : undefined;
        info = bundle
          ? computeBundledCablePath(cable, src, tgt, offsetPx, bundle.normal)
          : computeCablePath(cable, src, tgt);
      } else {
        info = computeCablePath(cable, src, tgt);
      }
    }
    if (!info) return null;

    return {
      pathD: info.d,
      pts: info.pts,
      x1: info.x1,
      y1: info.y1,
      x2: info.x2,
      y2: info.y2,
      midX: info.midPoint.x,
      midY: info.midPoint.y,
      midAngleDeg: info.midAngleDeg
    };
  }, [isTransformingNodes, transformingNodeIdSet, cableBundleLayout, getNodeEffectiveRect]);

  const lastCulledBundlesRef = useRef<CableBundleInfo[] | null>(null);
  const culledBundles = useMemo(() => {
    if (isTransformingNodes && lastCulledBundlesRef.current) {
      return lastCulledBundlesRef.current;
    }
    const next = filterCableBundlesInViewport(
      cableBundleLayout.bundles,
      worldViewportRect,
      getCableGeometry,
      activeBundleId,
      selection.type === 'edge' ? selection.id : undefined
    );
    lastCulledBundlesRef.current = next;
    return next;
  }, [isTransformingNodes, cableBundleLayout.bundles, worldViewportRect, getCableGeometry, activeBundleId, selection.type, selection.id]);

  const lastStaticNodeRectEntriesRef = useRef<Array<[string, RectBox]> | null>(null);
  const staticNodeRectEntries = useMemo(() => {
    if (isTransformingNodes && lastStaticNodeRectEntriesRef.current) {
      return lastStaticNodeRectEntriesRef.current;
    }
    const seen = new Set<string>();
    const entries: Array<[string, RectBox]> = [];
    for (const cable of culledVisibleCables) {
      for (const nodeId of [cable.sourceNodeId, cable.targetNodeId]) {
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        const rect = getNodeEffectiveRect(nodeId);
        if (rect) {
          entries.push([nodeId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }]);
        }
      }
    }
    lastStaticNodeRectEntriesRef.current = entries;
    return entries;
  }, [isTransformingNodes, culledVisibleCables, getNodeEffectiveRect]);

  const rasterCableMode = useMemo(
    () =>
      shouldUseRasterCableLayer(culledVisibleCables.length, isPanning, isTransformingNodes, {
        dense: perfPolicy.rasterCableDenseThreshold,
        pan: perfPolicy.rasterCablePanThreshold
      }),
    [
      culledVisibleCables.length,
      isPanning,
      isTransformingNodes,
      perfPolicy.rasterCableDenseThreshold,
      perfPolicy.rasterCablePanThreshold
    ]
  );

  const interactiveCableIds = useMemo(() => {
    const ids = new Set<string>();
    if (selection.type === 'edge' && selection.id) ids.add(selection.id);
    if (hoveredCableId) ids.add(hoveredCableId);
    if (draggingWaypoint?.cableId) ids.add(draggingWaypoint.cableId);
    if (reconnectingCable?.cableId) ids.add(reconnectingCable.cableId);
    if (editingCableLabel?.cableId) ids.add(editingCableLabel.cableId);
    if (activeBundleInfo) {
      for (const c of activeBundleInfo.cables) ids.add(c.id);
    }
    if (draggingNodeIds && draggingNodeIds.length > 0) {
      const draggedSet = new Set(draggingNodeIds);
      for (const c of culledVisibleCables) {
        if (draggedSet.has(c.sourceNodeId) || draggedSet.has(c.targetNodeId)) {
          ids.add(c.id);
        }
      }
    }
    if (resizingNodeId) {
      for (const c of culledVisibleCables) {
        if (c.sourceNodeId === resizingNodeId || c.targetNodeId === resizingNodeId) {
          ids.add(c.id);
        }
      }
    }
    return ids;
  }, [
    selection.type,
    selection.id,
    hoveredCableId,
    draggingWaypoint,
    reconnectingCable,
    editingCableLabel,
    activeBundleInfo,
    draggingNodeIds,
    resizingNodeId,
    culledVisibleCables
  ]);

  const findRasterCableAtCoord = useCallback(
    (wx: number, wy: number): CableEdge | null => {
      const tolWorld = Math.max(8, 12 / Math.max(0.25, zoom));
      const candidates = cableQuadtree
        ? cableQuadtree.queryRect({ x: wx - tolWorld, y: wy - tolWorld, width: tolWorld * 2, height: tolWorld * 2 })
        : culledVisibleCables;
      for (let i = candidates.length - 1; i >= 0; i--) {
        const c = candidates[i];
        const bundleId = cableBundleLayout.cableToBundleId.get(c.id);
        if (bundleId && collapsedBundleIds.has(bundleId)) continue;
        const geom = getCableGeometry(c);
        if (!geom) continue;
        if (hitTestCablePolyline(wx, wy, geom.pts, tolWorld)) {
          return c;
        }
      }
      return null;
    },
    [cableQuadtree, culledVisibleCables, cableBundleLayout.cableToBundleId, collapsedBundleIds, getCableGeometry, zoom]
  );

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      clearLongPressTimer();
      if (rasterCableMode) {
        const coord = clientToCanvasCoord(e.clientX, e.clientY);
        const hitCable = findRasterCableAtCoord(coord.x, coord.y);
        if (hitCable) {
          onSelect('edge', hitCable.id);
          openContextMenuAt(e.clientX, e.clientY, 'edge', hitCable.id);
          return;
        }
      }
      openContextMenuAt(e.clientX, e.clientY, 'canvas', 'canvas');
    },
    [clearLongPressTimer, clientToCanvasCoord, findRasterCableAtCoord, onSelect, openContextMenuAt, rasterCableMode]
  );

  const startNodeResize = useCallback((
    e: React.PointerEvent,
    nodeId: string,
    dir: ResizeHandleDir,
    rect: { x: number; y: number; width: number; height: number },
    rotationDeg: number,
    minW: number,
    minH: number
  ) => {
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode || isNodeEffectivelyLocked(targetNode, project.settings, project.assets, isReadOnlyMode)) return;
    e.stopPropagation();
    onBeginDragSnapshot?.();
    setResizingSession({
      targetKind: 'node',
      targetId: nodeId,
      handle: dir,
      originClientX: e.clientX,
      originClientY: e.clientY,
      initialRect: rect,
      rotationDeg,
      minW,
      minH,
      currentRect: rect
    });
  }, [isReadOnlyMode, nodeMap, onBeginDragSnapshot, project.assets, project.settings]);

  const handleRoomSelectAndDragStart = useCallback((e: React.PointerEvent, room: Room) => {
    const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
    if (!isPrimary) return;
    onSelect('room', room.id);
    const roomLocked = isRoomEffectivelyLocked(room, project.settings, isReadOnlyMode);
    if (!roomLocked && onMoveRoomTransient) {
      onBeginDragSnapshot?.();
      setDraggingRoom({
        roomId: room.id,
        lastClientX: e.clientX,
        lastClientY: e.clientY
      });
    }
  }, [isReadOnlyMode, onBeginDragSnapshot, onMoveRoomTransient, onSelect, project.settings]);

  const handleSelectRoom = useCallback((_e: React.MouseEvent, roomId: string) => {
    onSelect('room', roomId);
  }, [onSelect]);

  const handleStartRoomResize = useCallback((e: React.PointerEvent, room: Room, dir: ResizeHandleDir) => {
    e.stopPropagation();
    if (isRoomEffectivelyLocked(room, project.settings, isReadOnlyMode)) return;
    onBeginDragSnapshot?.();
    setResizingSession({
      targetKind: 'room',
      targetId: room.id,
      handle: dir,
      originClientX: e.clientX,
      originClientY: e.clientY,
      initialRect: { x: room.x, y: room.y, width: room.width, height: room.height },
      rotationDeg: 0,
      minW: 60,
      minH: 45,
      currentRect: { x: room.x, y: room.y, width: room.width, height: room.height }
    });
  }, [isReadOnlyMode, onBeginDragSnapshot, project.settings]);

  const handleSelectTrayAndDragStart = useCallback(
    (trayId: string, e: React.PointerEvent) => {
      const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
      if (!isPrimary) return;
      onSelect('tray', trayId);
      const tray = (project.cableTrays || []).find(t => t.id === trayId);
      if (!tray) return;
      if (!isTrayEffectivelyLocked(tray, project.settings, isReadOnlyMode) && onMoveCableTrayTransient) {
        onBeginDragSnapshot?.();
        setDraggingTray({
          trayId,
          lastClientX: e.clientX,
          lastClientY: e.clientY
        });
      }
    },
    [isReadOnlyMode, onBeginDragSnapshot, onMoveCableTrayTransient, onSelect, project.cableTrays, project.settings]
  );

  const handleStartDragTrayVertex = useCallback(
    (trayId: string, vertexIndex: number, _e: React.PointerEvent) => {
      const tray = (project.cableTrays || []).find(t => t.id === trayId);
      if (!tray || isTrayEffectivelyLocked(tray, project.settings, isReadOnlyMode)) return;
      onBeginDragSnapshot?.();
      setDraggingTrayVertex({ trayId, vertexIndex });
    },
    [isReadOnlyMode, onBeginDragSnapshot, project.cableTrays, project.settings]
  );

  const handleDoubleClickDeviceNode = useCallback((nodeId: string, assetId?: string) => {
    onOpenDeepInspect(assetId || nodeId);
  }, [onOpenDeepInspect]);

  const handleToggleNodeIconPicker = useCallback((nodeId: string) => {
    setNodeIconUploadError(null);
    setIconPickerNodeId(prev => (prev === nodeId ? null : nodeId));
  }, []);

  const handleDevicePortClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (connectingSource) {
      if (connectingSource.nodeId !== nodeId) {
        initiateConnectionOrOpenPortPicker(connectingSource.nodeId, nodeId, e.clientX, e.clientY);
      } else {
        onSetConnectingSource(null);
      }
    } else {
      onSetConnectingSource({ nodeId });
    }
  }, [connectingSource, initiateConnectionOrOpenPortPicker, onSetConnectingSource]);

  const getDeviceColor = useCallback((cat?: string) => {
    switch (cat) {
      case 'core_switch': return '#0284c7';
      case 'switch': return '#0ea5e9';
      case 'router': return '#2563eb';
      case 'firewall': return '#dc2626';
      case 'server': return '#475569';
      case 'storage': return '#0f766e';
      case 'ups': return '#e11d48';
      case 'pdu': return '#9333ea';
      case 'odf': return '#06b6d4';
      case 'patch_panel': return '#64748b';
      case 'nvr': return '#d97706';
      default: return '#3b82f6';
    }
  }, []);

  const handleToggleRackSide = useCallback((rackId: string, nextSide: RackSide) => {
    setRackSides(prev => ({ ...prev, [rackId]: nextSide }));
  }, []);

  const handleToggleRackCollapse = useMemo(
    () =>
      onUpdateNode
        ? (targetRackNode: DiagramNode) => {
            onUpdateNode(targetRackNode.id, {
              customData: {
                ...(targetRackNode.customData || {}),
                collapsed: !isRackNodeCollapsed(targetRackNode)
              }
            });
          }
        : undefined,
    [onUpdateNode]
  );

  const handleToggleRackThermalOverlay = useMemo(
    () =>
      onUpdateNode
        ? (targetRackNode: DiagramNode) => {
            const currentVisible = targetRackNode.customData?.showThermalOverlay !== false;
            onUpdateNode(targetRackNode.id, {
              customData: {
                ...(targetRackNode.customData || {}),
                showThermalOverlay: !currentVisible
              }
            });
          }
        : undefined,
    [onUpdateNode]
  );

  const handleToggleActiveBundle = useCallback((bundleId: string) => {
    setActiveBundleId(prev => (prev === bundleId ? null : bundleId));
  }, []);

  const handleSelectEdge = useCallback((cableId: string) => {
    onSelect('edge', cableId);
  }, [onSelect]);

  const handleHoverCable = useCallback((cableId: string | null) => {
    setHoveredCableId(cableId);
  }, []);

  const handleStartWaypointDrag = useCallback((cableId: string, pointIndex: number) => {
    setDraggingWaypoint({ cableId, pointIndex });
  }, []);

  const handleStartCableReconnect = useCallback(
    (cableId: string, endpoint: 'source' | 'target', anchorX: number, anchorY: number) => {
      setReconnectingCable({ cableId, endpoint, anchorX, anchorY });
    },
    []
  );

  const isTransformingAnyGeometry = isTransformingNodes || Boolean(draggingRoom) || Boolean(resizingSession);
  const lastMinimapBoundsRef = useRef<{ minX: number; minY: number; width: number; height: number } | null>(null);
  const minimapBounds = useMemo(() => {
    if (isTransformingAnyGeometry && lastMinimapBoundsRef.current) {
      return lastMinimapBoundsRef.current;
    }
    let minX = 0;
    let minY = 0;
    let maxX = 1400;
    let maxY = 900;
    visibleNodes.forEach(n => {
      minX = Math.min(minX, n.x - 80);
      minY = Math.min(minY, n.y - 80);
      maxX = Math.max(maxX, n.x + n.width + 80);
      maxY = Math.max(maxY, n.y + n.height + 80);
    });
    visibleRooms.forEach(r => {
      minX = Math.min(minX, r.x - 80);
      minY = Math.min(minY, r.y - 80);
      maxX = Math.max(maxX, r.x + r.width + 80);
      maxY = Math.max(maxY, r.y + r.height + 80);
    });
    const next = {
      minX,
      minY,
      width: Math.max(800, maxX - minX),
      height: Math.max(500, maxY - minY)
    };
    lastMinimapBoundsRef.current = next;
    return next;
  }, [isTransformingAnyGeometry, visibleNodes, visibleRooms]);

  const connectingSourceRect = connectingSource ? getNodeEffectiveRect(connectingSource.nodeId) : null;
  const connectingSourceNode = connectingSource ? nodeMap.get(connectingSource.nodeId) : undefined;

  const canvasAppearance = useMemo(
    () => resolveCanvasAppearance(project.settings),
    [project.settings]
  );

  const handleBackgroundImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateSettings) return;
    try {
      const dataUrl = await processCanvasBackgroundImage(file);
      setBgUploadError(null);
      onUpdateSettings({
        backgroundImageUrl: dataUrl,
        backgroundImageOpacity: project.settings.backgroundImageOpacity ?? 0.35,
        backgroundImageMode: project.settings.backgroundImageMode || 'cover'
      });
    } catch (err) {
      setBgUploadError(err instanceof Error ? err.message : 'Không thể tải ảnh nền.');
    }
    if (bgFileInputRef.current) bgFileInputRef.current.value = '';
  };

  const svgAriaLabel = useMemo(() => {
    return `Sơ đồ kỹ thuật ${project.name} (${project.activeMode}): ${visibleRooms.length} phòng, ${visibleRackNodes.length} tủ rack, ${visibleDeviceNodes.length} thiết bị, ${visibleCables.length} dây cáp${isReadOnlyMode ? ' — Chế độ Chỉ xem' : ''}`;
  }, [project.name, project.activeMode, visibleRooms.length, visibleRackNodes.length, visibleDeviceNodes.length, visibleCables.length, isReadOnlyMode]);

  return (
    <div
      ref={containerRef}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onPointerCancelCapture={handlePointerUpCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onWheel={handleWheel}
      onContextMenu={handleCanvasContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        touchAction: 'none',
        backgroundColor: canvasAppearance.backgroundColor
      }}
      className={`relative w-full h-full overflow-hidden select-none transition-colors duration-200 ${
        isReadOnlyMode || activeTool === 'pan'
          ? isPanning
            ? 'cursor-grabbing'
            : 'cursor-grab'
          : activeTool === 'room' || activeTool === 'tray' || activeTool === 'measure'
          ? 'cursor-crosshair'
          : activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'connect' || connectingSource || reconnectingCable
          ? 'cursor-pointer'
          : isPanning
          ? 'cursor-grabbing'
          : draggingRackDevice
          ? 'cursor-grabbing'
          : 'cursor-default'
      }`}
    >
      <input
        ref={bgFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={handleBackgroundImageUpload}
        className="hidden"
      />

      {canvasAppearance.imageUrl && canvasAppearance.imageMode === 'cover' && (
        <div
          className="absolute inset-0 pointer-events-none bg-center bg-cover"
          style={{
            backgroundImage: `url(${canvasAppearance.imageUrl})`,
            opacity: canvasAppearance.imageOpacity
          }}
        />
      )}

      {/* Locked Non-Destructive AutoCAD Underlay Canvas */}
      <canvas
        ref={cadUnderlayCanvasRef}
        aria-hidden="true"
        className="w-full h-full absolute inset-0 pointer-events-none"
      />

      {/* Backdrop World SVG (Grid, Floor Image, Rooms, Trays, Heatmaps) */}
      <svg
        data-layer="world-backdrop"
        aria-hidden="true"
        className="w-full h-full absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0'
        }}
      >

        {/* CAD Grid / Pattern */}
        {canvasAppearance.pattern !== 'none' && (
          <defs>
            <pattern
              id="cad-grid-pattern"
              width={project.settings.gridSize}
              height={project.settings.gridSize}
              patternUnits="userSpaceOnUse"
            >
              {canvasAppearance.pattern === 'dots' && (
                <circle cx="1.5" cy="1.5" r="1.15" fill={canvasAppearance.gridColor} />
              )}
              {canvasAppearance.pattern === 'lines' && (
                <path
                  d={`M ${project.settings.gridSize} 0 L 0 0 0 ${project.settings.gridSize}`}
                  fill="none"
                  stroke={canvasAppearance.gridColor}
                  strokeWidth="0.7"
                  strokeOpacity="0.7"
                />
              )}
              {canvasAppearance.pattern === 'cross' && (
                <path
                  d="M 1 4 L 7 4 M 4 1 L 4 7"
                  fill="none"
                  stroke={canvasAppearance.gridColor}
                  strokeWidth="0.9"
                />
              )}
            </pattern>
          </defs>
        )}

        {canvasAppearance.pattern !== 'none' && (
          <rect
            data-canvas-bg="true"
            x="-2000"
            y="-2000"
            width="8000"
            height="8000"
            fill="url(#cad-grid-pattern)"
          />
        )}

        {canvasAppearance.imageUrl && canvasAppearance.imageMode === 'world' && (
          <image
            href={canvasAppearance.imageUrl}
            x={0}
            y={0}
            width={1600}
            height={1000}
            preserveAspectRatio="xMidYMid meet"
            opacity={canvasAppearance.imageOpacity}
            className="pointer-events-none"
          />
        )}

        {/* 1. LAYER: ROOMS */}
        {culledVisibleRooms.map(room => (
          <CanvasRoomNode
            key={room.id}
            room={room}
            isSelected={selection.type === 'room' && selection.id === room.id}
            roomLocked={isRoomEffectivelyLocked(room, project.settings, isReadOnlyMode)}
            zoom={zoom}
            scale={normalizeScalePxPerMeter(project.settings.scale)}
            isPointerPassthrough={!isReadOnlyMode && (activeTool === 'connect' || Boolean(connectingSource) || activeTool === 'room')}
            onSelectAndDragStart={handleRoomSelectAndDragStart}
            onSelectRoom={handleSelectRoom}
            onStartResize={handleStartRoomResize}
          />
        ))}

        {/* 1b. LAYER: CULLED CABLE TRAYS & CONDUITS */}
        <CanvasTraysLayer
          trays={culledVisibleCableTrays}
          hideLabels={hiddenLayerSet.has('labels')}
          selectedTrayId={selection.type === 'tray' ? selection.id : null}
          lockedLayerTrays={getLockedLayerSet(project.settings).has('trays')}
          isReadOnlyMode={isReadOnlyMode}
          isPointerPassthrough={!isReadOnlyMode && (activeTool === 'connect' || Boolean(connectingSource) || activeTool === 'room' || activeTool === 'tray')}
          onSelectTray={handleSelectTrayAndDragStart}
          onStartDragTrayVertex={handleStartDragTrayVertex}
        />

        {/* LOGICAL GROUP FRAMES */}
        {groupBounds.map(([grpId, b]) => (
          <g key={`grp_${grpId}`} className="pointer-events-none">
            <rect
              x={b.minX - 10}
              y={b.minY - 14}
              width={b.maxX - b.minX + 20}
              height={b.maxY - b.minY + 24}
              rx="10"
              fill="#3b82f6"
              fillOpacity="0.04"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <text
              x={b.minX - 4}
              y={b.minY - 18}
              fill="#2563eb"
              fontSize="9"
              fontWeight="bold"
              fontFamily="monospace"
            >
              NHÓM ({b.count})
            </text>
          </g>
        ))}

        {/* Dynamic Room Drawing Preview */}
        {isDrawingRoom && roomStartPos && !isReadOnlyMode && (
          <rect
            x={Math.min(roomStartPos.x, currentMouseCanvas.x)}
            y={Math.min(roomStartPos.y, currentMouseCanvas.y)}
            width={Math.abs(currentMouseCanvas.x - roomStartPos.x)}
            height={Math.abs(currentMouseCanvas.y - roomStartPos.y)}
            fill="#3b82f6"
            fillOpacity="0.15"
            stroke="#2563eb"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        )}

        {/* Dynamic Cable Tray Polyline Preview */}
        {activeTool === 'tray' && trayDraftPoints.length > 0 && !isReadOnlyMode && (
          <g className="pointer-events-none">
            <polyline
              points={[...trayDraftPoints, currentMouseCanvas].map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={project.activeMode === 'electrical' ? '#e11d48' : '#0284c7'}
              strokeWidth="16"
              strokeOpacity="0.24"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={[...trayDraftPoints, currentMouseCanvas].map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={project.activeMode === 'electrical' ? '#e11d48' : '#0284c7'}
              strokeWidth="2.2"
              strokeDasharray="6 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {trayDraftPoints.map((pt, idx) => (
              <circle
                key={`tray_draft_${idx}`}
                cx={pt.x}
                cy={pt.y}
                r="4.5"
                fill="#ffffff"
                stroke="#155EEF"
                strokeWidth="2"
              />
            ))}
          </g>
        )}

        {/* 2. LAYER: WI-FI HEATMAP */}
        {project.settings.showCoverageRadius && !hiddenLayerSet.has('wifi') && culledDeviceNodes.map(node => {
          const asset = node.assetId ? project.assets[node.assetId] : undefined;
          const wifiCov = resolveWifiCoverage(node, asset);
          if (!wifiCov) return null;

          const isSession = wifiResizeSession?.nodeId === node.id;
          const activeMeters = isSession ? wifiResizeSession.currentMeters : wifiCov.radiusMeters;
          const activeAngle = isSession ? wifiResizeSession.currentAngleDeg : wifiCov.angleDeg;
          const isDirectional = activeAngle < 359.5;
          const radiusPx = wifiRadiusMetersToCanvasPx(activeMeters, project.settings.scale);
          const cx = node.x + node.width / 2;
          const cy = node.y + node.height / 2;
          const nodeRotDeg = node.rotation || 0;
          const areaSqm = computeSectorAreaSqm(activeMeters, activeAngle);
          const isActiveWifi =
            isSession || selectedNodeIdSet.has(node.id) || hoveredNodeId === node.id;
          const canSelectZone = !connectingSource && !isDrawingRoom && activeTool === 'select';
          const rotRad = (nodeRotDeg * Math.PI) / 180;
          const labelX = isDirectional ? cx + radiusPx * 0.65 * Math.cos(rotRad) : cx;
          const labelY = isDirectional ? cy + radiusPx * 0.65 * Math.sin(rotRad) : cy - radiusPx - 6;

          return (
            <g
              key={`wifi_heat_${node.id}`}
              data-testid={`wifi-coverage-zone-${node.id}`}
              style={{ pointerEvents: canSelectZone ? 'auto' : 'none' }}
              className={canSelectZone ? 'cursor-pointer' : undefined}
              onPointerDown={(e) => {
                if (!canSelectZone) return;
                e.stopPropagation();
                onSelect('node', node.id);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {isDirectional ? (
                <>
                  <path
                    d={buildSectorSvgPath(cx, cy, radiusPx * 0.55, nodeRotDeg, activeAngle)}
                    fill="#10b981"
                    fillOpacity={isActiveWifi ? '0.24' : '0.16'}
                    stroke="#059669"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <path
                    d={buildSectorSvgPath(cx, cy, radiusPx, nodeRotDeg, activeAngle)}
                    fill="#06b6d4"
                    fillOpacity={isActiveWifi ? '0.14' : '0.08'}
                    stroke={isActiveWifi ? '#059669' : '#0891b2'}
                    strokeWidth={isActiveWifi ? '2.2' : '1.5'}
                    strokeDasharray="5 5"
                  />
                </>
              ) : (
                <>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radiusPx * 0.55}
                    fill="#10b981"
                    fillOpacity={isActiveWifi ? '0.22' : '0.16'}
                    stroke="#059669"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radiusPx}
                    fill="#06b6d4"
                    fillOpacity={isActiveWifi ? '0.12' : '0.07'}
                    stroke={isSession ? '#059669' : isActiveWifi ? '#0284c7' : '#0891b2'}
                    strokeWidth={isSession ? '2.2' : isActiveWifi ? '2' : '1.5'}
                    strokeDasharray="5 5"
                  />
                </>
              )}
              {(!perfPolicy.lowDetailMode || isActiveWifi) && (
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  fill="#059669"
                  fontSize="9.5"
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {activeMeters}m{isDirectional ? ` · ${activeAngle}°` : ''} ({areaSqm} m²)
                </text>
              )}
            </g>
          );
        })}

        {/* 3. LAYER: CAMERA FOV */}
        {project.settings.showCoverageRadius && !hiddenLayerSet.has('fov') && culledDeviceNodes.map(node => {
          const asset = node.assetId ? project.assets[node.assetId] : undefined;
          const camFov = resolveCameraFov(node, asset);
          if (!camFov) return null;

          const isSession = cameraFovSession?.nodeId === node.id;
          const activeFov = isSession ? cameraFovSession.currentFovAngle : camFov.fovAngle;
          const activeRange = isSession ? cameraFovSession.currentRangeMeters : camFov.rangeMeters;
          const isOmni = activeFov >= 359.5;
          const cx = node.x + node.width / 2;
          const cy = node.y + node.height / 2;
          const rangePx = cameraRangeMetersToCanvasPx(activeRange, project.settings.scale);
          const nodeRotDeg = node.rotation || 0;
          const rotRad = (nodeRotDeg * Math.PI) / 180;
          const isActiveCam =
            isSession || selectedNodeIdSet.has(node.id) || hoveredNodeId === node.id;
          const canSelectZone = !connectingSource && !isDrawingRoom && activeTool === 'select';
          const labelX = isOmni ? cx : cx + rangePx * 0.65 * Math.cos(rotRad);
          const labelY = isOmni ? cy - rangePx - 6 : cy + rangePx * 0.65 * Math.sin(rotRad);

          return (
            <g
              key={`cam_fov_${node.id}`}
              data-testid={`camera-fov-zone-${node.id}`}
              style={{ pointerEvents: canSelectZone ? 'auto' : 'none' }}
              className={canSelectZone ? 'cursor-pointer' : undefined}
              onPointerDown={(e) => {
                if (!canSelectZone) return;
                e.stopPropagation();
                onSelect('node', node.id);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {isOmni ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={rangePx}
                  fill="#f59e0b"
                  fillOpacity={isActiveCam ? '0.26' : '0.18'}
                  stroke={isActiveCam ? '#b45309' : '#d97706'}
                  strokeWidth={isActiveCam ? '2.2' : '1.5'}
                  strokeDasharray="4 4"
                />
              ) : (
                <path
                  d={buildSectorSvgPath(cx, cy, rangePx, nodeRotDeg, activeFov)}
                  fill="#f59e0b"
                  fillOpacity={isActiveCam ? '0.28' : '0.22'}
                  stroke={isActiveCam ? '#b45309' : '#d97706'}
                  strokeWidth={isActiveCam ? '2.2' : '1.5'}
                  strokeDasharray="4 4"
                />
              )}
              {(!perfPolicy.lowDetailMode || isActiveCam) && (
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  fill="#b45309"
                  fontSize="9"
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  FOV {activeFov}° ({activeRange}m)
                </text>
              )}
            </g>
          );
        })}

      </svg>

      {/* Independent Hardware-Accelerated 2D Canvas Cable Raster Cache Layer */}
      <CanvasCableRasterLayer
        active={rasterCableMode}
        viewportSize={viewportSize}
        pan={pan}
        zoom={zoom}
        culledCables={culledVisibleCables}
        culledBundles={culledBundles}
        cableToBundleId={cableBundleLayout.cableToBundleId}
        collapsedBundleIds={collapsedBundleIds}
        interactiveCableIds={interactiveCableIds}
        staticNodeRectEntries={staticNodeRectEntries}
        getCableGeometry={getCableGeometry}
        showCableLabels={!hiddenLayerSet.has('cable_labels') && !hiddenLayerSet.has('labels')}
        showCableCodes={project.settings.showCableCodes}
        isPanning={isPanning}
        isTransformingNodes={isTransformingNodes}
      />

      {/* Interactive Main Vector SVG Layer (Active Cables, Racks, Devices, Handles) */}
      <svg
        id="hachihi-main-svg"
        role="img"
        aria-label={svgAriaLabel}
        className="w-full h-full absolute inset-0 pointer-events-none"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0'
        }}
      >
        <title>{svgAriaLabel}</title>
        <g style={{ pointerEvents: 'auto' }}>
        {/* 4. LAYER: CABLE BUNDLE JACKETS + CABLES + LABELS */}
        <CanvasCablesLayer
          rasterActive={rasterCableMode}
          culledCables={culledVisibleCables}
          culledBundles={culledBundles}
          cableBundleLayout={cableBundleLayout}
          interactiveCableIds={interactiveCableIds}
          collapsedBundleIds={collapsedBundleIds}
          activeBundleId={activeBundleId}
          selection={selection}
          hoveredCableId={hoveredCableId}
          editingCableLabelId={editingCableLabel?.cableId ?? null}
          isDarkMode={project.settings.isDarkMode}
          isReadOnlyMode={isReadOnlyMode}
          hideLabels={hiddenLayerSet.has('labels') || hiddenLayerSet.has('cable_labels')}
          showCableCodes={project.settings.showCableCodes}
          getCableGeometry={getCableGeometry}
          onToggleActiveBundle={handleToggleActiveBundle}
          onSelectEdge={handleSelectEdge}
          onScheduleLongPress={scheduleLongPress}
          onCableContextMenu={handleCableContextMenu}
          onOpenInlineCableLabelEditor={openInlineCableLabelEditor}
          onHoverCable={handleHoverCable}
          onBeginDragSnapshot={onBeginDragSnapshot}
          onStartWaypointDrag={handleStartWaypointDrag}
          onUpdateCable={onUpdateCable}
          onUpdateCableControlPoints={onUpdateCableControlPoints}
          onStartReconnect={handleStartCableReconnect}
        />

        {reconnectingCable && !isReadOnlyMode && (
          <line
            x1={reconnectingCable.anchorX}
            y1={reconnectingCable.anchorY}
            x2={currentMouseCanvas.x}
            y2={currentMouseCanvas.y}
            stroke="#10b981"
            strokeWidth="2.5"
            strokeDasharray="5 3"
            className="pointer-events-none"
          />
        )}

        {connectingSourceRect && !isReadOnlyMode && (
          <line
            x1={connectingSourceRect.x + connectingSourceRect.width / 2}
            y1={connectingSourceRect.y + connectingSourceRect.height / 2}
            x2={currentMouseCanvas.x}
            y2={currentMouseCanvas.y}
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeDasharray="4 4"
            className="pointer-events-none"
          />
        )}

        {/* 5. LAYER: INTERACTIVE 19-INCH SERVER RACKS */}
        {culledRackNodes.map(rackNode => (
          <CanvasRackNode
            key={rackNode.id}
            rackNode={rackNode}
            project={project}
            selection={selection}
            activeTool={activeTool}
            zoom={zoom}
            rackSides={rackSides}
            connectingSource={connectingSource}
            draggingRackDevice={draggingRackDevice}
            rackDropPreview={rackDropPreview}
            selectedNodeIdSet={selectedNodeIdSet}
            isOverlapping={overlapReport.overlappingNodeIds.has(rackNode.id)}
            isReadOnlyMode={isReadOnlyMode}
            showFineSubDetails={perfPolicy.showFineSubDetails}
            enableShadows={perfPolicy.enableShadowsAndFilters}
            resolveRackForNode={resolveRackForNode}
            getDeviceColor={getDeviceColor}
            clientToCanvasCoord={clientToCanvasCoord}
            onNodePointerDown={handleNodePointerDown}
            onNodeClick={handleNodeClick}
            onSelect={onSelect}
            onOpenDeepInspect={onOpenDeepInspect}
            onToggleRackSide={handleToggleRackSide}
            onStartDraggingRackDevice={setDraggingRackDevice}
            onRemoveDeviceFromRackSlot={onRemoveDeviceFromRackSlot}
            onToggleRackCollapse={handleToggleRackCollapse}
            hoveredSubDeviceAssetId={hoveredRackSubDevice?.asset.id ?? null}
            onHoverSubDevice={handleHoverRackSubDevice}
            onToggleRackThermalOverlay={handleToggleRackThermalOverlay}
            onStartResize={startNodeResize}
            onNodeContextMenu={handleNodeContextMenu}
          />
        ))}

        {/* 6. LAYER: DEVICE / LEGEND / SHAPE NODES */}
        {culledDeviceNodes.map(node => {
          const isSelected = selectedNodeIdSet.has(node.id);
          const isSingleSelected = isSelected && selectedNodeIds.length === 1;
          const isOverlapping = overlapReport.overlappingNodeIds.has(node.id);

          if (node.type === 'legend') {
            const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
            const handleSize = 7.5 * invZ;
            const framePad = 5 * invZ;
            return (
              <CanvasLegendNode
                key={node.id}
                node={node}
                project={project}
                isSelected={isSelected}
                isSingleSelected={isSingleSelected}
                isOverlapping={isOverlapping}
                isConnecting={Boolean(connectingSource)}
                isReadOnlyMode={isReadOnlyMode}
                framePad={framePad}
                handleSize={handleSize}
                invZ={invZ}
                onNodePointerDown={handleNodePointerDown}
                onNodeClick={handleNodeClick}
                onHoverChange={setHoveredNodeId}
                onResizeLegendToFit={onResizeLegendToFit}
                onStartResize={startNodeResize}
                onNodeContextMenu={handleNodeContextMenu}
              />
            );
          }

          const asset = node.assetId ? project.assets[node.assetId] : undefined;
          const isConnectingFromThis = connectingSource?.nodeId === node.id;
          const isHovered = hoveredNodeId === node.id;
          const isTargetCandidate = Boolean(
            !isReadOnlyMode &&
            ((connectingSource && connectingSource.nodeId !== node.id) ||
              (reconnectingCable && isHovered))
          );

          return (
            <CanvasDeviceNode
              key={node.id}
              node={node}
              asset={asset}
              isSelected={isSelected}
              isSingleSelected={isSingleSelected}
              isHovered={isHovered}
              isOverlapping={isOverlapping}
              isConnecting={Boolean(connectingSource)}
              isConnectingFromThis={isConnectingFromThis}
              isTargetCandidate={isTargetCandidate}
              isDarkCanvas={canvasAppearance.isDarkCanvas}
              showIpAddresses={project.settings.showIpAddresses}
              hideLabels={hiddenLayerSet.has('labels')}
              isReadOnlyMode={isReadOnlyMode}
              zoom={zoom}
              lowDetailMode={perfPolicy.lowDetailMode}
              enableShadows={perfPolicy.enableShadowsAndFilters}
              onNodePointerDown={handleNodePointerDown}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              onHoverChange={setHoveredNodeId}
              onDoubleClickNode={handleDoubleClickDeviceNode}
              onToggleIconPicker={handleToggleNodeIconPicker}
              onPortClick={handleDevicePortClick}
              onStartResize={startNodeResize}
            />
          );
        })}

        {overlapReport.pairs.map((pair, idx) => (
          <rect
            key={`ovl_${pair.aId}_${pair.bId}_${idx}`}
            x={pair.overlapRect.x}
            y={pair.overlapRect.y}
            width={pair.overlapRect.width}
            height={pair.overlapRect.height}
            fill="#ef4444"
            fillOpacity="0.16"
            stroke="#dc2626"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            className="pointer-events-none"
          />
        ))}

        {marqueeStart && (
          <rect
            x={Math.min(marqueeStart.x, currentMouseCanvas.x)}
            y={Math.min(marqueeStart.y, currentMouseCanvas.y)}
            width={Math.abs(currentMouseCanvas.x - marqueeStart.x)}
            height={Math.abs(currentMouseCanvas.y - marqueeStart.y)}
            fill="#3b82f6"
            fillOpacity="0.12"
            stroke="#2563eb"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            className="pointer-events-none"
          />
        )}

        {draggingRackDevice && draggingRackDevice.hasMoved && !isReadOnlyMode && (
          <g transform={`translate(${draggingRackDevice.currentX - 110}, ${draggingRackDevice.currentY - 12})`} className="pointer-events-none">
            <rect
              width="220"
              height={Math.max(22, draggingRackDevice.uHeight * 14)}
              rx="4"
              fill="#0f172a"
              fillOpacity="0.92"
              stroke={draggingRackDevice.color}
              strokeWidth="2"
              filter="drop-shadow(0 6px 12px rgba(0,0,0,0.4))"
            />
            <text x="12" y="15" fill="#ffffff" fontSize="10" fontWeight="bold">
              {draggingRackDevice.label} ({draggingRackDevice.uHeight}U)
            </text>
          </g>
        )}

        {alignmentGuides.map((g, idx) => {
          const isCenter = g.kind === 'center';
          const guideColor = g.sourceKind === 'guide' ? '#06b6d4' : isCenter ? '#0ea5e9' : '#f43f5e';
          const invZ = 1 / Math.max(0.35, zoom);
          const strokeW = 1.4 * invZ;
          const dashArr = `${5 * invZ} ${3.5 * invZ}`;
          const tick = 4.5 * invZ;
          const labelText = `${g.alignLabel} · ${Math.round(g.pos)}`;
          const badgeW = (labelText.length * 5.6 + 12) * invZ;
          const badgeH = 16 * invZ;

          if (g.orientation === 'vertical') {
            const labelY = g.from + 14 * invZ;
            return (
              <g key={`align_v_${idx}`} className="pointer-events-none">
                <line x1={g.pos} y1={g.from} x2={g.pos} y2={g.to} stroke={guideColor} strokeWidth={strokeW} strokeDasharray={dashArr} />
                <line x1={g.pos - tick} y1={g.from} x2={g.pos + tick} y2={g.from} stroke={guideColor} strokeWidth={strokeW} />
                <line x1={g.pos - tick} y1={g.to} x2={g.pos + tick} y2={g.to} stroke={guideColor} strokeWidth={strokeW} />
                <g transform={`translate(${g.pos + 6 * invZ}, ${labelY})`}>
                  <rect x={0} y={-badgeH / 2} width={badgeW} height={badgeH} rx={4 * invZ} fill={guideColor} />
                  <text x={badgeW / 2} y={3.2 * invZ} textAnchor="middle" fill="#ffffff" fontSize={9 * invZ} fontWeight="700" fontFamily="ui-monospace, monospace">
                    {labelText}
                  </text>
                </g>
              </g>
            );
          }

          const labelX = g.from + 12 * invZ + badgeW / 2;
          return (
            <g key={`align_h_${idx}`} className="pointer-events-none">
              <line x1={g.from} y1={g.pos} x2={g.to} y2={g.pos} stroke={guideColor} strokeWidth={strokeW} strokeDasharray={dashArr} />
              <line x1={g.from} y1={g.pos - tick} x2={g.from} y2={g.pos + tick} stroke={guideColor} strokeWidth={strokeW} />
              <line x1={g.to} y1={g.pos - tick} x2={g.to} y2={g.pos + tick} stroke={guideColor} strokeWidth={strokeW} />
              <g transform={`translate(${labelX}, ${g.pos - 11 * invZ})`}>
                <rect x={-badgeW / 2} y={-badgeH / 2} width={badgeW} height={badgeH} rx={4 * invZ} fill={guideColor} />
                <text x={0} y={3.2 * invZ} textAnchor="middle" fill="#ffffff" fontSize={9 * invZ} fontWeight="700" fontFamily="ui-monospace, monospace">
                  {labelText}
                </text>
              </g>
            </g>
          );
        })}

        {/* Interactive Wi-Fi Coverage Perimeter Resize & Angle Width Handles */}
        {project.settings.showCoverageRadius &&
          !hiddenLayerSet.has('wifi') &&
          !isReadOnlyMode &&
          !lockedLayerSet.has('wifi') &&
          !connectingSource &&
          culledDeviceNodes.map(node => {
            const asset = node.assetId ? project.assets[node.assetId] : undefined;
            const wifiCov = resolveWifiCoverage(node, asset);
            if (!wifiCov) return null;
            if (isNodeEffectivelyLocked(node, project.settings, project.assets, isReadOnlyMode)) return null;

            const isSession = wifiResizeSession?.nodeId === node.id;
            const isSelectedNode = selectedNodeIdSet.has(node.id);
            const isSingleSelectedNode = isSelectedNode && selectedNodeIds.length === 1;
            const showHandles = isSession || isSelectedNode || hoveredNodeId === node.id;
            const activeMeters = isSession ? wifiResizeSession.currentMeters : wifiCov.radiusMeters;
            const activeAngle = isSession ? wifiResizeSession.currentAngleDeg : wifiCov.angleDeg;
            const isDirectional = activeAngle < 359.5;
            const radiusPx = wifiRadiusMetersToCanvasPx(activeMeters, project.settings.scale);
            const cx = node.x + node.width / 2;
            const cy = node.y + node.height / 2;
            const nodeRotDeg = node.rotation || 0;
            const rotRad = (nodeRotDeg * Math.PI) / 180;
            const halfAngleRad = ((activeAngle / 2) * Math.PI) / 180;
            const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
            const handleR = 5.5 * invZ;

            const beginWifiDrag = (mode: 'radius' | 'angle', e: React.PointerEvent) => {
              e.stopPropagation();
              onSelect('node', node.id);
              onBeginDragSnapshot?.();
              activePointerIdRef.current = e.pointerId;
              setWifiResizeSession({
                nodeId: node.id,
                centerX: cx,
                centerY: cy,
                mode,
                currentMeters: activeMeters,
                currentAngleDeg: activeAngle,
                nodeRotationDeg: nodeRotDeg
              });
            };

            const radiusHandles = isDirectional
              ? [
                  {
                    id: 'e',
                    x: cx + radiusPx * Math.cos(rotRad),
                    y: cy + radiusPx * Math.sin(rotRad),
                    cursor: 'cursor-ew-resize'
                  }
                ]
              : [
                  { id: 'e', x: cx + radiusPx, y: cy, cursor: 'cursor-ew-resize' },
                  { id: 'w', x: cx - radiusPx, y: cy, cursor: 'cursor-ew-resize' },
                  { id: 'n', x: cx, y: cy - radiusPx, cursor: 'cursor-ns-resize' },
                  { id: 's', x: cx, y: cy + radiusPx, cursor: 'cursor-ns-resize' }
                ];

            const angleHandleDist = radiusPx * 0.74;
            const angleHandles = isDirectional
              ? [
                  {
                    id: 'left',
                    x: cx + angleHandleDist * Math.cos(rotRad - halfAngleRad),
                    y: cy + angleHandleDist * Math.sin(rotRad - halfAngleRad)
                  },
                  {
                    id: 'right',
                    x: cx + angleHandleDist * Math.cos(rotRad + halfAngleRad),
                    y: cy + angleHandleDist * Math.sin(rotRad + halfAngleRad)
                  }
                ]
              : isSingleSelectedNode
              ? [
                  {
                    id: 'pinch',
                    x: cx + angleHandleDist * Math.cos(rotRad + Math.PI * 0.85),
                    y: cy + angleHandleDist * Math.sin(rotRad + Math.PI * 0.85)
                  }
                ]
              : [];

            return (
              <g key={`wifi_resize_${node.id}`}>
                {/* Transparent hit circumference / outer arc for easy drag-to-resize */}
                {isDirectional ? (
                  <path
                    d={buildArcSvgPath(cx, cy, radiusPx, nodeRotDeg, activeAngle)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10, 14 * invZ)}
                    className="cursor-ew-resize"
                    onPointerDown={(e) => beginWifiDrag('radius', e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <title>Kéo viền cung phủ sóng Wi-Fi để co giãn bán kính</title>
                  </path>
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radiusPx}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10, 14 * invZ)}
                    className="cursor-ew-resize"
                    onPointerDown={(e) => beginWifiDrag('radius', e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <title>Kéo viền vòng phủ sóng Wi-Fi để co giãn bán kính</title>
                  </circle>
                )}

                {showHandles && (
                  <>
                    {radiusHandles.map(pt => (
                      <circle
                        key={`wifi_h_${node.id}_${pt.id}`}
                        data-testid={pt.id === 'e' ? `wifi-resize-handle-${node.id}` : undefined}
                        cx={pt.x}
                        cy={pt.y}
                        r={handleR}
                        fill="#ffffff"
                        stroke="#059669"
                        strokeWidth={2 * invZ}
                        className={pt.cursor}
                        onPointerDown={(e) => beginWifiDrag('radius', e)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <title>Kéo để điều chỉnh bán kính phủ sóng Wi-Fi ({activeMeters} m)</title>
                      </circle>
                    ))}
                    {angleHandles.map(ah => {
                      const dSz = 5.2 * invZ;
                      return (
                        <polygon
                          key={`wifi_ang_${node.id}_${ah.id}`}
                          data-testid={ah.id === 'left' || ah.id === 'pinch' ? `wifi-angle-handle-${node.id}` : undefined}
                          points={`${ah.x},${ah.y - dSz} ${ah.x + dSz},${ah.y} ${ah.x},${ah.y + dSz} ${ah.x - dSz},${ah.y}`}
                          fill="#06b6d4"
                          stroke="#ffffff"
                          strokeWidth={1.6 * invZ}
                          className="cursor-pointer"
                          onPointerDown={(e) => beginWifiDrag('angle', e)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <title>Kéo để mở rộng / thu hẹp góc phát Wi-Fi ({activeAngle}°)</title>
                        </polygon>
                      );
                    })}
                  </>
                )}

                {isSession && (() => {
                  const areaSqm = computeSectorAreaSqm(activeMeters, activeAngle);
                  const scalePct = Math.round((activeMeters / 18) * 100);
                  const badgeText = `Wi-Fi R=${activeMeters}m (${scalePct}%) · ${activeAngle}° · ~${areaSqm}m²`;
                  const badgeW = (badgeText.length * 6.3 + 18) * invZ;
                  const badgeH = 22 * invZ;
                  const rx = cx + radiusPx * Math.cos(rotRad);
                  const ry = cy + radiusPx * Math.sin(rotRad);
                  return (
                    <g className="pointer-events-none">
                      <line
                        x1={cx}
                        y1={cy}
                        x2={rx}
                        y2={ry}
                        stroke="#059669"
                        strokeWidth={1.6 * invZ}
                        strokeDasharray={`${4 * invZ} ${3 * invZ}`}
                      />
                      <g transform={`translate(${(cx + rx) / 2}, ${(cy + ry) / 2 - 18 * invZ})`}>
                        <rect
                          x={-badgeW / 2}
                          y={-badgeH / 2}
                          width={badgeW}
                          height={badgeH}
                          rx={5 * invZ}
                          fill="#064e3b"
                          stroke="#34d399"
                          strokeWidth={1.2 * invZ}
                        />
                        <text
                          x={0}
                          y={4 * invZ}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize={10 * invZ}
                          fontWeight="700"
                          fontFamily="ui-monospace, monospace"
                        >
                          {badgeText}
                        </text>
                      </g>
                    </g>
                  );
                })()}
              </g>
            );
          })}

        {/* Interactive Camera FOV Range & Angle Handles */}
        {project.settings.showCoverageRadius &&
          !hiddenLayerSet.has('fov') &&
          !isReadOnlyMode &&
          !lockedLayerSet.has('fov') &&
          !connectingSource &&
          culledDeviceNodes.map(node => {
            const asset = node.assetId ? project.assets[node.assetId] : undefined;
            const camFov = resolveCameraFov(node, asset);
            if (!camFov) return null;
            if (isNodeEffectivelyLocked(node, project.settings, project.assets, isReadOnlyMode)) return null;

            const isSession = cameraFovSession?.nodeId === node.id;
            const isSelectedNode = selectedNodeIdSet.has(node.id);
            const showHandles = isSession || isSelectedNode || hoveredNodeId === node.id;
            const activeRange = isSession ? cameraFovSession.currentRangeMeters : camFov.rangeMeters;
            const activeFov = isSession ? cameraFovSession.currentFovAngle : camFov.fovAngle;
            const isOmni = activeFov >= 359.5;
            const rangePx = cameraRangeMetersToCanvasPx(activeRange, project.settings.scale);
            const cx = node.x + node.width / 2;
            const cy = node.y + node.height / 2;
            const nodeRotDeg = node.rotation || 0;
            const rotRad = (nodeRotDeg * Math.PI) / 180;
            const halfRad = ((activeFov / 2) * Math.PI) / 180;
            const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
            const handleR = 5.5 * invZ;

            const beginCamDrag = (mode: 'range' | 'angle', e: React.PointerEvent) => {
              e.stopPropagation();
              onSelect('node', node.id);
              onBeginDragSnapshot?.();
              activePointerIdRef.current = e.pointerId;
              setCameraFovSession({
                nodeId: node.id,
                centerX: cx,
                centerY: cy,
                mode,
                currentRangeMeters: activeRange,
                currentFovAngle: activeFov,
                nodeRotationDeg: nodeRotDeg
              });
            };

            const rangeTipX = cx + rangePx * Math.cos(rotRad);
            const rangeTipY = cy + rangePx * Math.sin(rotRad);
            const angDist = rangePx * 0.72;
            const dSz = 5.2 * invZ;
            const sideAngles = isOmni
              ? [{ id: 'pinch', rad: rotRad + Math.PI * 0.88 }]
              : [
                  { id: 'left', rad: rotRad - halfRad },
                  { id: 'right', rad: rotRad + halfRad }
                ];

            return (
              <g key={`cam_fov_handles_${node.id}`}>
                {isOmni ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={rangePx}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10, 14 * invZ)}
                    className="cursor-ew-resize"
                    onPointerDown={(e) => beginCamDrag('range', e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <title>Kéo viền vùng quan sát Camera để co giãn cự ly</title>
                  </circle>
                ) : (
                  <path
                    d={buildArcSvgPath(cx, cy, rangePx, nodeRotDeg, activeFov)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(10, 14 * invZ)}
                    className="cursor-ew-resize"
                    onPointerDown={(e) => beginCamDrag('range', e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <title>Kéo cung ngoài để thay đổi tầm quan sát Camera</title>
                  </path>
                )}

                {showHandles && (
                  <>
                    <circle
                      data-testid={`camera-range-handle-${node.id}`}
                      cx={rangeTipX}
                      cy={rangeTipY}
                      r={handleR}
                      fill="#ffffff"
                      stroke="#d97706"
                      strokeWidth={2 * invZ}
                      className="cursor-ew-resize"
                      onPointerDown={(e) => beginCamDrag('range', e)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <title>Kéo để tăng/giảm tầm quan sát Camera ({activeRange} m)</title>
                    </circle>
                    {sideAngles.map(sa => {
                      const sx = cx + angDist * Math.cos(sa.rad);
                      const sy = cy + angDist * Math.sin(sa.rad);
                      return (
                        <polygon
                          key={`cam_ang_${node.id}_${sa.id}`}
                          data-testid={sa.id === 'left' || sa.id === 'pinch' ? `camera-angle-handle-${node.id}` : undefined}
                          points={`${sx},${sy - dSz} ${sx + dSz},${sy} ${sx},${sy + dSz} ${sx - dSz},${sy}`}
                          fill="#f59e0b"
                          stroke="#ffffff"
                          strokeWidth={1.6 * invZ}
                          className="cursor-pointer"
                          onPointerDown={(e) => beginCamDrag('angle', e)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <title>Kéo để mở rộng / thu hẹp góc quét FOV Camera ({activeFov}°)</title>
                        </polygon>
                      );
                    })}
                  </>
                )}

                {isSession && (() => {
                  const areaSqm = computeSectorAreaSqm(activeRange, activeFov);
                  const scalePct = Math.round((activeRange / 30) * 100);
                  const badgeText = `FOV ${activeFov}° · ${activeRange}m (${scalePct}%) · ~${areaSqm}m²`;
                  const badgeW = (badgeText.length * 6.3 + 18) * invZ;
                  const badgeH = 22 * invZ;
                  return (
                    <g className="pointer-events-none">
                      <line
                        x1={cx}
                        y1={cy}
                        x2={rangeTipX}
                        y2={rangeTipY}
                        stroke="#d97706"
                        strokeWidth={1.6 * invZ}
                        strokeDasharray={`${4 * invZ} ${3 * invZ}`}
                      />
                      <g transform={`translate(${(cx + rangeTipX) / 2}, ${(cy + rangeTipY) / 2 - 18 * invZ})`}>
                        <rect
                          x={-badgeW / 2}
                          y={-badgeH / 2}
                          width={badgeW}
                          height={badgeH}
                          rx={5 * invZ}
                          fill="#78350f"
                          stroke="#fbbf24"
                          strokeWidth={1.2 * invZ}
                        />
                        <text
                          x={0}
                          y={4 * invZ}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize={10 * invZ}
                          fontWeight="700"
                          fontFamily="ui-monospace, monospace"
                        >
                          {badgeText}
                        </text>
                      </g>
                    </g>
                  );
                })()}
              </g>
            );
          })}

        {/* MS Word-Style 360-degree Interactive Rotation Handle (press & hold to rotate) */}
        {!isReadOnlyMode &&
          !connectingSource &&
          selectedNodeIds.length === 1 &&
          (() => {
            const targetId = selectedNodeIds[0];
            const node = visibleNodeMap.get(targetId);
            if (!node) return null;
            if (isNodeEffectivelyLocked(node, project.settings, project.assets, isReadOnlyMode)) {
              return null;
            }
            const effRect = getNodeEffectiveRect(node.id) || node;
            const cx = effRect.x + effRect.width / 2;
            const cy = effRect.y + effRect.height / 2;
            const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
            const framePad = 5 * invZ;
            const stemTopOffset = effRect.height / 2 + framePad + 20 * invZ;
            const isRotActive = rotationDragSession?.nodeId === node.id;
            const activeRot = isRotActive
              ? rotationDragSession.currentDeg
              : normalizeRotationDeg(node.rotation || 0);
            const rad = ((activeRot - 90) * Math.PI) / 180;
            const edgeX = cx + (effRect.height / 2 + framePad) * Math.cos(rad);
            const edgeY = cy + (effRect.height / 2 + framePad) * Math.sin(rad);
            const handleX = cx + stemTopOffset * Math.cos(rad);
            const handleY = cy + stemTopOffset * Math.sin(rad);
            const knobR = 9.5 * invZ;
            const strokeHex = isRotActive ? '#2563eb' : '#475569';

            return (
              <g key={`rotate_handle_${node.id}`}>
                <line
                  x1={edgeX}
                  y1={edgeY}
                  x2={handleX}
                  y2={handleY}
                  stroke={strokeHex}
                  strokeWidth={1.35 * invZ}
                  className="pointer-events-none"
                />
                <circle
                  data-testid={`node-rotate-handle-${node.id}`}
                  cx={handleX}
                  cy={handleY}
                  r={knobR}
                  fill="#ffffff"
                  stroke={strokeHex}
                  strokeWidth={1.35 * invZ}
                  style={{ filter: 'drop-shadow(0 1px 2px rgba(15,23,42,0.22))' }}
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    try {
                      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                    } catch {
                      // ignore
                    }
                    onSelect('node', node.id);
                    onBeginDragSnapshot?.();
                    activePointerIdRef.current = e.pointerId;
                    setRotationDragSession({
                      nodeId: node.id,
                      centerX: cx,
                      centerY: cy,
                      currentDeg: activeRot
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <title>Nhấn giữ chuột và kéo để xoay 360° ({activeRot}° · Giữ Shift bước 15°)</title>
                </circle>
                <g
                  transform={`translate(${handleX}, ${handleY}) scale(${invZ})`}
                  className="pointer-events-none"
                >
                  <path
                    d="M 3.6 -2.6 A 4.5 4.5 0 1 0 4.5 1.1"
                    fill="none"
                    stroke={strokeHex}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <polygon
                    points="4.8,-4.5 5.4,-0.8 1.6,-1.6"
                    fill={strokeHex}
                  />
                </g>
                {isRotActive && (
                  <g transform={`translate(${handleX}, ${handleY - 22 * invZ})`} className="pointer-events-none">
                    <rect
                      x={-24 * invZ}
                      y={-10 * invZ}
                      width={48 * invZ}
                      height={18 * invZ}
                      rx={4 * invZ}
                      fill="#0f172a"
                      stroke="#38bdf8"
                      strokeWidth={1.2 * invZ}
                    />
                    <text
                      x={0}
                      y={2.5 * invZ}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={10 * invZ}
                      fontWeight="700"
                      fontFamily="ui-monospace, monospace"
                    >
                      {activeRot}°
                    </text>
                  </g>
                )}
              </g>
            );
          })()}

        {resizingSession && (() => {
          const r = resizingSession.currentRect;
          const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
          const scale = normalizeScalePxPerMeter(project.settings.scale);
          const dimText =
            resizingSession.targetKind === 'room'
              ? `${(r.width / scale).toFixed(1)}m × ${(r.height / scale).toFixed(1)}m (${r.width}×${r.height}px)`
              : `${r.width} × ${r.height} px`;
          const badgeW = (dimText.length * 6.2 + 16) * invZ;
          const badgeH = 20 * invZ;
          const cx = r.x + r.width / 2;
          const by = r.y + r.height + 16 * invZ;
          return (
            <g transform={`translate(${cx}, ${by})`} className="pointer-events-none">
              <rect x={-badgeW / 2} y={-badgeH / 2} width={badgeW} height={badgeH} rx={5 * invZ} fill="#0f172a" stroke="#38bdf8" strokeWidth={1.2 * invZ} />
              <text x={0} y={3.5 * invZ} textAnchor="middle" fill="#ffffff" fontSize={10 * invZ} fontWeight="700" fontFamily="ui-monospace, monospace">
                {dimText}
              </text>
            </g>
          );
        })()}
        {measureSession && (() => {
          const { start, current } = measureSession;
          const dx = current.x - start.x;
          const dy = current.y - start.y;
          const distPx = Math.hypot(dx, dy);
          if (distPx < 2) return null;
          const invZ = 1 / Math.max(0.4, Math.min(zoom, 1.8));
          const scale = normalizeScalePxPerMeter(project.settings.scale);
          const distMeters = (distPx / scale).toFixed(2);
          const midX = (start.x + current.x) / 2;
          const midY = (start.y + current.y) / 2;
          const nx = -dy / distPx;
          const ny = dx / distPx;
          const tickLen = 7 * invZ;
          const cadDist = cadUnderlayDoc?.underlay.enabled
            ? computeCadUnderlayDistance(cadUnderlayDoc, start, current)
            : null;
          const cadUnitStr = cadDist
            ? cadDist.cadUnits >= 100
              ? String(Math.round(cadDist.cadUnits))
              : cadDist.cadUnits.toFixed(2)
            : '';
          const label = cadDist && cadUnderlayDoc?.header.$INSUNITS !== 0
            ? `${cadDist.meters.toFixed(2)} m · ${cadUnitStr} ${cadDist.unitShortLabel}`
            : `${distMeters} m · ${Math.round(distPx)} px`;
          const badgeW = (label.length * 6.8 + 16) * invZ;
          const badgeH = 22 * invZ;
          return (
            <g className="pointer-events-none">
              <line
                x1={start.x}
                y1={start.y}
                x2={current.x}
                y2={current.y}
                stroke="#155EEF"
                strokeWidth={2 * invZ}
                strokeDasharray={`${6 * invZ} ${4 * invZ}`}
              />
              <line
                x1={start.x - nx * tickLen}
                y1={start.y - ny * tickLen}
                x2={start.x + nx * tickLen}
                y2={start.y + ny * tickLen}
                stroke="#155EEF"
                strokeWidth={2 * invZ}
              />
              <line
                x1={current.x - nx * tickLen}
                y1={current.y - ny * tickLen}
                x2={current.x + nx * tickLen}
                y2={current.y + ny * tickLen}
                stroke="#155EEF"
                strokeWidth={2 * invZ}
              />
              <circle cx={start.x} cy={start.y} r={3.5 * invZ} fill="#155EEF" />
              <circle cx={current.x} cy={current.y} r={3.5 * invZ} fill="#155EEF" />
              <g transform={`translate(${midX}, ${midY - 16 * invZ})`}>
                <rect
                  x={-badgeW / 2}
                  y={-badgeH / 2}
                  width={badgeW}
                  height={badgeH}
                  rx={5 * invZ}
                  fill="#0f172a"
                  stroke="#3b82f6"
                  strokeWidth={1.2 * invZ}
                />
                <text
                  x={0}
                  y={4 * invZ}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={11 * invZ}
                  fontWeight="700"
                  fontFamily="ui-monospace, monospace"
                >
                  {label}
                </text>
              </g>
            </g>
          );
        })()}
        {cadSnapHit && (() => {
          const invZ = 1 / Math.max(0.4, Math.min(zoom, 1.8));
          const sz = 6 * invZ;
          const { x, y } = cadSnapHit.point;
          const tagW = (cadSnapHit.labelVi.length * 6 + 14) * invZ;
          return (
            <g className="pointer-events-none" transform={`translate(${x}, ${y})`}>
              <polygon
                points={`0,${-sz} ${sz},0 0,${sz} ${-sz},0`}
                fill="#06b6d4"
                fillOpacity={0.25}
                stroke="#22d3ee"
                strokeWidth={1.6 * invZ}
              />
              <g transform={`translate(${12 * invZ}, ${-14 * invZ})`}>
                <rect
                  x={0}
                  y={-9 * invZ}
                  width={tagW}
                  height={16 * invZ}
                  rx={4 * invZ}
                  fill="#083344"
                  stroke="#22d3ee"
                  strokeWidth={1 * invZ}
                />
                <text
                  x={tagW / 2}
                  y={2.5 * invZ}
                  textAnchor="middle"
                  fill="#cffafe"
                  fontSize={9.5 * invZ}
                  fontWeight="700"
                >
                  {cadSnapHit.labelVi}
                </text>
              </g>
            </g>
          );
        })()}
        </g>
      </svg>

      {/* Extracted HTML Overlays */}
      <CanvasSelectionOverlays
        containerRef={containerRef}
        showRulers={project.settings.showRulers !== false}
        project={project}
        selection={selection}
        selectedNodeIds={selectedNodeIds}
        nodeMap={nodeMap}
        zoom={zoom}
        pan={pan}
        viewportSize={viewportSize}
        isDraggingOrResizing={Boolean(draggingNodeIds || resizingSession)}
        isConnecting={Boolean(connectingSource)}
        isReadOnlyMode={isReadOnlyMode}
        iconPickerNodeId={iconPickerNodeId}
        iconPickerTab={iconPickerTab}
        nodeIconUploadError={nodeIconUploadError}
        confirmToolbarDelete={confirmToolbarDelete}
        pendingConnection={pendingConnection}
        editingCableLabel={editingCableLabel}
        getCableGeometry={getCableGeometry}
        onSetIconPickerNodeId={setIconPickerNodeId}
        onSetIconPickerTab={setIconPickerTab}
        onSetNodeIconUploadError={setNodeIconUploadError}
        onSetConfirmToolbarDelete={setConfirmToolbarDelete}
        onSetPendingConnection={setPendingConnection}
        onSetEditingCableLabel={setEditingCableLabel}
        onCommitInlineCableLabel={commitInlineCableLabel}
        onOpenInlineCableLabelEditor={openInlineCableLabelEditor}
        onResizeLegendToFit={onResizeLegendToFit}
        onToggleNodeLock={onToggleNodeLock}
        onToggleNodeVisibility={onToggleNodeVisibility}
        onDuplicateNodes={onDuplicateNodes}
        onUpdateNode={onUpdateNode}
        onRotateNodes={onRotateNodes}
        onMirrorNodes={onMirrorNodes}
        onSetNodeIconOrLogo={onSetNodeIconOrLogo}
        onSetConnectingSource={onSetConnectingSource}
        onSetCableColor={onSetCableColor}
        onUpdateCable={onUpdateCable}
        onAutoRouteCable={onAutoRouteCable}
        onAddCable={onAddCable}
        onDeleteSelected={onDeleteSelected}
      />

      {/* Edge Rulers & Draggable Reference Guide Lines */}
      <CanvasGuideOverlay
        containerRef={containerRef}
        viewportSize={viewportSize}
        zoom={zoom}
        pan={pan}
        scale={normalizeScalePxPerMeter(project.settings.scale)}
        unit={project.settings.unit || 'm'}
        isDarkSurface={canvasAppearance.isDarkCanvas}
        showRulers={project.settings.showRulers !== false}
        isReadOnlyMode={isReadOnlyMode}
        activeFloorId={project.activeFloorId}
        guideLines={project.settings.guideLines || []}
        onChangeGuideLines={nextGuideLines => onUpdateSettings?.({ guideLines: nextGuideLines })}
      />

      {/* Extracted HUD Controls */}
      <CanvasHudControls
        containerRef={containerRef}
        project={project}
        selection={selection}
        visibleNodes={visibleNodes}
        visibleRooms={visibleRooms}
        nodeMap={nodeMap}
        selectedNodeIdSet={selectedNodeIdSet}
        overlappingNodeIds={overlapReport.overlappingNodeIds}
        canvasAppearance={canvasAppearance}
        showBgMenu={showBgMenu}
        bgUploadError={bgUploadError}
        bgFileInputRef={bgFileInputRef}
        connectingSource={connectingSource}
        connectingSourceNode={connectingSourceNode}
        reconnectingCableEndpoint={reconnectingCable?.endpoint || null}
        activeBundleInfo={activeBundleInfo}
        collapsedBundleIds={collapsedBundleIds}
        touchContextMenu={touchContextMenu}
        showMinimap={showMinimap}
        minimapBounds={minimapBounds}
        viewportSize={viewportSize}
        zoom={zoom}
        pan={pan}
        isReadOnlyMode={isReadOnlyMode}
        onSetShowBgMenu={setShowBgMenu}
        onSetBgUploadError={setBgUploadError}
        onSetActiveBundleId={setActiveBundleId}
        onSetCollapsedBundleIds={setCollapsedBundleIds}
        onSetHoveredCableId={setHoveredCableId}
        onSetTouchContextMenu={setTouchContextMenu}
        onSetIconPickerNodeId={setIconPickerNodeId}
        onUpdateSettings={onUpdateSettings}
        onSelect={onSelect}
        onSelectMultipleNodes={onSelectMultipleNodes}
        onSetConnectingSource={onSetConnectingSource}
        onOpenTemplates={onOpenTemplates}
        onAddQuickDevice={onAddQuickDevice}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenBuildingGenerator={onOpenBuildingGenerator}
        onSetActiveFloor={onSetActiveFloor}
        onCloneFloor={onCloneFloor}
        onDuplicateNodes={onDuplicateNodes}
        smartClipboardNodeIds={smartClipboardNodeIds}
        onSmartCopyPasteNodes={onSmartCopyPasteNodes}
        onCopyNodesToClipboard={onCopyNodesToClipboard}
        onToggleNodeLock={onToggleNodeLock}
        onOpenDeepInspect={onOpenDeepInspect}
        onDeleteSelected={onDeleteSelected}
        onAutoRouteCable={onAutoRouteCable}
        onUpdateCable={onUpdateCable}
        getCableGeometry={getCableGeometry}
        onOpenInlineCableLabelEditor={openInlineCableLabelEditor}
        onPanChange={onPanChange}
      />

      {hoveredRackSubDevice && !isPanning && !draggingNodeIds && !draggingRackDevice && (
        <RackSubDeviceTooltip
          info={hoveredRackSubDevice}
          containerRect={containerRef.current?.getBoundingClientRect() ?? null}
          onMouseEnter={clearRackTooltipTimer}
          onMouseLeave={() => handleHoverRackSubDevice(null)}
          onOpenDeepInspect={onOpenDeepInspect}
          onSelectDevice={(assetId, rackId) => {
            const matchedNode = project.nodes.find(
              n => n.assetId === assetId && !n.hidden
            );
            if (matchedNode) {
              onSelect('node', matchedNode.id);
            } else {
              onSelect('rack', rackId);
            }
            setHoveredRackSubDevice(null);
          }}
          onClose={() => {
            clearRackTooltipTimer();
            setHoveredRackSubDevice(null);
          }}
        />
      )}

      {!isReadOnlyMode && activeTool === 'tray' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/92 text-white text-xs shadow-lg border border-slate-700">
          <span>
            Nhấp để đặt điểm máng cáp ({trayDraftPoints.length} điểm) · Nhấp đúp / Enter để hoàn tất · Esc để hủy
          </span>
          {trayDraftPoints.length >= 2 && (
            <button
              type="button"
              onClick={() => commitTrayDraft()}
              className="px-2 py-0.5 rounded bg-[#155EEF] hover:bg-blue-500 text-white font-semibold"
            >
              Hoàn tất
            </button>
          )}
          {trayDraftPoints.length > 0 && (
            <button
              type="button"
              onClick={() => setTrayDraftPoints([])}
              className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium"
            >
              Hủy
            </button>
          )}
        </div>
      )}
    </div>
  );
};
