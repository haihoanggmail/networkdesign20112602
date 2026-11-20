import * as THREE from 'three';
import {
  CableEdge,
  CableTray,
  DeviceAsset,
  DiagramNode,
  Floor,
  ProjectState,
  Room,
  ServerRack
} from '../../../types/infrastructure';
import {
  getAssetUHeight,
  isRackMountedTopologyShadowNode,
  layoutRackNodesForElevationMode
} from '../../../utils/rackGeometry';
import {
  getHiddenLayerSet,
  isNodeEffectivelyLocked,
  resolveNodeLayer
} from '../../../utils/layerPolicy';
import {
  cameraRangeMetersToCanvasPx,
  resolveCameraFov,
  resolveWifiCoverage,
  wifiRadiusMetersToCanvasPx
} from '../../../utils/coverageUtils';
import {
  applySceneWireframeMode,
  StudioRenderQuality
} from './studioEnvironment';
import {
  disposeThreeObjectTree,
  ThreeResourceRegistry
} from './resourceRegistry';
import {
  classifyTempRisk,
  computeRackThermalOverlayData,
  getSubDeviceThermalReading,
  RackThermalOverlayData,
  ThermalRiskLevel,
  thermalHeatToColor
} from '../../../utils/rackAirflow';
import type { CADDocument, CADEntity, Point2D } from '../../../cad/core/CADTypes';
import { cadPointToNetworkCanvas } from '../../../cad/core/CADUnderlayTransform';
import {
  IDENTITY_2D,
  Affine2D,
  applyAffine2D,
  buildInsertTransform2D
} from '../../../cad/core/CADTransform';
import {
  tessellateEllipse,
  tessellatePolyline,
  tessellateSpline
} from '../../../cad/geometry/CADCurve';
import { resolveEntityColorHex } from '../../../cad/core/CADColorPalette';
import { isCADLayerVisible } from '../../../cad/core/CADDocument';
import {
  computeCableBundleLayout,
  RectBox
} from '../../../utils/cableRouting';
import {
  LEGACY_WORLD_SCALE,
  CoordinateTransform,
  WorldCoordinateOrigin as EngineeringWorldOrigin,
  buildFloorElevationPlan,
  buildRackLookupIndex,
  computeWorldOriginFromBounds,
  createCoordinateTransform,
  isTopologyShadowMountedInRack,
  projectCableRouteTo3D,
  resolveCableTrayWidthWorld,
  resolveNodeFloorAndElevation,
  resolveNodeFloorId,
  resolveNodePivotCenter,
  resolveRackForDiagramNode,
  resolveRackPhysicalDimensions,
  resolveRoomWorldDimensions,
  rotationDegToThreeYRad
} from '../../../engineering';

export type DetailLodLevel = 'high' | 'medium' | 'low' | 'collapsed';

export const WORLD_SCALE = LEGACY_WORLD_SCALE;

export type WorldCoordinateOrigin = EngineeringWorldOrigin;

export function computeWorldOrigin(
  nodes: DiagramNode[],
  rooms: Room[]
): WorldCoordinateOrigin {
  return computeWorldOriginFromBounds(nodes, rooms);
}

export function canvasToWorldXZ(
  cx: number,
  cy: number,
  origin: WorldCoordinateOrigin
): { x: number; z: number } {
  const transform = createCoordinateTransform({ origin, mode: 'legacy_world_scale' });
  const p = transform.canvasToWorld({ x: cx, y: cy });
  return { x: p.x, z: p.z };
}

export function worldXZToCanvas(
  wx: number,
  wz: number,
  origin: WorldCoordinateOrigin
): { x: number; y: number } {
  const transform = createCoordinateTransform({ origin, mode: 'legacy_world_scale' });
  return transform.worldToCanvas({ x: wx, z: wz });
}

export function computeRackUnitFromWorldY(
  hitWorldY: number,
  rackGroupY: number,
  totalUnits: number,
  isSmallWallRack: boolean
): number {
  const units = Math.max(1, totalUnits);
  const rackH = isSmallWallRack
    ? Math.max(0.88, Math.min(1.22, (units / 12) * 0.98))
    : Math.max(1.8, Math.min(3.15, (units / 42) * 2.65));
  const baseElevationY = isSmallWallRack ? 0.88 : 0;
  const usableH = Math.max(0.2, rackH - 0.16);
  const uStep = usableH / units;
  const localY = hitWorldY - (rackGroupY + baseElevationY) - 0.1;
  return Math.max(1, Math.min(units, Math.floor(localY / uStep) + 1));
}

function tagSelectableSubtree(
  group: THREE.Object3D,
  selectType: 'node' | 'rack',
  selectId: string,
  nodeId: string,
  label: string,
  castShadow: boolean
) {
  group.userData = { ...group.userData, selectType, selectId, nodeId, label };
  group.traverse(child => {
    child.userData = { ...child.userData, selectType, selectId, nodeId, label };
    if (child instanceof THREE.Mesh) {
      if (
        !child.userData.noShadow &&
        child.name !== 'contact_shadow' &&
        child.name !== 'selection_ring' &&
        child.name !== 'locked_indicator_ring'
      ) {
        child.castShadow = castShadow;
        child.receiveShadow = castShadow;
      }
    }
  });
}

function buildSectorPerimeterLine(
  radiusWorld: number,
  angleDeg: number,
  y: number,
  color: number,
  opacity: number,
  segments = 48
): THREE.Line {
  const clampedAngle = Math.max(1, Math.min(360, angleDeg));
  const isFullCircle = clampedAngle >= 359.5;
  const halfRad = ((clampedAngle / 2) * Math.PI) / 180;
  const pts: THREE.Vector3[] = [];
  if (!isFullCircle) {
    pts.push(new THREE.Vector3(0, y, 0));
  }
  const startRad = isFullCircle ? 0 : -halfRad;
  const sweepRad = isFullCircle ? Math.PI * 2 : halfRad * 2;
  for (let i = 0; i <= segments; i++) {
    const rad = startRad + (sweepRad * i) / segments;
    pts.push(new THREE.Vector3(radiusWorld * Math.cos(rad), y, radiusWorld * Math.sin(rad)));
  }
  if (!isFullCircle) {
    pts.push(new THREE.Vector3(0, y, 0));
  }
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity
  });
  const line = new THREE.Line(geom, mat);
  line.userData.excludeWireframe = true;
  line.userData.noShadow = true;
  return line;
}

export type Gizmo3DAction =
  | 'rotate'
  | 'wifi-range'
  | 'wifi-angle'
  | 'camera-range'
  | 'camera-angle';

function buildGizmoSphereHandle(
  name: string,
  color: number,
  x: number,
  y: number,
  z: number,
  gizmoAction: Gizmo3DAction,
  selectType: 'node' | 'rack',
  selectId: string,
  nodeId: string,
  label: string,
  shape: 'sphere' | 'diamond' = 'sphere'
): THREE.Group {
  const handleGrp = new THREE.Group();
  handleGrp.name = name;
  handleGrp.position.set(x, 0, z);

  const stemMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9
  });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, y, 8), stemMat);
  stem.position.y = y / 2;
  stem.userData = { gizmoAction, selectType, selectId, nodeId, label, excludeWireframe: true, noShadow: true };
  handleGrp.add(stem);

  const knobMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.55,
    roughness: 0.25,
    metalness: 0.2
  });
  const knobGeo =
    shape === 'diamond'
      ? new THREE.OctahedronGeometry(0.15, 0)
      : new THREE.SphereGeometry(0.145, 16, 12);
  const knob = new THREE.Mesh(knobGeo, knobMat);
  knob.position.y = y;
  knob.userData = { gizmoAction, selectType, selectId, nodeId, label, excludeWireframe: true, noShadow: true };
  handleGrp.add(knob);

  handleGrp.userData = { gizmoAction, selectType, selectId, nodeId, label, excludeWireframe: true, noShadow: true };
  return handleGrp;
}

export function buildNode3DCoverageAndGizmoOverlay(
  node: DiagramNode,
  asset: DeviceAsset | undefined,
  project: ProjectState,
  options: {
    selectType: 'node' | 'rack';
    selectId: string;
    label: string;
    isSelected: boolean;
    isLocked: boolean;
    interactiveUnlocked: boolean;
    ringRadius: number;
  }
): THREE.Group {
  const overlayRoot = new THREE.Group();
  overlayRoot.name = 'node_coverage_overlay_root';
  overlayRoot.userData = {
    selectType: options.selectType,
    selectId: options.selectId,
    nodeId: node.id,
    label: options.label,
    excludeWireframe: true,
    noShadow: true
  };

  const hiddenLayers = getHiddenLayerSet(project.settings);
  const lockedLayers = project.settings.lockedLayers || [];
  const projectScale = project.settings.scale;

  // 1) Wi-Fi Coverage Overlay (360° or directional sector 30°–360°)
  const wifiCov = node.type !== 'rack' ? resolveWifiCoverage(node, asset) : null;
  const showWifiOverlay = Boolean(
    wifiCov && !hiddenLayers.has('wifi') && project.settings.showCoverageRadius !== false
  );
  if (wifiCov && showWifiOverlay) {
    const wifiWorldRadius = Math.max(
      0.35,
      wifiRadiusMetersToCanvasPx(wifiCov.radiusMeters, projectScale) * WORLD_SCALE
    );
    const halfAngleRad = ((wifiCov.angleDeg / 2) * Math.PI) / 180;
    const isFullCircle = wifiCov.angleDeg >= 359.5;
    const thetaStart = isFullCircle ? 0 : -halfAngleRad;
    const thetaLength = isFullCircle ? Math.PI * 2 : halfAngleRad * 2;

    const wifiGroup = new THREE.Group();
    wifiGroup.name = 'coverage_wifi_group';
    wifiGroup.userData.radiusMeters = wifiCov.radiusMeters;
    wifiGroup.userData.angleDeg = wifiCov.angleDeg;
    wifiGroup.userData.worldRadius = wifiWorldRadius;

    const outerGeo = new THREE.CircleGeometry(wifiWorldRadius, 48, thetaStart, thetaLength);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: options.isSelected ? 0.16 : 0.09,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.rotation.x = -Math.PI / 2;
    outerMesh.position.y = 0.031;
    outerMesh.name = 'coverage_wifi_outer';
    outerMesh.userData.excludeWireframe = true;
    outerMesh.userData.noShadow = true;
    wifiGroup.add(outerMesh);

    const innerGeo = new THREE.CircleGeometry(wifiWorldRadius * 0.55, 40, thetaStart, thetaLength);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x059669,
      transparent: true,
      opacity: options.isSelected ? 0.18 : 0.11,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.rotation.x = -Math.PI / 2;
    innerMesh.position.y = 0.034;
    innerMesh.name = 'coverage_wifi_inner';
    innerMesh.userData.excludeWireframe = true;
    innerMesh.userData.noShadow = true;
    wifiGroup.add(innerMesh);

    const rimLine = buildSectorPerimeterLine(
      wifiWorldRadius,
      wifiCov.angleDeg,
      0.041,
      options.isSelected ? 0x059669 : 0x10b981,
      options.isSelected ? 0.9 : 0.58,
      48
    );
    rimLine.name = 'coverage_wifi_rim';
    wifiGroup.add(rimLine);

    const wifiLocked = options.isLocked || lockedLayers.includes('wifi');
    if (options.isSelected && !wifiLocked && options.interactiveUnlocked) {
      const wifiHandle = buildGizmoSphereHandle(
        'gizmo_wifi_range',
        0x059669,
        wifiWorldRadius,
        0.16,
        0,
        'wifi-range',
        options.selectType,
        options.selectId,
        node.id,
        options.label
      );
      wifiGroup.add(wifiHandle);

      const angleHandleDist = wifiWorldRadius * 0.74;
      const wifiAngleEntries = isFullCircle
        ? [{ id: 'pinch', rad: Math.PI * 0.85 }]
        : [
            { id: 'left', rad: -halfAngleRad },
            { id: 'right', rad: halfAngleRad }
          ];
      for (const ae of wifiAngleEntries) {
        const angHandle = buildGizmoSphereHandle(
          `gizmo_wifi_angle_${ae.id}`,
          0x06b6d4,
          angleHandleDist * Math.cos(ae.rad),
          0.16,
          angleHandleDist * Math.sin(ae.rad),
          'wifi-angle',
          options.selectType,
          options.selectId,
          node.id,
          options.label,
          'diamond'
        );
        wifiGroup.add(angHandle);
      }
    }

    overlayRoot.add(wifiGroup);
  }

  // 2) Camera FOV Ground Sector + Volumetric 3D Frustum Rays (15°–360°)
  const camFov = node.type !== 'rack' ? resolveCameraFov(node, asset) : null;
  const showCamOverlay = Boolean(
    camFov && !hiddenLayers.has('fov') && project.settings.showCoverageRadius !== false
  );
  if (camFov && showCamOverlay) {
    const camWorldRange = Math.max(
      0.45,
      cameraRangeMetersToCanvasPx(camFov.rangeMeters, projectScale) * WORLD_SCALE
    );
    const halfAngleRad = ((camFov.fovAngle / 2) * Math.PI) / 180;
    const isFullCircle = camFov.fovAngle >= 359.5;
    const thetaStart = isFullCircle ? 0 : -halfAngleRad;
    const thetaLength = isFullCircle ? Math.PI * 2 : halfAngleRad * 2;

    const fovGroup = new THREE.Group();
    fovGroup.name = 'coverage_fov_group';
    fovGroup.userData.fovAngle = camFov.fovAngle;
    fovGroup.userData.rangeMeters = camFov.rangeMeters;
    fovGroup.userData.worldRange = camWorldRange;

    const fovGeo = new THREE.CircleGeometry(camWorldRange, 44, thetaStart, thetaLength);
    const fovMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: options.isSelected ? 0.22 : 0.14,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const fovMesh = new THREE.Mesh(fovGeo, fovMat);
    fovMesh.rotation.x = -Math.PI / 2;
    fovMesh.position.y = 0.035;
    fovMesh.name = 'coverage_fov_sector';
    fovMesh.userData.excludeWireframe = true;
    fovMesh.userData.noShadow = true;
    fovGroup.add(fovMesh);

    const fovRim = buildSectorPerimeterLine(
      camWorldRange,
      camFov.fovAngle,
      0.043,
      options.isSelected ? 0xd97706 : 0xf59e0b,
      options.isSelected ? 0.92 : 0.68,
      44
    );
    fovRim.name = 'coverage_fov_rim';
    fovGroup.add(fovRim);

    // 3D volumetric ray lines from camera lens (0.26, 0.49, 0) down to ground FOV boundaries
    const lensOrigin = new THREE.Vector3(0.26, 0.49, 0);
    const rayAngles = isFullCircle
      ? [0, Math.PI / 2, Math.PI, -Math.PI / 2]
      : [-halfAngleRad, 0, halfAngleRad];
    const rayPts: THREE.Vector3[] = [];
    for (const a of rayAngles) {
      rayPts.push(lensOrigin);
      rayPts.push(new THREE.Vector3(camWorldRange * Math.cos(a), 0.043, camWorldRange * Math.sin(a)));
    }
    const rayGeo = new THREE.BufferGeometry().setFromPoints(rayPts);
    const rayMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: options.isSelected ? 0.65 : 0.35
    });
    const rayLines = new THREE.LineSegments(rayGeo, rayMat);
    rayLines.name = 'coverage_fov_rays';
    rayLines.userData.excludeWireframe = true;
    rayLines.userData.noShadow = true;
    fovGroup.add(rayLines);

    const fovLocked = options.isLocked || lockedLayers.includes('fov');
    if (options.isSelected && !fovLocked && options.interactiveUnlocked) {
      const fovHandle = buildGizmoSphereHandle(
        'gizmo_camera_range',
        0xd97706,
        camWorldRange,
        0.16,
        0,
        'camera-range',
        options.selectType,
        options.selectId,
        node.id,
        options.label
      );
      fovGroup.add(fovHandle);

      const fovAngDist = camWorldRange * 0.72;
      const camAngleEntries = isFullCircle
        ? [{ id: 'pinch', rad: Math.PI * 0.88 }]
        : [
            { id: 'left', rad: -halfAngleRad },
            { id: 'right', rad: halfAngleRad }
          ];
      for (const ae of camAngleEntries) {
        const fovAngleHandle = buildGizmoSphereHandle(
          `gizmo_camera_angle_${ae.id}`,
          0xf59e0b,
          fovAngDist * Math.cos(ae.rad),
          0.16,
          fovAngDist * Math.sin(ae.rad),
          'camera-angle',
          options.selectType,
          options.selectId,
          node.id,
          options.label,
          'diamond'
        );
        fovGroup.add(fovAngleHandle);
      }
    }

    overlayRoot.add(fovGroup);
  }

  // 3) 3D Rotation Gizmo Ring + Cyan Knob along local +X when selected & unlocked
  if (options.isSelected && !options.isLocked && options.interactiveUnlocked) {
    const gizmoRadius = Math.max(1.08, options.ringRadius + 0.25);
    const rotRingGeo = new THREE.RingGeometry(gizmoRadius - 0.025, gizmoRadius + 0.025, 48);
    const rotRingMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
    const rotRing = new THREE.Mesh(rotRingGeo, rotRingMat);
    rotRing.rotation.x = -Math.PI / 2;
    rotRing.position.y = 0.036;
    rotRing.name = 'gizmo_rotate_ring';
    rotRing.userData.excludeWireframe = true;
    rotRing.userData.noShadow = true;
    overlayRoot.add(rotRing);

    const pointerShaftGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(options.ringRadius * 0.72, 0.045, 0),
      new THREE.Vector3(gizmoRadius, 0.045, 0)
    ]);
    const pointerShaftMat = new THREE.LineBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.9
    });
    const pointerShaft = new THREE.Line(pointerShaftGeo, pointerShaftMat);
    pointerShaft.name = 'gizmo_rotate_pointer';
    pointerShaft.userData.excludeWireframe = true;
    pointerShaft.userData.noShadow = true;
    overlayRoot.add(pointerShaft);

    const rotKnob = buildGizmoSphereHandle(
      'gizmo_rotate_knob',
      0x06b6d4,
      gizmoRadius,
      0.16,
      0,
      'rotate',
      options.selectType,
      options.selectId,
      node.id,
      options.label
    );
    overlayRoot.add(rotKnob);
  }

  overlayRoot.traverse(child => {
    child.userData = {
      ...child.userData,
      selectType: child.userData.selectType || options.selectType,
      selectId: child.userData.selectId || options.selectId,
      nodeId: child.userData.nodeId || node.id,
      label: child.userData.label || options.label,
      excludeWireframe: true,
      noShadow: true
    };
  });

  return overlayRoot;
}

export function refreshNode3DCoverageAndGizmos(
  group: THREE.Group,
  node: DiagramNode,
  asset: DeviceAsset | undefined,
  project: ProjectState,
  options: {
    isSelected: boolean;
    isLocked: boolean;
    interactiveUnlocked: boolean;
  }
) {
  const existing = group.getObjectByName('node_coverage_overlay_root');
  if (existing) {
    group.remove(existing);
    disposeObjectTree(existing);
  }
  const selectType: 'node' | 'rack' = node.type === 'rack' ? 'rack' : 'node';
  const selectId = String(group.userData.selectId || node.id);
  const label = String(group.userData.label || asset?.name || node.label);
  const ringRadius = node.type === 'rack' ? 0.92 : 0.85;
  const nextOverlay = buildNode3DCoverageAndGizmoOverlay(node, asset, project, {
    selectType,
    selectId,
    label,
    isSelected: options.isSelected,
    isLocked: options.isLocked,
    interactiveUnlocked: options.interactiveUnlocked,
    ringRadius
  });
  group.add(nextOverlay);
}

function createRackThermalCurtainTexture(
  thermalData: RackThermalOverlayData,
  units: number
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
  const maxU = Math.max(1, units);

  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const u = Math.max(1, Math.min(maxU, Math.round(1 + t * (maxU - 1))));
    const reading = thermalData.unitReadings.find(r => r.u === u);
    const heatNorm = reading ? reading.heatNorm : 0.25;
    const zone = reading ? reading.zone : 'nominal';
    grad.addColorStop(t, thermalHeatToColor(heatNorm, zone));
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Horizontal U-band micro striations for technical clarity
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  for (let u = 1; u <= maxU; u += 2) {
    const y = canvas.height * (1 - u / maxU);
    ctx.fillRect(0, y, canvas.width, 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createRackTempBadgeSprite(
  label: string,
  tempC: number,
  zone: ThermalRiskLevel
): THREE.Sprite | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 68;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const badgeBg =
    zone === 'hot'
      ? 'rgba(153, 27, 27, 0.94)'
      : zone === 'warm'
      ? 'rgba(146, 64, 14, 0.94)'
      : zone === 'cool'
      ? 'rgba(12, 74, 110, 0.94)'
      : 'rgba(6, 78, 59, 0.94)';
  const accent =
    zone === 'hot'
      ? '#f87171'
      : zone === 'warm'
      ? '#fbbf24'
      : zone === 'cool'
      ? '#38bdf8'
      : '#34d399';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = badgeBg;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(24, 34, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.slice(0, 12), 40, 24);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 24px monospace';
  ctx.fillText(`${tempC.toFixed(1)}°C`, 40, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.86, 0.23, 1);
  sprite.renderOrder = 22;
  sprite.userData.excludeWireframe = true;
  sprite.userData.noShadow = true;
  return sprite;
}

function addContactShadow(
  parent: THREE.Group,
  width: number,
  depth: number,
  shadowTex: THREE.Texture
) {
  const mat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.45, depth * 1.45), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.008;
  mesh.name = 'contact_shadow';
  parent.add(mesh);
}

function addSelectionRing(parent: THREE.Group, radius: number, isLocked = false) {
  const ringGeo = new THREE.RingGeometry(radius, radius + 0.09, 40);
  const ringMat = new THREE.MeshBasicMaterial({
    color: isLocked ? 0xf59e0b : 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.024;
  ring.name = 'selection_ring';
  parent.add(ring);
}

function addLockedVisualEffect(
  parent: THREE.Group,
  radius: number,
  boxW: number,
  boxH: number,
  boxD: number,
  lockBadgeTex?: THREE.Texture
) {
  // 1. Bright amber floor rim collar
  const ringGeo = new THREE.RingGeometry(radius * 0.84, radius * 0.94, 36);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.018;
  ring.name = 'locked_indicator_ring';
  parent.add(ring);

  // 2. Luminous amber wireframe outline frame around the locked object
  const frameBoxGeo = new THREE.BoxGeometry(boxW + 0.14, Math.max(0.28, boxH + 0.08), boxD + 0.14);
  const edgesGeo = new THREE.EdgesGeometry(frameBoxGeo);
  frameBoxGeo.dispose();
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.92
  });
  const rimFrame = new THREE.LineSegments(edgesGeo, edgesMat);
  rimFrame.position.y = Math.max(0.16, boxH / 2 + 0.04);
  rimFrame.name = 'locked_rim_frame';
  parent.add(rimFrame);

  // 3. Floating 3D padlock icon sprite directly above locked device/rack
  if (lockBadgeTex) {
    const spriteMat = new THREE.SpriteMaterial({
      map: lockBadgeTex,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.46, 0.46, 0.46);
    sprite.position.set(0, boxH + 0.42, 0);
    sprite.renderOrder = 18;
    sprite.name = 'locked_padlock_sprite';
    parent.add(sprite);
  }
}

/**
 * Builds a composite 3D Server Rack (wall-mounted 12U compact cabinet or full 42U Main Rack) with live U-mounted blades.
 */
function buildRackGroup(
  node: DiagramNode,
  rack: ServerRack | undefined,
  assets: Record<string, DeviceAsset>,
  isSelected: boolean,
  isLocked: boolean,
  castShadow: boolean,
  shadowTex: THREE.Texture,
  lockBadgeTex?: THREE.Texture,
  isFloorplanWallMount = false,
  detailLevel: DetailLodLevel = 'high',
  showThermalHeatmap = true
): THREE.Group {
  const group = new THREE.Group();
  const isCollapsed = detailLevel === 'collapsed' || Boolean(node.customData?.collapsed);
  const isReducedDetail = isCollapsed || detailLevel === 'low';
  const effectiveLod: DetailLodLevel = isCollapsed ? 'collapsed' : detailLevel;
  group.userData.rackCollapsed = isCollapsed;
  group.userData.lodLevel = effectiveLod;
  const thermalData = computeRackThermalOverlayData(rack, assets, node);
  const peakZone = classifyTempRisk(thermalData.peakTempC);
  group.userData.thermalPeakTempC = thermalData.peakTempC;
  group.userData.thermalHasHardwareSensors = thermalData.hasHardwareSensors;

  const units = rack?.totalUnits || node.customData?.totalUnits || 42;
  const isSmallWallRack = isFloorplanWallMount && units <= 18;
  const rackH = isSmallWallRack
    ? Math.max(0.88, Math.min(1.22, (units / 12) * 0.98))
    : Math.max(1.8, Math.min(3.15, (units / 42) * 2.65));
  const physicalDims = resolveRackPhysicalDimensions({
    totalUnits: units,
    widthMm: rack?.widthMm ?? (isSmallWallRack ? 600 : 800),
    depthMm: rack?.depthMm ?? (isSmallWallRack ? 500 : 1000)
  });
  // Scale physical cabinet width/depth meters harmoniously into the 3D scene while reflecting rack specs
  const rackW = isSmallWallRack
    ? Math.max(0.68, Number((physicalDims.widthMeters * 1.48).toFixed(3)))
    : Math.max(0.75, Number((physicalDims.widthMeters * 1.5).toFixed(3)));
  const rackD = isSmallWallRack
    ? Math.max(0.54, Number((physicalDims.depthMeters * 1.24).toFixed(3)))
    : Math.max(0.68, Number((physicalDims.depthMeters * 1.24).toFixed(3)));
  const baseElevationY = isSmallWallRack ? 0.88 : 0;

  const cabinetBody = new THREE.Group();
  cabinetBody.position.y = baseElevationY;
  group.add(cabinetBody);

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.42,
    metalness: 0.72
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.55,
    metalness: 0.65
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.3,
    metalness: 0.85
  });
  const blueHarnessMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.4,
    metalness: 0.35
  });

  if (isSmallWallRack) {
    // Wall-mount backplate bracket
    const wallBracket = new THREE.Mesh(
      new THREE.BoxGeometry(rackW + 0.14, rackH + 0.12, 0.05),
      railMat
    );
    wallBracket.position.set(0, rackH / 2 + 0.04, -rackD / 2 - 0.02);
    cabinetBody.add(wallBracket);

    if (!isCollapsed) {
      // Side blue cable bundle cuff exiting right toward vertical Riser shaft
      const cableCuff = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.24, 0.22),
        blueHarnessMat
      );
      cableCuff.position.set(rackW / 2 + 0.05, rackH * 0.28, -0.05);
      cabinetBody.add(cableCuff);
    }
  } else {
    // 1. Base plinth for floor-standing racks (42U Main Rack)
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(rackW, 0.08, rackD), darkMetalMat);
    plinth.position.y = 0.06;
    cabinetBody.add(plinth);

    if (!isReducedDetail) {
      const footGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.05, 12);
      const fx = rackW * 0.42;
      const fz = rackD * 0.42;
      for (const [sx, sz] of [
        [-fx, -fz],
        [fx, -fz],
        [-fx, fz],
        [fx, fz]
      ]) {
        const foot = new THREE.Mesh(footGeo, railMat);
        foot.position.set(sx, 0.025, sz);
        cabinetBody.add(foot);
      }

      // Dual top cooling fan circles on canopy
      const fanMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.35,
        metalness: 0.78
      });
      for (const fanX of [-rackW * 0.22, rackW * 0.22]) {
        const fanRing = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 18), fanMat);
        fanRing.position.set(fanX, rackH + 0.115, 0);
        cabinetBody.add(fanRing);
      }

      // Vertical blue cable trunk harness on right side of Main Rack
      const verticalHarness = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, rackH * 0.86, 0.18),
        blueHarnessMat
      );
      verticalHarness.position.set(rackW / 2 + 0.04, rackH * 0.48, -0.14);
      cabinetBody.add(verticalHarness);
    }
  }

  // Bottom floor plate (especially visible for wall-mounted rack)
  const bottomPlate = new THREE.Mesh(new THREE.BoxGeometry(rackW, 0.06, rackD), frameMat);
  bottomPlate.position.y = 0.04;
  cabinetBody.add(bottomPlate);

  // Top fan canopy
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(rackW, 0.09, rackD), frameMat);
  canopy.position.y = rackH + 0.05;
  cabinetBody.add(canopy);

  // Corner structural posts
  const postGeo = new THREE.BoxGeometry(0.065, rackH, 0.065);
  for (const [px, pz] of [
    [-rackW / 2 + 0.035, -rackD / 2 + 0.035],
    [rackW / 2 - 0.035, -rackD / 2 + 0.035],
    [-rackW / 2 + 0.035, rackD / 2 - 0.035],
    [rackW / 2 - 0.035, rackD / 2 - 0.035]
  ]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(px, rackH / 2 + 0.05, pz);
    cabinetBody.add(post);
  }

  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(rackW - 0.08, rackH - 0.08, 0.04), darkMetalMat);
  backPanel.position.set(0, rackH / 2 + 0.05, -rackD / 2 + 0.03);
  cabinetBody.add(backPanel);

  if (!isReducedDetail) {
    // Subtle smoked glass side/front trim frame
    const glassTrimMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.18,
      metalness: 0.25,
      transparent: true,
      opacity: 0.16
    });
    const frontGlass = new THREE.Mesh(
      new THREE.BoxGeometry(rackW - 0.18, rackH - 0.14, 0.02),
      glassTrimMat
    );
    frontGlass.position.set(0, rackH / 2 + 0.05, rackD / 2 - 0.03);
    cabinetBody.add(frontGlass);
  }

  if (!isCollapsed) {
    // Front vertical mounting rails
    const railGeo = new THREE.BoxGeometry(0.035, rackH - 0.12, 0.035);
    for (const rx of [-rackW / 2 + 0.11, rackW / 2 - 0.11]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(rx, rackH / 2 + 0.05, rackD / 2 - 0.11);
      cabinetBody.add(rail);
    }
  }

  // Mounted U blades populated from rack.slots (front) & rack.rearSlots (rear)
  const usableH = rackH - 0.16;
  const uStep = usableH / units;
  const frontSlots = rack?.slots || {};
  const rearSlots = rack?.rearSlots || {};
  const hasRearSlots = Object.keys(rearSlots).length > 0;
  const sharedCollapsedLedMat = isCollapsed
    ? null
    : new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x22c55e,
        emissiveIntensity: 0.9,
        roughness: 0.3
      });

  const addSideBlades = (sideMap: Record<string, string>, side: 'front' | 'rear') => {
    for (const [uStr, assetId] of Object.entries(sideMap)) {
      const startU = parseInt(uStr, 10);
      const asset = assets[assetId];
      if (!asset || Number.isNaN(startU)) continue;
      const uH = getAssetUHeight(asset);
      const bladeH = Math.max(0.038, uH * uStep * 0.88);
      const bladeY = 0.1 + (startU - 1 + uH / 2) * uStep;

      const bladeColor =
        asset.category === 'ups'
          ? 0xd97706
          : asset.category === 'switch' || asset.category === 'core_switch'
          ? 0x0284c7
          : asset.category === 'router' || asset.category === 'firewall'
          ? 0x0ea5e9
          : asset.category === 'patch_panel' || asset.category === 'odf'
          ? 0x64748b
          : 0x334155;

      const bladeDepth = hasRearSlots
        ? rackD * (isCollapsed ? 0.34 : 0.38)
        : rackD * (isCollapsed ? 0.58 : 0.68);
      const bladeZ =
        side === 'rear'
          ? -rackD * 0.2
          : hasRearSlots
          ? rackD * 0.16
          : 0.02;

      const bladeMat = new THREE.MeshStandardMaterial({
        color: bladeColor,
        roughness: isCollapsed ? 0.52 : 0.36,
        metalness: isCollapsed ? 0.3 : 0.58
      });
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(rackW - 0.22, bladeH, bladeDepth),
        bladeMat
      );
      const bladeThermal = getSubDeviceThermalReading(thermalData, startU, uH);
      blade.position.set(0, bladeY, bladeZ);
      blade.name = isCollapsed ? 'subdevice_proxy_lod' : 'subdevice_blade';
      blade.userData.subDeviceLod = effectiveLod;
      blade.userData.subDeviceAssetId = asset.id;
      blade.userData.subDeviceRackId = rack?.id || node.id;
      blade.userData.subDeviceStartU = startU;
      blade.userData.subDeviceUHeight = uH;
      blade.userData.subDeviceSide = side;
      blade.userData.subDeviceTempC = bladeThermal.tempC;
      blade.userData.subDeviceZone = bladeThermal.zone;
      blade.userData.subDeviceHeatBtu = Math.round((asset.powerWatts || 0) * 3.41214);
      cabinetBody.add(blade);

      // Omit per-device LED indicator sub-meshes when rack is collapsed or quality is low
      if (!isReducedDetail && sharedCollapsedLedMat && side === 'front') {
        const led = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, Math.min(0.022, bladeH * 0.42), 0.02),
          sharedCollapsedLedMat
        );
        led.position.set(-rackW * 0.28, bladeY, rackD * 0.36);
        led.name = 'subdevice_led';
        cabinetBody.add(led);
      }
    }
  };

  addSideBlades(frontSlots, 'front');
  if (hasRearSlots) {
    addSideBlades(rearSlots, 'rear');
  }

  // 3D Thermal Heatmap Overlay (translucent U-thermal gradient curtains + sensor temperature sprites)
  const shouldRenderNodeThermal =
    showThermalHeatmap && node.customData?.showThermalOverlay !== false;
  if (shouldRenderNodeThermal) {
    const thermalGroup = new THREE.Group();
    thermalGroup.name = 'thermal_heatmap_overlay';
    thermalGroup.userData.excludeWireframe = true;
    thermalGroup.userData.noShadow = true;
    thermalGroup.userData.sensorCount = thermalData.sensors.length;
    thermalGroup.userData.peakTempC = thermalData.peakTempC;

    const curtainTex = createRackThermalCurtainTexture(thermalData, units);
    const curtainMat = new THREE.MeshBasicMaterial({
      ...(curtainTex ? { map: curtainTex } : {}),
      color: curtainTex ? 0xffffff : peakZone === 'hot' ? 0xef4444 : 0x0ea5e9,
      transparent: true,
      opacity: isCollapsed ? 0.26 : 0.32,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // Side right thermal heatmap fin/curtain + front thin wash
    const rightCurtain = new THREE.Mesh(
      new THREE.PlaneGeometry(rackD * 0.88, usableH),
      curtainMat
    );
    rightCurtain.rotation.y = Math.PI / 2;
    rightCurtain.position.set(rackW / 2 + 0.045, 0.1 + usableH / 2, 0);
    rightCurtain.name = 'thermal_curtain_right';
    rightCurtain.userData.excludeWireframe = true;
    rightCurtain.userData.noShadow = true;
    thermalGroup.add(rightCurtain);

    if (!isCollapsed) {
      const frontCurtain = new THREE.Mesh(
        new THREE.PlaneGeometry(rackW - 0.16, usableH),
        curtainMat
      );
      frontCurtain.position.set(0, 0.1 + usableH / 2, rackD / 2 + 0.032);
      frontCurtain.name = 'thermal_curtain_front';
      frontCurtain.userData.excludeWireframe = true;
      frontCurtain.userData.noShadow = true;
      thermalGroup.add(frontCurtain);

      // Individual rack sensor probe spheres + floating temperature sprites
      thermalData.sensors.forEach((sensor, idx) => {
        const uVal = sensor.u ?? Math.round((idx + 0.5) * (units / Math.max(1, thermalData.sensors.length)));
        const clampedU = Math.max(1, Math.min(units, uVal));
        const probeY = 0.1 + (clampedU - 0.5) * uStep;
        const probeColor =
          sensor.status === 'hot'
            ? 0xef4444
            : sensor.status === 'warm'
            ? 0xf59e0b
            : sensor.status === 'cool'
            ? 0x0ea5e9
            : 0x10b981;

        const probeMat = new THREE.MeshStandardMaterial({
          color: probeColor,
          emissive: probeColor,
          emissiveIntensity: 0.75,
          roughness: 0.25
        });
        const probeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10), probeMat);
        probeSphere.position.set(rackW / 2 + 0.075, probeY, idx % 2 === 0 ? 0.16 : -0.16);
        probeSphere.name = 'thermal_sensor_probe';
        probeSphere.userData.excludeWireframe = true;
        probeSphere.userData.noShadow = true;
        thermalGroup.add(probeSphere);

        const badge = createRackTempBadgeSprite(sensor.label, sensor.temperatureC, sensor.status);
        if (badge) {
          badge.position.set(rackW / 2 + 0.56, probeY, idx % 2 === 0 ? 0.16 : -0.16);
          badge.name = 'thermal_sensor_sprite';
          thermalGroup.add(badge);
        }
      });
    } else {
      // Collapsed LOD: single peak sensor temperature sprite above canopy
      const peakSprite = createRackTempBadgeSprite('Đỉnh nhiệt', thermalData.peakTempC, peakZone);
      if (peakSprite) {
        peakSprite.position.set(0, rackH + 0.34, 0);
        peakSprite.name = 'thermal_collapsed_peak_sprite';
        thermalGroup.add(peakSprite);
      }
    }

    cabinetBody.add(thermalGroup);
  }

  if (!isSmallWallRack) {
    addContactShadow(group, rackW, rackD, shadowTex);
  }
  const totalBoxH = baseElevationY + rackH + 0.12;
  if (isLocked) {
    addLockedVisualEffect(group, 0.92, rackW, totalBoxH, rackD, lockBadgeTex);
  }
  if (isSelected) {
    addSelectionRing(group, 0.92, isLocked);
  }

  tagSelectableSubtree(group, 'rack', rack?.id || node.id, node.id, rack?.name || node.label, castShadow);
  return group;
}

function createTerminalUiTexture(kind: 'workstation' | 'attendance'): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (kind === 'workstation') {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 192, 128);
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(0, 0, 192, 22);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(12, 34, 72, 40);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(94, 34, 86, 80);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(104, 46, 62, 10);
      ctx.fillRect(104, 66, 48, 10);
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(12, 84, 72, 30);
    } else {
      // Biometric Time Attendance screen
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 192, 128);
      ctx.fillStyle = '#059669';
      ctx.fillRect(0, 0, 192, 24);
      // Fingerprint ring icon
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      for (const r of [14, 24, 34]) {
        ctx.beginPath();
        ctx.arc(54, 74, r, 0.2, Math.PI * 1.8);
        ctx.stroke();
      }
      // UI tiles
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(108, 36, 32, 26);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(148, 36, 32, 26);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(108, 72, 32, 26);
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(148, 72, 32, 26);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface WorldDeviceResourcePool {
  darkSlateMat: THREE.MeshStandardMaterial;
  brushedSteelMat: THREE.MeshStandardMaterial;
  ledGreenMat: THREE.MeshStandardMaterial;
  chassisMats: Map<string, THREE.MeshStandardMaterial>;
  terminalUiTextures: Partial<Record<'workstation' | 'attendance', THREE.CanvasTexture | null>>;
}

function createWorldDeviceResourcePool(): WorldDeviceResourcePool {
  return {
    darkSlateMat: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.62
    }),
    brushedSteelMat: new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.28,
      metalness: 0.82
    }),
    ledGreenMat: new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x22c55e,
      emissiveIntensity: 0.95,
      roughness: 0.25
    }),
    chassisMats: new Map(),
    terminalUiTextures: {}
  };
}

/**
 * Builds composite 3–10 part procedural 3D models for every network/electrical node category.
 */
function buildDeviceGroup(
  node: DiagramNode,
  asset: DeviceAsset | undefined,
  isSelected: boolean,
  isLocked: boolean,
  castShadow: boolean,
  shadowTex: THREE.Texture,
  lockBadgeTex?: THREE.Texture,
  pool?: WorldDeviceResourcePool
): THREE.Group {
  const rootGroup = new THREE.Group();
  const group = new THREE.Group();
  group.name = 'visual_mirror_group';
  rootGroup.add(group);
  const category = String(asset?.category || node.type);
  const labelLower = String(asset?.name || node.label || '').toLowerCase();
  const isAttendance =
    category === 'iot' || /chấm công|attendance|speedface/.test(labelLower);
  const isRiser =
    category === 'riser' || category === 'telecom_tower' || node.type === 'riser';

  const accentHex = node.style?.backgroundColor || '#1d4ed8';
  let chassisMat = pool?.chassisMats.get(accentHex);
  if (!chassisMat) {
    chassisMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.38,
      metalness: 0.52
    });
    pool?.chassisMats.set(accentHex, chassisMat);
  }
  const darkSlateMat =
    pool?.darkSlateMat ||
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.62
    });
  const brushedSteelMat =
    pool?.brushedSteelMat ||
    new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.28,
      metalness: 0.82
    });
  const ledGreenMat =
    pool?.ledGreenMat ||
    new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x22c55e,
      emissiveIntensity: 0.95,
      roughness: 0.25
    });

  if (category === 'workstation') {
    // Composite Office Workstation: desk + 4 legs + dual monitor + PC tower + office chair
    const deskMat = new THREE.MeshStandardMaterial({
      color: 0xe2d5c1,
      roughness: 0.62,
      metalness: 0.08
    });
    const chairMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.72,
      metalness: 0.15
    });

    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.055, 0.72), deskMat);
    deskTop.position.set(0, 0.62, 0);
    group.add(deskTop);

    const legGeo = new THREE.BoxGeometry(0.045, 0.6, 0.045);
    for (const [lx, lz] of [
      [-0.56, -0.28],
      [0.56, -0.28],
      [-0.56, 0.28],
      [0.56, 0.28]
    ]) {
      const leg = new THREE.Mesh(legGeo, brushedSteelMat);
      leg.position.set(lx, 0.3, lz);
      group.add(leg);
    }

    // Monitor stand + widescreen display
    const monStand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.08), darkSlateMat);
    monStand.position.set(-0.08, 0.73, -0.14);
    group.add(monStand);

    const monFrame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.4, 0.04), darkSlateMat);
    monFrame.position.set(-0.08, 0.94, -0.14);
    group.add(monFrame);

    let monScreenTex: THREE.CanvasTexture | null;
    if (pool && 'workstation' in pool.terminalUiTextures) {
      monScreenTex = pool.terminalUiTextures.workstation ?? null;
    } else {
      monScreenTex = createTerminalUiTexture('workstation');
      if (pool) pool.terminalUiTextures.workstation = monScreenTex;
    }
    const monScreenMat = new THREE.MeshStandardMaterial({
      color: monScreenTex ? 0xffffff : 0x0ea5e9,
      ...(monScreenTex ? { map: monScreenTex, emissiveMap: monScreenTex } : {}),
      emissive: new THREE.Color(monScreenTex ? 0xffffff : 0x0284c7),
      emissiveIntensity: 0.42,
      roughness: 0.22
    });
    const monScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.34), monScreenMat);
    monScreen.position.set(-0.08, 0.94, -0.118);
    group.add(monScreen);

    // Desktop PC tower
    const pcTower = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44, 0.44), darkSlateMat);
    pcTower.position.set(0.44, 0.86, -0.05);
    group.add(pcTower);

    const pcLed = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.02), ledGreenMat);
    pcLed.position.set(0.44, 0.98, 0.175);
    group.add(pcLed);

    // Ergonomic office chair
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), chairMat);
    chairSeat.position.set(-0.08, 0.42, 0.42);
    group.add(chairSeat);

    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.06), chairMat);
    chairBack.position.set(-0.08, 0.65, 0.61);
    group.add(chairBack);

    const chairStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.38, 10), brushedSteelMat);
    chairStem.position.set(-0.08, 0.22, 0.42);
    group.add(chairStem);

    addContactShadow(group, 1.35, 1.15, shadowTex);
  } else if (isAttendance) {
    // Biometric Time Attendance Terminal ("Máy Chấm Công")
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.05, 0.14), brushedSteelMat);
    pedestal.position.set(0, 0.525, -0.04);
    group.add(pedestal);

    const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.36), darkSlateMat);
    basePlate.position.set(0, 0.025, 0);
    group.add(basePlate);

    const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 0.12), darkSlateMat);
    headBox.position.set(0, 1.15, 0.02);
    group.add(headBox);

    const trimBezel = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.41, 0.04), chassisMat);
    trimBezel.position.set(0, 1.15, -0.02);
    group.add(trimBezel);

    let uiTex: THREE.CanvasTexture | null;
    if (pool && 'attendance' in pool.terminalUiTextures) {
      uiTex = pool.terminalUiTextures.attendance ?? null;
    } else {
      uiTex = createTerminalUiTexture('attendance');
      if (pool) pool.terminalUiTextures.attendance = uiTex;
    }
    const uiMat = new THREE.MeshStandardMaterial({
      color: uiTex ? 0xffffff : 0x10b981,
      ...(uiTex ? { map: uiTex, emissiveMap: uiTex } : {}),
      emissive: new THREE.Color(uiTex ? 0xffffff : 0x059669),
      emissiveIntensity: 0.55,
      roughness: 0.2
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.31), uiMat);
    screen.position.set(0, 1.15, 0.082);
    group.add(screen);

    addContactShadow(group, 0.58, 0.52, shadowTex);
  } else if (isRiser) {
    // Vertical Riser Trunk Collar / Splice Hub
    const blueTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.34,
      metalness: 0.45
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.08, 0.5), darkSlateMat);
    plinth.position.y = 0.04;
    group.add(plinth);

    const hubBox = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.88, 0.4), blueTrunkMat);
    hubBox.position.y = 0.48;
    group.add(hubBox);

    const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.25, 12);
    for (const px of [-0.11, 0.11]) {
      const pipe = new THREE.Mesh(pipeGeo, brushedSteelMat);
      pipe.position.set(px, 0.66, 0);
      group.add(pipe);
    }

    const statusLed = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.03), ledGreenMat);
    statusLed.position.set(0, 0.72, 0.21);
    group.add(statusLed);

    addContactShadow(group, 0.66, 0.62, shadowTex);
  } else if (category === 'switch' || category === 'core_switch' || category === 'patch_panel' || category === 'odf') {
    const w = 1.28;
    const h = category === 'core_switch' ? 0.38 : 0.24;
    const d = 0.72;

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkSlateMat);
    body.position.y = h / 2 + 0.04;
    group.add(body);

    const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h * 0.78, 0.06), chassisMat);
    bezel.position.set(0, h / 2 + 0.04, d / 2 + 0.02);
    group.add(bezel);

    const earGeo = new THREE.BoxGeometry(0.08, h * 0.9, 0.04);
    for (const ex of [-w / 2 - 0.04, w / 2 + 0.04]) {
      const ear = new THREE.Mesh(earGeo, brushedSteelMat);
      ear.position.set(ex, h / 2 + 0.04, d / 2 - 0.02);
      group.add(ear);
    }

    const portBank = new THREE.Mesh(new THREE.BoxGeometry(w * 0.74, h * 0.42, 0.04), brushedSteelMat);
    portBank.position.set(-0.06, h / 2 + 0.04, d / 2 + 0.045);
    group.add(portBank);

    const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), ledGreenMat);
    ledStrip.position.set(w * 0.36, h / 2 + 0.04, d / 2 + 0.05);
    group.add(ledStrip);

    const vent = new THREE.Mesh(new THREE.BoxGeometry(w * 0.68, 0.02, d * 0.48), brushedSteelMat);
    vent.position.set(0, h + 0.045, -0.04);
    group.add(vent);

    addContactShadow(group, w, d, shadowTex);
  } else if (category === 'router' || category === 'gateway' || category === 'firewall') {
    const w = 0.98;
    const h = 0.28;
    const d = 0.76;

    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), darkSlateMat);
    base.position.y = 0.025;
    group.add(base);

    const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, h, d * 0.92), chassisMat);
    body.position.y = h / 2 + 0.05;
    group.add(body);

    const heatsink = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.04, d * 0.65), darkSlateMat);
    heatsink.position.y = h + 0.06;
    group.add(heatsink);

    const mastGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.56, 10);
    for (const ax of [-w * 0.36, w * 0.36]) {
      const mast = new THREE.Mesh(mastGeo, darkSlateMat);
      mast.position.set(ax, h + 0.26, -d * 0.34);
      group.add(mast);
    }

    const fascia = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75, h * 0.45, 0.04), brushedSteelMat);
    fascia.position.set(0, h / 2 + 0.05, d * 0.46);
    group.add(fascia);

    const statusLed = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.03), ledGreenMat);
    statusLed.position.set(w * 0.25, h * 0.75, d * 0.47);
    group.add(statusLed);

    addContactShadow(group, w, d, shadowTex);
  } else if (category === 'ups' || category === 'pdu' || category === 'electrical_panel') {
    const w = 0.78;
    const h = 0.88;
    const d = 0.92;

    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.07, d + 0.06), darkSlateMat);
    base.position.y = 0.035;
    group.add(base);

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), darkSlateMat);
    body.position.y = h / 2 + 0.07;
    group.add(body);

    const frontCap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, h * 0.36, 0.06), brushedSteelMat);
    frontCap.position.set(0, h * 0.78, d / 2 + 0.02);
    group.add(frontCap);

    const lcdMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0369a1,
      emissiveIntensity: 0.75,
      roughness: 0.2
    });
    const lcd = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.03), lcdMat);
    lcd.position.set(-0.14, h * 0.8, d / 2 + 0.05);
    group.add(lcd);

    const pwrLedMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.9,
      roughness: 0.3
    });
    const pwrBar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.03), pwrLedMat);
    pwrBar.position.set(0.18, h * 0.8, d / 2 + 0.05);
    group.add(pwrBar);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.05, 0.18), chassisMat);
    handle.position.set(0, h + 0.09, 0);
    group.add(handle);

    addContactShadow(group, w, d, shadowTex);
  } else if (category === 'ap') {
    const mountRing = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.06, 24), darkSlateMat);
    mountRing.position.y = 0.03;
    group.add(mountRing);

    const whiteDomeMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.32,
      metalness: 0.12
    });
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.44, 0.14, 28), whiteDomeMat);
    saucer.position.y = 0.12;
    group.add(saucer);

    const haloMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
      roughness: 0.2
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 10, 28), haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.195;
    group.add(halo);

    addContactShadow(group, 0.88, 0.88, shadowTex);
  } else if (category === 'camera' || category === 'nvr') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 16), darkSlateMat);
    base.position.y = 0.04;
    group.add(base);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 12), brushedSteelMat);
    arm.position.y = 0.28;
    group.add(arm);

    const camMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.25 });
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.42, 18), camMat);
    housing.rotation.z = -(Math.PI / 2 + 0.16);
    housing.position.set(0.06, 0.52, 0);
    group.add(housing);

    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), darkSlateMat);
    lens.rotation.z = -(Math.PI / 2 + 0.16);
    lens.position.set(0.26, 0.49, 0);
    group.add(lens);

    addContactShadow(group, 0.56, 0.56, shadowTex);
  } else {
    // Server / Storage / Generic Device (4+ composite parts)
    const w = 1.05;
    const h = 0.55;
    const d = 0.8;

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.06, d * 0.94), darkSlateMat);
    plinth.position.y = 0.03;
    group.add(plinth);

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), chassisMat);
    body.position.y = h / 2 + 0.06;
    group.add(body);

    const frontFace = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, h * 0.72, 0.05), darkSlateMat);
    frontFace.position.set(0, h / 2 + 0.06, d / 2 + 0.015);
    group.add(frontFace);

    const driveStrip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, h * 0.28, 0.03), brushedSteelMat);
    driveStrip.position.set(-0.08, h / 2 + 0.06, d / 2 + 0.035);
    group.add(driveStrip);

    const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.03), ledGreenMat);
    led.position.set(w * 0.34, h * 0.65, d / 2 + 0.035);
    group.add(led);

    addContactShadow(rootGroup, w, d, shadowTex);
  }

  const isDirectionalCamOrWifi =
    Boolean(resolveCameraFov(node, asset)) ||
    Boolean(resolveWifiCoverage(node, asset)?.isDirectional);
  const mirrorX = !isDirectionalCamOrWifi && node.flipX ? -1 : 1;
  const mirrorZ = !isDirectionalCamOrWifi && node.flipY ? -1 : 1;
  if (mirrorX !== 1 || mirrorZ !== 1) {
    group.scale.set(mirrorX, 1, mirrorZ);
    if (mirrorX * mirrorZ < 0) {
      group.traverse(child => {
        if (child instanceof THREE.Mesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map(m => {
              const cloned = m.clone();
              cloned.side = THREE.DoubleSide;
              return cloned;
            });
          } else {
            const cloned = child.material.clone();
            cloned.side = THREE.DoubleSide;
            child.material = cloned;
          }
        }
      });
    }
  }

  if (isLocked) {
    const devDims =
      category === 'workstation'
        ? { w: 1.32, h: 1.15, d: 1.05 }
        : isAttendance
        ? { w: 0.56, h: 1.4, d: 0.4 }
        : isRiser
        ? { w: 0.6, h: 1.3, d: 0.55 }
        : category === 'switch' || category === 'core_switch' || category === 'patch_panel' || category === 'odf'
        ? { w: 1.32, h: category === 'core_switch' ? 0.44 : 0.3, d: 0.78 }
        : category === 'router' || category === 'gateway' || category === 'firewall'
        ? { w: 1.0, h: 0.48, d: 0.78 }
        : category === 'ups' || category === 'pdu' || category === 'electrical_panel'
        ? { w: 0.84, h: 0.96, d: 0.96 }
        : category === 'ap'
        ? { w: 0.9, h: 0.26, d: 0.9 }
        : category === 'camera' || category === 'nvr'
        ? { w: 0.6, h: 0.72, d: 0.6 }
        : { w: 1.08, h: 0.64, d: 0.84 };
    addLockedVisualEffect(rootGroup, 0.85, devDims.w, devDims.h, devDims.d, lockBadgeTex);
  }
  if (isSelected) {
    addSelectionRing(rootGroup, 0.85, isLocked);
  }

  tagSelectableSubtree(rootGroup, 'node', node.id, node.id, asset?.name || node.label, castShadow);
  return rootGroup;
}

function createFloorPlaqueSprite(label: string, isDark: boolean): THREE.Sprite | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 76;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.94)';
    ctx.strokeStyle = isDark ? '#38bdf8' : '#0284c7';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(4, 4, 312, 68, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.font = '700 26px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, 22), 160, 39);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.55, 0.62, 1);
  return sprite;
}

export function build3DRoomGroup(
  room: Room,
  origin: WorldCoordinateOrigin,
  isDark: boolean,
  options?: { floorY?: number; isCutaway?: boolean }
): THREE.Group {
  const group = new THREE.Group();
  const floorY = options?.floorY ?? 0;
  const isCutaway = Boolean(options?.isCutaway);
  const transform = createCoordinateTransform({ origin, mode: 'legacy_world_scale' });
  const roomDims = resolveRoomWorldDimensions(room, transform);
  const w = Math.max(1.2, roomDims.widthWorld);
  const d = Math.max(1.2, roomDims.depthWorld);
  const pos = canvasToWorldXZ(room.x + room.width / 2, room.y + room.height / 2, origin);
  const nameLower = (room.name || '').toLowerCase();

  const isParking = /đậu xe|bãi đỗ|parking|ô đậu/.test(nameLower);
  const isElevator = /thang máy|elevator/.test(nameLower);
  const isStair = /cầu thang|stair/.test(nameLower);
  const isGate = /cổng ra vào|gate/.test(nameLower);

  const slabH = isCutaway ? 0.11 : 0.04;
  const slabColor = isParking
    ? isDark
      ? 0x1e293b
      : 0x475569
    : isDark
    ? 0x1e293b
    : new THREE.Color(room.color || '#e2e8f0');

  const slabMat = new THREE.MeshStandardMaterial({
    color: slabColor,
    roughness: 0.85,
    metalness: 0.05
  });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, slabH, d), slabMat);
  slab.position.y = slabH / 2;
  slab.receiveShadow = true;
  group.add(slab);

  const backWallMat = new THREE.MeshStandardMaterial({
    color: isDark ? 0x475569 : 0xcbd5e1,
    roughness: 0.55,
    metalness: 0.12,
    transparent: true,
    opacity: isCutaway ? 0.34 : 0.38
  });
  const frontCurbMat = new THREE.MeshStandardMaterial({
    color: isDark ? 0x334155 : 0x94a3b8,
    roughness: 0.6,
    metalness: 0.15,
    transparent: true,
    opacity: isCutaway ? 0.58 : 0.34
  });

  const backWallH = isCutaway ? 2.15 : 0.44;
  const frontWallH = isCutaway ? 0.16 : 0.44;
  const wallT = 0.06;

  // Back (North & West) walls taller in cutaway, Front (South & East) low architectural curb
  const north = new THREE.Mesh(new THREE.BoxGeometry(w, backWallH, wallT), backWallMat);
  north.position.set(0, backWallH / 2 + slabH, -d / 2);
  const west = new THREE.Mesh(new THREE.BoxGeometry(wallT, backWallH, d), backWallMat);
  west.position.set(-w / 2, backWallH / 2 + slabH, 0);

  const south = new THREE.Mesh(new THREE.BoxGeometry(w, frontWallH, wallT), frontCurbMat);
  south.position.set(0, frontWallH / 2 + slabH, d / 2);
  const east = new THREE.Mesh(new THREE.BoxGeometry(wallT, frontWallH, d), frontCurbMat);
  east.position.set(w / 2, frontWallH / 2 + slabH, 0);
  group.add(north, south, west, east);

  // Special procedural architectural interiors matching HACHIHI 2 reference views
  if (isElevator) {
    const shaftW = Math.min(w * 0.62, 2.2);
    const shaftD = Math.min(d * 0.62, 2.2);
    const shaftH = isCutaway ? 2.85 : 1.75;
    const mullionMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.3,
      metalness: 0.8
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.15,
      metalness: 0.25,
      transparent: true,
      opacity: 0.2
    });
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.35,
      metalness: 0.55
    });

    const shaftOffsetX = -w * 0.1;
    const shaftOffsetZ = 0;

    for (const [mx, mz] of [
      [-shaftW / 2, -shaftD / 2],
      [shaftW / 2, -shaftD / 2],
      [-shaftW / 2, shaftD / 2],
      [shaftW / 2, shaftD / 2]
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, shaftH, 0.08), mullionMat);
      post.position.set(shaftOffsetX + mx, slabH + shaftH / 2, shaftOffsetZ + mz);
      group.add(post);
    }

    const glassEnclosure = new THREE.Mesh(
      new THREE.BoxGeometry(shaftW - 0.04, shaftH - 0.08, shaftD - 0.04),
      glassMat
    );
    glassEnclosure.position.set(shaftOffsetX, slabH + shaftH / 2, shaftOffsetZ);
    group.add(glassEnclosure);

    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(shaftW * 0.72, Math.min(1.5, shaftH * 0.62), shaftD * 0.72),
      cabMat
    );
    cab.position.set(shaftOffsetX, slabH + shaftH * 0.44, shaftOffsetZ);
    group.add(cab);
  } else if (isStair) {
    const stepMat = new THREE.MeshStandardMaterial({
      color: isDark ? 0x64748b : 0xcbd5e1,
      roughness: 0.65,
      metalness: 0.15
    });
    const steps = 8;
    const stepW = w * 0.68;
    const stepD = Math.min(d * 0.78, 6.2) / steps;
    const totalRise = isCutaway ? 2.4 : 0.95;
    for (let i = 0; i < steps; i++) {
      const h = ((i + 1) / steps) * totalRise;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(stepW, h * 0.22 + 0.1, stepD * 0.95), stepMat);
      tread.position.set(0, slabH + h * 0.5, -d * 0.34 + i * stepD);
      group.add(tread);
    }

    // Glass curtain-wall mullions on west facade
    const curtainGlassMat = new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      roughness: 0.15,
      metalness: 0.2,
      transparent: true,
      opacity: 0.16
    });
    const curtainH = isCutaway ? 2.6 : 0.8;
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.05, curtainH, d * 0.94), curtainGlassMat);
    curtain.position.set(-w / 2 + 0.03, slabH + curtainH / 2, 0);
    group.add(curtain);
  } else if (isParking) {
    // Yellow parking stall lines + stylized low-poly parked vehicles
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
    const carBodyColors = [0xdbeafe, 0x94a3b8, 0x64748b];
    const carCount = w > 10 ? 3 : 2;
    const spacing = (w * 0.74) / carCount;

    for (let i = 0; i <= carCount; i++) {
      const lineX = -w * 0.37 + i * spacing;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, d * 0.52), stripeMat);
      stripe.position.set(lineX, slabH + 0.01, d * 0.08);
      group.add(stripe);
    }

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 });
    for (let i = 0; i < carCount; i++) {
      const cx = -w * 0.37 + (i + 0.5) * spacing;
      const carMat = new THREE.MeshStandardMaterial({
        color: carBodyColors[i % carBodyColors.length],
        roughness: 0.35,
        metalness: 0.45
      });
      const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.46, 2.75), carMat);
      chassis.position.set(cx, slabH + 0.34, d * 0.08);
      group.add(chassis);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.38, 1.45), carMat);
      cabin.position.set(cx, slabH + 0.72, d * 0.02);
      group.add(cabin);

      for (const [wx, wz] of [
        [-0.76, -0.82],
        [0.76, -0.82],
        [-0.76, 0.82],
        [0.76, 0.82]
      ]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(cx + wx, slabH + 0.22, d * 0.08 + wz);
        group.add(wheel);
      }
    }
  } else if (isGate) {
    // Security gate posts + yellow-and-black barrier arm
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.35 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35, metalness: 0.2 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.92, 0.28), postMat);
    post.position.set(-w * 0.28, slabH + 0.46, d * 0.18);
    group.add(post);

    const barrierArm = new THREE.Mesh(new THREE.BoxGeometry(w * 0.56, 0.09, 0.09), barMat);
    barrierArm.position.set(0, slabH + 0.76, d * 0.18);
    group.add(barrierArm);
  }

  group.position.set(pos.x, floorY, pos.z);
  return group;
}

function build3DCableTrayMesh(
  tray: CableTray,
  origin: WorldCoordinateOrigin,
  floorY: number,
  isCutaway: boolean,
  transform?: CoordinateTransform
): THREE.Group | null {
  if (!tray.points || tray.points.length < 2) return null;
  const effectiveTransform =
    transform ?? createCoordinateTransform({ origin, mode: 'legacy_world_scale' });
  const grp = new THREE.Group();
  const y = floorY + (isCutaway ? 2.02 : 0.045);
  const trayColor = tray.color || (tray.kind === 'power_tray' ? '#d97706' : '#0284c7');
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(trayColor),
    roughness: 0.45,
    metalness: 0.55,
    transparent: true,
    opacity: isCutaway ? 0.72 : 0.65
  });

  const width = resolveCableTrayWidthWorld(tray, effectiveTransform);
  for (let i = 0; i < tray.points.length - 1; i++) {
    const a = canvasToWorldXZ(tray.points[i].x, tray.points[i].y, origin);
    const b = canvasToWorldXZ(tray.points[i + 1].x, tray.points[i + 1].y, origin);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) continue;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, width), mat);
    seg.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    seg.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    grp.add(seg);
  }
  return grp;
}

function buildRoundedPolylineCurvePath(
  points: THREE.Vector3[],
  cornerRadius: number
): THREE.Curve<THREE.Vector3> {
  // Deduplicate adjacent nearly identical vertices
  const clean: THREE.Vector3[] = [];
  for (const pt of points) {
    if (clean.length === 0 || clean[clean.length - 1].distanceTo(pt) > 0.025) {
      clean.push(pt);
    }
  }
  if (clean.length <= 1) {
    const fallback = clean[0] || new THREE.Vector3(0, 0.3, 0);
    return new THREE.LineCurve3(fallback.clone(), fallback.clone().add(new THREE.Vector3(0.05, 0, 0)));
  }
  if (clean.length === 2 || cornerRadius <= 0.01) {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < clean.length - 1; i++) {
      path.add(new THREE.LineCurve3(clean[i], clean[i + 1]));
    }
    return path;
  }

  const path = new THREE.CurvePath<THREE.Vector3>();
  let cursor = clean[0].clone();

  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1];
    const curr = clean[i];
    const next = clean[i + 1];

    const vIn = new THREE.Vector3().subVectors(curr, prev);
    const vOut = new THREE.Vector3().subVectors(next, curr);
    const lenIn = vIn.length();
    const lenOut = vOut.length();
    if (lenIn < 0.03 || lenOut < 0.03) {
      if (cursor.distanceTo(curr) > 0.015) {
        path.add(new THREE.LineCurve3(cursor, curr.clone()));
        cursor = curr.clone();
      }
      continue;
    }

    const r = Math.min(cornerRadius, lenIn * 0.42, lenOut * 0.42);
    const dirIn = vIn.normalize();
    const dirOut = vOut.normalize();

    // Skip fillet if nearly collinear
    if (dirIn.dot(dirOut) > 0.995) {
      if (cursor.distanceTo(curr) > 0.015) {
        path.add(new THREE.LineCurve3(cursor, curr.clone()));
        cursor = curr.clone();
      }
      continue;
    }

    const pEnter = curr.clone().addScaledVector(dirIn, -r);
    const pExit = curr.clone().addScaledVector(dirOut, r);

    if (cursor.distanceTo(pEnter) > 0.015) {
      path.add(new THREE.LineCurve3(cursor, pEnter));
    }
    path.add(new THREE.QuadraticBezierCurve3(pEnter, curr.clone(), pExit));
    cursor = pExit;
  }

  const last = clean[clean.length - 1];
  if (cursor.distanceTo(last) > 0.015) {
    path.add(new THREE.LineCurve3(cursor, last.clone()));
  }

  if (path.curves.length === 0) {
    return new THREE.LineCurve3(clean[0], last);
  }
  return path;
}

export interface Cable3DRouteSyncOptions {
  srcRect?: RectBox;
  tgtRect?: RectBox;
  bundleOffsetPx?: number;
  bundleNormal?: Point2D;
  coordinateTransform?: CoordinateTransform;
  srcElevationZ?: number;
  tgtElevationZ?: number;
}

export function build3DCableCurve(
  cable: Pick<CableEdge, 'routingType' | 'controlPoints' | 'strokeWidth'>,
  srcCenterWorld: { x: number; z: number },
  tgtCenterWorld: { x: number; z: number },
  srcIsRack: boolean,
  tgtIsRack: boolean,
  laneIndex: number,
  laneCount: number,
  explodeSpread: number,
  origin?: WorldCoordinateOrigin,
  srcFloorY = 0,
  tgtFloorY = 0,
  routeSyncOptions?: Cable3DRouteSyncOptions
): { curve: THREE.Curve<THREE.Vector3>; midWorld: THREE.Vector3 } {
  const dx = tgtCenterWorld.x - srcCenterWorld.x;
  const dz = tgtCenterWorld.z - srcCenterWorld.z;
  const dist = Math.hypot(dx, dz) || 1;
  const nx = -dz / dist;
  const nz = dx / dist;
  const laneOffset = (laneIndex - (laneCount - 1) / 2) * 0.14;

  const srcY =
    srcFloorY + (srcIsRack ? 1.15 : 0.34) + (routeSyncOptions?.srcElevationZ ?? 0) + explodeSpread * 0.2;
  const tgtY =
    tgtFloorY + (tgtIsRack ? 1.15 : 0.34) + (routeSyncOptions?.tgtElevationZ ?? 0) + explodeSpread * 0.2;

  // Canonical 2D -> 3D route projection when canvas origin/transform is available
  if (origin || routeSyncOptions?.coordinateTransform) {
    const transform =
      routeSyncOptions?.coordinateTransform ??
      createCoordinateTransform({ origin: origin!, mode: 'legacy_world_scale' });
    const srcCanvasCenter = transform.worldToCanvas(srcCenterWorld);
    const tgtCanvasCenter = transform.worldToCanvas(tgtCenterWorld);
    const srcRect: RectBox = routeSyncOptions?.srcRect
      ? {
          ...routeSyncOptions.srcRect,
          x: srcCanvasCenter.x - routeSyncOptions.srcRect.width / 2,
          y: srcCanvasCenter.y - routeSyncOptions.srcRect.height / 2
        }
      : { x: srcCanvasCenter.x, y: srcCanvasCenter.y, width: 0, height: 0 };
    const tgtRect: RectBox = routeSyncOptions?.tgtRect
      ? {
          ...routeSyncOptions.tgtRect,
          x: tgtCanvasCenter.x - routeSyncOptions.tgtRect.width / 2,
          y: tgtCanvasCenter.y - routeSyncOptions.tgtRect.height / 2
        }
      : { x: tgtCanvasCenter.x, y: tgtCanvasCenter.y, width: 0, height: 0 };

    const isInterFloor = Math.abs(srcFloorY - tgtFloorY) > 0.2;
    const trayY =
      cable.routingType === 'curved' && !isInterFloor
        ? Math.max(srcY, tgtY) + Math.min(1.6, 0.38 + dist * 0.14) + explodeSpread * 0.45
        : Math.max(srcY, tgtY) + 0.18 + Math.abs(laneIndex - (laneCount - 1) / 2) * 0.04 + explodeSpread * 0.3;

    const bundleOffsetPx =
      routeSyncOptions?.bundleOffsetPx !== undefined
        ? routeSyncOptions.bundleOffsetPx
        : laneCount > 1
        ? (laneIndex - (laneCount - 1) / 2) * 6.5
        : 0;
    const bundleNormal =
      routeSyncOptions?.bundleNormal ??
      ({
        x: -(tgtCanvasCenter.y - srcCanvasCenter.y) / (Math.hypot(tgtCanvasCenter.x - srcCanvasCenter.x, tgtCanvasCenter.y - srcCanvasCenter.y) || 1),
        y: (tgtCanvasCenter.x - srcCanvasCenter.x) / (Math.hypot(tgtCanvasCenter.x - srcCanvasCenter.x, tgtCanvasCenter.y - srcCanvasCenter.y) || 1)
      });

    const fullCableStub: CableEdge = {
      id: 'preview_cable',
      diagramMode: 'floorplan',
      sourceNodeId: 'src',
      targetNodeId: 'tgt',
      cableType: 'CAT6_UTP',
      cableCode: '',
      bandwidth: '1G',
      color: '#0284c7',
      lineStyle: 'solid',
      routingType: cable.routingType,
      strokeWidth: cable.strokeWidth,
      controlPoints: cable.controlPoints,
      lengthMeters: 1,
      status: 'active'
    };

    const projected = projectCableRouteTo3D(fullCableStub, srcRect, tgtRect, transform, {
      sourceY: srcY,
      targetY: tgtY,
      trayY,
      bundleOffsetPx,
      bundleNormal,
      curveSegments: 16
    });

    const vec3s = projected.points3D.map(p => new THREE.Vector3(p.x, p.y, p.z));
    let curve: THREE.Curve<THREE.Vector3>;
    if (isInterFloor) {
      curve = buildRoundedPolylineCurvePath(vec3s, cable.routingType === 'straight' ? 0 : 0.22);
    } else if (cable.routingType === 'curved' && vec3s.length >= 3) {
      curve = new THREE.CatmullRomCurve3(vec3s);
    } else if (cable.routingType === 'orthogonal') {
      curve = buildRoundedPolylineCurvePath(vec3s, 0.14);
    } else {
      curve = buildRoundedPolylineCurvePath(vec3s, 0);
    }

    const midWorld = new THREE.Vector3(
      projected.midWorld.x,
      projected.midWorld.y,
      projected.midWorld.z
    );
    return { curve, midWorld };
  }

  const pStart = new THREE.Vector3(srcCenterWorld.x + nx * laneOffset, srcY, srcCenterWorld.z + nz * laneOffset);
  const pEnd = new THREE.Vector3(tgtCenterWorld.x + nx * laneOffset, tgtY, tgtCenterWorld.z + nz * laneOffset);

  // Inter-floor vertical riser trunk routing
  if (Math.abs(srcFloorY - tgtFloorY) > 0.2) {
    const shaftX = tgtCenterWorld.x + nx * laneOffset;
    const shaftZ = tgtCenterWorld.z + nz * laneOffset;
    const riserPts: THREE.Vector3[] = [pStart];
    if (Math.hypot(shaftX - pStart.x, shaftZ - pStart.z) > 0.12) {
      riserPts.push(new THREE.Vector3(shaftX, srcY, shaftZ));
    }
    riserPts.push(new THREE.Vector3(shaftX, tgtY, shaftZ));
    if (riserPts[riserPts.length - 1].distanceTo(pEnd) > 0.08) {
      riserPts.push(pEnd);
    }
    const curve = buildRoundedPolylineCurvePath(riserPts, cable.routingType === 'straight' ? 0 : 0.22);
    const midWorld = curve.getPointAt(0.5);
    return { curve, midWorld };
  }

  const trayY = Math.max(srcY, tgtY) + 0.18 + Math.abs(laneIndex - (laneCount - 1) / 2) * 0.04 + explodeSpread * 0.3;

  if (cable.routingType === 'straight') {
    const pts = [pStart, pEnd];
    const curve = buildRoundedPolylineCurvePath(pts, 0);
    const midWorld = curve.getPointAt(0.5);
    return { curve, midWorld };
  }

  if (cable.routingType === 'orthogonal') {
    const midX = (pStart.x + pEnd.x) / 2 + nx * laneOffset * 0.65;
    const rawPts: THREE.Vector3[] = [
      pStart,
      new THREE.Vector3(pStart.x, trayY, pStart.z),
      new THREE.Vector3(midX, trayY, pStart.z),
      new THREE.Vector3(midX, trayY, pEnd.z),
      new THREE.Vector3(pEnd.x, trayY, pEnd.z),
      pEnd
    ];
    const curve = buildRoundedPolylineCurvePath(rawPts, 0.28);
    const midWorld = curve.getPointAt(0.5);
    return { curve, midWorld };
  }

  const arcPeak = Math.max(srcY, tgtY) + Math.min(1.6, 0.38 + dist * 0.14) + explodeSpread * 0.45;
  const curvePts = [
    pStart,
    new THREE.Vector3(
      srcCenterWorld.x + dx * 0.28 + nx * laneOffset,
      arcPeak * 0.85,
      srcCenterWorld.z + dz * 0.28 + nz * laneOffset
    ),
    new THREE.Vector3(
      srcCenterWorld.x + dx * 0.72 + nx * laneOffset,
      arcPeak * 0.85,
      srcCenterWorld.z + dz * 0.72 + nz * laneOffset
    ),
    pEnd
  ];
  const curve = new THREE.CatmullRomCurve3(curvePts);
  const midWorld = curve.getPointAt(0.5);
  return { curve, midWorld };
}

export function build3DCableGeometry(
  cable: Pick<CableEdge, 'routingType' | 'controlPoints' | 'strokeWidth'>,
  srcCenterWorld: { x: number; z: number },
  tgtCenterWorld: { x: number; z: number },
  srcIsRack: boolean,
  tgtIsRack: boolean,
  laneIndex: number,
  laneCount: number,
  explodeSpread: number,
  origin?: WorldCoordinateOrigin,
  isSelected = false,
  srcFloorY = 0,
  tgtFloorY = 0,
  renderQuality: StudioRenderQuality = 'high',
  routeSyncOptions?: Cable3DRouteSyncOptions
): THREE.TubeGeometry {
  const { curve } = build3DCableCurve(
    cable,
    srcCenterWorld,
    tgtCenterWorld,
    srcIsRack,
    tgtIsRack,
    laneIndex,
    laneCount,
    explodeSpread,
    origin,
    srcFloorY,
    tgtFloorY,
    routeSyncOptions
  );
  const baseRadius = Math.min(0.052, Math.max(0.026, (cable.strokeWidth || 2) * 0.012));
  const radius = isSelected ? baseRadius * 1.45 : baseRadius;
  const isFlatStraight = cable.routingType === 'straight' && Math.abs(srcFloorY - tgtFloorY) <= 0.2;
  const tubularSegments =
    renderQuality === 'low'
      ? isFlatStraight
        ? 6
        : 16
      : renderQuality === 'medium'
      ? isFlatStraight
        ? 8
        : 24
      : isFlatStraight
      ? 12
      : 36;
  const radialSegments = renderQuality === 'low' ? 5 : 8;
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
}

export function build3DCableMesh(
  cable: CableEdge,
  srcNode: DiagramNode,
  tgtNode: DiagramNode,
  origin: WorldCoordinateOrigin,
  laneIndex: number,
  laneCount: number,
  explodeSpread: number,
  castShadow: boolean,
  isSelected = false,
  srcFloorY = 0,
  tgtFloorY = 0,
  renderQuality: StudioRenderQuality = 'high',
  routeSyncOptions?: Cable3DRouteSyncOptions
): { mesh: THREE.Mesh; midWorld: THREE.Vector3 } {
  const srcPivot = resolveNodePivotCenter(srcNode).canonicalCenter;
  const tgtPivot = resolveNodePivotCenter(tgtNode).canonicalCenter;
  const s = canvasToWorldXZ(srcPivot.x, srcPivot.y, origin);
  const t = canvasToWorldXZ(tgtPivot.x, tgtPivot.y, origin);
  const mergedSyncOptions: Cable3DRouteSyncOptions = {
    srcRect: { x: srcNode.x, y: srcNode.y, width: srcNode.width, height: srcNode.height },
    tgtRect: { x: tgtNode.x, y: tgtNode.y, width: tgtNode.width, height: tgtNode.height },
    srcElevationZ:
      typeof srcNode.customData?.elevationZ === 'number' && Number.isFinite(srcNode.customData.elevationZ)
        ? srcNode.customData.elevationZ
        : 0,
    tgtElevationZ:
      typeof tgtNode.customData?.elevationZ === 'number' && Number.isFinite(tgtNode.customData.elevationZ)
        ? tgtNode.customData.elevationZ
        : 0,
    ...routeSyncOptions
  };
  const { midWorld } = build3DCableCurve(
    cable,
    s,
    t,
    srcNode.type === 'rack',
    tgtNode.type === 'rack',
    laneIndex,
    laneCount,
    explodeSpread,
    origin,
    srcFloorY,
    tgtFloorY,
    mergedSyncOptions
  );
  const geo = build3DCableGeometry(
    cable,
    s,
    t,
    srcNode.type === 'rack',
    tgtNode.type === 'rack',
    laneIndex,
    laneCount,
    explodeSpread,
    origin,
    isSelected,
    srcFloorY,
    tgtFloorY,
    renderQuality,
    mergedSyncOptions
  );
  const baseColor = new THREE.Color(cable.color || '#0284c7');
  const mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: isSelected ? baseColor : new THREE.Color(0x000000),
    emissiveIntensity: isSelected ? 0.5 : 0,
    roughness: isSelected ? 0.25 : 0.42,
    metalness: 0.22
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = castShadow;
  mesh.userData = {
    selectType: 'edge',
    selectId: cable.id,
    cableId: cable.id,
    label: cable.cableCode
  };
  return { mesh, midWorld };
}

export interface Populated3DCableEntry {
  mesh: THREE.Mesh;
  cable: CableEdge;
  sourceNodeId: string;
  targetNodeId: string;
  sourceIsRack: boolean;
  targetIsRack: boolean;
  srcFloorY: number;
  tgtFloorY: number;
  laneIndex: number;
  laneCount: number;
  bundleOffsetPx?: number;
  bundleNormal?: Point2D;
  srcElevationZ?: number;
  tgtElevationZ?: number;
  midWorld: THREE.Vector3;
}

export interface World3DBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  size: number;
}

export interface Populated3DWorldResult {
  origin: WorldCoordinateOrigin;
  activeFloorY: number;
  isMultiFloorCutaway: boolean;
  nodeGroups: Map<string, { group: THREE.Group; node: DiagramNode; floorY: number }>;
  cableEntries: Populated3DCableEntry[];
  bounds: World3DBounds;
}

export function populateInfrastructure3DWorld(
  worldRoot: THREE.Group,
  project: ProjectState,
  selectedId: string | undefined,
  options: {
    showRooms: boolean;
    showCables: boolean;
    explodeSpread: number;
    castShadow: boolean;
    shadowTex: THREE.Texture;
    lockBadgeTex?: THREE.Texture;
    viewAllFloors?: boolean;
    renderQuality?: StudioRenderQuality;
    wireframe?: boolean;
    showThermalHeatmap?: boolean;
    registry?: ThreeResourceRegistry;
    registryScope?: string;
    cadUnderlayDoc?: CADDocument | null;
    interactiveUnlocked?: boolean;
  }
): Populated3DWorldResult {
  const quality: StudioRenderQuality = options.renderQuality || 'high';
  const showThermalHeatmap = options.showThermalHeatmap !== false;
  const isFloorBasedMode = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);
  const isMultiFloorCutaway = Boolean(
    options.viewAllFloors && isFloorBasedMode && project.floors.length > 1
  );

  const floorPlan = buildFloorElevationPlan(project, {
    isMultiFloorCutaway,
    explodeSpread: options.explodeSpread,
    usePhysicalFloorHeight: false
  });
  const sortedFloors: Floor[] = floorPlan.floorsSorted;
  const floorYMap = new Map<string, number>();
  floorPlan.byFloorId.forEach((entry, fid) => {
    floorYMap.set(fid, entry.displayElevationY);
  });

  const roomFloorById = new Map((project.rooms || []).map(r => [r.id, r.floorId]));
  const rackLookup = buildRackLookupIndex(project.racks || [], project.nodes);

  // Resolve rack-mounted shadow topology nodes so 3D floorplan/cutaway routes cables to 3D Racks
  const shadowToRackNodeId = new Map<string, string>();
  if (isFloorBasedMode) {
    for (const n of project.nodes) {
      if (isTopologyShadowMountedInRack(n, project.assets, rackLookup)) {
        const asset = n.assetId ? project.assets[n.assetId] : undefined;
        const matchRackNode = asset?.rackId ? rackLookup.rackNodeByRackId.get(asset.rackId) : undefined;
        if (matchRackNode && (!n.floorId || !matchRackNode.floorId || n.floorId === matchRackNode.floorId)) {
          shadowToRackNodeId.set(n.id, matchRackNode.id);
        }
      }
    }
  }

  const hiddenLayerSet = getHiddenLayerSet(project.settings);

  let visibleNodes = project.nodes.filter(n => {
    if (n.hidden) return false;
    if (n.type === 'legend' || n.type === 'text') return false;
    const nodeLayer = resolveNodeLayer(n, project.assets);
    if (hiddenLayerSet.has(nodeLayer)) return false;
    if (isFloorBasedMode) {
      if (shadowToRackNodeId.has(n.id)) return false;
      const { floorId: nodeFloorId } = resolveNodeFloorId(n, project, {
        rackLookup,
        roomFloorById
      });
      if (!isMultiFloorCutaway && nodeFloorId && project.activeFloorId && nodeFloorId !== project.activeFloorId) {
        return false;
      }
      return true;
    }
    if (project.activeMode === 'rack') return n.diagramMode === 'rack' || n.type === 'rack';
    return true;
  });

  if (project.activeMode === 'rack') {
    visibleNodes = layoutRackNodesForElevationMode(visibleNodes, project.racks);
  }

  const showRoomsEffective = options.showRooms && !hiddenLayerSet.has('rooms');
  const showTraysEffective = !hiddenLayerSet.has('trays');
  const showCablesEffective = options.showCables && !hiddenLayerSet.has('cables');

  const visibleRooms = showRoomsEffective
    ? project.rooms.filter(r => {
        if (isFloorBasedMode) {
          if (!isMultiFloorCutaway && r.floorId && project.activeFloorId && r.floorId !== project.activeFloorId) {
            return false;
          }
        }
        return true;
      })
    : [];

  const visibleTrays = showTraysEffective
    ? (project.cableTrays || []).filter(tr => {
        if (isFloorBasedMode) {
          if (!isMultiFloorCutaway && tr.floorId && project.activeFloorId && tr.floorId !== project.activeFloorId) {
            return false;
          }
        }
        return true;
      })
    : [];

  const origin = computeWorldOrigin(visibleNodes, visibleRooms);
  const worldTransform = createCoordinateTransform({
    pixelsPerMeter: project.settings.scale,
    origin,
    mode: 'legacy_world_scale'
  });
  const nodeGroups = new Map<string, { group: THREE.Group; node: DiagramNode; floorY: number }>();
  const cableEntries: Populated3DCableEntry[] = [];

  if (options.cadUnderlayDoc?.underlay.enabled && options.cadUnderlayDoc?.underlay.showIn3D) {
    const activeFloorY = project.activeFloorId ? (floorYMap.get(project.activeFloorId) ?? 0) : 0;
    const cadGroup = build3DCadUnderlayGroup(
      options.cadUnderlayDoc,
      origin,
      activeFloorY + 0.006,
      project.settings.isDarkMode
    );
    if (cadGroup) {
      worldRoot.add(cadGroup);
    }
  }

  if (showRoomsEffective) {
    for (const room of visibleRooms) {
      const floorY = room.floorId ? (floorYMap.get(room.floorId) ?? 0) : 0;
      const roomGrp = build3DRoomGroup(room, origin, project.settings.isDarkMode, {
        floorY,
        isCutaway: isMultiFloorCutaway
      });
      worldRoot.add(roomGrp);
    }

    // Add Floor Label Plaques in multi-floor cutaway mode
    if (isMultiFloorCutaway && visibleRooms.length > 0) {
      const minCanvasX = Math.min(...visibleRooms.map(r => r.x));
      const midCanvasY =
        (Math.min(...visibleRooms.map(r => r.y)) +
          Math.max(...visibleRooms.map(r => r.y + r.height))) /
        2;
      const labelXZ = canvasToWorldXZ(minCanvasX, midCanvasY, origin);
      for (const flr of sortedFloors) {
        const fy = floorYMap.get(flr.id) ?? 0;
        const shortLabel = flr.name.split(' - ')[0] || flr.name;
        const plaque = createFloorPlaqueSprite(shortLabel, project.settings.isDarkMode);
        if (plaque) {
          plaque.position.set(labelXZ.x - 1.65, fy + 1.05, labelXZ.z);
          worldRoot.add(plaque);
        }
      }
    }
  }

  // Render overhead/floor cable trays in 3D
  if (showTraysEffective) {
    for (const tray of visibleTrays) {
      const floorY = tray.floorId ? (floorYMap.get(tray.floorId) ?? 0) : 0;
      const trayGrp = build3DCableTrayMesh(tray, origin, floorY, isMultiFloorCutaway, worldTransform);
      if (trayGrp) worldRoot.add(trayGrp);
    }
  }

  const nodeMap = new Map<string, DiagramNode>();
  const nodeFloorYMap = new Map<string, number>();
  const devicePool = createWorldDeviceResourcePool();

  for (const node of visibleNodes) {
    nodeMap.set(node.id, node);
    const resolvedElevation = resolveNodeFloorAndElevation(node, project, floorPlan, {
      rackLookup,
      roomFloorById
    });
    const floorY = resolvedElevation.displayWorldY - resolvedElevation.elevationZ;
    nodeFloorYMap.set(node.id, floorY);

    const canonicalCenter = resolveNodePivotCenter(node).canonicalCenter;
    const pos = canvasToWorldXZ(canonicalCenter.x, canonicalCenter.y, origin);
    const asset = node.assetId ? project.assets[node.assetId] : undefined;
    const isLocked = isNodeEffectivelyLocked(node, project.settings, project.assets, false);

    let grp: THREE.Group;
    let nodeSelectType: 'node' | 'rack' = 'node';
    let nodeSelectId = node.id;
    let nodeLabel = asset?.name || node.label;
    let nodeSelected = false;
    if (node.type === 'rack') {
      const rack = resolveRackForDiagramNode(node, project.assets, rackLookup);
      nodeSelected = selectedId === rack?.id || selectedId === node.id;
      nodeSelectType = 'rack';
      nodeSelectId = rack?.id || node.id;
      nodeLabel = rack?.name || node.label;
      const rackLod: DetailLodLevel = node.customData?.collapsed ? 'collapsed' : quality;
      grp = buildRackGroup(
        node,
        rack,
        project.assets,
        nodeSelected,
        isLocked,
        options.castShadow,
        options.shadowTex,
        options.lockBadgeTex,
        isFloorBasedMode,
        rackLod,
        showThermalHeatmap
      );
    } else {
      nodeSelected = selectedId === node.id;
      grp = buildDeviceGroup(
        node,
        asset,
        nodeSelected,
        isLocked,
        options.castShadow,
        options.shadowTex,
        options.lockBadgeTex,
        devicePool
      );
    }

    const overlayGroup = buildNode3DCoverageAndGizmoOverlay(node, asset, project, {
      selectType: nodeSelectType,
      selectId: nodeSelectId,
      label: nodeLabel,
      isSelected: nodeSelected,
      isLocked,
      interactiveUnlocked: Boolean(options.interactiveUnlocked),
      ringRadius: node.type === 'rack' ? 0.92 : 0.85
    });
    if (overlayGroup.children.length > 0) {
      grp.add(overlayGroup);
    }

    const layerLift = node.type === 'rack' || isMultiFloorCutaway ? 0 : options.explodeSpread * 0.45;
    const finalY = floorY + layerLift + resolvedElevation.elevationZ;
    grp.position.set(pos.x, finalY, pos.z);
    if (node.rotation) {
      grp.rotation.y = rotationDegToThreeYRad(node.rotation);
    }
    worldRoot.add(grp);
    nodeGroups.set(node.id, { group: grp, node, floorY });
  }

  // Continuous Blue Vertical Riser Trunk in Multi-Floor Cutaway
  if (isMultiFloorCutaway) {
    const riserNodes = visibleNodes.filter(n => n.type === 'riser');
    if (riserNodes.length >= 2) {
      const avgX = riserNodes.reduce((acc, n) => acc + n.x + n.width / 2, 0) / riserNodes.length;
      const avgY = riserNodes.reduce((acc, n) => acc + n.y + n.height / 2, 0) / riserNodes.length;
      const trunkXZ = canvasToWorldXZ(avgX, avgY, origin);
      const ys = riserNodes.map(n => nodeFloorYMap.get(n.id) ?? 0);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys) + 1.8;
      const spanH = Math.max(2, maxY - minY);

      const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        roughness: 0.32,
        metalness: 0.45,
        transparent: true,
        opacity: 0.85
      });
      const trunkPipe = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, spanH, 0.22),
        trunkMat
      );
      trunkPipe.position.set(trunkXZ.x, minY + spanH / 2, trunkXZ.z);
      worldRoot.add(trunkPipe);
    }
  }

  if (showCablesEffective) {
    const resolvedCables: CableEdge[] = [];
    const resolvedPairs = new Map<string, { cable: CableEdge; src: DiagramNode; tgt: DiagramNode }>();
    const resolvedLinks = new Map<
      string,
      { cable: CableEdge; src: DiagramNode; tgt: DiagramNode }[]
    >();

    for (const c of project.cables) {
      const effSrcId = shadowToRackNodeId.get(c.sourceNodeId) || c.sourceNodeId;
      const effTgtId = shadowToRackNodeId.get(c.targetNodeId) || c.targetNodeId;
      if (effSrcId === effTgtId) continue;
      const src = nodeMap.get(effSrcId);
      const tgt = nodeMap.get(effTgtId);
      if (!src || !tgt) continue;
      const effCable: CableEdge =
        effSrcId === c.sourceNodeId && effTgtId === c.targetNodeId
          ? c
          : { ...c, sourceNodeId: effSrcId, targetNodeId: effTgtId };
      resolvedCables.push(effCable);
      resolvedPairs.set(c.id, { cable: c, src, tgt });
      const pairKey = [effSrcId, effTgtId].sort().join('__');
      const list = resolvedLinks.get(pairKey) || [];
      list.push({ cable: c, src, tgt });
      resolvedLinks.set(pairKey, list);
    }

    const bundleLayout = computeCableBundleLayout(resolvedCables, id => {
      const n = nodeMap.get(id);
      return n ? { x: n.x, y: n.y, width: n.width, height: n.height } : null;
    });
    const bundleById = new Map(bundleLayout.bundles.map(b => [b.bundleId, b]));

    for (const list of resolvedLinks.values()) {
      list.forEach(({ cable, src, tgt }, idx) => {
        const srcFloorY = nodeFloorYMap.get(src.id) ?? 0;
        const tgtFloorY = nodeFloorYMap.get(tgt.id) ?? 0;
        const bundleId = bundleLayout.cableToBundleId.get(cable.id);
        const bundleInfo = bundleId ? bundleById.get(bundleId) : undefined;
        const bundleOffsetPx = bundleLayout.cableOffsets.get(cable.id) ?? 0;
        const bundleNormal = bundleInfo?.normal;
        const srcElevationZ =
          typeof src.customData?.elevationZ === 'number' && Number.isFinite(src.customData.elevationZ)
            ? src.customData.elevationZ
            : 0;
        const tgtElevationZ =
          typeof tgt.customData?.elevationZ === 'number' && Number.isFinite(tgt.customData.elevationZ)
            ? tgt.customData.elevationZ
            : 0;

        const { mesh, midWorld } = build3DCableMesh(
          cable,
          src,
          tgt,
          origin,
          idx,
          list.length,
          options.explodeSpread,
          options.castShadow,
          selectedId === cable.id,
          srcFloorY,
          tgtFloorY,
          quality,
          {
            coordinateTransform: worldTransform,
            bundleOffsetPx,
            bundleNormal,
            srcElevationZ,
            tgtElevationZ
          }
        );
        worldRoot.add(mesh);
        cableEntries.push({
          mesh,
          cable,
          sourceNodeId: src.id,
          targetNodeId: tgt.id,
          sourceIsRack: src.type === 'rack',
          targetIsRack: tgt.type === 'rack',
          srcFloorY,
          tgtFloorY,
          laneIndex: idx,
          laneCount: list.length,
          bundleOffsetPx,
          bundleNormal,
          srcElevationZ,
          tgtElevationZ,
          midWorld
        });
      });
    }
  }

  // Compute world bounding box for adaptive camera framing
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = 0;
  let maxY = 2.6;

  for (const r of visibleRooms) {
    const p1 = canvasToWorldXZ(r.x, r.y, origin);
    const p2 = canvasToWorldXZ(r.x + r.width, r.y + r.height, origin);
    minX = Math.min(minX, p1.x, p2.x);
    maxX = Math.max(maxX, p1.x, p2.x);
    minZ = Math.min(minZ, p1.z, p2.z);
    maxZ = Math.max(maxZ, p1.z, p2.z);
    const fy = r.floorId ? (floorYMap.get(r.floorId) ?? 0) : 0;
    minY = Math.min(minY, fy);
    maxY = Math.max(maxY, fy + (isMultiFloorCutaway ? 2.8 : 1.6));
  }
  for (const n of visibleNodes) {
    const p1 = canvasToWorldXZ(n.x, n.y, origin);
    const p2 = canvasToWorldXZ(n.x + n.width, n.y + n.height, origin);
    minX = Math.min(minX, p1.x, p2.x);
    maxX = Math.max(maxX, p1.x, p2.x);
    minZ = Math.min(minZ, p1.z, p2.z);
    maxZ = Math.max(maxZ, p1.z, p2.z);
    const fy = nodeFloorYMap.get(n.id) ?? 0;
    minY = Math.min(minY, fy);
    maxY = Math.max(maxY, fy + (n.type === 'rack' ? 2.8 : 1.5));
  }

  if (!Number.isFinite(minX)) {
    minX = -6;
    maxX = 6;
    minZ = -4;
    maxZ = 4;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const size = Math.max(spanX, spanY, spanZ, 8);

  const bounds: World3DBounds = {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    centerZ: (minZ + maxZ) / 2,
    size
  };

  if (options.wireframe) {
    applySceneWireframeMode(worldRoot, true);
  }

  if (options.registry) {
    const keepTextures = new Set<THREE.Texture>([options.shadowTex]);
    if (options.lockBadgeTex) {
      keepTextures.add(options.lockBadgeTex);
    }
    options.registry.trackObjectTree(worldRoot, options.registryScope || 'world', keepTextures);
  }

  const activeFloorY =
    isMultiFloorCutaway && project.activeFloorId ? (floorYMap.get(project.activeFloorId) ?? 0) : 0;

  return { origin, activeFloorY, isMultiFloorCutaway, nodeGroups, cableEntries, bounds };
}

export function disposeObjectTree(root: THREE.Object3D, keepTextures?: Set<THREE.Texture>) {
  disposeThreeObjectTree(root, keepTextures);
}

function build3DCadUnderlayGroup(
  cadDoc: CADDocument,
  origin: WorldCoordinateOrigin,
  yBase: number,
  isDarkMode: boolean
): THREE.Group | null {
  const linePositions: number[] = [];
  const lineColors: number[] = [];
  const facePositions: number[] = [];
  const faceColors: number[] = [];
  const tmpColor = new THREE.Color();
  const maxSegments = 80000;

  const toWorld = (pt: Point2D) => {
    const np = cadPointToNetworkCanvas(pt, cadDoc.underlay);
    return canvasToWorldXZ(np.x, np.y, origin);
  };

  const pushPolyline = (pts: Point2D[], r: number, g: number, b: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (linePositions.length / 6 >= maxSegments) return;
      const a = toWorld(pts[i]);
      const c = toWorld(pts[i + 1]);
      linePositions.push(a.x, yBase, a.z, c.x, yBase, c.z);
      lineColors.push(r, g, b, r, g, b);
    }
  };

  const walkEntity = (
    ent: CADEntity,
    transform: Affine2D,
    depth: number,
    visited: Set<string>,
    parentColor?: string
  ) => {
    if (linePositions.length / 6 >= maxSegments) return;
    if (ent.visible === false || !isCADLayerVisible(cadDoc, ent.layer)) return;
    const hex = resolveEntityColorHex(ent, cadDoc, {
      lightBackground: !isDarkMode,
      parentBlockColorHex: parentColor
    });
    tmpColor.set(hex);
    const { r, g, b } = tmpColor;
    const xf = (p: Point2D) => applyAffine2D(transform, p);

    switch (ent.type) {
      case 'LINE':
        pushPolyline([xf(ent.start), xf(ent.end)], r, g, b);
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        pushPolyline(tessellatePolyline(ent.vertices, ent.closed, 12).map(xf), r, g, b);
        break;
      case 'CIRCLE': {
        const pts: Point2D[] = [];
        for (let i = 0; i <= 24; i++) {
          const rad = (i / 24) * Math.PI * 2;
          pts.push(
            xf({
              x: ent.center.x + ent.radius * Math.cos(rad),
              y: ent.center.y + ent.radius * Math.sin(rad)
            })
          );
        }
        pushPolyline(pts, r, g, b);
        break;
      }
      case 'ARC': {
        const pts: Point2D[] = [];
        const s = ent.startAngle;
        let e = ent.endAngle;
        if (e <= s) e += 360;
        for (let i = 0; i <= 18; i++) {
          const rad = ((s + ((e - s) * i) / 18) * Math.PI) / 180;
          pts.push(
            xf({
              x: ent.center.x + ent.radius * Math.cos(rad),
              y: ent.center.y + ent.radius * Math.sin(rad)
            })
          );
        }
        pushPolyline(pts, r, g, b);
        break;
      }
      case 'ELLIPSE':
        pushPolyline(tessellateEllipse(ent, 24).map(xf), r, g, b);
        break;
      case 'SPLINE':
        pushPolyline(tessellateSpline(ent, 24).map(xf), r, g, b);
        break;
      case '3DFACE': {
        if (ent.vertices.length >= 3) {
          const v0 = toWorld(xf(ent.vertices[0]));
          const v1 = toWorld(xf(ent.vertices[1]));
          const v2 = toWorld(xf(ent.vertices[2]));
          const zScale = cadDoc.underlay.scaleToCanvasPx * WORLD_SCALE;
          const y0 = yBase + (ent.vertices[0].z || 0) * zScale;
          const y1 = yBase + (ent.vertices[1].z || 0) * zScale;
          const y2 = yBase + (ent.vertices[2].z || 0) * zScale;
          facePositions.push(v0.x, y0, v0.z, v1.x, y1, v1.z, v2.x, y2, v2.z);
          faceColors.push(r, g, b, r, g, b, r, g, b);
          if (ent.vertices.length >= 4) {
            const v3 = toWorld(xf(ent.vertices[3]));
            const y3 = yBase + (ent.vertices[3].z || 0) * zScale;
            facePositions.push(v0.x, y0, v0.z, v2.x, y2, v2.z, v3.x, y3, v3.z);
            faceColors.push(r, g, b, r, g, b, r, g, b);
          }
        }
        break;
      }
      case 'INSERT': {
        const blk = cadDoc.blocks[ent.blockName];
        if (!blk || depth > 8 || visited.has(ent.blockName)) break;
        visited.add(ent.blockName);
        const lm = buildInsertTransform2D(ent.position, ent.scale, ent.rotation, blk.basePoint);
        const nextT: Affine2D = [
          transform[0] * lm[0] + transform[2] * lm[1],
          transform[1] * lm[0] + transform[3] * lm[1],
          transform[0] * lm[2] + transform[2] * lm[3],
          transform[1] * lm[2] + transform[3] * lm[3],
          transform[0] * lm[4] + transform[2] * lm[5] + transform[4],
          transform[1] * lm[4] + transform[3] * lm[5] + transform[5]
        ];
        for (const sub of blk.entities) {
          walkEntity(sub, nextT, depth + 1, visited, hex);
        }
        visited.delete(ent.blockName);
        break;
      }
      default:
        break;
    }
  };

  const visited = new Set<string>();
  for (const ent of cadDoc.entities) {
    walkEntity(ent, IDENTITY_2D, 0, visited);
  }

  if (linePositions.length === 0 && facePositions.length === 0) {
    return null;
  }

  const group = new THREE.Group();
  group.name = 'cad_underlay_3d_group';
  const opacity = Math.max(0.1, Math.min(1, cadDoc.underlay.opacity ?? 0.72));

  if (linePositions.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: opacity < 0.99,
      opacity
    });
    const segs = new THREE.LineSegments(geom, mat);
    segs.name = 'cad_underlay_3d_lines';
    group.add(segs);
  }

  if (facePositions.length > 0) {
    const fGeom = new THREE.BufferGeometry();
    fGeom.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3));
    fGeom.setAttribute('color', new THREE.Float32BufferAttribute(faceColors, 3));
    fGeom.computeVertexNormals();
    const fMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: Math.max(0.15, opacity * 0.65),
      roughness: 0.7
    });
    const mesh = new THREE.Mesh(fGeom, fMat);
    mesh.name = 'cad_underlay_3d_faces';
    group.add(mesh);
  }

  return group;
}
