import {
  CableEdge,
  DeviceAsset,
  DiagramNode,
  PatchLink,
  ProjectState,
  ServerRack
} from '../../types/infrastructure';
import { BatchCableRouteUpdate } from '../../utils/cableRouting';

/**
 * Synchronizes each DeviceAsset's port status (`up` / `unlinked` / `down`) and link pointers
 * against the active CableEdge list.
 */
export function syncAssetPortsWithCables(
  assets: Record<string, DeviceAsset>,
  nodes: DiagramNode[],
  cables: CableEdge[]
): Record<string, DeviceAsset> {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const portLinks = new Map<
    string,
    Map<string, { cableId: string; peerDeviceId: string; peerPortId: string }>
  >();

  const registerLink = (
    assetId: string,
    portIdentifier: string | undefined,
    cableId: string,
    peerDeviceId: string,
    peerPortId: string
  ) => {
    if (!portIdentifier || portIdentifier === 'Auto') return;
    const asset = assets[assetId];
    if (!asset || !asset.ports || asset.ports.length === 0) return;
    const matchedPort = asset.ports.find(
      p => p.id === portIdentifier || p.name === portIdentifier
    );
    if (!matchedPort) return;
    let assetMap = portLinks.get(assetId);
    if (!assetMap) {
      assetMap = new Map();
      portLinks.set(assetId, assetMap);
    }
    assetMap.set(matchedPort.id, { cableId, peerDeviceId, peerPortId });
  };

  for (const cable of cables) {
    const srcNode = nodeById.get(cable.sourceNodeId);
    const tgtNode = nodeById.get(cable.targetNodeId);
    if (srcNode?.assetId) {
      registerLink(
        srcNode.assetId,
        cable.sourcePortId,
        cable.id,
        tgtNode?.assetId || cable.targetNodeId,
        cable.targetPortId || ''
      );
    }
    if (tgtNode?.assetId) {
      registerLink(
        tgtNode.assetId,
        cable.targetPortId,
        cable.id,
        srcNode?.assetId || cable.sourceNodeId,
        cable.sourcePortId || ''
      );
    }
  }

  let changed = false;
  const nextAssets: Record<string, DeviceAsset> = { ...assets };

  for (const [assetId, asset] of Object.entries(assets)) {
    if (!asset.ports || asset.ports.length === 0) continue;
    const assetLinks = portLinks.get(assetId);
    let assetChanged = false;
    const nextPorts = asset.ports.map(port => {
      const link = assetLinks?.get(port.id);
      if (link) {
        if (
          port.status !== 'up' ||
          port.connectedCableId !== link.cableId ||
          port.connectedTarget?.deviceId !== link.peerDeviceId ||
          port.connectedTarget?.portId !== link.peerPortId
        ) {
          assetChanged = true;
          return {
            ...port,
            status: 'up' as const,
            connectedCableId: link.cableId,
            connectedTarget: {
              deviceId: link.peerDeviceId,
              portId: link.peerPortId
            }
          };
        }
        return port;
      }
      if (port.connectedCableId || port.connectedTarget || port.status === 'up') {
        assetChanged = true;
        return {
          ...port,
          status: port.status === 'down' ? ('down' as const) : ('unlinked' as const),
          connectedCableId: undefined,
          connectedTarget: undefined
        };
      }
      return port;
    });

    if (assetChanged) {
      changed = true;
      nextAssets[assetId] = { ...asset, ports: nextPorts };
    }
  }

  return changed ? nextAssets : assets;
}

/**
 * Removes orphan DeviceAssets that are no longer referenced by any canvas node (in any mode)
 * or mounted inside any rack (front slots or rear slots).
 */
export function pruneOrphanAssets(
  assets: Record<string, DeviceAsset>,
  nodes: DiagramNode[],
  racks: ServerRack[]
): Record<string, DeviceAsset> {
  const referencedIds = new Set<string>();
  for (const node of nodes) {
    if (node.assetId) referencedIds.add(node.assetId);
  }
  for (const rack of racks) {
    for (const assetId of Object.values(rack.slots || {})) {
      if (assetId) referencedIds.add(assetId);
    }
    for (const assetId of Object.values(rack.rearSlots || {})) {
      if (assetId) referencedIds.add(assetId);
    }
  }

  const keys = Object.keys(assets);
  let removed = false;
  for (const id of keys) {
    if (!referencedIds.has(id)) {
      removed = true;
      break;
    }
  }
  if (!removed) return assets;

  const nextAssets: Record<string, DeviceAsset> = {};
  for (const id of keys) {
    if (referencedIds.has(id)) {
      nextAssets[id] = assets[id];
    }
  }
  return nextAssets;
}

/**
 * Removes PatchLink records pointing to panel assets that existed before deletion
 * and were pruned from `nextAssets`.
 */
export function pruneOrphanPatchLinks(
  patchLinks: PatchLink[] | undefined,
  prevAssets: Record<string, DeviceAsset>,
  nextAssets: Record<string, DeviceAsset>
): PatchLink[] | undefined {
  if (!patchLinks || patchLinks.length === 0) return patchLinks;
  const filtered = patchLinks.filter(link => {
    const existedBefore = Boolean(prevAssets[link.patchPanelAssetId]);
    if (!existedBefore) return true;
    return Boolean(nextAssets[link.patchPanelAssetId]);
  });
  return filtered.length === patchLinks.length ? patchLinks : filtered;
}

/**
 * Pure immutable reducer applying batch obstacle-avoiding cable routes computed
 * either synchronously or off-thread by infrastructureCompute.worker.ts.
 */
export function applyBatchCableRouteUpdates(
  prev: ProjectState,
  updates: BatchCableRouteUpdate[]
): ProjectState {
  if (updates.length === 0) return prev;
  const updateMap = new Map(updates.map(u => [u.id, u]));
  return {
    ...prev,
    cables: prev.cables.map(c => {
      const patch = updateMap.get(c.id);
      if (!patch) return c;
      return {
        ...c,
        routingType: 'orthogonal',
        controlPoints: patch.controlPoints,
        lengthMeters: patch.lengthMeters
      };
    })
  };
}
