import type { ProjectState } from '../types/infrastructure';
import { computeBatchProjectCableRoutes, BatchCableRouteUpdate } from '../utils/cableRouting';
import { runEngineeringAudit, AuditReport } from '../utils/engineeringValidator';
import {
  prepareRecoveryEnvelopePayload,
  type PreparedRecoveryEnvelopePayload,
  type RecoverySnapshotEnvelope
} from '../utils/projectStorage';

export type ComputeWorkerRequest =
  | { requestId: number; type: 'RUN_AUDIT'; project: ProjectState }
  | { requestId: number; type: 'AUTO_ROUTE_BATCH'; project: ProjectState }
  | {
      requestId: number;
      type: 'PREPARE_RECOVERY_ENVELOPE';
      project: ProjectState;
      reason: RecoverySnapshotEnvelope['reason'];
    };

export type ComputeWorkerResponse =
  | { requestId: number; ok: true; type: 'RUN_AUDIT'; report: AuditReport }
  | { requestId: number; ok: true; type: 'AUTO_ROUTE_BATCH'; updates: BatchCableRouteUpdate[] }
  | {
      requestId: number;
      ok: true;
      type: 'PREPARE_RECOVERY_ENVELOPE';
      payload: PreparedRecoveryEnvelopePayload;
    }
  | { requestId: number; ok: false; error: string };

interface WorkerScopeLike {
  onmessage: ((ev: MessageEvent<ComputeWorkerRequest>) => void) | null;
  postMessage: (msg: ComputeWorkerResponse) => void;
}

const workerScope = globalThis as unknown as WorkerScopeLike;

if (typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = (event: MessageEvent<ComputeWorkerRequest>) => {
    const payload = event.data;
    if (!payload || typeof payload.requestId !== 'number') return;

    try {
      if (payload.type === 'RUN_AUDIT') {
        const report = runEngineeringAudit(payload.project);
        workerScope.postMessage({
          requestId: payload.requestId,
          ok: true,
          type: 'RUN_AUDIT',
          report
        });
        return;
      }

      if (payload.type === 'AUTO_ROUTE_BATCH') {
        const updates = computeBatchProjectCableRoutes(payload.project);
        workerScope.postMessage({
          requestId: payload.requestId,
          ok: true,
          type: 'AUTO_ROUTE_BATCH',
          updates
        });
        return;
      }

      if (payload.type === 'PREPARE_RECOVERY_ENVELOPE') {
        const prepared = prepareRecoveryEnvelopePayload(payload.project, payload.reason);
        if (!prepared.ok) {
          workerScope.postMessage({
            requestId: payload.requestId,
            ok: false,
            error: prepared.error
          });
          return;
        }
        workerScope.postMessage({
          requestId: payload.requestId,
          ok: true,
          type: 'PREPARE_RECOVERY_ENVELOPE',
          payload: prepared.payload
        });
        return;
      }
    } catch (err: unknown) {
      workerScope.postMessage({
        requestId: payload.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  };
}
