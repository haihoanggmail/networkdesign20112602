import type { CADDocument } from '../core/CADTypes';
import { cadRepository } from './CADRepository';

export class CADAutosaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingDoc: CADDocument | null = null;
  private pendingOnSaved?: (docId: string) => void;
  private onErrorHandler?: (err: Error, docId: string) => void;
  private inFlightPromise: Promise<void> | null = null;
  private readonly delayMs: number;
  private readonly saveFn: (doc: CADDocument) => Promise<unknown>;

  constructor(
    delayMs = 1000,
    options?: {
      onError?: (err: Error, docId: string) => void;
      saveFn?: (doc: CADDocument) => Promise<unknown>;
    }
  ) {
    this.delayMs = delayMs;
    this.onErrorHandler = options?.onError;
    this.saveFn = options?.saveFn ?? (doc => cadRepository.saveDocument(doc));
  }

  setOnError(handler: ((err: Error, docId: string) => void) | undefined): void {
    this.onErrorHandler = handler;
  }

  isSaving(): boolean {
    return this.inFlightPromise !== null;
  }

  getPendingDocId(): string | null {
    return this.pendingDoc?.id ?? null;
  }

  private async drainQueue(rethrowError = false): Promise<void> {
    while (this.inFlightPromise || this.pendingDoc) {
      if (this.inFlightPromise) {
        try {
          await this.inFlightPromise;
        } catch (err) {
          if (rethrowError && !this.pendingDoc) {
            throw err;
          }
        }
        continue;
      }

      const target = this.pendingDoc!;
      const onSaved = this.pendingOnSaved;
      this.pendingDoc = null;
      this.pendingOnSaved = undefined;

      const exec = (async () => {
        try {
          await this.saveFn(target);
          onSaved?.(target.id);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.onErrorHandler?.(error, target.id);
          throw error;
        }
      })();

      this.inFlightPromise = exec;
      try {
        await exec;
      } catch (err) {
        if (rethrowError && !this.pendingDoc) {
          throw err;
        }
      } finally {
        if (this.inFlightPromise === exec) {
          this.inFlightPromise = null;
        }
      }
    }
  }

  schedule(doc: CADDocument, onSaved?: (docId: string) => void): void {
    this.pendingDoc = doc;
    this.pendingOnSaved = onSaved;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drainQueue(false);
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.drainQueue(true);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingDoc = null;
    this.pendingOnSaved = undefined;
  }
}

export const cadAutosave = new CADAutosaveController(1000);
