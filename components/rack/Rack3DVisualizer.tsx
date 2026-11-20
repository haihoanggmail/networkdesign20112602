import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  DoorOpen,
  Eye,
  Fan,
  Flame,
  Grid3x3,
  RotateCw,
  Sun,
  Trash2,
  Wind
} from 'lucide-react';
import { DeviceAsset, RackSide, ServerRack } from '../../types/infrastructure';
import {
  canPlaceDeviceAtU,
  clampStartU,
  findNearestAvailableU,
  getAssetUHeight
} from '../../utils/rackGeometry';
import {
  RackAirflowAnalysis,
  RackDoorAirflowType
} from '../../utils/rackAirflow';
import {
  applyGlobalShadowMapping,
  applySceneWireframeMode,
  detectSoftwareGl,
  getPixelRatioForQuality,
  setupStudioEnvironment,
  StudioRenderQuality
} from '../canvas/three/studioEnvironment';
import { ThreeResourceRegistry } from '../canvas/three/resourceRegistry';
import {
  buildInteractiveRackScene,
  InteractiveRackSceneHandle
} from './rack3DGeometry';

// Pre-allocated raycast & camera vectors (zero per-frame heap churn)
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _cameraGoalPos = new THREE.Vector3();
const _cameraGoalTarget = new THREE.Vector3();

type CameraPresetId = 'front' | 'rear' | 'iso' | 'top';
type DoorViewMode = 'open' | 'closed' | 'hidden';

export interface Rack3DVisualizerProps {
  rack: ServerRack;
  assets: Record<string, DeviceAsset>;
  analysis: RackAirflowAnalysis;
  doorType: RackDoorAirflowType;
  fanCount: number;
  onChangeDoorType: (doorType: RackDoorAirflowType) => void;
  onChangeFanCount: (fanCount: number) => void;
  activeSide: RackSide;
  onChangeSide: (side: RackSide) => void;
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string | null) => void;
  draggedExternalAsset: { assetId: string; uHeight: number } | null;
  highlightedGap: { startU: number; endU: number } | null;
  onAssignDeviceToRackSlot: (
    rackId: string,
    assetId: string,
    preferredU: number,
    side: RackSide
  ) => void;
  onRemoveDeviceFromRackSlot: (
    rackId: string,
    assetIdOrU: string | number,
    side: RackSide
  ) => void;
  onDropPresetIntoRack?: (
    presetName: string,
    rackId: string,
    preferredU: number,
    side: RackSide
  ) => void;
  onNotify?: (msg: string) => void;
  isDark: boolean;
}

export const Rack3DVisualizer: React.FC<Rack3DVisualizerProps> = ({
  rack,
  assets,
  analysis,
  doorType,
  fanCount,
  onChangeDoorType,
  onChangeFanCount,
  activeSide,
  onChangeSide,
  selectedAssetId,
  onSelectAsset,
  draggedExternalAsset,
  highlightedGap,
  onAssignDeviceToRackSlot,
  onRemoveDeviceFromRackSlot,
  onDropPresetIntoRack,
  onNotify,
  isDark
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneHandleRef = useRef<InteractiveRackSceneHandle | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraAnimRef = useRef<{ active: boolean }>({ active: false });
  const studioRef = useRef<ReturnType<typeof setupStudioEnvironment> | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const isSoftwareGlRef = useRef<boolean>(false);
  const requestRenderRef = useRef<() => void>(() => {});

  const [doorViewMode, setDoorViewMode] = useState<DoorViewMode>('open');
  const [xraySides, setXraySides] = useState<boolean>(true);
  const [showAirflow, setShowAirflow] = useState<boolean>(true);
  const [showThermal, setShowThermal] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [renderQuality, setRenderQuality] = useState<StudioRenderQuality>('high');
  const [shadowsEnabled, setShadowsEnabled] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [webglLost, setWebglLost] = useState<boolean>(false);
  const [rendererEpoch, setRendererEpoch] = useState<number>(0);
  const [dropReadout, setDropReadout] = useState<{
    label: string;
    startU: number;
    uHeight: number;
    side: RackSide;
    valid: boolean;
  } | null>(null);

  // Refs synced with latest props for imperative Three.js handlers
  const propsRef = useRef({
    rack,
    assets,
    analysis,
    activeSide,
    selectedAssetId,
    draggedExternalAsset,
    showAirflow,
    showThermal,
    autoRotate,
    doorViewMode,
    doorType,
    onChangeSide,
    onSelectAsset,
    onAssignDeviceToRackSlot,
    onDropPresetIntoRack,
    onNotify
  });
  propsRef.current = {
    rack,
    assets,
    analysis,
    activeSide,
    selectedAssetId,
    draggedExternalAsset,
    showAirflow,
    showThermal,
    autoRotate,
    doorViewMode,
    doorType,
    onChangeSide,
    onSelectAsset,
    onAssignDeviceToRackSlot,
    onDropPresetIntoRack,
    onNotify
  };

  const pointerDragRef = useRef<{
    assetId: string;
    side: RackSide;
    startU: number;
    uHeight: number;
    startX: number;
    startY: number;
    isDragging: boolean;
    targetU: number | null;
    targetValid: boolean;
  } | null>(null);

  const selectedMountedEntry = useMemo(() => {
    if (!selectedAssetId) return null;
    const asset = assets[selectedAssetId];
    if (!asset || asset.rackId !== rack.id || !asset.rackUnitStart) return null;
    return {
      asset,
      startU: asset.rackUnitStart,
      uHeight: getAssetUHeight(asset),
      side: (asset.rackSide || 'front') as RackSide
    };
  }, [assets, rack.id, selectedAssetId]);

  const applyCameraPreset = useCallback((preset: CameraPresetId) => {
    const handle = sceneHandleRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!handle || !camera || !controls) return;

    const { cabinetHeight, depth } = handle.dims;
    const midY = cabinetHeight * 0.5;
    const dist = Math.max(2.35, cabinetHeight * 1.25, depth * 2.4);

    if (preset === 'front') {
      _cameraGoalPos.set(0.32, midY + 0.08, dist);
      _cameraGoalTarget.set(0, midY, 0);
      propsRef.current.onChangeSide('front');
    } else if (preset === 'rear') {
      _cameraGoalPos.set(-0.32, midY + 0.08, -dist);
      _cameraGoalTarget.set(0, midY, 0);
      propsRef.current.onChangeSide('rear');
    } else if (preset === 'top') {
      _cameraGoalPos.set(0.28, cabinetHeight + 1.45, dist * 0.55);
      _cameraGoalTarget.set(0, cabinetHeight - 0.1, 0);
    } else {
      // 'iso' 3/4 studio view
      _cameraGoalPos.set(dist * 0.72, midY + 0.35, dist * 0.78);
      _cameraGoalTarget.set(0, midY, 0);
    }

    setAutoRotate(false);
    cameraAnimRef.current.active = true;
    requestRenderRef.current();
  }, []);

  // Initialize Three.js WebGL Viewport & Lifecycle
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    isSoftwareGlRef.current = isSoftwareGl;
    const initialShadows = isSoftwareGl ? false : shadowsEnabled;
    if (isSoftwareGl && shadowsEnabled) {
      setShadowsEnabled(false);
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false
      });
    } catch {
      setWebglLost(true);
      return;
    }
    rendererRef.current = renderer;
    renderer.setPixelRatio(
      getPixelRatioForQuality(renderQuality, window.devicePixelRatio || 1, isSoftwareGl)
    );
    renderer.setSize(
      Math.max(100, container.clientWidth),
      Math.max(100, container.clientHeight)
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const rackRegistry = new ThreeResourceRegistry();
    const studio = setupStudioEnvironment(scene, renderer, isDark, isSoftwareGl, rackRegistry);
    studio.setShadowsEnabled(initialShadows);
    studio.setRenderQuality(renderQuality, isSoftwareGl, initialShadows);
    studioRef.current = studio;

    const handle = buildInteractiveRackScene(
      propsRef.current.rack,
      renderer.capabilities.getMaxAnisotropy(),
      initialShadows
    );
    rackRegistry.trackObjectTree(handle.root, 'rack_shell');
    scene.add(handle.root);
    sceneHandleRef.current = handle;

    const { cabinetHeight, depth } = handle.dims;
    const midY = cabinetHeight * 0.5;
    const initDist = Math.max(2.4, cabinetHeight * 1.25, depth * 2.4);

    const camera = new THREE.PerspectiveCamera(
      42,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.08,
      60
    );
    camera.position.set(initDist * 0.72, midY + 0.3, initDist * 0.78);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, midY, 0);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.95;
    controls.maxDistance = 8.5;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.autoRotateSpeed = 1.4;
    controls.update();
    controlsRef.current = controls;

    // Cancel camera preset flight immediately if user orbits manually
    const onControlStart = () => {
      cameraAnimRef.current.active = false;
      requestRenderRef.current();
    };
    const onControlChange = () => {
      requestRenderRef.current();
    };
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    // Initial scene population
    handle.rebuildDevices(
      propsRef.current.rack,
      propsRef.current.assets,
      propsRef.current.analysis,
      propsRef.current.selectedAssetId,
      propsRef.current.showThermal
    );
    handle.rebuildThermalAndAirflow(
      propsRef.current.analysis,
      propsRef.current.showThermal,
      propsRef.current.showAirflow,
      null
    );
    handle.setDoorMode(propsRef.current.doorViewMode, propsRef.current.doorType);
    handle.setXRaySides(true);

    // ResizeObserver for responsive container sizing
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(100, Math.floor(entry.contentRect.width));
        const h = Math.max(100, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRenderRef.current();
      }
    });
    ro.observe(container);

    // Render scheduling with WebGL2 fenceSync pacing on software rasterizers
    let disposed = false;
    let rafId = 0;
    let timerId = 0;
    let renderPending = false;
    let lastTime = performance.now();
    const startTime = lastTime;

    const rawGl = isSoftwareGl ? (renderer.getContext() as WebGL2RenderingContext) : null;
    const afterDraw = (onReady: () => void) => {
      if (disposed) return;
      if (!rawGl || typeof rawGl.fenceSync !== 'function') {
        rafId = requestAnimationFrame(onReady);
        return;
      }
      const sync = rawGl.fenceSync(rawGl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      rawGl.flush();
      const deadline = performance.now() + 80;
      const poll = () => {
        if (disposed) {
          if (sync) rawGl.deleteSync(sync);
          return;
        }
        const status = sync ? rawGl.clientWaitSync(sync, 0, 0) : rawGl.ALREADY_SIGNALED;
        if (
          status === rawGl.ALREADY_SIGNALED ||
          status === rawGl.CONDITION_SATISFIED ||
          performance.now() >= deadline
        ) {
          if (sync) rawGl.deleteSync(sync);
          timerId = window.setTimeout(onReady, 0);
        } else {
          timerId = window.setTimeout(poll, 4);
        }
      };
      timerId = window.setTimeout(poll, 0);
    };

    const tick = () => {
      if (disposed) return;
      renderPending = false;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      const elapsed = (now - startTime) / 1000;
      lastTime = now;

      if (cameraAnimRef.current.active) {
        const k = Math.min(1, 1 - Math.exp(-8 * dt));
        camera.position.lerp(_cameraGoalPos, k);
        controls.target.lerp(_cameraGoalTarget, k);
        if (
          camera.position.distanceTo(_cameraGoalPos) < 0.015 &&
          controls.target.distanceTo(_cameraGoalTarget) < 0.015
        ) {
          camera.position.copy(_cameraGoalPos);
          controls.target.copy(_cameraGoalTarget);
          cameraAnimRef.current.active = false;
        }
      }

      controls.autoRotate = propsRef.current.autoRotate;
      controls.update();

      handle.updateAnimation(
        dt,
        elapsed,
        propsRef.current.analysis,
        propsRef.current.showAirflow
      );

      renderer.render(scene, camera);

      const needsContinuous =
        propsRef.current.showAirflow ||
        propsRef.current.autoRotate ||
        cameraAnimRef.current.active ||
        propsRef.current.analysis.fanCount > 0;

      if (needsContinuous) {
        renderPending = true;
        afterDraw(tick);
      }
    };

    requestRenderRef.current = () => {
      if (disposed || renderPending) return;
      renderPending = true;
      rafId = requestAnimationFrame(tick);
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const handleContextRestored = () => {
      setWebglLost(false);
      setRendererEpoch(n => n + 1);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // Start initial draw
    requestRenderRef.current();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      ro.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlChange);
      controls.dispose();
      rackRegistry.trackObjectTree(handle.root, 'rack_dynamic');
      handle.dispose();
      studio.dispose();
      rackRegistry.disposeAll(renderer);
      scene.clear();
      renderer.renderLists?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneHandleRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      studioRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
    };
    // Rebuild full cabinet geometry only when rack ID, structural dimensions, or recovery epoch change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rack.id, rack.totalUnits, rack.widthMm, rack.depthMm, rendererEpoch]);

  // Update theme cleanly without destroying WebGL context
  useEffect(() => {
    studioRef.current?.updateTheme(isDark);
    requestRenderRef.current();
  }, [isDark]);

  // Sync mounted devices, thermal bars & airflow particles whenever slots/analysis/overlays change
  useEffect(() => {
    const handle = sceneHandleRef.current;
    if (!handle) return;
    handle.rebuildDevices(rack, assets, analysis, selectedAssetId, showThermal);
    handle.rebuildThermalAndAirflow(analysis, showThermal, showAirflow, highlightedGap);
    if (wireframeMode) {
      applySceneWireframeMode(handle.root, true);
    }
    if (rendererRef.current && sceneRef.current) {
      applyGlobalShadowMapping(rendererRef.current, sceneRef.current, shadowsEnabled);
    }
    requestRenderRef.current();
  }, [rack, assets, analysis, selectedAssetId, showThermal, showAirflow, highlightedGap, wireframeMode, shadowsEnabled]);

  // Sync door & side X-ray state
  useEffect(() => {
    const handle = sceneHandleRef.current;
    if (!handle) return;
    handle.setDoorMode(doorViewMode, doorType);
    handle.setXRaySides(xraySides);
    requestRenderRef.current();
  }, [doorViewMode, doorType, xraySides]);

  // Toggle wireframe across interactive rack meshes
  useEffect(() => {
    const handle = sceneHandleRef.current;
    if (!handle) return;
    applySceneWireframeMode(handle.root, wireframeMode);
    requestRenderRef.current();
  }, [wireframeMode]);

  // Adjust rendering quality (pixelRatio, shadow map size, anisotropy)
  useEffect(() => {
    const renderer = rendererRef.current;
    const container = mountRef.current;
    const studio = studioRef.current;
    if (!renderer || !container || !studio) return;
    const w = Math.max(100, container.clientWidth);
    const h = Math.max(100, container.clientHeight);
    renderer.setPixelRatio(
      getPixelRatioForQuality(renderQuality, window.devicePixelRatio || 1, isSoftwareGlRef.current)
    );
    renderer.setSize(w, h);
    studio.setRenderQuality(renderQuality, isSoftwareGlRef.current, shadowsEnabled);
    requestRenderRef.current();
  }, [renderQuality, shadowsEnabled]);

  // Globally toggle shadow mapping for the rack visualizer scene
  useEffect(() => {
    studioRef.current?.setShadowsEnabled(shadowsEnabled);
    requestRenderRef.current();
  }, [shadowsEnabled]);

  // Sync auto-rotate kickoff
  useEffect(() => {
    requestRenderRef.current();
  }, [autoRotate]);

  // Helper: map client coordinates to NDC & raycast U-slot hit planes
  const raycastUSlot = useCallback(
    (
      clientX: number,
      clientY: number,
      forcedSide?: RackSide
    ): { startU: number; side: RackSide } | null => {
      const container = mountRef.current;
      const camera = cameraRef.current;
      const handle = sceneHandleRef.current;
      if (!container || !camera || !handle) return null;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointerNdc, camera);

      // Determine side facing camera when not locked to a specific side
      const targetSide: RackSide =
        forcedSide ?? (camera.position.z < -0.15 ? 'rear' : 'front');
      const planes =
        targetSide === 'rear' ? handle.rearHitPlanes : handle.frontHitPlanes;
      const hits = _raycaster.intersectObjects(planes, false);
      if (hits.length === 0) return null;

      const hitU = hits[0].object.userData?.hitSlotU as number | undefined;
      if (!hitU) return null;
      return { startU: hitU, side: targetSide };
    },
    []
  );

  // Direct 3D Pointer Interaction (Click to select OR Drag mounted device vertically along U rails)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = mountRef.current;
    const camera = cameraRef.current;
    const handle = sceneHandleRef.current;
    const controls = controlsRef.current;
    if (!container || !camera || !handle || !controls) return;

    const rect = container.getBoundingClientRect();
    _pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_pointerNdc, camera);

    const hits = _raycaster.intersectObjects(handle.mountedDevicesGroup.children, true);
    if (hits.length === 0) return;

    const tag = hits[0].object.userData as
      | { assetId?: string; rackSide?: RackSide; startU?: number; uHeight?: number }
      | undefined;
    if (!tag?.assetId || !tag.rackSide || !tag.startU) return;

    pointerDragRef.current = {
      assetId: tag.assetId,
      side: tag.rackSide,
      startU: tag.startU,
      uHeight: tag.uHeight || 1,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      targetU: null,
      targetValid: false
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    const handle = sceneHandleRef.current;
    const controls = controlsRef.current;
    if (!drag || !handle || !controls) return;

    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.isDragging && dist > 6) {
      drag.isDragging = true;
      controls.enabled = false;
      if (doorViewMode === 'closed') {
        setDoorViewMode('open');
      }
    }

    if (!drag.isDragging) return;

    const hit = raycastUSlot(e.clientX, e.clientY, drag.side);
    if (!hit) {
      handle.setDropPreview(null);
      setDropReadout(null);
      drag.targetU = null;
      requestRenderRef.current();
      return;
    }

    const totalUnits = rack.totalUnits || 42;
    const clampedU = clampStartU(hit.startU, totalUnits, drag.uHeight);
    const valid = canPlaceDeviceAtU(
      rack,
      assets,
      clampedU,
      drag.uHeight,
      drag.assetId,
      drag.side
    );

    drag.targetU = clampedU;
    drag.targetValid = valid;
    handle.setDropPreview({ startU: clampedU, uHeight: drag.uHeight, side: drag.side, valid });

    const devName = assets[drag.assetId]?.name || drag.assetId;
    setDropReadout({
      label: devName,
      startU: clampedU,
      uHeight: drag.uHeight,
      side: drag.side,
      valid
    });
    requestRenderRef.current();
  };

  const finishPointerDrag = () => {
    const drag = pointerDragRef.current;
    const handle = sceneHandleRef.current;
    const controls = controlsRef.current;
    if (!drag) return;

    if (controls) controls.enabled = true;
    handle?.setDropPreview(null);
    setDropReadout(null);

    if (!drag.isDragging) {
      onSelectAsset(drag.assetId);
    } else if (drag.targetU !== null) {
      if (drag.targetValid) {
        onAssignDeviceToRackSlot(rack.id, drag.assetId, drag.targetU, drag.side);
      } else {
        onNotify?.(
          `Vị trí U${drag.targetU} trên mặt ${drag.side === 'rear' ? 'sau' : 'trước'} đã bị chiếm!`
        );
      }
    }

    pointerDragRef.current = null;
    requestRenderRef.current();
  };

  // HTML5 External Drag-and-Drop from Right Equipment Palette onto 3D Rack Slots
  const handleHtmlDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const handle = sceneHandleRef.current;
    if (!handle) return;

    // Automatically open front/rear door while dragging equipment onto the rack
    if (doorViewMode === 'closed') {
      setDoorViewMode('open');
    }

    const uHeight = draggedExternalAsset?.uHeight || 1;
    const hit = raycastUSlot(e.clientX, e.clientY);
    if (!hit) {
      handle.setDropPreview(null);
      setDropReadout(null);
      requestRenderRef.current();
      return;
    }

    const totalUnits = rack.totalUnits || 42;
    const clampedU = clampStartU(hit.startU, totalUnits, uHeight);
    const valid = canPlaceDeviceAtU(
      rack,
      assets,
      clampedU,
      uHeight,
      draggedExternalAsset?.assetId,
      hit.side
    );

    handle.setDropPreview({ startU: clampedU, uHeight, side: hit.side, valid });
    const devName = draggedExternalAsset?.assetId
      ? assets[draggedExternalAsset.assetId]?.name || 'Thiết bị'
      : 'Thiết bị';
    setDropReadout({
      label: devName,
      startU: clampedU,
      uHeight,
      side: hit.side,
      valid
    });
    requestRenderRef.current();
  };

  const handleHtmlDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      sceneHandleRef.current?.setDropPreview(null);
      setDropReadout(null);
      requestRenderRef.current();
    }
  };

  const handleHtmlDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = sceneHandleRef.current;
    handle?.setDropPreview(null);
    setDropReadout(null);

    const droppedDevId =
      e.dataTransfer.getData('deviceId') ||
      e.dataTransfer.getData('text/plain') ||
      draggedExternalAsset?.assetId;
    const droppedPreset = e.dataTransfer.getData('presetName');

    const hit = raycastUSlot(e.clientX, e.clientY);
    const targetSide: RackSide = hit?.side ?? activeSide;
    const preferredU = hit?.startU ?? Math.max(1, Math.floor((rack.totalUnits || 42) / 2));

    if (droppedDevId && assets[droppedDevId]) {
      const uHeight = getAssetUHeight(assets[droppedDevId]);
      const clampedU = clampStartU(preferredU, rack.totalUnits || 42, uHeight);
      if (canPlaceDeviceAtU(rack, assets, clampedU, uHeight, droppedDevId, targetSide)) {
        onAssignDeviceToRackSlot(rack.id, droppedDevId, clampedU, targetSide);
        onSelectAsset(droppedDevId);
        if (targetSide !== activeSide) onChangeSide(targetSide);
      } else {
        onNotify?.(
          `Khe U${clampedU} mặt ${targetSide === 'rear' ? 'sau' : 'trước'} không đủ ${uHeight}U trống!`
        );
      }
    } else if (droppedPreset && onDropPresetIntoRack) {
      onDropPresetIntoRack(droppedPreset, rack.id, preferredU, targetSide);
      if (targetSide !== activeSide) onChangeSide(targetSide);
    }

    requestRenderRef.current();
  };

  const handleNudgeSelectedU = (dir: 'up' | 'down') => {
    if (!selectedMountedEntry) return;
    const { asset, startU, uHeight, side } = selectedMountedEntry;
    const totalUnits = rack.totalUnits || 42;
    const step = dir === 'up' ? 1 : -1;
    let candidate = startU + step;
    while (candidate >= 1 && candidate + uHeight - 1 <= totalUnits) {
      if (canPlaceDeviceAtU(rack, assets, candidate, uHeight, asset.id, side)) {
        onAssignDeviceToRackSlot(rack.id, asset.id, candidate, side);
        return;
      }
      candidate += step;
    }
    onNotify?.('Không còn vị trí U trống theo hướng này.');
  };

  const handleFlipSelectedSide = () => {
    if (!selectedMountedEntry) return;
    const { asset, startU, uHeight, side } = selectedMountedEntry;
    const nextSide: RackSide = side === 'front' ? 'rear' : 'front';
    const availableU = findNearestAvailableU(rack, assets, startU, uHeight, asset.id, nextSide);
    if (availableU === null) {
      onNotify?.(`Mặt ${nextSide === 'rear' ? 'sau' : 'trước'} không còn đủ ${uHeight}U trống!`);
      return;
    }
    onAssignDeviceToRackSlot(rack.id, asset.id, availableU, nextSide);
    onChangeSide(nextSide);
    applyCameraPreset(nextSide);
  };

  const statusBadgeClass =
    analysis.status === 'critical'
      ? 'bg-rose-950/95 border-rose-500/70 text-rose-200'
      : analysis.status === 'warning'
        ? 'bg-amber-950/95 border-amber-500/70 text-amber-200'
        : 'bg-emerald-950/95 border-emerald-500/70 text-emerald-200';

  const statusText =
    analysis.status === 'critical'
      ? 'Nguy cơ quá nhiệt'
      : analysis.status === 'warning'
        ? 'Cần tối ưu thông gió'
        : 'Thông gió đạt chuẩn';

  return (
    <div
      className="relative w-full h-full min-h-[460px] rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-slate-950 select-none"
      onDragOver={handleHtmlDragOver}
      onDragLeave={handleHtmlDragLeave}
      onDrop={handleHtmlDrop}
    >
      {webglLost && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 text-white p-5">
          <div className="max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 text-center space-y-2.5">
            <div className="font-bold text-xs">Kết nối WebGL Tủ Rack tạm gián đoạn</div>
            <p className="text-[11px] text-slate-300">
              Nhấn khôi phục để dựng lại mô hình 3D tủ rack của bạn.
            </p>
            <button
              type="button"
              onClick={() => {
                setWebglLost(false);
                setRendererEpoch(n => n + 1);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors"
            >
              Thử khôi phục 3D
            </button>
          </div>
        </div>
      )}
      {/* Isolated WebGL canvas mount point (zero React children inside) */}
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
      />

      {/* Top-Left Compact Ventilation & Airflow Readout (Solid, no backdrop-blur) */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 max-w-[330px] pointer-events-auto">
        <div className="px-3 py-2 rounded-lg bg-slate-900/95 border border-slate-700 text-slate-100 shadow-lg space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold flex items-center gap-1.5 text-sky-300">
              <Wind className="w-3.5 h-3.5" />
              Kiểm Tra Thông Gió 3D
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusBadgeClass}`}>
              {statusText}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
            <div className="px-1.5 py-1 rounded bg-slate-800/95 border border-slate-700/80">
              <div className="text-slate-400">Nhiệt tỏa</div>
              <div className="font-bold text-amber-300">{analysis.totalWatts}W</div>
              <div className="text-[9px] text-slate-400">{analysis.totalBtuPerHour} BTU/h</div>
            </div>
            <div className="px-1.5 py-1 rounded bg-slate-800/95 border border-slate-700/80">
              <div className="text-slate-400">Lưu lượng</div>
              <div
                className={`font-bold ${
                  analysis.airflowCoveragePct < 100 ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                {analysis.effectiveCoolingCfm}/{analysis.requiredCfm}
              </div>
              <div className="text-[9px] text-slate-400">CFM ({analysis.airflowCoveragePct}%)</div>
            </div>
            <div className="px-1.5 py-1 rounded bg-slate-800/95 border border-slate-700/80">
              <div className="text-slate-400">Khí xả</div>
              <div
                className={`font-bold ${
                  analysis.estimatedExhaustTempC >= 36
                    ? 'text-rose-300'
                    : analysis.estimatedExhaustTempC >= 31
                      ? 'text-amber-300'
                      : 'text-sky-300'
                }`}
              >
                {analysis.estimatedExhaustTempC}°C
              </div>
              <div className="text-[9px] text-slate-400">Phòng {analysis.ambientTempC}°C</div>
            </div>
          </div>

          {/* Quick Door & Fan Config */}
          <div className="flex items-center gap-1.5 pt-0.5 text-[10px]">
            <select
              aria-label="Chọn loại cửa tủ ảnh hưởng thông gió"
              value={doorType}
              onChange={e => onChangeDoorType(e.target.value as RackDoorAirflowType)}
              className="flex-1 px-1.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200 outline-none"
            >
              <option value="perforated">Cửa lưới đục lỗ (90% gió)</option>
              <option value="open">Không cửa / Open (100% gió)</option>
              <option value="glass">Cửa kính kín (48% gió)</option>
            </select>
            <select
              aria-label="Chọn số lượng quạt hút đỉnh tủ"
              value={fanCount}
              onChange={e => onChangeFanCount(parseInt(e.target.value, 10))}
              className="px-1.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono outline-none"
            >
              <option value={0}>0 Quạt</option>
              <option value={2}>2 Quạt</option>
              <option value={4}>4 Quạt</option>
              <option value={6}>6 Quạt</option>
            </select>
          </div>
        </div>

        {/* Thermal Legend Strip */}
        {showAirflow && (
          <div className="px-2.5 py-1 rounded-md bg-slate-900/95 border border-slate-700/90 text-[10px] text-slate-300 flex items-center gap-2.5">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-sky-400 inline-block" /> Gió lạnh nạp
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-amber-400 inline-block" /> Khí nóng xả
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-orange-400 inline-block" /> Quẩn khí
            </span>
          </div>
        )}
      </div>

      {/* Top-Center Live Drag & Drop U-Slot Readout */}
      {dropReadout && (
        <div
          className={`absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-lg border font-mono text-xs font-bold shadow-lg pointer-events-none ${
            dropReadout.valid
              ? 'bg-emerald-950/95 border-emerald-400 text-emerald-200'
              : 'bg-rose-950/95 border-rose-400 text-rose-200'
          }`}
        >
          {dropReadout.valid
            ? `Thả "${dropReadout.label}" → Mặt ${dropReadout.side === 'rear' ? 'Sau' : 'Trước'} · ${
                dropReadout.uHeight > 1
                  ? `U${dropReadout.startU}–U${dropReadout.startU + dropReadout.uHeight - 1}`
                  : `U${dropReadout.startU}`
              }`
            : `Vị trí U${dropReadout.startU} (${dropReadout.side === 'rear' ? 'Sau' : 'Trước'}) đã bị chiếm!`}
        </div>
      )}

      {/* Top-Right Selected Mounted Equipment Quick Action Bar */}
      {selectedMountedEntry && (
        <div className="absolute top-3 right-3 z-20 px-3 py-2 rounded-lg bg-slate-900/95 border border-sky-500/60 text-slate-100 shadow-lg max-w-[260px] space-y-1.5 pointer-events-auto">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-xs text-white truncate">
                {selectedMountedEntry.asset.name}
              </div>
              <div className="text-[10px] font-mono text-sky-300">
                {selectedMountedEntry.side === 'rear' ? 'Mặt Sau' : 'Mặt Trước'} ·{' '}
                {selectedMountedEntry.uHeight > 1
                  ? `U${selectedMountedEntry.startU}–U${
                      selectedMountedEntry.startU + selectedMountedEntry.uHeight - 1
                    }`
                  : `U${selectedMountedEntry.startU}`}{' '}
                · {selectedMountedEntry.asset.powerWatts || 0}W
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectAsset(null)}
              className="text-slate-400 hover:text-white text-[10px] px-1"
            >
              Đóng
            </button>
          </div>
          <div className="flex items-center gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => handleNudgeSelectedU('up')}
              className="flex-1 py-1 px-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center justify-center gap-1"
              title="Di chuyển lên 1U"
            >
              <ArrowUp className="w-3 h-3" /> Lên
            </button>
            <button
              type="button"
              onClick={() => handleNudgeSelectedU('down')}
              className="flex-1 py-1 px-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center justify-center gap-1"
              title="Di chuyển xuống 1U"
            >
              <ArrowDown className="w-3 h-3" /> Xuống
            </button>
            <button
              type="button"
              onClick={handleFlipSelectedSide}
              className="flex-1 py-1 px-1.5 rounded bg-blue-700/80 hover:bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center gap-1"
              title="Xoay chuyển gá sang mặt đối diện (Trước ↔ Sau)"
            >
              <ArrowLeftRight className="w-3 h-3" /> Đảo mặt
            </button>
            <button
              type="button"
              onClick={() => {
                onRemoveDeviceFromRackSlot(
                  rack.id,
                  selectedMountedEntry.startU,
                  selectedMountedEntry.side
                );
                onSelectAsset(null);
              }}
              className="py-1 px-1.5 rounded bg-rose-700/80 hover:bg-rose-600 text-white text-[10px]"
              title="Tháo thiết bị khỏi tủ"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Collapsible 3D Rotation & Ventilation Dock (Solid, no backdrop-blur) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center pointer-events-auto max-w-[96%]">
        <button
          type="button"
          onClick={() => setDockCollapsed(v => !v)}
          className="mb-1 px-2.5 py-0.5 rounded-t-md bg-slate-900/95 border border-b-0 border-slate-700 text-[10px] font-semibold text-slate-300 hover:text-white flex items-center gap-1"
        >
          {dockCollapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <span>{dockCollapsed ? 'Mở thanh điều khiển 3D' : 'Thu gọn'}</span>
        </button>

        {!dockCollapsed && (
          <div className="px-2.5 py-1.5 rounded-xl bg-slate-900/95 border border-slate-700 shadow-xl flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
            {/* Camera Rotation Presets */}
            <div className="flex items-center gap-1 pr-2 border-r border-slate-700">
              <button
                type="button"
                onClick={() => applyCameraPreset('front')}
                className={`px-2 py-1 rounded-md font-semibold transition-colors ${
                  activeSide === 'front'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Mặt Trước
              </button>
              <button
                type="button"
                onClick={() => applyCameraPreset('rear')}
                className={`px-2 py-1 rounded-md font-semibold transition-colors ${
                  activeSide === 'rear'
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Mặt Sau
              </button>
              <button
                type="button"
                onClick={() => applyCameraPreset('iso')}
                className="px-2 py-1 rounded-md font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
              >
                Góc 3/4
              </button>
              <button
                type="button"
                onClick={() => applyCameraPreset('top')}
                className="px-2 py-1 rounded-md font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors flex items-center gap-1"
              >
                <Fan className="w-3 h-3 text-sky-400" /> Đỉnh Quạt
              </button>
              <button
                type="button"
                onClick={() => setAutoRotate(v => !v)}
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  autoRotate
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Tự động xoay tủ 360°"
              >
                <RotateCw className="w-3 h-3" /> Xoay 360°
              </button>
            </div>

            {/* Cabinet Inspection & Ventilation Toggles */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setDoorViewMode(m =>
                    m === 'open' ? 'closed' : m === 'closed' ? 'hidden' : 'open'
                  )
                }
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  doorViewMode === 'closed'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
                title="Đổi trạng thái cửa tủ: Mở / Đóng / Ẩn"
              >
                <DoorOpen className="w-3 h-3" />
                {doorViewMode === 'open'
                  ? 'Cửa: Mở'
                  : doorViewMode === 'closed'
                    ? 'Cửa: Đóng'
                    : 'Cửa: Ẩn'}
              </button>
              <button
                type="button"
                onClick={() => setXraySides(v => !v)}
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  xraySides
                    ? 'bg-sky-700 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Làm trong suốt vỏ hông để soi bên trong tủ"
              >
                <Eye className="w-3 h-3" /> X-Ray Vỏ
              </button>
              <button
                type="button"
                onClick={() => setShowAirflow(v => !v)}
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  showAirflow
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Mô phỏng dòng khí nạp lạnh & khí nóng xả"
              >
                <Wind className="w-3 h-3" /> Luồng Gió
              </button>
              <button
                type="button"
                onClick={() => setShowThermal(v => !v)}
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  showThermal
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Hiển thị dải bản đồ nhiệt theo từng U"
              >
                <Flame className="w-3 h-3" /> Nhiệt Độ U
              </button>
              <div className="h-4 w-px bg-slate-700 mx-0.5" />
              <button
                type="button"
                aria-pressed={wireframeMode}
                onClick={() => setWireframeMode(v => !v)}
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  wireframeMode
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Bật/tắt chế độ khung dây (Wireframe)"
              >
                <Grid3x3 className="w-3 h-3" /> Khung dây
              </button>
              <button
                type="button"
                onClick={() =>
                  setRenderQuality(q => (q === 'high' ? 'medium' : q === 'medium' ? 'low' : 'high'))
                }
                className="px-2 py-1 rounded-md font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
                title="Chuyển mức chất lượng kết xuất (Cao / TB / Thấp)"
              >
                CL: {renderQuality === 'high' ? 'Cao' : renderQuality === 'medium' ? 'TB' : 'Thấp'}
              </button>
              <button
                id="rack-3d-shadow-toggle"
                type="button"
                aria-pressed={shadowsEnabled}
                onClick={() => setShadowsEnabled(v => !v)}
                className={`px-2 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                  shadowsEnabled
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Bật/tắt tính toán bóng đổ cho tủ rack 3D"
              >
                <Sun className="w-3 h-3" /> Bóng: {shadowsEnabled ? 'Bật' : 'Tắt'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
