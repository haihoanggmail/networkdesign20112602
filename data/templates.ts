import {
  ProjectState,
  Building,
  Floor,
  Room,
  ServerRack,
  DeviceAsset,
  DiagramNode,
  CableEdge,
  DesignMode,
  VlanSpec,
  SubnetSpec,
  PatchLink
} from '../types/infrastructure';
import { DEVICE_CATALOG, createDeviceAssetFromPreset } from './deviceCatalog';
import {
  createStandardLanStarProject,
  createStandardLanVlanDmzProject,
  createStandardWanDualIspProject,
  createStandardCoreDistributionProject,
  createStandardCollapsedCoreProject
} from './standardNetworkTemplates';
import { createHachihi2BuildingProject } from './hachihi2BuildingTemplate';
import { createFiveStoreyBuildingProject } from './defaultStarterTemplate';

export { createFiveStoreyBuildingProject };

export interface ArchitectureTemplate {
  id: string;
  name: string;
  mode: DesignMode;
  categoryName: string;
  description: string;
  thumbnailIcon: string;
  badge: string;
  highlights?: string[];
  createProject: () => ProjectState;
}

/**
 * Transitional built-in registry preserved for backward compatibility and offline unit tests.
 * Dynamic Template Library reads from `/templates/catalog.json` (generated from `public/templates/`).
 */
export const ARCHITECTURE_TEMPLATES: ArchitectureTemplate[] = [
  // 0. Dự án mẫu (Sample Project)
  {
    id: 'tpl_sample_multifloor_office',
    name: 'Văn phòng 3 Tầng Hoàn chỉnh (Mạng + Rack + IP Subnet)',
    mode: 'topology',
    categoryName: 'Dự án mẫu (Sample Project)',
    badge: 'Sample Project',
    thumbnailIcon: 'Layers',
    highlights: ['3 tầng · 4 phòng', '3 tủ Rack (MDF + 2 IDF)', '5 VLAN & Subnet CIDR'],
    description:
      'Dự án mẫu cho người mới làm quen: tòa nhà văn phòng 3 tầng (MDF Tầng 1 + IDF Tầng 2–3), gán sẵn thiết bị vào 3 tủ Rack 19", chia 5 VLAN/Subnet (10.10.10–50.0/24), Wi-Fi, CCTV và nguồn PoE/UPS chuẩn kỹ thuật.',
    createProject: () => createMultiFloorSampleOfficeProject()
  },

  // 0b. Mạng tiêu chuẩn (LAN / WAN / Core-Dist)
  {
    id: 'tpl_std_lan_star',
    name: 'Mạng LAN Cơ bản (Star 2-Tầng PoE)',
    mode: 'topology',
    categoryName: 'Mạng tiêu chuẩn (LAN / WAN / Core-Dist)',
    badge: 'LAN Star',
    thumbnailIcon: 'Network',
    highlights: ['Router → Switch PoE → AP/Cam/NAS', '3 VLAN (LAN, Wi-Fi, CCTV)', 'Sẵn sàng cho văn phòng 15–40 người'],
    description:
      'Sơ đồ LAN hình sao 2 tầng chuẩn mực: WAN ISP → Router MikroTik → Switch PoE 24-port cấp nguồn cho Wi-Fi 6 AP, Camera IP, đầu ghi NVR và máy chủ NAS nội bộ.',
    createProject: () => createStandardLanStarProject()
  },
  {
    id: 'tpl_std_lan_vlan_dmz',
    name: 'Mạng LAN Phân tách VLAN & Vùng DMZ Bảo mật',
    mode: 'topology',
    categoryName: 'Mạng tiêu chuẩn (LAN / WAN / Core-Dist)',
    badge: 'LAN + DMZ',
    thumbnailIcon: 'Server',
    highlights: ['Firewall FortiGate + DMZ Server', '6 VLAN tách biệt lưu lượng', 'Có UPS bảo vệ vùng Core'],
    description:
      'Kiến trúc LAN bảo mật cho doanh nghiệp: Firewall biên phân vùng DMZ (Web/API công cộng), tách 6 VLAN Nội bộ/Kế toán/Guest/Camera/DMZ và bảo vệ nguồn bằng UPS Online.',
    createProject: () => createStandardLanVlanDmzProject()
  },
  {
    id: 'tpl_std_wan_dual_isp',
    name: 'Mạng WAN Dual-ISP & Kết nối Chi nhánh IPsec VPN',
    mode: 'topology',
    categoryName: 'Mạng tiêu chuẩn (LAN / WAN / Core-Dist)',
    badge: 'WAN Multi-Site',
    thumbnailIcon: 'Globe',
    highlights: ['2 đường truyền ISP (Viettel + VNPT)', 'IPsec VPN Site-to-Site HN & ĐN', 'BGP/Failover tự động'],
    description:
      'Mô hình kết nối WAN đa đường truyền dự phòng (Active-Active/Failover) qua 2 nhà mạng độc lập, kết hợp đường hầm VPN IPsec Site-to-Site liên kết Hội sở chính và 2 chi nhánh.',
    createProject: () => createStandardWanDualIspProject()
  },
  {
    id: 'tpl_std_core_dist_3tier',
    name: 'Kiến trúc Campus 3-Tầng (Core / Distribution / Access)',
    mode: 'topology',
    categoryName: 'Mạng tiêu chuẩn (LAN / WAN / Core-Dist)',
    badge: 'Core / Dist / Acc',
    thumbnailIcon: 'GitBranch',
    highlights: ['Dual Core Switch 100G ISL', '3 lớp Core–Dist–Access dự phòng kép', 'Cụm ảo hóa Server & SAN Storage'],
    description:
      'Chuẩn Campus 3 lớp doanh nghiệp lớn: cặp Core Switch Nexus 100G liên kết vòng ISL, nối quang OS2 dual-homed xuống 3 Distribution Switch cho Khối Văn phòng, Xưởng sản xuất và Server Farm.',
    createProject: () => createStandardCoreDistributionProject()
  },
  {
    id: 'tpl_std_collapsed_core',
    name: 'Kiến trúc Collapsed Core (Gom Core + Dist 3 Tầng)',
    mode: 'topology',
    categoryName: 'Mạng tiêu chuẩn (LAN / WAN / Core-Dist)',
    badge: 'Collapsed Core',
    thumbnailIcon: 'Layers',
    highlights: ['Core L3 + 3 Switch Access liên tầng', 'Cáp quang OS2 10G trục đứng', 'Tối ưu chi phí tòa nhà 3–5 tầng'],
    description:
      'Mô hình Collapsed Core thực dụng cho tòa nhà vừa: gộp tầng Core và Distribution vào Switch L3 hiệu năng cao kết nối Firewall/Server, kéo cáp quang trục đứng OS2 lên các tủ Access từng tầng.',
    createProject: () => createStandardCollapsedCoreProject()
  },

  // 1. Network Topology
  {
    id: 'tpl_net_enterprise',
    name: 'Doanh nghiệp Đa phòng ban & VLAN',
    mode: 'topology',
    categoryName: '01. Sơ đồ logic',
    badge: 'Doanh nghiệp',
    thumbnailIcon: 'Network',
    description: 'Sơ đồ mạng hoàn chỉnh gồm WAN Dual-ISP, Firewall HA FortiGate, Core Switch Nexus 9300, 3x Distribution Switch cho Phòng Kinh Doanh, Kỹ Thuật và Server Farm.',
    createProject: () => createEnterpriseTopologyProject()
  },
  {
    id: 'tpl_net_small_office',
    name: 'Văn phòng Vừa & Nhỏ (SMB)',
    mode: 'topology',
    categoryName: '01. Sơ đồ logic',
    badge: 'Văn phòng SMB',
    thumbnailIcon: 'Building',
    description: 'Mô hình chuẩn cho văn phòng 30-50 nhân sự: Router cân bằng tải Dual-WAN, Switch PoE 24 port, 2x Wi-Fi 6 APs, Máy chủ NAS và Máy in mạng.',
    createProject: () => createSmallOfficeTopologyProject()
  },

  // 2. Mặt bằng tòa nhà
  {
    id: 'tpl_building_hachihi2',
    name: 'Tòa nhà HACHIHI 2 (B1 + G + 5 Tầng · 2D & 3D Cutaway)',
    mode: 'floorplan',
    categoryName: '02. Mặt bằng tầng',
    badge: '2D CAD & 3D',
    thumbnailIcon: 'Building2',
    highlights: ['B1 + G + 5 Tầng (Main Rack 42U T4)', '6x Small Rack 12U + Trục Riser', 'Thang máy · Chấm công · CCTV'],
    description:
      'Mô hình tòa nhà văn phòng kết nối HACHIHI 2 (Hahihi2) đầy đủ 7 mặt bằng (Tầng hầm B1 bãi xe & cổng chính, Tầng G trệt, Tầng 1–5): Main Rack Tầng 4 (42U), Small Rack 12U từng tầng liên thông trục đứng Riser, Thang máy kính, Máy chấm công, PC, Wi-Fi 6 & Camera giám sát rõ nét trên cả 2D CAD và 3D Cutaway.',
    createProject: () => createHachihi2BuildingProject()
  },
  {
    id: 'tpl_building_5floors',
    name: 'Tòa nhà HACHIHI Building (5 Tầng + 1 Hầm)',
    mode: 'floorplan',
    categoryName: '02. Mặt bằng tầng',
    badge: 'Mặt bằng CAD',
    thumbnailIcon: 'Building2',
    description: 'Mặt bằng kiến trúc kỹ thuật gồm 5 tầng nổi và 1 tầng hầm B1: Trục kỹ thuật đứng (Vertical Riser), phòng máy chủ, phòng kinh doanh, lễ tân và tủ phân phối IDF từng tầng.',
    createProject: () => createFiveStoreyBuildingProject()
  },

  // 3. Tủ Server Rack 19 inch
  {
    id: 'tpl_rack_datacenter',
    name: 'Tủ Server Rack 42U Data Center',
    mode: 'rack',
    categoryName: '03. Tủ Server Rack 19"',
    badge: '19-inch 42U',
    thumbnailIcon: 'Server',
    description: 'Thiết kế tủ rack 42U chuẩn quốc tế: ODF quang đỉnh tủ (U41-42), Patch Panel Cat6 (U38-40), Switch Core & Access (U34-36), Server ảo hóa VMware 2U (U20-30), Bộ lưu điện UPS Online 3kVA (U1-U4).',
    createProject: () => createServerRackProject()
  },

  // 4. Camera CCTV
  {
    id: 'tpl_cctv_security',
    name: 'Hệ thống Camera Giám sát An ninh AI',
    mode: 'cctv',
    categoryName: '04. Camera CCTV',
    badge: 'An ninh AI',
    thumbnailIcon: 'Video',
    description: 'Bố trí 8 camera 4K AI kèm nón góc quét quan sát (FOV 95°), tầm xa hồng ngoại 30m, kết nối PoE Switch tới đầu ghi NVR 32 kênh và màn hình giám sát trung tâm.',
    createProject: () => createCctvSecurityProject()
  },

  // 5. Phủ sóng Wi-Fi
  {
    id: 'tpl_wifi_coverage',
    name: 'Bản đồ Phủ sóng Wi-Fi 6 Doanh nghiệp',
    mode: 'wifi',
    categoryName: '05. Phủ sóng Wi-Fi',
    badge: 'Vùng phủ RF',
    thumbnailIcon: 'Wifi',
    description: 'Mô phỏng bán kính phủ sóng RF 2.4GHz & 5GHz của các Access Point Wi-Fi 6, trực quan hóa vùng giao thoa tín hiệu và khu vực điểm mù yếu sóng trong tòa nhà.',
    createProject: () => createWifiCoverageProject()
  },

  // 6. Cáp quang & Đấu nối
  {
    id: 'tpl_fiber_cabling',
    name: 'Trục Cáp quang ODF & Đấu nối Tủ Mạng',
    mode: 'fiber',
    categoryName: '06. Cáp quang',
    badge: 'Cáp quang ODF',
    thumbnailIcon: 'GitBranch',
    description: 'Sơ đồ luồng cáp quang đa lõi Single-mode OS2 kết nối giữa ODF phòng máy chủ trung tâm (MDF) với ODF các tầng (IDF) và bảng đấu dây Patch Panel Cat6A.',
    createProject: () => createFiberCablingProject()
  },

  // 7. Đa chi nhánh
  {
    id: 'tpl_multisite_wan',
    name: 'Tổng thể Đa Chi Nhánh (HQ & 3 Chi Nhánh)',
    mode: 'multisite',
    categoryName: '08. Đa chi nhánh',
    badge: 'WAN / SD-WAN',
    thumbnailIcon: 'Globe',
    description: 'Mô hình liên kết diện rộng kết nối Trụ sở chính (Headquarters), Chi nhánh Hà Nội, Chi nhánh Đà Nẵng và Đám mây AWS qua mạng riêng ảo IPsec / SD-WAN.',
    createProject: () => createMultiSiteWanProject()
  }
];

// -------------------------------------------------------------
// Template Generators
// -------------------------------------------------------------

// Default starter project imported from ./defaultStarterTemplate.ts

export function createEnterpriseTopologyProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  // 1. Internet Cloud
  const cloudPreset = DEVICE_CATALOG.find(d => d.category === 'cloud')!;
  const cloudAsset = createDeviceAssetFromPreset(cloudPreset, 1);
  cloudAsset.name = 'Dual-ISP Internet WAN';
  assets[cloudAsset.id] = cloudAsset;

  const cloudNode: DiagramNode = {
    id: 'node_cloud',
    diagramMode: 'topology',
    type: 'cloud',
    assetId: cloudAsset.id,
    label: cloudAsset.name,
    x: 440,
    y: 60,
    width: 170,
    height: 70,
    rotation: 0,
    style: {
      backgroundColor: '#6366f1',
      borderColor: '#4f46e5',
      borderWidth: 2,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#ffffff'
    }
  };
  nodes.push(cloudNode);

  // 2. Fortinet Firewall HA
  const fwPreset = DEVICE_CATALOG.find(d => d.category === 'firewall')!;
  const fwAsset = createDeviceAssetFromPreset(fwPreset, 2);
  fwAsset.name = 'NGFW-FortiGate-200F';
  fwAsset.ipAddress = '192.168.1.1';
  assets[fwAsset.id] = fwAsset;

  const fwNode: DiagramNode = {
    id: 'node_fw',
    diagramMode: 'topology',
    type: 'device',
    assetId: fwAsset.id,
    label: fwAsset.name,
    x: 440,
    y: 190,
    width: 170,
    height: 60,
    rotation: 0,
    style: {
      backgroundColor: '#dc2626',
      borderColor: '#b91c1c',
      borderWidth: 2,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#ffffff'
    }
  };
  nodes.push(fwNode);

  // 3. Core Switch Nexus
  const corePreset = DEVICE_CATALOG.find(d => d.category === 'core_switch')!;
  const coreAsset = createDeviceAssetFromPreset(corePreset, 3);
  coreAsset.name = 'Core-Switch-Nexus-9336C';
  coreAsset.ipAddress = '10.0.0.1';
  assets[coreAsset.id] = coreAsset;

  const coreNode: DiagramNode = {
    id: 'node_core',
    diagramMode: 'topology',
    type: 'device',
    assetId: coreAsset.id,
    label: coreAsset.name,
    x: 440,
    y: 320,
    width: 180,
    height: 64,
    rotation: 0,
    style: {
      backgroundColor: '#0284c7',
      borderColor: '#0369a1',
      borderWidth: 2,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#ffffff'
    }
  };
  nodes.push(coreNode);

  // 4. Distribution Switches (Left: Sales, Center: Servers, Right: Engineering)
  const swPreset = DEVICE_CATALOG.find(d => d.category === 'switch')!;
  
  const distSales = createDeviceAssetFromPreset(swPreset, 4);
  distSales.name = 'SW-DIST-SALES (VLAN 10)';
  distSales.ipAddress = '10.0.10.1';
  assets[distSales.id] = distSales;

  const nodeDistSales: DiagramNode = {
    id: 'node_dist_sales',
    diagramMode: 'topology',
    type: 'device',
    assetId: distSales.id,
    label: distSales.name,
    x: 140,
    y: 470,
    width: 180,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  };
  nodes.push(nodeDistSales);

  const serverPreset = DEVICE_CATALOG.find(d => d.category === 'server')!;
  const serverAsset = createDeviceAssetFromPreset(serverPreset, 5);
  serverAsset.name = 'PROD-VMware-ESXi-01';
  serverAsset.ipAddress = '10.0.50.11';
  assets[serverAsset.id] = serverAsset;

  const nodeServer: DiagramNode = {
    id: 'node_server_01',
    diagramMode: 'topology',
    type: 'device',
    assetId: serverAsset.id,
    label: serverAsset.name,
    x: 440,
    y: 470,
    width: 180,
    height: 60,
    rotation: 0,
    style: { backgroundColor: '#475569', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  };
  nodes.push(nodeServer);

  const distTech = createDeviceAssetFromPreset(swPreset, 6);
  distTech.name = 'SW-DIST-ENG (VLAN 20)';
  distTech.ipAddress = '10.0.20.1';
  assets[distTech.id] = distTech;

  const nodeDistTech: DiagramNode = {
    id: 'node_dist_tech',
    diagramMode: 'topology',
    type: 'device',
    assetId: distTech.id,
    label: distTech.name,
    x: 740,
    y: 470,
    width: 180,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  };
  nodes.push(nodeDistTech);

  // Cabling edges
  cables.push({
    id: 'cab_wan_fw',
    cableCode: 'WAN-ISP-01',
    diagramMode: 'topology',
    sourceNodeId: cloudNode.id,
    targetNodeId: fwNode.id,
    cableType: 'FIBER_SM_OS2',
    bandwidth: '10G',
    color: '#dc2626',
    routingType: 'straight',
    lineStyle: 'solid',
    strokeWidth: 3,
    lengthMeters: 5,
    status: 'active'
  });

  cables.push({
    id: 'cab_fw_core',
    cableCode: 'TRUNK-CORE-01',
    diagramMode: 'topology',
    sourceNodeId: fwNode.id,
    targetNodeId: coreNode.id,
    cableType: 'DAC_10G',
    bandwidth: '40G',
    color: '#0284c7',
    routingType: 'straight',
    lineStyle: 'solid',
    strokeWidth: 4,
    lengthMeters: 2,
    status: 'active'
  });

  cables.push({
    id: 'cab_core_sales',
    cableCode: 'FIB-CORE-SALES',
    diagramMode: 'topology',
    sourceNodeId: coreNode.id,
    targetNodeId: nodeDistSales.id,
    cableType: 'FIBER_MM_OM4',
    bandwidth: '10G',
    color: '#0ea5e9',
    routingType: 'orthogonal',
    lineStyle: 'solid',
    strokeWidth: 2,
    lengthMeters: 45,
    status: 'active'
  });

  cables.push({
    id: 'cab_core_srv',
    cableCode: 'DAC-CORE-SRV',
    diagramMode: 'topology',
    sourceNodeId: coreNode.id,
    targetNodeId: nodeServer.id,
    cableType: 'DAC_10G',
    bandwidth: '25G',
    color: '#475569',
    routingType: 'straight',
    lineStyle: 'solid',
    strokeWidth: 3,
    lengthMeters: 3,
    status: 'active'
  });

  cables.push({
    id: 'cab_core_tech',
    cableCode: 'FIB-CORE-ENG',
    diagramMode: 'topology',
    sourceNodeId: coreNode.id,
    targetNodeId: nodeDistTech.id,
    cableType: 'FIBER_MM_OM4',
    bandwidth: '10G',
    color: '#0ea5e9',
    routingType: 'orthogonal',
    lineStyle: 'solid',
    strokeWidth: 2,
    lengthMeters: 60,
    status: 'active'
  });

  return {
    id: 'proj_enterprise_topo',
    name: 'HACHIHI Enterprise Network Core Topology',
    author: 'Lead Infrastructure Engineer',
    version: '2.4.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets,
    nodes,
    cables,
    activeMode: 'topology',
    activeBuildingId: '',
    activeFloorId: '',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: false,
      unit: 'm',
      scale: 25,
      backgroundColor: '#f8fafc',
      isDarkMode: false
    }
  };
}

export function createSmallOfficeTopologyProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const routerPreset = DEVICE_CATALOG.find(d => d.category === 'router')!;
  const rAsset = createDeviceAssetFromPreset(routerPreset, 1);
  rAsset.name = 'Gateway-Router-SMB';
  rAsset.ipAddress = '192.168.1.1';
  assets[rAsset.id] = rAsset;

  const rNode: DiagramNode = {
    id: 'node_smb_r',
    diagramMode: 'topology',
    type: 'device',
    assetId: rAsset.id,
    label: rAsset.name,
    x: 420,
    y: 80,
    width: 170,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#2563eb', borderColor: '#1d4ed8', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
  };
  nodes.push(rNode);

  const swPreset = DEVICE_CATALOG.find(d => d.category === 'switch')!;
  const swAsset = createDeviceAssetFromPreset(swPreset, 2);
  swAsset.name = 'Switch-PoE-24P';
  swAsset.ipAddress = '192.168.1.2';
  assets[swAsset.id] = swAsset;

  const swNode: DiagramNode = {
    id: 'node_smb_sw',
    diagramMode: 'topology',
    type: 'device',
    assetId: swAsset.id,
    label: swAsset.name,
    x: 420,
    y: 220,
    width: 170,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
  };
  nodes.push(swNode);

  const apPreset = DEVICE_CATALOG.find(d => d.category === 'ap')!;
  const apAsset = createDeviceAssetFromPreset(apPreset, 3);
  apAsset.name = 'UniFi-AP-Office';
  apAsset.ipAddress = '192.168.1.20';
  assets[apAsset.id] = apAsset;

  const apNode: DiagramNode = {
    id: 'node_smb_ap',
    diagramMode: 'topology',
    type: 'device',
    assetId: apAsset.id,
    label: apAsset.name,
    x: 200,
    y: 360,
    width: 110,
    height: 70,
    rotation: 0,
    style: { backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
  };
  nodes.push(apNode);

  const srvPreset = DEVICE_CATALOG.find(d => d.category === 'server')!;
  const srvAsset = createDeviceAssetFromPreset(srvPreset, 4);
  srvAsset.name = 'NAS-FileServer';
  srvAsset.ipAddress = '192.168.1.100';
  assets[srvAsset.id] = srvAsset;

  const srvNode: DiagramNode = {
    id: 'node_smb_srv',
    diagramMode: 'topology',
    type: 'device',
    assetId: srvAsset.id,
    label: srvAsset.name,
    x: 640,
    y: 360,
    width: 150,
    height: 60,
    rotation: 0,
    style: { backgroundColor: '#475569', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
  };
  nodes.push(srvNode);

  cables.push({
    id: 'cab_smb_1',
    cableCode: 'UPLINK-01',
    diagramMode: 'topology',
    sourceNodeId: rNode.id,
    targetNodeId: swNode.id,
    cableType: 'CAT6_UTP',
    bandwidth: '1G',
    color: '#2563eb',
    routingType: 'straight',
    lineStyle: 'solid',
    strokeWidth: 3,
    lengthMeters: 1.5,
    status: 'active'
  });

  cables.push({
    id: 'cab_smb_2',
    cableCode: 'POE-AP-01',
    diagramMode: 'topology',
    sourceNodeId: swNode.id,
    targetNodeId: apNode.id,
    cableType: 'CAT6_UTP',
    bandwidth: '1G',
    color: '#10b981',
    routingType: 'orthogonal',
    lineStyle: 'solid',
    strokeWidth: 2,
    lengthMeters: 25,
    status: 'active'
  });

  cables.push({
    id: 'cab_smb_3',
    cableCode: 'LAN-NAS-01',
    diagramMode: 'topology',
    sourceNodeId: swNode.id,
    targetNodeId: srvNode.id,
    cableType: 'CAT6A_STP',
    bandwidth: '10G',
    color: '#0284c7',
    routingType: 'orthogonal',
    lineStyle: 'solid',
    strokeWidth: 2,
    lengthMeters: 3,
    status: 'active'
  });

  return {
    id: 'proj_smb_topo',
    name: 'Văn phòng SMB Network Design',
    author: 'Network Engineer',
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets,
    nodes,
    cables,
    activeMode: 'topology',
    activeBuildingId: '',
    activeFloorId: '',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: false,
      unit: 'm',
      scale: 25,
      backgroundColor: '#f8fafc',
      isDarkMode: false
    }
  };
}

export function createServerRackProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  // ODF at U41
  const odfPreset = DEVICE_CATALOG.find(d => d.category === 'odf')!;
  const odfAsset = createDeviceAssetFromPreset(odfPreset, 1);
  odfAsset.name = 'ODF-48F-LC (U41)';
  odfAsset.rackUnitStart = 41;
  odfAsset.rackUnitHeight = 1;
  assets[odfAsset.id] = odfAsset;

  // Patch Panel at U39
  const ppPreset = DEVICE_CATALOG.find(d => d.category === 'patch_panel')!;
  const ppAsset = createDeviceAssetFromPreset(ppPreset, 2);
  ppAsset.name = 'Patch-Panel-Cat6A (U39)';
  ppAsset.rackUnitStart = 39;
  ppAsset.rackUnitHeight = 1;
  assets[ppAsset.id] = ppAsset;

  // Core Switch at U36
  const corePreset = DEVICE_CATALOG.find(d => d.category === 'core_switch')!;
  const coreAsset = createDeviceAssetFromPreset(corePreset, 3);
  coreAsset.name = 'Cisco-Nexus-9336C (U36)';
  coreAsset.rackUnitStart = 36;
  coreAsset.rackUnitHeight = 1;
  assets[coreAsset.id] = coreAsset;

  // Servers at U24, U22
  const srvPreset = DEVICE_CATALOG.find(d => d.category === 'server')!;
  const srv1 = createDeviceAssetFromPreset(srvPreset, 4);
  srv1.name = 'Dell R760 Database (U24)';
  srv1.rackUnitStart = 24;
  srv1.rackUnitHeight = 2;
  assets[srv1.id] = srv1;

  const srv2 = createDeviceAssetFromPreset(srvPreset, 5);
  srv2.name = 'Dell R760 Virtualization (U22)';
  srv2.rackUnitStart = 22;
  srv2.rackUnitHeight = 2;
  assets[srv2.id] = srv2;

  // UPS at U1-2
  const upsPreset = DEVICE_CATALOG.find(d => d.category === 'ups')!;
  const upsAsset = createDeviceAssetFromPreset(upsPreset, 6);
  upsAsset.name = 'APC Smart-UPS 3kVA (U01-02)';
  upsAsset.rackUnitStart = 1;
  upsAsset.rackUnitHeight = 2;
  assets[upsAsset.id] = upsAsset;

  const rackId = 'rack_dc_row1';
  const rack: ServerRack = {
    id: rackId,
    name: 'RACK DC-A01 (42U Server Room)',
    totalUnits: 42,
    widthMm: 800,
    depthMm: 1200,
    maxLoadKg: 1300,
    x: 320,
    y: 40,
    slots: {
      41: odfAsset.id,
      39: ppAsset.id,
      36: coreAsset.id,
      24: srv1.id,
      22: srv2.id,
      1: upsAsset.id
    }
  };

  // Node for visual rack in canvas
  const rackNode: DiagramNode = {
    id: 'node_rack_01',
    diagramMode: 'rack',
    type: 'rack',
    label: rack.name,
    x: 340,
    y: 50,
    width: 320,
    height: 720,
    rotation: 0,
    style: {
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      borderWidth: 4,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#f8fafc'
    },
    customData: {
      rackId: rack.id,
      totalUnits: 42
    }
  };
  nodes.push(rackNode);

  return {
    id: 'proj_rack_design',
    name: 'HACHIHI Data Center Rack 42U Elevation',
    author: 'Data Center Facilities Manager',
    version: '1.2.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [rack],
    assets,
    nodes,
    cables,
    activeMode: 'rack',
    activeBuildingId: '',
    activeFloorId: '',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: false,
      unit: 'mm',
      scale: 1,
      backgroundColor: '#f8fafc',
      isDarkMode: false
    }
  };
}

export function createCctvSecurityProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const nvrPreset = DEVICE_CATALOG.find(d => d.category === 'nvr')!;
  const nvrAsset = createDeviceAssetFromPreset(nvrPreset, 1);
  nvrAsset.name = 'NVR-32CH-4K-AI';
  nvrAsset.ipAddress = '192.168.100.10';
  assets[nvrAsset.id] = nvrAsset;

  const nvrNode: DiagramNode = {
    id: 'node_nvr',
    diagramMode: 'cctv',
    type: 'device',
    assetId: nvrAsset.id,
    label: nvrAsset.name,
    x: 440,
    y: 60,
    width: 170,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#d97706', borderColor: '#b45309', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
  };
  nodes.push(nvrNode);

  // 4 cameras in cardinal positions with FOV cone data
  const camPreset = DEVICE_CATALOG.find(d => d.category === 'camera')!;
  const camPositions = [
    { name: 'CAM-01 (Cổng Chính)', x: 160, y: 220, rot: 45, fov: 95 },
    { name: 'CAM-02 (Hành Lang Đông)', x: 720, y: 220, rot: 135, fov: 90 },
    { name: 'CAM-03 (Bãi Xe Hầm B1)', x: 160, y: 440, rot: 315, fov: 110 },
    { name: 'CAM-04 (Cửa Phòng Server)', x: 720, y: 440, rot: 225, fov: 85 }
  ];

  camPositions.forEach((cp, idx) => {
    const cam = createDeviceAssetFromPreset(camPreset, idx + 2);
    cam.name = cp.name;
    cam.ipAddress = `192.168.100.${20 + idx}`;
    if (cam.cameraSpecs) {
      cam.cameraSpecs.fovAngle = cp.fov;
      cam.cameraSpecs.irDistanceMeters = 30;
      cam.cameraSpecs.nvrChannel = idx + 1;
    }
    assets[cam.id] = cam;

    const cNode: DiagramNode = {
      id: `node_cam_${idx + 1}`,
      diagramMode: 'cctv',
      type: 'device',
      assetId: cam.id,
      label: cam.name,
      x: cp.x,
      y: cp.y,
      width: 100,
      height: 80,
      rotation: cp.rot,
      style: { backgroundColor: '#f59e0b', borderColor: '#d97706', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' },
      customData: {
        fov: cp.fov,
        irDistance: 30
      }
    };
    nodes.push(cNode);

    cables.push({
      id: `cab_cam_${idx + 1}`,
      cableCode: `CAM-CABLE-${idx + 1}`,
      diagramMode: 'cctv',
      sourceNodeId: nvrNode.id,
      targetNodeId: cNode.id,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#f59e0b',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 30 + idx * 10,
      status: 'active'
    });
  });

  return {
    id: 'proj_cctv',
    name: 'CCTV Surveillance & FOV Coverage Plan',
    author: 'Security Architect',
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets,
    nodes,
    cables,
    activeMode: 'cctv',
    activeBuildingId: '',
    activeFloorId: '',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: true,
      unit: 'm',
      scale: 30,
      backgroundColor: '#f8fafc',
      isDarkMode: false
    }
  };
}

export function createWifiCoverageProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const apPreset = DEVICE_CATALOG.find(d => d.category === 'ap')!;
  const apList = [
    { name: 'AP-HALL-NORTH (Ch 1 / 36)', x: 260, y: 180, radius: 20 },
    { name: 'AP-TECH-CENTER (Ch 6 / 44)', x: 620, y: 180, radius: 22 },
    { name: 'AP-OFFICE-SOUTH (Ch 11 / 52)', x: 440, y: 380, radius: 18 }
  ];

  apList.forEach((apData, idx) => {
    const ap = createDeviceAssetFromPreset(apPreset, idx + 1);
    ap.name = apData.name;
    ap.ipAddress = `10.20.1.${10 + idx}`;
    if (ap.wifiSpecs) {
      ap.wifiSpecs.coverageRadiusMeters = apData.radius;
    }
    assets[ap.id] = ap;

    nodes.push({
      id: `node_wifi_ap_${idx + 1}`,
      diagramMode: 'wifi',
      type: 'device',
      assetId: ap.id,
      label: ap.name,
      x: apData.x,
      y: apData.y,
      width: 110,
      height: 90,
      rotation: 0,
      style: { backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' },
      customData: {
        coverageRadiusMeters: apData.radius
      }
    });
  });

  return {
    id: 'proj_wifi',
    name: 'Bản đồ Vùng Phủ sóng Wi-Fi 6',
    author: 'Wireless Engineer',
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets,
    nodes,
    cables,
    activeMode: 'wifi',
    activeBuildingId: '',
    activeFloorId: '',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: true,
      unit: 'm',
      scale: 30,
      backgroundColor: '#f8fafc',
      isDarkMode: false
    }
  };
}

export function createFiberCablingProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const odfPreset = DEVICE_CATALOG.find(d => d.category === 'odf')!;
  const mdfOdf = createDeviceAssetFromPreset(odfPreset, 1);
  mdfOdf.name = 'ODF-MDF-TẦNG 1 (48F)';
  assets[mdfOdf.id] = mdfOdf;

  const nodeMdfOdf: DiagramNode = {
    id: 'node_mdf_odf',
    diagramMode: 'fiber',
    type: 'device',
    assetId: mdfOdf.id,
    label: mdfOdf.name,
    x: 420,
    y: 80,
    width: 190,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#06b6d4', borderColor: '#0891b2', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
  };
  nodes.push(nodeMdfOdf);

  const floorOdfs = [
    { name: 'ODF-IDF TẦNG 2 (12F)', x: 180, y: 300 },
    { name: 'ODF-IDF TẦNG 3 (12F)', x: 420, y: 300 },
    { name: 'ODF-IDF TẦNG 4 (12F)', x: 660, y: 300 }
  ];

  floorOdfs.forEach((fOdf, i) => {
    const odf = createDeviceAssetFromPreset(odfPreset, i + 2);
    odf.name = fOdf.name;
    assets[odf.id] = odf;

    const n: DiagramNode = {
      id: `node_idf_${i + 1}`,
      diagramMode: 'fiber',
      type: 'device',
      assetId: odf.id,
      label: odf.name,
      x: fOdf.x,
      y: fOdf.y,
      width: 180,
      height: 56,
      rotation: 0,
      style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
    };
    nodes.push(n);

    cables.push({
      id: `cab_fiber_spine_${i + 1}`,
      cableCode: `FO-BACKBONE-FL${i + 2}`,
      diagramMode: 'fiber',
      sourceNodeId: nodeMdfOdf.id,
      targetNodeId: n.id,
      cableType: 'FIBER_SM_OS2',
      bandwidth: '100G',
      color: '#06b6d4',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 3,
      lengthMeters: 40 + i * 15,
      status: 'active'
    });
  });

  return {
    id: 'proj_fiber',
    name: 'Sơ đồ Tuyến Cáp Quang Trục Đứng ODF',
    author: 'Optical Telecom Engineer',
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets,
    nodes,
    cables,
    activeMode: 'fiber',
    activeBuildingId: '',
    activeFloorId: '',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: false,
      unit: 'm',
      scale: 30,
      backgroundColor: '#f8fafc',
      isDarkMode: false
    }
  };
}

export function createMultiSiteWanProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const cloudPreset = DEVICE_CATALOG.find(d => d.category === 'cloud')!;
  const cloud = createDeviceAssetFromPreset(cloudPreset, 1);
  cloud.name = 'HACHIHI SD-WAN CLOUD MESH';
  assets[cloud.id] = cloud;

  const cloudNode: DiagramNode = {
    id: 'node_sdwan_cloud',
    diagramMode: 'multisite',
    type: 'cloud',
    assetId: cloud.id,
    label: cloud.name,
    x: 420,
    y: 180,
    width: 200,
    height: 90,
    rotation: 0,
    style: { backgroundColor: '#6366f1', borderColor: '#4f46e5', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
  };
  nodes.push(cloudNode);

  const sites = [
    { name: 'TRỤ SỞ CHÍNH (TP. HỒ CHÍ MINH)', x: 420, y: 30, color: '#0284c7' },
    { name: 'CHI NHÁNH HÀ NỘI', x: 120, y: 340, color: '#0ea5e9' },
    { name: 'CHI NHÁNH ĐÀ NẴNG', x: 420, y: 340, color: '#0ea5e9' },
    { name: 'DATA CENTER AWS SINGAPORE', x: 720, y: 340, color: '#475569' }
  ];

  sites.forEach((st, idx) => {
    const rPreset = DEVICE_CATALOG.find(d => d.category === 'router')!;
    const rAsset = createDeviceAssetFromPreset(rPreset, idx + 2);
    rAsset.name = st.name;
    assets[rAsset.id] = rAsset;

    const n: DiagramNode = {
      id: `node_site_${idx + 1}`,
      diagramMode: 'multisite',
      type: 'device',
      assetId: rAsset.id,
      label: st.name,
      x: st.x,
      y: st.y,
      width: 210,
      height: 64,
      rotation: 0,
      style: { backgroundColor: st.color, borderColor: '#1e293b', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
    };
    nodes.push(n);

    cables.push({
      id: `cab_sdwan_${idx + 1}`,
      cableCode: `VPN-TUNNEL-SITE-${idx + 1}`,
      diagramMode: 'multisite',
      sourceNodeId: cloudNode.id,
      targetNodeId: n.id,
      cableType: 'FIBER_SM_OS2',
      bandwidth: '1G',
      color: '#6366f1',
      routingType: 'straight',
      lineStyle: 'dashed',
      strokeWidth: 3,
      lengthMeters: 800,
      status: 'active'
    });
  });

  return {
    id: 'proj_multisite',
    name: 'HACHIHI Multi-Site SD-WAN Enterprise Architecture',
    author: 'Chief Network Architect',
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets,
    nodes,
    cables,
    activeMode: 'multisite',
    activeBuildingId: '',
    activeFloorId: '',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: false,
      unit: 'm',
      scale: 25,
      backgroundColor: '#f8fafc',
      isDarkMode: false
    }
  };
}

function syncSampleProjectPorts(
  assets: Record<string, DeviceAsset>,
  nodes: DiagramNode[],
  cables: CableEdge[]
): Record<string, DeviceAsset> {
  const next: Record<string, DeviceAsset> = {};
  for (const [id, asset] of Object.entries(assets)) {
    next[id] = {
      ...asset,
      ports: asset.ports.map(p => ({
        ...p,
        status: 'unlinked',
        connectedCableId: undefined,
        connectedTarget: undefined
      }))
    };
  }
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const cab of cables) {
    const srcNode = nodeMap.get(cab.sourceNodeId);
    const tgtNode = nodeMap.get(cab.targetNodeId);
    const srcAsset = srcNode?.assetId ? next[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? next[tgtNode.assetId] : undefined;
    if (srcAsset && cab.sourcePortId) {
      const p = srcAsset.ports.find(port => port.id === cab.sourcePortId);
      if (p) {
        p.status = 'up';
        p.connectedCableId = cab.id;
        if (tgtAsset && cab.targetPortId) {
          p.connectedTarget = { deviceId: tgtAsset.id, portId: cab.targetPortId };
        }
      }
    }
    if (tgtAsset && cab.targetPortId) {
      const p = tgtAsset.ports.find(port => port.id === cab.targetPortId);
      if (p) {
        p.status = 'up';
        p.connectedCableId = cab.id;
        if (srcAsset && cab.sourcePortId) {
          p.connectedTarget = { deviceId: srcAsset.id, portId: cab.sourcePortId };
        }
      }
    }
  }
  return next;
}

/**
 * Sample Project: Pre-configured 3-floor office network topology with rack assignments,
 * VLAN directory, CIDR IP subnetting, PoE budgets, UPS headroom, and patch schedule.
 */
export function createMultiFloorSampleOfficeProject(): ProjectState {
  const buildingId = 'bld_sample_hq';
  const building: Building = {
    id: buildingId,
    name: 'Tòa nhà Văn phòng Mẫu HACHIHI (3 Tầng)',
    totalFloors: 3,
    basementFloors: 0,
    widthMeters: 36,
    depthMeters: 24,
    floorHeightMeters: 3.6,
    wallThicknessMm: 200,
    layoutStyle: 'rectangle'
  };

  const floors: Floor[] = [
    {
      id: 'flr_sample_1',
      buildingId,
      level: 1,
      name: 'Tầng 1 - Lễ tân & Phòng Server MDF',
      description: 'Phòng Server trung tâm (Rack MDF-01), Firewall, Core Switch và sảnh Lễ tân',
      widthMeters: 36,
      depthMeters: 24
    },
    {
      id: 'flr_sample_2',
      buildingId,
      level: 2,
      name: 'Tầng 2 - Khối Kinh doanh & Vận hành',
      description: 'Khu vực làm việc nhân viên, Wi-Fi 6 và tủ phân phối IDF-F2',
      widthMeters: 36,
      depthMeters: 24
    },
    {
      id: 'flr_sample_3',
      buildingId,
      level: 3,
      name: 'Tầng 3 - Khối Kỹ thuật R&D & Phòng Họp',
      description: 'Phòng Lab R&D, Camera giám sát, Wi-Fi và tủ phân phối IDF-F3',
      widthMeters: 36,
      depthMeters: 24
    }
  ];

  const rooms: Room[] = [
    {
      id: 'rm_s1_mdf',
      floorId: 'flr_sample_1',
      name: 'Phòng Server MDF (Tầng 1)',
      type: 'server_room',
      x: 345,
      y: 108,
      width: 525,
      height: 205,
      color: '#f0fdf4',
      wallThickness: 8
    },
    {
      id: 'rm_s1_rec',
      floorId: 'flr_sample_1',
      name: 'Sảnh Lễ tân & An ninh (Tầng 1)',
      type: 'reception',
      x: 40,
      y: 205,
      width: 265,
      height: 395,
      color: '#f8fafc',
      wallThickness: 6
    },
    {
      id: 'rm_s2_sales',
      floorId: 'flr_sample_2',
      name: 'Phòng Kinh doanh & Tủ IDF Tầng 2',
      type: 'office',
      x: 340,
      y: 355,
      width: 295,
      height: 340,
      color: '#eff6ff',
      wallThickness: 6
    },
    {
      id: 'rm_s3_rnd',
      floorId: 'flr_sample_3',
      name: 'Phòng Kỹ thuật R&D & Tủ IDF Tầng 3',
      type: 'office',
      x: 640,
      y: 355,
      width: 270,
      height: 245,
      color: '#f8fafc',
      wallThickness: 6
    }
  ];

  const vlans: VlanSpec[] = [
    { id: 'vlan_10', vlanId: 10, name: 'MGMT-Infra', purpose: 'Quản trị Switch, Firewall, UPS & thiết bị mạng', color: '#2563eb' },
    { id: 'vlan_20', vlanId: 20, name: 'Office-Staff', purpose: 'Máy trạm nhân viên & thiết bị văn phòng', color: '#0ea5e9' },
    { id: 'vlan_30', vlanId: 30, name: 'Corp-WiFi', purpose: 'Hệ thống phát sóng Wi-Fi 6 doanh nghiệp', color: '#10b981' },
    { id: 'vlan_40', vlanId: 40, name: 'CCTV-Security', purpose: 'Camera an ninh IP & đầu ghi NVR', color: '#f59e0b' },
    { id: 'vlan_50', vlanId: 50, name: 'Server-Farm', purpose: 'Máy chủ nội bộ ERP & lưu trữ', color: '#6366f1' }
  ];

  const subnets: SubnetSpec[] = [
    {
      id: 'sub_mgmt',
      name: 'MGMT - Hạ tầng mạng',
      cidr: '10.10.10.0/24',
      vlanId: 10,
      gateway: '10.10.10.1',
      dnsServers: '10.10.50.10, 8.8.8.8',
      dhcpRange: 'Tĩnh (Static)',
      notes: 'Dành riêng cho quản trị Firewall, Switch, UPS và PDU'
    },
    {
      id: 'sub_staff',
      name: 'STAFF - Văn phòng',
      cidr: '10.10.20.0/24',
      vlanId: 20,
      gateway: '10.10.20.1',
      dnsServers: '10.10.50.10, 1.1.1.1',
      dhcpRange: '10.10.20.50 - 10.10.20.220',
      notes: 'Máy tính nhân viên Tầng 1–3'
    },
    {
      id: 'sub_wifi',
      name: 'WIFI - Điểm phát không dây',
      cidr: '10.10.30.0/24',
      vlanId: 30,
      gateway: '10.10.30.1',
      dnsServers: '10.10.50.10, 8.8.8.8',
      dhcpRange: '10.10.30.50 - 10.10.30.220',
      notes: 'Access Point Wi-Fi 6 tại các tầng'
    },
    {
      id: 'sub_cctv',
      name: 'CCTV - Giám sát an ninh',
      cidr: '10.10.40.0/24',
      vlanId: 40,
      gateway: '10.10.40.1',
      dnsServers: '10.10.40.1',
      dhcpRange: 'Tĩnh (Static)',
      notes: 'Cô lập hoàn toàn luồng video Camera & NVR'
    },
    {
      id: 'sub_srv',
      name: 'SERVERS - Máy chủ nội bộ',
      cidr: '10.10.50.0/24',
      vlanId: 50,
      gateway: '10.10.50.1',
      dnsServers: '10.10.50.10',
      dhcpRange: 'Tĩnh (Static)',
      notes: 'Máy chủ ERP, AD/DNS trong tủ MDF-01'
    }
  ];

  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const cloudPreset = DEVICE_CATALOG.find(d => d.category === 'cloud')!;
  const fwPreset = DEVICE_CATALOG.find(d => d.category === 'firewall')!;
  const corePreset = DEVICE_CATALOG.find(d => d.category === 'core_switch')!;
  const ciscoSwPreset = DEVICE_CATALOG.find(d => d.model.includes('C9300'))!;
  const ruijieSwPreset = DEVICE_CATALOG.find(d => d.vendor === 'Ruijie') || ciscoSwPreset;
  const tplinkSwPreset = DEVICE_CATALOG.find(d => d.vendor.includes('TP-Link')) || ciscoSwPreset;
  const srvPreset = DEVICE_CATALOG.find(d => d.category === 'server')!;
  const nvrPreset = DEVICE_CATALOG.find(d => d.category === 'nvr')!;
  const apPreset = DEVICE_CATALOG.find(d => d.category === 'ap')!;
  const camPreset = DEVICE_CATALOG.find(d => d.category === 'camera')!;
  const odfPreset = DEVICE_CATALOG.find(d => d.category === 'odf')!;
  const ppPreset = DEVICE_CATALOG.find(d => d.category === 'patch_panel')!;
  const upsPreset = DEVICE_CATALOG.find(d => d.category === 'ups')!;
  const pduPreset = DEVICE_CATALOG.find(d => d.category === 'pdu')!;

  // 1. WAN Cloud (Internet)
  const cloudAsset = createDeviceAssetFromPreset(cloudPreset, 1);
  cloudAsset.id = 'ast_sample_cloud';
  cloudAsset.name = 'WAN-FTTH-DualISP';
  cloudAsset.ipAddress = '';
  cloudAsset.subnetMask = '';
  cloudAsset.gateway = '';
  cloudAsset.vlan = '';
  cloudAsset.buildingId = buildingId;
  cloudAsset.floorId = 'flr_sample_1';
  assets[cloudAsset.id] = cloudAsset;

  nodes.push({
    id: 'node_sample_cloud',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'cloud',
    assetId: cloudAsset.id,
    label: cloudAsset.name,
    x: 375,
    y: 30,
    width: 170,
    height: 64,
    rotation: 0,
    style: { backgroundColor: '#6366f1', borderColor: '#4f46e5', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  // 2. Firewall FortiGate 200F (MDF Rack U38)
  const fwAsset = createDeviceAssetFromPreset(fwPreset, 2);
  fwAsset.id = 'ast_sample_fw';
  fwAsset.name = 'FW-HQ-200F';
  fwAsset.ipAddress = '10.10.10.1';
  fwAsset.subnetMask = '255.255.255.0';
  fwAsset.gateway = '10.10.10.1';
  fwAsset.vlan = '10, 20, 30, 40, 50';
  fwAsset.buildingId = buildingId;
  fwAsset.floorId = 'flr_sample_1';
  fwAsset.roomId = 'rm_s1_mdf';
  fwAsset.rackId = 'rack_sample_mdf';
  fwAsset.rackUnitStart = 38;
  fwAsset.rackUnitHeight = 1;
  fwAsset.rackSide = 'front';
  assets[fwAsset.id] = fwAsset;

  nodes.push({
    id: 'node_sample_fw',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: fwAsset.id,
    label: fwAsset.name,
    x: 375,
    y: 130,
    width: 170,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#dc2626', borderColor: '#b91c1c', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  // 3. Core Switch Nexus (MDF Rack U36)
  const coreAsset = createDeviceAssetFromPreset(corePreset, 3);
  coreAsset.id = 'ast_sample_core';
  coreAsset.name = 'SW-CORE-MDF';
  coreAsset.ipAddress = '10.10.10.2';
  coreAsset.subnetMask = '255.255.255.0';
  coreAsset.gateway = '10.10.10.1';
  coreAsset.vlan = '10, 20, 30, 40, 50';
  coreAsset.buildingId = buildingId;
  coreAsset.floorId = 'flr_sample_1';
  coreAsset.roomId = 'rm_s1_mdf';
  coreAsset.rackId = 'rack_sample_mdf';
  coreAsset.rackUnitStart = 36;
  coreAsset.rackUnitHeight = 1;
  coreAsset.rackSide = 'front';
  coreAsset.ports.push({
    id: 'port_9',
    name: 'SFP+_5',
    type: 'SFP_PLUS_10G',
    speed: '10 Gbps',
    status: 'unlinked'
  });
  assets[coreAsset.id] = coreAsset;

  nodes.push({
    id: 'node_sample_core',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: coreAsset.id,
    label: coreAsset.name,
    x: 370,
    y: 224,
    width: 180,
    height: 60,
    rotation: 0,
    style: { backgroundColor: '#0284c7', borderColor: '#0369a1', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  // 4. Server ERP (MDF Rack U24-25)
  const srvAsset = createDeviceAssetFromPreset(srvPreset, 4);
  srvAsset.id = 'ast_sample_srv';
  srvAsset.name = 'SRV-ERP-01';
  srvAsset.ipAddress = '10.10.50.10';
  srvAsset.subnetMask = '255.255.255.0';
  srvAsset.gateway = '10.10.50.1';
  srvAsset.vlan = '50';
  srvAsset.buildingId = buildingId;
  srvAsset.floorId = 'flr_sample_1';
  srvAsset.roomId = 'rm_s1_mdf';
  srvAsset.rackId = 'rack_sample_mdf';
  srvAsset.rackUnitStart = 24;
  srvAsset.rackUnitHeight = 2;
  srvAsset.rackSide = 'front';
  assets[srvAsset.id] = srvAsset;

  nodes.push({
    id: 'node_sample_srv',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: srvAsset.id,
    label: srvAsset.name,
    x: 680,
    y: 224,
    width: 160,
    height: 60,
    rotation: 0,
    style: { backgroundColor: '#475569', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  // 5. UPS MDF (MDF Rack U1-2)
  const upsMdfAsset = createDeviceAssetFromPreset(upsPreset, 5);
  upsMdfAsset.id = 'ast_sample_ups_mdf';
  upsMdfAsset.name = 'UPS-MDF-3KVA';
  upsMdfAsset.ipAddress = '10.10.10.5';
  upsMdfAsset.subnetMask = '255.255.255.0';
  upsMdfAsset.gateway = '10.10.10.1';
  upsMdfAsset.vlan = '10';
  upsMdfAsset.buildingId = buildingId;
  upsMdfAsset.floorId = 'flr_sample_1';
  upsMdfAsset.roomId = 'rm_s1_mdf';
  upsMdfAsset.rackId = 'rack_sample_mdf';
  upsMdfAsset.rackUnitStart = 1;
  upsMdfAsset.rackUnitHeight = 2;
  upsMdfAsset.rackSide = 'front';
  if (upsMdfAsset.ports[3]) {
    upsMdfAsset.ports[3] = { ...upsMdfAsset.ports[3], speed: '1 Gbps' };
  }
  assets[upsMdfAsset.id] = upsMdfAsset;

  nodes.push({
    id: 'node_sample_ups_mdf',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: upsMdfAsset.id,
    label: upsMdfAsset.name,
    x: 680,
    y: 130,
    width: 160,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#e11d48', borderColor: '#be123c', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  // 6. NVR CCTV (MDF Rack U20)
  const nvrAsset = createDeviceAssetFromPreset(nvrPreset, 6);
  nvrAsset.id = 'ast_sample_nvr';
  nvrAsset.name = 'NVR-CCTV-01';
  nvrAsset.ipAddress = '10.10.40.10';
  nvrAsset.subnetMask = '255.255.255.0';
  nvrAsset.gateway = '10.10.40.1';
  nvrAsset.vlan = '40';
  nvrAsset.powerWatts = 120;
  nvrAsset.poeBudgetWatts = 180;
  nvrAsset.buildingId = buildingId;
  nvrAsset.floorId = 'flr_sample_1';
  nvrAsset.roomId = 'rm_s1_mdf';
  nvrAsset.rackId = 'rack_sample_mdf';
  nvrAsset.rackUnitStart = 20;
  nvrAsset.rackUnitHeight = 1;
  nvrAsset.rackSide = 'front';
  assets[nvrAsset.id] = nvrAsset;

  nodes.push({
    id: 'node_sample_nvr',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: nvrAsset.id,
    label: nvrAsset.name,
    x: 80,
    y: 224,
    width: 160,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#d97706', borderColor: '#b45309', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  // 7. Floor 1 Access Switch + AP + Camera
  const swF1Asset = createDeviceAssetFromPreset(ciscoSwPreset, 7);
  swF1Asset.id = 'ast_sample_sw_f1';
  swF1Asset.name = 'SW-ACC-FL1';
  swF1Asset.ipAddress = '10.10.10.11';
  swF1Asset.subnetMask = '255.255.255.0';
  swF1Asset.gateway = '10.10.10.1';
  swF1Asset.vlan = '10, 20, 30, 40';
  swF1Asset.poeBudgetWatts = 370;
  swF1Asset.buildingId = buildingId;
  swF1Asset.floorId = 'flr_sample_1';
  swF1Asset.roomId = 'rm_s1_mdf';
  swF1Asset.rackId = 'rack_sample_mdf';
  swF1Asset.rackUnitStart = 34;
  swF1Asset.rackUnitHeight = 1;
  swF1Asset.rackSide = 'front';
  if (swF1Asset.ports[0]) {
    swF1Asset.ports[0] = { ...swF1Asset.ports[0], type: 'RJ45_10G', speed: '2.5 Gbps', poe: true };
  }
  assets[swF1Asset.id] = swF1Asset;

  nodes.push({
    id: 'node_sample_sw_f1',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: swF1Asset.id,
    label: swF1Asset.name,
    x: 80,
    y: 380,
    width: 170,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  const apF1Asset = createDeviceAssetFromPreset(apPreset, 8);
  apF1Asset.id = 'ast_sample_ap_f1';
  apF1Asset.name = 'AP-F1-LOBBY';
  apF1Asset.ipAddress = '10.10.30.11';
  apF1Asset.subnetMask = '255.255.255.0';
  apF1Asset.gateway = '10.10.30.1';
  apF1Asset.vlan = '30';
  apF1Asset.poeEnabled = true;
  apF1Asset.poeWatts = 22;
  apF1Asset.buildingId = buildingId;
  apF1Asset.floorId = 'flr_sample_1';
  apF1Asset.roomId = 'rm_s1_rec';
  if (apF1Asset.wifiSpecs) {
    apF1Asset.wifiSpecs.coverageRadiusMeters = 18;
    apF1Asset.wifiSpecs.channel24 = 1;
    apF1Asset.wifiSpecs.channel5 = 36;
  }
  assets[apF1Asset.id] = apF1Asset;

  nodes.push({
    id: 'node_sample_ap_f1',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: apF1Asset.id,
    label: apF1Asset.name,
    x: 60,
    y: 490,
    width: 100,
    height: 80,
    rotation: 0,
    style: { backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' },
    customData: { coverageRadiusMeters: 18 }
  });

  const camF1Asset = createDeviceAssetFromPreset(camPreset, 9);
  camF1Asset.id = 'ast_sample_cam_f1';
  camF1Asset.name = 'CAM-F1-GATE';
  camF1Asset.ipAddress = '10.10.40.21';
  camF1Asset.subnetMask = '255.255.255.0';
  camF1Asset.gateway = '10.10.40.1';
  camF1Asset.vlan = '40';
  camF1Asset.poeEnabled = true;
  camF1Asset.poeWatts = 12;
  camF1Asset.buildingId = buildingId;
  camF1Asset.floorId = 'flr_sample_1';
  camF1Asset.roomId = 'rm_s1_rec';
  if (camF1Asset.cameraSpecs) {
    camF1Asset.cameraSpecs.fovAngle = 95;
    camF1Asset.cameraSpecs.irDistanceMeters = 30;
    camF1Asset.cameraSpecs.nvrChannel = 1;
  }
  assets[camF1Asset.id] = camF1Asset;

  nodes.push({
    id: 'node_sample_cam_f1',
    diagramMode: 'topology',
    floorId: 'flr_sample_1',
    type: 'device',
    assetId: camF1Asset.id,
    label: camF1Asset.name,
    x: 190,
    y: 495,
    width: 96,
    height: 74,
    rotation: 45,
    style: { backgroundColor: '#f59e0b', borderColor: '#d97706', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' },
    customData: { fov: 95, irDistance: 30 }
  });

  // 8. Floor 2 IDF Rack, Switch, AP, Workstation & UPS
  const swF2Asset = createDeviceAssetFromPreset(ruijieSwPreset, 10);
  swF2Asset.id = 'ast_sample_sw_f2';
  swF2Asset.name = 'SW-ACC-FL2';
  swF2Asset.ipAddress = '10.10.10.12';
  swF2Asset.subnetMask = '255.255.255.0';
  swF2Asset.gateway = '10.10.10.1';
  swF2Asset.vlan = '10, 20, 30';
  swF2Asset.poeBudgetWatts = 370;
  swF2Asset.buildingId = buildingId;
  swF2Asset.floorId = 'flr_sample_2';
  swF2Asset.roomId = 'rm_s2_sales';
  swF2Asset.rackId = 'rack_sample_idf2';
  swF2Asset.rackUnitStart = 22;
  swF2Asset.rackUnitHeight = 1;
  swF2Asset.rackSide = 'front';
  if (swF2Asset.ports[0]) {
    swF2Asset.ports[0] = { ...swF2Asset.ports[0], type: 'RJ45_10G', speed: '2.5 Gbps', poe: true };
  }
  assets[swF2Asset.id] = swF2Asset;

  nodes.push({
    id: 'node_sample_sw_f2',
    diagramMode: 'topology',
    floorId: 'flr_sample_2',
    type: 'device',
    assetId: swF2Asset.id,
    label: swF2Asset.name,
    x: 375,
    y: 380,
    width: 170,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  const apF2Asset = createDeviceAssetFromPreset(apPreset, 11);
  apF2Asset.id = 'ast_sample_ap_f2';
  apF2Asset.name = 'AP-F2-SALES';
  apF2Asset.ipAddress = '10.10.30.12';
  apF2Asset.subnetMask = '255.255.255.0';
  apF2Asset.gateway = '10.10.30.1';
  apF2Asset.vlan = '30';
  apF2Asset.poeEnabled = true;
  apF2Asset.poeWatts = 22;
  apF2Asset.buildingId = buildingId;
  apF2Asset.floorId = 'flr_sample_2';
  apF2Asset.roomId = 'rm_s2_sales';
  if (apF2Asset.wifiSpecs) {
    apF2Asset.wifiSpecs.coverageRadiusMeters = 20;
    apF2Asset.wifiSpecs.channel24 = 6;
    apF2Asset.wifiSpecs.channel5 = 44;
  }
  assets[apF2Asset.id] = apF2Asset;

  nodes.push({
    id: 'node_sample_ap_f2',
    diagramMode: 'topology',
    floorId: 'flr_sample_2',
    type: 'device',
    assetId: apF2Asset.id,
    label: apF2Asset.name,
    x: 360,
    y: 490,
    width: 100,
    height: 80,
    rotation: 0,
    style: { backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' },
    customData: { coverageRadiusMeters: 20 }
  });

  const pcF2Asset: DeviceAsset = {
    id: 'ast_sample_pc_f2',
    name: 'PC-F2-SALES-01',
    category: 'workstation',
    vendor: 'Dell',
    model: 'OptiPlex 7010',
    assetTag: 'AST-0012',
    serialNumber: 'SNDL7010F2',
    ipAddress: '10.10.20.51',
    subnetMask: '255.255.255.0',
    gateway: '10.10.20.1',
    macAddress: '00:1A:2B:00:12:C1',
    vlan: '20',
    status: 'online',
    buildingId,
    floorId: 'flr_sample_2',
    roomId: 'rm_s2_sales',
    powerWatts: 180,
    weightKg: 6.5,
    ports: [
      { id: 'port_1', name: 'NIC_1G', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked' }
    ]
  };
  assets[pcF2Asset.id] = pcF2Asset;

  nodes.push({
    id: 'node_sample_pc_f2',
    diagramMode: 'topology',
    floorId: 'flr_sample_2',
    type: 'device',
    assetId: pcF2Asset.id,
    label: pcF2Asset.name,
    x: 490,
    y: 495,
    width: 120,
    height: 70,
    rotation: 0,
    style: { backgroundColor: '#334155', borderColor: '#1e293b', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  const upsIdf2Asset = createDeviceAssetFromPreset(upsPreset, 13);
  upsIdf2Asset.id = 'ast_sample_ups_idf2';
  upsIdf2Asset.name = 'UPS-IDF-F2';
  upsIdf2Asset.ipAddress = '10.10.10.15';
  upsIdf2Asset.subnetMask = '255.255.255.0';
  upsIdf2Asset.gateway = '10.10.10.1';
  upsIdf2Asset.vlan = '10';
  upsIdf2Asset.buildingId = buildingId;
  upsIdf2Asset.floorId = 'flr_sample_2';
  upsIdf2Asset.roomId = 'rm_s2_sales';
  upsIdf2Asset.rackId = 'rack_sample_idf2';
  upsIdf2Asset.rackUnitStart = 1;
  upsIdf2Asset.rackUnitHeight = 2;
  upsIdf2Asset.rackSide = 'front';
  if (upsIdf2Asset.ports[3]) {
    upsIdf2Asset.ports[3] = { ...upsIdf2Asset.ports[3], speed: '1 Gbps' };
  }
  assets[upsIdf2Asset.id] = upsIdf2Asset;

  nodes.push({
    id: 'node_sample_ups_idf2',
    diagramMode: 'topology',
    floorId: 'flr_sample_2',
    type: 'device',
    assetId: upsIdf2Asset.id,
    label: upsIdf2Asset.name,
    x: 375,
    y: 615,
    width: 160,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#e11d48', borderColor: '#be123c', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  // 9. Floor 3 IDF Rack, Switch, AP & Camera
  const swF3Asset = createDeviceAssetFromPreset(tplinkSwPreset, 14);
  swF3Asset.id = 'ast_sample_sw_f3';
  swF3Asset.name = 'SW-ACC-FL3';
  swF3Asset.ipAddress = '10.10.10.13';
  swF3Asset.subnetMask = '255.255.255.0';
  swF3Asset.gateway = '10.10.10.1';
  swF3Asset.vlan = '10, 20, 30, 40';
  swF3Asset.poeBudgetWatts = 250;
  swF3Asset.buildingId = buildingId;
  swF3Asset.floorId = 'flr_sample_3';
  swF3Asset.roomId = 'rm_s3_rnd';
  swF3Asset.rackId = 'rack_sample_idf3';
  swF3Asset.rackUnitStart = 13;
  swF3Asset.rackUnitHeight = 1;
  swF3Asset.rackSide = 'front';
  if (swF3Asset.ports[0]) {
    swF3Asset.ports[0] = { ...swF3Asset.ports[0], type: 'RJ45_10G', speed: '2.5 Gbps', poe: true };
  }
  const swF3Uplink = swF3Asset.ports.find(p => p.id === 'port_25');
  if (swF3Uplink) {
    swF3Uplink.speed = '10 Gbps';
  }
  assets[swF3Asset.id] = swF3Asset;

  nodes.push({
    id: 'node_sample_sw_f3',
    diagramMode: 'topology',
    floorId: 'flr_sample_3',
    type: 'device',
    assetId: swF3Asset.id,
    label: swF3Asset.name,
    x: 680,
    y: 380,
    width: 170,
    height: 56,
    rotation: 0,
    style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  const apF3Asset = createDeviceAssetFromPreset(apPreset, 15);
  apF3Asset.id = 'ast_sample_ap_f3';
  apF3Asset.name = 'AP-F3-ENG';
  apF3Asset.ipAddress = '10.10.30.13';
  apF3Asset.subnetMask = '255.255.255.0';
  apF3Asset.gateway = '10.10.30.1';
  apF3Asset.vlan = '30';
  apF3Asset.poeEnabled = true;
  apF3Asset.poeWatts = 22;
  apF3Asset.buildingId = buildingId;
  apF3Asset.floorId = 'flr_sample_3';
  apF3Asset.roomId = 'rm_s3_rnd';
  if (apF3Asset.wifiSpecs) {
    apF3Asset.wifiSpecs.coverageRadiusMeters = 18;
    apF3Asset.wifiSpecs.channel24 = 11;
    apF3Asset.wifiSpecs.channel5 = 52;
  }
  assets[apF3Asset.id] = apF3Asset;

  nodes.push({
    id: 'node_sample_ap_f3',
    diagramMode: 'topology',
    floorId: 'flr_sample_3',
    type: 'device',
    assetId: apF3Asset.id,
    label: apF3Asset.name,
    x: 660,
    y: 490,
    width: 100,
    height: 80,
    rotation: 0,
    style: { backgroundColor: '#10b981', borderColor: '#059669', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' },
    customData: { coverageRadiusMeters: 18 }
  });

  const camF3Asset = createDeviceAssetFromPreset(camPreset, 16);
  camF3Asset.id = 'ast_sample_cam_f3';
  camF3Asset.name = 'CAM-F3-LAB';
  camF3Asset.ipAddress = '10.10.40.22';
  camF3Asset.subnetMask = '255.255.255.0';
  camF3Asset.gateway = '10.10.40.1';
  camF3Asset.vlan = '40';
  camF3Asset.poeEnabled = true;
  camF3Asset.poeWatts = 12;
  camF3Asset.buildingId = buildingId;
  camF3Asset.floorId = 'flr_sample_3';
  camF3Asset.roomId = 'rm_s3_rnd';
  if (camF3Asset.cameraSpecs) {
    camF3Asset.cameraSpecs.fovAngle = 90;
    camF3Asset.cameraSpecs.irDistanceMeters = 30;
    camF3Asset.cameraSpecs.nvrChannel = 2;
  }
  assets[camF3Asset.id] = camF3Asset;

  nodes.push({
    id: 'node_sample_cam_f3',
    diagramMode: 'topology',
    floorId: 'flr_sample_3',
    type: 'device',
    assetId: camF3Asset.id,
    label: camF3Asset.name,
    x: 790,
    y: 495,
    width: 96,
    height: 74,
    rotation: 225,
    style: { backgroundColor: '#f59e0b', borderColor: '#d97706', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' },
    customData: { fov: 90, irDistance: 30 }
  });

  // 10. Passive Rack Assets (ODFs, Patch Panels, Rear PDU) assigned directly to rack slots
  const makePassiveRackAsset = (
    preset: typeof odfPreset,
    id: string,
    name: string,
    idx: number,
    floorId: string,
    roomId: string,
    rackId: string,
    uStart: number,
    side: 'front' | 'rear' = 'front',
    mgmtIp = ''
  ) => {
    const a = createDeviceAssetFromPreset(preset, idx);
    a.id = id;
    a.name = name;
    a.ipAddress = mgmtIp;
    a.subnetMask = mgmtIp ? '255.255.255.0' : '';
    a.gateway = mgmtIp ? '10.10.10.1' : '';
    a.vlan = mgmtIp ? '10' : '';
    a.buildingId = buildingId;
    a.floorId = floorId;
    a.roomId = roomId;
    a.rackId = rackId;
    a.rackUnitStart = uStart;
    a.rackUnitHeight = Math.max(1, preset.defaultUHeight || 1);
    a.rackSide = side;
    assets[a.id] = a;
    return a;
  };

  const odfMdf = makePassiveRackAsset(odfPreset, 'ast_sample_odf_mdf', 'ODF-MDF-24F', 17, 'flr_sample_1', 'rm_s1_mdf', 'rack_sample_mdf', 42);
  const ppMdf = makePassiveRackAsset(ppPreset, 'ast_sample_pp_mdf', 'PP-MDF-24P', 18, 'flr_sample_1', 'rm_s1_mdf', 'rack_sample_mdf', 40);
  const pduMdf = makePassiveRackAsset(pduPreset, 'ast_sample_pdu_mdf', 'PDU-MDF-R1', 19, 'flr_sample_1', 'rm_s1_mdf', 'rack_sample_mdf', 10, 'rear', '10.10.10.6');

  const odfIdf2 = makePassiveRackAsset(odfPreset, 'ast_sample_odf_idf2', 'ODF-IDF-F2', 20, 'flr_sample_2', 'rm_s2_sales', 'rack_sample_idf2', 26);
  const ppIdf2 = makePassiveRackAsset(ppPreset, 'ast_sample_pp_idf2', 'PP-IDF-F2', 21, 'flr_sample_2', 'rm_s2_sales', 'rack_sample_idf2', 24);

  const odfIdf3 = makePassiveRackAsset(odfPreset, 'ast_sample_odf_idf3', 'ODF-IDF-F3', 22, 'flr_sample_3', 'rm_s3_rnd', 'rack_sample_idf3', 17);
  const ppIdf3 = makePassiveRackAsset(ppPreset, 'ast_sample_pp_idf3', 'PP-IDF-F3', 23, 'flr_sample_3', 'rm_s3_rnd', 'rack_sample_idf3', 15);

  // 11. 3 Server Racks across 3 floors + Visual Rack Elevation Nodes
  const racks: ServerRack[] = [
    {
      id: 'rack_sample_mdf',
      name: 'Rack MDF-01 (42U - Tầng 1)',
      buildingId,
      floorId: 'flr_sample_1',
      roomId: 'rm_s1_mdf',
      totalUnits: 42,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 1200,
      x: 1000,
      y: 40,
      slots: {
        42: odfMdf.id,
        40: ppMdf.id,
        38: fwAsset.id,
        36: coreAsset.id,
        34: swF1Asset.id,
        24: srvAsset.id,
        20: nvrAsset.id,
        1: upsMdfAsset.id
      },
      rearSlots: {
        10: pduMdf.id
      }
    },
    {
      id: 'rack_sample_idf2',
      name: 'Rack IDF-F2 (27U - Tầng 2)',
      buildingId,
      floorId: 'flr_sample_2',
      roomId: 'rm_s2_sales',
      totalUnits: 27,
      widthMm: 600,
      depthMm: 800,
      maxLoadKg: 800,
      x: 1360,
      y: 40,
      slots: {
        26: odfIdf2.id,
        24: ppIdf2.id,
        22: swF2Asset.id,
        1: upsIdf2Asset.id
      }
    },
    {
      id: 'rack_sample_idf3',
      name: 'Rack IDF-F3 (18U - Tầng 3)',
      buildingId,
      floorId: 'flr_sample_3',
      roomId: 'rm_s3_rnd',
      totalUnits: 18,
      widthMm: 600,
      depthMm: 800,
      maxLoadKg: 600,
      x: 1360,
      y: 530,
      slots: {
        17: odfIdf3.id,
        15: ppIdf3.id,
        13: swF3Asset.id
      }
    }
  ];

  nodes.push(
    {
      id: 'node_rack_sample_mdf',
      diagramMode: 'rack',
      floorId: 'flr_sample_1',
      type: 'rack',
      label: racks[0].name,
      x: 1000,
      y: 40,
      width: 320,
      height: 640,
      rotation: 0,
      style: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 3, borderStyle: 'solid', opacity: 1, textColor: '#f8fafc' },
      customData: { rackId: racks[0].id, totalUnits: 42 }
    },
    {
      id: 'node_rack_sample_idf2',
      diagramMode: 'rack',
      floorId: 'flr_sample_2',
      type: 'rack',
      label: racks[1].name,
      x: 1360,
      y: 40,
      width: 320,
      height: 460,
      rotation: 0,
      style: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 3, borderStyle: 'solid', opacity: 1, textColor: '#f8fafc' },
      customData: { rackId: racks[1].id, totalUnits: 27 }
    },
    {
      id: 'node_rack_sample_idf3',
      diagramMode: 'rack',
      floorId: 'flr_sample_3',
      type: 'rack',
      label: racks[2].name,
      x: 1360,
      y: 530,
      width: 320,
      height: 330,
      rotation: 0,
      style: { backgroundColor: '#0f172a', borderColor: '#334155', borderWidth: 3, borderStyle: 'solid', opacity: 1, textColor: '#f8fafc' },
      customData: { rackId: racks[2].id, totalUnits: 18 }
    }
  );

  // 12. Cabling across WAN, Spine, Vertical Fiber Risers, and PoE/LAN Endpoints
  cables.push(
    {
      id: 'cab_s_wan_fw',
      cableCode: 'WAN-FTTH-01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_cloud',
      sourcePortId: 'port_2',
      targetNodeId: 'node_sample_fw',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#dc2626',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 3,
      lengthMeters: 8,
      status: 'active'
    },
    {
      id: 'cab_s_fw_core',
      cableCode: 'DAC-FW-CORE',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_fw',
      sourcePortId: 'port_4',
      targetNodeId: 'node_sample_core',
      targetPortId: 'port_5',
      cableType: 'DAC_10G',
      bandwidth: '10G',
      color: '#0284c7',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 3,
      lengthMeters: 1.5,
      vlan: '10, 20, 30, 40, 50',
      status: 'active'
    },
    {
      id: 'cab_s_core_srv',
      cableCode: 'DAC-CORE-ERP',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_core',
      sourcePortId: 'port_6',
      targetNodeId: 'node_sample_srv',
      targetPortId: 'port_2',
      cableType: 'DAC_10G',
      bandwidth: '10G',
      color: '#475569',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 3,
      lengthMeters: 2,
      vlan: '50',
      status: 'active'
    },
    {
      id: 'cab_s_core_f1',
      cableCode: 'DAC-MDF-FL1',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_core',
      sourcePortId: 'port_7',
      targetNodeId: 'node_sample_sw_f1',
      targetPortId: 'port_25',
      cableType: 'DAC_10G',
      bandwidth: '10G',
      color: '#0ea5e9',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 3,
      lengthMeters: 2,
      vlan: '10, 20, 30, 40',
      status: 'active'
    },
    {
      id: 'cab_s_core_f2',
      cableCode: 'FO-RISER-FL2',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_core',
      sourcePortId: 'port_8',
      targetNodeId: 'node_sample_sw_f2',
      targetPortId: 'port_25',
      cableType: 'FIBER_MM_OM4',
      bandwidth: '10G',
      color: '#f59e0b',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 3,
      lengthMeters: 28,
      vlan: '10, 20, 30',
      status: 'active'
    },
    {
      id: 'cab_s_core_f3',
      cableCode: 'FO-RISER-FL3',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_core',
      sourcePortId: 'port_9',
      targetNodeId: 'node_sample_sw_f3',
      targetPortId: 'port_25',
      cableType: 'FIBER_MM_OM4',
      bandwidth: '10G',
      color: '#f59e0b',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 3,
      lengthMeters: 42,
      vlan: '10, 20, 30, 40',
      status: 'active'
    },
    // Floor 1 access connections
    {
      id: 'cab_s_f1_ap',
      cableCode: 'CAT6-F1-AP01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f1',
      sourcePortId: 'port_1',
      targetNodeId: 'node_sample_ap_f1',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#10b981',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 24,
      vlan: '30',
      status: 'active'
    },
    {
      id: 'cab_s_f1_cam',
      cableCode: 'CAT6-F1-CAM01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f1',
      sourcePortId: 'port_2',
      targetNodeId: 'node_sample_cam_f1',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#f59e0b',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 31,
      vlan: '40',
      status: 'active'
    },
    {
      id: 'cab_s_f1_nvr',
      cableCode: 'CAT6-F1-NVR01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f1',
      sourcePortId: 'port_3',
      targetNodeId: 'node_sample_nvr',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#d97706',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 3,
      vlan: '40',
      status: 'active'
    },
    {
      id: 'cab_s_f1_ups',
      cableCode: 'MGMT-F1-UPS01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f1',
      sourcePortId: 'port_4',
      targetNodeId: 'node_sample_ups_mdf',
      targetPortId: 'port_4',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#2563eb',
      routingType: 'orthogonal',
      lineStyle: 'dashed',
      strokeWidth: 2,
      lengthMeters: 3,
      vlan: '10',
      status: 'active'
    },
    // Floor 2 access connections
    {
      id: 'cab_s_f2_ap',
      cableCode: 'CAT6-F2-AP01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f2',
      sourcePortId: 'port_1',
      targetNodeId: 'node_sample_ap_f2',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#10b981',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 22,
      vlan: '30',
      status: 'active'
    },
    {
      id: 'cab_s_f2_pc',
      cableCode: 'CAT6-F2-WS01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f2',
      sourcePortId: 'port_2',
      targetNodeId: 'node_sample_pc_f2',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0ea5e9',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 18,
      vlan: '20',
      status: 'active'
    },
    {
      id: 'cab_s_f2_ups',
      cableCode: 'MGMT-F2-UPS02',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f2',
      sourcePortId: 'port_3',
      targetNodeId: 'node_sample_ups_idf2',
      targetPortId: 'port_4',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#2563eb',
      routingType: 'orthogonal',
      lineStyle: 'dashed',
      strokeWidth: 2,
      lengthMeters: 2.5,
      vlan: '10',
      status: 'active'
    },
    // Floor 3 access connections
    {
      id: 'cab_s_f3_ap',
      cableCode: 'CAT6-F3-AP01',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f3',
      sourcePortId: 'port_1',
      targetNodeId: 'node_sample_ap_f3',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#10b981',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 25,
      vlan: '30',
      status: 'active'
    },
    {
      id: 'cab_s_f3_cam',
      cableCode: 'CAT6-F3-CAM02',
      diagramMode: 'topology',
      sourceNodeId: 'node_sample_sw_f3',
      sourcePortId: 'port_2',
      targetNodeId: 'node_sample_cam_f3',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#f59e0b',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 29,
      vlan: '40',
      status: 'active'
    }
  );

  const patchLinks: PatchLink[] = [
    {
      id: 'pl_sample_1',
      patchPanelAssetId: ppMdf.id,
      patchPort: 'Port 01',
      targetDeviceName: 'AP-F1-LOBBY',
      targetPort: 'Eth0_PoE',
      cableCode: 'CAT6-F1-AP01',
      roomName: 'Sảnh Lễ tân & An ninh (Tầng 1)',
      vlan: '30',
      notes: 'Cổng PoE+ Gi1/0/1 trên SW-ACC-FL1'
    },
    {
      id: 'pl_sample_2',
      patchPanelAssetId: ppMdf.id,
      patchPort: 'Port 02',
      targetDeviceName: 'CAM-F1-GATE',
      targetPort: 'RJ45_PoE',
      cableCode: 'CAT6-F1-CAM01',
      roomName: 'Sảnh Lễ tân & An ninh (Tầng 1)',
      vlan: '40',
      notes: 'Camera cửa chính Tầng 1'
    },
    {
      id: 'pl_sample_3',
      patchPanelAssetId: ppIdf2.id,
      patchPort: 'Port 01',
      targetDeviceName: 'AP-F2-SALES',
      targetPort: 'Eth0_PoE',
      cableCode: 'CAT6-F2-AP01',
      roomName: 'Phòng Kinh doanh & Tủ IDF Tầng 2',
      vlan: '30',
      notes: 'Wi-Fi 6 khu vực Kinh doanh'
    },
    {
      id: 'pl_sample_4',
      patchPanelAssetId: ppIdf3.id,
      patchPort: 'Port 01',
      targetDeviceName: 'AP-F3-ENG',
      targetPort: 'Eth0_PoE',
      cableCode: 'CAT6-F3-AP01',
      roomName: 'Phòng Kỹ thuật R&D & Tủ IDF Tầng 3',
      vlan: '30',
      notes: 'Wi-Fi 6 khu vực Kỹ thuật R&D'
    }
  ];

  const syncedAssets = syncSampleProjectPorts(assets, nodes, cables);

  return {
    id: 'proj_sample_office_3f',
    name: 'Dự án mẫu: Văn phòng 3 Tầng (Mạng + Rack + IP Subnet)',
    author: 'HACHIHI Sample Architect',
    version: '3.1.0',
    lastModified: new Date().toISOString(),
    buildings: [building],
    floors,
    rooms,
    racks,
    assets: syncedAssets,
    nodes,
    cables,
    vlans,
    subnets,
    patchLinks,
    activeMode: 'topology',
    activeBuildingId: buildingId,
    activeFloorId: 'flr_sample_1',
    settings: {
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      showGrid: true,
      showPortLabels: true,
      showIpAddresses: true,
      showCableCodes: true,
      showCoverageRadius: true,
      unit: 'm',
      scale: 25,
      backgroundColor: '#f8fafc',
      isDarkMode: false,
      ipRangeStart: '10.10.10.10',
      ipRangeEnd: '10.10.10.250',
      ipSubnetMask: '255.255.255.0',
      ipGateway: '10.10.10.1'
    }
  };
}
