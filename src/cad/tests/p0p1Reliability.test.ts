import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createMultiFloorSampleOfficeProject } from '../../data/templates';
import type { CableEdge, CableTray, DiagramNode, ProjectState } from '../../types/infrastructure';
import { computeProjectBomStats } from '../../utils/bomAggregator';
import {
  calculateTrayAwareCableLengthMeters,
  computeCableTrayLengthMeters,
  computeRealTimeCableLengthBreakdown,
  estimateCableLengthMeters
} from '../../utils/cableRouting';
import { estimateWifiRssiDbm } from '../../utils/engineeringValidator';
import { generateStandaloneViewerHtml } from '../../utils/htmlViewerExporter';
import { computeA4ScaleMetrics, computePdfViewportFitScale } from '../../utils/pdfScale';
import {
  DEFAULT_SCALE_PX_PER_METER,
  MAX_SCALE_PX_PER_METER,
  MIN_SCALE_PX_PER_METER,
  metersToPixels,
  normalizeScalePxPerMeter,
  pixelsToMeters,
  roundScalePxPerMeter
} from '../../utils/scaleUtils';
import { generatePureSvgMarkup } from '../../utils/svgExport';
import type { TestFn } from '../../utils/__tests__/testHarness';
import { runStandaloneSuite } from '../../utils/__tests__/testHarness';
import type { CADCommand } from '../commands/CADCommand';
import { CADCommandManager } from '../commands/CADCommandManager';
import { createEmptyCADDocument } from '../core/CADDocument';
import { computeAutoFitUnderlayDoc, resolveCadScaleSyncEffect } from '../core/CADScaleSync';
import type { CADDocument } from '../core/CADTypes';
import { computeNetworkPxPerMeterFromCad } from '../core/CADUnderlayTransform';
import { writeCombinedCadAndNetworkDxf } from '../export/DXFWriter';
import { writeRoundTripDxf } from '../export/DXFRoundTripWriter';
import { importDxfContent } from '../import/DXFImporter';
import { CADAutosaveController } from '../storage/CADAutosave';
import { CADRepository } from '../storage/CADRepository';

function makeDxfForAcadVersion(acadVer: string, unitCode: number | null = 4): string {
  const isR12 = acadVer === 'AC1009';
  const headerLines = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER', '1', acadVer
  ];
  if (unitCode !== null && !isR12) {
    headerLines.push('9', '$INSUNITS', '70', String(unitCode));
  }
  headerLines.push('0', 'ENDSEC');

  const tableLines = [
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE',
    '2', 'LAYER',
    '70', '2',
    '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS',
    '0', 'LAYER', '2', 'A_WALL', '70', '0', '62', '3', '6', 'CONTINUOUS',
    '0', 'ENDTAB',
    '0', 'ENDSEC'
  ];

  const entityLines: string[] = [
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LINE',
    ...(isR12 ? [] : ['5', 'A10']),
    '8', 'A_WALL',
    '10', '0', '20', '0', '30', '0',
    '11', '12000', '21', '0', '31', '0',
    '0', 'CIRCLE',
    ...(isR12 ? [] : ['5', 'A11']),
    '8', 'A_WALL',
    '10', '6000', '20', '3000', '30', '0',
    '40', '500'
  ];

  if (isR12) {
    // R12 classic POLYLINE -> VERTEX -> SEQEND
    entityLines.push(
      '0', 'POLYLINE', '8', 'A_WALL', '66', '1', '70', '1',
      '0', 'VERTEX', '8', 'A_WALL', '10', '0', '20', '0', '30', '0',
      '0', 'VERTEX', '8', 'A_WALL', '10', '12000', '20', '0', '30', '0',
      '0', 'VERTEX', '8', 'A_WALL', '10', '12000', '20', '6000', '30', '0',
      '0', 'SEQEND'
    );
  } else {
    entityLines.push(
      '0', 'LWPOLYLINE',
      '5', 'A12',
      '8', 'A_WALL',
      '90', '4',
      '70', '1',
      '10', '0', '20', '0',
      '10', '12000', '20', '0',
      '10', '12000', '20', '6000',
      '10', '0', '20', '6000'
    );
  }
  entityLines.push('0', 'ENDSEC', '0', 'EOF');

  return [...headerLines, ...tableLines, ...entityLines].join('\n');
}

export async function runP0P1ReliabilityTests(runTest: TestFn): Promise<void> {
  await runTest('P0.1 ScaleUtils: single canonical [0.05, 500] normalization and bidirectional conversion', () => {
    assert.equal(MIN_SCALE_PX_PER_METER, 0.05);
    assert.equal(MAX_SCALE_PX_PER_METER, 500);
    assert.equal(DEFAULT_SCALE_PX_PER_METER, 30);

    assert.equal(normalizeScalePxPerMeter(undefined), 30);
    assert.equal(normalizeScalePxPerMeter(null), 30);
    assert.equal(normalizeScalePxPerMeter(0), 30);
    assert.equal(normalizeScalePxPerMeter(-10), 30);
    assert.equal(normalizeScalePxPerMeter(Number.NaN), 30);
    assert.equal(normalizeScalePxPerMeter(Number.POSITIVE_INFINITY), 30);

    assert.equal(normalizeScalePxPerMeter(0.01), 0.05);
    assert.equal(normalizeScalePxPerMeter(0.05), 0.05);
    assert.equal(normalizeScalePxPerMeter(0.2), 0.2);
    assert.equal(normalizeScalePxPerMeter(4.5), 4.5);
    assert.equal(normalizeScalePxPerMeter(500), 500);
    assert.equal(normalizeScalePxPerMeter(9999), 500);

    assert.equal(roundScalePxPerMeter(0.123456, 4), 0.1235);
    assert.equal(pixelsToMeters(10, 0.2), 50);
    assert.equal(metersToPixels(50, 0.2), 10);
  });

  await runTest('P0.2 Sub-5 px/m Scale Uniformity: cableRouting, svgExport, pdfScale, bomAggregator & validator match 0.2 px/m without 1x/5x/10x error', () => {
    const scaleLow = 0.2; // 1 meter = 0.2 px -> 20 px = 100 meters!
    const project = createMultiFloorSampleOfficeProject();
    const floorId = project.activeFloorId;

    const apNode: DiagramNode = {
      id: 'node_ap_low_scale',
      type: 'device',
      diagramMode: 'wifi',
      floorId,
      label: 'AP-SITE-WIDE',
      x: 100,
      y: 100,
      width: 40,
      height: 40,
      rotation: 0,
      customData: { coverageRadiusMeters: 50 }, // 50m * 0.2 px/m = 10px radius (was 250px under old Math.max(5))
      style: { backgroundColor: '#0284c7', borderColor: '#0369a1', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
    };
    const swNode: DiagramNode = {
      id: 'node_sw_low_scale',
      type: 'device',
      diagramMode: 'topology',
      floorId,
      label: 'SW-EDGE',
      x: 100,
      y: 200,
      width: 40,
      height: 40,
      rotation: 0,
      style: { backgroundColor: '#155EEF', borderColor: '#1e293b', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
    };

    const cable: CableEdge = {
      id: 'cab_low_scale',
      cableCode: 'F01-LOW-01',
      diagramMode: 'topology',
      sourceNodeId: apNode.id,
      targetNodeId: swNode.id,
      cableType: 'FIBER_SM_OS2',
      bandwidth: '10G',
      color: '#f59e0b',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 0,
      status: 'active'
    };

    const tray: CableTray = {
      id: 'tray_low_scale',
      name: 'MAIN-DUCT',
      floorId,
      kind: 'network_tray',
      widthPx: 12,
      points: [{ x: 120, y: 120 }, { x: 120, y: 220 }] // 100 px = 500.0 m at 0.2 px/m
    };

    // 1. Cable routing: 100 px center-to-center / 0.2 px/m = 500 m (no slack)
    const exactCableMeters = estimateCableLengthMeters(cable, apNode, swNode, scaleLow, 1);
    assert.equal(exactCableMeters, 500);
    const breakdown = computeRealTimeCableLengthBreakdown(cable, apNode, swNode, {
      pxPerMeter: scaleLow,
      slackFactor: 1
    });
    assert.equal(breakdown.scalePxPerMeter, 0.2);
    assert.equal(breakdown.horizontalMeters, 500);

    // 2. Tray length: 100 px / 0.2 px/m = 500 m (old Math.max(10) gave 10m!)
    assert.equal(computeCableTrayLengthMeters(tray, scaleLow), 500);
    const trayAware = calculateTrayAwareCableLengthMeters(cable, apNode, swNode, [tray], scaleLow);
    assert.equal(trayAware.routedViaTrayName, 'MAIN-DUCT');
    assert.ok(trayAware.meters >= 500);

    // 3. Wi-Fi RSSI distance: 20 px / 0.2 px/m = 100 m (old Math.max(5) gave 4m!)
    const rssi = estimateWifiRssiDbm({ x: 0, y: 0 }, { x: 20, y: 0 }, 20, scaleLow, []);
    assert.equal(rssi.distanceMeters, 100);

    // 4. PDF scale: bounds 400x200 px at 0.2 px/m => 2000m x 1000m (old Math.max(1) gave 400m x 200m!)
    const a4 = computeA4ScaleMetrics({ minX: 0, minY: 0, width: 400, height: 200 }, scaleLow, 'landscape');
    assert.equal(a4.pxPerMeter, 0.2);
    assert.equal(a4.realWorldWidthMeters, 2000);
    assert.equal(a4.realWorldHeightMeters, 1000);
    const fixedPdfFit = computePdfViewportFitScale(400, 200, 250, 150, {
      autoFit: false,
      targetScaleDenominator: 1000, // 1 mm/m -> at 0.2 px/m, 1 px = 5m => 5 mm/px
      pxPerMeter: scaleLow
    });
    assert.equal(fixedPdfFit.scale, 5);

    // 5. BOM room area & tray totals at 0.2 px/m: 20x10 px room = 100m x 50m = 5000 m²
    const lowScaleProj: ProjectState = {
      ...project,
      activeMode: 'wifi',
      settings: {
        ...project.settings,
        scale: scaleLow,
        showCoverageRadius: true,
        hiddenLayers: []
      },
      rooms: [
        {
          id: 'room_low_1',
          floorId,
          name: 'Khu Công Nghiệp',
          type: 'warehouse',
          x: 0,
          y: 0,
          width: 20,
          height: 10,
          color: '#f8fafc',
          wallThickness: 2
        }
      ],
      nodes: [apNode, swNode],
      cables: [{ ...cable, lengthMeters: exactCableMeters }],
      cableTrays: [tray]
    };

    const bom = computeProjectBomStats(lowScaleProj, { floorId });
    assert.equal(bom.kpis.totalAreaM2, 5000);
    assert.equal(bom.kpis.trayTotalMeters, 500);

    // 6. SVG export Wi-Fi circle radius = 50m * 0.2 px/m = 10.0px (old Math.max(5) gave 250.0px!)
    const svg = generatePureSvgMarkup(lowScaleProj);
    assert.ok(svg.includes('r="10.0"'), `Expected Wi-Fi SVG circle r="10.0" at 0.2 px/m`);

    // 7. DXF export works cleanly at 0.05 px/m minimum scale
    const cadDoc = createEmptyCADDocument('LowScale', { projectId: lowScaleProj.id });
    const dxf = writeCombinedCadAndNetworkDxf(cadDoc, {
      ...lowScaleProj,
      settings: { ...lowScaleProj.settings, scale: MIN_SCALE_PX_PER_METER }
    });
    assert.ok(dxf.includes('HACHIHI_NET'));
  });

  await runTest('P1.1 CAD Scale Sync State Machine: handles $INSUNITS, scaleToCanvasPx, Undo/Redo & blocks cross-project leaks', () => {
    const base = createEmptyCADDocument('SyncDoc', { projectId: 'proj_A' });
    const docMm: CADDocument = {
      ...base,
      header: { ...base.header, $INSUNITS: 4 }, // mm
      underlay: { ...base.underlay, enabled: true, scaleToCanvasPx: 0.05 } // 50 px/m
    };

    assert.equal(computeNetworkPxPerMeterFromCad(docMm), 50);

    // 1. Open in underlay mode syncs scale
    assert.equal(
      resolveCadScaleSyncEffect(null, docMm, { reason: 'open', expectedProjectId: 'proj_A' }),
      50
    );

    // 2. Same project command that changes $INSUNITS + Undo/Redo
    const mgr = new CADCommandManager(20);
    const prevUnits = docMm.header.$INSUNITS;
    const changeUnitsCmd: CADCommand = {
      id: 'cmd_test_units_m',
      labelVi: 'Chuyển đơn vị sang Mét',
      execute: d => ({
        ...d,
        header: { ...d.header, $INSUNITS: 6 }
      }),
      undo: d => ({
        ...d,
        header: { ...d.header, $INSUNITS: prevUnits }
      })
    };
    const docMeters = mgr.execute(docMm, changeUnitsCmd);
    // Underlay scaleToCanvasPx stays 0.05 while $INSUNITS becomes 6 (meters) => 0.05 px/m
    assert.equal(
      resolveCadScaleSyncEffect(docMm, docMeters, { reason: 'command', expectedProjectId: 'proj_A' }),
      0.05
    );

    // Undo restores $INSUNITS=4 and syncs back to 50 px/m
    const undone = mgr.undo(docMeters)!;
    assert.ok(undone);
    assert.equal(undone.header.$INSUNITS, 4);
    assert.equal(
      resolveCadScaleSyncEffect(docMeters, undone, { reason: 'undo', expectedProjectId: 'proj_A' }),
      50
    );

    // Redo switches back to $INSUNITS=6
    const redone = mgr.redo(undone)!;
    assert.ok(redone);
    assert.equal(redone.header.$INSUNITS, 6);
    assert.equal(
      resolveCadScaleSyncEffect(undone, redone, { reason: 'redo', expectedProjectId: 'proj_A' }),
      0.05
    );

    // 3. No-op opacity change does NOT unnecessarily re-sync scale
    const opacityChanged: CADDocument = {
      ...docMm,
      underlay: { ...docMm.underlay, opacity: 0.35 }
    };
    assert.equal(
      resolveCadScaleSyncEffect(docMm, opacityChanged, { reason: 'settings', expectedProjectId: 'proj_A' }),
      null
    );

    // 4. Cross-project guard blocks scale leak from proj_A doc when active project is proj_B
    assert.equal(
      resolveCadScaleSyncEffect(null, docMm, { reason: 'open', expectedProjectId: 'proj_B' }),
      null
    );

    // 5. AutoFit computes positive clamped underlay scale and updates extents alignment
    const netProj = createMultiFloorSampleOfficeProject();
    const docWithExtents: CADDocument = {
      ...docMm,
      projectId: netProj.id,
      extents: { minX: 0, minY: 0, maxX: 20000, maxY: 10000 }
    };
    const fitted = computeAutoFitUnderlayDoc(docWithExtents, netProj);
    assert.equal(fitted.underlay.enabled, true);
    assert.ok(fitted.underlay.scaleToCanvasPx > 0);
    assert.ok(
      resolveCadScaleSyncEffect(docWithExtents, fitted, { reason: 'autofit', expectedProjectId: netProj.id }) !== null
    );
  });

  await runTest('P1.2 CADRepository & Autosave Isolation: saves/loads per-project documents cleanly under continuous switching', async () => {
    const repo = new CADRepository();
    const autosave = new CADAutosaveController(15, {
      saveFn: doc => repo.saveDocument(doc)
    });

    const docA = createEmptyCADDocument('Floor_Project_A', { projectId: 'proj_iso_A' });
    docA.underlay.scaleToCanvasPx = 0.04;
    const docB = createEmptyCADDocument('Floor_Project_B', { projectId: 'proj_iso_B' });
    docB.underlay.scaleToCanvasPx = 0.08;

    await repo.saveDocument(docA);
    autosave.schedule(docB);
    await autosave.flush(); // Simulate immediate flush before project switch B -> A

    const listA = await repo.listDocumentsForProject('proj_iso_A');
    const listB = await repo.listDocumentsForProject('proj_iso_B');
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
    assert.equal(listA[0].id, docA.id);
    assert.equal(listB[0].id, docB.id);

    const loadedA = await repo.loadDocument(docA.id);
    const loadedB = await repo.loadDocument(docB.id);
    assert.equal(loadedA?.projectId, 'proj_iso_A');
    assert.equal(loadedA?.underlay.scaleToCanvasPx, 0.04);
    assert.equal(loadedB?.projectId, 'proj_iso_B');
    assert.equal(loadedB?.underlay.scaleToCanvasPx, 0.08);
  });

  await runTest('P1.3 Multi-Version DXF Compatibility: imports & round-trips AutoCAD R12 (AC1009) through 2018+ (AC1032)', () => {
    const versions = [
      { code: 'AC1009', labelMatch: 'R11/R12', minEntities: 3 },
      { code: 'AC1012', labelMatch: 'R13', minEntities: 3 },
      { code: 'AC1014', labelMatch: 'R14', minEntities: 3 },
      { code: 'AC1015', labelMatch: '2000', minEntities: 3 },
      { code: 'AC1018', labelMatch: '2004', minEntities: 3 },
      { code: 'AC1021', labelMatch: '2007', minEntities: 3 },
      { code: 'AC1024', labelMatch: '2010', minEntities: 3 },
      { code: 'AC1027', labelMatch: '2013', minEntities: 3 },
      { code: 'AC1032', labelMatch: '2018', minEntities: 3 }
    ] as const;

    for (const v of versions) {
      const dxf = makeDxfForAcadVersion(v.code, 4);
      const { document, report } = importDxfContent(dxf, { fileName: `sample_${v.code}.dxf` });
      assert.equal(document.header.$ACADVER, v.code);
      assert.ok(
        document.metadata.acadVersion.includes(v.labelMatch),
        `Expected version label to include ${v.labelMatch}, got ${document.metadata.acadVersion}`
      );
      assert.ok(document.entities.length >= v.minEntities, `Expected >= ${v.minEntities} entities for ${v.code}`);
      assert.equal(report.ok, true);
      assert.equal(report.skippedCount, 0);
      assert.equal(report.errorMessageVi, undefined);

      // Round-trip DXF preserves entities & layer A_WALL
      const exported = writeRoundTripDxf(document);
      const { document: reimported } = importDxfContent(exported, { fileName: `rt_${v.code}.dxf` });
      assert.ok(reimported.layers['A_WALL'], `Layer A_WALL lost on ${v.code} round-trip`);
      assert.ok(reimported.entities.length >= v.minEntities, `Entities lost on ${v.code} round-trip`);
    }
  });

  await runTest('P1.4 Standalone HTML 3D Diagnostics & Vercel CSP Policy Verification', () => {
    const proj = createMultiFloorSampleOfficeProject();
    const html = generateStandaloneViewerHtml(proj, { contentScope: '3d' });

    assert.ok(html.includes('id="webglFallback"'));
    assert.ok(html.includes('id="webglErrorStep"'));
    assert.ok(html.includes('id="webglErrorCode"'));
    assert.ok(html.includes('id="webglErrorMsg"'));
    assert.ok(html.includes('id="btnRetry3D"'));
    assert.ok(html.includes('id="btnFallback2D"'));
    assert.ok(html.includes('disposeViewer3d'));
    assert.ok(html.includes('probeWebglSupport'));
    assert.ok(html.includes('webglcontextlost'));
    assert.ok(html.includes('WEBGL_CONTEXT_LOST'));

    // Verify vercel.json keeps main SPA CSP strict while exempting /viewer/* and /exports/*
    const vercelPath = path.resolve(process.cwd(), 'vercel.json');
    const vercelRaw = JSON.parse(fs.readFileSync(vercelPath, 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const spaRewrite = vercelRaw.rewrites[0];
    assert.ok(spaRewrite.source.includes('viewer/'));
    assert.ok(spaRewrite.source.includes('exports/'));
    assert.ok(spaRewrite.source.includes('html'));

    const globalHeaders = vercelRaw.headers.find(h => h.source === '/(.*)');
    const globalCsp = globalHeaders?.headers.find(h => h.key === 'Content-Security-Policy')?.value || '';
    assert.ok(globalCsp.includes("script-src 'self' 'wasm-unsafe-eval'"));
    assert.ok(!globalCsp.includes("script-src 'self' 'unsafe-inline'"));

    const viewerHeaders = vercelRaw.headers.find(h => h.source === '/viewer/(.*)');
    const viewerCsp = viewerHeaders?.headers.find(h => h.key === 'Content-Security-Policy')?.value || '';
    assert.ok(viewerCsp.includes("script-src 'unsafe-inline'"));
    assert.ok(viewerCsp.includes("default-src 'none'"));
  });
}

runStandaloneSuite(import.meta.url, runP0P1ReliabilityTests);
