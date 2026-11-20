import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CableEdge, DiagramNode, ProjectState, RackSide, SelectionState } from '../../types/infrastructure';
import type { CanvasTool } from '../../store/useProjectStore';
import type { CADDocument } from '../../cad/core/CADTypes';
import { DEVICE_CATALOG } from '../../data/deviceCatalog';
import {
  canDragNodeIn3DScene,
  canInsertIn3DScene,
  isNodeEffectivelyLocked,
  isNodePositionLocked
} from '../../utils/layerPolicy';
import type {
  CameraPresetId,
  Network3DSceneHandle,
  RenderQualityLevel,
  View3DDisplayOptions
} from '../../contexts/ViewportContext';
import {
  applyGlobalShadowMapping,
  applySceneWireframeMode,
  detectSoftwareGl,
  createContactShadowTexture,
  createLockBadgeTexture,
  createWorldAxesHelper,
  getPixelRatioForQuality,
  setupStudioEnvironment,
  StudioRenderQuality,
  StudioRigCleanup
} from './three/studioEnvironment';
import {
  extractCameraRotationMatrix,
  projectCornerAxesFromCameraMatrix,
  AxisId
} from './three/axisHelperProjection';
import {
  clampFloatingPosition,
  DockSideOrFree,
  FloatingPanelPosition,
  resolveEdgeOrFreeDrop,
  useFloatingPanel
} from '../../hooks/useFloatingPanel';
import {
  WORLD_SCALE,
  build3DCableCurve,
  build3DCableGeometry,
  populateInfrastructure3DWorld,
  refreshNode3DCoverageAndGizmos,
  disposeObjectTree,
  worldXZToCanvas,
  computeRackUnitFromWorldY,
  Populated3DCableEntry,
  World3DBounds,
  WorldCoordinateOrigin
} from './three/proceduralDevices';
import { rotationDegToThreeYRad } from '../../engineering';
import { ThreeResourceRegistry } from './three/resourceRegistry';
import {
  CAMERA_FOV_MAX_DEG,
  CAMERA_FOV_MIN_DEG,
  CAMERA_FOV_SCALE_FACTOR,
  CAMERA_RANGE_MAX_M,
  CAMERA_RANGE_MIN_M,
  WIFI_MAX_ANGLE_DEG,
  WIFI_MAX_RADIUS_M,
  WIFI_MIN_ANGLE_DEG,
  WIFI_MIN_RADIUS_M,
  cameraRangeFromAreaSqm,
  cameraRangeFromScalePct,
  clampCameraFovDeg,
  clampCameraRangeMeters,
  clampWifiAngleDeg,
  clampWifiRadiusMeters,
  computeSectorAreaSqm,
  normalizeRotationDeg,
  resolveCameraFov,
  resolveWifiCoverage,
  signedAngularDiffDeg,
  wifiRadiusFromAreaSqm,
  wifiRadiusFromScalePct
} from '../../utils/coverageUtils';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import { getAssetUHeight } from '../../utils/rackGeometry';
import { computeRackThermalOverlayData, getSubDeviceThermalReading, ThermalRiskLevel } from '../../utils/rackAirflow';
import { RackSubDeviceTooltip, HoveredRackSubDeviceInfo } from './RackSubDeviceTooltip';
import { FloorSwitcher3DOverlay } from './FloorSwitcher3DOverlay';
import { useFloorFiltered3DProject } from '../../hooks/useFloorFiltered3DProject';
import {
  Box,
  Compass,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  GitBranch,
  Grid3x3,
  GripHorizontal,
  GripVertical,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Move,
  RotateCw,
  SlidersHorizontal,
  Spline,
  Sun,
  Thermometer,
  Trash2,
  ChevronDown,
  ChevronUp,
  Unlock,
  Video,
  Wifi
} from 'lucide-react';

interface Network3DSceneProps {
  project: ProjectState;
  selection: SelectionState;
  activeTool?: CanvasTool;
  isReadOnlyMode?: boolean;
  isSceneDragLocked?: boolean;
  draggedPresetName?: string | null;
  view3DOptions?: View3DDisplayOptions;
  onChangeView3DOptions?: React.Dispatch<React.SetStateAction<View3DDisplayOptions>>;
  onContextLostChange?: (lost: boolean) => void;
  onSelect: (type: SelectionState['type'], id?: string) => void;
  onSetTool?: (tool: CanvasTool) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onUpdateNode?: (nodeId: string, partial: Partial<DiagramNode>) => void;
  cadUnderlayDoc?: CADDocument | null;
  onAddCable?: (
    sourceNodeId: string,
    targetNodeId: string,
    sourcePortId?: string,
    targetPortId?: string,
    options?: {
      cableType?: CableEdge['cableType'];
      color?: string;
      routingType?: CableEdge['routingType'];
    }
  ) => void;
  onUpdateCable?: (cableId: string, partial: Partial<CableEdge>) => void;
  onAutoRouteCable?: (cableId: string) => void;
  onAutoRouteAllCables?: () => void;
  onDeleteCable?: (cableId: string) => void;
  onBeginDragSnapshot?: () => void;
  onMoveNodesTransient?: (nodeIds: string[], dx: number, dy: number) => void;
  onSnapNodesAndCommitDrag?: (nodeIds: string[], options?: { snapX?: boolean; snapY?: boolean }) => void;
  onRotateNodesTransient?: (nodeIds: string[], rotationDeg: number) => void;
  onRotateNodes?: (nodeIds: string[], rotationDeg: number) => void;
  onMirrorNodes?: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  onUpdateWifiCoverageTransient?: (nodeId: string, partial: { radiusMeters?: number; angleDeg?: number }) => void;
  onUpdateWifiCoverage?: (nodeId: string, partial: { radiusMeters?: number; angleDeg?: number }) => void;
  onUpdateCameraFovTransient?: (nodeId: string, partial: { fovAngle?: number; irDistanceMeters?: number }) => void;
  onUpdateCameraFov?: (nodeId: string, partial: { fovAngle?: number; irDistanceMeters?: number }) => void;
  onToggleSceneDragLocked?: () => void;
  onUpdateSettings?: (partial: Partial<ProjectState['settings']>) => void;
  onDropDevice?: (
    presetName: string,
    x: number,
    y: number,
    options?: { elevationZ?: number }
  ) => void;
  onDropDeviceIntoRack?: (
    presetName: string,
    rackId: string,
    preferredU: number,
    side?: RackSide
  ) => void;
  onOpenDeepInspect: (rackId: string) => void;
  onExit3D: () => void;
  onSetActiveFloor?: (floorId: string) => void;
  onSetActiveFloorId?: (floorId: string) => void;
  onCloneFloor?: (floorId: string, newLevel: number, newName: string) => void;
}

type DockEdge = DockSideOrFree;

const DOCK_EDGE_STORAGE_KEY = 'hachihi:3d-dock-edge';
const DOCK_FREE_POS_STORAGE_KEY = 'hachihi:3d-dock-free-pos';
const DOCK_COLLAPSED_STORAGE_KEY = 'hachihi:3d-dock-collapsed';

function loadSavedDockEdge(): DockEdge {
  try {
    const val = window.localStorage.getItem(DOCK_EDGE_STORAGE_KEY);
    if (val === 'left' || val === 'right' || val === 'bottom' || val === 'free') return val;
  } catch {
    // ignore storage errors
  }
  return 'bottom';
}

function loadSavedDockFreePos(): FloatingPanelPosition | null {
  try {
    const raw = window.localStorage.getItem(DOCK_FREE_POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FloatingPanelPosition;
    if (typeof parsed?.x === 'number' && Number.isFinite(parsed.x) && typeof parsed?.y === 'number' && Number.isFinite(parsed.y)) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function loadSavedDockCollapsed(): boolean {
  try {
    return window.localStorage.getItem(DOCK_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

interface DragSessionItem {
  nodeId: string;
  group: THREE.Group;
  startGroupPos: THREE.Vector3;
  startNodeX: number;
  startNodeY: number;
}

type DragSessionMode = 'move' | 'rotate' | 'wifi-range' | 'wifi-angle' | 'camera-range' | 'camera-angle';

interface DragSession {
  mode: DragSessionMode;
  pointerId: number;
  nodeId: string;
  selectType: 'node' | 'rack' | 'edge';
  selectId: string;
  label: string;
  preserveSelection: boolean;
  items: DragSessionItem[];
  draggedIdSet: Set<string>;
  dragPlane: THREE.Plane;
  startClientPos: { x: number; y: number };
  startHitPoint: THREE.Vector3;
  startAnchorX: number;
  startAnchorY: number;
  lastAppliedDx: number;
  lastAppliedDy: number;
  hasMoved: boolean;
}

const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _targetCamPos = new THREE.Vector3();
const _targetCtrlTarget = new THREE.Vector3();
const _dragHitPoint = new THREE.Vector3();
const _planeNormal = new THREE.Vector3(0, 1, 0);
const _camRotMatrix = new THREE.Matrix4();

export const Network3DScene = forwardRef<Network3DSceneHandle, Network3DSceneProps>(({
  project,
  selection,
  activeTool = 'select',
  isReadOnlyMode = false,
  isSceneDragLocked = true,
  draggedPresetName = null,
  view3DOptions: externalViewOptions,
  onChangeView3DOptions,
  onContextLostChange,
  onSelect,
  onSetTool,
  onToggleNodeLock,
  onUpdateNode,
  onAddCable,
  onUpdateCable,
  onAutoRouteCable,
  onAutoRouteAllCables,
  onDeleteCable,
  onBeginDragSnapshot,
  onMoveNodesTransient,
  onSnapNodesAndCommitDrag,
  onRotateNodesTransient,
  onRotateNodes,
  onMirrorNodes,
  onUpdateWifiCoverageTransient,
  onUpdateWifiCoverage,
  onUpdateCameraFovTransient,
  onUpdateCameraFov,
  onToggleSceneDragLocked,
  onUpdateSettings,
  onDropDevice,
  onDropDeviceIntoRack,
  onOpenDeepInspect,
  onExit3D,
  onSetActiveFloor,
  onSetActiveFloorId,
  onCloneFloor,
  cadUnderlayDoc
}, ref) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const gizmoLayerRef = useRef<SVGGElement>(null);
  const gizmoGroupXRef = useRef<SVGGElement>(null);
  const gizmoGroupYRef = useRef<SVGGElement>(null);
  const gizmoGroupZRef = useRef<SVGGElement>(null);
  const gizmoPosLineXRef = useRef<SVGLineElement>(null);
  const gizmoPosLineYRef = useRef<SVGLineElement>(null);
  const gizmoPosLineZRef = useRef<SVGLineElement>(null);
  const gizmoNegLineXRef = useRef<SVGLineElement>(null);
  const gizmoNegLineYRef = useRef<SVGLineElement>(null);
  const gizmoNegLineZRef = useRef<SVGLineElement>(null);
  const gizmoDotXRef = useRef<SVGCircleElement>(null);
  const gizmoDotYRef = useRef<SVGCircleElement>(null);
  const gizmoDotZRef = useRef<SVGCircleElement>(null);
  const gizmoTextXRef = useRef<SVGTextElement>(null);
  const gizmoTextYRef = useRef<SVGTextElement>(null);
  const gizmoTextZRef = useRef<SVGTextElement>(null);

  const xyzPanel = useFloatingPanel({
    containerRef: rootRef,
    storageKey: 'hachihi:3d-xyz-panel',
    defaultCollapsed: false
  });
  const renderControlsPanel = useFloatingPanel({
    containerRef: rootRef,
    storageKey: 'hachihi:3d-render-panel',
    defaultCollapsed: false
  });
  const floorPanel = useFloatingPanel({
    containerRef: rootRef,
    storageKey: 'hachihi:3d-floor-panel',
    defaultCollapsed: false
  });

  const [webglError, setWebglError] = useState<string | null>(null);
  const [internalViewOptions, setInternalViewOptions] = useState<View3DDisplayOptions>(() => ({
    showAxes: true,
    explodeSpread: 0,
    viewAllFloors: project.floors.length > 1,
    activePreset: 'iso',
    wireframeMode: false,
    renderQuality: 'high',
    shadowsEnabled: true,
    showThermalHeatmap: true
  }));
  const effectiveViewOptions = externalViewOptions ?? internalViewOptions;
  const updateViewOptions = useCallback(
    (updater: React.SetStateAction<View3DDisplayOptions>) => {
      if (onChangeView3DOptions) {
        onChangeView3DOptions(updater);
      } else {
        setInternalViewOptions(updater);
      }
    },
    [onChangeView3DOptions]
  );

  const showAxes = effectiveViewOptions.showAxes;
  const explodeSpread = effectiveViewOptions.explodeSpread;
  const viewAllFloors = effectiveViewOptions.viewAllFloors;
  const activePreset = effectiveViewOptions.activePreset;
  const wireframeMode = effectiveViewOptions.wireframeMode;
  const renderQuality = effectiveViewOptions.renderQuality;
  const shadowsEnabled = effectiveViewOptions.shadowsEnabled;
  const showThermalHeatmap = effectiveViewOptions.showThermalHeatmap ?? true;

  const setViewAllFloors = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      updateViewOptions(prev => ({
        ...prev,
        viewAllFloors: typeof updater === 'function' ? updater(prev.viewAllFloors) : updater
      }));
    },
    [updateViewOptions]
  );
  const setActivePreset = useCallback(
    (preset: CameraPresetId) => {
      updateViewOptions(prev => (prev.activePreset === preset ? prev : { ...prev, activePreset: preset }));
    },
    [updateViewOptions]
  );
  const toggleWireframeMode = useCallback(() => {
    updateViewOptions(prev => ({ ...prev, wireframeMode: !prev.wireframeMode }));
  }, [updateViewOptions]);
  const setRenderQuality = useCallback(
    (quality: RenderQualityLevel) => {
      updateViewOptions(prev => (prev.renderQuality === quality ? prev : { ...prev, renderQuality: quality }));
    },
    [updateViewOptions]
  );
  const toggleShadowsEnabled = useCallback(() => {
    updateViewOptions(prev => ({ ...prev, shadowsEnabled: !prev.shadowsEnabled }));
  }, [updateViewOptions]);
  const toggleShowThermalHeatmap = useCallback(() => {
    updateViewOptions(prev => ({
      ...prev,
      showThermalHeatmap: !(prev.showThermalHeatmap ?? true)
    }));
  }, [updateViewOptions]);

  const [hoveredRackSubDevice, setHoveredRackSubDevice] = useState<HoveredRackSubDeviceInfo | null>(null);
  const rackTooltipTimerRef = useRef<number | null>(null);
  const clearRackTooltipTimer = useCallback(() => {
    if (rackTooltipTimerRef.current !== null) {
      window.clearTimeout(rackTooltipTimerRef.current);
      rackTooltipTimerRef.current = null;
    }
  }, []);
  const scheduleHideRackTooltip = useCallback(() => {
    clearRackTooltipTimer();
    rackTooltipTimerRef.current = window.setTimeout(() => {
      setHoveredRackSubDevice(null);
      rackTooltipTimerRef.current = null;
    }, 150);
  }, [clearRackTooltipTimer]);
  useEffect(() => {
    return () => {
      clearRackTooltipTimer();
    };
  }, [clearRackTooltipTimer]);

  const [dockDrawer, setDockDrawer] = useState<'none' | 'routing'>('none');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(loadSavedDockCollapsed);
  const [dockEdge, setDockEdge] = useState<DockEdge>(loadSavedDockEdge);
  const [dockFreePos, setDockFreePos] = useState<FloatingPanelPosition | null>(loadSavedDockFreePos);
  const [dockDragPreview, setDockDragPreview] = useState<{
    left: number;
    top: number;
    previewEdge: DockEdge;
    freePos?: FloatingPanelPosition;
  } | null>(null);
  const [draggingHud, setDraggingHud] = useState<{ label: string; x: number; y: number; metricText?: string } | null>(null);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [preferredRouting, setPreferredRouting] = useState<CableEdge['routingType']>('orthogonal');
  const [rebuildNonce, setRebuildNonce] = useState(0);
  const [rendererEpoch, setRendererEpoch] = useState(0);

  const autoFrameNextBuildRef = useRef(true);
  const prevProjectIdRef = useRef(project.id);
  const prevViewAllFloorsRef = useRef(viewAllFloors);
  const prevActiveModeRef = useRef(project.activeMode);
  const prevActiveFloorIdRef = useRef(project.activeFloorId);

  const projectRef = useRef(project);
  projectRef.current = project;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const isReadOnlyRef = useRef(isReadOnlyMode);
  isReadOnlyRef.current = isReadOnlyMode;
  const isSceneDragLockedRef = useRef(isSceneDragLocked);
  isSceneDragLockedRef.current = isSceneDragLocked;
  const connectSourceIdRef = useRef(connectSourceId);
  connectSourceIdRef.current = connectSourceId;
  const preferredRoutingRef = useRef(preferredRouting);
  preferredRoutingRef.current = preferredRouting;
  const explodeSpreadRef = useRef(explodeSpread);
  explodeSpreadRef.current = explodeSpread;
  const wireframeModeRef = useRef(wireframeMode);
  wireframeModeRef.current = wireframeMode;
  const renderQualityRef = useRef(renderQuality);
  renderQualityRef.current = renderQuality;
  const shadowsEnabledRef = useRef(shadowsEnabled);
  shadowsEnabledRef.current = shadowsEnabled;
  const updateViewOptionsRef = useRef(updateViewOptions);
  updateViewOptionsRef.current = updateViewOptions;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onAddCableRef = useRef(onAddCable);
  onAddCableRef.current = onAddCable;
  const onBeginDragSnapshotRef = useRef(onBeginDragSnapshot);
  onBeginDragSnapshotRef.current = onBeginDragSnapshot;
  const onMoveNodesTransientRef = useRef(onMoveNodesTransient);
  onMoveNodesTransientRef.current = onMoveNodesTransient;
  const onSnapNodesAndCommitDragRef = useRef(onSnapNodesAndCommitDrag);
  onSnapNodesAndCommitDragRef.current = onSnapNodesAndCommitDrag;
  const onRotateNodesTransientRef = useRef(onRotateNodesTransient);
  onRotateNodesTransientRef.current = onRotateNodesTransient;
  const onUpdateWifiCoverageTransientRef = useRef(onUpdateWifiCoverageTransient);
  onUpdateWifiCoverageTransientRef.current = onUpdateWifiCoverageTransient;
  const onUpdateCameraFovTransientRef = useRef(onUpdateCameraFovTransient);
  onUpdateCameraFovTransientRef.current = onUpdateCameraFovTransient;
  const onOpenDeepInspectRef = useRef(onOpenDeepInspect);
  onOpenDeepInspectRef.current = onOpenDeepInspect;

  const [dropHoverState, setDropHoverState] = useState<'allowed' | 'locked' | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);

  const sceneRefs = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    worldRoot: THREE.Group;
    axesGroup: THREE.Group;
    connectPreviewLine: THREE.Line;
    studioRig: StudioRigCleanup;
    resourceRegistry: ThreeResourceRegistry;
    shadowTex: THREE.Texture;
    lockBadgeTex: THREE.Texture;
    isSoftwareGl: boolean;
    transitioning: boolean;
    requestRender: () => void;
    origin: WorldCoordinateOrigin;
    activeFloorY: number;
    worldBounds: World3DBounds;
    nodeGroups: Map<string, { group: THREE.Group; node: DiagramNode; floorY: number }>;
    cableEntries: Populated3DCableEntry[];
  } | null>(null);

  // Filter project entities and device assets dynamically based on store.project.activeFloorId (unless viewing whole-building cutaway)
  const {
    activeFloorId: resolvedActiveFloorId,
    isFloorBasedMode: isFloorBasedMode3D,
    filteredProject,
    filteredAssets
  } = useFloorFiltered3DProject(project, viewAllFloors);

  // Resolve currently selected 3D device or rack within the active floor view
  const selectedTarget = useMemo(() => {
    if ((selection.type !== 'node' && selection.type !== 'rack') || !selection.id) return null;

    let primaryNode: DiagramNode | undefined;
    if (selection.type === 'rack') {
      primaryNode = filteredProject.nodes.find(
        n =>
          n.type === 'rack' &&
          (n.customData?.rackId === selection.id || n.id === selection.id)
      );
    } else {
      primaryNode = filteredProject.nodes.find(n => n.id === selection.id);
    }
    if (!primaryNode) return null;

    const idSet = new Set<string>([primaryNode.id]);
    if (selection.type === 'node' && selection.additionalIds?.length) {
      selection.additionalIds.forEach(id => idSet.add(id));
    }

    const targetNodes = filteredProject.nodes.filter(n => idSet.has(n.id));
    if (targetNodes.length === 0) return null;

    const allNodeLocked = targetNodes.every(n => isNodePositionLocked(n));
    const allEffectiveLocked = targetNodes.every(n =>
      isNodeEffectivelyLocked(n, filteredProject.settings, filteredAssets, false)
    );
    const layerLockedOnly = allEffectiveLocked && !allNodeLocked;

    const rackInfo =
      primaryNode.type === 'rack'
        ? filteredProject.racks.find(
            r =>
              r.id === primaryNode?.customData?.rackId ||
              r.id === primaryNode?.id ||
              r.name === primaryNode?.label
          )
        : undefined;
    const assetInfo = primaryNode.assetId ? filteredAssets[primaryNode.assetId] : undefined;
    const baseLabel = rackInfo?.name || assetInfo?.name || primaryNode.label;
    const wifiCov = targetNodes.length === 1 && primaryNode.type !== 'rack' ? resolveWifiCoverage(primaryNode, assetInfo) : null;
    const camFov = targetNodes.length === 1 && primaryNode.type !== 'rack' ? resolveCameraFov(primaryNode, assetInfo) : null;

    return {
      anchorNodeId: primaryNode.id,
      nodeIds: targetNodes.map(n => n.id),
      label: targetNodes.length > 1 ? `${baseLabel} (+${targetNodes.length - 1})` : baseLabel,
      isRack: primaryNode.type === 'rack',
      rackId: rackInfo?.id || primaryNode.id,
      isNodeLocked: allNodeLocked,
      isEffectiveLocked: allEffectiveLocked,
      layerLockedOnly,
      x: Math.round(primaryNode.x),
      y: Math.round(primaryNode.y),
      rotation: normalizeRotationDeg(primaryNode.rotation || 0),
      flipX: Boolean(primaryNode.flipX),
      flipY: Boolean(primaryNode.flipY),
      wifiCov,
      camFov,
      wifiLayerLocked: (filteredProject.settings.lockedLayers || []).includes('wifi'),
      fovLayerLocked: (filteredProject.settings.lockedLayers || []).includes('fov')
    };
  }, [filteredAssets, filteredProject, selection]);

  // Resolve currently selected 3D cable edge for routing/editing UI
  const selectedCable = useMemo(() => {
    if (selection.type !== 'edge' || !selection.id) return null;
    const cable = filteredProject.cables.find(c => c.id === selection.id);
    if (!cable) return null;
    const srcNode = filteredProject.nodes.find(n => n.id === cable.sourceNodeId);
    const tgtNode = filteredProject.nodes.find(n => n.id === cable.targetNodeId);
    return {
      cable,
      sourceLabel: srcNode?.label || 'Nguồn',
      targetLabel: tgtNode?.label || 'Đích'
    };
  }, [filteredProject.cables, filteredProject.nodes, selection]);

  const selectedPanel = useFloatingPanel({
    containerRef: rootRef,
    storageKey: 'hachihi:3d-selected-object-panel',
    defaultCollapsed: false,
    isOpen: Boolean((selectedTarget || selectedCable) && !draggingHud)
  });

  const connectSourceLabel = useMemo(() => {
    if (!connectSourceId) return null;
    return filteredProject.nodes.find(n => n.id === connectSourceId)?.label || 'Thiết bị';
  }, [connectSourceId, filteredProject.nodes]);

  // Persist dock edge & collapsed state cleanly
  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_EDGE_STORAGE_KEY, dockEdge);
    } catch {
      // ignore
    }
  }, [dockEdge]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_COLLAPSED_STORAGE_KEY, String(dockCollapsed));
    } catch {
      // ignore
    }
  }, [dockCollapsed]);

  // Clear in-progress connect session if 3D is locked, read-only, or tool switched away from connect
  useEffect(() => {
    if (isSceneDragLocked || isReadOnlyMode || activeTool !== 'connect') {
      if (connectSourceId) {
        setConnectSourceId(null);
      }
      const line = sceneRefs.current?.connectPreviewLine;
      if (line && line.visible) {
        line.visible = false;
        sceneRefs.current?.requestRender();
      }
    }
  }, [isSceneDragLocked, isReadOnlyMode, activeTool, connectSourceId]);

  const prevSceneDragLockedRef = useRef(isSceneDragLocked);
  useEffect(() => {
    if (prevSceneDragLockedRef.current && !isSceneDragLocked && !isReadOnlyMode) {
      setDockCollapsed(false);
      setDockDrawer(curr => (curr === 'none' ? 'routing' : curr));
    }
    prevSceneDragLockedRef.current = isSceneDragLocked;
  }, [isSceneDragLocked, isReadOnlyMode]);

  // Esc key cancels active 3D cable connection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connectSourceIdRef.current) {
        setConnectSourceId(null);
        const line = sceneRefs.current?.connectPreviewLine;
        if (line) {
          line.visible = false;
          sceneRefs.current?.requestRender();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToggleSelectedLock = useCallback(() => {
    if (!selectedTarget || isReadOnlyMode || selectedTarget.layerLockedOnly) return;
    if (onToggleNodeLock) {
      onToggleNodeLock(selectedTarget.nodeIds);
      return;
    }
    if (onUpdateNode) {
      const nextLocked = !selectedTarget.isNodeLocked;
      for (const nodeId of selectedTarget.nodeIds) {
        const curr = projectRef.current.nodes.find(n => n.id === nodeId);
        if (!curr) continue;
        onUpdateNode(nodeId, {
          locked: nextLocked,
          customData: {
            ...(curr.customData || {}),
            locked: nextLocked
          }
        });
      }
    }
  }, [selectedTarget, isReadOnlyMode, onToggleNodeLock, onUpdateNode]);

  const updateFloatingOverlays = useCallback(() => {
    const refs = sceneRefs.current;
    const container = mountRef.current;
    if (!refs || !container) return;

    // 1. Update corner XYZ Axis Helper using camera's inverse rotation matrix (depth-sorted back-to-front)
    extractCameraRotationMatrix(refs.camera, _camRotMatrix);
    const projectedAxes = projectCornerAxesFromCameraMatrix(_camRotMatrix, 38, 22, 9);
    const axisRefs: Record<
      AxisId,
      {
        group: SVGGElement | null;
        posLine: SVGLineElement | null;
        negLine: SVGLineElement | null;
        dot: SVGCircleElement | null;
        text: SVGTextElement | null;
      }
    > = {
      X: {
        group: gizmoGroupXRef.current,
        posLine: gizmoPosLineXRef.current,
        negLine: gizmoNegLineXRef.current,
        dot: gizmoDotXRef.current,
        text: gizmoTextXRef.current
      },
      Y: {
        group: gizmoGroupYRef.current,
        posLine: gizmoPosLineYRef.current,
        negLine: gizmoNegLineYRef.current,
        dot: gizmoDotYRef.current,
        text: gizmoTextYRef.current
      },
      Z: {
        group: gizmoGroupZRef.current,
        posLine: gizmoPosLineZRef.current,
        negLine: gizmoNegLineZRef.current,
        dot: gizmoDotZRef.current,
        text: gizmoTextZRef.current
      }
    };

    const layerEl = gizmoLayerRef.current;
    for (const item of projectedAxes) {
      const el = axisRefs[item.axis];
      if (!el.group || !el.posLine || !el.negLine || !el.dot || !el.text) continue;
      el.posLine.setAttribute('x2', item.px.toFixed(1));
      el.posLine.setAttribute('y2', item.py.toFixed(1));
      el.negLine.setAttribute('x2', item.nx.toFixed(1));
      el.negLine.setAttribute('y2', item.ny.toFixed(1));
      el.dot.setAttribute('cx', item.px.toFixed(1));
      el.dot.setAttribute('cy', item.py.toFixed(1));
      el.text.setAttribute('x', item.tx.toFixed(1));
      el.text.setAttribute('y', (item.ty + 3.2).toFixed(1));
      el.group.setAttribute('opacity', item.opacity.toFixed(2));
      if (layerEl) {
        layerEl.appendChild(el.group);
      }
    }
  }, []);

  const updateFloatingOverlaysRef = useRef(updateFloatingOverlays);
  updateFloatingOverlaysRef.current = updateFloatingOverlays;

  const computePoseForPreset = useCallback((b: World3DBounds, preset: CameraPresetId) => {
    const cx = b.centerX;
    const cy = b.centerY;
    const cz = b.centerZ;
    const span = Math.max(12, b.size);
    const camPos = new THREE.Vector3();
    const target = new THREE.Vector3(cx, cy, cz);

    if (preset === 'top') {
      const dist = span * 1.12;
      camPos.set(cx + 0.01, cy + dist, cz + 0.01);
    } else if (preset === 'front') {
      const dist = span * 0.94;
      camPos.set(cx, cy + span * 0.14, cz + dist);
    } else if (preset === 'side') {
      const dist = span * 0.94;
      camPos.set(cx + dist, cy + span * 0.14, cz + 0.01);
    } else {
      const dist = span * 0.96;
      camPos.set(cx + dist * 0.72, cy + dist * 0.56, cz + dist * 0.76);
    }
    return { camPos, target };
  }, []);

  const applyCameraPreset = useCallback((preset: CameraPresetId, immediate = false) => {
    const refs = sceneRefs.current;
    if (!refs) return;
    setActivePreset(preset);
    const pose = computePoseForPreset(refs.worldBounds, preset);
    _targetCamPos.copy(pose.camPos);
    _targetCtrlTarget.copy(pose.target);

    if (immediate) {
      refs.camera.position.copy(_targetCamPos);
      refs.controls.target.copy(_targetCtrlTarget);
      refs.controls.update();
      refs.transitioning = false;
    } else {
      refs.transitioning = true;
    }
    refs.requestRender();
  }, [computePoseForPreset, setActivePreset]);

  const activePresetRef = useRef(activePreset);
  activePresetRef.current = activePreset;

  useImperativeHandle(
    ref,
    () => ({
      setCameraPreset: (preset: CameraPresetId) => {
        applyCameraPreset(preset, false);
      },
      fitToScreen: () => {
        applyCameraPreset(activePresetRef.current, false);
      },
      resetZoom: () => {
        applyCameraPreset('iso', false);
      },
      zoomIn: () => {
        const refs = sceneRefs.current;
        if (!refs) return;
        refs.transitioning = false;
        const dir = refs.camera.position.clone().sub(refs.controls.target);
        const dist = dir.length();
        const nextDist = Math.max(refs.controls.minDistance, dist * 0.8);
        dir.normalize().multiplyScalar(nextDist);
        refs.camera.position.copy(refs.controls.target).add(dir);
        refs.controls.update();
        refs.requestRender();
      },
      zoomOut: () => {
        const refs = sceneRefs.current;
        if (!refs) return;
        refs.transitioning = false;
        const dir = refs.camera.position.clone().sub(refs.controls.target);
        const dist = dir.length();
        const nextDist = Math.min(refs.controls.maxDistance, dist * 1.24);
        dir.normalize().multiplyScalar(nextDist);
        refs.camera.position.copy(refs.controls.target).add(dir);
        refs.controls.update();
        refs.requestRender();
      },
      isContextLost: () => {
        const refs = sceneRefs.current;
        if (!refs) return true;
        try {
          return refs.renderer.getContext().isContextLost();
        } catch {
          return true;
        }
      },
      captureImage: async (reqOpts) => {
        const refs = sceneRefs.current;
        if (!refs) {
          throw new Error('Không thể chụp ảnh 3D vì WebGL Scene chưa được khởi tạo.');
        }
        const gl = refs.renderer.getContext();
        if (gl.isContextLost()) {
          throw new Error('WebGL Context đã bị mất, không thể kết xuất hình ảnh 3D.');
        }

        const w = Math.max(320, Math.min(3840, Math.round(reqOpts?.width ?? 1920)));
        const h = Math.max(240, Math.min(2160, Math.round(reqOpts?.height ?? 1080)));
        const background = reqOpts?.background ?? 'light';
        const usedPreset = reqOpts?.preset ?? activePresetRef.current;

        const prevTarget = refs.renderer.getRenderTarget();
        const prevAspect = refs.camera.aspect;
        const prevCamPos = refs.camera.position.clone();
        const prevCtrlTarget = refs.controls.target.clone();
        const prevBackground = refs.scene.background;
        const prevFog = refs.scene.fog;
        const prevAxesVisible = refs.axesGroup.visible;
        const prevPreviewVisible = refs.connectPreviewLine.visible;
        const prevDark = projectRef.current.settings.isDarkMode;
        const prevTransitioning = refs.transitioning;

        let rt: THREE.WebGLRenderTarget | null = null;
        try {
          const wantSamples = !refs.isSoftwareGl && refs.renderer.capabilities.isWebGL2 ? 4 : 0;
          try {
            rt = new THREE.WebGLRenderTarget(w, h, {
              minFilter: THREE.LinearFilter,
              magFilter: THREE.LinearFilter,
              format: THREE.RGBAFormat,
              type: THREE.UnsignedByteType,
              samples: wantSamples
            });
          } catch {
            rt = new THREE.WebGLRenderTarget(w, h, {
              minFilter: THREE.LinearFilter,
              magFilter: THREE.LinearFilter,
              format: THREE.RGBAFormat,
              type: THREE.UnsignedByteType,
              samples: 0
            });
          }

          refs.transitioning = false;
          refs.axesGroup.visible = false;
          refs.connectPreviewLine.visible = false;

          if (background === 'dark') {
            refs.studioRig.updateTheme(true);
          } else {
            refs.studioRig.updateTheme(false);
            refs.scene.background = new THREE.Color(0xffffff);
            refs.scene.fog = null;
          }

          if (reqOpts?.preset) {
            const pose = computePoseForPreset(refs.worldBounds, reqOpts.preset);
            refs.camera.position.copy(pose.camPos);
            refs.controls.target.copy(pose.target);
          }

          refs.camera.aspect = w / h;
          refs.camera.updateProjectionMatrix();
          refs.controls.update();

          refs.renderer.setRenderTarget(rt);
          refs.renderer.clear();
          refs.renderer.render(refs.scene, refs.camera);

          const rawPixels = new Uint8Array(w * h * 4);
          refs.renderer.readRenderTargetPixels(rt, 0, 0, w, h, rawPixels);

          const outCanvas = document.createElement('canvas');
          outCanvas.width = w;
          outCanvas.height = h;
          const ctx = outCanvas.getContext('2d');
          if (!ctx) {
            throw new Error('Trình duyệt không hỗ trợ 2D Canvas để đọc ảnh chụp 3D.');
          }
          const imgData = ctx.createImageData(w, h);
          const rowBytes = w * 4;
          for (let row = 0; row < h; row++) {
            const srcStart = (h - 1 - row) * rowBytes;
            imgData.data.set(rawPixels.subarray(srcStart, srcStart + rowBytes), row * rowBytes);
          }
          ctx.putImageData(imgData, 0, 0);

          const dataUrl = outCanvas.toDataURL('image/png');
          const blob = await new Promise<Blob>((resolve, reject) => {
            outCanvas.toBlob(b => {
              if (b && b.size > 0) resolve(b);
              else reject(new Error('Không thể tạo PNG Blob từ bộ đệm khung hình 3D.'));
            }, 'image/png', 1);
          });

          return {
            blob,
            dataUrl,
            width: w,
            height: h,
            preset: usedPreset,
            background
          };
        } finally {
          refs.renderer.setRenderTarget(prevTarget);
          refs.camera.aspect = prevAspect;
          refs.camera.position.copy(prevCamPos);
          refs.controls.target.copy(prevCtrlTarget);
          refs.camera.updateProjectionMatrix();
          refs.controls.update();
          refs.studioRig.updateTheme(prevDark);
          refs.scene.background = prevBackground;
          refs.scene.fog = prevFog;
          refs.axesGroup.visible = prevAxesVisible;
          refs.connectPreviewLine.visible = prevPreviewVisible;
          refs.transitioning = prevTransitioning;
          rt?.dispose();
          refs.requestRender();
        }
      }
    }),
    [applyCameraPreset, computePoseForPreset]
  );

  // Initialize WebGL Scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: isSoftwareGl ? 'low-power' : 'high-performance'
      });
    } catch (err) {
      setWebglError(
        err instanceof Error ? err.message : 'Trình duyệt không hỗ trợ WebGL 3D.'
      );
      return;
    }

    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 640;
    renderer.setPixelRatio(
      getPixelRatioForQuality(renderQualityRef.current, window.devicePixelRatio || 1, isSoftwareGl)
    );
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 180);
    camera.position.set(13, 11.5, 13.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 3;
    controls.maxDistance = 48;
    controls.target.set(0, 0.4, 0);
    controls.update();

    const resourceRegistry = new ThreeResourceRegistry();
    const studioRig = setupStudioEnvironment(
      scene,
      renderer,
      project.settings.isDarkMode,
      isSoftwareGl,
      resourceRegistry
    );
    if (isSoftwareGl && shadowsEnabledRef.current) {
      studioRig.setShadowsEnabled(false);
      updateViewOptionsRef.current(prev =>
        prev.shadowsEnabled ? { ...prev, shadowsEnabled: false } : prev
      );
    } else {
      studioRig.setShadowsEnabled(shadowsEnabledRef.current);
    }
    studioRig.setRenderQuality(
      renderQualityRef.current as StudioRenderQuality,
      isSoftwareGl,
      isSoftwareGl ? false : shadowsEnabledRef.current
    );
    const shadowTex = createContactShadowTexture();
    const lockBadgeTex = createLockBadgeTexture();
    resourceRegistry.pinTexture(shadowTex);
    resourceRegistry.pinTexture(lockBadgeTex);

    const worldRoot = new THREE.Group();
    worldRoot.name = 'infrastructure_world_root';
    scene.add(worldRoot);

    const axesGroup = createWorldAxesHelper(2.6);
    resourceRegistry.trackObjectTree(axesGroup, 'overlay');
    scene.add(axesGroup);

    const PREVIEW_MAX_POINTS = 32;
    const previewPositions = new Float32Array(PREVIEW_MAX_POINTS * 3);
    const previewPosAttr = new THREE.BufferAttribute(previewPositions, 3);
    previewPosAttr.setUsage(THREE.DynamicDrawUsage);
    const previewGeo = new THREE.BufferGeometry();
    previewGeo.setAttribute('position', previewPosAttr);
    previewGeo.setDrawRange(0, 2);
    const previewMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92
    });
    const connectPreviewLine = new THREE.Line(previewGeo, previewMat);
    connectPreviewLine.visible = false;
    connectPreviewLine.frustumCulled = false;
    connectPreviewLine.renderOrder = 15;
    connectPreviewLine.name = 'connect_preview_line';
    resourceRegistry.trackObjectTree(connectPreviewLine, 'overlay');
    scene.add(connectPreviewLine);

    let rafId = 0;
    let needsRender = true;
    let lastTime = performance.now();
    let disposed = false;

    const scheduleFrame = () => {
      if (disposed || rafId !== 0) return;
      rafId = requestAnimationFrame(tick);
    };

    const requestRender = () => {
      needsRender = true;
      scheduleFrame();
    };

    const tick = (now: number) => {
      rafId = 0;
      if (disposed) return;

      const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const refs = sceneRefs.current;
      let stillAnimating = false;

      if (refs?.transitioning) {
        const alpha = isSoftwareGl ? 1 : 1 - Math.exp(-9 * dt);
        camera.position.lerp(_targetCamPos, alpha);
        controls.target.lerp(_targetCtrlTarget, alpha);
        if (
          camera.position.distanceTo(_targetCamPos) < 0.04 &&
          controls.target.distanceTo(_targetCtrlTarget) < 0.04
        ) {
          camera.position.copy(_targetCamPos);
          controls.target.copy(_targetCtrlTarget);
          refs.transitioning = false;
        } else {
          stillAnimating = true;
        }
      }

      const dampingChanged = controls.update();
      if (needsRender || dampingChanged || stillAnimating) {
        needsRender = false;
        renderer.render(scene, camera);
        updateFloatingOverlaysRef.current();
      }

      if (stillAnimating || (controls.enableDamping && dampingChanged)) {
        scheduleFrame();
      }
    };

    sceneRefs.current = {
      renderer,
      scene,
      camera,
      controls,
      worldRoot,
      axesGroup,
      connectPreviewLine,
      studioRig,
      resourceRegistry,
      shadowTex,
      lockBadgeTex,
      isSoftwareGl,
      transitioning: false,
      requestRender,
      origin: { centerX: 500, centerY: 320 },
      activeFloorY: 0,
      worldBounds: {
        minX: -8,
        maxX: 8,
        minY: 0,
        maxY: 3,
        minZ: -6,
        maxZ: 6,
        centerX: 0,
        centerY: 0.4,
        centerZ: 0,
        size: 16
      },
      nodeGroups: new Map(),
      cableEntries: []
    };

    const handleControlChange = () => {
      requestRender();
    };
    const handleControlStart = () => {
      if (sceneRefs.current) sceneRefs.current.transitioning = false;
    };
    controls.addEventListener('change', handleControlChange);
    controls.addEventListener('start', handleControlStart);

    // ResizeObserver
    const resizeObs = new ResizeObserver(() => {
      if (!container || disposed) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 500;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObs.observe(container);

    const setPointerRay = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointer, camera);
    };

    const pickObjectAt = (clientX: number, clientY: number) => {
      setPointerRay(clientX, clientY);
      const hits = _raycaster.intersectObjects(worldRoot.children, true);
      if (!isSceneDragLockedRef.current && !isReadOnlyRef.current) {
        for (const hit of hits) {
          const { gizmoAction, selectType, selectId, nodeId, label } = hit.object.userData || {};
          if (
            (gizmoAction === 'rotate' ||
              gizmoAction === 'wifi-range' ||
              gizmoAction === 'wifi-angle' ||
              gizmoAction === 'camera-range' ||
              gizmoAction === 'camera-angle') &&
            selectType &&
            selectId &&
            nodeId
          ) {
            return {
              selectType: selectType as 'node' | 'rack',
              selectId: String(selectId),
              nodeId: String(nodeId),
              label: String(label || ''),
              gizmoAction: gizmoAction as 'rotate' | 'wifi-range' | 'wifi-angle' | 'camera-range' | 'camera-angle',
              point: hit.point.clone()
            };
          }
        }
      }
      for (const hit of hits) {
        const { selectType, selectId, nodeId, cableId, label } = hit.object.userData || {};
        if (selectType === 'edge' && (selectId || cableId)) {
          return {
            selectType: 'edge' as const,
            selectId: String(selectId || cableId),
            nodeId: '',
            label: String(label || ''),
            gizmoAction: undefined,
            point: hit.point.clone()
          };
        }
        if (selectType && selectId && nodeId) {
          return {
            selectType: selectType as 'node' | 'rack',
            selectId: String(selectId),
            nodeId: String(nodeId),
            label: String(label || ''),
            gizmoAction: undefined,
            point: hit.point.clone()
          };
        }
      }
      return null;
    };

    const updateConnectPreview = (clientX: number, clientY: number) => {
      const refs = sceneRefs.current;
      const srcId = connectSourceIdRef.current;
      if (!refs || !srcId) {
        if (refs?.connectPreviewLine.visible) {
          refs.connectPreviewLine.visible = false;
          refs.requestRender();
        }
        return;
      }
      const srcEntry = refs.nodeGroups.get(srcId);
      if (!srcEntry) {
        refs.connectPreviewLine.visible = false;
        return;
      }

      const picked = pickObjectAt(clientX, clientY);
      let tgtCenter: { x: number; z: number } | null = null;
      let tgtIsRack = false;

      if (picked && (picked.selectType === 'node' || picked.selectType === 'rack') && picked.nodeId !== srcId) {
        const tgtEntry = refs.nodeGroups.get(picked.nodeId);
        if (tgtEntry) {
          tgtCenter = { x: tgtEntry.group.position.x, z: tgtEntry.group.position.z };
          tgtIsRack = tgtEntry.node.type === 'rack';
        }
      }

      if (!tgtCenter) {
        setPointerRay(clientX, clientY);
        const plane = new THREE.Plane(_planeNormal, -0.45);
        const hit = _raycaster.ray.intersectPlane(plane, _dragHitPoint);
        if (!hit) return;
        tgtCenter = { x: hit.x, z: hit.z };
      }

      const { curve } = build3DCableCurve(
        { routingType: preferredRoutingRef.current, strokeWidth: 2 },
        { x: srcEntry.group.position.x, z: srcEntry.group.position.z },
        tgtCenter,
        srcEntry.node.type === 'rack',
        tgtIsRack,
        0,
        1,
        explodeSpreadRef.current,
        refs.origin,
        srcEntry.floorY,
        picked && (picked.selectType === 'node' || picked.selectType === 'rack')
          ? (refs.nodeGroups.get(picked.nodeId)?.floorY ?? srcEntry.floorY)
          : srcEntry.floorY
      );
      const pts = curve.getPoints(28);
      const count = Math.min(PREVIEW_MAX_POINTS, pts.length);
      for (let i = 0; i < count; i++) {
        previewPositions[i * 3] = pts[i].x;
        previewPositions[i * 3 + 1] = pts[i].y;
        previewPositions[i * 3 + 2] = pts[i].z;
      }
      previewPosAttr.needsUpdate = true;
      previewGeo.setDrawRange(0, count);
      refs.connectPreviewLine.visible = true;
      refs.requestRender();
    };

    let lastHoverCheck = 0;

    const handlePointerDown = (e: PointerEvent) => {
      // Only primary mouse/touch button initiates object interaction; right/middle stay camera pan/zoom
      if (e.button !== 0) return;

      const refs = sceneRefs.current;
      if (!refs) return;
      clearRackTooltipTimer();
      setHoveredRackSubDevice(null);

      const picked = pickObjectAt(e.clientX, e.clientY);

      // Unlocked 3D cable connect workflow
      if (
        activeToolRef.current === 'connect' &&
        !isSceneDragLockedRef.current &&
        !isReadOnlyRef.current
      ) {
        dragSessionRef.current = null;
        if (picked && (picked.selectType === 'node' || picked.selectType === 'rack')) {
          const currSrc = connectSourceIdRef.current;
          if (!currSrc) {
            setConnectSourceId(picked.nodeId);
            onSelectRef.current(picked.selectType, picked.selectId);
            updateConnectPreview(e.clientX, e.clientY);
          } else if (currSrc !== picked.nodeId) {
            onAddCableRef.current?.(currSrc, picked.nodeId, undefined, undefined, {
              routingType: preferredRoutingRef.current
            });
            setConnectSourceId(null);
            refs.connectPreviewLine.visible = false;
            refs.requestRender();
          } else {
            setConnectSourceId(null);
            refs.connectPreviewLine.visible = false;
            refs.requestRender();
          }
        } else if (picked && picked.selectType === 'edge') {
          onSelectRef.current('edge', picked.selectId);
        } else {
          setConnectSourceId(null);
          refs.connectPreviewLine.visible = false;
          refs.requestRender();
        }
        return;
      }

      if (!picked) {
        dragSessionRef.current = null;
        return;
      }

      if (picked.selectType === 'edge') {
        dragSessionRef.current = {
          mode: 'move',
          pointerId: e.pointerId,
          nodeId: '',
          selectType: 'edge',
          selectId: picked.selectId,
          label: picked.label,
          preserveSelection: false,
          items: [],
          draggedIdSet: new Set(),
          dragPlane: new THREE.Plane(),
          startClientPos: { x: e.clientX, y: e.clientY },
          startHitPoint: new THREE.Vector3(),
          startAnchorX: 0,
          startAnchorY: 0,
          lastAppliedDx: 0,
          lastAppliedDy: 0,
          hasMoved: false
        };
        return;
      }

      const entry = refs.nodeGroups.get(picked.nodeId);
      const currProject = projectRef.current;

      // Interactive 3D Gizmo drag ('rotate' | 'wifi-range' | 'camera-range')
      if (
        picked.gizmoAction &&
        entry &&
        !isReadOnlyRef.current &&
        !isSceneDragLockedRef.current &&
        !isNodeEffectivelyLocked(entry.node, currProject.settings, currProject.assets, false)
      ) {
        const dragPlane = new THREE.Plane(_planeNormal, -entry.group.position.y);
        setPointerRay(e.clientX, e.clientY);
        const hitStart = _raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
        if (!hitStart) return;

        refs.transitioning = false;
        controls.enabled = false;
        renderer.domElement.style.cursor = 'grabbing';
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        dragSessionRef.current = {
          mode: picked.gizmoAction,
          pointerId: e.pointerId,
          nodeId: picked.nodeId,
          selectType: picked.selectType,
          selectId: picked.selectId,
          label: picked.label,
          preserveSelection: true,
          items: [
            {
              nodeId: picked.nodeId,
              group: entry.group,
              startGroupPos: entry.group.position.clone(),
              startNodeX: entry.node.x,
              startNodeY: entry.node.y
            }
          ],
          draggedIdSet: new Set([picked.nodeId]),
          dragPlane,
          startClientPos: { x: e.clientX, y: e.clientY },
          startHitPoint: hitStart,
          startAnchorX: entry.node.x,
          startAnchorY: entry.node.y,
          lastAppliedDx: 0,
          lastAppliedDy: 0,
          hasMoved: false
        };
        return;
      }

      const isLocked =
        !entry ||
        !canDragNodeIn3DScene(entry.node, currProject.settings, currProject.assets, {
          isReadOnlyMode: isReadOnlyRef.current,
          isSceneDragLocked: isSceneDragLockedRef.current
        });

      if (isLocked || !onMoveNodesTransientRef.current) {
        // Still allow click-to-select on locked or read-only objects (cannot drag!)
        dragSessionRef.current = {
          mode: 'move',
          pointerId: e.pointerId,
          nodeId: picked.nodeId,
          selectType: picked.selectType,
          selectId: picked.selectId,
          label: picked.label,
          preserveSelection: false,
          items: [],
          draggedIdSet: new Set(),
          dragPlane: new THREE.Plane(),
          startClientPos: { x: e.clientX, y: e.clientY },
          startHitPoint: new THREE.Vector3(),
          startAnchorX: 0,
          startAnchorY: 0,
          lastAppliedDx: 0,
          lastAppliedDy: 0,
          hasMoved: false
        };
        return;
      }

      const dragPlane = new THREE.Plane(_planeNormal, -entry.group.position.y);
      setPointerRay(e.clientX, e.clientY);
      const hitStart = _raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
      if (!hitStart) return;

      // Match 2D Canvas behavior: move multi-selected nodes or group peers together
      const currSelection = selectionRef.current;
      const currentSelectedIds = new Set<string>();
      if (currSelection.type === 'node' && currSelection.id) {
        currentSelectedIds.add(currSelection.id);
        currSelection.additionalIds?.forEach(id => currentSelectedIds.add(id));
      }
      const isMultiNodeSelected = currentSelectedIds.size > 1 && currentSelectedIds.has(picked.nodeId);

      const candidateIds = new Set<string>([picked.nodeId]);
      if (isMultiNodeSelected) {
        currentSelectedIds.forEach(id => candidateIds.add(id));
      } else if (entry.node.groupId) {
        refs.nodeGroups.forEach((peer, peerId) => {
          if (peer.node.groupId === entry.node.groupId) {
            candidateIds.add(peerId);
          }
        });
      }

      const items: DragSessionItem[] = [];
      const draggedIdSet = new Set<string>();
      candidateIds.forEach(id => {
        const peer = refs.nodeGroups.get(id);
        if (!peer) return;
        if (isNodeEffectivelyLocked(peer.node, currProject.settings, currProject.assets, false)) return;
        draggedIdSet.add(id);
        items.push({
          nodeId: id,
          group: peer.group,
          startGroupPos: peer.group.position.clone(),
          startNodeX: peer.node.x,
          startNodeY: peer.node.y
        });
      });

      if (items.length === 0) return;

      refs.transitioning = false;
      controls.enabled = false;
      renderer.domElement.style.cursor = 'grabbing';
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic event capture errors
      }

      dragSessionRef.current = {
        mode: 'move',
        pointerId: e.pointerId,
        nodeId: picked.nodeId,
        selectType: picked.selectType,
        selectId: picked.selectId,
        label: items.length > 1 ? `${picked.label} (+${items.length - 1})` : picked.label,
        preserveSelection: isMultiNodeSelected,
        items,
        draggedIdSet,
        dragPlane,
        startClientPos: { x: e.clientX, y: e.clientY },
        startHitPoint: hitStart,
        startAnchorX: entry.node.x,
        startAnchorY: entry.node.y,
        lastAppliedDx: 0,
        lastAppliedDy: 0,
        hasMoved: false
      };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const refs = sceneRefs.current;
      if (!refs) return;

      const drag = dragSessionRef.current;
      if (drag && !controls.enabled) {
        const clientDist = Math.hypot(e.clientX - drag.startClientPos.x, e.clientY - drag.startClientPos.y);
        if (!drag.hasMoved && clientDist <= 4) {
          return;
        }

        if (!drag.hasMoved) {
          drag.hasMoved = true;
          if (!drag.preserveSelection) {
            onSelectRef.current(drag.selectType, drag.selectId);
          }
          onBeginDragSnapshotRef.current?.();
        }

        setPointerRay(e.clientX, e.clientY);
        const hit = _raycaster.ray.intersectPlane(drag.dragPlane, _dragHitPoint);
        if (!hit) return;

        if (drag.mode === 'rotate') {
          const item = drag.items[0];
          if (!item) return;
          const rawDeg =
            (Math.atan2(hit.z - item.group.position.z, hit.x - item.group.position.x) * 180) / Math.PI;
          const nextDeg = e.shiftKey
            ? normalizeRotationDeg(Math.round(rawDeg / 15) * 15)
            : Math.round(normalizeRotationDeg(rawDeg));

          item.group.rotation.y = rotationDegToThreeYRad(nextDeg);
          onRotateNodesTransientRef.current?.([drag.nodeId], nextDeg);
          setDraggingHud({
            label: drag.label,
            x: Math.round(drag.startAnchorX),
            y: Math.round(drag.startAnchorY),
            metricText: `Xoay ${nextDeg}°`
          });
          refs.requestRender();
          return;
        }

        if (
          drag.mode === 'wifi-range' ||
          drag.mode === 'wifi-angle' ||
          drag.mode === 'camera-range' ||
          drag.mode === 'camera-angle'
        ) {
          const item = drag.items[0];
          const entry = refs.nodeGroups.get(drag.nodeId);
          const currProj = projectRef.current;
          if (!item || !entry) return;

          const distWorld = Math.hypot(hit.x - item.group.position.x, hit.z - item.group.position.z);
          const pointerAngleDeg =
            (Math.atan2(hit.z - item.group.position.z, hit.x - item.group.position.x) * 180) / Math.PI;
          const scalePx = normalizeScalePxPerMeter(currProj.settings.scale);
          const liveNode = currProj.nodes.find(n => n.id === drag.nodeId) || entry.node;
          const liveAsset = liveNode.assetId ? currProj.assets[liveNode.assetId] : undefined;

          if (drag.mode === 'wifi-range') {
            const nextRadius = clampWifiRadiusMeters(distWorld / (WORLD_SCALE * scalePx));
            const curWifi = resolveWifiCoverage(liveNode, liveAsset);
            const curAngle = curWifi?.angleDeg ?? 360;
            const areaSqm = computeSectorAreaSqm(nextRadius, curAngle);
            onUpdateWifiCoverageTransientRef.current?.(drag.nodeId, { radiusMeters: nextRadius });
            const patchedNode: DiagramNode = {
              ...liveNode,
              customData: { ...liveNode.customData, coverageRadiusMeters: nextRadius }
            };
            const patchedAsset = liveAsset?.wifiSpecs
              ? {
                  ...liveAsset,
                  wifiSpecs: { ...liveAsset.wifiSpecs, coverageRadiusMeters: nextRadius }
                }
              : liveAsset;
            refreshNode3DCoverageAndGizmos(item.group, patchedNode, patchedAsset, currProj, {
              isSelected: true,
              isLocked: false,
              interactiveUnlocked: true
            });
            setDraggingHud({
              label: drag.label,
              x: Math.round(drag.startAnchorX),
              y: Math.round(drag.startAnchorY),
              metricText: `Phủ Wi-Fi ${nextRadius} m (~${areaSqm} m²)`
            });
          } else if (drag.mode === 'wifi-angle') {
            const halfDiff = Math.abs(signedAngularDiffDeg(liveNode.rotation || 0, pointerAngleDeg));
            const rawAngle = e.shiftKey ? Math.round((halfDiff * 2) / 15) * 15 : Math.round(halfDiff * 2);
            const nextAngle = clampWifiAngleDeg(rawAngle);
            const curWifi = resolveWifiCoverage(liveNode, liveAsset);
            const curRadius = curWifi?.radiusMeters ?? 18;
            const areaSqm = computeSectorAreaSqm(curRadius, nextAngle);
            onUpdateWifiCoverageTransientRef.current?.(drag.nodeId, { angleDeg: nextAngle });
            const patchedNode: DiagramNode = {
              ...liveNode,
              customData: { ...liveNode.customData, coverageAngleDeg: nextAngle }
            };
            const patchedAsset = liveAsset?.wifiSpecs
              ? {
                  ...liveAsset,
                  wifiSpecs: { ...liveAsset.wifiSpecs, coverageAngleDeg: nextAngle }
                }
              : liveAsset;
            refreshNode3DCoverageAndGizmos(item.group, patchedNode, patchedAsset, currProj, {
              isSelected: true,
              isLocked: false,
              interactiveUnlocked: true
            });
            setDraggingHud({
              label: drag.label,
              x: Math.round(drag.startAnchorX),
              y: Math.round(drag.startAnchorY),
              metricText: `Góc Wi-Fi ${nextAngle}° (~${areaSqm} m²)`
            });
          } else if (drag.mode === 'camera-range') {
            const nextRange = clampCameraRangeMeters(
              distWorld / (WORLD_SCALE * scalePx * CAMERA_FOV_SCALE_FACTOR)
            );
            const curCam = resolveCameraFov(liveNode, liveAsset);
            const curFov = curCam?.fovAngle ?? 90;
            const areaSqm = computeSectorAreaSqm(nextRange, curFov);
            onUpdateCameraFovTransientRef.current?.(drag.nodeId, { irDistanceMeters: nextRange });
            const patchedNode: DiagramNode = {
              ...liveNode,
              customData: { ...liveNode.customData, irDistance: nextRange }
            };
            const patchedAsset = liveAsset?.cameraSpecs
              ? {
                  ...liveAsset,
                  cameraSpecs: { ...liveAsset.cameraSpecs, irDistanceMeters: nextRange }
                }
              : liveAsset;
            refreshNode3DCoverageAndGizmos(item.group, patchedNode, patchedAsset, currProj, {
              isSelected: true,
              isLocked: false,
              interactiveUnlocked: true
            });
            setDraggingHud({
              label: drag.label,
              x: Math.round(drag.startAnchorX),
              y: Math.round(drag.startAnchorY),
              metricText: `Tầm Camera ${nextRange} m (~${areaSqm} m²)`
            });
          } else {
            const halfDiff = Math.abs(signedAngularDiffDeg(liveNode.rotation || 0, pointerAngleDeg));
            const rawFov = e.shiftKey ? Math.round((halfDiff * 2) / 5) * 5 : Math.round(halfDiff * 2);
            const nextFov = clampCameraFovDeg(rawFov);
            const curCam = resolveCameraFov(liveNode, liveAsset);
            const curRange = curCam?.rangeMeters ?? 30;
            const areaSqm = computeSectorAreaSqm(curRange, nextFov);
            onUpdateCameraFovTransientRef.current?.(drag.nodeId, { fovAngle: nextFov });
            const patchedNode: DiagramNode = {
              ...liveNode,
              customData: { ...liveNode.customData, fov: nextFov }
            };
            const patchedAsset = liveAsset?.cameraSpecs
              ? {
                  ...liveAsset,
                  cameraSpecs: { ...liveAsset.cameraSpecs, fovAngle: nextFov }
                }
              : liveAsset;
            refreshNode3DCoverageAndGizmos(item.group, patchedNode, patchedAsset, currProj, {
              isSelected: true,
              isLocked: false,
              interactiveUnlocked: true
            });
            setDraggingHud({
              label: drag.label,
              x: Math.round(drag.startAnchorX),
              y: Math.round(drag.startAnchorY),
              metricText: `Góc FOV ${nextFov}° (~${areaSqm} m²)`
            });
          }
          refs.requestRender();
          return;
        }

        const dxWorld = hit.x - drag.startHitPoint.x;
        const dzWorld = hit.z - drag.startHitPoint.z;

        const minAllowedDx = Math.max(...drag.items.map(it => 10 - it.startNodeX));
        const minAllowedDy = Math.max(...drag.items.map(it => 10 - it.startNodeY));
        const totalDx = Math.max(minAllowedDx, dxWorld / WORLD_SCALE);
        const totalDy = Math.max(minAllowedDy, dzWorld / WORLD_SCALE);

        // 1) Update all dragged 3D mesh groups immediately at 60fps
        for (const item of drag.items) {
          item.group.position.set(
            item.startGroupPos.x + totalDx * WORLD_SCALE,
            item.startGroupPos.y,
            item.startGroupPos.z + totalDy * WORLD_SCALE
          );
        }

        // 2) Update connected 3D cables in real time
        for (const ce of refs.cableEntries) {
          if (!drag.draggedIdSet.has(ce.sourceNodeId) && !drag.draggedIdSet.has(ce.targetNodeId)) continue;
          const srcEntry = refs.nodeGroups.get(ce.sourceNodeId);
          const tgtEntry = refs.nodeGroups.get(ce.targetNodeId);
          if (!srcEntry || !tgtEntry) continue;
          const srcGrp = srcEntry.group;
          const tgtGrp = tgtEntry.group;
          const routeSyncOpts = {
            bundleOffsetPx: ce.bundleOffsetPx,
            bundleNormal: ce.bundleNormal,
            srcElevationZ: ce.srcElevationZ,
            tgtElevationZ: ce.tgtElevationZ
          };
          const nextCurve = build3DCableCurve(
            ce.cable,
            { x: srcGrp.position.x, z: srcGrp.position.z },
            { x: tgtGrp.position.x, z: tgtGrp.position.z },
            ce.sourceIsRack,
            ce.targetIsRack,
            ce.laneIndex,
            ce.laneCount,
            explodeSpreadRef.current,
            refs.origin,
            srcEntry.floorY,
            tgtEntry.floorY,
            routeSyncOpts
          );
          ce.midWorld.copy(nextCurve.midWorld);
          const nextGeo = build3DCableGeometry(
            ce.cable,
            { x: srcGrp.position.x, z: srcGrp.position.z },
            { x: tgtGrp.position.x, z: tgtGrp.position.z },
            ce.sourceIsRack,
            ce.targetIsRack,
            ce.laneIndex,
            ce.laneCount,
            explodeSpreadRef.current,
            refs.origin,
            selectionRef.current.type === 'edge' && selectionRef.current.id === ce.cable.id,
            srcEntry.floorY,
            tgtEntry.floorY,
            'high',
            routeSyncOpts
          );
          ce.mesh.geometry.dispose();
          ce.mesh.geometry = refs.resourceRegistry.trackGeometry(nextGeo, 'world');
        }

        // 3) Sync live delta into store (rebuild effect skips while dragSessionRef is active)
        const stepDx = totalDx - drag.lastAppliedDx;
        const stepDy = totalDy - drag.lastAppliedDy;
        if (stepDx !== 0 || stepDy !== 0) {
          drag.lastAppliedDx = totalDx;
          drag.lastAppliedDy = totalDy;
          onMoveNodesTransientRef.current?.(Array.from(drag.draggedIdSet), stepDx, stepDy);
        }

        setDraggingHud({
          label: drag.label,
          x: Math.round(drag.startAnchorX + totalDx),
          y: Math.round(drag.startAnchorY + totalDy)
        });
        refs.requestRender();
        return;
      }

      if (
        activeToolRef.current === 'connect' &&
        !isSceneDragLockedRef.current &&
        !isReadOnlyRef.current
      ) {
        if (connectSourceIdRef.current) {
          updateConnectPreview(e.clientX, e.clientY);
        }
        renderer.domElement.style.cursor = 'crosshair';
        return;
      }

      // Throttled hover cursor feedback when not dragging
      const now = performance.now();
      if (now - lastHoverCheck < 45) return;
      lastHoverCheck = now;

      const picked = pickObjectAt(e.clientX, e.clientY);
      if (picked && !isReadOnlyRef.current) {
        if (picked.selectType === 'edge' || isSceneDragLockedRef.current) {
          renderer.domElement.style.cursor = 'pointer';
        } else {
          const entry = refs.nodeGroups.get(picked.nodeId);
          const currProj = projectRef.current;
          const canMove =
            entry &&
            canDragNodeIn3DScene(entry.node, currProj.settings, currProj.assets, {
              isReadOnlyMode: isReadOnlyRef.current,
              isSceneDragLocked: false
            });
          renderer.domElement.style.cursor = canMove ? 'grab' : 'not-allowed';
        }
      } else {
        renderer.domElement.style.cursor = 'default';
      }

      // Raycast 3D rack sub-device blades for interactive technical specs tooltip
      setPointerRay(e.clientX, e.clientY);
      const bladeHits = _raycaster.intersectObjects(refs.worldRoot.children, true);
      let matchedBladeHit: THREE.Intersection | null = null;
      for (const hit of bladeHits) {
        if (hit.object.userData?.subDeviceAssetId) {
          matchedBladeHit = hit;
          break;
        }
      }
      if (matchedBladeHit) {
        const ud = matchedBladeHit.object.userData;
        const currProj = projectRef.current;
        const asset = currProj.assets[ud.subDeviceAssetId as string];
        if (asset) {
          const rack = currProj.racks.find(r => r.id === ud.subDeviceRackId);
          const rackNode = currProj.nodes.find(n => n.id === (ud.nodeId as string));
          const thermalData = computeRackThermalOverlayData(rack, currProj.assets, rackNode);
          const startU = (ud.subDeviceStartU as number) || 1;
          const uHeight = (ud.subDeviceUHeight as number) || getAssetUHeight(asset);
          const subThermal = getSubDeviceThermalReading(thermalData, startU, uHeight);
          clearRackTooltipTimer();
          setHoveredRackSubDevice({
            rackId: rack?.id || (ud.subDeviceRackId as string) || '',
            rackNodeId: (ud.nodeId as string) || '',
            rackName: rack?.name || rackNode?.label || 'Tủ Rack',
            asset,
            startU,
            uHeight,
            side: (ud.subDeviceSide as 'front' | 'rear') || 'front',
            tempC: typeof ud.subDeviceTempC === 'number' ? ud.subDeviceTempC : subThermal.tempC,
            zone: (ud.subDeviceZone as ThermalRiskLevel) || subThermal.zone,
            heatBtuPerHour:
              typeof ud.subDeviceHeatBtu === 'number'
                ? ud.subDeviceHeatBtu
                : Math.round((asset.powerWatts || 0) * 3.41214),
            clientX: e.clientX,
            clientY: e.clientY
          });
        } else {
          scheduleHideRackTooltip();
        }
      } else {
        scheduleHideRackTooltip();
      }
    };

    const finishPointerInteraction = (e: PointerEvent, cancelled = false) => {
      const drag = dragSessionRef.current;
      const wasOrbiting = controls.enabled;

      if (!controls.enabled) {
        controls.enabled = true;
        try {
          if (drag && renderer.domElement.hasPointerCapture(drag.pointerId)) {
            renderer.domElement.releasePointerCapture(drag.pointerId);
          }
        } catch {
          // ignore
        }
      }

      renderer.domElement.style.cursor = 'default';
      setDraggingHud(null);

      if (drag?.hasMoved && !cancelled) {
        const committedIds = drag.mode === 'move' ? Array.from(drag.draggedIdSet) : [];
        dragSessionRef.current = null;
        onSnapNodesAndCommitDragRef.current?.(committedIds);
        setRebuildNonce(n => n + 1);
        return;
      }

      dragSessionRef.current = null;

      if (cancelled) {
        setRebuildNonce(n => n + 1);
        return;
      }

      // Treat short press without drag as standard click-to-select (when not orbiting empty space)
      const moveDist = drag
        ? Math.hypot(e.clientX - drag.startClientPos.x, e.clientY - drag.startClientPos.y)
        : 0;

      if (drag && moveDist <= 6) {
        onSelectRef.current(drag.selectType, drag.selectId);
      } else if (!drag && wasOrbiting) {
        const picked = pickObjectAt(e.clientX, e.clientY);
        if (picked) {
          onSelectRef.current(picked.selectType, picked.selectId);
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragSessionRef.current && controls.enabled) {
        return;
      }
      finishPointerInteraction(e, false);
    };

    const handlePointerCancel = (e: PointerEvent) => {
      finishPointerInteraction(e, true);
    };

    let bgDownPos: { x: number; y: number } | null = null;
    const handleBgPointerDown = (e: PointerEvent) => {
      if (e.button === 0 && !dragSessionRef.current) {
        bgDownPos = { x: e.clientX, y: e.clientY };
      } else {
        bgDownPos = null;
      }
    };
    const handleBgPointerUp = (e: PointerEvent) => {
      if (bgDownPos && Math.hypot(e.clientX - bgDownPos.x, e.clientY - bgDownPos.y) <= 5) {
        const picked = pickObjectAt(e.clientX, e.clientY);
        if (!picked) {
          onSelectRef.current('none');
        }
      }
      bgDownPos = null;
    };

    const handleDoubleClick = (e: MouseEvent) => {
      const picked = pickObjectAt(e.clientX, e.clientY);
      if (picked?.selectType === 'rack') {
        onOpenDeepInspectRef.current(picked.selectId);
      }
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      onContextLostChange?.(true);
      setWebglError('Kết nối WebGL tạm gián đoạn. Nhấn "Thử khôi phục 3D" hoặc quay lại sơ đồ 2D CAD.');
    };
    const handleContextRestored = () => {
      onContextLostChange?.(false);
      setWebglError(null);
      setRebuildNonce(n => n + 1);
      requestRender();
    };

    const handlePointerLeave = () => {
      scheduleHideRackTooltip();
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerdown', handleBgPointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerup', handleBgPointerUp);
    renderer.domElement.addEventListener('pointercancel', handlePointerCancel);
    renderer.domElement.addEventListener('dblclick', handleDoubleClick);
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    requestRender();

    return () => {
      disposed = true;
      clearRackTooltipTimer();
      if (rafId) cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      controls.removeEventListener('change', handleControlChange);
      controls.removeEventListener('start', handleControlStart);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerdown', handleBgPointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointerup', handleBgPointerUp);
      renderer.domElement.removeEventListener('pointercancel', handlePointerCancel);
      renderer.domElement.removeEventListener('dblclick', handleDoubleClick);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      const keepTextures = new Set<THREE.Texture>([shadowTex, lockBadgeTex]);
      resourceRegistry.disposeScope('world', renderer);
      disposeObjectTree(worldRoot, keepTextures);
      worldRoot.clear();
      resourceRegistry.disposeScope('overlay', renderer);
      disposeObjectTree(axesGroup);
      axesGroup.clear();
      disposeObjectTree(connectPreviewLine);
      studioRig.dispose();
      resourceRegistry.disposeAll(renderer);
      scene.clear();
      renderer.renderLists?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRefs.current = null;
    };
  }, [rendererEpoch]);

  // Sync theme changes without tearing down WebGL context
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.studioRig.updateTheme(project.settings.isDarkMode);
    refs.requestRender();
  }, [project.settings.isDarkMode]);

  // Toggle World XYZ Axes Helper visibility
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.axesGroup.visible = showAxes;
    refs.requestRender();
  }, [showAxes]);

  // Globally toggle Three.js shadow mapping without tearing down WebGL context
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.studioRig.setShadowsEnabled(shadowsEnabled);
    refs.requestRender();
  }, [shadowsEnabled]);

  // Toggle wireframe rendering across 3D scene meshes cleanly
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    applySceneWireframeMode(refs.worldRoot, wireframeMode);
    refs.requestRender();
  }, [wireframeMode]);

  // Dynamically adjust pixelRatio, shadow map resolution, and floor texture anisotropy
  useEffect(() => {
    const refs = sceneRefs.current;
    const container = mountRef.current;
    if (!refs || !container) return;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 500;
    refs.renderer.setPixelRatio(
      getPixelRatioForQuality(renderQuality, window.devicePixelRatio || 1, refs.isSoftwareGl)
    );
    refs.renderer.setSize(w, h);
    refs.studioRig.setRenderQuality(
      renderQuality as StudioRenderQuality,
      refs.isSoftwareGl,
      shadowsEnabledRef.current
    );
    refs.requestRender();
  }, [renderQuality]);

  // Reset multi-floor cutaway preference when switching projects
  useEffect(() => {
    if (prevProjectIdRef.current !== project.id) {
      prevProjectIdRef.current = project.id;
      setViewAllFloors(project.floors.length > 1);
      autoFrameNextBuildRef.current = true;
    }
  }, [project.id, project.floors.length, setViewAllFloors]);

  useEffect(() => {
    const viewChanged = prevViewAllFloorsRef.current !== viewAllFloors;
    const modeChanged = prevActiveModeRef.current !== project.activeMode;
    const floorChanged = prevActiveFloorIdRef.current !== resolvedActiveFloorId;
    if (viewChanged || modeChanged || floorChanged) {
      prevViewAllFloorsRef.current = viewAllFloors;
      prevActiveModeRef.current = project.activeMode;
      prevActiveFloorIdRef.current = resolvedActiveFloorId;
      if (viewChanged || modeChanged || !viewAllFloors) {
        autoFrameNextBuildRef.current = true;
      }
      if (floorChanged) {
        clearRackTooltipTimer();
        setHoveredRackSubDevice(null);
      }
      if (floorChanged && !viewAllFloors && connectSourceId) {
        setConnectSourceId(null);
      }
    }
  }, [viewAllFloors, project.activeMode, resolvedActiveFloorId, connectSourceId, clearRackTooltipTimer]);

  // Rebuild 3D infrastructure entities dynamically whenever filteredProject, activeFloorId, or toggles change
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs || dragSessionRef.current?.hasMoved) return;

    refs.resourceRegistry.disposeScope('world', refs.renderer);
    disposeObjectTree(refs.worldRoot, new Set<THREE.Texture>([refs.shadowTex, refs.lockBadgeTex]));
    refs.worldRoot.clear();

    const populated = populateInfrastructure3DWorld(refs.worldRoot, filteredProject, selection.id, {
      showRooms: true,
      showCables: true,
      explodeSpread,
      castShadow: shadowsEnabledRef.current,
      shadowTex: refs.shadowTex,
      lockBadgeTex: refs.lockBadgeTex,
      viewAllFloors,
      renderQuality: renderQuality as StudioRenderQuality,
      wireframe: wireframeModeRef.current,
      showThermalHeatmap,
      registry: refs.resourceRegistry,
      registryScope: 'world',
      cadUnderlayDoc,
      interactiveUnlocked: !isSceneDragLocked && !isReadOnlyMode
    });
    refs.origin = populated.origin;
    refs.activeFloorY = populated.activeFloorY;
    refs.worldBounds = populated.bounds;
    refs.nodeGroups = populated.nodeGroups;
    refs.cableEntries = populated.cableEntries;

    applyGlobalShadowMapping(refs.renderer, refs.scene, shadowsEnabledRef.current);
    if (wireframeModeRef.current) {
      applySceneWireframeMode(refs.worldRoot, true);
    }
    if (!refs.isSoftwareGl && typeof refs.renderer.compile === 'function') {
      refs.renderer.compile(refs.scene, refs.camera);
    }

    // Adapt camera clip planes and orbit bounds for multi-storey buildings
    refs.controls.maxDistance = Math.max(48, populated.bounds.size * 2.8);
    refs.camera.far = Math.max(180, populated.bounds.size * 6);
    refs.camera.updateProjectionMatrix();

    if (autoFrameNextBuildRef.current) {
      autoFrameNextBuildRef.current = false;
      applyCameraPreset(activePreset, true);
    } else {
      refs.requestRender();
    }
  }, [filteredProject, resolvedActiveFloorId, selection.id, explodeSpread, viewAllFloors, renderQuality, showThermalHeatmap, rebuildNonce, rendererEpoch, applyCameraPreset, activePreset, cadUnderlayDoc, isSceneDragLocked, isReadOnlyMode]);

  // Persist free dock coordinates & clamp on resize/collapse
  useEffect(() => {
    try {
      if (dockFreePos) {
        window.localStorage.setItem(DOCK_FREE_POS_STORAGE_KEY, JSON.stringify(dockFreePos));
      } else {
        window.localStorage.removeItem(DOCK_FREE_POS_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [dockFreePos]);

  useEffect(() => {
    if (dockEdge !== 'free' || !dockFreePos) return;
    const containerEl = rootRef.current;
    const dockEl = dockRef.current;
    if (!containerEl || !dockEl) return;

    const clampDock = () => {
      const cRect = containerEl.getBoundingClientRect();
      const dRect = dockEl.getBoundingClientRect();
      if (cRect.width <= 0 || cRect.height <= 0) return;
      const next = clampFloatingPosition(dockFreePos, dRect.width, dRect.height, cRect.width, cRect.height, 8);
      if (next.x !== dockFreePos.x || next.y !== dockFreePos.y) {
        setDockFreePos(next);
      }
    };

    clampDock();
    const ro = new ResizeObserver(clampDock);
    ro.observe(containerEl);
    ro.observe(dockEl);
    return () => ro.disconnect();
  }, [dockEdge, dockFreePos, dockCollapsed, dockDrawer]);

  const dockDragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dockDragCleanupRef.current?.();
      dockDragCleanupRef.current = null;
    };
  }, []);

  // Drag-and-drop handler for snapping the 3D Control Dock to Bottom, Left, Right OR moving freely anywhere
  const handleDockDragPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = rootRef.current;
    if (!container) return;

    dockDragCleanupRef.current?.();

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let lastPreview: { left: number; top: number; previewEdge: DockEdge; freePos?: FloatingPanelPosition } = {
      left: 0,
      top: 0,
      previewEdge: dockEdge
    };

    const computeDropFromPointer = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const dRect = dockRef.current?.getBoundingClientRect();
      const panelW = dRect?.width || 240;
      const panelH = dRect?.height || 42;
      const relX = Math.max(16, Math.min(rect.width - 16, clientX - rect.left));
      const relY = Math.max(16, Math.min(rect.height - 16, clientY - rect.top));
      const resolved = resolveEdgeOrFreeDrop(relX, relY, panelW, panelH, rect.width, rect.height);
      return {
        left: relX,
        top: relY,
        previewEdge: resolved.mode,
        freePos: resolved.freePos
      };
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) {
        return;
      }
      dragging = true;
      const preview = computeDropFromPointer(ev.clientX, ev.clientY);
      lastPreview = preview;
      setDockDragPreview(preview);
    };

    const cleanupListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dockDragCleanupRef.current === cleanupListeners) {
        dockDragCleanupRef.current = null;
      }
    };

    const onUp = () => {
      cleanupListeners();
      if (dragging) {
        setDockEdge(lastPreview.previewEdge);
        if (lastPreview.previewEdge === 'free' && lastPreview.freePos) {
          setDockFreePos(lastPreview.freePos);
        } else {
          setDockFreePos(null);
        }
        setDockDragPreview(null);
      }
    };

    dockDragCleanupRef.current = cleanupListeners;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [dockEdge]);

  const isVerticalDock = dockEdge === 'left' || dockEdge === 'right';
  const dockPositionClass =
    dockEdge === 'free' && dockFreePos
      ? 'left-0 top-0'
      : dockEdge === 'left'
      ? 'left-2.5 top-1/2 -translate-y-1/2'
      : dockEdge === 'right'
      ? 'right-2.5 top-[54%] -translate-y-1/2'
      : 'bottom-14 left-3';

  const snapEdgeLabel =
    dockDragPreview?.previewEdge === 'left'
      ? 'Xếp gọn bên trái'
      : dockDragPreview?.previewEdge === 'right'
      ? 'Xếp gọn bên phải'
      : dockDragPreview?.previewEdge === 'bottom'
      ? 'Xếp gọn xuống dưới'
      : 'Đặt tự do tại đây';

  const setActiveFloorId = onSetActiveFloorId ?? onSetActiveFloor;
  const sortedFloorsDesc = useMemo(
    () => [...project.floors].sort((a, b) => b.level - a.level),
    [project.floors]
  );
  const activeFloorIndexDesc = useMemo(
    () => sortedFloorsDesc.findIndex(fl => fl.id === resolvedActiveFloorId),
    [sortedFloorsDesc, resolvedActiveFloorId]
  );

  const handleSelectFloor3D = useCallback(
    (value: string) => {
      if (value === '__ALL__') {
        setViewAllFloors(true);
        autoFrameNextBuildRef.current = true;
        return;
      }
      setViewAllFloors(false);
      setActiveFloorId?.(value);
      autoFrameNextBuildRef.current = true;
    },
    [setActiveFloorId, setViewAllFloors]
  );

  const handleStepFloor3D = useCallback(
    (direction: 'up' | 'down') => {
      if (sortedFloorsDesc.length === 0) return;
      const baseIdx = activeFloorIndexDesc >= 0 ? activeFloorIndexDesc : sortedFloorsDesc.length - 1;
      const nextIdx =
        direction === 'up'
          ? viewAllFloors
            ? Math.max(0, baseIdx)
            : Math.max(0, baseIdx - 1)
          : viewAllFloors
          ? Math.min(sortedFloorsDesc.length - 1, baseIdx)
          : Math.min(sortedFloorsDesc.length - 1, baseIdx + 1);
      const targetFloor = sortedFloorsDesc[nextIdx];
      if (!targetFloor) return;
      setViewAllFloors(false);
      setActiveFloorId?.(targetFloor.id);
      autoFrameNextBuildRef.current = true;
    },
    [activeFloorIndexDesc, setActiveFloorId, setViewAllFloors, sortedFloorsDesc, viewAllFloors]
  );

  const selectedPanelDefaultPosClass =
    !showAxes || xyzPanel.position
      ? project.floors.length >= 1 && !floorPanel.position
        ? 'top-14 right-2.5'
        : 'top-3 right-2.5'
      : xyzPanel.collapsed
      ? 'top-12 right-2.5'
      : 'top-[126px] right-2.5';

  const canAccept3DDrop = canInsertIn3DScene({
    is3DView: true,
    isSceneDragLocked,
    isReadOnlyMode
  });

  const handleSceneDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const types = Array.from(e.dataTransfer?.types || []).map(t => t.toLowerCase());
      const hasPresetDrag = Boolean(
        draggedPresetName || types.includes('presetname') || types.includes('text/plain')
      );
      if (!hasPresetDrag) return;

      if (!canAccept3DDrop) {
        e.dataTransfer.dropEffect = 'none';
        setDropHoverState(isReadOnlyMode ? null : 'locked');
        return;
      }

      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (dropHoverState !== 'allowed') {
        setDropHoverState('allowed');
      }
    },
    [canAccept3DDrop, draggedPresetName, dropHoverState, isReadOnlyMode]
  );

  const handleSceneDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && rootRef.current?.contains(nextTarget)) return;
    setDropHoverState(null);
  }, []);

  const handleSceneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropHoverState(null);
      if (!canAccept3DDrop) return;

      const presetName =
        e.dataTransfer.getData('presetName') ||
        e.dataTransfer.getData('text/plain') ||
        draggedPresetName ||
        '';
      if (!presetName) return;

      const preset = DEVICE_CATALOG.find(p => p.name === presetName);
      const isRackPreset = preset?.category === 'rack';
      const refs = sceneRefs.current;
      if (!refs) {
        onDropDevice?.(presetName, 360, 240);
        return;
      }

      const rect = refs.renderer.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _raycaster.setFromCamera(_pointer, refs.camera);

        // 1) Dropping a non-rack device directly onto a 3D Rack mounts it into the target Rack U slot
        if (!isRackPreset && onDropDeviceIntoRack) {
          const hits = _raycaster.intersectObjects(refs.worldRoot.children, true);
          for (const hit of hits) {
            const { selectType, selectId, nodeId } = hit.object.userData || {};
            if (selectType === 'rack' && selectId) {
              const rackEntry = nodeId ? refs.nodeGroups.get(String(nodeId)) : undefined;
              const rackRecord = projectRef.current.racks.find(
                r => r.id === String(selectId) || r.id === rackEntry?.node.customData?.rackId
              );
              const totalUnits =
                rackRecord?.totalUnits ||
                rackEntry?.node.customData?.totalUnits ||
                42;
              const isFloorBasedMode = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(
                projectRef.current.activeMode
              );
              const isSmallWallRack = isFloorBasedMode && totalUnits <= 18;
              const rackGroupY = rackEntry?.group.position.y ?? refs.activeFloorY;
              const preferredU = computeRackUnitFromWorldY(
                hit.point.y,
                rackGroupY,
                totalUnits,
                isSmallWallRack
              );
              onDropDeviceIntoRack(presetName, rackRecord?.id || String(selectId), preferredU, 'front');
              return;
            }
          }
        }

        // 2) Otherwise project drop onto the active 3D floor plane and convert back to 2D canvas coordinates
        const floorPlane = new THREE.Plane(_planeNormal, -(refs.activeFloorY ?? 0));
        const hitPoint = _raycaster.ray.intersectPlane(floorPlane, _dragHitPoint);
        if (hitPoint) {
          const canvasCenter = worldXZToCanvas(hitPoint.x, hitPoint.z, refs.origin);
          const halfW = (preset?.defaultWidth ?? 150) / 2;
          const halfH = (preset?.defaultHeight ?? 56) / 2;
          const targetX = Math.max(10, Math.round(canvasCenter.x - halfW));
          const targetY = Math.max(10, Math.round(canvasCenter.y - halfH));
          onDropDevice?.(presetName, targetX, targetY);
          return;
        }
      }

      // Fallback: place near orbit camera target
      const fallbackCenter = worldXZToCanvas(
        refs.controls.target.x,
        refs.controls.target.z,
        refs.origin
      );
      const targetX = Math.max(10, Math.round(fallbackCenter.x - (preset?.defaultWidth ?? 150) / 2));
      const targetY = Math.max(10, Math.round(fallbackCenter.y - (preset?.defaultHeight ?? 56) / 2));
      onDropDevice?.(presetName, targetX, targetY);
    },
    [canAccept3DDrop, draggedPresetName, onDropDevice, onDropDeviceIntoRack]
  );

  // Touch drag session uses DragSessionItem['selectType'] compatibility: allow 'edge' in DragSession
  return (
    <div
      ref={rootRef}
      data-testid="network-3d-scene"
      data-active-floor-id={resolvedActiveFloorId}
      data-filtered-asset-count={Object.keys(filteredAssets).length}
      onDragOver={handleSceneDragOver}
      onDragLeave={handleSceneDragLeave}
      onDrop={handleSceneDrop}
      className="w-full h-full relative overflow-hidden bg-slate-950 select-none"
    >
      {/* Dedicated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full relative z-0" />

      {dropHoverState && (
        <div
          className={`pointer-events-none absolute inset-3 z-30 rounded-xl border-2 border-dashed flex items-start justify-center pt-4 transition-colors ${
            dropHoverState === 'allowed'
              ? 'border-blue-400/90 bg-blue-500/10'
              : 'border-amber-400/90 bg-amber-500/10'
          }`}
        >
          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-lg ${
              dropHoverState === 'allowed'
                ? 'bg-blue-600 text-white'
                : 'bg-amber-600 text-white'
            }`}
          >
            {dropHoverState === 'allowed'
              ? 'Thả để đặt thiết bị vào không gian 3D (hoặc thả lên Tủ Rack để gắn U)'
              : 'Đang khóa kéo thả 3D — nhấn "Mở khóa kéo 3D" ở thanh dưới để thả thiết bị'}
          </div>
        </div>
      )}

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 text-white p-6 z-30">
          <div className="max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-center space-y-3">
            <Box className="w-8 h-8 text-blue-400 mx-auto" />
            <div className="font-bold text-sm">Không thể khởi tạo WebGL 3D</div>
            <p className="text-xs text-slate-300">{webglError}</p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                type="button"
                data-testid="retry-webgl-3d-btn"
                onClick={() => {
                  setWebglError(null);
                  onContextLostChange?.(false);
                  setRendererEpoch(n => n + 1);
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors"
              >
                Thử khôi phục 3D
              </button>
              <button
                type="button"
                onClick={onExit3D}
                className="px-4 py-2 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
              >
                Quay lại sơ đồ 2D CAD
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transient 3D Connect / Drag Status Pills */}
      {((activeTool === 'connect' && !isSceneDragLocked && !isReadOnlyMode) || draggingHud) && (
        <div className="pointer-events-none absolute top-3 left-3 z-20 flex flex-col items-start gap-1.5 max-w-[calc(100%-24px)]">
          {activeTool === 'connect' && !isSceneDragLocked && !isReadOnlyMode && (
            <div className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium shadow-md flex items-center gap-1.5">
              <Spline className="w-3 h-3 shrink-0" />
              <span>
                {connectSourceLabel
                  ? `Đang nối từ "${connectSourceLabel}" · Nhấp thiết bị đích (Esc để hủy)`
                  : 'Chế độ Nối dây 3D · Nhấp thiết bị nguồn để bắt đầu'}
              </span>
            </div>
          )}

          {draggingHud && (
            <div className="px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-mono tabular-nums shadow-md flex items-center gap-1.5">
              <Move className="w-3 h-3 shrink-0" />
              <span className="font-sans font-semibold">{draggingHud.label}</span>
              <span>{draggingHud.metricText ? `· ${draggingHud.metricText}` : `· X:${draggingHud.x} Y:${draggingHud.y}`}</span>
            </div>
          )}
        </div>
      )}

      {/* Movable & Collapsible 3D Floor Selector Overlay */}
      <FloorSwitcher3DOverlay
        floors={project.floors}
        activeFloorId={resolvedActiveFloorId}
        isFloorBasedMode={isFloorBasedMode3D}
        viewAllFloors={viewAllFloors}
        isReadOnlyMode={isReadOnlyMode}
        showAxes={showAxes}
        isXyzPanelFreePositioned={Boolean(xyzPanel.position)}
        panel={floorPanel}
        onSelectFloor={handleSelectFloor3D}
        onStepFloor={handleStepFloor3D}
        onToggleViewAllFloors={() => {
          setViewAllFloors(v => !v);
          autoFrameNextBuildRef.current = true;
        }}
        onCloneFloor={onCloneFloor}
      />

      {/* Movable & Collapsible Camera-Rotation-Matrix XYZ Axis Helper */}
      {showAxes && (
        <div
          ref={xyzPanel.panelRef}
          data-testid="3d-xyz-gizmo"
          aria-label="Helper trục tọa độ XYZ theo ma trận xoay camera"
          style={
            xyzPanel.position
              ? { left: `${xyzPanel.position.x}px`, top: `${xyzPanel.position.y}px` }
              : undefined
          }
          className={`pointer-events-auto absolute z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-md p-1 flex flex-col items-center gap-0.5 ${
            xyzPanel.position ? '' : 'top-3 right-3'
          }`}
          title="Helper trục tọa độ XYZ cập nhật theo ma trận xoay camera (Nhấp X/Y/Z để căn góc nhìn)"
        >
          <div className="w-full flex items-center justify-between gap-1 px-0.5">
            <button
              type="button"
              data-testid="3d-xyz-drag-handle"
              onPointerDown={xyzPanel.handleDragStart}
              onDoubleClick={xyzPanel.resetPosition}
              title="Kéo để di chuyển bảng trục XYZ · Nhấp đúp về góc phải"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripHorizontal className="w-3 h-3" />
            </button>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 leading-none select-none">
              XYZ
            </span>
            <button
              type="button"
              data-testid="3d-xyz-collapse-btn"
              onClick={xyzPanel.toggleCollapsed}
              title={xyzPanel.collapsed ? 'Mở rộng bảng trục XYZ' : 'Thu gọn bảng trục XYZ'}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
            >
              {xyzPanel.collapsed ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
          </div>
          <svg
            width="76"
            height="76"
            viewBox="0 0 76 76"
            className={xyzPanel.collapsed ? 'hidden' : 'overflow-visible'}
          >
            <circle cx="38" cy="38" r="30" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
            <g ref={gizmoLayerRef}>
              <g
                ref={gizmoGroupXRef}
                className="cursor-pointer"
                onClick={() => applyCameraPreset('side')}
              >
                <title>Trục +X (Nhấp để nhìn từ bên hông)</title>
                <line ref={gizmoNegLineXRef} x1="38" y1="38" x2="26" y2="38" stroke="#ef4444" strokeOpacity="0.35" strokeWidth="1.4" strokeDasharray="2 2" strokeLinecap="round" />
                <line ref={gizmoPosLineXRef} x1="38" y1="38" x2="60" y2="38" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round" />
                <circle ref={gizmoDotXRef} cx="60" cy="38" r="2.8" fill="#ef4444" />
                <text ref={gizmoTextXRef} x="68" y="41" fill="#ef4444" fontSize="10" fontWeight="700" textAnchor="middle">X</text>
              </g>
              <g
                ref={gizmoGroupYRef}
                className="cursor-pointer"
                onClick={() => applyCameraPreset('top')}
              >
                <title>Trục +Y (Nhấp để nhìn từ trên xuống)</title>
                <line ref={gizmoNegLineYRef} x1="38" y1="38" x2="38" y2="50" stroke="#22c55e" strokeOpacity="0.35" strokeWidth="1.4" strokeDasharray="2 2" strokeLinecap="round" />
                <line ref={gizmoPosLineYRef} x1="38" y1="38" x2="38" y2="16" stroke="#22c55e" strokeWidth="2.4" strokeLinecap="round" />
                <circle ref={gizmoDotYRef} cx="38" cy="16" r="2.8" fill="#22c55e" />
                <text ref={gizmoTextYRef} x="38" y="10" fill="#22c55e" fontSize="10" fontWeight="700" textAnchor="middle">Y</text>
              </g>
              <g
                ref={gizmoGroupZRef}
                className="cursor-pointer"
                onClick={() => applyCameraPreset('front')}
              >
                <title>Trục +Z (Nhấp để nhìn trực diện)</title>
                <line ref={gizmoNegLineZRef} x1="38" y1="38" x2="46" y2="29" stroke="#3b82f6" strokeOpacity="0.35" strokeWidth="1.4" strokeDasharray="2 2" strokeLinecap="round" />
                <line ref={gizmoPosLineZRef} x1="38" y1="38" x2="24" y2="53" stroke="#3b82f6" strokeWidth="2.4" strokeLinecap="round" />
                <circle ref={gizmoDotZRef} cx="24" cy="53" r="2.8" fill="#3b82f6" />
                <text ref={gizmoTextZRef} x="18" y="61" fill="#3b82f6" fontSize="10" fontWeight="700" textAnchor="middle">Z</text>
              </g>
            </g>
            <circle cx="38" cy="38" r="2.8" className="fill-slate-600 dark:fill-slate-300 pointer-events-none" />
          </svg>
        </div>
      )}

      {/* Vertical, Right-Corner Docked, Draggable & Collapsible Selected 3D Object Action Panel */}
      {selectedTarget && !draggingHud && (
        <div
          ref={selectedPanel.panelRef}
          data-testid="3d-selected-object-bar"
          data-collapsed={selectedPanel.collapsed ? 'true' : 'false'}
          style={
            selectedPanel.position
              ? { left: `${selectedPanel.position.x}px`, top: `${selectedPanel.position.y}px` }
              : undefined
          }
          className={`pointer-events-auto absolute z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-xs text-slate-800 dark:text-slate-100 ${
            selectedPanel.position ? '' : selectedPanelDefaultPosClass
          }`}
        >
          {selectedPanel.collapsed ? (
            <div className="p-1 flex flex-col items-center gap-1 w-9">
              <button
                type="button"
                data-testid="3d-selected-drag-handle"
                onPointerDown={selectedPanel.handleDragStart}
                onDoubleClick={selectedPanel.resetPosition}
                title="Kéo để di chuyển thanh đối tượng · Nhấp đúp về góc phải"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="3d-selected-collapse-btn"
                onClick={e => {
                  e.stopPropagation();
                  selectedPanel.toggleCollapsed();
                }}
                title={`Mở rộng thông tin ${selectedTarget.label}`}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="3d-toggle-lock-btn"
                disabled={isReadOnlyMode || selectedTarget.layerLockedOnly || (!onToggleNodeLock && !onUpdateNode)}
                onClick={e => {
                  e.stopPropagation();
                  handleToggleSelectedLock();
                }}
                title={
                  selectedTarget.layerLockedOnly
                    ? `${selectedTarget.label} đang khóa theo Lớp thiết kế`
                    : selectedTarget.isNodeLocked
                    ? `Mở khóa ${selectedTarget.label}`
                    : `Khóa vị trí ${selectedTarget.label}`
                }
                className={`p-1.5 rounded-md transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                  selectedTarget.isNodeLocked
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600'
                }`}
              >
                {selectedTarget.isNodeLocked ? (
                  <Unlock className="w-3.5 h-3.5" />
                ) : (
                  <Lock className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ) : (
            <div className="w-[176px] p-1.5 flex flex-col items-stretch gap-1.5 max-h-[calc(100vh-180px)] overflow-y-auto">
              <div className="flex items-center justify-between gap-1 pb-1 border-b border-slate-200/80 dark:border-slate-800">
                <button
                  type="button"
                  data-testid="3d-selected-drag-handle"
                  onPointerDown={selectedPanel.handleDragStart}
                  onDoubleClick={selectedPanel.resetPosition}
                  title="Kéo để di chuyển · Nhấp đúp về góc phải"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                >
                  <GripHorizontal className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 select-none truncate">
                  Đối tượng
                </span>
                <button
                  type="button"
                  data-testid="3d-selected-collapse-btn"
                  onClick={e => {
                    e.stopPropagation();
                    selectedPanel.toggleCollapsed();
                  }}
                  title="Thu gọn thanh đối tượng"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
                >
                  <Minimize2 className="w-3 h-3" />
                </button>
              </div>

              <div
                title={selectedTarget.label}
                className="font-semibold text-[11px] leading-snug text-slate-900 dark:text-slate-100 break-words line-clamp-2"
              >
                {selectedTarget.label}
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/70 rounded px-1.5 py-0.5">
                <span>X:{selectedTarget.x}</span>
                <span>Y:{selectedTarget.y}</span>
                <span>{Math.round(selectedTarget.rotation)}°</span>
              </div>

              {/* 3D Unlocked 360° Rotation Controls (Synced 2D <-> 3D) */}
              {(() => {
                const canMutateIn3D =
                  !isReadOnlyMode &&
                  !isSceneDragLocked &&
                  !selectedTarget.isEffectiveLocked &&
                  Boolean(onRotateNodes || onRotateNodesTransient || onUpdateNode);
                const applyRotationTransient3D = (nextDeg: number) => {
                  const normalized = normalizeRotationDeg(nextDeg);
                  if (onRotateNodesTransient) {
                    onRotateNodesTransient(selectedTarget.nodeIds, normalized);
                  } else if (onRotateNodes) {
                    onRotateNodes(selectedTarget.nodeIds, normalized);
                  } else if (onUpdateNode) {
                    selectedTarget.nodeIds.forEach(nid => onUpdateNode(nid, { rotation: normalized }));
                  }
                };
                const applyRotationCommitted3D = (nextDeg: number) => {
                  const normalized = normalizeRotationDeg(nextDeg);
                  if (onRotateNodes) {
                    onRotateNodes(selectedTarget.nodeIds, normalized);
                  } else if (onUpdateNode) {
                    selectedTarget.nodeIds.forEach(nid => onUpdateNode(nid, { rotation: normalized }));
                  } else if (onRotateNodesTransient) {
                    onRotateNodesTransient(selectedTarget.nodeIds, normalized);
                  }
                };
                return (
                  <div className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-1">
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                        <RotateCw className="w-3 h-3 text-cyan-600" />
                        <span>Xoay 360°</span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={359}
                        step={1}
                        disabled={!canMutateIn3D}
                        aria-label="Xoay đối tượng 3D (độ)"
                        value={Math.round(selectedTarget.rotation)}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) applyRotationCommitted3D(parsed);
                        }}
                        className="w-12 px-1 py-0.5 text-right rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold tabular-nums disabled:opacity-45"
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      disabled={!canMutateIn3D}
                      aria-label="Thanh trượt xoay đối tượng 3D"
                      value={Math.round(selectedTarget.rotation)}
                      onPointerDown={() => onBeginDragSnapshot?.()}
                      onPointerUp={() => onSnapNodesAndCommitDrag?.([])}
                      onKeyUp={() => onSnapNodesAndCommitDrag?.([])}
                      onChange={e => applyRotationTransient3D(parseFloat(e.target.value))}
                      className="w-full accent-cyan-600 disabled:opacity-45"
                    />
                    <div className="grid grid-cols-5 gap-0.5 text-[9.5px] font-mono">
                      {[
                        { label: '-45°', val: selectedTarget.rotation - 45 },
                        { label: '-15°', val: selectedTarget.rotation - 15 },
                        { label: '0°', val: 0 },
                        { label: '+15°', val: selectedTarget.rotation + 15 },
                        { label: '+90°', val: selectedTarget.rotation + 90 }
                      ].map(btn => (
                        <button
                          key={btn.label}
                          type="button"
                          disabled={!canMutateIn3D}
                          onClick={e => {
                            e.stopPropagation();
                            applyRotationCommitted3D(btn.val);
                          }}
                          className="py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-cyan-500 font-semibold disabled:opacity-40"
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                    {onMirrorNodes && (
                      <div className="grid grid-cols-2 gap-1 pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
                        <button
                          type="button"
                          data-testid="3d-mirror-horizontal-btn"
                          disabled={!canMutateIn3D}
                          onClick={e => {
                            e.stopPropagation();
                            onMirrorNodes(selectedTarget.nodeIds, 'horizontal');
                          }}
                          className={`py-1 px-1.5 rounded border text-[10px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 ${
                            selectedTarget.flipX
                              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-400 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <FlipHorizontal2 className="w-3 h-3" />
                          <span>Lật ngang</span>
                        </button>
                        <button
                          type="button"
                          data-testid="3d-mirror-vertical-btn"
                          disabled={!canMutateIn3D}
                          onClick={e => {
                            e.stopPropagation();
                            onMirrorNodes(selectedTarget.nodeIds, 'vertical');
                          }}
                          className={`py-1 px-1.5 rounded border text-[10px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 ${
                            selectedTarget.flipY
                              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-400 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <FlipVertical2 className="w-3 h-3" />
                          <span>Lật dọc</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Notice + Quick Enable if Wi-Fi/Camera coverage overlay is globally hidden */}
              {(selectedTarget.wifiCov || selectedTarget.camFov) &&
                project.settings.showCoverageRadius === false &&
                onUpdateSettings &&
                !isReadOnlyMode && (
                  <button
                    type="button"
                    data-testid="3d-enable-coverage-btn"
                    onClick={e => {
                      e.stopPropagation();
                      onUpdateSettings({ showCoverageRadius: true });
                    }}
                    className="w-full px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold transition-colors"
                  >
                    Bật hiển thị vùng phủ 2D/3D
                  </button>
                )}

              {/* 3D Unlocked Wi-Fi Coverage Controls (Synced 2D <-> 3D) */}
              {selectedTarget.wifiCov && (onUpdateWifiCoverage || onUpdateWifiCoverageTransient) && (() => {
                const cov = selectedTarget.wifiCov;
                const canMutateWifi =
                  !isReadOnlyMode &&
                  !isSceneDragLocked &&
                  !selectedTarget.isEffectiveLocked &&
                  !selectedTarget.wifiLayerLocked;
                const applyWifiTransient = (partial: { radiusMeters?: number; angleDeg?: number }) => {
                  if (onUpdateWifiCoverageTransient) {
                    onUpdateWifiCoverageTransient(selectedTarget.anchorNodeId, partial);
                  } else {
                    onUpdateWifiCoverage?.(selectedTarget.anchorNodeId, partial);
                  }
                };
                const applyWifiCommitted = (partial: { radiusMeters?: number; angleDeg?: number }) => {
                  if (onUpdateWifiCoverage) {
                    onUpdateWifiCoverage(selectedTarget.anchorNodeId, partial);
                  } else {
                    onUpdateWifiCoverageTransient?.(selectedTarget.anchorNodeId, partial);
                  }
                };
                return (
                  <div className="p-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <span className="flex items-center gap-1">
                        <Wifi className="w-3 h-3" /> Wi-Fi
                      </span>
                      <span className="font-mono tabular-nums">~{cov.areaSqm}m²</span>
                    </div>
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Bán kính (m)</span>
                      <input
                        type="number"
                        min={WIFI_MIN_RADIUS_M}
                        max={WIFI_MAX_RADIUS_M}
                        step={0.5}
                        disabled={!canMutateWifi}
                        aria-label="Bán kính phủ Wi-Fi 3D (m)"
                        value={cov.radiusMeters}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            applyWifiCommitted({ radiusMeters: clampWifiRadiusMeters(parsed) });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                    <input
                      type="range"
                      min={WIFI_MIN_RADIUS_M}
                      max={WIFI_MAX_RADIUS_M}
                      step={0.5}
                      disabled={!canMutateWifi}
                      aria-label="Thanh trượt bán kính Wi-Fi 3D"
                      value={cov.radiusMeters}
                      onPointerDown={() => onBeginDragSnapshot?.()}
                      onPointerUp={() => onSnapNodesAndCommitDrag?.([])}
                      onKeyUp={() => onSnapNodesAndCommitDrag?.([])}
                      onChange={e =>
                        applyWifiTransient({
                          radiusMeters: clampWifiRadiusMeters(parseFloat(e.target.value))
                        })
                      }
                      className="w-full accent-emerald-500 disabled:opacity-45"
                    />
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Tỷ lệ %</span>
                      <input
                        type="number"
                        min={10}
                        max={450}
                        step={5}
                        disabled={!canMutateWifi}
                        aria-label="Tỷ lệ phủ Wi-Fi 3D (%)"
                        value={cov.scalePct}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            applyWifiCommitted({ radiusMeters: wifiRadiusFromScalePct(parsed) });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={450}
                      step={5}
                      disabled={!canMutateWifi}
                      aria-label="Thanh trượt tỷ lệ phủ Wi-Fi 3D"
                      value={Math.min(450, Math.max(10, cov.scalePct))}
                      onPointerDown={() => onBeginDragSnapshot?.()}
                      onPointerUp={() => onSnapNodesAndCommitDrag?.([])}
                      onKeyUp={() => onSnapNodesAndCommitDrag?.([])}
                      onChange={e =>
                        applyWifiTransient({
                          radiusMeters: wifiRadiusFromScalePct(parseFloat(e.target.value))
                        })
                      }
                      className="w-full accent-emerald-500 disabled:opacity-45"
                    />
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Diện tích (m²)</span>
                      <input
                        type="number"
                        min={5}
                        step={25}
                        disabled={!canMutateWifi}
                        aria-label="Diện tích phủ Wi-Fi 3D (m²)"
                        value={cov.areaSqm}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed) && parsed > 0) {
                            applyWifiCommitted({
                              radiusMeters: wifiRadiusFromAreaSqm(parsed, cov.angleDeg)
                            });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Góc (°)</span>
                      <input
                        type="number"
                        min={WIFI_MIN_ANGLE_DEG}
                        max={WIFI_MAX_ANGLE_DEG}
                        step={5}
                        disabled={!canMutateWifi}
                        aria-label="Độ rộng góc phát Wi-Fi 3D (độ)"
                        value={cov.angleDeg}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            applyWifiCommitted({ angleDeg: clampWifiAngleDeg(parsed) });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                    <input
                      type="range"
                      min={WIFI_MIN_ANGLE_DEG}
                      max={WIFI_MAX_ANGLE_DEG}
                      step={5}
                      disabled={!canMutateWifi}
                      aria-label="Thanh trượt góc phát Wi-Fi 3D"
                      value={cov.angleDeg}
                      onPointerDown={() => onBeginDragSnapshot?.()}
                      onPointerUp={() => onSnapNodesAndCommitDrag?.([])}
                      onKeyUp={() => onSnapNodesAndCommitDrag?.([])}
                      onChange={e =>
                        applyWifiTransient({
                          angleDeg: clampWifiAngleDeg(parseFloat(e.target.value))
                        })
                      }
                      className="w-full accent-emerald-500 disabled:opacity-45"
                    />
                    <div className="grid grid-cols-4 gap-0.5 text-[9.5px] font-mono">
                      {[60, 90, 120, 360].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          disabled={!canMutateWifi}
                          onClick={e => {
                            e.stopPropagation();
                            applyWifiCommitted({ angleDeg: preset });
                          }}
                          className={`py-0.5 rounded border font-semibold disabled:opacity-40 ${
                            Math.round(cov.angleDeg) === preset
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 hover:border-emerald-500'
                          }`}
                        >
                          {preset}°
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 3D Unlocked Camera FOV Controls (Synced 2D <-> 3D) */}
              {selectedTarget.camFov && (onUpdateCameraFov || onUpdateCameraFovTransient) && (() => {
                const fov = selectedTarget.camFov;
                const canMutateFov =
                  !isReadOnlyMode &&
                  !isSceneDragLocked &&
                  !selectedTarget.isEffectiveLocked &&
                  !selectedTarget.fovLayerLocked;
                const applyCamTransient = (partial: { fovAngle?: number; irDistanceMeters?: number }) => {
                  if (onUpdateCameraFovTransient) {
                    onUpdateCameraFovTransient(selectedTarget.anchorNodeId, partial);
                  } else {
                    onUpdateCameraFov?.(selectedTarget.anchorNodeId, partial);
                  }
                };
                const applyCamCommitted = (partial: { fovAngle?: number; irDistanceMeters?: number }) => {
                  if (onUpdateCameraFov) {
                    onUpdateCameraFov(selectedTarget.anchorNodeId, partial);
                  } else {
                    onUpdateCameraFovTransient?.(selectedTarget.anchorNodeId, partial);
                  }
                };
                return (
                  <div className="p-1.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                      <span className="flex items-center gap-1">
                        <Video className="w-3 h-3" /> Camera FOV
                      </span>
                      <span className="font-mono tabular-nums">~{fov.areaSqm}m²</span>
                    </div>
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Góc (°)</span>
                      <input
                        type="number"
                        min={CAMERA_FOV_MIN_DEG}
                        max={CAMERA_FOV_MAX_DEG}
                        step={1}
                        disabled={!canMutateFov}
                        aria-label="Góc quét Camera FOV 3D (độ)"
                        value={fov.fovAngle}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            applyCamCommitted({ fovAngle: clampCameraFovDeg(parsed) });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                    <input
                      type="range"
                      min={CAMERA_FOV_MIN_DEG}
                      max={CAMERA_FOV_MAX_DEG}
                      step={1}
                      disabled={!canMutateFov}
                      aria-label="Thanh trượt góc quét Camera FOV 3D"
                      value={fov.fovAngle}
                      onPointerDown={() => onBeginDragSnapshot?.()}
                      onPointerUp={() => onSnapNodesAndCommitDrag?.([])}
                      onKeyUp={() => onSnapNodesAndCommitDrag?.([])}
                      onChange={e =>
                        applyCamTransient({
                          fovAngle: clampCameraFovDeg(parseFloat(e.target.value))
                        })
                      }
                      className="w-full accent-amber-500 disabled:opacity-45"
                    />
                    <div className="grid grid-cols-4 gap-0.5 text-[9.5px] font-mono">
                      {[45, 90, 120, 360].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          disabled={!canMutateFov}
                          onClick={e => {
                            e.stopPropagation();
                            applyCamCommitted({ fovAngle: preset });
                          }}
                          className={`py-0.5 rounded border font-semibold disabled:opacity-40 ${
                            Math.round(fov.fovAngle) === preset
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 hover:border-amber-500'
                          }`}
                        >
                          {preset}°
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Tầm (m)</span>
                      <input
                        type="number"
                        min={CAMERA_RANGE_MIN_M}
                        max={CAMERA_RANGE_MAX_M}
                        step={0.5}
                        disabled={!canMutateFov}
                        aria-label="Tầm quan sát Camera 3D (m)"
                        value={fov.rangeMeters}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            applyCamCommitted({ irDistanceMeters: clampCameraRangeMeters(parsed) });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                    <input
                      type="range"
                      min={CAMERA_RANGE_MIN_M}
                      max={CAMERA_RANGE_MAX_M}
                      step={0.5}
                      disabled={!canMutateFov}
                      aria-label="Thanh trượt tầm quan sát Camera 3D"
                      value={fov.rangeMeters}
                      onPointerDown={() => onBeginDragSnapshot?.()}
                      onPointerUp={() => onSnapNodesAndCommitDrag?.([])}
                      onKeyUp={() => onSnapNodesAndCommitDrag?.([])}
                      onChange={e =>
                        applyCamTransient({
                          irDistanceMeters: clampCameraRangeMeters(parseFloat(e.target.value))
                        })
                      }
                      className="w-full accent-amber-500 disabled:opacity-45"
                    />
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Tỷ lệ %</span>
                      <input
                        type="number"
                        min={10}
                        max={400}
                        step={5}
                        disabled={!canMutateFov}
                        aria-label="Tỷ lệ vùng quan sát Camera 3D (%)"
                        value={fov.scalePct}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed)) {
                            applyCamCommitted({ irDistanceMeters: cameraRangeFromScalePct(parsed) });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={400}
                      step={5}
                      disabled={!canMutateFov}
                      aria-label="Thanh trượt tỷ lệ vùng quan sát Camera 3D"
                      value={Math.min(400, Math.max(10, fov.scalePct))}
                      onPointerDown={() => onBeginDragSnapshot?.()}
                      onPointerUp={() => onSnapNodesAndCommitDrag?.([])}
                      onKeyUp={() => onSnapNodesAndCommitDrag?.([])}
                      onChange={e =>
                        applyCamTransient({
                          irDistanceMeters: cameraRangeFromScalePct(parseFloat(e.target.value))
                        })
                      }
                      className="w-full accent-amber-500 disabled:opacity-45"
                    />
                    <div className="flex items-center justify-between gap-1 text-[10px]">
                      <span className="text-slate-500 dark:text-slate-400">Diện tích (m²)</span>
                      <input
                        type="number"
                        min={5}
                        step={10}
                        disabled={!canMutateFov}
                        aria-label="Diện tích vùng quan sát Camera 3D (m²)"
                        value={fov.areaSqm}
                        onChange={e => {
                          const parsed = parseFloat(e.target.value);
                          if (!Number.isNaN(parsed) && parsed > 0) {
                            applyCamCommitted({
                              irDistanceMeters: cameraRangeFromAreaSqm(parsed, fov.fovAngle)
                            });
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono text-[10px] font-semibold disabled:opacity-45"
                      />
                    </div>
                  </div>
                );
              })()}

              {selectedTarget.isEffectiveLocked ? (
                <div className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-semibold text-center">
                  {selectedTarget.layerLockedOnly ? 'Khóa lớp' : 'Đã khóa'}
                </div>
              ) : isSceneDragLocked ? (
                onToggleSceneDragLocked && !isReadOnlyMode ? (
                  <button
                    type="button"
                    data-testid="3d-unlock-drag-btn"
                    onClick={e => {
                      e.stopPropagation();
                      onToggleSceneDragLocked();
                    }}
                    className="w-full px-1.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold text-center transition-colors flex items-center justify-center gap-1"
                  >
                    <Unlock className="w-3 h-3" />
                    <span>Mở khóa kéo 3D để xoay/kéo</span>
                  </button>
                ) : (
                  <div className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-medium text-center">
                    Mở khóa 3D để xoay/kéo
                  </div>
                )
              ) : null}

              <button
                type="button"
                data-testid="3d-toggle-lock-btn"
                disabled={isReadOnlyMode || selectedTarget.layerLockedOnly || (!onToggleNodeLock && !onUpdateNode)}
                onClick={e => {
                  e.stopPropagation();
                  handleToggleSelectedLock();
                }}
                title={
                  selectedTarget.layerLockedOnly
                    ? 'Đối tượng đang bị khóa theo Lớp thiết kế'
                    : selectedTarget.isNodeLocked
                    ? 'Mở khóa vị trí (cập nhật customData.locked = false) để cho phép kéo thả trong 3D'
                    : 'Khóa vị trí (lưu customData.locked = true) để ngăn kéo thả ngoài ý muốn'
                }
                className={`w-full flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                  selectedTarget.isNodeLocked
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600'
                }`}
              >
                {selectedTarget.isNodeLocked ? (
                  <>
                    <Unlock className="w-3 h-3 shrink-0" />
                    <span>Mở khóa</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>Khóa</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Vertical, Right-Corner Docked, Draggable & Collapsible Selected 3D Cable Panel */}
      {selectedCable && !selectedTarget && !draggingHud && (
        <div
          ref={selectedPanel.panelRef}
          data-testid="3d-selected-cable-bar"
          data-collapsed={selectedPanel.collapsed ? 'true' : 'false'}
          style={
            selectedPanel.position
              ? { left: `${selectedPanel.position.x}px`, top: `${selectedPanel.position.y}px` }
              : undefined
          }
          className={`pointer-events-auto absolute z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-sky-300 dark:border-sky-700 shadow-lg text-xs text-slate-800 dark:text-slate-100 ${
            selectedPanel.position ? '' : selectedPanelDefaultPosClass
          }`}
        >
          {selectedPanel.collapsed ? (
            <div className="p-1 flex flex-col items-center gap-1 w-9">
              <button
                type="button"
                data-testid="3d-selected-drag-handle"
                onPointerDown={selectedPanel.handleDragStart}
                onDoubleClick={selectedPanel.resetPosition}
                title="Kéo để di chuyển · Nhấp đúp về góc phải"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="3d-selected-collapse-btn"
                onClick={e => {
                  e.stopPropagation();
                  selectedPanel.toggleCollapsed();
                }}
                title={`Mở rộng thông tin ${selectedCable.cable.cableCode}`}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-sky-500 shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="w-[136px] p-1.5 flex flex-col items-stretch gap-1.5">
              <div className="flex items-center justify-between gap-1 pb-1 border-b border-slate-200/80 dark:border-slate-800">
                <button
                  type="button"
                  data-testid="3d-selected-drag-handle"
                  onPointerDown={selectedPanel.handleDragStart}
                  onDoubleClick={selectedPanel.resetPosition}
                  title="Kéo để di chuyển · Nhấp đúp về góc phải"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                >
                  <GripHorizontal className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400 select-none truncate">
                  Tuyến cáp
                </span>
                <button
                  type="button"
                  data-testid="3d-selected-collapse-btn"
                  onClick={e => {
                    e.stopPropagation();
                    selectedPanel.toggleCollapsed();
                  }}
                  title="Thu gọn thanh tuyến cáp"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
                >
                  <Minimize2 className="w-3 h-3" />
                </button>
              </div>

              <div className="flex items-center gap-1 font-semibold text-[11px]">
                <GitBranch className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span className="truncate">{selectedCable.cable.cableCode}</span>
              </div>

              <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight break-words">
                {selectedCable.sourceLabel} → {selectedCable.targetLabel}
              </div>

              <div className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 text-[10px] font-medium border border-sky-200 dark:border-sky-800 text-center">
                {selectedCable.cable.routingType === 'straight'
                  ? 'Thẳng'
                  : selectedCable.cable.routingType === 'curved'
                  ? 'Bo tròn'
                  : 'Vuông góc'}
              </div>

              {onDeleteCable && (
                <button
                  type="button"
                  disabled={isReadOnlyMode || isSceneDragLocked}
                  onClick={e => {
                    e.stopPropagation();
                    onDeleteCable(selectedCable.cable.id);
                    onSelect('none');
                  }}
                  title={
                    isSceneDragLocked ? 'Mở khóa kéo 3D để xóa cáp' : 'Xóa tuyến cáp này'
                  }
                  className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3 h-3 shrink-0" />
                  <span>Xóa cáp</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edge Snap Drop-Zone Visual Guides While Dragging the 3D Control Dock */}
      {dockDragPreview && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className={`absolute left-2 top-1/2 -translate-y-1/2 w-12 h-44 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center text-[10px] font-bold ${
              dockDragPreview.previewEdge === 'left'
                ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                : 'border-slate-500/40 bg-slate-800/20 text-slate-400'
            }`}
          >
            <span className="-rotate-90 whitespace-nowrap">Trái</span>
          </div>
          <div
            className={`absolute right-2 top-[54%] -translate-y-1/2 w-12 h-44 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center text-[10px] font-bold ${
              dockDragPreview.previewEdge === 'right'
                ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                : 'border-slate-500/40 bg-slate-800/20 text-slate-400'
            }`}
          >
            <span className="rotate-90 whitespace-nowrap">Phải</span>
          </div>
          <div
            className={`absolute bottom-2 left-1/2 -translate-x-1/2 w-56 h-10 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center text-[10px] font-bold ${
              dockDragPreview.previewEdge === 'bottom'
                ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                : 'border-slate-500/40 bg-slate-800/20 text-slate-400'
            }`}
          >
            Dưới
          </div>
          <div
            style={{
              left: `${Math.round(dockDragPreview.left)}px`,
              top: `${Math.round(dockDragPreview.top)}px`,
              transform: 'translate(-50%, -50%)'
            }}
            className="absolute px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold shadow-xl border border-blue-300 whitespace-nowrap"
          >
            {snapEdgeLabel}
          </div>
        </div>
      )}

      {/* Draggable, Edge-Snapping (Bottom / Left / Right) OR Free-Moving, Collapsible 3D Control Dock */}
      <div
        ref={dockRef}
        data-testid="3d-control-dock"
        data-dock-edge={dockEdge}
        data-dock-collapsed={dockCollapsed ? 'true' : 'false'}
        style={
          dockEdge === 'free' && dockFreePos
            ? { left: `${dockFreePos.x}px`, top: `${dockFreePos.y}px` }
            : undefined
        }
        className={`pointer-events-none absolute z-20 ${dockPositionClass} ${
          isVerticalDock ? 'max-h-[calc(100%-132px)]' : 'max-w-[95vw]'
        }`}
      >
        {dockCollapsed ? (
          <div
            className={`pointer-events-auto rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg p-1 text-xs text-slate-800 dark:text-slate-100 flex ${
              isVerticalDock ? 'flex-col' : 'flex-row'
            } items-center gap-1`}
          >
            <button
              type="button"
              data-testid="3d-dock-drag-handle"
              onPointerDown={handleDockDragPointerDown}
              onDoubleClick={() => {
                setDockEdge('bottom');
                setDockFreePos(null);
              }}
              title="Kéo thả để di chuyển tự do hoặc xếp gọn xuống dưới / trái / phải · Nhấp đúp về dưới"
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              {isVerticalDock ? <GripHorizontal className="w-3.5 h-3.5" /> : <GripVertical className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              data-testid="3d-dock-expand-btn"
              onClick={() => setDockCollapsed(false)}
              title="Mở rộng thanh điều khiển góc nhìn 3D"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap transition-colors ${
                isVerticalDock ? 'flex-col py-1.5' : ''
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px]">{isVerticalDock ? '3D' : 'Điều khiển 3D'}</span>
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto rounded-xl bg-white/96 dark:bg-slate-900/96 border border-slate-200 dark:border-slate-700 shadow-xl px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100">
            <div
              className={`flex ${
                isVerticalDock ? 'flex-col items-stretch overflow-y-auto max-h-[calc(100vh-220px)]' : 'flex-row items-center overflow-x-auto flex-nowrap'
              } gap-1`}
            >
              <button
                type="button"
                data-testid="3d-dock-drag-handle"
                onPointerDown={handleDockDragPointerDown}
                onDoubleClick={() => {
                  setDockEdge('bottom');
                  setDockFreePos(null);
                }}
                title="Kéo thả để di chuyển tự do hoặc xếp gọn xuống dưới / bên trái / bên phải · Nhấp đúp về dưới"
                className="flex items-center justify-center p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                {isVerticalDock ? <GripHorizontal className="w-3.5 h-3.5" /> : <GripVertical className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('iso')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'iso'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Góc nhìn Isometric 3D"
              >
                <Compass className="w-3.5 h-3.5 shrink-0" />
                <span>Isometric</span>
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('top')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'top'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Chiếu bằng từ trên xuống"
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>Trên xuống</span>
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('front')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'front'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Nhìn trực diện tủ Rack"
              >
                <Box className="w-3.5 h-3.5 shrink-0" />
                <span>Trực diện</span>
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('side')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'side'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Nhìn mặt cắt bên hông"
              >
                <Box className="w-3.5 h-3.5 shrink-0" />
                <span>Bên hông</span>
              </button>

              <div className={isVerticalDock ? 'h-px w-full bg-slate-200 dark:bg-slate-700 shrink-0 my-0.5' : 'h-5 w-px bg-slate-200 dark:bg-slate-700 shrink-0'} />

              <button
                type="button"
                data-testid="3d-dock-routing-toggle"
                onClick={() => setDockDrawer(d => (d === 'routing' ? 'none' : 'routing'))}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  dockDrawer === 'routing'
                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={
                  dockDrawer === 'routing'
                    ? 'Thu gọn menu kiểu dây & bo góc'
                    : 'Mở rộng menu kiểu dây (Vuông góc, Thẳng, Bo tròn, Bo góc)'
                }
              >
                <Spline className="w-3.5 h-3.5 shrink-0" />
                <span>Kiểu dây</span>
                {dockDrawer === 'routing' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </button>

              <button
                type="button"
                data-testid="3d-dock-collapse-btn"
                onClick={() => setDockCollapsed(true)}
                className="flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 shrink-0"
                title="Thu gọn thanh điều khiển 3D để không che hình vẽ"
              >
                <Minimize2 className="w-3.5 h-3.5 shrink-0" />
                {!isVerticalDock && <span className="text-[11px]">Thu gọn</span>}
              </button>
            </div>

            {dockDrawer === 'routing' && (
              <div
                data-testid="3d-dock-routing-panel"
                className={`mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-800 flex ${
                  isVerticalDock
                    ? 'flex-col items-stretch'
                    : 'flex-row items-center justify-between flex-nowrap overflow-x-auto'
                } gap-1 text-[11px]`}
              >
                {selectedCable && (
                  <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-300 px-1 whitespace-nowrap shrink-0">
                    {selectedCable.cable.cableCode}:
                  </span>
                )}

                {(
                  [
                    { id: 'orthogonal', label: 'Vuông góc' },
                    { id: 'straight', label: 'Thẳng' },
                    { id: 'curved', label: 'Bo tròn' }
                  ] as const
                ).map(opt => {
                  const targetRouting = selectedCable ? selectedCable.cable.routingType : preferredRouting;
                  const isActive = targetRouting === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`3d-routing-${opt.id}`}
                      disabled={isReadOnlyMode}
                      onClick={() => {
                        setPreferredRouting(opt.id);
                        if (selectedCable && onUpdateCable) {
                          onUpdateCable(selectedCable.cable.id, { routingType: opt.id });
                        }
                      }}
                      className={`px-2 py-1 rounded-md font-medium whitespace-nowrap shrink-0 transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                        isActive
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                      title={
                        selectedCable
                          ? `Đổi tuyến cáp ${selectedCable.cable.cableCode} sang kiểu ${opt.label}`
                          : `Chọn kiểu dây ${opt.label} cho cáp nối mới`
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

          </div>
        )}
      </div>

      {/* On-Screen 3D Performance & Rendering Control Panel (Wireframe, Quality, Global Shadows) */}
      <div
        ref={renderControlsPanel.panelRef}
        data-testid="3d-render-controls-panel"
        style={
          renderControlsPanel.position
            ? { left: `${renderControlsPanel.position.x}px`, top: `${renderControlsPanel.position.y}px` }
            : undefined
        }
        className={`pointer-events-none absolute z-20 ${
          renderControlsPanel.position ? '' : 'top-14 left-3 md:max-w-[calc(100%-132px)]'
        } max-w-[calc(100%-120px)]`}
      >
        {renderControlsPanel.collapsed ? (
          <div className="pointer-events-auto flex items-center gap-1 px-1.5 py-1 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-xs text-slate-800 dark:text-slate-100">
            <button
              type="button"
              data-testid="3d-render-drag-handle"
              onPointerDown={renderControlsPanel.handleDragStart}
              onDoubleClick={renderControlsPanel.resetPosition}
              title="Kéo để di chuyển bảng hiệu năng 3D · Nhấp đúp về góc mặc định"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="3d-render-expand-btn"
              onClick={renderControlsPanel.toggleCollapsed}
              title="Mở bảng điều chỉnh Wireframe, Chất lượng & Bóng đổ 3D"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Hiển thị 3D</span>
              <Maximize2 className="w-3 h-3 text-slate-400" />
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto flex items-center gap-0.5 px-1.5 h-9 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-xs text-slate-800 dark:text-slate-100 overflow-x-auto flex-nowrap">
            <button
              type="button"
              data-testid="3d-render-drag-handle"
              onPointerDown={renderControlsPanel.handleDragStart}
              onDoubleClick={renderControlsPanel.resetPosition}
              title="Kéo để di chuyển bảng hiệu năng 3D · Nhấp đúp về góc mặc định"
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              data-testid="3d-wireframe-toggle-btn"
              aria-pressed={wireframeMode}
              onClick={toggleWireframeMode}
              title="Bật/tắt chế độ khung dây (Wireframe) cho mô hình 3D"
              className={`flex items-center gap-1 px-1.5 h-7 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                wireframeMode
                  ? 'bg-indigo-600 text-white'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
              }`}
            >
              <Grid3x3 className="w-3.5 h-3.5 shrink-0" />
              <span>Khung dây</span>
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 shrink-0 mx-0.5" />

            <div
              className="flex items-center gap-0.5 shrink-0"
              role="group"
              aria-label="Chất lượng kết xuất 3D"
            >
              <Gauge className="w-3.5 h-3.5 text-slate-400 mr-0.5 shrink-0 hidden xl:inline" />
              {(
                [
                  { id: 'low', label: 'Thấp', title: 'Chất lượng Thấp: Giảm chi tiết tủ & dây để tối ưu FPS' },
                  { id: 'medium', label: 'TB', title: 'Chất lượng Trung bình: Cân bằng tốc độ và độ nét' },
                  { id: 'high', label: 'Cao', title: 'Chất lượng Cao: Chi tiết đầy đủ & độ phân giải tối đa' }
                ] as const
              ).map(opt => {
                const active = renderQuality === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`3d-quality-${opt.id}`}
                    aria-pressed={active}
                    onClick={() => setRenderQuality(opt.id)}
                    title={opt.title}
                    className={`px-1.5 h-7 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 shrink-0 mx-0.5" />

            <button
              id="shadow-toggle-button"
              type="button"
              data-testid="shadow-toggle-button"
              aria-pressed={shadowsEnabled}
              onClick={toggleShadowsEnabled}
              title={
                shadowsEnabled
                  ? 'Tắt tính toán đổ bóng toàn cục để tăng hiệu năng cho tủ rack phức tạp'
                  : 'Bật lại tính toán đổ bóng toàn cục trong không gian 3D'
              }
              className={`flex items-center gap-1 px-1.5 h-7 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                shadowsEnabled
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/50 hover:bg-amber-500/25'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span>Bóng đổ: {shadowsEnabled ? 'Bật' : 'Tắt'}</span>
            </button>

            <button
              type="button"
              data-testid="3d-heatmap-toggle-btn"
              aria-pressed={showThermalHeatmap}
              onClick={toggleShowThermalHeatmap}
              title={
                showThermalHeatmap
                  ? 'Ẩn lớp phủ bản đồ nhiệt và cảm biến tủ rack 3D'
                  : 'Hiển thị lớp phủ bản đồ nhiệt và nhiệt độ cảm biến tủ rack 3D'
              }
              className={`flex items-center gap-1 px-1.5 h-7 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                showThermalHeatmap
                  ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-400/50 hover:bg-orange-500/25'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Thermometer className="w-3.5 h-3.5 shrink-0" />
              <span>Nhiệt 3D</span>
            </button>

            <button
              type="button"
              data-testid="3d-render-collapse-btn"
              onClick={renderControlsPanel.toggleCollapsed}
              title="Thu gọn bảng hiệu năng 3D"
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 shrink-0"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {hoveredRackSubDevice && !draggingHud && (
        <RackSubDeviceTooltip
          info={hoveredRackSubDevice}
          containerRect={rootRef.current?.getBoundingClientRect() ?? null}
          onMouseEnter={clearRackTooltipTimer}
          onMouseLeave={scheduleHideRackTooltip}
          onOpenDeepInspect={onOpenDeepInspect}
          onSelectDevice={(assetId, rackId) => {
            const matchedNode = project.nodes.find(n => n.assetId === assetId && !n.hidden);
            if (matchedNode) {
              onSelect('node', matchedNode.id);
            } else {
              onSelect('rack', rackId);
            }
            clearRackTooltipTimer();
            setHoveredRackSubDevice(null);
          }}
          onClose={() => {
            clearRackTooltipTimer();
            setHoveredRackSubDevice(null);
          }}
        />
      )}
    </div>
  );
});

Network3DScene.displayName = 'Network3DScene';

