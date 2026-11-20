import assert from 'node:assert/strict';
import { Quadtree } from '../../utils/spatialIndex';
import { createFiveStoreyBuildingProject } from '../../data/defaultStarterTemplate';
import { createEmptyCADDocument } from '../core/CADDocument';
import {
  buildInsertTransform2D,
  applyAffine2D,
  ocsPointToWcs
} from '../core/CADTransform';
import { cadPointToNetworkCanvas, networkCanvasToCadPoint } from '../core/CADUnderlayTransform';
import type { CADBlock, CADDocument, CADEntity } from '../core/CADTypes';
import {
  computeEntityBounds2D,
  computeSmartFitExtents,
  recomputeDocumentExtents
} from '../geometry/CADBounds';
import { decodeAutoCadText, stripMTextFormatting } from '../geometry/CADCurve';
import {
  extendLineToBoundaries,
  offsetSimpleEntity,
  trimLineAgainstCutters
} from '../geometry/CADIntersection';
import { findBestSnapPoint } from '../geometry/CADSnap';
import {
  LineBuffer,
  StreamingDxfSession,
  importDxfContent,
  streamDxfFileLineBatches
} from '../import/DXFImporter';
import { decodeBinaryDxfBuffer, detectDwgSignature, isBinaryDxfBuffer } from '../import/DXFBinaryImporter';
import { detectBlockCycles } from '../import/CADImportValidator';
import {
  CADImportProgressInfo,
  applyImportModeToDocument,
  cadImportService
} from '../import/CADImportService';
import type { DwgDatabase } from '@mlightcad/libredwg-web';
import { importDwgBuffer } from '../import/DWGImporter';
import { validateDwgConverterUrl } from '../dwg/DWGProviderConfig';
import {
  decodeDwgBufferWithLibreDwg,
  getLibreDwgInstance,
  type LibreDwgRuntimeLike
} from '../dwg/LibreDwgWasmLoader';
import { CADCommandManager } from '../commands/CADCommandManager';
import { DeleteEntitiesCommand, MoveCommand } from '../commands/CADCommands';
import { writeRoundTripDxf } from '../export/DXFRoundTripWriter';
import { writeCleanDxf, writeCombinedCadAndNetworkDxf } from '../export/DXFWriter';
import { CADExportService, cadExportService } from '../export/CADExportService';
import {
  CADCanvasRenderer,
  resolveCadDetailCullingThresholds
} from '../rendering/CADCanvasRenderer';
import { renderCADDocumentToSvg } from '../rendering/CADSVGRenderer';
import { createDefaultCADViewport } from '../rendering/CADViewport';
import { cadRepository } from '../storage/CADRepository';
import { runStandaloneSuite, type TestFn } from '../../utils/__tests__/testHarness';

const SAMPLE_MULTI_ENTITY_DXF = [
  '0', 'SECTION',
  '2', 'HEADER',
  '9', '$ACADVER', '1', 'AC1027',
  '9', '$INSUNITS', '70', '4',
  '9', '$CLAYER', '8', 'WALLS',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'CLASSES',
  '0', 'CLASS',
  '1', 'ACDBDICTIONARYWDFLT',
  '2', 'AcDbDictionaryWithDefault',
  '3', 'ObjectDBX Classes',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'TABLES',
  '0', 'TABLE', '2', 'LAYER', '70', '2',
  '0', 'LAYER', '5', '10', '2', 'WALLS', '70', '0', '62', '7', '6', 'Continuous',
  '0', 'LAYER', '5', '11', '2', 'DEVICES', '70', '0', '62', '3', '6', 'Continuous',
  '0', 'ENDTAB',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'BLOCKS',
  '0', 'BLOCK', '5', '20', '8', '0', '2', 'SW_BLOCK', '70', '0', '10', '0', '20', '0', '30', '0',
  '0', 'LINE', '5', '21', '8', '0', '10', '-50', '20', '-20', '30', '0', '11', '50', '21', '-20', '31', '0',
  '0', 'CIRCLE', '5', '22', '8', '0', '10', '0', '20', '0', '30', '0', '40', '15',
  '0', 'ENDBLK', '5', '23',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'ENTITIES',
  '0', 'LINE', '5', '100', '8', 'WALLS', '10', '0', '20', '0', '30', '0', '11', '1000', '21', '0', '31', '0',
  '0', 'LINE', '5', '101', '8', 'WALLS', '10', '1000', '20', '0', '30', '0', '11', '1000', '21', '800', '31', '0',
  '0', 'CIRCLE', '5', '102', '8', 'DEVICES', '10', '500', '20', '400', '30', '0', '40', '120',
  '0', 'ARC', '5', '103', '8', 'WALLS', '10', '200', '20', '200', '30', '0', '40', '80', '50', '0', '51', '90',
  '0', 'LWPOLYLINE', '5', '104', '8', 'WALLS', '90', '3', '70', '1',
  '10', '0', '20', '0', '42', '0.5',
  '10', '300', '20', '0', '42', '0',
  '10', '300', '20', '200', '42', '0',
  '0', 'ELLIPSE', '5', '105', '8', 'DEVICES', '10', '700', '20', '500', '30', '0', '11', '100', '21', '0', '31', '0', '40', '0.5', '41', '0', '42', '6.283185307179586',
  '0', 'SPLINE', '5', '106', '8', 'DEVICES', '70', '8', '71', '3', '72', '0', '73', '3', '74', '0',
  '10', '100', '20', '600', '30', '0',
  '10', '250', '20', '720', '30', '0',
  '10', '400', '20', '620', '30', '0',
  '0', 'TEXT', '5', '107', '8', 'DEVICES', '10', '120', '20', '120', '30', '0', '40', '45', '1', 'MDF-RACK-01',
  '0', 'MTEXT', '5', '108', '8', 'DEVICES', '10', '500', '20', '700', '30', '0', '40', '40', '1', '{\\fArial|b1;\\H2.5;CORE-SW-01\\P10G}',
  '0', 'DIMENSION', '5', '109', '8', 'WALLS', '10', '1000', '20', '-100', '30', '0', '11', '500', '21', '-100', '31', '0', '13', '0', '23', '0', '14', '1000', '24', '0', '70', '0', '1', '1000 mm',
  '0', 'INSERT', '5', '110', '8', 'DEVICES', '2', 'SW_BLOCK', '10', '600', '20', '300', '30', '0', '41', '2', '42', '2', '50', '90', '66', '1',
  '0', 'ATTRIB', '5', '111', '8', 'DEVICES', '10', '620', '20', '310', '30', '0', '40', '25', '2', 'TAG', '1', 'SW-01',
  '0', 'SEQEND', '5', '112',
  '0', '3DSOLID', '5', '901', '8', 'WALLS', '1', 'ACIS_SOLID_BODY_PLACEHOLDER',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'OBJECTS',
  '0', 'DICTIONARY', '5', 'C',
  '0', 'ENDSEC',
  '0', 'EOF'
].join('\n');

function buildSyntheticBinaryDxfBuffer(): ArrayBuffer {
  const bytes: number[] = [];
  const pushStr = (s: string) => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  const pushUint16 = (n: number) => {
    bytes.push(n & 0xff, (n >> 8) & 0xff);
  };
  const pushInt16 = (n: number) => {
    const buf = new ArrayBuffer(2);
    new DataView(buf).setInt16(0, n, true);
    bytes.push(...new Uint8Array(buf));
  };
  const pushFloat64 = (n: number) => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, n, true);
    bytes.push(...new Uint8Array(buf));
  };
  const pushPairStr = (code: number, val: string) => {
    pushUint16(code);
    pushStr(val);
    bytes.push(0);
  };
  const pushPairInt16 = (code: number, val: number) => {
    pushUint16(code);
    pushInt16(val);
  };
  const pushPairF64 = (code: number, val: number) => {
    pushUint16(code);
    pushFloat64(val);
  };

  pushStr('AutoCAD Binary DXF\r\n\x1a\0');
  pushPairStr(0, 'SECTION');
  pushPairStr(2, 'HEADER');
  pushPairStr(9, '$ACADVER');
  pushPairStr(1, 'AC1015');
  pushPairStr(9, '$INSUNITS');
  pushPairInt16(70, 4);
  pushPairStr(0, 'ENDSEC');

  pushPairStr(0, 'SECTION');
  pushPairStr(2, 'ENTITIES');
  pushPairStr(0, 'LINE');
  pushPairStr(5, 'A1');
  pushPairStr(8, '0');
  pushPairF64(10, 125.5);
  pushPairF64(20, 250.25);
  pushPairF64(30, 0);
  pushPairF64(11, 825.5);
  pushPairF64(21, 650.75);
  pushPairF64(31, 0);
  pushPairStr(0, 'ENDSEC');
  pushPairStr(0, 'EOF');

  return new Uint8Array(bytes).buffer;
}

export async function runCadEngineTests(runTest: TestFn): Promise<void> {
  await runTest('CAD: Parse ASCII DXF multi-entity, MTEXT cleanup & UNKNOWN preservation', () => {
    const { document: doc, report } = importDxfContent(SAMPLE_MULTI_ENTITY_DXF, {
      fileName: 'office-floor1.dxf'
    });

    assert.equal(doc.header.$ACADVER, 'AC1027');
    assert.equal(doc.header.$INSUNITS, 4);
    assert.ok(doc.layers.WALLS);
    assert.ok(doc.layers.DEVICES);
    assert.ok(doc.blocks.SW_BLOCK);
    assert.equal(report.entityCount, doc.entities.length);

    const line = doc.entities.find(e => e.handle === '100');
    assert.equal(line?.type, 'LINE');

    const lw = doc.entities.find(e => e.handle === '104');
    assert.equal(lw?.type, 'LWPOLYLINE');
    if (lw?.type === 'LWPOLYLINE') {
      assert.equal(lw.closed, true);
      assert.equal(lw.vertices[0].bulge, 0.5);
    }

    const mtext = doc.entities.find(e => e.handle === '108');
    assert.equal(mtext?.type, 'MTEXT');
    if (mtext?.type === 'MTEXT') {
      assert.equal(mtext.plainText, 'CORE-SW-01\n10G');
    }

    const ins = doc.entities.find(e => e.handle === '110');
    assert.equal(ins?.type, 'INSERT');
    if (ins?.type === 'INSERT') {
      assert.equal(ins.blockName, 'SW_BLOCK');
      assert.equal(ins.attributes?.length, 1);
      assert.equal(ins.attributes?.[0].text, 'SW-01');
    }

    const unknown = doc.entities.find(e => e.handle === '901');
    assert.equal(unknown?.type, 'UNKNOWN');
    assert.equal(unknown?.preservationTier, 'unknown');
    assert.ok((unknown?.rawDxf?.length || 0) > 0);
    assert.ok(doc.rawSections?.classes && doc.rawSections.classes.length > 0);
    assert.ok(doc.rawSections?.objects && doc.rawSections.objects.length > 0);
  });

  await runTest('CAD: Decode AutoCAD Binary DXF buffer locally', () => {
    const buf = buildSyntheticBinaryDxfBuffer();
    assert.equal(isBinaryDxfBuffer(buf), true);
    const decoded = decodeBinaryDxfBuffer(buf);
    assert.ok(decoded.pairs.length >= 10);
    assert.ok(decoded.asciiDxf.includes('LINE'));

    const { document: doc } = importDxfContent(buf, { fileName: 'binary-sample.dxf' });
    assert.equal(doc.metadata.sourceFormat, 'dxf-binary');
    assert.equal(doc.entities.length, 1);
    const line = doc.entities[0];
    assert.equal(line.type, 'LINE');
    if (line.type === 'LINE') {
      assert.ok(Math.abs(line.start.x - 125.5) < 1e-6);
      assert.ok(Math.abs(line.end.y - 650.75) < 1e-6);
    }
  });

  await runTest('CAD: Recursive Block transform, bounds, OCS->WCS & cycle guard', () => {
    const blocks: Record<string, CADBlock> = {
      A: {
        id: 'blk_a',
        name: 'A',
        basePoint: { x: 0, y: 0, z: 0 },
        entities: [
          {
            id: 'i1',
            handle: '',
            type: 'INSERT',
            layer: '0',
            blockName: 'B',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: 0,
            preservationTier: 'supported'
          }
        ]
      },
      B: {
        id: 'blk_b',
        name: 'B',
        basePoint: { x: 0, y: 0, z: 0 },
        entities: [
          {
            id: 'i2',
            handle: '',
            type: 'INSERT',
            layer: '0',
            blockName: 'A',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: 0,
            preservationTier: 'supported'
          }
        ]
      }
    };
    const cycleWarnings = detectBlockCycles(blocks);
    assert.ok(cycleWarnings.length > 0);

    const { document: doc } = importDxfContent(SAMPLE_MULTI_ENTITY_DXF);
    const ins = doc.entities.find(e => e.type === 'INSERT');
    assert.ok(ins && ins.type === 'INSERT');
    const b = computeEntityBounds2D(ins, doc.blocks);
    assert.ok(Number.isFinite(b.minX) && b.maxX > b.minX);

    // Build affine transform for rotated/scaled block point (50, -20)
    const m = buildInsertTransform2D({ x: 600, y: 300 }, { x: 2, y: 2 }, 90, { x: 0, y: 0 });
    const mapped = applyAffine2D(m, { x: 50, y: -20 });
    assert.ok(Math.abs(mapped.x - 640) < 1e-6);
    assert.ok(Math.abs(mapped.y - 400) < 1e-6);

    // OCS arbitrary axis mapping with inverted Z extrusion (0, 0, -1)
    const wcs = ocsPointToWcs({ x: 10, y: 20, z: 5 }, { x: 0, y: 0, z: -1 });
    assert.ok(Math.abs(wcs.x + 10) < 1e-6);
    assert.ok(Math.abs(wcs.y - 20) < 1e-6);
    assert.ok(Math.abs(wcs.z + 5) < 1e-6);
  });

  await runTest('CAD: Undo/Redo Move & Delete + Round-trip DXF preserves handles & UNKNOWN entities', () => {
    const { document: imported } = importDxfContent(SAMPLE_MULTI_ENTITY_DXF, {
      fileName: 'roundtrip.dxf'
    });
    const mgr = new CADCommandManager(100);

    const ent100 = imported.entities.find(e => e.handle === '100')!;
    const ent101 = imported.entities.find(e => e.handle === '101')!;
    assert.ok(ent100 && ent101);

    let doc = mgr.execute(imported, new MoveCommand([ent100.id], 250, -150));
    doc = mgr.execute(doc, new DeleteEntitiesCommand([ent101.id]));
    assert.equal(mgr.canUndo(), true);
    assert.ok(!doc.entities.some(e => e.handle === '101'));

    // Undo Delete -> entity 101 returns
    doc = mgr.undo(doc)!;
    assert.ok(doc.entities.some(e => e.handle === '101'));
    // Undo Move -> entity 100 returns to (0, 0)
    doc = mgr.undo(doc)!;
    const restored100 = doc.entities.find(e => e.handle === '100');
    assert.equal(restored100?.type === 'LINE' ? restored100.start.x : -1, 0);

    // Redo Move & Redo Delete
    doc = mgr.redo(doc)!;
    doc = mgr.redo(doc)!;

    const roundTripText = writeRoundTripDxf(doc);
    assert.ok(roundTripText.includes('CLASSES'));
    assert.ok(roundTripText.includes('OBJECTS'));
    assert.ok(roundTripText.includes('3DSOLID'));

    const { document: reimported } = importDxfContent(roundTripText, { fileName: 'roundtrip-out.dxf' });
    assert.ok(!reimported.entities.some(e => e.handle === '101'));
    const movedOut = reimported.entities.find(e => e.handle === '100');
    assert.equal(movedOut?.type, 'LINE');
    if (movedOut?.type === 'LINE') {
      assert.ok(Math.abs(movedOut.start.x - 250) < 1e-4);
      assert.ok(Math.abs(movedOut.start.y + 150) < 1e-4);
    }
    const preservedUnknown = reimported.entities.find(e => e.handle === '901');
    assert.equal(preservedUnknown?.type, 'UNKNOWN');

    const cleanText = writeCleanDxf(doc);
    assert.ok(cleanText.includes('SECTION'));
    const svg = renderCADDocumentToSvg(doc);
    assert.ok(svg.includes('<svg'));
  });

  await runTest('CAD: DWG header signature inspection & bridge URL security validation', async () => {
    const dwgBytes = new Uint8Array(64);
    'AC1032'.split('').forEach((ch, idx) => {
      dwgBytes[idx] = ch.charCodeAt(0);
    });
    const sig = detectDwgSignature(dwgBytes.buffer);
    assert.equal(sig.isDwg, true);
    assert.equal(sig.versionCode, 'AC1032');

    const outcome = await importDwgBuffer(dwgBytes.buffer, 'site-plan.dwg');
    assert.equal(outcome.status, 'requires-conversion');
    assert.equal(outcome.inspection.versionCode, 'AC1032');
    assert.ok(outcome.inspection.wasmErrorVi && outcome.inspection.wasmErrorVi.length > 0);
    assert.ok(outcome.inspection.guideStepsVi.length >= 2);

    assert.equal(validateDwgConverterUrl('http://evil.example/convert').ok, false);
    assert.equal(validateDwgConverterUrl('javascript:alert(1)').ok, false);
    assert.equal(validateDwgConverterUrl('https://cad-bridge.company.com/convert').ok, true);
    assert.equal(validateDwgConverterUrl('http://localhost:8787/convert').ok, true);
  });

  await runTest('CAD: Geometry intersections (Trim/Extend/Offset), OSNAP & 15,000-entity speed', () => {
    const targetLine: CADEntity = {
      id: 'l_target',
      handle: '',
      type: 'LINE',
      layer: '0',
      start: { x: 0, y: 0, z: 0 },
      end: { x: 100, y: 0, z: 0 },
      preservationTier: 'supported'
    };
    const cutterLine: CADEntity = {
      id: 'l_cutter',
      handle: '',
      type: 'LINE',
      layer: '0',
      start: { x: 60, y: -50, z: 0 },
      end: { x: 60, y: 50, z: 0 },
      preservationTier: 'supported'
    };
    const trimRes = trimLineAgainstCutters(targetLine, [cutterLine], { x: 85, y: 0 });
    assert.ok(trimRes && trimRes.mode === 'trim');
    assert.ok(Math.abs(trimRes.updated.end.x - 60) < 1e-6);

    const shortLine: CADEntity = {
      id: 'l_short',
      handle: '',
      type: 'LINE',
      layer: '0',
      start: { x: 0, y: 0, z: 0 },
      end: { x: 40, y: 0, z: 0 },
      preservationTier: 'supported'
    };
    const extRes = extendLineToBoundaries(shortLine, [cutterLine], { x: 39, y: 0 });
    assert.ok(extRes);
    assert.ok(Math.abs(extRes.end.x - 60) < 1e-6);

    const offRes = offsetSimpleEntity(targetLine, 25, { x: 50, y: 100 });
    assert.equal(offRes.type, 'LINE');
    if (offRes.type === 'LINE') {
      assert.ok(Math.abs(offRes.start.y - 25) < 1e-6);
    }

    const doc = createEmptyCADDocument('Snap Test');
    doc.entities.push(targetLine, {
      id: 'c1',
      handle: '',
      type: 'CIRCLE',
      layer: '0',
      center: { x: 200, y: 200, z: 0 },
      radius: 40,
      preservationTier: 'supported'
    });
    const snap = findBestSnapPoint(
      doc,
      { x: 50.5, y: 1 },
      14,
      {
        enabled: true,
        ortho: false,
        polar: false,
        gridSnap: false,
        gridSpacing: 10,
        modes: {
          endpoint: true,
          midpoint: true,
          center: true,
          intersection: false,
          perpendicular: false,
          quadrant: false,
          nearest: false,
          insertion: false
        }
      }
    );
    assert.ok(snap);
    assert.equal(snap.mode, 'midpoint');
    assert.ok(Math.abs(snap.point.x - 50) < 1e-4);

    // Performance benchmark: 15,000 entities extent + Quadtree index + viewport query < 1500ms
    const startMs = Date.now();
    const bigDoc = createEmptyCADDocument('Benchmark 15K');
    const qt = new Quadtree<string>({ x: 0, y: 0, width: 200000, height: 200000 }, 24, 8);
    for (let i = 0; i < 15000; i++) {
      const row = Math.floor(i / 150);
      const col = i % 150;
      const x = col * 100;
      const y = row * 100;
      bigDoc.entities.push({
        id: `e_${i}`,
        handle: '',
        type: 'LINE',
        layer: '0',
        start: { x, y, z: 0 },
        end: { x: x + 80, y: y + 40, z: 0 },
        preservationTier: 'supported'
      });
      qt.insert(`e_${i}`, { x, y, width: 80, height: 40 });
    }
    const ext = recomputeDocumentExtents(bigDoc);
    const hits = qt.queryRect({ x: 500, y: 500, width: 2000, height: 2000 });
    const elapsedMs = Date.now() - startMs;
    assert.ok(ext.maxX > 14000);
    assert.ok(hits.length > 0);
    assert.ok(elapsedMs < 1500, `15,000-entity spatial benchmark took ${elapsedMs}ms (>= 1500ms)`);
  });

  await runTest('CAD: Import mode filtering, bidirectional underlay & Combined CAD+Network DXF', () => {
    const { document: doc } = importDxfContent(SAMPLE_MULTI_ENTITY_DXF);
    const filtered = applyImportModeToDocument(doc, 'filter-layers', ['DEVICES']);
    assert.ok(filtered.entities.every(e => e.layer === 'DEVICES'));
    // Transitive block SW_BLOCK used by INSERT on layer DEVICES must stay intact
    assert.ok(filtered.blocks.SW_BLOCK);

    const underlay = { offsetX: 120, offsetY: 640, scaleToCanvasPx: 0.25, rotationDeg: 15 };
    const orig = { x: 1250, y: 480 };
    const canvasPt = cadPointToNetworkCanvas(orig, underlay);
    const back = networkCanvasToCadPoint(canvasPt, underlay);
    assert.ok(Math.abs(back.x - orig.x) < 1e-6);
    assert.ok(Math.abs(back.y - orig.y) < 1e-6);

    const sampleProject = createFiveStoreyBuildingProject();
    const combinedDxf = writeCombinedCadAndNetworkDxf(doc, sampleProject, {
      floorScope: sampleProject.activeFloorId || 'all'
    });
    assert.ok(combinedDxf.includes('HACHIHI_ROOMS'));
    assert.ok(combinedDxf.includes('HACHIHI_DEVICES'));
    assert.ok(combinedDxf.includes('HACHIHI_CABLES'));
    assert.ok(combinedDxf.includes('SW-CORE-HACHIHI'));
  });

  await runTest('CAD: Repository multi-chunk (>2000 entities) save, load & delete', async () => {
    const doc: CADDocument = createEmptyCADDocument('Chunk Storage Test', { projectId: 'proj_chunk' });
    for (let i = 0; i < 2500; i++) {
      doc.entities.push({
        id: `ent_${i}`,
        handle: '',
        type: 'POINT',
        layer: '0',
        position: { x: i * 5, y: i * 2, z: 0 },
        preservationTier: 'supported'
      });
    }
    doc.extents = recomputeDocumentExtents(doc);

    await cadRepository.saveDocument(doc);
    const loaded = await cadRepository.loadDocument(doc.id);
    assert.ok(loaded);
    assert.equal(loaded.entities.length, 2500);
    assert.equal(loaded.projectId, 'proj_chunk');

    const projList = await cadRepository.listDocumentsForProject('proj_chunk');
    assert.ok(projList.some(d => d.id === doc.id));

    const clonedDocs = await cadRepository.cloneDocumentsForProject('proj_chunk', 'proj_chunk_copy');
    assert.equal(clonedDocs.length, 1);
    assert.notEqual(clonedDocs[0].id, doc.id);
    assert.equal(clonedDocs[0].projectId, 'proj_chunk_copy');
    assert.equal(clonedDocs[0].entities.length, 2500);
    const copyList = await cadRepository.listDocumentsForProject('proj_chunk_copy');
    assert.equal(copyList.length, 1);

    const purgedOrig = await cadRepository.deleteDocumentsForProject('proj_chunk');
    assert.equal(purgedOrig, 1);
    const afterOrigDelete = await cadRepository.loadDocument(doc.id);
    assert.equal(afterOrigDelete, null);

    // Cloned project's CAD doc remains intact until deleted separately
    const copyStillExists = await cadRepository.loadDocument(clonedDocs[0].id);
    assert.ok(copyStillExists);
    await cadRepository.deleteDocumentsForProject('proj_chunk_copy');
    assert.equal(await cadRepository.loadDocument(clonedDocs[0].id), null);
  });

  await runTest('CAD Streaming: LineBuffer CRLF boundary safety & pair-aligned batching', async () => {
    const lb = new LineBuffer();
    lb.push('0\r\nSECTION\r');
    lb.push('\n2\r\nENTITIES\r\n0\nLINE\n');
    const b1 = lb.takeBatch(4, true);
    assert.ok(b1);
    assert.equal(b1.length, 4);
    assert.deepEqual(b1, ['0', 'SECTION', '2', 'ENTITIES']);
    const tail = lb.flush();
    assert.deepEqual(tail, ['0', 'LINE']);

    // Verify streamDxfFileLineBatches over Blob emits pair-aligned batches
    const blob = new Blob([SAMPLE_MULTI_ENTITY_DXF], { type: 'text/plain' });
    const emittedBatches: string[][] = [];
    const res = await streamDxfFileLineBatches(blob, {
      batchSizeLines: 14,
      onBatch: lines => {
        assert.equal(lines.length % 2, 0, 'Streaming batch must stay DXF pair-aligned');
        emittedBatches.push(lines);
      }
    });
    assert.ok(emittedBatches.length >= 2);
    assert.ok(res.totalBytesRead > 0);
  });

  await runTest('CAD Streaming: Multi-pass StreamingDxfSession & garbage/layer filtering', () => {
    const dxfWithGarbage = [
      '0', 'SECTION', '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1032',
      '9', '$INSUNITS', '70', '4',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LAYER',
      '0', 'LAYER', '2', 'WALLS', '70', '0', '62', '7',
      '0', 'LAYER', '2', 'HIDDEN_L', '70', '0', '62', '-3',
      '0', 'LAYER', '2', 'FROZEN_L', '70', '1', '62', '5',
      '0', 'LAYER', '2', 'LOCKED_L', '70', '4', '62', '1',
      '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '2', 'AP_BLK', '10', '0', '20', '0', '30', '0',
      '0', 'CIRCLE', '8', '0', '10', '0', '20', '0', '30', '0', '40', '25',
      '0', 'HATCH', '8', '0', '2', 'SOLID', '70', '1',
      '0', 'ENDBLK',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '5', '10', '8', 'WALLS', '10', '0', '20', '0', '30', '0', '11', '500', '21', '0', '31', '0',
      '0', 'HATCH', '5', '11', '8', 'WALLS', '2', 'ANSI31', '70', '0', '92', '1', '10', '0', '20', '0', '10', '100', '20', '0', '10', '100', '20', '100',
      '0', '3DSOLID', '5', '12', '8', 'WALLS', '1', 'ACIS_DATA',
      '0', 'IMAGE', '5', '13', '8', 'WALLS', '10', '10', '20', '10',
      '0', 'LINE', '5', '14', '8', 'HIDDEN_L', '10', '0', '20', '10', '30', '0', '11', '100', '21', '10', '31', '0',
      '0', 'LINE', '5', '15', '8', 'FROZEN_L', '10', '0', '20', '20', '30', '0', '11', '100', '21', '20', '31', '0',
      '0', 'INSERT', '5', '16', '8', 'LOCKED_L', '2', 'AP_BLK', '66', '1', '10', '50', '20', '50', '30', '0',
      '0', 'ATTRIB', '5', '17', '8', 'LOCKED_L', '2', 'AP', '1', 'AP-01', '10', '50', '20', '50', '30', '0',
      '0', 'SEQEND', '5', '18',
      '0', 'POLYLINE', '5', '19', '8', 'WALLS', '70', '1',
      '0', 'VERTEX', '5', '1A', '8', 'WALLS', '10', '10', '20', '10', '30', '0',
      '0', 'VERTEX', '5', '1B', '8', 'WALLS', '10', '90', '20', '10', '30', '0',
      '0', 'SEQEND', '5', '1C',
      '0', 'TEXT', '5', '1D', '8', 'WALLS', '10', '200', '20', '200', '30', '0', '40', '20', '1', 'RACK-A',
      '0', 'ENDSEC',
      '0', 'EOF'
    ];

    const session = new StreamingDxfSession({
      fileName: 'big-building.dxf',
      fileSizeBytes: dxfWithGarbage.join('\n').length,
      lowMemoryMode: true,
      entityChunkSize: 2,
      filterOptions: {
        skipHatch: true,
        skipHeavy3DAndImages: true,
        skipHiddenLayers: true,
        skipFrozenLayers: true,
        skipLockedLayers: true
      }
    });

    // Feed Pass 1 in tiny odd-sized line slices to verify cross-batch state machine
    for (let i = 0; i < dxfWithGarbage.length; i += 6) {
      session.feedPass1Lines(dxfWithGarbage.slice(i, i + 6));
    }
    const p1 = session.finishPass1();
    assert.ok(p1.layerCount >= 4);
    assert.ok(session.blocks.AP_BLK);
    assert.equal(session.blocks.AP_BLK.entities.length, 1); // HATCH inside block stripped

    // Feed Pass 2 in small batches, collecting streamed entity chunks
    const streamedChunks: CADEntity[][] = [];
    for (let i = 0; i < dxfWithGarbage.length; i += 6) {
      session.feedPass2Lines(dxfWithGarbage.slice(i, i + 6), chunk => {
        streamedChunks.push(chunk);
      });
    }
    const shell = session.finishPass2(chunk => {
      streamedChunks.push(chunk);
    });

    const allEntities = streamedChunks.flat();
    assert.equal(allEntities.length, 3); // LINE(10), POLYLINE(19), TEXT(1D)
    assert.equal(shell.skippedCount, 6); // HATCH, 3DSOLID, IMAGE, HIDDEN_L, FROZEN_L, LOCKED_L INSERT(+ATTRIB+SEQEND)
    assert.equal(allEntities[0].rawDxf, undefined); // Low-memory mode omits rawDxf
    assert.equal(allEntities[1].type, 'POLYLINE');
    if (allEntities[1].type === 'POLYLINE') {
      assert.equal(allEntities[1].vertices.length, 2);
    }

    const { document, report } = session.assembleImportResult(shell, allEntities);
    assert.equal(document.metadata.hasRawRoundTripData, false);
    assert.equal(report.streamingUsed, true);
    assert.equal(report.skippedCount, 6);
    assert.ok(report.warnings.some(w => w.code === 'LOW_MEMORY_MODE'));
  });

  await runTest('CAD Streaming: CADImportService.importFile streams 10,000+ entities with progress telemetry', async () => {
    const lines: string[] = [
      '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1027', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LAYER',
      '0', 'LAYER', '2', 'NET', '70', '0', '62', '3',
      '0', 'ENDTAB', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES'
    ];
    for (let i = 0; i < 8000; i++) {
      lines.push(
        '0', 'LINE', '8', 'NET',
        '10', String(i * 10), '20', '0', '30', '0',
        '11', String(i * 10 + 5), '21', '100', '31', '0'
      );
      if (i % 4 === 0) {
        lines.push('0', 'HATCH', '8', 'NET', '2', 'SOLID', '70', '1', '92', '1', '10', '0', '20', '0', '10', '1', '20', '1');
      }
    }
    lines.push('0', 'ENDSEC', '0', 'EOF');

    const dxfPayload = lines.join('\n');
    const file = new File([dxfPayload], 'large-plant.dxf', { type: 'text/plain' });
    const progressEvents: CADImportProgressInfo[] = [];

    const outcome = await cadImportService.importFile(file, {
      lowMemoryMode: true,
      filterOptions: { skipHatch: true, skipHeavy3DAndImages: true },
      onProgressDetail: info => progressEvents.push(info)
    });

    assert.equal(outcome.kind, 'dxf');
    const { document, report } = outcome.importResult;
    assert.equal(document.entities.length, 8000);
    assert.equal(report.skippedCount, 2000);
    assert.equal(report.streamingUsed, true);
    assert.ok(progressEvents.some(p => p.pass === 1));
    assert.ok(progressEvents.some(p => p.pass === 2));
    assert.equal(progressEvents[progressEvents.length - 1].percent, 100);
  });

  await runTest('CAD Renderer: Bitmap pan cache fast-path & scale invalidation', () => {
    const { document: doc } = importDxfContent(SAMPLE_MULTI_ENTITY_DXF);
    const renderer = new CADCanvasRenderer();
    const baseVp = createDefaultCADViewport(1000, 600);

    const drawImageCalls: Array<{ dx: number; dy: number; w: number; h: number }> = [];
    const noop = () => {};
    const mockCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      globalAlpha: 1,
      textBaseline: 'alphabetic',
      textAlign: 'left',
      save: noop,
      restore: noop,
      fillRect: noop,
      clearRect: noop,
      beginPath: noop,
      closePath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      fill: noop,
      arc: noop,
      ellipse: noop,
      rect: noop,
      fillText: noop,
      strokeText: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      setLineDash: noop,
      measureText: () => ({ width: 20 }),
      drawImage: (_img: unknown, dx: number, dy: number, w: number, h: number) => {
        drawImageCalls.push({ dx, dy, w, h });
      }
    } as unknown as CanvasRenderingContext2D;

    const fakeSurface = { width: 1000, height: 600 } as HTMLCanvasElement;
    renderer.setPanCacheForTest(fakeSurface, doc, baseVp, false, 1);

    // Pan viewport center by (+200, -100) world units at scale 0.08 => dx = -16, dy = -8
    const pannedVp = {
      ...baseVp,
      centerX: baseVp.centerX + 200,
      centerY: baseVp.centerY - 100
    };
    const panStats = renderer.render(mockCtx, doc, pannedVp, {
      lightBackground: false,
      isPanning: true
    });
    assert.equal(panStats.usedPanCache, true);
    assert.equal(drawImageCalls.length, 1);
    assert.ok(Math.abs(drawImageCalls[0].dx - -16) < 1e-6);
    assert.ok(Math.abs(drawImageCalls[0].dy - -8) < 1e-6);

    // Changing scale must bypass pan cache and fall back to crisp vector draw
    const zoomedVp = { ...pannedVp, scale: baseVp.scale * 1.5 };
    const zoomStats = renderer.render(mockCtx, doc, zoomedVp, {
      lightBackground: false,
      isPanning: true
    });
    assert.equal(zoomStats.usedPanCache, false);
  });

  await runTest('CAD Renderer: Deep-zoom TEXT & sub-pixel detail culling', () => {
    const doc = createEmptyCADDocument('Culling Test');
    doc.entities.push(
      {
        id: 't1',
        handle: '1',
        type: 'TEXT',
        layer: '0',
        position: { x: 100, y: 100, z: 0 },
        height: 200,
        rotation: 0,
        text: 'SW-CORE-01',
        style: 'STANDARD',
        hAlign: 0,
        vAlign: 0,
        widthFactor: 1,
        obliqueAngle: 0,
        preservationTier: 'supported'
      },
      {
        id: 'mt1',
        handle: '2',
        type: 'MTEXT',
        layer: '0',
        position: { x: 300, y: 100, z: 0 },
        height: 150,
        width: 800,
        rotation: 0,
        rawText: 'MDF ROOM',
        plainText: 'MDF ROOM',
        attachmentPoint: 1,
        style: 'STANDARD',
        preservationTier: 'supported'
      },
      {
        id: 'l_tiny',
        handle: '3',
        type: 'LINE',
        layer: '0',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 40, y: 0, z: 0 },
        preservationTier: 'supported'
      },
      {
        id: 'c_tiny',
        handle: '4',
        type: 'CIRCLE',
        layer: '0',
        center: { x: 500, y: 500, z: 0 },
        radius: 20,
        preservationTier: 'supported'
      },
      {
        id: 'l_big',
        handle: '5',
        type: 'LINE',
        layer: '0',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 12000, y: 0, z: 0 },
        preservationTier: 'supported'
      }
    );
    doc.extents = recomputeDocumentExtents(doc);

    const renderer = new CADCanvasRenderer();
    const noop = () => {};
    const mockCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      globalAlpha: 1,
      textBaseline: 'alphabetic',
      textAlign: 'left',
      save: noop,
      restore: noop,
      fillRect: noop,
      beginPath: noop,
      closePath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      fill: noop,
      arc: noop,
      ellipse: noop,
      rect: noop,
      fillText: noop,
      strokeText: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      setLineDash: noop,
      measureText: () => ({ width: 20 })
    } as unknown as CanvasRenderingContext2D;

    const thPerf = resolveCadDetailCullingThresholds('high_performance', 5000, true);
    assert.ok(thPerf.minTextPx >= 6.0);

    // Deep zoom-out: text is 200 * 0.002 = 0.4px, tiny line is 0.08px, big line is 24px
    const farVp = { centerX: 5000, centerY: 500, scale: 0.002, width: 1000, height: 600 };
    const farStats = renderer.render(mockCtx, doc, farVp, { showGrid: false });
    assert.equal(farStats.renderedCount, 1);
    assert.equal(farStats.skippedDetailCount, 4);

    // Close zoom-in: all 5 entities render cleanly
    const nearVp = { centerX: 500, centerY: 200, scale: 1.0, width: 1000, height: 600 };
    const nearStats = renderer.render(mockCtx, doc, nearVp, { showGrid: false });
    assert.equal(nearStats.renderedCount, 5);
    assert.equal(nearStats.skippedDetailCount, 0);
  });

  await runTest('CAD Export: Standalone interactive HTML & ISO A4/A3 PDF export', async () => {
    const { document: doc } = importDxfContent(SAMPLE_MULTI_ENTITY_DXF);
    doc.name = 'Tang 1 <Test & Check>';

    const exporter = new CADExportService();
    const html = exporter.exportToHtmlString(doc, { lightBackground: false });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('Tang 1 &lt;Test &amp; Check&gt;'));
    assert.ok(html.includes('viewBox'));
    assert.ok(html.includes("addEventListener('wheel'"));
    assert.ok(html.includes('Vừa khung'));

    const pdfA4 = await cadExportService.exportToPdfArtifact(doc, {
      paperSize: 'A4',
      orientation: 'landscape'
    });
    assert.equal(pdfA4.paperSize, 'A4');
    assert.equal(pdfA4.pageCount, 1);
    assert.ok(pdfA4.filename.endsWith('_A4.pdf'));
    const headerA4 = String.fromCharCode(...pdfA4.uint8.slice(0, 5));
    assert.equal(headerA4, '%PDF-');

    const pdfA3 = await exporter.exportToPdfArtifact(doc, {
      paperSize: 'A3',
      orientation: 'landscape'
    });
    assert.equal(pdfA3.paperSize, 'A3');
    assert.ok(pdfA3.filename.endsWith('_A3.pdf'));
    assert.ok(pdfA3.uint8.length > 500);
  });

  await runTest('CAD: LibreDWG WASM runtime loads, decodes DWG via mapper & cleans WASM memory', async () => {
    // 1. Real WASM binary instantiates cleanly in runtime environment
    const realInstance = await getLibreDwgInstance();
    assert.equal(typeof realInstance.dwg_read_file, 'function');
    assert.equal(typeof realInstance.convertEx, 'function');
    assert.equal(typeof realInstance.dwg_free, 'function');

    // 2. Full decode + DwgDatabaseMapper pipeline + cleanup verification
    const memfs = new Map<string, Uint8Array>();
    let freedPtr = 0;
    let unlinkedPath = '';

    const sampleDb = {
      header: {
        ACADVER: 'AC1027',
        INSUNITS: 4,
        MEASUREMENT: 1,
        LUNITS: 2,
        DIMSCALE: 1,
        LTSCALE: 1,
        TEXTSIZE: 250,
        CLAYER: 'WALLS'
      },
      tables: {
        LAYER: {
          entries: [
            { name: '0', colorIndex: 7, lineType: 'CONTINUOUS', lineweight: -3, off: false, frozen: false, locked: false, plotFlag: 1, handle: '1' },
            { name: 'WALLS', colorIndex: 1, lineType: 'CONTINUOUS', lineweight: 30, off: false, frozen: false, locked: false, plotFlag: 1, handle: '10' },
            { name: 'DEVICES', colorIndex: 3, lineType: 'CONTINUOUS', lineweight: 25, off: false, frozen: false, locked: false, plotFlag: 1, handle: '11' }
          ]
        },
        LTYPE: { entries: [] },
        STYLE: { entries: [] },
        DIMSTYLE: { entries: [] },
        BLOCK_RECORD: {
          entries: [
            {
              name: 'SW_BLOCK',
              flags: 0,
              basePoint: { x: 0, y: 0, z: 0 },
              handle: '20',
              entities: [
                {
                  type: 'CIRCLE',
                  layer: '0',
                  handle: '21',
                  center: { x: 0, y: 0, z: 0 },
                  radius: 25
                }
              ]
            }
          ]
        }
      },
      entities: [
        {
          type: 'LINE',
          layer: 'WALLS',
          handle: '100',
          startPoint: { x: 0, y: 0, z: 0 },
          endPoint: { x: 4000, y: 0, z: 0 }
        },
        {
          type: 'MTEXT',
          layer: 'DEVICES',
          handle: '101',
          insertionPoint: { x: 1500, y: 800, z: 0 },
          text: '{\\fArial;RACK-01\\PCORE-SW}',
          textHeight: 180,
          rectWidth: 1000
        },
        {
          type: 'INSERT',
          layer: 'DEVICES',
          handle: '102',
          name: 'SW_BLOCK',
          insertionPoint: { x: 2000, y: 1200, z: 0 },
          xScale: 1,
          yScale: 1,
          zScale: 1,
          rotation: 0,
          attribs: [
            {
              type: 'ATTRIB',
              handle: '103',
              tag: 'SW_TAG',
              text: 'SW-MDF-01',
              startPoint: { x: 2050, y: 1200, z: 0 },
              textHeight: 100,
              rotation: 0
            }
          ]
        },
        // Duplicate ATTRIB pushed by LibreDWG at root must be deduplicated
        {
          type: 'ATTRIB',
          handle: '103',
          layer: 'DEVICES',
          tag: 'SW_TAG',
          text: 'SW-MDF-01',
          startPoint: { x: 2050, y: 1200, z: 0 },
          textHeight: 100,
          rotation: 0
        }
      ],
      objects: {
        LAYOUT: [{ layoutName: 'Model', tabOrder: 0 }]
      }
    } as unknown as DwgDatabase;

    const mockRuntime: LibreDwgRuntimeLike = {
      FS: {
        writeFile: (p, data) => {
          memfs.set(p, data);
        },
        analyzePath: p => ({ exists: memfs.has(p) }),
        unlink: p => {
          unlinkedPath = p;
          memfs.delete(p);
        }
      },
      dwg_read_file: () => ({ data: 99123, error: 0 }),
      convertEx: () => ({
        database: sampleDb,
        stats: { unknownEntityCount: 2 }
      }),
      dwg_free: ptr => {
        freedPtr = ptr;
      }
    };

    const dwgStub = new Uint8Array(64);
    'AC1027'.split('').forEach((c, i) => (dwgStub[i] = c.charCodeAt(0)));

    const outcome = await importDwgBuffer(dwgStub.buffer, 'tang1-server.dwg', {
      projectId: 'proj_dwg_1',
      libreDwgOverride: mockRuntime
    });
    assert.equal(outcome.status, 'converted');
    assert.equal(outcome.decodedBy, 'libredwg-wasm');
    assert.equal(outcome.inspection.conversionRequired, false);
    assert.ok(outcome.result);
    assert.equal(outcome.result.document.projectId, 'proj_dwg_1');
    assert.equal(outcome.result.document.metadata.sourceFormat, 'dwg-converted');
    assert.equal(outcome.result.document.entities.length, 3);
    assert.ok(outcome.result.document.blocks['SW_BLOCK']);
    assert.ok(outcome.result.report.warnings.some(w => w.code === 'DWG_WASM_DECODED'));
    assert.ok(outcome.result.report.warnings.some(w => w.code === 'UNKNOWN_ENTITIES' && w.count === 2));
    assert.equal(freedPtr, 99123);
    assert.ok(unlinkedPath.endsWith('.dwg'));
    assert.equal(memfs.size, 0);

    // 3. Verify OUTOFMEM error calls dwg_abandon and falls back cleanly without leaking MEMFS
    let abandonedPtr = 0;
    const oomRuntime: LibreDwgRuntimeLike = {
      FS: mockRuntime.FS,
      dwg_read_file: () => ({ data: 777, error: 8192 }),
      convertEx: mockRuntime.convertEx,
      dwg_free: mockRuntime.dwg_free,
      dwg_abandon: ptr => {
        abandonedPtr = ptr;
      }
    };
    await assert.rejects(
      () => decodeDwgBufferWithLibreDwg(dwgStub.buffer, { fileName: 'huge.dwg', libreDwgOverride: oomRuntime }),
      /WebAssembly/i
    );
    assert.equal(abandonedPtr, 777);
    assert.equal(memfs.size, 0);
  });

  await runTest('CAD: Decodes \\U+XXXX Vietnamese/CJK Unicode escapes across DXF layers & text and strips MTEXT', () => {
    assert.equal(
      decodeAutoCadText('M\\U+1EB6T B\\U+1EB0NG T\\U+1EA6NG 1 %%c110 %%d45 %%p2'),
      'MẶT BẰNG TẦNG 1 ∅110 °45 ±2'
    );
    assert.equal(
      stripMTextFormatting('{\\fArial|b1;M\\U+1EB6T B\\U+1EB0NG}\\P{\\H0.8x;T\\U+1EA6NG 2}'),
      'MẶT BẰNG\nTẦNG 2'
    );

    const unicodeDxf = [
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LAYER',
      '0', 'LAYER', '2', '\\U+6DD8\\U+5B9D_TUONG', '70', '0', '62', '3',
      '0', 'ENDTAB',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'TEXT', '8', '\\U+6DD8\\U+5B9D_TUONG', '10', '100', '20', '200', '40', '25',
      '1', 'M\\U+1EB6T B\\U+1EB0NG S\\U+00C2N TH\\U+01AF\\U+1EE2NG',
      '0', 'ENDSEC',
      '0', 'EOF'
    ].join('\n');

    const { document: doc } = importDxfContent(unicodeDxf);
    assert.ok(doc.layers['淘宝_TUONG']);
    assert.equal(doc.entities.length, 1);
    assert.equal(doc.entities[0].layer, '淘宝_TUONG');
    assert.equal((doc.entities[0] as Extract<CADEntity, { type: 'TEXT' }>).text, 'MẶT BẰNG SÂN THƯỢNG');
  });

  await runTest('CAD: Smart fit excludes extreme outlier geometry & SVG/HTML preserves proportional text', () => {
    const doc = createEmptyCADDocument('Smart Fit & Proportional HTML');
    doc.layers['HIDDEN_AXIS'] = {
      id: 'layer_hidden',
      name: 'HIDDEN_AXIS',
      colorIndex: 8,
      lineType: 'CONTINUOUS',
      lineWeight: -3,
      visible: false,
      frozen: false,
      locked: false,
      plottable: true
    };

    // 10 entities clustered in [100..500, 100..400]
    for (let i = 0; i < 10; i++) {
      doc.entities.push({
        id: `wall_${i}`,
        handle: `W${i}`,
        type: 'LINE',
        layer: '0',
        start: { x: 100 + i * 35, y: 100, z: 0 },
        end: { x: 100 + i * 35, y: 400, z: 0 },
        preservationTier: 'supported',
        dirty: false
      });
    }
    // Small proportional label (world height = 10 -> ~2.5% of 400 span, much smaller than giant fixed 6px floor if outliers existed)
    doc.entities.push({
      id: 'lbl_1',
      handle: 'T1',
      type: 'TEXT',
      layer: '0',
      position: { x: 150, y: 200, z: 0 },
      height: 1.5,
      rotation: 0,
      text: 'M\\U+1EB6T B\\U+1EB0NG T\\U+1EA6NG 1',
      style: 'STANDARD',
      hAlign: 0,
      vAlign: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      preservationTier: 'supported',
      dirty: false
    });
    // 1 huge outlier cross line spanning [-50000..50000]
    doc.entities.push({
      id: 'outlier_cross',
      handle: 'OC1',
      type: 'LINE',
      layer: '0',
      start: { x: -50000, y: 250, z: 0 },
      end: { x: 50000, y: 250, z: 0 },
      preservationTier: 'supported',
      dirty: false
    });
    // 1 hidden layer giant frame
    doc.entities.push({
      id: 'hidden_big',
      handle: 'HB1',
      type: 'LINE',
      layer: 'HIDDEN_AXIS',
      start: { x: -80000, y: -80000, z: 0 },
      end: { x: 80000, y: 80000, z: 0 },
      preservationTier: 'supported',
      dirty: false
    });
    // 1 DIMENSION with uninitialized (0,0) defPoint while anchor points sit at the cluster
    doc.entities.push({
      id: 'dim_origin_bug',
      handle: 'DM1',
      type: 'DIMENSION',
      layer: '0',
      dimensionType: 'linear',
      subTypeCode: 0,
      defPoint: { x: 0, y: 0, z: 0 },
      defPoint2: { x: 400, y: 300, z: 0 },
      defPoint3: { x: 450, y: 300, z: 0 },
      textMidPoint: { x: 425, y: 315, z: 0 },
      text: '<>',
      measuredValue: 50,
      style: 'STANDARD',
      preservationTier: 'supported',
      dirty: false
    });

    const dimBounds = computeEntityBounds2D(doc.entities[doc.entities.length - 1]);
    assert.ok(dimBounds.minX >= 390, 'Ignores stray (0,0) defPoint when anchors cluster far away');

    doc.extents = recomputeDocumentExtents(doc);
    const smart = computeSmartFitExtents(doc);
    assert.ok(smart.minX >= 90 && smart.maxX <= 500, `Smart fit X=${smart.minX}..${smart.maxX} ignores outlier cross & hidden layer`);
    assert.ok(smart.minY >= 90 && smart.maxY <= 410, `Smart fit Y=${smart.minY}..${smart.maxY} focuses on main cluster`);

    const svg = renderCADDocumentToSvg(doc, {
      width: 1920,
      height: 1200,
      tagEntitiesForInteractiveHtml: true,
      minTextSvgSize: 0.1
    });
    assert.ok(svg.includes('MẶT BẰNG TẦNG 1'), 'SVG renders decoded Vietnamese label');
    assert.ok(!svg.includes('\\U+1EB6'), 'SVG contains no raw \\U+XXXX escapes');
    // Proportional font-size ~ 1.5 * ((1200-56)/300) ~ 5.7 (not clamped up when tiny, check even smaller text)
    doc.entities[10] = {
      ...(doc.entities[10] as Extract<CADEntity, { type: 'TEXT' }>),
      height: 0.25
    };
    const smallSvg = renderCADDocumentToSvg(doc, {
      width: 1920,
      height: 1200,
      tagEntitiesForInteractiveHtml: true,
      minTextSvgSize: 0.1
    });
    const match = smallSvg.match(/font-size="([0-9.]+)"/);
    assert.ok(match && Number(match[1]) < 2.0, `Expected proportional small font-size (< 2), got ${match?.[1]}`);

    const html = new CADExportService().exportToHtmlString(doc);
    assert.ok(html.includes('btn-toggle-text'));
    assert.ok(html.includes('btn-toggle-layers'));
    assert.ok(html.includes('data-layer="0"'));
    assert.ok(html.includes('MẶT BẰNG TẦNG 1'));
  });

  await runTest('CAD Export: Multi-zone asymmetric drawing keeps full upper+lower half in HTML & auto-orients A4/A3 PDF', async () => {
    const doc = createEmptyCADDocument('Multi Zone Portrait CAD');

    // Dense upper zone (15 entities at y=800..1000)
    for (let i = 0; i < 15; i++) {
      doc.entities.push({
        id: `top_${i}`,
        handle: `TOP_${i}`,
        type: 'LINE',
        layer: '0',
        start: { x: 100 + i * 20, y: 800, z: 0 },
        end: { x: 100 + i * 20, y: 1000, z: 0 },
        preservationTier: 'supported',
        dirty: false
      });
    }
    // Sparser lower zone (4 entities at y=0..400, total tall aspect 300x1000)
    for (let i = 0; i < 4; i++) {
      doc.entities.push({
        id: `bot_${i}`,
        handle: `BOT_${i}`,
        type: 'LINE',
        layer: '0',
        start: { x: 100 + i * 80, y: 0, z: 0 },
        end: { x: 100 + i * 80, y: 400, z: 0 },
        preservationTier: 'supported',
        dirty: false
      });
    }

    doc.extents = recomputeDocumentExtents(doc);
    const smart = computeSmartFitExtents(doc);
    assert.ok(smart.minY <= 10, `Expected full lower zone preserved (minY=${smart.minY})`);
    assert.ok(smart.maxY >= 990, `Expected full upper zone preserved (maxY=${smart.maxY})`);

    const exporter = new CADExportService();
    const html = exporter.exportToHtmlString(doc);
    assert.ok(html.includes('id="cad-content"'), 'HTML wraps entities in cad-content group');
    const vbMatch = html.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(vbMatch, 'HTML SVG contains integer viewBox');
    const vbW = Number(vbMatch![1]);
    const vbH = Number(vbMatch![2]);
    assert.ok(vbH >= vbW, `Tall drawing produces tall SVG viewport (${vbW}x${vbH})`);

    // Verify all rendered <line y1/y2 coordinates stay comfortably inside [0..vbH]
    const yValues = Array.from(html.matchAll(/<line[^>]*\sy1="([0-9.-]+)"\s+x2="[0-9.-]+"\s+y2="([0-9.-]+)"/g))
      .flatMap(m => [Number(m[1]), Number(m[2])]);
    assert.equal(yValues.length, 38, 'All 19 lines rendered in HTML');
    const minMappedY = Math.min(...yValues);
    const maxMappedY = Math.max(...yValues);
    assert.ok(minMappedY > 20 && maxMappedY < vbH - 20, `Mapped Y spans ${minMappedY}..${maxMappedY} centered inside 0..${vbH}`);

    // Tall drawing auto-selects portrait for A4 & A3 when orientation is omitted or 'auto'
    const autoA4 = await exporter.exportToPdfArtifact(doc, { paperSize: 'A4' });
    assert.equal(autoA4.orientation, 'portrait');
    const autoA3 = await exporter.exportToPdfArtifact(doc, { paperSize: 'A3', orientation: 'auto' });
    assert.equal(autoA3.orientation, 'portrait');

    // Explicit landscape override still respected
    const forcedLandscape = await exporter.exportToPdfArtifact(doc, {
      paperSize: 'A4',
      orientation: 'landscape'
    });
    assert.equal(forcedLandscape.orientation, 'landscape');
  });
}

runStandaloneSuite(import.meta.url, runCadEngineTests);
