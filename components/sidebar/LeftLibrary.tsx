import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DesignMode, DeviceCategory, ProjectState } from '../../types/infrastructure';
import {
  DEVICE_CATALOG,
  DevicePreset,
  CustomDevicePreset,
  getCategoryAccentColor,
  loadCustomDevicePresets,
  saveCustomDevicePresets,
  searchDeviceCatalog
} from '../../data/deviceCatalog';
import { CUSTOM_DEVICES_UPDATED_EVENT } from '../../utils/projectPackage';
import { matchesAccentInsensitiveQuery } from '../../utils/helpCatalog';
import { ISOMETRIC_ICON_OPTIONS } from '../../utils/deviceIcons';
import { canInsertIn3DScene } from '../../utils/layerPolicy';
import {
  Search,
  Layers,
  Server,
  Router,
  Shield,
  Wifi,
  Video,
  Cpu,
  Box,
  Plus,
  GitBranch,
  Zap,
  HardDrive,
  Radio,
  Cloud,
  ChevronsLeft,
  ChevronsRight,
  Square,
  Sliders,
  Film,
  Power,
  Star,
  LayoutGrid,
  List,
  Type,
  Table2,
  Circle,
  RectangleHorizontal,
  Minus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
  Monitor,
  Printer,
  CircuitBoard,
  Pin,
  X
} from 'lucide-react';

interface LeftLibraryProps {
  project: ProjectState;
  onAddDevice: (presetName: string, x?: number, y?: number) => void;
  onAddCustomDevice?: (preset: CustomDevicePreset, x?: number, y?: number) => void;
  onAddTextNode?: (x?: number, y?: number) => void;
  onAddShapeNode?: (kind: 'zone' | 'rect' | 'circle' | 'wall', x?: number, y?: number) => void;
  onGenerateLegend?: () => void;
  onAddRack: () => void;
  onPlaceExistingAsset?: (assetId: string, x?: number, y?: number) => void;
  onDragPresetChange?: (presetName: string | null) => void;
  canvasCenter?: { x: number; y: number };
  widthPx?: number;
  isOverlayDrawer?: boolean;
  onCloseDrawer?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: (nextCollapsed: boolean) => void;
  is3DView?: boolean;
  is3DDragLocked?: boolean;
  isReadOnlyMode?: boolean;
}

type LibraryTab = 'catalog' | 'project' | 'favorites' | 'custom';

type CategoryGroupId =
  | 'network'
  | 'server_rack'
  | 'camera_security'
  | 'wifi'
  | 'cables_acc'
  | 'electrical'
  | 'symbols';

interface CategoryGroupMeta {
  id: CategoryGroupId;
  label: string;
  categories: DeviceCategory[];
}

const CATEGORY_GROUPS: CategoryGroupMeta[] = [
  { id: 'network', label: 'Thiết bị mạng', categories: ['core_switch', 'switch', 'router', 'gateway', 'firewall'] },
  { id: 'server_rack', label: 'Server & Rack', categories: ['server', 'storage', 'rack'] },
  { id: 'camera_security', label: 'Camera & an ninh', categories: ['camera', 'nvr'] },
  { id: 'wifi', label: 'Wi-Fi', categories: ['ap', 'telecom_tower'] },
  { id: 'cables_acc', label: 'Cáp & phụ kiện', categories: ['odf', 'patch_panel', 'cloud', 'workstation', 'printer'] },
  { id: 'electrical', label: 'Thiết bị điện', categories: ['electrical_panel', 'ups', 'pdu', 'iot', 'sensor'] },
  { id: 'symbols', label: 'Ký hiệu & hình vẽ', categories: [] }
];

const MODE_RECOMMENDED_GROUPS: Record<DesignMode, CategoryGroupId[]> = {
  topology: ['network', 'server_rack', 'cables_acc'],
  multisite: ['network', 'cables_acc', 'symbols'],
  floorplan: ['wifi', 'camera_security', 'symbols'],
  rack: ['server_rack', 'network', 'electrical'],
  fiber: ['cables_acc', 'network'],
  cctv: ['camera_security', 'network', 'electrical'],
  wifi: ['wifi', 'symbols'],
  electrical: ['electrical', 'server_rack']
};

const SHORT_LABELS: Record<string, string> = {
  'Core Switch 32x 100G': 'Core SW',
  'Access Switch 24-PoE+': 'PoE SW',
  'Distribution Switch 48-Port': 'Dist 48P',
  'WAN Edge Router': 'Router',
  'Next-Gen Firewall HA': 'Firewall',
  'Enterprise Rack Server 2U': 'Server 2U',
  'SAN Storage Array 2U': 'SAN 2U',
  'Access Point Wi-Fi 6': 'Wi-Fi 6',
  'Camera Dome 4K AI': 'Cam 4K',
  'Network Video Recorder (NVR)': 'NVR',
  'Cảm biến Nhiệt độ & Độ ẩm IoT': 'Cảm biến IoT',
  'IoT Gateway & Điều khiển': 'IoT GW',
  'ODF Quang 24 Core SC/LC': 'ODF 24C',
  'Patch Panel Cat6 24-Port': 'Patch 24P',
  'UPS Online 3kVA Rackmount': 'UPS 2U',
  'Managed PDU 16-Port': 'PDU',
  'UPS Vertiv Emerson GXT5 3kVA': 'UPS Vertiv',
  'Router MikroTik CCR2004': 'CCR2004',
  'Router MikroTik hEX RB750Gr3': 'hEX RB750',
  'Switch Ruijie 24P PoE+ 4x10G': 'Ruijie 24P',
  'Switch H3C S5130S 24P PoE+': 'H3C 24P',
  'Switch TP-Link Omada 24P PoE+': 'Omada 24P',
  'Camera IP Dahua WizMind 4MP': 'Dahua 4MP',
  'Camera IP Uniview LightHunter': 'UNV 4MP',
  'Server Rack 42U Standard': 'Rack 42U',
  'Cloud / Internet WAN': 'Cloud WAN',
  'Cột phát sóng & Trục Riser': 'Trục Riser'
};

const VENDOR_FILTERS = [
  'Tất cả',
  'Cisco',
  'MikroTik',
  'Aruba',
  'Fortinet',
  'Hikvision',
  'TP-Link',
  'Ruijie',
  'Dell',
  'APC'
] as const;

type QuickCategoryFilterId =
  | 'all'
  | 'router'
  | 'switch'
  | 'firewall'
  | 'server'
  | 'camera'
  | 'ap'
  | 'ups';

const QUICK_CATEGORY_FILTERS: Array<{
  id: QuickCategoryFilterId;
  label: string;
  categories: DeviceCategory[];
}> = [
  { id: 'all', label: 'Tất cả', categories: [] },
  { id: 'router', label: 'Router', categories: ['router', 'gateway'] },
  { id: 'switch', label: 'Switch', categories: ['switch', 'core_switch'] },
  { id: 'firewall', label: 'Firewall', categories: ['firewall'] },
  { id: 'server', label: 'Server', categories: ['server', 'storage', 'rack'] },
  { id: 'camera', label: 'Camera', categories: ['camera', 'nvr'] },
  { id: 'ap', label: 'AP', categories: ['ap'] },
  { id: 'ups', label: 'UPS', categories: ['ups', 'pdu', 'electrical_panel'] }
];

function resolveIsometricImageForCategory(category: DeviceCategory): string | null {
  switch (category) {
    case 'router':
    case 'gateway':
    case 'firewall':
      return ISOMETRIC_ICON_OPTIONS.find(o => o.id === 'iso_router_firewall')?.imageSrc || null;
    case 'switch':
    case 'core_switch':
    case 'odf':
      return ISOMETRIC_ICON_OPTIONS.find(o => o.id === 'iso_switch_network')?.imageSrc || null;
    case 'patch_panel':
      return ISOMETRIC_ICON_OPTIONS.find(o => o.id === 'iso_patch_panel')?.imageSrc || null;
    case 'server':
    case 'storage':
    case 'rack':
    case 'nvr':
      return ISOMETRIC_ICON_OPTIONS.find(o => o.id === 'iso_server_rack')?.imageSrc || null;
    case 'ups':
    case 'pdu':
    case 'electrical_panel':
      return ISOMETRIC_ICON_OPTIONS.find(o => o.id === 'iso_ups_unit')?.imageSrc || null;
    default:
      return null;
  }
}

const FAVORITES_STORAGE_KEY = 'hachihi_favorite_devices_v1';
const RECENTS_STORAGE_KEY = 'hachihi_recent_devices_v1';
const VIEW_MODE_STORAGE_KEY = 'hachihi_library_view_v1';
const PINNED_GROUPS_STORAGE_KEY = 'hachihi_library_pinned_groups_v1';
const OPEN_GROUPS_STORAGE_KEY = 'hachihi_library_open_groups_v1';

const DEFAULT_FAVORITES = [
  'Core Switch 32x 100G',
  'Access Switch 24-PoE+',
  'WAN Edge Router',
  'Next-Gen Firewall HA'
];

interface SymbolBlockItem {
  id: string;
  label: string;
  sub: string;
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
  action: 'rack' | 'zone' | 'text' | 'rect' | 'circle' | 'wall' | 'legend';
}

const SYMBOL_ITEMS: SymbolBlockItem[] = [
  {
    id: 'sym_rack',
    label: 'Tủ Rack 42U',
    sub: 'Chuẩn 19 inch',
    keywords: 'tu rack 42u cabinet 19 inch',
    icon: Box,
    accentClass: 'text-slate-700 dark:text-slate-200',
    action: 'rack'
  },
  {
    id: 'sym_zone',
    label: 'Vùng VLAN / Khu vực',
    sub: 'Khoanh vùng mạng',
    keywords: 'vung vlan phong khu vuc zone',
    icon: RectangleHorizontal,
    accentClass: 'text-[#155EEF] dark:text-blue-400',
    action: 'zone'
  },
  {
    id: 'sym_wall',
    label: 'Vách ngăn / Tường',
    sub: 'Tường kỹ thuật',
    keywords: 'tuong vach ngan wall kien truc',
    icon: Minus,
    accentClass: 'text-slate-700 dark:text-slate-300',
    action: 'wall'
  },
  {
    id: 'sym_text',
    label: 'Ghi chú văn bản',
    sub: 'Nhãn chú thích (T)',
    keywords: 'chu ghi chu van ban text label',
    icon: Type,
    accentClass: 'text-slate-600 dark:text-slate-300',
    action: 'text'
  },
  {
    id: 'sym_rect',
    label: 'Khối chữ nhật',
    sub: 'Khối chức năng',
    keywords: 'hinh chu nhat block rect',
    icon: Square,
    accentClass: 'text-slate-500 dark:text-slate-400',
    action: 'rect'
  },
  {
    id: 'sym_circle',
    label: 'Khối tròn',
    sub: 'Điểm tập trung',
    keywords: 'hinh tron circle node',
    icon: Circle,
    accentClass: 'text-slate-500 dark:text-slate-400',
    action: 'circle'
  },
  {
    id: 'sym_legend',
    label: 'Bảng chú giải',
    sub: 'Ký hiệu & cáp (L)',
    keywords: 'bang chu giai legend ky hieu',
    icon: Table2,
    accentClass: 'text-[#155EEF] dark:text-blue-400',
    action: 'legend'
  }
];

function buildInitialOpenGroups(mode: DesignMode): Record<CategoryGroupId, boolean> {
  const defaults = new Set(MODE_RECOMMENDED_GROUPS[mode] || ['network', 'server_rack']);
  try {
    const raw = localStorage.getItem(OPEN_GROUPS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<CategoryGroupId, boolean>>;
      if (parsed && typeof parsed === 'object') {
        return {
          network: typeof parsed.network === 'boolean' ? parsed.network : defaults.has('network'),
          server_rack: typeof parsed.server_rack === 'boolean' ? parsed.server_rack : defaults.has('server_rack'),
          camera_security:
            typeof parsed.camera_security === 'boolean'
              ? parsed.camera_security
              : defaults.has('camera_security'),
          wifi: typeof parsed.wifi === 'boolean' ? parsed.wifi : defaults.has('wifi'),
          cables_acc: typeof parsed.cables_acc === 'boolean' ? parsed.cables_acc : defaults.has('cables_acc'),
          electrical: typeof parsed.electrical === 'boolean' ? parsed.electrical : defaults.has('electrical'),
          symbols: typeof parsed.symbols === 'boolean' ? parsed.symbols : true
        };
      }
    }
  } catch {
    // ignore storage errors
  }
  return {
    network: defaults.has('network'),
    server_rack: defaults.has('server_rack'),
    camera_security: defaults.has('camera_security'),
    wifi: defaults.has('wifi'),
    cables_acc: defaults.has('cables_acc'),
    electrical: defaults.has('electrical'),
    symbols: defaults.has('symbols')
  };
}

export const LeftLibrary: React.FC<LeftLibraryProps> = React.memo(({
  project,
  onAddDevice,
  onAddCustomDevice,
  onAddTextNode,
  onAddShapeNode,
  onGenerateLegend,
  onAddRack,
  onPlaceExistingAsset,
  onDragPresetChange,
  canvasCenter = { x: 450, y: 250 },
  widthPx = 272,
  isOverlayDrawer = false,
  onCloseDrawer,
  isCollapsed,
  onToggleCollapse,
  is3DView = false,
  is3DDragLocked = true,
  isReadOnlyMode = false
}) => {
  const [activeTab, setActiveTab] = useState<LibraryTab>('catalog');
  const [projectAssetSearch, setProjectAssetSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<string>('Tất cả');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<QuickCategoryFilterId>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isSidebarCollapsed = typeof isCollapsed === 'boolean' ? isCollapsed : internalCollapsed;
  const setSidebarCollapsed = React.useCallback(
    (next: boolean) => {
      if (typeof isCollapsed !== 'boolean') {
        setInternalCollapsed(next);
      }
      onToggleCollapse?.(next);
    },
    [isCollapsed, onToggleCollapse]
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [pinnedGroups, setPinnedGroups] = useState<CategoryGroupId[]>(() => {
    try {
      const raw = localStorage.getItem(PINNED_GROUPS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as CategoryGroupId[]) : [];
    } catch {
      return [];
    }
  });

  const [openGroups, setOpenGroups] = useState<Record<CategoryGroupId, boolean>>(() =>
    buildInitialOpenGroups(project.activeMode)
  );

  // Ctrl+F or custom 'hachihi:focus-library' event focuses the Library search input cleanly
  useEffect(() => {
    const focusSearchInput = () => {
      setSidebarCollapsed(false);
      setActiveTab('catalog');
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        const hasOpenDialog = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
        if (hasOpenDialog) return;
        e.preventDefault();
        focusSearchInput();
      }
    };
    const onFocusLibraryEvent = () => {
      focusSearchInput();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('hachihi:focus-library', onFocusLibraryEvent);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('hachihi:focus-library', onFocusLibraryEvent);
    };
  }, [setSidebarCollapsed]);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return DEFAULT_FAVORITES;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : DEFAULT_FAVORITES;
    } catch {
      return DEFAULT_FAVORITES;
    }
  });

  const [recents, setRecents] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [customPresets, setCustomPresets] = useState<CustomDevicePreset[]>(() => loadCustomDevicePresets());
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customVendor, setCustomVendor] = useState('Tùy chỉnh');
  const [customModel, setCustomModel] = useState('');
  const [customCategory, setCustomCategory] = useState<DeviceCategory>('switch');
  const [customPortCount, setCustomPortCount] = useState(8);
  const [customWatts, setCustomWatts] = useState(45);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      // ignore
    }
  }, [openGroups]);

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_GROUPS_STORAGE_KEY, JSON.stringify(pinnedGroups));
    } catch {
      // ignore
    }
  }, [pinnedGroups]);

  useEffect(() => {
    const handleCustomDevicesUpdated = () => {
      setCustomPresets(loadCustomDevicePresets());
    };
    window.addEventListener(CUSTOM_DEVICES_UPDATED_EVENT, handleCustomDevicesUpdated);
    return () => {
      window.removeEventListener(CUSTOM_DEVICES_UPDATED_EVENT, handleCustomDevicesUpdated);
    };
  }, []);

  const recordRecent = (name: string) => {
    setRecents(prev => {
      const next = [name, ...prev.filter(x => x !== name)].slice(0, 6);
      try {
        localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const toggleFavorite = (name: string) => {
    setFavorites(prev => {
      const next = prev.includes(name) ? prev.filter(x => x !== name) : [name, ...prev];
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const togglePinGroup = (id: CategoryGroupId) => {
    setPinnedGroups(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev];
      return next;
    });
    setOpenGroups(prev => ({ ...prev, [id]: true }));
  };

  const canInsertDevices = canInsertIn3DScene({
    is3DView,
    isSceneDragLocked: is3DDragLocked,
    isReadOnlyMode
  });
  const is3DLockedBlock = Boolean(is3DView && is3DDragLocked && !isReadOnlyMode);

  const handleAddPreset = (preset: DevicePreset | CustomDevicePreset) => {
    if (!canInsertDevices) return;
    recordRecent(preset.name);
    if ('id' in preset && onAddCustomDevice) {
      onAddCustomDevice(preset, canvasCenter.x, canvasCenter.y);
    } else {
      onAddDevice(preset.name, canvasCenter.x, canvasCenter.y);
    }
  };

  const handleTriggerSymbol = (action: SymbolBlockItem['action']) => {
    if (isReadOnlyMode) return;
    if (is3DView && (action !== 'rack' || is3DDragLocked)) return;
    switch (action) {
      case 'rack':
        onAddRack();
        break;
      case 'zone':
        onAddShapeNode?.('zone', canvasCenter.x, canvasCenter.y);
        break;
      case 'wall':
        onAddShapeNode?.('wall', canvasCenter.x, canvasCenter.y);
        break;
      case 'text':
        onAddTextNode?.(canvasCenter.x, canvasCenter.y);
        break;
      case 'rect':
        onAddShapeNode?.('rect', canvasCenter.x, canvasCenter.y);
        break;
      case 'circle':
        onAddShapeNode?.('circle', canvasCenter.x, canvasCenter.y);
        break;
      case 'legend':
        onGenerateLegend?.();
        break;
    }
  };

  const handleCreateCustomDevice = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customName.trim();
    if (!trimmed) return;
    const count = Math.max(1, Math.min(48, Number(customPortCount) || 8));
    const accent = getCategoryAccentColor(customCategory);
    const created: CustomDevicePreset = {
      id: `cust_${Date.now()}`,
      createdAt: new Date().toISOString(),
      category: customCategory,
      name: trimmed,
      shortCode: trimmed.slice(0, 10),
      vendor: customVendor.trim() || 'Tùy chỉnh',
      model: customModel.trim() || 'Model tùy chỉnh',
      defaultUHeight: customCategory === 'ap' || customCategory === 'camera' ? 0 : 1,
      powerWatts: Math.max(0, Number(customWatts) || 0),
      weightKg: 2.5,
      defaultWidth: 150,
      defaultHeight: 56,
      color: accent,
      iconName: '',
      description: `Thiết bị tùy chỉnh (${count} cổng, ${customWatts}W)`,
      defaultPorts: Array.from({ length: count }, (_, idx) => ({
        name: `Port_${idx + 1}`,
        type: 'RJ45_1G',
        speed: '1 Gbps'
      }))
    };

    const next = [created, ...customPresets];
    setCustomPresets(next);
    saveCustomDevicePresets(next);
    setCustomName('');
    setCustomModel('');
    setShowCustomForm(false);
    handleAddPreset(created);
  };

  const handleDeleteCustomPreset = (id: string) => {
    const next = customPresets.filter(p => p.id !== id);
    setCustomPresets(next);
    saveCustomDevicePresets(next);
  };

  const allPresets = useMemo<Array<DevicePreset | CustomDevicePreset>>(
    () => [...customPresets, ...DEVICE_CATALOG],
    [customPresets]
  );

  const isFiltering = Boolean(
    searchQuery.trim() || selectedVendor !== 'Tất cả' || selectedCategoryFilter !== 'all'
  );

  const filteredDevices = useMemo(() => {
    const base = searchDeviceCatalog(allPresets, searchQuery, selectedVendor, SHORT_LABELS);
    if (selectedCategoryFilter === 'all') return base;
    const catMeta = QUICK_CATEGORY_FILTERS.find(f => f.id === selectedCategoryFilter);
    if (!catMeta || catMeta.categories.length === 0) return base;
    const allowed = new Set<DeviceCategory>(catMeta.categories);
    return base.filter(item => allowed.has(item.category));
  }, [allPresets, searchQuery, selectedVendor, selectedCategoryFilter]);

  const filteredSymbols = useMemo(() => {
    if (selectedVendor !== 'Tất cả' || selectedCategoryFilter !== 'all') return [];
    const q = searchQuery.trim();
    if (!q) return SYMBOL_ITEMS;
    return SYMBOL_ITEMS.filter(sym =>
      matchesAccentInsensitiveQuery(`${sym.label} ${sym.sub} ${sym.keywords}`, q)
    );
  }, [searchQuery, selectedVendor, selectedCategoryFilter]);

  const orderedGroups = useMemo(() => {
    const bucket = new Map<CategoryGroupId, Array<DevicePreset | CustomDevicePreset>>();
    for (const g of CATEGORY_GROUPS) {
      bucket.set(g.id, []);
    }
    for (const item of filteredDevices) {
      const targetGroup = CATEGORY_GROUPS.find(g => g.categories.includes(item.category));
      if (targetGroup) {
        bucket.get(targetGroup.id)!.push(item);
      } else {
        bucket.get('cables_acc')!.push(item);
      }
    }

    const recommendedSet = new Set(MODE_RECOMMENDED_GROUPS[project.activeMode] || ['network']);
    const pinnedSet = new Set(pinnedGroups);

    const mapped = CATEGORY_GROUPS.map((g, idx) => {
      const items = bucket.get(g.id) || [];
      const count = g.id === 'symbols' ? filteredSymbols.length : items.length;
      return {
        ...g,
        items,
        count,
        isPinned: pinnedSet.has(g.id),
        isRecommended: recommendedSet.has(g.id),
        originalIndex: idx
      };
    }).filter(g => g.count > 0);

    // Pinned groups float to the top cleanly while keeping natural order otherwise
    return mapped.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return a.originalIndex - b.originalIndex;
    });
  }, [filteredDevices, filteredSymbols.length, project.activeMode, pinnedGroups]);

  const favoriteItems = useMemo(
    () => allPresets.filter(d => favorites.includes(d.name)),
    [allPresets, favorites]
  );

  const recentItems = useMemo(
    () =>
      recents
        .map(name => allPresets.find(d => d.name === name))
        .filter((x): x is DevicePreset | CustomDevicePreset => Boolean(x)),
    [allPresets, recents]
  );

  const projectAssetsList = useMemo(() => {
    const assets = Object.values(project.assets || {});
    const q = projectAssetSearch.trim();
    const filtered = q
      ? assets.filter(a =>
          matchesAccentInsensitiveQuery(`${a.name} ${a.vendor} ${a.model} ${a.ipAddress || ''} ${a.category}`, q)
        )
      : assets;

    return filtered
      .map(asset => {
        const assetNodes = project.nodes.filter(n => n.assetId === asset.id);
        const onCurrentView = assetNodes.some(n => {
          if (n.diagramMode !== project.activeMode) return false;
          if (!project.activeFloorId) return true;
          return !n.floorId || n.floorId === project.activeFloorId;
        });
        const rackHost = asset.rackId
          ? project.racks.find(r => r.id === asset.rackId)
          : project.racks.find(
              r =>
                Object.values(r.slots || {}).includes(asset.id) ||
                Object.values(r.rearSlots || {}).includes(asset.id)
            );

        const locationTags: string[] = [];
        if (rackHost) {
          locationTags.push(`Rack ${rackHost.name}`);
        }
        const modes = Array.from(new Set(assetNodes.map(n => n.diagramMode)));
        for (const mode of modes) {
          locationTags.push(mode === 'topology' ? 'Logic' : mode === 'floorplan' ? 'Mặt bằng' : mode);
        }

        return {
          asset,
          onCurrentView,
          nodeCount: assetNodes.length,
          locationTags
        };
      })
      .sort((a, b) => {
        if (a.onCurrentView !== b.onCurrentView) return a.onCurrentView ? 1 : -1;
        return a.asset.name.localeCompare(b.asset.name, 'vi');
      });
  }, [project.assets, project.nodes, project.racks, project.activeMode, project.activeFloorId, projectAssetSearch]);

  const renderIcon = (cat: string, className = 'w-4 h-4') => {
    switch (cat) {
      case 'router':
      case 'gateway':
        return <Router className={className} />;
      case 'firewall':
        return <Shield className={className} />;
      case 'core_switch':
        return <Layers className={className} />;
      case 'switch':
        return <Server className={className} />;
      case 'server':
        return <Cpu className={className} />;
      case 'storage':
        return <HardDrive className={className} />;
      case 'workstation':
        return <Monitor className={className} />;
      case 'printer':
        return <Printer className={className} />;
      case 'ap':
        return <Wifi className={className} />;
      case 'camera':
        return <Video className={className} />;
      case 'nvr':
        return <Film className={className} />;
      case 'odf':
        return <GitBranch className={className} />;
      case 'patch_panel':
        return <Sliders className={className} />;
      case 'ups':
        return <Zap className={className} />;
      case 'pdu':
        return <Power className={className} />;
      case 'electrical_panel':
        return <CircuitBoard className={className} />;
      case 'rack':
        return <Box className={className} />;
      case 'cloud':
        return <Cloud className={className} />;
      case 'telecom_tower':
        return <Radio className={className} />;
      default:
        return <Server className={className} />;
    }
  };

  const formatCardSpecs = (preset: DevicePreset | CustomDevicePreset) => {
    const vendor = preset.vendor.split('/')[0].trim();
    if (preset.category === 'rack') {
      return `${vendor} · ${preset.defaultUHeight || 42}U`;
    }
    const portPart = preset.defaultPorts.length > 0 ? `${preset.defaultPorts.length}P` : '';
    const wattPart = preset.powerWatts > 0 ? `${preset.powerWatts}W` : '';
    return [vendor, portPart, wattPart].filter(Boolean).join(' · ');
  };

  const isInsertBlocked = !canInsertDevices;

  const renderDeviceCard = (preset: DevicePreset | CustomDevicePreset) => {
    const isCustom = 'id' in preset;
    const isFav = favorites.includes(preset.name);
    const shortName = isCustom
      ? preset.shortCode || preset.name
      : SHORT_LABELS[preset.name] || preset.name;
    const accent = getCategoryAccentColor(preset.category);
    const specLine = formatCardSpecs(preset);
    const tooltip = isReadOnlyMode
      ? `${preset.name} — Đang ở chế độ Chỉ xem`
      : is3DLockedBlock
      ? `${preset.name} — Mở khóa kéo 3D để kéo thả hoặc thêm vào không gian 3D`
      : is3DView
      ? `${preset.name}\n${preset.vendor} · ${preset.model}\n${preset.defaultPorts.length} cổng · ${preset.powerWatts}W\nKéo thả vào không gian 3D hoặc nhấp đúp để thêm`
      : `${preset.name}\n${preset.vendor} · ${preset.model}\n${preset.defaultPorts.length} cổng · ${preset.powerWatts}W\nKéo thả vào bản vẽ hoặc nhấp đúp`;

    if (viewMode === 'list') {
      return (
        <div
          key={isCustom ? preset.id : preset.name}
          draggable={!isCustom && !isInsertBlocked}
          onDragStart={
            !isCustom && !isInsertBlocked
              ? e => {
                  e.dataTransfer.setData('text/plain', preset.name);
                  e.dataTransfer.setData('presetName', preset.name);
                  e.dataTransfer.effectAllowed = 'copy';
                  recordRecent(preset.name);
                  onDragPresetChange?.(preset.name);
                }
              : undefined
          }
          onDragEnd={() => onDragPresetChange?.(null)}
          onDoubleClick={() => handleAddPreset(preset)}
          title={tooltip}
          className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors ${
            isInsertBlocked
              ? 'opacity-45 cursor-not-allowed'
              : 'hover:border-[#155EEF] hover:bg-slate-50/70 dark:hover:bg-slate-800/50 cursor-grab active:cursor-grabbing'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {(() => {
              const isoImg = resolveIsometricImageForCategory(preset.category);
              if (isoImg) {
                return (
                  <img
                    src={isoImg}
                    alt={preset.name}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-md object-contain bg-white border border-slate-200 dark:border-slate-700 p-0.5 shrink-0"
                  />
                );
              }
              return (
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: accent }}
                >
                  {renderIcon(preset.category, 'w-3.5 h-3.5')}
                </div>
              );
            })()}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                {preset.name}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
                {specLine}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                toggleFavorite(preset.name);
              }}
              aria-label="Đánh dấu yêu thích"
              className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ${
                isFav ? 'text-[#F59E0B]' : 'text-slate-300 opacity-0 group-hover:opacity-100'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
            </button>
            {isCustom && (
              <button
                type="button"
                disabled={isReadOnlyMode}
                onClick={e => {
                  e.stopPropagation();
                  handleDeleteCustomPreset(preset.id);
                }}
                aria-label="Xóa thiết bị tùy chỉnh"
                className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-[#DC2626] disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              disabled={isInsertBlocked}
              onClick={() => handleAddPreset(preset)}
              aria-label={`Thêm ${preset.name}`}
              className="p-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-[#155EEF] hover:text-white text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-slate-100 disabled:hover:text-slate-600"
              title={
                isReadOnlyMode
                  ? 'Đang ở chế độ Chỉ xem'
                  : is3DLockedBlock
                  ? 'Mở khóa kéo 3D để thêm thiết bị'
                  : is3DView
                  ? 'Thêm nhanh vào không gian 3D'
                  : 'Thêm vào giữa bản vẽ'
              }
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={isCustom ? preset.id : preset.name}
        draggable={!isCustom && !isInsertBlocked}
        onDragStart={
          !isCustom && !isInsertBlocked
            ? e => {
                e.dataTransfer.setData('text/plain', preset.name);
                e.dataTransfer.setData('presetName', preset.name);
                e.dataTransfer.effectAllowed = 'copy';
                recordRecent(preset.name);
                onDragPresetChange?.(preset.name);
              }
            : undefined
        }
        onDragEnd={() => onDragPresetChange?.(null)}
        onDoubleClick={() => handleAddPreset(preset)}
        title={tooltip}
        className={`group relative flex flex-col items-start p-2 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors select-none ${
          isInsertBlocked
            ? 'opacity-45 cursor-not-allowed'
            : 'hover:border-[#155EEF] hover:bg-slate-50/70 dark:hover:bg-slate-800/50 cursor-grab active:cursor-grabbing'
        }`}
      >
        <div className="w-full flex items-center justify-between gap-1 mb-1.5">
          {(() => {
            const isoImg = resolveIsometricImageForCategory(preset.category);
            if (isoImg) {
              return (
                <img
                  src={isoImg}
                  alt={preset.name}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-md object-contain bg-white border border-slate-200 dark:border-slate-700 p-0.5 shrink-0"
                />
              );
            }
            return (
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center text-white shrink-0"
                style={{ backgroundColor: accent }}
              >
                {renderIcon(preset.category, 'w-4 h-4')}
              </div>
            );
          })()}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                toggleFavorite(preset.name);
              }}
              aria-label="Yêu thích"
              className={`p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-opacity ${
                isFav ? 'text-[#F59E0B] opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-current' : ''}`} />
            </button>
            <button
              type="button"
              disabled={isInsertBlocked}
              onClick={e => {
                e.stopPropagation();
                handleAddPreset(preset);
              }}
              aria-label={`Thêm ${preset.name}`}
              className="p-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-[#155EEF] hover:text-white text-slate-600 dark:text-slate-300 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0"
              title={
                isReadOnlyMode
                  ? 'Đang ở chế độ Chỉ xem'
                  : is3DLockedBlock
                  ? 'Mở khóa kéo 3D để thêm thiết bị'
                  : is3DView
                  ? 'Thêm nhanh vào không gian 3D'
                  : 'Thêm nhanh lên bản vẽ'
              }
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="w-full text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
          {shortName}
        </div>
        <div className="w-full text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
          {specLine}
        </div>
      </div>
    );
  };

  // Collapsed rail strictly 48px (w-12)
  if (isSidebarCollapsed && !isOverlayDrawer) {
    return (
      <aside className="w-12 h-full flex flex-col items-center py-3 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 text-slate-500 shrink-0 select-none">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          aria-label="Mở rộng thư viện thiết bị"
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-[#155EEF]"
          title="Mở rộng thư viện thiết bị (Ctrl+F)"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className="mt-4 text-xs font-semibold text-slate-500 hover:text-[#155EEF] cursor-pointer"
          style={{ writingMode: 'vertical-rl' }}
        >
          Thư viện
        </button>
      </aside>
    );
  }

  const toggleGroup = (id: CategoryGroupId) => {
    setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside
      aria-label="Thư viện thiết bị và ký hiệu"
      style={{ width: isOverlayDrawer ? 'min(296px, 86vw)' : `${widthPx}px` }}
      className="h-full flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 shrink-0 select-none overflow-hidden"
    >
      {/* Header: Title + Collapse + 3 Priority Tabs */}
      <div className="px-3 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
            Thư viện
          </span>
          <button
            type="button"
            onClick={() => {
              if (isOverlayDrawer && onCloseDrawer) onCloseDrawer();
              else setSidebarCollapsed(true);
            }}
            aria-label="Thu gọn thư viện"
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
            title="Thu gọn sang trái"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        </div>

        {/* 4 Segmented Tabs: Danh mục | Dự án | Yêu thích | Tùy chỉnh */}
        <div className="grid grid-cols-4 gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md">
          {(
            [
              { id: 'catalog', label: 'Thư viện' },
              { id: 'project', label: 'Dự án' },
              { id: 'favorites', label: 'Đã ghim' },
              { id: 'custom', label: 'Tự tạo' }
            ] as const
          ).map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`py-1 px-1 rounded text-[11px] font-medium whitespace-nowrap truncate transition-colors ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
                {tab.id === 'project' && projectAssetsList.length > 0 ? ` (${projectAssetsList.length})` : ''}
                {tab.id === 'custom' && customPresets.length > 0 ? ` (${customPresets.length})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: DANH MỤC (7 Clean Semantic Categories + Accent-Insensitive Search + Pin) */}
      {activeTab === 'catalog' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 space-y-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
            {/* Search + Grid/List toggle */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  id="hachihi-library-search-input"
                  ref={searchInputRef}
                  type="text"
                  placeholder="Tìm thiết bị, cổng SFP+, hãng (Ctrl+F)..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="ent-input pl-8 pr-7 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Xóa từ khóa tìm thiết bị"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Dạng lưới"
                  className={`p-1.5 rounded ${
                    viewMode === 'grid' ? 'bg-white dark:bg-slate-900 text-[#155EEF] shadow-2xs' : 'text-slate-500'
                  }`}
                  title="Hiển thị dạng lưới"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="Dạng danh sách"
                  className={`p-1.5 rounded ${
                    viewMode === 'list' ? 'bg-white dark:bg-slate-900 text-[#155EEF] shadow-2xs' : 'text-slate-500'
                  }`}
                  title="Hiển thị dạng danh sách"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Quick Category Filter Strip (Router, Switch, Firewall, Server, Camera, AP, UPS) */}
            <div
              role="group"
              aria-label="Lọc theo nhóm thiết bị"
              className="flex items-center gap-1 overflow-x-auto no-scrollbar"
            >
              {QUICK_CATEGORY_FILTERS.map(cat => {
                const active = selectedCategoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    data-testid={`library-cat-filter-${cat.id}`}
                    aria-pressed={active}
                    onClick={() => setSelectedCategoryFilter(cat.id)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      active
                        ? 'bg-[#155EEF] text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Vendor Filter Strip */}
            <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
              {VENDOR_FILTERS.map(v => {
                const active = selectedVendor === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSelectedVendor(v)}
                    className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      active
                        ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {/* Recently Used Quick Strip */}
            {recentItems.length > 0 && !isFiltering && (
              <div className="space-y-1.5 pb-1">
                <div className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Vừa thêm</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {recentItems.slice(0, 4).map(item => (
                    <button
                      key={`rec_${item.name}`}
                      type="button"
                      disabled={isInsertBlocked}
                      onClick={() => handleAddPreset(item)}
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800 hover:border-[#155EEF] text-xs font-medium text-slate-700 dark:text-slate-200 truncate max-w-[116px] transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                      title={
                        isReadOnlyMode
                          ? 'Đang ở chế độ Chỉ xem'
                          : is3DLockedBlock
                          ? 'Mở khóa kéo 3D để thêm thiết bị'
                          : `Thêm nhanh ${item.name}`
                      }
                    >
                      + {SHORT_LABELS[item.name] || item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 7 Clean Groups */}
            {orderedGroups.length === 0 ? (
              <div className="text-center py-8 px-3 space-y-2 text-xs text-slate-500 dark:text-slate-400">
                <div>Không tìm thấy thiết bị hoặc ký hiệu phù hợp.</div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedVendor('Tất cả');
                    setSelectedCategoryFilter('all');
                  }}
                  className="text-[#155EEF] dark:text-blue-400 font-semibold hover:underline"
                >
                  Xóa bộ lọc tìm kiếm
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {orderedGroups.map(group => {
                  const isOpen = isFiltering ? true : Boolean(openGroups[group.id]);
                  return (
                    <div
                      key={group.id}
                      className="rounded-md border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-1 px-2 py-1.5 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 transition-colors">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.id)}
                          aria-expanded={isOpen}
                          className="flex-1 min-w-0 flex items-center justify-between gap-1.5 text-left py-0.5"
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            {isOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                              {group.label}
                            </span>
                            {group.isRecommended && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-[#155EEF] shrink-0"
                                title="Nhóm thiết bị chính cho chế độ hiện tại"
                              />
                            )}
                          </span>
                          <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                            {group.count}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => togglePinGroup(group.id)}
                          aria-label={group.isPinned ? `Bỏ ghim ${group.label}` : `Ghim ${group.label} lên đầu`}
                          className={`p-1 rounded transition-colors shrink-0 ${
                            group.isPinned
                              ? 'text-[#155EEF] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                              : 'text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300'
                          }`}
                          title={group.isPinned ? 'Bỏ ghim danh mục' : 'Ghim danh mục lên đầu'}
                        >
                          <Pin className="w-3 h-3" />
                        </button>
                      </div>

                      {isOpen && (
                        <div className="p-2 pt-1.5 border-t border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900">
                          {group.id === 'symbols' ? (
                            <div className="grid grid-cols-2 gap-1.5">
                              {filteredSymbols.map(sym => {
                                const SymIcon = sym.icon;
                                const isSymBlocked = isReadOnlyMode
                                  ? true
                                  : is3DView
                                  ? sym.action !== 'rack' || is3DDragLocked
                                  : false;
                                return (
                                  <button
                                    key={sym.id}
                                    type="button"
                                    disabled={isSymBlocked}
                                    onClick={() => handleTriggerSymbol(sym.action)}
                                    title={
                                      isReadOnlyMode
                                        ? 'Đang ở chế độ Chỉ xem'
                                        : is3DView && sym.action === 'rack' && is3DDragLocked
                                        ? 'Mở khóa kéo 3D để thêm Tủ Server Rack'
                                        : is3DView && sym.action !== 'rack'
                                        ? `${sym.label} chỉ khả dụng trong chế độ 2D CAD`
                                        : sym.sub
                                    }
                                    className="p-2 rounded-md border border-slate-200 dark:border-slate-800 hover:border-[#155EEF] hover:bg-slate-50/70 dark:hover:bg-slate-800/40 text-left flex flex-col gap-1 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                                  >
                                    <SymIcon className={`w-4 h-4 ${sym.accentClass}`} />
                                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-tight">
                                      {sym.label}
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                                      {sym.sub}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-1.5' : 'space-y-1.5'}>
                              {group.items.map(renderDeviceCard)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: THIẾT BỊ TRONG DỰ ÁN (ĐỒNG BỘ ĐA VIEW TOPOLOGY <-> FLOORPLAN <-> RACK) */}
      {activeTab === 'project' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 space-y-1.5 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Tìm thiết bị đã có trong dự án..."
                value={projectAssetSearch}
                onChange={e => setProjectAssetSearch(e.target.value)}
                className="ent-input pl-8 pr-7 text-xs"
              />
              {projectAssetSearch && (
                <button
                  type="button"
                  onClick={() => setProjectAssetSearch('')}
                  aria-label="Xóa tìm kiếm tài sản dự án"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              Đặt lại thiết bị đang có lên chế độ/tầng hiện tại mà không tạo trùng tài sản BOM.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
            {projectAssetsList.length === 0 ? (
              <div className="text-center py-6 px-3 text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-md">
                Chưa có thiết bị nào trong dự án khớp bộ lọc.
              </div>
            ) : (
              projectAssetsList.map(({ asset, onCurrentView, locationTags }) => {
                const accent = getCategoryAccentColor(asset.category);
                const disabledPlace = isReadOnlyMode || !onPlaceExistingAsset;
                return (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#155EEF] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: accent }}
                      >
                        {renderIcon(asset.category, 'w-3.5 h-3.5')}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {asset.name}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono">
                          {asset.ipAddress || asset.model}
                          {locationTags.length > 0 ? ` · ${locationTags.slice(0, 2).join(', ')}` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={disabledPlace}
                      onClick={() => onPlaceExistingAsset?.(asset.id, canvasCenter.x, canvasCenter.y)}
                      className={`px-2 py-1 rounded text-[11px] font-semibold shrink-0 transition-colors disabled:opacity-40 ${
                        onCurrentView
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                          : 'bg-[#155EEF] hover:bg-blue-700 text-white'
                      }`}
                      title={
                        onCurrentView
                          ? 'Thiết bị đã có trên chế độ/tầng này — nhấp để chọn'
                          : 'Đặt thiết bị này lên chế độ/tầng đang xem (dùng chung 1 tài sản BOM)'
                      }
                    >
                      {onCurrentView ? 'Đang có' : 'Đặt vào view'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: YÊU THÍCH & GẦN ĐÂY */}
      {activeTab === 'favorites' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Thiết bị đã ghim ({favoriteItems.length})</span>
          </div>
          {favoriteItems.length === 0 ? (
            <div className="text-center py-6 px-3 text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-md">
              Nhấn biểu tượng ngôi sao trên từng thiết bị để ghim vào danh sách dùng nhanh.
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-1.5' : 'space-y-1.5'}>
              {favoriteItems.map(renderDeviceCard)}
            </div>
          )}

          {recentItems.length > 0 && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Vừa sử dụng
              </div>
              <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-1.5' : 'space-y-1.5'}>
                {recentItems.map(renderDeviceCard)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: THIẾT BỊ TÙY CHỈNH */}
      {activeTab === 'custom' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <button
            type="button"
            onClick={() => setShowCustomForm(v => !v)}
            className="ent-btn-primary w-full text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showCustomForm ? 'Ẩn biểu mẫu tạo nhanh' : 'Tạo thiết bị tùy chỉnh mới'}</span>
          </button>

          {showCustomForm && (
            <form
              onSubmit={handleCreateCustomDevice}
              className="p-2.5 rounded-md bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2 text-xs"
            >
              <input
                type="text"
                required
                placeholder="Tên thiết bị (VD: OLT GPON 16P)"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                className="ent-input"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  placeholder="Hãng"
                  value={customVendor}
                  onChange={e => setCustomVendor(e.target.value)}
                  className="ent-input"
                />
                <input
                  type="text"
                  placeholder="Mã thiết bị"
                  value={customModel}
                  onChange={e => setCustomModel(e.target.value)}
                  className="ent-input"
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={customCategory}
                  onChange={e => setCustomCategory(e.target.value as DeviceCategory)}
                  className="col-span-1 ent-select"
                >
                  <option value="switch">Switch</option>
                  <option value="router">Router</option>
                  <option value="firewall">Firewall</option>
                  <option value="server">Máy chủ</option>
                  <option value="ap">Wi-Fi AP</option>
                  <option value="camera">Camera</option>
                  <option value="sensor">Cảm biến IoT</option>
                  <option value="iot">IoT Gateway</option>
                  <option value="ups">UPS</option>
                  <option value="pdu">PDU</option>
                  <option value="electrical_panel">Tủ điện</option>
                  <option value="odf">ODF</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={48}
                  value={customPortCount}
                  onChange={e => setCustomPortCount(Number(e.target.value))}
                  title="Số cổng"
                  className="ent-input font-mono tabular-nums"
                />
                <input
                  type="number"
                  min={0}
                  max={5000}
                  value={customWatts}
                  onChange={e => setCustomWatts(Number(e.target.value))}
                  title="Công suất (W)"
                  className="ent-input font-mono tabular-nums"
                />
              </div>
              <button type="submit" className="ent-btn-primary w-full">
                Lưu &amp; Thêm vào bản vẽ
              </button>
            </form>
          )}

          {customPresets.length === 0 ? (
            <div className="text-center py-6 px-3 text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-md">
              Chưa có thiết bị tùy chỉnh nào. Nhấn nút phía trên để tự định nghĩa thiết bị với số cổng và công suất riêng.
            </div>
          ) : (
            <div className="space-y-1.5">
              {customPresets.map(preset => renderDeviceCard(preset))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
});
