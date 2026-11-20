import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CableTray,
  ProjectState,
  ProjectSummary,
  DiagramNode,
  DeviceAsset,
  Room,
  Floor,
  ServerRack,
  Building,
  RackSide,
  ProjectRevision,
  ProjectSnapshot,
  ProjectSnapshotTrigger
} from '../types/infrastructure';
import { isLayerLocked, isTrayEffectivelyLocked } from '../utils/layerPolicy';
import { createFiveStoreyBuildingProject } from '../data/defaultStarterTemplate';
import { DEVICE_CATALOG, createDeviceAssetFromPreset } from '../data/deviceCatalog';
import {
  getAssetUHeight,
  canPlaceDeviceAtU,
  clampStartU,
  findNearestAvailableU,
  getCanvasRackHeight,
  clampRackUnits
} from '../utils/rackGeometry';
import {
  PRIMARY_STORAGE_KEY,
  RECOVERY_STORAGE_KEY,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CANVAS_SETTINGS,
  AUTO_SNAPSHOT_INTERVAL_MS,
  safeLoadFromStorage,
  saveProjectToDB,
  listProjectsFromDB,
  loadProjectFromDB,
  setProjectTrashStateInDB,
  deleteProjectPermanentlyFromDB,
  requestPersistentStorage,
  getMetaValue,
  setMetaValue,
  migrateAndValidateProject,
  saveRevisionToDB,
  listRevisionsFromDB,
  deleteRevisionFromDB,
  saveProjectSnapshotToDB,
  listProjectSnapshotsFromDB,
  deleteProjectSnapshotFromDB,
  saveRecoverySnapshot,
  loadLatestValidRecoverySnapshot,
  toProjectSummaryFromState
} from '../utils/projectStorage';
import { saveRecoverySnapshotOffThread } from '../utils/computeWorkerClient';
import { createSaveCoordinator, SaveCoordinator } from '../utils/saveCoordinator';
import { trackSave, trackTemplate } from '../services/tracker';
import type { TemplateCatalogEntry } from '../services/templateLibrary';
import { findNextAvailableIpInProject, isIpAssignableCategory } from '../utils/ipAutoAssign';
import { cadRepository } from '../cad/storage/CADRepository';
import { notifyCadProjectSync } from '../hooks/useCADController';
import {
  pruneOrphanAssets,
  pruneOrphanPatchLinks,
  syncAssetPortsWithCables
} from './slices/rackDeviceHelpers';
import { useUIStateSlice, CanvasTool } from './slices/useUIStateSlice';
import {
  useNodesSlice,
  applySmartCopyPasteToProject,
  type SmartCopyPasteOptions,
  type SmartCopyPasteResult
} from './slices/useNodesSlice';
import { useCablesSlice } from './slices/useCablesSlice';
import { useProjectSettingsSlice } from './slices/useProjectSettingsSlice';

export type { CanvasTool, SmartCopyPasteOptions, SmartCopyPasteResult };
export { syncAssetPortsWithCables, pruneOrphanAssets, applySmartCopyPasteToProject };

const MAX_HISTORY_STEPS = 40;
const AUTOSAVE_DEBOUNCE_MS = 750;

export function areStatesStructurallyEqual(a: ProjectState, b: ProjectState): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.schemaVersion === b.schemaVersion &&
    a.name === b.name &&
    a.author === b.author &&
    a.version === b.version &&
    a.activeMode === b.activeMode &&
    a.activeBuildingId === b.activeBuildingId &&
    a.activeFloorId === b.activeFloorId &&
    a.buildings === b.buildings &&
    a.floors === b.floors &&
    a.rooms === b.rooms &&
    a.racks === b.racks &&
    a.assets === b.assets &&
    a.nodes === b.nodes &&
    a.cables === b.cables &&
    a.cableTrays === b.cableTrays &&
    a.vlans === b.vlans &&
    a.subnets === b.subnets &&
    a.patchLinks === b.patchLinks &&
    a.settings === b.settings
  );
}

export function createEmptyProject(name = 'HACHIHI Dự án Mới'): ProjectState {
  const now = new Date().toISOString();
  return {
    id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name,
    author: 'Kỹ sư Hạ tầng',
    version: '4.1.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastModified: now,
    lastSavedAt: now,
    buildings: [],
    floors: [
      {
        id: 'flr_1',
        buildingId: 'bld_1',
        level: 1,
        name: 'Tầng 1 - Mặt bằng chính',
        description: 'Mặt bằng thiết kế mặc định',
        widthMeters: 30,
        depthMeters: 20
      }
    ],
    rooms: [],
    racks: [],
    assets: {},
    nodes: [],
    cables: [],
    activeMode: 'topology',
    activeBuildingId: 'bld_1',
    activeFloorId: 'flr_1',
    settings: { ...DEFAULT_CANVAS_SETTINGS }
  };
}

function loadSyncFallbackProject(): { project: ProjectState; hadLegacyLocal: boolean } {
  const fromPrimary = safeLoadFromStorage(PRIMARY_STORAGE_KEY);
  if (fromPrimary) return { project: fromPrimary, hadLegacyLocal: true };
  const fromRing = loadLatestValidRecoverySnapshot();
  if (fromRing) return { project: fromRing.project, hadLegacyLocal: true };
  const fromRecovery = safeLoadFromStorage(RECOVERY_STORAGE_KEY);
  if (fromRecovery) return { project: fromRecovery, hadLegacyLocal: true };
  const fallback = createFiveStoreyBuildingProject();
  return {
    project: {
      ...fallback,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastSavedAt: new Date().toISOString()
    },
    hadLegacyLocal: false
  };
}

export function useProjectStore() {
  const [initialBoot] = useState(() => loadSyncFallbackProject());

  // Primary Project State
  const [project, setProject] = useState<ProjectState>(initialBoot.project);
  const projectRef = useRef<ProjectState>(project);
  projectRef.current = project;
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(false);

  // History stack using structural sharing (no JSON.stringify per step)
  const [history, setHistory] = useState<ProjectState[]>([initialBoot.project]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const historyRef = useRef<ProjectState[]>([initialBoot.project]);
  const historyIndexRef = useRef<number>(0);
  const dragPreSnapshotRef = useRef<ProjectState | null>(null);
  const isInteractingRef = useRef<boolean>(false);

  // Save state tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string>(
    initialBoot.project.lastSavedAt || new Date().toISOString()
  );
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const hydratedRef = useRef<boolean>(false);
  const suppressNextAutoSaveRef = useRef<boolean>(true);
  const dirtyTrackingRef = useRef<{ version: number }>({ version: 0 });
  const unsavedFlagRef = useRef<boolean>(false);
  const transitionSeqRef = useRef<number>(0);
  const coordinatorRef = useRef<SaveCoordinator<ProjectState> | null>(null);
  const isAdminDraftModeRef = useRef<boolean>(false);
  const [isAdminTemplateMode, setIsAdminTemplateMode] = useState<boolean>(false);
  const savedUserSessionRef = useRef<{
    project: ProjectState;
    history: ProjectState[];
    historyIndex: number;
    lastSavedAt: string;
    hasUnsavedChanges: boolean;
  } | null>(null);

  // Isolated UI & Viewport Interaction Slice
  const {
    activeTool,
    setActiveTool,
    selection,
    setSelection,
    selectItem,
    toggleNodeSelection,
    selectMultipleNodes,
    clearSelection,
    zoom,
    setZoom,
    pan,
    setPan,
    connectingSource,
    setConnectingSource,
    deepInspectId,
    setDeepInspectId,
    copiedStyle,
    setCopiedStyle,
    smartClipboardNodeIds,
    setSmartClipboardNodeIds
  } = useUIStateSlice();

  // Named Project Revisions
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  // Periodic IndexedDB Snapshots (Auto every 10 min + Manual + Pre-Restore)
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [lastAutoSnapshotAt, setLastAutoSnapshotAt] = useState<string | null>(null);
  const lastSnapshotAttemptAtRef = useRef<number>(Date.now());

  const refreshRevisions = useCallback(async (targetProjectId?: string) => {
    const pid = targetProjectId || project.id;
    const list = await listRevisionsFromDB(pid);
    setRevisions(list);
    return list;
  }, [project.id]);

  const refreshSnapshots = useCallback(async (targetProjectId?: string) => {
    const pid = targetProjectId || project.id;
    const list = await listProjectSnapshotsFromDB(pid);
    setSnapshots(list);
    const latestAuto = list.find(s => s.trigger === 'auto_interval');
    setLastAutoSnapshotAt(latestAuto?.createdAt ?? list[0]?.createdAt ?? null);
    return list;
  }, [project.id]);

  useEffect(() => {
    let active = true;
    listRevisionsFromDB(project.id).then(list => {
      if (active) setRevisions(list);
    });
    listProjectSnapshotsFromDB(project.id).then(list => {
      if (!active) return;
      setSnapshots(list);
      const latestAuto = list.find(s => s.trigger === 'auto_interval');
      setLastAutoSnapshotAt(latestAuto?.createdAt ?? list[0]?.createdAt ?? null);
    });
    return () => {
      active = false;
    };
  }, [project.id]);

  // Automatic periodic IndexedDB snapshot every 10 minutes
  useEffect(() => {
    let active = true;

    const runPeriodicSnapshot = async () => {
      if (!active || !hydratedRef.current || isInteractingRef.current) return;
      lastSnapshotAttemptAtRef.current = Date.now();
      const res = await saveProjectSnapshotToDB(projectRef.current, {
        trigger: 'auto_interval',
        skipIfUnchanged: true
      });
      if (!active || !res.ok) return;
      const list = await listProjectSnapshotsFromDB(projectRef.current.id);
      if (!active) return;
      setSnapshots(list);
      const latestAuto = list.find(s => s.trigger === 'auto_interval');
      setLastAutoSnapshotAt(latestAuto?.createdAt ?? res.snapshot?.createdAt ?? null);
    };

    const intervalId = window.setInterval(() => {
      void runPeriodicSnapshot();
    }, AUTO_SNAPSHOT_INTERVAL_MS);

    const handleVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastSnapshotAttemptAtRef.current >= AUTO_SNAPSHOT_INTERVAL_MS
      ) {
        void runPeriodicSnapshot();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const refreshProjectList = useCallback(async () => {
    const list = await listProjectsFromDB();
    setProjectList(list);
    return list;
  }, []);

  if (!coordinatorRef.current) {
    coordinatorRef.current = createSaveCoordinator<ProjectState>({
      debounceMs: AUTOSAVE_DEBOUNCE_MS,
      stampSnapshot: (snap, savedAtIso) => ({
        ...snap,
        lastSavedAt: savedAtIso
      }),
      onPersist: async (stampedSnapshot) => saveProjectToDB(stampedSnapshot),
      onPersistSuccess: (stampedSnapshot) => {
        void saveRecoverySnapshotOffThread(stampedSnapshot, 'autosave');
        const nextSummary = toProjectSummaryFromState(stampedSnapshot);
        setProjectList(prev => {
          const filtered = prev.filter(item => item.id !== nextSummary.id);
          return [nextSummary, ...filtered];
        });
      },
      onStatusChange: (status) => {
        unsavedFlagRef.current = status.hasUnsavedChanges;
        setHasUnsavedChanges(status.hasUnsavedChanges);
        setIsSaving(status.isSaving);
        setStorageError(status.storageError);
        if (status.lastSavedAt) {
          setLastSavedAt(status.lastSavedAt);
        }
      },
      shouldDeferAutoSave: () => isInteractingRef.current
    });
    coordinatorRef.current.reset(
      initialBoot.project,
      initialBoot.project.lastSavedAt || new Date().toISOString()
    );
  }

  // Hydrate from IndexedDB on initial mount & migrate legacy localStorage if present
  useEffect(() => {
    let active = true;
    (async () => {
      await requestPersistentStorage();
      const [existingList, activeId, savedBackupAt, seenWelcome] = await Promise.all([
        listProjectsFromDB(),
        getMetaValue<string>('activeProjectId'),
        getMetaValue<string>('lastFullBackupAt'),
        getMetaValue<boolean>('hasSeenWelcome')
      ]);

      if (!active) return;
      if (savedBackupAt) setLastBackupAt(savedBackupAt);

      if (existingList.length === 0) {
        // First-time IndexedDB setup: migrate legacy localStorage or seed starter
        await saveProjectToDB(initialBoot.project);
        saveRecoverySnapshot(initialBoot.project, 'autosave');
        const updatedList = await listProjectsFromDB();
        if (!active) return;
        setProjectList(updatedList);
        if (!initialBoot.hadLegacyLocal && !seenWelcome) {
          setShowWelcomeModal(true);
        }
      } else {
        setProjectList(existingList);
        const nonTrashed = existingList.filter(p => !p.isTrashed);
        const targetId =
          (activeId && nonTrashed.some(p => p.id === activeId) ? activeId : undefined) ||
          nonTrashed[0]?.id;

        if (targetId) {
          const loaded = await loadProjectFromDB(targetId);
          if (loaded && active) {
            suppressNextAutoSaveRef.current = true;
            projectRef.current = loaded;
            setProject(loaded);
            historyRef.current = [loaded];
            historyIndexRef.current = 0;
            setHistory([loaded]);
            setHistoryIndex(0);
            const loadedSavedAt = loaded.lastSavedAt || loaded.lastModified;
            coordinatorRef.current?.reset(loaded, loadedSavedAt);
            setLastSavedAt(loadedSavedAt);
            setHasUnsavedChanges(false);
          }
        }
      }
      hydratedRef.current = true;
    })();

    return () => {
      active = false;
    };
  }, [initialBoot]);

  // Trigger single-flight serialized Save Coordinator whenever committed project edits change
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (isAdminDraftModeRef.current) return;
    if (isInteractingRef.current) return;
    if (suppressNextAutoSaveRef.current) {
      suppressNextAutoSaveRef.current = false;
      return;
    }
    coordinatorRef.current?.scheduleSave(project);
  }, [project]);

  useEffect(() => {
    return () => {
      coordinatorRef.current?.dispose();
    };
  }, []);

  // Protect pending edits on tab close/reload with synchronous verified recovery snapshot
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const status = coordinatorRef.current?.getStatus();
      if (status?.hasUnsavedChanges || status?.isSaving || storageError) {
        saveRecoverySnapshot(projectRef.current, 'crash_guard');
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [storageError]);

  const dismissWelcomeModal = useCallback(async () => {
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
  }, []);

  const recordFullBackup = useCallback(async () => {
    const now = new Date().toISOString();
    setLastBackupAt(now);
    await setMetaValue('lastFullBackupAt', now);
  }, []);

  // Push structural snapshot onto Undo/Redo stack
  const pushHistoryState = useCallback((nextState: ProjectState, baseOverride?: ProjectState) => {
    const currentStack = historyRef.current;
    const currentIdx = historyIndexRef.current;
    const compareTarget = baseOverride || currentStack[currentIdx];

    if (compareTarget && areStatesStructurallyEqual(compareTarget, nextState)) {
      return;
    }

    const stamped: ProjectState = {
      ...nextState,
      lastModified: new Date().toISOString()
    };

    const truncated = currentStack.slice(0, currentIdx + 1);
    const updatedStack = [...truncated, stamped].slice(-MAX_HISTORY_STEPS);
    const nextIdx = updatedStack.length - 1;

    historyRef.current = updatedStack;
    historyIndexRef.current = nextIdx;
    setHistory(updatedStack);
    setHistoryIndex(nextIdx);
    dirtyTrackingRef.current.version += 1;
    unsavedFlagRef.current = true;
    setHasUnsavedChanges(true);
  }, []);

  const updateProject = useCallback((updater: (prev: ProjectState) => ProjectState) => {
    setProject(prev => {
      const next = updater(prev);
      if (areStatesStructurallyEqual(prev, next)) return prev;
      const stamped: ProjectState = {
        ...next,
        lastModified: new Date().toISOString()
      };
      projectRef.current = stamped;
      pushHistoryState(stamped, prev);
      return stamped;
    });
  }, [pushHistoryState]);

  const updateProjectTransient = useCallback((updater: (prev: ProjectState) => ProjectState) => {
    setProject(prev => {
      const next = updater(prev);
      projectRef.current = next;
      return next;
    });
  }, []);

  const beginDragSnapshot = useCallback(() => {
    isInteractingRef.current = true;
    setProject(current => {
      dragPreSnapshotRef.current = current;
      return current;
    });
  }, []);

  const commitDragSnapshot = useCallback(() => {
    isInteractingRef.current = false;
    const preSnap = dragPreSnapshotRef.current;
    dragPreSnapshotRef.current = null;
    if (!preSnap) return;

    setProject(current => {
      if (areStatesStructurallyEqual(preSnap, current)) {
        return current;
      }
      const stack = historyRef.current;
      const idx = historyIndexRef.current;
      if (!stack[idx] || !areStatesStructurallyEqual(stack[idx], preSnap)) {
        const baseTruncated = stack.slice(0, idx + 1);
        baseTruncated.push(preSnap);
        historyRef.current = baseTruncated.slice(-MAX_HISTORY_STEPS);
        historyIndexRef.current = historyRef.current.length - 1;
      }
      const stamped: ProjectState = {
        ...current,
        lastModified: new Date().toISOString()
      };
      pushHistoryState(stamped, preSnap);
      return stamped;
    });
  }, [pushHistoryState]);

  const undo = useCallback(() => {
    const currentIdx = historyIndexRef.current;
    if (currentIdx > 0) {
      const nextIdx = currentIdx - 1;
      const targetState = historyRef.current[nextIdx];
      if (targetState) {
        historyIndexRef.current = nextIdx;
        projectRef.current = targetState;
        dirtyTrackingRef.current.version += 1;
        unsavedFlagRef.current = true;
        setHasUnsavedChanges(true);
        setHistoryIndex(nextIdx);
        setProject(targetState);
      }
    }
  }, []);

  const redo = useCallback(() => {
    const currentIdx = historyIndexRef.current;
    if (currentIdx < historyRef.current.length - 1) {
      const nextIdx = currentIdx + 1;
      const targetState = historyRef.current[nextIdx];
      if (targetState) {
        historyIndexRef.current = nextIdx;
        projectRef.current = targetState;
        dirtyTrackingRef.current.version += 1;
        unsavedFlagRef.current = true;
        setHasUnsavedChanges(true);
        setHistoryIndex(nextIdx);
        setProject(targetState);
      }
    }
  }, []);

  const flushPendingSave = useCallback(async () => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return { ok: true, error: null, committedVersion: 0, dirtyVersion: 0 };
    const st = coordinator.getStatus();
    if (unsavedFlagRef.current && st.dirtyVersion <= st.committedVersion) {
      return coordinator.saveNow(projectRef.current);
    }
    return coordinator.flush(projectRef.current);
  }, []);

  const markSaved = useCallback(async () => {
    if (isAdminDraftModeRef.current) return;
    const coordinator = coordinatorRef.current;
    if (!coordinator) return;
    const res = await coordinator.saveNow(projectRef.current);
    if (res.ok) {
      const stamped = { ...projectRef.current, lastSavedAt: coordinator.getStatus().lastSavedAt || new Date().toISOString() };
      suppressNextAutoSaveRef.current = true;
      projectRef.current = stamped;
      setProject(stamped);
      saveRecoverySnapshot(stamped, 'manual');
      trackSave(stamped.name || stamped.id);
    }
  }, []);

  const resetHistoryToProject = useCallback((proj: ProjectState) => {
    suppressNextAutoSaveRef.current = true;
    unsavedFlagRef.current = false;
    projectRef.current = proj;
    historyRef.current = [proj];
    historyIndexRef.current = 0;
    setHistory([proj]);
    setHistoryIndex(0);
    setProject(proj);
    setSelection({ type: 'none' });
    coordinatorRef.current?.reset(proj, proj.lastSavedAt || proj.lastModified);
    setHasUnsavedChanges(false);
    setStorageError(null);
    setZoom(1);
    setPan({ x: 50, y: 50 });
  }, []);

  const enterAdminTemplateEdit = useCallback(async (templateProject: ProjectState) => {
    if (!isAdminDraftModeRef.current) {
      await flushPendingSave();
      savedUserSessionRef.current = {
        project: projectRef.current,
        history: historyRef.current,
        historyIndex: historyIndexRef.current,
        lastSavedAt,
        hasUnsavedChanges: unsavedFlagRef.current
      };
      isAdminDraftModeRef.current = true;
      setIsAdminTemplateMode(true);
    }
    const cloned = structuredClone(templateProject);
    suppressNextAutoSaveRef.current = true;
    projectRef.current = cloned;
    historyRef.current = [cloned];
    historyIndexRef.current = 0;
    setHistory([cloned]);
    setHistoryIndex(0);
    setProject(cloned);
    setSelection({ type: 'none' });
    setHasUnsavedChanges(false);
    setZoom(1);
    setPan({ x: 50, y: 50 });
  }, [flushPendingSave, lastSavedAt, setSelection, setZoom, setPan]);

  const exitAdminTemplateEdit = useCallback(() => {
    const saved = savedUserSessionRef.current;
    isAdminDraftModeRef.current = false;
    setIsAdminTemplateMode(false);
    savedUserSessionRef.current = null;
    if (saved) {
      suppressNextAutoSaveRef.current = true;
      projectRef.current = saved.project;
      historyRef.current = saved.history;
      historyIndexRef.current = saved.historyIndex;
      setHistory(saved.history);
      setHistoryIndex(saved.historyIndex);
      setProject(saved.project);
      setLastSavedAt(saved.lastSavedAt);
      unsavedFlagRef.current = saved.hasUnsavedChanges;
      setHasUnsavedChanges(saved.hasUnsavedChanges);
      setSelection({ type: 'none' });
    }
  }, [setSelection]);

  // Multi-Project Hub Operations
  const switchProject = useCallback(async (projectId: string) => {
    const seq = ++transitionSeqRef.current;
    if (projectId !== projectRef.current.id) {
      saveRecoverySnapshot(projectRef.current, 'pre_switch');
      await flushPendingSave();
      if (seq !== transitionSeqRef.current) return false;
    }
    const loaded = await loadProjectFromDB(projectId);
    if (!loaded || seq !== transitionSeqRef.current) return false;
    await setMetaValue('activeProjectId', projectId);
    if (seq !== transitionSeqRef.current) return false;
    resetHistoryToProject(loaded);
    saveRecoverySnapshot(loaded, 'pre_switch');
    setLastSavedAt(loaded.lastSavedAt || loaded.lastModified);
    return true;
  }, [flushPendingSave, resetHistoryToProject]);

  const createBlankProject = useCallback(async (name = 'HACHIHI Bản vẽ mới') => {
    const seq = ++transitionSeqRef.current;
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    await flushPendingSave();
    if (seq !== transitionSeqRef.current) return;
    const emptyProj = createEmptyProject(name);
    const saveRes = await saveProjectToDB(emptyProj);
    if (seq !== transitionSeqRef.current) return;
    resetHistoryToProject(emptyProj);
    if (saveRes.ok) {
      saveRecoverySnapshot(emptyProj, 'manual');
      await setMetaValue('activeProjectId', emptyProj.id);
    } else {
      unsavedFlagRef.current = true;
      setHasUnsavedChanges(true);
      setStorageError(saveRes.error);
    }
    await refreshProjectList();
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
  }, [flushPendingSave, refreshProjectList, resetHistoryToProject]);

  const trashProject = useCallback(async (projectId: string) => {
    if (projectId === projectRef.current.id) {
      saveRecoverySnapshot(projectRef.current, 'pre_switch');
      await flushPendingSave();
    }
    await setProjectTrashStateInDB(projectId, true);
    const updated = await refreshProjectList();
    if (projectId === projectRef.current.id) {
      const nextActive = updated.find(p => !p.isTrashed);
      if (nextActive) {
        await switchProject(nextActive.id);
      } else {
        await createBlankProject();
      }
    }
  }, [flushPendingSave, refreshProjectList, switchProject, createBlankProject]);

  const restoreProject = useCallback(async (projectId: string) => {
    await setProjectTrashStateInDB(projectId, false);
    await refreshProjectList();
  }, [refreshProjectList]);

  const deleteProjectPermanently = useCallback(async (projectId: string) => {
    await deleteProjectPermanentlyFromDB(projectId);
    await cadRepository.deleteDocumentsForProject(projectId).catch(() => 0);
    notifyCadProjectSync(projectId);
    await refreshProjectList();
  }, [refreshProjectList]);

  const duplicateProject = useCallback(async () => {
    const seq = ++transitionSeqRef.current;
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    await flushPendingSave();
    if (seq !== transitionSeqRef.current) return;
    const current = projectRef.current;
    const now = new Date().toISOString();
    const cloned: ProjectState = {
      ...structuredClone(current),
      id: `proj_${Date.now()}`,
      name: `${current.name} (Bản sao)`,
      lastModified: now,
      lastSavedAt: now
    };
    const saveRes = await saveProjectToDB(cloned);
    if (seq !== transitionSeqRef.current) return;
    await cadRepository.cloneDocumentsForProject(current.id, cloned.id).catch(() => []);
    if (seq !== transitionSeqRef.current) return;
    resetHistoryToProject(cloned);
    notifyCadProjectSync(cloned.id);
    if (saveRes.ok) {
      saveRecoverySnapshot(cloned, 'manual');
      await setMetaValue('activeProjectId', cloned.id);
    } else {
      unsavedFlagRef.current = true;
      setHasUnsavedChanges(true);
      setStorageError(saveRes.error);
    }
    await refreshProjectList();
  }, [flushPendingSave, refreshProjectList, resetHistoryToProject]);

  const importValidatedProject = useCallback((rawJson: unknown) => {
    const res = migrateAndValidateProject(rawJson);
    if (!res.ok) return res;
    const seq = ++transitionSeqRef.current;
    const previousSnapshot = projectRef.current;
    saveRecoverySnapshot(previousSnapshot, 'pre_switch');
    const preFlushPromise = coordinatorRef.current?.flush(previousSnapshot);
    resetHistoryToProject(res.project);
    setIsSaving(true);
    void (async () => {
      try {
        if (preFlushPromise) {
          await preFlushPromise;
        }
        if (seq !== transitionSeqRef.current) return;
        const saveRes = await saveProjectToDB(res.project);
        if (seq !== transitionSeqRef.current) return;
        if (saveRes.ok) {
          saveRecoverySnapshot(res.project, 'manual');
          await setMetaValue('activeProjectId', res.project.id);
          await setMetaValue('hasSeenWelcome', true);
          setLastSavedAt(res.project.lastSavedAt || res.project.lastModified);
        } else {
          unsavedFlagRef.current = true;
          setHasUnsavedChanges(true);
          setStorageError(saveRes.error);
        }
        await refreshProjectList();
        notifyCadProjectSync(res.project.id);
      } finally {
        if (seq === transitionSeqRef.current) {
          setIsSaving(false);
        }
      }
    })();
    return res;
  }, [resetHistoryToProject, refreshProjectList]);

  const commitImportedProject = useCallback(async (importedProject: ProjectState) => {
    const seq = ++transitionSeqRef.current;
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    await flushPendingSave();
    if (seq !== transitionSeqRef.current) return;
    resetHistoryToProject(importedProject);
    const res = await saveProjectToDB(importedProject);
    if (seq !== transitionSeqRef.current) return;
    if (res.ok) {
      saveRecoverySnapshot(importedProject, 'manual');
      await setMetaValue('activeProjectId', importedProject.id);
      setLastSavedAt(importedProject.lastSavedAt || importedProject.lastModified);
    } else {
      unsavedFlagRef.current = true;
      setHasUnsavedChanges(true);
      setStorageError(res.error);
    }
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
    await refreshProjectList();
    notifyCadProjectSync(importedProject.id);
  }, [flushPendingSave, resetHistoryToProject, refreshProjectList]);

  // Rack Operations (defined before useNodesSlice so catalog rack drops can delegate to addRack)
  const addRack = useCallback((
    name: string,
    totalUnits = 42,
    x = 300,
    y = 80,
    options?: { floorId?: string; diagramMode?: ProjectState['activeMode']; elevationZ?: number }
  ) => {
    const clampedUnits = clampRackUnits(totalUnits);
    const clampedX = Math.max(10, Math.round(x));
    const clampedY = Math.max(10, Math.round(y));
    const newRackId = `rack_${Date.now()}`;
    const newRack: ServerRack = {
      id: newRackId,
      name,
      totalUnits: clampedUnits,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 1000,
      x: clampedX,
      y: clampedY,
      slots: {},
      rearSlots: {}
    };

    updateProject(prev => {
      const targetFloorId = options?.floorId ?? prev.activeFloorId;
      newRack.floorId = targetFloorId;
      const elevationZ =
        typeof options?.elevationZ === 'number' && Number.isFinite(options.elevationZ)
          ? options.elevationZ
          : undefined;
      const rackNode: DiagramNode = {
        id: `node_${newRackId}`,
        diagramMode: options?.diagramMode ?? prev.activeMode,
        floorId: targetFloorId,
        type: 'rack',
        label: name,
        x: clampedX,
        y: clampedY,
        width: 300,
        height: getCanvasRackHeight(clampedUnits),
        rotation: 0,
        style: {
          backgroundColor: '#0f172a',
          borderColor: '#475569',
          borderWidth: 3,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#f8fafc'
        },
        customData: {
          rackId: newRackId,
          totalUnits: clampedUnits,
          ...(elevationZ !== undefined ? { elevationZ } : {})
        }
      };

      return {
        ...prev,
        racks: [...prev.racks, newRack],
        nodes: [...prev.nodes, rackNode]
      };
    });
    setSelection({ type: 'rack', id: newRackId });
  }, [updateProject, setSelection]);

  // Modular Feature Slices (Nodes, Cables, Project Settings & Directory)
  const nodesSlice = useNodesSlice({
    project,
    projectRef,
    copiedStyle,
    setCopiedStyle,
    smartClipboardNodeIds,
    setSmartClipboardNodeIds,
    setSelection,
    updateProject,
    updateProjectTransient,
    commitDragSnapshot,
    addRack
  });

  const cablesSlice = useCablesSlice({
    setSelection,
    updateProject,
    updateProjectTransient
  });

  const settingsSlice = useProjectSettingsSlice({
    project,
    historyRef,
    historyIndexRef,
    setSelection,
    updateProject
  });

  // Room Operations
  const addRoom = useCallback((room: Omit<Room, 'id'>) => {
    const newRoom: Room = {
      ...room,
      id: `rm_${Date.now()}`
    };
    updateProject(prev => ({
      ...prev,
      rooms: [...prev.rooms, newRoom]
    }));
    setSelection({ type: 'room', id: newRoom.id });
  }, [updateProject]);

  const updateRoom = useCallback((roomId: string, partial: Partial<Room>) => {
    updateProject(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => r.id === roomId ? { ...r, ...partial } : r)
    }));
  }, [updateProject]);

  const moveRoomTransient = useCallback((roomId: string, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    updateProjectTransient(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => {
        if (r.id !== roomId || r.locked) return r;
        return {
          ...r,
          x: Math.max(10, r.x + dx),
          y: Math.max(10, r.y + dy)
        };
      })
    }));
  }, [updateProjectTransient]);

  const resizeRoomTransient = useCallback((
    roomId: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    updateProjectTransient(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => {
        if (r.id !== roomId || r.locked) return r;
        return {
          ...r,
          x: Math.max(10, rect.x),
          y: Math.max(10, rect.y),
          width: Math.max(60, Math.round(rect.width)),
          height: Math.max(45, Math.round(rect.height))
        };
      })
    }));
  }, [updateProjectTransient]);

  const snapRoomAndCommit = useCallback((roomId: string) => {
    updateProjectTransient(prev => {
      const snap = prev.settings.snapToGrid ? Math.max(5, Math.round(prev.settings.gridSize / 2)) : 1;
      if (snap <= 1) return prev;
      return {
        ...prev,
        rooms: prev.rooms.map(r => {
          if (r.id !== roomId || r.locked) return r;
          return {
            ...r,
            x: Math.max(10, Math.round(r.x / snap) * snap),
            y: Math.max(10, Math.round(r.y / snap) * snap),
            width: Math.max(60, Math.round(r.width / snap) * snap),
            height: Math.max(45, Math.round(r.height / snap) * snap)
          };
        })
      };
    });
    commitDragSnapshot();
  }, [updateProjectTransient, commitDragSnapshot]);

  const deleteRoom = useCallback((roomId: string) => {
    updateProject(prev => ({
      ...prev,
      rooms: prev.rooms.filter(r => r.id !== roomId)
    }));
    setSelection({ type: 'none' });
  }, [updateProject]);

  // Cable Tray Operations
  const addCableTray = useCallback((tray: Omit<CableTray, 'id'>) => {
    const newTray: CableTray = {
      ...tray,
      id: `tray_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`
    };
    updateProject(prev => ({
      ...prev,
      cableTrays: [...(prev.cableTrays || []), newTray]
    }));
    setSelection({ type: 'tray', id: newTray.id });
    setActiveTool('select');
  }, [updateProject, setSelection, setActiveTool]);

  const updateCableTray = useCallback((trayId: string, partial: Partial<CableTray>) => {
    updateProject(prev => ({
      ...prev,
      cableTrays: (prev.cableTrays || []).map(t => {
        if (t.id !== trayId) return t;
        const isOnlyToggleLock = Object.keys(partial).length === 1 && 'locked' in partial;
        if (!isOnlyToggleLock && isTrayEffectivelyLocked(t, prev.settings, false)) {
          return t;
        }
        return { ...t, ...partial };
      })
    }));
  }, [updateProject]);

  const moveCableTrayVertexTransient = useCallback(
    (trayId: string, vertexIndex: number, pos: { x: number; y: number }) => {
      updateProjectTransient(prev => {
        if (isLayerLocked(prev.settings, 'trays')) return prev;
        return {
          ...prev,
          cableTrays: (prev.cableTrays || []).map(t => {
            if (t.id !== trayId || t.locked) return t;
            if (vertexIndex < 0 || vertexIndex >= t.points.length) return t;
            const nextPts = t.points.map((pt, idx) =>
              idx === vertexIndex
                ? { x: Math.max(10, Math.round(pos.x)), y: Math.max(10, Math.round(pos.y)) }
                : pt
            );
            return { ...t, points: nextPts };
          })
        };
      });
    },
    [updateProjectTransient]
  );

  const moveCableTrayTransient = useCallback(
    (trayId: string, dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return;
      updateProjectTransient(prev => {
        if (isLayerLocked(prev.settings, 'trays')) return prev;
        return {
          ...prev,
          cableTrays: (prev.cableTrays || []).map(t => {
            if (t.id !== trayId || t.locked) return t;
            return {
              ...t,
              points: t.points.map(pt => ({
                x: Math.max(10, pt.x + dx),
                y: Math.max(10, pt.y + dy)
              }))
            };
          })
        };
      });
    },
    [updateProjectTransient]
  );

  const snapCableTrayAndCommit = useCallback(
    (trayId: string) => {
      updateProjectTransient(prev => {
        const snap = prev.settings.snapToGrid ? Math.max(5, Math.round(prev.settings.gridSize / 2)) : 1;
        return {
          ...prev,
          cableTrays: (prev.cableTrays || []).map(t => {
            if (t.id !== trayId || isTrayEffectivelyLocked(t, prev.settings, false)) return t;
            return {
              ...t,
              points: t.points.map(pt => ({
                x: Math.max(10, Math.round(pt.x / snap) * snap),
                y: Math.max(10, Math.round(pt.y / snap) * snap)
              }))
            };
          })
        };
      });
      commitDragSnapshot();
    },
    [updateProjectTransient, commitDragSnapshot]
  );

  const deleteCableTray = useCallback((trayId: string) => {
    updateProject(prev => ({
      ...prev,
      cableTrays: (prev.cableTrays || []).filter(t => t.id !== trayId)
    }));
    setSelection(prev => (prev.type === 'tray' && prev.id === trayId ? { type: 'none' } : prev));
  }, [updateProject, setSelection]);

  const updateRack = useCallback((rackId: string, partial: Partial<ServerRack>) => {
    updateProject(prev => {
      const nextUnits = partial.totalUnits !== undefined ? clampRackUnits(partial.totalUnits) : undefined;
      const sanitizedPartial = nextUnits !== undefined ? { ...partial, totalUnits: nextUnits } : partial;

      const updatedRacks = prev.racks.map(r => r.id === rackId ? { ...r, ...sanitizedPartial } : r);
      const updatedNodes = prev.nodes.map(n => {
        if (n.type === 'rack' && (n.customData?.rackId === rackId || n.id === rackId)) {
          const resolvedUnits = nextUnits ?? n.customData?.totalUnits ?? 42;
          return {
            ...n,
            label: sanitizedPartial.name ?? n.label,
            height: nextUnits !== undefined ? getCanvasRackHeight(nextUnits) : n.height,
            customData: {
              ...n.customData,
              rackId,
              totalUnits: resolvedUnits
            }
          };
        }
        return n;
      });
      return {
        ...prev,
        racks: updatedRacks,
        nodes: updatedNodes
      };
    });
  }, [updateProject]);

  const assignDeviceToRackSlot = useCallback((
    rackId: string,
    assetId: string,
    preferredU: number,
    side: RackSide = 'front'
  ) => {
    updateProject(prev => {
      const targetRack = prev.racks.find(r => r.id === rackId);
      const targetAsset = prev.assets[assetId];
      if (!targetRack || !targetAsset) return prev;

      const totalUnits = targetRack.totalUnits || 42;
      const uHeight = getAssetUHeight(targetAsset);
      if (uHeight > totalUnits) return prev;

      const clampedU = clampStartU(preferredU, totalUnits, uHeight);
      if (!canPlaceDeviceAtU(targetRack, prev.assets, clampedU, uHeight, assetId, side)) {
        return prev;
      }

      const updatedRacks = prev.racks.map(r => {
        const cleanedFront: Record<number, string> = {};
        for (const [uStr, devId] of Object.entries(r.slots || {})) {
          if (devId && devId !== assetId) cleanedFront[parseInt(uStr, 10)] = devId;
        }
        const cleanedRear: Record<number, string> = {};
        for (const [uStr, devId] of Object.entries(r.rearSlots || {})) {
          if (devId && devId !== assetId) cleanedRear[parseInt(uStr, 10)] = devId;
        }

        if (r.id === rackId) {
          if (side === 'rear') cleanedRear[clampedU] = assetId;
          else cleanedFront[clampedU] = assetId;
        }
        return { ...r, slots: cleanedFront, rearSlots: cleanedRear };
      });

      const syncedFloorId = targetRack.floorId ?? targetAsset.floorId;
      const syncedBuildingId = targetRack.buildingId ?? targetAsset.buildingId;
      const syncedRoomId = targetRack.roomId ?? targetAsset.roomId;

      const updatedAsset: DeviceAsset = {
        ...targetAsset,
        buildingId: syncedBuildingId,
        floorId: syncedFloorId,
        roomId: syncedRoomId,
        rackId,
        rackUnitStart: clampedU,
        rackUnitHeight: uHeight,
        rackSide: side
      };

      const nextNodes =
        syncedFloorId && syncedFloorId !== targetAsset.floorId
          ? prev.nodes.map(n =>
              n.assetId === assetId && (!n.floorId || n.floorId === targetAsset.floorId)
                ? { ...n, floorId: syncedFloorId }
                : n
            )
          : prev.nodes;

      return {
        ...prev,
        racks: updatedRacks,
        nodes: nextNodes,
        assets: {
          ...prev.assets,
          [assetId]: updatedAsset
        }
      };
    });
  }, [updateProject]);

  const removeDeviceFromRackSlot = useCallback((
    rackId: string,
    assetIdOrU: string | number,
    side: RackSide = 'front'
  ) => {
    updateProject(prev => {
      const targetRack = prev.racks.find(r => r.id === rackId);
      if (!targetRack) return prev;

      let removedAssetId: string | undefined;
      const filterSlotMap = (slotMap: Record<number, string> | undefined, activeSideMatch: boolean) => {
        const nextMap: Record<number, string> = {};
        for (const [uStr, devId] of Object.entries(slotMap || {})) {
          const uNum = parseInt(uStr, 10);
          const matches = typeof assetIdOrU === 'number'
            ? (activeSideMatch && uNum === assetIdOrU)
            : devId === assetIdOrU;
          if (matches) {
            removedAssetId = devId;
          } else {
            nextMap[uNum] = devId;
          }
        }
        return nextMap;
      };

      const nextFront = filterSlotMap(targetRack.slots, side === 'front');
      const nextRear = filterSlotMap(targetRack.rearSlots, side === 'rear');

      const nextAssets = { ...prev.assets };
      if (removedAssetId && nextAssets[removedAssetId]) {
        nextAssets[removedAssetId] = {
          ...nextAssets[removedAssetId],
          rackId: undefined,
          rackUnitStart: undefined,
          rackSide: undefined
        };
      }

      return {
        ...prev,
        racks: prev.racks.map(r => r.id === rackId ? { ...r, slots: nextFront, rearSlots: nextRear } : r),
        assets: nextAssets
      };
    });
  }, [updateProject]);

  const addDeviceFromCatalogToRack = useCallback((
    presetName: string,
    rackId: string,
    preferredU: number,
    side: RackSide = 'front'
  ) => {
    const preset = DEVICE_CATALOG.find(p => p.name === presetName);
    if (!preset || preset.category === 'rack') return;

    updateProject(prev => {
      const targetRack = prev.racks.find(r => r.id === rackId);
      if (!targetRack) return prev;

      const assetCount = Object.keys(prev.assets).length + 1;
      const newAsset = createDeviceAssetFromPreset(preset, assetCount);
      const uHeight = preset.defaultUHeight >= 1 ? preset.defaultUHeight : 1;
      const targetU = findNearestAvailableU(targetRack, prev.assets, preferredU, uHeight, undefined, side);

      if (targetU === null) return prev;

      if (isIpAssignableCategory(newAsset.category)) {
        const nextIp = findNextAvailableIpInProject(prev, newAsset.category);
        if (nextIp) {
          if (nextIp.ipAddress) newAsset.ipAddress = nextIp.ipAddress;
          newAsset.subnetMask = nextIp.subnetMask;
          newAsset.gateway = nextIp.gateway;
        }
      }

      newAsset.rackId = rackId;
      newAsset.rackUnitStart = targetU;
      newAsset.rackUnitHeight = uHeight;
      newAsset.rackSide = side;
      newAsset.buildingId = targetRack.buildingId || prev.activeBuildingId;
      newAsset.floorId = targetRack.floorId || prev.activeFloorId;

      const rackNode = prev.nodes.find(n => n.type === 'rack' && (n.customData?.rackId === rackId || n.id === rackId));
      const existingCount = Object.keys(targetRack.slots || {}).length + Object.keys(targetRack.rearSlots || {}).length;

      const newNode: DiagramNode = {
        id: `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        diagramMode: 'topology',
        floorId: newAsset.floorId,
        type: 'device',
        assetId: newAsset.id,
        label: newAsset.name,
        x: (rackNode?.x ?? targetRack.x ?? 300) + 340,
        y: (rackNode?.y ?? targetRack.y ?? 100) + (existingCount * 70),
        width: preset.defaultWidth,
        height: preset.defaultHeight,
        rotation: 0,
        style: {
          backgroundColor: preset.color,
          borderColor: '#334155',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#ffffff',
          iconColor: '#ffffff'
        }
      };

      return {
        ...prev,
        assets: { ...prev.assets, [newAsset.id]: newAsset },
        nodes: [...prev.nodes, newNode],
        racks: prev.racks.map(r => {
          if (r.id !== rackId) return r;
          if (side === 'rear') {
            return { ...r, rearSlots: { ...(r.rearSlots || {}), [targetU]: newAsset.id } };
          }
          return { ...r, slots: { ...r.slots, [targetU]: newAsset.id } };
        })
      };
    });
  }, [updateProject]);

  const deleteRack = useCallback((rackId: string) => {
    updateProject(prev => {
      const updatedAssets: Record<string, DeviceAsset> = { ...prev.assets };
      Object.values(updatedAssets).forEach(a => {
        if (a.rackId === rackId) {
          updatedAssets[a.id] = { ...a, rackId: undefined, rackUnitStart: undefined, rackSide: undefined };
        }
      });

      const nextRacks = prev.racks.filter(r => r.id !== rackId);
      const removedNodeIds = new Set<string>();
      const nextNodes = prev.nodes.filter(n => {
        const isTargetRackNode =
          n.type === 'rack' && (n.customData?.rackId === rackId || n.id === rackId);
        if (isTargetRackNode) {
          removedNodeIds.add(n.id);
          return false;
        }
        return true;
      });
      const nextCables =
        removedNodeIds.size > 0
          ? prev.cables.filter(
              c => !removedNodeIds.has(c.sourceNodeId) && !removedNodeIds.has(c.targetNodeId)
            )
          : prev.cables;
      const syncedAssets = syncAssetPortsWithCables(updatedAssets, nextNodes, nextCables);
      const prunedAssets = pruneOrphanAssets(syncedAssets, nextNodes, nextRacks);

      return {
        ...prev,
        assets: prunedAssets,
        racks: nextRacks,
        nodes: nextNodes,
        cables: nextCables,
        patchLinks: pruneOrphanPatchLinks(prev.patchLinks, prev.assets, prunedAssets)
      };
    });
    setSelection({ type: 'none' });
  }, [updateProject]);

  // Multi-floor Building Generator
  const generateOrUpdateBuilding = useCallback((config: {
    name: string;
    totalFloors: number;
    basementFloors: number;
    widthMeters: number;
    depthMeters: number;
    floorHeightMeters: number;
    wallThicknessMm: number;
    layoutStyle: 'rectangle' | 'L-shape' | 'U-shape';
  }) => {
    updateProject(prev => {
      const existingBuilding = prev.buildings[0];
      const buildingId = existingBuilding?.id || `bld_${Date.now()}`;

      const newBuilding: Building = {
        id: buildingId,
        name: config.name,
        totalFloors: config.totalFloors,
        basementFloors: config.basementFloors,
        widthMeters: config.widthMeters,
        depthMeters: config.depthMeters,
        floorHeightMeters: config.floorHeightMeters,
        wallThicknessMm: config.wallThicknessMm,
        layoutStyle: config.layoutStyle
      };

      const existingFloorMap = new Map(prev.floors.map(f => [f.level, f]));
      const newFloors: Floor[] = [];

      for (let b = config.basementFloors; b >= 1; b--) {
        const level = -b;
        if (existingFloorMap.has(level)) {
          newFloors.push({
            ...existingFloorMap.get(level)!,
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        } else {
          newFloors.push({
            id: `flr_b${b}_${Date.now()}`,
            buildingId,
            level,
            name: `Tầng hầm B${b} - Bãi xe & Phòng Kỹ thuật Điện`,
            description: 'Khu đỗ xe và trạm phân phối phụ trợ',
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        }
      }

      for (let f = 1; f <= config.totalFloors; f++) {
        if (existingFloorMap.has(f)) {
          newFloors.push({
            ...existingFloorMap.get(f)!,
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        } else {
          newFloors.push({
            id: `flr_${f}_${Date.now()}`,
            buildingId,
            level: f,
            name: `Tầng ${f} - Khu vực Mở rộng`,
            description: `Mặt bằng tầng ${f} phân phối`,
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        }
      }

      const targetActiveFloorId = newFloors.some(fl => fl.id === prev.activeFloorId)
        ? prev.activeFloorId
        : newFloors[0]?.id || '';

      return {
        ...prev,
        buildings: [newBuilding],
        floors: newFloors,
        activeBuildingId: buildingId,
        activeFloorId: targetActiveFloorId
      };
    });
  }, [updateProject]);

  const cloneFloor = useCallback((sourceFloorId: string, newLevelNumber: number, newFloorName: string) => {
    updateProject(prev => {
      const sourceFloor = prev.floors.find(f => f.id === sourceFloorId);
      if (!sourceFloor) return prev;

      const newFloorId = `flr_${Date.now()}`;
      const newFloor: Floor = {
        ...sourceFloor,
        id: newFloorId,
        level: newLevelNumber,
        name: newFloorName
      };

      const clonedRooms: Room[] = prev.rooms
        .filter(r => r.floorId === sourceFloorId)
        .map(r => ({
          ...r,
          id: `rm_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          floorId: newFloorId
        }));

      const clonedAssets: Record<string, DeviceAsset> = { ...prev.assets };
      const clonedNodes: DiagramNode[] = [];

      prev.nodes
        .filter(n => n.floorId === sourceFloorId)
        .forEach(n => {
          let newAssetId: string | undefined = undefined;
          if (n.assetId && prev.assets[n.assetId]) {
            const originalAsset = prev.assets[n.assetId];
            const newAsset: DeviceAsset = {
              ...originalAsset,
              id: `asset_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name: `${originalAsset.name}-L${newLevelNumber}`,
              floorId: newFloorId
            };
            clonedAssets[newAsset.id] = newAsset;
            newAssetId = newAsset.id;
          }

          clonedNodes.push({
            ...n,
            id: `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            floorId: newFloorId,
            assetId: newAssetId
          });
        });

      return {
        ...prev,
        floors: [...prev.floors, newFloor],
        rooms: [...prev.rooms, ...clonedRooms],
        assets: clonedAssets,
        nodes: [...prev.nodes, ...clonedNodes],
        activeFloorId: newFloorId
      };
    });
  }, [updateProject]);

  const loadExternalTemplate = useCallback(
    async (
      entry: TemplateCatalogEntry
    ): Promise<{ ok: boolean; error?: string; warnings?: string[]; project?: ProjectState }> => {
      const seq = ++transitionSeqRef.current;
      const { fetchAndPrepareTemplateProject } = await import('../services/templateLibrary');
      const prepared = await fetchAndPrepareTemplateProject(entry);
      if (seq !== transitionSeqRef.current) {
        return { ok: false, error: 'Thao tác nạp mẫu đã bị thay thế bởi thao tác mới hơn.' };
      }
      if (!prepared.ok) {
        return { ok: false, error: prepared.error };
      }

      saveRecoverySnapshot(projectRef.current, 'pre_switch');
      await flushPendingSave();
      if (seq !== transitionSeqRef.current) {
        return { ok: false, error: 'Thao tác nạp mẫu đã bị thay thế bởi thao tác mới hơn.' };
      }

      const newProject = prepared.project;
      resetHistoryToProject(newProject);
      const res = await saveProjectToDB(newProject);
      if (seq !== transitionSeqRef.current) {
        return { ok: false, error: 'Thao tác nạp mẫu đã bị thay thế bởi thao tác mới hơn.' };
      }
      if (res.ok) {
        saveRecoverySnapshot(newProject, 'manual');
        await setMetaValue('activeProjectId', newProject.id);
      } else {
        unsavedFlagRef.current = true;
        setHasUnsavedChanges(true);
        setStorageError(res.error);
      }
      await refreshProjectList();
      setShowWelcomeModal(false);
      await setMetaValue('hasSeenWelcome', true);
      trackTemplate(`library:${entry.id}`);
      return { ok: true, warnings: prepared.warnings, project: newProject };
    },
    [flushPendingSave, resetHistoryToProject, refreshProjectList]
  );

  const loadTemplate = useCallback(async (templateId: string) => {
    const seq = ++transitionSeqRef.current;
    const { ARCHITECTURE_TEMPLATES } = await import('../data/templates');
    if (seq !== transitionSeqRef.current) return;
    const tpl = ARCHITECTURE_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    await flushPendingSave();
    if (seq !== transitionSeqRef.current) return;
    const newProject: ProjectState = {
      ...tpl.createProject(),
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastSavedAt: new Date().toISOString()
    };
    resetHistoryToProject(newProject);
    const res = await saveProjectToDB(newProject);
    if (seq !== transitionSeqRef.current) return;
    if (res.ok) {
      saveRecoverySnapshot(newProject, 'manual');
      await setMetaValue('activeProjectId', newProject.id);
    } else {
      unsavedFlagRef.current = true;
      setHasUnsavedChanges(true);
      setStorageError(res.error);
    }
    await refreshProjectList();
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
    trackTemplate(`gallery:${tpl.id}`);
  }, [flushPendingSave, resetHistoryToProject, refreshProjectList]);

  const resetCanvas = useCallback(async () => {
    await createBlankProject('HACHIHI Sơ đồ mới');
  }, [createBlankProject]);

  // Named Version Checkpoints
  const createNamedRevision = useCallback(async (label: string, note?: string) => {
    const trimmed = label.trim() || `Mốc lưu ${new Date().toLocaleTimeString('vi-VN')}`;
    const snapshot = structuredClone(project);
    const rev: ProjectRevision = {
      id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      projectId: project.id,
      label: trimmed,
      note: note?.trim() || undefined,
      createdAt: new Date().toISOString(),
      author: project.author || 'Kỹ sư Hạ tầng',
      nodeCount: snapshot.nodes.length,
      assetCount: Object.keys(snapshot.assets).length,
      rackCount: snapshot.racks.length,
      cableCount: snapshot.cables.length,
      snapshot
    };
    const ok = await saveRevisionToDB(rev);
    if (ok) {
      await refreshRevisions(project.id);
    }
    return ok ? rev : null;
  }, [project, refreshRevisions]);

  const restoreNamedRevision = useCallback(async (revisionId: string) => {
    const found = revisions.find(r => r.id === revisionId);
    if (!found) return false;
    const seq = ++transitionSeqRef.current;
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    await flushPendingSave();
    if (seq !== transitionSeqRef.current) return false;
    const restored: ProjectState = {
      ...structuredClone(found.snapshot),
      id: projectRef.current.id,
      lastModified: new Date().toISOString(),
      lastSavedAt: new Date().toISOString()
    };
    resetHistoryToProject(restored);
    const res = await saveProjectToDB(restored);
    if (res.ok) {
      saveRecoverySnapshot(restored, 'manual');
    } else {
      unsavedFlagRef.current = true;
      setHasUnsavedChanges(true);
      setStorageError(res.error);
    }
    await refreshProjectList();
    return true;
  }, [revisions, flushPendingSave, resetHistoryToProject, refreshProjectList]);

  const deleteNamedRevision = useCallback(async (revisionId: string) => {
    const ok = await deleteRevisionFromDB(revisionId);
    if (ok) {
      await refreshRevisions(project.id);
    }
    return ok;
  }, [project.id, refreshRevisions]);

  // Periodic & Manual IndexedDB Snapshot Actions
  const createProjectSnapshot = useCallback(
    async (label?: string, trigger: ProjectSnapshotTrigger = 'manual') => {
      lastSnapshotAttemptAtRef.current = Date.now();
      const res = await saveProjectSnapshotToDB(projectRef.current, {
        trigger,
        label,
        skipIfUnchanged: false
      });
      if (!res.ok || !res.snapshot) return null;
      await refreshSnapshots(projectRef.current.id);
      return res.snapshot;
    },
    [refreshSnapshots]
  );

  const restoreProjectSnapshot = useCallback(
    async (
      snapshotId: string
    ): Promise<{ ok: boolean; restoredName?: string; error?: string }> => {
      let target = snapshots.find(s => s.id === snapshotId);
      if (!target) {
        const latestList = await listProjectSnapshotsFromDB(projectRef.current.id);
        target = latestList.find(s => s.id === snapshotId);
      }
      if (!target) {
        return { ok: false, error: 'Không tìm thấy bản Snapshot cần phục hồi.' };
      }

      const validated = migrateAndValidateProject(target.snapshot);
      if (!validated.ok) {
        return { ok: false, error: validated.error };
      }

      const seq = ++transitionSeqRef.current;
      saveRecoverySnapshot(projectRef.current, 'pre_switch');
      await flushPendingSave();
      if (seq !== transitionSeqRef.current) {
        return { ok: false, error: 'Thao tác khôi phục đã bị thay thế bởi chuyển đổi mới hơn.' };
      }
      // Preserve current work with a safety pre_restore snapshot before overwriting
      await saveProjectSnapshotToDB(projectRef.current, {
        trigger: 'pre_restore',
        skipIfUnchanged: true
      });
      if (seq !== transitionSeqRef.current) {
        return { ok: false, error: 'Thao tác khôi phục đã bị thay thế bởi chuyển đổi mới hơn.' };
      }

      const nowIso = new Date().toISOString();
      const restored: ProjectState = {
        ...structuredClone(validated.project),
        id: projectRef.current.id,
        lastModified: nowIso,
        lastSavedAt: nowIso
      };

      resetHistoryToProject(restored);
      const saveRes = await saveProjectToDB(restored);
      if (saveRes.ok) {
        saveRecoverySnapshot(restored, 'manual');
      } else {
        unsavedFlagRef.current = true;
        setHasUnsavedChanges(true);
        setStorageError(saveRes.error);
      }
      await refreshProjectList();
      await refreshSnapshots(restored.id);
      return { ok: true, restoredName: target.label };
    },
    [snapshots, flushPendingSave, resetHistoryToProject, refreshProjectList, refreshSnapshots]
  );

  const deleteProjectSnapshot = useCallback(
    async (snapshotId: string) => {
      const ok = await deleteProjectSnapshotFromDB(snapshotId);
      if (ok) {
        await refreshSnapshots(projectRef.current.id);
      }
      return ok;
    },
    [refreshSnapshots]
  );

  const hasCopiedStyle = Boolean(copiedStyle);

  return useMemo(() => ({
    project,
    setProject,
    projectList,
    showWelcomeModal,
    dismissWelcomeModal,
    switchProject,
    createBlankProject,
    trashProject,
    restoreProject,
    deleteProjectPermanently,
    refreshProjectList,
    updateProject,
    updateProjectTransient,
    beginDragSnapshot,
    commitDragSnapshot,
    history,
    historyIndex,
    undo,
    redo,
    hasUnsavedChanges,
    isSaving,
    storageError,
    lastSavedAt,
    lastBackupAt,
    recordFullBackup,
    markSaved,
    flushPendingSave,
    duplicateProject,
    importValidatedProject,
    commitImportedProject,
    activeTool,
    setActiveTool,
    selection,
    setSelection,
    selectItem,
    toggleNodeSelection,
    selectMultipleNodes,
    clearSelection,
    zoom,
    setZoom,
    pan,
    setPan,
    connectingSource,
    setConnectingSource,
    deepInspectId,
    setDeepInspectId,
    smartClipboardNodeIds,
    hasCopiedStyle,
    ...nodesSlice,
    ...cablesSlice,
    ...settingsSlice,
    addRoom,
    updateRoom,
    moveRoomTransient,
    resizeRoomTransient,
    snapRoomAndCommit,
    deleteRoom,
    addCableTray,
    updateCableTray,
    moveCableTrayVertexTransient,
    moveCableTrayTransient,
    snapCableTrayAndCommit,
    deleteCableTray,
    addRack,
    updateRack,
    assignDeviceToRackSlot,
    removeDeviceFromRackSlot,
    addDeviceFromCatalogToRack,
    deleteRack,
    generateOrUpdateBuilding,
    cloneFloor,
    loadExternalTemplate,
    loadTemplate,
    resetCanvas,
    revisions,
    refreshRevisions,
    createNamedRevision,
    restoreNamedRevision,
    deleteNamedRevision,
    snapshots,
    lastAutoSnapshotAt,
    refreshSnapshots,
    createProjectSnapshot,
    restoreProjectSnapshot,
    deleteProjectSnapshot,
    activeFloorId: project.activeFloorId,
    setActiveFloorId: settingsSlice.setActiveFloor,
    isAdminTemplateMode,
    enterAdminTemplateEdit,
    exitAdminTemplateEdit
  }), [
    project,
    projectList,
    showWelcomeModal,
    dismissWelcomeModal,
    switchProject,
    createBlankProject,
    trashProject,
    restoreProject,
    deleteProjectPermanently,
    refreshProjectList,
    updateProject,
    updateProjectTransient,
    beginDragSnapshot,
    commitDragSnapshot,
    history,
    historyIndex,
    undo,
    redo,
    hasUnsavedChanges,
    isSaving,
    storageError,
    lastSavedAt,
    lastBackupAt,
    recordFullBackup,
    markSaved,
    flushPendingSave,
    duplicateProject,
    importValidatedProject,
    commitImportedProject,
    activeTool,
    setActiveTool,
    selection,
    setSelection,
    selectItem,
    toggleNodeSelection,
    selectMultipleNodes,
    clearSelection,
    zoom,
    setZoom,
    pan,
    setPan,
    connectingSource,
    setConnectingSource,
    deepInspectId,
    setDeepInspectId,
    smartClipboardNodeIds,
    hasCopiedStyle,
    nodesSlice,
    cablesSlice,
    settingsSlice,
    addRoom,
    updateRoom,
    moveRoomTransient,
    resizeRoomTransient,
    snapRoomAndCommit,
    deleteRoom,
    addCableTray,
    updateCableTray,
    moveCableTrayVertexTransient,
    moveCableTrayTransient,
    snapCableTrayAndCommit,
    deleteCableTray,
    addRack,
    updateRack,
    assignDeviceToRackSlot,
    removeDeviceFromRackSlot,
    addDeviceFromCatalogToRack,
    deleteRack,
    generateOrUpdateBuilding,
    cloneFloor,
    loadExternalTemplate,
    loadTemplate,
    resetCanvas,
    revisions,
    refreshRevisions,
    createNamedRevision,
    restoreNamedRevision,
    deleteNamedRevision,
    snapshots,
    lastAutoSnapshotAt,
    refreshSnapshots,
    createProjectSnapshot,
    restoreProjectSnapshot,
    deleteProjectSnapshot,
    isAdminTemplateMode,
    enterAdminTemplateEdit,
    exitAdminTemplateEdit
  ]);
}
