import { useMemo } from 'react';
import type {
  DeviceAsset,
  DiagramNode,
  ProjectState,
  ServerRack
} from '../types/infrastructure';
import {
  buildRackLookupIndex,
  isTopologyShadowMountedInRack,
  resolveRackForDiagramNode
} from '../engineering';

export interface FloorFiltered3DResult {
  activeFloorId: string;
  isFloorBasedMode: boolean;
  isMultiFloorCutaway: boolean;
  filteredProject: ProjectState;
  filteredAssets: Record<string, DeviceAsset>;
  filteredAssetIds: string[];
}

const FLOOR_BASED_MODES = new Set(['floorplan', 'cctv', 'wifi', 'fiber']);

/**
 * Pure helper that filters a ProjectState (including project.assets, nodes, racks, rooms,
 * cableTrays, and cables) for the activeFloorId unless whole-building cutaway mode is active.
 */
export function filterProjectForActiveFloor3D(
  project: ProjectState,
  options?: { viewAllFloors?: boolean }
): FloorFiltered3DResult {
  const isFloorBasedMode = FLOOR_BASED_MODES.has(project.activeMode);
  const isMultiFloorCutaway = Boolean(
    options?.viewAllFloors && isFloorBasedMode && project.floors.length > 1
  );

  const resolvedActiveFloorId =
    project.activeFloorId && project.floors.some(f => f.id === project.activeFloorId)
      ? project.activeFloorId
      : project.floors[0]?.id || project.activeFloorId || '';

  if (isMultiFloorCutaway || !resolvedActiveFloorId || project.floors.length === 0) {
    return {
      activeFloorId: resolvedActiveFloorId,
      isFloorBasedMode,
      isMultiFloorCutaway,
      filteredProject: project,
      filteredAssets: project.assets,
      filteredAssetIds: Object.keys(project.assets)
    };
  }

  const roomFloorById = new Map<string, string>();
  for (const room of project.rooms) {
    if (room.floorId) {
      roomFloorById.set(room.id, room.floorId);
    }
  }

  const rackFloorById = new Map<string, string>();
  for (const rack of project.racks) {
    const rackFloor = rack.floorId || (rack.roomId ? roomFloorById.get(rack.roomId) : undefined);
    if (rackFloor) {
      rackFloorById.set(rack.id, rackFloor);
    }
  }

  const rackLookup = buildRackLookupIndex(project.racks || [], project.nodes);

  const matchesFloor = (itemFloorId?: string, roomId?: string, rackId?: string): boolean => {
    const resolved =
      itemFloorId ||
      (rackId ? rackFloorById.get(rackId) : undefined) ||
      (roomId ? roomFloorById.get(roomId) : undefined);
    if (!resolved) return true;
    return resolved === resolvedActiveFloorId;
  };

  const filteredRooms = project.rooms.filter(r => matchesFloor(r.floorId));

  const filteredRacks: ServerRack[] = project.racks.filter(r =>
    matchesFloor(r.floorId, r.roomId)
  );
  const filteredRackIdSet = new Set(filteredRacks.map(r => r.id));

  const filteredNodes: DiagramNode[] = project.nodes.filter(n => {
    if (n.type === 'rack') {
      const rackRecord = resolveRackForDiagramNode(n, project.assets, rackLookup);
      return matchesFloor(n.floorId || rackRecord?.floorId, rackRecord?.roomId, rackRecord?.id);
    }
    const asset = n.assetId ? project.assets[n.assetId] : undefined;
    return matchesFloor(n.floorId || asset?.floorId, asset?.roomId, asset?.rackId);
  });

  const filteredNodeIdSet = new Set(filteredNodes.map(n => n.id));
  const shadowToRackNodeId = new Map<string, string>();
  for (const n of project.nodes) {
    if (isTopologyShadowMountedInRack(n, project.assets, rackLookup)) {
      const asset = n.assetId ? project.assets[n.assetId] : undefined;
      const rackNode = asset?.rackId ? rackLookup.rackNodeByRackId.get(asset.rackId) : undefined;
      if (rackNode && filteredNodeIdSet.has(rackNode.id)) {
        shadowToRackNodeId.set(n.id, rackNode.id);
      }
    }
  }

  const nodeIdsByAssetId = new Map<string, DiagramNode[]>();
  for (const node of filteredNodes) {
    if (!node.assetId) continue;
    const list = nodeIdsByAssetId.get(node.assetId);
    if (list) list.push(node);
    else nodeIdsByAssetId.set(node.assetId, [node]);
  }

  const filteredAssets: Record<string, DeviceAsset> = {};
  for (const [assetId, asset] of Object.entries(project.assets)) {
    const linkedNodes = nodeIdsByAssetId.get(assetId);
    const matchesAssetFloor = matchesFloor(asset.floorId, asset.roomId, asset.rackId);
    const mountedInFilteredRack = asset.rackId ? filteredRackIdSet.has(asset.rackId) : false;

    if (matchesAssetFloor && (linkedNodes || mountedInFilteredRack || !asset.rackId)) {
      filteredAssets[assetId] = asset;
    }
  }

  const filteredCableTrays = (project.cableTrays || []).filter(t => matchesFloor(t.floorId));

  const filteredCables = project.cables.filter(c => {
    const effSrc = shadowToRackNodeId.get(c.sourceNodeId) || c.sourceNodeId;
    const effTgt = shadowToRackNodeId.get(c.targetNodeId) || c.targetNodeId;
    return filteredNodeIdSet.has(effSrc) && filteredNodeIdSet.has(effTgt);
  });

  const filteredProject: ProjectState = {
    ...project,
    activeFloorId: resolvedActiveFloorId,
    rooms: filteredRooms,
    racks: filteredRacks,
    nodes: filteredNodes,
    assets: filteredAssets,
    cableTrays: filteredCableTrays,
    cables: filteredCables
  };

  return {
    activeFloorId: resolvedActiveFloorId,
    isFloorBasedMode,
    isMultiFloorCutaway,
    filteredProject,
    filteredAssets,
    filteredAssetIds: Object.keys(filteredAssets)
  };
}

/**
 * React hook that reactively filters ProjectState and DeviceAssets for Network3DScene
 * whenever store.project.activeFloorId, project entities, or viewAllFloors change.
 */
export function useFloorFiltered3DProject(
  project: ProjectState,
  viewAllFloors: boolean
): FloorFiltered3DResult {
  return useMemo(
    () => filterProjectForActiveFloor3D(project, { viewAllFloors }),
    [project, viewAllFloors]
  );
}
