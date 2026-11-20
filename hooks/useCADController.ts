import { useCallback, useEffect, useRef, useState } from 'react';
import type { CADCommand } from '../cad/commands/CADCommand';
import { CADCommandLogEntry, CADCommandManager } from '../cad/commands/CADCommandManager';
import {
  computeAutoFitUnderlayDoc,
  resolveCadScaleSyncEffect,
  type CadScaleSyncReason
} from '../cad/core/CADScaleSync';
import type { CADDocument } from '../cad/core/CADTypes';
import { computeNetworkPxPerMeterFromCad } from '../cad/core/CADUnderlayTransform';
import { getCADUnitMeta } from '../cad/core/CADUnits';
import { cadAutosave } from '../cad/storage/CADAutosave';
import { cadRepository } from '../cad/storage/CADRepository';
import { cadRevisionManager } from '../cad/storage/CADRevisionManager';
import type { ProjectState } from '../types/infrastructure';

export const CAD_PROJECT_SYNC_EVENT = 'hachihi-cad-project-sync';

export function notifyCadProjectSync(projectId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CAD_PROJECT_SYNC_EVENT, { detail: { projectId } })
  );
}

export type WorkspaceMode = 'network' | 'cad';

export interface UseCADControllerOptions {
  project: ProjectState;
  onNotify?: (message: string, type?: 'info' | 'success' | 'error') => void;
  onSyncProjectScale?: (pxPerMeter: number) => void;
}

export function useCADController({ project, onNotify, onSyncProjectScale }: UseCADControllerOptions) {
  const [cadDoc, setCadDoc] = useState<CADDocument | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('network');
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [redoLabel, setRedoLabel] = useState<string | null>(null);
  const [executionLog, setExecutionLog] = useState<CADCommandLogEntry[]>([]);

  const commandManagerRef = useRef<CADCommandManager>(new CADCommandManager(100));
  const cadDocRef = useRef<CADDocument | null>(null);
  cadDocRef.current = cadDoc;
  const activeProjectIdRef = useRef<string>(project.id);
  activeProjectIdRef.current = project.id;
  const loadedProjectIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const onSyncProjectScaleRef = useRef(onSyncProjectScale);
  onSyncProjectScaleRef.current = onSyncProjectScale;

  const syncCommandFlags = useCallback(() => {
    setCanUndo(commandManagerRef.current.canUndo());
    setCanRedo(commandManagerRef.current.canRedo());
    setUndoLabel(commandManagerRef.current.peekUndoLabel());
    setRedoLabel(commandManagerRef.current.peekRedoLabel());
    setExecutionLog(commandManagerRef.current.getExecutionLog());
  }, []);

  /**
   * Deterministic commit pipeline: updates `cadDocRef` and React state together, schedules autosave,
   * refreshes command flags, and dispatches scale synchronization synchronously outside any React state updater.
   */
  const commitCadTransition = useCallback(
    (
      nextDoc: CADDocument | null,
      options: {
        reason: CadScaleSyncReason | 'load';
        autosave?: boolean;
        syncScale?: boolean;
      }
    ) => {
      const expectedPid = activeProjectIdRef.current;
      if (nextDoc && nextDoc.projectId && nextDoc.projectId !== expectedPid) {
        return;
      }
      const prevDoc = cadDocRef.current;
      cadDocRef.current = nextDoc;
      setCadDoc(nextDoc);
      syncCommandFlags();

      if (nextDoc && options.autosave !== false) {
        cadAutosave.schedule(nextDoc);
      }

      if (options.syncScale !== false && options.reason !== 'load') {
        const syncedPxPerMeter = resolveCadScaleSyncEffect(prevDoc, nextDoc, {
          reason: options.reason,
          expectedProjectId: expectedPid
        });
        if (syncedPxPerMeter !== null) {
          onSyncProjectScaleRef.current?.(syncedPxPerMeter);
        }
      }
    },
    [syncCommandFlags]
  );

  // Load most recent CAD drawing linked to the current HACHIHI project & isolate rapid project switches
  useEffect(() => {
    const pid = project.id;
    if (!pid) return;

    let cancelled = false;
    const isSwitchingProject =
      loadedProjectIdRef.current !== null && loadedProjectIdRef.current !== pid;

    if (isSwitchingProject) {
      // Flush pending autosave for the previous project before isolating state for the new project
      void cadAutosave.flush().catch(() => {
        // Ignore storage flush error on unmount/switch
      });
      if (cadDocRef.current && cadDocRef.current.projectId !== pid) {
        commandManagerRef.current.clear();
        cadDocRef.current = null;
        setCadDoc(null);
        setWorkspaceMode('network');
        syncCommandFlags();
      }
    }

    const loadLinkedCadForProject = (forceRefresh: boolean) => {
      if (!forceRefresh && loadedProjectIdRef.current === pid) return;
      loadedProjectIdRef.current = pid;
      const requestSeq = ++loadSeqRef.current;

      void cadRepository
        .listDocumentsForProject(pid)
        .then(async summaries => {
          if (
            cancelled ||
            loadSeqRef.current !== requestSeq ||
            activeProjectIdRef.current !== pid
          ) {
            return;
          }
          if (summaries.length === 0) {
            if (cadDocRef.current && (forceRefresh || cadDocRef.current.projectId !== pid)) {
              commandManagerRef.current.clear();
              cadDocRef.current = null;
              setCadDoc(null);
              setWorkspaceMode('network');
              syncCommandFlags();
            }
            return;
          }
          const loaded = await cadRepository.loadDocument(summaries[0].id);
          if (
            cancelled ||
            loadSeqRef.current !== requestSeq ||
            activeProjectIdRef.current !== pid ||
            !loaded
          ) {
            return;
          }
          if (loaded.projectId && loaded.projectId !== pid) {
            return;
          }
          commandManagerRef.current.clear();
          cadDocRef.current = loaded;
          setCadDoc(loaded);
          syncCommandFlags();
        })
        .catch(() => {
          // Ignore storage errors silently in initial load
        });
    };

    loadLinkedCadForProject(false);

    const handleSyncEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === pid) {
        loadLinkedCadForProject(true);
      }
    };
    window.addEventListener(CAD_PROJECT_SYNC_EVENT, handleSyncEvent);

    return () => {
      cancelled = true;
      window.removeEventListener(CAD_PROJECT_SYNC_EVENT, handleSyncEvent);
    };
  }, [project.id, syncCommandFlags]);

  // Flush autosave on unmount or pagehide
  useEffect(() => {
    const onPageHide = () => {
      void cadAutosave.flush();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      void cadAutosave.flush();
    };
  }, []);

  const openImportDialog = useCallback((file?: File | null) => {
    setPendingImportFile(file ?? null);
    setIsImportDialogOpen(true);
  }, []);

  const closeImportDialog = useCallback(() => {
    setIsImportDialogOpen(false);
    setPendingImportFile(null);
  }, []);

  const openCadDocument = useCallback(
    (doc: CADDocument, options?: { openInNetworkUnderlay?: boolean }) => {
      const nextDoc: CADDocument = {
        ...doc,
        projectId: project.id,
        underlay: options?.openInNetworkUnderlay
          ? { ...doc.underlay, enabled: true }
          : doc.underlay,
        updatedAt: new Date().toISOString()
      };
      commandManagerRef.current.clear();
      commitCadTransition(nextDoc, {
        reason: 'open',
        autosave: false,
        syncScale: Boolean(options?.openInNetworkUnderlay)
      });
      setWorkspaceMode(options?.openInNetworkUnderlay ? 'network' : 'cad');
      void cadRepository.saveDocument(nextDoc);
      onNotify?.(
        options?.openInNetworkUnderlay
          ? `Đã lồng bản vẽ AutoCAD "${nextDoc.name}" làm lớp nền thiết kế mạng.`
          : `Đã mở "${nextDoc.name}" trong AutoCAD Studio.`,
        'success'
      );
    },
    [commitCadTransition, onNotify, project.id]
  );

  const executeCadCommand = useCallback(
    (cmd: CADCommand) => {
      const prev = cadDocRef.current;
      if (!prev) return;
      const next = commandManagerRef.current.execute(prev, cmd);
      commitCadTransition(next, { reason: 'command' });
    },
    [commitCadTransition]
  );

  const undoCad = useCallback(() => {
    const prev = cadDocRef.current;
    if (!prev) return;
    const restored = commandManagerRef.current.undo(prev);
    if (!restored) {
      syncCommandFlags();
      return;
    }
    commitCadTransition(restored, { reason: 'undo' });
  }, [commitCadTransition, syncCommandFlags]);

  const redoCad = useCallback(() => {
    const prev = cadDocRef.current;
    if (!prev) return;
    const redone = commandManagerRef.current.redo(prev);
    if (!redone) {
      syncCommandFlags();
      return;
    }
    commitCadTransition(redone, { reason: 'redo' });
  }, [commitCadTransition, syncCommandFlags]);

  const updateCadDocumentSettings = useCallback(
    (updater: (doc: CADDocument) => CADDocument) => {
      const prev = cadDocRef.current;
      if (!prev) return;
      const next = updater(prev);
      const stamped: CADDocument = {
        ...next,
        projectId: next.projectId ?? prev.projectId,
        updatedAt: new Date().toISOString()
      };
      commitCadTransition(stamped, { reason: 'settings' });
    },
    [commitCadTransition]
  );

  const toggleCadUnderlayEnabled = useCallback(() => {
    updateCadDocumentSettings(doc => ({
      ...doc,
      underlay: {
        ...doc.underlay,
        enabled: !doc.underlay.enabled
      }
    }));
  }, [updateCadDocumentSettings]);

  const toggleCadUnderlay3D = useCallback(() => {
    updateCadDocumentSettings(doc => ({
      ...doc,
      underlay: {
        ...doc.underlay,
        showIn3D: !doc.underlay.showIn3D
      }
    }));
  }, [updateCadDocumentSettings]);

  const changeCadUnderlayOpacity = useCallback(
    (opacity: number) => {
      const clamped = Math.max(0.05, Math.min(1, opacity));
      updateCadDocumentSettings(doc => ({
        ...doc,
        underlay: {
          ...doc.underlay,
          opacity: clamped
        }
      }));
    },
    [updateCadDocumentSettings]
  );

  const toggleCadLayerVisibility = useCallback(
    (layerName: string) => {
      updateCadDocumentSettings(doc => {
        const layer = doc.layers[layerName];
        if (!layer) return doc;
        return {
          ...doc,
          layers: {
            ...doc.layers,
            [layerName]: {
              ...layer,
              visible: !layer.visible
            }
          }
        };
      });
    },
    [updateCadDocumentSettings]
  );

  const toggleCadLayerLocked = useCallback(
    (layerName: string) => {
      updateCadDocumentSettings(doc => {
        const layer = doc.layers[layerName];
        if (!layer) return doc;
        return {
          ...doc,
          layers: {
            ...doc.layers,
            [layerName]: {
              ...layer,
              locked: !layer.locked
            }
          }
        };
      });
    },
    [updateCadDocumentSettings]
  );

  const lockAllCadFloorplanLayers = useCallback(
    (lock = true) => {
      const current = cadDocRef.current;
      const count = current ? Object.keys(current.layers).length : 0;
      updateCadDocumentSettings(doc => {
        const nextLayers = { ...doc.layers };
        for (const key of Object.keys(nextLayers)) {
          nextLayers[key] = { ...nextLayers[key], locked: lock };
        }
        return {
          ...doc,
          layers: nextLayers
        };
      });
      if (count > 0) {
        onNotify?.(
          lock
            ? `Đã khóa ${count} lớp nền AutoCAD để bảo vệ mặt bằng.`
            : `Đã mở khóa ${count} lớp AutoCAD.`,
          'info'
        );
      }
    },
    [onNotify, updateCadDocumentSettings]
  );

  const syncScaleToNetworkProject = useCallback((): boolean => {
    const doc = cadDocRef.current;
    if (!doc) return false;
    const pxPerMeter = computeNetworkPxPerMeterFromCad(doc);
    if (pxPerMeter === null) {
      onNotify?.(
        'Bản vẽ CAD chưa có đơn vị thực ($INSUNITS=0). Vui lòng chọn đơn vị trong AutoCAD Studio trước khi đồng bộ.',
        'error'
      );
      return false;
    }
    onSyncProjectScaleRef.current?.(pxPerMeter);
    const unitLabel = getCADUnitMeta(doc.header.$INSUNITS).shortLabel;
    onNotify?.(
      `Đã đồng bộ tỉ lệ ${pxPerMeter} px/m từ đơn vị CAD (${unitLabel}) & cập nhật chiều dài cáp.`,
      'success'
    );
    return true;
  }, [onNotify]);

  const autoFitUnderlayToProject = useCallback(() => {
    const current = cadDocRef.current;
    if (!current) return;
    const nextDoc = computeAutoFitUnderlayDoc(current, project);
    commitCadTransition(nextDoc, { reason: 'autofit' });
    onNotify?.('Đã tự động căn khớp bản vẽ AutoCAD với sơ đồ hạ tầng mạng.', 'success');
  }, [commitCadTransition, onNotify, project]);

  const saveCadRevision = useCallback(
    async (labelVi = 'Bản lưu thủ công') => {
      const current = cadDocRef.current;
      if (!current) return;
      await cadAutosave.flush();
      await cadRepository.saveDocument(current);
      await cadRevisionManager.createRevision(current, labelVi);
      onNotify?.(`Đã lưu bản chụp AutoCAD "${current.name}" vào IndexedDB.`, 'success');
    },
    [onNotify]
  );

  const applyToNetworkDesign = useCallback(() => {
    const doc = cadDocRef.current;
    if (doc) {
      const nextDoc: CADDocument = {
        ...doc,
        underlay: {
          ...doc.underlay,
          enabled: true
        },
        updatedAt: new Date().toISOString()
      };
      commitCadTransition(nextDoc, { reason: 'apply' });
    }
    setWorkspaceMode('network');
    onNotify?.('Đã chuyển sang không gian Thiết kế Mạng với lớp nền AutoCAD đang bật.', 'info');
  }, [commitCadTransition, onNotify]);

  return {
    cadDoc,
    workspaceMode,
    setWorkspaceMode,
    isImportDialogOpen,
    pendingImportFile,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    executionLog,
    openImportDialog,
    closeImportDialog,
    openCadDocument,
    executeCadCommand,
    undoCad,
    redoCad,
    updateCadDocumentSettings,
    toggleCadUnderlayEnabled,
    toggleCadUnderlay3D,
    changeCadUnderlayOpacity,
    toggleCadLayerVisibility,
    toggleCadLayerLocked,
    lockAllCadFloorplanLayers,
    syncScaleToNetworkProject,
    autoFitUnderlayToProject,
    saveCadRevision,
    applyToNetworkDesign
  };
}
