import type { ProjectState } from '../../types/infrastructure';
import { APP_BUILD_HASH, APP_VERSION } from '../../config/appInfo';
import {
  calculateTrayAwareCableLengthMeters,
  computeCablePath,
  estimateCableLengthMeters,
  type RectBox
} from '../../utils/cableRouting';
import type { CADBlock, CADDocument, CADEntity, RawDxfGroupPair } from '../core/CADTypes';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import { CADHandleAllocator } from '../core/CADRegistry';
import { networkCanvasToCadPoint } from '../core/CADUnderlayTransform';
import {
  formatDxfPairs,
  serializeBlockToPairs,
  serializeDimStyleToPairs,
  serializeEntityToPairs,
  serializeHeaderToPairs,
  serializeLayerToPairs,
  serializeLineTypeToPairs,
  serializeTextStyleToPairs
} from './CADSerializer';
import { writeRoundTripDxf } from './DXFRoundTripWriter';

function buildTablePairs(
  tableName: string,
  records: RawDxfGroupPair[][],
  allocator: CADHandleAllocator,
  includeAcDb: boolean
): RawDxfGroupPair[] {
  const pairs: RawDxfGroupPair[] = [
    { code: 0, value: 'TABLE' },
    { code: 2, value: tableName },
    { code: 5, value: allocator.allocate() }
  ];
  if (includeAcDb) {
    pairs.push({ code: 100, value: 'AcDbSymbolTable' });
  }
  pairs.push({ code: 70, value: records.length });
  for (const rec of records) {
    pairs.push(...rec);
  }
  pairs.push({ code: 0, value: 'ENDTAB' });
  return pairs;
}

/**
 * Emits a clean, self-contained AutoCAD 2000+ (AC1015) ASCII DXF string from the current CADDocument.
 */
export function writeCleanDxf(doc: CADDocument): string {
  const allocator = new CADHandleAllocator(doc);
  const includeAcDb = true;
  const headerWithExtents = {
    ...doc.header,
    $ACADVER: doc.header.$ACADVER || 'AC1015',
    $EXTMIN: { x: doc.extents.minX, y: doc.extents.minY, z: 0 },
    $EXTMAX: { x: doc.extents.maxX, y: doc.extents.maxY, z: 0 }
  };

  // TABLES
  const ltypes = Object.values(doc.lineTypes).map(lt => serializeLineTypeToPairs(lt, allocator, includeAcDb));
  const layers = Object.values(doc.layers).map(l => serializeLayerToPairs(l, allocator, includeAcDb));
  const styles = Object.values(doc.textStyles).map(s => serializeTextStyleToPairs(s, allocator, includeAcDb));
  const dimstyles = Object.values(doc.dimStyles).map(d => serializeDimStyleToPairs(d, allocator, includeAcDb));

  const tablePairs = [
    { code: 0, value: 'SECTION' },
    { code: 2, value: 'TABLES' },
    ...buildTablePairs('LTYPE', ltypes, allocator, includeAcDb),
    ...buildTablePairs('LAYER', layers, allocator, includeAcDb),
    ...buildTablePairs('STYLE', styles, allocator, includeAcDb),
    ...buildTablePairs('DIMSTYLE', dimstyles, allocator, includeAcDb),
    { code: 0, value: 'ENDSEC' }
  ];

  const blockPairs: RawDxfGroupPair[] = [{ code: 0, value: 'SECTION' }, { code: 2, value: 'BLOCKS' }];
  for (const block of Object.values(doc.blocks)) {
    blockPairs.push(...serializeBlockToPairs(block, allocator, { includeAcDb, preferRawIfUntouched: false }));
  }
  blockPairs.push({ code: 0, value: 'ENDSEC' });

  const entityPairs: RawDxfGroupPair[] = [{ code: 0, value: 'SECTION' }, { code: 2, value: 'ENTITIES' }];
  for (const entity of doc.entities) {
    entityPairs.push(...serializeEntityToPairs(entity, allocator, { includeAcDb, preferRawIfUntouched: false }));
  }
  entityPairs.push({ code: 0, value: 'ENDSEC' });

  const pairs: RawDxfGroupPair[] = [
    { code: 999, value: `Exported by HACHIHI AutoCAD Studio v${APP_VERSION} (${APP_BUILD_HASH})` },
    { code: 0, value: 'SECTION' },
    { code: 2, value: 'HEADER' },
    ...serializeHeaderToPairs(headerWithExtents, allocator.getNextSeed()),
    { code: 0, value: 'ENDSEC' },
    ...tablePairs,
    ...blockPairs,
    ...entityPairs,
    { code: 0, value: 'EOF' }
  ];

  return formatDxfPairs(pairs);
}

function buildNetworkSymbolBlock(
  name: string,
  colorIndex: number,
  allocator: CADHandleAllocator
): CADBlock {
  const mkId = (prefix: string) => `${prefix}_${allocator.getNextSeed()}`;
  return {
    id: `blk_${name}`,
    name,
    handle: allocator.allocate(),
    basePoint: { x: 0, y: 0, z: 0 },
    isXref: false,
    entities: [
      {
        id: mkId('blk_rect'),
        handle: allocator.allocate(),
        type: 'LWPOLYLINE',
        layer: '0',
        colorIndex,
        vertices: [
          { x: -0.5, y: -0.5 },
          { x: 0.5, y: -0.5 },
          { x: 0.5, y: 0.5 },
          { x: -0.5, y: 0.5 }
        ],
        closed: true,
        elevation: 0,
        preservationTier: 'supported',
        dirty: true
      },
      {
        id: mkId('blk_diag1'),
        handle: allocator.allocate(),
        type: 'LINE',
        layer: '0',
        colorIndex,
        start: { x: -0.5, y: -0.5, z: 0 },
        end: { x: 0.5, y: 0.5, z: 0 },
        preservationTier: 'supported',
        dirty: true
      },
      {
        id: mkId('blk_att_tag'),
        handle: allocator.allocate(),
        type: 'ATTDEF',
        layer: '0',
        colorIndex: 7,
        position: { x: -0.5, y: 0.6, z: 0 },
        height: 0.16,
        rotation: 0,
        style: 'STANDARD',
        tag: 'TAG',
        prompt: 'Device Tag',
        text: 'DEV-01',
        flags: 0,
        preservationTier: 'supported',
        dirty: true
      },
      {
        id: mkId('blk_att_model'),
        handle: allocator.allocate(),
        type: 'ATTDEF',
        layer: '0',
        colorIndex: 8,
        position: { x: -0.5, y: -0.75, z: 0 },
        height: 0.13,
        rotation: 0,
        style: 'STANDARD',
        tag: 'MODEL',
        prompt: 'Device Model',
        text: 'HACHIHI',
        flags: 0,
        preservationTier: 'supported',
        dirty: true
      },
      {
        id: mkId('blk_att_ip'),
        handle: allocator.allocate(),
        type: 'ATTDEF',
        layer: '0',
        colorIndex: 3,
        position: { x: -0.5, y: -0.95, z: 0 },
        height: 0.13,
        rotation: 0,
        style: 'STANDARD',
        tag: 'IP',
        prompt: 'IP Address',
        text: '',
        flags: 0,
        preservationTier: 'supported',
        dirty: true
      }
    ]
  };
}

/**
 * Projects HACHIHI Network Topology (Rooms, Racks, Devices, Cables, Labels) into the exact CAD World
 * coordinate system defined by `cadDoc.underlay`, creating dedicated `HACHIHI_*` CAD layers,
 * structured `HACHIHI_DEV_SYM` / `HACHIHI_RACK_SYM` blocks with `ATTRIB` tags, and XDATA-tagged
 * cables alongside 100% of original CAD floorplan entities.
 */
export function writeCombinedCadAndNetworkDxf(
  cadDoc: CADDocument,
  project: ProjectState,
  options?: { floorScope?: string }
): string {
  const allocator = new CADHandleAllocator(cadDoc);
  const scale = cadDoc.underlay.scaleToCanvasPx || 0.05;
  const textHeight = Math.max(8 / scale, 0.05);
  const netRotation = -(cadDoc.underlay.rotationDeg || 0);
  const projectScalePxPerM = normalizeScalePxPerMeter(project.settings?.scale);

  const rawScope = options?.floorScope ?? project.activeFloorId ?? 'all';
  const targetFloorId =
    rawScope === 'all' || rawScope === '__ALL__'
      ? null
      : rawScope === 'active'
        ? project.activeFloorId
        : rawScope;

  const roomFloorMap = new Map((project.rooms || []).map(r => [r.id, r.floorId]));
  const getNodeFloorId = (n: (typeof project.nodes)[number]) => {
    const assetRoomId = n.assetId ? project.assets?.[n.assetId]?.roomId : undefined;
    return n.floorId || (assetRoomId ? roomFloorMap.get(assetRoomId) : undefined) || project.activeFloorId;
  };

  const rooms = targetFloorId ? project.rooms.filter(r => r.floorId === targetFloorId) : project.rooms;
  const nodes = (project.nodes || []).filter(n => !n.hidden && (!targetFloorId || getNodeFloorId(n) === targetFloorId));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const cables = (project.cables || []).filter(c => nodeMap.has(c.sourceNodeId) && nodeMap.has(c.targetNodeId));
  const allTrays = project.cableTrays || [];

  const networkLayers = {
    HACHIHI_ROOMS: { id: 'layer_HACHIHI_ROOMS', name: 'HACHIHI_ROOMS', colorIndex: 8, lineType: 'DASHED', lineWeight: 25, visible: true, frozen: false, locked: false, plottable: true },
    HACHIHI_RACKS: { id: 'layer_HACHIHI_RACKS', name: 'HACHIHI_RACKS', colorIndex: 4, lineType: 'CONTINUOUS', lineWeight: 35, visible: true, frozen: false, locked: false, plottable: true },
    HACHIHI_DEVICES: { id: 'layer_HACHIHI_DEVICES', name: 'HACHIHI_DEVICES', colorIndex: 5, lineType: 'CONTINUOUS', lineWeight: 30, visible: true, frozen: false, locked: false, plottable: true },
    HACHIHI_CABLES: { id: 'layer_HACHIHI_CABLES', name: 'HACHIHI_CABLES', colorIndex: 3, lineType: 'CONTINUOUS', lineWeight: 25, visible: true, frozen: false, locked: false, plottable: true },
    HACHIHI_LABELS: { id: 'layer_HACHIHI_LABELS', name: 'HACHIHI_LABELS', colorIndex: 2, lineType: 'CONTINUOUS', lineWeight: 18, visible: true, frozen: false, locked: false, plottable: true }
  };

  const mergedBlocks: Record<string, CADBlock> = { ...cadDoc.blocks };
  if (!mergedBlocks.HACHIHI_DEV_SYM) {
    mergedBlocks.HACHIHI_DEV_SYM = buildNetworkSymbolBlock('HACHIHI_DEV_SYM', 5, allocator);
  }
  if (!mergedBlocks.HACHIHI_RACK_SYM) {
    mergedBlocks.HACHIHI_RACK_SYM = buildNetworkSymbolBlock('HACHIHI_RACK_SYM', 4, allocator);
  }

  const mergedDoc: CADDocument = {
    ...cadDoc,
    layers: { ...cadDoc.layers, ...networkLayers },
    blocks: mergedBlocks,
    entities: [...cadDoc.entities]
  };

  const pushPolylineRect = (layer: string, x: number, y: number, w: number, h: number, colorIndex: number) => {
    const corners = [
      networkCanvasToCadPoint({ x, y }, cadDoc.underlay),
      networkCanvasToCadPoint({ x: x + w, y }, cadDoc.underlay),
      networkCanvasToCadPoint({ x: x + w, y: y + h }, cadDoc.underlay),
      networkCanvasToCadPoint({ x, y: y + h }, cadDoc.underlay)
    ];
    const ent: CADEntity = {
      id: `net_poly_${allocator.getNextSeed()}`,
      handle: allocator.allocate(),
      type: 'LWPOLYLINE',
      layer,
      colorIndex,
      vertices: corners.map(c => ({ x: c.x, y: c.y })),
      closed: true,
      elevation: 0,
      preservationTier: 'supported',
      dirty: true
    };
    mergedDoc.entities.push(ent);
  };

  const pushLabel = (x: number, y: number, text: string, colorIndex: number, sizeScale = 1) => {
    if (!text.trim()) return;
    const p = networkCanvasToCadPoint({ x, y }, cadDoc.underlay);
    mergedDoc.entities.push({
      id: `net_txt_${allocator.getNextSeed()}`,
      handle: allocator.allocate(),
      type: 'TEXT',
      layer: 'HACHIHI_LABELS',
      colorIndex,
      position: { x: p.x, y: p.y, z: 0 },
      height: textHeight * sizeScale,
      rotation: netRotation,
      text: text.replace(/[\r\n]+/g, ' ').slice(0, 120),
      style: 'STANDARD',
      hAlign: 0,
      vAlign: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      preservationTier: 'supported',
      dirty: true
    });
  };

  for (const room of rooms) {
    pushPolylineRect('HACHIHI_ROOMS', room.x, room.y, room.width, room.height, 8);
    pushLabel(room.x + 8, room.y + 18, room.name, 8, 1.1);
  }

  for (const node of nodes) {
    const layer = node.type === 'rack' ? 'HACHIHI_RACKS' : 'HACHIHI_DEVICES';
    const color = node.type === 'rack' ? 4 : 5;
    const blockName = node.type === 'rack' ? 'HACHIHI_RACK_SYM' : 'HACHIHI_DEV_SYM';

    const c0 = networkCanvasToCadPoint({ x: node.x, y: node.y }, cadDoc.underlay);
    const c1 = networkCanvasToCadPoint({ x: node.x + node.width, y: node.y }, cadDoc.underlay);
    const c3 = networkCanvasToCadPoint({ x: node.x, y: node.y + node.height }, cadDoc.underlay);
    const cadCenter = networkCanvasToCadPoint(
      { x: node.x + node.width / 2, y: node.y + node.height / 2 },
      cadDoc.underlay
    );
    const cadW = Math.max(0.01, Math.hypot(c1.x - c0.x, c1.y - c0.y));
    const cadH = Math.max(0.01, Math.hypot(c3.x - c0.x, c3.y - c0.y));

    const asset = node.assetId ? project.assets[node.assetId] : undefined;
    const tagText = (node.label || asset?.name || node.id).replace(/[\r\n]+/g, ' ').slice(0, 80);
    const modelText = (asset?.model || asset?.vendor || (node.type === 'rack' ? 'Rack 42U' : 'Device'))
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 80);
    const ipText = (asset?.ipAddress || '').replace(/[\r\n]+/g, ' ').slice(0, 60);

    const tagPos = networkCanvasToCadPoint({ x: node.x, y: node.y + node.height + 14 }, cadDoc.underlay);
    const modelPos = networkCanvasToCadPoint({ x: node.x, y: node.y + node.height + 26 }, cadDoc.underlay);
    const ipPos = networkCanvasToCadPoint({ x: node.x, y: node.y + node.height + 38 }, cadDoc.underlay);

    mergedDoc.entities.push({
      id: `net_ins_${allocator.getNextSeed()}`,
      handle: allocator.allocate(),
      type: 'INSERT',
      layer,
      colorIndex: color,
      blockName,
      position: { x: cadCenter.x, y: cadCenter.y, z: 0 },
      scale: { x: cadW, y: cadH, z: 1 },
      rotation: netRotation,
      attributes: [
        {
          id: `net_att_${allocator.getNextSeed()}`,
          handle: allocator.allocate(),
          tag: 'TAG',
          text: tagText,
          position: { x: tagPos.x, y: tagPos.y, z: 0 },
          height: textHeight * 0.85,
          rotation: netRotation,
          style: 'STANDARD',
          layer: 'HACHIHI_LABELS'
        },
        {
          id: `net_att_${allocator.getNextSeed()}`,
          handle: allocator.allocate(),
          tag: 'MODEL',
          text: modelText,
          position: { x: modelPos.x, y: modelPos.y, z: 0 },
          height: textHeight * 0.72,
          rotation: netRotation,
          style: 'STANDARD',
          layer: 'HACHIHI_LABELS'
        },
        {
          id: `net_att_${allocator.getNextSeed()}`,
          handle: allocator.allocate(),
          tag: 'IP',
          text: ipText || '-',
          position: { x: ipPos.x, y: ipPos.y, z: 0 },
          height: textHeight * 0.72,
          rotation: netRotation,
          style: 'STANDARD',
          layer: 'HACHIHI_LABELS'
        }
      ],
      xdata: [
        {
          appName: 'HACHIHI_NET',
          values: [
            { code: 1000, value: node.type },
            { code: 1000, value: tagText },
            { code: 1000, value: modelText },
            { code: 1000, value: ipText || 'N/A' }
          ]
        }
      ],
      preservationTier: 'supported',
      dirty: true
    });

    pushLabel(node.x, node.y + node.height + 14, tagText, 7, 0.9);
    if (ipText) {
      pushLabel(node.x, node.y + node.height + 28, ipText, 3, 0.75);
    }
  }

  for (const cable of cables) {
    const src = nodeMap.get(cable.sourceNodeId);
    const tgt = nodeMap.get(cable.targetNodeId);
    if (!src || !tgt) continue;
    const pathInfo = computeCablePath(cable, src, tgt);
    const pts = pathInfo.pts.map(p => networkCanvasToCadPoint(p, cadDoc.underlay));

    const r1: RectBox = { x: src.x, y: src.y, width: src.width, height: src.height };
    const r2: RectBox = { x: tgt.x, y: tgt.y, width: tgt.width, height: tgt.height };
    const traysOnFloor =
      allTrays.length > 0
        ? allTrays.filter(t => !t.floorId || t.floorId === src.floorId || t.floorId === tgt.floorId)
        : [];
    const cableMeters =
      traysOnFloor.length > 0
        ? calculateTrayAwareCableLengthMeters(cable, r1, r2, traysOnFloor, projectScalePxPerM).meters
        : estimateCableLengthMeters(cable, r1, r2, projectScalePxPerM);

    mergedDoc.entities.push({
      id: `net_cab_${allocator.getNextSeed()}`,
      handle: allocator.allocate(),
      type: 'LWPOLYLINE',
      layer: 'HACHIHI_CABLES',
      colorIndex: 3,
      vertices: pts.map(p => ({ x: p.x, y: p.y })),
      closed: false,
      elevation: 0,
      xdata: [
        {
          appName: 'HACHIHI_NET',
          values: [
            { code: 1000, value: cable.cableCode },
            { code: 1000, value: cable.cableType },
            { code: 1040, value: cableMeters }
          ]
        }
      ],
      preservationTier: 'supported',
      dirty: true
    });
    const baseLabel = cable.label ? `${cable.cableCode} - ${cable.label}` : cable.cableCode;
    const label = `${baseLabel} (${cable.cableType}, ${cableMeters}m)`;
    pushLabel(pathInfo.midPoint.x, pathInfo.midPoint.y - 6, label, 2, 0.72);
  }

  mergedDoc.nextHandleSeed = allocator.getNextSeed();

  const hasRoundTrip = Boolean(
    mergedDoc.metadata.hasRawRoundTripData ||
      mergedDoc.rawSections?.classes?.length ||
      mergedDoc.rawSections?.objects?.length ||
      mergedDoc.rawSections?.thumbnail?.length ||
      mergedDoc.rawSections?.extraTables?.length
  );

  return hasRoundTrip ? writeRoundTripDxf(mergedDoc) : writeCleanDxf(mergedDoc);
}
