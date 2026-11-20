import { DeviceCategory, DevicePort, PortType } from '../types/infrastructure';

export interface DevicePreset {
  category: DeviceCategory;
  name: string;
  vendor: string;
  model: string;
  defaultUHeight: number;
  powerWatts: number;
  weightKg: number;
  defaultPorts: Array<{ name: string; type: PortType; speed: string; poe?: boolean }>;
  description: string;
  defaultWidth: number;
  defaultHeight: number;
  color: string;
  iconName: string;
}

export const DEVICE_CATALOG: DevicePreset[] = [
  // 1. Core & Access Switches
  {
    category: 'core_switch',
    name: 'Core Switch 32x 100G',
    vendor: 'Cisco',
    model: 'Nexus 9336C-FX2',
    defaultUHeight: 1,
    powerWatts: 450,
    weightKg: 10.2,
    defaultWidth: 160,
    defaultHeight: 64,
    color: '#0284c7', // sky-600
    iconName: 'Layers',
    description: '36-port 40/100G QSFP28 Spine/Core Switch',
    defaultPorts: [
      ...Array.from({ length: 4 }, (_, i) => ({ name: `QSFP_${i + 1}`, type: 'QSFP28_100G' as PortType, speed: '100 Gbps' })),
      ...Array.from({ length: 4 }, (_, i) => ({ name: `SFP+_${i + 1}`, type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' }))
    ]
  },
  {
    category: 'switch',
    name: 'Access Switch 24-PoE+',
    vendor: 'Cisco / Aruba',
    model: 'Catalyst C9300-24P',
    defaultUHeight: 1,
    powerWatts: 380,
    weightKg: 7.4,
    defaultWidth: 150,
    defaultHeight: 56,
    color: '#0ea5e9', // sky-500
    iconName: 'Server',
    description: '24-port 1GbE PoE+ (370W) with 4x 10G SFP+ uplinks',
    defaultPorts: [
      ...Array.from({ length: 24 }, (_, i) => ({ name: `Gi1/0/${i + 1}`, type: 'RJ45_1G' as PortType, speed: '1 Gbps', poe: true })),
      { name: 'Te1/1/1', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' },
      { name: 'Te1/1/2', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' }
    ]
  },
  {
    category: 'switch',
    name: 'Distribution Switch 48-Port',
    vendor: 'Aruba / HPE',
    model: 'CX 6300M 48G',
    defaultUHeight: 1,
    powerWatts: 490,
    weightKg: 8.1,
    defaultWidth: 160,
    defaultHeight: 56,
    color: '#38bdf8', // sky-400
    iconName: 'Server',
    description: '48x 1G RJ45 + 4x 25G SFP28 aggregation switch',
    defaultPorts: [
      ...Array.from({ length: 48 }, (_, i) => ({ name: `Port_${i + 1}`, type: 'RJ45_1G' as PortType, speed: '1 Gbps' })),
      { name: 'Uplink_1', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' },
      { name: 'Uplink_2', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' }
    ]
  },

  // 2. Routers & Firewalls
  {
    category: 'router',
    name: 'WAN Edge Router',
    vendor: 'Cisco / MikroTik',
    model: 'ASR 1001-X',
    defaultUHeight: 1,
    powerWatts: 250,
    weightKg: 8.5,
    defaultWidth: 150,
    defaultHeight: 56,
    color: '#2563eb', // blue-600
    iconName: 'Router',
    description: 'Carrier-grade WAN aggregation router, 20Gbps throughput',
    defaultPorts: [
      { name: 'WAN1_ISP1', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' },
      { name: 'WAN2_ISP2', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      { name: 'LAN1_Core', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' },
      { name: 'LAN2_DMZ', type: 'RJ45_1G' as PortType, speed: '1 Gbps' }
    ]
  },
  {
    category: 'firewall',
    name: 'Next-Gen Firewall HA',
    vendor: 'Fortinet',
    model: 'FortiGate 200F',
    defaultUHeight: 1,
    powerWatts: 180,
    weightKg: 5.8,
    defaultWidth: 150,
    defaultHeight: 56,
    color: '#dc2626', // red-600
    iconName: 'Shield',
    description: 'Enterprise NGFW with 27Gbps Firewall throughput & SSL inspection',
    defaultPorts: [
      { name: 'WAN1', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      { name: 'WAN2', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      { name: 'DMZ', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      { name: 'Internal', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' },
      { name: 'HA1', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      { name: 'HA2', type: 'RJ45_1G' as PortType, speed: '1 Gbps' }
    ]
  },

  // 3. Servers & Storage
  {
    category: 'server',
    name: 'Enterprise Rack Server 2U',
    vendor: 'Dell',
    model: 'PowerEdge R760',
    defaultUHeight: 2,
    powerWatts: 750,
    weightKg: 28.5,
    defaultWidth: 150,
    defaultHeight: 64,
    color: '#475569', // slate-600
    iconName: 'Cpu',
    description: 'Dual Intel Xeon Scalable, 512GB RAM, 8x NVMe, Dual 10GbE',
    defaultPorts: [
      { name: 'NIC1_LAN', type: 'RJ45_10G' as PortType, speed: '10 Gbps' },
      { name: 'NIC2_SAN', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' },
      { name: 'iDRAC_Mgmt', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      { name: 'PSU1', type: 'POWER_C13' as PortType, speed: 'Power' },
      { name: 'PSU2', type: 'POWER_C13' as PortType, speed: 'Power' }
    ]
  },
  {
    category: 'storage',
    name: 'SAN Storage Array 2U',
    vendor: 'NetApp / Synology',
    model: 'AFF A250',
    defaultUHeight: 2,
    powerWatts: 620,
    weightKg: 26.0,
    defaultWidth: 150,
    defaultHeight: 64,
    color: '#0f766e', // teal-700
    iconName: 'HardDrive',
    description: 'All-flash SAN/NAS Array with 24x SSD bays, 16G Fibre Channel & 10GbE',
    defaultPorts: [
      { name: 'FC_PortA', type: 'FIBER_LC' as PortType, speed: '16 Gbps' },
      { name: 'FC_PortB', type: 'FIBER_LC' as PortType, speed: '16 Gbps' },
      { name: 'iSCSI_1', type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' },
      { name: 'Mgmt', type: 'RJ45_1G' as PortType, speed: '1 Gbps' }
    ]
  },

  // 4. Wireless & CCTV Security
  {
    category: 'ap',
    name: 'Access Point Wi-Fi 6',
    vendor: 'Aruba / UniFi',
    model: 'UniFi U6 Enterprise',
    defaultUHeight: 0,
    powerWatts: 22,
    weightKg: 0.9,
    defaultWidth: 100,
    defaultHeight: 100,
    color: '#10b981', // emerald-500
    iconName: 'Wifi',
    description: 'Tri-band Wi-Fi 6E AP, 10.2Gbps aggregate, 2.5GbE PoE+ uplink',
    defaultPorts: [
      { name: 'Eth0_PoE', type: 'RJ45_10G' as PortType, speed: '2.5 Gbps', poe: true }
    ]
  },
  {
    category: 'camera',
    name: 'Camera Dome 4K AI',
    vendor: 'Hikvision / Axis',
    model: 'DS-2CD2186G2-ISU',
    defaultUHeight: 0,
    powerWatts: 12,
    weightKg: 0.6,
    defaultWidth: 90,
    defaultHeight: 90,
    color: '#f59e0b', // amber-500
    iconName: 'Video',
    description: '8MP 4K UltraHD Dome Camera, AcuSense AI, 30m IR, 102° FOV',
    defaultPorts: [
      { name: 'RJ45_PoE', type: 'RJ45_1G' as PortType, speed: '1 Gbps', poe: true }
    ]
  },
  {
    category: 'nvr',
    name: 'Network Video Recorder (NVR)',
    vendor: 'Hikvision',
    model: 'iDS-7732NXI-M4/16P',
    defaultUHeight: 1,
    powerWatts: 300,
    weightKg: 5.0,
    defaultWidth: 150,
    defaultHeight: 56,
    color: '#d97706', // amber-600
    iconName: 'Film',
    description: '32-ch 4K NVR with 16-port PoE built-in, 4x SATA HDDs up to 40TB',
    defaultPorts: [
      { name: 'LAN1', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `Cam_PoE_${i + 1}`, type: 'RJ45_1G' as PortType, speed: '100 Mbps', poe: true }))
    ]
  },
  {
    category: 'sensor',
    name: 'Cảm biến Nhiệt độ & Độ ẩm IoT',
    vendor: 'Advantech / Schneider',
    model: 'TH-IoT-PoE-S1',
    defaultUHeight: 0,
    powerWatts: 4,
    weightKg: 0.25,
    defaultWidth: 76,
    defaultHeight: 76,
    color: '#0d9488', // teal-600
    iconName: 'Activity',
    description: 'Cảm biến nhiệt độ, độ ẩm & môi trường phòng Server / kho lạnh kết nối PoE',
    defaultPorts: [
      { name: 'IoT_PoE', type: 'RJ45_1G' as PortType, speed: '100 Mbps', poe: true }
    ]
  },
  {
    category: 'iot',
    name: 'IoT Gateway & Điều khiển',
    vendor: 'HACHIHI IoT / Advantech',
    model: 'GW-IOT-4060',
    defaultUHeight: 0,
    powerWatts: 10,
    weightKg: 0.6,
    defaultWidth: 110,
    defaultHeight: 68,
    color: '#059669', // emerald-600
    iconName: 'Smartphone',
    description: 'Bộ thu thập & điều khiển thiết bị IoT (Modbus / MQTT / Zigbee / RJ45)',
    defaultPorts: [
      { name: 'LAN_PoE', type: 'RJ45_1G' as PortType, speed: '1 Gbps', poe: true },
      { name: 'IoT_Bus', type: 'CONSOLE' as PortType, speed: 'RS485/MQTT' }
    ]
  },

  // 5. Cabling, ODF & Patch Panels
  {
    category: 'odf',
    name: 'ODF Quang 24 Core SC/LC',
    vendor: 'HACHIHI Telecom',
    model: 'ODF-24-LC-DUPLEX',
    defaultUHeight: 1,
    powerWatts: 0,
    weightKg: 2.8,
    defaultWidth: 150,
    defaultHeight: 48,
    color: '#06b6d4', // cyan-500
    iconName: 'GitBranch',
    description: 'Hộp phối quang ODF 19" 24 adapter Duplex LC/UPC (48 sợi)',
    defaultPorts: Array.from({ length: 12 }, (_, i) => ({
      name: `LC_Port_${i + 1}`,
      type: 'FIBER_LC' as PortType,
      speed: 'Fiber'
    }))
  },
  {
    category: 'patch_panel',
    name: 'Patch Panel Cat6 24-Port',
    vendor: 'CommScope / AMP',
    model: 'AMP Cat6 24P UTP',
    defaultUHeight: 1,
    powerWatts: 0,
    weightKg: 1.5,
    defaultWidth: 150,
    defaultHeight: 48,
    color: '#64748b', // slate-500
    iconName: 'Sliders',
    description: 'Thanh đấu nối cáp mạng 24 cổng RJ45 chuẩn 19 inch 1U Cat6',
    defaultPorts: Array.from({ length: 24 }, (_, i) => ({
      name: `Port_${i + 1}`,
      type: 'RJ45_1G' as PortType,
      speed: '1 Gbps'
    }))
  },

  // 6. Power & UPS
  {
    category: 'ups',
    name: 'UPS Online 3kVA Rackmount',
    vendor: 'APC by Schneider',
    model: 'Smart-UPS RT 3000VA',
    defaultUHeight: 2,
    powerWatts: 2700,
    weightKg: 31.0,
    defaultWidth: 150,
    defaultHeight: 64,
    color: '#e11d48', // rose-600
    iconName: 'Zap',
    description: 'UPS Online chuyển đổi kép 3000VA / 2700W 230V 2U Rack/Tower',
    defaultPorts: [
      { name: 'AC_Input', type: 'POWER_C13' as PortType, speed: 'Input 230V' },
      { name: 'Out_1', type: 'POWER_C13' as PortType, speed: 'Output 230V' },
      { name: 'Out_2', type: 'POWER_C13' as PortType, speed: 'Output 230V' },
      { name: 'NMC_Mgmt', type: 'RJ45_1G' as PortType, speed: '100 Mbps' }
    ]
  },
  {
    category: 'pdu',
    name: 'Managed PDU 16-Port',
    vendor: 'APC / Vertiv',
    model: 'AP8959EU3',
    defaultUHeight: 0, // 0U vertical or 1U horizontal
    powerWatts: 15,
    weightKg: 4.2,
    defaultWidth: 140,
    defaultHeight: 40,
    color: '#9333ea', // purple-600
    iconName: 'Power',
    description: 'Thanh phân phối nguồn PDU quản lý từ xa qua mạng',
    defaultPorts: [
      { name: 'Feed_In', type: 'POWER_C13' as PortType, speed: 'Power' },
      { name: 'Ethernet', type: 'RJ45_1G' as PortType, speed: '100 Mbps' }
    ]
  },
  {
    category: 'ups',
    name: 'UPS Vertiv Emerson GXT5 3kVA',
    vendor: 'Vertiv / Emerson',
    model: 'Liebert GXT5-3000IRT2UXL',
    defaultUHeight: 2,
    powerWatts: 3000,
    weightKg: 28.5,
    defaultWidth: 150,
    defaultHeight: 64,
    color: '#be123c', // rose-700
    iconName: 'Zap',
    description: 'UPS Online Vertiv Emerson 3000VA/3000W hệ số công suất 1.0 cho phòng Server',
    defaultPorts: [
      { name: 'AC_In', type: 'POWER_C13' as PortType, speed: 'Input 230V' },
      { name: 'Out_Group_1', type: 'POWER_C13' as PortType, speed: 'Output 230V' },
      { name: 'RDU101_Mgmt', type: 'RJ45_1G' as PortType, speed: '1 Gbps' }
    ]
  },

  // 6b. Vietnam Market Standard Gear (MikroTik, Ruijie, H3C, TP-Link Omada, Dahua, Uniview)
  {
    category: 'router',
    name: 'Router MikroTik CCR2004',
    vendor: 'MikroTik',
    model: 'CCR2004-1G-12S+2XS',
    defaultUHeight: 1,
    powerWatts: 49,
    weightKg: 2.1,
    defaultWidth: 150,
    defaultHeight: 54,
    color: '#2563eb', // blue-600
    iconName: 'Router',
    description: 'Router Cloud Core MikroTik 12x 10G SFP+ & 2x 25G SFP28 chịu tải cao',
    defaultPorts: [
      { name: 'ether1', type: 'RJ45_1G' as PortType, speed: '1 Gbps' },
      ...Array.from({ length: 4 }, (_, i) => ({ name: `sfp-sfpplus${i + 1}`, type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' })),
      { name: 'sfp28-1', type: 'QSFP28_100G' as PortType, speed: '25 Gbps' }
    ]
  },
  {
    category: 'router',
    name: 'Router MikroTik hEX RB750Gr3',
    vendor: 'MikroTik',
    model: 'hEX RB750Gr3',
    defaultUHeight: 1,
    powerWatts: 10,
    weightKg: 0.4,
    defaultWidth: 120,
    defaultHeight: 46,
    color: '#1d4ed8', // blue-700
    iconName: 'Router',
    description: 'Router VPN/PPPoE 5 cổng Gigabit nhỏ gọn phổ biến cho văn phòng & chi nhánh',
    defaultPorts: Array.from({ length: 5 }, (_, i) => ({
      name: `ether${i + 1}`,
      type: 'RJ45_1G' as PortType,
      speed: '1 Gbps'
    }))
  },
  {
    category: 'switch',
    name: 'Switch Ruijie 24P PoE+ 4x10G',
    vendor: 'Ruijie',
    model: 'RG-NBS3200-24GT4XS-P',
    defaultUHeight: 1,
    powerWatts: 370,
    weightKg: 4.5,
    defaultWidth: 150,
    defaultHeight: 54,
    color: '#0284c7',
    iconName: 'Server',
    description: 'Switch Ruijie Reyee Cloud L2+ 24x 1G PoE+ (370W) + 4x 10G SFP+ Uplink',
    defaultPorts: [
      ...Array.from({ length: 24 }, (_, i) => ({ name: `Gi0/${i + 1}`, type: 'RJ45_1G' as PortType, speed: '1 Gbps', poe: true })),
      ...Array.from({ length: 4 }, (_, i) => ({ name: `Te0/${25 + i}`, type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' }))
    ]
  },
  {
    category: 'switch',
    name: 'Switch H3C S5130S 24P PoE+',
    vendor: 'H3C',
    model: 'S5130S-28P-PWR-EI',
    defaultUHeight: 1,
    powerWatts: 380,
    weightKg: 5.2,
    defaultWidth: 150,
    defaultHeight: 54,
    color: '#0369a1',
    iconName: 'Server',
    description: 'Switch doanh nghiệp H3C 24x GE PoE+ + 4x SFP 1G/10G ổn định chuẩn TCVN',
    defaultPorts: [
      ...Array.from({ length: 24 }, (_, i) => ({ name: `GE1/0/${i + 1}`, type: 'RJ45_1G' as PortType, speed: '1 Gbps', poe: true })),
      ...Array.from({ length: 4 }, (_, i) => ({ name: `XGE1/0/${25 + i}`, type: 'SFP_PLUS_10G' as PortType, speed: '10 Gbps' }))
    ]
  },
  {
    category: 'switch',
    name: 'Switch TP-Link Omada 24P PoE+',
    vendor: 'TP-Link Omada',
    model: 'TL-SG2428P',
    defaultUHeight: 1,
    powerWatts: 250,
    weightKg: 3.4,
    defaultWidth: 150,
    defaultHeight: 52,
    color: '#0ea5e9',
    iconName: 'Server',
    description: 'Switch JetStream Omada SDN 24x Gigabit PoE+ (250W) + 4x SFP',
    defaultPorts: [
      ...Array.from({ length: 24 }, (_, i) => ({ name: `Port_${i + 1}`, type: 'RJ45_1G' as PortType, speed: '1 Gbps', poe: true })),
      ...Array.from({ length: 4 }, (_, i) => ({ name: `SFP_${25 + i}`, type: 'SFP_PLUS_10G' as PortType, speed: '1 Gbps' }))
    ]
  },
  {
    category: 'camera',
    name: 'Camera IP Dahua WizMind 4MP',
    vendor: 'Dahua',
    model: 'IPC-HFW5442E-ZE',
    defaultUHeight: 0,
    powerWatts: 12,
    weightKg: 0.95,
    defaultWidth: 68,
    defaultHeight: 68,
    color: '#d97706',
    iconName: 'Video',
    description: 'Camera IP thân trụ AI WizMind ePoE hồng ngoại 50m chuẩn IP67',
    defaultPorts: [
      { name: 'PoE_LAN', type: 'RJ45_1G' as PortType, speed: '100 Mbps', poe: true }
    ]
  },
  {
    category: 'camera',
    name: 'Camera IP Uniview LightHunter',
    vendor: 'Uniview',
    model: 'IPC2124SR3-APF40',
    defaultUHeight: 0,
    powerWatts: 9,
    weightKg: 0.55,
    defaultWidth: 66,
    defaultHeight: 66,
    color: '#ea580c',
    iconName: 'Video',
    description: 'Camera IP Uniview 4MP góc quan sát 85° hồng ngoại ban đêm có màu',
    defaultPorts: [
      { name: 'PoE_LAN', type: 'RJ45_1G' as PortType, speed: '100 Mbps', poe: true }
    ]
  },

  // 7. Server Rack & Infrastructure
  {
    category: 'rack',
    name: 'Server Rack 42U Standard',
    vendor: 'HACHIHI Cabinets',
    model: 'SR-42U-600x1000',
    defaultUHeight: 42,
    powerWatts: 0,
    weightKg: 110,
    defaultWidth: 160,
    defaultHeight: 180,
    color: '#1e293b', // slate-800
    iconName: 'Box',
    description: 'Tủ rack mạng & máy chủ tiêu chuẩn 19 inch 42U, sâu 1000mm cửa lưới',
    defaultPorts: []
  },
  {
    category: 'cloud',
    name: 'Cloud / Internet WAN',
    vendor: 'VNPT / Viettel / AWS',
    model: 'Cloud Gateway',
    defaultUHeight: 0,
    powerWatts: 0,
    weightKg: 0,
    defaultWidth: 140,
    defaultHeight: 90,
    color: '#6366f1', // indigo-500
    iconName: 'Cloud',
    description: 'Đường truyền Internet Băng thông rộng / FTTH / VPN MPLS',
    defaultPorts: [
      { name: 'ISP_Link1', type: 'FIBER_LC' as PortType, speed: '1 Gbps' },
      { name: 'ISP_Link2', type: 'RJ45_1G' as PortType, speed: '1 Gbps' }
    ]
  },
  {
    category: 'telecom_tower',
    name: 'Cột phát sóng & Trục Riser',
    vendor: 'Telecom Riser',
    model: 'Riser Shaft Vertical',
    defaultUHeight: 0,
    powerWatts: 0,
    weightKg: 0,
    defaultWidth: 80,
    defaultHeight: 80,
    color: '#059669', // emerald-600
    iconName: 'Radio',
    description: 'Trục kỹ thuật đứng kết nối xuyên suốt các tầng (Vertical Riser Backbone)',
    defaultPorts: [
      { name: 'Riser_Backbone_Up', type: 'FIBER_LC' as PortType, speed: '100G' },
      { name: 'Riser_Backbone_Down', type: 'FIBER_LC' as PortType, speed: '100G' }
    ]
  }
];

export function createDeviceAssetFromPreset(preset: DevicePreset, index = 1): import('../types/infrastructure').DeviceAsset {
  const assetId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const tagNumber = String(index).padStart(4, '0');
  
  const ports: DevicePort[] = preset.defaultPorts.map((p, pIdx) => ({
    id: `port_${pIdx + 1}`,
    name: p.name,
    type: p.type,
    poe: p.poe,
    speed: p.speed,
    status: 'unlinked'
  }));

  return {
    id: assetId,
    name: `${preset.name.split(' ')[0]}-${tagNumber.slice(-2)}`,
    category: preset.category,
    vendor: preset.vendor.split(' ')[0],
    model: preset.model,
    assetTag: `AST-${tagNumber}`,
    serialNumber: `SN${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
    ipAddress: `192.168.10.${10 + index}`,
    subnetMask: '255.255.255.0',
    gateway: '192.168.10.1',
    macAddress: `00:1A:2B:${tagNumber.slice(0, 2)}:${tagNumber.slice(2, 4)}:C1`,
    vlan: '10, 20',
    status: 'online',
    powerWatts: preset.powerWatts,
    weightKg: preset.weightKg,
    cameraSpecs: preset.category === 'camera' ? {
      resolution: '4K 8MP (3840x2160)',
      lensMm: 2.8,
      fovAngle: 95,
      irDistanceMeters: 30,
      nvrChannel: 1
    } : undefined,
    wifiSpecs: preset.category === 'ap' ? {
      standard: 'Wi-Fi 6 (802.11ax)',
      bands: '2.4GHz + 5GHz',
      txPowerDbm: 22,
      coverageRadiusMeters: 18,
      channel24: 6,
      channel5: 36,
      maxClients: 250,
      ssid: 'HACHIHI-CORP-WIFI'
    } : undefined,
    upsSpecs: preset.category === 'ups' ? {
      ratedVa: Math.max(500, Math.round((preset.powerWatts || 2700) / 0.9 / 100) * 100),
      batteryAh: 9,
      batteryVoltageV: 12,
      batteryCount: 8,
      inverterEfficiency: 0.85,
      dodFactor: 0.8
    } : undefined,
    ports
  };
}

export const CATEGORY_ACCENT_COLORS: Record<string, string> = {
  core_switch: '#1E40AF',
  switch: '#1D4ED8',
  router: '#155EEF',
  gateway: '#155EEF',
  firewall: '#DC2626',
  server: '#475569',
  storage: '#475569',
  patch_panel: '#475569',
  workstation: '#475569',
  printer: '#475569',
  ap: '#16A34A',
  telecom_tower: '#16A34A',
  camera: '#7C3AED',
  nvr: '#7C3AED',
  cloud: '#0891B2',
  odf: '#0891B2',
  ups: '#E11D48',
  pdu: '#E11D48',
  electrical_panel: '#E11D48',
  sensor: '#0D9488',
  iot: '#059669',
  rack: '#1E293B',
};

export function getCategoryAccentColor(category?: string): string {
  if (!category) return '#155EEF';
  return CATEGORY_ACCENT_COLORS[category] || '#155EEF';
}

const LEGACY_AND_DEFAULT_CATALOG_COLORS = new Set([
  '#0284c7', '#0ea5e9', '#38bdf8', '#2563eb', '#dc2626', '#475569',
  '#0f766e', '#10b981', '#f59e0b', '#d97706', '#06b6d4', '#64748b',
  '#e11d48', '#9333ea', '#be123c', '#1d4ed8', '#0369a1', '#ea580c',
  '#1e293b', '#6366f1', '#059669', '#1e40af', '#155eef', '#16a34a',
  '#7c3aed', '#0891b2', '#0d9488'
]);

export function isStandardCatalogNodeColor(color?: string): boolean {
  if (!color) return true;
  return LEGACY_AND_DEFAULT_CATALOG_COLORS.has(color.trim().toLowerCase());
}

export interface CustomDevicePreset extends DevicePreset {
  id: string;
  createdAt: string;
  shortCode?: string;
}

const CUSTOM_DEVICES_STORAGE_KEY = 'hachihi_custom_devices_v1';

export function loadCustomDevicePresets(): CustomDevicePreset[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_DEVICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomDevicePresets(presets: CustomDevicePreset[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CUSTOM_DEVICES_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage quota errors
  }
}

function stripAccentForCatalog(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function searchDeviceCatalog<T extends DevicePreset>(
  presets: T[],
  query: string,
  vendorFilter = 'Tất cả',
  shortLabels: Record<string, string> = {}
): T[] {
  const normalizedQuery = stripAccentForCatalog(query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const normalizedVendor = vendorFilter && vendorFilter !== 'Tất cả' ? stripAccentForCatalog(vendorFilter) : '';

  return presets.filter(d => {
    if (normalizedVendor) {
      const vendorHaystack = stripAccentForCatalog(`${d.vendor} ${d.name} ${d.model}`);
      if (!vendorHaystack.includes(normalizedVendor)) return false;
    }
    if (terms.length === 0) return true;
    const portsText = d.defaultPorts
      .map(p => `${p.name} ${p.type} ${p.speed} ${p.poe ? 'poe' : ''}`)
      .join(' ');
    const haystack = stripAccentForCatalog(
      `${d.name} ${shortLabels[d.name] || ''} ${d.vendor} ${d.model} ${d.category} ${d.description} ${portsText} ${d.powerWatts}W`
    );
    return terms.every(term => haystack.includes(term));
  });
}


