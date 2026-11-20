import type { CADDocument } from '../core/CADTypes';
import { recomputeDocumentExtents } from '../geometry/CADBounds';
import type { CADCommand } from './CADCommand';

export interface CADCommandLogEntry {
  id: string;
  timestamp: string;
  action: 'execute' | 'undo' | 'redo';
  labelVi: string;
}

export class CADCommandManager {
  private undoStack: CADCommand[] = [];
  private redoStack: CADCommand[] = [];
  private executionLog: CADCommandLogEntry[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth = 100) {
    this.maxDepth = Math.max(10, maxDepth);
  }

  private pushLog(action: CADCommandLogEntry['action'], cmd: CADCommand): void {
    this.executionLog.unshift({
      id: `${cmd.id}_${action}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action,
      labelVi: cmd.labelVi
    });
    if (this.executionLog.length > this.maxDepth) {
      this.executionLog.length = this.maxDepth;
    }
  }

  execute(doc: CADDocument, command: CADCommand): CADDocument {
    const next = command.execute(doc);
    next.extents = recomputeDocumentExtents(next);
    next.updatedAt = new Date().toISOString();

    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.pushLog('execute', command);
    return next;
  }

  undo(doc: CADDocument): CADDocument | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    const prev = cmd.undo(doc);
    prev.extents = recomputeDocumentExtents(prev);
    prev.updatedAt = new Date().toISOString();
    this.redoStack.push(cmd);
    this.pushLog('undo', cmd);
    return prev;
  }

  redo(doc: CADDocument): CADDocument | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    const next = cmd.execute(doc);
    next.extents = recomputeDocumentExtents(next);
    next.updatedAt = new Date().toISOString();
    this.undoStack.push(cmd);
    this.pushLog('redo', cmd);
    return next;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  peekUndoLabel(): string | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].labelVi : null;
  }

  peekRedoLabel(): string | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].labelVi : null;
  }

  getHistory(): { undoLabels: string[]; redoLabels: string[] } {
    return {
      undoLabels: [...this.undoStack].reverse().map(c => c.labelVi),
      redoLabels: [...this.redoStack].reverse().map(c => c.labelVi)
    };
  }

  getExecutionLog(): CADCommandLogEntry[] {
    return [...this.executionLog];
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.executionLog = [];
  }
}
