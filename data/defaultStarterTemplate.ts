import {
  ProjectState,
  Building,
  Floor,
  Room,
  DeviceAsset,
  DiagramNode,
  CableEdge
} from '../types/infrastructure';
import { DEVICE_CATALOG, createDeviceAssetFromPreset } from './deviceCatalog';

export function createFiveStoreyBuildingProject(): ProjectState {
  const buildingId = 'bld_hachihi_main';
  const building: Building = {
    id: buildingId,
    name: 'HACHIHI Building',
    totalFloors: 5,
    basementFloors: 1,
    widthMeters: 30,
    depthMeters: 20,
    floorHeightMeters: 3.6,
    wallThicknessMm: 200,
    layoutStyle: 'rectangle'
  };

  const floors: Floor[] = [
    { id: 'flr_5', buildingId, level: 5, name: 'Tầng 5 - Văn phòng Quản lý & BOD', description: 'Ban Giám đốc, Phòng Họp VIP, Tài chính', widthMeters: 30, depthMeters: 20 },
    { id: 'flr_4', buildingId, level: 4, name: 'Tầng 4 - Phòng Kỹ thuật & R&D', description: 'Kỹ sư phần mềm, IT Support, Phòng Lab', widthMeters: 30, depthMeters: 20 },
    { id: 'flr_3', buildingId, level: 3, name: 'Tầng 3 - Khối Kinh doanh & Marketing', description: 'Sales, Marketing, Telesales mở rộng', widthMeters: 30, depthMeters: 20 },
    { id: 'flr_2', buildingId, level: 2, name: 'Tầng 2 - Kho & Vận hành Logistics', description: 'Kho kiểm thử thiết bị, đóng gói', widthMeters: 30, depthMeters: 20 },
    { id: 'flr_1', buildingId, level: 1, name: 'Tầng 1 - Sảnh Lễ tân & Showroom', description: 'Lễ tân, Showroom sản phẩm, Khu tiếp khách', widthMeters: 30, depthMeters: 20 },
    { id: 'flr_b1', buildingId, level: -1, name: 'Tầng hầm B1 - Bãi xe & Phòng Máy Biến Áp', description: 'Bãi đỗ xe nhân viên, Trạm biến áp, Máy phát', widthMeters: 30, depthMeters: 20 }
  ];

  const rooms: Room[] = [
    { id: 'rm_101', floorId: 'flr_1', name: 'Sảnh Lễ tân & Check-in', type: 'reception', x: 80, y: 80, width: 340, height: 220, color: '#f8fafc', wallThickness: 6 },
    { id: 'rm_102', floorId: 'flr_1', name: 'Phòng Server / MDF Tầng 1', type: 'server_room', x: 440, y: 80, width: 260, height: 220, color: '#f0fdf4', wallThickness: 8 },
    { id: 'rm_103', floorId: 'flr_1', name: 'Showroom Trải nghiệm Thiết bị', type: 'office', x: 80, y: 320, width: 340, height: 240, color: '#f8fafc', wallThickness: 6 },
    { id: 'rm_104', floorId: 'flr_1', name: 'Trục Kỹ thuật Điện & Mạng (Riser A)', type: 'utility_riser', x: 440, y: 320, width: 120, height: 240, color: '#fef3c7', wallThickness: 8 },
    { id: 'rm_105', floorId: 'flr_1', name: 'Phòng Họp Khách Hàng', type: 'meeting', x: 580, y: 320, width: 220, height: 240, color: '#f8fafc', wallThickness: 6 }
  ];

  const assets: Record<string, DeviceAsset> = {};
  const nodes: DiagramNode[] = [];
  const cables: CableEdge[] = [];

  const corePreset = DEVICE_CATALOG.find(d => d.category === 'core_switch')!;
  const coreAsset = createDeviceAssetFromPreset(corePreset, 1);
  coreAsset.name = 'SW-CORE-HACHIHI';
  coreAsset.ipAddress = '10.10.0.1';
  coreAsset.buildingId = buildingId;
  coreAsset.floorId = 'flr_1';
  coreAsset.roomId = 'rm_102';
  coreAsset.rackId = 'rack_mdf_01';
  coreAsset.rackUnitStart = 40;
  coreAsset.rackUnitHeight = 1;
  assets[coreAsset.id] = coreAsset;

  const coreNode: DiagramNode = {
    id: 'node_core_sw',
    diagramMode: 'floorplan',
    floorId: 'flr_1',
    type: 'device',
    assetId: coreAsset.id,
    label: coreAsset.name,
    x: 480,
    y: 130,
    width: 170,
    height: 60,
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
  };
  nodes.push(coreNode);

  const swPreset = DEVICE_CATALOG.find(d => d.model.includes('C9300'))!;
  const swAsset = createDeviceAssetFromPreset(swPreset, 2);
  swAsset.name = 'SW-ACCESS-FL01';
  swAsset.ipAddress = '10.10.1.2';
  swAsset.buildingId = buildingId;
  swAsset.floorId = 'flr_1';
  swAsset.roomId = 'rm_102';
  swAsset.rackId = 'rack_mdf_01';
  swAsset.rackUnitStart = 36;
  swAsset.rackUnitHeight = 1;
  assets[swAsset.id] = swAsset;

  const swNode: DiagramNode = {
    id: 'node_sw_fl01',
    diagramMode: 'floorplan',
    floorId: 'flr_1',
    type: 'device',
    assetId: swAsset.id,
    label: swAsset.name,
    x: 480,
    y: 210,
    width: 170,
    height: 60,
    rotation: 0,
    style: {
      backgroundColor: '#0ea5e9',
      borderColor: '#0284c7',
      borderWidth: 2,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#ffffff',
      iconColor: '#ffffff'
    }
  };
  nodes.push(swNode);

  const apPreset = DEVICE_CATALOG.find(d => d.category === 'ap')!;
  const apAsset = createDeviceAssetFromPreset(apPreset, 3);
  apAsset.name = 'AP-RECEPTION-01';
  apAsset.ipAddress = '10.10.1.21';
  apAsset.buildingId = buildingId;
  apAsset.floorId = 'flr_1';
  apAsset.roomId = 'rm_101';
  assets[apAsset.id] = apAsset;

  const apNode: DiagramNode = {
    id: 'node_ap_rec',
    diagramMode: 'floorplan',
    floorId: 'flr_1',
    type: 'device',
    assetId: apAsset.id,
    label: apAsset.name,
    x: 200,
    y: 160,
    width: 90,
    height: 80,
    rotation: 0,
    style: {
      backgroundColor: '#10b981',
      borderColor: '#059669',
      borderWidth: 2,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#ffffff',
      iconColor: '#ffffff'
    }
  };
  nodes.push(apNode);

  const camPreset = DEVICE_CATALOG.find(d => d.category === 'camera')!;
  const camAsset = createDeviceAssetFromPreset(camPreset, 4);
  camAsset.name = 'CAM-DOOR-01';
  camAsset.ipAddress = '10.10.100.11';
  camAsset.buildingId = buildingId;
  camAsset.floorId = 'flr_1';
  camAsset.roomId = 'rm_101';
  assets[camAsset.id] = camAsset;

  const camNode: DiagramNode = {
    id: 'node_cam_door',
    diagramMode: 'floorplan',
    floorId: 'flr_1',
    type: 'device',
    assetId: camAsset.id,
    label: camAsset.name,
    x: 100,
    y: 100,
    width: 80,
    height: 70,
    rotation: 45,
    style: {
      backgroundColor: '#f59e0b',
      borderColor: '#d97706',
      borderWidth: 2,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#ffffff',
      iconColor: '#ffffff'
    }
  };
  nodes.push(camNode);

  const riserNode: DiagramNode = {
    id: 'node_riser_shaft',
    diagramMode: 'floorplan',
    floorId: 'flr_1',
    type: 'riser',
    label: 'TRỤC KỸ THUẬT (RISER)',
    x: 460,
    y: 360,
    width: 80,
    height: 80,
    rotation: 0,
    style: {
      backgroundColor: '#fef3c7',
      borderColor: '#f59e0b',
      borderWidth: 3,
      borderStyle: 'dashed',
      opacity: 0.9,
      textColor: '#78350f',
      iconColor: '#b45309'
    }
  };
  nodes.push(riserNode);

  const mdfRackNode: DiagramNode = {
    id: 'node_rack_mdf_01',
    diagramMode: 'rack',
    floorId: 'flr_1',
    type: 'rack',
    label: 'Rack MDF-01 (42U Server Room)',
    x: 340,
    y: 40,
    width: 320,
    height: 660,
    rotation: 0,
    style: {
      backgroundColor: '#0f172a',
      borderColor: '#334155',
      borderWidth: 3,
      borderStyle: 'solid',
      opacity: 1,
      textColor: '#f8fafc'
    },
    customData: {
      rackId: 'rack_mdf_01',
      totalUnits: 42
    }
  };
  nodes.push(mdfRackNode);

  cables.push({
    id: 'cab_core_sw',
    cableCode: 'FIB-F1-001',
    diagramMode: 'floorplan',
    sourceNodeId: coreNode.id,
    sourcePortId: 'port_1',
    targetNodeId: swNode.id,
    targetPortId: 'port_25',
    cableType: 'FIBER_SM_OS2',
    bandwidth: '10G',
    color: '#0284c7',
    routingType: 'orthogonal',
    lineStyle: 'solid',
    strokeWidth: 3,
    lengthMeters: 2.5,
    vlan: 'TRUNK (10,20,100)',
    status: 'active'
  });

  cables.push({
    id: 'cab_sw_ap',
    cableCode: 'UTP-F1-012',
    diagramMode: 'floorplan',
    sourceNodeId: swNode.id,
    sourcePortId: 'port_1',
    targetNodeId: apNode.id,
    targetPortId: 'port_1',
    cableType: 'CAT6_UTP',
    bandwidth: '1G',
    color: '#10b981',
    routingType: 'orthogonal',
    lineStyle: 'solid',
    strokeWidth: 2,
    lengthMeters: 28.0,
    vlan: 'VLAN 20 (Wi-Fi)',
    status: 'active'
  });

  cables.push({
    id: 'cab_sw_cam',
    cableCode: 'UTP-F1-015',
    diagramMode: 'floorplan',
    sourceNodeId: swNode.id,
    sourcePortId: 'port_2',
    targetNodeId: camNode.id,
    targetPortId: 'port_1',
    cableType: 'CAT6_UTP',
    bandwidth: '1G',
    color: '#f59e0b',
    routingType: 'orthogonal',
    lineStyle: 'solid',
    strokeWidth: 2,
    lengthMeters: 34.5,
    vlan: 'VLAN 100 (CCTV)',
    status: 'active'
  });

  return {
    id: 'proj_hachihi_v3',
    name: 'HACHIHI Corporate Infrastructure 2026',
    author: 'Chief Systems Architect',
    version: '3.0.0',
    lastModified: new Date().toISOString(),
    buildings: [building],
    floors,
    rooms,
    racks: [
      {
        id: 'rack_mdf_01',
        name: 'Rack MDF-01 (42U Server Room)',
        buildingId,
        floorId: 'flr_1',
        roomId: 'rm_102',
        totalUnits: 42,
        widthMm: 800,
        depthMm: 1000,
        maxLoadKg: 1200,
        x: 460,
        y: 110,
        slots: {
          40: coreAsset.id,
          36: swAsset.id
        }
      }
    ],
    assets,
    nodes,
    cables,
    activeMode: 'floorplan',
    activeBuildingId: buildingId,
    activeFloorId: 'flr_1',
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
