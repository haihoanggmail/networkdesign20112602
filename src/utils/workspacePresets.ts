import { CanvasLayerId, DesignMode } from '../types/infrastructure';

export type WorkspacePresetId =
  | 'network_design'
  | 'electrical_design'
  | 'construction'
  | 'audit_review';

export interface WorkspacePresetMeta {
  id: WorkspacePresetId;
  label: string;
  shortLabel: string;
  description: string;
  targetMode?: DesignMode;
  unhideLayers: CanvasLayerId[];
  hideLayers?: CanvasLayerId[];
  showGrid?: boolean;
  showIpAddresses?: boolean;
  showCableCodes?: boolean;
  preferredRightTab: 'inspector' | 'power';
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export const WORKSPACE_PRESET_STORAGE_KEY = 'hachihi_workspace_preset_v1';

export const WORKSPACE_PRESETS: WorkspacePresetMeta[] = [
  {
    id: 'network_design',
    label: 'Thiết kế mạng',
    shortLabel: 'Mạng',
    description: 'Ưu tiên sơ đồ logic, địa chỉ IP/VLAN, switch & định tuyến cáp.',
    targetMode: 'topology',
    unhideLayers: ['network', 'cables', 'cable_labels', 'rooms'],
    showIpAddresses: true,
    showCableCodes: true,
    preferredRightTab: 'inspector',
    leftCollapsed: false,
    rightCollapsed: false
  },
  {
    id: 'electrical_design',
    label: 'Thiết kế điện',
    shortLabel: 'Điện',
    description: 'Tập trung nguồn AC, UPS/PDU, bảng tính PoE và dự phòng mất điện.',
    targetMode: 'electrical',
    unhideLayers: ['electrical', 'cables', 'cable_labels'],
    showCableCodes: true,
    preferredRightTab: 'power',
    leftCollapsed: false,
    rightCollapsed: false
  },
  {
    id: 'construction',
    label: 'Thi công',
    shortLabel: 'Thi công',
    description: 'Mặt bằng kiến trúc, lưới tọa độ chuẩn, mã cáp & vị trí lắp đặt.',
    targetMode: 'floorplan',
    unhideLayers: ['network', 'iot', 'electrical', 'trays', 'racks', 'cables', 'cable_labels', 'rooms', 'labels'],
    showGrid: true,
    showCableCodes: true,
    preferredRightTab: 'inspector',
    leftCollapsed: false,
    rightCollapsed: false
  },
  {
    id: 'audit_review',
    label: 'Kiểm tra kỹ thuật',
    shortLabel: 'Kiểm tra',
    description: 'Mở rộng vùng nhìn bản vẽ, hiện đủ lớp để rà soát lỗi & xuất hồ sơ.',
    unhideLayers: ['network', 'iot', 'electrical', 'trays', 'racks', 'cables', 'cable_labels', 'rooms', 'labels'],
    showIpAddresses: true,
    showCableCodes: true,
    preferredRightTab: 'inspector',
    leftCollapsed: true,
    rightCollapsed: false
  }
];

export function getWorkspacePresetMeta(id: WorkspacePresetId): WorkspacePresetMeta {
  return WORKSPACE_PRESETS.find(p => p.id === id) || WORKSPACE_PRESETS[0];
}

export function computeNextHiddenLayersForPreset(
  currentHiddenLayers: CanvasLayerId[] | undefined,
  preset: WorkspacePresetMeta
): CanvasLayerId[] {
  const next = new Set<CanvasLayerId>(currentHiddenLayers || []);
  for (const layerId of preset.unhideLayers) {
    next.delete(layerId);
  }
  if (preset.hideLayers) {
    for (const layerId of preset.hideLayers) {
      next.add(layerId);
    }
  }
  return Array.from(next);
}

export function loadSavedWorkspacePresetId(): WorkspacePresetId {
  if (typeof window === 'undefined' || !window.localStorage) return 'network_design';
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PRESET_STORAGE_KEY);
    if (WORKSPACE_PRESETS.some(p => p.id === raw)) {
      return raw as WorkspacePresetId;
    }
  } catch {
    // Ignore storage errors
  }
  return 'network_design';
}

export function saveWorkspacePresetId(id: WorkspacePresetId): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(WORKSPACE_PRESET_STORAGE_KEY, id);
  } catch {
    // Ignore storage errors
  }
}
