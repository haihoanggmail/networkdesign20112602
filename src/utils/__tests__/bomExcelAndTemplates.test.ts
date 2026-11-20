import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { disposeObjectTree, populateInfrastructure3DWorld } from '../../components/canvas/three/proceduralDevices';
import {
  getRackStatistics,
  isRackMountedTopologyShadowNode,
  layoutRackNodesForElevationMode
} from '../rackGeometry';
import { migrateAndValidateProject, CURRENT_SCHEMA_VERSION } from '../projectStorage';
import { runEngineeringAudit } from '../engineeringValidator';
import { generatePureSvgMarkup } from '../svgExport';
import { detectOverlappingNodes } from '../snapGuides';
import {
  ARCHITECTURE_TEMPLATES,
  createEnterpriseTopologyProject,
  createMultiFloorSampleOfficeProject,
  createServerRackProject
} from '../../data/templates';
import { createHachihi2BuildingProject } from '../../data/hachihi2BuildingTemplate';
import {
  buildBomCsvContent,
  escapeBomCsvCell,
  formatBomTsvForClipboard
} from '../bomCsvExporter';
import {
  computeProjectBomStats,
  optimizeCableSpools,
  compareProjectBoms
} from '../bomAggregator';
import {
  resolveDeviceSkuAndPrice,
  resolveCableSkuAndPrice,
  saveBomPriceOverrides,
  loadBomPriceOverrides,
  clearBomPriceOverrides,
  validateAndMergePricingCatalog
} from '../bomPricingCatalog';
import { extractBomQuantitiesFromCad } from '../cadBomExtractor';
import { createDefaultLayer, createEmptyCADDocument } from '../../cad/core/CADDocument';
import { buildTemplateCatalogFromDir } from '../../../scripts/build-template-catalog';
import {
  buildTemplateExportPackage,
  fetchTemplateCatalog,
  normalizeTemplateCatalogPayload,
  prepareProjectFromRawTemplateJson,
  refreshTemplateCatalog,
  slugifyTemplateId
} from '../../services/templateLibrary';
import {
  buildProjectExcelWorkbook,
  buildDetailedBomExcelWorkbook,
  parseExcelDevices
} from '../excelService';
import {
  buildRouterTreeTemplateWorkbook,
  buildRouterTreeExportWorkbook,
  buildSampleRouterTreePreview,
  extractRouterTreeFromProject,
  parseRouterTreeExcelPayload,
  parseRouterTreeTextPayload,
  computeRouterTreeLayout,
  buildProjectFromRouterTree
} from '../excelTreeImporter';
import { computeAutoLayeringPlan, resolveSelectableTargetForLayer } from '../layerPolicy';
import {
  HELP_SUGGESTIONS,
  searchHelpCatalog,
  searchHelpShortcuts
} from '../helpCatalog';
import {
  MAX_RECENT_ACTIONS,
  RecentActionEntry,
  ReplayableActionId,
  pushRecentAction
} from '../recentActions';
import { getDefaultShortcutKeymap } from '../../hooks/useKeyboardShortcuts';
import type { ProjectState } from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runBomExcelAndTemplatesTests(runTest: TestFn): Promise<void> {
  // 3. ExcelJS Export & Round-Trip Import Tests
  await runTest('excelService: builds 6 worksheets and parses xlsx/csv round-trip', async () => {
    const enterprise = createEnterpriseTopologyProject();
    const wb = buildProjectExcelWorkbook(enterprise);
    const sheetNames = wb.worksheets.map(s => s.name);

    assert.equal(sheetNames.length, 6);
    assert.deepEqual(sheetNames, [
      'Tong_Quan',
      'BOM_Vat_Tu',
      'Danh_Sach_Thiet_Bi',
      'Ket_Noi_Cap',
      'Tu_Rack_Chi_Tiet',
      'Theo_Khu_Vuc'
    ]);

    const buffer = await wb.xlsx.writeBuffer();
    const file = new File([buffer], 'roundtrip.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const parsed = await parseExcelDevices(file, enterprise);
    assert.ok(parsed.importedCount > 0);
    assert.ok(Object.keys(parsed.newAssets).length > Object.keys(enterprise.assets).length);

    const csv = [
      'Mã Tài Sản (Asset Tag),Tên Thiết Bị,Loại Thiết Bị,Hãng Sản Xuất,Model,Địa Chỉ IP,VLAN,Công Suất (W)',
      'AST-9001,SW-EDGE-TEST,switch,Aruba,CX6100,10.20.30.40,20,120'
    ].join('\n');
    const csvFile = new File([csv], 'devices.csv', { type: 'text/csv' });
    const parsedCsv = await parseExcelDevices(csvFile, enterprise);
    assert.equal(parsedCsv.importedCount, 1);
  });

  // 24. Export BOM CSV (Assets, Cable Lengths, Front/Rear Rack Components, UTF-8 BOM & RFC-4180 Safety)
  await runTest('bomCsvExporter: builds UTF-8 BOM CSV with grouped assets, cable lengths, rack components, and safe escaping', () => {
    assert.equal(escapeBomCsvCell('plain'), 'plain');
    assert.equal(escapeBomCsvCell('a,b'), '"a,b"');
    assert.equal(escapeBomCsvCell('say "hi"'), '"say ""hi"""');
    assert.equal(escapeBomCsvCell('line1\nline2'), '"line1\nline2"');
    assert.equal(escapeBomCsvCell('=1+1'), "'=1+1");
    assert.equal(escapeBomCsvCell('+cmd'), "'+cmd");
    assert.equal(escapeBomCsvCell(-12.5), '-12.5');

    const proj = createEnterpriseTopologyProject();
    const rackProj = createServerRackProject();
    proj.name = 'Core Office, "Phase 1"';
    proj.floors = [
      {
        id: 'fl_test_1',
        buildingId: 'bld_1',
        level: 1,
        name: 'Tầng 1 - Phòng Máy Chủ',
        description: '',
        widthMeters: 25,
        depthMeters: 16
      }
    ];
    proj.activeFloorId = 'fl_test_1';
    proj.racks = structuredClone(rackProj.racks);
    if (proj.racks.length > 0) {
      proj.racks[0].floorId = 'fl_test_1';
    }
    proj.assets = { ...proj.assets, ...rackProj.assets };

    // Mount a rear-side PDU component inside the first rack to verify both front & rear components appear
    if (proj.racks.length > 0) {
      proj.assets['ast_rear_pdu'] = {
        id: 'ast_rear_pdu',
        name: '=PDU-REAR, 01',
        category: 'pdu',
        vendor: 'APC',
        model: 'AP8953',
        assetTag: 'PDU-R01',
        serialNumber: 'SN-PDU-R01',
        ipAddress: '',
        subnetMask: '',
        gateway: '',
        macAddress: '',
        vlan: '',
        floorId: 'fl_test_1',
        rackId: proj.racks[0].id,
        rackSide: 'rear',
        rackUnitStart: 2,
        rackUnitHeight: 1,
        powerWatts: 15,
        weightKg: 4.5,
        status: 'online',
        ports: []
      };
      proj.racks[0].rearSlots = { ...(proj.racks[0].rearSlots || {}), 2: 'ast_rear_pdu' };
    }

    const res = buildBomCsvContent(proj, '2026-11-14T10:00:00.000Z', { reservePct: 15 });
    assert.ok(res.csvWithBom.startsWith('\uFEFF'));
    assert.ok(res.filename.endsWith('_BOM.csv'));
    assert.ok(res.summary.assetCount >= Object.keys(proj.assets).length);
    assert.equal(res.summary.cableCount, proj.cables.length);
    assert.equal(res.summary.rackCount, proj.racks.length);
    assert.ok(res.summary.rackComponentCount >= 1);

    // Uniform clean spreadsheet headers & categories
    assert.ok(res.csv.startsWith('STT,Nhóm Hạng Mục,Mã SKU,Phân Loại,Hãng Sản Xuất,Model / Quy Cách'));
    assert.ok(res.csv.includes('Đơn Giá (VNĐ),Thành Tiền (VNĐ)'));
    assert.ok(res.csv.includes('Thiết bị & Tủ Rack'));
    assert.ok(res.csv.includes('Dây cáp & Đấu nối'));
    assert.ok(res.csv.includes('Thành phần Tủ Rack'));
    assert.ok(res.csv.includes('TỔNG CỘNG DỰ ÁN'));
    assert.ok(res.csv.includes('+15%'));

    // Escaped project name & formula-neutralized rear rack component name
    assert.ok(res.csv.includes('"Core Office, ""Phase 1"""'));
    assert.ok(res.csv.includes(`"'=PDU-REAR, 01 (PDU-R01)"`));
    assert.ok(res.csv.includes('Mặt sau (Rear)'));
    assert.ok(res.csv.includes('Mặt trước (Front)'));

    // Test BOM aggregator KPIs, reserve %, and search filter + TSV clipboard output
    const stats15 = computeProjectBomStats(proj, { reservePct: 15 });
    assert.ok(stats15.kpis.totalCableWithReserveMeters >= stats15.kpis.rawCableMeters);
    assert.ok(stats15.kpis.recommendedUpsVa > 0);
    assert.ok(stats15.floorRows.length >= 1);

    const filtered = computeProjectBomStats(proj, { searchQuery: 'AP8953' });
    assert.equal(filtered.deviceRows.length, 1);
    assert.equal(filtered.deviceRows[0].model, 'AP8953');

    const tsv = formatBomTsvForClipboard(proj, { reservePct: 15 });
    assert.ok(tsv.includes('\t'));
    assert.ok(tsv.startsWith('STT\tNhóm Hạng Mục\t'));
  });

  // 28. BOM v3.1 Precision, Inferred Accessories, Copper/Fiber Loss & Detailed Live-Formula Excel Tests
  await runTest('bomAggregator & excelService: computes copper/fiber loss, service loop, inferred accessories, TIA warnings & 6-sheet BOM workbook', async () => {
    const proj = createEnterpriseTopologyProject();
    const firstTwo = proj.nodes.filter(n => n.type !== 'rack');
    assert.ok(firstTwo.length >= 2);

    // Ensure project has copper > 100m, fiber, and rack components for full BOM verification
    proj.cables = [
      {
        id: 'cab_cu_long',
        cableCode: 'CU-LONG-01',
        diagramMode: 'topology',
        sourceNodeId: firstTwo[0].id,
        targetNodeId: firstTwo[1].id,
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 120,
        status: 'active'
      },
      {
        id: 'cab_fb_1',
        cableCode: 'FB-TRUNK-01',
        diagramMode: 'topology',
        sourceNodeId: firstTwo[0].id,
        targetNodeId: firstTwo[1].id,
        cableType: 'FIBER_SM_OS2',
        bandwidth: '10G',
        color: '#f59e0b',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 80,
        status: 'active'
      }
    ];

    const stats = computeProjectBomStats(proj, {
      copperLossPct: 15,
      fiberLossPct: 10,
      serviceLoopMetersPerEnd: 3,
      copperSpoolMeters: 305,
      fiberSpoolMeters: 1000
    });

    const copperRow = stats.cableRows.find(r => r.cableType === 'CAT6_UTP')!;
    const fiberRow = stats.cableRows.find(r => r.cableType === 'FIBER_SM_OS2')!;
    assert.ok(copperRow);
    assert.ok(fiberRow);
    assert.equal(copperRow.serviceLoopMeters, 6);
    assert.equal(copperRow.lossPct, 15);
    // (120 + 6) * 1.15 = 144.9m
    assert.equal(copperRow.totalWithReserveMeters, 144.9);

    assert.equal(fiberRow.serviceLoopMeters, 6);
    assert.equal(fiberRow.lossPct, 10);
    // (80 + 6) * 1.10 = 94.6m
    assert.equal(fiberRow.totalWithReserveMeters, 94.6);

    // 3-way reconciliation & TIA 100m warning
    assert.equal(stats.precision.isConsistent, true);
    assert.equal(stats.precision.routeTotalMeters, 200);
    assert.equal(stats.precision.typeTotalMeters, 200);
    assert.equal(stats.precision.floorTotalMeters, 200);
    assert.ok(stats.precision.warnings.some(w => w.code === 'TIA_COPPER_100M'));

    // Inferred accessories with provenance
    const accIds = new Set(stats.inferredAccessories.map(a => a.id));
    assert.ok(accIds.has('acc_keystone_copper'));
    assert.ok(accIds.has('acc_fiber_pigtail_lc'));
    assert.ok(accIds.has('acc_tia606_labels'));

    // Detailed BOM workbook: 7 sheets & live formulas referencing Gia_Dinh_BOM
    const bomWb = buildDetailedBomExcelWorkbook(proj);
    assert.deepEqual(bomWb.worksheets.map(s => s.name), [
      'Tong_Hop',
      'Chi_Tiet_BOM',
      'Theo_Tang',
      'Cap_Tung_Tuyen',
      'Phu_Kien_Suy_Ra',
      'Theo_He_Thong',
      'Gia_Dinh_BOM'
    ]);

    const routesWs = bomWb.getWorksheet('Cap_Tung_Tuyen')!;
    const row2Drop = routesWs.getCell('H2').value as { formula?: string };
    const row2Loop = routesWs.getCell('I2').value as { formula?: string };
    const row2Loss = routesWs.getCell('J2').value as { formula?: string };
    const row2Total = routesWs.getCell('K2').value as { formula?: string };
    assert.equal(row2Drop.formula, 'Gia_Dinh_BOM!$B$8*2');
    assert.equal(row2Loop.formula, 'Gia_Dinh_BOM!$B$2*2');
    assert.equal(row2Loss.formula, 'Gia_Dinh_BOM!$B$3');
    assert.equal(row2Total.formula, 'ROUND((F2+G2+H2+I2)*(1+J2/100),1)');

    const row3Loss = routesWs.getCell('J3').value as { formula?: string };
    assert.equal(row3Loss.formula, 'Gia_Dinh_BOM!$B$4');

    // Legacy 6-sheet project workbook also stays intact for Test #3 compatibility
    const legacyWb = buildProjectExcelWorkbook(proj);
    assert.equal(legacyWb.worksheets.length, 6);
  });

  // 29. Sample Project Category & Multi-Floor Office Topology Template Tests
  await runTest('templates: Sample Project category provides multi-floor office topology with rack assignments, IP subnetting & zero audit issues', () => {
    const sampleTpl = ARCHITECTURE_TEMPLATES.find(t => t.id === 'tpl_sample_multifloor_office');
    assert.ok(sampleTpl);
    assert.equal(sampleTpl.categoryName, 'Dự án mẫu (Sample Project)');
    assert.equal(sampleTpl.badge, 'Sample Project');

    const sample = createMultiFloorSampleOfficeProject();
    assert.equal(sample.buildings.length, 1);
    assert.equal(sample.floors.length, 3);
    assert.equal(sample.rooms.length, 4);
    assert.equal(sample.racks.length, 3);
    assert.equal((sample.vlans || []).length, 5);
    assert.equal((sample.subnets || []).length, 5);
    assert.ok((sample.patchLinks || []).length >= 4);

    // Every floor has assigned rooms/assets, and racks have valid slot assignments
    for (const rk of sample.racks) {
      const rackStats = getRackStatistics(rk, sample.assets);
      assert.ok(rackStats.frontUsedUnits > 0);
      assert.equal(rackStats.overflowItems.length, 0);
      assert.equal(rackStats.isOverweight, false);
    }

    // Zero node overlaps on canvas
    const overlapReport = detectOverlappingNodes(
      sample.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }))
    );
    assert.equal(overlapReport.pairs.length, 0);

    // Clean migration & zero engineering errors or warnings
    const migrated = migrateAndValidateProject(sample);
    assert.equal(migrated.ok, true);

    const audit = runEngineeringAudit(sample);
    assert.equal(audit.summary.errorCount, 0, `Unexpected audit errors: ${audit.issues.map(i => i.title).join('; ')}`);
    assert.equal(audit.summary.warningCount, 0, `Unexpected audit warnings: ${audit.issues.map(i => i.title).join('; ')}`);
  });

  // 30. Hand-Verified BOM Arithmetic Tests (Group 2)
  await runTest('bomAggregator: matches exact hand-verified device counts, wattage, UPS VA, cable loop/loss & spool math', () => {
    const base = createEnterpriseTopologyProject();
    const defaultNodeStyle = {
      backgroundColor: '#1d4ed8',
      borderColor: '#334155',
      borderWidth: 2,
      borderStyle: 'solid' as const,
      opacity: 1
    };
    const handProject: ProjectState = {
      ...base,
      floors: [
        {
          id: 'fl_1',
          buildingId: base.activeBuildingId,
          name: 'Tầng 1',
          description: 'Mặt bằng tầng 1',
          level: 1,
          widthMeters: 30,
          depthMeters: 20
        }
      ],
      activeFloorId: 'fl_1',
      rooms: [],
      racks: [
        {
          id: 'rk_1',
          name: 'Rack-01',
          floorId: 'fl_1',
          totalUnits: 42,
          widthMm: 600,
          depthMm: 1000,
          maxLoadKg: 800,
          x: 100,
          y: 100,
          slots: { 40: 'a_sw1', 38: 'a_sw2' },
          rearSlots: {}
        }
      ],
      assets: {
        a_rk1: {
          id: 'a_rk1',
          assetTag: 'RK-01',
          serialNumber: 'SN-RK01',
          name: 'Rack-01',
          category: 'rack',
          vendor: 'HACHIHI',
          model: 'SR-42U-600x1000',
          ipAddress: '',
          subnetMask: '',
          gateway: '',
          macAddress: '',
          vlan: '',
          rackUnitHeight: 42,
          powerWatts: 0,
          weightKg: 110,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        },
        a_sw1: {
          id: 'a_sw1',
          assetTag: 'SW-01',
          serialNumber: 'SN-SW01',
          name: 'SW-01',
          category: 'switch',
          vendor: 'Cisco',
          model: 'C9200-24P',
          ipAddress: '10.0.0.11',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:11',
          vlan: '10',
          rackUnitHeight: 1,
          powerWatts: 250,
          weightKg: 4.5,
          ports: [],
          status: 'online',
          floorId: 'fl_1',
          rackId: 'rk_1'
        },
        a_sw2: {
          id: 'a_sw2',
          assetTag: 'SW-02',
          serialNumber: 'SN-SW02',
          name: 'SW-02',
          category: 'switch',
          vendor: 'Cisco',
          model: 'C9200-24P',
          ipAddress: '10.0.0.12',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:12',
          vlan: '10',
          rackUnitHeight: 1,
          powerWatts: 250,
          weightKg: 4.5,
          ports: [],
          status: 'online',
          floorId: 'fl_1',
          rackId: 'rk_1'
        },
        a_cam1: {
          id: 'a_cam1',
          assetTag: 'CAM-01',
          serialNumber: 'SN-CAM01',
          name: 'CAM-01',
          category: 'camera',
          vendor: 'Hikvision',
          model: 'DS-2CD2143',
          ipAddress: '10.0.0.21',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:21',
          vlan: '20',
          powerWatts: 15,
          weightKg: 0.8,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        },
        a_cam2: {
          id: 'a_cam2',
          assetTag: 'CAM-02',
          serialNumber: 'SN-CAM02',
          name: 'CAM-02',
          category: 'camera',
          vendor: 'Hikvision',
          model: 'DS-2CD2143',
          ipAddress: '10.0.0.22',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:22',
          vlan: '20',
          powerWatts: 15,
          weightKg: 0.8,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        },
        a_cam3: {
          id: 'a_cam3',
          assetTag: 'CAM-03',
          serialNumber: 'SN-CAM03',
          name: 'CAM-03',
          category: 'camera',
          vendor: 'Hikvision',
          model: 'DS-2CD2143',
          ipAddress: '10.0.0.23',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:23',
          vlan: '20',
          powerWatts: 15,
          weightKg: 0.8,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        }
      },
      nodes: [
        { id: 'n_rk1', type: 'rack', assetId: 'a_rk1', diagramMode: 'topology', floorId: 'fl_1', x: 100, y: 100, width: 180, height: 300, rotation: 0, label: 'Rack-01', style: defaultNodeStyle },
        { id: 'n_sw1', type: 'device', assetId: 'a_sw1', diagramMode: 'topology', floorId: 'fl_1', x: 350, y: 100, width: 80, height: 60, rotation: 0, label: 'SW-01', style: defaultNodeStyle },
        { id: 'n_sw2', type: 'device', assetId: 'a_sw2', diagramMode: 'topology', floorId: 'fl_1', x: 350, y: 220, width: 80, height: 60, rotation: 0, label: 'SW-02', style: defaultNodeStyle },
        { id: 'n_cam1', type: 'device', assetId: 'a_cam1', diagramMode: 'topology', floorId: 'fl_1', x: 550, y: 100, width: 80, height: 60, rotation: 0, label: 'CAM-01', style: defaultNodeStyle },
        { id: 'n_cam2', type: 'device', assetId: 'a_cam2', diagramMode: 'topology', floorId: 'fl_1', x: 550, y: 180, width: 80, height: 60, rotation: 0, label: 'CAM-02', style: defaultNodeStyle },
        { id: 'n_cam3', type: 'device', assetId: 'a_cam3', diagramMode: 'topology', floorId: 'fl_1', x: 550, y: 260, width: 80, height: 60, rotation: 0, label: 'CAM-03', style: defaultNodeStyle }
      ],
      cables: [
        {
          id: 'c_cu_1',
          cableCode: 'CU-01',
          diagramMode: 'topology',
          sourceNodeId: 'n_sw1',
          targetNodeId: 'n_cam1',
          cableType: 'CAT6_UTP',
          bandwidth: '1G',
          color: '#0284c7',
          routingType: 'orthogonal',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 180,
          status: 'active'
        },
        {
          id: 'c_cu_2',
          cableCode: 'CU-02',
          diagramMode: 'topology',
          sourceNodeId: 'n_sw2',
          targetNodeId: 'n_cam1',
          cableType: 'CAT6_UTP',
          bandwidth: '1G',
          color: '#0284c7',
          routingType: 'orthogonal',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 160,
          status: 'active'
        },
        {
          id: 'c_fb_1',
          cableCode: 'FB-01',
          diagramMode: 'topology',
          sourceNodeId: 'n_sw1',
          targetNodeId: 'n_sw2',
          cableType: 'FIBER_SM_OS2',
          bandwidth: '10G',
          color: '#f59e0b',
          routingType: 'orthogonal',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 400,
          status: 'active'
        }
      ]
    };

    const stats = computeProjectBomStats(handProject, {
      copperLossPct: 15,
      fiberLossPct: 10,
      serviceLoopMetersPerEnd: 3,
      copperSpoolMeters: 305,
      fiberSpoolMeters: 1000
    });

    assert.equal(stats.kpis.deviceCount, 5);
    assert.equal(stats.kpis.rackCount, 1);
    assert.equal(stats.kpis.totalPowerWatts, 545);
    assert.equal(stats.kpis.recommendedUpsVa, 886);
    assert.equal(stats.kpis.totalWeightKg, 121.4);
    assert.equal(stats.kpis.rawCableMeters, 740);
    assert.equal(stats.kpis.totalCableWithReserveMeters, 851.4);

    const cuRow = stats.cableRows.find(r => r.cableType === 'CAT6_UTP')!;
    assert.equal(cuRow.rawMeters, 340);
    assert.equal(cuRow.serviceLoopMeters, 12);
    assert.equal(cuRow.totalWithReserveMeters, 404.8);
    assert.equal(cuRow.estimatedSpools, 2);

    const fbRow = stats.cableRows.find(r => r.cableType === 'FIBER_SM_OS2')!;
    assert.equal(fbRow.rawMeters, 400);
    assert.equal(fbRow.serviceLoopMeters, 6);
    assert.equal(fbRow.totalWithReserveMeters, 446.6);
    assert.equal(fbRow.estimatedSpools, 1);
    assert.equal(stats.precision.isConsistent, true);
  });

  // 37. Three Benchmark BOM Projects + Vertical Drop/Rise + B4 IDs + B5 Warnings (B9)
  await runTest('bomAggregator: verifies 3 benchmark projects (small office, 2-floor cross-riser, mixed PoE deficit & B4/B5 trace)', () => {
    // Benchmark 1: Small single-floor office (Router + PoE Switch + 2 AP + 3 Cameras + 5x Cat6 @ 20m = 100m raw)
    const bm1 = createEnterpriseTopologyProject();
    bm1.floors = [{ id: 'f1', buildingId: 'b1', name: 'Tầng 1', level: 1, widthMeters: 30, depthMeters: 20, description: 'VP nhỏ' }];
    bm1.buildings = [{ id: 'b1', name: 'VP', totalFloors: 1, basementFloors: 0, floorHeightMeters: 3.5, widthMeters: 30, depthMeters: 20, wallThicknessMm: 200, layoutStyle: 'rectangle' }];
    bm1.racks = [];
    bm1.rooms = [];
    bm1.assets = {
      a_rtr: { id: 'a_rtr', name: 'RTR-01', category: 'router', vendor: 'MikroTik', model: 'RB5009', assetTag: 'R1', serialNumber: '', ipAddress: '192.168.1.1', subnetMask: '255.255.255.0', gateway: '', macAddress: '', vlan: '1', status: 'online', powerWatts: 20, weightKg: 1.2, floorId: 'f1', ports: [] },
      a_sw: { id: 'a_sw', name: 'SW-POE-01', category: 'switch', vendor: 'Cisco', model: 'C1200-24P', assetTag: 'S1', serialNumber: '', ipAddress: '192.168.1.2', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '1', status: 'online', powerWatts: 180, poeBudgetWatts: 195, weightKg: 4.0, floorId: 'f1', ports: [] },
      a_ap1: { id: 'a_ap1', name: 'AP-01', category: 'ap', vendor: 'Ubiquiti', model: 'U6-Pro', assetTag: 'A1', serialNumber: '', ipAddress: '192.168.1.11', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '10', status: 'online', powerWatts: 13, weightKg: 0.5, floorId: 'f1', ports: [] },
      a_ap2: { id: 'a_ap2', name: 'AP-02', category: 'ap', vendor: 'Ubiquiti', model: 'U6-Pro', assetTag: 'A2', serialNumber: '', ipAddress: '192.168.1.12', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '10', status: 'online', powerWatts: 13, weightKg: 0.5, floorId: 'f1', ports: [] },
      a_cam1: { id: 'a_cam1', name: 'CAM-01', category: 'camera', vendor: 'Hikvision', model: 'DS-2CD2143', assetTag: 'C1', serialNumber: '', ipAddress: '192.168.1.21', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '20', status: 'online', powerWatts: 8, weightKg: 0.4, floorId: 'f1', ports: [] },
      a_cam2: { id: 'a_cam2', name: 'CAM-02', category: 'camera', vendor: 'Hikvision', model: 'DS-2CD2143', assetTag: 'C2', serialNumber: '', ipAddress: '192.168.1.22', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '20', status: 'online', powerWatts: 8, weightKg: 0.4, floorId: 'f1', ports: [] }
    };
    bm1.nodes = [
      { id: 'nr1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_rtr', label: 'RTR-01', x: 50, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'ns1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_sw', label: 'SW-POE-01', x: 250, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'na1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_ap1', label: 'AP-01', x: 450, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'na2', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_ap2', label: 'AP-02', x: 450, y: 150, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'nc1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_cam1', label: 'CAM-01', x: 650, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'nc2', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_cam2', label: 'CAM-02', x: 650, y: 150, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } }
    ];
    bm1.cables = [
      { id: 'c1', cableCode: 'CAB-01', diagramMode: 'topology', sourceNodeId: 'nr1', targetNodeId: 'ns1', sourcePortId: 'eth1', targetPortId: 'Gi1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' },
      { id: 'c2', cableCode: 'CAB-02', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'na1', sourcePortId: 'Gi2', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, status: 'active' },
      { id: 'c3', cableCode: 'CAB-03', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'na2', sourcePortId: 'Gi3', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, status: 'active' },
      { id: 'c4', cableCode: 'CAB-04', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'nc1', sourcePortId: 'Gi4', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 20, status: 'active' },
      { id: 'c5', cableCode: 'CAB-05', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'nc2', sourcePortId: 'Gi5', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, status: 'active' }
    ];
    const s1 = computeProjectBomStats(bm1, { copperLossPct: 15, serviceLoopMetersPerEnd: 3, dropHeightMeters: 1.5 });
    // 5 cables * (2*3 loop + 2*1.5 drop) = 45m extra + 100m raw = 145m * 1.15 = 166.8m -> 1 spool (305m)
    assert.equal(s1.kpis.deviceCount, 6);
    assert.equal(s1.kpis.rawCableMeters, 100);
    assert.equal(s1.cableRows[0].dropHeightMeters, 15);
    assert.equal(s1.cableRows[0].serviceLoopMeters, 30);
    assert.equal(s1.cableRows[0].totalWithReserveMeters, 166.8);
    assert.equal(s1.cableRows[0].estimatedSpools, 1);
    assert.equal(s1.cableRows[0].cableIds.length, 5);
    const apGroup = s1.deviceRows.find(d => d.model === 'U6-Pro')!;
    assert.equal(apGroup.nodeIds.length, 2);

    // Benchmark 2: Two-floor cross-riser Fiber trunk (level 1 -> level 3, floorHeight = 4m => +8m vertical rise)
    const bm2 = structuredClone(bm1);
    bm2.floors = [
      { id: 'f1', buildingId: 'b1', name: 'Tầng 1', level: 1, widthMeters: 30, depthMeters: 20, description: '' },
      { id: 'f3', buildingId: 'b1', name: 'Tầng 3', level: 3, widthMeters: 30, depthMeters: 20, description: '' }
    ];
    bm2.buildings = [{ id: 'b1', name: 'Tower', totalFloors: 3, basementFloors: 0, floorHeightMeters: 4, widthMeters: 30, depthMeters: 20, wallThicknessMm: 200, layoutStyle: 'rectangle' }];
    bm2.nodes[2].floorId = 'f3';
    bm2.cables = [
      { id: 'cf1', cableCode: 'FO-01', diagramMode: 'fiber', sourceNodeId: 'ns1', targetNodeId: 'na1', sourcePortId: 'SFP1', targetPortId: 'SFP1', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#f59e0b', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 42, status: 'active' }
    ];
    const s2 = computeProjectBomStats(bm2, { fiberLossPct: 10, serviceLoopMetersPerEnd: 3, dropHeightMeters: 1 });
    // (42 horizontal + 8 cross-floor + 2 drop + 6 loop) = 58 * 1.10 = 63.8m
    assert.equal(s2.cableRows[0].verticalRiseMeters, 8);
    assert.equal(s2.cableRows[0].dropHeightMeters, 2);
    assert.equal(s2.cableRows[0].totalWithReserveMeters, 63.8);
    assert.equal(s2.precision.deltaMeters, 0);

    // Benchmark 3: Multi-floor sample office -> verify B5 warnings & 3-way reconciliation
    const bm3 = createMultiFloorSampleOfficeProject();
    // Inject a standard unspec device and unported cable to verify B5 warnings
    bm3.assets['a_unspec'] = {
      id: 'a_unspec', name: 'TB-CHUA-SPEC', category: 'switch', vendor: 'Generic', model: 'Standard',
      assetTag: '', serialNumber: '', ipAddress: '', subnetMask: '255.255.255.0', gateway: '', macAddress: '',
      vlan: '1', status: 'online', powerWatts: 0, weightKg: 1, floorId: bm3.activeFloorId, ports: []
    };
    bm3.nodes.push({
      id: 'n_unspec',
      diagramMode: 'topology',
      floorId: bm3.activeFloorId,
      type: 'device',
      assetId: 'a_unspec',
      label: 'TB-CHUA-SPEC',
      x: 120,
      y: 120,
      width: 110,
      height: 54,
      rotation: 0,
      style: { backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1 }
    });
    bm3.cables.push({
      id: 'c_auto_port', cableCode: 'AUTO-PORT', diagramMode: 'topology',
      sourceNodeId: bm3.nodes[0].id, targetNodeId: bm3.nodes[1].id,
      cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid',
      strokeWidth: 2, lengthMeters: 15, status: 'active'
    });
    const s3 = computeProjectBomStats(bm3);
    assert.equal(s3.precision.isConsistent, true);
    assert.ok(s3.precision.warnings.some(w => w.code === 'MISSING_PORT_ASSIGNMENT'));
    assert.ok(s3.precision.warnings.some(w => w.code === 'MISSING_DEVICE_SPECS'));
  });

  // 38. Standard Network Templates (LAN / WAN / Core-Dist)
  await runTest('standardNetworkTemplates: validates all 5 templates pass audit & BOM reconciliation', () => {
    const stdIds = [
      'tpl_std_lan_star',
      'tpl_std_lan_vlan_dmz',
      'tpl_std_wan_dual_isp',
      'tpl_std_core_dist_3tier',
      'tpl_std_collapsed_core'
    ];
    for (const id of stdIds) {
      const entry = ARCHITECTURE_TEMPLATES.find(t => t.id === id);
      assert.ok(entry, `Missing template ${id}`);
      const proj = entry.createProject();
      assert.ok(proj.nodes.length >= 4, `${id} should have nodes`);
      assert.ok(proj.cables.length >= 3, `${id} should have cables`);
      const audit = runEngineeringAudit(proj);
      const errors = audit.issues.filter(i => i.severity === 'error');
      assert.equal(errors.length, 0, `${id} audit errors: ${errors.map(e => e.title).join('; ')}`);
      const bom = computeProjectBomStats(proj);
      assert.equal(bom.precision.isConsistent, true, `${id} BOM reconciliation failed`);
    }
  });

  // 39. Group B: Tray BOM, SKU/Pricing Catalog Overrides, Multi-View Breakdown, Spool Optimization & BOM Diff
  await runTest('bomAggregator & bomPricingCatalog: tray BOM, SKU pricing overrides, multi-view, FFD spools & version diff', () => {
    const base = createMultiFloorSampleOfficeProject();
    base.cableTrays = [
      {
        id: 'tray_bom_1',
        name: 'Máng cáp trục tầng 1',
        floorId: base.floors[0].id,
        kind: 'network_tray',
        widthPx: 36,
        points: [
          { x: 100, y: 100 },
          { x: 400, y: 100 },
          { x: 400, y: 250 }
        ]
      }
    ];
    // Raw pixel length = 300 + 150 = 450px @ scale 30px/m = 15m -> expect acc_tray_straight
    const stats = computeProjectBomStats(base, {
      priceOverrides: { 'cable::CAT6_UTP': 15_000 }
    });
    assert.ok(stats.inferredAccessories.some(a => a.id === 'acc_tray_straight' && a.orderQty >= 15));
    assert.ok(stats.floorRows.length >= 2);
    assert.ok(stats.roomRows.length >= 1);
    assert.ok(stats.systemRows.length >= 1);
    assert.ok(stats.rackSummaryRows.length >= 1);
    assert.ok(stats.kpis.estimatedGrandTotalVnd > 0);

    // Pricing catalog lookup & safe localStorage guard
    const skuEntry = resolveDeviceSkuAndPrice('k1', 'switch', 'Cisco', 'Catalyst C9300-48P', { 'CS-C9300-48P': 70_000_000 });
    assert.equal(skuEntry.sku, 'CS-C9300-48P');
    assert.equal(skuEntry.unitPriceVnd, 70_000_000);
    const cabSku = resolveCableSkuAndPrice('CAT6_UTP', { 'cable::CAT6_UTP': 19_000 });
    assert.equal(cabSku.unitPriceVnd, 19_000);
    saveBomPriceOverrides({ 'cable::CAT6_UTP': 19_000 });
    void loadBomPriceOverrides();
    clearBomPriceOverrides();

    // FFD Spool cut optimizer
    const spoolPlans = optimizeCableSpools(base);
    assert.ok(spoolPlans.length >= 1);
    for (const plan of spoolPlans) {
      assert.ok(plan.optimizedSpools >= 1);
      assert.ok(plan.overallUtilizationPct > 0 && plan.overallUtilizationPct <= 100);
    }

    // Compare two BOM versions
    const modified = structuredClone(base);
    modified.cables.push({
      id: 'c_extra_diff',
      cableCode: 'DIFF-01',
      diagramMode: 'topology',
      sourceNodeId: modified.nodes[0].id,
      targetNodeId: modified.nodes[1].id,
      sourcePortId: 'Gi1/0/20',
      targetPortId: 'Gi1/0/20',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 50,
      status: 'active'
    });
    const modifiedStats = computeProjectBomStats(modified);
    const diff = compareProjectBoms(stats, modifiedStats);
    assert.ok(diff.kpis.cableMetersDelta > 0);
    assert.ok(diff.kpis.estimatedCostDeltaVnd > 0);
  });

  // 43. Hierarchical Router Tree Excel Template, Parser, Layouts (Vertical/Horizontal/By-Floor) & New/Merge Project Builder
  await runTest('excelTreeImporter: builds 2-sheet template, parses parent-child uplinks, computes non-overlapping layouts & merges safely', async () => {
    // 1) Built-in 4-tier/4-floor sample matches 10 nodes, 9 links, 4 floors, depth 4
    const sample = buildSampleRouterTreePreview();
    assert.equal(sample.nodes.length, 10);
    assert.equal(sample.links.length, 9);
    assert.equal(sample.floors.length, 4);
    assert.equal(sample.maxDepth, 4);
    assert.deepEqual(sample.rootNames, ['Router-A1']);
    assert.ok(sample.links.some(l => l.isCrossFloor));

    // 2) Generated .xlsx workbook contains 2 sheets and round-trips through XLSX parser cleanly
    const wb = buildRouterTreeTemplateWorkbook();
    assert.deepEqual(wb.worksheets.map(ws => ws.name), ['So_Do_Router_Cay', 'Huong_Dan_Nhap']);
    const xlsxBuf = await wb.xlsx.writeBuffer();
    const parsedXlsx = await parseRouterTreeExcelPayload(xlsxBuf, 'HACHIHI_Mau_So_Do_Router_Da_Tang.xlsx');
    assert.equal(parsedXlsx.nodes.length, 10);
    assert.equal(parsedXlsx.links.length, 9);
    assert.equal(parsedXlsx.floors.length, 4);
    assert.equal(parsedXlsx.maxDepth, 4);

    // 3) CSV with redundant comma-separated parent uplinks and missing parent warning
    const csvPayload = [
      'Tên Thiết Bị,Router Cha (Uplink),Loại Thiết Bị,Hãng,Model,IP,VLAN,Tầng / Khu Vực,Loại Cáp Kết Nối,Cổng Cha,Cổng Con,Công Suất (W),Ghi Chú',
      'Core-01,,router,MikroTik,CCR2116,10.0.0.1,10,Tầng 1,Quang OS2 (10G),,,85,Root',
      'Core-02,,router,MikroTik,CCR2116,10.0.0.2,10,Tầng 1,Quang OS2 (10G),,,85,Backup Root',
      'Dist-01,"Core-01, Core-02",core_switch,Cisco,C9500,10.1.0.1,10,Tầng 2,Quang OS2 (10G),SFP+1,SFP+1,140,Dual uplink',
      'Edge-01,Missing-Parent,switch,Aruba,6200F,10.2.0.1,20,Tầng 3,Cat6A STP (10G),eth1,wan1,65,Missing parent test'
    ].join('\n');
    const parsedCsv = await parseRouterTreeExcelPayload(new TextEncoder().encode(csvPayload), 'custom_tree.csv');
    assert.equal(parsedCsv.nodes.length, 4);
    // Dist-01 has 2 links (Core-01 & Core-02); Edge-01 missing parent warns
    assert.equal(parsedCsv.links.length, 2);
    assert.ok(parsedCsv.warnings.some(w => w.includes('Missing-Parent')));

    // 4) Non-overlapping coordinates across all 3 layout modes
    for (const mode of ['vertical', 'horizontal', 'by_floor'] as const) {
      const layout = computeRouterTreeLayout(parsedXlsx, mode);
      assert.equal(layout.positions.size, 10);
      const rects = Array.from(layout.positions.entries()).map(([id, box]) => ({ id, ...box }));
      const overlaps = detectOverlappingNodes(rects);
      assert.equal(overlaps.pairs.length, 0, `Expected 0 overlapping nodes in ${mode} layout`);
      if (mode === 'by_floor') {
        assert.equal(layout.floorBands.length, 4);
      }
    }

    // 5) Build new_project & merge into existingProject
    const builtNew = buildProjectFromRouterTree(parsedXlsx, {
      layoutMode: 'by_floor',
      applyMode: 'new_project',
      projectName: 'Sơ đồ Router 4 Tầng'
    });
    assert.equal(builtNew.createdNodesCount, 10);
    assert.equal(builtNew.createdCablesCount, 9);
    assert.equal(builtNew.floorCount, 4);
    assert.equal(builtNew.project.floors.length, 4);
    assert.equal(builtNew.project.rooms.length, 4);
    assert.equal(builtNew.project.cables.length, 9);
    const mig = migrateAndValidateProject(builtNew.project);
    assert.equal(mig.ok, true);

    const existing = createEnterpriseTopologyProject();
    const prevNodeCount = existing.nodes.length;
    const prevCableCount = existing.cables.length;
    const builtMerge = buildProjectFromRouterTree(parsedCsv, {
      layoutMode: 'horizontal',
      applyMode: 'merge',
      existingProject: existing
    });
    assert.equal(builtMerge.project.nodes.length, prevNodeCount + 4);
    assert.equal(builtMerge.project.cables.length, prevCableCount + 2);
  });

  // 45. Text/ASCII Tree Paste Parser, Project Router Tree Round-Trip Export, Help Shortcuts, Recent 10 MRU & Unified Layer Selection
  await runTest('text-tree paste, project router tree round-trip, help shortcuts, recent 10 MRU & layer selection', async () => {
    // 1) Parse ASCII / indented box-drawing tree with floor heading
    const asciiTree = [
      'Tầng 1',
      '└── Router 01 (10.0.0.1)',
      '     ├── Switch 01',
      '     │    ├── PC 01',
      '     │    ├── PC 02',
      '     │    └── Camera 01',
      '     └── Switch 02',
      '          ├── AP 01',
      '          └── Camera 02'
    ].join('\n');
    const parsedAscii = parseRouterTreeTextPayload(asciiTree, 'paste_tree.txt');
    assert.equal(parsedAscii.nodes.length, 8);
    assert.equal(parsedAscii.links.length, 7);
    assert.deepEqual(parsedAscii.rootNames, ['Router 01']);
    assert.ok(parsedAscii.nodes.every(n => n.floorName === 'Tầng 1'));
    const pc01 = parsedAscii.nodes.find(n => n.name === 'PC 01');
    const cam02 = parsedAscii.nodes.find(n => n.name === 'Camera 02');
    assert.equal(pc01?.category, 'workstation');
    assert.deepEqual(pc01?.parents, ['Switch 01']);
    assert.equal(cam02?.category, 'camera');
    assert.deepEqual(cam02?.parents, ['Switch 02']);

    // 2) Parse pasted Excel TSV (headered + headerless) and semicolon CSV
    const headeredTsv = [
      'Tên Thiết Bị\tRouter Cha\tLoại Thiết Bị\tĐịa Chỉ IP\tTầng / Khu Vực',
      'RTR-CORE\t\trouter\t10.10.0.1\tTầng 1',
      'SW-DIST\tRTR-CORE\tswitch\t10.10.1.2\tTầng 2'
    ].join('\n');
    const parsedTsv = parseRouterTreeTextPayload(headeredTsv, 'paste.tsv');
    assert.equal(parsedTsv.nodes.length, 2);
    assert.equal(parsedTsv.links.length, 1);
    assert.equal(parsedTsv.links[0].parentName, 'RTR-CORE');
    assert.equal(parsedTsv.links[0].childName, 'SW-DIST');

    const headerlessTsv = [
      'Gateway-01\t\trouter\t192.168.10.1\tTầng Trệt',
      'AP-Sanh\tGateway-01\tap\t192.168.10.20\tTầng Trệt'
    ].join('\n');
    const parsedHeaderlessTsv = parseRouterTreeTextPayload(headerlessTsv, 'paste_no_header.tsv');
    assert.equal(parsedHeaderlessTsv.nodes.length, 2);
    assert.equal(parsedHeaderlessTsv.nodes[1].category, 'ap');
    assert.deepEqual(parsedHeaderlessTsv.nodes[1].parents, ['Gateway-01']);

    const semicolonCsv = [
      'Tên Thiết Bị;Router Cha;Loại Thiết Bị;Địa Chỉ IP;Tầng / Khu Vực',
      'FW-01;;firewall;172.16.0.1;DC',
      'SW-01;FW-01;switch;172.16.0.2;DC'
    ].join('\n');
    const parsedSemicolon = parseRouterTreeTextPayload(semicolonCsv, 'semi.csv');
    assert.equal(parsedSemicolon.nodes.length, 2);
    assert.equal(parsedSemicolon.nodes[0].category, 'firewall');
    assert.equal(parsedSemicolon.links.length, 1);

    // 3) Extract Router Tree from ProjectState (with cycle safety) & round-trip through Excel workbook
    const enterprise = createEnterpriseTopologyProject();
    const extracted = extractRouterTreeFromProject(enterprise);
    assert.ok(extracted.nodes.length >= 3);
    assert.ok(extracted.links.length >= 2);
    const wb = buildRouterTreeExportWorkbook(enterprise);
    assert.deepEqual(wb.worksheets.map(ws => ws.name), ['So_Do_Router_Cay', 'Huong_Dan_Nhap']);
    const roundTripBuf = await wb.xlsx.writeBuffer();
    const roundTripParsed = await parseRouterTreeExcelPayload(roundTripBuf, 'roundtrip_tree.xlsx');
    assert.equal(roundTripParsed.nodes.length, extracted.nodes.length);
    assert.equal(roundTripParsed.links.length, extracted.links.length);

    // 4) Help catalog suggestions & custom keymap shortcut search
    assert.ok(HELP_SUGGESTIONS.length >= 6);
    assert.ok(searchHelpCatalog('dan van ban').some(t => t.id === 'help-excel-tree'));
    const customKeymap = { ...getDefaultShortcutKeymap(), command_palette: 'Alt+Space' };
    const shortcutMatches = searchHelpShortcuts('bang lenh', customKeymap);
    assert.ok(shortcutMatches.some(m => m.id === 'command_palette' && m.combo === 'Alt+Space'));

    // 5) Recent Actions MRU: dedupe, count increment, and strict MAX_RECENT_ACTIONS = 10 cap
    assert.equal(MAX_RECENT_ACTIONS, 10);
    let recent: RecentActionEntry[] = [];
    const actionIds: ReplayableActionId[] = [
      'auto_route_all',
      'fit_screen',
      'generate_legend',
      'auto_assign_ip',
      'auto_layer',
      'open_audit',
      'open_bom',
      'open_export',
      'export_pdf_a4',
      'open_excel_tree',
      'export_excel_tree',
      'toggle_3d'
    ];
    actionIds.forEach((id, idx) => {
      recent = pushRecentAction(recent, id, undefined, 1_000_000 + idx * 1000);
    });
    assert.equal(recent.length, 10);
    assert.equal(recent[0].id, 'toggle_3d');
    assert.equal(recent.some(e => e.id === 'auto_route_all'), false);
    // Re-trigger an existing entry -> promotes to index 0 and increments count
    recent = pushRecentAction(recent, 'open_bom', undefined, 2_000_000);
    assert.equal(recent.length, 10);
    assert.equal(recent[0].id, 'open_bom');
    assert.equal(recent[0].count, 2);

    // 6) Unified layer object selection policy (network, iot, electrical, racks, rooms, cables & hidden layer guard)
    const sample = createMultiFloorSampleOfficeProject();
    const planned = computeAutoLayeringPlan(sample);
    const layerProj: ProjectState = { ...sample, nodes: planned.nodes };
    const netSel = resolveSelectableTargetForLayer(layerProj, 'network');
    assert.equal(netSel.type, 'node');
    const rackSel = resolveSelectableTargetForLayer(layerProj, 'racks');
    assert.ok(rackSel.type === 'node' || rackSel.type === 'none');
    const cableSel = resolveSelectableTargetForLayer(layerProj, 'cables');
    assert.equal(cableSel.type, 'edge');
    const hiddenSelProj: ProjectState = {
      ...layerProj,
      settings: { ...layerProj.settings, hiddenLayers: ['cables', 'rooms'] }
    };
    assert.equal(resolveSelectableTargetForLayer(hiddenSelProj, 'cables').type, 'none');
    assert.equal(resolveSelectableTargetForLayer(hiddenSelProj, 'rooms').type, 'none');
  });

  // 53. Tòa nhà HACHIHI 2 Template (7 Floors B1 + G + 5, 2D CAD, Rack Elevation & Multi-Floor 3D Cutaway)
  await runTest('hachihi2BuildingTemplate: passes 2D/Audit/Rack checks and renders 7-floor 3D cutaway with inter-floor riser cables', () => {
    const tplEntry = ARCHITECTURE_TEMPLATES.find(t => t.id === 'tpl_building_hachihi2');
    assert.ok(tplEntry, 'Expected tpl_building_hachihi2 registered in ARCHITECTURE_TEMPLATES');

    const proj = createHachihi2BuildingProject();
    assert.equal(proj.floors.length, 7);
    assert.deepEqual(
      [...proj.floors].sort((a, b) => a.level - b.level).map(f => f.level),
      [-1, 0, 1, 2, 3, 4, 5]
    );
    assert.equal(proj.racks.length, 7);
    assert.ok(proj.racks.some(r => r.name === 'Main Rack Tầng 4 (42U)' && r.totalUnits === 42));
    assert.equal(proj.racks.filter(r => r.totalUnits === 12).length, 6);
    assert.equal(proj.vlans?.length, 6);
    assert.equal(proj.subnets?.length, 6);
    assert.ok((proj.cableTrays || []).length >= 14);

    // Migration round-trip safety
    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);

    // Engineering Audit: 0 errors, 0 warnings
    const audit = runEngineeringAudit(proj);
    assert.equal(
      audit.summary.errorCount,
      0,
      `Expected 0 audit errors, got: ${audit.issues.filter(i => i.severity === 'error').map(i => i.id + ': ' + i.title).join('; ')}`
    );
    assert.equal(
      audit.summary.warningCount,
      0,
      `Expected 0 audit warnings, got: ${audit.issues.filter(i => i.severity === 'warning').map(i => i.id + ': ' + i.title).join('; ')}`
    );

    // 0 overlapping nodes per floor in 2D floorplan
    const floorplanRacks = proj.nodes.filter(n => n.type === 'rack' && n.diagramMode === 'floorplan');
    for (const flr of proj.floors) {
      const floorNodes = proj.nodes.filter(
        n =>
          n.floorId === flr.id &&
          !isRackMountedTopologyShadowNode(n, proj.assets, floorplanRacks, proj.racks)
      );
      const overlaps = detectOverlappingNodes(floorNodes, -4);
      assert.equal(
        overlaps.pairs.length,
        0,
        `Expected 0 overlaps on floor ${flr.name}, found ${overlaps.pairs.length}`
      );
    }

    // Rack Elevation mode separates overlapping multi-floor racks cleanly
    const laidOutRacks = layoutRackNodesForElevationMode(floorplanRacks, proj.racks);
    assert.equal(laidOutRacks.length, 7);
    assert.equal(detectOverlappingNodes(laidOutRacks, 0).pairs.length, 0);

    // Multi-floor 3D cutaway builds 7 stacked floor levels & finite inter-floor riser cable geometry
    const dummyTex = new THREE.Texture();
    const lockTex = new THREE.Texture();
    const root = new THREE.Group();
    const populated = populateInfrastructure3DWorld(root, proj, undefined, {
      showRooms: true,
      showCables: true,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: dummyTex,
      lockBadgeTex: lockTex,
      viewAllFloors: true
    });
    assert.equal(populated.isMultiFloorCutaway, true);
    assert.ok(populated.bounds.maxY - populated.bounds.minY >= 18);

    const floorYValues = new Set(
      Array.from(populated.nodeGroups.values()).map(entry => Math.round(entry.floorY * 100) / 100)
    );
    assert.equal(floorYValues.size, 7);

    // Verify all 7 racks + vertical inter-floor riser cables exist and have finite coordinates
    const rackEntries = Array.from(populated.nodeGroups.values()).filter(e => e.node.type === 'rack');
    assert.equal(rackEntries.length, 7);

    const interFloorCables = populated.cableEntries.filter(
      ce => Math.abs(ce.srcFloorY - ce.tgtFloorY) > 0.2
    );
    assert.equal(interFloorCables.length, 6);
    for (const ce of populated.cableEntries) {
      assert.ok(Number.isFinite(ce.midWorld.x));
      assert.ok(Number.isFinite(ce.midWorld.y));
      assert.ok(Number.isFinite(ce.midWorld.z));
      const posAttr = ce.mesh.geometry.getAttribute('position');
      assert.ok(posAttr && posAttr.count > 10);
      assert.ok(Number.isFinite(posAttr.getX(0)));
    }

    // Pure SVG export produces crisp 2D CAD markup without errors
    const svg = generatePureSvgMarkup(proj);
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('Máy Chấm Công'));

    disposeObjectTree(root, new Set([dummyTex, lockTex]));
    dummyTex.dispose();
    lockTex.dispose();
  });

  // 54. Closed-Loop CAD Auto-Extract, Dynamic Pricing Catalog JSON & Extended Quotation (Aux + Labor)
  await runTest('cadBomExtractor, bomPricingCatalog & bomAggregator: extracts CAD curves to meters, merges dynamic JSON catalog & computes full quotation across CSV/Excel', async () => {
    // 1) Dynamic Pricing Catalog validation & override resolution
    const invalidCatalog = validateAndMergePricingCatalog({ foo: 'bar' });
    assert.equal(invalidCatalog.ok, false);

    const customMerged = validateAndMergePricingCatalog(
      {
        catalogVersion: '2026.12-test',
        quotationDefaults: { defaultAuxMaterialPct: 7, defaultLaborUnitPriceVnd: 750_000 },
        cablePricePerMeter: {
          CAT6_UTP: { sku: 'CBL-CAT6-CUSTOM', unitPriceVnd: 16_000, supplier: 'CommScope VN' }
        },
        modelOverrides: [
          { pattern: 'C9200-24P', flags: 'i', sku: 'CS-C9200-CUSTOM', unitPriceVnd: 55_000_000, supplier: 'Cisco Official' }
        ]
      },
      'Test API Catalog'
    );
    assert.equal(customMerged.ok, true);
    if (!customMerged.ok) throw new Error('Expected customMerged.ok to be true');

    const customCat6 = resolveCableSkuAndPrice('CAT6_UTP', undefined, customMerged.catalog);
    assert.equal(customCat6.sku, 'CBL-CAT6-CUSTOM');
    assert.equal(customCat6.unitPriceVnd, 16_000);
    const customSwitch = resolveDeviceSkuAndPrice('k_sw', 'switch', 'Cisco', 'C9200-24P', undefined, customMerged.catalog);
    assert.equal(customSwitch.sku, 'CS-C9200-CUSTOM');
    assert.equal(customSwitch.unitPriceVnd, 55_000_000);

    // 2) CAD Document with LINE, LWPOLYLINE (with bulge), SPLINE, ARC, CIRCLE, INSERT block & ignored WALL layer
    const cadDoc = createEmptyCADDocument('MB_Tang1_ELV.dxf', { insUnits: 4 }); // 4 = Millimeters
    for (const lname of ['ELV_CAT6', 'FIBER_OS2', 'TRAY_MANG', 'PVC_CONDUIT', 'WALL', 'CAT6A_STP']) {
      cadDoc.layers[lname] = createDefaultLayer(lname);
    }
    cadDoc.blocks['BLK_TRUNK'] = {
      id: 'blk_trunk',
      name: 'BLK_TRUNK',
      basePoint: { x: 0, y: 0, z: 0 },
      entities: [
        {
          id: 'blk_l1',
          handle: 'B1',
          type: 'LINE',
          layer: '0',
          start: { x: 0, y: 0, z: 0 },
          end: { x: 3000, y: 0, z: 0 },
          preservationTier: 'supported'
        }
      ]
    };
    cadDoc.entities = [
      // 10,000 mm = 10m Cat6
      {
        id: 'cad_l1',
        handle: 'E1',
        type: 'LINE',
        layer: 'ELV_CAT6',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 10000, y: 0, z: 0 },
        preservationTier: 'supported'
      },
      // 5,000 mm straight + semicircle bulge=1 (r=1000mm -> ~3,141.6 mm) => ~8.14 m Cat6
      {
        id: 'cad_lw1',
        handle: 'E2',
        type: 'LWPOLYLINE',
        layer: 'ELV_CAT6',
        closed: false,
        elevation: 0,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 5000, y: 0, bulge: 1 },
          { x: 7000, y: 0, bulge: 0 }
        ],
        preservationTier: 'supported'
      },
      // 12,000 mm = 12m Fiber OS2
      {
        id: 'cad_sp1',
        handle: 'E3',
        type: 'SPLINE',
        layer: 'FIBER_OS2',
        degree: 1,
        closed: false,
        knots: [0, 0, 1, 1],
        controlPoints: [
          { x: 0, y: 0, z: 0 },
          { x: 12000, y: 0, z: 0 }
        ],
        fitPoints: [
          { x: 0, y: 0, z: 0 },
          { x: 12000, y: 0, z: 0 }
        ],
        preservationTier: 'supported'
      },
      // 20,000 mm = 20m Tray + quarter ARC r=2000mm (~3.14m) => ~23.1m Tray
      {
        id: 'cad_tr1',
        handle: 'E4',
        type: 'LINE',
        layer: 'TRAY_MANG',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 20000, y: 0, z: 0 },
        preservationTier: 'supported'
      },
      {
        id: 'cad_arc1',
        handle: 'E5',
        type: 'ARC',
        layer: 'TRAY_MANG',
        center: { x: 0, y: 0, z: 0 },
        radius: 2000,
        startAngle: 0,
        endAngle: 90,
        preservationTier: 'supported'
      },
      // CIRCLE r=500mm -> circumference ~3.14m Conduit
      {
        id: 'cad_cir1',
        handle: 'E6',
        type: 'CIRCLE',
        layer: 'PVC_CONDUIT',
        center: { x: 0, y: 0, z: 0 },
        radius: 500,
        preservationTier: 'supported'
      },
      // INSERT 2x scale * 3,000 mm = 6m CAT6A_STP
      {
        id: 'cad_ins1',
        handle: 'E7',
        type: 'INSERT',
        layer: 'CAT6A_STP',
        blockName: 'BLK_TRUNK',
        position: { x: 1000, y: 1000, z: 0 },
        scale: { x: 2, y: 2, z: 1 },
        rotation: 0,
        preservationTier: 'supported'
      },
      // Architectural WALL layer (50m) must be ignored automatically
      {
        id: 'cad_wall',
        handle: 'E8',
        type: 'LINE',
        layer: 'WALL',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 50000, y: 0, z: 0 },
        preservationTier: 'supported'
      }
    ];

    const cadSummary = extractBomQuantitiesFromCad(cadDoc);
    assert.ok((cadSummary.cableMetersByType.CAT6_UTP || 0) >= 18);
    assert.equal(cadSummary.cableMetersByType.FIBER_SM_OS2, 12);
    assert.equal(cadSummary.cableMetersByType.CAT6A_STP, 6);
    assert.ok(cadSummary.trayMeters >= 23);
    assert.ok(cadSummary.conduitMeters >= 3);
    assert.equal(cadSummary.layers.find(l => l.layerName === 'WALL')?.effectiveTarget, 'ignored');

    // Manual layer remap works cleanly
    const remappedCad = extractBomQuantitiesFromCad(cadDoc, {
      layerMappings: { WALL: 'CAT6_UTP' }
    });
    assert.ok((remappedCad.cableMetersByType.CAT6_UTP || 0) >= 68);

    // 3) Closed-loop BOM aggregation + Quotation (Aux % + Labor) + CSV + Excel export
    const proj = createEnterpriseTopologyProject();
    const bomOptions = {
      cadDocument: cadDoc,
      cadExtractEnabled: true,
      pricingCatalog: customMerged.catalog,
      auxMaterialPct: 8,
      laborWorkdays: 4,
      laborUnitPriceVnd: 700_000
    };
    const stats = computeProjectBomStats(proj, bomOptions);

    assert.ok(stats.cadExtraction);
    assert.equal(stats.precision.isConsistent, true);
    assert.equal(stats.precision.deltaMeters, 0);
    assert.ok(stats.cableRows.some(r => (r.cadRawMeters || 0) >= 18 && (r.cadEntityCount || 0) === 2));
    assert.ok(stats.cableRows.some(r => r.cableType === 'FIBER_SM_OS2' && r.cadRawMeters === 12));
    assert.ok(stats.cableRows.some(r => r.cableType === 'CAT6A_STP' && r.cadRawMeters === 6));
    assert.ok(stats.inferredAccessories.some(a => a.id === 'acc_tray_straight' && a.orderQty >= 23));
    assert.ok(stats.inferredAccessories.some(a => a.id === 'acc_conduit_pvc' && a.orderQty >= 3));

    const expectedMat = stats.kpis.devicesTotalVnd + stats.kpis.cablesTotalVnd + stats.kpis.accessoriesTotalVnd;
    assert.equal(stats.quotation.materialSubtotalVnd, expectedMat);
    assert.equal(stats.quotation.auxMaterialCostVnd, Math.round((expectedMat * 8) / 100));
    assert.equal(stats.quotation.laborTotalVnd, 2_800_000);
    assert.equal(
      stats.quotation.finalQuotationTotalVnd,
      expectedMat + stats.quotation.auxMaterialCostVnd + 2_800_000
    );
    assert.equal(stats.kpis.estimatedGrandTotalVnd, stats.quotation.materialSubtotalVnd);

    const csvRes = buildBomCsvContent(proj, undefined, bomOptions);
    assert.ok(csvRes.csv.includes('Vật tư phụ thi công'));
    assert.ok(csvRes.csv.includes('Nhân công thi công'));
    assert.ok(csvRes.csv.includes('TỔNG BÁO GIÁ HOÀN THIỆN'));

    const wb = buildDetailedBomExcelWorkbook(proj, bomOptions);
    assert.deepEqual(wb.worksheets.map(ws => ws.name), [
      'Tong_Hop',
      'Chi_Tiet_BOM',
      'Theo_Tang',
      'Cap_Tung_Tuyen',
      'Phu_Kien_Suy_Ra',
      'Theo_He_Thong',
      'Gia_Dinh_BOM'
    ]);
    const tongHopText = wb.getWorksheet('Tong_Hop')!
      .getSheetValues()
      .flat()
      .map(v => String(v ?? ''))
      .join(' ');
    assert.ok(tongHopText.includes('Vật tư phụ'));
    assert.ok(tongHopText.includes('TỔNG BÁO GIÁ HOÀN THIỆN'));
  });

  // 55. Dynamic GitHub Template Library: Catalog Builder, Error Isolation, Migration, ID Isolation & Export-as-Template
  await runTest('templateLibrary & build-template-catalog: builds catalog.json dynamically, isolates broken templates, validates/migrates project.json & exports template bundle', () => {
    // 1) Verify real public/templates/catalog.json generated on disk
    const publicCatalogPath = path.resolve(process.cwd(), 'public', 'templates', 'catalog.json');
    assert.ok(fs.existsSync(publicCatalogPath), 'public/templates/catalog.json must exist');
    const diskCatalog = normalizeTemplateCatalogPayload(JSON.parse(fs.readFileSync(publicCatalogPath, 'utf8')));
    assert.ok(diskCatalog.totalTemplates >= 15);
    assert.ok(diskCatalog.categories.includes('Mạng LAN'));
    assert.ok(diskCatalog.templates.every(t => t.hasProjectData && Boolean(t.previewUrl)));

    // 2) Catalog builder scans arbitrary folders & isolates corrupt project.json / missing preview without crashing
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hachihi-tpl-test-'));
    try {
      const validDir = path.join(tmpRoot, '01-valid');
      const brokenJsonDir = path.join(tmpRoot, '02-broken-project');
      const missingPreviewDir = path.join(tmpRoot, '03-missing-preview');
      fs.mkdirSync(validDir, { recursive: true });
      fs.mkdirSync(brokenJsonDir, { recursive: true });
      fs.mkdirSync(missingPreviewDir, { recursive: true });

      const sampleProj = createMultiFloorSampleOfficeProject();
      fs.writeFileSync(
        path.join(validDir, 'template.json'),
        JSON.stringify({
          id: 'valid-tpl-001',
          name: 'Valid Template',
          category: 'Mạng LAN',
          mode: 'topology',
          badge: 'LAN',
          version: '1.0.0',
          author: 'HACHIHI',
          description: 'Healthy template',
          projectFile: 'project.json',
          preview: 'preview.webp'
        })
      );
      fs.writeFileSync(path.join(validDir, 'project.json'), JSON.stringify(sampleProj));
      fs.writeFileSync(path.join(validDir, 'preview.webp'), 'RIFF....WEBP');

      fs.writeFileSync(
        path.join(brokenJsonDir, 'template.json'),
        JSON.stringify({
          id: 'broken-tpl-002',
          name: 'Broken Project JSON',
          category: 'Camera',
          mode: 'cctv',
          projectFile: 'project.json',
          preview: 'preview.png'
        })
      );
      fs.writeFileSync(path.join(brokenJsonDir, 'project.json'), '{not-valid-json');
      fs.writeFileSync(path.join(brokenJsonDir, 'preview.png'), 'PNGDATA');

      fs.writeFileSync(
        path.join(missingPreviewDir, 'template.json'),
        JSON.stringify({
          id: 'no-preview-003',
          name: 'Missing Preview Template',
          category: 'Wi-Fi',
          mode: 'wifi',
          projectFile: 'project.json',
          preview: 'preview.webp'
        })
      );
      fs.writeFileSync(path.join(missingPreviewDir, 'project.json'), JSON.stringify(sampleProj));

      const built = buildTemplateCatalogFromDir(tmpRoot);
      assert.equal(built.totalTemplates, 3);
      assert.equal(built.templates.find(t => t.id === 'valid-tpl-001')?.hasProjectData, true);
      assert.equal(built.templates.find(t => t.id === 'valid-tpl-001')?.previewUrl, '/templates/01-valid/preview.webp');
      assert.equal(built.templates.find(t => t.id === 'broken-tpl-002')?.hasProjectData, false);
      assert.ok(built.templates.find(t => t.id === 'broken-tpl-002')?.validationError);
      assert.equal(built.templates.find(t => t.id === 'no-preview-003')?.hasProjectData, true);
      assert.equal(built.templates.find(t => t.id === 'no-preview-003')?.previewUrl, null);
      assert.ok(built.templates.find(t => t.id === 'no-preview-003')?.previewError);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    // 3) prepareProjectFromRawTemplateJson migrates legacy schema, generates fresh project ID & deep-clones independently
    const rawLegacy = {
      ...createEnterpriseTopologyProject(),
      id: 'template_original_fixed_id',
      schemaVersion: 2
    };
    const prep1 = prepareProjectFromRawTemplateJson(rawLegacy, {
      id: 'network-office-001',
      name: 'Office Network',
      mode: 'topology',
      version: '1.2.0',
      author: 'HACHIHI'
    });
    assert.equal(prep1.ok, true);
    if (prep1.ok) {
      assert.notEqual(prep1.project.id, 'template_original_fixed_id');
      assert.notEqual(prep1.project.id, 'network-office-001');
      assert.ok(prep1.project.id.startsWith('proj_'));
      assert.equal(prep1.project.schemaVersion, CURRENT_SCHEMA_VERSION);
      // Mutating prepared project does not mutate raw input
      prep1.project.nodes[0].label = 'MUTATED_LOCAL_COPY';
      assert.notEqual(rawLegacy.nodes[0].label, 'MUTATED_LOCAL_COPY');
    }

    const prepInvalid = prepareProjectFromRawTemplateJson({ bad: true });
    assert.equal(prepInvalid.ok, false);

    // 4) Export current project as reusable GitHub Template ZIP bundle
    const activeProj = createEnterpriseTopologyProject();
    const pkg = buildTemplateExportPackage(activeProj, {
      name: 'Mẫu Mạng Chi Nhánh Tầng 4',
      category: 'Mạng LAN',
      version: '1.1.0',
      author: 'HACHIHI Team',
      tags: ['LAN', 'Branch']
    });
    assert.equal(pkg.slug, slugifyTemplateId('Mẫu Mạng Chi Nhánh Tầng 4'));
    assert.equal(pkg.manifest.projectFile, 'project.json');
    assert.equal(pkg.manifest.preview, 'preview.svg');
    assert.ok(pkg.previewSvgString.includes('<svg'));

    const unzipped = unzipSync(pkg.zipBytes);
    assert.ok(unzipped[`${pkg.slug}/template.json`]);
    assert.ok(unzipped[`${pkg.slug}/project.json`]);
    assert.ok(unzipped[`${pkg.slug}/preview.svg`]);
    const parsedManifest = JSON.parse(strFromU8(unzipped[`${pkg.slug}/template.json`]));
    assert.equal(parsedManifest.version, '1.1.0');
    const parsedProject = JSON.parse(strFromU8(unzipped[`${pkg.slug}/project.json`]));
    assert.equal(migrateAndValidateProject(parsedProject).ok, true);

    // 5) Export with raster snapshot PNG bytes embeds preview.png & updates manifest.preview
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pkgPng = buildTemplateExportPackage(
      activeProj,
      {
        name: 'Mẫu Chi Nhánh PNG Snapshot',
        category: 'Mạng LAN',
        version: '1.2.0'
      },
      { previewRasterBytes: fakePng, previewExtension: 'png' }
    );
    assert.equal(pkgPng.previewFilename, 'preview.png');
    assert.equal(pkgPng.manifest.preview, 'preview.png');
    const unzippedPng = unzipSync(pkgPng.zipBytes);
    assert.ok(unzippedPng[`${pkgPng.slug}/template.json`]);
    assert.ok(unzippedPng[`${pkgPng.slug}/project.json`]);
    assert.ok(unzippedPng[`${pkgPng.slug}/preview.png`]);
    assert.deepEqual(unzippedPng[`${pkgPng.slug}/preview.png`], fakePng);
  });

  // 56. Dynamic Template Library Refresh: cache-busting query, cache:'reload', updated list & graceful error handling
  await runTest('templateLibrary: fetchTemplateCatalog forceRefresh bypasses cache, updates list & handles offline errors cleanly', async () => {
    const originalFetch = globalThis.fetch;
    const capturedCalls: Array<{ url: string; cache?: RequestCache }> = [];
    let serverVersion = 1;

    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        capturedCalls.push({ url, cache: init?.cache });

        if (serverVersion === -1) {
          return new Response('Service Unavailable', { status: 503 });
        }

        const templates = [
          {
            id: 'tpl-net-01',
            slug: '01-net',
            name: 'Mạng Văn Phòng v1',
            category: 'Mạng LAN',
            mode: 'topology',
            badge: 'LAN',
            version: '1.0.0',
            updatedAt: '2026-11-18',
            author: 'HACHIHI',
            description: 'Initial template',
            highlights: ['2 tầng'],
            tags: ['LAN'],
            projectUrl: '/templates/01-net/project.json',
            previewUrl: '/templates/01-net/preview.webp',
            hasProjectData: true
          }
        ];

        if (serverVersion >= 2) {
          templates.push({
            id: 'tpl-wifi-02',
            slug: '02-wifi',
            name: 'Phủ sóng Wi-Fi Mới',
            category: 'Wi-Fi',
            mode: 'wifi',
            badge: 'Wi-Fi 6',
            version: '1.0.0',
            updatedAt: '2026-11-19',
            author: 'HACHIHI',
            description: 'Newly added template after refresh',
            highlights: ['Wi-Fi 6'],
            tags: ['Wi-Fi'],
            projectUrl: '/templates/02-wifi/project.json',
            previewUrl: '/templates/02-wifi/preview.webp',
            hasProjectData: true
          });
        }

        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            totalTemplates: templates.length,
            categories: Array.from(new Set(templates.map(t => t.category))),
            templates
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      // 1) Initial load uses no-cache without ?v= query
      const initial = await fetchTemplateCatalog({ forceRefresh: false });
      assert.equal(initial.source, 'online');
      assert.equal(initial.catalog.totalTemplates, 1);
      assert.equal(capturedCalls[0].url, '/templates/catalog.json');
      assert.equal(capturedCalls[0].cache, 'no-cache');

      // 2) Simulated new template pushed -> refreshTemplateCatalog sends ?v=<ts> & cache:'reload' and receives updated catalog
      serverVersion = 2;
      const refreshed = await refreshTemplateCatalog();
      assert.equal(refreshed.source, 'online');
      assert.equal(refreshed.catalog.totalTemplates, 2);
      assert.ok(refreshed.catalog.templates.some(t => t.id === 'tpl-wifi-02'));
      assert.match(capturedCalls[1].url, /^\/templates\/catalog\.json\?v=\d+$/);
      assert.equal(capturedCalls[1].cache, 'reload');

      // 3) Server failure without localStorage cache rejects cleanly with descriptive message
      serverVersion = -1;
      await assert.rejects(
        () => refreshTemplateCatalog(),
        /HTTP 503/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

runStandaloneSuite(import.meta.url, runBomExcelAndTemplatesTests);
