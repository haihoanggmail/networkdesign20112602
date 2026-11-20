import {
  CableEdge,
  DeviceAsset,
  DiagramNode,
  ProjectState,
  SubnetSpec,
  VlanSpec
} from '../types/infrastructure';
import { DEVICE_CATALOG, DevicePreset, createDeviceAssetFromPreset } from './deviceCatalog';

function findPreset(predicate: (d: DevicePreset) => boolean): DevicePreset {
  return DEVICE_CATALOG.find(predicate) || DEVICE_CATALOG[0];
}

function syncTemplatePorts(
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

function createBaseTopologySettings(ipStart: string, ipEnd: string, mask: string, gateway: string): ProjectState['settings'] {
  return {
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
    ipRangeStart: ipStart,
    ipRangeEnd: ipEnd,
    ipSubnetMask: mask,
    ipGateway: gateway
  };
}

/**
 * 1. LAN Tiêu chuẩn (Star 2-Tier: WAN -> Router -> PoE Switch -> AP / Camera / NAS)
 */
export function createStandardLanStarProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const cloudPreset = findPreset(d => d.category === 'cloud');
  const routerPreset = findPreset(d => d.category === 'router' && d.model.includes('RB750'));
  const swPreset = findPreset(d => d.category === 'switch' && d.vendor === 'Ruijie');
  const srvPreset = findPreset(d => d.category === 'server');
  const apPreset = findPreset(d => d.category === 'ap');
  const nvrPreset = findPreset(d => d.category === 'nvr');
  const camPreset = findPreset(d => d.category === 'camera');

  const vlans: VlanSpec[] = [
    { id: 'vlan_10', vlanId: 10, name: 'LAN-NoiBo', purpose: 'Máy chủ NAS, máy trạm & thiết bị quản trị', color: '#2563eb' },
    { id: 'vlan_20', vlanId: 20, name: 'WiFi-VanPhong', purpose: 'Phát sóng Wi-Fi văn phòng & khách', color: '#10b981' },
    { id: 'vlan_30', vlanId: 30, name: 'CCTV-AnNinh', purpose: 'Camera IP PoE & đầu ghi hình NVR', color: '#f59e0b' }
  ];

  const subnets: SubnetSpec[] = [
    { id: 'sub_10', name: 'LAN Nội bộ', cidr: '192.168.10.0/24', vlanId: 10, gateway: '192.168.10.1', dnsServers: '1.1.1.1, 8.8.8.8', dhcpRange: '192.168.10.50 - 192.168.10.220', notes: 'Mạng nội bộ & NAS' },
    { id: 'sub_20', name: 'Wi-Fi Văn phòng', cidr: '192.168.20.0/24', vlanId: 20, gateway: '192.168.20.1', dnsServers: '1.1.1.1, 8.8.8.8', dhcpRange: '192.168.20.50 - 192.168.20.240', notes: 'Access Point Wi-Fi 6' },
    { id: 'sub_30', name: 'Camera CCTV', cidr: '192.168.30.0/24', vlanId: 30, gateway: '192.168.30.1', dnsServers: '192.168.30.1', dhcpRange: 'Tĩnh (Static)', notes: 'Cô lập băng thông hình ảnh Camera' }
  ];

  const addDevice = (
    id: string,
    preset: DevicePreset,
    idx: number,
    name: string,
    ip: string,
    vlan: string,
    x: number,
    y: number,
    style: { bg: string; border: string; w?: number; h?: number; type?: DiagramNode['type'] }
  ) => {
    const asset = createDeviceAssetFromPreset(preset, idx);
    asset.id = `ast_${id}`;
    asset.name = name;
    asset.ipAddress = ip;
    asset.subnetMask = ip ? '255.255.255.0' : '';
    asset.gateway = ip ? `${ip.split('.').slice(0, 3).join('.')}.1` : '';
    asset.vlan = vlan;
    assets[asset.id] = asset;

    nodes.push({
      id: `node_${id}`,
      diagramMode: 'topology',
      type: style.type || 'device',
      assetId: asset.id,
      label: name,
      x,
      y,
      width: style.w || 160,
      height: style.h || 56,
      rotation: 0,
      style: {
        backgroundColor: style.bg,
        borderColor: style.border,
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1,
        textColor: '#ffffff'
      }
    });
    return { asset, nodeId: `node_${id}` };
  };

  const cloud = addDevice('lan_cloud', cloudPreset, 1, 'FTTH-ISP-WAN', '', '', 420, 30, { bg: '#6366f1', border: '#4f46e5', h: 64, type: 'cloud' });
  const rtr = addDevice('lan_rtr', routerPreset, 2, 'RTR-MIKROTIK-GW', '192.168.10.1', '10, 20, 30', 420, 145, { bg: '#2563eb', border: '#1d4ed8' });
  const sw = addDevice('lan_sw', swPreset, 3, 'SW-POE-ACCESS-24P', '192.168.10.2', '10, 20, 30', 410, 275, { bg: '#0ea5e9', border: '#0284c7', w: 180 });
  sw.asset.poeBudgetWatts = 370;

  const nas = addDevice('lan_nas', srvPreset, 4, 'SRV-NAS-NOI-BO', '192.168.10.10', '10', 80, 425, { bg: '#475569', border: '#334155', w: 150 });
  const ap1 = addDevice('lan_ap1', apPreset, 5, 'AP-WIFI6-VP01', '192.168.20.11', '20', 270, 425, { bg: '#10b981', border: '#059669', w: 130, h: 66 });
  ap1.asset.poeEnabled = true;
  ap1.asset.poeWatts = 22;

  const ap2 = addDevice('lan_ap2', apPreset, 6, 'AP-WIFI6-VP02', '192.168.20.12', '20', 440, 425, { bg: '#10b981', border: '#059669', w: 130, h: 66 });
  ap2.asset.poeEnabled = true;
  ap2.asset.poeWatts = 22;

  const nvr = addDevice('lan_nvr', nvrPreset, 7, 'NVR-CCTV-01', '192.168.30.10', '30', 620, 425, { bg: '#d97706', border: '#b45309', w: 150 });
  const cam1 = addDevice('lan_cam1', camPreset, 8, 'CAM-CUA-CHINH', '192.168.30.21', '30', 600, 555, { bg: '#f59e0b', border: '#d97706', w: 120, h: 64 });
  cam1.asset.poeEnabled = true;
  cam1.asset.poeWatts = 12;

  const cam2 = addDevice('lan_cam2', camPreset, 9, 'CAM-KHO-HANG', '192.168.30.22', '30', 760, 555, { bg: '#f59e0b', border: '#d97706', w: 120, h: 64 });
  cam2.asset.poeEnabled = true;
  cam2.asset.poeWatts = 12;

  cables.push(
    { id: 'c_lan_1', cableCode: 'WAN-FTTH-01', diagramMode: 'topology', sourceNodeId: cloud.nodeId, sourcePortId: 'port_2', targetNodeId: rtr.nodeId, targetPortId: 'port_2', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#6366f1', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 5, status: 'active' },
    { id: 'c_lan_2', cableCode: 'LAN-TRUNK-01', diagramMode: 'topology', sourceNodeId: rtr.nodeId, sourcePortId: 'port_3', targetNodeId: sw.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#2563eb', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 2, vlan: '10, 20, 30', status: 'active' },
    { id: 'c_lan_3', cableCode: 'LAN-NAS-10G', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_26', targetNodeId: nas.nodeId, targetPortId: 'port_2', cableType: 'DAC_10G', bandwidth: '10G', color: '#475569', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, vlan: '10', status: 'active' },
    { id: 'c_lan_4', cableCode: 'POE-AP-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_2', targetNodeId: ap1.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#10b981', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 22, vlan: '20', status: 'active' },
    { id: 'c_lan_5', cableCode: 'POE-AP-02', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_3', targetNodeId: ap2.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#10b981', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 28, vlan: '20', status: 'active' },
    { id: 'c_lan_6', cableCode: 'LAN-NVR-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_4', targetNodeId: nvr.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#d97706', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, vlan: '30', status: 'active' },
    { id: 'c_lan_7', cableCode: 'POE-CAM-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_5', targetNodeId: cam1.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#f59e0b', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 30, vlan: '30', status: 'active' },
    { id: 'c_lan_8', cableCode: 'POE-CAM-02', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_6', targetNodeId: cam2.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#f59e0b', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 36, vlan: '30', status: 'active' }
  );

  return {
    id: 'proj_std_lan_star',
    name: 'Mạng LAN Tiêu chuẩn (Star 2-Tier)',
    author: 'HACHIHI Network Standard',
    version: '3.1.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets: syncTemplatePorts(assets, nodes, cables),
    nodes,
    cables,
    vlans,
    subnets,
    activeMode: 'topology',
    activeBuildingId: '',
    activeFloorId: '',
    settings: createBaseTopologySettings('192.168.10.10', '192.168.10.250', '255.255.255.0', '192.168.10.1')
  };
}

/**
 * 2. LAN Phân tách VLAN & Vùng DMZ (Firewall + Switch L2+ + DMZ + UPS)
 */
export function createStandardLanVlanDmzProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const cloudPreset = findPreset(d => d.category === 'cloud');
  const fwPreset = findPreset(d => d.category === 'firewall');
  const swPreset = findPreset(d => d.category === 'switch' && d.model.includes('C9300'));
  const srvPreset = findPreset(d => d.category === 'server');
  const apPreset = findPreset(d => d.category === 'ap');
  const camPreset = findPreset(d => d.category === 'camera');
  const upsPreset = findPreset(d => d.category === 'ups');

  const vlans: VlanSpec[] = [
    { id: 'vlan_10', vlanId: 10, name: 'MGMT-Infra', purpose: 'Quản trị Firewall, Switch, UPS', color: '#2563eb' },
    { id: 'vlan_20', vlanId: 20, name: 'Staff-LAN', purpose: 'Máy trạm phòng ban', color: '#0ea5e9' },
    { id: 'vlan_30', vlanId: 30, name: 'Corp-WiFi', purpose: 'Hệ thống Wi-Fi 6 nội bộ', color: '#10b981' },
    { id: 'vlan_40', vlanId: 40, name: 'CCTV-Sec', purpose: 'Camera an ninh IP', color: '#f59e0b' },
    { id: 'vlan_50', vlanId: 50, name: 'Internal-SRV', purpose: 'Máy chủ ERP & DB nội bộ', color: '#475569' },
    { id: 'vlan_99', vlanId: 99, name: 'DMZ-Public', purpose: 'Vùng đệm Web/API/Mail công khai', color: '#dc2626' }
  ];

  const subnets: SubnetSpec[] = [
    { id: 'sub_10', name: 'MGMT', cidr: '10.20.10.0/24', vlanId: 10, gateway: '10.20.10.1', dnsServers: '10.20.50.10', dhcpRange: 'Tĩnh', notes: 'Quản trị hạ tầng' },
    { id: 'sub_20', name: 'Staff LAN', cidr: '10.20.20.0/24', vlanId: 20, gateway: '10.20.20.1', dnsServers: '10.20.50.10, 1.1.1.1', dhcpRange: '10.20.20.50 - 10.20.20.230', notes: 'PC nhân viên' },
    { id: 'sub_30', name: 'Corp Wi-Fi', cidr: '10.20.30.0/24', vlanId: 30, gateway: '10.20.30.1', dnsServers: '10.20.50.10, 8.8.8.8', dhcpRange: '10.20.30.50 - 10.20.30.230', notes: 'Access Point' },
    { id: 'sub_40', name: 'CCTV', cidr: '10.20.40.0/24', vlanId: 40, gateway: '10.20.40.1', dnsServers: '10.20.40.1', dhcpRange: 'Tĩnh', notes: 'Camera IP' },
    { id: 'sub_50', name: 'Server Farm', cidr: '10.20.50.0/24', vlanId: 50, gateway: '10.20.50.1', dnsServers: '10.20.50.10', dhcpRange: 'Tĩnh', notes: 'ERP & AD/DNS' },
    { id: 'sub_99', name: 'DMZ Zone', cidr: '172.16.99.0/24', vlanId: 99, gateway: '172.16.99.1', dnsServers: '1.1.1.1', dhcpRange: 'Tĩnh', notes: 'Vùng đệm công khai tách biệt LAN' }
  ];

  const putNode = (
    id: string,
    preset: DevicePreset,
    idx: number,
    name: string,
    ip: string,
    vlan: string,
    x: number,
    y: number,
    bg: string,
    border: string,
    type: DiagramNode['type'] = 'device',
    w = 160,
    h = 56
  ) => {
    const asset = createDeviceAssetFromPreset(preset, idx);
    asset.id = `ast_${id}`;
    asset.name = name;
    asset.ipAddress = ip;
    asset.subnetMask = ip ? '255.255.255.0' : '';
    asset.gateway = ip ? `${ip.split('.').slice(0, 3).join('.')}.1` : '';
    asset.vlan = vlan;
    assets[asset.id] = asset;
    nodes.push({
      id: `node_${id}`,
      diagramMode: 'topology',
      type,
      assetId: asset.id,
      label: name,
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      style: { backgroundColor: bg, borderColor: border, borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
    });
    return { asset, nodeId: `node_${id}` };
  };

  const cloud = putNode('dmz_cloud', cloudPreset, 1, 'WAN-INTERNET', '', '', 400, 30, '#6366f1', '#4f46e5', 'cloud', 170, 64);
  const fw = putNode('dmz_fw', fwPreset, 2, 'NGFW-FORTIGATE-200F', '10.20.10.1', '10, 20, 30, 40, 50, 99', 400, 145, '#dc2626', '#b91c1c', 'device', 180, 58);
  const dmzSrv = putNode('dmz_web', srvPreset, 3, 'SRV-DMZ-WEB-API', '172.16.99.10', '99', 710, 145, '#b91c1c', '#991b1b', 'device', 170, 58);
  const sw = putNode('dmz_sw', swPreset, 4, 'SW-LAN-POE-24P', '10.20.10.2', '10, 20, 30, 40, 50', 400, 285, '#0ea5e9', '#0284c7', 'device', 180, 58);
  sw.asset.poeBudgetWatts = 370;

  const ups = putNode('dmz_ups', upsPreset, 5, 'UPS-MDF-3KVA', '10.20.10.5', '10', 110, 285, '#e11d48', '#be123c', 'device', 160, 58);
  const erp = putNode('dmz_erp', srvPreset, 6, 'SRV-ERP-INTERNAL', '10.20.50.10', '50', 110, 445, '#475569', '#334155', 'device', 160, 58);

  const pcAsset: DeviceAsset = {
    id: 'ast_dmz_pc',
    name: 'PC-STAFF-VLAN20',
    category: 'workstation',
    vendor: 'Dell',
    model: 'OptiPlex 7010',
    assetTag: 'AST-0007',
    serialNumber: 'SNPC007',
    ipAddress: '10.20.20.51',
    subnetMask: '255.255.255.0',
    gateway: '10.20.20.1',
    macAddress: '00:1A:2B:00:07:C1',
    vlan: '20',
    status: 'online',
    powerWatts: 180,
    weightKg: 6.5,
    ports: [{ id: 'port_1', name: 'NIC_1G', type: 'RJ45_1G', speed: '1 Gbps', status: 'unlinked' }]
  };
  assets[pcAsset.id] = pcAsset;
  nodes.push({
    id: 'node_dmz_pc',
    diagramMode: 'topology',
    type: 'device',
    assetId: pcAsset.id,
    label: pcAsset.name,
    x: 320,
    y: 445,
    width: 150,
    height: 58,
    rotation: 0,
    style: { backgroundColor: '#334155', borderColor: '#1e293b', borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
  });

  const ap = putNode('dmz_ap', apPreset, 8, 'AP-WIFI6-CORP', '10.20.30.11', '30', 520, 445, '#10b981', '#059669', 'device', 140, 64);
  ap.asset.poeEnabled = true;
  ap.asset.poeWatts = 22;

  const cam = putNode('dmz_cam', camPreset, 9, 'CAM-AN-NINH-01', '10.20.40.21', '40', 710, 445, '#f59e0b', '#d97706', 'device', 140, 64);
  cam.asset.poeEnabled = true;
  cam.asset.poeWatts = 12;

  cables.push(
    { id: 'c_dmz_1', cableCode: 'WAN-UPLINK-01', diagramMode: 'topology', sourceNodeId: cloud.nodeId, sourcePortId: 'port_2', targetNodeId: fw.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#dc2626', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 5, status: 'active' },
    { id: 'c_dmz_2', cableCode: 'DMZ-WEB-01', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_3', targetNodeId: dmzSrv.nodeId, targetPortId: 'port_3', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#b91c1c', routingType: 'straight', lineStyle: 'dashed', strokeWidth: 2, lengthMeters: 3, vlan: '99', status: 'active' },
    { id: 'c_dmz_3', cableCode: 'TRUNK-FW-SW', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_4', targetNodeId: sw.nodeId, targetPortId: 'port_25', cableType: 'DAC_10G', bandwidth: '10G', color: '#0284c7', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 1.5, vlan: '10, 20, 30, 40, 50', status: 'active' },
    { id: 'c_dmz_4', cableCode: 'MGMT-UPS-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_1', targetNodeId: ups.nodeId, targetPortId: 'port_4', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#e11d48', routingType: 'straight', lineStyle: 'dashed', strokeWidth: 2, lengthMeters: 2, vlan: '10', status: 'active' },
    { id: 'c_dmz_5', cableCode: 'LAN-ERP-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_26', targetNodeId: erp.nodeId, targetPortId: 'port_2', cableType: 'DAC_10G', bandwidth: '10G', color: '#475569', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, vlan: '50', status: 'active' },
    { id: 'c_dmz_6', cableCode: 'LAN-PC-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_3', targetNodeId: 'node_dmz_pc', targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0ea5e9', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 20, vlan: '20', status: 'active' },
    { id: 'c_dmz_7', cableCode: 'POE-AP-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_4', targetNodeId: ap.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#10b981', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, vlan: '30', status: 'active' },
    { id: 'c_dmz_8', cableCode: 'POE-CAM-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_5', targetNodeId: cam.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#f59e0b', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 32, vlan: '40', status: 'active' }
  );

  return {
    id: 'proj_std_lan_vlan_dmz',
    name: 'Mạng LAN Phân tách VLAN & DMZ',
    author: 'HACHIHI Network Standard',
    version: '3.1.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets: syncTemplatePorts(assets, nodes, cables),
    nodes,
    cables,
    vlans,
    subnets,
    activeMode: 'topology',
    activeBuildingId: '',
    activeFloorId: '',
    settings: createBaseTopologySettings('10.20.10.10', '10.20.10.250', '255.255.255.0', '10.20.10.1')
  };
}

/**
 * 3. WAN Dự phòng Dual-ISP & SD-WAN / IPsec VPN
 */
export function createStandardWanDualIspProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const cloudPreset = findPreset(d => d.category === 'cloud');
  const ccrPreset = findPreset(d => d.category === 'router' && d.model.includes('CCR2004'));
  const hexPreset = findPreset(d => d.category === 'router' && d.model.includes('RB750'));
  const fwPreset = findPreset(d => d.category === 'firewall');
  const swPreset = findPreset(d => d.category === 'switch' && d.model.includes('C9300'));
  const srvPreset = findPreset(d => d.category === 'server');
  const upsPreset = findPreset(d => d.category === 'ups');

  const vlans: VlanSpec[] = [
    { id: 'vlan_10', vlanId: 10, name: 'WAN-MGMT-VPN', purpose: 'Định tuyến biên, Firewall & VPN Sites', color: '#2563eb' },
    { id: 'vlan_20', vlanId: 20, name: 'HQ-LAN', purpose: 'Mạng LAN văn phòng trụ sở chính', color: '#0ea5e9' },
    { id: 'vlan_50', vlanId: 50, name: 'HQ-SERVERS', purpose: 'Cụm máy chủ ứng dụng trung tâm', color: '#475569' }
  ];

  const subnets: SubnetSpec[] = [
    { id: 'sub_10', name: 'MGMT & Edge', cidr: '10.30.10.0/24', vlanId: 10, gateway: '10.30.10.1', dnsServers: '10.30.50.10, 1.1.1.1', dhcpRange: 'Tĩnh', notes: 'Thiết bị biên WAN & VPN' },
    { id: 'sub_20', name: 'HQ LAN', cidr: '10.30.20.0/24', vlanId: 20, gateway: '10.30.20.1', dnsServers: '10.30.50.10', dhcpRange: '10.30.20.50 - 10.30.20.220', notes: 'Người dùng trụ sở' },
    { id: 'sub_50', name: 'HQ Servers', cidr: '10.30.50.0/24', vlanId: 50, gateway: '10.30.50.1', dnsServers: '10.30.50.10', dhcpRange: 'Tĩnh', notes: 'Máy chủ dữ liệu' },
    { id: 'sub_hn', name: 'Site Hà Nội (VPN)', cidr: '10.31.10.0/24', vlanId: 10, gateway: '10.31.10.1', dnsServers: '10.30.50.10', dhcpRange: '10.31.10.50 - 10.31.10.200', notes: 'Chi nhánh miền Bắc' },
    { id: 'sub_dn', name: 'Site Đà Nẵng (VPN)', cidr: '10.32.10.0/24', vlanId: 10, gateway: '10.32.10.1', dnsServers: '10.30.50.10', dhcpRange: '10.32.10.50 - 10.32.10.200', notes: 'Chi nhánh miền Trung' }
  ];

  const add = (
    id: string,
    preset: DevicePreset,
    idx: number,
    name: string,
    ip: string,
    vlan: string,
    x: number,
    y: number,
    bg: string,
    border: string,
    type: DiagramNode['type'] = 'device',
    w = 180,
    h = 58
  ) => {
    const a = createDeviceAssetFromPreset(preset, idx);
    a.id = `ast_${id}`;
    a.name = name;
    a.ipAddress = ip;
    a.subnetMask = ip ? '255.255.255.0' : '';
    a.gateway = ip ? `${ip.split('.').slice(0, 3).join('.')}.1` : '';
    a.vlan = vlan;
    assets[a.id] = a;
    nodes.push({
      id: `node_${id}`,
      diagramMode: 'topology',
      type,
      assetId: a.id,
      label: name,
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      style: { backgroundColor: bg, borderColor: border, borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
    });
    return { asset: a, nodeId: `node_${id}` };
  };

  const isp1 = add('wan_isp1', cloudPreset, 1, 'ISP-1 VIETTEL FTTH (CHÍNH)', '', '', 220, 30, '#6366f1', '#4f46e5', 'cloud', 190, 64);
  const isp2 = add('wan_isp2', cloudPreset, 2, 'ISP-2 VNPT LEASED LINE (DỰ PHÒNG)', '', '', 590, 30, '#0891b2', '#0e7490', 'cloud', 210, 64);
  const edge = add('wan_edge', ccrPreset, 3, 'WAN-EDGE-CCR2004 (DUAL-WAN)', '10.30.10.1', '10, 20, 50', 410, 155, '#2563eb', '#1d4ed8', 'device', 190, 58);
  const fw = add('wan_fw', fwPreset, 4, 'NGFW-FORTIGATE-VPN', '10.30.10.2', '10, 20, 50', 410, 285, '#dc2626', '#b91c1c', 'device', 190, 58);
  const siteHn = add('wan_hn', hexPreset, 5, 'SITE HÀ NỘI (IPSEC VPN)', '10.31.10.1', '10', 80, 285, '#0284c7', '#0369a1', 'device', 180, 58);
  const siteDn = add('wan_dn', hexPreset, 6, 'SITE ĐÀ NẴNG (IPSEC VPN)', '10.32.10.1', '10', 740, 285, '#0284c7', '#0369a1', 'device', 180, 58);
  const sw = add('wan_sw', swPreset, 7, 'SW-HQ-DISTRIBUTION', '10.30.10.3', '10, 20, 50', 410, 425, '#0ea5e9', '#0284c7', 'device', 190, 58);
  const srv = add('wan_srv', srvPreset, 8, 'SRV-HQ-CENTRAL-ERP', '10.30.50.10', '50', 220, 560, '#475569', '#334155', 'device', 180, 58);
  const ups = add('wan_ups', upsPreset, 9, 'UPS-WAN-EDGE-3KVA', '10.30.10.5', '10', 600, 560, '#e11d48', '#be123c', 'device', 180, 58);

  fw.asset.ports.push({ id: 'port_7', name: 'X2_LAN_10G', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' });
  cables.push(
    { id: 'c_wan_1', cableCode: 'ISP1-PRIMARY-10G', diagramMode: 'topology', sourceNodeId: isp1.nodeId, sourcePortId: 'port_1', targetNodeId: edge.nodeId, targetPortId: 'port_2', cableType: 'FIBER_SM_OS2', bandwidth: '10G', color: '#6366f1', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 8, status: 'active' },
    { id: 'c_wan_2', cableCode: 'ISP2-BACKUP-1G', diagramMode: 'topology', sourceNodeId: isp2.nodeId, sourcePortId: 'port_2', targetNodeId: edge.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0891b2', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 10, status: 'active' },
    { id: 'c_wan_3', cableCode: 'EDGE-TO-NGFW', diagramMode: 'topology', sourceNodeId: edge.nodeId, sourcePortId: 'port_3', targetNodeId: fw.nodeId, targetPortId: 'port_4', cableType: 'DAC_10G', bandwidth: '10G', color: '#2563eb', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 1.5, vlan: '10, 20, 50', status: 'active' },
    { id: 'c_wan_4', cableCode: 'IPSEC-TUNNEL-HN', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_2', targetNodeId: siteHn.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#6366f1', routingType: 'straight', lineStyle: 'dashed', strokeWidth: 3, lengthMeters: 50, vlan: '10', status: 'active' },
    { id: 'c_wan_5', cableCode: 'IPSEC-TUNNEL-DN', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_3', targetNodeId: siteDn.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#6366f1', routingType: 'straight', lineStyle: 'dashed', strokeWidth: 3, lengthMeters: 50, vlan: '10', status: 'active' },
    { id: 'c_wan_6', cableCode: 'TRUNK-FW-HQ', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_7', targetNodeId: sw.nodeId, targetPortId: 'port_25', cableType: 'DAC_10G', bandwidth: '10G', color: '#0284c7', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 1.5, vlan: '10, 20, 50', status: 'active' },
    { id: 'c_wan_7', cableCode: 'LAN-ERP-10G', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_26', targetNodeId: srv.nodeId, targetPortId: 'port_2', cableType: 'DAC_10G', bandwidth: '10G', color: '#475569', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, vlan: '50', status: 'active' },
    { id: 'c_wan_8', cableCode: 'MGMT-UPS-01', diagramMode: 'topology', sourceNodeId: sw.nodeId, sourcePortId: 'port_2', targetNodeId: ups.nodeId, targetPortId: 'port_4', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#e11d48', routingType: 'orthogonal', lineStyle: 'dashed', strokeWidth: 2, lengthMeters: 2, vlan: '10', status: 'active' }
  );

  return {
    id: 'proj_std_wan_dual_isp',
    name: 'WAN Dự phòng Dual-ISP & SD-WAN VPN',
    author: 'HACHIHI Network Standard',
    version: '3.1.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets: syncTemplatePorts(assets, nodes, cables),
    nodes,
    cables,
    vlans,
    subnets,
    activeMode: 'topology',
    activeBuildingId: '',
    activeFloorId: '',
    settings: createBaseTopologySettings('10.30.10.10', '10.30.10.250', '255.255.255.0', '10.30.10.1')
  };
}

/**
 * 4. Kiến trúc 3 Lớp Core / Distribution / Access (Dự phòng Kép Dual-Homed)
 */
export function createStandardCoreDistributionProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const cloudPreset = findPreset(d => d.category === 'cloud');
  const fwPreset = findPreset(d => d.category === 'firewall');
  const corePreset = findPreset(d => d.category === 'core_switch');
  const distPreset = findPreset(d => d.category === 'switch' && d.model.includes('CX 6300M'));
  const accCiscoPreset = findPreset(d => d.category === 'switch' && d.model.includes('C9300'));
  const accH3cPreset = findPreset(d => d.category === 'switch' && d.vendor === 'H3C');
  const accRuijiePreset = findPreset(d => d.category === 'switch' && d.vendor === 'Ruijie');
  const srvPreset = findPreset(d => d.category === 'server');
  const sanPreset = findPreset(d => d.category === 'storage');

  const vlans: VlanSpec[] = [
    { id: 'vlan_10', vlanId: 10, name: 'CORE-MGMT', purpose: 'Quản trị Core, Distribution & Access Switches', color: '#1e40af' },
    { id: 'vlan_20', vlanId: 20, name: 'CAMPUS-OFFICE', purpose: 'Khối văn phòng các tầng', color: '#0ea5e9' },
    { id: 'vlan_30', vlanId: 30, name: 'CAMPUS-WIFI', purpose: 'Hệ thống không dây toàn khu', color: '#10b981' },
    { id: 'vlan_40', vlanId: 40, name: 'CCTV-IOT', purpose: 'Camera an ninh & cảm biến nhà xưởng', color: '#f59e0b' },
    { id: 'vlan_50', vlanId: 50, name: 'DATACENTER-SRV', purpose: 'Cụm Server ảo hóa & SAN Storage', color: '#475569' }
  ];

  const subnets: SubnetSpec[] = [
    { id: 'sub_10', name: 'Core & Mgmt', cidr: '10.40.10.0/24', vlanId: 10, gateway: '10.40.10.1', dnsServers: '10.40.50.10', dhcpRange: 'Tĩnh', notes: 'Loopback & OOB Management' },
    { id: 'sub_20', name: 'Office Access', cidr: '10.40.20.0/24', vlanId: 20, gateway: '10.40.20.1', dnsServers: '10.40.50.10', dhcpRange: '10.40.20.50 - 10.40.20.230', notes: 'Văn phòng' },
    { id: 'sub_30', name: 'Campus Wi-Fi', cidr: '10.40.30.0/24', vlanId: 30, gateway: '10.40.30.1', dnsServers: '10.40.50.10', dhcpRange: '10.40.30.50 - 10.40.30.230', notes: 'Wi-Fi doanh nghiệp' },
    { id: 'sub_40', name: 'CCTV & IoT', cidr: '10.40.40.0/24', vlanId: 40, gateway: '10.40.40.1', dnsServers: '10.40.40.1', dhcpRange: 'Tĩnh', notes: 'Camera giám sát' },
    { id: 'sub_50', name: 'Data Center', cidr: '10.40.50.0/24', vlanId: 50, gateway: '10.40.50.1', dnsServers: '10.40.50.10', dhcpRange: 'Tĩnh', notes: 'Server & Storage' }
  ];

  const add = (
    id: string,
    preset: DevicePreset,
    idx: number,
    name: string,
    ip: string,
    vlan: string,
    x: number,
    y: number,
    bg: string,
    border: string,
    type: DiagramNode['type'] = 'device',
    w = 160,
    h = 56
  ) => {
    const a = createDeviceAssetFromPreset(preset, idx);
    a.id = `ast_${id}`;
    a.name = name;
    a.ipAddress = ip;
    a.subnetMask = ip ? '255.255.255.0' : '';
    a.gateway = ip ? `${ip.split('.').slice(0, 3).join('.')}.1` : '';
    a.vlan = vlan;
    assets[a.id] = a;
    nodes.push({
      id: `node_${id}`,
      diagramMode: 'topology',
      type,
      assetId: a.id,
      label: name,
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      style: { backgroundColor: bg, borderColor: border, borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
    });
    return { asset: a, nodeId: `node_${id}` };
  };

  // Extra uplink ports for CX 6300M (has 48 RJ45 + 2 SFP+, add 2 more SFP+ so dual-homed + 2 access downlinks fit cleanly)
  const cloud = add('cd_cloud', cloudPreset, 1, 'WAN-DUAL-ISP', '', '', 440, 20, '#6366f1', '#4f46e5', 'cloud', 170, 58);
  const fw = add('cd_fw', fwPreset, 2, 'NGFW-EDGE-HA', '10.40.10.1', '10, 20, 30, 40, 50', 435, 120, '#dc2626', '#b91c1c', 'device', 180, 56);

  const core1 = add('cd_core1', corePreset, 3, 'CORE-SW-01 (PRIMARY)', '10.40.10.2', '10, 20, 30, 40, 50', 230, 240, '#1e40af', '#1e3a8a', 'device', 180, 58);
  const core2 = add('cd_core2', corePreset, 4, 'CORE-SW-02 (STANDBY)', '10.40.10.3', '10, 20, 30, 40, 50', 630, 240, '#1e40af', '#1e3a8a', 'device', 180, 58);

  const distOff = add('cd_dist_off', distPreset, 5, 'DIST-SW-OFFICE', '10.40.10.11', '10, 20, 30', 110, 390, '#0284c7', '#0369a1', 'device', 170, 56);
  const distDc = add('cd_dist_dc', distPreset, 6, 'DIST-SW-SERVERFARM', '10.40.10.12', '10, 50', 435, 390, '#0284c7', '#0369a1', 'device', 180, 56);
  const distSec = add('cd_dist_sec', distPreset, 7, 'DIST-SW-SECURITY', '10.40.10.13', '10, 40', 760, 390, '#0284c7', '#0369a1', 'device', 170, 56);

  const accT1 = add('cd_acc1', accCiscoPreset, 8, 'ACC-SW-TANG1-POE', '10.40.10.21', '10, 20, 30', 50, 540, '#0ea5e9', '#0284c7', 'device', 160, 56);
  const accT2 = add('cd_acc2', accH3cPreset, 9, 'ACC-SW-TANG2-POE', '10.40.10.22', '10, 20, 30', 240, 540, '#0ea5e9', '#0284c7', 'device', 160, 56);
  const srv = add('cd_srv', srvPreset, 10, 'SRV-VMWARE-CLUSTER', '10.40.50.11', '50', 430, 540, '#475569', '#334155', 'device', 160, 56);
  const san = add('cd_san', sanPreset, 11, 'SAN-STORAGE-AFF250', '10.40.50.21', '50', 620, 540, '#0f766e', '#115e59', 'device', 160, 56);
  const accCam = add('cd_acccam', accRuijiePreset, 12, 'ACC-SW-CCTV-POE', '10.40.10.23', '10, 40', 810, 540, '#0ea5e9', '#0284c7', 'device', 160, 56);

  core1.asset.l2Config = { role: 'core', stpMode: 'rstp', stpPriority: 4096, mlagDomain: 'CORE-VPC' };
  core2.asset.l2Config = { role: 'core', stpMode: 'rstp', stpPriority: 8192, mlagDomain: 'CORE-VPC' };
  distOff.asset.l2Config = { role: 'distribution', stpMode: 'rstp', stpPriority: 16384 };
  distDc.asset.l2Config = { role: 'distribution', stpMode: 'rstp', stpPriority: 16384 };
  distSec.asset.l2Config = { role: 'distribution', stpMode: 'rstp', stpPriority: 16384 };
  accT1.asset.l2Config = { role: 'access', stpMode: 'rstp' };
  accT2.asset.l2Config = { role: 'access', stpMode: 'rstp' };
  accCam.asset.l2Config = { role: 'access', stpMode: 'rstp' };

  fw.asset.ports.push({ id: 'port_7', name: 'X2_HA_CORE2', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' });
  [core1.asset, core2.asset].forEach(cAsset => {
    cAsset.ports.push(
      { id: 'port_9', name: 'SFP+_5', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' },
      { id: 'port_10', name: 'SFP+_6', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' },
      { id: 'port_11', name: 'SFP+_7', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' }
    );
  });
  [distOff.asset, distDc.asset, distSec.asset].forEach(dAsset => {
    dAsset.ports.push(
      { id: 'port_51', name: 'Uplink_3', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' },
      { id: 'port_52', name: 'Uplink_4', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' }
    );
  });

  cables.push(
    { id: 'c_cd_1', cableCode: 'WAN-EDGE-01', diagramMode: 'topology', sourceNodeId: cloud.nodeId, sourcePortId: 'port_2', targetNodeId: fw.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#6366f1', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 6, status: 'active' },
    { id: 'c_cd_2', cableCode: 'FW-TO-CORE1', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_4', targetNodeId: core1.nodeId, targetPortId: 'port_5', cableType: 'DAC_10G', bandwidth: '10G', color: '#dc2626', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 2, vlan: '10, 20, 30, 40, 50', status: 'active' },
    { id: 'c_cd_3', cableCode: 'FW-TO-CORE2', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_7', targetNodeId: core2.nodeId, targetPortId: 'port_5', cableType: 'DAC_10G', bandwidth: '10G', color: '#dc2626', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 2, vlan: '10, 20, 30, 40, 50', status: 'active' },
    { id: 'c_cd_4', cableCode: 'CORE-ISL-100G', diagramMode: 'topology', sourceNodeId: core1.nodeId, sourcePortId: 'port_1', targetNodeId: core2.nodeId, targetPortId: 'port_1', cableType: 'DAC_10G', bandwidth: '100G', color: '#1e40af', routingType: 'straight', lineStyle: 'solid', strokeWidth: 4, lengthMeters: 1.5, vlan: '10, 20, 30, 40, 50', status: 'active' },
    // Dual-homed Distribution -> Core 1 & Core 2
    { id: 'c_cd_5', cableCode: 'DIST1-CORE1-OM4', diagramMode: 'topology', sourceNodeId: core1.nodeId, sourcePortId: 'port_6', targetNodeId: distOff.nodeId, targetPortId: 'port_49', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 18, vlan: '10, 20, 30', status: 'active' },
    { id: 'c_cd_6', cableCode: 'DIST1-CORE2-OM4', diagramMode: 'topology', sourceNodeId: core2.nodeId, sourcePortId: 'port_6', targetNodeId: distOff.nodeId, targetPortId: 'port_50', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'dashed', strokeWidth: 2, lengthMeters: 20, vlan: '10, 20, 30', status: 'active' },
    { id: 'c_cd_7', cableCode: 'DIST2-CORE1-OM4', diagramMode: 'topology', sourceNodeId: core1.nodeId, sourcePortId: 'port_7', targetNodeId: distDc.nodeId, targetPortId: 'port_49', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 12, vlan: '10, 50', status: 'active' },
    { id: 'c_cd_8', cableCode: 'DIST2-CORE2-OM4', diagramMode: 'topology', sourceNodeId: core2.nodeId, sourcePortId: 'port_7', targetNodeId: distDc.nodeId, targetPortId: 'port_50', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'dashed', strokeWidth: 2, lengthMeters: 12, vlan: '10, 50', status: 'active' },
    { id: 'c_cd_9', cableCode: 'DIST3-CORE1-OM4', diagramMode: 'topology', sourceNodeId: core1.nodeId, sourcePortId: 'port_8', targetNodeId: distSec.nodeId, targetPortId: 'port_49', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'dashed', strokeWidth: 2, lengthMeters: 22, vlan: '10, 40', status: 'active' },
    { id: 'c_cd_10', cableCode: 'DIST3-CORE2-OM4', diagramMode: 'topology', sourceNodeId: core2.nodeId, sourcePortId: 'port_8', targetNodeId: distSec.nodeId, targetPortId: 'port_50', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 18, vlan: '10, 40', status: 'active' },
    // Access & Server Farm downlinks
    { id: 'c_cd_11', cableCode: 'ACC-T1-UPLINK', diagramMode: 'topology', sourceNodeId: distOff.nodeId, sourcePortId: 'port_51', targetNodeId: accT1.nodeId, targetPortId: 'port_25', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0ea5e9', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 30, vlan: '10, 20, 30', status: 'active' },
    { id: 'c_cd_12', cableCode: 'ACC-T2-UPLINK', diagramMode: 'topology', sourceNodeId: distOff.nodeId, sourcePortId: 'port_52', targetNodeId: accT2.nodeId, targetPortId: 'port_25', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#0ea5e9', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 42, vlan: '10, 20, 30', status: 'active' },
    { id: 'c_cd_13', cableCode: 'DC-SRV-10G', diagramMode: 'topology', sourceNodeId: distDc.nodeId, sourcePortId: 'port_51', targetNodeId: srv.nodeId, targetPortId: 'port_2', cableType: 'DAC_10G', bandwidth: '10G', color: '#475569', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 2.5, vlan: '50', status: 'active' },
    { id: 'c_cd_14', cableCode: 'DC-SAN-10G', diagramMode: 'topology', sourceNodeId: distDc.nodeId, sourcePortId: 'port_52', targetNodeId: san.nodeId, targetPortId: 'port_3', cableType: 'DAC_10G', bandwidth: '10G', color: '#0f766e', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 2.5, vlan: '50', status: 'active' },
    { id: 'c_cd_15', cableCode: 'ACC-CAM-UPLINK', diagramMode: 'topology', sourceNodeId: distSec.nodeId, sourcePortId: 'port_51', targetNodeId: accCam.nodeId, targetPortId: 'port_25', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#f59e0b', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 35, vlan: '10, 40', status: 'active' }
  );

  return {
    id: 'proj_std_core_dist_3tier',
    name: 'Mạng 3 Lớp Core / Distribution / Access',
    author: 'HACHIHI Network Standard',
    version: '3.1.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets: syncTemplatePorts(assets, nodes, cables),
    nodes,
    cables,
    vlans,
    subnets,
    activeMode: 'topology',
    activeBuildingId: '',
    activeFloorId: '',
    settings: createBaseTopologySettings('10.40.10.10', '10.40.10.250', '255.255.255.0', '10.40.10.1')
  };
}

/**
 * 5. Mô hình Collapsed Core – Access cho Tòa nhà vừa (Core/Dist gộp + Trục quang OS2)
 */
export function createStandardCollapsedCoreProject(): ProjectState {
  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const cloudPreset = findPreset(d => d.category === 'cloud');
  const fwPreset = findPreset(d => d.category === 'firewall');
  const corePreset = findPreset(d => d.category === 'core_switch');
  const accPreset = findPreset(d => d.category === 'switch' && d.vendor === 'Ruijie');
  const srvPreset = findPreset(d => d.category === 'server');
  const upsPreset = findPreset(d => d.category === 'ups');
  const apPreset = findPreset(d => d.category === 'ap');
  const camPreset = findPreset(d => d.category === 'camera');

  const vlans: VlanSpec[] = [
    { id: 'vlan_10', vlanId: 10, name: 'MGMT-INFRA', purpose: 'Quản trị Core, Access & UPS', color: '#1e40af' },
    { id: 'vlan_20', vlanId: 20, name: 'OFFICE-LAN', purpose: 'Mạng văn phòng các tầng', color: '#0ea5e9' },
    { id: 'vlan_30', vlanId: 30, name: 'OFFICE-WIFI', purpose: 'Wi-Fi các tầng', color: '#10b981' },
    { id: 'vlan_40', vlanId: 40, name: 'CCTV-SEC', purpose: 'Camera an ninh', color: '#f59e0b' },
    { id: 'vlan_50', vlanId: 50, name: 'SERVER-LOCAL', purpose: 'Máy chủ AD/File nội bộ', color: '#475569' }
  ];

  const subnets: SubnetSpec[] = [
    { id: 'sub_10', name: 'MGMT', cidr: '10.50.10.0/24', vlanId: 10, gateway: '10.50.10.1', dnsServers: '10.50.50.10', dhcpRange: 'Tĩnh', notes: 'Thiết bị mạng & UPS' },
    { id: 'sub_20', name: 'Office LAN', cidr: '10.50.20.0/24', vlanId: 20, gateway: '10.50.20.1', dnsServers: '10.50.50.10', dhcpRange: '10.50.20.50 - 10.50.20.230', notes: 'Máy trạm' },
    { id: 'sub_30', name: 'Wi-Fi', cidr: '10.50.30.0/24', vlanId: 30, gateway: '10.50.30.1', dnsServers: '10.50.50.10', dhcpRange: '10.50.30.50 - 10.50.30.230', notes: 'AP các tầng' },
    { id: 'sub_40', name: 'CCTV', cidr: '10.50.40.0/24', vlanId: 40, gateway: '10.50.40.1', dnsServers: '10.50.40.1', dhcpRange: 'Tĩnh', notes: 'Camera IP' },
    { id: 'sub_50', name: 'Servers', cidr: '10.50.50.0/24', vlanId: 50, gateway: '10.50.50.1', dnsServers: '10.50.50.10', dhcpRange: 'Tĩnh', notes: 'Server phòng MDF' }
  ];

  const add = (
    id: string,
    preset: DevicePreset,
    idx: number,
    name: string,
    ip: string,
    vlan: string,
    x: number,
    y: number,
    bg: string,
    border: string,
    type: DiagramNode['type'] = 'device',
    w = 170,
    h = 56
  ) => {
    const a = createDeviceAssetFromPreset(preset, idx);
    a.id = `ast_${id}`;
    a.name = name;
    a.ipAddress = ip;
    a.subnetMask = ip ? '255.255.255.0' : '';
    a.gateway = ip ? `${ip.split('.').slice(0, 3).join('.')}.1` : '';
    a.vlan = vlan;
    assets[a.id] = a;
    nodes.push({
      id: `node_${id}`,
      diagramMode: 'topology',
      type,
      assetId: a.id,
      label: name,
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      style: { backgroundColor: bg, borderColor: border, borderWidth: 2, borderStyle: 'solid', opacity: 1, textColor: '#ffffff' }
    });
    return { asset: a, nodeId: `node_${id}` };
  };

  const cloud = add('cc_cloud', cloudPreset, 1, 'WAN-DUAL-ISP', '', '', 420, 25, '#6366f1', '#4f46e5', 'cloud', 170, 58);
  const fw = add('cc_fw', fwPreset, 2, 'NGFW-FORTIGATE-200F', '10.50.10.1', '10, 20, 30, 40, 50', 415, 130, '#dc2626', '#b91c1c', 'device', 180, 56);
  const core = add('cc_core', corePreset, 3, 'COLLAPSED-CORE-L3', '10.50.10.2', '10, 20, 30, 40, 50', 415, 250, '#1e40af', '#1e3a8a', 'device', 180, 58);
  const srv = add('cc_srv', srvPreset, 4, 'SRV-AD-ERP-MDF', '10.50.50.10', '50', 110, 250, '#475569', '#334155', 'device', 170, 56);
  const ups = add('cc_ups', upsPreset, 5, 'UPS-MDF-3KVA', '10.50.10.5', '10', 720, 250, '#e11d48', '#be123c', 'device', 160, 56);

  const sw1 = add('cc_sw1', accPreset, 6, 'SW-ACC-TANG1-POE', '10.50.10.11', '10, 20, 30, 40', 120, 410, '#0ea5e9', '#0284c7', 'device', 170, 56);
  const sw2 = add('cc_sw2', accPreset, 7, 'SW-ACC-TANG2-POE', '10.50.10.12', '10, 20, 30, 40', 420, 410, '#0ea5e9', '#0284c7', 'device', 170, 56);
  const sw3 = add('cc_sw3', accPreset, 8, 'SW-ACC-TANG3-POE', '10.50.10.13', '10, 20, 30, 40', 720, 410, '#0ea5e9', '#0284c7', 'device', 170, 56);

  const ap1 = add('cc_ap1', apPreset, 9, 'AP-TANG1-WIFI6', '10.50.30.11', '30', 135, 540, '#10b981', '#059669', 'device', 140, 62);
  ap1.asset.poeEnabled = true;
  ap1.asset.poeWatts = 22;

  const ap2 = add('cc_ap2', apPreset, 10, 'AP-TANG2-WIFI6', '10.50.30.12', '30', 435, 540, '#10b981', '#059669', 'device', 140, 62);
  ap2.asset.poeEnabled = true;
  ap2.asset.poeWatts = 22;

  const cam3 = add('cc_cam3', camPreset, 11, 'CAM-TANG3-01', '10.50.40.21', '40', 735, 540, '#f59e0b', '#d97706', 'device', 140, 62);
  cam3.asset.poeEnabled = true;
  cam3.asset.poeWatts = 12;

  core.asset.ports.push(
    { id: 'port_9', name: 'SFP+_5', type: 'SFP_PLUS_10G', speed: '10 Gbps', status: 'unlinked' },
    { id: 'port_10', name: 'Mgmt0', type: 'RJ45_1G', speed: '100 Mbps', status: 'unlinked' }
  );
  cables.push(
    { id: 'c_cc_1', cableCode: 'WAN-FTTH-01', diagramMode: 'topology', sourceNodeId: cloud.nodeId, sourcePortId: 'port_2', targetNodeId: fw.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#6366f1', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 5, status: 'active' },
    { id: 'c_cc_2', cableCode: 'FW-COLLAPSED-CORE', diagramMode: 'topology', sourceNodeId: fw.nodeId, sourcePortId: 'port_4', targetNodeId: core.nodeId, targetPortId: 'port_5', cableType: 'DAC_10G', bandwidth: '10G', color: '#dc2626', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 1.5, vlan: '10, 20, 30, 40, 50', status: 'active' },
    { id: 'c_cc_3', cableCode: 'CORE-SRV-10G', diagramMode: 'topology', sourceNodeId: core.nodeId, sourcePortId: 'port_6', targetNodeId: srv.nodeId, targetPortId: 'port_2', cableType: 'DAC_10G', bandwidth: '10G', color: '#475569', routingType: 'straight', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 2, vlan: '50', status: 'active' },
    { id: 'c_cc_4', cableCode: 'CORE-UPS-MGMT', diagramMode: 'topology', sourceNodeId: core.nodeId, sourcePortId: 'port_10', targetNodeId: ups.nodeId, targetPortId: 'port_4', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#e11d48', routingType: 'straight', lineStyle: 'dashed', strokeWidth: 2, lengthMeters: 2, vlan: '10', status: 'active' },
    { id: 'c_cc_5', cableCode: 'FO-TRUNK-FL1', diagramMode: 'topology', sourceNodeId: core.nodeId, sourcePortId: 'port_7', targetNodeId: sw1.nodeId, targetPortId: 'port_25', cableType: 'FIBER_SM_OS2', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 18, vlan: '10, 20, 30, 40', status: 'active' },
    { id: 'c_cc_6', cableCode: 'FO-TRUNK-FL2', diagramMode: 'topology', sourceNodeId: core.nodeId, sourcePortId: 'port_8', targetNodeId: sw2.nodeId, targetPortId: 'port_25', cableType: 'FIBER_SM_OS2', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 28, vlan: '10, 20, 30, 40', status: 'active' },
    { id: 'c_cc_7', cableCode: 'FO-TRUNK-FL3', diagramMode: 'topology', sourceNodeId: core.nodeId, sourcePortId: 'port_9', targetNodeId: sw3.nodeId, targetPortId: 'port_25', cableType: 'FIBER_SM_OS2', bandwidth: '10G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 3, lengthMeters: 38, vlan: '10, 20, 30, 40', status: 'active' },
    { id: 'c_cc_8', cableCode: 'POE-FL1-AP01', diagramMode: 'topology', sourceNodeId: sw1.nodeId, sourcePortId: 'port_1', targetNodeId: ap1.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#10b981', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 24, vlan: '30', status: 'active' },
    { id: 'c_cc_9', cableCode: 'POE-FL2-AP01', diagramMode: 'topology', sourceNodeId: sw2.nodeId, sourcePortId: 'port_1', targetNodeId: ap2.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#10b981', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 24, vlan: '30', status: 'active' },
    { id: 'c_cc_10', cableCode: 'POE-FL3-CAM01', diagramMode: 'topology', sourceNodeId: sw3.nodeId, sourcePortId: 'port_1', targetNodeId: cam3.nodeId, targetPortId: 'port_1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#f59e0b', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 30, vlan: '40', status: 'active' }
  );

  return {
    id: 'proj_std_collapsed_core',
    name: 'Mạng Collapsed Core – Access Tòa nhà',
    author: 'HACHIHI Network Standard',
    version: '3.1.0',
    lastModified: new Date().toISOString(),
    buildings: [],
    floors: [],
    rooms: [],
    racks: [],
    assets: syncTemplatePorts(assets, nodes, cables),
    nodes,
    cables,
    vlans,
    subnets,
    activeMode: 'topology',
    activeBuildingId: '',
    activeFloorId: '',
    settings: createBaseTopologySettings('10.50.10.10', '10.50.10.250', '255.255.255.0', '10.50.10.1')
  };
}
