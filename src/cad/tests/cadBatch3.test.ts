import assert from 'node:assert/strict';
import { createMultiFloorSampleOfficeProject } from '../../data/templates';
import type { CableEdge, CableTray, DiagramNode, ProjectState } from '../../types/infrastructure';
import { computeProjectBomStats } from '../../utils/bomAggregator';
import {
  calculateTrayAwareCableLengthMeters,
  estimateCableLengthMeters
} from '../../utils/cableRouting';
import { classifyCadLayerForBom, extractBomQuantitiesFromCad } from '../../utils/cadBomExtractor';
import { estimateBomWithLabor } from '../../utils/tia606';
import type { TestFn } from '../../utils/__tests__/testHarness';
import { runStandaloneSuite } from '../../utils/__tests__/testHarness';
import { CADCommandManager } from '../commands/CADCommandManager';
import {
  BatchModifyEntitiesCommand,
  BatchUpdateLayersCommand,
  buildExplodeInsertCommand,
  DeleteEntitiesCommand,
  MirrorCommand,
  ModifyEntityCommand,
  MoveCommand,
  ReplaceEntitiesCommand,
  RotateCommand,
  ScaleCommand
} from '../commands/CADCommands';
import { isCADLayerLocked } from '../core/CADDocument';
import type { CADDocument, CADEntity } from '../core/CADTypes';
import {
  cadPointToNetworkCanvas,
  checkCadNetworkScaleConsistency,
  computeCadUnderlayDistance,
  computeCadUnderlayScaleFromNetworkPxPerMeter,
  computeNetworkPxPerMeterFromCad
} from '../core/CADUnderlayTransform';
import { computeMetersPerCanvasPx } from '../core/CADUnits';
import { writeCombinedCadAndNetworkDxf } from '../export/DXFWriter';
import { snapCanvasPointToCadUnderlay } from '../geometry/CADUnderlaySnap';
import { importDxfContent } from '../import/DXFImporter';

function makeFloorplanDxf(unitCode: 4 | 6): string {
  // Unit 4 = mm (10000 x 6000 mm = 10m x 6m room); Unit 6 = m (10 x 6 m room)
  const k = unitCode === 4 ? 1000 : 1;
  return [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1015',
    '9', '$INSUNITS', '70', String(unitCode),
    '9', '$CLAYER', '8', 'A_WALL',
    '9', '$HANDSEED', '5', '400',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '4',
    '0', 'LAYER', '5', '10', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS', '290', '1', '370', '-3',
    '0', 'LAYER', '5', '11', '2', 'A_WALL', '70', '0', '62', '7', '6', 'CONTINUOUS', '290', '1', '370', '35',
    '0', 'LAYER', '5', '12', '2', 'MANG_CAP_ELV', '70', '0', '62', '4', '6', 'DASHED', '290', '1', '370', '25',
    '0', 'LAYER', '5', '13', '2', 'NET_EDIT', '70', '0', '62', '3', '6', 'CONTINUOUS', '290', '1', '370', '25',
    '0', 'ENDTAB',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '5', '30', '8', 'A_WALL', '2', 'COL_SYM', '70', '0', '10', '0', '20', '0', '30', '0', '3', 'COL_SYM',
    '0', 'LINE', '5', '31', '8', '0', '10', String(-0.2 * k), '20', '0', '30', '0', '11', String(0.2 * k), '21', '0', '31', '0',
    '0', 'ENDBLK', '5', '32',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    // North wall (0, 6m) -> (10m, 6m)
    '0', 'LINE', '5', 'A1', '8', 'A_WALL', '10', '0', '20', String(6 * k), '30', '0', '11', String(10 * k), '21', String(6 * k), '31', '0',
    // South wall (0, 0) -> (10m, 0)
    '0', 'LINE', '5', 'A2', '8', 'A_WALL', '10', '0', '20', '0', '30', '0', '11', String(10 * k), '21', '0', '31', '0',
    // Column block on A_WALL
    '0', 'INSERT', '5', 'A3', '8', 'A_WALL', '2', 'COL_SYM', '10', String(5 * k), '20', String(3 * k), '30', '0', '41', '1', '42', '1', '43', '1', '50', '0',
    // Existing CAD cable tray along Y = 5m from X = 0 to X = 10m (10 meters)
    '0', 'LINE', '5', 'T1', '8', 'MANG_CAP_ELV', '10', '0', '20', String(5 * k), '30', '0', '11', String(10 * k), '21', String(5 * k), '31', '0',
    // Editable CAD annotation line on NET_EDIT
    '0', 'LINE', '5', 'E1', '8', 'NET_EDIT', '10', String(1 * k), '20', String(1 * k), '30', '0', '11', String(2 * k), '21', String(1 * k), '31', '0',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');
}

function configureUnderlay(
  doc: CADDocument,
  scaleToCanvasPx: number,
  offsetX = 100,
  offsetY = 500
): CADDocument {
  return {
    ...doc,
    underlay: {
      ...doc.underlay,
      enabled: true,
      scaleToCanvasPx,
      offsetX,
      offsetY,
      rotationDeg: 0
    }
  };
}

const DEFAULT_NODE_STYLE: DiagramNode['style'] = {
  backgroundColor: '#ffffff',
  borderColor: '#155EEF',
  borderWidth: 1.5,
  borderStyle: 'solid',
  opacity: 1
};

function makeMinimalNetworkProject(scalePxPerMeter: number): ProjectState {
  const base = createMultiFloorSampleOfficeProject();
  const floorId = base.floors[0].id;
  const rackNode: DiagramNode = {
    id: 'node_rack_1',
    type: 'rack',
    diagramMode: 'topology',
    floorId,
    assetId: 'asset_rack_1',
    label: 'RACK-MDF-01',
    x: 0,
    y: 0,
    width: 48,
    height: 48,
    rotation: 0,
    style: { ...DEFAULT_NODE_STYLE }
  };
  const swNode: DiagramNode = {
    id: 'node_sw_1',
    type: 'device',
    diagramMode: 'topology',
    floorId,
    assetId: 'asset_sw_1',
    label: 'SW-ACC-01',
    x: 400,
    y: 0,
    width: 40,
    height: 40,
    rotation: 0,
    style: { ...DEFAULT_NODE_STYLE }
  };
  const camNode: DiagramNode = {
    id: 'node_cam_1',
    type: 'device',
    diagramMode: 'topology',
    floorId,
    assetId: 'asset_cam_1',
    label: 'CAM-LOBBY-01',
    x: 400,
    y: 200,
    width: 36,
    height: 36,
    rotation: 0,
    style: { ...DEFAULT_NODE_STYLE }
  };
  return {
    ...base,
    settings: {
      ...base.settings,
      scale: scalePxPerMeter,
      snapToGrid: true
    },
    rooms: [
      {
        id: 'room_1',
        floorId,
        name: 'Phòng Server MDF',
        type: 'server_room',
        x: 70,
        y: 160,
        width: 560,
        height: 360,
        color: '#e2e8f0',
        wallThickness: 10
      }
    ],
    racks: [
      {
        id: 'rack_1',
        floorId,
        roomId: 'room_1',
        name: 'RACK-MDF-01',
        totalUnits: 42,
        widthMm: 600,
        depthMm: 1000,
        maxLoadKg: 1000,
        x: 100,
        y: 200,
        slots: { 40: 'asset_sw_1' },
        rearSlots: {}
      }
    ],
    assets: {
      asset_rack_1: {
        id: 'asset_rack_1',
        name: 'RACK-MDF-01',
        category: 'rack',
        vendor: 'APC',
        model: 'NetShelter SX 42U',
        assetTag: 'AST-RK-01',
        serialNumber: 'SN-RK-01',
        ipAddress: '',
        subnetMask: '255.255.255.0',
        gateway: '',
        macAddress: '',
        vlan: '1',
        status: 'online',
        floorId,
        roomId: 'room_1',
        powerWatts: 0,
        weightKg: 120,
        ports: []
      },
      asset_sw_1: {
        id: 'asset_sw_1',
        name: 'SW-ACC-01',
        category: 'switch',
        vendor: 'Cisco',
        model: 'C9200L-24P',
        assetTag: 'AST-SW-01',
        serialNumber: 'SN-SW-01',
        ipAddress: '10.10.1.10',
        subnetMask: '255.255.255.0',
        gateway: '10.10.1.1',
        macAddress: '00:11:22:33:44:55',
        vlan: '10',
        status: 'online',
        floorId,
        roomId: 'room_1',
        rackId: 'rack_1',
        rackUnitStart: 40,
        rackUnitHeight: 1,
        powerWatts: 180,
        weightKg: 4.5,
        ports: []
      },
      asset_cam_1: {
        id: 'asset_cam_1',
        name: 'CAM-LOBBY-01',
        category: 'camera',
        vendor: 'Hikvision',
        model: 'DS-2CD2143G2',
        assetTag: 'AST-CAM-01',
        serialNumber: 'SN-CAM-01',
        ipAddress: '10.10.20.51',
        subnetMask: '255.255.255.0',
        gateway: '10.10.20.1',
        macAddress: '00:11:22:33:44:66',
        vlan: '20',
        status: 'online',
        floorId,
        roomId: 'room_1',
        powerWatts: 12,
        weightKg: 0.8,
        ports: []
      }
    },
    nodes: [rackNode, swNode, camNode],
    cables: [],
    cableTrays: []
  };
}

export async function runCadBatch3Tests(runTest: TestFn): Promise<void> {
  await runTest('P3.1 Floorplan Layer Locking: khóa toàn bộ lớp mặt bằng bảo vệ khỏi mọi lệnh sửa hình học kể cả Replace/Explode', () => {
    const { document: docMm } = importDxfContent(makeFloorplanDxf(4), { fileName: 'floor_mm.dxf' });
    const mgr = new CADCommandManager(50);

    // Lock all floorplan layers except NET_EDIT
    let doc = mgr.execute(
      docMm,
      new BatchUpdateLayersCommand(layers => {
        const next = { ...layers };
        for (const [name, l] of Object.entries(next)) {
          next[name] = { ...l, locked: name !== 'NET_EDIT' };
        }
        return next;
      }, 'Khóa lớp mặt bằng CAD')
    );

    assert.equal(isCADLayerLocked(doc, 'A_WALL'), true);
    assert.equal(isCADLayerLocked(doc, 'MANG_CAP_ELV'), true);
    assert.equal(isCADLayerLocked(doc, 'NET_EDIT'), false);

    const wallA1 = doc.entities.find(e => e.handle === 'A1')! as Extract<CADEntity, { type: 'LINE' }>;
    const colA3 = doc.entities.find(e => e.handle === 'A3')!;
    const editE1 = doc.entities.find(e => e.handle === 'E1')! as Extract<CADEntity, { type: 'LINE' }>;

    // Attempt mutating locked wall + unlocked line together
    doc = mgr.execute(doc, new MoveCommand([wallA1.id, editE1.id], 500, 200));
    doc = mgr.execute(doc, new RotateCommand([wallA1.id], { x: 0, y: 0 }, 30));
    doc = mgr.execute(doc, new ScaleCommand([wallA1.id], { x: 0, y: 0 }, 2));
    doc = mgr.execute(doc, new MirrorCommand([wallA1.id], { x: 0, y: 0 }, { x: 0, y: 1000 }));
    doc = mgr.execute(doc, new ModifyEntityCommand(wallA1.id, e => ({ ...e, colorIndex: 1 })));
    doc = mgr.execute(doc, new BatchModifyEntitiesCommand([wallA1.id], { colorIndex: 2 }));
    doc = mgr.execute(doc, new DeleteEntitiesCommand([wallA1.id]));
    doc = mgr.execute(doc, new ReplaceEntitiesCommand([wallA1.id], [], 'Thử thay thế nét tường đang khóa'));
    assert.equal(buildExplodeInsertCommand(doc, colA3.id), null);

    // Locked wall & block are 100% intact, while unlocked NET_EDIT line moved cleanly
    const wallAfter = doc.entities.find(e => e.handle === 'A1')! as Extract<CADEntity, { type: 'LINE' }>;
    assert.deepEqual(wallAfter.start, wallA1.start);
    assert.deepEqual(wallAfter.end, wallA1.end);
    assert.equal(wallAfter.colorIndex, wallA1.colorIndex);
    assert.ok(doc.entities.some(e => e.handle === 'A3'));

    const editAfter = doc.entities.find(e => e.handle === 'E1')! as Extract<CADEntity, { type: 'LINE' }>;
    assert.equal(editAfter.start.x, editE1.start.x + 500);
    assert.equal(editAfter.start.y, editE1.start.y + 200);
  });

  await runTest('P3.2 Two-Way Scale Sync & Consistency: quy đổi 2 chiều giữa $INSUNITS + scaleToCanvasPx và scalePixelsPerMeter', () => {
    const { document: docMmRaw } = importDxfContent(makeFloorplanDxf(4), { fileName: 'scale_mm.dxf' });
    const { document: docMRaw } = importDxfContent(makeFloorplanDxf(6), { fileName: 'scale_m.dxf' });

    // mm floorplan: 1 mm = 0.05 px => 1000 mm (1m) = 50 px
    const docMm = configureUnderlay(docMmRaw, 0.05);
    assert.equal(computeNetworkPxPerMeterFromCad(docMm), 50);
    assert.equal(computeCadUnderlayScaleFromNetworkPxPerMeter(50, 4), 0.05);
    assert.ok(Math.abs((computeMetersPerCanvasPx(0.05, 4) ?? 0) - 0.02) < 1e-9);

    const okCheck = checkCadNetworkScaleConsistency(docMm, 50);
    assert.equal(okCheck.consistent, true);
    assert.equal(okCheck.cadPxPerMeter, 50);

    const driftCheck = checkCadNetworkScaleConsistency(docMm, 30);
    assert.equal(driftCheck.consistent, false);
    assert.equal(driftCheck.cadPxPerMeter, 50);
    assert.ok(driftCheck.deltaRatio > 0.35);

    // Meter floorplan: 1 m = 40 px
    const docM = configureUnderlay(docMRaw, 40);
    assert.equal(computeNetworkPxPerMeterFromCad(docM), 40);
    assert.equal(computeCadUnderlayScaleFromNetworkPxPerMeter(40, 6), 40);
    assert.ok(Math.abs((computeMetersPerCanvasPx(40, 6) ?? 0) - 0.025) < 1e-9);
    assert.equal(checkCadNetworkScaleConsistency(docM, 40).consistent, true);

    // Unitless ($INSUNITS=0) returns null and flags inconsistency
    const unitlessDoc: CADDocument = {
      ...docM,
      header: { ...docM.header, $INSUNITS: 0 }
    };
    assert.equal(computeNetworkPxPerMeterFromCad(unitlessDoc), null);
    assert.equal(computeCadUnderlayScaleFromNetworkPxPerMeter(40, 0), null);
    assert.equal(checkCadNetworkScaleConsistency(unitlessDoc, 40).hasUnit, false);
    assert.equal(checkCadNetworkScaleConsistency(unitlessDoc, 40).consistent, false);
  });

  await runTest('P3.3 OSNAP & Real CAD Cable Length: đặt thiết bị bám nền CAD, đi dây qua waypoint/máng cáp khớp đúng mét thực tế', () => {
    const { document: docMmRaw } = importDxfContent(makeFloorplanDxf(4), { fileName: 'snap_mm.dxf' });
    // 1 mm = 0.05 px => 50 px/m, origin offset (100, 500)
    const docMm = configureUnderlay(docMmRaw, 0.05, 100, 500);
    const pxPerMeter = computeNetworkPxPerMeterFromCad(docMm)!;
    assert.equal(pxPerMeter, 50);

    // CAD wall north endpoints: (0, 6000mm) -> canvas (100, 200), (10000mm, 6000mm) -> canvas (600, 200)
    // CAD wall south right endpoint: (10000mm, 0mm) -> canvas (600, 500)
    const pNorthLeftExpected = cadPointToNetworkCanvas({ x: 0, y: 6000 }, docMm.underlay);
    const pNorthRightExpected = cadPointToNetworkCanvas({ x: 10000, y: 6000 }, docMm.underlay);
    const pSouthRightExpected = cadPointToNetworkCanvas({ x: 10000, y: 0 }, docMm.underlay);

    // Slightly offset pointer (3px away) must OSNAP directly onto exact CAD wall vertices
    const snapA = snapCanvasPointToCadUnderlay(
      { x: pNorthLeftExpected.x + 3, y: pNorthLeftExpected.y - 2 },
      docMm,
      10
    );
    const snapB = snapCanvasPointToCadUnderlay(
      { x: pNorthRightExpected.x - 2, y: pNorthRightExpected.y + 3 },
      docMm,
      10
    );
    const snapC = snapCanvasPointToCadUnderlay(
      { x: pSouthRightExpected.x + 2, y: pSouthRightExpected.y - 2 },
      docMm,
      10
    );
    assert.ok(snapA && Math.hypot(snapA.point.x - pNorthLeftExpected.x, snapA.point.y - pNorthLeftExpected.y) < 1e-6);
    assert.ok(snapB && Math.hypot(snapB.point.x - pNorthRightExpected.x, snapB.point.y - pNorthRightExpected.y) < 1e-6);
    assert.ok(snapC && Math.hypot(snapC.point.x - pSouthRightExpected.x, snapC.point.y - pSouthRightExpected.y) < 1e-6);

    // Measure distance directly in CAD units & meters: 10,000 mm = 10.00 m
    const cadDist = computeCadUnderlayDistance(docMm, snapA!.point, snapB!.point);
    assert.ok(Math.abs(cadDist.cadUnits - 10000) < 1e-4);
    assert.ok(Math.abs(cadDist.meters - 10) < 1e-6);
    assert.equal(cadDist.unitShortLabel, 'mm');

    // Place rack at snapA center and camera at snapC center with waypoint at snapB (10m east + 6m south = 16m path)
    const project = makeMinimalNetworkProject(pxPerMeter);
    const rackNode: DiagramNode = {
      ...project.nodes[0],
      x: snapA!.point.x - 24,
      y: snapA!.point.y - 24,
      width: 48,
      height: 48
    };
    const camNode: DiagramNode = {
      ...project.nodes[2],
      x: snapC!.point.x - 18,
      y: snapC!.point.y - 18,
      width: 36,
      height: 36
    };
    const cableDirect: CableEdge = {
      id: 'cab_1',
      cableCode: 'CAB-CAM-01',
      diagramMode: 'topology',
      sourceNodeId: rackNode.id,
      targetNodeId: camNode.id,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'straight',
      controlPoints: [{ x: snapB!.point.x, y: snapB!.point.y }],
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 0,
      status: 'active'
    };

    // Without slack (slackFactor = 1): exact 16m matches CAD wall perimeter (10m + 6m)
    const exactMeters = estimateCableLengthMeters(cableDirect, rackNode, camNode, pxPerMeter, 1);
    assert.equal(exactMeters, 16);
    // With standard 15% slack: round(16 * 1.15) = 18m
    const withSlackMeters = estimateCableLengthMeters(cableDirect, rackNode, camNode, pxPerMeter, 1.15);
    assert.equal(withSlackMeters, 18);

    // Tray-aware routing along CAD tray line (Y = 5000mm -> canvas Y = 250)
    const trayStart = cadPointToNetworkCanvas({ x: 0, y: 5000 }, docMm.underlay);
    const trayEnd = cadPointToNetworkCanvas({ x: 10000, y: 5000 }, docMm.underlay);
    const tray: CableTray = {
      id: 'tray_1',
      name: 'TRAY-NORTH',
      kind: 'network_tray',
      floorId: project.floors[0].id,
      points: [trayStart, trayEnd],
      widthPx: 14
    };
    const trayRes = calculateTrayAwareCableLengthMeters(cableDirect, rackNode, camNode, [tray], pxPerMeter);
    // drop1 (1m) + trayRun (10m) + drop2 (5m) = 16m; round(16 * 1.12 + 3) = 21m
    assert.equal(trayRes.routedViaTrayName, 'TRAY-NORTH');
    assert.equal(trayRes.meters, 21);
  });

  await runTest('P3.4 BOM Integration & No Double-Counting: thống kê BOM thiết bị + cáp + máng CAD chuẩn xác, bỏ qua layer HACHIHI_*', () => {
    const { document: docMmRaw } = importDxfContent(makeFloorplanDxf(4), { fileName: 'bom_mm.dxf' });
    const docMm = configureUnderlay(docMmRaw, 0.05, 100, 500);
    const pxPerMeter = computeNetworkPxPerMeterFromCad(docMm)!; // 50 px/m

    const project = makeMinimalNetworkProject(pxPerMeter);
    const rackNode: DiagramNode = { ...project.nodes[0], x: 100 - 24, y: 200 - 24 };
    const swNode: DiagramNode = { ...project.nodes[1], x: 600 - 20, y: 200 - 20 }; // 10m away
    const camNode: DiagramNode = { ...project.nodes[2], x: 600 - 18, y: 500 - 18 }; // 6m south of swNode

    const cabFiber: CableEdge = {
      id: 'cab_fo',
      cableCode: 'FO-CORE-01',
      diagramMode: 'topology',
      sourceNodeId: rackNode.id,
      targetNodeId: swNode.id,
      cableType: 'FIBER_SM_OS2',
      bandwidth: '10G',
      color: '#f59e0b',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: estimateCableLengthMeters(
        { id: 'tmp1', cableCode: 'x', diagramMode: 'topology', sourceNodeId: rackNode.id, targetNodeId: swNode.id, cableType: 'FIBER_SM_OS2', bandwidth: '10G', color: '#000', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 0, status: 'active' },
        rackNode,
        swNode,
        pxPerMeter
      ),
      status: 'active'
    };
    const cabCam: CableEdge = {
      id: 'cab_cam',
      cableCode: 'CAT6-CAM-01',
      diagramMode: 'topology',
      sourceNodeId: swNode.id,
      targetNodeId: camNode.id,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: estimateCableLengthMeters(
        { id: 'tmp2', cableCode: 'y', diagramMode: 'topology', sourceNodeId: swNode.id, targetNodeId: camNode.id, cableType: 'CAT6_UTP', bandwidth: '1G', color: '#000', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 0, status: 'active' },
        swNode,
        camNode,
        pxPerMeter
      ),
      status: 'active'
    };

    const fullProject: ProjectState = {
      ...project,
      nodes: [rackNode, swNode, camNode],
      cables: [cabFiber, cabCam]
    };

    // 10m * 1.15 = 12m fiber; 6m * 1.15 = 7m cat6
    assert.equal(cabFiber.lengthMeters, 12);
    assert.equal(cabCam.lengthMeters, 7);

    // CAD extraction reads MANG_CAP_ELV (10m) and ignores A_WALL & NET_EDIT
    const cadSummary = extractBomQuantitiesFromCad(docMm);
    assert.equal(cadSummary.trayMeters, 10);
    assert.equal(cadSummary.totalExtractedMeters, 10);

    const bom = computeProjectBomStats(fullProject, { cadDocument: docMm });
    assert.equal(bom.kpis.deviceCount, 2); // switch + camera
    assert.equal(bom.kpis.rackCount, 1);
    assert.equal(bom.kpis.cableCount, 2);
    assert.equal(bom.kpis.rawCableMeters, 19); // 12 + 7
    assert.equal(bom.kpis.trayTotalMeters, 10); // from CAD MANG_CAP_ELV

    const laborBom = estimateBomWithLabor(fullProject);
    assert.ok(laborBom.items.some(i => i.code === 'VT-CAT6' && i.quantity > 0));
    assert.ok(laborBom.items.some(i => i.code === 'VT-FO' && i.quantity > 0));
    assert.ok(laborBom.items.some(i => i.code === 'NC-CAM' && i.quantity === 1));
    assert.ok(laborBom.items.some(i => i.code === 'NC-RACK' && i.quantity === 1));
    assert.ok(laborBom.grandTotalVnd > 0);

    // Export combined DXF and verify re-extracting BOM ignores HACHIHI_CABLES (no double counting!)
    const combinedDxf = writeCombinedCadAndNetworkDxf(docMm, fullProject);
    const { document: reimportedDoc } = importDxfContent(combinedDxf, { fileName: 'combined_bom.dxf' });
    assert.equal(classifyCadLayerForBom('HACHIHI_CABLES'), 'ignored');
    assert.equal(classifyCadLayerForBom('HACHIHI_DEVICES'), 'ignored');
    assert.equal(classifyCadLayerForBom('HACHIHI_RACKS'), 'ignored');

    const reCadSummary = extractBomQuantitiesFromCad(reimportedDoc);
    assert.equal(reCadSummary.cableBreakdown.length, 0);
    assert.equal(reCadSummary.trayMeters, 10);
    const reBom = computeProjectBomStats(fullProject, { cadDocument: reimportedDoc });
    assert.equal(reBom.kpis.rawCableMeters, 19);
  });

  await runTest('P3.5 Combined DXF Round-Trip: xuất DXF kết hợp (mm & m), bảo toàn 100% nền CAD + Block/ATTRIB thiết bị + cáp XDATA', () => {
    for (const unitCode of [4, 6] as const) {
      const { document: rawFloor } = importDxfContent(makeFloorplanDxf(unitCode), {
        fileName: unitCode === 4 ? 'round_mm.dxf' : 'round_m.dxf'
      });
      const scaleToPx = unitCode === 4 ? 0.05 : 50; // both give 50 px/m
      const cadDoc = configureUnderlay(rawFloor, scaleToPx, 100, 500);
      const pxPerMeter = computeNetworkPxPerMeterFromCad(cadDoc)!;
      assert.equal(pxPerMeter, 50);

      const baseProj = makeMinimalNetworkProject(pxPerMeter);
      const rackNode: DiagramNode = { ...baseProj.nodes[0], x: 100 - 24, y: 200 - 24 };
      const swNode: DiagramNode = { ...baseProj.nodes[1], x: 600 - 20, y: 200 - 20 };
      const cable: CableEdge = {
        id: 'cab_rt_1',
        cableCode: 'F01.MDF.RK01.SW01.P1-CAM.P1',
        diagramMode: 'topology',
        sourceNodeId: rackNode.id,
        targetNodeId: swNode.id,
        cableType: 'CAT6A_STP',
        bandwidth: '10G',
        color: '#2563eb',
        routingType: 'straight',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 12,
        status: 'active'
      };
      const proj: ProjectState = {
        ...baseProj,
        nodes: [rackNode, swNode],
        cables: [cable]
      };

      const dxfOut = writeCombinedCadAndNetworkDxf(cadDoc, proj);
      const { document: reopened } = importDxfContent(dxfOut, {
        fileName: unitCode === 4 ? 'combined_out_mm.dxf' : 'combined_out_m.dxf'
      });

      // 1. Original CAD floorplan layers, blocks & entities preserved intact
      assert.equal(reopened.header.$INSUNITS, unitCode);
      assert.ok(reopened.layers['A_WALL']);
      assert.ok(reopened.layers['MANG_CAP_ELV']);
      assert.ok(reopened.blocks['COL_SYM']);
      assert.ok(reopened.entities.some(e => e.handle === 'A1' && e.layer === 'A_WALL'));
      assert.ok(reopened.entities.some(e => e.handle === 'T1' && e.layer === 'MANG_CAP_ELV'));

      // 2. All HACHIHI_* network layers & symbol blocks present
      for (const lName of ['HACHIHI_ROOMS', 'HACHIHI_RACKS', 'HACHIHI_DEVICES', 'HACHIHI_CABLES', 'HACHIHI_LABELS']) {
        assert.ok(reopened.layers[lName], `Missing layer ${lName}`);
      }
      assert.ok(reopened.blocks['HACHIHI_DEV_SYM']);
      assert.ok(reopened.blocks['HACHIHI_RACK_SYM']);

      // 3. Device INSERT carries TAG / MODEL / IP ATTRIBs
      const devInsert = reopened.entities.find(
        e => e.type === 'INSERT' && e.blockName === 'HACHIHI_DEV_SYM'
      ) as Extract<CADEntity, { type: 'INSERT' }> | undefined;
      assert.ok(devInsert, 'Missing HACHIHI_DEV_SYM INSERT');
      const attrMap = new Map((devInsert.attributes || []).map(a => [a.tag, a.text]));
      assert.equal(attrMap.get('TAG'), 'SW-ACC-01');
      assert.equal(attrMap.get('MODEL'), 'C9200L-24P');
      assert.equal(attrMap.get('IP'), '10.10.1.10');

      const rackInsert = reopened.entities.find(
        e => e.type === 'INSERT' && e.blockName === 'HACHIHI_RACK_SYM'
      ) as Extract<CADEntity, { type: 'INSERT' }> | undefined;
      assert.ok(rackInsert, 'Missing HACHIHI_RACK_SYM INSERT');
      assert.equal(rackInsert.attributes?.find(a => a.tag === 'TAG')?.text, 'RACK-MDF-01');

      // 4. Cable polyline on HACHIHI_CABLES carries XDATA with real meter length & proportional label height
      const cableEnt = reopened.entities.find(e => e.layer === 'HACHIHI_CABLES' && e.type === 'LWPOLYLINE');
      assert.ok(cableEnt, 'Missing HACHIHI_CABLES polyline');
      const xdataNet = cableEnt.xdata?.find(x => x.appName === 'HACHIHI_NET');
      assert.ok(xdataNet);
      assert.equal(xdataNet.values[0]?.value, 'F01.MDF.RK01.SW01.P1-CAM.P1');
      assert.equal(xdataNet.values[1]?.value, 'CAT6A_STP');
      assert.equal(xdataNet.values[2]?.value, 12);

      const labelEnts = reopened.entities.filter(
        e => e.layer === 'HACHIHI_LABELS' && e.type === 'TEXT'
      ) as Array<Extract<CADEntity, { type: 'TEXT' }>>;
      assert.ok(labelEnts.some(t => t.text.includes('F01.MDF.RK01.SW01.P1-CAM.P1') && t.text.includes('12m')));
      if (unitCode === 6) {
        // Meter-scale drawing must emit proportional ~0.16m label heights, NOT 12m giant text!
        for (const t of labelEnts) {
          assert.ok(t.height < 1.0, `Expected meter-scale label height < 1.0m, got ${t.height}`);
        }
      }
    }
  });
}

runStandaloneSuite(import.meta.url, runCadBatch3Tests);
