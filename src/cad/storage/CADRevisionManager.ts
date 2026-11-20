import { cloneCADDocument } from '../core/CADDocument';
import { createCadId } from '../core/CADRegistry';
import type { CADDocument } from '../core/CADTypes';
import { cadDatabase } from './CADDatabase';

export interface CADRevisionSnapshot {
  id: string;
  docId: string;
  labelVi: string;
  createdAt: string;
  entityCount: number;
  snapshot: CADDocument;
}

export class CADRevisionManager {
  async createRevision(doc: CADDocument, labelVi = 'Bản lưu thủ công'): Promise<CADRevisionSnapshot> {
    const rev: CADRevisionSnapshot = {
      id: createCadId('rev'),
      docId: doc.id,
      labelVi,
      createdAt: new Date().toISOString(),
      entityCount: doc.entities.length,
      snapshot: cloneCADDocument(doc)
    };
    await cadDatabase.putRecord('revisions', rev);
    return rev;
  }

  async listRevisions(docId: string): Promise<CADRevisionSnapshot[]> {
    const all = await cadDatabase.getRecordsByDocId<CADRevisionSnapshot>('revisions', docId);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async restoreRevision(revisionId: string): Promise<CADDocument | null> {
    const rev = await cadDatabase.getRecord<CADRevisionSnapshot>('revisions', revisionId);
    if (!rev) return null;
    const restored = cloneCADDocument(rev.snapshot);
    restored.updatedAt = new Date().toISOString();
    return restored;
  }
}

export const cadRevisionManager = new CADRevisionManager();
