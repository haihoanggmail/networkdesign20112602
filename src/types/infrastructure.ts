/**
 * HACHIHI Network Designer - Premium Edition V3
 * Core Data Models & Unified Infrastructure Architecture
 */

export type DesignMode = 
  | 'topology'      // 01. Network LAN/WAN Logic & Physical
  | 'floorplan'     // 02. Building & Multi-floor 2D Architectural Plan
  | 'rack'          // 03. Server Rack 19" U-Slot Elevation
  | 'cctv'          // 04. CCTV & Security Surveillance with FOV Cones
  | 'wifi'          // 05. Wi-Fi Coverage & RF Heatmap Radius
  | 'fiber'         // 06. Fiber Optic, ODF & Patch Panel Interconnects
  | 'electrical'    // 07. Electrical, UPS & Power Distribution
  | 'multisite';    // 08. Multi-site WAN, Campus & Datacenter Overview

export type DeviceCategory = 
  | 'router'
  | 'switch'
  | 'core_switch'
  | 'firewall'
  | 'server'
  | 'storage'
  | 'ap'
  | 'camera'
  | 'nvr'
  | 'odf'
  | 'patch_panel'
  | 'ups'
  | 'pdu'
  | 'rack'
  | 'workstation'
  | 'printer'
  | 'gateway'
  | 'cloud'
  | 'telecom_tower'
  | 'electrical_panel'
  | 'sensor'
  | 'iot';

export type PortType = 
  | 'RJ45_1G'
  | 'RJ45_10G'
  | 'SFP_PLUS_10G'
  | 'QSFP_40G'
  | 'QSFP28_100G'
  | 'FIBER_LC'
  | 'FIBER_SC'
  | 'POWER_C13'
  | 'CONSOLE';

export interface DevicePort {
  id: string;
  name: string;
  type: PortType;
  poe?: boolean;
  poeWatts?: number;
  vlan?: string;
  portMode?: 'access' | 'trunk' | 'routed' | 'lacp_member';
  lacpGroup?: string;
  nativeVlan?: string;
  allowedVlans?: string;
  speed: string; // e.g. "1 Gbps", "10 Gbps"
  status: 'up' | 'down' | 'unlinked';
  connectedCableId?: string;
  connectedTarget?: {
    deviceId: string;
    portId: string;
  };
  patchedToDeviceId?: string;
  patchedToPortId?: string;
}

export type RackSide = 'front' | 'rear';

export const STANDARD_RACK_UNITS = [6, 9, 12, 15, 18, 22, 27, 32, 42, 45, 48] as const;

export type SwitchStpMode = 'none' | 'stp' | 'rstp' | 'mstp' | 'pvst';

export interface DeviceL2Config {
  role?: 'core' | 'distribution' | 'access' | 'edge';
  stpMode?: SwitchStpMode;
  stpPriority?: number;
  lacpEnabled?: boolean;
  mlagDomain?: string;
}

/**
 * Shared Device Asset (Single Source of Truth)
 * A single physical asset can appear on the Floorplan, the Logic Topology, and the Rack view.
 */
export interface DeviceAsset {
  id: string;
  name: string; // e.g. "SW-CORE-01"
  category: DeviceCategory;
  vendor: string; // Cisco, Aruba, Fortinet, MikroTik, Dell, Ubiquiti, APC...
  model: string;
  assetTag: string; // AST-2026-001
  serialNumber: string;
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  macAddress: string;
  vlan: string;
  managementUrl?: string;
  status: 'online' | 'standby' | 'maintenance' | 'offline';
  
  // Physical placement
  buildingId?: string;
  floorId?: string;
  roomId?: string;
  rackId?: string;
  rackUnitStart?: number; // e.g. U24
  rackUnitHeight?: number; // e.g. 1U, 2U, 4U
  rackSide?: RackSide; // 'front' (default) or 'rear'

  // Custom visual icon / image
  customIcon?: string;
  customImageUrl?: string;

  // Power & Environment
  powerWatts?: number;
  powerDomain?: string;
  fedByUpsId?: string;
  fedByPduId?: string;
  powerFeed?: 'A' | 'B' | 'single';
  circuitBreaker?: string;
  poeRole?: 'auto' | 'pse' | 'pd' | 'none';
  poeEnabled?: boolean;
  poeWatts?: number;
  poeBudgetWatts?: number;
  heatBtu?: number;
  weightKg?: number;

  // Structured L2 Switching Protocol Configuration
  l2Config?: DeviceL2Config;

  // Domain-specific specs
  cameraSpecs?: {
    resolution: string; // "4K 8MP", "2MP 1080p"
    lensMm: number; // 2.8mm, 4mm, 6mm
    fovAngle: number; // in degrees, e.g. 90
    irDistanceMeters: number; // e.g. 30
    nvrChannel?: number;
  };
  wifiSpecs?: {
    standard: 'Wi-Fi 6 (802.11ax)' | 'Wi-Fi 6E' | 'Wi-Fi 7' | 'Wi-Fi 5';
    bands: '2.4GHz + 5GHz' | 'Tri-Band';
    txPowerDbm: number; // e.g. 20
    coverageRadiusMeters: number; // e.g. 18
    coverageAngleDeg?: number; // beam angle in degrees (30..360, default 360)
    channel24?: number;
    channel5?: number;
    maxClients: number;
    ssid: string;
  };
  upsSpecs?: {
    ratedVa?: number;
    powerFactor?: number;
    batteryAh: number;
    batteryVoltageV: number;
    batteryCount: number;
    batteryConfig?: string;
    inputVoltageRange?: string;
    inverterEfficiency?: number;
    dodFactor?: number;
    redundancyMode?: 'standalone' | 'parallel' | 'n_plus_1';
    powerDomain?: string;
  };
  sensorSpecs?: {
    temperatureC?: number;
    humidityPct?: number;
    probeLocation?: 'intake' | 'mid' | 'exhaust' | 'ambient';
    warningTempC?: number;
    criticalTempC?: number;
  };

  ports: DevicePort[];
}

export interface Building {
  id: string;
  name: string;
  totalFloors: number;
  basementFloors: number;
  widthMeters: number;
  depthMeters: number;
  floorHeightMeters: number;
  wallThicknessMm: number;
  layoutStyle: 'rectangle' | 'L-shape' | 'U-shape';
}

export interface Floor {
  id: string;
  buildingId: string;
  level: number; // -1 = B1, 1 = Floor 1, 2 = Floor 2...
  name: string; // "Tầng 1 - Sảnh & Lễ tân"
  description: string;
  widthMeters: number;
  depthMeters: number;
}

export type RoomType = 
  | 'server_room'
  | 'office'
  | 'meeting'
  | 'corridor'
  | 'utility_riser'
  | 'warehouse'
  | 'reception'
  | 'restroom';

export interface Room {
  id: string;
  floorId: string;
  name: string;
  type: RoomType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  wallThickness: number;
  description?: string;
  locked?: boolean;
}

export interface RackSensorReading {
  id: string;
  label: string;
  zone: 'intake' | 'mid' | 'exhaust' | 'ambient';
  u?: number;
  temperatureC: number;
  humidityPct?: number;
  status?: 'ok' | 'warm' | 'critical';
}

export interface ServerRack {
  id: string;
  name: string; // "Rack A01"
  buildingId?: string;
  floorId?: string;
  roomId?: string;
  totalUnits: number; // Supports 6, 9, 12, 15, 18, 22, 27, 32, 42, 45, 48 & custom U
  widthMm: number; // 600 or 800
  depthMm: number; // 800, 1000, 1200
  maxLoadKg: number;
  x: number;
  y: number;
  // unit index (1-based) to asset ID (Front rail - also legacy default)
  slots: Record<number, string>;
  // unit index (1-based) to asset ID (Rear rail)
  rearSlots?: Record<number, string>;
  // optional telemetry sensors mounted on or monitoring this rack
  sensors?: RackSensorReading[];
}

export type NodeType = 
  | 'device'
  | 'room'
  | 'rack'
  | 'wall'
  | 'riser'
  | 'text'
  | 'zone'
  | 'cloud'
  | 'telecom_tower'
  | 'legend';

export interface NodeCustomData {
  locked?: boolean;
  collapsed?: boolean;
  showThermalOverlay?: boolean;
  rackId?: string;
  totalUnits?: number;
  fov?: number;
  irDistance?: number;
  coverageRadiusMeters?: number;
  coverageAngleDeg?: number;
  legendScope?: 'all' | 'activeFloor';
  legendIncludeCables?: boolean;
  legendTitle?: string;
  legendScale?: number;
  elevationZ?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface DiagramNode {
  id: string;
  diagramMode: DesignMode;
  floorId?: string; // which floor this node belongs to
  layerId?: CanvasLayerId; // Optional explicit or auto-assigned layer
  type: NodeType;
  assetId?: string; // If bound to a DeviceAsset
  groupId?: string; // Optional logical group membership
  locked?: boolean; // Lock position to prevent accidental drag
  hidden?: boolean; // Temporarily hide object on canvas without deleting
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
  customIcon?: string;
  customImageUrl?: string;
  style: {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    borderStyle: 'solid' | 'dashed' | 'dotted';
    opacity: number;
    fontSize?: number;
    textColor?: string;
    iconColor?: string;
    shadow?: boolean;
    shape?: 'round' | 'rect' | 'circle';
  };
  customData?: NodeCustomData;
}

export type CableType = 
  | 'CAT6_UTP'
  | 'CAT6A_STP'
  | 'FIBER_SM_OS2'
  | 'FIBER_MM_OM4'
  | 'DAC_10G'
  | 'POWER_AC';

export interface CablePoint {
  x: number;
  y: number;
}

export interface CableEdge {
  id: string;
  cableCode: string; // e.g. "CAB-F1-001"
  diagramMode: DesignMode;
  sourceNodeId: string;
  sourcePortId?: string;
  targetNodeId: string;
  targetPortId?: string;
  cableType: CableType;
  bandwidth: '1G' | '10G' | '25G' | '40G' | '100G';
  color: string;
  routingType: 'orthogonal' | 'straight' | 'curved';
  lineStyle: 'solid' | 'dashed';
  strokeWidth: number;
  lengthMeters: number;
  vlan?: string;
  status: 'active' | 'inactive' | 'fault';
  notes?: string;
  label?: string;
  labelFontSize?: number;
  labelRotation?: number;
  labelAutoOrient?: boolean;
  controlPoints?: CablePoint[];
  slackFactor?: number;
  fiberConnectors?: number;
  fiberSplices?: number;
  transceiverBudgetDb?: number;
}

export interface CableTrayPoint {
  x: number;
  y: number;
}

export type CableTrayKind = 'network_tray' | 'power_tray' | 'conduit';

export interface CableTray {
  id: string;
  name: string;
  floorId?: string;
  kind: CableTrayKind;
  widthPx: number;
  points: CableTrayPoint[];
  color?: string;
  locked?: boolean;
}

export type CanvasLayerId =
  | 'rooms'
  | 'trays'
  | 'racks'
  | 'devices'
  | 'network'
  | 'iot'
  | 'electrical'
  | 'cables'
  | 'cable_labels'
  | 'fov'
  | 'wifi'
  | 'labels';

export type CanvasBackgroundPattern = 'dots' | 'lines' | 'cross' | 'none';

export interface CanvasGuideLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  pos: number;
  floorId?: string;
}

export type CanvasPerformanceMode = 'auto' | 'high_quality' | 'high_performance';

export interface CanvasSettings {
  gridSize: number;
  snapToGrid: boolean;
  showRulers: boolean;
  showGrid: boolean;
  showPortLabels: boolean;
  showIpAddresses: boolean;
  showCableCodes: boolean;
  showCoverageRadius: boolean;
  unit: 'm' | 'cm' | 'mm';
  scale: number; // 1 meter = 40px
  backgroundColor: string;
  backgroundPreset?: string;
  backgroundPattern?: CanvasBackgroundPattern;
  backgroundImageUrl?: string;
  backgroundImageOpacity?: number;
  backgroundImageMode?: 'cover' | 'world';
  isDarkMode: boolean;
  hiddenLayers?: CanvasLayerId[];
  lockedLayers?: CanvasLayerId[];
  autoLayeringEnabled?: boolean;
  guideLines?: CanvasGuideLine[];
  ipRangeStart?: string;
  ipRangeEnd?: string;
  ipSubnetMask?: string;
  ipGateway?: string;
  experienceMode?: 'basic' | 'advanced';
  canvasPerformanceMode?: CanvasPerformanceMode;
}

export interface VlanSpec {
  id: string;
  vlanId: number;
  name: string;
  purpose?: string;
  color?: string;
}

export interface SubnetSpec {
  id: string;
  name: string;
  cidr: string; // e.g. "10.10.20.0/24"
  vlanId?: number;
  gateway?: string;
  dnsServers?: string;
  dhcpRange?: string;
  notes?: string;
}

export interface PatchLink {
  id: string;
  patchPanelAssetId: string;
  patchPort: string;
  targetDeviceName: string;
  targetPort?: string;
  cableCode?: string;
  roomName?: string;
  vlan?: string;
  notes?: string;
}

export interface ProjectRevision {
  id: string;
  projectId: string;
  label: string;
  note?: string;
  createdAt: string;
  author: string;
  nodeCount: number;
  assetCount: number;
  rackCount: number;
  cableCount: number;
  snapshot: ProjectState;
}

export type ProjectSnapshotTrigger = 'auto_interval' | 'manual' | 'pre_restore';

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  trigger: ProjectSnapshotTrigger;
  label: string;
  checksum: string;
  byteSize?: number;
  nodeCount: number;
  assetCount: number;
  rackCount: number;
  cableCount: number;
  floorCount: number;
  snapshot: ProjectState;
}

export interface RevisionDiffSummary {
  addedNodes: number;
  removedNodes: number;
  addedAssets: number;
  removedAssets: number;
  addedCables: number;
  removedCables: number;
  addedRacks: number;
  removedRacks: number;
}

export interface ProjectState {
  id: string;
  name: string;
  author: string;
  version: string;
  schemaVersion?: number;
  lastModified: string;
  lastSavedAt?: string;
  buildings: Building[];
  floors: Floor[];
  rooms: Room[];
  cableTrays?: CableTray[];
  racks: ServerRack[];
  assets: Record<string, DeviceAsset>;
  nodes: DiagramNode[];
  cables: CableEdge[];
  vlans?: VlanSpec[];
  subnets?: SubnetSpec[];
  patchLinks?: PatchLink[];
  activeMode: DesignMode;
  activeBuildingId: string;
  activeFloorId: string;
  settings: CanvasSettings;
}

export interface ProjectSummary {
  id: string;
  name: string;
  author: string;
  version: string;
  lastModified: string;
  lastSavedAt: string;
  nodeCount: number;
  assetCount: number;
  rackCount: number;
  cableCount: number;
  isTrashed?: boolean;
  trashedAt?: string;
}

export interface SelectionState {
  type: 'none' | 'node' | 'edge' | 'room' | 'tray' | 'rack' | 'floor' | 'building' | 'canvas';
  id?: string;
  additionalIds?: string[];
}
