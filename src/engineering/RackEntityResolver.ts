import { DeviceAsset, DiagramNode, ServerRack } from '../types/infrastructure';
import { getEffectiveRackDisplayHeight, isRackNodeCollapsed } from '../utils/rackGeometry';
import { Point2D } from './CoordinateTransform';

export interface RackLookupIndex {
  byId: Map<string, ServerRack>;
  byName: Map<string, ServerRack>;
  rackNodeByRackId: Map<string, DiagramNode>;
}

export function buildRackLookupIndex(
  racks: readonly ServerRack[],
  nodes?: readonly DiagramNode[]
): RackLookupIndex {
  const byId = new Map<string, ServerRack>();
  const byName = new Map<string, ServerRack>();
  const rackNodeByRackId = new Map<string, DiagramNode>();

  for (const r of racks) {
    byId.set(r.id, r);
    if (r.name && !byName.has(r.name)) {
      byName.set(r.name, r);
    }
  }

  if (nodes) {
    for (const n of nodes) {
      if (n.hidden) continue;
      if (n.type !== 'rack') continue;
      const customRackId = n.customData?.rackId;
      if (customRackId && !rackNodeByRackId.has(customRackId)) {
        rackNodeByRackId.set(customRackId, n);
      }
      const matched =
        (customRackId ? byId.get(customRackId) : undefined) ||
        byId.get(n.id) ||
        (n.label ? byName.get(n.label) : undefined);
      if (matched && !rackNodeByRackId.has(matched.id)) {
        rackNodeByRackId.set(matched.id, n);
      }
      if (!rackNodeByRackId.has(n.id)) {
        rackNodeByRackId.set(n.id, n);
      }
    }
  }

  return { byId, byName, rackNodeByRackId };
}

export function resolveRackForDiagramNode(
  node: Pick<DiagramNode, 'id' | 'type' | 'assetId' | 'label' | 'customData'>,
  assets: Record<string, DeviceAsset>,
  lookup: RackLookupIndex
): ServerRack | undefined {
  const customRackId = node.customData?.rackId;
  if (customRackId) {
    const byCustom = lookup.byId.get(customRackId);
    if (byCustom) return byCustom;
  }

  const byNodeId = lookup.byId.get(node.id);
  if (byNodeId) return byNodeId;

  if (node.assetId) {
    const asset = assets[node.assetId];
    if (asset) {
      if (asset.rackId) {
        const byAssetRack = lookup.byId.get(asset.rackId);
        if (byAssetRack) return byAssetRack;
      }
      const byAssetId = lookup.byId.get(asset.id);
      if (byAssetId) return byAssetId;
    }
  }

  return node.label ? lookup.byName.get(node.label) : undefined;
}

export function isTopologyShadowMountedInRack(
  node: Pick<DiagramNode, 'diagramMode' | 'type' | 'assetId'>,
  assets: Record<string, DeviceAsset>,
  lookup: RackLookupIndex
): boolean {
  if (node.diagramMode === 'floorplan' || node.type === 'rack' || !node.assetId) {
    return false;
  }
  const asset = assets[node.assetId];
  if (!asset?.rackId) return false;
  const rackNode = lookup.rackNodeByRackId.get(asset.rackId);
  return Boolean(rackNode && !rackNode.hidden && rackNode.diagramMode === 'floorplan');
}

export interface NodePivotResolution {
  /** Full uncollapsed geometric center (used by 3D world placement) */
  canonicalCenter: Point2D;
  /** 2D visible display center (differs when a rack node is collapsed in 2D) */
  display2DCenter: Point2D;
  isCollapsedRack: boolean;
  display2DHeight: number;
}

/**
 * Computes canonical center vs 2D display center so collapsed racks never drift between 2D and 3D.
 */
export function resolveNodePivotCenter(
  node: Pick<DiagramNode, 'type' | 'x' | 'y' | 'width' | 'height' | 'customData'>
): NodePivotResolution {
  const isRack = node.type === 'rack';
  const isCollapsedRack = isRack && isRackNodeCollapsed(node);
  const display2DHeight = isRack ? getEffectiveRackDisplayHeight(node) : node.height;

  return {
    canonicalCenter: {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    },
    display2DCenter: {
      x: node.x + node.width / 2,
      y: node.y + display2DHeight / 2
    },
    isCollapsedRack,
    display2DHeight
  };
}
