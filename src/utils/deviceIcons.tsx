import React, { useState } from 'react';
import {
  Server,
  Router,
  Shield,
  Wifi,
  Video,
  Cpu,
  HardDrive,
  Zap,
  Layers,
  Box,
  Cloud,
  Radio,
  GitBranch,
  Monitor,
  Printer,
  Database,
  Globe,
  Lock,
  Activity,
  Smartphone
} from 'lucide-react';

const isoSwitchImg = new URL('../assets/images/iso_switch_network_1794553965320.jpg', import.meta.url).href;
const isoPatchPanelImg = new URL('../assets/images/iso_patch_panel_1794553965522.jpg', import.meta.url).href;
const isoUpsUnitImg = new URL('../assets/images/iso_ups_unit_1794553966274.jpg', import.meta.url).href;
const isoRouterFirewallImg = new URL('../assets/images/iso_router_firewall_1794553966509.jpg', import.meta.url).href;
const isoServerRackImg = new URL('../assets/images/iso_server_rack_1794553966809.jpg', import.meta.url).href;

export interface DeviceIconOption {
  id: string;
  label: string;
  component: React.ComponentType<{ className?: string }>;
}

export interface IsometricIconOption {
  id: string;
  label: string;
  shortLabel: string;
  categoryMatch: string;
  imageSrc: string;
  fallbackColor: string;
  fallbackComponent: React.ComponentType<{ className?: string }>;
}

export interface BrandLogoOption {
  id: string;
  label: string;
  shortCode: string;
  accentColor: string;
  bgColor: string;
}

export const ISOMETRIC_ICON_OPTIONS: IsometricIconOption[] = [
  {
    id: 'iso_switch_network',
    label: 'Switch Mạng 24P (Isometric 2D)',
    shortLabel: 'Switch 2D',
    categoryMatch: 'switch',
    imageSrc: isoSwitchImg,
    fallbackColor: '#1d4ed8',
    fallbackComponent: Server
  },
  {
    id: 'iso_patch_panel',
    label: 'Patch Panel 24P (Isometric 2D)',
    shortLabel: 'Patch Panel',
    categoryMatch: 'patch_panel',
    imageSrc: isoPatchPanelImg,
    fallbackColor: '#0e7490',
    fallbackComponent: GitBranch
  },
  {
    id: 'iso_ups_unit',
    label: 'Bộ Lưu Điện UPS (Isometric 2D)',
    shortLabel: 'UPS Power',
    categoryMatch: 'ups',
    imageSrc: isoUpsUnitImg,
    fallbackColor: '#d97706',
    fallbackComponent: Zap
  },
  {
    id: 'iso_router_firewall',
    label: 'Router / Firewall (Isometric 2D)',
    shortLabel: 'Router/FW',
    categoryMatch: 'router',
    imageSrc: isoRouterFirewallImg,
    fallbackColor: '#0369a1',
    fallbackComponent: Shield
  },
  {
    id: 'iso_server_rack',
    label: 'Tủ Server Rack 42U (Isometric 2D)',
    shortLabel: 'Server Rack',
    categoryMatch: 'rack',
    imageSrc: isoServerRackImg,
    fallbackColor: '#334155',
    fallbackComponent: Box
  }
];

export const DEVICE_ICON_OPTIONS: DeviceIconOption[] = [
  { id: 'Server', label: 'Switch / Rack Unit', component: Server },
  { id: 'Router', label: 'Router', component: Router },
  { id: 'Shield', label: 'Firewall', component: Shield },
  { id: 'Layers', label: 'Core Switch', component: Layers },
  { id: 'Cpu', label: 'Server / Compute', component: Cpu },
  { id: 'HardDrive', label: 'Storage / NAS', component: HardDrive },
  { id: 'Database', label: 'Database', component: Database },
  { id: 'Wifi', label: 'Wi-Fi AP', component: Wifi },
  { id: 'Video', label: 'Camera / NVR', component: Video },
  { id: 'Zap', label: 'UPS / Power', component: Zap },
  { id: 'GitBranch', label: 'ODF / Patch', component: GitBranch },
  { id: 'Cloud', label: 'Cloud / WAN', component: Cloud },
  { id: 'Globe', label: 'Internet', component: Globe },
  { id: 'Radio', label: 'Antenna / Riser', component: Radio },
  { id: 'Monitor', label: 'Workstation', component: Monitor },
  { id: 'Printer', label: 'Printer', component: Printer },
  { id: 'Smartphone', label: 'Mobile / IoT', component: Smartphone },
  { id: 'Lock', label: 'Access Control', component: Lock },
  { id: 'Activity', label: 'Sensor / Monitor', component: Activity },
  { id: 'Box', label: 'Rack / Enclosure', component: Box }
];

export const BRAND_LOGO_OPTIONS: BrandLogoOption[] = [
  { id: 'logo_cisco', label: 'Cisco Systems', shortCode: 'CISCO', accentColor: '#049fd9', bgColor: '#0c4a6e' },
  { id: 'logo_mikrotik', label: 'MikroTik', shortCode: 'MT', accentColor: '#f8fafc', bgColor: '#1e293b' },
  { id: 'logo_fortinet', label: 'Fortinet', shortCode: 'FTNT', accentColor: '#ef4444', bgColor: '#450a0a' },
  { id: 'logo_aruba', label: 'Aruba HPE', shortCode: 'ARUBA', accentColor: '#f97316', bgColor: '#431407' },
  { id: 'logo_ubiquiti', label: 'Ubiquiti UniFi', shortCode: 'UniFi', accentColor: '#38bdf8', bgColor: '#0f172a' },
  { id: 'logo_ruijie', label: 'Ruijie Reyee', shortCode: 'RG', accentColor: '#60a5fa', bgColor: '#172554' },
  { id: 'logo_h3c', label: 'H3C Enterprise', shortCode: 'H3C', accentColor: '#f43f5e', bgColor: '#3b0764' },
  { id: 'logo_tplink', label: 'TP-Link Omada', shortCode: 'OMADA', accentColor: '#2dd4bf', bgColor: '#134e4a' },
  { id: 'logo_dell', label: 'Dell PowerEdge', shortCode: 'DELL', accentColor: '#38bdf8', bgColor: '#082f49' },
  { id: 'logo_hikvision', label: 'Hikvision', shortCode: 'HIK', accentColor: '#f87171', bgColor: '#1e1b4b' },
  { id: 'logo_apc', label: 'APC Schneider', shortCode: 'APC', accentColor: '#4ade80', bgColor: '#052e16' },
  { id: 'logo_hachihi', label: 'HACHIHI Corp', shortCode: 'HCH', accentColor: '#ffffff', bgColor: '#1d4ed8' }
];

export function getIsometricIconOption(customIcon?: string): IsometricIconOption | undefined {
  if (!customIcon) return undefined;
  return ISOMETRIC_ICON_OPTIONS.find(opt => opt.id === customIcon);
}

const IsometricIconImg: React.FC<{ option: IsometricIconOption; className?: string }> = ({
  option,
  className = 'w-6 h-6'
}) => {
  const [hasError, setHasError] = useState(false);
  const FallbackIcon = option.fallbackComponent;

  if (hasError) {
    return (
      <div
        className={`${className} rounded flex items-center justify-center text-white`}
        style={{ background: option.fallbackColor }}
      >
        <FallbackIcon className="w-3/5 h-3/5" />
      </div>
    );
  }

  return (
    <img
      src={option.imageSrc}
      alt={option.label}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`${className} object-contain rounded-sm bg-white p-0.5`}
      draggable={false}
    />
  );
};

export function renderBrandLogoBadge(logo: BrandLogoOption, className = 'w-6 h-6'): React.ReactElement {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      aria-label={logo.label}
    >
      <rect x="1" y="1" width="38" height="38" rx="8" fill={logo.bgColor} stroke={logo.accentColor} strokeWidth="2" />
      <path d="M 7 11 L 33 11" stroke={logo.accentColor} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      <text
        x="20"
        y="25"
        textAnchor="middle"
        fill={logo.accentColor}
        fontSize={logo.shortCode.length >= 5 ? '8.5' : logo.shortCode.length >= 4 ? '10' : '12'}
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {logo.shortCode}
      </text>
      <circle cx="32" cy="31" r="2" fill={logo.accentColor} fillOpacity="0.8" />
    </svg>
  );
}

export function getIconComponentByCategoryOrName(
  customIcon?: string,
  category?: string
): React.ComponentType<{ className?: string }> {
  if (customIcon) {
    const matchedIso = ISOMETRIC_ICON_OPTIONS.find(i => i.id === customIcon);
    if (matchedIso) return matchedIso.fallbackComponent;
    const matched = DEVICE_ICON_OPTIONS.find(i => i.id === customIcon);
    if (matched) return matched.component;
  }

  switch (category) {
    case 'router':
    case 'gateway':
      return Router;
    case 'firewall':
      return Shield;
    case 'core_switch':
      return Layers;
    case 'switch':
      return Server;
    case 'server':
      return Cpu;
    case 'storage':
      return HardDrive;
    case 'ap':
      return Wifi;
    case 'camera':
    case 'nvr':
      return Video;
    case 'ups':
    case 'pdu':
    case 'electrical_panel':
      return Zap;
    case 'cloud':
      return Cloud;
    case 'telecom_tower':
    case 'riser':
      return Radio;
    case 'odf':
    case 'patch_panel':
      return GitBranch;
    case 'workstation':
      return Monitor;
    case 'printer':
      return Printer;
    case 'sensor':
      return Activity;
    case 'iot':
      return Smartphone;
    case 'rack':
      return Box;
    default:
      return Server;
  }
}

export function renderDeviceVisualIcon(
  options: {
    customIcon?: string;
    customImageUrl?: string;
    category?: string;
    className?: string;
  }
) {
  const { customIcon, customImageUrl, category, className = 'w-4 h-4' } = options;
  if (customImageUrl) {
    return (
      <img
        src={customImageUrl}
        alt="Icon"
        referrerPolicy="no-referrer"
        className={`${className} object-contain rounded-xs`}
        draggable={false}
      />
    );
  }
  if (customIcon) {
    const isoOption = getIsometricIconOption(customIcon);
    if (isoOption) {
      return <IsometricIconImg option={isoOption} className={className} />;
    }
    const brandLogo = BRAND_LOGO_OPTIONS.find(b => b.id === customIcon);
    if (brandLogo) {
      return renderBrandLogoBadge(brandLogo, className);
    }
  }
  const IconComp = getIconComponentByCategoryOrName(customIcon, category);
  return <IconComp className={className} />;
}
