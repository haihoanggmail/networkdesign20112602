import assert from 'node:assert/strict';
import { DeviceAsset, CableEdge } from '../../types/infrastructure';
import { findContiguousFreeUBlocks, computeRackPduOutletSummary } from '../rackGeometry';
import { migrateAndValidateProject, computeDetailedRevisionDiff } from '../projectStorage';
import {
  runEngineeringAudit,
  buildIpVlanMatrix,
  detectL2SwitchingLoops,
  resolveUpsActiveWatts,
  parseAndApplyBulkStaticIpsCsv,
  collectFloorWallSegments,
  computeSegmentWallCrossings,
  estimateWifiRssiDbm
} from '../engineeringValidator';
import { computeAutoRoutedWaypoints, computeOpticalLinkBudget } from '../cableRouting';
import { computeProjectBomStats } from '../bomAggregator';
import { computeProjectSubnetIpStats } from '../ipAutoAssign';
import { diffMergeNetworkScannerData } from '../scannerImport';
import {
  ARCHITECTURE_TEMPLATES,
  createEnterpriseTopologyProject,
  createMultiFloorSampleOfficeProject,
  createServerRackProject
} from '../../data/templates';
import {
  classifyPoeStandard,
  computeProjectPoeSummary,
  computeSwitchPoeBreakdown,
  isPoeConsumerDevice,
  isPseDevice,
  computeUpsBatteryRuntime,
  resolvePoeDeviceRole,
  simulateBranchOutage
} from '../poeCalculator';
import type { ProjectState } from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runPowerAndValidatorTests(runTest: TestFn): Promise<void> {
  // 4. Engineering Validator & IP/VLAN Matrix Tests
  await runTest('engineeringValidator: detects duplicate IP, port conflict, VLAN mismatch, rack overload & builds matrix', () => {
    const base = createEnterpriseTopologyProject();
    const nodeIds = base.nodes.filter(n => n.assetId).map(n => n.id);
    assert.ok(nodeIds.length >= 2);

    const n1 = base.nodes.find(n => n.id === nodeIds[0])!;
    const n2 = base.nodes.find(n => n.id === nodeIds[1])!;
    const a1 = base.assets[n1.assetId!];
    const a2 = base.assets[n2.assetId!];

    // Force duplicate IP + VLAN mismatch
    a1.ipAddress = '192.168.99.99';
    a2.ipAddress = '192.168.99.99';
    a1.vlan = '10';
    a2.vlan = '20';

    // Force port conflict on n1:port_1
    const c1: CableEdge = {
      id: 'cab_test_1',
      cableCode: 'TST-01',
      diagramMode: 'topology',
      sourceNodeId: n1.id,
      targetNodeId: n2.id,
      sourcePortId: 'port_1',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#2563eb',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active'
    };
    const c2: CableEdge = {
      ...c1,
      id: 'cab_test_2',
      cableCode: 'TST-02',
      targetPortId: 'port_2'
    };
    base.cables.push(c1, c2);

    const report = runEngineeringAudit(base);
    assert.ok(report.issues.some(i => i.category === 'ip'));
    assert.ok(report.issues.some(i => i.category === 'port'));
    assert.ok(report.issues.some(i => i.category === 'vlan'));
    assert.ok(report.summary.errorCount >= 2);

    const matrix = buildIpVlanMatrix(base);
    const dupRows = matrix.filter(r => r.ipAddress === '192.168.99.99');
    assert.equal(dupRows.length, 2);
    assert.ok(dupRows.every(r => r.duplicateIp === true));
  });

  // 18. Project PoE Power Consumption & PSE Budget Tests
  await runTest('poeCalculator: separates PD consumption from PSE budget, respects overrides, and detects overload', () => {
    const proj = createEnterpriseTopologyProject();
    proj.nodes = [];
    proj.cables = [];
    proj.racks = [];

    const makeDevice = (
      id: string,
      name: string,
      category: DeviceAsset['category'],
      partial: Partial<DeviceAsset> = {}
    ): DeviceAsset => ({
      id,
      name,
      category,
      vendor: 'Test',
      model: 'Model-X',
      assetTag: id.toUpperCase(),
      serialNumber: `SN-${id}`,
      ipAddress: '10.10.0.10',
      subnetMask: '255.255.255.0',
      gateway: '10.10.0.1',
      macAddress: '00:11:22:33:44:55',
      vlan: '10',
      status: 'online',
      powerWatts: 0,
      ports: [],
      ...partial
    });

    const swPoe = makeDevice('dev_sw_poe', 'SW-POE-01', 'switch', {
      powerWatts: 380,
      poeBudgetWatts: 100,
      ports: [
        { id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' },
        { id: 'p2', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }
      ]
    });
    const cam1 = makeDevice('dev_cam_1', 'CAM-01', 'camera', {
      powerWatts: 12,
      ports: [{ id: 'p1', name: 'RJ45_PoE', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const camDc = makeDevice('dev_cam_dc', 'CAM-DC-02', 'camera', {
      powerWatts: 15,
      poeEnabled: false
    });
    const ap1 = makeDevice('dev_ap_1', 'AP-WIFI6-01', 'ap', {
      powerWatts: 25,
      ports: [{ id: 'p1', name: 'Eth0_PoE', type: 'RJ45_10G', speed: '2.5 Gbps', poe: true, poeWatts: 24, status: 'up' }]
    });
    const voipPhone = makeDevice('dev_voip_1', 'VOIP-01', 'workstation', {
      powerWatts: 65,
      poeWatts: 14,
      ports: [{ id: 'p1', name: 'LAN_PoE', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const orphanCam = makeDevice('dev_cam_orphan', 'CAM-DELETED', 'camera', {
      powerWatts: 20
    });

    assert.equal(isPseDevice(swPoe), true);
    assert.equal(isPoeConsumerDevice(swPoe), false);
    assert.equal(isPoeConsumerDevice(cam1), true);
    assert.equal(isPoeConsumerDevice(camDc), false);
    assert.equal(isPoeConsumerDevice(voipPhone), true);
    assert.equal(classifyPoeStandard(12).id, '802.3af');
    assert.equal(classifyPoeStandard(24).id, '802.3at');
    assert.equal(classifyPoeStandard(45).id, '802.3bt-3');

    proj.assets = {
      [swPoe.id]: swPoe,
      [cam1.id]: cam1,
      [camDc.id]: camDc,
      [ap1.id]: ap1,
      [voipPhone.id]: voipPhone,
      [orphanCam.id]: orphanCam
    };

    const mkNode = (id: string, assetId: string) => ({
      id,
      diagramMode: 'topology' as const,
      floorId: proj.activeFloorId,
      type: 'device' as const,
      assetId,
      label: id,
      x: 100,
      y: 100,
      width: 120,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155EEF', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid' as const, opacity: 1 }
    });

    // Only active nodes count (orphanCam excluded); cam1(12W) + ap1(port poeWatts 24W) + voipPhone(asset poeWatts 14W) = 50W
    proj.nodes = [
      mkNode('n_sw', swPoe.id),
      mkNode('n_cam1', cam1.id),
      mkNode('n_camdc', camDc.id),
      mkNode('n_ap1', ap1.id),
      mkNode('n_voip', voipPhone.id)
    ];

    const summary = computeProjectPoeSummary(proj);
    assert.equal(summary.poweredDeviceCount, 3);
    assert.equal(summary.totalPoeWatts, 50);
    assert.equal(summary.totalPoeBudgetWatts, 100);
    assert.equal(summary.headroomWatts, 50);
    assert.equal(summary.utilizationPct, 50);
    assert.equal(summary.status, 'nominal');

    // Push load above 100W PSE budget -> overload + engineeringValidator error
    proj.assets[ap1.id] = { ...ap1, poeWatts: 85 };
    const overloadSummary = computeProjectPoeSummary(proj);
    assert.equal(overloadSummary.totalPoeWatts, 111); // 12 + 85 + 14
    assert.equal(overloadSummary.headroomWatts, -11);
    assert.equal(overloadSummary.status, 'overload');

    const audit = runEngineeringAudit(proj);
    assert.equal(audit.summary.totalPoeWattsEstimate, 111);
    assert.ok(audit.issues.some(i => i.id === 'poe_budget_overload' && i.severity === 'error'));
  });

  // 19. Per-Switch PoE Consumption vs Budget Breakdown Tests
  await runTest('poeCalculator: computeSwitchPoeBreakdown attributes connected & patch-routed PDs per switch and detects overload', () => {
    const proj = createEnterpriseTopologyProject();
    proj.nodes = [];
    proj.cables = [];
    proj.racks = [];

    const makeDev = (
      id: string,
      name: string,
      category: DeviceAsset['category'],
      partial: Partial<DeviceAsset> = {}
    ): DeviceAsset => ({
      id,
      name,
      category,
      vendor: 'Cisco',
      model: 'C9300-24P',
      assetTag: id.toUpperCase(),
      serialNumber: `SN-${id}`,
      ipAddress: '10.20.0.10',
      subnetMask: '255.255.255.0',
      gateway: '10.20.0.1',
      macAddress: '00:11:22:33:44:66',
      vlan: '10',
      status: 'online',
      powerWatts: 0,
      ports: [],
      ...partial
    });

    const sw1 = makeDev('sw_1', 'SW-FL1-01', 'switch', {
      poeBudgetWatts: 120,
      ports: [{ id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const sw2 = makeDev('sw_2', 'SW-FL2-01', 'switch', {
      poeBudgetWatts: 30,
      ports: [{ id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const patch = makeDev('pp_1', 'PATCH-01', 'patch_panel');
    const ap1 = makeDev('ap_1', 'AP-01', 'ap', { poeWatts: 22 });
    const cam1 = makeDev('cam_1', 'CAM-01', 'camera', { poeWatts: 15 });
    const cam2 = makeDev('cam_2', 'CAM-02', 'camera', { poeWatts: 35 });
    const orphanAp = makeDev('ap_unwired', 'AP-UNWIRED', 'ap', { poeWatts: 18 });

    proj.assets = {
      [sw1.id]: sw1,
      [sw2.id]: sw2,
      [patch.id]: patch,
      [ap1.id]: ap1,
      [cam1.id]: cam1,
      [cam2.id]: cam2,
      [orphanAp.id]: orphanAp
    };

    const mkNode = (id: string, assetId: string) => ({
      id,
      diagramMode: 'topology' as const,
      floorId: proj.activeFloorId,
      type: 'device' as const,
      assetId,
      label: id,
      x: 100,
      y: 100,
      width: 120,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155EEF', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid' as const, opacity: 1 }
    });

    proj.nodes = [
      mkNode('n_sw1', sw1.id),
      mkNode('n_sw2', sw2.id),
      mkNode('n_pp', patch.id),
      mkNode('n_ap1', ap1.id),
      mkNode('n_cam1', cam1.id),
      mkNode('n_cam2', cam2.id),
      mkNode('n_orphan', orphanAp.id)
    ];

    const mkCable = (id: string, src: string, tgt: string): CableEdge => ({
      id,
      cableCode: id.toUpperCase(),
      diagramMode: 'topology',
      sourceNodeId: src,
      targetNodeId: tgt,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#155EEF',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active'
    });

    // sw1 <- ap1 (direct), sw1 <- patch <- cam1 (2-hop through passive patch panel), sw2 <- cam2 (overloads 30W budget!)
    proj.cables = [
      mkCable('c1', 'n_sw1', 'n_ap1'),
      mkCable('c2', 'n_sw1', 'n_pp'),
      mkCable('c3', 'n_pp', 'n_cam1'),
      mkCable('c4', 'n_sw2', 'n_cam2')
    ];

    const breakdown = computeSwitchPoeBreakdown(proj);
    assert.equal(breakdown.switches.length, 2);

    const b1 = breakdown.switches.find(s => s.assetId === 'sw_1')!;
    const b2 = breakdown.switches.find(s => s.assetId === 'sw_2')!;
    assert.equal(b1.consumedWatts, 37); // 22 + 15
    assert.equal(b1.budgetWatts, 120);
    assert.equal(b1.headroomWatts, 83);
    assert.equal(b1.status, 'nominal');
    assert.equal(b1.connectedPds.length, 2);

    assert.equal(b2.consumedWatts, 35);
    assert.equal(b2.budgetWatts, 30);
    assert.equal(b2.headroomWatts, -5);
    assert.equal(b2.status, 'overload');

    assert.equal(breakdown.unassignedPds.length, 1);
    assert.equal(breakdown.unassignedPds[0].assetId, 'ap_unwired');
    assert.equal(breakdown.unassignedWatts, 18);
    assert.equal(breakdown.totalConsumedWatts, 90);
    assert.equal(breakdown.totalBudgetWatts, 150);
  });

  // 40. Group E (E2-E5): Free U Blocks, PDU Outlets, L2 Loop Detector, Bulk CSV IP, Optical Loss & UPS/Outage
  await runTest('Group E2-E5: rack free blocks, PDU outlets, L2 loop detection, bulk IP CSV, optical budget & UPS runtime', () => {
    const rackProj = createServerRackProject();
    const rack = rackProj.racks[0];
    const freeBlocks = findContiguousFreeUBlocks(rack, rackProj.assets, 2, 'front');
    assert.ok(freeBlocks.length >= 1);
    assert.ok(freeBlocks.every(b => b.size >= 2));

    const pduSummary = computeRackPduOutletSummary(rack, rackProj.assets);
    assert.ok(pduSummary.poweredDeviceCount >= 1);

    // L2 Switching Loop Detection (3 switches in a triangle)
    const loopProj = createEnterpriseTopologyProject();
    const swAssets = Object.values(loopProj.assets).filter(a => a.category === 'switch' || a.category === 'core_switch');
    const swNodes = swAssets
      .map(a => loopProj.nodes.find(n => n.assetId === a.id && n.diagramMode === 'topology'))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    if (swNodes.length >= 3) {
      loopProj.cables.push(
        { id: 'lp1', cableCode: 'LP1', diagramMode: 'topology', sourceNodeId: swNodes[0].id, targetNodeId: swNodes[1].id, cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' },
        { id: 'lp2', cableCode: 'LP2', diagramMode: 'topology', sourceNodeId: swNodes[1].id, targetNodeId: swNodes[2].id, cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' },
        { id: 'lp3', cableCode: 'LP3', diagramMode: 'topology', sourceNodeId: swNodes[2].id, targetNodeId: swNodes[0].id, cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' }
      );
      const loops = detectL2SwitchingLoops(loopProj);
      assert.ok(loops.length >= 1, 'Expected triangle switching loop to be detected');
    }

    // Bulk static IP CSV import
    const firstAsset = Object.values(loopProj.assets)[0];
    const bulkRes = parseAndApplyBulkStaticIpsCsv(
      `target,ipAddress,subnetMask,gateway,vlan\n${firstAsset.name},10.99.0.10,255.255.255.0,10.99.0.1,99\nbad_device,999.1.1.1`,
      loopProj
    );
    assert.equal(bulkRes.updatedCount, 1);
    assert.equal(bulkRes.updatedAssets[firstAsset.id].ipAddress, '10.99.0.10');
    assert.ok(bulkRes.errors.length >= 1);

    // Optical link budget
    const smOk = computeOpticalLinkBudget({ cableType: 'FIBER_SM_OS2', lengthMeters: 1000, connectorCount: 2, spliceCount: 2 });
    assert.equal(smOk.status, 'nominal');
    assert.ok(smOk.totalLossDb < 2);
    const mmBad = computeOpticalLinkBudget({ cableType: 'FIBER_MM_OM4', lengthMeters: 1500, connectorCount: 4, spliceCount: 4 });
    assert.equal(mmBad.status, 'exceeded');

    // UPS battery runtime & branch outage simulator
    const ups = computeUpsBatteryRuntime({ totalLoadWatts: 500, batteryAh: 100, batteryVoltageV: 48, batteryCount: 1 });
    assert.ok(ups.runtimeMinutes > 300);
    assert.equal(ups.status, 'adequate');
    const starProj = ARCHITECTURE_TEMPLATES.find(t => t.id === 'tpl_std_lan_star')!.createProject();
    const swNode = starProj.nodes.find(n => n.assetId && starProj.assets[n.assetId]?.category === 'switch')!;
    const outage = simulateBranchOutage(starProj, [swNode.id]);
    assert.ok(outage.affectedDownstreamDevices.length >= 1);
    assert.ok(outage.lostTotalWatts > 0);
  });

  // 41. Group E (E6-E7): Wall Attenuation, Tray-Aware Routing, Scanner Diff-Merge & Revision Diff
  await runTest('Group E6-E7: wall RSSI attenuation, tray routing, scanner diff-merge & detailed revision diff', () => {
    const proj = createMultiFloorSampleOfficeProject();
    const wallSegments = collectFloorWallSegments(proj, proj.activeFloorId);
    assert.ok(wallSegments.length >= 4);
    const crossing = computeSegmentWallCrossings({ x: 0, y: 0 }, { x: 2000, y: 2000 }, wallSegments);
    assert.ok(crossing.crossingCount >= 1);
    assert.ok(crossing.totalAttenuationDb > 0);

    const openRssi = estimateWifiRssiDbm({ x: 50, y: 50 }, { x: 150, y: 50 }, 20, 30, []);
    const blockedRssi = estimateWifiRssiDbm({ x: 50, y: 50 }, { x: 150, y: 50 }, 20, 30, [
      { x1: 100, y1: 0, x2: 100, y2: 100, material: 'concrete', opaque: true }
    ]);
    assert.ok(blockedRssi.estimatedRssiDbm <= openRssi.estimatedRssiDbm - 12);

    // Tray-aware auto-routed waypoints
    const routed = computeAutoRoutedWaypoints(
      { x: 50, y: 200, width: 100, height: 50 },
      { x: 500, y: 220, width: 100, height: 50 },
      [{ id: 'obs1', x: 250, y: 170, width: 120, height: 150 }],
      {
        preferredTrays: [
          { id: 't1', name: 'Máng T1', floorId: proj.activeFloorId, kind: 'network_tray', widthPx: 16, points: [{ x: 100, y: 126 }, { x: 550, y: 126 }] }
        ]
      }
    );
    assert.ok(routed.controlPoints.some(pt => Math.abs(pt.y - 126) <= 2), 'Expected cable waypoint to route through tray anchor y=126');

    // NetworkScanner diff-merge
    const csv = 'Name,IP,MAC,Vendor,Category\nCORE-SW-NEW,10.10.10.250,AA:BB:CC:DD:EE:01,Cisco,switch';
    const merge1 = diffMergeNetworkScannerData(csv, proj);
    assert.equal(merge1.addedCount, 1);
    const afterMerge = { ...proj, assets: merge1.assets, nodes: merge1.nodes, cables: merge1.cables };
    const csvUpdate = 'Name,IP,MAC,Vendor,Category\nCORE-SW-RENAMED,10.10.10.250,AA:BB:CC:DD:EE:01,Cisco,switch';
    const merge2 = diffMergeNetworkScannerData(csvUpdate, afterMerge);
    assert.equal(merge2.updatedCount, 1);

    // Detailed revision diff
    const revSnap = structuredClone(proj);
    const curProj = structuredClone(proj);
    const firstKey = Object.keys(curProj.assets)[0];
    curProj.assets[firstKey] = { ...curProj.assets[firstKey], name: 'RENAMED-ASSET-DIFF' };
    const revDiff = computeDetailedRevisionDiff(curProj, revSnap);
    assert.ok(revDiff.modifiedAssets.length >= 1);
    assert.equal(revDiff.summary.addedAssets, 0);
  });

  // 47. P0 UPS Real Wattage & Battery Runtime Validation + upsSpecs Migration Tests
  await runTest('engineeringValidator & projectStorage: uses real UPS capacity (no 1500W floor) and battery-spec runtime', () => {
    const base = createEnterpriseTopologyProject();
    const floorId = base.activeFloorId;
    const makeUpsProject = (upsWatts: number, upsSpecs?: DeviceAsset['upsSpecs']): ProjectState => {
      const proj = structuredClone(base);
      proj.assets = {
        a_load: {
          id: 'a_load',
          assetTag: 'SW-01',
          serialNumber: '',
          name: 'SW-Core',
          category: 'switch',
          vendor: 'Cisco',
          model: 'C9200',
          ipAddress: '10.0.0.1',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.254',
          macAddress: '',
          vlan: '1',
          powerWatts: 300,
          ports: [],
          status: 'online',
          floorId
        },
        a_ups: {
          id: 'a_ups',
          assetTag: 'UPS-01',
          serialNumber: '',
          name: 'UPS Test',
          category: 'ups',
          vendor: 'APC',
          model: 'Smart-UPS',
          ipAddress: '',
          subnetMask: '',
          gateway: '',
          macAddress: '',
          vlan: '',
          powerWatts: upsWatts,
          upsSpecs,
          ports: [],
          status: 'online',
          floorId
        }
      };
      proj.nodes = [
        {
          id: 'n_load',
          diagramMode: 'topology',
          floorId,
          type: 'device',
          assetId: 'a_load',
          label: 'SW-Core',
          x: 100,
          y: 100,
          width: 100,
          height: 60,
          rotation: 0,
          style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1 }
        },
        {
          id: 'n_ups',
          diagramMode: 'topology',
          floorId,
          type: 'device',
          assetId: 'a_ups',
          label: 'UPS Test',
          x: 260,
          y: 100,
          width: 100,
          height: 60,
          rotation: 0,
          style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1 }
        }
      ];
      proj.cables = [];
      return proj;
    };

    // 1) Undeclared UPS (0W, no upsSpecs) -> upsCapacityWatts === 0 (never inflated to 1500), runtime === 0, emits both warnings
    const zeroUpsAudit = runEngineeringAudit(makeUpsProject(0));
    assert.equal(zeroUpsAudit.summary.upsCapacityWatts, 0);
    assert.equal(zeroUpsAudit.summary.estimatedUpsRuntimeMinutes, 0);
    assert.ok(zeroUpsAudit.issues.some(i => i.id === 'ups_missing_capacity_a_ups'));
    assert.ok(zeroUpsAudit.issues.some(i => i.id === 'ups_missing_battery_specs_a_ups'));

    // 2) Declared 600W UPS without battery specs -> keeps exact 600W (not 1500W) and keeps runtime 0 (no 0.45*60 guess)
    const noBatteryAudit = runEngineeringAudit(makeUpsProject(600));
    assert.equal(noBatteryAudit.summary.upsCapacityWatts, 600);
    assert.equal(noBatteryAudit.summary.estimatedUpsRuntimeMinutes, 0);
    assert.ok(!noBatteryAudit.issues.some(i => i.id === 'ups_missing_capacity_a_ups'));
    assert.ok(noBatteryAudit.issues.some(i => i.id === 'ups_missing_battery_specs_a_ups'));

    // 3) Declared 1200W UPS with real battery specs -> matches computeUpsBatteryRuntime formula
    const realSpecs = { batteryAh: 9, batteryVoltageV: 12, batteryCount: 4, inverterEfficiency: 0.85, dodFactor: 0.8 };
    const fullUpsProj = makeUpsProject(1200, realSpecs);
    const fullAudit = runEngineeringAudit(fullUpsProj);
    const expectedBattery = computeUpsBatteryRuntime({ totalLoadWatts: 300, ...realSpecs });
    assert.equal(fullAudit.summary.upsCapacityWatts, 1200);
    assert.equal(fullAudit.summary.estimatedUpsRuntimeMinutes, expectedBattery.runtimeMinutes);
    assert.ok(!fullAudit.issues.some(i => i.id === 'ups_missing_battery_specs_a_ups'));

    // 4) Migration preserves valid upsSpecs and strips invalid zero-capacity ones
    const migratedValid = migrateAndValidateProject(fullUpsProj);
    assert.equal(migratedValid.ok, true);
    if (migratedValid.ok) {
      assert.equal(migratedValid.project.assets['a_ups']?.upsSpecs?.batteryAh, 9);
      assert.equal(migratedValid.project.assets['a_ups']?.upsSpecs?.batteryCount, 4);
    }
    const invalidProj = makeUpsProject(600, { batteryAh: 0, batteryVoltageV: 12, batteryCount: 2 });
    const migratedInvalid = migrateAndValidateProject(invalidProj);
    assert.equal(migratedInvalid.ok, true);
    if (migratedInvalid.ok) {
      assert.equal(migratedInvalid.project.assets['a_ups']?.upsSpecs, undefined);
    }
  });

  // 59. P0 #3 — Power-Domain-Aware UPS Engine, VA * PF, Spec Sanity & Peukert Derating
  await runTest('engineeringValidator & poeCalculator (P0#3): enforces VA*PF, isolates UPS domains, catches W>VA & applies Peukert derating', () => {
    const base = createEnterpriseTopologyProject();
    base.floors = [
      { id: 'flr_1', buildingId: 'b1', level: 1, name: 'Tầng 1', description: '', widthMeters: 20, depthMeters: 15 },
      { id: 'flr_4', buildingId: 'b1', level: 4, name: 'Tầng 4', description: '', widthMeters: 20, depthMeters: 15 }
    ];
    base.racks = [];

    // 1) resolveUpsActiveWatts never equates VA = W (3000VA * 0.8 PF = 2400W)
    const ups3kva: DeviceAsset = {
      id: 'ups_f1',
      name: 'UPS-F1-3KVA',
      category: 'ups',
      vendor: 'APC',
      model: 'SMT3000',
      assetTag: 'UPS-F1',
      serialNumber: 'SN-U1',
      ipAddress: '10.0.1.5',
      macAddress: '00:00:00:00:01:01',
      subnetMask: '255.255.255.0',
      gateway: '10.0.1.1',
      vlan: '10',
      status: 'online',
      powerWatts: 0,
      weightKg: 30,
      floorId: 'flr_1',
      upsSpecs: {
        ratedVa: 3000,
        powerFactor: 0.8,
        batteryAh: 9,
        batteryVoltageV: 12,
        batteryCount: 8,
        inverterEfficiency: 0.85,
        dodFactor: 0.8
      },
      ports: []
    };
    const resolved3kva = resolveUpsActiveWatts(ups3kva);
    assert.equal(resolved3kva.activeWatts, 2400);
    assert.equal(resolved3kva.hasInvalidSpecs, false);

    // Invalid specs W > VA flags warning and caps at VA * PF
    const impossibleUps: DeviceAsset = { ...ups3kva, id: 'ups_bad', powerWatts: 3500 };
    const resolvedImpossible = resolveUpsActiveWatts(impossibleUps);
    assert.equal(resolvedImpossible.hasInvalidSpecs, true);
    assert.equal(resolvedImpossible.activeWatts, 2400);

    // 2) Cross-floor overload isolation: Floor 1 has 2600W load on 2400W UPS; Floor 4 has idle 2400W UPS
    const upsF4: DeviceAsset = { ...ups3kva, id: 'ups_f4', name: 'UPS-F4-3KVA', ipAddress: '10.0.4.5', floorId: 'flr_4' };
    const loadF1: DeviceAsset = {
      ...ups3kva,
      id: 'srv_f1',
      name: 'SRV-F1-HEAVY',
      category: 'server',
      ipAddress: '10.0.1.10',
      powerWatts: 2600,
      floorId: 'flr_1',
      upsSpecs: undefined
    };

    const domainProj: ProjectState = {
      ...base,
      assets: {
        ups_f1: ups3kva,
        ups_f4: upsF4,
        srv_f1: loadF1
      },
      nodes: [
        { id: 'n_u1', diagramMode: 'floorplan', floorId: 'flr_1', type: 'device', assetId: 'ups_f1', label: 'UPS F1', x: 50, y: 50, width: 80, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } },
        { id: 'n_s1', diagramMode: 'floorplan', floorId: 'flr_1', type: 'device', assetId: 'srv_f1', label: 'SRV F1', x: 180, y: 50, width: 80, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } },
        { id: 'n_u4', diagramMode: 'floorplan', floorId: 'flr_4', type: 'device', assetId: 'ups_f4', label: 'UPS F4', x: 50, y: 50, width: 80, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } }
      ],
      cables: []
    };

    const audit = runEngineeringAudit(domainProj);
    assert.ok(
      audit.issues.some(i => i.id === 'ups_overload_floor:flr_1' && i.severity === 'error'),
      'Overloaded Floor 1 UPS must be reported even when Floor 4 UPS is completely idle'
    );
    assert.equal(audit.summary.upsCapacityWatts, 4800);

    // 3) Peukert derating reduces usable energy under high C-rate load vs nominal C/20 linear
    const heavyBank = computeUpsBatteryRuntime({
      totalLoadWatts: 1200,
      batteryAh: 9,
      batteryVoltageV: 12,
      batteryCount: 4,
      inverterEfficiency: 0.85,
      dodFactor: 0.8
    });
    const linearUsableWh = Math.round(9 * 12 * 4 * 0.85 * 0.8);
    assert.ok((heavyBank.derateFactor ?? 1) < 0.85);
    assert.ok(heavyBank.usableEnergyWh < linearUsableWh);
  });

  // 60. P0 #4 — Trustworthy L2 Switching Loop Classification (2+ switches, routed exclusion, no text bypass)
  await runTest('engineeringValidator (P0#4): detects 2-switch parallel loops, refuses text bypass, trusts structured LACP/STP & excludes L3 routed links', () => {
    const makeSw = (id: string, name: string, stpMode?: 'rstp' | 'none'): DeviceAsset => ({
      id,
      name,
      category: 'switch',
      vendor: 'Cisco',
      model: 'C9300',
      assetTag: id,
      serialNumber: `SN-${id}`,
      ipAddress: `10.10.0.${id === 'sw1' ? 1 : 2}`,
      macAddress: '00:11:22:33:44:55',
      subnetMask: '255.255.255.0',
      gateway: '10.10.0.254',
      vlan: '10',
      status: 'online',
      powerWatts: 120,
      weightKg: 4,
      l2Config: stpMode ? { role: 'access', stpMode } : undefined,
      ports: [
        { id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1G', poe: false, status: 'up' },
        { id: 'p2', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1G', poe: false, status: 'up' }
      ]
    });

    const base = createEnterpriseTopologyProject();
    base.racks = [];
    base.assets = { sw1: makeSw('sw1', 'SW-1'), sw2: makeSw('sw2', 'SW-2') };
    base.nodes = [
      { id: 'n_sw1', diagramMode: 'topology', type: 'device', assetId: 'sw1', label: 'SW-1', x: 50, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } },
      { id: 'n_sw2', diagramMode: 'topology', type: 'device', assetId: 'sw2', label: 'SW-2', x: 250, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } }
    ];
    base.cables = [
      { id: 'c1', cableCode: 'LINK-1', diagramMode: 'topology', sourceNodeId: 'n_sw1', sourcePortId: 'p1', targetNodeId: 'n_sw2', targetPortId: 'p1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, status: 'active' },
      { id: 'c2', cableCode: 'LINK-2', diagramMode: 'topology', sourceNodeId: 'n_sw1', sourcePortId: 'p2', targetNodeId: 'n_sw2', targetPortId: 'p2', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, status: 'active' }
    ];

    // 1) Bare 2-switch parallel cables -> suspected_loop + audit error
    const bareLoops = detectL2SwitchingLoops(base);
    assert.equal(bareLoops.length, 1);
    assert.equal(bareLoops[0].kind, 'parallel_links');
    assert.equal(bareLoops[0].status, 'suspected_loop');
    assert.ok(runEngineeringAudit(base).issues.some(i => i.severity === 'error' && i.id.startsWith('l2_loop_')));

    // 2) Free-text "RSTP/LACP" note alone -> NEVER silent pass, flagged as unverified warning
    const textOnly = structuredClone(base);
    textOnly.cables[0].notes = 'RSTP LACP enabled';
    const textLoops = detectL2SwitchingLoops(textOnly);
    assert.equal(textLoops[0].status, 'unverified');
    assert.ok(runEngineeringAudit(textOnly).issues.some(i => i.severity === 'warning' && i.id.startsWith('l2_loop_')));

    // 3) Structured LACP port_mode + matching lacpGroup -> protected_redundancy (0 L2 loop issues)
    const lacpProj = structuredClone(base);
    lacpProj.assets.sw1.ports.forEach(p => {
      p.portMode = 'lacp_member';
      p.lacpGroup = 'Po1';
    });
    lacpProj.assets.sw2.ports.forEach(p => {
      p.portMode = 'lacp_member';
      p.lacpGroup = 'Po1';
    });
    const lacpLoops = detectL2SwitchingLoops(lacpProj);
    assert.equal(lacpLoops[0].status, 'protected_redundancy');
    assert.equal(runEngineeringAudit(lacpProj).issues.some(i => i.id.startsWith('l2_loop_')), false);

    // 4) Routed L3 ports -> excluded cleanly from L2 graph (0 loops)
    const routedProj = structuredClone(base);
    routedProj.assets.sw1.ports.forEach(p => {
      p.portMode = 'routed';
    });
    assert.equal(detectL2SwitchingLoops(routedProj).length, 0);
  });

  // 69. Per-Subnet IP Statistics Aggregation Tests
  await runTest('ipAutoAssign: computeProjectSubnetIpStats calculates used/free IPs, longest-prefix match, inferred, unmatched & unassigned devices', () => {
    const base = createEnterpriseTopologyProject();
    base.racks = [];
    base.cables = [];
    base.nodes = [];
    base.settings = {
      ...base.settings,
      ipRangeStart: '',
      ipRangeEnd: '',
      ipSubnetMask: '255.255.255.0',
      ipGateway: ''
    };

    const mkAsset = (
      id: string,
      name: string,
      category: DeviceAsset['category'],
      ipAddress: string,
      subnetMask = '',
      gateway = ''
    ): DeviceAsset => ({
      id,
      name,
      category,
      vendor: 'Cisco',
      model: 'Model-1',
      assetTag: id.toUpperCase(),
      serialNumber: `SN-${id}`,
      ipAddress,
      subnetMask,
      gateway,
      macAddress: '00:11:22:33:44:55',
      vlan: '10',
      status: 'online',
      powerWatts: 20,
      ports: []
    });

    // 1) Declared overlapping subnets (/24 vs /26), /30, /31, duplicates, inferred, unmatched, unassigned + passive exclusion
    base.subnets = [
      { id: 'sub_corp', name: 'Corp LAN', cidr: '10.10.0.0/24', vlanId: 10, gateway: '10.10.0.1' },
      { id: 'sub_mgmt', name: 'Mgmt /26', cidr: '10.10.0.192/26', vlanId: 99, gateway: '10.10.0.193' },
      { id: 'sub_p2p30', name: 'WAN P2P /30', cidr: '172.16.1.0/30' },
      { id: 'sub_p2p31', name: 'Link /31', cidr: '172.16.2.0/31' }
    ];

    base.assets = {
      gw_corp: mkAsset('gw_corp', 'RTR-CORP', 'router', '10.10.0.1', '255.255.255.0', '10.10.0.1'),
      sw_dup1: mkAsset('sw_dup1', 'SW-DUP-1', 'switch', '10.10.0.10'),
      sw_dup2: mkAsset('sw_dup2', 'SW-DUP-2', 'switch', '10.10.0.10'), // duplicate IP
      srv_mgmt: mkAsset('srv_mgmt', 'SRV-MGMT', 'server', '10.10.0.200'), // longest-prefix -> sub_mgmt (/26)
      wan_a: mkAsset('wan_a', 'RTR-WAN-A', 'router', '172.16.1.1'),
      p2p_b: mkAsset('p2p_b', 'RTR-P2P-B', 'router', '172.16.2.0'),
      cam_inf: mkAsset('cam_inf', 'CAM-INF-1', 'camera', '192.168.50.11', '255.255.255.0', '192.168.50.1'),
      pc_out: mkAsset('pc_out', 'PC-OUTSIDE', 'workstation', '10.99.99.5', ''), // no mask, outside declared -> __unmatched__
      ap_noip: mkAsset('ap_noip', 'AP-NOIP', 'ap', ''), // assignable -> unassignedDevices
      pp_passive: mkAsset('pp_passive', 'PP-01', 'patch_panel', ''), // passive -> excluded
      odf_passive: mkAsset('odf_passive', 'ODF-01', 'odf', ''), // passive -> excluded
      rack_passive: mkAsset('rack_passive', 'RACK-01', 'rack', '') // passive -> excluded
    };

    const stats = computeProjectSubnetIpStats(base);

    const corp = stats.subnets.find(s => s.id === 'sub_corp')!;
    const mgmt = stats.subnets.find(s => s.id === 'sub_mgmt')!;
    const p2p30 = stats.subnets.find(s => s.id === 'sub_p2p30')!;
    const p2p31 = stats.subnets.find(s => s.id === 'sub_p2p31')!;
    const inferred = stats.subnets.find(s => s.id === 'inferred_192.168.50.0/24')!;
    const unmatched = stats.subnets.find(s => s.id === '__unmatched__')!;

    assert.ok(corp && mgmt && p2p30 && p2p31 && inferred && unmatched);

    // Longest-prefix match placed 10.10.0.200 in mgmt (/26), not corp (/24)
    assert.equal(mgmt.totalUsableIps, 62);
    assert.equal(mgmt.usedIpCount, 1);
    assert.equal(mgmt.freeIpCount, 61);
    assert.equal(mgmt.devices[0].assetId, 'srv_mgmt');
    assert.ok(mgmt.overlaps.some(o => o.includes('10.10.0.0/24')));

    // Corp has gw_corp (10.10.0.1) + sw_dup1 & sw_dup2 sharing 10.10.0.10 => 2 unique used IPs, 3 devices, 2 duplicate entries
    assert.equal(corp.totalUsableIps, 254);
    assert.equal(corp.usedIpCount, 2);
    assert.equal(corp.freeIpCount, 252);
    assert.equal(corp.deviceCount, 3);
    assert.equal(corp.duplicateIpCount, 2);
    assert.equal(corp.utilizationPct, Math.round((2 / 254) * 100));
    assert.equal(corp.devices.find(d => d.assetId === 'gw_corp')?.isGatewayIp, true);

    // /30 and /31 capacity
    assert.equal(p2p30.totalUsableIps, 2);
    assert.equal(p2p30.usedIpCount, 1);
    assert.equal(p2p30.freeIpCount, 1);
    assert.equal(p2p31.totalUsableIps, 2);
    assert.equal(p2p31.usedIpCount, 1);
    assert.equal(p2p31.freeIpCount, 1);

    // Inferred & unmatched
    assert.equal(inferred.source, 'inferred');
    assert.equal(inferred.totalUsableIps, 254);
    assert.equal(inferred.usedIpCount, 1);
    assert.equal(unmatched.source, 'unmatched');
    assert.equal(unmatched.deviceCount, 1);
    assert.equal(unmatched.devices[0].isOutOfSubnet, true);

    // Unassigned excludes passive categories
    assert.equal(stats.unassignedDevices.length, 1);
    assert.equal(stats.unassignedDevices[0].assetId, 'ap_noip');

    // 2) Fallback to project.settings IP plan when project.subnets is empty
    const fallbackProj = structuredClone(base);
    fallbackProj.subnets = [];
    fallbackProj.settings = {
      ...fallbackProj.settings,
      ipRangeStart: '192.168.10.10',
      ipRangeEnd: '192.168.10.100',
      ipSubnetMask: '255.255.255.0',
      ipGateway: '192.168.10.1'
    };
    fallbackProj.assets = {
      sw1: mkAsset('sw1', 'SW-PLAN', 'switch', '192.168.10.10', '255.255.255.0', '192.168.10.1')
    };
    const planStats = computeProjectSubnetIpStats(fallbackProj);
    const planBucket = planStats.subnets.find(s => s.id === '__project_plan__');
    assert.ok(planBucket);
    assert.equal(planBucket.source, 'project_plan');
    assert.equal(planBucket.cidr, '192.168.10.0/24');
    assert.equal(planBucket.usedIpCount, 1);
    assert.equal(planBucket.freeIpCount, 253);
  });

  // 69. Sprint 1: BOM, Engineering Audit & IP/VLAN Matrix exclude orphan/unreferenced assets identically to PoE calculator
  await runTest('crossEngine (Sprint 1): excludes unreferenced orphan assets from BOM, Audit, PoE & IP/VLAN matrix', () => {
    const proj = createEnterpriseTopologyProject();
    const activeNode = proj.nodes.find(n => n.assetId && proj.assets[n.assetId]?.ipAddress);
    assert.ok(activeNode?.assetId);
    const activeAsset = proj.assets[activeNode.assetId];
    const baselineBom = computeProjectBomStats(proj);
    const baselineAudit = runEngineeringAudit(proj);

    // Inject unreferenced orphan asset carrying duplicate IP + huge 900W power load
    const orphanId = 'orphan_ghost_sw';
    proj.assets[orphanId] = {
      ...structuredClone(activeAsset),
      id: orphanId,
      name: 'GHOST-ORPHAN-SW',
      model: 'GHOST-9000X',
      ipAddress: activeAsset.ipAddress,
      powerWatts: 900
    };

    const nextBom = computeProjectBomStats(proj);
    const nextAudit = runEngineeringAudit(proj);
    const nextMatrix = buildIpVlanMatrix(proj);

    assert.equal(nextBom.kpis.deviceCount, baselineBom.kpis.deviceCount);
    assert.equal(nextBom.kpis.totalPowerWatts, baselineBom.kpis.totalPowerWatts);
    assert.equal(nextBom.deviceRows.some(r => r.model === 'GHOST-9000X'), false);
    assert.equal(nextAudit.summary.totalDevices, baselineAudit.summary.totalDevices);
    assert.equal(nextAudit.summary.totalPowerWatts, baselineAudit.summary.totalPowerWatts);
    assert.equal(
      nextAudit.issues.some(i => i.description.includes('GHOST-ORPHAN-SW')),
      false
    );
    assert.equal(nextMatrix.some(row => row.assetId === orphanId), false);
  });

  // 71. Sprint 2: Explicit poeRole resolution & per-switch PoE audit overload
  await runTest('poeCalculator & validator (Sprint 2): honors explicit poeRole & flags per-switch PoE overload', () => {
    const base = createEnterpriseTopologyProject();
    base.nodes = [];
    base.cables = [];
    base.racks = [];

    const sw1: DeviceAsset = {
      id: 'sw_poe_1',
      name: 'SW-ACC-01',
      category: 'switch',
      vendor: 'Cisco',
      model: 'C9200L-24P',
      assetTag: '',
      serialNumber: '',
      ipAddress: '10.10.1.11',
      subnetMask: '255.255.255.0',
      gateway: '10.10.1.1',
      macAddress: '',
      vlan: '10',
      status: 'online',
      powerWatts: 55,
      poeRole: 'pse',
      poeEnabled: true, // Even if legacy flag was toggled, explicit poeRole='pse' wins
      poeBudgetWatts: 60,
      ports: [
        { id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked', poe: true },
        { id: 'p2', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked', poe: true }
      ]
    };
    const sw2: DeviceAsset = {
      ...structuredClone(sw1),
      id: 'sw_poe_2',
      name: 'SW-ACC-02',
      ipAddress: '10.10.1.12',
      poeBudgetWatts: 370,
      ports: [{ id: 'p1', name: 'Gi2/0/1', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked', poe: true }]
    };
    const apNonPoe: DeviceAsset = {
      id: 'ap_dc',
      name: 'AP-DC-ONLY',
      category: 'ap',
      vendor: 'Aruba',
      model: 'AP-515',
      assetTag: '',
      serialNumber: '',
      ipAddress: '10.10.1.21',
      subnetMask: '255.255.255.0',
      gateway: '10.10.1.1',
      macAddress: '',
      vlan: '10',
      status: 'online',
      powerWatts: 18,
      poeRole: 'none',
      poeWatts: 25,
      ports: [{ id: 'p1', name: 'Eth0', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked' }]
    };
    const cam1: DeviceAsset = {
      id: 'cam_1',
      name: 'CAM-PTZ-01',
      category: 'camera',
      vendor: 'Hikvision',
      model: 'DS-2DE',
      assetTag: '',
      serialNumber: '',
      ipAddress: '10.10.1.31',
      subnetMask: '255.255.255.0',
      gateway: '10.10.1.1',
      macAddress: '',
      vlan: '10',
      status: 'online',
      powerWatts: 45,
      poeRole: 'pd',
      poeWatts: 45,
      ports: [{ id: 'p1', name: 'Eth0', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked', poe: true }]
    };
    const cam2: DeviceAsset = {
      ...structuredClone(cam1),
      id: 'cam_2',
      name: 'CAM-PTZ-02',
      ipAddress: '10.10.1.32',
      poeWatts: 30,
      powerWatts: 30
    };

    assert.equal(resolvePoeDeviceRole(sw1), 'pse');
    assert.equal(resolvePoeDeviceRole(apNonPoe), 'none');
    assert.equal(resolvePoeDeviceRole(cam1), 'pd');
    assert.equal(isPseDevice(sw1), true);
    assert.equal(isPoeConsumerDevice(sw1), false);
    assert.equal(isPoeConsumerDevice(apNonPoe), false);

    base.assets = { sw_poe_1: sw1, sw_poe_2: sw2, ap_dc: apNonPoe, cam_1: cam1, cam_2: cam2 };
    base.nodes = [
      { id: 'n_sw1', diagramMode: 'topology', type: 'device', assetId: 'sw_poe_1', label: 'SW-ACC-01', x: 100, y: 100, width: 140, height: 56, rotation: 0, style: { backgroundColor: '#0284c7', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff', iconColor: '#fff' } },
      { id: 'n_sw2', diagramMode: 'topology', type: 'device', assetId: 'sw_poe_2', label: 'SW-ACC-02', x: 300, y: 100, width: 140, height: 56, rotation: 0, style: { backgroundColor: '#0284c7', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff', iconColor: '#fff' } },
      { id: 'n_ap', diagramMode: 'topology', type: 'device', assetId: 'ap_dc', label: 'AP-DC-ONLY', x: 300, y: 240, width: 120, height: 56, rotation: 0, style: { backgroundColor: '#0284c7', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff', iconColor: '#fff' } },
      { id: 'n_cam1', diagramMode: 'topology', type: 'device', assetId: 'cam_1', label: 'CAM-PTZ-01', x: 60, y: 240, width: 120, height: 56, rotation: 0, style: { backgroundColor: '#0284c7', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff', iconColor: '#fff' } },
      { id: 'n_cam2', diagramMode: 'topology', type: 'device', assetId: 'cam_2', label: 'CAM-PTZ-02', x: 180, y: 240, width: 120, height: 56, rotation: 0, style: { backgroundColor: '#0284c7', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff', iconColor: '#fff' } }
    ];
    base.cables = [
      { id: 'c1', cableCode: 'C-01', diagramMode: 'topology', sourceNodeId: 'n_sw1', sourcePortId: 'p1', targetNodeId: 'n_cam1', targetPortId: 'p1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#2563eb', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, status: 'active' },
      { id: 'c2', cableCode: 'C-02', diagramMode: 'topology', sourceNodeId: 'n_sw1', sourcePortId: 'p2', targetNodeId: 'n_cam2', targetPortId: 'p1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#2563eb', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 30, status: 'active' },
      { id: 'c3', cableCode: 'C-03', diagramMode: 'topology', sourceNodeId: 'n_sw2', sourcePortId: 'p1', targetNodeId: 'n_ap', targetPortId: 'p1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#2563eb', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 20, status: 'active' }
    ];

    // Total PoE across project is 75W vs 430W total PSE budget -> project-wide OK,
    // BUT SW-ACC-01 has 75W > 60W budget -> per-switch audit MUST catch overload!
    const poeSummary = computeProjectPoeSummary(base);
    assert.equal(poeSummary.totalPoeWatts, 75);
    assert.equal(poeSummary.status, 'nominal');

    const audit = runEngineeringAudit(base);
    assert.ok(audit.issues.some(i => i.id === 'poe_switch_overload_sw_poe_1' && i.severity === 'error'));
    assert.equal(audit.issues.some(i => i.id === 'poe_budget_overload'), false);
  });

  // 72. Sprint 2: Port media incompatibility, TIA-568 100m copper limit, optical budget & persistent cable specs migration
  await runTest('engineeringValidator & storage (Sprint 2): audits TIA-568/optical/port compatibility & preserves new fields', () => {
    const base = createEnterpriseTopologyProject();
    base.nodes = [];
    base.cables = [];
    base.racks = [];

    const aSw: DeviceAsset = {
      id: 'sw_a',
      name: 'SW-A',
      category: 'core_switch',
      vendor: 'Cisco',
      model: 'C9500',
      assetTag: '',
      serialNumber: '',
      ipAddress: '10.20.0.1',
      subnetMask: '255.255.255.0',
      gateway: '10.20.0.254',
      macAddress: '',
      vlan: '10',
      status: 'online',
      powerWatts: 120,
      ports: [
        { id: 'rj1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked' },
        { id: 'rj2', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked' },
        { id: 'sfp1', name: 'Te1/0/1', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' }
      ]
    };
    const bSw: DeviceAsset = {
      id: 'sw_b',
      name: 'SW-B',
      category: 'switch',
      vendor: 'Cisco',
      model: 'C9200',
      assetTag: '',
      serialNumber: '',
      ipAddress: '10.20.0.2',
      subnetMask: '255.255.255.0',
      gateway: '10.20.0.254',
      macAddress: '',
      vlan: '10',
      status: 'online',
      powerWatts: 80,
      ports: [
        { id: 'rj1', name: 'Gi2/0/1', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked' },
        { id: 'sfp1', name: 'Te2/0/1', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' },
        { id: 'sfp2', name: 'Te2/0/2', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' }
      ]
    };

    base.assets = { sw_a: aSw, sw_b: bSw };
    base.nodes = [
      { id: 'n_a', diagramMode: 'topology', type: 'device', assetId: 'sw_a', label: 'SW-A', x: 100, y: 100, width: 140, height: 56, rotation: 0, style: { backgroundColor: '#0284c7', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff', iconColor: '#fff' } },
      { id: 'n_b', diagramMode: 'topology', type: 'device', assetId: 'sw_b', label: 'SW-B', x: 400, y: 100, width: 140, height: 56, rotation: 0, style: { backgroundColor: '#0284c7', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff', iconColor: '#fff' } }
    ];
    base.cables = [
      // 1) Copper Cat6 > 100m -> error
      {
        id: 'cab_long_cu',
        cableCode: 'CU-LONG',
        diagramMode: 'topology',
        sourceNodeId: 'n_a',
        sourcePortId: 'rj1',
        targetNodeId: 'n_b',
        targetPortId: 'rj1',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 125,
        slackFactor: 1.25,
        status: 'active'
      },
      // 2) Copper RJ45 connected directly to optical SFP+ -> port incompatibility error
      {
        id: 'cab_incompat',
        cableCode: 'BAD-PORT',
        diagramMode: 'topology',
        sourceNodeId: 'n_a',
        sourcePortId: 'rj2',
        targetNodeId: 'n_b',
        targetPortId: 'sfp1',
        cableType: 'FIBER_SM_OS2',
        bandwidth: '10G',
        color: '#eab308',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 50,
        status: 'active'
      },
      // 3) Optical cable exceeding transceiver budget due to persistent connectors & splices
      {
        id: 'cab_opt_loss',
        cableCode: 'FO-LOSS',
        diagramMode: 'topology',
        sourceNodeId: 'n_a',
        sourcePortId: 'sfp1',
        targetNodeId: 'n_b',
        targetPortId: 'sfp2',
        cableType: 'FIBER_MM_OM4',
        bandwidth: '10G',
        color: '#06b6d4',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 450,
        fiberConnectors: 12,
        fiberSplices: 16,
        transceiverBudgetDb: 8,
        status: 'active'
      }
    ];

    const audit = runEngineeringAudit(base);
    assert.ok(audit.issues.some(i => i.id === 'copper_distance_cab_long_cu' && i.severity === 'error'));
    assert.ok(audit.issues.some(i => i.id === 'port_incompat_cab_incompat' && i.severity === 'error'));
    assert.ok(audit.issues.some(i => i.id === 'media_fiber_on_rj45_cab_incompat' && i.severity === 'error'));
    assert.ok(audit.issues.some(i => i.id === 'om4_distance_cab_opt_loss' && i.severity === 'warning'));
    assert.ok(audit.issues.some(i => i.id === 'optical_budget_exceeded_cab_opt_loss' && i.severity === 'error'));

    // Round-trip via migrateAndValidateProject preserves & clamps new Sprint 2 fields
    const migrated = migrateAndValidateProject(JSON.parse(JSON.stringify(base)));
    assert.equal(migrated.ok, true);
    if (migrated.ok) {
      const mCu = migrated.project.cables.find(c => c.id === 'cab_long_cu')!;
      const mFo = migrated.project.cables.find(c => c.id === 'cab_opt_loss')!;
      assert.equal(mCu.slackFactor, 1.25);
      assert.equal(mFo.fiberConnectors, 12);
      assert.equal(mFo.fiberSplices, 16);
      assert.equal(mFo.transceiverBudgetDb, 8);
    }
  });

  // 73. CAT6_UTP @ 10G > 55m channel limit check in engineeringValidator & bomAggregator
  await runTest('engineeringValidator & bomAggregator: flags CAT6_UTP @ 10G exceeding 55m while allowing CAT6A_STP 10G and CAT6_UTP 1G', () => {
    const base = createEnterpriseTopologyProject();
    base.nodes = base.nodes.slice(0, 2);
    const n1 = base.nodes[0];
    const n2 = base.nodes[1];
    base.racks = [];
    base.cables = [
      {
        id: 'cab_cat6_10g_70m',
        cableCode: 'CAT6-10G-70M',
        diagramMode: 'topology',
        sourceNodeId: n1.id,
        targetNodeId: n2.id,
        cableType: 'CAT6_UTP',
        bandwidth: '10G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 70,
        status: 'active'
      },
      {
        id: 'cab_cat6a_10g_70m',
        cableCode: 'CAT6A-10G-70M',
        diagramMode: 'topology',
        sourceNodeId: n1.id,
        targetNodeId: n2.id,
        cableType: 'CAT6A_STP',
        bandwidth: '10G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 70,
        status: 'active'
      },
      {
        id: 'cab_cat6_1g_70m',
        cableCode: 'CAT6-1G-70M',
        diagramMode: 'topology',
        sourceNodeId: n1.id,
        targetNodeId: n2.id,
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 70,
        status: 'active'
      }
    ];

    const audit = runEngineeringAudit(base);
    assert.ok(
      audit.issues.some(i => i.id === 'cat6_10g_distance_cab_cat6_10g_70m' && i.severity === 'warning'),
      'Expected warning for CAT6_UTP @ 10G over 55m'
    );
    assert.equal(
      audit.issues.some(i => i.id === 'copper_distance_cab_cat6_10g_70m'),
      false,
      '70m should not trigger >100m error'
    );
    assert.equal(
      audit.issues.some(i => i.id === 'cat6_10g_distance_cab_cat6a_10g_70m'),
      false,
      'CAT6A_STP @ 10G at 70m is valid within 100m'
    );
    assert.equal(
      audit.issues.some(i => i.id === 'cat6_10g_distance_cab_cat6_1g_70m'),
      false,
      'CAT6_UTP @ 1G at 70m is valid within 100m'
    );

    const bom = computeProjectBomStats(base);
    assert.ok(
      bom.precision.warnings.some(w => w.code === 'TIA_CAT6_10G_55M'),
      'Expected BOM precision warning TIA_CAT6_10G_55M'
    );
  });
}

runStandaloneSuite(import.meta.url, runPowerAndValidatorTests);
