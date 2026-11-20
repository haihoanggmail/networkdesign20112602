import {
  Building,
  CableEdge,
  CableTray,
  DeviceAsset,
  DevicePort,
  DiagramNode,
  Floor,
  PatchLink,
  ProjectState,
  Room,
  ServerRack,
  SubnetSpec,
  VlanSpec
} from '../types/infrastructure';
import { DEVICE_CATALOG, createDeviceAssetFromPreset } from './deviceCatalog';
import { getCanvasRackHeight } from '../utils/rackGeometry';

function syncPortStatuses(
  assets: Record<string, DeviceAsset>,
  nodes: DiagramNode[],
  cables: CableEdge[]
): Record<string, DeviceAsset> {
  const next: Record<string, DeviceAsset> = {};
  for (const [id, a] of Object.entries(assets)) {
    next[id] = {
      ...a,
      ports: (a.ports || []).map(p => ({ ...p, status: 'unlinked' as const, connectedTarget: undefined }))
    };
  }
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  for (const c of cables) {
    const srcNode = nodeMap.get(c.sourceNodeId);
    const tgtNode = nodeMap.get(c.targetNodeId);
    const srcAsset = srcNode?.assetId ? next[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? next[tgtNode.assetId] : undefined;
    if (srcAsset && c.sourcePortId) {
      srcAsset.ports = srcAsset.ports.map(p =>
        p.id === c.sourcePortId
          ? {
              ...p,
              status: 'up' as const,
              connectedCableId: c.id,
              connectedTarget: tgtAsset
                ? { deviceId: tgtAsset.id, portId: c.targetPortId || 'Auto', cableType: c.cableType }
                : undefined
            }
          : p
      );
    }
    if (tgtAsset && c.targetPortId) {
      tgtAsset.ports = tgtAsset.ports.map(p =>
        p.id === c.targetPortId
          ? {
              ...p,
              status: 'up' as const,
              connectedCableId: c.id,
              connectedTarget: srcAsset
                ? { deviceId: srcAsset.id, portId: c.sourcePortId || 'Auto', cableType: c.cableType }
                : undefined
            }
          : p
      );
    }
  }
  return next;
}

export function createHachihi2BuildingProject(): ProjectState {
  const buildingId = 'bld_hachihi2';
  const building: Building = {
    id: buildingId,
    name: 'Tòa nhà HACHIHI 2',
    totalFloors: 6, // G + Tầng 1..5
    basementFloors: 1, // B1
    widthMeters: 44,
    depthMeters: 24,
    floorHeightMeters: 3.6,
    wallThicknessMm: 200,
    layoutStyle: 'rectangle'
  };

  const floors: Floor[] = [
    {
      id: 'flr_h2_5',
      buildingId,
      level: 5,
      name: 'Tầng 5 - Ban Giám Đốc & Điều Hành',
      description: 'Phòng Chủ tịch, Phòng họp Hội đồng, Small Rack 12U T5',
      widthMeters: 44,
      depthMeters: 24
    },
    {
      id: 'flr_h2_4',
      buildingId,
      level: 4,
      name: 'Tầng 4 - Phòng Server (Main Rack 42U) & NOC',
      description: 'Trung tâm dữ liệu Main Rack 42U, Trục Riser chính, Phòng NOC Kỹ thuật',
      widthMeters: 44,
      depthMeters: 24
    },
    {
      id: 'flr_h2_3',
      buildingId,
      level: 3,
      name: 'Tầng 3 - Khối Tài Chính & Nhân Sự',
      description: 'Kế toán, Nhân sự, Small Rack 12U T3, Máy chấm công',
      widthMeters: 44,
      depthMeters: 24
    },
    {
      id: 'flr_h2_2',
      buildingId,
      level: 2,
      name: 'Tầng 2 - Khối Kinh Doanh & Marketing',
      description: 'Khu làm việc mở Sales/Marketing, Small Rack 12U T2',
      widthMeters: 44,
      depthMeters: 24
    },
    {
      id: 'flr_h2_1',
      buildingId,
      level: 1,
      name: 'Tầng 1 - Khối Vận Hành & CSKH',
      description: 'Văn phòng Vận hành, Hỗ trợ khách hàng, Small Rack 12U T1',
      widthMeters: 44,
      depthMeters: 24
    },
    {
      id: 'flr_h2_g',
      buildingId,
      level: 0,
      name: 'Tầng G (Trệt) - Sảnh Lễ Tân, Thang Máy & Chấm Công',
      description: 'Sảnh chính, Thang máy kính trung tâm, Máy chấm công & Small Rack 12U G',
      widthMeters: 44,
      depthMeters: 24
    },
    {
      id: 'flr_h2_b1',
      buildingId,
      level: -1,
      name: 'Tầng Hầm (B1) - Bãi Đỗ Xe & Cổng Ra Vào Chính',
      description: 'Ô đậu xe 1 & 2, Cổng kiểm soát ra vào chính, Camera giám sát hầm & Small Rack 12U B1',
      widthMeters: 44,
      depthMeters: 24
    }
  ];

  const vlans: VlanSpec[] = [
    { id: 'vlan_h2_10', vlanId: 10, name: 'MGMT-CORE', purpose: 'Quản trị Switch, Router, Firewall, UPS & PDU', color: '#2563eb' },
    { id: 'vlan_h2_20', vlanId: 20, name: 'CORP-WORKSTATION', purpose: 'Máy trạm PC & Điện thoại bàn văn phòng các tầng', color: '#0ea5e9' },
    { id: 'vlan_h2_30', vlanId: 30, name: 'WIFI-CORP', purpose: 'Hệ thống Access Point Wi-Fi 6 toàn tòa nhà', color: '#10b981' },
    { id: 'vlan_h2_40', vlanId: 40, name: 'CCTV-SECURITY', purpose: 'Camera IP giám sát các tầng, tầng hầm, cổng & NVR', color: '#f59e0b' },
    { id: 'vlan_h2_50', vlanId: 50, name: 'SERVER-SAN', purpose: 'Cụm máy chủ ứng dụng, Database & SAN tại Tầng 4', color: '#475569' },
    { id: 'vlan_h2_60', vlanId: 60, name: 'ACCESS-ATTENDANCE', purpose: 'Máy chấm công vân tay/khuôn mặt & kiểm soát thang máy', color: '#059669' }
  ];

  const subnets: SubnetSpec[] = [
    { id: 'sub_h2_10', name: 'MGMT & Core Network', cidr: '10.20.10.0/24', vlanId: 10, gateway: '10.20.10.1', dnsServers: '10.20.50.11, 8.8.8.8' },
    { id: 'sub_h2_20', name: 'Văn phòng & Máy trạm', cidr: '10.20.20.0/24', vlanId: 20, gateway: '10.20.20.1', dhcpRange: '10.20.20.50 - 10.20.20.240' },
    { id: 'sub_h2_30', name: 'Wi-Fi 6 Doanh nghiệp', cidr: '10.20.30.0/24', vlanId: 30, gateway: '10.20.30.1', dhcpRange: '10.20.30.50 - 10.20.30.240' },
    { id: 'sub_h2_40', name: 'CCTV An ninh & NVR', cidr: '10.20.40.0/24', vlanId: 40, gateway: '10.20.40.1' },
    { id: 'sub_h2_50', name: 'Server Farm Tầng 4', cidr: '10.20.50.0/24', vlanId: 50, gateway: '10.20.50.1' },
    { id: 'sub_h2_60', name: 'Chấm công & Cổng vào', cidr: '10.20.60.0/24', vlanId: 60, gateway: '10.20.60.1' }
  ];

  const corePreset = DEVICE_CATALOG.find(d => d.category === 'core_switch')!;
  const swPreset = DEVICE_CATALOG.find(d => d.name.includes('Ruijie 24P PoE+')) || DEVICE_CATALOG.find(d => d.category === 'switch')!;
  const fwPreset = DEVICE_CATALOG.find(d => d.category === 'firewall')!;
  const rtrPreset = DEVICE_CATALOG.find(d => d.category === 'router')!;
  const srvPreset = DEVICE_CATALOG.find(d => d.category === 'server')!;
  const sanPreset = DEVICE_CATALOG.find(d => d.category === 'storage')!;
  const nvrPreset = DEVICE_CATALOG.find(d => d.category === 'nvr')!;
  const apPreset = DEVICE_CATALOG.find(d => d.category === 'ap')!;
  const camPreset = DEVICE_CATALOG.find(d => d.category === 'camera')!;
  const iotPreset = DEVICE_CATALOG.find(d => d.category === 'iot')!;
  const odfPreset = DEVICE_CATALOG.find(d => d.category === 'odf')!;
  const ppPreset = DEVICE_CATALOG.find(d => d.category === 'patch_panel')!;
  const pduPreset = DEVICE_CATALOG.find(d => d.category === 'pdu')!;
  const upsVertivPreset = DEVICE_CATALOG.find(d => d.name.includes('Vertiv')) || DEVICE_CATALOG.find(d => d.category === 'ups')!;
  const upsApcPreset = DEVICE_CATALOG.find(d => d.name.includes('APC') || d.category === 'ups')!;
  const riserPreset = DEVICE_CATALOG.find(d => d.category === 'telecom_tower')!;

  const rooms: Room[] = [];
  const cableTrays: CableTray[] = [];
  const racks: ServerRack[] = [];
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];
  const patchLinks: PatchLink[] = [];

  let assetIdx = 1;
  const riserNodeIdByFloor: Record<string, string> = {};
  const floorSwitchNodeByFloor: Record<string, string> = {};
  const floorTagById: Record<string, string> = {
    flr_h2_b1: 'B1',
    flr_h2_g: 'G',
    flr_h2_1: 'T1',
    flr_h2_2: 'T2',
    flr_h2_3: 'T3',
    flr_h2_4: 'T4',
    flr_h2_5: 'T5'
  };

  const makeWorkstationAsset = (
    id: string,
    name: string,
    ip: string,
    floorId: string,
    roomId: string
  ): DeviceAsset => {
    const idx = assetIdx++;
    const tag = String(idx).padStart(4, '0');
    const a: DeviceAsset = {
      id,
      name,
      category: 'workstation',
      vendor: 'Dell / HP',
      model: 'OptiPlex 7010 Tower',
      assetTag: `H2-WS-${tag}`,
      serialNumber: `H2WS${tag}`,
      ipAddress: ip,
      subnetMask: '255.255.255.0',
      gateway: '10.20.20.1',
      macAddress: `00:2B:4C:20:${tag.slice(0, 2)}:${tag.slice(2, 4)}`,
      vlan: '20',
      status: 'online',
      powerWatts: 120,
      weightKg: 7.5,
      poeEnabled: false,
      buildingId,
      floorId,
      roomId,
      ports: [
        { id: 'port_1', name: 'GbE_LAN', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked' }
      ]
    };
    assets[id] = a;
    return a;
  };

  const makeAttendanceAsset = (
    id: string,
    name: string,
    ip: string,
    floorId: string,
    roomId: string
  ): DeviceAsset => {
    const a = createDeviceAssetFromPreset(iotPreset, assetIdx++);
    a.id = id;
    a.name = name;
    a.vendor = 'ZKTeco / HACHIHI';
    a.model = 'SpeedFace-V5L-PoE';
    a.ipAddress = ip;
    a.subnetMask = '255.255.255.0';
    a.gateway = '10.20.60.1';
    a.vlan = '60';
    a.powerWatts = 10;
    a.poeEnabled = true;
    a.poeWatts = 10;
    a.buildingId = buildingId;
    a.floorId = floorId;
    a.roomId = roomId;
    assets[id] = a;
    return a;
  };

  const makeRiserAsset = (id: string, name: string, floorId: string, roomId: string): DeviceAsset => {
    const a = createDeviceAssetFromPreset(riserPreset, assetIdx++);
    a.id = id;
    a.name = name;
    a.model = 'Trục Riser Quang-Đồng Đứng';
    a.ipAddress = '';
    a.subnetMask = '';
    a.gateway = '';
    a.vlan = '10, 20, 30, 40, 50, 60';
    a.powerWatts = 0;
    a.buildingId = buildingId;
    a.floorId = floorId;
    a.roomId = roomId;
    a.ports = [
      { id: 'port_1', name: 'Riser_Floor_Link', type: 'FIBER_LC', speed: '10 Gbps', status: 'unlinked' },
      { id: 'port_2', name: 'Riser_Trunk_Up', type: 'FIBER_LC', speed: '25 Gbps', status: 'unlinked' },
      { id: 'port_3', name: 'Riser_Trunk_Down', type: 'FIBER_LC', speed: '25 Gbps', status: 'unlinked' },
      { id: 'port_4', name: 'Riser_Backup', type: 'FIBER_LC', speed: '10 Gbps', status: 'unlinked' }
    ];
    assets[id] = a;
    return a;
  };

  // Ordered bottom -> top for clean numbering
  const orderedFloorSpecs: Array<{
    floorId: string;
    tag: string;
    octet: number;
    isBasement?: boolean;
    isServerFloor?: boolean;
    isGround?: boolean;
    zoneDTitle: string;
    zoneETitle: string;
  }> = [
    {
      floorId: 'flr_h2_b1',
      tag: 'B1',
      octet: 11,
      isBasement: true,
      zoneDTitle: 'Bãi Đỗ Xe Tầng Hầm - Ô Đậu Xe 1',
      zoneETitle: 'Bãi Đỗ Xe Tầng Hầm - Ô Đậu Xe 2'
    },
    {
      floorId: 'flr_h2_g',
      tag: 'G',
      octet: 12,
      isGround: true,
      zoneDTitle: 'Sảnh Lễ Tân & Tiếp Khách Tầng G',
      zoneETitle: 'Khu Văn Phòng Hỗ Trợ Tầng G'
    },
    {
      floorId: 'flr_h2_1',
      tag: 'T1',
      octet: 13,
      zoneDTitle: 'Văn Phòng Vận Hành Tầng 1',
      zoneETitle: 'Phòng Chăm Sóc Khách Hàng T1'
    },
    {
      floorId: 'flr_h2_2',
      tag: 'T2',
      octet: 14,
      zoneDTitle: 'Văn Phòng Kinh Doanh Tầng 2',
      zoneETitle: 'Phòng Marketing & Media T2'
    },
    {
      floorId: 'flr_h2_3',
      tag: 'T3',
      octet: 15,
      zoneDTitle: 'Văn Phòng Tài Chính Kế Toán T3',
      zoneETitle: 'Phòng Nhân Sự & Đào Tạo T3'
    },
    {
      floorId: 'flr_h2_4',
      tag: 'T4',
      octet: 16,
      isServerFloor: true,
      zoneDTitle: 'Phòng Điều Hành NOC & Kỹ Thuật T4',
      zoneETitle: 'Khu Lab Kiểm Thử & Bảo Trì T4'
    },
    {
      floorId: 'flr_h2_5',
      tag: 'T5',
      octet: 17,
      zoneDTitle: 'Văn Phòng Ban Giám Đốc Tầng 5',
      zoneETitle: 'Phòng Họp Hội Đồng Tầng 5'
    }
  ];

  // Build Floor 4 Main Server Core first so other floors link cleanly to it
  let coreNodeId = '';
  let coreSwitchAsset: DeviceAsset | null = null;
  let coreFreePortsQueue: string[] = [];

  for (const spec of orderedFloorSpecs) {
    const fId = spec.floorId;
    const tag = spec.tag;

    // 1. Rooms (Exact vertical footprint across all 7 floors: X 60..1280, Y 60..680)
    const stairRoomId = `rm_h2_${tag.toLowerCase()}_stair`;
    const rackRoomId = `rm_h2_${tag.toLowerCase()}_rack`;
    const lobbyLowerId = `rm_h2_${tag.toLowerCase()}_gate`;
    const elevRoomId = `rm_h2_${tag.toLowerCase()}_elev`;
    const zoneDRoomId = `rm_h2_${tag.toLowerCase()}_zoned`;
    const zoneERoomId = `rm_h2_${tag.toLowerCase()}_zonee`;

    rooms.push({
      id: stairRoomId,
      floorId: fId,
      name: `Cầu Thang Bộ & Mặt Kính (${tag})`,
      type: 'corridor',
      x: 60,
      y: 60,
      width: 140,
      height: 620,
      color: '#e2e8f0',
      wallThickness: 6
    });

    if (spec.isServerFloor) {
      rooms.push({
        id: rackRoomId,
        floorId: fId,
        name: 'Phòng Server - Main Rack Tầng 4 (42U)',
        type: 'server_room',
        x: 200,
        y: 60,
        width: 300,
        height: 620,
        color: '#dcfce7',
        wallThickness: 8
      });
    } else {
      rooms.push({
        id: rackRoomId,
        floorId: fId,
        name: `Khu Tủ Small Rack 12U & Trục Riser (${tag})`,
        type: 'utility_riser',
        x: 200,
        y: 60,
        width: 300,
        height: 360,
        color: '#dbeafe',
        wallThickness: 6
      });

      rooms.push({
        id: lobbyLowerId,
        floorId: fId,
        name: spec.isBasement ? 'Cổng Ra Vào Chính & Kiểm Soát An Ninh' : `Hành Lang Kỹ Thuật (${tag})`,
        type: spec.isBasement ? 'reception' : 'corridor',
        x: 200,
        y: 420,
        width: 300,
        height: 260,
        color: spec.isBasement ? '#fef3c7' : '#f1f5f9',
        wallThickness: 6
      });
    }

    rooms.push({
      id: elevRoomId,
      floorId: fId,
      name: `Thang Máy & Máy Chấm Công (${tag})`,
      type: 'reception',
      x: 500,
      y: 420,
      width: 200,
      height: 260,
      color: '#e0f2fe',
      wallThickness: 6
    });

    rooms.push({
      id: zoneDRoomId,
      floorId: fId,
      name: spec.zoneDTitle,
      type: spec.isBasement ? 'warehouse' : 'office',
      x: 500,
      y: 60,
      width: 780,
      height: 360,
      color: spec.isBasement ? '#f1f5f9' : '#f8fafc',
      wallThickness: 6
    });

    rooms.push({
      id: zoneERoomId,
      floorId: fId,
      name: spec.zoneETitle,
      type: spec.isBasement ? 'warehouse' : 'meeting',
      x: 700,
      y: 420,
      width: 580,
      height: 260,
      color: spec.isBasement ? '#e2e8f0' : '#f8fafc',
      wallThickness: 6
    });

    // 2. Horizontal & Branch Cable Trays per floor
    cableTrays.push(
      {
        id: `tray_h2_${tag}_main`,
        name: `Máng Cáp Mạng Trục Chính (${tag})`,
        floorId: fId,
        kind: 'network_tray',
        widthPx: 20,
        color: '#0284c7',
        points: [
          { x: 468, y: 188 },
          { x: 1185, y: 188 },
          { x: 1185, y: 560 }
        ]
      },
      {
        id: `tray_h2_${tag}_elev`,
        name: `Ống Luồn Sảnh Thang Máy (${tag})`,
        floorId: fId,
        kind: 'conduit',
        widthPx: 14,
        color: '#0d9488',
        points: [
          { x: 646, y: 188 },
          { x: 646, y: 548 }
        ]
      }
    );

    // 3. Riser Shaft Node on every floor (exact same X/Y for 3D vertical alignment)
    const riserNodeId = `node_h2_riser_${tag.toLowerCase()}`;
    riserNodeIdByFloor[fId] = riserNodeId;
    const riserAsset = makeRiserAsset(
      `ast_h2_riser_${tag.toLowerCase()}`,
      `Trục Riser ${tag}`,
      fId,
      rackRoomId
    );
    nodes.push({
      id: riserNodeId,
      diagramMode: 'floorplan',
      floorId: fId,
      type: 'riser',
      assetId: riserAsset.id,
      label: `Riser ${tag}`,
      x: 446,
      y: 160,
      width: 46,
      height: 56,
      rotation: 0,
      style: {
        backgroundColor: '#0284c7',
        borderColor: '#0369a1',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1,
        textColor: '#ffffff',
        iconColor: '#ffffff'
      }
    });

    // 4. Rack + Mounted Assets per floor
    if (spec.isServerFloor) {
      // TẦNG 4: MAIN RACK 42U
      const rackId = 'rack_h2_main_t4';
      const rackNodeId = 'node_h2_rack_t4';

      const odfMain = createDeviceAssetFromPreset(odfPreset, assetIdx++);
      odfMain.id = 'ast_h2_odf_t4';
      odfMain.name = 'ODF-MAIN-48F-T4';
      odfMain.ipAddress = '';
      odfMain.subnetMask = '';
      odfMain.gateway = '';
      odfMain.vlan = '';
      odfMain.buildingId = buildingId;
      odfMain.floorId = fId;
      odfMain.roomId = rackRoomId;
      odfMain.rackId = rackId;
      odfMain.rackUnitStart = 42;
      odfMain.rackUnitHeight = 1;
      assets[odfMain.id] = odfMain;

      const ppMain = createDeviceAssetFromPreset(ppPreset, assetIdx++);
      ppMain.id = 'ast_h2_pp_t4';
      ppMain.name = 'PP-MAIN-48P-T4';
      ppMain.ipAddress = '';
      ppMain.subnetMask = '';
      ppMain.gateway = '';
      ppMain.vlan = '';
      ppMain.buildingId = buildingId;
      ppMain.floorId = fId;
      ppMain.roomId = rackRoomId;
      ppMain.rackId = rackId;
      ppMain.rackUnitStart = 40;
      ppMain.rackUnitHeight = 1;
      assets[ppMain.id] = ppMain;

      const coreSw = createDeviceAssetFromPreset(corePreset, assetIdx++);
      coreSw.id = 'ast_h2_core_t4';
      coreSw.name = 'CORE-SW-T4';
      coreSw.ipAddress = '10.20.10.2';
      coreSw.subnetMask = '255.255.255.0';
      coreSw.gateway = '10.20.10.1';
      coreSw.vlan = '10, 20, 30, 40, 50, 60';
      coreSw.powerWatts = 180;
      coreSw.buildingId = buildingId;
      coreSw.floorId = fId;
      coreSw.roomId = rackRoomId;
      coreSw.rackId = rackId;
      coreSw.rackUnitStart = 38;
      coreSw.rackUnitHeight = 1;
      coreSw.ports = Array.from({ length: 12 }, (_, i): DevicePort => ({
        id: `port_${i + 1}`,
        name: i < 4 ? `QSFP_${i + 1}` : `SFP+_${i - 3}`,
        type: i < 4 ? 'QSFP28_100G' : 'SFP_PLUS_10G',
        speed: i < 4 ? '100 Gbps' : '10 Gbps',
        status: 'unlinked'
      }));
      assets[coreSw.id] = coreSw;
      coreSwitchAsset = coreSw;
      coreFreePortsQueue = ['port_5', 'port_6', 'port_7', 'port_8', 'port_9', 'port_10', 'port_11', 'port_12'];

      const fwMain = createDeviceAssetFromPreset(fwPreset, assetIdx++);
      fwMain.id = 'ast_h2_fw_t4';
      fwMain.name = 'FW-FORTIGATE-T4';
      fwMain.ipAddress = '10.20.10.1';
      fwMain.subnetMask = '255.255.255.0';
      fwMain.gateway = '10.20.10.1';
      fwMain.vlan = '10, 20, 30, 40, 50, 60';
      fwMain.powerWatts = 120;
      fwMain.buildingId = buildingId;
      fwMain.floorId = fId;
      fwMain.roomId = rackRoomId;
      fwMain.rackId = rackId;
      fwMain.rackUnitStart = 36;
      fwMain.rackUnitHeight = 1;
      assets[fwMain.id] = fwMain;

      const rtrMain = createDeviceAssetFromPreset(rtrPreset, assetIdx++);
      rtrMain.id = 'ast_h2_rtr_t4';
      rtrMain.name = 'RTR-WAN-EDGE-T4';
      rtrMain.ipAddress = '10.20.10.3';
      rtrMain.subnetMask = '255.255.255.0';
      rtrMain.gateway = '10.20.10.1';
      rtrMain.vlan = '10';
      rtrMain.powerWatts = 80;
      rtrMain.buildingId = buildingId;
      rtrMain.floorId = fId;
      rtrMain.roomId = rackRoomId;
      rtrMain.rackId = rackId;
      rtrMain.rackUnitStart = 34;
      rtrMain.rackUnitHeight = 1;
      assets[rtrMain.id] = rtrMain;

      const swT4 = createDeviceAssetFromPreset(swPreset, assetIdx++);
      swT4.id = 'ast_h2_sw_t4';
      swT4.name = 'SW-POE-T4';
      swT4.ipAddress = '10.20.10.16';
      swT4.subnetMask = '255.255.255.0';
      swT4.gateway = '10.20.10.1';
      swT4.vlan = '10, 20, 30, 40, 50, 60';
      swT4.powerWatts = 160;
      swT4.poeBudgetWatts = 370;
      swT4.buildingId = buildingId;
      swT4.floorId = fId;
      swT4.roomId = rackRoomId;
      swT4.rackId = rackId;
      swT4.rackUnitStart = 32;
      swT4.rackUnitHeight = 1;
      if (swT4.ports[1]) {
        swT4.ports[1] = { ...swT4.ports[1], type: 'RJ45_10G', speed: '2.5 Gbps', poe: true };
      }
      assets[swT4.id] = swT4;

      const nvrMain = createDeviceAssetFromPreset(nvrPreset, assetIdx++);
      nvrMain.id = 'ast_h2_nvr_t4';
      nvrMain.name = 'NVR-MAIN-32CH';
      nvrMain.ipAddress = '10.20.40.10';
      nvrMain.subnetMask = '255.255.255.0';
      nvrMain.gateway = '10.20.40.1';
      nvrMain.vlan = '40';
      nvrMain.powerWatts = 180;
      nvrMain.poeBudgetWatts = 0; // Cameras powered by floor PoE switches
      nvrMain.buildingId = buildingId;
      nvrMain.floorId = fId;
      nvrMain.roomId = rackRoomId;
      nvrMain.rackId = rackId;
      nvrMain.rackUnitStart = 28;
      nvrMain.rackUnitHeight = 1;
      assets[nvrMain.id] = nvrMain;

      const srv1 = createDeviceAssetFromPreset(srvPreset, assetIdx++);
      srv1.id = 'ast_h2_srv_01';
      srv1.name = 'SRV-CHASSIS-01';
      srv1.ipAddress = '10.20.50.11';
      srv1.subnetMask = '255.255.255.0';
      srv1.gateway = '10.20.50.1';
      srv1.vlan = '50';
      srv1.powerWatts = 420;
      srv1.buildingId = buildingId;
      srv1.floorId = fId;
      srv1.roomId = rackRoomId;
      srv1.rackId = rackId;
      srv1.rackUnitStart = 24;
      srv1.rackUnitHeight = 2;
      assets[srv1.id] = srv1;

      const srv2 = createDeviceAssetFromPreset(srvPreset, assetIdx++);
      srv2.id = 'ast_h2_srv_02';
      srv2.name = 'SRV-DB-02';
      srv2.ipAddress = '10.20.50.12';
      srv2.subnetMask = '255.255.255.0';
      srv2.gateway = '10.20.50.1';
      srv2.vlan = '50';
      srv2.powerWatts = 420;
      srv2.buildingId = buildingId;
      srv2.floorId = fId;
      srv2.roomId = rackRoomId;
      srv2.rackId = rackId;
      srv2.rackUnitStart = 20;
      srv2.rackUnitHeight = 2;
      assets[srv2.id] = srv2;

      const sanMain = createDeviceAssetFromPreset(sanPreset, assetIdx++);
      sanMain.id = 'ast_h2_san_01';
      sanMain.name = 'SAN-STORAGE-01';
      sanMain.ipAddress = '10.20.50.20';
      sanMain.subnetMask = '255.255.255.0';
      sanMain.gateway = '10.20.50.1';
      sanMain.vlan = '50';
      sanMain.powerWatts = 340;
      sanMain.buildingId = buildingId;
      sanMain.floorId = fId;
      sanMain.roomId = rackRoomId;
      sanMain.rackId = rackId;
      sanMain.rackUnitStart = 16;
      sanMain.rackUnitHeight = 2;
      assets[sanMain.id] = sanMain;

      const pduMain = createDeviceAssetFromPreset(pduPreset, assetIdx++);
      pduMain.id = 'ast_h2_pdu_t4';
      pduMain.name = 'PDU-MAIN-T4';
      pduMain.ipAddress = '10.20.10.30';
      pduMain.subnetMask = '255.255.255.0';
      pduMain.gateway = '10.20.10.1';
      pduMain.vlan = '10';
      pduMain.powerWatts = 15;
      pduMain.buildingId = buildingId;
      pduMain.floorId = fId;
      pduMain.roomId = rackRoomId;
      pduMain.rackId = rackId;
      pduMain.rackUnitStart = 10;
      pduMain.rackUnitHeight = 1;
      pduMain.rackSide = 'rear';
      assets[pduMain.id] = pduMain;

      const upsB = createDeviceAssetFromPreset(upsApcPreset, assetIdx++);
      upsB.id = 'ast_h2_ups_b';
      upsB.name = 'UPS-MAIN-B-3kVA';
      upsB.ipAddress = '10.20.10.42';
      upsB.subnetMask = '255.255.255.0';
      upsB.gateway = '10.20.10.1';
      upsB.vlan = '10';
      upsB.powerWatts = 2700;
      upsB.upsSpecs = {
        ratedVa: 3000,
        batteryAh: 9,
        batteryVoltageV: 12,
        batteryCount: 8,
        inverterEfficiency: 0.85,
        dodFactor: 0.8
      };
      upsB.buildingId = buildingId;
      upsB.floorId = fId;
      upsB.roomId = rackRoomId;
      upsB.rackId = rackId;
      upsB.rackUnitStart = 4;
      upsB.rackUnitHeight = 2;
      assets[upsB.id] = upsB;

      const upsA = createDeviceAssetFromPreset(upsVertivPreset, assetIdx++);
      upsA.id = 'ast_h2_ups_a';
      upsA.name = 'UPS-MAIN-A-6kVA';
      upsA.ipAddress = '10.20.10.41';
      upsA.subnetMask = '255.255.255.0';
      upsA.gateway = '10.20.10.1';
      upsA.vlan = '10';
      upsA.powerWatts = 5400;
      upsA.upsSpecs = {
        ratedVa: 6000,
        batteryAh: 9,
        batteryVoltageV: 12,
        batteryCount: 16,
        inverterEfficiency: 0.88,
        dodFactor: 0.8
      };
      upsA.buildingId = buildingId;
      upsA.floorId = fId;
      upsA.roomId = rackRoomId;
      upsA.rackId = rackId;
      upsA.rackUnitStart = 1;
      upsA.rackUnitHeight = 2;
      assets[upsA.id] = upsA;

      racks.push({
        id: rackId,
        name: 'Main Rack Tầng 4 (42U)',
        buildingId,
        floorId: fId,
        roomId: rackRoomId,
        totalUnits: 42,
        widthMm: 800,
        depthMm: 1000,
        maxLoadKg: 1200,
        x: 215,
        y: 92,
        slots: {
          42: odfMain.id,
          40: ppMain.id,
          38: coreSw.id,
          36: fwMain.id,
          34: rtrMain.id,
          32: swT4.id,
          28: nvrMain.id,
          24: srv1.id,
          20: srv2.id,
          16: sanMain.id,
          4: upsB.id,
          1: upsA.id
        },
        rearSlots: {
          10: pduMain.id
        }
      });

      nodes.push({
        id: rackNodeId,
        diagramMode: 'floorplan',
        floorId: fId,
        type: 'rack',
        label: 'Main Rack Tầng 4 (42U)',
        x: 215,
        y: 92,
        width: 222,
        height: 556,
        rotation: 0,
        style: {
          backgroundColor: '#0f172a',
          borderColor: '#334155',
          borderWidth: 3,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#f8fafc'
        },
        customData: { rackId, totalUnits: 42 }
      });

      // Hidden topology node representations for U-slot cable anchoring + PoE breakdown
      coreNodeId = 'node_h2_core_t4';
      const swT4NodeId = 'node_h2_sw_t4';
      floorSwitchNodeByFloor[fId] = swT4NodeId;

      nodes.push(
        {
          id: coreNodeId,
          diagramMode: 'topology',
          floorId: fId,
          type: 'device',
          assetId: coreSw.id,
          label: coreSw.name,
          x: 680,
          y: 180,
          width: 170,
          height: 58,
          rotation: 0,
          style: { backgroundColor: '#0284c7', borderColor: '#0369a1', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
        },
        {
          id: swT4NodeId,
          diagramMode: 'topology',
          floorId: fId,
          type: 'device',
          assetId: swT4.id,
          label: swT4.name,
          x: 680,
          y: 280,
          width: 165,
          height: 56,
          rotation: 0,
          style: { backgroundColor: '#0ea5e9', borderColor: '#0284c7', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
        }
      );

      // Core -> SW-T4 + Core -> Riser-T4
      cables.push(
        {
          id: 'cab_h2_core_swt4',
          cableCode: 'DAC-CORE-SWT4',
          diagramMode: 'floorplan',
          sourceNodeId: coreNodeId,
          sourcePortId: 'port_5',
          targetNodeId: swT4NodeId,
          targetPortId: 'port_25',
          cableType: 'DAC_10G',
          bandwidth: '10G',
          color: '#0284c7',
          routingType: 'straight',
          lineStyle: 'solid',
          strokeWidth: 3,
          lengthMeters: 1.5,
          vlan: '10, 20, 30, 40, 50, 60',
          status: 'active',
          label: '10G DAC'
        },
        {
          id: 'cab_h2_core_riser_t4',
          cableCode: 'FO-CORE-RISER-T4',
          diagramMode: 'floorplan',
          sourceNodeId: coreNodeId,
          sourcePortId: 'port_6',
          targetNodeId: riserNodeId,
          targetPortId: 'port_1',
          cableType: 'FIBER_SM_OS2',
          bandwidth: '10G',
          color: '#0284c7',
          routingType: 'orthogonal',
          lineStyle: 'solid',
          strokeWidth: 3.5,
          lengthMeters: 4,
          vlan: '10, 20, 30, 40, 50, 60',
          status: 'active',
          label: '25G Backbone'
        }
      );

      patchLinks.push({
        id: 'pl_h2_t4_1',
        patchPanelAssetId: ppMain.id,
        patchPort: 'Port 01',
        targetDeviceName: 'WS-NOC-T4-01',
        targetPort: 'GbE_LAN',
        cableCode: 'CAT6-T4-WS01',
        roomName: spec.zoneDTitle,
        vlan: '20',
        notes: 'Cổng mạng phòng điều hành NOC Tầng 4'
      });
    } else {
      // B1, G, 1, 2, 3, 5: SMALL RACK 12U
      const rackId = `rack_h2_${tag.toLowerCase()}`;
      const rackNodeId = `node_h2_rack_${tag.toLowerCase()}`;

      const odfFx = createDeviceAssetFromPreset(odfPreset, assetIdx++);
      odfFx.id = `ast_h2_odf_${tag.toLowerCase()}`;
      odfFx.name = `ODF-${tag}-12F`;
      odfFx.ipAddress = '';
      odfFx.subnetMask = '';
      odfFx.gateway = '';
      odfFx.vlan = '';
      odfFx.buildingId = buildingId;
      odfFx.floorId = fId;
      odfFx.roomId = rackRoomId;
      odfFx.rackId = rackId;
      odfFx.rackUnitStart = 12;
      odfFx.rackUnitHeight = 1;
      assets[odfFx.id] = odfFx;

      const ppFx = createDeviceAssetFromPreset(ppPreset, assetIdx++);
      ppFx.id = `ast_h2_pp_${tag.toLowerCase()}`;
      ppFx.name = `PP-${tag}-24P`;
      ppFx.ipAddress = '';
      ppFx.subnetMask = '';
      ppFx.gateway = '';
      ppFx.vlan = '';
      ppFx.buildingId = buildingId;
      ppFx.floorId = fId;
      ppFx.roomId = rackRoomId;
      ppFx.rackId = rackId;
      ppFx.rackUnitStart = 10;
      ppFx.rackUnitHeight = 1;
      assets[ppFx.id] = ppFx;

      const swFx = createDeviceAssetFromPreset(swPreset, assetIdx++);
      swFx.id = `ast_h2_sw_${tag.toLowerCase()}`;
      swFx.name = `SW-POE-${tag}`;
      swFx.ipAddress = `10.20.10.${spec.octet}`;
      swFx.subnetMask = '255.255.255.0';
      swFx.gateway = '10.20.10.1';
      swFx.vlan = '10, 20, 30, 40, 50, 60';
      swFx.powerWatts = 160;
      swFx.poeBudgetWatts = 370;
      swFx.buildingId = buildingId;
      swFx.floorId = fId;
      swFx.roomId = rackRoomId;
      swFx.rackId = rackId;
      swFx.rackUnitStart = 8;
      swFx.rackUnitHeight = 1;
      if (swFx.ports[1]) {
        swFx.ports[1] = { ...swFx.ports[1], type: 'RJ45_10G', speed: '2.5 Gbps', poe: true };
      }
      assets[swFx.id] = swFx;

      const pduFx = createDeviceAssetFromPreset(pduPreset, assetIdx++);
      pduFx.id = `ast_h2_pdu_${tag.toLowerCase()}`;
      pduFx.name = `PDU-${tag}`;
      pduFx.ipAddress = '';
      pduFx.subnetMask = '';
      pduFx.gateway = '';
      pduFx.vlan = '';
      pduFx.powerWatts = 15;
      pduFx.buildingId = buildingId;
      pduFx.floorId = fId;
      pduFx.roomId = rackRoomId;
      pduFx.rackId = rackId;
      pduFx.rackUnitStart = 4;
      pduFx.rackUnitHeight = 1;
      pduFx.rackSide = 'rear';
      assets[pduFx.id] = pduFx;

      racks.push({
        id: rackId,
        name: `Small Rack ${tag} (12U)`,
        buildingId,
        floorId: fId,
        roomId: rackRoomId,
        totalUnits: 12,
        widthMm: 600,
        depthMm: 600,
        maxLoadKg: 450,
        x: 215,
        y: 95,
        slots: {
          12: odfFx.id,
          10: ppFx.id,
          8: swFx.id
        },
        rearSlots: {
          4: pduFx.id
        }
      });

      nodes.push({
        id: rackNodeId,
        diagramMode: 'floorplan',
        floorId: fId,
        type: 'rack',
        label: `Small Rack ${tag} (12U)`,
        x: 215,
        y: 95,
        width: 215,
        height: getCanvasRackHeight(12),
        rotation: 0,
        style: {
          backgroundColor: '#0f172a',
          borderColor: '#334155',
          borderWidth: 3,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#f8fafc'
        },
        customData: { rackId, totalUnits: 12 }
      });

      const swNodeId = `node_h2_sw_${tag.toLowerCase()}`;
      floorSwitchNodeByFloor[fId] = swNodeId;
      nodes.push({
        id: swNodeId,
        diagramMode: 'topology',
        floorId: fId,
        type: 'device',
        assetId: swFx.id,
        label: swFx.name,
        x: 680,
        y: 120 + spec.octet * 30,
        width: 165,
        height: 54,
        rotation: 0,
        style: {
          backgroundColor: '#0ea5e9',
          borderColor: '#0284c7',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#ffffff'
        }
      });

      // Floor switch uplinks to floor Riser
      cables.push({
        id: `cab_h2_sw_riser_${tag.toLowerCase()}`,
        cableCode: `FO-UP-${tag}`,
        diagramMode: 'floorplan',
        sourceNodeId: swNodeId,
        sourcePortId: 'port_25',
        targetNodeId: riserNodeId,
        targetPortId: 'port_1',
        cableType: 'FIBER_SM_OS2',
        bandwidth: '10G',
        color: '#0284c7',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 3,
        lengthMeters: 6,
        vlan: '10, 20, 30, 40, 50, 60',
        status: 'active',
        label: `Uplink ${tag}`
      });

      patchLinks.push({
        id: `pl_h2_${tag.toLowerCase()}_1`,
        patchPanelAssetId: ppFx.id,
        patchPort: 'Port 01',
        targetDeviceName: `AP-WIFI-${tag}`,
        targetPort: 'Eth0_PoE',
        cableCode: `CAT6-${tag}-AP`,
        roomName: spec.zoneDTitle,
        vlan: '30',
        notes: `Wi-Fi 6 PoE+ tầng ${tag}`
      });
    }

    const activeSwNodeId = floorSwitchNodeByFloor[fId];
    let swPortCounter = 1;

    // 5. Máy Chấm Công (Time Attendance) at Elevator Lobby on EVERY floor
    const attNodeId = `node_h2_att_${tag.toLowerCase()}`;
    const attAsset = makeAttendanceAsset(
      `ast_h2_att_${tag.toLowerCase()}`,
      `Máy Chấm Công ${tag}`,
      `10.20.60.${spec.octet}`,
      fId,
      elevRoomId
    );
    nodes.push({
      id: attNodeId,
      diagramMode: 'floorplan',
      floorId: fId,
      type: 'device',
      assetId: attAsset.id,
      label: `Máy Chấm Công ${tag}`,
      x: 608,
      y: 518,
      width: 78,
      height: 58,
      rotation: 0,
      style: {
        backgroundColor: '#059669',
        borderColor: '#047857',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1,
        textColor: '#ffffff',
        iconColor: '#ffffff'
      }
    });
    cables.push({
      id: `cab_h2_${tag.toLowerCase()}_att`,
      cableCode: `CAT6-${tag}-ATT`,
      diagramMode: 'floorplan',
      sourceNodeId: activeSwNodeId,
      sourcePortId: `port_${swPortCounter++}`,
      targetNodeId: attNodeId,
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#059669',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 18,
      vlan: '60',
      status: 'active'
    });

    // 6. Wi-Fi 6 AP on every floor
    const apNodeId = `node_h2_ap_${tag.toLowerCase()}`;
    const apAsset = createDeviceAssetFromPreset(apPreset, assetIdx++);
    apAsset.id = `ast_h2_ap_${tag.toLowerCase()}`;
    apAsset.name = `AP-WIFI-${tag}`;
    apAsset.ipAddress = `10.20.30.${spec.octet}`;
    apAsset.subnetMask = '255.255.255.0';
    apAsset.gateway = '10.20.30.1';
    apAsset.vlan = '30';
    apAsset.poeEnabled = true;
    apAsset.poeWatts = 22;
    apAsset.buildingId = buildingId;
    apAsset.floorId = fId;
    apAsset.roomId = zoneDRoomId;
    if (apAsset.wifiSpecs) {
      apAsset.wifiSpecs.coverageRadiusMeters = 18;
      apAsset.wifiSpecs.ssid = 'HACHIHI2-CORP';
    }
    assets[apAsset.id] = apAsset;

    nodes.push({
      id: apNodeId,
      diagramMode: 'floorplan',
      floorId: fId,
      type: 'device',
      assetId: apAsset.id,
      label: apAsset.name,
      x: 785,
      y: 255,
      width: 80,
      height: 74,
      rotation: 0,
      style: {
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1,
        textColor: '#ffffff',
        iconColor: '#ffffff'
      },
      customData: { coverageRadiusMeters: 18 }
    });
    cables.push({
      id: `cab_h2_${tag.toLowerCase()}_ap`,
      cableCode: `CAT6-${tag}-AP`,
      diagramMode: 'floorplan',
      sourceNodeId: activeSwNodeId,
      sourcePortId: `port_${swPortCounter++}`,
      targetNodeId: apNodeId,
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
    });

    // 7. Floor-specific CCTV Cameras & Workstations
    const addCam = (suffix: string, label: string, x: number, y: number, rot: number, roomId: string, ipLast: number) => {
      const camNodeId = `node_h2_cam_${tag.toLowerCase()}_${suffix}`;
      const camAsset = createDeviceAssetFromPreset(camPreset, assetIdx++);
      camAsset.id = `ast_h2_cam_${tag.toLowerCase()}_${suffix}`;
      camAsset.name = label;
      camAsset.ipAddress = `10.20.40.${ipLast}`;
      camAsset.subnetMask = '255.255.255.0';
      camAsset.gateway = '10.20.40.1';
      camAsset.vlan = '40';
      camAsset.poeEnabled = true;
      camAsset.poeWatts = 12;
      camAsset.buildingId = buildingId;
      camAsset.floorId = fId;
      camAsset.roomId = roomId;
      if (camAsset.cameraSpecs) {
        camAsset.cameraSpecs.fovAngle = 95;
        camAsset.cameraSpecs.irDistanceMeters = 30;
      }
      assets[camAsset.id] = camAsset;

      nodes.push({
        id: camNodeId,
        diagramMode: 'floorplan',
        floorId: fId,
        type: 'device',
        assetId: camAsset.id,
        label,
        x,
        y,
        width: 74,
        height: 64,
        rotation: rot,
        style: {
          backgroundColor: '#f59e0b',
          borderColor: '#d97706',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#ffffff',
          iconColor: '#ffffff'
        },
        customData: { fov: 95, irDistance: 30 }
      });

      cables.push({
        id: `cab_h2_${tag.toLowerCase()}_cam_${suffix}`,
        cableCode: `CAT6-${tag}-CAM${suffix.toUpperCase()}`,
        diagramMode: 'floorplan',
        sourceNodeId: activeSwNodeId,
        sourcePortId: `port_${swPortCounter++}`,
        targetNodeId: camNodeId,
        targetPortId: 'port_1',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#f59e0b',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 28,
        vlan: '40',
        status: 'active'
      });
    };

    const addWs = (suffix: string, label: string, x: number, y: number, roomId: string, ipLast: number) => {
      const wsNodeId = `node_h2_ws_${tag.toLowerCase()}_${suffix}`;
      const wsAsset = makeWorkstationAsset(
        `ast_h2_ws_${tag.toLowerCase()}_${suffix}`,
        label,
        `10.20.20.${ipLast}`,
        fId,
        roomId
      );
      nodes.push({
        id: wsNodeId,
        diagramMode: 'floorplan',
        floorId: fId,
        type: 'device',
        assetId: wsAsset.id,
        label,
        x,
        y,
        width: 96,
        height: 64,
        rotation: 0,
        style: {
          backgroundColor: '#475569',
          borderColor: '#334155',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#ffffff',
          iconColor: '#ffffff'
        }
      });
      cables.push({
        id: `cab_h2_${tag.toLowerCase()}_ws_${suffix}`,
        cableCode: `CAT6-${tag}-WS${suffix.toUpperCase()}`,
        diagramMode: 'floorplan',
        sourceNodeId: activeSwNodeId,
        sourcePortId: `port_${swPortCounter++}`,
        targetNodeId: wsNodeId,
        targetPortId: 'port_1',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#0ea5e9',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 24,
        vlan: '20',
        status: 'active'
      });
    };

    const baseIpOffset = (spec.octet - 10) * 10;

    if (spec.isBasement) {
      addCam('1', 'CAM-Hầm-B1-01', 1140, 105, 165, zoneDRoomId, 100 + baseIpOffset + 1);
      addCam('2', 'CAM-Hầm-B1-02', 1140, 525, 210, zoneERoomId, 100 + baseIpOffset + 2);
      addCam('gate', 'CAM-Cổng-Chính', 310, 515, 20, lobbyLowerId, 100 + baseIpOffset + 3);
    } else {
      addWs('1', `PC-${tag}-01`, 560, 120, zoneDRoomId, baseIpOffset + 1);
      addWs('2', `PC-${tag}-02`, 945, 120, zoneDRoomId, baseIpOffset + 2);
      addCam('1', `CAM-${tag}-01`, 1150, 105, 155, zoneDRoomId, 100 + baseIpOffset + 1);
      addCam('2', `CAM-${tag}-02`, 1150, 535, 205, zoneERoomId, 100 + baseIpOffset + 2);
      if (spec.isGround || spec.tag === 'T1' || spec.tag === 'T2') {
        addWs('3', `PC-${tag}-03`, 865, 515, zoneERoomId, baseIpOffset + 3);
      }
    }
  }

  // 8. Vertical Inter-Floor Riser Trunk Cables (star/tree up/down into Tầng 4 Main Riser & Core)
  const verticalRiserLinks: Array<{ code: string; from: string; to: string; len: number; label: string }> = [
    { code: 'FO-RISER-B1-G', from: 'flr_h2_b1', to: 'flr_h2_g', len: 6, label: 'Trục đứng B1→G' },
    { code: 'FO-RISER-G-T1', from: 'flr_h2_g', to: 'flr_h2_1', len: 6, label: 'Trục đứng G→T1' },
    { code: 'FO-RISER-T1-T2', from: 'flr_h2_1', to: 'flr_h2_2', len: 6, label: 'Trục đứng T1→T2' },
    { code: 'FO-RISER-T2-T3', from: 'flr_h2_2', to: 'flr_h2_3', len: 6, label: 'Trục đứng T2→T3' },
    { code: 'FO-RISER-T3-T4', from: 'flr_h2_3', to: 'flr_h2_4', len: 6, label: 'Trục đứng T3→T4' },
    { code: 'FO-RISER-T5-T4', from: 'flr_h2_5', to: 'flr_h2_4', len: 6, label: 'Trục đứng T5→T4' }
  ];

  // Note: Riser-T4 connects to Core-T4 on port_1, Riser-T3 on port_2, Riser-T5 on port_3
  const riserUsedPortCount: Record<string, number> = {};
  const nextRiserPort = (floorId: string) => {
    // port_1 is already used by floor Switch -> Riser
    const curr = riserUsedPortCount[floorId] ?? 1;
    const next = curr + 1;
    riserUsedPortCount[floorId] = next;
    return `port_${next}`;
  };

  verticalRiserLinks.forEach((link, idx) => {
    const fromNode = riserNodeIdByFloor[link.from];
    const toNode = riserNodeIdByFloor[link.to];
    cables.push({
      id: `cab_h2_vriser_${idx + 1}`,
      cableCode: link.code,
      diagramMode: 'floorplan',
      sourceNodeId: fromNode,
      sourcePortId: nextRiserPort(link.from),
      targetNodeId: toNode,
      targetPortId: nextRiserPort(link.to),
      cableType: 'FIBER_SM_OS2',
      bandwidth: '25G',
      color: '#2563eb',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 4,
      lengthMeters: link.len,
      vlan: '10, 20, 30, 40, 50, 60',
      status: 'active',
      label: link.label
    });
  });

  // Unused unused-var safety for floorTagById & coreFreePortsQueue
  void floorTagById;
  void coreFreePortsQueue;
  void coreSwitchAsset;

  const syncedAssets = syncPortStatuses(assets, nodes, cables);

  return {
    id: 'proj_hachihi2_building',
    name: 'Tòa nhà HACHIHI 2 (B1 + G + 5 Tầng)',
    author: 'HACHIHI Building Architect',
    version: '3.2.0',
    lastModified: new Date().toISOString(),
    buildings: [building],
    floors,
    rooms,
    cableTrays,
    racks,
    assets: syncedAssets,
    nodes,
    cables,
    vlans,
    subnets,
    patchLinks,
    activeMode: 'floorplan',
    activeBuildingId: buildingId,
    activeFloorId: 'flr_h2_g',
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
      isDarkMode: false,
      ipRangeStart: '10.20.20.10',
      ipRangeEnd: '10.20.20.240',
      ipSubnetMask: '255.255.255.0',
      ipGateway: '10.20.20.1'
    }
  };
}
