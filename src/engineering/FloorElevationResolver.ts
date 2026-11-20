import { Building, DiagramNode, Floor, ProjectState } from '../types/infrastructure';
import { buildRackLookupIndex, resolveRackForDiagramNode } from './RackEntityResolver';

export const DEFAULT_FLOOR_HEIGHT_METERS = 3.5;
export const LEGACY_CUTAWAY_FLOOR_STEP_UNITS = 3.25;
export const LEGACY_EXPLODE_STEP_FACTOR = 1.15;

export interface FloorElevationEntry {
  floorId: string;
  level: number;
  orderIndex: number;
  floorHeightMeters: number;
  /** Real architectural height relative to the lowest floor (in meters) */
  physicalElevationMeters: number;
  /** Legacy 3.25-unit floor step used by current cutaway renderer when explodeSpread === 0 */
  legacyCutawayElevationUnits: number;
  /** Visual-only cutaway expansion offset (NEVER persisted to ProjectState) */
  visualExplodeOffsetMeters: number;
  /** Total display Y coordinate when rendering multi-floor cutaway */
  displayElevationY: number;
}

export interface FloorElevationPlan {
  floorsSorted: Floor[];
  baseLevel: number;
  buildingFloorHeightMeters: number;
  isMultiFloorCutaway: boolean;
  explodeSpread: number;
  byFloorId: Map<string, FloorElevationEntry>;
}

export type FloorResolutionSource =
  | 'node'
  | 'rack'
  | 'room'
  | 'asset'
  | 'active_floor_fallback'
  | 'unresolved';

export interface ResolvedNodeFloorAndElevation {
  floorId: string | undefined;
  source: FloorResolutionSource;
  /** Physical floor height in meters (0 if single-floor view or unresolved) */
  physicalFloorMeters: number;
  /** Physical mounting height above floor from node.customData.elevationZ (meters) */
  elevationZ: number;
  /** Visual-only explode offset (meters/units, 0 when explodeSpread === 0) */
  visualExplodeOffset: number;
  /** Physical world Y (without visual explode spread) */
  physicalWorldY: number;
  /** Display world Y (physical + visual explode offset) */
  displayWorldY: number;
}

export function resolveBuildingFloorHeightMeters(
  project: Pick<ProjectState, 'buildings' | 'activeBuildingId'>
): number {
  const activeBuilding: Building | undefined =
    project.buildings.find(b => b.id === project.activeBuildingId) || project.buildings[0];
  const raw = activeBuilding?.floorHeightMeters;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 2) {
    return raw;
  }
  return DEFAULT_FLOOR_HEIGHT_METERS;
}

/**
 * Computes physical & visual floor elevations cleanly separated from each other.
 * Note: `visualExplodeOffsetMeters` is strictly for transient 3D cutaway viewing and must
 * never be written back into `ProjectState` or physical node elevation.
 */
export function buildFloorElevationPlan(
  project: Pick<ProjectState, 'floors' | 'buildings' | 'activeBuildingId'>,
  options?: {
    isMultiFloorCutaway?: boolean;
    explodeSpread?: number;
    usePhysicalFloorHeight?: boolean;
  }
): FloorElevationPlan {
  const floorsSorted = [...(project.floors || [])].sort((a, b) => a.level - b.level);
  const isMultiFloorCutaway = Boolean(options?.isMultiFloorCutaway && floorsSorted.length > 1);
  const explodeSpread =
    typeof options?.explodeSpread === 'number' && Number.isFinite(options.explodeSpread)
      ? Math.max(0, options.explodeSpread)
      : 0;
  const buildingFloorHeightMeters = resolveBuildingFloorHeightMeters(project);
  const baseLevel = floorsSorted.length > 0 ? floorsSorted[0].level : 1;
  const usePhysicalFloorHeight = options?.usePhysicalFloorHeight ?? false;

  const byFloorId = new Map<string, FloorElevationEntry>();

  floorsSorted.forEach((floor, idx) => {
    const levelDelta = floor.level - baseLevel;
    const physicalElevationMeters = levelDelta * buildingFloorHeightMeters;
    const legacyCutawayElevationUnits = idx * LEGACY_CUTAWAY_FLOOR_STEP_UNITS;
    const baseDisplayY = isMultiFloorCutaway
      ? usePhysicalFloorHeight
        ? physicalElevationMeters
        : legacyCutawayElevationUnits
      : 0;
    const visualExplodeOffsetMeters = isMultiFloorCutaway
      ? idx * explodeSpread * LEGACY_EXPLODE_STEP_FACTOR
      : 0;

    byFloorId.set(floor.id, {
      floorId: floor.id,
      level: floor.level,
      orderIndex: idx,
      floorHeightMeters: buildingFloorHeightMeters,
      physicalElevationMeters: isMultiFloorCutaway ? physicalElevationMeters : 0,
      legacyCutawayElevationUnits: isMultiFloorCutaway ? legacyCutawayElevationUnits : 0,
      visualExplodeOffsetMeters,
      displayElevationY: baseDisplayY + visualExplodeOffsetMeters
    });
  });

  return {
    floorsSorted,
    baseLevel,
    buildingFloorHeightMeters,
    isMultiFloorCutaway,
    explodeSpread,
    byFloorId
  };
}

/**
 * Resolves the floor ownership of a DiagramNode using a deterministic fallback chain:
 * `node.floorId -> rack.floorId -> room.floorId -> asset.floorId -> activeFloorId fallback (optional)`.
 */
export function resolveNodeFloorId(
  node: Pick<DiagramNode, 'id' | 'type' | 'floorId' | 'assetId' | 'label' | 'customData'>,
  project: Pick<ProjectState, 'assets' | 'racks' | 'rooms' | 'activeFloorId'>,
  options?: {
    fallbackToActiveFloor?: boolean;
    rackLookup?: ReturnType<typeof buildRackLookupIndex>;
    roomFloorById?: Map<string, string>;
  }
): { floorId: string | undefined; source: FloorResolutionSource } {
  if (node.floorId) {
    return { floorId: node.floorId, source: 'node' };
  }

  const asset = node.assetId ? project.assets[node.assetId] : undefined;
  const roomFloorById =
    options?.roomFloorById ?? new Map((project.rooms || []).map(r => [r.id, r.floorId]));
  const rackLookup = options?.rackLookup ?? buildRackLookupIndex(project.racks || []);

  const resolvedRack = resolveRackForDiagramNode(node, project.assets, rackLookup);
  if (resolvedRack?.floorId) {
    return { floorId: resolvedRack.floorId, source: 'rack' };
  }
  if (resolvedRack?.roomId) {
    const rackRoomFloor = roomFloorById.get(resolvedRack.roomId);
    if (rackRoomFloor) {
      return { floorId: rackRoomFloor, source: 'room' };
    }
  }

  if (asset?.rackId) {
    const assetRack = rackLookup.byId.get(asset.rackId);
    if (assetRack?.floorId) {
      return { floorId: assetRack.floorId, source: 'rack' };
    }
    if (assetRack?.roomId) {
      const assetRackRoomFloor = roomFloorById.get(assetRack.roomId);
      if (assetRackRoomFloor) {
        return { floorId: assetRackRoomFloor, source: 'room' };
      }
    }
  }

  if (asset?.roomId) {
    const assetRoomFloor = roomFloorById.get(asset.roomId);
    if (assetRoomFloor) {
      return { floorId: assetRoomFloor, source: 'room' };
    }
  }

  if (asset?.floorId) {
    return { floorId: asset.floorId, source: 'asset' };
  }

  if (options?.fallbackToActiveFloor && project.activeFloorId) {
    return { floorId: project.activeFloorId, source: 'active_floor_fallback' };
  }

  return { floorId: undefined, source: 'unresolved' };
}

export function resolveNodeFloorAndElevation(
  node: Pick<DiagramNode, 'id' | 'type' | 'floorId' | 'assetId' | 'label' | 'customData'>,
  project: Pick<ProjectState, 'assets' | 'racks' | 'rooms' | 'activeFloorId'>,
  plan: FloorElevationPlan,
  options?: {
    fallbackToActiveFloor?: boolean;
    rackLookup?: ReturnType<typeof buildRackLookupIndex>;
    roomFloorById?: Map<string, string>;
  }
): ResolvedNodeFloorAndElevation {
  const { floorId, source } = resolveNodeFloorId(node, project, options);
  const floorEntry = floorId ? plan.byFloorId.get(floorId) : undefined;
  const physicalFloorMeters = floorEntry?.physicalElevationMeters ?? 0;
  const rawElevationZ = node.customData?.elevationZ;
  const elevationZ =
    typeof rawElevationZ === 'number' && Number.isFinite(rawElevationZ) ? rawElevationZ : 0;

  const baseFloorDisplayY = floorEntry
    ? floorEntry.displayElevationY - floorEntry.visualExplodeOffsetMeters
    : 0;
  const visualExplodeOffset = floorEntry?.visualExplodeOffsetMeters ?? 0;

  return {
    floorId,
    source,
    physicalFloorMeters,
    elevationZ,
    visualExplodeOffset,
    physicalWorldY: physicalFloorMeters + elevationZ,
    displayWorldY: baseFloorDisplayY + visualExplodeOffset + elevationZ
  };
}
