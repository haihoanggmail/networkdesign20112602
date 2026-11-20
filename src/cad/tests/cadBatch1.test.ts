import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TestFn } from '../../utils/__tests__/testHarness';
import { runStandaloneSuite } from '../../utils/__tests__/testHarness';
import { createFiveStoreyBuildingProject } from '../../data/defaultStarterTemplate';
import type { ProjectState } from '../../types/infrastructure';
import { createEmptyCADDocument } from '../core/CADDocument';
import type { CADEntity } from '../core/CADTypes';
import { writeRoundTripDxf } from '../export/DXFRoundTripWriter';
import { writeCombinedCadAndNetworkDxf } from '../export/DXFWriter';
import { decodeDwgBufferWithLibreDwg } from '../dwg/LibreDwgWasmLoader';
import { CADImportService } from '../import/CADImportService';
import {
  CAD_FORMAT_MEMORY_POLICIES,
  validateCadFilePayload
} from '../import/CADImportValidator';
import { importDxfContent } from '../import/DXFImporter';
import { CADAutosaveController } from '../storage/CADAutosave';
import { cadDatabase } from '../storage/CADDatabase';
import { CADRepository } from '../storage/CADRepository';

function makeBatch1RoundTripDxf(): string {
  return [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1027',
    '9', '$INSUNITS', '70', '4',
    '9', '$HANDSEED', '5', '200',
    '9', '$EXTMIN', '10', '0', '20', '0', '30', '0',
    '9', '$EXTMAX', '10', '1000', '20', '1000', '30', '0',
    '9', '$CECOLOR', '62', '5',
    '9', '$FINGERPRINTGUID', '1', '{11111111-2222-3333-4444-555555555555}',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'CLASSES',
    '0', 'CLASS', '1', 'HATCH', '2', 'AcDbHatch', '3', 'ObjectDBX Classes', '90', '0', '280', '0', '281', '0',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'VPORT', '5', '8', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'VPORT', '5', '18', '100', 'AcDbSymbolTableRecord', '100', 'AcDbViewportTableRecord', '2', '*ACTIVE', '40', '1200',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'LTYPE', '5', '5', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'LTYPE', '5', '14', '100', 'AcDbSymbolTableRecord', '100', 'AcDbLinetypeTableRecord', '2', 'CONTINUOUS', '70', '0', '3', 'Solid', '72', '65', '73', '0', '40', '0',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'LAYER', '5', '2', '100', 'AcDbSymbolTable', '70', '3',
    '0', 'LAYER', '5', '10', '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS', '290', '1', '370', '-3',
    '0', 'LAYER', '5', '11', '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '2', 'ARCH_WALL', '70', '0', '62', '1', '6', 'CONTINUOUS', '290', '1', '370', '30',
    '0', 'LAYER', '5', '12', '100', 'AcDbSymbolTableRecord', '100', 'AcDbLayerTableRecord', '2', 'TAG_LAYER', '70', '0', '62', '3', '6', 'CONTINUOUS', '290', '1', '370', '25',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'STYLE', '5', '3', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'STYLE', '5', '13', '100', 'AcDbSymbolTableRecord', '100', 'AcDbTextStyleTableRecord', '2', 'STANDARD', '70', '0', '40', '0', '41', '1', '50', '0', '71', '0', '42', '2.5', '3', 'arial.ttf', '4', '',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'APPID', '5', '9', '100', 'AcDbSymbolTable', '70', '2',
    '0', 'APPID', '5', '19', '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '2', 'ACAD', '70', '0',
    '0', 'APPID', '5', '1A', '100', 'AcDbSymbolTableRecord', '100', 'AcDbRegAppTableRecord', '2', 'HACHIHI_META', '70', '0',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'DIMSTYLE', '5', 'A', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'DIMSTYLE', '105', '27', '100', 'AcDbSymbolTableRecord', '100', 'AcDbDimStyleTableRecord', '2', 'STANDARD', '70', '0', '40', '1', '41', '2.5', '42', '0.625', '44', '1.25', '140', '2.5', '144', '1', '271', '2',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'BLOCK_RECORD', '5', '1', '100', 'AcDbSymbolTable', '70', '1',
    '0', 'BLOCK_RECORD', '5', '30', '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '2', 'NET_BOX',
    '0', 'ENDTAB',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '5', '31', '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockBegin', '2', 'NET_BOX', '70', '2', '10', '0', '20', '0', '30', '0', '3', 'NET_BOX',
    '0', 'LINE', '5', '32', '100', 'AcDbEntity', '8', '0', '100', 'AcDbLine', '10', '-20', '20', '-20', '30', '0', '11', '20', '21', '20', '31', '0',
    '0', 'ENDBLK', '5', '33', '100', 'AcDbEntity', '8', '0', '100', 'AcDbBlockEnd',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'INSERT', '5', 'A1', '100', 'AcDbEntity', '8', 'ARCH_WALL', '100', 'AcDbBlockReference', '66', '1', '2', 'NET_BOX', '10', '250', '20', '350', '30', '0', '41', '1', '42', '1', '43', '1', '50', '0',
    '0', 'ATTRIB', '5', 'A2', '100', 'AcDbEntity', '8', 'TAG_LAYER', '100', 'AcDbText', '10', '260', '20', '360', '30', '0', '40', '12', '1', 'SW-01', '100', 'AcDbAttribute', '2', 'HOST', '70', '0',
    '0', 'ATTRIB', '5', 'A3', '100', 'AcDbEntity', '8', 'TAG_LAYER', '100', 'AcDbText', '10', '260', '20', '340', '30', '0', '40', '10', '1', '10.10.1.10', '100', 'AcDbAttribute', '2', 'IP', '70', '0',
    '0', 'SEQEND', '5', 'A4', '100', 'AcDbEntity', '8', 'ARCH_WALL',
    '0', 'POLYLINE', '5', 'B1', '100', 'AcDbEntity', '8', 'ARCH_WALL', '100', 'AcDb2dPolyline', '66', '1', '70', '1',
    '0', 'VERTEX', '5', 'B2', '100', 'AcDbEntity', '8', 'ARCH_WALL', '100', 'AcDbVertex', '100', 'AcDb2dVertex', '10', '0', '20', '0', '30', '0',
    '0', 'VERTEX', '5', 'B3', '100', 'AcDbEntity', '8', 'ARCH_WALL', '100', 'AcDbVertex', '100', 'AcDb2dVertex', '10', '800', '20', '0', '30', '0',
    '0', 'SEQEND', '5', 'B4', '100', 'AcDbEntity', '8', 'ARCH_WALL',
    '0', 'LINE', '5', 'C1', '100', 'AcDbEntity', '8', 'ARCH_WALL', '100', 'AcDbLine', '10', '0', '20', '100', '30', '0', '11', '900', '21', '100', '31', '0', '1001', 'HACHIHI_META', '1000', 'CORRIDOR_A', '1070', '42',
    '0', '3DSOLID', '5', 'D1', '100', 'AcDbEntity', '8', 'ARCH_WALL', '100', 'AcDbModelerGeometry', '70', '1', '1', 'RAW_ACIS_STUB',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'OBJECTS',
    '0', 'DICTIONARY', '5', 'E1', '100', 'AcDbDictionary', '281', '1', '3', 'ACAD_LAYOUT', '350', 'E2',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'THUMBNAILIMAGE',
    '90', '4', '310', 'AABBCCDD',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');
}

export async function runCadBatch1Tests(runTest: TestFn): Promise<void> {
  await runTest('P1.1 CAD Round-Trip: preserves Header extra vars, Tables, Classes, Objects, INSERT+ATTRIB+SEQEND, POLYLINE+VERTEX+SEQEND, XData & Unknowns + Combined Export', () => {
    const rawDxf = makeBatch1RoundTripDxf();
    const { document: doc1, report: rep1 } = importDxfContent(rawDxf, { fileName: 'roundtrip_p1.dxf' });

    assert.equal(rep1.ok, true);
    assert.equal(doc1.header.$HANDSEED, '200');
    assert.ok(doc1.header.extra?.['$FINGERPRINTGUID']);
    assert.ok(doc1.header.extra?.['$CECOLOR']);
    assert.ok(doc1.rawSections?.classes?.length);
    assert.ok(doc1.rawSections?.objects?.length);
    assert.ok(doc1.rawSections?.thumbnail?.length);
    const extraNames = (doc1.rawSections?.extraTables || []).map(t => t.name);
    assert.ok(extraNames.includes('VPORT'));
    assert.ok(extraNames.includes('APPID'));
    assert.ok(extraNames.includes('BLOCK_RECORD'));

    // Edit layer lock/visibility and verify untouched entities keep exact handles + sub-records
    doc1.layers['ARCH_WALL'].locked = true;
    doc1.layers['ARCH_WALL'].visible = false;

    const roundTripText = writeRoundTripDxf(doc1);
    const { document: doc2 } = importDxfContent(roundTripText, { fileName: 'roundtrip_p1_out.dxf' });

    // 1. Header extra & strictly larger $HANDSEED
    assert.ok(doc2.header.extra?.['$FINGERPRINTGUID']);
    assert.ok(doc2.header.extra?.['$CECOLOR']);
    const seedInt = parseInt(doc2.header.$HANDSEED || '0', 16);
    assert.ok(seedInt > 0x200, `Expected $HANDSEED (${doc2.header.$HANDSEED}) > 200`);

    // 2. Classes, Objects, Thumbnail, and Extra Tables preserved
    assert.ok(doc2.rawSections?.classes?.length);
    assert.ok(doc2.rawSections?.objects?.length);
    assert.ok(doc2.rawSections?.thumbnail?.length);
    const extraNames2 = (doc2.rawSections?.extraTables || []).map(t => t.name);
    assert.ok(extraNames2.includes('VPORT'));
    assert.ok(extraNames2.includes('APPID'));
    assert.ok(extraNames2.includes('BLOCK_RECORD'));

    // 3. Edited layer keeps lock + off state while keeping handle '11'
    assert.equal(doc2.layers['ARCH_WALL'].locked, true);
    assert.equal(doc2.layers['ARCH_WALL'].visible, false);
    assert.equal(doc2.layers['ARCH_WALL'].handle, '11');

    // 4. INSERT + ATTRIB sub-records keep distinct handles & TAG_LAYER intact
    const ins = doc2.entities.find(e => e.type === 'INSERT') as Extract<CADEntity, { type: 'INSERT' }>;
    assert.ok(ins);
    assert.equal(ins.handle, 'A1');
    assert.equal(ins.layer, 'ARCH_WALL');
    assert.equal(ins.attributes?.length, 2);
    assert.equal(ins.attributes?.[0].handle, 'A2');
    assert.equal(ins.attributes?.[0].layer, 'TAG_LAYER');
    assert.equal(ins.attributes?.[0].text, 'SW-01');
    assert.equal(ins.attributes?.[1].handle, 'A3');
    assert.equal(ins.attributes?.[1].layer, 'TAG_LAYER');
    // Verify SEQEND still carries handle A4 and not A1 in output text
    assert.ok(roundTripText.includes('\n5\nA4\n'));
    assert.ok(roundTripText.includes('\n5\nA2\n'));

    // 5. POLYLINE + VERTEX + SEQEND keep distinct handles
    const poly = doc2.entities.find(e => e.type === 'POLYLINE') as Extract<CADEntity, { type: 'POLYLINE' }>;
    assert.ok(poly);
    assert.equal(poly.handle, 'B1');
    assert.equal(poly.vertices.length, 2);
    assert.ok(roundTripText.includes('\n5\nB2\n'));
    assert.ok(roundTripText.includes('\n5\nB3\n'));
    assert.ok(roundTripText.includes('\n5\nB4\n'));

    // 6. XDATA & Unknown 3DSOLID preserved
    const xLine = doc2.entities.find(e => e.handle === 'C1');
    assert.ok(xLine?.xdata?.some(x => x.appName === 'HACHIHI_META'));
    const solid = doc2.entities.find(e => e.type === 'UNKNOWN' && e.handle === 'D1');
    assert.ok(solid && solid.type === 'UNKNOWN' && solid.dxfType === '3DSOLID');

    // 7. Combined CAD + Network DXF export preserves round-trip sections & entities alongside HACHIHI_* layers
    const project: ProjectState = createFiveStoreyBuildingProject();
    const combinedDxf = writeCombinedCadAndNetworkDxf(doc2, project, {
      floorScope: project.activeFloorId || 'all'
    });
    const { document: docCombined } = importDxfContent(combinedDxf, { fileName: 'combined.dxf' });
    assert.ok(docCombined.rawSections?.objects?.length);
    assert.ok(docCombined.rawSections?.classes?.length);
    assert.ok(docCombined.layers['HACHIHI_DEVICES']);
    assert.ok(docCombined.entities.some(e => e.handle === 'D1' && e.type === 'UNKNOWN'));
    assert.ok(docCombined.entities.some(e => e.handle === 'A1' && e.type === 'INSERT'));
    assert.ok(docCombined.entities.some(e => e.layer === 'HACHIHI_DEVICES'));
  });

  await runTest('P1.2 CAD Persistence: atomic generation commit preserves previous committed data on mid-save failures, supports legacy v1 & serializes autosave', async () => {
    const repo = new CADRepository();
    const docId = `cad_p12_${Date.now()}`;

    const makeEntities = (count: number, prefix: string): CADEntity[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `${prefix}_${i}`,
        handle: (0x1000 + i).toString(16).toUpperCase(),
        type: 'LINE',
        layer: '0',
        start: { x: i, y: 0, z: 0 },
        end: { x: i + 10, y: 5, z: 0 },
        preservationTier: 'supported',
        dirty: false
      }));

    try {
      const docV1 = createEmptyCADDocument('Doc Gen 1');
      docV1.id = docId;
      docV1.entities = makeEntities(1200, 'v1');
      const gen1 = await repo.saveDocument(docV1, { chunkSize: 400 });
      assert.equal(gen1, 1);

      const loadedV1 = await repo.loadDocument(docId);
      assert.ok(loadedV1);
      assert.equal(loadedV1.name, 'Doc Gen 1');
      assert.equal(loadedV1.entities.length, 1200);
      assert.equal(loadedV1.entities[0].id, 'v1_0');

      // Fault-injection mid-chunks during Gen 2 save
      const docV2 = createEmptyCADDocument('Doc Gen 2 Broken');
      docV2.id = docId;
      docV2.entities = makeEntities(1500, 'v2');
      await assert.rejects(
        () =>
          repo.saveDocument(docV2, {
            chunkSize: 300,
            onBeforeStage: stage => {
              if (stage === 'mid-chunks') {
                throw new Error('Simulated storage quota failure mid-chunks');
              }
            }
          }),
        /quota failure/
      );

      // Verify Gen 1 reloads 100% intact and no orphan Gen 2 chunks remain
      const afterMidFail = await repo.loadDocument(docId);
      assert.ok(afterMidFail);
      assert.equal(afterMidFail.name, 'Doc Gen 1');
      assert.equal(afterMidFail.entities.length, 1200);
      assert.equal(afterMidFail.entities[0].id, 'v1_0');

      const entityChunksAfterMidFail = await cadDatabase.getRecordsByDocId<{
        docId?: string;
        generation?: number;
      }>('entities', docId);
      assert.ok(entityChunksAfterMidFail.every(c => c.generation === 1));

      // Fault-injection right before commit pointer update
      await assert.rejects(
        () =>
          repo.saveDocument(docV2, {
            chunkSize: 300,
            onBeforeStage: stage => {
              if (stage === 'before-commit') {
                throw new Error('Simulated failure before commit');
              }
            }
          }),
        /before commit/
      );
      const afterPreCommitFail = await repo.loadDocument(docId);
      assert.equal(afterPreCommitFail?.name, 'Doc Gen 1');
      assert.equal(afterPreCommitFail?.entities.length, 1200);

      // Successful Gen 2 save commits cleanly and GC removes Gen 1 chunks
      docV2.name = 'Doc Gen 2 Committed';
      const gen2 = await repo.saveDocument(docV2, { chunkSize: 400 });
      assert.equal(gen2, 2);
      // Allow background GC microtasks to settle
      await new Promise(resolve => setTimeout(resolve, 20));
      const loadedV2 = await repo.loadDocument(docId);
      assert.equal(loadedV2?.name, 'Doc Gen 2 Committed');
      assert.equal(loadedV2?.entities.length, 1500);
      assert.equal(loadedV2?.entities[0].id, 'v2_0');

      const chunksAfterGen2 = await cadDatabase.getRecordsByDocId<{
        docId?: string;
        generation?: number;
      }>('entities', docId);
      assert.ok(chunksAfterGen2.every(c => c.generation === 2));

      // Legacy v1 record (without committedGeneration) remains readable
      const legacyId = `cad_legacy_${Date.now()}`;
      const legacyDoc = createEmptyCADDocument('Legacy v1');
      legacyDoc.id = legacyId;
      legacyDoc.entities = makeEntities(5, 'legacy');
      await cadDatabase.putRecord('documents', {
        id: legacyId,
        name: legacyDoc.name,
        schemaVersion: legacyDoc.schemaVersion,
        header: legacyDoc.header,
        extents: legacyDoc.extents,
        nextHandleSeed: legacyDoc.nextHandleSeed,
        metadata: legacyDoc.metadata,
        underlay: legacyDoc.underlay,
        entityCount: 5,
        layerCount: 1,
        chunkCount: 1,
        createdAt: legacyDoc.createdAt,
        updatedAt: legacyDoc.updatedAt
      });
      await cadDatabase.putRecord('layers', { id: legacyId, docId: legacyId, layers: legacyDoc.layers });
      await cadDatabase.putRecord('blocks', { id: legacyId, docId: legacyId, blocks: legacyDoc.blocks });
      await cadDatabase.putRecord('styles', {
        id: legacyId,
        docId: legacyId,
        lineTypes: legacyDoc.lineTypes,
        textStyles: legacyDoc.textStyles,
        dimStyles: legacyDoc.dimStyles
      });
      await cadDatabase.putRecord('layouts', { id: legacyId, docId: legacyId, layouts: legacyDoc.layouts });
      await cadDatabase.saveEntityChunksStreaming(legacyId, legacyDoc.entities);

      const loadedLegacy = await repo.loadDocument(legacyId);
      assert.equal(loadedLegacy?.name, 'Legacy v1');
      assert.equal(loadedLegacy?.entities.length, 5);
      await repo.deleteDocument(legacyId);

      // Autosave controller serialization & error reporting
      let concurrent = 0;
      let maxConcurrent = 0;
      const savedNames: string[] = [];
      const errors: string[] = [];
      let failNext = false;

      const autosave = new CADAutosaveController(15, {
        onError: err => errors.push(err.message),
        saveFn: async doc => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise(resolve => setTimeout(resolve, 25));
          concurrent -= 1;
          if (failNext) {
            failNext = false;
            throw new Error('Autosave disk error');
          }
          savedNames.push(doc.name);
        }
      });

      const a1 = createEmptyCADDocument('A1');
      const a2 = createEmptyCADDocument('A2');
      autosave.schedule(a1);
      await new Promise(resolve => setTimeout(resolve, 20)); // A1 save is now in-flight
      autosave.schedule(a2);
      await autosave.flush();
      assert.equal(maxConcurrent, 1);
      assert.deepEqual(savedNames, ['A1', 'A2']);

      failNext = true;
      autosave.schedule(createEmptyCADDocument('A3'));
      await assert.rejects(() => autosave.flush(), /Autosave disk error/);
      assert.equal(errors.length, 1);
    } finally {
      await repo.deleteDocument(docId);
    }
  });

  await runTest('P1.3 Real DWG Verification: decodes sample_ac1032_xref.dwg (AC1032) via LibreDWG WASM with XData, HANDSEED & reconciled accounting', async () => {
    const dwgPath = path.resolve(process.cwd(), 'src/cad/tests/fixtures/dwg/sample_ac1032_xref.dwg');
    const fileBuf = await fs.readFile(dwgPath);
    const arrayBuffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);

    const { document: doc, report } = await decodeDwgBufferWithLibreDwg(arrayBuffer, {
      fileName: 'sample_ac1032_xref.dwg',
      fileSizeBytes: fileBuf.byteLength
    });

    assert.equal(report.ok, true);
    assert.equal(doc.header.$ACADVER, 'AC1032');
    assert.ok(doc.metadata.acadVersion.includes('AC1032'));
    assert.ok(doc.header.$HANDSEED && parseInt(doc.header.$HANDSEED, 16) > 0);
    assert.ok(doc.nextHandleSeed >= parseInt(doc.header.$HANDSEED!, 16));

    assert.ok(Object.keys(doc.layers).length >= 180);
    assert.ok(Object.keys(doc.blocks).length >= 1500);
    assert.ok(doc.entities.length >= 5000);
    assert.ok(doc.entities.some(e => e.type === 'DIMENSION'));
    assert.ok(doc.entities.some(e => e.type === 'TEXT' || e.type === 'MTEXT'));

    // XData preservation on real AC1032 DWG entities
    const xdataEntities = doc.entities.filter(e => Array.isArray(e.xdata) && e.xdata.length > 0);
    assert.ok(
      xdataEntities.length > 4000,
      `Expected > 4000 entities with preserved xdata in real AC1032 DWG, got ${xdataEntities.length}`
    );

    // 5-bucket & unknownType reconciliation
    const unknownTypeSum = Object.values(report.unknownEntityTypes).reduce((s, n) => s + n, 0);
    assert.equal(unknownTypeSum, report.unknownCount);
    assert.equal(
      report.readableCount,
      report.editableCount + report.readonlyCount + report.unknownCount
    );
    assert.equal(report.unsupportedCount, report.unknownCount + report.dwgUnsupportedCount);
    assert.equal(
      report.totalEncounteredCount,
      report.readableCount + report.dwgUnsupportedCount + report.skippedCount
    );

    // Corrupt DWG fails cleanly without crashing WASM runtime
    const corrupt = new TextEncoder().encode('NOT_A_REAL_DWG_BINARY_PAYLOAD_1234567890');
    await assert.rejects(
      () => decodeDwgBufferWithLibreDwg(corrupt.buffer, { fileName: 'corrupt.dwg' }),
      /LibreDWG|DWG/i
    );
  });

  await runTest('P1.4 Per-format Memory Control: enforces 250 MB ASCII DXF, 64 MB Binary DXF, 64 MB DWG WASM & 150 MB HTTP Bridge before full buffer read', async () => {
    assert.equal(CAD_FORMAT_MEMORY_POLICIES['dxf-ascii'].hardMaxBytes, 250 * 1024 * 1024);
    assert.equal(CAD_FORMAT_MEMORY_POLICIES['dxf-binary'].hardMaxBytes, 64 * 1024 * 1024);
    assert.equal(CAD_FORMAT_MEMORY_POLICIES['dwg-wasm'].hardMaxBytes, 64 * 1024 * 1024);
    assert.equal(CAD_FORMAT_MEMORY_POLICIES['dwg-http-bridge'].hardMaxBytes, 150 * 1024 * 1024);

    assert.equal(validateCadFilePayload('plan.dxf', 260 * 1024 * 1024, 'dxf-ascii').ok, false);
    assert.equal(validateCadFilePayload('plan.dxf', 130 * 1024 * 1024, 'dxf-ascii').ok, true);
    assert.equal(validateCadFilePayload('bin.dxf', 70 * 1024 * 1024, 'dxf-binary').ok, false);
    assert.equal(validateCadFilePayload('site.dwg', 70 * 1024 * 1024, 'dwg-wasm').ok, false);
    assert.equal(validateCadFilePayload('site.dwg', 100 * 1024 * 1024, 'dwg-http-bridge').ok, true);
    assert.equal(validateCadFilePayload('site.dwg', 160 * 1024 * 1024, 'dwg-http-bridge').ok, false);

    // Verify CADImportService rejects 80 MB DWG (wasm) and 80 MB Binary DXF using only 64-byte slice without calling file.arrayBuffer()
    const svc = new CADImportService();
    const makeTrapFile = (name: string, fakeSize: number, headBytes: Uint8Array): File => {
      return {
        name,
        size: fakeSize,
        slice: (start = 0, end = 64) => ({
          arrayBuffer: async () =>
            headBytes.slice(start, Math.min(headBytes.length, end)).buffer
        }),
        arrayBuffer: async () => {
          throw new Error('BUG: full file.arrayBuffer() should NOT be read when format cap is exceeded!');
        }
      } as unknown as File;
    };

    const dwgHead = new TextEncoder().encode('AC1032\0\0\0\0\0\0\0\0\0\0');
    await assert.rejects(
      () => svc.importFile(makeTrapFile('huge.dwg', 80 * 1024 * 1024, dwgHead)),
      /64 MB/
    );

    const binDxfHead = new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\0');
    await assert.rejects(
      () => svc.importFile(makeTrapFile('huge_bin.dxf', 80 * 1024 * 1024, binDxfHead)),
      /64 MB/
    );
  });

  await runTest('P1.5 5-Bucket Entity Accounting: separates readable, editable, readonly, unsupported & skipped accurately', () => {
    const mixedDxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      // 2 editable
      '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '0',
      '0', 'CIRCLE', '8', '0', '10', '50', '20', '50', '40', '20',
      // 1 readonly (SOLID) + 1 filtered HATCH
      '0', 'SOLID', '8', '0', '10', '0', '20', '0', '11', '10', '21', '0', '12', '10', '22', '10', '13', '0', '23', '10',
      '0', 'HATCH', '8', '0', '2', 'SOLID', '70', '1', '91', '0',
      // 2 unsupported preserved UNKNOWN
      '0', '3DSOLID', '8', '0', '1', 'STUB1',
      '0', 'REGION', '8', '0', '1', 'STUB2',
      '0', 'ENDSEC',
      '0', 'EOF'
    ].join('\n');

    const { report } = importDxfContent(mixedDxf, {
      fileName: 'accounting_test.dxf',
      filterOptions: { skipHatch: true }
    });

    assert.equal(report.editableCount, 2);
    assert.equal(report.supportedCount, 2);
    assert.equal(report.readonlyCount, 1);
    assert.equal(report.unknownCount, 2);
    assert.equal(report.dwgUnsupportedCount, 0);
    assert.equal(report.unsupportedCount, 2);
    assert.equal(report.readableCount, 5);
    assert.equal(report.skippedCount, 1);
    assert.equal(report.skippedTypes['HATCH'], 1);
    assert.equal(report.totalEncounteredCount, 6);
  });
}

runStandaloneSuite(import.meta.url, runCadBatch1Tests);
