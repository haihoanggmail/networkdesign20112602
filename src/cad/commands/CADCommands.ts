import { isCADLayerLocked } from '../core/CADDocument';
import { CADHandleAllocator, createCadId } from '../core/CADRegistry';
import { applyAffine2D, buildInsertTransform2D, decomposeAffine2D } from '../core/CADTransform';
import type {
  CADBlock,
  CADDimensionStyle,
  CADDocument,
  CADEntity,
  CADInsertAttribute,
  CADInsertEntity,
  CADLayer,
  CADTextStyle,
  Point2D,
  Point3D
} from '../core/CADTypes';
import {
  isEntityGeometryEditable,
  mirrorEntityAcrossLine,
  rotateEntityAround,
  scaleEntityAround,
  translateEntity
} from '../geometry/CADGeometry';
import type { CADCommand } from './CADCommand';

function cloneEntity(e: CADEntity): CADEntity {
  return structuredClone(e);
}

export class AddEntitiesCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private added: CADEntity[];

  constructor(entities: CADEntity[], labelVi = 'Thêm đối tượng CAD') {
    this.added = entities.map(cloneEntity);
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    const allocator = new CADHandleAllocator(doc);
    const stamped = this.added.map(e => {
      const handle = e.handle || allocator.allocate();
      allocator.register(handle);
      return { ...cloneEntity(e), handle, dirty: true };
    });
    this.added = stamped.map(cloneEntity);
    return {
      ...doc,
      entities: [...doc.entities, ...stamped],
      nextHandleSeed: allocator.getNextSeed()
    };
  }

  undo(doc: CADDocument): CADDocument {
    const ids = new Set(this.added.map(e => e.id));
    return {
      ...doc,
      entities: doc.entities.filter(e => !ids.has(e.id))
    };
  }
}

export class DeleteEntitiesCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly targetIds: Set<string>;
  private snapshots: Array<{ index: number; entity: CADEntity }> = [];

  constructor(entityIds: string[], labelVi = 'Xóa đối tượng CAD') {
    this.targetIds = new Set(entityIds);
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    this.snapshots = [];
    const remaining: CADEntity[] = [];
    doc.entities.forEach((ent, index) => {
      if (this.targetIds.has(ent.id) && !isCADLayerLocked(doc, ent.layer)) {
        this.snapshots.push({ index, entity: cloneEntity(ent) });
      } else {
        remaining.push(ent);
      }
    });
    return { ...doc, entities: remaining };
  }

  undo(doc: CADDocument): CADDocument {
    if (this.snapshots.length === 0) return doc;
    const restored = [...doc.entities];
    for (const item of [...this.snapshots].sort((a, b) => a.index - b.index)) {
      const insertAt = Math.min(restored.length, item.index);
      restored.splice(insertAt, 0, cloneEntity(item.entity));
    }
    return { ...doc, entities: restored };
  }
}

export class TransformEntitiesCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly targetIds: Set<string>;
  private readonly transformer: (entity: CADEntity) => CADEntity;
  private beforeMap = new Map<string, CADEntity>();
  private skippedProtectedCount = 0;

  constructor(
    entityIds: string[],
    transformer: (entity: CADEntity) => CADEntity,
    labelVi: string
  ) {
    this.targetIds = new Set(entityIds);
    this.transformer = transformer;
    this.labelVi = labelVi;
  }

  getSkippedProtectedCount(): number {
    return this.skippedProtectedCount;
  }

  execute(doc: CADDocument): CADDocument {
    this.beforeMap.clear();
    this.skippedProtectedCount = 0;
    const entities = doc.entities.map(ent => {
      if (!this.targetIds.has(ent.id) || isCADLayerLocked(doc, ent.layer)) {
        return ent;
      }
      if (!isEntityGeometryEditable(ent)) {
        this.skippedProtectedCount++;
        return ent;
      }
      this.beforeMap.set(ent.id, cloneEntity(ent));
      return this.transformer(cloneEntity(ent));
    });
    return { ...doc, entities };
  }

  undo(doc: CADDocument): CADDocument {
    if (this.beforeMap.size === 0) return doc;
    return {
      ...doc,
      entities: doc.entities.map(ent => {
        const prev = this.beforeMap.get(ent.id);
        return prev ? cloneEntity(prev) : ent;
      })
    };
  }
}

export class MoveCommand extends TransformEntitiesCommand {
  constructor(entityIds: string[], dx: number, dy: number, dz = 0) {
    super(entityIds, e => translateEntity(e, dx, dy, dz), 'Di chuyển đối tượng');
  }
}

export class RotateCommand extends TransformEntitiesCommand {
  constructor(entityIds: string[], origin: Point2D, angleDeg: number) {
    super(entityIds, e => rotateEntityAround(e, origin, angleDeg), 'Xoay đối tượng');
  }
}

export class ScaleCommand extends TransformEntitiesCommand {
  constructor(entityIds: string[], origin: Point2D, factor: number) {
    super(entityIds, e => scaleEntityAround(e, origin, factor), 'Tỉ lệ đối tượng');
  }
}

export class MirrorCommand extends TransformEntitiesCommand {
  constructor(entityIds: string[], lineA: Point2D, lineB: Point2D) {
    super(entityIds, e => mirrorEntityAcrossLine(e, lineA, lineB), 'Đối xứng đối tượng');
  }
}

export class CopyEntitiesCommand extends AddEntitiesCommand {
  constructor(sourceEntities: CADEntity[], dx: number, dy: number, targetLayer?: string) {
    const copies = sourceEntities
      .filter(src => isEntityGeometryEditable(src))
      .map(src => {
        const shifted = translateEntity(cloneEntity(src), dx, dy, 0);
        return {
          ...shifted,
          id: createCadId('ent'),
          handle: '',
          rawDxf: undefined,
          dirty: true,
          layer: targetLayer || shifted.layer
        };
      });
    super(copies, `Sao chép ${copies.length} đối tượng`);
  }
}

export class ModifyEntityCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly entityId: string;
  private readonly patcher: (entity: CADEntity) => CADEntity;
  private beforeEntity: CADEntity | null = null;

  constructor(
    entityId: string,
    patcher: (entity: CADEntity) => CADEntity,
    labelVi = 'Cập nhật thuộc tính đối tượng'
  ) {
    this.entityId = entityId;
    this.patcher = patcher;
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    const entities = doc.entities.map(ent => {
      if (ent.id !== this.entityId) return ent;
      if (isCADLayerLocked(doc, ent.layer)) return ent;
      this.beforeEntity = cloneEntity(ent);
      const updated = this.patcher(cloneEntity(ent));
      if (!isEntityGeometryEditable(ent)) {
        // Keep readonly/unknown geometry & rawDxf/xdata untouched; only allow metadata layer/visible updates
        return {
          ...cloneEntity(ent),
          layer: updated.layer,
          visible: updated.visible
        };
      }
      return { ...updated, dirty: true, bounds: undefined };
    });
    return { ...doc, entities };
  }

  undo(doc: CADDocument): CADDocument {
    if (!this.beforeEntity) return doc;
    const restore = cloneEntity(this.beforeEntity);
    return {
      ...doc,
      entities: doc.entities.map(ent => (ent.id === this.entityId ? restore : ent))
    };
  }
}

export class ReplaceEntitiesCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly removedIds: Set<string>;
  private readonly replacements: CADEntity[];
  private removedSnapshots: Array<{ index: number; entity: CADEntity }> = [];
  private insertedIds: string[] = [];

  constructor(removedIds: string[], replacements: CADEntity[], labelVi = 'Cắt / Nối / Phá Block') {
    this.removedIds = new Set(removedIds);
    this.replacements = replacements.map(cloneEntity);
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    const allocator = new CADHandleAllocator(doc);
    this.removedSnapshots = [];
    const surviving: CADEntity[] = [];
    doc.entities.forEach((ent, index) => {
      if (this.removedIds.has(ent.id) && !isCADLayerLocked(doc, ent.layer)) {
        this.removedSnapshots.push({ index, entity: cloneEntity(ent) });
      } else {
        surviving.push(ent);
      }
    });

    if (this.removedIds.size > 0 && this.removedSnapshots.length === 0) {
      return doc;
    }

    const added = this.replacements.map(r => {
      const h = r.handle || allocator.allocate();
      allocator.register(h);
      return { ...cloneEntity(r), handle: h, dirty: true, bounds: undefined };
    });
    this.insertedIds = added.map(a => a.id);

    return {
      ...doc,
      entities: [...surviving, ...added],
      nextHandleSeed: allocator.getNextSeed()
    };
  }

  undo(doc: CADDocument): CADDocument {
    const insSet = new Set(this.insertedIds);
    const base = doc.entities.filter(e => !insSet.has(e.id));
    for (const snap of [...this.removedSnapshots].sort((a, b) => a.index - b.index)) {
      base.splice(Math.min(base.length, snap.index), 0, cloneEntity(snap.entity));
    }
    return { ...doc, entities: base };
  }
}

export function buildExplodeInsertCommand(
  doc: CADDocument,
  insertEntityId: string
): ReplaceEntitiesCommand | null {
  const ent = doc.entities.find(e => e.id === insertEntityId);
  if (!ent || ent.type !== 'INSERT' || isCADLayerLocked(doc, ent.layer)) return null;
  const blk = doc.blocks[ent.blockName];
  if (!blk) return null;

  const m = buildInsertTransform2D(ent.position, ent.scale, ent.rotation, blk.basePoint);
  const dec = decomposeAffine2D(m);
  const scaleAvg = (Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2;
  const expanded: CADEntity[] = [];

  for (const sub of blk.entities) {
    const baseCommon = {
      ...cloneEntity(sub),
      id: createCadId('ent'),
      handle: '',
      rawDxf: undefined,
      dirty: true,
      bounds: undefined,
      layer: sub.layer === '0' ? ent.layer : sub.layer
    };
    if (baseCommon.type === 'LINE') {
      const a = applyAffine2D(m, baseCommon.start);
      const b = applyAffine2D(m, baseCommon.end);
      expanded.push({
        ...baseCommon,
        start: { x: a.x, y: a.y, z: baseCommon.start.z },
        end: { x: b.x, y: b.y, z: baseCommon.end.z }
      });
    } else if (baseCommon.type === 'CIRCLE') {
      const c = applyAffine2D(m, baseCommon.center);
      expanded.push({
        ...baseCommon,
        center: { x: c.x, y: c.y, z: baseCommon.center.z },
        radius: baseCommon.radius * scaleAvg
      });
    } else if (baseCommon.type === 'ARC') {
      const c = applyAffine2D(m, baseCommon.center);
      expanded.push({
        ...baseCommon,
        center: { x: c.x, y: c.y, z: baseCommon.center.z },
        radius: baseCommon.radius * scaleAvg,
        startAngle: baseCommon.startAngle + dec.rotationDeg,
        endAngle: baseCommon.endAngle + dec.rotationDeg
      });
    } else if (baseCommon.type === 'LWPOLYLINE' || baseCommon.type === 'POLYLINE') {
      expanded.push({
        ...baseCommon,
        vertices: baseCommon.vertices.map(v => {
          const p = applyAffine2D(m, v);
          return { ...v, x: p.x, y: p.y };
        })
      });
    } else if (baseCommon.type === 'TEXT' || baseCommon.type === 'MTEXT') {
      const p = applyAffine2D(m, baseCommon.position);
      expanded.push({
        ...baseCommon,
        position: { x: p.x, y: p.y, z: baseCommon.position.z },
        height: baseCommon.height * scaleAvg,
        rotation: (baseCommon.rotation || 0) + dec.rotationDeg
      });
    }
  }

  return new ReplaceEntitiesCommand([ent.id], expanded, `Phá khối Block "${ent.blockName}"`);
}

export class UpsertLayerCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly layer: CADLayer;
  private prevLayer: CADLayer | undefined;

  constructor(layer: CADLayer, labelVi = `Cập nhật Layer "${layer.name}"`) {
    this.layer = structuredClone(layer);
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    this.prevLayer = doc.layers[this.layer.name] ? structuredClone(doc.layers[this.layer.name]) : undefined;
    return {
      ...doc,
      layers: {
        ...doc.layers,
        [this.layer.name]: structuredClone(this.layer)
      }
    };
  }

  undo(doc: CADDocument): CADDocument {
    const layers = { ...doc.layers };
    if (this.prevLayer) {
      layers[this.layer.name] = structuredClone(this.prevLayer);
    } else {
      delete layers[this.layer.name];
    }
    return { ...doc, layers };
  }
}

export class RenameLayerCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly oldName: string;
  private readonly newName: string;
  private prevLayers: Record<string, CADLayer> | null = null;
  private prevClayer = '0';
  private prevEntities: CADEntity[] | null = null;
  private prevBlocks: Record<string, CADBlock> | null = null;

  constructor(oldName: string, newName: string) {
    this.oldName = oldName;
    this.newName = newName.trim();
    this.labelVi = `Đổi tên Layer "${oldName}" -> "${this.newName}"`;
  }

  execute(doc: CADDocument): CADDocument {
    if (
      !this.newName ||
      this.oldName === '0' ||
      this.newName === this.oldName ||
      !doc.layers[this.oldName] ||
      doc.layers[this.newName]
    ) {
      return doc;
    }

    this.prevLayers = structuredClone(doc.layers);
    this.prevClayer = doc.header.$CLAYER;
    this.prevEntities = doc.entities;
    this.prevBlocks = doc.blocks;

    const layers: Record<string, CADLayer> = {};
    for (const [k, l] of Object.entries(doc.layers)) {
      if (k === this.oldName) {
        layers[this.newName] = { ...structuredClone(l), name: this.newName };
      } else {
        layers[k] = l;
      }
    }

    const entities = doc.entities.map(ent =>
      ent.layer === this.oldName ? { ...ent, layer: this.newName } : ent
    );

    const blocks: Record<string, CADBlock> = {};
    for (const [bKey, blk] of Object.entries(doc.blocks)) {
      const hasMatch = blk.entities.some(sub => sub.layer === this.oldName);
      if (!hasMatch) {
        blocks[bKey] = blk;
      } else {
        blocks[bKey] = {
          ...blk,
          entities: blk.entities.map(sub =>
            sub.layer === this.oldName ? { ...sub, layer: this.newName } : sub
          )
        };
      }
    }

    return {
      ...doc,
      header: {
        ...doc.header,
        $CLAYER: doc.header.$CLAYER === this.oldName ? this.newName : doc.header.$CLAYER
      },
      layers,
      entities,
      blocks
    };
  }

  undo(doc: CADDocument): CADDocument {
    if (!this.prevLayers || !this.prevEntities || !this.prevBlocks) return doc;
    return {
      ...doc,
      header: { ...doc.header, $CLAYER: this.prevClayer },
      layers: structuredClone(this.prevLayers),
      entities: this.prevEntities,
      blocks: this.prevBlocks
    };
  }
}

export class DeleteLayerCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly layerName: string;
  private readonly reassignToLayer: string;
  private prevLayer: CADLayer | null = null;
  private prevClayer = '0';
  private changedEntityIds: string[] = [];

  constructor(layerName: string, reassignToLayer = '0') {
    this.layerName = layerName;
    this.reassignToLayer = reassignToLayer;
    this.labelVi = `Xóa Layer "${layerName}"`;
  }

  execute(doc: CADDocument): CADDocument {
    if (this.layerName === '0' || !doc.layers[this.layerName]) return doc;
    this.prevLayer = structuredClone(doc.layers[this.layerName]);
    this.prevClayer = doc.header.$CLAYER;
    this.changedEntityIds = [];

    const layers = { ...doc.layers };
    delete layers[this.layerName];

    const fallback = layers[this.reassignToLayer] ? this.reassignToLayer : '0';
    const entities = doc.entities.map(ent => {
      if (ent.layer !== this.layerName) return ent;
      this.changedEntityIds.push(ent.id);
      return { ...ent, layer: fallback };
    });

    return {
      ...doc,
      header: {
        ...doc.header,
        $CLAYER: doc.header.$CLAYER === this.layerName ? fallback : doc.header.$CLAYER
      },
      layers,
      entities
    };
  }

  undo(doc: CADDocument): CADDocument {
    if (!this.prevLayer) return doc;
    const idSet = new Set(this.changedEntityIds);
    return {
      ...doc,
      header: { ...doc.header, $CLAYER: this.prevClayer },
      layers: {
        ...doc.layers,
        [this.layerName]: structuredClone(this.prevLayer)
      },
      entities: doc.entities.map(ent =>
        idSet.has(ent.id) ? { ...ent, layer: this.layerName } : ent
      )
    };
  }
}

export class BatchUpdateLayersCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly updater: (layers: Record<string, CADLayer>) => Record<string, CADLayer>;
  private prevLayers: Record<string, CADLayer> | null = null;

  constructor(
    updater: (layers: Record<string, CADLayer>) => Record<string, CADLayer>,
    labelVi = 'Cập nhật hàng loạt Layer'
  ) {
    this.updater = updater;
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    this.prevLayers = structuredClone(doc.layers);
    return {
      ...doc,
      layers: this.updater(structuredClone(doc.layers))
    };
  }

  undo(doc: CADDocument): CADDocument {
    if (!this.prevLayers) return doc;
    return { ...doc, layers: structuredClone(this.prevLayers) };
  }
}

export interface CADBatchEntityPatch {
  layer?: string;
  colorIndex?: number;
  lineType?: string;
  lineWeight?: number;
  visible?: boolean;
}

export class BatchModifyEntitiesCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly targetIds: Set<string>;
  private readonly patch: CADBatchEntityPatch;
  private beforeMap = new Map<string, CADEntity>();

  constructor(
    entityIds: string[],
    patch: CADBatchEntityPatch,
    labelVi = 'Cập nhật thuộc tính hàng loạt'
  ) {
    this.targetIds = new Set(entityIds);
    this.patch = patch;
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    this.beforeMap.clear();
    const entities = doc.entities.map(ent => {
      if (!this.targetIds.has(ent.id) || isCADLayerLocked(doc, ent.layer)) {
        return ent;
      }
      this.beforeMap.set(ent.id, cloneEntity(ent));
      if (!isEntityGeometryEditable(ent)) {
        return {
          ...cloneEntity(ent),
          layer: this.patch.layer !== undefined ? this.patch.layer : ent.layer,
          visible: this.patch.visible !== undefined ? this.patch.visible : ent.visible
        };
      }
      return {
        ...cloneEntity(ent),
        ...(this.patch.layer !== undefined ? { layer: this.patch.layer } : {}),
        ...(this.patch.colorIndex !== undefined ? { colorIndex: this.patch.colorIndex, trueColor: undefined } : {}),
        ...(this.patch.lineType !== undefined ? { lineType: this.patch.lineType } : {}),
        ...(this.patch.lineWeight !== undefined ? { lineWeight: this.patch.lineWeight } : {}),
        ...(this.patch.visible !== undefined ? { visible: this.patch.visible } : {}),
        dirty: true
      };
    });
    return { ...doc, entities };
  }

  undo(doc: CADDocument): CADDocument {
    if (this.beforeMap.size === 0) return doc;
    return {
      ...doc,
      entities: doc.entities.map(ent => {
        const prev = this.beforeMap.get(ent.id);
        return prev ? cloneEntity(prev) : ent;
      })
    };
  }
}

export class EditInsertAttributesCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly entityId: string;
  private readonly nextAttributes: CADInsertAttribute[];
  private prevAttributes: CADInsertAttribute[] | undefined;
  private prevDirty: boolean | undefined;

  constructor(
    entityId: string,
    nextAttributes: CADInsertAttribute[],
    labelVi = 'Cập nhật thuộc tính Attribute Block'
  ) {
    this.entityId = entityId;
    this.nextAttributes = structuredClone(nextAttributes);
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    return {
      ...doc,
      entities: doc.entities.map(ent => {
        if (ent.id !== this.entityId || ent.type !== 'INSERT' || isCADLayerLocked(doc, ent.layer)) {
          return ent;
        }
        this.prevAttributes = ent.attributes ? structuredClone(ent.attributes) : undefined;
        this.prevDirty = ent.dirty;
        return {
          ...cloneEntity(ent),
          attributes: structuredClone(this.nextAttributes),
          dirty: true,
          bounds: undefined
        } as CADInsertEntity;
      })
    };
  }

  undo(doc: CADDocument): CADDocument {
    return {
      ...doc,
      entities: doc.entities.map(ent => {
        if (ent.id !== this.entityId || ent.type !== 'INSERT') return ent;
        return {
          ...cloneEntity(ent),
          attributes: this.prevAttributes ? structuredClone(this.prevAttributes) : undefined,
          dirty: this.prevDirty,
          bounds: undefined
        } as CADInsertEntity;
      })
    };
  }
}

export class CreateBlockFromSelectionCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly entityIds: Set<string>;
  private readonly blockName: string;
  private readonly basePoint: Point3D;
  private readonly insertLayer: string;
  private removedSnapshots: Array<{ index: number; entity: CADEntity }> = [];
  private insertedId: string | null = null;
  private created = false;

  constructor(
    entityIds: string[],
    blockName: string,
    basePoint: Point3D,
    insertLayer = '0'
  ) {
    this.entityIds = new Set(entityIds);
    this.blockName = blockName.trim();
    this.basePoint = { ...basePoint };
    this.insertLayer = insertLayer;
    this.labelVi = `Tạo Block "${this.blockName}" từ vùng chọn`;
  }

  execute(doc: CADDocument): CADDocument {
    if (!this.blockName || doc.blocks[this.blockName]) {
      return doc;
    }

    const allocator = new CADHandleAllocator(doc);
    this.removedSnapshots = [];
    const surviving: CADEntity[] = [];
    const selected: CADEntity[] = [];

    doc.entities.forEach((ent, index) => {
      if (
        this.entityIds.has(ent.id) &&
        !isCADLayerLocked(doc, ent.layer) &&
        isEntityGeometryEditable(ent)
      ) {
        this.removedSnapshots.push({ index, entity: cloneEntity(ent) });
        selected.push(cloneEntity(ent));
      } else {
        surviving.push(ent);
      }
    });

    if (selected.length === 0) return doc;

    const blockEntities: CADEntity[] = selected.map(ent => {
      const shifted = translateEntity(ent, -this.basePoint.x, -this.basePoint.y, -(this.basePoint.z || 0));
      return {
        ...shifted,
        id: createCadId('blk_ent'),
        handle: allocator.allocate(),
        rawDxf: undefined,
        dirty: true,
        bounds: undefined
      };
    });

    const attributes: CADInsertAttribute[] = [];
    for (const sub of selected) {
      if (sub.type === 'ATTDEF') {
        attributes.push({
          id: createCadId('att'),
          tag: sub.tag,
          text: sub.text,
          position: { ...sub.position },
          height: sub.height,
          rotation: sub.rotation,
          style: sub.style,
          layer: sub.layer
        });
      }
    }

    const blockHandle = allocator.allocate();
    const insertHandle = allocator.allocate();
    const newBlock: CADBlock = {
      id: createCadId('blk'),
      name: this.blockName,
      basePoint: { x: 0, y: 0, z: 0 },
      entities: blockEntities,
      handle: blockHandle
    };

    const insertEnt: CADInsertEntity = {
      id: createCadId('ent'),
      handle: insertHandle,
      type: 'INSERT',
      layer: this.insertLayer || selected[0].layer || '0',
      space: selected[0].space,
      blockName: this.blockName,
      position: { ...this.basePoint },
      scale: { x: 1, y: 1, z: 1 },
      rotation: 0,
      ...(attributes.length > 0 ? { attributes } : {}),
      preservationTier: 'supported',
      dirty: true
    };
    this.insertedId = insertEnt.id;
    this.created = true;

    return {
      ...doc,
      blocks: {
        ...doc.blocks,
        [this.blockName]: newBlock
      },
      entities: [...surviving, insertEnt],
      nextHandleSeed: allocator.getNextSeed()
    };
  }

  undo(doc: CADDocument): CADDocument {
    if (!this.created || !this.insertedId) return doc;
    const blocks = { ...doc.blocks };
    delete blocks[this.blockName];
    const base = doc.entities.filter(e => e.id !== this.insertedId);
    for (const snap of [...this.removedSnapshots].sort((a, b) => a.index - b.index)) {
      base.splice(Math.min(base.length, snap.index), 0, cloneEntity(snap.entity));
    }
    return {
      ...doc,
      blocks,
      entities: base
    };
  }
}

export class UpdateBlockCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly blockName: string;
  private readonly patch: { newName?: string; basePoint?: Point3D };
  private prevBlocks: Record<string, CADBlock> | null = null;
  private prevEntities: CADEntity[] | null = null;

  constructor(
    blockName: string,
    patch: { newName?: string; basePoint?: Point3D },
    labelVi = `Cập nhật Block "${blockName}"`
  ) {
    this.blockName = blockName;
    this.patch = patch;
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    const target = doc.blocks[this.blockName];
    if (!target) return doc;
    const nextName = (this.patch.newName ?? this.blockName).trim();
    if (!nextName || (nextName !== this.blockName && doc.blocks[nextName])) return doc;

    this.prevBlocks = structuredClone(doc.blocks);
    this.prevEntities = doc.entities;

    const updatedBlock: CADBlock = {
      ...structuredClone(target),
      name: nextName,
      basePoint: this.patch.basePoint ? { ...this.patch.basePoint } : { ...target.basePoint }
    };

    const blocks: Record<string, CADBlock> = {};
    for (const [k, b] of Object.entries(doc.blocks)) {
      if (k === this.blockName) {
        blocks[nextName] = updatedBlock;
      } else if (nextName !== this.blockName && b.entities.some(e => e.type === 'INSERT' && e.blockName === this.blockName)) {
        blocks[k] = {
          ...b,
          entities: b.entities.map(e =>
            e.type === 'INSERT' && e.blockName === this.blockName
              ? { ...e, blockName: nextName, dirty: true }
              : e
          )
        };
      } else {
        blocks[k] = b;
      }
    }

    const entities =
      nextName !== this.blockName
        ? doc.entities.map(ent =>
            ent.type === 'INSERT' && ent.blockName === this.blockName
              ? { ...ent, blockName: nextName, dirty: true, bounds: undefined }
              : ent
          )
        : doc.entities.map(ent =>
            ent.type === 'INSERT' && ent.blockName === nextName
              ? { ...ent, bounds: undefined }
              : ent
          );

    return { ...doc, blocks, entities };
  }

  undo(doc: CADDocument): CADDocument {
    if (!this.prevBlocks || !this.prevEntities) return doc;
    return {
      ...doc,
      blocks: structuredClone(this.prevBlocks),
      entities: this.prevEntities
    };
  }
}

export class PurgeUnusedBlocksCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi = 'Dọn dẹp Block không sử dụng (Purge)';
  private removedBlocks: Record<string, CADBlock> = {};

  execute(doc: CADDocument): CADDocument {
    this.removedBlocks = {};
    const used = new Set<string>();
    const queue: string[] = [];

    for (const ent of doc.entities) {
      if (ent.type === 'INSERT' && ent.blockName && !used.has(ent.blockName)) {
        used.add(ent.blockName);
        queue.push(ent.blockName);
      }
    }
    while (queue.length > 0) {
      const bName = queue.shift()!;
      const blk = doc.blocks[bName];
      if (!blk) continue;
      for (const sub of blk.entities) {
        if (sub.type === 'INSERT' && sub.blockName && !used.has(sub.blockName)) {
          used.add(sub.blockName);
          queue.push(sub.blockName);
        }
      }
    }

    const kept: Record<string, CADBlock> = {};
    for (const [name, blk] of Object.entries(doc.blocks)) {
      const isSystem = name.startsWith('*Model_Space') || name.startsWith('*Paper_Space');
      if (isSystem || used.has(name)) {
        kept[name] = blk;
      } else {
        this.removedBlocks[name] = structuredClone(blk);
      }
    }

    return { ...doc, blocks: kept };
  }

  undo(doc: CADDocument): CADDocument {
    if (Object.keys(this.removedBlocks).length === 0) return doc;
    return {
      ...doc,
      blocks: {
        ...doc.blocks,
        ...structuredClone(this.removedBlocks)
      }
    };
  }
}

export class UpdateXrefBlockCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly blockName: string;
  private readonly action:
    | { mode: 'setPath'; xrefPath: string }
    | { mode: 'bindLocal' }
    | { mode: 'clearMissingNotice' };
  private prevBlock: CADBlock | undefined;
  private prevMissingXrefs: string[] = [];

  constructor(
    blockName: string,
    action:
      | { mode: 'setPath'; xrefPath: string }
      | { mode: 'bindLocal' }
      | { mode: 'clearMissingNotice' }
  ) {
    this.blockName = blockName;
    this.action = action;
    this.labelVi =
      action.mode === 'bindLocal'
        ? `Gắn nội bộ XREF "${blockName}"`
        : action.mode === 'clearMissingNotice'
          ? `Xác nhận bỏ qua cảnh báo XREF "${blockName}"`
          : `Cập nhật đường dẫn XREF "${blockName}"`;
  }

  execute(doc: CADDocument): CADDocument {
    const blk = doc.blocks[this.blockName];
    this.prevMissingXrefs = [...doc.metadata.missingXrefs];
    this.prevBlock = blk ? structuredClone(blk) : undefined;

    if (this.action.mode === 'clearMissingNotice') {
      const targetLower = this.blockName.toLowerCase();
      const blkPathLower = blk?.xrefPath?.toLowerCase();
      return {
        ...doc,
        metadata: {
          ...doc.metadata,
          missingXrefs: doc.metadata.missingXrefs.filter(m => {
            const ml = m.toLowerCase();
            return ml !== targetLower && (!blkPathLower || ml !== blkPathLower);
          })
        }
      };
    }

    if (!blk) return doc;

    if (this.action.mode === 'bindLocal') {
      const oldPath = blk.xrefPath?.toLowerCase();
      const nextBlock: CADBlock = {
        ...structuredClone(blk),
        xrefPath: undefined,
        isXref: false
      };
      return {
        ...doc,
        blocks: { ...doc.blocks, [this.blockName]: nextBlock },
        metadata: {
          ...doc.metadata,
          missingXrefs: doc.metadata.missingXrefs.filter(
            m => m.toLowerCase() !== this.blockName.toLowerCase() && (!oldPath || m.toLowerCase() !== oldPath)
          )
        }
      };
    }

    const nextPath = this.action.xrefPath.trim();
    const nextBlock: CADBlock = {
      ...structuredClone(blk),
      xrefPath: nextPath || undefined,
      isXref: Boolean(nextPath)
    };
    return {
      ...doc,
      blocks: { ...doc.blocks, [this.blockName]: nextBlock }
    };
  }

  undo(doc: CADDocument): CADDocument {
    const nextBlocks = { ...doc.blocks };
    if (this.prevBlock) {
      nextBlocks[this.blockName] = structuredClone(this.prevBlock);
    }
    return {
      ...doc,
      blocks: nextBlocks,
      metadata: {
        ...doc.metadata,
        missingXrefs: [...this.prevMissingXrefs]
      }
    };
  }
}

export class UpsertTextStyleCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly style: CADTextStyle;
  private readonly keyName: string;
  private prevStyle: CADTextStyle | undefined;

  constructor(style: CADTextStyle, labelVi = `Cập nhật kiểu chữ "${style.name}"`) {
    this.style = structuredClone(style);
    this.keyName = style.name.trim().toUpperCase() || 'STANDARD';
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    this.prevStyle = doc.textStyles[this.keyName] ? structuredClone(doc.textStyles[this.keyName]) : undefined;
    return {
      ...doc,
      textStyles: {
        ...doc.textStyles,
        [this.keyName]: {
          ...structuredClone(this.style),
          name: this.style.name.trim() || this.keyName
        }
      }
    };
  }

  undo(doc: CADDocument): CADDocument {
    const next = { ...doc.textStyles };
    if (this.prevStyle) {
      next[this.keyName] = structuredClone(this.prevStyle);
    } else {
      delete next[this.keyName];
    }
    return { ...doc, textStyles: next };
  }
}

export class UpsertDimStyleCommand implements CADCommand {
  readonly id = createCadId('cmd');
  readonly labelVi: string;
  private readonly dimStyle: CADDimensionStyle;
  private readonly keyName: string;
  private prevStyle: CADDimensionStyle | undefined;

  constructor(dimStyle: CADDimensionStyle, labelVi = `Cập nhật kiểu kích thước "${dimStyle.name}"`) {
    this.dimStyle = structuredClone(dimStyle);
    this.keyName = dimStyle.name.trim().toUpperCase() || 'STANDARD';
    this.labelVi = labelVi;
  }

  execute(doc: CADDocument): CADDocument {
    this.prevStyle = doc.dimStyles[this.keyName] ? structuredClone(doc.dimStyles[this.keyName]) : undefined;
    return {
      ...doc,
      dimStyles: {
        ...doc.dimStyles,
        [this.keyName]: {
          ...structuredClone(this.dimStyle),
          name: this.dimStyle.name.trim() || this.keyName
        }
      }
    };
  }

  undo(doc: CADDocument): CADDocument {
    const next = { ...doc.dimStyles };
    if (this.prevStyle) {
      next[this.keyName] = structuredClone(this.prevStyle);
    } else {
      delete next[this.keyName];
    }
    return { ...doc, dimStyles: next };
  }
}
