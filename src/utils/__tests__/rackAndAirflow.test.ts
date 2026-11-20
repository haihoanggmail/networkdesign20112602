import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  STANDARD_RACK_UNITS,
  ServerRack,
  DeviceAsset
} from '../../types/infrastructure';
import {
  build3DCableGeometry,
  disposeObjectTree,
  populateInfrastructure3DWorld
} from '../../components/canvas/three/proceduralDevices';
import {
  canPlaceDeviceAtU,
  findNearestAvailableU,
  getRackStatistics,
  clampRackUnits,
  CANVAS_RACK_COLLAPSED_H,
  isRackNodeCollapsed,
  getEffectiveRackDisplayHeight
} from '../rackGeometry';
import {
  analyzeRackAirflow,
  classifyTempRisk,
  computeRackThermalOverlayData,
  getSubDeviceThermalReading,
  thermalHeatToColor
} from '../rackAirflow';
import {
  getRackDimensions3D,
  uSlotToCenterY,
  UNIT_HEIGHT_M
} from '../../components/rack/rack3DGeometry';
import { createServerRackProject } from '../../data/templates';
import type { ProjectState } from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runRackAndAirflowTests(runTest: TestFn): Promise<void> {
  // 1. Rack Geometry Tests
  await runTest('rackGeometry: supports standard rack units and clamps bounds', () => {
    assert.ok(STANDARD_RACK_UNITS.includes(6));
    assert.ok(STANDARD_RACK_UNITS.includes(42));
    assert.ok(STANDARD_RACK_UNITS.includes(45));
    assert.equal(clampRackUnits(2), 4);
    assert.equal(clampRackUnits(100), 60);
    assert.equal(clampRackUnits(27), 27);
  });

  await runTest('rackGeometry: isolates Front/Rear mounting & blocks multi-U collisions', () => {
    const rack: ServerRack = {
      id: 'rk_test',
      name: 'Test Rack 12U',
      totalUnits: 12,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 100,
      x: 100,
      y: 100,
      slots: { 5: 'srv_2u' },
      rearSlots: { 5: 'pdu_1u' }
    };

    const assets: Record<string, DeviceAsset> = {
      srv_2u: {
        id: 'srv_2u',
        name: 'Server-2U',
        category: 'server',
        vendor: 'Dell',
        model: 'R750',
        assetTag: 'AST-01',
        serialNumber: 'SN01',
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: '00:11:22:33:44:55',
        vlan: '10',
        status: 'online',
        rackId: 'rk_test',
        rackUnitStart: 5,
        rackUnitHeight: 2,
        rackSide: 'front',
        powerWatts: 450,
        weightKg: 70,
        ports: []
      },
      pdu_1u: {
        id: 'pdu_1u',
        name: 'PDU-Rear',
        category: 'pdu',
        vendor: 'APC',
        model: 'AP8959',
        assetTag: 'AST-02',
        serialNumber: 'SN02',
        ipAddress: '10.0.0.11',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: '00:11:22:33:44:56',
        vlan: '10',
        status: 'online',
        rackId: 'rk_test',
        rackUnitStart: 5,
        rackUnitHeight: 1,
        rackSide: 'rear',
        powerWatts: 50,
        weightKg: 45,
        ports: []
      }
    };

    // Front slots 5 & 6 are occupied by srv_2u
    assert.equal(canPlaceDeviceAtU(rack, assets, 5, 1, undefined, 'front'), false);
    assert.equal(canPlaceDeviceAtU(rack, assets, 6, 1, undefined, 'front'), false);
    assert.equal(canPlaceDeviceAtU(rack, assets, 4, 2, undefined, 'front'), false); // overlaps U5
    assert.equal(canPlaceDeviceAtU(rack, assets, 3, 2, undefined, 'front'), true);  // U3-U4 free
    assert.equal(canPlaceDeviceAtU(rack, assets, 7, 1, undefined, 'front'), true);  // U7 free

    // Rear side U6 is free even though Front U6 is occupied
    assert.equal(canPlaceDeviceAtU(rack, assets, 6, 1, undefined, 'rear'), true);
    assert.equal(canPlaceDeviceAtU(rack, assets, 5, 1, undefined, 'rear'), false);

    // Nearest free U near 5 for 2U on front should jump to U7 or U3
    const nearest = findNearestAvailableU(rack, assets, 5, 2, undefined, 'front');
    assert.ok(nearest === 7 || nearest === 3);

    // Statistics: 2U front, 1U rear, total 70 + 45 = 115kg (>100kg overweight)
    const stats = getRackStatistics(rack, assets);
    assert.equal(stats.frontUsedUnits, 2);
    assert.equal(stats.frontFreeUnits, 10);
    assert.equal(stats.rearUsedUnits, 1);
    assert.equal(stats.totalPowerWatts, 500);
    assert.equal(stats.isOverweight, true);
    assert.equal(stats.overflowItems.length, 0);

    // Overflow detection
    rack.slots[12] = 'srv_2u'; // 2U starting at U12 exceeds 12U
    const overflowStats = getRackStatistics(rack, assets);
    assert.ok(overflowStats.overflowItems.length > 0);
  });

  await runTest('3D Rack Dimensions, U-Slot Mapping & Ventilation/Airflow Analysis', () => {
    const rack42: ServerRack = {
      id: 'rack_test_vent',
      name: 'Rack Server 42U',
      totalUnits: 42,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 1200,
      x: 100,
      y: 100,
      slots: {
        1: 'srv_1',
        3: 'srv_2',
        5: 'srv_3',
        30: 'ups_high'
      },
      rearSlots: {
        40: 'pdu_rear'
      }
    };

    const makeDev = (
      id: string,
      name: string,
      category: DeviceAsset['category'],
      uHeight: number,
      powerWatts: number
    ): DeviceAsset => ({
      id,
      name,
      category,
      vendor: 'Dell',
      model: 'R760',
      assetTag: `TAG-${id}`,
      serialNumber: `SN-${id}`,
      ipAddress: '10.0.0.1',
      macAddress: '00:11:22:33:44:55',
      subnetMask: '255.255.255.0',
      gateway: '10.0.0.254',
      vlan: '10',
      status: 'online',
      rackUnitHeight: uHeight,
      powerWatts,
      weightKg: 20,
      ports: []
    });

    const testAssets: Record<string, DeviceAsset> = {
      srv_1: makeDev('srv_1', 'Node-01', 'server', 2, 950),
      srv_2: makeDev('srv_2', 'Node-02', 'server', 2, 950),
      srv_3: makeDev('srv_3', 'Node-03', 'server', 2, 950),
      ups_high: makeDev('ups_high', 'UPS High', 'ups', 2, 450),
      pdu_rear: makeDev('pdu_rear', 'Rear PDU', 'pdu', 1, 20)
    };

    // Metric geometry checks
    const dims = getRackDimensions3D(rack42);
    assert.equal(dims.totalUnits, 42);
    assert.ok(Math.abs(dims.width - 0.8) < 0.001);
    assert.ok(Math.abs(dims.depth - 1.0) < 0.001);
    assert.ok(uSlotToCenterY(10, 2) > uSlotToCenterY(1, 2));
    assert.ok(Math.abs(uSlotToCenterY(2, 1) - uSlotToCenterY(1, 1) - UNIT_HEIGHT_M) < 0.0001);

    // Airflow analysis with perforated door & 4 fans vs choked glass door & 0 fans
    const perforatedRes = analyzeRackAirflow(rack42, testAssets, {
      doorType: 'perforated',
      fanCount: 4
    });
    assert.equal(perforatedRes.totalWatts, 3320);
    assert.ok(perforatedRes.totalBtuPerHour > 11000);
    assert.ok(perforatedRes.hotspots.length >= 1, 'Dense stacked 950W servers should flag hotspot');
    assert.ok(
      perforatedRes.bypassGaps.some(g => g.startU === 7 && g.endU === 29),
      'Large U7-U29 open gap should flag unblanked bypass recirculation'
    );
    assert.ok(
      perforatedRes.recommendations.some(r => r.id.startsWith('high_ups_')),
      'UPS mounted at U30 should trigger high-center-of-gravity warning'
    );

    const glassChokedRes = analyzeRackAirflow(rack42, testAssets, {
      doorType: 'glass',
      fanCount: 0
    });
    assert.equal(glassChokedRes.status, 'critical');
    assert.ok(glassChokedRes.effectiveCoolingCfm < perforatedRes.effectiveCoolingCfm);
    assert.ok(glassChokedRes.estimatedExhaustTempC > perforatedRes.estimatedExhaustTempC);
  });

  // 62. Rack Node Collapse & Conditional Sub-Device LOD Optimization (.rack-node-container)
  await runTest('rackGeometry & proceduralDevices: reduces sub-device LOD when rack node is collapsed and scales cable/rack detail by renderQuality', () => {
    const base = createServerRackProject();
    const rackNode = base.nodes.find(n => n.type === 'rack');
    assert.ok(rackNode, 'Expected rack node in server rack project');
    assert.equal(isRackNodeCollapsed(rackNode), false);
    assert.equal(getEffectiveRackDisplayHeight(rackNode), rackNode.height);

    const collapsedRackNode = {
      ...rackNode,
      customData: { ...(rackNode.customData || {}), collapsed: true }
    };
    assert.equal(isRackNodeCollapsed(collapsedRackNode), true);
    assert.equal(getEffectiveRackDisplayHeight(collapsedRackNode), CANVAS_RACK_COLLAPSED_H);

    const dummyTex = new THREE.Texture();
    const expandedProj: ProjectState = {
      ...base,
      activeMode: 'rack'
    };
    const expandedRoot = new THREE.Group();
    const expandedPop = populateInfrastructure3DWorld(expandedRoot, expandedProj, undefined, {
      showRooms: false,
      showCables: false,
      explodeSpread: 0,
      castShadow: true,
      shadowTex: dummyTex,
      lockBadgeTex: dummyTex,
      renderQuality: 'high'
    });

    const collapsedProj: ProjectState = {
      ...expandedProj,
      nodes: expandedProj.nodes.map(n =>
        n.id === rackNode.id ? collapsedRackNode : n
      )
    };
    const collapsedRoot = new THREE.Group();
    const collapsedPop = populateInfrastructure3DWorld(collapsedRoot, collapsedProj, undefined, {
      showRooms: false,
      showCables: false,
      explodeSpread: 0,
      castShadow: true,
      shadowTex: dummyTex,
      lockBadgeTex: dummyTex,
      renderQuality: 'high'
    });

    const expandedGroup = expandedPop.nodeGroups.get(rackNode.id)?.group;
    const collapsedGroup = collapsedPop.nodeGroups.get(rackNode.id)?.group;
    assert.ok(expandedGroup && collapsedGroup);
    assert.equal(expandedGroup.userData.rackCollapsed, false);
    assert.equal(collapsedGroup.userData.rackCollapsed, true);
    assert.equal(collapsedGroup.userData.lodLevel, 'collapsed');

    const countMeshes = (root: THREE.Object3D) => {
      let total = 0;
      let leds = 0;
      let proxies = 0;
      root.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          total += 1;
          if (obj.name === 'subdevice_led') leds += 1;
          if (obj.name === 'subdevice_proxy_lod' && obj.userData?.subDeviceLod === 'collapsed') proxies += 1;
        }
      });
      return { total, leds, proxies };
    };

    const expandedStats = countMeshes(expandedGroup);
    const collapsedStats = countMeshes(collapsedGroup);
    assert.ok(expandedStats.leds > 0, 'Expanded rack should render detailed sub-device LEDs');
    assert.equal(collapsedStats.leds, 0, 'Collapsed rack must skip per-device LED sub-meshes');
    assert.ok(collapsedStats.proxies > 0, 'Collapsed rack should render lightweight proxy blades');
    assert.ok(
      collapsedStats.total < expandedStats.total,
      `Collapsed rack mesh count (${collapsedStats.total}) must be lower than expanded (${expandedStats.total})`
    );

    // Low quality cable LOD builds fewer tubular segments than high quality
    const cableStub = { routingType: 'orthogonal' as const, strokeWidth: 2 };
    const highGeo = build3DCableGeometry(
      cableStub,
      { x: 0, z: 0 },
      { x: 3, z: 2 },
      false,
      false,
      0,
      1,
      0,
      undefined,
      false,
      0,
      0,
      'high'
    );
    const lowGeo = build3DCableGeometry(
      cableStub,
      { x: 0, z: 0 },
      { x: 3, z: 2 },
      false,
      false,
      0,
      1,
      0,
      undefined,
      false,
      0,
      0,
      'low'
    );
    assert.ok(
      lowGeo.attributes.position.count < highGeo.attributes.position.count,
      'Low render quality should produce fewer cable vertices than high render quality'
    );

    highGeo.dispose();
    lowGeo.dispose();
    disposeObjectTree(expandedRoot, new Set([dummyTex]));
    disposeObjectTree(collapsedRoot, new Set([dummyTex]));
    dummyTex.dispose();
  });

  // 64. Rack 3D Thermal Sensor Heatmaps, Sub-Device Hover Specs Metadata & Toggle/LOD Behavior
  await runTest('rackAirflow + proceduralDevices: computes rack sensor heatmaps and renders toggleable 3D thermal overlays with blade metadata', () => {
    const rackProj = createServerRackProject();
    const rack = rackProj.racks[0];
    const rackNode = rackProj.nodes.find(n => n.type === 'rack');
    assert.ok(rack && rackNode, 'Server rack template should provide a rack and rack node');

    // Attach explicit rack sensor telemetry + a rack-mounted sensor DeviceAsset
    const sensorAssetId = 'ast_rack_sensor_probe';
    rackProj.assets[sensorAssetId] = {
      id: sensorAssetId,
      name: 'Temp Probe Top-U40',
      category: 'sensor',
      vendor: 'APC',
      model: 'AP9335TH',
      assetTag: 'AST-SNS-40',
      serialNumber: 'SN-SNS-40',
      ipAddress: '10.0.0.240',
      subnetMask: '255.255.255.0',
      gateway: '10.0.0.1',
      macAddress: '00:11:22:33:44:99',
      vlan: '10',
      status: 'online',
      rackId: rack.id,
      rackUnitStart: 40,
      rackUnitHeight: 1,
      powerWatts: 3,
      sensorSpecs: {
        temperatureC: 41.2,
        humidityPct: 48,
        probeLocation: 'exhaust',
        warningTempC: 35,
        criticalTempC: 40
      },
      ports: []
    };
    rack.slots[40] = sensorAssetId;
    rack.sensors = [
      { id: 's_intake', label: 'Cảm biến cửa trước', zone: 'intake', u: 4, temperatureC: 23.5, humidityPct: 45 },
      { id: 's_mid', label: 'Cảm biến giữa tủ', zone: 'mid', u: 22, temperatureC: 31.0 }
    ];

    const thermal = computeRackThermalOverlayData(rack, rackProj.assets, rackNode);
    assert.equal(thermal.hasHardwareSensors, true);
    assert.equal(thermal.sensors.length, 3);
    assert.ok(thermal.peakTempC >= 41.2, 'Peak temp must reflect explicit hot exhaust sensor');
    assert.equal(classifyTempRisk(thermal.peakTempC), 'hot');
    assert.equal(thermal.unitReadings.length, rack.totalUnits);

    const lowUReading = thermal.unitReadings.find(r => r.u === 4)!;
    const highUReading = thermal.unitReadings.find(r => r.u === 40)!;
    assert.ok(highUReading.tempC > lowUReading.tempC, 'Upper sensor zone should be warmer than intake');
    assert.ok(thermalHeatToColor(highUReading.heatNorm, highUReading.zone).startsWith('#'));

    const firstSlotU = Number(Object.keys(rack.slots)[0] || 1);
    const firstSlotReading = getSubDeviceThermalReading(thermal, firstSlotU, 1);
    assert.ok(firstSlotReading.tempC >= 18 && firstSlotReading.tempC <= 65);

    // Also test fallback calculated probes when rack has no explicit sensors
    const projFallback = createServerRackProject();
    const fallbackThermal = computeRackThermalOverlayData(projFallback.racks[0], projFallback.assets);
    assert.equal(fallbackThermal.hasHardwareSensors, false);
    assert.ok(fallbackThermal.sensors.length >= 2);

    // Populate 3D world with thermal heatmap enabled vs disabled and verify blade metadata
    const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    dummyTex.needsUpdate = true;

    rackProj.assets['ast_rear_pdu_test'] = {
      id: 'ast_rear_pdu_test',
      name: 'Rear Vertical PDU',
      category: 'pdu',
      vendor: 'APC',
      model: 'AP8853',
      assetTag: 'AST-PDU-R1',
      serialNumber: 'SN-PDU-R1',
      ipAddress: '10.0.0.241',
      subnetMask: '255.255.255.0',
      gateway: '10.0.0.1',
      macAddress: '00:11:22:33:44:98',
      vlan: '10',
      status: 'online',
      rackId: rack.id,
      rackSide: 'rear',
      rackUnitStart: 10,
      rackUnitHeight: 1,
      powerWatts: 15,
      weightKg: 4.5,
      ports: []
    };
    rack.rearSlots = { ...(rack.rearSlots || {}), 10: 'ast_rear_pdu_test' };

    const heatOnRoot = new THREE.Group();
    const heatOnPop = populateInfrastructure3DWorld(heatOnRoot, rackProj, undefined, {
      showRooms: true,
      showCables: false,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: dummyTex,
      renderQuality: 'high',
      showThermalHeatmap: true
    });
    const heatOnRackGrp = heatOnPop.nodeGroups.get(rackNode.id)?.group;
    assert.ok(heatOnRackGrp);
    let hasThermalGroup = false;
    let bladeWithMetadataCount = 0;
    let hasRearBlade = false;
    heatOnRackGrp.traverse(obj => {
      if (obj.name === 'thermal_heatmap_overlay') hasThermalGroup = true;
      if (obj instanceof THREE.Mesh && obj.userData?.subDeviceAssetId) {
        bladeWithMetadataCount += 1;
        assert.equal(typeof obj.userData.subDeviceTempC, 'number');
        assert.ok(obj.userData.subDeviceZone);
        if (obj.userData.subDeviceSide === 'rear' && obj.userData.subDeviceAssetId === 'ast_rear_pdu_test') {
          hasRearBlade = true;
        }
      }
    });
    assert.equal(hasThermalGroup, true, '3D rack must include thermal_heatmap_overlay when showThermalHeatmap is true');
    assert.ok(bladeWithMetadataCount > 0, '3D rack sub-device blades must carry asset & thermal hover metadata');
    assert.equal(hasRearBlade, true, '3D rack must also include rear-mounted sub-device blade metadata');

    const heatOffRoot = new THREE.Group();
    const heatOffPop = populateInfrastructure3DWorld(heatOffRoot, rackProj, undefined, {
      showRooms: true,
      showCables: false,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: dummyTex,
      renderQuality: 'high',
      showThermalHeatmap: false
    });
    const heatOffRackGrp = heatOffPop.nodeGroups.get(rackNode.id)?.group;
    assert.ok(heatOffRackGrp);
    let heatOffFound = false;
    heatOffRackGrp.traverse(obj => {
      if (obj.name === 'thermal_heatmap_overlay') heatOffFound = true;
    });
    assert.equal(heatOffFound, false, '3D rack must omit thermal_heatmap_overlay when showThermalHeatmap is false');

    disposeObjectTree(heatOnRoot, new Set([dummyTex]));
    disposeObjectTree(heatOffRoot, new Set([dummyTex]));
    dummyTex.dispose();
  });
}

runStandaloneSuite(import.meta.url, runRackAndAirflowTests);
