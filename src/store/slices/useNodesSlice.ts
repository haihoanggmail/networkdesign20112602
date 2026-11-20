import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  CableEdge,
  DeviceAsset,
  DiagramNode,
  ProjectState,
  SelectionState,
  ServerRack
} from '../../types/infrastructure';
import {
  DEVICE_CATALOG,
  CustomDevicePreset,
  createDeviceAssetFromPreset
} from '../../data/deviceCatalog';
import { estimateCableLengthMeters } from '../../utils/cableRouting';
import { normalizeScalePxPerMeter } from '../../utils/scaleUtils';
import { computeSnapToGridAutoAlign, SnapToGridAlignMode } from '../../utils/snapGuides';
import { buildProjectLegendData, computeRecommendedLegendSize } from '../../utils/legendGenerator';
import { findNextAvailableIpInProject, isIpAssignableCategory } from '../../utils/ipAutoAssign';
import { classifyDeviceLayer, isNodePositionLocked, resolveNodeLayer } from '../../utils/layerPolicy';
import {
  CAMERA_FOV_DEFAULT_DEG,
  CAMERA_RANGE_DEFAULT_M,
  WIFI_DEFAULT_ANGLE_DEG,
  WIFI_DEFAULT_RADIUS_M,
  clampCameraFovDeg,
  clampCameraRangeMeters,
  clampWifiAngleDeg,
  clampWifiRadiusMeters,
  normalizeRotationDeg,
  resolveCameraFov,
  resolveWifiCoverage
} from '../../utils/coverageUtils';
import {
  pruneOrphanAssets,
  pruneOrphanPatchLinks,
  syncAssetPortsWithCables
} from './rackDeviceHelpers';
import { buildRackLookupIndex, resolveRackForDiagramNode } from '../../engineering';

function syncRackPositionsFromNodes(
  prev: ProjectState,
  movedNodes: DiagramNode[]
): ServerRack[] {
  const movedRackNodes = movedNodes.filter(n => n.type === 'rack');
  if (movedRackNodes.length === 0 || prev.racks.length === 0) return prev.racks;

  const lookup = buildRackLookupIndex(prev.racks);
  const rackUpdates = new Map<string, { x: number; y: number }>();

  for (const rn of movedRackNodes) {
    // Prefer floorplan rack nodes over rack-elevation layout nodes when syncing physical coordinates
    if (rn.diagramMode === 'rack' && prev.nodes.some(other => other.id !== rn.id && other.type === 'rack' && other.diagramMode === 'floorplan' && (other.customData?.rackId || other.id) === (rn.customData?.rackId || rn.id))) {
      continue;
    }
    const matchedRack = resolveRackForDiagramNode(rn, prev.assets, lookup);
    if (matchedRack && (matchedRack.x !== rn.x || matchedRack.y !== rn.y)) {
      rackUpdates.set(matchedRack.id, { x: rn.x, y: rn.y });
    }
  }

  if (rackUpdates.size === 0) return prev.racks;
  return prev.racks.map(r => {
    const upd = rackUpdates.get(r.id);
    return upd ? { ...r, x: upd.x, y: upd.y } : r;
  });
}

function recalculateConnectedCableLengths(
  prev: ProjectState,
  nextNodes: DiagramNode[],
  movedIdSet: Set<string>
): CableEdge[] {
  if (movedIdSet.size === 0 || prev.cables.length === 0) return prev.cables;
  const pxPerMeter = normalizeScalePxPerMeter(prev.settings.scale);
  const nodeMap = new Map(nextNodes.map(n => [n.id, n]));
  let changed = false;

  const nextCables = prev.cables.map(c => {
    if (!movedIdSet.has(c.sourceNodeId) && !movedIdSet.has(c.targetNodeId)) return c;
    const src = nodeMap.get(c.sourceNodeId);
    const tgt = nodeMap.get(c.targetNodeId);
    if (!src || !tgt) return c;
    const nextLen = estimateCableLengthMeters(c, src, tgt, pxPerMeter);
    if (nextLen === c.lengthMeters) return c;
    changed = true;
    return { ...c, lengthMeters: nextLen };
  });

  return changed ? nextCables : prev.cables;
}

export function applyCommitMovedNodesToProject(
  prev: ProjectState,
  nodeIds: string[],
  options?: { snapX?: boolean; snapY?: boolean }
): ProjectState {
  if (nodeIds.length === 0) return prev;
  const idSet = new Set(nodeIds);
  const shouldSnapX = options?.snapX ?? true;
  const shouldSnapY = options?.snapY ?? true;
  const snap = prev.settings.snapToGrid ? prev.settings.gridSize : 1;

  const movedNodes: DiagramNode[] = [];
  let nodesChanged = false;
  const nextNodes = prev.nodes.map(n => {
    if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
    const nextX =
      snap > 1 && shouldSnapX ? Math.max(10, Math.round(n.x / snap) * snap) : n.x;
    const nextY =
      snap > 1 && shouldSnapY ? Math.max(10, Math.round(n.y / snap) * snap) : n.y;
    const updated =
      nextX !== n.x || nextY !== n.y ? { ...n, x: nextX, y: nextY } : n;
    if (updated !== n) nodesChanged = true;
    movedNodes.push(updated);
    return updated;
  });

  const nextRacks = syncRackPositionsFromNodes(prev, movedNodes);
  const nextCables = recalculateConnectedCableLengths(prev, nextNodes, idSet);

  if (!nodesChanged && nextRacks === prev.racks && nextCables === prev.cables) {
    return prev;
  }

  return {
    ...prev,
    nodes: nodesChanged ? nextNodes : prev.nodes,
    racks: nextRacks,
    cables: nextCables
  };
}

export function applyNodesRotationToProject(
  prev: ProjectState,
  nodeIds: string[],
  rotationDeg: number
): ProjectState {
  if (nodeIds.length === 0 || !Number.isFinite(rotationDeg)) return prev;
  const normalized = normalizeRotationDeg(rotationDeg);
  const idSet = new Set(nodeIds);
  const lockedLayers = prev.settings.lockedLayers || [];
  let changed = false;

  const nextNodes = prev.nodes.map(n => {
    if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
    if (lockedLayers.includes(resolveNodeLayer(n, prev.assets))) return n;
    if (n.rotation === normalized) return n;
    changed = true;
    return { ...n, rotation: normalized };
  });

  return changed ? { ...prev, nodes: nextNodes } : prev;
}

export type MirrorAxis = 'horizontal' | 'vertical';

export function applyNodesMirrorToProject(
  prev: ProjectState,
  nodeIds: string[],
  axis: MirrorAxis
): ProjectState {
  if (nodeIds.length === 0) return prev;
  const idSet = new Set(nodeIds);
  const lockedLayers = prev.settings.lockedLayers || [];
  let changed = false;

  const nextNodes = prev.nodes.map(n => {
    if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
    if (lockedLayers.includes(resolveNodeLayer(n, prev.assets))) return n;

    const asset = n.assetId ? prev.assets[n.assetId] : undefined;
    const isDirectional =
      Boolean(resolveCameraFov(n, asset)) ||
      Boolean(resolveWifiCoverage(n, asset)?.isDirectional);

    const nextFlipX = axis === 'horizontal' ? !n.flipX : Boolean(n.flipX);
    const nextFlipY = axis === 'vertical' ? !n.flipY : Boolean(n.flipY);

    let nextRotation = normalizeRotationDeg(n.rotation || 0);
    if (isDirectional) {
      nextRotation =
        axis === 'horizontal'
          ? normalizeRotationDeg(180 - nextRotation)
          : normalizeRotationDeg(360 - nextRotation);
    }

    changed = true;
    return {
      ...n,
      flipX: nextFlipX ? true : undefined,
      flipY: nextFlipY ? true : undefined,
      rotation: nextRotation
    };
  });

  return changed ? { ...prev, nodes: nextNodes } : prev;
}

export function applyWifiCoverageToProject(
  prev: ProjectState,
  nodeId: string,
  partial: { radiusMeters?: number; angleDeg?: number }
): ProjectState {
  const targetNode = prev.nodes.find(n => n.id === nodeId);
  if (!targetNode || isNodePositionLocked(targetNode)) return prev;
  const lockedLayers = prev.settings.lockedLayers || [];
  if (
    lockedLayers.includes(resolveNodeLayer(targetNode, prev.assets)) ||
    lockedLayers.includes('wifi')
  ) {
    return prev;
  }

  const asset = targetNode.assetId ? prev.assets[targetNode.assetId] : undefined;
  const nextRadius =
    partial.radiusMeters !== undefined
      ? clampWifiRadiusMeters(partial.radiusMeters)
      : clampWifiRadiusMeters(
          asset?.wifiSpecs?.coverageRadiusMeters ??
            targetNode.customData?.coverageRadiusMeters ??
            WIFI_DEFAULT_RADIUS_M
        );
  const nextAngle =
    partial.angleDeg !== undefined
      ? clampWifiAngleDeg(partial.angleDeg)
      : clampWifiAngleDeg(
          asset?.wifiSpecs?.coverageAngleDeg ??
            targetNode.customData?.coverageAngleDeg ??
            WIFI_DEFAULT_ANGLE_DEG
        );

  const nextNodes = prev.nodes.map(n =>
    n.id === nodeId
      ? {
          ...n,
          customData: {
            ...n.customData,
            coverageRadiusMeters: nextRadius,
            coverageAngleDeg: nextAngle
          }
        }
      : n
  );

  let nextAssets = prev.assets;
  if (asset) {
    nextAssets = {
      ...prev.assets,
      [asset.id]: {
        ...asset,
        wifiSpecs: asset.wifiSpecs
          ? {
              ...asset.wifiSpecs,
              coverageRadiusMeters: nextRadius,
              coverageAngleDeg: nextAngle
            }
          : asset.category === 'ap'
          ? {
              standard: 'Wi-Fi 6 (802.11ax)',
              bands: '2.4GHz + 5GHz',
              txPowerDbm: 22,
              coverageRadiusMeters: nextRadius,
              coverageAngleDeg: nextAngle,
              maxClients: 200,
              ssid: 'HACHIHI-WIFI'
            }
          : undefined
      }
    };
  }

  return {
    ...prev,
    nodes: nextNodes,
    assets: nextAssets
  };
}

export function applyCameraFovToProject(
  prev: ProjectState,
  nodeId: string,
  partial: { fovAngle?: number; irDistanceMeters?: number }
): ProjectState {
  const targetNode = prev.nodes.find(n => n.id === nodeId);
  if (!targetNode || isNodePositionLocked(targetNode)) return prev;
  const lockedLayers = prev.settings.lockedLayers || [];
  if (
    lockedLayers.includes(resolveNodeLayer(targetNode, prev.assets)) ||
    lockedLayers.includes('fov')
  ) {
    return prev;
  }

  const asset = targetNode.assetId ? prev.assets[targetNode.assetId] : undefined;
  const nextFov =
    partial.fovAngle !== undefined
      ? clampCameraFovDeg(partial.fovAngle)
      : clampCameraFovDeg(
          asset?.cameraSpecs?.fovAngle ?? targetNode.customData?.fov ?? CAMERA_FOV_DEFAULT_DEG
        );
  const nextRange =
    partial.irDistanceMeters !== undefined
      ? clampCameraRangeMeters(partial.irDistanceMeters)
      : clampCameraRangeMeters(
          asset?.cameraSpecs?.irDistanceMeters ??
            targetNode.customData?.irDistance ??
            CAMERA_RANGE_DEFAULT_M
        );

  const nextNodes = prev.nodes.map(n =>
    n.id === nodeId
      ? {
          ...n,
          customData: {
            ...n.customData,
            fov: nextFov,
            irDistance: nextRange
          }
        }
      : n
  );

  let nextAssets = prev.assets;
  if (asset) {
    nextAssets = {
      ...prev.assets,
      [asset.id]: {
        ...asset,
        cameraSpecs: asset.cameraSpecs
          ? {
              ...asset.cameraSpecs,
              fovAngle: nextFov,
              irDistanceMeters: nextRange
            }
          : asset.category === 'camera'
          ? {
              resolution: '4K 8MP',
              lensMm: 2.8,
              fovAngle: nextFov,
              irDistanceMeters: nextRange
            }
          : undefined
      }
    };
  }

  return {
    ...prev,
    nodes: nextNodes,
    assets: nextAssets
  };
}

export interface SmartCopyPasteOptions {
  offsetX?: number;
  offsetY?: number;
  targetCanvasPos?: { x: number; y: number };
}

export interface SmartCopyPasteResult {
  nextState: ProjectState;
  createdNodeIds: string[];
  createdCableIds: string[];
  createdRackIds: string[];
}

/**
 * Pure Smart Copy-Paste reducer:
 * Duplicates selected nodes while preserving:
 * - Deep-cloned `customData` (FOV, Wi-Fi radius, legend configs, rack refs, custom metadata)
 * - Relative internal cable connections (remapped endpoints, preserved ports/VLANs/types, shifted waypoints, recalculated lengths)
 * - Synced `DeviceAsset` ports via `syncAssetPortsWithCables` (clears stale external links, binds cloned cables)
 * - Group membership (`groupId` remapped per copied cluster) and cloned `ServerRack` slots if rack + mounted devices are copied together
 */
export function applySmartCopyPasteToProject(
  prev: ProjectState,
  nodeIds: string[],
  options?: SmartCopyPasteOptions
): SmartCopyPasteResult {
  if (nodeIds.length === 0) {
    return { nextState: prev, createdNodeIds: [], createdCableIds: [], createdRackIds: [] };
  }

  const idSet = new Set(nodeIds);
  const sourceNodes = prev.nodes.filter(n => idSet.has(n.id));
  if (sourceNodes.length === 0) {
    return { nextState: prev, createdNodeIds: [], createdCableIds: [], createdRackIds: [] };
  }

  const minX = Math.min(...sourceNodes.map(n => n.x));
  const minY = Math.min(...sourceNodes.map(n => n.y));
  const snap = prev.settings.snapToGrid ? Math.max(1, prev.settings.gridSize || 20) : 1;

  let dx: number;
  let dy: number;

  if (options?.targetCanvasPos) {
    const rawTargetX = Math.max(10, options.targetCanvasPos.x);
    const rawTargetY = Math.max(10, options.targetCanvasPos.y);
    const snappedTargetX = snap > 1 ? Math.max(10, Math.round(rawTargetX / snap) * snap) : Math.round(rawTargetX);
    const snappedTargetY = snap > 1 ? Math.max(10, Math.round(rawTargetY / snap) * snap) : Math.round(rawTargetY);
    dx = snappedTargetX - minX;
    dy = snappedTargetY - minY;
  } else if (options?.offsetX !== undefined || options?.offsetY !== undefined) {
    dx = options?.offsetX ?? 48;
    dy = options?.offsetY ?? 48;
  } else {
    const baseDx = 48;
    const baseDy = 48;
    const anchor = sourceNodes[0];
    let step = 1;
    while (step < 12) {
      const candidateX = Math.max(10, anchor.x + baseDx * step);
      const candidateY = Math.max(10, anchor.y + baseDy * step);
      const overlaps = prev.nodes.some(
        n =>
          Math.abs(n.x - candidateX) < 12 &&
          Math.abs(n.y - candidateY) < 12 &&
          n.floorId === anchor.floorId &&
          n.diagramMode === anchor.diagramMode
      );
      if (!overlaps) break;
      step++;
    }
    dx = baseDx * step;
    dy = baseDy * step;
  }

  const ts = Date.now();
  const nextAssets: Record<string, DeviceAsset> = { ...prev.assets };
  const nextRacks: ServerRack[] = [...prev.racks];
  const clonedNodes: DiagramNode[] = [];
  const createdNodeIds: string[] = [];
  const createdRackIds: string[] = [];
  const nodeIdMap: Record<string, string> = {};
  const rackIdMap: Record<string, string> = {};
  const groupIdMap: Record<string, string> = {};

  // First pass: clone any Rack records included in the selection so mounted devices can remap rackId
  sourceNodes.forEach((orig, idx) => {
    const origRackId =
      orig.type === 'rack'
        ? orig.customData?.rackId || orig.id
        : orig.customData?.rackId;
    if (!origRackId || rackIdMap[origRackId]) return;
    const origRack = prev.racks.find(r => r.id === origRackId);
    if (!origRack) return;

    const newRackId = `rack_scp_${ts}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
    rackIdMap[origRack.id] = newRackId;
    createdRackIds.push(newRackId);
    nextRacks.push({
      ...structuredClone(origRack),
      id: newRackId,
      name: `${origRack.name}-Copy`,
      x: Math.max(10, orig.x + dx),
      y: Math.max(10, orig.y + dy),
      slots: {},
      rearSlots: {}
    });
  });

  // Second pass: clone nodes, customData, and linked assets
  sourceNodes.forEach((orig, idx) => {
    const newNodeId = `node_scp_${ts}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
    nodeIdMap[orig.id] = newNodeId;
    createdNodeIds.push(newNodeId);

    let mappedGroupId = orig.groupId;
    if (orig.groupId) {
      if (!groupIdMap[orig.groupId]) {
        groupIdMap[orig.groupId] = `grp_scp_${ts}_${Object.keys(groupIdMap).length}`;
      }
      mappedGroupId = groupIdMap[orig.groupId];
    }

    let newAssetId = orig.assetId;
    if (orig.assetId && prev.assets[orig.assetId]) {
      const origAsset = prev.assets[orig.assetId];
      const clonedAssetId = `dev_scp_${ts}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
      const clonedAsset = structuredClone(origAsset);
      const mappedRackId = origAsset.rackId ? rackIdMap[origAsset.rackId] : undefined;

      if (mappedRackId && origAsset.rackUnitStart) {
        const clonedRack = nextRacks.find(r => r.id === mappedRackId);
        if (clonedRack) {
          if (origAsset.rackSide === 'rear') {
            clonedRack.rearSlots = { ...(clonedRack.rearSlots || {}), [origAsset.rackUnitStart]: clonedAssetId };
          } else {
            clonedRack.slots = { ...(clonedRack.slots || {}), [origAsset.rackUnitStart]: clonedAssetId };
          }
        }
      }

      nextAssets[clonedAssetId] = {
        ...clonedAsset,
        id: clonedAssetId,
        name: `${origAsset.name}-Copy`,
        assetTag: `${origAsset.assetTag}-C`,
        rackId: mappedRackId,
        rackUnitStart: mappedRackId ? origAsset.rackUnitStart : undefined,
        rackSide: mappedRackId ? origAsset.rackSide : undefined
      };
      newAssetId = clonedAssetId;
    }

    const clonedCustomData = orig.customData ? structuredClone(orig.customData) : undefined;
    if (clonedCustomData && typeof clonedCustomData === 'object') {
      if ('locked' in clonedCustomData) {
        clonedCustomData.locked = false;
      }
      if (clonedCustomData.rackId && rackIdMap[clonedCustomData.rackId]) {
        clonedCustomData.rackId = rackIdMap[clonedCustomData.rackId];
      }
    }

    const clonedNode: DiagramNode = {
      ...structuredClone(orig),
      id: newNodeId,
      assetId: newAssetId,
      locked: false,
      groupId: mappedGroupId,
      customData: clonedCustomData,
      label: `${orig.label}-Copy`,
      x: Math.max(10, orig.x + dx),
      y: Math.max(10, orig.y + dy)
    };
    clonedNodes.push(clonedNode);
  });

  const allNodes = [...prev.nodes, ...clonedNodes];
  const allNodeMap = new Map(allNodes.map(n => [n.id, n]));

  // Third pass: clone relative cable connections (edges whose endpoints are both duplicated)
  const createdCableIds: string[] = [];
  const clonedCables: CableEdge[] = prev.cables
    .filter(c => Boolean(nodeIdMap[c.sourceNodeId] && nodeIdMap[c.targetNodeId]))
    .map((c, idx) => {
      const newCableId = `cable_scp_${ts}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
      createdCableIds.push(newCableId);
      const nextSrcId = nodeIdMap[c.sourceNodeId];
      const nextTgtId = nodeIdMap[c.targetNodeId];
      const nextCable: CableEdge = {
        ...structuredClone(c),
        id: newCableId,
        cableCode: `${c.cableCode}-C`,
        sourceNodeId: nextSrcId,
        targetNodeId: nextTgtId,
        controlPoints: c.controlPoints?.map(pt => ({
          x: Math.max(10, pt.x + dx),
          y: Math.max(10, pt.y + dy)
        }))
      };
      const srcNode = allNodeMap.get(nextSrcId);
      const tgtNode = allNodeMap.get(nextTgtId);
      if (srcNode && tgtNode) {
        nextCable.lengthMeters = estimateCableLengthMeters(
          nextCable,
          srcNode,
          tgtNode,
          normalizeScalePxPerMeter(prev.settings.scale)
        );
      }
      return nextCable;
    });

  const allCables = [...prev.cables, ...clonedCables];
  const syncedAssets = syncAssetPortsWithCables(nextAssets, allNodes, allCables);

  return {
    nextState: {
      ...prev,
      racks: nextRacks,
      assets: syncedAssets,
      nodes: allNodes,
      cables: allCables
    },
    createdNodeIds,
    createdCableIds,
    createdRackIds
  };
}

export interface AddNodePlacementOptions {
  floorId?: string;
  diagramMode?: ProjectState['activeMode'];
  elevationZ?: number;
}

export interface NodesSliceDeps {
  project: ProjectState;
  projectRef: MutableRefObject<ProjectState>;
  copiedStyle: DiagramNode['style'] | null;
  setCopiedStyle: Dispatch<SetStateAction<DiagramNode['style'] | null>>;
  smartClipboardNodeIds: string[];
  setSmartClipboardNodeIds: Dispatch<SetStateAction<string[]>>;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  updateProject: (updater: (prev: ProjectState) => ProjectState) => void;
  updateProjectTransient: (updater: (prev: ProjectState) => ProjectState) => void;
  commitDragSnapshot: () => void;
  addRack: (
    name: string,
    totalUnits?: number,
    x?: number,
    y?: number,
    options?: AddNodePlacementOptions
  ) => void;
}

export function useNodesSlice({
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
}: NodesSliceDeps) {
  const updateDeviceAsset = useCallback((assetId: string, partial: Partial<DeviceAsset>) => {
    updateProject(prev => {
      const currentAsset = prev.assets[assetId];
      if (!currentAsset) return prev;
      const updatedAsset = { ...currentAsset, ...partial };

      const updatedNodes = prev.nodes.map(n => {
        if (n.assetId !== assetId) return n;
        const patch: Partial<DiagramNode> = {};
        if (partial.name !== undefined) patch.label = partial.name;
        if ('customIcon' in partial) patch.customIcon = partial.customIcon;
        if ('customImageUrl' in partial) patch.customImageUrl = partial.customImageUrl;
        if (partial.floorId !== undefined && (!n.floorId || n.floorId === currentAsset.floorId)) {
          patch.floorId = partial.floorId || undefined;
        }
        return Object.keys(patch).length > 0 ? { ...n, ...patch } : n;
      });

      return {
        ...prev,
        assets: {
          ...prev.assets,
          [assetId]: updatedAsset
        },
        nodes: updatedNodes
      };
    });
  }, [updateProject]);

  const updateNode = useCallback((nodeId: string, partial: Partial<DiagramNode>) => {
    updateProject(prev => {
      const targetNode = prev.nodes.find(n => n.id === nodeId);
      const nextNodes = prev.nodes.map(n => (n.id === nodeId ? { ...n, ...partial } : n));
      let nextAssets = prev.assets;

      if (
        targetNode?.assetId &&
        prev.assets[targetNode.assetId] &&
        ('customIcon' in partial || 'customImageUrl' in partial || partial.label !== undefined)
      ) {
        const asset = prev.assets[targetNode.assetId];
        const assetPatch: Partial<DeviceAsset> = {};
        if ('customIcon' in partial) assetPatch.customIcon = partial.customIcon;
        if ('customImageUrl' in partial) assetPatch.customImageUrl = partial.customImageUrl;
        if (partial.label !== undefined) assetPatch.name = partial.label;
        nextAssets = {
          ...prev.assets,
          [asset.id]: { ...asset, ...assetPatch }
        };
      }

      return {
        ...prev,
        assets: nextAssets,
        nodes: nextNodes
      };
    });
  }, [updateProject]);

  const setNodeIconOrLogo = useCallback(
    (nodeId: string, visual: { customIcon?: string; customImageUrl?: string }) => {
      updateNode(nodeId, {
        customIcon: visual.customIcon,
        customImageUrl: visual.customImageUrl
      });
    },
    [updateNode]
  );

  const toggleNodeLock = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => {
      const targets = prev.nodes.filter(n => idSet.has(n.id));
      const allLocked = targets.length > 0 && targets.every(n => isNodePositionLocked(n));
      const nextLocked = !allLocked;
      return {
        ...prev,
        nodes: prev.nodes.map(n =>
          idSet.has(n.id)
            ? {
                ...n,
                locked: nextLocked,
                customData: {
                  ...(n.customData || {}),
                  locked: nextLocked
                }
              }
            : n
        )
      };
    });
  }, [updateProject]);

  const rotateNodes = useCallback(
    (nodeIds: string[], rotationDeg: number) => {
      updateProject(prev => applyNodesRotationToProject(prev, nodeIds, rotationDeg));
    },
    [updateProject]
  );

  const rotateNodesTransient = useCallback(
    (nodeIds: string[], rotationDeg: number) => {
      updateProjectTransient(prev => applyNodesRotationToProject(prev, nodeIds, rotationDeg));
    },
    [updateProjectTransient]
  );

  const mirrorNodes = useCallback(
    (nodeIds: string[], axis: MirrorAxis) => {
      updateProject(prev => applyNodesMirrorToProject(prev, nodeIds, axis));
    },
    [updateProject]
  );

  const updateWifiCoverage = useCallback(
    (nodeId: string, partial: { radiusMeters?: number; angleDeg?: number }) => {
      updateProject(prev => applyWifiCoverageToProject(prev, nodeId, partial));
    },
    [updateProject]
  );

  const updateWifiCoverageTransient = useCallback(
    (nodeId: string, partial: { radiusMeters?: number; angleDeg?: number }) => {
      updateProjectTransient(prev => applyWifiCoverageToProject(prev, nodeId, partial));
    },
    [updateProjectTransient]
  );

  const updateWifiCoverageRadiusTransient = useCallback(
    (nodeId: string, radiusMeters: number) => {
      updateWifiCoverageTransient(nodeId, { radiusMeters });
    },
    [updateWifiCoverageTransient]
  );

  const updateCameraFov = useCallback(
    (nodeId: string, partial: { fovAngle?: number; irDistanceMeters?: number }) => {
      updateProject(prev => applyCameraFovToProject(prev, nodeId, partial));
    },
    [updateProject]
  );

  const updateCameraFovTransient = useCallback(
    (nodeId: string, partial: { fovAngle?: number; irDistanceMeters?: number }) => {
      updateProjectTransient(prev => applyCameraFovToProject(prev, nodeId, partial));
    },
    [updateProjectTransient]
  );

  const moveNodesTransient = useCallback(
    (nodeIds: string[], dx: number, dy: number) => {
      if ((dx === 0 && dy === 0) || nodeIds.length === 0) return;
      const idSet = new Set(nodeIds);
      updateProjectTransient(prev => {
        const lockedLayers = prev.settings.lockedLayers || [];
        const movedNodes: DiagramNode[] = [];
        let changed = false;
        const nextNodes = prev.nodes.map(n => {
          if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
          const layer = resolveNodeLayer(n, prev.assets);
          if (lockedLayers.includes(layer)) return n;
          changed = true;
          const updated = {
            ...n,
            x: Math.max(10, n.x + dx),
            y: Math.max(10, n.y + dy)
          };
          movedNodes.push(updated);
          return updated;
        });
        if (!changed) return prev;
        return {
          ...prev,
          nodes: nextNodes,
          racks: syncRackPositionsFromNodes(prev, movedNodes)
        };
      });
    },
    [updateProjectTransient]
  );

  const snapNodesAndCommitDrag = useCallback(
    (nodeIds: string[], options?: { snapX?: boolean; snapY?: boolean }) => {
      if (nodeIds.length > 0) {
        updateProjectTransient(prev => applyCommitMovedNodesToProject(prev, nodeIds, options));
      }
      commitDragSnapshot();
    },
    [updateProjectTransient, commitDragSnapshot]
  );

  const moveNode = useCallback((nodeId: string, dx: number, dy: number) => {
    updateProject(prev => {
      const snap = prev.settings.snapToGrid ? prev.settings.gridSize : 1;
      const movedNodes: DiagramNode[] = [];
      let changed = false;
      const nextNodes = prev.nodes.map(n => {
        if (n.id !== nodeId || isNodePositionLocked(n)) return n;
        const rawX = n.x + dx;
        const rawY = n.y + dy;
        const snappedX = Math.round(rawX / snap) * snap;
        const snappedY = Math.round(rawY / snap) * snap;
        changed = true;
        const updated = { ...n, x: Math.max(10, snappedX), y: Math.max(10, snappedY) };
        movedNodes.push(updated);
        return updated;
      });
      if (!changed) return prev;
      return {
        ...prev,
        nodes: nextNodes,
        racks: syncRackPositionsFromNodes(prev, movedNodes),
        cables: recalculateConnectedCableLengths(prev, nextNodes, new Set([nodeId]))
      };
    });
  }, [updateProject]);

  const resizeNodeTransient = useCallback(
    (nodeId: string, rect: { x: number; y: number; width: number; height: number }) => {
      updateProjectTransient(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => {
          if (n.id !== nodeId || isNodePositionLocked(n)) return n;
          const minW = n.type === 'rack' ? 210 : n.type === 'legend' ? 220 : 44;
          const minH = n.type === 'rack' || n.type === 'legend' ? 120 : 36;
          return {
            ...n,
            x: Math.max(10, rect.x),
            y: Math.max(10, rect.y),
            width: Math.max(minW, Math.round(rect.width)),
            height: Math.max(minH, Math.round(rect.height))
          };
        })
      }));
    },
    [updateProjectTransient]
  );

  const snapNodeResizeAndCommit = useCallback(
    (nodeId: string) => {
      updateProjectTransient(prev => {
        const snap = prev.settings.snapToGrid ? Math.max(5, Math.round(prev.settings.gridSize / 2)) : 1;
        if (snap <= 1) return prev;
        return {
          ...prev,
          nodes: prev.nodes.map(n => {
            if (n.id !== nodeId || isNodePositionLocked(n)) return n;
            const minW = n.type === 'rack' ? 210 : n.type === 'legend' ? 220 : 44;
            const minH = n.type === 'rack' || n.type === 'legend' ? 120 : 36;
            return {
              ...n,
              x: Math.max(10, Math.round(n.x / snap) * snap),
              y: Math.max(10, Math.round(n.y / snap) * snap),
              width: Math.max(minW, Math.round(n.width / snap) * snap),
              height: Math.max(minH, Math.round(n.height / snap) * snap)
            };
          })
        };
      });
      commitDragSnapshot();
    },
    [updateProjectTransient, commitDragSnapshot]
  );

  const addDeviceFromCatalog = useCallback(
    (presetName: string, dropX = 300, dropY = 200, options?: AddNodePlacementOptions) => {
      const preset = DEVICE_CATALOG.find(p => p.name === presetName) || DEVICE_CATALOG[0];
      const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
      const snappedX = Math.max(10, Math.round(dropX / snap) * snap);
      const snappedY = Math.max(10, Math.round(dropY / snap) * snap);

      if (preset.category === 'rack') {
        addRack(preset.name, preset.defaultUHeight || 42, snappedX, snappedY, options);
        return;
      }

      const elevationZ =
        typeof options?.elevationZ === 'number' && Number.isFinite(options.elevationZ)
          ? options.elevationZ
          : undefined;
      let createdNodeId = '';

      updateProject(prev => {
        const assetCount = Object.keys(prev.assets).length + 1;
        const newAsset = createDeviceAssetFromPreset(preset, assetCount);
        const targetFloorId = options?.floorId ?? prev.activeFloorId;
        newAsset.buildingId = prev.activeBuildingId;
        newAsset.floorId = targetFloorId;
        if (isIpAssignableCategory(newAsset.category)) {
          const nextIp = findNextAvailableIpInProject(prev, newAsset.category);
          if (nextIp) {
            if (nextIp.ipAddress) newAsset.ipAddress = nextIp.ipAddress;
            newAsset.subnetMask = nextIp.subnetMask;
            newAsset.gateway = nextIp.gateway;
          }
        }

        createdNodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const nextAssets = { ...prev.assets, [newAsset.id]: newAsset };
        const baseCustomData =
          preset.category === 'camera'
            ? { fov: 95, irDistance: 30 }
            : preset.category === 'ap'
            ? { coverageRadiusMeters: 18 }
            : undefined;
        const mergedCustomData =
          baseCustomData || elevationZ !== undefined
            ? {
                ...(baseCustomData || {}),
                ...(elevationZ !== undefined ? { elevationZ } : {})
              }
            : undefined;

        const draftNode: DiagramNode = {
          id: createdNodeId,
          diagramMode: options?.diagramMode ?? prev.activeMode,
          floorId: targetFloorId,
          type:
            preset.category === 'cloud'
              ? 'cloud'
              : preset.category === 'telecom_tower'
              ? 'telecom_tower'
              : 'device',
          assetId: newAsset.id,
          label: newAsset.name,
          x: snappedX,
          y: snappedY,
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
          },
          customData: mergedCustomData
        };
        const newNode: DiagramNode = prev.settings.autoLayeringEnabled
          ? { ...draftNode, layerId: classifyDeviceLayer(draftNode, nextAssets) }
          : draftNode;

        const shouldEnableCoverage =
          (preset.category === 'camera' || preset.category === 'ap') &&
          !prev.settings.showCoverageRadius;
        return {
          ...prev,
          assets: nextAssets,
          nodes: [...prev.nodes, newNode],
          settings: shouldEnableCoverage
            ? { ...prev.settings, showCoverageRadius: true }
            : prev.settings
        };
      });

      if (createdNodeId) {
        setSelection({ type: 'node', id: createdNodeId });
      }
    },
    [project.settings.snapToGrid, project.settings.gridSize, updateProject, addRack, setSelection]
  );

  const placeExistingAssetOnCanvas = useCallback(
    (assetId: string, dropX = 320, dropY = 220, options?: AddNodePlacementOptions) => {
      const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
      const snappedX = Math.max(10, Math.round(dropX / snap) * snap);
      const snappedY = Math.max(10, Math.round(dropY / snap) * snap);
      const elevationZ =
        typeof options?.elevationZ === 'number' && Number.isFinite(options.elevationZ)
          ? options.elevationZ
          : undefined;
      let targetSelectNodeId = '';

      updateProject(prev => {
        const asset = prev.assets[assetId];
        if (!asset) return prev;

        const targetMode = options?.diagramMode ?? prev.activeMode;
        const targetFloorId = options?.floorId ?? prev.activeFloorId ?? asset.floorId;

        const existingNode = prev.nodes.find(
          n =>
            n.assetId === assetId &&
            n.diagramMode === targetMode &&
            (!targetFloorId || !n.floorId || n.floorId === targetFloorId)
        );
        if (existingNode) {
          targetSelectNodeId = existingNode.id;
          return prev;
        }

        const matchedPreset =
          DEVICE_CATALOG.find(p => p.model === asset.model && p.category === asset.category) ||
          DEVICE_CATALOG.find(p => p.category === asset.category) ||
          DEVICE_CATALOG[0];

        const newNodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        targetSelectNodeId = newNodeId;

        const baseCustomData =
          asset.category === 'camera'
            ? {
                fov: asset.cameraSpecs?.fovAngle ?? 95,
                irDistance: asset.cameraSpecs?.irDistanceMeters ?? 30
              }
            : asset.category === 'ap'
            ? {
                coverageRadiusMeters: asset.wifiSpecs?.coverageRadiusMeters ?? 18
              }
            : undefined;
        const mergedCustomData =
          baseCustomData || elevationZ !== undefined
            ? {
                ...(baseCustomData || {}),
                ...(elevationZ !== undefined ? { elevationZ } : {})
              }
            : undefined;

        const draftNode: DiagramNode = {
          id: newNodeId,
          diagramMode: targetMode,
          floorId: targetFloorId,
          type:
            asset.category === 'cloud'
              ? 'cloud'
              : asset.category === 'telecom_tower'
              ? 'telecom_tower'
              : 'device',
          assetId: asset.id,
          label: asset.name,
          x: snappedX,
          y: snappedY,
          width: matchedPreset.defaultWidth,
          height: matchedPreset.defaultHeight,
          rotation: 0,
          customIcon: asset.customIcon,
          customImageUrl: asset.customImageUrl,
          style: {
            backgroundColor: matchedPreset.color,
            borderColor: '#334155',
            borderWidth: 2,
            borderStyle: 'solid',
            opacity: 1,
            textColor: '#ffffff',
            iconColor: '#ffffff'
          },
          customData: mergedCustomData
        };

        const newNode: DiagramNode = prev.settings.autoLayeringEnabled
          ? { ...draftNode, layerId: classifyDeviceLayer(draftNode, prev.assets) }
          : draftNode;

        return {
          ...prev,
          nodes: [...prev.nodes, newNode]
        };
      });

      if (targetSelectNodeId) {
        setSelection({ type: 'node', id: targetSelectNodeId });
      }
    },
    [project.settings.snapToGrid, project.settings.gridSize, updateProject, setSelection]
  );

  const addCustomDevicePresetToCanvas = useCallback(
    (preset: CustomDevicePreset, dropX = 300, dropY = 200, options?: AddNodePlacementOptions) => {
      const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
      const snappedX = Math.max(10, Math.round(dropX / snap) * snap);
      const snappedY = Math.max(10, Math.round(dropY / snap) * snap);
      const elevationZ =
        typeof options?.elevationZ === 'number' && Number.isFinite(options.elevationZ)
          ? options.elevationZ
          : undefined;
      let createdNodeId = '';

      updateProject(prev => {
        const assetCount = Object.keys(prev.assets).length + 1;
        const newAsset = createDeviceAssetFromPreset(preset, assetCount);
        const targetFloorId = options?.floorId ?? prev.activeFloorId;
        newAsset.buildingId = prev.activeBuildingId;
        newAsset.floorId = targetFloorId;
        if (isIpAssignableCategory(newAsset.category)) {
          const nextIp = findNextAvailableIpInProject(prev, newAsset.category);
          if (nextIp) {
            if (nextIp.ipAddress) newAsset.ipAddress = nextIp.ipAddress;
            newAsset.subnetMask = nextIp.subnetMask;
            newAsset.gateway = nextIp.gateway;
          }
        }
        if (preset.iconName) {
          newAsset.customIcon = preset.iconName;
        }

        createdNodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const nextAssets = { ...prev.assets, [newAsset.id]: newAsset };
        const baseCustomData =
          preset.category === 'camera'
            ? { fov: 95, irDistance: 30 }
            : preset.category === 'ap'
            ? { coverageRadiusMeters: 18 }
            : undefined;
        const mergedCustomData =
          baseCustomData || elevationZ !== undefined
            ? {
                ...(baseCustomData || {}),
                ...(elevationZ !== undefined ? { elevationZ } : {})
              }
            : undefined;

        const draftNode: DiagramNode = {
          id: createdNodeId,
          diagramMode: options?.diagramMode ?? prev.activeMode,
          floorId: targetFloorId,
          type:
            preset.category === 'cloud'
              ? 'cloud'
              : preset.category === 'telecom_tower'
              ? 'telecom_tower'
              : 'device',
          assetId: newAsset.id,
          label: newAsset.name,
          x: snappedX,
          y: snappedY,
          width: preset.defaultWidth || 150,
          height: preset.defaultHeight || 56,
          rotation: 0,
          customIcon: preset.iconName,
          style: {
            backgroundColor: preset.color || '#155EEF',
            borderColor: '#334155',
            borderWidth: 2,
            borderStyle: 'solid',
            opacity: 1,
            textColor: '#ffffff',
            iconColor: '#ffffff'
          },
          customData: mergedCustomData
        };
        const newNode: DiagramNode = prev.settings.autoLayeringEnabled
          ? { ...draftNode, layerId: classifyDeviceLayer(draftNode, nextAssets) }
          : draftNode;

        const shouldEnableCoverage =
          (preset.category === 'camera' || preset.category === 'ap') &&
          !prev.settings.showCoverageRadius;
        return {
          ...prev,
          assets: nextAssets,
          nodes: [...prev.nodes, newNode],
          settings: shouldEnableCoverage
            ? { ...prev.settings, showCoverageRadius: true }
            : prev.settings
        };
      });

      if (createdNodeId) {
        setSelection({ type: 'node', id: createdNodeId });
      }
    },
    [project.settings.snapToGrid, project.settings.gridSize, updateProject, setSelection]
  );

  const addTextNode = useCallback(
    (dropX = 300, dropY = 200, label = 'Ghi chú kỹ thuật') => {
      const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
      const snappedX = Math.round(dropX / snap) * snap;
      const snappedY = Math.round(dropY / snap) * snap;
      const nodeId = `node_txt_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

      updateProject(prev => {
        const newNode: DiagramNode = {
          id: nodeId,
          diagramMode: prev.activeMode,
          floorId: prev.activeFloorId,
          type: 'text',
          label,
          x: snappedX,
          y: snappedY,
          width: 180,
          height: 44,
          rotation: 0,
          style: {
            backgroundColor: '#FFFFFF',
            borderColor: '#CBD5E1',
            borderWidth: 1,
            borderStyle: 'dashed',
            opacity: 1,
            fontSize: 12,
            textColor: '#0F172A',
            shape: 'round'
          }
        };
        return {
          ...prev,
          nodes: [...prev.nodes, newNode]
        };
      });
      setSelection({ type: 'node', id: nodeId });
    },
    [project.settings.snapToGrid, project.settings.gridSize, updateProject, setSelection]
  );

  const addShapeNode = useCallback(
    (
      kind: 'zone' | 'rect' | 'circle' | 'wall',
      dropX = 280,
      dropY = 180,
      customLabel?: string
    ) => {
      const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
      const snappedX = Math.round(dropX / snap) * snap;
      const snappedY = Math.round(dropY / snap) * snap;
      const nodeId = `node_shp_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

      updateProject(prev => {
        const defaults =
          kind === 'zone'
            ? {
                type: 'zone' as const,
                label: customLabel || 'Vùng mạng / VLAN Zone',
                w: 260,
                h: 160,
                bg: '#EFF6FF',
                border: '#155EEF',
                bStyle: 'dashed' as const,
                shape: 'round' as const,
                text: '#1E3A8A'
              }
            : kind === 'wall'
            ? {
                type: 'wall' as const,
                label: customLabel || 'Vách ngăn kỹ thuật',
                w: 220,
                h: 24,
                bg: '#334155',
                border: '#0F172A',
                bStyle: 'solid' as const,
                shape: 'rect' as const,
                text: '#FFFFFF'
              }
            : kind === 'circle'
            ? {
                type: 'zone' as const,
                label: customLabel || 'Điểm tập trung',
                w: 120,
                h: 120,
                bg: '#F8FAFC',
                border: '#475569',
                bStyle: 'solid' as const,
                shape: 'circle' as const,
                text: '#0F172A'
              }
            : {
                type: 'zone' as const,
                label: customLabel || 'Khối chức năng',
                w: 180,
                h: 100,
                bg: '#F8FAFC',
                border: '#64748B',
                bStyle: 'solid' as const,
                shape: 'rect' as const,
                text: '#0F172A'
              };

        const newNode: DiagramNode = {
          id: nodeId,
          diagramMode: prev.activeMode,
          floorId: prev.activeFloorId,
          type: defaults.type,
          label: defaults.label,
          x: snappedX,
          y: snappedY,
          width: defaults.w,
          height: defaults.h,
          rotation: 0,
          style: {
            backgroundColor: defaults.bg,
            borderColor: defaults.border,
            borderWidth: 2,
            borderStyle: defaults.bStyle,
            opacity: kind === 'zone' ? 0.85 : 1,
            textColor: defaults.text,
            shape: defaults.shape
          }
        };

        return {
          ...prev,
          nodes: [...prev.nodes, newNode]
        };
      });
      setSelection({ type: 'node', id: nodeId });
    },
    [project.settings.snapToGrid, project.settings.gridSize, updateProject, setSelection]
  );

  const toggleNodeVisibility = useCallback(
    (nodeIds: string[], forceHidden?: boolean) => {
      if (nodeIds.length === 0) return;
      const idSet = new Set(nodeIds);
      updateProject(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => {
          if (!idSet.has(n.id)) return n;
          const nextHidden = forceHidden !== undefined ? forceHidden : !n.hidden;
          return { ...n, hidden: nextHidden ? true : undefined };
        })
      }));
      if (forceHidden !== false) {
        setSelection(prevSel => {
          if (prevSel.type === 'node' && prevSel.id && idSet.has(prevSel.id)) {
            return { type: 'none' };
          }
          return prevSel;
        });
      }
    },
    [updateProject, setSelection]
  );

  const deleteNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) return;
      const deleteSet = new Set(nodeIds);
      updateProject(prev => {
        const nextNodes = prev.nodes.filter(n => !deleteSet.has(n.id));
        const nextCables = prev.cables.filter(
          c => !deleteSet.has(c.sourceNodeId) && !deleteSet.has(c.targetNodeId)
        );
        const syncedAssets = syncAssetPortsWithCables(prev.assets, nextNodes, nextCables);
        const prunedAssets = pruneOrphanAssets(syncedAssets, nextNodes, prev.racks);
        return {
          ...prev,
          nodes: nextNodes,
          cables: nextCables,
          assets: prunedAssets,
          patchLinks: pruneOrphanPatchLinks(prev.patchLinks, prev.assets, prunedAssets)
        };
      });
      setSelection({ type: 'none' });
    },
    [updateProject, setSelection]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      deleteNodes([nodeId]);
    },
    [deleteNodes]
  );

  const duplicateNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) return;
      const idSet = new Set(nodeIds);
      const createdNodeIds: string[] = [];

      updateProject(prev => {
        const nextAssets = { ...prev.assets };
        const clonedNodes: DiagramNode[] = [];
        const nodeIdMap: Record<string, string> = {};
        const newGroupId = nodeIds.length > 1 ? `grp_${Date.now()}` : undefined;

        prev.nodes
          .filter(n => idSet.has(n.id))
          .forEach((orig, idx) => {
            const newNodeId = `node_dup_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
            nodeIdMap[orig.id] = newNodeId;
            createdNodeIds.push(newNodeId);

            let newAssetId = orig.assetId;
            if (orig.assetId && prev.assets[orig.assetId]) {
              const origAsset = prev.assets[orig.assetId];
              const clonedAssetId = `dev_dup_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
              nextAssets[clonedAssetId] = {
                ...structuredClone(origAsset),
                id: clonedAssetId,
                name: `${origAsset.name}-Copy`,
                assetTag: `${origAsset.assetTag}-C`,
                rackId: undefined,
                rackUnitStart: undefined
              };
              newAssetId = clonedAssetId;
            }

            clonedNodes.push({
              ...structuredClone(orig),
              id: newNodeId,
              assetId: newAssetId,
              locked: false,
              groupId: orig.groupId ? newGroupId : orig.groupId,
              label: `${orig.label}-Copy`,
              x: orig.x + 36,
              y: orig.y + 36
            });
          });

        const clonedCables: CableEdge[] = prev.cables
          .filter(c => nodeIdMap[c.sourceNodeId] && nodeIdMap[c.targetNodeId])
          .map((c, idx) => ({
            ...structuredClone(c),
            id: `cable_dup_${Date.now()}_${idx}`,
            cableCode: `${c.cableCode}-C`,
            sourceNodeId: nodeIdMap[c.sourceNodeId],
            targetNodeId: nodeIdMap[c.targetNodeId],
            controlPoints: c.controlPoints?.map(pt => ({ x: pt.x + 36, y: pt.y + 36 }))
          }));

        return {
          ...prev,
          assets: nextAssets,
          nodes: [...prev.nodes, ...clonedNodes],
          cables: [...prev.cables, ...clonedCables]
        };
      });

      if (createdNodeIds.length > 0) {
        setSelection({
          type: 'node',
          id: createdNodeIds[0],
          additionalIds: createdNodeIds.slice(1)
        });
      }
    },
    [updateProject, setSelection]
  );

  const copyNodesToClipboard = useCallback(
    (nodeIds: string[]) => {
      const unique = Array.from(new Set(nodeIds.filter(Boolean)));
      if (unique.length === 0) return;
      setSmartClipboardNodeIds(unique);
    },
    [setSmartClipboardNodeIds]
  );

  const smartCopyPasteNodes = useCallback(
    (nodeIds?: string[], options?: SmartCopyPasteOptions) => {
      const targetIds =
        nodeIds && nodeIds.length > 0 ? nodeIds : smartClipboardNodeIds;
      if (targetIds.length === 0) return [] as string[];

      let createdIds: string[] = [];
      updateProject(prev => {
        const res = applySmartCopyPasteToProject(prev, targetIds, options);
        createdIds = res.createdNodeIds;
        return res.nextState;
      });

      if (createdIds.length > 0) {
        setSmartClipboardNodeIds(createdIds);
        setSelection({
          type: 'node',
          id: createdIds[0],
          additionalIds: createdIds.slice(1)
        });
      }
      return createdIds;
    },
    [smartClipboardNodeIds, updateProject, setSmartClipboardNodeIds, setSelection]
  );

  const nudgeNodes = useCallback(
    (nodeIds: string[], dx: number, dy: number) => {
      if (nodeIds.length === 0 || (dx === 0 && dy === 0)) return;
      const idSet = new Set(nodeIds);
      updateProject(prev => {
        const movedNodes: DiagramNode[] = [];
        const nextNodes = prev.nodes.map(n => {
          if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
          const updated = { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) };
          movedNodes.push(updated);
          return updated;
        });
        return {
          ...prev,
          nodes: nextNodes,
          racks: syncRackPositionsFromNodes(prev, movedNodes),
          cables: recalculateConnectedCableLengths(prev, nextNodes, idSet)
        };
      });
    },
    [updateProject]
  );

  const copyNodeStyle = useCallback(
    (nodeId: string) => {
      const found = project.nodes.find(n => n.id === nodeId);
      if (!found) return false;
      setCopiedStyle({ ...found.style });
      return true;
    },
    [project.nodes, setCopiedStyle]
  );

  const pasteNodeStyle = useCallback(
    (nodeIds: string[]) => {
      if (!copiedStyle || nodeIds.length === 0) return false;
      const idSet = new Set(nodeIds);
      updateProject(prev => ({
        ...prev,
        nodes: prev.nodes.map(n =>
          idSet.has(n.id) ? { ...n, style: { ...n.style, ...copiedStyle } } : n
        )
      }));
      return true;
    },
    [copiedStyle, updateProject]
  );

  const groupNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length < 2) return;
      const groupId = `grp_${Date.now()}`;
      const idSet = new Set(nodeIds);
      updateProject(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => (idSet.has(n.id) ? { ...n, groupId } : n))
      }));
    },
    [updateProject]
  );

  const ungroupNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) return;
      const idSet = new Set(nodeIds);
      updateProject(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => (idSet.has(n.id) ? { ...n, groupId: undefined } : n))
      }));
    },
    [updateProject]
  );

  const alignNodes = useCallback(
    (
      nodeIds: string[],
      alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
    ) => {
      if (nodeIds.length < 2) return;
      const idSet = new Set(nodeIds);
      updateProject(prev => {
        const targets = prev.nodes.filter(n => idSet.has(n.id));
        if (targets.length < 2) return prev;

        const minX = Math.min(...targets.map(n => n.x));
        const maxX = Math.max(...targets.map(n => n.x + n.width));
        const avgCenterX = (minX + maxX) / 2;
        const minY = Math.min(...targets.map(n => n.y));
        const maxY = Math.max(...targets.map(n => n.y + n.height));
        const avgCenterY = (minY + maxY) / 2;

        return {
          ...prev,
          nodes: prev.nodes.map(n => {
            if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
            switch (alignment) {
              case 'left':
                return { ...n, x: minX };
              case 'center':
                return { ...n, x: Math.round(avgCenterX - n.width / 2) };
              case 'right':
                return { ...n, x: maxX - n.width };
              case 'top':
                return { ...n, y: minY };
              case 'middle':
                return { ...n, y: Math.round(avgCenterY - n.height / 2) };
              case 'bottom':
                return { ...n, y: maxY - n.height };
              default:
                return n;
            }
          })
        };
      });
    },
    [updateProject]
  );

  const distributeNodes = useCallback(
    (nodeIds: string[], axis: 'horizontal' | 'vertical') => {
      if (nodeIds.length < 3) return;
      const idSet = new Set(nodeIds);
      updateProject(prev => {
        const targets = prev.nodes
          .filter(n => idSet.has(n.id))
          .sort((a, b) => (axis === 'horizontal' ? a.x - b.x : a.y - b.y));
        if (targets.length < 3) return prev;

        const first = targets[0];
        const last = targets[targets.length - 1];
        const span = axis === 'horizontal' ? last.x - first.x : last.y - first.y;
        const step = span / (targets.length - 1);
        const posMap = new Map<string, number>();
        targets.forEach((n, idx) => {
          posMap.set(n.id, Math.round((axis === 'horizontal' ? first.x : first.y) + step * idx));
        });

        return {
          ...prev,
          nodes: prev.nodes.map(n => {
            const val = posMap.get(n.id);
            if (val === undefined || isNodePositionLocked(n)) return n;
            return axis === 'horizontal' ? { ...n, x: val } : { ...n, y: val };
          })
        };
      });
    },
    [updateProject]
  );

  const autoAlignNodesSnapToGrid = useCallback(
    (nodeIds: string[], mode: SnapToGridAlignMode, options?: { evenSpacing?: boolean }) => {
      if (nodeIds.length < 2 && mode !== 'grid-only') return;
      if (nodeIds.length === 0) return;
      const idSet = new Set(nodeIds);
      updateProject(prev => {
        const targets = prev.nodes.filter(n => idSet.has(n.id));
        const posMap = computeSnapToGridAutoAlign(
          targets,
          mode,
          prev.settings.gridSize || 20,
          { evenSpacing: options?.evenSpacing ?? true }
        );
        if (posMap.size === 0) return prev;
        return {
          ...prev,
          nodes: prev.nodes.map(n => {
            const nextPos = posMap.get(n.id);
            if (!nextPos || isNodePositionLocked(n)) return n;
            return { ...n, x: nextPos.x, y: nextPos.y };
          })
        };
      });
    },
    [updateProject]
  );

  const generateOrUpdateLegendNode = useCallback(
    (options?: {
      scope?: 'all' | 'activeFloor';
      includeCables?: boolean;
      title?: string;
      x?: number;
      y?: number;
    }) => {
      const currentSnapshot = projectRef.current;
      const preExisting = currentSnapshot.nodes.find(
        n =>
          n.type === 'legend' &&
          (!n.floorId || !currentSnapshot.activeFloorId || n.floorId === currentSnapshot.activeFloorId)
      );
      const createdLegendId = `node_legend_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const targetLegendId = preExisting?.id || createdLegendId;
      let resolvedLegendId = targetLegendId;

      updateProject(prev => {
        const existing = prev.nodes.find(
          n => n.type === 'legend' && (!n.floorId || !prev.activeFloorId || n.floorId === prev.activeFloorId)
        );
        if (existing) {
          resolvedLegendId = existing.id;
        }
        const scope = options?.scope ?? existing?.customData?.legendScope ?? 'all';
        const includeCables = options?.includeCables ?? existing?.customData?.legendIncludeCables ?? true;
        const title = options?.title ?? existing?.customData?.legendTitle ?? 'BẢNG CHÚ GIẢI KÝ HIỆU THIẾT BỊ';

        const data = buildProjectLegendData(prev, { scope, includeCables, title });
        const rec = computeRecommendedLegendSize(data);

        if (existing) {
          return {
            ...prev,
            nodes: prev.nodes.map(n =>
              n.id === existing.id
                ? {
                    ...n,
                    label: title,
                    width: Math.max(n.width, rec.width),
                    height: rec.height,
                    customData: {
                      ...n.customData,
                      legendScope: scope,
                      legendIncludeCables: includeCables,
                      legendTitle: title
                    }
                  }
                : n
            )
          };
        }

        const nonLegendNodes = prev.nodes.filter(n => n.type !== 'legend');
        let defaultX = options?.x ?? 760;
        let defaultY = options?.y ?? 60;
        if (options?.x === undefined && nonLegendNodes.length > 0) {
          const maxRight = Math.max(...nonLegendNodes.map(n => n.x + n.width));
          const minTop = Math.min(...nonLegendNodes.map(n => n.y));
          defaultX = Math.max(40, Math.round((maxRight + 48) / 20) * 20);
          defaultY = Math.max(40, Math.round(minTop / 20) * 20);
        }

        const newLegendNode: DiagramNode = {
          id: createdLegendId,
          diagramMode: prev.activeMode,
          floorId: prev.activeFloorId || undefined,
          type: 'legend',
          label: title,
          x: defaultX,
          y: defaultY,
          width: rec.width,
          height: rec.height,
          rotation: 0,
          style: {
            backgroundColor: '#ffffff',
            borderColor: '#1d4ed8',
            borderWidth: 2,
            borderStyle: 'solid',
            opacity: 1,
            textColor: '#0f172a'
          },
          customData: {
            legendScope: scope,
            legendIncludeCables: includeCables,
            legendTitle: title
          }
        };

        resolvedLegendId = createdLegendId;
        return {
          ...prev,
          nodes: [...prev.nodes, newLegendNode]
        };
      });

      setSelection({ type: 'node', id: resolvedLegendId });
      queueMicrotask(() => {
        if (resolvedLegendId && resolvedLegendId !== targetLegendId) {
          setSelection({ type: 'node', id: resolvedLegendId });
        }
      });
    },
    [projectRef, updateProject, setSelection]
  );

  const resizeLegendToFit = useCallback(
    (nodeId: string) => {
      updateProject(prev => {
        const target = prev.nodes.find(n => n.id === nodeId && n.type === 'legend');
        if (!target) return prev;
        const data = buildProjectLegendData(prev, {
          scope: target.customData?.legendScope || 'all',
          includeCables: target.customData?.legendIncludeCables ?? true,
          title: target.customData?.legendTitle || target.label
        });
        const rec = computeRecommendedLegendSize(data);
        return {
          ...prev,
          nodes: prev.nodes.map(n =>
            n.id === nodeId ? { ...n, width: Math.max(300, rec.width), height: rec.height } : n
          )
        };
      });
    },
    [updateProject]
  );

  return useMemo(
    () => ({
      updateDeviceAsset,
      updateNode,
      setNodeIconOrLogo,
      toggleNodeLock,
      rotateNodes,
      rotateNodesTransient,
      mirrorNodes,
      updateWifiCoverage,
      updateWifiCoverageTransient,
      updateWifiCoverageRadiusTransient,
      updateCameraFov,
      updateCameraFovTransient,
      moveNode,
      moveNodesTransient,
      snapNodesAndCommitDrag,
      resizeNodeTransient,
      snapNodeResizeAndCommit,
      addDeviceFromCatalog,
      placeExistingAssetOnCanvas,
      addCustomDevicePresetToCanvas,
      addTextNode,
      addShapeNode,
      toggleNodeVisibility,
      deleteNode,
      deleteNodes,
      duplicateNodes,
      copyNodesToClipboard,
      smartCopyPasteNodes,
      nudgeNodes,
      copyNodeStyle,
      pasteNodeStyle,
      groupNodes,
      ungroupNodes,
      alignNodes,
      distributeNodes,
      autoAlignNodesSnapToGrid,
      generateOrUpdateLegendNode,
      resizeLegendToFit
    }),
    [
      updateDeviceAsset,
      updateNode,
      setNodeIconOrLogo,
      toggleNodeLock,
      rotateNodes,
      rotateNodesTransient,
      mirrorNodes,
      updateWifiCoverage,
      updateWifiCoverageTransient,
      updateWifiCoverageRadiusTransient,
      updateCameraFov,
      updateCameraFovTransient,
      moveNode,
      moveNodesTransient,
      snapNodesAndCommitDrag,
      resizeNodeTransient,
      snapNodeResizeAndCommit,
      addDeviceFromCatalog,
      placeExistingAssetOnCanvas,
      addCustomDevicePresetToCanvas,
      addTextNode,
      addShapeNode,
      toggleNodeVisibility,
      deleteNode,
      deleteNodes,
      duplicateNodes,
      copyNodesToClipboard,
      smartCopyPasteNodes,
      nudgeNodes,
      copyNodeStyle,
      pasteNodeStyle,
      groupNodes,
      ungroupNodes,
      alignNodes,
      distributeNodes,
      autoAlignNodesSnapToGrid,
      generateOrUpdateLegendNode,
      resizeLegendToFit
    ]
  );
}
