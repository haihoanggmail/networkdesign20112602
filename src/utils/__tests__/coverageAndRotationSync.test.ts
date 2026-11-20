import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyCameraFovToProject,
  applyNodesRotationToProject,
  applyWifiCoverageToProject
} from '../../store/slices/useNodesSlice';
import {
  cameraRangeFromAreaSqm,
  cameraRangeFromScalePct,
  computeSectorAreaSqm,
  normalizeRotationDeg,
  resolveCameraFov,
  resolveWifiCoverage,
  signedAngularDiffDeg,
  wifiRadiusFromAreaSqm,
  wifiRadiusFromScalePct
} from '../coverageUtils';
import {
  buildNode3DCoverageAndGizmoOverlay,
  populateInfrastructure3DWorld,
  refreshNode3DCoverageAndGizmos
} from '../../components/canvas/three/proceduralDevices';
import { ThreeResourceRegistry } from '../../components/canvas/three/resourceRegistry';
import { generatePureSvgMarkup } from '../svgExport';
import { createEnterpriseTopologyProject } from '../../data/templates';
import { runStandaloneSuite, type TestFn } from './testHarness';
import type { DiagramNode, ProjectState } from '../../types/infrastructure';

function collectGizmoActions(obj: THREE.Object3D): string[] {
  const actions: string[] = [];
  obj.traverse(child => {
    const act = child.userData?.gizmoAction;
    if (typeof act === 'string') actions.push(act);
  });
  return actions;
}

function collectNamedGizmos(obj: THREE.Object3D, prefix: string): string[] {
  const names: string[] = [];
  obj.traverse(child => {
    if (child.name.startsWith(prefix)) {
      names.push(child.name);
    }
  });
  return names;
}

const DEFAULT_STYLE: DiagramNode['style'] = {
  backgroundColor: '#155eef',
  borderColor: '#1e40af',
  borderWidth: 1.5,
  borderStyle: 'solid',
  opacity: 1,
  textColor: '#ffffff',
  shape: 'round'
};

const LEGEND_STYLE: DiagramNode['style'] = {
  backgroundColor: '#ffffff',
  borderColor: '#cbd5e1',
  borderWidth: 1,
  borderStyle: 'solid',
  opacity: 1,
  textColor: '#0f172a',
  shape: 'rect'
};

export async function runCoverageAndRotationSyncTests(runTest: TestFn): Promise<void> {
  await runTest('coverageUtils & store helpers: 360° rotation, m/m²/% coverage sync & locking', () => {
    const base = createEnterpriseTopologyProject();
    const apNode: DiagramNode = {
      id: 'node_ap_test',
      type: 'device',
      diagramMode: 'floorplan',
      assetId: 'asset_ap_test',
      label: 'AP-TANG1',
      x: 200,
      y: 220,
      width: 64,
      height: 64,
      rotation: 0,
      locked: false,
      style: { ...DEFAULT_STYLE }
    };
    const camNode: DiagramNode = {
      id: 'node_cam_test',
      type: 'device',
      diagramMode: 'floorplan',
      assetId: 'asset_cam_test',
      label: 'CAM-CONG',
      x: 420,
      y: 240,
      width: 64,
      height: 64,
      rotation: 45,
      locked: false,
      style: { ...DEFAULT_STYLE }
    };
    const legendNode: DiagramNode = {
      id: 'node_legend_test',
      type: 'legend',
      diagramMode: 'floorplan',
      label: 'Chú giải',
      x: 80,
      y: 80,
      width: 300,
      height: 200,
      rotation: 0,
      locked: false,
      style: { ...LEGEND_STYLE }
    };
    const lockedNode: DiagramNode = {
      id: 'node_locked_test',
      type: 'device',
      diagramMode: 'floorplan',
      label: 'Locked Node',
      x: 600,
      y: 200,
      width: 64,
      height: 64,
      rotation: 30,
      locked: true,
      style: { ...DEFAULT_STYLE }
    };

    const proj: ProjectState = {
      ...base,
      nodes: [apNode, camNode, legendNode, lockedNode],
      assets: {
        ...base.assets,
        asset_ap_test: {
          id: 'asset_ap_test',
          assetTag: 'AP-TEST-01',
          serialNumber: 'SN-AP-TEST-01',
          name: 'AP Test',
          category: 'ap',
          vendor: 'Ubiquiti',
          model: 'U6-Pro',
          ipAddress: '10.0.0.10',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: 'AA:BB:CC:DD:EE:01',
          vlan: '10',
          ports: [],
          status: 'online',
          powerWatts: 13,
          wifiSpecs: {
            standard: 'Wi-Fi 6 (802.11ax)',
            bands: '2.4GHz + 5GHz',
            txPowerDbm: 22,
            coverageRadiusMeters: 18,
            coverageAngleDeg: 360,
            maxClients: 200,
            ssid: 'TEST-WIFI'
          }
        },
        asset_cam_test: {
          id: 'asset_cam_test',
          assetTag: 'CAM-TEST-01',
          serialNumber: 'SN-CAM-TEST-01',
          name: 'Camera Test',
          category: 'camera',
          vendor: 'Hikvision',
          model: 'DS-2CD',
          ipAddress: '10.0.0.20',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: 'AA:BB:CC:DD:EE:02',
          vlan: '20',
          ports: [],
          status: 'online',
          powerWatts: 8,
          cameraSpecs: {
            resolution: '4MP',
            lensMm: 4,
            fovAngle: 90,
            irDistanceMeters: 30,
            nvrChannel: 1
          }
        }
      }
    };

    // 1. Batch 360° rotation normalizes negative & >=360 angles and skips locked nodes
    const rotated = applyNodesRotationToProject(proj, ['node_ap_test', 'node_cam_test', 'node_legend_test', 'node_locked_test'], -45);
    assert.equal(rotated.nodes.find(n => n.id === 'node_ap_test')?.rotation, 315);
    assert.equal(rotated.nodes.find(n => n.id === 'node_cam_test')?.rotation, 315);
    assert.equal(rotated.nodes.find(n => n.id === 'node_legend_test')?.rotation, 315);
    assert.equal(rotated.nodes.find(n => n.id === 'node_locked_test')?.rotation, 30);
    assert.equal(normalizeRotationDeg(405), 45);
    assert.equal(signedAngularDiffDeg(350, 10), 20);
    assert.equal(signedAngularDiffDeg(10, 350), -20);

    // 2. Atomic Wi-Fi update syncs node customData + asset.wifiSpecs & area/scale helpers match
    const radiusFrom150Pct = wifiRadiusFromScalePct(150);
    assert.equal(radiusFrom150Pct, 27);
    const updatedWifiProj = applyWifiCoverageToProject(rotated, 'node_ap_test', {
      radiusMeters: radiusFrom150Pct,
      angleDeg: 120
    });
    const updatedApNode = updatedWifiProj.nodes.find(n => n.id === 'node_ap_test')!;
    const updatedApAsset = updatedWifiProj.assets['asset_ap_test'];
    assert.equal(updatedApNode.customData?.coverageRadiusMeters, 27);
    assert.equal(updatedApNode.customData?.coverageAngleDeg, 120);
    assert.equal(updatedApAsset.wifiSpecs?.coverageRadiusMeters, 27);
    assert.equal(updatedApAsset.wifiSpecs?.coverageAngleDeg, 120);

    const resolvedWifi = resolveWifiCoverage(updatedApNode, updatedApAsset)!;
    assert.equal(resolvedWifi.isDirectional, true);
    assert.equal(resolvedWifi.scalePct, 150);
    assert.equal(resolvedWifi.areaSqm, computeSectorAreaSqm(27, 120));
    const derivedRadius = wifiRadiusFromAreaSqm(resolvedWifi.areaSqm, 120);
    assert.ok(Math.abs(derivedRadius - 27) <= 0.5);

    // 3. Atomic Camera FOV update syncs node customData + asset.cameraSpecs & area/scale helpers match
    const rangeFrom120Pct = cameraRangeFromScalePct(120);
    assert.equal(rangeFrom120Pct, 36);
    const updatedCamProj = applyCameraFovToProject(updatedWifiProj, 'node_cam_test', {
      fovAngle: 110,
      irDistanceMeters: rangeFrom120Pct
    });
    const updatedCamNode = updatedCamProj.nodes.find(n => n.id === 'node_cam_test')!;
    const updatedCamAsset = updatedCamProj.assets['asset_cam_test'];
    assert.equal(updatedCamNode.customData?.fov, 110);
    assert.equal(updatedCamNode.customData?.irDistance, 36);
    assert.equal(updatedCamAsset.cameraSpecs?.fovAngle, 110);
    assert.equal(updatedCamAsset.cameraSpecs?.irDistanceMeters, 36);

    const resolvedCam = resolveCameraFov(updatedCamNode, updatedCamAsset)!;
    assert.equal(resolvedCam.scalePct, 120);
    assert.equal(resolvedCam.areaSqm, computeSectorAreaSqm(36, 110));
    const derivedRange = cameraRangeFromAreaSqm(resolvedCam.areaSqm, 110);
    assert.ok(Math.abs(derivedRange - 36) <= 0.5);
  });

  await runTest('3D coverage gizmos & SVG export: angle/range/rotate handles & rotated Legend/Devices', () => {
    const base = createEnterpriseTopologyProject();
    const apNode: DiagramNode = {
      id: 'ap_3d_1',
      type: 'device',
      diagramMode: 'floorplan',
      assetId: 'ap_asset_1',
      label: 'AP-3D',
      x: 240,
      y: 200,
      width: 64,
      height: 64,
      rotation: 65,
      locked: false,
      style: { ...DEFAULT_STYLE }
    };
    const camNode: DiagramNode = {
      id: 'cam_3d_1',
      type: 'device',
      diagramMode: 'floorplan',
      assetId: 'cam_asset_1',
      label: 'CAM-3D',
      x: 440,
      y: 260,
      width: 64,
      height: 64,
      rotation: 135,
      locked: false,
      style: { ...DEFAULT_STYLE }
    };
    const legendNode: DiagramNode = {
      id: 'legend_rot_1',
      type: 'legend',
      diagramMode: 'floorplan',
      label: 'Chú giải xoay',
      x: 100,
      y: 420,
      width: 280,
      height: 160,
      rotation: 33,
      locked: false,
      style: { ...LEGEND_STYLE }
    };

    const proj: ProjectState = {
      ...base,
      settings: {
        ...base.settings,
        showCoverageRadius: true
      },
      nodes: [apNode, camNode, legendNode],
      cables: [],
      assets: {
        ap_asset_1: {
          id: 'ap_asset_1',
          assetTag: 'AP-3D-01',
          serialNumber: 'SN-AP-3D-01',
          name: 'AP 3D',
          category: 'ap',
          vendor: 'Ubiquiti',
          model: 'U6',
          ipAddress: '10.0.1.1',
          subnetMask: '255.255.255.0',
          gateway: '10.0.1.254',
          macAddress: 'AA:BB:CC:DD:EE:03',
          vlan: '1',
          ports: [],
          status: 'online',
          powerWatts: 15,
          wifiSpecs: {
            standard: 'Wi-Fi 6 (802.11ax)',
            bands: '2.4GHz + 5GHz',
            txPowerDbm: 20,
            coverageRadiusMeters: 20,
            coverageAngleDeg: 360,
            maxClients: 150,
            ssid: 'LAB'
          }
        },
        cam_asset_1: {
          id: 'cam_asset_1',
          assetTag: 'CAM-3D-01',
          serialNumber: 'SN-CAM-3D-01',
          name: 'CAM 3D',
          category: 'camera',
          vendor: 'Axis',
          model: 'P1455',
          ipAddress: '10.0.1.2',
          subnetMask: '255.255.255.0',
          gateway: '10.0.1.254',
          macAddress: 'AA:BB:CC:DD:EE:04',
          vlan: '20',
          ports: [],
          status: 'online',
          powerWatts: 10,
          cameraSpecs: {
            resolution: '4MP',
            lensMm: 4,
            fovAngle: 90,
            irDistanceMeters: 25,
            nvrChannel: 1
          }
        }
      }
    };

    // 1. Unlocked selected AP in 3D builds rotate + wifi-range + wifi-angle (360° pinch)
    const registry = new ThreeResourceRegistry();
    const apOverlay360 = buildNode3DCoverageAndGizmoOverlay(
      apNode,
      proj.assets.ap_asset_1,
      proj,
      {
        selectType: 'node',
        selectId: apNode.id,
        label: apNode.label,
        isSelected: true,
        isLocked: false,
        interactiveUnlocked: true,
        ringRadius: 1
      }
    );
    const apActions360 = collectGizmoActions(apOverlay360);
    assert.ok(apActions360.includes('rotate'));
    assert.ok(apActions360.includes('wifi-range'));
    assert.ok(apActions360.includes('wifi-angle'));

    // 2. Directional AP builds both left and right angle wing gizmos
    const directionalApProj = applyWifiCoverageToProject(proj, apNode.id, { angleDeg: 110 });
    const dirApNode = directionalApProj.nodes.find(n => n.id === apNode.id)!;
    const apOverlayDir = buildNode3DCoverageAndGizmoOverlay(
      dirApNode,
      directionalApProj.assets.ap_asset_1,
      directionalApProj,
      {
        selectType: 'node',
        selectId: dirApNode.id,
        label: dirApNode.label,
        isSelected: true,
        isLocked: false,
        interactiveUnlocked: true,
        ringRadius: 1
      }
    );
    const dirAngleHandles = collectNamedGizmos(apOverlayDir, 'gizmo_wifi_angle_');
    assert.deepEqual(dirAngleHandles.sort(), ['gizmo_wifi_angle_left', 'gizmo_wifi_angle_right']);

    // 3. Camera FOV in 3D builds rotate + camera-range + 2 camera-angle wings
    const camOverlay = buildNode3DCoverageAndGizmoOverlay(
      camNode,
      proj.assets.cam_asset_1,
      proj,
      {
        selectType: 'node',
        selectId: camNode.id,
        label: camNode.label,
        isSelected: true,
        isLocked: false,
        interactiveUnlocked: true,
        ringRadius: 1
      }
    );
    const camActions = collectGizmoActions(camOverlay);
    assert.ok(camActions.includes('rotate'));
    assert.ok(camActions.includes('camera-range'));
    const camAngleHandles = collectNamedGizmos(camOverlay, 'gizmo_camera_angle_');
    assert.deepEqual(camAngleHandles.sort(), ['gizmo_camera_angle_left', 'gizmo_camera_angle_right']);

    // 4. Refreshing world group preserves rotation & hides BOTH Wi-Fi and Camera overlays when showCoverageRadius = false
    const worldRoot = new THREE.Group();
    const populated = populateInfrastructure3DWorld(worldRoot, proj, camNode.id, {
      showRooms: true,
      showCables: false,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: new THREE.Texture(),
      interactiveUnlocked: true,
      registry
    });
    const camGroup = populated.nodeGroups.get(camNode.id)!.group;
    assert.ok(Math.abs(camGroup.rotation.y - (-135 * Math.PI) / 180) < 1e-4);

    const hiddenOverlayProj: ProjectState = {
      ...proj,
      settings: { ...proj.settings, showCoverageRadius: false }
    };
    refreshNode3DCoverageAndGizmos(camGroup, camNode, hiddenOverlayProj.assets.cam_asset_1, hiddenOverlayProj, {
      isSelected: true,
      isLocked: false,
      interactiveUnlocked: true
    });
    const camHiddenActions = collectGizmoActions(camGroup);
    assert.ok(camHiddenActions.includes('rotate'));
    assert.equal(camHiddenActions.includes('camera-range'), false);
    assert.equal(camHiddenActions.includes('camera-angle'), false);
    registry.disposeAll();

    // 5. Pure SVG Export rotates Legend, Camera, and AP nodes matching 2D & 3D
    const svg = generatePureSvgMarkup(proj, { darkTheme: false, includeTitleBlock: false });
    assert.ok(svg.includes('rotate(33 '));
    assert.ok(svg.includes('rotate(65 '));
    assert.ok(svg.includes('rotate(135 '));
  });
}

runStandaloneSuite(import.meta.url, runCoverageAndRotationSyncTests);
