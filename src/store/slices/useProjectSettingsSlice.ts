import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  CanvasLayerId,
  DesignMode,
  PatchLink,
  ProjectState,
  SelectionState,
  SubnetSpec,
  VlanSpec
} from '../../types/infrastructure';
import { autoAssignTopologyIps, AutoAssignIpResult } from '../../utils/ipAutoAssign';
import { AutoLayeringSummary, computeAutoLayeringPlan } from '../../utils/layerPolicy';
import {
  calculateTrayAwareCableLengthMeters,
  estimateCableLengthMeters,
  type RectBox
} from '../../utils/cableRouting';
import { normalizeScalePxPerMeter, roundScalePxPerMeter } from '../../utils/scaleUtils';

export interface ProjectSettingsSliceDeps {
  project: ProjectState;
  historyRef: MutableRefObject<ProjectState[]>;
  historyIndexRef: MutableRefObject<number>;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  updateProject: (updater: (prev: ProjectState) => ProjectState) => void;
}

export function useProjectSettingsSlice({
  project,
  historyRef,
  historyIndexRef,
  setSelection,
  updateProject
}: ProjectSettingsSliceDeps) {
  const updateProjectMeta = useCallback(
    (meta: Partial<Pick<ProjectState, 'name' | 'author' | 'version'>>) => {
      updateProject(prev => ({
        ...prev,
        ...meta
      }));
    },
    [updateProject]
  );

  const setDesignMode = useCallback(
    (mode: DesignMode) => {
      updateProject(prev => {
        if (prev.activeMode === mode) return prev;
        return { ...prev, activeMode: mode };
      });
      setSelection({ type: 'none' });
    },
    [updateProject, setSelection]
  );

  const setActiveFloor = useCallback(
    (floorId: string) => {
      updateProject(prev => {
        if (prev.activeFloorId === floorId) return prev;
        return { ...prev, activeFloorId: floorId };
      });
      setSelection({ type: 'none' });
    },
    [updateProject, setSelection]
  );

  const updateSettings = useCallback(
    (partial: Partial<ProjectState['settings']>) => {
      const normalizedPartial: Partial<ProjectState['settings']> =
        partial.scale !== undefined
          ? { ...partial, scale: normalizeScalePxPerMeter(partial.scale) }
          : partial;
      updateProject(prev => ({
        ...prev,
        settings: { ...prev.settings, ...normalizedPartial }
      }));
    },
    [updateProject]
  );

  const syncProjectScaleFromCad = useCallback(
    (pxPerMeter: number) => {
      if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return;
      const clampedScale = roundScalePxPerMeter(pxPerMeter, 4);
      updateProject(prev => {
        const nodeMap = new Map(prev.nodes.map(n => [n.id, n]));
        const allTrays = prev.cableTrays || [];
        let cablesChanged = false;
        const nextCables = prev.cables.map(cable => {
          const src = nodeMap.get(cable.sourceNodeId);
          const tgt = nodeMap.get(cable.targetNodeId);
          if (!src || !tgt) return cable;
          const r1: RectBox = { x: src.x, y: src.y, width: src.width, height: src.height };
          const r2: RectBox = { x: tgt.x, y: tgt.y, width: tgt.width, height: tgt.height };
          const traysOnFloor =
            allTrays.length > 0
              ? allTrays.filter(t => !t.floorId || t.floorId === src.floorId || t.floorId === tgt.floorId)
              : [];
          const nextMeters =
            traysOnFloor.length > 0
              ? calculateTrayAwareCableLengthMeters(cable, r1, r2, traysOnFloor, clampedScale).meters
              : estimateCableLengthMeters(cable, r1, r2, clampedScale);
          if (cable.lengthMeters === nextMeters) return cable;
          cablesChanged = true;
          return { ...cable, lengthMeters: nextMeters };
        });

        if (prev.settings.scale === clampedScale && !cablesChanged) {
          return prev;
        }
        return {
          ...prev,
          settings: { ...prev.settings, scale: clampedScale },
          cables: cablesChanged ? nextCables : prev.cables
        };
      });
    },
    [updateProject]
  );

  const toggleLayerVisibility = useCallback(
    (layerId: CanvasLayerId) => {
      updateProject(prev => {
        const hidden = prev.settings.hiddenLayers || [];
        const nextHidden = hidden.includes(layerId)
          ? hidden.filter(l => l !== layerId)
          : [...hidden, layerId];
        return {
          ...prev,
          settings: {
            ...prev.settings,
            hiddenLayers: nextHidden
          }
        };
      });
    },
    [updateProject]
  );

  const toggleLayerLock = useCallback(
    (layerId: CanvasLayerId) => {
      updateProject(prev => {
        const locked = prev.settings.lockedLayers || [];
        const nextLocked = locked.includes(layerId)
          ? locked.filter(l => l !== layerId)
          : [...locked, layerId];
        return {
          ...prev,
          settings: {
            ...prev.settings,
            lockedLayers: nextLocked
          }
        };
      });
    },
    [updateProject]
  );

  const autoAssignDeviceLayers = useCallback((): AutoLayeringSummary => {
    const currentSnapshot = historyRef.current[historyIndexRef.current] || project;
    const plan = computeAutoLayeringPlan(currentSnapshot);
    updateProject(prev => {
      const nextPlan = computeAutoLayeringPlan(prev);
      return {
        ...prev,
        nodes: nextPlan.nodes
      };
    });
    return plan.summary;
  }, [project, historyRef, historyIndexRef, updateProject]);

  const autoAssignIps = useCallback(
    (options?: { preserveExistingValid?: boolean }): AutoAssignIpResult => {
      let result = autoAssignTopologyIps(project, options);
      updateProject(prev => {
        const computed = autoAssignTopologyIps(prev, options);
        result = computed;
        if (!computed.ok || (computed.assignedCount === 0 && computed.preservedCount === 0)) {
          return prev;
        }
        return {
          ...prev,
          assets: computed.updatedAssets
        };
      });
      return result;
    },
    [project, updateProject]
  );

  const upsertVlan = useCallback(
    (spec: Omit<VlanSpec, 'id'> & { id?: string }) => {
      updateProject(prev => {
        const current = prev.vlans || [];
        const id = spec.id || `vlan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: VlanSpec = { ...spec, id };
        const exists = current.some(v => v.id === id);
        return {
          ...prev,
          vlans: exists ? current.map(v => (v.id === id ? entry : v)) : [...current, entry]
        };
      });
    },
    [updateProject]
  );

  const deleteVlan = useCallback(
    (id: string) => {
      updateProject(prev => ({
        ...prev,
        vlans: (prev.vlans || []).filter(v => v.id !== id)
      }));
    },
    [updateProject]
  );

  const upsertSubnet = useCallback(
    (spec: Omit<SubnetSpec, 'id'> & { id?: string }) => {
      updateProject(prev => {
        const current = prev.subnets || [];
        const id = spec.id || `subnet_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: SubnetSpec = { ...spec, id };
        const exists = current.some(s => s.id === id);
        return {
          ...prev,
          subnets: exists ? current.map(s => (s.id === id ? entry : s)) : [...current, entry]
        };
      });
    },
    [updateProject]
  );

  const deleteSubnet = useCallback(
    (id: string) => {
      updateProject(prev => ({
        ...prev,
        subnets: (prev.subnets || []).filter(s => s.id !== id)
      }));
    },
    [updateProject]
  );

  const upsertPatchLink = useCallback(
    (link: Omit<PatchLink, 'id'> & { id?: string }) => {
      updateProject(prev => {
        const current = prev.patchLinks || [];
        const id = link.id || `patch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: PatchLink = { ...link, id };
        const exists = current.some(p => p.id === id);
        return {
          ...prev,
          patchLinks: exists ? current.map(p => (p.id === id ? entry : p)) : [...current, entry]
        };
      });
    },
    [updateProject]
  );

  const deletePatchLink = useCallback(
    (id: string) => {
      updateProject(prev => ({
        ...prev,
        patchLinks: (prev.patchLinks || []).filter(p => p.id !== id)
      }));
    },
    [updateProject]
  );

  return useMemo(
    () => ({
      updateProjectMeta,
      setDesignMode,
      setActiveFloor,
      updateSettings,
      syncProjectScaleFromCad,
      toggleLayerVisibility,
      toggleLayerLock,
      autoAssignDeviceLayers,
      autoAssignIps,
      upsertVlan,
      deleteVlan,
      upsertSubnet,
      deleteSubnet,
      upsertPatchLink,
      deletePatchLink
    }),
    [
      updateProjectMeta,
      setDesignMode,
      setActiveFloor,
      updateSettings,
      syncProjectScaleFromCad,
      toggleLayerVisibility,
      toggleLayerLock,
      autoAssignDeviceLayers,
      autoAssignIps,
      upsertVlan,
      deleteVlan,
      upsertSubnet,
      deleteSubnet,
      upsertPatchLink,
      deletePatchLink
    ]
  );
}
