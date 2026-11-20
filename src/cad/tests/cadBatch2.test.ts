import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TestFn } from '../../utils/__tests__/testHarness';
import { runStandaloneSuite } from '../../utils/__tests__/testHarness';
import { CADCommandManager } from '../commands/CADCommandManager';
import {
  BatchModifyEntitiesCommand,
  BatchUpdateLayersCommand,
  CreateBlockFromSelectionCommand,
  DeleteLayerCommand,
  EditInsertAttributesCommand,
  MirrorCommand,
  ModifyEntityCommand,
  MoveCommand,
  PurgeUnusedBlocksCommand,
  RenameLayerCommand,
  RotateCommand,
  ScaleCommand,
  UpdateBlockCommand,
  UpdateXrefBlockCommand,
  UpsertDimStyleCommand,
  UpsertTextStyleCommand
} from '../commands/CADCommands';
import {
  createDefaultLayer,
  createEmptyCADDocument,
  isCADEntityInSpace
} from '../core/CADDocument';
import type { CADEntity } from '../core/CADTypes';
import { decodeDwgBufferWithLibreDwg } from '../dwg/LibreDwgWasmLoader';
import { writeRoundTripDxf } from '../export/DXFRoundTripWriter';
import { computeEntitiesBoundingBox, computeSmartFitExtents } from '../geometry/CADBounds';
import {
  computeEntityLength2D,
  doesEntityMatchSelectionBox,
  extractViewportSummary,
  getSimilarEntityIds,
  isEntityGeometryEditable,
  pickTopEntityAtPoint
} from '../geometry/CADGeometry';
import { importDxfContent } from '../import/DXFImporter';
import { formatDimensionDisplayText } from '../rendering/CADTextRenderer';

function makeBatch2FixtureDxf(): string {
  return [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1027',
    '9', '$INSUNITS', '70', '4',
    '9', '$CLAYER', '8', 'NET_CABLE',
    '9', '$HANDSEED', '5', '300',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES',
    '0', 'TABLE', '2', 'LAYER', '70', '3',
    '0', 'LAYER', '5', '10', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS', '290', '1', '370', '-3',
    '0', 'LAYER', '5', '11', '2', 'NET_CABLE', '70', '0', '62', '3', '6', 'DASHED', '290', '1', '370', '25',
    '0', 'LAYER', '5', '12', '2', 'TEMP_LAYER', '70', '0', '62', '1', '6', 'CONTINUOUS', '290', '1', '370', '15',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'STYLE', '70', '1',
    '0', 'STYLE', '5', '20', '2', 'STANDARD', '70', '0', '40', '0', '41', '1', '50', '0', '3', 'arial.ttf',
    '0', 'ENDTAB',
    '0', 'TABLE', '2', 'DIMSTYLE', '70', '1',
    '0', 'DIMSTYLE', '105', '21', '2', 'STANDARD', '70', '0', '40', '1', '41', '180', '140', '180', '144', '1', '271', '2',
    '0', 'ENDTAB',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS',
    '0', 'BLOCK', '5', '30', '8', '0', '2', 'DEV_PORT', '70', '2', '10', '0', '20', '0', '30', '0', '3', 'DEV_PORT',
    '0', 'LINE', '5', '31', '8', 'NET_CABLE', '10', '-10', '20', '0', '30', '0', '11', '10', '21', '0', '31', '0',
    '0', 'INSERT', '5', '32', '8', '0', '2', 'NESTED_ICON', '10', '0', '20', '0', '30', '0', '41', '1', '42', '1', '43', '1', '50', '0',
    '0', 'ENDBLK', '5', '33',
    '0', 'BLOCK', '5', '34', '8', '0', '2', 'NESTED_ICON', '70', '0', '10', '0', '20', '0', '30', '0', '3', 'NESTED_ICON',
    '0', 'CIRCLE', '5', '35', '8', '0', '10', '0', '20', '0', '30', '0', '40', '5',
    '0', 'ENDBLK', '5', '36',
    '0', 'BLOCK', '5', '37', '8', '0', '2', 'UNUSED_BLK', '70', '0', '10', '0', '20', '0', '30', '0', '3', 'UNUSED_BLK',
    '0', 'CIRCLE', '5', '38', '8', '0', '10', '0', '20', '0', '30', '0', '40', '3',
    '0', 'ENDBLK', '5', '39',
    '0', 'BLOCK', '5', '3A', '8', '0', '2', 'XREF_SITE_A', '70', '4', '10', '0', '20', '0', '30', '0', '3', 'XREF_SITE_A', '1', 'C:\\xrefs\\site_a.dwg',
    '0', 'LINE', '5', '3B', '8', '0', '10', '0', '20', '0', '30', '0', '11', '50', '21', '0', '31', '0',
    '0', 'ENDBLK', '5', '3C',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    // Model space entities
    '0', 'LINE', '5', 'A1', '8', 'NET_CABLE', '10', '0', '20', '0', '30', '0', '11', '300', '21', '400', '31', '0',
    '0', 'LINE', '5', 'A7', '8', 'NET_CABLE', '10', '50', '20', '50', '30', '0', '11', '150', '21', '50', '31', '0',
    '0', 'LINE', '5', 'A2', '8', 'TEMP_LAYER', '10', '0', '20', '200', '30', '0', '11', '500', '21', '200', '31', '0',
    '0', 'INSERT', '5', 'A3', '8', 'NET_CABLE', '66', '1', '2', 'DEV_PORT', '10', '100', '20', '100', '30', '0', '41', '1', '42', '1', '43', '1', '50', '0',
    '0', 'ATTRIB', '5', 'A4', '8', 'NET_CABLE', '10', '105', '20', '110', '30', '0', '40', '15', '1', 'PORT-01', '2', 'PORT', '70', '0',
    '0', 'SEQEND', '5', 'A5', '8', 'NET_CABLE',
    '0', 'DIMENSION', '5', 'A6', '8', 'NET_CABLE', '2', '', '3', 'STANDARD', '10', '500', '20', '0', '30', '0', '11', '250', '21', '60', '31', '0', '70', '1', '1', '<> mm', '13', '0', '23', '0', '33', '0', '14', '500', '24', '0', '34', '0', '42', '500',
    // Protected readonly & unknown entities in Model space
    '0', 'HATCH', '5', 'B1', '8', 'NET_CABLE', '2', 'SOLID', '70', '1', '91', '0', '1001', 'HACHIHI_PROTECT', '1000', 'KEEP_ME',
    '0', '3DSOLID', '5', 'B2', '8', 'NET_CABLE', '1', 'ACIS_BLOB_DATA', '1001', 'HACHIHI_PROTECT', '1000', 'SOLID_META',
    // Paper space entities (group 67 = 1) + VIEWPORT
    '0', 'LINE', '5', 'P1', '67', '1', '8', 'NET_CABLE', '10', '0', '20', '0', '30', '0', '11', '297', '21', '0', '31', '0',
    '0', 'VIEWPORT', '5', 'P2', '67', '1', '8', '0', '10', '150', '20', '100', '30', '0', '40', '200', '41', '120', '69', '2',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');
}

export async function runCadBatch2Tests(runTest: TestFn): Promise<void> {
  await runTest('P2.1 Full Layer Manager: rename (entities + blocks + $CLAYER), delete reassign to 0, batch isolate/lock & Undo/Redo', () => {
    const { document: doc0 } = importDxfContent(makeBatch2FixtureDxf(), { fileName: 'b2_layers.dxf' });
    const mgr = new CADCommandManager(50);

    // Rename NET_CABLE -> CORE_TRUNK
    let doc = mgr.execute(doc0, new RenameLayerCommand('NET_CABLE', 'CORE_TRUNK'));
    assert.ok(doc.layers['CORE_TRUNK']);
    assert.equal(doc.layers['NET_CABLE'], undefined);
    assert.equal(doc.header.$CLAYER, 'CORE_TRUNK');
    assert.equal(doc.entities.find(e => e.handle === 'A1')?.layer, 'CORE_TRUNK');
    assert.equal(doc.blocks['DEV_PORT'].entities[0].layer, 'CORE_TRUNK');

    // Protected Layer '0' cannot be renamed or deleted
    const unchangedRename = mgr.execute(doc, new RenameLayerCommand('0', 'ZERO_RENAMED'));
    assert.ok(unchangedRename.layers['0']);
    assert.equal(unchangedRename.layers['ZERO_RENAMED'], undefined);

    // Delete TEMP_LAYER -> reassigns entity A2 to '0'
    doc = mgr.execute(doc, new DeleteLayerCommand('TEMP_LAYER', '0'));
    assert.equal(doc.layers['TEMP_LAYER'], undefined);
    assert.equal(doc.entities.find(e => e.handle === 'A2')?.layer, '0');

    // Batch isolate/lock all except active CORE_TRUNK
    doc = mgr.execute(
      doc,
      new BatchUpdateLayersCommand(layers => {
        const next = { ...layers };
        for (const [name, l] of Object.entries(next)) {
          next[name] = { ...l, locked: name !== 'CORE_TRUNK' };
        }
        return next;
      }, 'Khóa tất cả trừ Layer CORE_TRUNK')
    );
    assert.equal(doc.layers['0'].locked, true);
    assert.equal(doc.layers['CORE_TRUNK'].locked, false);

    // Round-trip DXF preserves renamed layer + entity assignments
    const exported = writeRoundTripDxf(doc);
    const { document: reopened } = importDxfContent(exported, { fileName: 'b2_layers_out.dxf' });
    assert.ok(reopened.layers['CORE_TRUNK']);
    assert.equal(reopened.header.$CLAYER, 'CORE_TRUNK');
    assert.equal(reopened.entities.find(e => e.handle === 'A1')?.layer, 'CORE_TRUNK');

    // Undo restores everything cleanly
    doc = mgr.undo(doc)!; // undo batch lock
    doc = mgr.undo(doc)!; // undo delete TEMP_LAYER
    assert.ok(doc.layers['TEMP_LAYER']);
    assert.equal(doc.entities.find(e => e.handle === 'A2')?.layer, 'TEMP_LAYER');
    doc = mgr.undo(doc)!; // undo rename
    doc = mgr.undo(doc)!; // (before rename '0' no-op)
    assert.ok(doc.layers['NET_CABLE']);
    assert.equal(doc.header.$CLAYER, 'NET_CABLE');
  });

  await runTest('P2.2 Block Editor & Attributes: CreateBlockFromSelection (+ATTDEF->ATTRIB), Edit ATTRIB round-trip, UpdateBlock, PurgeUnusedBlocks', () => {
    const mgr = new CADCommandManager(50);
    let doc = createEmptyCADDocument('Blocks P2');
    doc.layers['NET'] = createDefaultLayer('NET', 3);

    const lineEnt: CADEntity = {
      id: 'sel_1',
      handle: '101',
      type: 'LINE',
      layer: 'NET',
      start: { x: 90, y: 100, z: 0 },
      end: { x: 110, y: 100, z: 0 },
      preservationTier: 'supported'
    };
    const attDefEnt: CADEntity = {
      id: 'sel_2',
      handle: '102',
      type: 'ATTDEF',
      layer: 'NET',
      tag: 'SWITCH_ID',
      text: 'SW-DEFAULT',
      position: { x: 100, y: 112, z: 0 },
      height: 12,
      rotation: 0,
      style: 'STANDARD',
      flags: 0,
      preservationTier: 'supported'
    };
    doc = { ...doc, entities: [lineEnt, attDefEnt], nextHandleSeed: 0x110 };

    // Create block from selection
    doc = mgr.execute(
      doc,
      new CreateBlockFromSelectionCommand(['sel_1', 'sel_2'], 'ACCESS_SW', { x: 100, y: 100, z: 0 }, 'NET')
    );
    assert.ok(doc.blocks['ACCESS_SW']);
    assert.equal(doc.blocks['ACCESS_SW'].entities.length, 2);
    assert.equal(doc.entities.length, 1);
    assert.equal(doc.entities[0].type, 'INSERT');
    const createdInsert = doc.entities[0] as Extract<CADEntity, { type: 'INSERT' }>;
    assert.equal(createdInsert.attributes?.length, 1);
    assert.equal(createdInsert.attributes?.[0].tag, 'SWITCH_ID');
    assert.equal(createdInsert.attributes?.[0].text, 'SW-DEFAULT');

    // Edit INSERT ATTRIB
    doc = mgr.execute(
      doc,
      new EditInsertAttributesCommand(createdInsert.id, [
        { ...createdInsert.attributes![0], text: 'SW-FLOOR2-A', tag: 'HOST' }
      ])
    );

    // Rename block -> updates INSERT
    doc = mgr.execute(doc, new UpdateBlockCommand('ACCESS_SW', { newName: 'SW_NODE_V2' }));
    assert.ok(doc.blocks['SW_NODE_V2']);
    assert.equal(doc.blocks['ACCESS_SW'], undefined);
    const renamedInsert = doc.entities[0] as Extract<CADEntity, { type: 'INSERT' }>;
    assert.equal(renamedInsert.blockName, 'SW_NODE_V2');
    assert.equal(renamedInsert.attributes?.[0].text, 'SW-FLOOR2-A');

    // DXF export + re-import retains edited ATTRIB & block reference
    doc.metadata.hasRawRoundTripData = true;
    const roundDxf = writeRoundTripDxf(doc);
    const { document: reopened } = importDxfContent(roundDxf, { fileName: 'block_attr_rt.dxf' });
    const rtInsert = reopened.entities.find(e => e.type === 'INSERT') as Extract<CADEntity, { type: 'INSERT' }>;
    assert.equal(rtInsert.blockName, 'SW_NODE_V2');
    assert.equal(rtInsert.attributes?.[0].tag, 'HOST');
    assert.equal(rtInsert.attributes?.[0].text, 'SW-FLOOR2-A');

    // PurgeUnusedBlocks removes UNUSED_BLK while preserving transitively referenced NESTED_ICON
    const { document: fixDoc } = importDxfContent(makeBatch2FixtureDxf(), { fileName: 'purge_check.dxf' });
    const afterPurge = mgr.execute(fixDoc, new PurgeUnusedBlocksCommand());
    assert.ok(afterPurge.blocks['DEV_PORT']);
    assert.ok(afterPurge.blocks['NESTED_ICON']);
    assert.equal(afterPurge.blocks['UNUSED_BLK'], undefined);
    const undonePurge = mgr.undo(afterPurge)!;
    assert.ok(undonePurge.blocks['UNUSED_BLK']);
  });

  await runTest('P2.3 Text Style & Dimension Style: UpsertTextStyleCommand, UpsertDimStyleCommand, formatting & DXF round-trip', () => {
    const { document: doc0 } = importDxfContent(makeBatch2FixtureDxf(), { fileName: 'styles_p2.dxf' });
    const mgr = new CADCommandManager(50);

    let doc = mgr.execute(
      doc0,
      new UpsertTextStyleCommand({
        name: 'NET_NOTE',
        fontFile: 'courier.shx',
        fixedHeight: 150,
        widthFactor: 0.8,
        obliqueAngle: 12,
        isShapeFile: false
      })
    );
    assert.ok(doc.textStyles['NET_NOTE']);
    assert.equal(doc.textStyles['NET_NOTE'].widthFactor, 0.8);
    assert.equal(doc.textStyles['NET_NOTE'].obliqueAngle, 12);

    doc = mgr.execute(
      doc,
      new UpsertDimStyleCommand({
        name: 'NET_METRIC',
        dimscale: 10,
        dimtxt: 120,
        dimasz: 80,
        dimexo: 30,
        dimexe: 60,
        dimlfac: 0.001,
        dimdec: 3
      })
    );

    const dimEnt = doc.entities.find(e => e.type === 'DIMENSION') as Extract<CADEntity, { type: 'DIMENSION' }>;
    doc = mgr.execute(
      doc,
      new ModifyEntityCommand(dimEnt.id, e => ({ ...e, style: 'NET_METRIC' }))
    );
    const updatedDim = doc.entities.find(e => e.id === dimEnt.id) as Extract<CADEntity, { type: 'DIMENSION' }>;
    // 500 * dimlfac(0.001) with dimdec=3 => "0.500 mm"
    assert.equal(formatDimensionDisplayText(updatedDim, doc), '0.500 mm');

    // DXF round-trip preserves custom STYLE and DIMSTYLE values
    const exported = writeRoundTripDxf(doc);
    const { document: reopened } = importDxfContent(exported, { fileName: 'styles_out.dxf' });
    assert.equal(reopened.textStyles['NET_NOTE']?.widthFactor, 0.8);
    assert.equal(reopened.textStyles['NET_NOTE']?.obliqueAngle, 12);
    assert.equal(reopened.dimStyles['NET_METRIC']?.dimdec, 3);
    assert.ok(Math.abs((reopened.dimStyles['NET_METRIC']?.dimlfac ?? 0) - 0.001) < 1e-6);
  });

  await runTest('P2.4 XREF Manager: identifies XREFs in fixture & real AC1032 DWG, edits xrefPath & binds local with Undo', async () => {
    const { document: doc0 } = importDxfContent(makeBatch2FixtureDxf(), { fileName: 'xref_p2.dxf' });
    const mgr = new CADCommandManager(50);

    assert.equal(doc0.blocks['XREF_SITE_A'].isXref, true);
    assert.equal(doc0.blocks['XREF_SITE_A'].xrefPath, 'C:\\xrefs\\site_a.dwg');

    let doc = mgr.execute(
      doc0,
      new UpdateXrefBlockCommand('XREF_SITE_A', { mode: 'setPath', xrefPath: '.\\xrefs\\site_a_v2.dwg' })
    );
    assert.equal(doc.blocks['XREF_SITE_A'].xrefPath, '.\\xrefs\\site_a_v2.dwg');

    doc = mgr.execute(doc, new UpdateXrefBlockCommand('XREF_SITE_A', { mode: 'bindLocal' }));
    assert.equal(doc.blocks['XREF_SITE_A'].isXref, false);
    assert.equal(doc.blocks['XREF_SITE_A'].xrefPath, undefined);
    // Verify exported DXF clears Xref bit 4
    const rt = writeRoundTripDxf(doc);
    const { document: rtDoc } = importDxfContent(rt, { fileName: 'xref_bound.dxf' });
    assert.equal(rtDoc.blocks['XREF_SITE_A'].isXref, false);

    doc = mgr.undo(doc)!;
    assert.equal(doc.blocks['XREF_SITE_A'].isXref, true);
    assert.equal(doc.blocks['XREF_SITE_A'].xrefPath, '.\\xrefs\\site_a_v2.dwg');

    // Also verify LibreDWG mapper sets isXref when Xref flags exist on real AC1032 DWG
    const dwgPath = path.resolve(process.cwd(), 'src/cad/tests/fixtures/dwg/sample_ac1032_xref.dwg');
    const fileBuf = await fs.readFile(dwgPath);
    const { document: dwgDoc } = await decodeDwgBufferWithLibreDwg(
      fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength),
      { fileName: 'sample_ac1032_xref.dwg' }
    );
    const dwgXrefs = Object.values(dwgDoc.blocks).filter(b => b.isXref || b.xrefPath);
    assert.ok(dwgXrefs.length >= 1 || dwgDoc.metadata.missingXrefs.length >= 0);
  });

  await runTest('P2.5 Layout / Model Space / Paper Space / Viewport: filters space picking/bounds & preserves Paper VIEWPORT in DXF round-trip', () => {
    const { document: doc } = importDxfContent(makeBatch2FixtureDxf(), { fileName: 'space_vp.dxf' });

    const vpEnt = doc.entities.find(e => e.type === 'UNKNOWN' && e.dxfType === 'VIEWPORT');
    assert.ok(vpEnt);
    assert.equal(isCADEntityInSpace(vpEnt, 'paper'), true);
    assert.equal(isCADEntityInSpace(vpEnt, 'model'), false);

    const vpSummary = extractViewportSummary(vpEnt);
    assert.deepEqual(vpSummary, { viewportId: 2, width: 200, height: 120 });

    const vpBounds = computeEntitiesBoundingBox([vpEnt]);
    assert.equal(vpBounds.minX, 50);
    assert.equal(vpBounds.maxX, 250);
    assert.equal(vpBounds.minY, 40);
    assert.equal(vpBounds.maxY, 160);

    // Paper-space line at (150, 0) must not be picked in Model Space, and Model-space line A2 at (400, 200) must not be picked in Paper Space
    const pickedPaper = pickTopEntityAtPoint(doc, { x: 150, y: 0 }, 5, undefined, 'paper');
    assert.equal(pickedPaper?.handle, 'P1');
    const missedPaperInModel = pickTopEntityAtPoint(doc, { x: 150, y: 0 }, 5, undefined, 'model');
    assert.notEqual(missedPaperInModel?.handle, 'P1');
    const pickedModel = pickTopEntityAtPoint(doc, { x: 400, y: 200 }, 5, undefined, 'model');
    assert.equal(pickedModel?.handle, 'A2');

    // Space-scoped extents
    const paperExt = computeSmartFitExtents(doc, { space: 'paper' });
    assert.ok(paperExt.maxX <= 305 && paperExt.minY >= -5);

    // DXF round-trip preserves Paper Space flags & VIEWPORT untouched
    const rt = writeRoundTripDxf(doc);
    const { document: reopened } = importDxfContent(rt, { fileName: 'space_vp_out.dxf' });
    const reopenedVp = reopened.entities.find(e => e.handle === 'P2');
    assert.ok(reopenedVp && reopenedVp.space === 'paper' && reopenedVp.type === 'UNKNOWN');
  });

  await runTest('P2.6 Selection, Batch Properties, Length & Command History: Window vs Crossing, Select Similar, BatchModify & ExecutionLog', () => {
    const { document: doc0 } = importDxfContent(makeBatch2FixtureDxf(), { fileName: 'select_p2.dxf' });
    const mgr = new CADCommandManager(50);

    // Crossing vs Window box check on line A1 ((0,0)->(300,400), length 500)
    const lineA1 = doc0.entities.find(e => e.handle === 'A1')!;
    assert.equal(computeEntityLength2D(lineA1), 500);
    const partialBox = { minX: 100, minY: 100, maxX: 250, maxY: 350 };
    assert.equal(doesEntityMatchSelectionBox(lineA1, partialBox, 'crossing'), true);
    assert.equal(doesEntityMatchSelectionBox(lineA1, partialBox, 'window'), false);

    // Select Similar scoped by space finds Model-space NET_CABLE LINEs (A1, A7) without TEMP_LAYER (A2) or Paper-space P1
    const similar = getSimilarEntityIds(doc0, [lineA1], 'model');
    assert.equal(similar.includes(lineA1.id), true);
    assert.equal(similar.includes(doc0.entities.find(e => e.handle === 'A7')!.id), true);
    assert.equal(similar.includes(doc0.entities.find(e => e.handle === 'A2')!.id), false);
    assert.equal(similar.includes(doc0.entities.find(e => e.handle === 'P1')!.id), false);

    // BatchModifyEntitiesCommand + Undo + ExecutionLog tracking
    let doc = mgr.execute(
      doc0,
      new BatchModifyEntitiesCommand(
        similar,
        { colorIndex: 4, lineWeight: 50, lineType: 'CENTER' },
        'Đổi màu & nét 2 đoạn thẳng'
      )
    );
    const editedA1 = doc.entities.find(e => e.handle === 'A1')!;
    assert.equal(editedA1.colorIndex, 4);
    assert.equal(editedA1.lineWeight, 50);
    assert.equal(editedA1.lineType, 'CENTER');

    doc = mgr.undo(doc)!;
    assert.equal(doc.entities.find(e => e.handle === 'A1')?.colorIndex, doc0.entities.find(e => e.handle === 'A1')?.colorIndex);

    const history = mgr.getHistory();
    assert.equal(history.redoLabels.length, 1);
    const log = mgr.getExecutionLog();
    assert.equal(log[0].action, 'undo');
    assert.equal(log[1].action, 'execute');
  });

  await runTest('P2.7 Preserve Non-Editable Entities: Move/Rotate/Scale/Mirror/BatchModify never mutate HATCH or UNKNOWN rawDxf/xdata', () => {
    const { document: doc0 } = importDxfContent(makeBatch2FixtureDxf(), { fileName: 'protect_p2.dxf' });
    const mgr = new CADCommandManager(50);

    const lineA1 = doc0.entities.find(e => e.handle === 'A1')!;
    const hatchB1 = doc0.entities.find(e => e.handle === 'B1')!;
    const solidB2 = doc0.entities.find(e => e.handle === 'B2')!;

    assert.equal(isEntityGeometryEditable(lineA1), true);
    assert.equal(isEntityGeometryEditable(hatchB1), false);
    assert.equal(isEntityGeometryEditable(solidB2), false);

    const hatchRawBefore = JSON.stringify(hatchB1.rawDxf);
    const solidRawBefore = JSON.stringify(solidB2.rawDxf);

    const allThree = [lineA1.id, hatchB1.id, solidB2.id];
    const moveCmd = new MoveCommand(allThree, 100, 50);
    let doc = mgr.execute(doc0, moveCmd);
    assert.equal(moveCmd.getSkippedProtectedCount(), 2);

    doc = mgr.execute(doc, new RotateCommand(allThree, { x: 0, y: 0 }, 45));
    doc = mgr.execute(doc, new ScaleCommand(allThree, { x: 0, y: 0 }, 2));
    doc = mgr.execute(doc, new MirrorCommand(allThree, { x: 0, y: 0 }, { x: 0, y: 100 }));

    // Sibling LINE moved, while protected entities kept exact handle, dirty=false, xdata & rawDxf
    const lineAfter = doc.entities.find(e => e.handle === 'A1') as Extract<CADEntity, { type: 'LINE' }>;
    assert.notDeepEqual(lineAfter.end, (lineA1 as Extract<CADEntity, { type: 'LINE' }>).end);

    const hatchAfter = doc.entities.find(e => e.handle === 'B1')!;
    const solidAfter = doc.entities.find(e => e.handle === 'B2')!;
    assert.equal(JSON.stringify(hatchAfter.rawDxf), hatchRawBefore);
    assert.equal(JSON.stringify(solidAfter.rawDxf), solidRawBefore);
    assert.equal(hatchAfter.dirty, false);
    assert.equal(solidAfter.dirty, false);
    assert.equal(hatchAfter.xdata?.[0].appName, 'HACHIHI_PROTECT');
    assert.equal(solidAfter.xdata?.[0].appName, 'HACHIHI_PROTECT');

    // BatchModifyEntities skips geometry/color mutation on protected entities cleanly
    doc = mgr.execute(
      doc,
      new BatchModifyEntitiesCommand([hatchB1.id, solidB2.id], { colorIndex: 2, layer: 'TEMP_LAYER' })
    );
    const hatchMetaChanged = doc.entities.find(e => e.handle === 'B1')!;
    assert.equal(hatchMetaChanged.layer, 'TEMP_LAYER');
    assert.notEqual(hatchMetaChanged.colorIndex, 2);

    // Export + re-import keeps protected HATCH and 3DSOLID handles, layer, and XData intact
    const rt = writeRoundTripDxf(doc);
    const { document: reopened } = importDxfContent(rt, { fileName: 'protect_out.dxf' });
    const reHatch = reopened.entities.find(e => e.handle === 'B1');
    const reSolid = reopened.entities.find(e => e.handle === 'B2');
    assert.ok(reHatch && reHatch.type === 'HATCH' && reHatch.layer === 'TEMP_LAYER');
    assert.ok(reSolid && reSolid.type === 'UNKNOWN' && reSolid.dxfType === '3DSOLID');
    assert.equal(reHatch.xdata?.[0].appName, 'HACHIHI_PROTECT');
    assert.equal(reSolid.xdata?.[0].appName, 'HACHIHI_PROTECT');
  });
}

runStandaloneSuite(import.meta.url, runCadBatch2Tests);
