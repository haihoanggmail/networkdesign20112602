import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildFloorElevationPlan,
  buildRackLookupIndex,
  computeWorldOriginFromBounds,
  createCoordinateTransform,
  isTopologyShadowMountedInRack,
  LEGACY_CUTAWAY_FLOOR_STEP_UNITS,
  LEGACY_WORLD_SCALE,
  projectCableRouteTo3D,
  resolveCableTrayWidthMeters,
  resolveCableTrayWidthWorld,
  resolveDevicePhysicalDimensions,
  resolveNodeFloorAndElevation,
  resolveNodeFloorId,
  resolveNodePivotCenter,
  resolveRackForDiagramNode,
  resolveRackPhysicalDimensions,
  resolveRoomPhysicalDimensions,
  resolveRoomWorldDimensions,
  rotationDegToThreeYRad,
  sampleSvgPath2D,
  threeYRadToRotationDeg
} from '../../engineering';
import {
  build3DCableCurve,
  canvasToWorldXZ,
  computeWorldOrigin,
  disposeObjectTree,
  populateInfrastructure3DWorld,
  WORLD_SCALE,
  worldXZToCanvas
} from '../../components/canvas/three/proceduralDevices';
import { applyCommitMovedNodesToProject } from '../../store/slices/useNodesSlice';
import { getRackDimensions3D } from '../../components/rack/rack3DGeometry';
import {
  computeCableBundleLayout,
  computeCablePath
} from '../cableRouting';
import {
  cadPointToNetworkCanvas,
  networkCanvasToCadPoint
} from '../../cad/core/CADUnderlayTransform';
import { createEmptyCADDocument } from '../../cad/core/CADDocument';
import { generatePureSvgMarkup } from '../svgExport';
import { generateProjectDxf } from '../dxfExporter';
import { computeProjectBomStats } from '../bomAggregator';
import { buildTechnicalPdfArtifact } from '../pdfExporter';
import { migrateAndValidateProject } from '../projectStorage';
import {
  createEnterpriseTopologyProject,
  createMultiFloorSampleOfficeProject
} from '../../data/templates';
import { createHachihi2BuildingProject } from '../../data/hachihi2BuildingTemplate';
import { CANVAS_RACK_COLLAPSED_H } from '../rackGeometry';
import type { CableEdge, DiagramNode, ProjectState } from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runEngineeringSyncParityTests(runTest: TestFn): Promise<void> {
  // 1. Coordinate Transform & Scale Matrix (30 / 48 / custom / sub-5 px/m)
  await runTest('engineeringSync: CoordinateTransform round-trips 2D<->3D across 30, 48, 15, and 0.2 px/m scales', () => {
    const proj = createEnterpriseTopologyProject();
    const originLegacy = computeWorldOrigin(proj.nodes, proj.rooms);
    const originEng = computeWorldOriginFromBounds(proj.nodes, proj.rooms);
    assert.ok(Math.abs(originLegacy.centerX - originEng.centerX) < 1e-6);
    assert.ok(Math.abs(originLegacy.centerY - originEng.centerY) < 1e-6);

    const scales = [30, 48, 15, 0.2];
    const samplePoints = [
      { x: 0, y: 0 },
      { x: originEng.centerX, y: originEng.centerY },
      { x: 942.5, y: 318.25 },
      { x: -120, y: 1450 }
    ];

    for (const scale of scales) {
      // Legacy world scale mode matches existing proceduralDevices exactly
      const tfLegacy = createCoordinateTransform({
        pixelsPerMeter: scale,
        origin: originEng,
        mode: 'legacy_world_scale'
      });
      assert.equal(tfLegacy.worldUnitsPerPixel, WORLD_SCALE);
      assert.equal(LEGACY_WORLD_SCALE, WORLD_SCALE);

      for (const pt of samplePoints) {
        const wEng = tfLegacy.canvasToWorld(pt, 1.25);
        const wProc = canvasToWorldXZ(pt.x, pt.y, originLegacy);
        assert.ok(Math.abs(wEng.x - wProc.x) < 1e-9);
        assert.ok(Math.abs(wEng.z - wProc.z) < 1e-9);
        assert.equal(wEng.y, 1.25);

        const cBackEng = tfLegacy.worldToCanvas(wEng);
        const cBackProc = worldXZToCanvas(wProc.x, wProc.z, originLegacy);
        assert.ok(Math.abs(cBackEng.x - pt.x) < 1e-6);
        assert.ok(Math.abs(cBackEng.y - pt.y) < 1e-6);
        assert.ok(Math.abs(cBackEng.x - cBackProc.x) < 1e-6);
        assert.ok(Math.abs(cBackEng.y - cBackProc.y) < 1e-6);
      }

      // Physical meters mode maps 1 world unit = 1 meter according to project scale
      const tfPhys = createCoordinateTransform({
        pixelsPerMeter: scale,
        origin: originEng,
        mode: 'physical_meters'
      });
      assert.ok(Math.abs(tfPhys.metersToWorld(12.5) - 12.5) < 1e-9);
      assert.ok(Math.abs(tfPhys.worldToMeters(tfPhys.metersToWorld(12.5)) - 12.5) < 1e-9);
      assert.ok(Math.abs(tfPhys.pixelsToMeters(tfPhys.metersToPixels(7.4)) - 7.4) < 1e-6);

      for (const pt of samplePoints) {
        const wPhys = tfPhys.canvasToWorld(pt, 3.6);
        const cPhys = tfPhys.worldToCanvas(wPhys);
        assert.ok(Math.abs(cPhys.x - pt.x) < 1e-5);
        assert.ok(Math.abs(cPhys.y - pt.y) < 1e-5);
      }
    }
  });

  // 2. Floor Elevation, Physical Height vs Explode Spread & Floor Fallback Resolution
  await runTest('engineeringSync: FloorElevationResolver separates physical meters from explodeSpread and resolves floor fallback chain', () => {
    const h2 = createHachihi2BuildingProject();
    const customBuilding = {
      ...h2.buildings[0],
      floorHeightMeters: 4.2
    };
    const floors = [
      { id: 'flr_b1', buildingId: customBuilding.id, level: -1, name: 'B1', description: '', widthMeters: 30, depthMeters: 20 },
      { id: 'flr_1', buildingId: customBuilding.id, level: 1, name: 'T1', description: '', widthMeters: 30, depthMeters: 20 },
      { id: 'flr_2', buildingId: customBuilding.id, level: 2, name: 'T2', description: '', widthMeters: 30, depthMeters: 20 }
    ];

    const planZero = buildFloorElevationPlan(
      { buildings: [customBuilding], activeBuildingId: customBuilding.id, floors },
      { isMultiFloorCutaway: true, explodeSpread: 0, usePhysicalFloorHeight: true }
    );
    const planExploded = buildFloorElevationPlan(
      { buildings: [customBuilding], activeBuildingId: customBuilding.id, floors },
      { isMultiFloorCutaway: true, explodeSpread: 1.5, usePhysicalFloorHeight: true }
    );

    // Physical floor heights stay invariant regardless of visual explodeSpread
    assert.equal(planZero.byFloorId.get('flr_b1')!.physicalElevationMeters, 0);
    assert.equal(planZero.byFloorId.get('flr_1')!.physicalElevationMeters, 2 * 4.2); // level -1 -> +1 spans 2 levels
    assert.equal(planZero.byFloorId.get('flr_2')!.physicalElevationMeters, 3 * 4.2);
    assert.equal(
      planExploded.byFloorId.get('flr_1')!.physicalElevationMeters,
      planZero.byFloorId.get('flr_1')!.physicalElevationMeters
    );
    assert.equal(planZero.byFloorId.get('flr_2')!.visualExplodeOffsetMeters, 0);
    assert.ok(planExploded.byFloorId.get('flr_2')!.visualExplodeOffsetMeters > 0);
    assert.ok(
      planExploded.byFloorId.get('flr_2')!.displayElevationY >
      planExploded.byFloorId.get('flr_2')!.physicalElevationMeters
    );

    // Legacy cutaway baseline check (3.25 step)
    const planLegacy = buildFloorElevationPlan(
      { buildings: [customBuilding], activeBuildingId: customBuilding.id, floors },
      { isMultiFloorCutaway: true, explodeSpread: 0, usePhysicalFloorHeight: false }
    );
    assert.equal(planLegacy.byFloorId.get('flr_1')!.displayElevationY, LEGACY_CUTAWAY_FLOOR_STEP_UNITS);

    // Fallback chain: node.floorId -> rack.floorId -> room.floorId -> asset.floorId -> activeFloorId
    const rackOnFloor2 = {
      id: 'rk_f2',
      name: 'RACK-F2',
      floorId: 'flr_2',
      roomId: 'rm_f1',
      totalUnits: 42,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 1000,
      x: 100,
      y: 100,
      slots: {}
    };
    const roomOnFloor1 = {
      id: 'rm_f1',
      floorId: 'flr_1',
      name: 'Room 1',
      type: 'server_room' as const,
      x: 50,
      y: 50,
      width: 300,
      height: 200,
      color: '#f8fafc',
      wallThickness: 6
    };
    const projStub: Pick<ProjectState, 'assets' | 'racks' | 'rooms' | 'activeFloorId'> = {
      activeFloorId: 'flr_b1',
      racks: [rackOnFloor2],
      rooms: [roomOnFloor1],
      assets: {
        a_room_only: {
          id: 'a_room_only',
          assetTag: 'A1',
          serialNumber: 'S1',
          name: 'Room Inherited',
          category: 'switch',
          vendor: 'Cisco',
          model: 'C9200',
          ipAddress: '',
          subnetMask: '',
          gateway: '',
          macAddress: '',
          vlan: '',
          ports: [],
          status: 'online',
          powerWatts: 50,
          roomId: 'rm_f1'
        },
        a_asset_only: {
          id: 'a_asset_only',
          assetTag: 'A2',
          serialNumber: 'S2',
          name: 'Asset Floor',
          category: 'ap',
          vendor: 'Ubiquiti',
          model: 'U6',
          ipAddress: '',
          subnetMask: '',
          gateway: '',
          macAddress: '',
          vlan: '',
          ports: [],
          status: 'online',
          powerWatts: 15,
          floorId: 'flr_2'
        }
      }
    };

    const nodeFromRack = resolveNodeFloorId(
      { id: 'n_rk', type: 'rack', label: 'RACK-F2', customData: { rackId: 'rk_f2' } },
      projStub
    );
    assert.deepEqual(nodeFromRack, { floorId: 'flr_2', source: 'rack' });

    const nodeFromRoom = resolveNodeFloorId(
      { id: 'n_rm', type: 'device', label: 'SW', assetId: 'a_room_only' },
      projStub
    );
    assert.deepEqual(nodeFromRoom, { floorId: 'flr_1', source: 'room' });

    const nodeFromAsset = resolveNodeFloorId(
      { id: 'n_as', type: 'device', label: 'AP', assetId: 'a_asset_only', customData: { elevationZ: 2.8 } },
      projStub
    );
    assert.deepEqual(nodeFromAsset, { floorId: 'flr_2', source: 'asset' });

    const resolvedElev = resolveNodeFloorAndElevation(
      { id: 'n_as', type: 'device', label: 'AP', assetId: 'a_asset_only', customData: { elevationZ: 2.8 } },
      projStub,
      planExploded
    );
    assert.ok(Math.abs(resolvedElev.physicalWorldY - (3 * 4.2 + 2.8)) < 1e-6);
    assert.ok(resolvedElev.displayWorldY > resolvedElev.physicalWorldY);
  });

  // 3. Rotation Convention & Collapsed Rack Pivot Parity
  await runTest('engineeringSync: rotationDegToThreeYRad matches 2D clockwise +X=0° and resolves collapsed rack pivot safely', () => {
    const angles = [0, 45, 90, 135, 180, 270, 315, -45, 405];
    for (const deg of angles) {
      const yRad = rotationDegToThreeYRad(deg);
      const degBack = threeYRadToRotationDeg(yRad);
      const expected = ((deg % 360) + 360) % 360;
      assert.ok(Math.abs(degBack - expected) < 1e-6);

      // Verify local +X vector rotated by yRad in Three.js points to (cos θ, 0, +sin θ) = 2D (cos θ, sin θ)
      const v = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yRad);
      const expectedRad = (expected * Math.PI) / 180;
      assert.ok(Math.abs(v.x - Math.cos(expectedRad)) < 1e-6);
      assert.ok(Math.abs(v.z - Math.sin(expectedRad)) < 1e-6);
    }

    const collapsedRack: Pick<DiagramNode, 'type' | 'x' | 'y' | 'width' | 'height' | 'customData'> = {
      type: 'rack',
      x: 200,
      y: 100,
      width: 300,
      height: 656,
      customData: { collapsed: true }
    };
    const pivot = resolveNodePivotCenter(collapsedRack);
    assert.equal(pivot.isCollapsedRack, true);
    assert.equal(pivot.display2DHeight, CANVAS_RACK_COLLAPSED_H);
    assert.deepEqual(pivot.canonicalCenter, { x: 350, y: 100 + 656 / 2 });
    assert.deepEqual(pivot.display2DCenter, { x: 350, y: 100 + CANVAS_RACK_COLLAPSED_H / 2 });
  });

  // 4. Physical Dimensions Parity (Rack, Room, CableTray, Device)
  await runTest('engineeringSync: PhysicalDimensionResolver unifies Rack mm, Room m, and CableTray width across scales', () => {
    const rack800 = { totalUnits: 42, widthMm: 800, depthMm: 1000 };
    const rackPhys = resolveRackPhysicalDimensions(rack800);
    const rack3DGeo = getRackDimensions3D({
      id: 'r1',
      name: 'R1',
      totalUnits: 42,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 1000,
      x: 0,
      y: 0,
      slots: {}
    });
    assert.equal(rackPhys.widthMeters, rack3DGeo.width);
    assert.equal(rackPhys.depthMeters, rack3DGeo.depth);
    assert.ok(Math.abs(rackPhys.heightMeters - rack3DGeo.cabinetHeight) < 1e-6);

    const room = { width: 300, height: 180 };
    const roomPhys30 = resolveRoomPhysicalDimensions(room, 30);
    assert.equal(roomPhys30.widthMeters, 10);
    assert.equal(roomPhys30.depthMeters, 6);

    const tfPhys30 = createCoordinateTransform({ pixelsPerMeter: 30, mode: 'physical_meters' });
    const roomWorld30 = resolveRoomWorldDimensions(room, tfPhys30);
    assert.equal(roomWorld30.widthWorld, 10);
    assert.equal(roomWorld30.depthWorld, 6);

    const tfPhysSub5 = createCoordinateTransform({ pixelsPerMeter: 0.2, mode: 'physical_meters' });
    const roomWorldSub5 = resolveRoomWorldDimensions({ width: 20, height: 10 }, tfPhysSub5);
    assert.equal(roomWorldSub5.widthWorld, 100);
    assert.equal(roomWorldSub5.depthWorld, 50);

    const tray = { widthPx: 24 };
    assert.equal(resolveCableTrayWidthMeters(tray, 48), 0.5);
    assert.equal(resolveCableTrayWidthWorld(tray, createCoordinateTransform({ pixelsPerMeter: 48, mode: 'physical_meters' })), 0.5);

    const devPhys = resolveDevicePhysicalDimensions(
      { width: 64, height: 64, customData: { physicalWidthMm: 440, physicalDepthMm: 320, physicalHeightMm: 44.5 } },
      undefined,
      30
    );
    assert.equal(devPhys.source, 'device_specs');
    assert.equal(devPhys.widthMeters, 0.44);
  });

  // 5. Cable Route 2D <-> 3D XZ Projection Parity (All Routing Modes & Waypoints & Bundles)
  await runTest('engineeringSync: projectCableRouteTo3D matches computeCablePath top-down XZ across straight, orthogonal, curved & bundled cables without mutating controlPoints', () => {
    const r1 = { x: 100, y: 120, width: 80, height: 48 }; // center (140, 144)
    const r2 = { x: 520, y: 360, width: 80, height: 48 }; // center (560, 384)
    const origin = { centerX: 350, centerY: 264 };
    const tf = createCoordinateTransform({ pixelsPerMeter: 30, origin, mode: 'legacy_world_scale' });

    const baseCable: CableEdge = {
      id: 'c_test',
      cableCode: 'CAB-01',
      diagramMode: 'floorplan',
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#2563eb',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 20,
      status: 'active'
    };

    const variants: CableEdge[] = [
      { ...baseCable, id: 'v_straight', routingType: 'straight' },
      { ...baseCable, id: 'v_ortho_0', routingType: 'orthogonal' },
      { ...baseCable, id: 'v_ortho_wp', routingType: 'orthogonal', controlPoints: [{ x: 300, y: 160 }, { x: 420, y: 320 }] },
      { ...baseCable, id: 'v_curved_0', routingType: 'curved' },
      { ...baseCable, id: 'v_curved_1', routingType: 'curved', controlPoints: [{ x: 340, y: 80 }] },
      {
        ...baseCable,
        id: 'v_curved_2',
        routingType: 'curved',
        controlPoints: [{ x: 240, y: 90 }, { x: 430, y: 390 }]
      }
    ];

    for (const cable of variants) {
      const origCpSnapshot = JSON.stringify(cable.controlPoints ?? null);
      const path2D = computeCablePath(cable, r1, r2);
      const sampledExpected = sampleSvgPath2D(path2D.d, 16);
      const projected = projectCableRouteTo3D(cable, r1, r2, tf, {
        sourceY: 0.35,
        targetY: 0.45,
        trayY: 0.72,
        curveSegments: 16
      });

      // Exact non-mutation guarantee
      assert.equal(JSON.stringify(cable.controlPoints ?? null), origCpSnapshot);

      // Start and end match 2D endpoints accurately
      const startCanvas = tf.worldToCanvas(projected.points3D[0]);
      const endCanvas = tf.worldToCanvas(projected.points3D[projected.points3D.length - 1]);
      assert.ok(Math.hypot(startCanvas.x - path2D.x1, startCanvas.y - path2D.y1) < 1e-4);
      assert.ok(Math.hypot(endCanvas.x - path2D.x2, endCanvas.y - path2D.y2) < 1e-4);

      // Every projected 3D point's XZ lands directly on the 2D SVG path polyline
      for (const p3 of projected.points3D) {
        const p2 = tf.worldToCanvas(p3);
        let minDist = Infinity;
        for (let i = 0; i < sampledExpected.length - 1; i++) {
          const a = sampledExpected[i];
          const b = sampledExpected[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const lenSq = dx * dx + dy * dy;
          const t = lenSq > 1e-9 ? Math.max(0, Math.min(1, ((p2.x - a.x) * dx + (p2.y - a.y) * dy) / lenSq)) : 0;
          const dist = Math.hypot(p2.x - (a.x + dx * t), p2.y - (a.y + dy * t));
          if (dist < minDist) minDist = dist;
        }
        assert.ok(minDist < 1e-3, `Cable ${cable.id} deviated ${minDist}px from 2D path`);
      }
    }

    // Bundled cables parity
    const bundleLayout = computeCableBundleLayout(
      [
        { ...baseCable, id: 'b1', routingType: 'orthogonal' },
        { ...baseCable, id: 'b2', routingType: 'curved' }
      ],
      id => (id === 'n1' ? r1 : id === 'n2' ? r2 : null)
    );
    assert.equal(bundleLayout.bundles.length, 1);
    const bundle = bundleLayout.bundles[0];
    for (const c of bundle.cables) {
      const offsetPx = bundleLayout.cableOffsets.get(c.id) || 0;
      const projB = projectCableRouteTo3D(c, r1, r2, tf, {
        sourceY: 0.3,
        targetY: 0.3,
        bundleOffsetPx: offsetPx,
        bundleNormal: bundle.normal
      });
      assert.ok(projB.points3D.length >= 4);
    }

    // Inter-floor projection preserves XZ polyline while transitioning between floors
    const interFloor = projectCableRouteTo3D(variants[2], r1, r2, tf, {
      sourceY: 0.35,
      targetY: 3.85
    });
    assert.equal(interFloor.points3D[0].y, 0.35);
    assert.equal(interFloor.points3D[interFloor.points3D.length - 1].y, 3.85);
    const last2D = tf.worldToCanvas(interFloor.points3D[interFloor.points3D.length - 1]);
    assert.ok(Math.hypot(last2D.x - 560, last2D.y - 384) < 1e-4);
  });

  // 6. Rack Resolution, CAD Underlay, Legacy Compatibility & Exporter Baseline Parity
  await runTest('engineeringSync: RackEntityResolver, CAD underlay, legacy projects & PDF/SVG/DXF/BOM baseline parity', async () => {
    const h2 = createHachihi2BuildingProject();
    const rackLookup = buildRackLookupIndex(h2.racks, h2.nodes);
    const floorplanRackNodes = h2.nodes.filter(n => !n.hidden && n.type === 'rack' && n.diagramMode === 'floorplan');
    if (floorplanRackNodes.length > 0) {
      const resolvedRack = resolveRackForDiagramNode(floorplanRackNodes[0], h2.assets, rackLookup);
      assert.ok(resolvedRack, 'Floorplan rack node must resolve to a ServerRack');
    }

    // Shadow node check
    const shadowNode = h2.nodes.find(
      n => n.diagramMode === 'topology' && n.assetId && h2.assets[n.assetId]?.rackId
    );
    if (shadowNode) {
      const assetRackId = h2.assets[shadowNode.assetId!]?.rackId;
      if (assetRackId && rackLookup.rackNodeByRackId.get(assetRackId)?.diagramMode === 'floorplan') {
        assert.equal(isTopologyShadowMountedInRack(shadowNode, h2.assets, rackLookup), true);
      }
    }

    // CAD Underlay round-trip with CoordinateTransform
    const cadDoc = createEmptyCADDocument('Floor1');
    cadDoc.underlay.offsetX = 240;
    cadDoc.underlay.offsetY = 180;
    cadDoc.underlay.scaleToCanvasPx = 0.03; // 1000mm -> 30px
    cadDoc.underlay.rotationDeg = 25;
    const tf = createCoordinateTransform({ pixelsPerMeter: 30, mode: 'legacy_world_scale' });
    const cadPt = { x: 4500, y: 2200 };
    const netPt = cadPointToNetworkCanvas(cadPt, cadDoc.underlay);
    const worldPt = tf.canvasToWorld(netPt, 0);
    const netBack = tf.worldToCanvas(worldPt);
    const cadBack = networkCanvasToCadPoint(netBack, cadDoc.underlay);
    assert.ok(Math.hypot(cadBack.x - cadPt.x, cadBack.y - cadPt.y) < 1e-4);

    // Legacy project (missing buildings, elevationZ, physical dims, scale) migrates & resolves non-destructively
    const enterprise = createEnterpriseTopologyProject();
    const legacyRaw = structuredClone(enterprise) as unknown as Record<string, unknown>;
    delete legacyRaw.schemaVersion;
    delete legacyRaw.buildings;
    const legacySettings = { ...(enterprise.settings as unknown as Record<string, unknown>) };
    delete legacySettings.scale;
    legacyRaw.settings = legacySettings;

    const migrated = migrateAndValidateProject(legacyRaw);
    assert.equal(migrated.ok, true);
    if (migrated.ok) {
      assert.equal(migrated.project.settings.scale, 30);
      const legacyTf = createCoordinateTransform({ pixelsPerMeter: migrated.project.settings.scale });
      assert.equal(legacyTf.pixelsPerMeter, 30);
      const root = new THREE.Group();
      const world = populateInfrastructure3DWorld(root, migrated.project, undefined, {
        showRooms: true,
        showCables: true,
        explodeSpread: 0,
        castShadow: false,
        shadowTex: new THREE.Texture()
      });
      assert.equal(world.activeFloorY, 0);
    }

    // Exporter baseline parity check (SVG, DXF, BOM, PDF)
    const multiFloor = createMultiFloorSampleOfficeProject();
    const svg = generatePureSvgMarkup(multiFloor, { darkTheme: false, includeTitleBlock: true });
    assert.ok(svg.startsWith('<svg '));
    const dxf = generateProjectDxf(multiFloor);
    assert.ok(dxf.includes('ENTITIES') && dxf.trim().endsWith('EOF'));
    const bom = computeProjectBomStats(multiFloor);
    assert.ok(bom.kpis.deviceCount > 0 && bom.kpis.cableCount > 0);
    const pdf = await buildTechnicalPdfArtifact(enterprise, {
      contentScope: '2d',
      paperSize: 'A4',
      orientation: 'landscape',
      includeDiagram: true,
      includeRackElevation: false,
      includeTables: false
    });
    assert.ok(pdf.uint8.byteLength > 500);
    assert.equal(pdf.pageCount, 1);
  });

  // 7. Stage 3 Live Integration: populateInfrastructure3DWorld cutaway fallback, 3D cable XZ parity, rack mm footprint, and move sync
  await runTest('engineeringSync: Stage 3 live 3D world places inherited-floor nodes, matches 2D curved/orthogonal XZ, scales racks & syncs moves', () => {
    const base = createEnterpriseTopologyProject();
    base.activeMode = 'floorplan';
    base.floors = [
      { id: 'fl_1', buildingId: 'b_1', level: 1, name: 'Tầng 1', description: '', widthMeters: 30, depthMeters: 20 },
      { id: 'fl_2', buildingId: 'b_1', level: 2, name: 'Tầng 2', description: '', widthMeters: 30, depthMeters: 20 }
    ];
    base.activeFloorId = 'fl_1';
    base.rooms = [
      { id: 'room_f2', floorId: 'fl_2', name: 'Phòng Server T2', type: 'server_room', x: 100, y: 100, width: 320, height: 240, color: '#e2e8f0', wallThickness: 8 }
    ];
    base.racks = [
      {
        id: 'rack_narrow',
        name: 'Rack 600x800',
        floorId: 'fl_1',
        totalUnits: 42,
        widthMm: 600,
        depthMm: 800,
        maxLoadKg: 800,
        x: 160,
        y: 160,
        slots: {},
        rearSlots: {}
      },
      {
        id: 'rack_wide',
        name: 'Rack 1000x1200',
        floorId: 'fl_2',
        roomId: 'room_f2',
        totalUnits: 42,
        widthMm: 1000,
        depthMm: 1200,
        maxLoadKg: 1000,
        x: 480,
        y: 220,
        slots: {},
        rearSlots: {}
      }
    ];
    base.assets = {
      ast_f2_dev: {
        id: 'ast_f2_dev',
        name: 'AP Tầng 2',
        category: 'ap',
        vendor: 'Cisco',
        model: 'AP-Pro',
        assetTag: 'AP-02',
        serialNumber: 'SN-AP-02',
        ipAddress: '10.0.2.10',
        subnetMask: '255.255.255.0',
        gateway: '10.0.2.1',
        macAddress: '00:11:22:33:44:55',
        vlan: '20',
        status: 'online',
        powerWatts: 18,
        weightKg: 1,
        rackUnitHeight: 1,
        roomId: 'room_f2',
        ports: []
      }
    };
    const defaultStyle = {
      backgroundColor: '#ffffff',
      borderColor: '#334155',
      borderWidth: 1,
      borderStyle: 'solid' as const,
      opacity: 1,
      textColor: '#0f172a'
    };
    base.nodes = [
      {
        id: 'node_rack_narrow',
        type: 'rack',
        diagramMode: 'floorplan',
        floorId: 'fl_1',
        label: 'Rack 600x800',
        x: 160,
        y: 160,
        width: 240,
        height: 460,
        rotation: 0,
        style: defaultStyle,
        customData: { rackId: 'rack_narrow' }
      },
      {
        id: 'node_rack_wide',
        type: 'rack',
        diagramMode: 'floorplan',
        // Intentionally omit floorId so it inherits from rack_wide -> fl_2
        label: 'Rack 1000x1200',
        x: 480,
        y: 220,
        width: 240,
        height: 460,
        rotation: 0,
        style: defaultStyle,
        customData: { rackId: 'rack_wide' }
      },
      {
        id: 'node_ap_f2',
        type: 'device',
        diagramMode: 'floorplan',
        // Intentionally omit floorId so it inherits from asset -> room_f2 -> fl_2
        assetId: 'ast_f2_dev',
        label: 'AP Tầng 2',
        x: 680,
        y: 340,
        width: 150,
        height: 56,
        rotation: 0,
        style: defaultStyle
      }
    ];
    base.cables = [
      {
        id: 'cab_curved_1cp',
        diagramMode: 'floorplan',
        sourceNodeId: 'node_rack_narrow',
        targetNodeId: 'node_ap_f2',
        cableType: 'CAT6_UTP',
        cableCode: 'C-01',
        bandwidth: '1G',
        color: '#0284c7',
        lineStyle: 'solid',
        routingType: 'curved',
        strokeWidth: 2,
        controlPoints: [{ x: 420, y: 120 }],
        lengthMeters: 10,
        status: 'active'
      }
    ];

    const root = new THREE.Group();
    const tex = new THREE.Texture();
    const world = populateInfrastructure3DWorld(root, base, undefined, {
      showRooms: true,
      showCables: true,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: tex,
      viewAllFloors: true
    });

    // Inherited-floor nodes placed at Floor 2 cutaway elevation (3.25) rather than grounded at 0
    const apEntry = world.nodeGroups.get('node_ap_f2');
    const wideRackEntry = world.nodeGroups.get('node_rack_wide');
    const narrowRackEntry = world.nodeGroups.get('node_rack_narrow');
    assert.ok(apEntry && wideRackEntry && narrowRackEntry);
    assert.ok(Math.abs(apEntry!.floorY - LEGACY_CUTAWAY_FLOOR_STEP_UNITS) < 1e-6);
    assert.ok(Math.abs(wideRackEntry!.floorY - LEGACY_CUTAWAY_FLOOR_STEP_UNITS) < 1e-6);
    assert.equal(narrowRackEntry!.floorY, 0);

    // Rack widthMm / depthMm changes reflect in 3D rack footprint
    const narrowBox = new THREE.Box3().setFromObject(narrowRackEntry!.group);
    const wideBox = new THREE.Box3().setFromObject(wideRackEntry!.group);
    const narrowSize = new THREE.Vector3();
    const wideSize = new THREE.Vector3();
    narrowBox.getSize(narrowSize);
    wideBox.getSize(wideSize);
    assert.ok(wideSize.x > narrowSize.x + 0.2, '1000mm rack must be wider in 3D than 600mm rack');
    assert.ok(wideSize.z > narrowSize.z + 0.2, '1200mm deep rack must be deeper in 3D than 800mm rack');

    // Same-floor live build3DCableCurve with 1 controlPoint curved cable preserves 2D XZ midpoint
    const sPt = canvasToWorldXZ(160 + 120, 160 + 230, world.origin);
    const tPt = canvasToWorldXZ(680 + 75, 340 + 28, world.origin);
    const liveCurve = build3DCableCurve(
      base.cables[0],
      sPt,
      tPt,
      true,
      false,
      0,
      1,
      0,
      world.origin,
      0,
      0
    );
    const path2D = computeCablePath(
      base.cables[0],
      { x: 160, y: 160, width: 240, height: 460 },
      { x: 680, y: 340, width: 150, height: 56 }
    );
    const mid2DFrom3D = worldXZToCanvas(liveCurve.midWorld.x, liveCurve.midWorld.z, world.origin);
    assert.ok(Math.hypot(mid2DFrom3D.x - path2D.midPoint.x, mid2DFrom3D.y - path2D.midPoint.y) < 1.5);

    // applyCommitMovedNodesToProject syncs ServerRack.x/y and recalculates CableEdge.lengthMeters
    const movedNodesProject = {
      ...base,
      settings: { ...base.settings, snapToGrid: true, gridSize: 20 },
      nodes: base.nodes.map(n =>
        n.id === 'node_rack_narrow' ? { ...n, x: 303, y: 277 } : n
      )
    };
    const committed = applyCommitMovedNodesToProject(movedNodesProject, ['node_rack_narrow']);
    const snappedNode = committed.nodes.find(n => n.id === 'node_rack_narrow')!;
    const syncedRack = committed.racks.find(r => r.id === 'rack_narrow')!;
    const updatedCable = committed.cables.find(c => c.id === 'cab_curved_1cp')!;
    assert.equal(snappedNode.x, 300);
    assert.equal(snappedNode.y, 280);
    assert.equal(syncedRack.x, 300);
    assert.equal(syncedRack.y, 280);
    assert.notEqual(updatedCable.lengthMeters, 10);

    disposeObjectTree(root);
    tex.dispose();
  });
}

runStandaloneSuite(import.meta.url, runEngineeringSyncParityTests);
