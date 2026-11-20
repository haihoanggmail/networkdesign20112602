import {
  BoundingBox2D,
  CADBlock,
  CADDocument,
  CADEntity,
  CADLayer,
  CADSnapSettings
} from './CADTypes';
import { CADHandleAllocator, createCadId } from './CADRegistry';

export const CAD_SCHEMA_VERSION = 1;

export const DEFAULT_CAD_SNAP_SETTINGS: CADSnapSettings = {
  enabled: true,
  ortho: false,
  polar: false,
  gridSnap: false,
  gridSpacing: 100,
  modes: {
    endpoint: true,
    midpoint: true,
    center: true,
    intersection: true,
    perpendicular: true,
    quadrant: true,
    nearest: false,
    insertion: true
  }
};

export function createDefaultLayer(name = '0', colorIndex = 7): CADLayer {
  return {
    id: `layer_${name}`,
    name,
    colorIndex,
    lineType: 'CONTINUOUS',
    lineWeight: -3,
    visible: true,
    frozen: false,
    locked: false,
    plottable: true
  };
}

export function createEmptyCADDocument(
  name = 'Bản vẽ AutoCAD mới',
  options?: { projectId?: string; insUnits?: CADDocument['header']['$INSUNITS'] }
): CADDocument {
  const now = new Date().toISOString();
  const allocator = new CADHandleAllocator();
  const layer0 = createDefaultLayer('0', 7);
  layer0.handle = allocator.allocate();

  return {
    id: createCadId('cad'),
    name,
    projectId: options?.projectId,
    schemaVersion: CAD_SCHEMA_VERSION,
    header: {
      $ACADVER: 'AC1015',
      $INSUNITS: options?.insUnits ?? 4,
      $MEASUREMENT: 1,
      $LUNITS: 2,
      $DIMSCALE: 1,
      $LTSCALE: 1,
      $TEXTSIZE: 250,
      $CLAYER: '0',
      $INSBASE: { x: 0, y: 0, z: 0 }
    },
    layers: {
      '0': layer0
    },
    lineTypes: {
      CONTINUOUS: {
        name: 'CONTINUOUS',
        description: 'Solid line',
        pattern: [],
        totalLength: 0,
        handle: allocator.allocate()
      },
      DASHED: {
        name: 'DASHED',
        description: 'Dashed __ __ __ __',
        pattern: [12, -6],
        totalLength: 18,
        handle: allocator.allocate()
      },
      CENTER: {
        name: 'CENTER',
        description: 'Center ____ _ ____ _',
        pattern: [30, -6, 6, -6],
        totalLength: 48,
        handle: allocator.allocate()
      }
    },
    textStyles: {
      STANDARD: {
        name: 'STANDARD',
        fontFile: 'txt',
        fixedHeight: 0,
        widthFactor: 1,
        obliqueAngle: 0,
        handle: allocator.allocate()
      }
    },
    dimStyles: {
      STANDARD: {
        name: 'STANDARD',
        dimscale: 1,
        dimtxt: 180,
        dimasz: 180,
        dimexo: 62.5,
        dimexe: 125,
        dimlfac: 1,
        dimdec: 2,
        handle: allocator.allocate()
      }
    },
    blocks: {},
    layouts: [
      {
        name: 'Model',
        tabOrder: 0,
        isModelSpace: true
      }
    ],
    entities: [],
    extents: { minX: 0, minY: 0, maxX: 10000, maxY: 8000 },
    nextHandleSeed: allocator.getNextSeed(),
    metadata: {
      sourceFileName: `${name}.dxf`,
      sourceFileSizeBytes: 0,
      sourceFormat: 'new',
      acadVersion: 'AC1015 (AutoCAD 2000+)',
      hasRawRoundTripData: false,
      missingFonts: [],
      missingXrefs: [],
      unknownEntityTypes: {},
      securityWarnings: [],
      importTimestamp: now
    },
    underlay: {
      enabled: true,
      opacity: 0.72,
      offsetX: 0,
      offsetY: 0,
      scaleToCanvasPx: 0.05,
      rotationDeg: 0,
      locked: true,
      showIn3D: true
    },
    createdAt: now,
    updatedAt: now
  };
}

export function cloneCADDocument(doc: CADDocument): CADDocument {
  return structuredClone(doc);
}

export function isCADLayerVisible(doc: CADDocument, layerName: string): boolean {
  const layer = doc.layers[layerName];
  if (!layer) return true;
  return layer.visible && !layer.frozen;
}

export function isCADLayerLocked(doc: CADDocument, layerName: string): boolean {
  const layer = doc.layers[layerName];
  return Boolean(layer?.locked);
}

export function getEntitySpace(entity: Pick<CADEntity, 'space'>): 'model' | 'paper' {
  return entity.space === 'paper' ? 'paper' : 'model';
}

export function isCADEntityInSpace(
  entity: Pick<CADEntity, 'space'>,
  activeSpace: 'model' | 'paper' | 'all' = 'all'
): boolean {
  if (activeSpace === 'all') return true;
  return getEntitySpace(entity) === activeSpace;
}

export function isCADEntityInteractive(doc: CADDocument, entity: CADEntity): boolean {
  if (entity.visible === false) return false;
  if (!isCADLayerVisible(doc, entity.layer)) return false;
  return !isCADLayerLocked(doc, entity.layer);
}

export function getCADDocumentStatistics(doc: CADDocument): {
  totalEntities: number;
  supportedCount: number;
  readonlyCount: number;
  unknownCount: number;
  layerCount: number;
  blockCount: number;
  extents: BoundingBox2D;
} {
  let supportedCount = 0;
  let readonlyCount = 0;
  let unknownCount = 0;
  for (const e of doc.entities) {
    if (e.preservationTier === 'supported') supportedCount++;
    else if (e.preservationTier === 'readonly') readonlyCount++;
    else unknownCount++;
  }
  return {
    totalEntities: doc.entities.length,
    supportedCount,
    readonlyCount,
    unknownCount,
    layerCount: Object.keys(doc.layers).length,
    blockCount: Object.values(doc.blocks).filter((b: CADBlock) => !b.name.startsWith('*Model_Space') && !b.name.startsWith('*Paper_Space')).length,
    extents: doc.extents
  };
}
