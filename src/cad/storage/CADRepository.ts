import type {
  BoundingBox2D,
  CADBlock,
  CADDimensionStyle,
  CADDocument,
  CADDocumentMetadata,
  CADEntity,
  CADHeaderVariables,
  CADLayer,
  CADLayout,
  CADLineType,
  CADRawSections,
  CADTextStyle,
  CADUnderlayAlignment
} from '../core/CADTypes';
import { createCadId } from '../core/CADRegistry';
import { CAD_ENTITY_CHUNK_SIZE, cadDatabase } from './CADDatabase';

export interface CADDocumentSummary {
  id: string;
  name: string;
  projectId?: string;
  entityCount: number;
  layerCount: number;
  updatedAt: string;
  acadVersion: string;
  sourceFileName: string;
}

interface StoredDocumentRecord {
  id: string;
  name: string;
  projectId?: string;
  schemaVersion: number;
  header: CADHeaderVariables;
  extents: BoundingBox2D;
  nextHandleSeed: number;
  rawSections?: CADRawSections;
  metadata: CADDocumentMetadata;
  underlay: CADUnderlayAlignment;
  entityCount: number;
  layerCount: number;
  chunkCount: number;
  committedGeneration?: number;
  activeGeneration?: number;
  saveState?: 'committed' | 'staging';
  createdAt: string;
  updatedAt: string;
}

interface StoredEntityChunk {
  id: string;
  docId: string;
  generation?: number;
  chunkIndex: number;
  entities: CADEntity[];
}

export type CADSaveStageHook = (
  stage: 'before-tables' | 'before-chunks' | 'mid-chunks' | 'before-commit',
  context: { docId: string; generation: number; batchIndex?: number }
) => void | Promise<void>;

export interface CADSaveDocumentOptions {
  chunkSize?: number;
  onBeforeStage?: CADSaveStageHook;
}

function generationKey(docId: string, generation: number): string {
  return `${docId}::g${generation}`;
}

export class CADRepository {
  async saveDocument(doc: CADDocument, options?: CADSaveDocumentOptions): Promise<number> {
    const existingMeta = await cadDatabase.getRecord<StoredDocumentRecord>('documents', doc.id);
    const prevGen = existingMeta?.committedGeneration ?? existingMeta?.activeGeneration ?? 0;
    const nextGen = prevGen + 1;
    const chunkSize = options?.chunkSize ?? CAD_ENTITY_CHUNK_SIZE;
    const chunkCount = Math.max(1, Math.ceil(doc.entities.length / Math.max(250, chunkSize)));
    const genId = generationKey(doc.id, nextGen);

    const cleanupStagedGeneration = async () => {
      await Promise.allSettled([
        cadDatabase.deleteDocRecordsForGeneration('layers', doc.id, nextGen),
        cadDatabase.deleteDocRecordsForGeneration('blocks', doc.id, nextGen),
        cadDatabase.deleteDocRecordsForGeneration('styles', doc.id, nextGen),
        cadDatabase.deleteDocRecordsForGeneration('layouts', doc.id, nextGen),
        cadDatabase.deleteDocRecordsForGeneration('entities', doc.id, nextGen)
      ]);
    };

    try {
      // Clear any orphaned partial data at nextGen from an earlier interrupted attempt
      await cleanupStagedGeneration();

      await options?.onBeforeStage?.('before-tables', { docId: doc.id, generation: nextGen });

      // Stage 1: Write tables under isolated generation keys while leaving prevGen untouched
      await cadDatabase.putRecord('layers', {
        id: genId,
        docId: doc.id,
        generation: nextGen,
        layers: doc.layers
      });
      await cadDatabase.putRecord('blocks', {
        id: genId,
        docId: doc.id,
        generation: nextGen,
        blocks: doc.blocks
      });
      await cadDatabase.putRecord('styles', {
        id: genId,
        docId: doc.id,
        generation: nextGen,
        lineTypes: doc.lineTypes,
        textStyles: doc.textStyles,
        dimStyles: doc.dimStyles
      });
      await cadDatabase.putRecord('layouts', {
        id: genId,
        docId: doc.id,
        generation: nextGen,
        layouts: doc.layouts
      });

      await options?.onBeforeStage?.('before-chunks', { docId: doc.id, generation: nextGen });

      // Stage 2: Write entity chunks into isolated generation namespace
      await cadDatabase.saveEntityChunksForGeneration(doc.id, nextGen, doc.entities, {
        chunkSize,
        onBeforeBatch: async batchIndex => {
          if (batchIndex > 0) {
            await options?.onBeforeStage?.('mid-chunks', {
              docId: doc.id,
              generation: nextGen,
              batchIndex
            });
          }
        }
      });

      await options?.onBeforeStage?.('before-commit', { docId: doc.id, generation: nextGen });

      // Stage 3: Atomic commit pointer update on documents store
      const docRecord: StoredDocumentRecord = {
        id: doc.id,
        name: doc.name,
        projectId: doc.projectId,
        schemaVersion: doc.schemaVersion,
        header: doc.header,
        extents: doc.extents,
        nextHandleSeed: doc.nextHandleSeed,
        rawSections: doc.rawSections,
        metadata: doc.metadata,
        underlay: doc.underlay,
        entityCount: doc.entities.length,
        layerCount: Object.keys(doc.layers).length,
        chunkCount,
        committedGeneration: nextGen,
        activeGeneration: nextGen,
        saveState: 'committed',
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      };
      await cadDatabase.putRecord('documents', docRecord);
    } catch (err) {
      // Roll back staged nextGen artifacts; previously committed generation stays 100% intact
      await cleanupStagedGeneration();
      throw err;
    }

    // Stage 4: Best-effort garbage collection of superseded generations after durable commit
    void Promise.allSettled([
      cadDatabase.deleteDocRecordsExceptGeneration('layers', doc.id, nextGen),
      cadDatabase.deleteDocRecordsExceptGeneration('blocks', doc.id, nextGen),
      cadDatabase.deleteDocRecordsExceptGeneration('styles', doc.id, nextGen),
      cadDatabase.deleteDocRecordsExceptGeneration('layouts', doc.id, nextGen),
      cadDatabase.deleteDocRecordsExceptGeneration('entities', doc.id, nextGen)
    ]);

    return nextGen;
  }

  async loadDocument(docId: string): Promise<CADDocument | null> {
    const meta = await cadDatabase.getRecord<StoredDocumentRecord>('documents', docId);
    if (!meta) return null;

    const committedGen = meta.committedGeneration ?? meta.activeGeneration;
    const isGenerationScoped = typeof committedGen === 'number';
    const targetRecordKey = isGenerationScoped ? generationKey(docId, committedGen) : docId;

    const [layersRec, blocksRec, stylesRec, layoutsRec, allChunks] = await Promise.all([
      cadDatabase.getRecord<{ id: string; docId: string; layers: Record<string, CADLayer> }>(
        'layers',
        targetRecordKey
      ),
      cadDatabase.getRecord<{ id: string; docId: string; blocks: Record<string, CADBlock> }>(
        'blocks',
        targetRecordKey
      ),
      cadDatabase.getRecord<{
        id: string;
        docId: string;
        lineTypes: Record<string, CADLineType>;
        textStyles: Record<string, CADTextStyle>;
        dimStyles: Record<string, CADDimensionStyle>;
      }>('styles', targetRecordKey),
      cadDatabase.getRecord<{ id: string; docId: string; layouts: CADLayout[] }>(
        'layouts',
        targetRecordKey
      ),
      cadDatabase.getRecordsByDocId<StoredEntityChunk>('entities', docId)
    ]);

    const matchingChunks = isGenerationScoped
      ? allChunks.filter(c => c.generation === committedGen)
      : allChunks.filter(c => c.generation === undefined);

    const sortedChunks = [...matchingChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const entities: CADEntity[] = [];
    for (const c of sortedChunks) {
      entities.push(...c.entities);
    }

    return {
      id: meta.id,
      name: meta.name,
      projectId: meta.projectId,
      schemaVersion: meta.schemaVersion,
      header: meta.header,
      layers: layersRec?.layers || {},
      lineTypes: stylesRec?.lineTypes || {},
      textStyles: stylesRec?.textStyles || {},
      dimStyles: stylesRec?.dimStyles || {},
      blocks: blocksRec?.blocks || {},
      layouts: layoutsRec?.layouts || [{ name: 'Model', tabOrder: 0, isModelSpace: true }],
      entities,
      extents: meta.extents,
      nextHandleSeed: meta.nextHandleSeed,
      rawSections: meta.rawSections,
      metadata: meta.metadata,
      underlay: meta.underlay,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt
    };
  }

  async listDocuments(): Promise<CADDocumentSummary[]> {
    const records = await cadDatabase.getAllRecords<StoredDocumentRecord>('documents');
    return records
      .map(r => ({
        id: r.id,
        name: r.name,
        projectId: r.projectId,
        entityCount: r.entityCount ?? 0,
        layerCount: r.layerCount ?? 0,
        updatedAt: r.updatedAt,
        acadVersion: r.metadata?.acadVersion || r.header?.$ACADVER || 'AC1015',
        sourceFileName: r.metadata?.sourceFileName || `${r.name}.dxf`
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listDocumentsForProject(projectId: string): Promise<CADDocumentSummary[]> {
    const all = await this.listDocuments();
    return all.filter(d => d.projectId === projectId);
  }

  async deleteDocument(docId: string): Promise<void> {
    await Promise.all([
      cadDatabase.deleteRecord('documents', docId),
      cadDatabase.deleteRecordsByDocId('layers', docId),
      cadDatabase.deleteRecordsByDocId('blocks', docId),
      cadDatabase.deleteRecordsByDocId('styles', docId),
      cadDatabase.deleteRecordsByDocId('layouts', docId),
      cadDatabase.deleteRecordsByDocId('entities', docId),
      cadDatabase.deleteRecordsByDocId('revisions', docId),
      cadDatabase.deleteRecordsByDocId('attachments', docId)
    ]);
  }

  async deleteDocumentsForProject(projectId: string): Promise<number> {
    if (!projectId) return 0;
    const docs = await this.listDocumentsForProject(projectId);
    for (const summary of docs) {
      await this.deleteDocument(summary.id);
    }
    return docs.length;
  }

  async cloneDocumentsForProject(sourceProjectId: string, targetProjectId: string): Promise<CADDocument[]> {
    if (!sourceProjectId || !targetProjectId || sourceProjectId === targetProjectId) return [];
    const summaries = await this.listDocumentsForProject(sourceProjectId);
    const clonedDocs: CADDocument[] = [];
    const now = new Date().toISOString();

    for (const summary of summaries) {
      const sourceDoc = await this.loadDocument(summary.id);
      if (!sourceDoc) continue;
      const cloned: CADDocument = {
        ...structuredClone(sourceDoc),
        id: createCadId('cad'),
        projectId: targetProjectId,
        createdAt: now,
        updatedAt: now
      };
      await this.saveDocument(cloned);
      clonedDocs.push(cloned);
    }

    return clonedDocs;
  }
}

export const cadRepository = new CADRepository();
