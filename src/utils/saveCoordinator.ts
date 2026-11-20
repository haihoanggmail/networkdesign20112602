export type PersistResult = { ok: true } | { ok: false; error: string };

export interface SaveCoordinatorStatus {
  dirtyVersion: number;
  committedVersion: number;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  storageError: string | null;
}

export interface SaveFlushResult {
  ok: boolean;
  error: string | null;
  committedVersion: number;
  dirtyVersion: number;
}

export interface SaveCoordinatorOptions<T> {
  debounceMs?: number;
  stampSnapshot?: (snapshot: T, savedAtIso: string) => T;
  onPersist: (snapshot: T, version: number) => Promise<PersistResult>;
  onPersistSuccess?: (snapshot: T, version: number) => void;
  onStatusChange?: (status: SaveCoordinatorStatus) => void;
  shouldDeferAutoSave?: () => boolean;
}

export interface SaveCoordinator<T> {
  getStatus: () => SaveCoordinatorStatus;
  markDirty: (snapshot: T) => number;
  scheduleSave: (snapshot: T, delayOverrideMs?: number) => number;
  saveNow: (snapshot?: T) => Promise<SaveFlushResult>;
  flush: (latestSnapshot?: T) => Promise<SaveFlushResult>;
  reset: (cleanSnapshot?: T, savedAt?: string | null) => void;
  dispose: () => void;
}

/**
 * Single-flight serialized Save Coordinator with monotonic dirty/committed versioning.
 * Guarantees:
 * - At most one IO persist call executes at any instant.
 * - Edits arriving mid-save bump `dirtyVersion`, keep `hasUnsavedChanges = true`, and drain automatically after the in-flight write resolves.
 * - Older async completions never clear unsaved state or overwrite newer state.
 * - Failed persists preserve `hasUnsavedChanges = true` and surface `storageError`.
 * - `flush()` awaits active IO and drains all pending dirty versions before project switches/imports.
 */
export function createSaveCoordinator<T>(options: SaveCoordinatorOptions<T>): SaveCoordinator<T> {
  const debounceMs = Math.max(0, options.debounceMs ?? 600);

  let dirtyVersion = 0;
  let committedVersion = 0;
  let generation = 0;
  let hasUnsavedChanges = false;
  let isSaving = false;
  let lastSavedAt: string | null = null;
  let storageError: string | null = null;
  let latestSnapshot: T | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeDrainPromise: Promise<SaveFlushResult> | null = null;
  let disposed = false;

  const emitStatus = () => {
    options.onStatusChange?.({
      dirtyVersion,
      committedVersion,
      hasUnsavedChanges,
      isSaving,
      lastSavedAt,
      storageError
    });
  };

  const clearDebounceTimer = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const runDrainLoop = async (): Promise<SaveFlushResult> => {
    if (activeDrainPromise) {
      return activeDrainPromise;
    }

    const opGeneration = generation;
    const drainPromise = (async (): Promise<SaveFlushResult> => {
      while (!disposed && opGeneration === generation && committedVersion < dirtyVersion && latestSnapshot !== undefined) {
        const targetVersion = dirtyVersion;
        const savedAtIso = new Date().toISOString();
        const candidate = options.stampSnapshot
          ? options.stampSnapshot(latestSnapshot, savedAtIso)
          : latestSnapshot;

        isSaving = true;
        emitStatus();

        let res: PersistResult;
        try {
          res = await options.onPersist(candidate, targetVersion);
        } catch (err) {
          res = {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }

        if (disposed || opGeneration !== generation) {
          return {
            ok: false,
            error: disposed ? 'SaveCoordinator disposed' : 'SaveCoordinator reset during persist',
            committedVersion,
            dirtyVersion
          };
        }

        if (res.ok) {
          committedVersion = Math.max(committedVersion, targetVersion);
          lastSavedAt = savedAtIso;
          storageError = null;
          hasUnsavedChanges = dirtyVersion > committedVersion;

          try {
            options.onPersistSuccess?.(candidate, targetVersion);
          } catch {
            // Recovery side-effect failure must never corrupt primary commit status
          }

          if (dirtyVersion > committedVersion) {
            // Newer changes arrived while IO was in flight; continue draining immediately
            emitStatus();
            continue;
          }

          isSaving = false;
          emitStatus();
          return {
            ok: true,
            error: null,
            committedVersion,
            dirtyVersion
          };
        } else {
          // Persist failed: retain dirty status and report error clearly
          isSaving = false;
          storageError = res.error;
          hasUnsavedChanges = true;
          emitStatus();
          return {
            ok: false,
            error: res.error,
            committedVersion,
            dirtyVersion
          };
        }
      }

      if (!disposed && opGeneration === generation) {
        isSaving = false;
        emitStatus();
      }
      return {
        ok: storageError === null,
        error: storageError,
        committedVersion,
        dirtyVersion
      };
    })();

    activeDrainPromise = drainPromise;
    try {
      return await drainPromise;
    } finally {
      if (activeDrainPromise === drainPromise) {
        activeDrainPromise = null;
      }
    }
  };

  const markDirty = (snapshot: T): number => {
    latestSnapshot = snapshot;
    dirtyVersion += 1;
    hasUnsavedChanges = true;
    emitStatus();
    return dirtyVersion;
  };

  const scheduleFlushAfterDelay = (delayMs: number) => {
    clearDebounceTimer();
    if (disposed) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (disposed) return;
      if (options.shouldDeferAutoSave?.()) {
        // Keep re-deferring until user finishes dragging or interaction ends
        scheduleFlushAfterDelay(Math.max(10, delayMs));
        return;
      }
      void runDrainLoop();
    }, delayMs);
  };

  const scheduleSave = (snapshot: T, delayOverrideMs?: number): number => {
    const ver = markDirty(snapshot);
    const waitMs = Math.max(0, delayOverrideMs ?? debounceMs);
    scheduleFlushAfterDelay(waitMs);
    return ver;
  };

  const saveNow = async (snapshot?: T): Promise<SaveFlushResult> => {
    clearDebounceTimer();
    if (snapshot !== undefined) {
      markDirty(snapshot);
    } else if (committedVersion >= dirtyVersion && latestSnapshot !== undefined) {
      // Explicit save request stamps a fresh commit even if already clean
      dirtyVersion += 1;
      hasUnsavedChanges = true;
      emitStatus();
    }
    return runDrainLoop();
  };

  const flush = async (latest?: T): Promise<SaveFlushResult> => {
    clearDebounceTimer();
    if (latest !== undefined && dirtyVersion > committedVersion) {
      latestSnapshot = latest;
    } else if (latest !== undefined && latestSnapshot === undefined) {
      latestSnapshot = latest;
    }
    if (committedVersion >= dirtyVersion && !activeDrainPromise) {
      return {
        ok: storageError === null,
        error: storageError,
        committedVersion,
        dirtyVersion
      };
    }
    const result = await runDrainLoop();
    // If new edits queued synchronously during final microtask, drain once more
    if (!disposed && result.ok && dirtyVersion > committedVersion) {
      return runDrainLoop();
    }
    return result;
  };

  const reset = (cleanSnapshot?: T, savedAt: string | null = null) => {
    clearDebounceTimer();
    generation += 1;
    activeDrainPromise = null;
    dirtyVersion += 1;
    committedVersion = dirtyVersion;
    latestSnapshot = cleanSnapshot;
    hasUnsavedChanges = false;
    isSaving = false;
    storageError = null;
    lastSavedAt = savedAt;
    emitStatus();
  };

  const dispose = () => {
    disposed = true;
    clearDebounceTimer();
  };

  return {
    getStatus: () => ({
      dirtyVersion,
      committedVersion,
      hasUnsavedChanges,
      isSaving,
      lastSavedAt,
      storageError
    }),
    markDirty,
    scheduleSave,
    saveNow,
    flush,
    reset,
    dispose
  };
}
