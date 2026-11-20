import React, { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  Maximize2,
  Paintbrush,
  RotateCcw,
  RotateCw,
  Settings2,
  Trash2,
  Unlock,
  Upload,
  Video,
  Wifi,
  X
} from 'lucide-react';
import {
  CanvasLayerId,
  DeviceAsset,
  DevicePort,
  DiagramNode,
  PortType,
  ProjectState,
  RackSide
} from '../../types/infrastructure';
import { classifyDeviceLayer, resolveNodeLayer } from '../../utils/layerPolicy';
import { canPlaceDeviceAtU, getAssetUHeight } from '../../utils/rackGeometry';
import {
  BRAND_LOGO_OPTIONS,
  DEVICE_ICON_OPTIONS,
  ISOMETRIC_ICON_OPTIONS,
  renderBrandLogoBadge,
  renderDeviceVisualIcon
} from '../../utils/deviceIcons';
import { getCategoryAccentColor } from '../../data/deviceCatalog';
import { validateAndConvertIconImage } from '../../utils/projectStorage';
import { normalizeCableColor } from '../../utils/cableRouting';
import { sanitizeSafeImageUrl } from '../../utils/security';
import { AuditIssue } from '../../utils/engineeringValidator';
import {
  type PoeDeviceRole,
  classifyPoeStandard,
  isPoeConsumerDevice,
  isPseCategoryCandidate,
  isPseDevice,
  resolveDevicePoeWatts,
  resolvePoeDeviceRole,
  resolvePseBudgetWatts
} from '../../utils/poeCalculator';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';
import {
  CAMERA_FOV_MAX_DEG,
  CAMERA_FOV_MIN_DEG,
  CAMERA_RANGE_MAX_M,
  CAMERA_RANGE_MIN_M,
  WIFI_MAX_ANGLE_DEG,
  WIFI_MAX_RADIUS_M,
  WIFI_MIN_ANGLE_DEG,
  WIFI_MIN_RADIUS_M,
  cameraRangeFromAreaSqm,
  cameraRangeFromScalePct,
  clampCameraFovDeg,
  clampCameraRangeMeters,
  clampWifiAngleDeg,
  clampWifiRadiusMeters,
  normalizeRotationDeg,
  resolveCameraFov,
  resolveWifiCoverage,
  wifiRadiusFromAreaSqm,
  wifiRadiusFromScalePct
} from '../../utils/coverageUtils';
import { ReadOnlyInspectorBanner, renderInlineDeleteBanner } from './propertiesShared';

type DeviceTab = 'general' | 'network' | 'physical' | 'notes';

interface DeviceNodeInspectorProps {
  project: ProjectState;
  selectedNode: DiagramNode;
  selectedAsset?: DeviceAsset;
  auditIssues: AuditIssue[];
  isReadOnlyMode: boolean;
  layoutTier: LayoutTier;
  confirmDeleteKey: string | null;
  setConfirmDeleteKey: (key: string | null) => void;
  onUpdateAsset: (assetId: string, partial: Partial<DeviceAsset>) => void;
  onUpdateNode: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onMirrorNodes?: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  onUpdateWifiCoverage?: (nodeId: string, partial: { radiusMeters?: number; angleDeg?: number }) => void;
  onUpdateCameraFov?: (nodeId: string, partial: { fovAngle?: number; irDistanceMeters?: number }) => void;
  onUpdateSettings?: (partial: Partial<ProjectState['settings']>) => void;
  onSetNodeIconOrLogo?: (nodeId: string, payload: { customIcon?: string; customImageUrl?: string }) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  hasCopiedStyle?: boolean;
  onCopyNodeStyle?: (nodeId: string) => void;
  onPasteNodeStyle?: (nodeIds: string[]) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteCable: (cableId: string) => void;
  onSelectCable?: (cableId: string) => void;
  onAssignDeviceToRackSlot?: (rackId: string, assetId: string, preferredU: number, side?: RackSide) => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onOpenDeepInspect: (id: string) => void;
  onAutoLayerDevices?: () => void;
  experienceMode?: 'basic' | 'advanced';
  onSwitchToAdvanced?: () => void;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
}

export const DeviceNodeInspector: React.FC<DeviceNodeInspectorProps> = ({
  project,
  selectedNode,
  selectedAsset,
  auditIssues,
  isReadOnlyMode,
  layoutTier,
  confirmDeleteKey,
  setConfirmDeleteKey,
  onUpdateAsset,
  onUpdateNode,
  onMirrorNodes,
  onUpdateWifiCoverage,
  onUpdateCameraFov,
  onUpdateSettings,
  onSetNodeIconOrLogo,
  onToggleNodeLock,
  onToggleNodeVisibility,
  onDuplicateNodes,
  hasCopiedStyle = false,
  onCopyNodeStyle,
  onPasteNodeStyle,
  onDeleteNode,
  onDeleteCable,
  onSelectCable,
  onAssignDeviceToRackSlot,
  onRemoveDeviceFromRackSlot,
  onOpenDeepInspect,
  onAutoLayerDevices,
  experienceMode: experienceModeProp,
  onSwitchToAdvanced,
  onToggleCollapse,
  onClosePanel
}) => {
  const experienceMode = experienceModeProp ?? project.settings.experienceMode ?? 'advanced';
  const isBasicMode = experienceMode === 'basic';
  const [deviceTab, setDeviceTab] = useState<DeviceTab>('general');
  const [portFilter, setPortFilter] = useState<'all' | 'used' | 'free'>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [iconUploadError, setIconUploadError] = useState<string | null>(null);

  const nodeAuditIssues = auditIssues.filter(
    i => i.targetId === selectedNode.id || (selectedAsset && i.targetId === selectedAsset.id)
  );
  const connectedCables = project.cables.filter(
    c => c.sourceNodeId === selectedNode.id || c.targetNodeId === selectedNode.id
  );
  const accentHex = getCategoryAccentColor(selectedAsset?.category || selectedNode.type);
  const assetPorts = selectedAsset?.ports || [];
  const filteredPorts = assetPorts.filter(pt => {
    if (portFilter === 'used') return pt.status === 'up';
    if (portFilter === 'free') return pt.status !== 'up';
    return true;
  });

  const safeCustomImageUrl = sanitizeSafeImageUrl(
    selectedNode.customImageUrl || selectedAsset?.customImageUrl
  );

  const noteText =
    typeof selectedNode.customData?.note === 'string' ? selectedNode.customData.note : '';

  const categoryContextLabel = (() => {
    const cat = selectedAsset?.category;
    switch (cat) {
      case 'switch':
      case 'core_switch':
        return 'Switch · Quản lý cổng, PoE & VLAN';
      case 'ups':
        return 'UPS · Công suất tải & Ắc quy dự phòng';
      case 'router':
      case 'gateway':
        return 'Router · Định tuyến IP & Kết nối WAN';
      case 'firewall':
        return 'Firewall · Bảo mật & Phân vùng';
      case 'camera':
      case 'nvr':
        return 'Camera / NVR · Góc quét FOV & Hồng ngoại';
      case 'ap':
        return 'Wi-Fi AP · Bán kính vùng phủ sóng';
      case 'server':
      case 'storage':
        return 'Máy chủ / Lưu trữ · Vị trí Rack & Nguồn';
      case 'pdu':
      case 'electrical_panel':
        return 'Tủ điện / PDU · Phân phối nguồn AC';
      default:
        return selectedAsset ? `Thiết bị · ${selectedAsset.category}` : 'Đối tượng bản vẽ';
    }
  })();

  const nodeTabs: Array<{ id: DeviceTab; label: string }> = isBasicMode
    ? [
        { id: 'general', label: 'Chung' },
        { id: 'network', label: 'Kết nối' },
        { id: 'notes', label: 'Ghi chú' }
      ]
    : [
        { id: 'general', label: 'Chung' },
        { id: 'network', label: selectedAsset?.category === 'ups' ? 'Cổng nối' : 'Mạng' },
        { id: 'physical', label: selectedAsset?.category === 'ups' ? 'Điện & Pin' : 'Vật lý' },
        { id: 'notes', label: 'Ghi chú' }
      ];

  const effectiveTab: DeviceTab =
    isBasicMode && deviceTab === 'physical' ? 'general' : deviceTab;

  const renderCoverageHiddenNotice = () => {
    if (project.settings.showCoverageRadius !== false) return null;
    return (
      <div className="px-2 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/70 flex items-center justify-between gap-2 text-[11px] text-blue-800 dark:text-blue-200">
        <span>Vùng phủ đang ẩn trên bản vẽ 2D/3D.</span>
        {onUpdateSettings && !isReadOnlyMode && (
          <button
            type="button"
            onClick={() => onUpdateSettings({ showCoverageRadius: true })}
            className="px-2 py-0.5 rounded bg-[#155EEF] hover:bg-blue-700 text-white font-semibold whitespace-nowrap shrink-0"
          >
            Bật hiển thị
          </button>
        )}
      </div>
    );
  };

  const renderCameraFovCard = () => {
    const resolvedCam = resolveCameraFov(selectedNode, selectedAsset);
    if (!selectedAsset?.cameraSpecs && !resolvedCam) return null;
    const camState = resolvedCam || {
      fovAngle: 90,
      rangeMeters: 30,
      isOmnidirectional: false,
      areaSqm: 707,
      scalePct: 100
    };
    const currentRot = normalizeRotationDeg(selectedNode.rotation || 0);

    const applyCameraFov = (partial: { fovAngle?: number; irDistanceMeters?: number }) => {
      const nextFov =
        partial.fovAngle !== undefined ? clampCameraFovDeg(partial.fovAngle) : camState.fovAngle;
      const nextRange =
        partial.irDistanceMeters !== undefined
          ? clampCameraRangeMeters(partial.irDistanceMeters)
          : camState.rangeMeters;

      if (onUpdateCameraFov) {
        onUpdateCameraFov(selectedNode.id, { fovAngle: nextFov, irDistanceMeters: nextRange });
        return;
      }

      if (selectedAsset) {
        onUpdateAsset(selectedAsset.id, {
          cameraSpecs: selectedAsset.cameraSpecs
            ? {
                ...selectedAsset.cameraSpecs,
                fovAngle: nextFov,
                irDistanceMeters: nextRange
              }
            : {
                resolution: '4MP',
                lensMm: 4,
                fovAngle: nextFov,
                irDistanceMeters: nextRange,
                nvrChannel: 1
              }
        });
      }
      onUpdateNode(selectedNode.id, {
        customData: {
          ...selectedNode.customData,
          fov: nextFov,
          irDistance: nextRange
        }
      });
    };

    return (
      <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 space-y-2.5">
        <div className="font-semibold text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-1.5">
          <span className="flex items-center gap-1.5">
            <Video className="w-3.5 h-3.5" /> Vùng quan sát Camera
          </span>
          <span className="text-[11px] font-mono text-amber-700 dark:text-amber-300 tabular-nums">
            ~{camState.areaSqm.toLocaleString('vi-VN')} m²
          </span>
        </div>

        {renderCoverageHiddenNotice()}

        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-400">Góc quét FOV (°)</span>
            <input
              type="number"
              min={CAMERA_FOV_MIN_DEG}
              max={CAMERA_FOV_MAX_DEG}
              step={1}
              aria-label="Góc quét FOV Camera (độ)"
              value={camState.fovAngle}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) applyCameraFov({ fovAngle: parsed });
              }}
              className="w-20 px-2 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 font-mono font-semibold text-amber-700 dark:text-amber-300 tabular-nums text-xs"
            />
          </div>
          <input
            type="range"
            min={CAMERA_FOV_MIN_DEG}
            max={CAMERA_FOV_MAX_DEG}
            step={1}
            aria-label="Thanh trượt góc quét FOV Camera"
            value={camState.fovAngle}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val)) applyCameraFov({ fovAngle: val });
            }}
            className="w-full accent-amber-500"
          />
          <div className="grid grid-cols-5 gap-1 mt-1 text-[10px] font-mono">
            {[45, 90, 120, 180, 360].map(presetAngle => (
              <button
                key={presetAngle}
                type="button"
                onClick={() => applyCameraFov({ fovAngle: presetAngle })}
                className={`py-0.5 rounded border font-semibold transition-colors ${
                  Math.round(camState.fovAngle) === presetAngle
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white dark:bg-slate-800 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 hover:border-amber-400'
                }`}
              >
                {presetAngle}°
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-400">Tầm quan sát (m)</span>
            <input
              type="number"
              min={CAMERA_RANGE_MIN_M}
              max={CAMERA_RANGE_MAX_M}
              step={0.5}
              aria-label="Tầm quan sát Camera (mét)"
              value={camState.rangeMeters}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) applyCameraFov({ irDistanceMeters: parsed });
              }}
              className="w-20 px-2 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 font-mono font-semibold text-amber-700 dark:text-amber-300 tabular-nums text-xs"
            />
          </div>
          <input
            type="range"
            min={CAMERA_RANGE_MIN_M}
            max={CAMERA_RANGE_MAX_M}
            step={0.5}
            aria-label="Thanh trượt tầm quan sát Camera (mét)"
            value={camState.rangeMeters}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val)) applyCameraFov({ irDistanceMeters: val });
            }}
            className="w-full accent-amber-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-400">Tỷ lệ vùng quan sát (%)</span>
            <input
              type="number"
              min={10}
              max={400}
              step={5}
              aria-label="Tỷ lệ vùng quan sát Camera (%)"
              value={camState.scalePct}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) {
                  applyCameraFov({ irDistanceMeters: cameraRangeFromScalePct(parsed) });
                }
              }}
              className="w-20 px-2 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 font-mono font-semibold text-amber-700 dark:text-amber-300 tabular-nums text-xs"
            />
          </div>
          <input
            type="range"
            min={10}
            max={400}
            step={5}
            aria-label="Thanh trượt tỷ lệ vùng quan sát Camera (%)"
            value={Math.min(400, Math.max(10, camState.scalePct))}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val)) {
                applyCameraFov({ irDistanceMeters: cameraRangeFromScalePct(val) });
              }
            }}
            className="w-full accent-amber-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">
              Diện tích vùng (m²)
            </label>
            <input
              type="number"
              min={5}
              step={10}
              aria-label="Diện tích vùng quan sát Camera (m²)"
              value={camState.areaSqm}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed) && parsed > 0) {
                  applyCameraFov({
                    irDistanceMeters: cameraRangeFromAreaSqm(parsed, camState.fovAngle)
                  });
                }
              }}
              className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
            />
          </div>
          <div>
            <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">
              Hướng Camera (°)
            </label>
            <input
              type="number"
              min={0}
              max={359}
              step={1}
              aria-label="Hướng xoay Camera (độ)"
              value={Math.round(currentRot)}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) {
                  onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(parsed) });
                }
              }}
              className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
            />
          </div>
        </div>

        {selectedAsset?.cameraSpecs && (
          <div>
            <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">
              Kênh NVR
            </label>
            <input
              type="number"
              min={1}
              max={64}
              value={selectedAsset.cameraSpecs.nvrChannel || 1}
              onChange={e =>
                onUpdateAsset(selectedAsset.id, {
                  cameraSpecs: {
                    ...selectedAsset.cameraSpecs!,
                    nvrChannel: parseInt(e.target.value, 10) || 1
                  }
                })
              }
              className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
            />
          </div>
        )}

        <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
          Mẹo: Kéo tay nắm vùng FOV trực tiếp trên bản vẽ 2D/3D để co giãn tầm xa, góc quét và xoay hướng đồng bộ.
        </div>
      </div>
    );
  };

  const renderWifiCoverageCard = () => {
    const resolvedWifi = resolveWifiCoverage(selectedNode, selectedAsset);
    if (!selectedAsset?.wifiSpecs && !resolvedWifi) return null;
    const wifiState = resolvedWifi || {
      radiusMeters: 18,
      angleDeg: 360,
      isDirectional: false,
      areaSqm: Math.round(Math.PI * 18 * 18),
      scalePct: 100
    };
    const applyWifiCoverage = (partial: { radiusMeters?: number; angleDeg?: number }) => {
      const nextRadius =
        partial.radiusMeters !== undefined
          ? clampWifiRadiusMeters(partial.radiusMeters)
          : wifiState.radiusMeters;
      const nextAngle =
        partial.angleDeg !== undefined
          ? clampWifiAngleDeg(partial.angleDeg)
          : wifiState.angleDeg;

      if (onUpdateWifiCoverage) {
        onUpdateWifiCoverage(selectedNode.id, { radiusMeters: nextRadius, angleDeg: nextAngle });
        return;
      }

      if (selectedAsset) {
        onUpdateAsset(selectedAsset.id, {
          wifiSpecs: selectedAsset.wifiSpecs
            ? {
                ...selectedAsset.wifiSpecs,
                coverageRadiusMeters: nextRadius,
                coverageAngleDeg: nextAngle
              }
            : {
                standard: 'Wi-Fi 6 (802.11ax)',
                bands: '2.4GHz + 5GHz',
                txPowerDbm: 22,
                coverageRadiusMeters: nextRadius,
                coverageAngleDeg: nextAngle,
                maxClients: 200,
                ssid: 'HACHIHI-WIFI'
              }
        });
      }
      onUpdateNode(selectedNode.id, {
        customData: {
          ...selectedNode.customData,
          coverageRadiusMeters: nextRadius,
          coverageAngleDeg: nextAngle
        }
      });
    };

    return (
      <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2.5">
        <div className="font-semibold text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-1.5">
          <span className="flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5" /> Phủ sóng Wi-Fi
          </span>
          <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
            ~{wifiState.areaSqm.toLocaleString('vi-VN')} m²
          </span>
        </div>

        {renderCoverageHiddenNotice()}

        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-400">Bán kính vùng phủ (m)</span>
            <input
              type="number"
              min={WIFI_MIN_RADIUS_M}
              max={WIFI_MAX_RADIUS_M}
              step={0.5}
              aria-label="Bán kính phủ sóng Wi-Fi (mét)"
              value={wifiState.radiusMeters}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) applyWifiCoverage({ radiusMeters: parsed });
              }}
              className="w-20 px-2 py-0.5 text-right rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 font-mono font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums text-xs"
            />
          </div>
          <input
            type="range"
            min={WIFI_MIN_RADIUS_M}
            max={WIFI_MAX_RADIUS_M}
            step={0.5}
            aria-label="Thanh trượt bán kính phủ sóng Wi-Fi"
            value={wifiState.radiusMeters}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val)) applyWifiCoverage({ radiusMeters: val });
            }}
            className="w-full accent-emerald-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-400">Tỷ lệ phủ sóng (%)</span>
            <input
              type="number"
              min={10}
              max={450}
              step={5}
              aria-label="Tỷ lệ phủ sóng Wi-Fi (%)"
              value={wifiState.scalePct}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) {
                  applyWifiCoverage({ radiusMeters: wifiRadiusFromScalePct(parsed) });
                }
              }}
              className="w-20 px-2 py-0.5 text-right rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 font-mono font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums text-xs"
            />
          </div>
          <input
            type="range"
            min={10}
            max={450}
            step={5}
            aria-label="Thanh trượt tỷ lệ phủ sóng Wi-Fi (%)"
            value={Math.min(450, Math.max(10, wifiState.scalePct))}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val)) {
                applyWifiCoverage({ radiusMeters: wifiRadiusFromScalePct(val) });
              }
            }}
            className="w-full accent-emerald-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-400">Độ rộng góc phát (°)</span>
            <input
              type="number"
              min={WIFI_MIN_ANGLE_DEG}
              max={WIFI_MAX_ANGLE_DEG}
              step={5}
              aria-label="Độ rộng góc phát Wi-Fi (độ)"
              value={wifiState.angleDeg}
              onChange={e => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) applyWifiCoverage({ angleDeg: parsed });
              }}
              className="w-20 px-2 py-0.5 text-right rounded border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 font-mono font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums text-xs"
            />
          </div>
          <input
            type="range"
            min={WIFI_MIN_ANGLE_DEG}
            max={WIFI_MAX_ANGLE_DEG}
            step={5}
            aria-label="Thanh trượt góc phát Wi-Fi"
            value={wifiState.angleDeg}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val)) applyWifiCoverage({ angleDeg: val });
            }}
            className="w-full accent-emerald-500"
          />
          <div className="grid grid-cols-5 gap-1 mt-1 text-[10px] font-mono">
            {[60, 90, 120, 180, 360].map(presetAngle => (
              <button
                key={presetAngle}
                type="button"
                onClick={() => applyWifiCoverage({ angleDeg: presetAngle })}
                className={`py-0.5 rounded border font-semibold transition-colors ${
                  Math.round(wifiState.angleDeg) === presetAngle
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white dark:bg-slate-800 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 hover:border-emerald-400'
                }`}
              >
                {presetAngle}°
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">
            Diện tích vùng phủ (m²)
          </label>
          <input
            type="number"
            min={5}
            step={25}
            aria-label="Diện tích vùng phủ sóng Wi-Fi (m²)"
            value={wifiState.areaSqm}
            onChange={e => {
              const parsed = parseFloat(e.target.value);
              if (!Number.isNaN(parsed) && parsed > 0) {
                applyWifiCoverage({
                  radiusMeters: wifiRadiusFromAreaSqm(parsed, wifiState.angleDeg)
                });
              }
            }}
            className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
          />
        </div>

        <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
          Mẹo: Nhấn vùng phủ sóng trên bản vẽ 2D/3D hoặc kéo tay nắm để thay đổi bán kính và góc phát.
        </div>

        {selectedAsset?.wifiSpecs && (
          <div>
            <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">
              Tên mạng SSID
            </label>
            <input
              type="text"
              value={selectedAsset.wifiSpecs.ssid}
              onChange={e =>
                onUpdateAsset(selectedAsset.id, {
                  wifiSpecs: { ...selectedAsset.wifiSpecs!, ssid: e.target.value }
                })
              }
              className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs select-text">
      {/* Header */}
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0 overflow-hidden"
            style={{ backgroundColor: accentHex }}
          >
            {renderDeviceVisualIcon({
              customIcon: selectedNode.customIcon || selectedAsset?.customIcon,
              customImageUrl: safeCustomImageUrl,
              category: selectedAsset?.category || selectedNode.type,
              className: 'w-4 h-4'
            })}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-slate-900 dark:text-white leading-tight truncate">
              {selectedAsset?.name || selectedNode.label}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {selectedAsset ? `${selectedAsset.vendor} · ${selectedAsset.model}` : selectedNode.type}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {!isReadOnlyMode && onToggleNodeLock && (
            <button
              type="button"
              onClick={() => onToggleNodeLock([selectedNode.id])}
              aria-label={selectedNode.locked ? 'Mở khóa vị trí' : 'Khóa vị trí'}
              className={`p-1.5 rounded-md transition-colors ${
                selectedNode.locked
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
              title={selectedNode.locked ? 'Mở khóa vị trí' : 'Khóa vị trí'}
            >
              {selectedNode.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          )}
          {!isReadOnlyMode && onToggleNodeVisibility && (
            <button
              type="button"
              onClick={() => onToggleNodeVisibility([selectedNode.id], true)}
              aria-label="Ẩn khỏi trang vẽ"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
              title="Ẩn khỏi trang vẽ"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}
          {!isReadOnlyMode && onDuplicateNodes && (
            <button
              type="button"
              onClick={() => onDuplicateNodes([selectedNode.id])}
              aria-label="Nhân bản đối tượng"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
              title="Nhân bản (Ctrl+D)"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenDeepInspect(selectedAsset ? selectedAsset.id : selectedNode.id)}
            aria-label="Cấu hình chuyên sâu"
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
            title="Cấu hình chuyên sâu"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {!isReadOnlyMode && (
            <button
              type="button"
              onClick={() => setConfirmDeleteKey(`node_${selectedNode.id}`)}
              aria-label="Xóa đối tượng"
              className="p-1.5 hover:bg-rose-50 text-rose-600 dark:hover:bg-rose-950/40 rounded-md transition-colors"
              title="Xóa đối tượng"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Thu gọn bảng thuộc tính"
              title="Thu gọn bảng thuộc tính"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {onClosePanel && (
            <button
              type="button"
              onClick={onClosePanel}
              aria-label="Đóng bảng thuộc tính"
              className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Segmented Tabs (Adaptive by category and Basic/Advanced mode) */}
      <div className="px-3 pt-2 pb-1.5 border-b border-slate-200 dark:border-slate-800 shrink-0 space-y-1.5">
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
          {categoryContextLabel}
        </div>
        <div
          className={`grid ${isBasicMode ? 'grid-cols-3' : 'grid-cols-4'} gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg`}
        >
          {nodeTabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setDeviceTab(t.id)}
              className={`py-1.5 px-1 rounded-md text-xs font-semibold whitespace-nowrap truncate transition-colors ${
                effectiveTab === t.id
                  ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isReadOnlyMode && <ReadOnlyInspectorBanner />}

      {renderInlineDeleteBanner(
        confirmDeleteKey,
        setConfirmDeleteKey,
        `node_${selectedNode.id}`,
        selectedAsset?.name || selectedNode.label,
        () => onDeleteNode(selectedNode.id),
        isReadOnlyMode
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {nodeAuditIssues.length > 0 && (
          <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 space-y-1 text-xs">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Cảnh báo kỹ thuật ({nodeAuditIssues.length})</span>
            </div>
            {nodeAuditIssues.slice(0, 3).map(iss => (
              <div key={iss.id} className="text-xs leading-snug">
                • {iss.title}
              </div>
            ))}
          </div>
        )}

        {/* TAB 1: CHUNG */}
        {effectiveTab === 'general' && (
          <div className="space-y-3">
            {selectedAsset ? (
              <>
                <fieldset disabled={isReadOnlyMode} className="contents">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Tên thiết bị
                    </label>
                    <input
                      type="text"
                      value={selectedAsset.name}
                      onChange={e => onUpdateAsset(selectedAsset.id, { name: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium disabled:opacity-70"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {!isBasicMode && (
                      <div>
                        <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                          Mã tài sản
                        </label>
                        <input
                          type="text"
                          value={selectedAsset.assetTag}
                          onChange={e => onUpdateAsset(selectedAsset.id, { assetTag: e.target.value })}
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs disabled:opacity-70"
                        />
                      </div>
                    )}
                    <div className={isBasicMode ? 'col-span-2' : ''}>
                      <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                        Trạng thái
                      </label>
                      <select
                        value={selectedAsset.status}
                        onChange={e =>
                          onUpdateAsset(selectedAsset.id, { status: e.target.value as DeviceAsset['status'] })
                        }
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
                      >
                        <option value="online">Hoạt động</option>
                        <option value="standby">Dự phòng</option>
                        <option value="maintenance">Bảo trì</option>
                        <option value="offline">Ngoại tuyến</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                        Hãng sản xuất
                      </label>
                      <input
                        type="text"
                        value={selectedAsset.vendor}
                        onChange={e => onUpdateAsset(selectedAsset.id, { vendor: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                        Mã thiết bị
                      </label>
                      <input
                        type="text"
                        value={selectedAsset.model}
                        onChange={e => onUpdateAsset(selectedAsset.id, { model: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
                      />
                    </div>
                  </div>
                </fieldset>

                {/* Smart Context Card tailored to Device Category */}
                {selectedAsset.category === 'ups' ? (() => {
                  const specs = selectedAsset.upsSpecs || {
                    batteryAh: 9,
                    batteryVoltageV: 12,
                    batteryCount: 8,
                    inverterEfficiency: 0.85,
                    dodFactor: 0.8
                  };
                  const usableWh = Math.round(
                    specs.batteryAh *
                      specs.batteryVoltageV *
                      specs.batteryCount *
                      (specs.inverterEfficiency ?? 0.85) *
                      (specs.dodFactor ?? 0.8)
                  );
                  return (
                    <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-800 border border-rose-200 dark:border-rose-900/60 rounded-md bg-rose-50/40 dark:bg-rose-950/20">
                      <div className="px-3 py-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Công suất UPS</div>
                        <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                          {selectedAsset.powerWatts || 0} W
                        </div>
                      </div>
                      <div className="px-3 py-2">
                        <div className="text-xs text-slate-500 dark:text-slate-400">Ắc quy ({specs.batteryCount} bình)</div>
                        <div className="font-semibold font-mono tabular-nums text-rose-700 dark:text-rose-300 mt-0.5">
                          {usableWh} Wh
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="px-3 py-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {isPseDevice(selectedAsset) ? 'Ngân sách PoE' : 'Số cổng'}
                      </div>
                      <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                        {isPseDevice(selectedAsset)
                          ? `${resolvePseBudgetWatts(selectedAsset)}W (${assetPorts.length}P)`
                          : `${assetPorts.length} cổng`}
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">Dây nối</div>
                      <div className="font-semibold font-mono tabular-nums text-[#155EEF] dark:text-blue-400 mt-0.5">
                        {connectedCables.length} tuyến
                      </div>
                    </div>
                  </div>
                )}

                {isBasicMode ? (
                  onSwitchToAdvanced && (
                    <button
                      type="button"
                      onClick={onSwitchToAdvanced}
                      className="w-full py-2 px-3 bg-blue-50/70 hover:bg-blue-100/70 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 text-[#155EEF] dark:text-blue-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-blue-200 dark:border-blue-900/60"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      <span>Bật Chế độ Kỹ sư (IP/VLAN, Rack, PoE)</span>
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenDeepInspect(selectedAsset.id)}
                    className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-200 dark:border-slate-700"
                  >
                    <Settings2 className="w-3.5 h-3.5 text-[#155EEF]" />
                    <span>Cấu hình chuyên sâu</span>
                  </button>
                )}
              </>
            ) : (
              <fieldset disabled={isReadOnlyMode} className="contents">
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      {selectedNode.type === 'text' ? 'Nội dung ghi chú' : 'Nhãn hiển thị'}
                    </label>
                    {selectedNode.type === 'text' ? (
                      <textarea
                        rows={4}
                        value={selectedNode.label}
                        onChange={e => onUpdateNode(selectedNode.id, { label: e.target.value })}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium disabled:opacity-70"
                      />
                    ) : (
                      <input
                        type="text"
                        value={selectedNode.label}
                        onChange={e => onUpdateNode(selectedNode.id, { label: e.target.value })}
                        className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium disabled:opacity-70"
                      />
                    )}
                  </div>
                  {selectedNode.type === 'text' && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">Cỡ chữ</span>
                        <span className="font-mono tabular-nums">{selectedNode.style.fontSize || 12} px</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={28}
                        value={selectedNode.style.fontSize || 12}
                        onChange={e =>
                          onUpdateNode(selectedNode.id, {
                            style: { ...selectedNode.style, fontSize: parseInt(e.target.value, 10) }
                          })
                        }
                        className="w-full accent-[#155EEF]"
                      />
                    </div>
                  )}
                </div>
              </fieldset>
            )}

            {/* Hướng xoay 360° cho mọi đối tượng (đồng bộ 2D & 3D) */}
            <fieldset disabled={isReadOnlyMode} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <RotateCw className="w-3.5 h-3.5 text-cyan-600" />
                  <span>Hướng xoay 360°</span>
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={359}
                    step={1}
                    aria-label="Hướng xoay đối tượng (độ)"
                    value={Math.round(normalizeRotationDeg(selectedNode.rotation || 0))}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      if (!Number.isNaN(val)) {
                        onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(val) });
                      }
                    }}
                    className="w-16 px-2 py-0.5 text-right rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs font-semibold tabular-nums"
                  />
                  <span className="text-xs font-mono text-slate-400">°</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                aria-label="Thanh trượt góc xoay 360°"
                value={Math.round(normalizeRotationDeg(selectedNode.rotation || 0))}
                onChange={e =>
                  onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(parseFloat(e.target.value)) })
                }
                className="w-full accent-cyan-600"
              />
              <div className="grid grid-cols-6 gap-1 text-[10px] font-mono">
                {[
                  { label: '-45°', val: normalizeRotationDeg((selectedNode.rotation || 0) - 45) },
                  { label: '-15°', val: normalizeRotationDeg((selectedNode.rotation || 0) - 15) },
                  { label: '0°', val: 0 },
                  { label: '+15°', val: normalizeRotationDeg((selectedNode.rotation || 0) + 15) },
                  { label: '+45°', val: normalizeRotationDeg((selectedNode.rotation || 0) + 45) },
                  { label: '+90°', val: normalizeRotationDeg((selectedNode.rotation || 0) + 90) }
                ].map(btn => (
                  <button
                    key={btn.label}
                    type="button"
                    onClick={() => onUpdateNode(selectedNode.id, { rotation: btn.val })}
                    className="py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-cyan-500 font-semibold transition-colors"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              {onMirrorNodes && (
                <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => onMirrorNodes([selectedNode.id], 'horizontal')}
                    aria-pressed={Boolean(selectedNode.flipX)}
                    className={`py-1 px-2 rounded border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      selectedNode.flipX
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-400 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <FlipHorizontal2 className="w-3.5 h-3.5" />
                    <span>Lật ngang</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onMirrorNodes([selectedNode.id], 'vertical')}
                    aria-pressed={Boolean(selectedNode.flipY)}
                    className={`py-1 px-2 rounded border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors ${
                      selectedNode.flipY
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-400 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <FlipVertical2 className="w-3.5 h-3.5" />
                    <span>Lật dọc</span>
                  </button>
                </div>
              )}
            </fieldset>

            {isBasicMode && (
              <fieldset disabled={isReadOnlyMode} className="space-y-2.5">
                {renderCameraFovCard()}
                {renderWifiCoverageCard()}
              </fieldset>
            )}

            {!isReadOnlyMode && (onCopyNodeStyle || onPasteNodeStyle) && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-1.5">
                {onCopyNodeStyle && (
                  <button
                    type="button"
                    onClick={() => onCopyNodeStyle(selectedNode.id)}
                    className="py-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] bg-white dark:bg-slate-900 text-xs font-medium flex items-center justify-center gap-1.5"
                  >
                    <Paintbrush className="w-3.5 h-3.5 text-[#155EEF]" />
                    <span>Sao chép kiểu</span>
                  </button>
                )}
                {onPasteNodeStyle && (
                  <button
                    type="button"
                    disabled={!hasCopiedStyle}
                    onClick={() => onPasteNodeStyle([selectedNode.id])}
                    className="py-1.5 px-2.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-[#155EEF] bg-white dark:bg-slate-900 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <Paintbrush className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Dán kiểu</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MẠNG / KẾT NỐI */}
        {effectiveTab === 'network' && (
          <div className="space-y-3">
            {selectedAsset && selectedAsset.category !== 'ups' && (
              <fieldset disabled={isReadOnlyMode} className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <div className={isBasicMode ? 'col-span-3' : 'col-span-2'}>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Địa chỉ IP
                    </label>
                    <input
                      type="text"
                      value={selectedAsset.ipAddress}
                      onChange={e => onUpdateAsset(selectedAsset.id, { ipAddress: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                    />
                  </div>
                  {!isBasicMode && (
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                        VLAN
                      </label>
                      <input
                        type="text"
                        value={selectedAsset.vlan}
                        onChange={e => onUpdateAsset(selectedAsset.id, { vlan: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs disabled:opacity-70"
                        placeholder="10, 20"
                      />
                    </div>
                  )}
                </div>

                {!isBasicMode && (
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Subnet Mask
                    </label>
                    <input
                      type="text"
                      value={selectedAsset.subnetMask}
                      onChange={e => onUpdateAsset(selectedAsset.id, { subnetMask: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs disabled:opacity-70"
                    />
                  </div>
                )}
              </fieldset>
            )}

            {/* Cổng kết nối */}
            {selectedAsset && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Cổng ({assetPorts.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenDeepInspect(selectedAsset.id)}
                    className="text-xs font-medium text-[#155EEF] dark:text-blue-400 hover:underline"
                  >
                    Ma trận cổng
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                  {(
                    [
                      { id: 'all', label: `Tất cả (${assetPorts.length})` },
                      { id: 'used', label: `Đang nối (${assetPorts.filter(p => p.status === 'up').length})` },
                      { id: 'free', label: `Trống (${assetPorts.filter(p => p.status !== 'up').length})` }
                    ] as const
                  ).map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setPortFilter(f.id)}
                      className={`py-1 rounded text-xs font-semibold truncate ${
                        portFilter === f.id
                          ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {filteredPorts.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 text-xs border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                    Không có cổng phù hợp bộ lọc.
                  </div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {filteredPorts.map(pt => {
                      const linkedCab = pt.connectedCableId
                        ? project.cables.find(c => c.id === pt.connectedCableId)
                        : undefined;
                      const peerAsset = pt.connectedTarget?.deviceId
                        ? project.assets[pt.connectedTarget.deviceId]
                        : pt.patchedToDeviceId
                        ? project.assets[pt.patchedToDeviceId]
                        : undefined;
                      return (
                        <div
                          key={pt.id}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`w-2 h-2 rounded-sm shrink-0 ${
                                pt.status === 'up'
                                  ? 'bg-emerald-500'
                                  : pt.status === 'down'
                                  ? 'bg-rose-500'
                                  : 'bg-slate-400'
                              }`}
                            />
                            <span className="font-mono font-semibold truncate">{pt.name}</span>
                            {pt.poe && (
                              <span className="text-xs font-mono tabular-nums text-amber-700 dark:text-amber-300 shrink-0">
                                {pt.poeWatts ? `PoE ${pt.poeWatts}W` : 'PoE'}
                              </span>
                            )}
                            {peerAsset && (
                              <span className="text-[10.5px] text-slate-500 dark:text-slate-400 truncate">
                                → {peerAsset.name}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {linkedCab && onSelectCable ? (
                              <button
                                type="button"
                                onClick={() => onSelectCable(linkedCab.id)}
                                className="text-xs font-mono text-[#155EEF] dark:text-blue-400 hover:underline truncate max-w-[96px]"
                                title={`Chọn dây cáp ${linkedCab.cableCode}`}
                              >
                                {linkedCab.cableCode}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                {pt.speed}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tuyến cáp đang nối */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Dây cáp kết nối ({connectedCables.length})
              </div>
              {connectedCables.length === 0 ? (
                <div className="text-center py-4 text-slate-500 text-xs border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                  Chưa có dây cáp nối. Dùng công cụ Nối dây (<kbd className="font-mono">C</kbd>) để nối.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {connectedCables.map(cab => {
                    const isSource = cab.sourceNodeId === selectedNode.id;
                    const peerId = isSource ? cab.targetNodeId : cab.sourceNodeId;
                    const peerNode = project.nodes.find(n => n.id === peerId);
                    const peerAsset = peerNode?.assetId ? project.assets[peerNode.assetId] : undefined;
                    return (
                      <div
                        key={cab.id}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex items-center justify-between gap-2"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectCable?.(cab.id)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: cab.color || '#155EEF' }}
                            />
                            <span className="font-mono font-semibold text-slate-900 dark:text-white truncate">
                              {cab.label || cab.cableCode}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {isSource ? '→' : '←'} {peerAsset?.name || peerNode?.label || peerId} ·{' '}
                            <span className="font-mono tabular-nums">
                              {cab.bandwidth} · {cab.lengthMeters}m
                            </span>
                          </div>
                        </button>
                        {!isReadOnlyMode && (
                          <button
                            type="button"
                            onClick={() => onDeleteCable(cab.id)}
                            aria-label={`Ngắt dây cáp ${cab.cableCode}`}
                            className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-500 shrink-0"
                            title="Ngắt / Xóa dây cáp"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: VẬT LÝ (Lớp Layer, Tầng, Phòng, Tủ Rack, Công suất PoE, Camera/Wi-Fi) */}
        {effectiveTab === 'physical' && !isBasicMode && (
          <fieldset disabled={isReadOnlyMode} className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-600 dark:text-slate-400 text-xs font-medium">
                  Lớp bản vẽ (Layer)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateNode(selectedNode.id, {
                        layerId: classifyDeviceLayer(selectedNode, project.assets)
                      })
                    }
                    className="text-[11px] font-semibold text-[#155EEF] hover:underline"
                    title="Gán riêng thiết bị này vào đúng lớp theo loại"
                  >
                    Tự chọn lớp này
                  </button>
                  {onAutoLayerDevices && (
                    <button
                      type="button"
                      onClick={onAutoLayerDevices}
                      className="text-[11px] font-semibold text-teal-600 dark:text-teal-400 hover:underline"
                      title="Phân lớp tự động toàn bộ thiết bị trên bản vẽ"
                    >
                      Phân lớp tất cả
                    </button>
                  )}
                </div>
              </div>
              <select
                value={resolveNodeLayer(selectedNode, project.assets)}
                onChange={e =>
                  onUpdateNode(selectedNode.id, {
                    layerId: e.target.value as CanvasLayerId
                  })
                }
                className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
              >
                <option value="devices">Thiết bị chung</option>
                <option value="network">Thiết bị Mạng (Network)</option>
                <option value="iot">IoT &amp; Cảm biến / Không dây</option>
                <option value="electrical">Nguồn &amp; Điện (Electrical)</option>
                <option value="labels">Nhãn IP &amp; Chú thích</option>
                <option value="racks">Tủ Server Rack</option>
              </select>
            </div>
            {selectedAsset ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Tầng
                    </label>
                    <select
                      value={selectedAsset.floorId || ''}
                      onChange={e => {
                        onUpdateAsset(selectedAsset.id, { floorId: e.target.value });
                        onUpdateNode(selectedNode.id, { floorId: e.target.value });
                      }}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
                    >
                      <option value="">-- Chưa gán --</option>
                      {project.floors.map(fl => (
                        <option key={fl.id} value={fl.id}>
                          {fl.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Phòng
                    </label>
                    <select
                      value={selectedAsset.roomId || ''}
                      onChange={e => onUpdateAsset(selectedAsset.id, { roomId: e.target.value })}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
                    >
                      <option value="">-- Chưa gán --</option>
                      {project.rooms.map(rm => (
                        <option key={rm.id} value={rm.id}>
                          {rm.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Tủ Rack gá
                    </label>
                    <select
                      value={selectedAsset.rackId || ''}
                      onChange={e => {
                        const targetRackId = e.target.value;
                        if (!targetRackId) {
                          if (selectedAsset.rackId && onRemoveDeviceFromRackSlot) {
                            onRemoveDeviceFromRackSlot(selectedAsset.rackId, selectedAsset.id, selectedAsset.rackSide || 'front');
                          } else {
                            onUpdateAsset(selectedAsset.id, { rackId: undefined, rackUnitStart: undefined });
                          }
                          return;
                        }
                        const rk = project.racks.find(r => r.id === targetRackId);
                        const uH = getAssetUHeight(selectedAsset);
                        const desiredU = selectedAsset.rackUnitStart || 1;
                        const side = selectedAsset.rackSide || 'front';
                        if (rk && onAssignDeviceToRackSlot) {
                          if (canPlaceDeviceAtU(rk, project.assets, desiredU, uH, selectedAsset.id, side)) {
                            onAssignDeviceToRackSlot(targetRackId, selectedAsset.id, desiredU, side);
                          } else {
                            for (let u = rk.totalUnits; u >= 1; u--) {
                              if (canPlaceDeviceAtU(rk, project.assets, u, uH, selectedAsset.id, side)) {
                                onAssignDeviceToRackSlot(targetRackId, selectedAsset.id, u, side);
                                break;
                              }
                            }
                          }
                        }
                      }}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
                    >
                      <option value="">-- Không --</option>
                      {project.racks.map(rk => (
                        <option key={rk.id} value={rk.id}>
                          {rk.name} ({rk.totalUnits}U)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Vị trí U &amp; Mặt
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        min={1}
                        max={project.racks.find(r => r.id === selectedAsset.rackId)?.totalUnits || 60}
                        disabled={isReadOnlyMode || !selectedAsset.rackId}
                        value={selectedAsset.rackUnitStart || ''}
                        onChange={e => {
                          const val = parseInt(e.target.value, 10);
                          if (selectedAsset.rackId && !Number.isNaN(val) && onAssignDeviceToRackSlot) {
                            onAssignDeviceToRackSlot(selectedAsset.rackId, selectedAsset.id, val, selectedAsset.rackSide || 'front');
                          }
                        }}
                        className="w-1/2 px-1.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-40 font-mono text-xs tabular-nums"
                        placeholder="U"
                      />
                      <select
                        disabled={isReadOnlyMode || !selectedAsset.rackId}
                        value={selectedAsset.rackSide || 'front'}
                        onChange={e => {
                          const nextSide = e.target.value as RackSide;
                          if (selectedAsset.rackId && onAssignDeviceToRackSlot) {
                            onAssignDeviceToRackSlot(selectedAsset.rackId, selectedAsset.id, selectedAsset.rackUnitStart || 1, nextSide);
                          }
                        }}
                        className="w-1/2 px-1 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-40"
                      >
                        <option value="front">Trước</option>
                        <option value="rear">Sau</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Cao (U)
                    </label>
                    <select
                      value={getAssetUHeight(selectedAsset)}
                      onChange={e => onUpdateAsset(selectedAsset.id, { rackUnitHeight: parseInt(e.target.value, 10) })}
                      className="w-full px-1.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs disabled:opacity-70"
                    >
                      {[1, 2, 3, 4, 6].map(h => (
                        <option key={h} value={h}>
                          {h}U
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      {selectedAsset.category === 'ups' ? 'Công suất định mức (W)' : 'Công suất (W)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={selectedAsset.powerWatts || 0}
                      onChange={e => onUpdateAsset(selectedAsset.id, { powerWatts: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-1.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                      Nặng (kg)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min={0}
                      value={selectedAsset.weightKg || 0}
                      onChange={e => onUpdateAsset(selectedAsset.id, { weightKg: parseFloat(e.target.value) || 0 })}
                      className="w-full px-1.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                    />
                  </div>
                </div>

                {/* PoE Power Configuration (Explicit Role: PSE supply / PD draw / None) */}
                {!['rack', 'cloud', 'telecom_tower', 'odf', 'patch_panel', 'ups', 'electrical_panel'].includes(
                  selectedAsset.category
                ) && (() => {
                  const currentRole: PoeDeviceRole = selectedAsset.poeRole
                    ? selectedAsset.poeRole
                    : selectedAsset.poeEnabled === true
                    ? 'pd'
                    : selectedAsset.poeEnabled === false
                    ? 'none'
                    : 'auto';
                  const resolvedRole = resolvePoeDeviceRole(selectedAsset);
                  const showPseInput =
                    currentRole === 'pse' ||
                    (currentRole === 'auto' &&
                      (resolvedRole === 'pse' || isPseCategoryCandidate(selectedAsset.category)));
                  const showPdInput =
                    currentRole === 'pd' ||
                    (currentRole === 'auto' && resolvedRole === 'pd');

                  return (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                          Vai trò PoE
                        </span>
                        <select
                          aria-label="Vai trò PoE"
                          value={currentRole}
                          onChange={e => {
                            const nextRole = e.target.value as PoeDeviceRole;
                            onUpdateAsset(selectedAsset.id, {
                              poeRole: nextRole,
                              poeEnabled: nextRole === 'pd' ? true : nextRole === 'none' ? false : undefined
                            });
                          }}
                          className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium disabled:opacity-70"
                        >
                          <option value="auto">Tự động theo thiết bị</option>
                          <option value="pse">Cấp nguồn PoE (PSE)</option>
                          <option value="pd">Nhận nguồn PoE (PD)</option>
                          <option value="none">Không dùng PoE</option>
                        </select>
                      </div>

                      {showPseInput && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                              Ngân sách cấp PoE
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {isPseDevice(selectedAsset)
                                ? `${selectedAsset.ports.filter(p => p.poe).length} cổng PoE khả dụng`
                                : 'Để trống hoặc 0 nếu không cấp PoE'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={0}
                              placeholder={String(isPseDevice(selectedAsset) ? resolvePseBudgetWatts(selectedAsset) : 0)}
                              value={selectedAsset.poeBudgetWatts ?? ''}
                              onChange={e => {
                                const raw = e.target.value.trim();
                                onUpdateAsset(selectedAsset.id, {
                                  poeBudgetWatts: raw === '' ? undefined : Math.max(0, parseInt(raw, 10) || 0)
                                });
                              }}
                              className="w-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums text-right text-xs disabled:opacity-70"
                            />
                            <span className="text-xs font-mono text-slate-500">W</span>
                          </div>
                        </div>
                      )}

                      {showPdInput && isPoeConsumerDevice(selectedAsset) && (() => {
                        const resolved = resolveDevicePoeWatts(selectedAsset);
                        const std = classifyPoeStandard(resolved.watts);
                        return (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              Công suất rút (Chuẩn {std.label})
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                placeholder={String(resolved.watts)}
                                value={selectedAsset.poeWatts ?? ''}
                                onChange={e => {
                                  const raw = e.target.value.trim();
                                  onUpdateAsset(selectedAsset.id, {
                                    poeWatts: raw === '' ? undefined : Math.max(0, parseFloat(raw) || 0)
                                  });
                                }}
                                className="w-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums text-right text-xs disabled:opacity-70"
                              />
                              <span className="text-xs font-mono text-slate-500">W</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* UPS Battery Configuration */}
                {selectedAsset.category === 'ups' && (() => {
                  const specs = selectedAsset.upsSpecs || {
                    batteryAh: 9,
                    batteryVoltageV: 12,
                    batteryCount: 8,
                    inverterEfficiency: 0.85,
                    dodFactor: 0.8
                  };
                  const eff = specs.inverterEfficiency ?? 0.85;
                  const dod = specs.dodFactor ?? 0.8;
                  const rawWh = Math.round(specs.batteryAh * specs.batteryVoltageV * specs.batteryCount);
                  const usableWh = Math.round(rawWh * eff * dod);
                  const updateUpsSpecs = (partial: Partial<NonNullable<DeviceAsset['upsSpecs']>>) => {
                    onUpdateAsset(selectedAsset.id, {
                      upsSpecs: {
                        ...specs,
                        ...partial
                      }
                    });
                  };
                  return (
                    <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-rose-800 dark:text-rose-200">
                          Thông số ắc quy UPS
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-rose-700 dark:text-rose-300 tabular-nums">
                          {usableWh} Wh khả dụng
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <div>
                          <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                            Dung lượng (Ah)
                          </label>
                          <input
                            type="number"
                            min={1}
                            step="1"
                            value={specs.batteryAh}
                            onChange={e =>
                              updateUpsSpecs({ batteryAh: Math.max(1, parseFloat(e.target.value) || 1) })
                            }
                            className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                            Điện áp (V)
                          </label>
                          <select
                            value={specs.batteryVoltageV}
                            onChange={e =>
                              updateUpsSpecs({ batteryVoltageV: Math.max(12, parseInt(e.target.value, 10) || 12) })
                            }
                            className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
                          >
                            <option value={12}>12V</option>
                            <option value={24}>24V</option>
                            <option value={48}>48V</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                            Số bình
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={64}
                            value={specs.batteryCount}
                            onChange={e =>
                              updateUpsSpecs({ batteryCount: Math.max(1, parseInt(e.target.value, 10) || 1) })
                            }
                            className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                            Hiệu suất inverter (%)
                          </label>
                          <input
                            type="number"
                            min={50}
                            max={98}
                            value={Math.round(eff * 100)}
                            onChange={e =>
                              updateUpsSpecs({
                                inverterEfficiency: Math.max(0.5, Math.min(0.98, (parseInt(e.target.value, 10) || 85) / 100))
                              })
                            }
                            className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                            Độ xả sâu DoD (%)
                          </label>
                          <input
                            type="number"
                            min={40}
                            max={95}
                            value={Math.round(dod * 100)}
                            onChange={e =>
                              updateUpsSpecs({
                                dodFactor: Math.max(0.4, Math.min(0.95, (parseInt(e.target.value, 10) || 80) / 100))
                              })
                            }
                            className="w-full px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {renderCameraFovCard()}
                {renderWifiCoverageCard()}
              </>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                    Thuộc tầng
                  </label>
                  <select
                    value={selectedNode.floorId || ''}
                    onChange={e => onUpdateNode(selectedNode.id, { floorId: e.target.value || undefined })}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
                  >
                    <option value="">-- Mọi tầng --</option>
                    {project.floors.map(fl => (
                      <option key={fl.id} value={fl.id}>
                        {fl.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md bg-slate-50/50 dark:bg-slate-800/30">
                  <div className="px-3 py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Vị trí</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white mt-0.5">
                      {Math.round(selectedNode.x)}, {Math.round(selectedNode.y)}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Kích thước</div>
                    <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white mt-0.5">
                      {selectedNode.width}×{selectedNode.height}
                    </div>
                  </div>
                </div>
                {renderCameraFovCard()}
                {renderWifiCoverageCard()}
              </div>
            )}
          </fieldset>
        )}

        {/* TAB 4: GHI CHÚ + NÂNG CAO ACCORDION */}
        {effectiveTab === 'notes' && (
          <fieldset disabled={isReadOnlyMode} className="space-y-3">
            <div>
              <label className="text-slate-600 dark:text-slate-400 text-xs font-medium block mb-1">
                Ghi chú kỹ thuật &amp; Vận hành
              </label>
              <textarea
                rows={4}
                placeholder="Ghi chú lắp đặt, thông số cổng uplink, người phụ trách hoặc lưu ý bảo trì..."
                value={noteText}
                onChange={e =>
                  onUpdateNode(selectedNode.id, {
                    customData: { ...selectedNode.customData, note: e.target.value }
                  })
                }
                className="w-full px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs disabled:opacity-70"
              />
            </div>

            {/* Collapsible Advanced Accordion */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setAdvancedOpen(v => !v)}
                aria-expanded={advancedOpen}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors"
              >
                <span>Nâng cao (Tọa độ, Hình khối &amp; Biểu tượng)</span>
                {advancedOpen ? (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {advancedOpen && (
                <div className="p-3 space-y-3 border-t border-slate-200 dark:border-slate-800">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">Tọa độ X (px)</label>
                      <input
                        type="number"
                        value={Math.round(selectedNode.x)}
                        onChange={e => onUpdateNode(selectedNode.id, { x: parseInt(e.target.value, 10) || 0 })}
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">Tọa độ Y (px)</label>
                      <input
                        type="number"
                        value={Math.round(selectedNode.y)}
                        onChange={e => onUpdateNode(selectedNode.id, { y: parseInt(e.target.value, 10) || 0 })}
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">Rộng (px)</label>
                      <input
                        type="number"
                        value={selectedNode.width}
                        onChange={e =>
                          onUpdateNode(selectedNode.id, { width: Math.max(40, parseInt(e.target.value, 10) || 40) })
                        }
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">Cao (px)</label>
                      <input
                        type="number"
                        value={selectedNode.height}
                        onChange={e =>
                          onUpdateNode(selectedNode.id, { height: Math.max(30, parseInt(e.target.value, 10) || 30) })
                        }
                        className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 items-center">
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">Góc xoay (0–359°)</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={359}
                          step={1}
                          aria-label="Góc xoay nâng cao (độ)"
                          value={Math.round(normalizeRotationDeg(selectedNode.rotation || 0))}
                          onChange={e => {
                            const val = parseFloat(e.target.value);
                            if (!Number.isNaN(val)) {
                              onUpdateNode(selectedNode.id, { rotation: normalizeRotationDeg(val) });
                            }
                          }}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs tabular-nums disabled:opacity-70"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateNode(selectedNode.id, {
                              rotation: normalizeRotationDeg((selectedNode.rotation || 0) + 90)
                            })
                          }
                          className="px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-mono shrink-0"
                          title="Xoay thêm +90°"
                        >
                          +90°
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">Hình khối</label>
                      <div className="grid grid-cols-3 gap-0.5 bg-slate-100 dark:bg-slate-800 p-0.5 rounded border border-slate-200 dark:border-slate-700">
                        {(
                          [
                            { id: 'round', label: 'Bo' },
                            { id: 'rect', label: 'Vuông' },
                            { id: 'circle', label: 'Tròn' }
                          ] as const
                        ).map(sh => {
                          const active = (selectedNode.style.shape || 'round') === sh.id;
                          return (
                            <button
                              key={sh.id}
                              type="button"
                              onClick={() =>
                                onUpdateNode(selectedNode.id, {
                                  style: { ...selectedNode.style, shape: sh.id }
                                })
                              }
                              className={`py-1 rounded text-xs font-medium disabled:opacity-60 ${
                                active
                                  ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                                  : 'text-slate-500'
                              }`}
                            >
                              {sh.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-slate-600 dark:text-slate-400 text-xs block mb-1">Màu khối</label>
                    <div className="flex items-center flex-wrap gap-1.5">
                      {['#155eef', '#0891b2', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#475569'].map(c => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Chọn màu khối ${c}`}
                          onClick={() =>
                            onUpdateNode(selectedNode.id, {
                              style: { ...selectedNode.style, backgroundColor: c }
                            })
                          }
                          className={`w-5 h-5 rounded border disabled:opacity-60 ${
                            selectedNode.style.backgroundColor?.toLowerCase() === c
                              ? 'ring-2 ring-[#155EEF] scale-110'
                              : 'border-black/15'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <label className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center gap-1 cursor-pointer text-xs font-mono">
                        <span
                          className="w-3.5 h-3.5 rounded-xs border border-black/15"
                          style={{ backgroundColor: selectedNode.style.backgroundColor || '#155eef' }}
                        />
                        <span>{normalizeCableColor(selectedNode.style.backgroundColor || '#155eef').toUpperCase()}</span>
                        <input
                          type="color"
                          value={normalizeCableColor(selectedNode.style.backgroundColor || '#155eef')}
                          onChange={e =>
                            onUpdateNode(selectedNode.id, {
                              style: { ...selectedNode.style, backgroundColor: e.target.value }
                            })
                          }
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Icon, 2D Illustration, Brand Logos, Custom Upload */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-600 dark:text-slate-400 text-xs font-medium">
                        Biểu tượng &amp; Logo
                      </label>
                      {!isReadOnlyMode &&
                        (selectedNode.customIcon || safeCustomImageUrl || selectedAsset?.customIcon) && (
                          <button
                            type="button"
                            onClick={() => {
                              if (onSetNodeIconOrLogo) {
                                onSetNodeIconOrLogo(selectedNode.id, { customIcon: undefined, customImageUrl: undefined });
                              } else {
                                onUpdateNode(selectedNode.id, { customIcon: undefined, customImageUrl: undefined });
                                if (selectedAsset) {
                                  onUpdateAsset(selectedAsset.id, { customIcon: undefined, customImageUrl: undefined });
                                }
                              }
                            }}
                            className="text-xs text-[#155EEF] hover:underline flex items-center gap-0.5"
                          >
                            <RotateCcw className="w-3 h-3" /> Mặc định
                          </button>
                        )}
                    </div>

                    <div className="grid grid-cols-5 gap-1">
                      {DEVICE_ICON_OPTIONS.map(opt => {
                        const IconComp = opt.component;
                        const active =
                          (selectedNode.customIcon || selectedAsset?.customIcon) === opt.id &&
                          !safeCustomImageUrl;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              if (onSetNodeIconOrLogo) {
                                onSetNodeIconOrLogo(selectedNode.id, { customIcon: opt.id, customImageUrl: undefined });
                              } else {
                                onUpdateNode(selectedNode.id, { customIcon: opt.id, customImageUrl: undefined });
                                if (selectedAsset) {
                                  onUpdateAsset(selectedAsset.id, { customIcon: opt.id, customImageUrl: undefined });
                                }
                              }
                            }}
                            className={`p-1.5 rounded border flex items-center justify-center disabled:opacity-60 ${
                              active
                                ? 'bg-[#155EEF] text-white border-[#155EEF]'
                                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-[#155EEF]'
                            }`}
                            title={opt.label}
                          >
                            <IconComp className="w-3.5 h-3.5" />
                          </button>
                        );
                      })}
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 mb-1">Hình chiếu 2D</div>
                      <div className="grid grid-cols-5 gap-1">
                        {ISOMETRIC_ICON_OPTIONS.map(iso => {
                          const active =
                            (selectedNode.customIcon || selectedAsset?.customIcon) === iso.id &&
                            !safeCustomImageUrl;
                          return (
                            <button
                              key={iso.id}
                              type="button"
                              onClick={() => {
                                if (onSetNodeIconOrLogo) {
                                  onSetNodeIconOrLogo(selectedNode.id, { customIcon: iso.id, customImageUrl: undefined });
                                } else {
                                  onUpdateNode(selectedNode.id, { customIcon: iso.id, customImageUrl: undefined });
                                }
                              }}
                              className={`p-1 rounded border flex items-center justify-center disabled:opacity-60 ${
                                active
                                  ? 'border-[#155EEF] bg-blue-50 dark:bg-blue-950/40'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                              }`}
                              title={iso.label}
                            >
                              <img
                                src={iso.imageSrc}
                                alt={iso.label}
                                referrerPolicy="no-referrer"
                                className="w-7 h-7 object-contain"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 mb-1">Logo hãng</div>
                      <div className="grid grid-cols-3 gap-1">
                        {BRAND_LOGO_OPTIONS.map(logo => {
                          const active =
                            (selectedNode.customIcon || selectedAsset?.customIcon) === logo.id &&
                            !safeCustomImageUrl;
                          return (
                            <button
                              key={logo.id}
                              type="button"
                              onClick={() => {
                                if (onSetNodeIconOrLogo) {
                                  onSetNodeIconOrLogo(selectedNode.id, { customIcon: logo.id, customImageUrl: undefined });
                                } else {
                                  onUpdateNode(selectedNode.id, { customIcon: logo.id, customImageUrl: undefined });
                                }
                              }}
                              className={`p-1 rounded border flex flex-col items-center gap-0.5 disabled:opacity-60 ${
                                active
                                  ? 'border-[#155EEF] bg-blue-50 dark:bg-blue-950/40'
                                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'
                              }`}
                              title={logo.label}
                            >
                              {renderBrandLogoBadge(logo, 'w-5 h-5')}
                              <span className="text-xs font-semibold truncate w-full text-center">
                                {logo.shortCode}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {!isReadOnlyMode && (
                      <label className="w-full py-1.5 px-2 rounded border border-dashed border-[#155EEF] bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50 text-[#155EEF] dark:text-blue-300 font-medium flex items-center justify-center gap-1.5 cursor-pointer text-xs">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Tải ảnh / Logo riêng</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setIconUploadError(null);
                            const res = await validateAndConvertIconImage(file);
                            if (!res.ok) {
                              setIconUploadError(res.error);
                            } else {
                              const safeUploaded = sanitizeSafeImageUrl(res.dataUrl);
                              if (!safeUploaded) {
                                setIconUploadError('Ảnh tải lên chứa định dạng hoặc mã nhúng không hợp lệ.');
                              } else if (onSetNodeIconOrLogo) {
                                onSetNodeIconOrLogo(selectedNode.id, { customImageUrl: safeUploaded, customIcon: undefined });
                              } else {
                                onUpdateNode(selectedNode.id, { customImageUrl: safeUploaded, customIcon: undefined });
                              }
                            }
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                    {iconUploadError && <div className="text-xs text-rose-600">{iconUploadError}</div>}
                  </div>
                </div>
              )}
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
};
