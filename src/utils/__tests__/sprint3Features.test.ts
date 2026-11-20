import assert from 'node:assert/strict';
import { createEnterpriseTopologyProject } from '../../data/templates';
import { computeProjectBomStats } from '../bomAggregator';
import { estimateBomWithLabor } from '../tia606';
import { computeCableTrayLengthMeters, calculateTrayAwareCableLengthMeters } from '../cableRouting';
import { pruneOrphanAssets } from '../../store/slices/rackDeviceHelpers';
import { normalizeScalePxPerMeter } from '../scaleUtils';
import type { CableEdge, CableTray } from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runSprint3FeaturesTests(runTest: TestFn): Promise<void> {
  await runTest('BOM unification: estimateBomWithLabor reconciles with computeProjectBomStats', () => {
    const project = createEnterpriseTopologyProject();
    project.cableTrays = [
      {
        id: 'tray_1',
        name: 'Máng cáp trục chính',
        kind: 'network_tray',
        widthPx: 20,
        points: [
          { x: 100, y: 100 },
          { x: 400, y: 100 },
          { x: 400, y: 250 }
        ]
      },
      {
        id: 'tray_conduit',
        name: 'Ống gen nhánh',
        kind: 'conduit',
        widthPx: 14,
        points: [
          { x: 200, y: 300 },
          { x: 500, y: 300 }
        ]
      }
    ];

    const bom = computeProjectBomStats(project);
    const laborBom = estimateBomWithLabor(project);

    const rowByType = new Map(bom.cableRows.map(r => [r.cableType, r]));
    const expectedCat6 = Math.round((rowByType.get('CAT6_UTP')?.totalWithReserveMeters || 0) * 10) / 10;
    const expectedCat6a = Math.round((rowByType.get('CAT6A_STP')?.totalWithReserveMeters || 0) * 10) / 10;
    const expectedFiber =
      Math.round(
        ((rowByType.get('FIBER_SM_OS2')?.totalWithReserveMeters || 0) +
          (rowByType.get('FIBER_MM_OM4')?.totalWithReserveMeters || 0)) *
          10
      ) / 10;

    const itemByCode = new Map(laborBom.items.map(i => [i.code, i]));
    assert.equal(itemByCode.get('VT-CAT6')?.quantity ?? 0, expectedCat6);
    assert.equal(itemByCode.get('VT-CAT6A')?.quantity ?? 0, expectedCat6a);
    assert.equal(itemByCode.get('VT-FO')?.quantity ?? 0, expectedFiber);

    const scalePx = normalizeScalePxPerMeter(project.settings.scale);
    const tray1Len = computeCableTrayLengthMeters(project.cableTrays[0], scalePx);
    assert.equal(tray1Len, Math.round((450 / scalePx) * 10) / 10);
    assert.ok(bom.kpis.trayTotalMeters >= tray1Len);
    assert.ok((itemByCode.get('MG-TRAY')?.quantity ?? 0) >= 1);
    assert.ok((itemByCode.get('MG-PVC')?.quantity ?? 0) >= 1);
  });

  await runTest('cableRouting: calculateTrayAwareCableLengthMeters snaps routes near CableTray', () => {
    const trays: CableTray[] = [
      {
        id: 'tray_corridor',
        name: 'Corridor',
        kind: 'network_tray',
        widthPx: 20,
        points: [
          { x: 100, y: 200 },
          { x: 700, y: 200 }
        ]
      }
    ];
    const sampleCable: CableEdge = {
      id: 'c_tray_test',
      cableCode: 'LAN-T1',
      diagramMode: 'topology',
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 0,
      status: 'active'
    };
    const srcNode = { x: 80, y: 180, width: 60, height: 60 };
    const dstNode = { x: 680, y: 180, width: 60, height: 60 };
    const res = calculateTrayAwareCableLengthMeters(sampleCable, srcNode, dstNode, trays, 30);
    assert.equal(res.routedViaTrayName, 'Corridor');
    assert.ok(res.meters >= 15);
  });

  await runTest('cross-view sync & orphan pruning: shared asset across topology and floorplan preserves BOM count', () => {
    const project = createEnterpriseTopologyProject();
    const assetIds = Object.keys(project.assets);
    const sharedAssetId = assetIds[0];
    const existingNode = project.nodes.find(n => n.assetId === sharedAssetId)!;
    assert.ok(existingNode);

    const floorplanNode = {
      ...structuredClone(existingNode),
      id: 'node_crossview_floorplan',
      diagramMode: 'floorplan' as const,
      floorId: project.activeFloorId || 'flr_1',
      x: 220,
      y: 220
    };
    const withShared = {
      ...project,
      nodes: [...project.nodes, floorplanNode]
    };

    const bomBefore = computeProjectBomStats(project);
    const bomShared = computeProjectBomStats(withShared);
    assert.equal(
      bomShared.kpis.deviceCount,
      bomBefore.kpis.deviceCount,
      'Adding a second DiagramNode referencing the same DeviceAsset must NOT duplicate BOM assets'
    );

    const afterFloorNodeDelete = {
      ...withShared,
      nodes: withShared.nodes.filter(n => n.id !== floorplanNode.id)
    };
    const prunedAfterFirst = pruneOrphanAssets(
      afterFloorNodeDelete.assets,
      afterFloorNodeDelete.nodes,
      afterFloorNodeDelete.racks
    );
    assert.ok(prunedAfterFirst[sharedAssetId], 'Asset should remain while topology node exists');

    const afterAllNodesDelete = {
      ...afterFloorNodeDelete,
      racks: afterFloorNodeDelete.racks.map(r => ({
        ...r,
        slots: Object.fromEntries(Object.entries(r.slots).filter(([, id]) => id !== sharedAssetId)),
        rearSlots: Object.fromEntries(Object.entries(r.rearSlots || {}).filter(([, id]) => id !== sharedAssetId))
      })),
      nodes: afterFloorNodeDelete.nodes.filter(n => n.assetId !== sharedAssetId)
    };
    const prunedAll = pruneOrphanAssets(
      afterAllNodesDelete.assets,
      afterAllNodesDelete.nodes,
      afterAllNodesDelete.racks
    );
    assert.equal(prunedAll[sharedAssetId], undefined, 'Orphan asset should be pruned after last node & rack slot removed');
  });
}

runStandaloneSuite(import.meta.url, runSprint3FeaturesTests);
