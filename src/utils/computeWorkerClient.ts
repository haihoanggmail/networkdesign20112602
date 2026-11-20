import { useEffect, useRef, useState } from 'react';
import { ProjectState } from '../types/infrastructure';
import { BatchCableRouteUpdate, computeBatchProjectCableRoutes } from './cableRouting';
import { AuditReport, runEngineeringAudit } from './engineeringValidator';
import {
  commitPreparedRecoveryEnvelope,
  prepareRecoveryEnvelopePayload,
  type PreparedRecoveryEnvelopePayload,
  type RecoverySnapshotEnvelope
} from './projectStorage';
import type { ComputeWorkerRequest, ComputeWorkerResponse } from '../workers/infrastructureCompute.worker';

interface PendingRequest {
  resolve: (value: ComputeWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  timerId: ReturnType<typeof setTimeout>;
}

const DEFAULT_WORKER_TIMEOUT_MS = 8000;

let sharedWorker: Worker | null = null;
let workerFailedToBoot = false;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

function getOrCreateComputeWorker(): Worker | null {
  if (workerFailedToBoot || typeof Worker === 'undefined') {
    return null;
  }
  if (sharedWorker) return sharedWorker;

  try {
    const w = new Worker(new URL('../workers/infrastructureCompute.worker.ts', import.meta.url), {
      type: 'module'
    });
    w.onmessage = (ev: MessageEvent<ComputeWorkerResponse>) => {
      const msg = ev.data;
      if (!msg || typeof msg.requestId !== 'number') return;
      const pending = pendingRequests.get(msg.requestId);
      if (!pending) return;
      clearTimeout(pending.timerId);
      pendingRequests.delete(msg.requestId);
      if (msg.ok) {
        pending.resolve(msg);
      } else {
        pending.reject(new Error(msg.error));
      }
    };
    w.onerror = () => {
      workerFailedToBoot = true;
      sharedWorker = null;
      for (const [reqId, pending] of pendingRequests.entries()) {
        clearTimeout(pending.timerId);
        pending.reject(new Error('Compute worker encountered a runtime error'));
        pendingRequests.delete(reqId);
      }
      try {
        w.terminate();
      } catch {
        // ignore termination error
      }
    };
    sharedWorker = w;
    return sharedWorker;
  } catch {
    workerFailedToBoot = true;
    return null;
  }
}

export function disposeComputeWorkerForTests(): void {
  if (sharedWorker) {
    try {
      sharedWorker.terminate();
    } catch {
      // ignore
    }
    sharedWorker = null;
  }
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timerId);
  }
  pendingRequests.clear();
  workerFailedToBoot = false;
}

async function dispatchWorkerTask<T extends ComputeWorkerResponse>(
  buildPayload: (requestId: number) => ComputeWorkerRequest,
  fallbackCompute: () => T,
  timeoutMs = DEFAULT_WORKER_TIMEOUT_MS
): Promise<T> {
  const worker = getOrCreateComputeWorker();
  if (!worker) {
    return fallbackCompute();
  }

  const requestId = nextRequestId++;
  try {
    const response = await new Promise<ComputeWorkerResponse>((resolve, reject) => {
      const timerId = setTimeout(() => {
        pendingRequests.delete(requestId);
        if (sharedWorker === worker) {
          sharedWorker = null;
        }
        try {
          worker.terminate();
        } catch {
          // ignore termination error
        }
        reject(new Error(`Compute worker timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timerId });

      try {
        worker.postMessage(buildPayload(requestId));
      } catch (postErr) {
        clearTimeout(timerId);
        pendingRequests.delete(requestId);
        reject(postErr);
      }
    });
    return response as T;
  } catch {
    return fallbackCompute();
  }
}

export async function runEngineeringAuditOffThread(project: ProjectState): Promise<AuditReport> {
  const res = await dispatchWorkerTask<Extract<ComputeWorkerResponse, { type: 'RUN_AUDIT' }>>(
    requestId => ({ requestId, type: 'RUN_AUDIT', project }),
    () => ({
      requestId: 0,
      ok: true,
      type: 'RUN_AUDIT',
      report: runEngineeringAudit(project)
    })
  );
  return res.report;
}

export async function runBatchAutoRouteOffThread(project: ProjectState): Promise<BatchCableRouteUpdate[]> {
  const res = await dispatchWorkerTask<Extract<ComputeWorkerResponse, { type: 'AUTO_ROUTE_BATCH' }>>(
    requestId => ({ requestId, type: 'AUTO_ROUTE_BATCH', project }),
    () => ({
      requestId: 0,
      ok: true,
      type: 'AUTO_ROUTE_BATCH',
      updates: computeBatchProjectCableRoutes(project)
    })
  );
  return res.updates;
}

export async function prepareRecoveryEnvelopeOffThread(
  project: ProjectState,
  reason: RecoverySnapshotEnvelope['reason'] = 'autosave'
): Promise<{ ok: true; payload: PreparedRecoveryEnvelopePayload } | { ok: false; error: string }> {
  try {
    const res = await dispatchWorkerTask<Extract<ComputeWorkerResponse, { type: 'PREPARE_RECOVERY_ENVELOPE' }>>(
      requestId => ({ requestId, type: 'PREPARE_RECOVERY_ENVELOPE', project, reason }),
      () => {
        const prepared = prepareRecoveryEnvelopePayload(project, reason);
        if (!prepared.ok) {
          throw new Error(prepared.error);
        }
        return {
          requestId: 0,
          ok: true,
          type: 'PREPARE_RECOVERY_ENVELOPE',
          payload: prepared.payload
        };
      }
    );
    return { ok: true, payload: res.payload };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

let recoverySequence = 0;

export async function saveRecoverySnapshotOffThread(
  project: ProjectState,
  reason: RecoverySnapshotEnvelope['reason'] = 'autosave'
): Promise<
  | { ok: true; envelope: RecoverySnapshotEnvelope; skippedLocalStorageQuota?: boolean; superseded?: boolean }
  | { ok: false; error: string }
> {
  const seq = ++recoverySequence;
  const prepared = await prepareRecoveryEnvelopeOffThread(project, reason);
  if (!prepared.ok) {
    return prepared;
  }
  if (seq !== recoverySequence) {
    return { ok: true, envelope: prepared.payload.envelope, superseded: true };
  }
  return commitPreparedRecoveryEnvelope(
    prepared.payload.envelope,
    prepared.payload.serializedPrimary
  );
}

/**
 * Debounced non-blocking hook running engineering validation on the Web Worker
 * so interactive node dragging and canvas panning stay smooth at 60 FPS.
 */
export function useAsyncEngineeringAudit(project: ProjectState, debounceMs = 140): AuditReport {
  const [report, setReport] = useState<AuditReport>(() => runEngineeringAudit(project));
  const latestSeqRef = useRef(0);
  const firstMountRef = useRef(true);

  useEffect(() => {
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }

    const seq = ++latestSeqRef.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void runEngineeringAuditOffThread(project).then(nextReport => {
        if (!cancelled && seq === latestSeqRef.current) {
          setReport(nextReport);
        }
      });
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project, debounceMs]);

  return report;
}
