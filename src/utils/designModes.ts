import { DesignMode } from '../types/infrastructure';

export type DesignModeGroupId = 'logic' | 'physical' | 'subsystem';

export interface DesignModeMeta {
  id: DesignMode;
  group: DesignModeGroupId;
  groupLabel: string;
  label: string;
  shortLabel: string;
  description: string;
}

export const DESIGN_MODE_GROUPS: Array<{ id: DesignModeGroupId; label: string }> = [
  { id: 'logic', label: 'Logic' },
  { id: 'physical', label: 'Vật lý' },
  { id: 'subsystem', label: 'Hệ thống phụ' }
];

export const DESIGN_MODES: DesignModeMeta[] = [
  {
    id: 'topology',
    group: 'logic',
    groupLabel: 'Logic',
    label: 'Sơ đồ logic',
    shortLabel: 'Sơ đồ logic',
    description: 'Sơ đồ kết nối mạng LAN/WAN, VLAN và định tuyến'
  },
  {
    id: 'multisite',
    group: 'logic',
    groupLabel: 'Logic',
    label: 'Đa chi nhánh',
    shortLabel: 'Đa chi nhánh',
    description: 'Kết nối WAN / SD-WAN giữa trụ sở và chi nhánh'
  },
  {
    id: 'floorplan',
    group: 'physical',
    groupLabel: 'Vật lý',
    label: 'Mặt bằng',
    shortLabel: 'Mặt bằng',
    description: 'Bố trí phòng kỹ thuật, vị trí thiết bị và tuyến cáp theo tầng'
  },
  {
    id: 'rack',
    group: 'physical',
    groupLabel: 'Vật lý',
    label: 'Tủ rack',
    shortLabel: 'Tủ rack',
    description: 'Sắp xếp thiết bị theo khe U chuẩn 19 inch'
  },
  {
    id: 'fiber',
    group: 'physical',
    groupLabel: 'Vật lý',
    label: 'Cáp quang',
    shortLabel: 'Cáp quang',
    description: 'Trục cáp quang ODF, hàn nối và đấu nối Patch Panel'
  },
  {
    id: 'cctv',
    group: 'subsystem',
    groupLabel: 'Hệ thống phụ',
    label: 'Camera',
    shortLabel: 'Camera',
    description: 'Bố trí Camera IP, góc quét FOV và đầu ghi NVR'
  },
  {
    id: 'wifi',
    group: 'subsystem',
    groupLabel: 'Hệ thống phụ',
    label: 'Wi-Fi',
    shortLabel: 'Wi-Fi',
    description: 'Quy hoạch vùng phủ sóng và bán kính phát Wi-Fi'
  },
  {
    id: 'electrical',
    group: 'subsystem',
    groupLabel: 'Hệ thống phụ',
    label: 'Hệ thống điện',
    shortLabel: 'Điện & UPS',
    description: 'Cấp nguồn UPS, thanh nguồn PDU và tủ điện kỹ thuật'
  }
];

export function getDesignModeMeta(mode: DesignMode): DesignModeMeta {
  return DESIGN_MODES.find(m => m.id === mode) || DESIGN_MODES[0];
}
