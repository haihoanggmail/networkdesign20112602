import type { CADDocument } from '../core/CADTypes';

export interface CADCommand {
  readonly id: string;
  readonly labelVi: string;
  execute(doc: CADDocument): CADDocument;
  undo(doc: CADDocument): CADDocument;
}
