import React, { useState, useRef, useEffect, Suspense, lazy } from 'react';
import {
  ProjectState,
  DeviceAsset,
  ServerRack,
  RackSide,
  STANDARD_RACK_UNITS
} from '../../types/infrastructure';
import {
  X,
  Server,
  Box,
  Trash2,
  ArrowUp,
  ArrowDown,
  GripVertical,
  AlertTriangle,
  Search,
  Wind,
  Flame,
  Plus,
  Layers,
  CheckCircle2
} from 'lucide-react';
import {
  getAssetUHeight,
  canPlaceDeviceAtU,
  clampStartU,
  findNearestAvailableU,
  pixelYToRackU,
  getSlotSpanRect,
  getRackSlotsForSide,
  getRackStatistics,
  clampRackUnits
} from '../../utils/rackGeometry';
import {
  analyzeRackAirflow,
  getDefaultRackFanCount,
  RackDoorAirflowType
} from '../../utils/rackAirflow';
import { DEVICE_CATALOG } from '../../data/deviceCatalog';
import { useFocusTrap } from '../../hooks/useFocusTrap';

const Rack3DVisualizer = lazy(() =>
  import('../rack/Rack3DVisualizer').then(m => ({ default: m.Rack3DVisualizer }))
);

const MODAL_SLOT_HEIGHT = 28; // exact pixel height per 1U slot row

interface DeepInspectModalProps {
  inspectId: string | null;
  project: ProjectState;
  isOpen: boolean;
  onClose: () => void;
  onUpdateAsset: (assetId: string, partial: Partial<DeviceAsset>) => void;
  onUpdateRack: (rackId: string, partial: Partial<ServerRack>) => void;
  onAssignDeviceToRackSlot?: (rackId: string, assetId: string, preferredU: number, side?: RackSide) => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onDropPresetIntoRack?: (presetName: string, rackId: string, preferredU: number, side?: RackSide) => void;
  initialRackView?: '2d' | '3d';
  isDark?: boolean;
}

export const DeepInspectModal: React.FC<DeepInspectModalProps> = ({
  inspectId,
  project,
  isOpen,
  onClose,
  onUpdateAsset,
  onUpdateRack,
  onAssignDeviceToRackSlot,
  onRemoveDeviceFromRackSlot,
  onDropPresetIntoRack,
  initialRackView = '2d',
  isDark
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const slotsGridRef = useRef<HTMLDivElement>(null);
  const [rackViewMode, setRackViewMode] = useState<'2d' | '3d'>(initialRackView);
  const [rightSidebarTab, setRightSidebarTab] = useState<'devices' | 'airflow'>('devices');
  const [activeSide, setActiveSide] = useState<RackSide>('front');
  const [deviceQuery, setDeviceQuery] = useState<string>('');
  const [dragInfo, setDragInfo] = useState<{ assetId: string; uHeight: number } | null>(null);
  const [dropPreview, setDropPreview] = useState<{ startU: number; uHeight: number; valid: boolean } | null>(null);
  const [rackAlert, setRackAlert] = useState<string | null>(null);
  const [selected3DAssetId, setSelected3DAssetId] = useState<string | null>(null);
  const [doorType, setDoorType] = useState<RackDoorAirflowType>('perforated');
  const [fanCount, setFanCount] = useState<number>(4);
  const [highlightedGap, setHighlightedGap] = useState<{ startU: number; endU: number } | null>(null);

  useEffect(() => {
    if (isOpen && inspectId) {
      setRackViewMode(initialRackView);
      setSelected3DAssetId(null);
      setHighlightedGap(null);
      const targetRack = project.racks.find(r => r.id === inspectId);
      if (targetRack) {
        setFanCount(getDefaultRackFanCount(targetRack));
      }
    }
  }, [isOpen, inspectId, initialRackView, project.racks]);

  useFocusTrap(dialogRef, isOpen && Boolean(inspectId), onClose);

  const resolvedDark =
    isDark ?? (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));

  if (!isOpen || !inspectId) return null;

  // 1. ROBUST RACK RESOLUTION (Ensures racks NEVER open as switch port matrix!)
  let rack = project.racks.find(r => r.id === inspectId);

  if (!rack) {
    const node = project.nodes.find(n => n.id === inspectId || n.assetId === inspectId);
    if (node?.customData?.rackId) {
      rack = project.racks.find(r => r.id === node.customData?.rackId);
    } else if (node?.type === 'rack' || node?.label?.toLowerCase().includes('rack')) {
      rack = project.racks.find(r => r.name === node.label || r.id === node.id) || project.racks[0];
    }
  }

  if (!rack) {
    const assetCandidate = project.assets[inspectId] ||
      (() => {
        const node = project.nodes.find(n => n.id === inspectId);
        return node?.assetId ? project.assets[node.assetId] : undefined;
      })();

    if (assetCandidate && (assetCandidate.category === 'rack' || assetCandidate.model?.includes('42U') || assetCandidate.name?.toLowerCase().includes('rack'))) {
      rack = project.racks.find(r => r.id === assetCandidate.id || r.name === assetCandidate.name) || {
        id: assetCandidate.id,
        name: assetCandidate.name || 'Tủ Server Rack 42U',
        totalUnits: 42,
        widthMm: 800,
        depthMm: 1000,
        maxLoadKg: 1200,
        x: 300,
        y: 100,
        slots: {},
        rearSlots: {}
      };
    }
  }

  // 2. DEVICE ASSET RESOLUTION (For Switches, Routers, Firewalls, Cameras, Servers)
  const asset = !rack ? (
    project.assets[inspectId] ||
    (() => {
      const node = project.nodes.find(n => n.id === inspectId);
      return node?.assetId ? project.assets[node.assetId] : undefined;
    })()
  ) : undefined;

  // -------------------------------------------------------------
  // VIEW A: RACK 19-INCH ELEVATION (FRONT/REAR + FREE-FORM DRAG & DROP)
  // -------------------------------------------------------------
  if (rack) {
    const activeRack = rack;
    const totalUnits = activeRack.totalUnits || 42;
    const stats = getRackStatistics(activeRack, project.assets);
    const activeSlotMap = getRackSlotsForSide(activeRack, activeSide);

    const occupiedEntries = Object.entries(activeSlotMap)
      .map(([uStr, devId]) => ({
        startU: parseInt(uStr, 10),
        devId,
        dev: project.assets[devId],
        uHeight: getAssetUHeight(project.assets[devId])
      }))
      .filter(entry => !Number.isNaN(entry.startU) && Boolean(entry.dev));

    const showAlert = (msg: string) => {
      setRackAlert(msg);
      setTimeout(() => setRackAlert(null), 3500);
    };

    const assignToU = (uNumber: number, deviceId: string, targetSide: RackSide = activeSide) => {
      const dev = project.assets[deviceId];
      const uHeight = getAssetUHeight(dev);
      if (uHeight > totalUnits) {
        showAlert(`Thiết bị "${dev?.name}" cao ${uHeight}U vượt quá chiều cao tủ (${totalUnits}U)!`);
        return;
      }
      const clampedU = clampStartU(uNumber, totalUnits, uHeight);

      if (!canPlaceDeviceAtU(activeRack, project.assets, clampedU, uHeight, deviceId, targetSide)) {
        showAlert(`Vị trí U${clampedU}${uHeight > 1 ? `-U${clampedU + uHeight - 1}` : ''} trên mặt ${targetSide === 'front' ? 'trước' : 'sau'} đã bị chiếm!`);
        return;
      }

      if (onAssignDeviceToRackSlot) {
        onAssignDeviceToRackSlot(activeRack.id, deviceId, clampedU, targetSide);
        return;
      }

      const nextFront = { ...activeRack.slots };
      const nextRear = { ...(activeRack.rearSlots || {}) };
      for (const [oldU, dId] of Object.entries(nextFront)) {
        if (dId === deviceId) delete nextFront[parseInt(oldU, 10)];
      }
      for (const [oldU, dId] of Object.entries(nextRear)) {
        if (dId === deviceId) delete nextRear[parseInt(oldU, 10)];
      }
      if (targetSide === 'rear') nextRear[clampedU] = deviceId;
      else nextFront[clampedU] = deviceId;

      onUpdateRack(activeRack.id, { slots: nextFront, rearSlots: nextRear });
      onUpdateAsset(deviceId, { rackId: activeRack.id, rackUnitStart: clampedU, rackUnitHeight: uHeight, rackSide: targetSide });
    };

    const unmountSlot = (uNumber: number, targetSide: RackSide = activeSide) => {
      if (onRemoveDeviceFromRackSlot) {
        onRemoveDeviceFromRackSlot(activeRack.id, uNumber, targetSide);
        return;
      }
      const sourceMap = targetSide === 'rear' ? { ...(activeRack.rearSlots || {}) } : { ...activeRack.slots };
      const devId = sourceMap[uNumber];
      delete sourceMap[uNumber];
      onUpdateRack(activeRack.id, targetSide === 'rear' ? { rearSlots: sourceMap } : { slots: sourceMap });
      if (devId) {
        onUpdateAsset(devId, { rackId: undefined, rackUnitStart: undefined, rackSide: undefined });
      }
    };

    const handleQuickAssign = (deviceId: string) => {
      const dev = project.assets[deviceId];
      const uHeight = getAssetUHeight(dev);
      const preferredStart = Math.max(1, totalUnits - 4);
      const openU = findNearestAvailableU(activeRack, project.assets, preferredStart, uHeight, deviceId, activeSide);
      if (openU !== null) {
        assignToU(openU, deviceId, activeSide);
      } else {
        showAlert(`Không còn khe trống đủ ${uHeight}U trên mặt ${activeSide === 'front' ? 'trước' : 'sau'}!`);
      }
    };

    const handleMoveSlot = (startU: number, deviceId: string, direction: 'up' | 'down') => {
      const uHeight = getAssetUHeight(project.assets[deviceId]);
      const step = direction === 'up' ? 1 : -1;
      let candidateU = startU + step;

      while (candidateU >= 1 && candidateU + uHeight - 1 <= totalUnits) {
        if (canPlaceDeviceAtU(activeRack, project.assets, candidateU, uHeight, deviceId, activeSide)) {
          assignToU(candidateU, deviceId, activeSide);
          return;
        }
        candidateU += step;
      }
    };

    const computeHoveredU = (clientY: number, unitHeight: number) => {
      if (!slotsGridRef.current) return null;
      const rect = slotsGridRef.current.getBoundingClientRect();
      const relY = clientY - rect.top;
      return pixelYToRackU(relY, MODAL_SLOT_HEIGHT, totalUnits, unitHeight);
    };

    const handleContainerDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const uHeight = dragInfo?.uHeight || 1;
      const startU = computeHoveredU(e.clientY, uHeight);
      if (startU !== null) {
        const valid = canPlaceDeviceAtU(activeRack, project.assets, startU, uHeight, dragInfo?.assetId, activeSide);
        setDropPreview({ startU, uHeight, valid });
      }
    };

    const handleContainerDragLeave = (e: React.DragEvent) => {
      if (slotsGridRef.current && !slotsGridRef.current.contains(e.relatedTarget as Node)) {
        setDropPreview(null);
      }
    };

    const handleContainerDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const droppedDevId = e.dataTransfer.getData('deviceId') || e.dataTransfer.getData('text/plain') || dragInfo?.assetId;
      if (droppedDevId && project.assets[droppedDevId]) {
        const uHeight = getAssetUHeight(project.assets[droppedDevId]);
        const startU = computeHoveredU(e.clientY, uHeight);
        if (startU !== null) {
          if (canPlaceDeviceAtU(activeRack, project.assets, startU, uHeight, droppedDevId, activeSide)) {
            assignToU(startU, droppedDevId, activeSide);
          } else {
            showAlert(`Khe U${startU} không đủ ${uHeight}U trống trên mặt ${activeSide === 'front' ? 'trước' : 'sau'}.`);
          }
        }
      }
      setDropPreview(null);
      setDragInfo(null);
    };

    const rackableDevices = Object.values(project.assets)
      .filter(a => !['rack', 'cloud', 'telecom_tower'].includes(a.category))
      .filter(a => {
        if (!deviceQuery.trim()) return true;
        const q = deviceQuery.toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          a.model.toLowerCase().includes(q) ||
          a.vendor.toLowerCase().includes(q) ||
          a.ipAddress.toLowerCase().includes(q)
        );
      });

    const getCategoryBadgeColor = (cat?: string) => {
      switch (cat) {
        case 'core_switch': return '#0284c7';
        case 'switch': return '#0ea5e9';
        case 'router': return '#2563eb';
        case 'firewall': return '#dc2626';
        case 'server': return '#475569';
        case 'storage': return '#0f766e';
        case 'ups': return '#e11d48';
        case 'odf': return '#06b6d4';
        default: return '#334155';
      }
    };

    const usedU = activeSide === 'rear' ? stats.rearUsedUnits : stats.frontUsedUnits;
    const freeU = activeSide === 'rear' ? stats.rearFreeUnits : stats.frontFreeUnits;
    const airflowAnalysis = analyzeRackAirflow(activeRack, project.assets, { doorType, fanCount });
    const rackableCatalogPresets = DEVICE_CATALOG.filter(
      p => p.category !== 'rack' && p.defaultUHeight >= 1
    );

    return (
      <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Mặt dựng 19 inch ${activeRack.name}`}>
        <div className={`w-full h-dvh sm:h-auto ${rackViewMode === '3d' ? 'sm:max-w-7xl' : 'sm:max-w-6xl'} sm:max-h-[94dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe transition-all`}>
          {/* Header */}
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-blue-50/50 dark:bg-slate-800/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-slate-950 text-white flex items-center justify-center shadow-xs">
                <Box className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>{activeRack.name} · Tủ Rack 19&quot;</span>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                    {totalUnits}U
                  </span>
                </h2>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                  <span>Đã dùng: <strong className="text-slate-700 dark:text-slate-200">{usedU}U</strong></span>
                  <span>· Trống: <strong className="text-emerald-600">{freeU}U</strong></span>
                  <span>· Công suất: <strong className="text-amber-600">{stats.totalPowerWatts}W ({airflowAnalysis.totalBtuPerHour} BTU/h)</strong></span>
                  <span className={stats.isOverweight ? 'text-rose-600 font-bold' : ''}>
                    · Tải trọng: <strong>{stats.totalWeightKg.toFixed(1)} / {stats.maxLoadKg} kg</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* 2D / 3D Switcher, Front/Rear switcher & Rack U-size quick adjuster */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-300/60 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setRackViewMode('2d')}
                  className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-colors flex items-center gap-1 ${
                    rackViewMode === '2d'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Mặt Dựng 2D
                </button>
                <button
                  type="button"
                  onClick={() => setRackViewMode('3d')}
                  className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-colors flex items-center gap-1 ${
                    rackViewMode === '3d'
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Wind className="w-3.5 h-3.5" />
                  Tủ Rack 3D &amp; Thông Gió
                </button>
              </div>

              <div className="flex items-center bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-300/60 dark:border-slate-700">
                <button
                  onClick={() => setActiveSide('front')}
                  className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-colors ${
                    activeSide === 'front'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Mặt Trước ({stats.frontDevicesCount})
                </button>
                <button
                  onClick={() => setActiveSide('rear')}
                  className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-colors ${
                    activeSide === 'rear'
                      ? 'bg-violet-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Mặt Sau ({stats.rearDevicesCount})
                </button>
              </div>

              <div className="flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700">
                <span className="text-[10px] text-slate-500">Cỡ tủ:</span>
                <select
                  value={STANDARD_RACK_UNITS.includes(totalUnits as any) ? String(totalUnits) : 'custom'}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v !== 'custom') {
                      onUpdateRack(activeRack.id, { totalUnits: parseInt(v, 10) });
                    }
                  }}
                  className="bg-transparent font-mono font-bold text-blue-600 dark:text-blue-400 outline-none cursor-pointer"
                >
                  {STANDARD_RACK_UNITS.map(u => (
                    <option key={u} value={u}>{u}U</option>
                  ))}
                  {!STANDARD_RACK_UNITS.includes(totalUnits as any) && (
                    <option value="custom">Tùy chỉnh ({totalUnits}U)</option>
                  )}
                </select>
                <input
                  type="number"
                  min={4}
                  max={60}
                  value={totalUnits}
                  onChange={(e) => {
                    const num = parseInt(e.target.value, 10);
                    if (!Number.isNaN(num)) {
                      onUpdateRack(activeRack.id, { totalUnits: clampRackUnits(num) });
                    }
                  }}
                  className="w-11 px-1 py-0.5 text-center font-mono border-l border-slate-200 dark:border-slate-700 bg-transparent outline-none"
                  title="Nhập số U tùy chỉnh (4 - 60U)"
                />
              </div>

              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Warnings & Alerts Strip */}
          {(stats.overflowItems.length > 0 || stats.isOverweight || rackAlert) && (
            <div className="px-5 py-2 bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-200 flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>
                {rackAlert ||
                  (stats.overflowItems.length > 0
                    ? `Cảnh báo vượt chiều cao tủ (${totalUnits}U): ${stats.overflowItems.map(i => `${i.name} @ U${i.startU} (${i.uHeight}U)`).join(', ')}`
                    : `Cảnh báo quá tải trọng tủ Rack: ${stats.totalWeightKg.toFixed(1)}kg vượt giới hạn ${stats.maxLoadKg}kg!`)}
              </span>
            </div>
          )}

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-5 flex flex-col md:flex-row gap-5">
            {/* Left Main Pane: Interactive 3D Rack Visualizer OR 2D Elevation Frame */}
            {rackViewMode === '3d' ? (
              <div className="flex-1 min-h-[480px] h-[62vh] md:h-[68vh] flex flex-col">
                <Suspense
                  fallback={
                    <div className="flex-1 flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-950/90 text-slate-300 text-xs font-medium">
                      Đang tải trình mô phỏng Tủ Rack 3D...
                    </div>
                  }
                >
                  <Rack3DVisualizer
                    rack={activeRack}
                    assets={project.assets}
                    analysis={airflowAnalysis}
                    doorType={doorType}
                    fanCount={fanCount}
                    onChangeDoorType={setDoorType}
                    onChangeFanCount={setFanCount}
                    activeSide={activeSide}
                    onChangeSide={setActiveSide}
                    selectedAssetId={selected3DAssetId}
                    onSelectAsset={setSelected3DAssetId}
                    draggedExternalAsset={dragInfo}
                    highlightedGap={highlightedGap}
                    onAssignDeviceToRackSlot={(_rackId, assetId, preferredU, side) =>
                      assignToU(preferredU, assetId, side)
                    }
                    onRemoveDeviceFromRackSlot={(_rackId, assetIdOrU, side) => {
                      if (typeof assetIdOrU === 'number') {
                        unmountSlot(assetIdOrU, side);
                      } else if (onRemoveDeviceFromRackSlot) {
                        onRemoveDeviceFromRackSlot(activeRack.id, assetIdOrU, side);
                      }
                    }}
                    onDropPresetIntoRack={onDropPresetIntoRack}
                    onNotify={showAlert}
                    isDark={resolvedDark}
                  />
                </Suspense>
              </div>
            ) : (
            <div className="flex-1 flex flex-col items-center">
              <div className="w-full max-w-lg bg-slate-950 border-4 border-slate-700 rounded-xl shadow-2xl p-3 flex flex-col">
                {/* Rack Top Frame */}
                <div className="h-7 bg-slate-900 rounded-t flex items-center justify-between px-3 text-[10px] font-mono text-slate-400 border-b border-slate-800">
                  <span className="font-semibold text-slate-300">
                    HACHIHI 19" · {activeSide === 'rear' ? 'REAR RAIL (MẶT SAU)' : 'FRONT RAIL (MẶT TRƯỚC)'}
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {usedU}/{totalUnits}U ({Math.round((usedU / Math.max(1, totalUnits)) * 100)}%)
                  </span>
                </div>

                {/* Scrollable U-Rail Viewport */}
                <div className="my-2 max-h-[540px] overflow-y-auto pr-1">
                  <div
                    ref={slotsGridRef}
                    onDragOver={handleContainerDragOver}
                    onDragLeave={handleContainerDragLeave}
                    onDrop={handleContainerDrop}
                    className={`relative w-full select-none rounded border border-slate-800 ${
                      activeSide === 'rear' ? 'bg-[#090d1f]' : 'bg-slate-950'
                    }`}
                    style={{ height: totalUnits * MODAL_SLOT_HEIGHT }}
                  >
                    {/* LAYER 1: Background Uniform 1U Rail Grid */}
                    {Array.from({ length: totalUnits }, (_, i) => {
                      const uNumber = totalUnits - i;
                      return (
                        <div
                          key={uNumber}
                          className="flex items-center border-b border-slate-800/70 box-border px-2 text-[10px]"
                          style={{ height: MODAL_SLOT_HEIGHT }}
                        >
                          <div className="w-8 font-mono font-bold text-slate-500 border-r border-slate-800/80 pr-1.5 mr-2 shrink-0 flex items-center justify-between">
                            <span>U{uNumber < 10 ? `0${uNumber}` : uNumber}</span>
                            <span className="w-1 h-1 rounded-full bg-slate-700" />
                          </div>
                          <div className="flex-1 flex items-center justify-between text-slate-600/80">
                            <span className="italic text-[10px]">
                              Khe trống U{uNumber} ({activeSide === 'front' ? 'Trước' : 'Sau'})
                            </span>
                            <span className="w-1 h-1 rounded-full bg-slate-700" />
                          </div>
                        </div>
                      );
                    })}

                    {/* LAYER 2: Multi-U Drop Preview Overlay */}
                    {dropPreview && (() => {
                      const spanRect = getSlotSpanRect(
                        dropPreview.startU,
                        dropPreview.uHeight,
                        totalUnits,
                        MODAL_SLOT_HEIGHT
                      );
                      return (
                        <div
                          className={`absolute left-10 right-1.5 pointer-events-none rounded border-2 border-dashed flex items-center justify-center font-mono font-bold text-[11px] z-20 transition-all duration-75 ${
                            dropPreview.valid
                              ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                              : 'bg-rose-500/25 border-rose-400 text-rose-200'
                          }`}
                          style={{
                            top: spanRect.top + 1,
                            height: spanRect.height - 2
                          }}
                        >
                          {dropPreview.valid
                            ? `Thả vào ${dropPreview.uHeight > 1 ? `U${dropPreview.startU}–U${dropPreview.startU + dropPreview.uHeight - 1} (${dropPreview.uHeight}U)` : `U${dropPreview.startU}`}`
                            : 'Vị trí đã bị chiếm!'}
                        </div>
                      );
                    })()}

                    {/* LAYER 3: Mounted Equipment Overlay */}
                    {occupiedEntries.map(({ startU, devId, dev, uHeight }) => {
                      if (!dev) return null;
                      const isOverflow = startU < 1 || startU + uHeight - 1 > totalUnits;
                      const clampedVisStart = Math.max(1, Math.min(totalUnits, startU));
                      const spanRect = getSlotSpanRect(clampedVisStart, uHeight, totalUnits, MODAL_SLOT_HEIGHT);
                      const accent = isOverflow ? '#ef4444' : getCategoryBadgeColor(dev.category);

                      return (
                        <div
                          key={devId}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData('deviceId', dev.id);
                            e.dataTransfer.setData('text/plain', dev.id);
                            e.dataTransfer.effectAllowed = 'move';
                            setDragInfo({ assetId: dev.id, uHeight });
                          }}
                          onDragEnd={() => {
                            setDragInfo(null);
                            setDropPreview(null);
                          }}
                          style={{
                            top: spanRect.top + 1,
                            height: spanRect.height - 2
                          }}
                          className={`absolute left-10 right-1.5 z-10 rounded shadow-md px-2 flex items-center justify-between text-xs text-white cursor-grab active:cursor-grabbing transition-colors ${
                            isOverflow
                              ? 'bg-rose-950 border-2 border-rose-500'
                              : 'bg-slate-900 border border-blue-500/80 hover:border-blue-400'
                          }`}
                          title={`${dev.name} (${uHeight}U @ U${startU}) · Kéo thả sang bất kỳ vị trí U nào`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <GripVertical className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span
                              className="w-1.5 h-4 rounded-xs shrink-0"
                              style={{ backgroundColor: accent }}
                            />
                            <span className="font-mono text-[9px] font-bold px-1 py-0.2 rounded bg-blue-600/30 text-blue-300 border border-blue-500/40 shrink-0">
                              {uHeight > 1 ? `U${startU}-${startU + uHeight - 1}` : `U${startU}`}
                            </span>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isOverflow ? 'bg-rose-500' : 'bg-emerald-400'}`} />
                            <span className="font-semibold truncate">{dev.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline truncate">
                              ({dev.model})
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 ml-1">
                            <span className="font-mono text-[10px] text-amber-400 mr-1">
                              {dev.powerWatts || 0}W
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveSlot(startU, dev.id, 'up');
                              }}
                              disabled={startU + uHeight - 1 >= totalUnits}
                              className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded disabled:opacity-20"
                              title="Di chuyển lên"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveSlot(startU, dev.id, 'down');
                              }}
                              disabled={startU <= 1}
                              className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded disabled:opacity-20"
                              title="Di chuyển xuống"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                unmountSlot(startU, activeSide);
                              }}
                              className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors ml-0.5"
                              title="Tháo thiết bị khỏi tủ"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Rack Base Power Frame */}
                <div className="h-7 bg-slate-900 rounded-b flex items-center justify-between px-3 text-[10px] font-mono text-slate-400 border-t border-slate-800">
                  <span>{stats.totalWeightKg.toFixed(1)}kg / {stats.maxLoadKg}kg MAX</span>
                  <span className="text-emerald-400 font-bold">{stats.totalPowerWatts}W LOAD</span>
                </div>
              </div>
            </div>
            )}

            {/* Right Side: Equipment Assignment & Ventilation Analysis Panel */}
            <div className="w-full md:w-96 flex flex-col space-y-3 shrink-0">
              {/* Right Panel Mode Switcher: Devices Drag/Drop vs Thermal & Airflow Diagnostics */}
              <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setRightSidebarTab('devices')}
                  className={`py-1.5 px-2 rounded-md text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    rightSidebarTab === 'devices'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  Thiết Bị ({rackableDevices.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRightSidebarTab('airflow')}
                  className={`py-1.5 px-2 rounded-md text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    rightSidebarTab === 'airflow'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Wind className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  Thông Gió ({airflowAnalysis.recommendations.length})
                </button>
              </div>

              {rightSidebarTab === 'airflow' ? (
                <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[620px]">
                  {/* Ventilation Metrics Card */}
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Flame className="w-4 h-4 text-amber-500" />
                        Đánh Giá Thông Gió &amp; Nhiệt
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          airflowAnalysis.status === 'critical'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                            : airflowAnalysis.status === 'warning'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {airflowAnalysis.status === 'critical'
                          ? 'Quá nhiệt'
                          : airflowAnalysis.status === 'warning'
                            ? 'Cảnh báo'
                            : 'Đạt chuẩn'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                        <div className="text-slate-500 text-[10px]">Tổng nhiệt tỏa</div>
                        <div className="font-mono font-bold text-amber-600 dark:text-amber-400">
                          {airflowAnalysis.totalWatts} W
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {airflowAnalysis.totalBtuPerHour} BTU/h
                        </div>
                      </div>
                      <div className="p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                        <div className="text-slate-500 text-[10px]">Lưu lượng quạt đỉnh</div>
                        <div className="font-mono font-bold text-cyan-600 dark:text-cyan-400">
                          {airflowAnalysis.effectiveCoolingCfm} / {airflowAnalysis.requiredCfm} CFM
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          Đáp ứng {airflowAnalysis.airflowCoveragePct}%
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1">
                      <span className="text-slate-500">Nhiệt độ khí xả ước tính:</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {airflowAnalysis.estimatedExhaustTempC}°C (phòng {airflowAnalysis.ambientTempC}°C)
                      </span>
                    </div>
                  </div>

                  {/* Recommendations & Interactive U-Gap Highlighting */}
                  <div className="space-y-2">
                    <div className="font-bold text-slate-900 dark:text-white text-[11px]">
                      Khuyến Nghị Kỹ Thuật ({airflowAnalysis.recommendations.length})
                    </div>
                    {airflowAnalysis.recommendations.map(rec => {
                      const hasBand = rec.targetStartU !== undefined && rec.targetEndU !== undefined;
                      const isActiveBand =
                        hasBand &&
                        highlightedGap?.startU === rec.targetStartU &&
                        highlightedGap?.endU === rec.targetEndU;
                      return (
                        <div
                          key={rec.id}
                          onMouseEnter={() => {
                            if (hasBand) {
                              setHighlightedGap({
                                startU: rec.targetStartU!,
                                endU: rec.targetEndU!
                              });
                            }
                          }}
                          onMouseLeave={() => setHighlightedGap(null)}
                          onClick={() => {
                            if (hasBand) {
                              setHighlightedGap(prev =>
                                prev?.startU === rec.targetStartU && prev?.endU === rec.targetEndU
                                  ? null
                                  : { startU: rec.targetStartU!, endU: rec.targetEndU! }
                              );
                            }
                          }}
                          className={`p-2.5 rounded-lg border space-y-1 transition-colors ${
                            hasBand ? 'cursor-pointer' : ''
                          } ${
                            isActiveBand
                              ? 'ring-2 ring-amber-400'
                              : ''
                          } ${
                            rec.severity === 'critical'
                              ? 'bg-rose-50/80 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900'
                              : rec.severity === 'warning'
                                ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
                                : 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900'
                          }`}
                        >
                          <div className="font-bold text-[11px] flex items-center gap-1.5">
                            {rec.severity === 'info' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertTriangle
                                className={`w-3.5 h-3.5 shrink-0 ${
                                  rec.severity === 'critical' ? 'text-rose-600' : 'text-amber-600'
                                }`}
                              />
                            )}
                            <span>{rec.title}</span>
                          </div>
                          <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
                            {rec.detail}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Per-device Thermal Load Table */}
                  {airflowAnalysis.devices.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="font-bold text-slate-900 dark:text-white text-[11px]">
                        Phân Bổ Nhiệt Thiết Bị ({airflowAnalysis.devices.length})
                      </div>
                      <div className="space-y-1">
                        {airflowAnalysis.devices.map(d => (
                          <button
                            key={`${d.side}_${d.assetId}`}
                            type="button"
                            onClick={() => {
                              setSelected3DAssetId(d.assetId);
                              setActiveSide(d.side);
                            }}
                            className={`w-full text-left px-2.5 py-1.5 rounded-md border flex items-center justify-between gap-2 transition-colors ${
                              selected3DAssetId === d.assetId
                                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-400'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate text-[11px]">{d.name}</div>
                              <div className="text-[10px] font-mono text-slate-500">
                                {d.side === 'rear' ? 'Sau' : 'Trước'} · U{d.startU}
                                {d.uHeight > 1 ? `–U${d.endU}` : ''} · {d.requiredCfm} CFM
                              </div>
                            </div>
                            <span
                              className={`font-mono font-bold text-[10.5px] shrink-0 ${
                                d.risk === 'hot'
                                  ? 'text-rose-600'
                                  : d.risk === 'warm'
                                    ? 'text-amber-600'
                                    : 'text-emerald-600'
                              }`}
                            >
                              {d.powerWatts}W
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
              <>
              {/* Rack Utilization Bar */}
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Mức độ chiếm dụng ({activeSide === 'front' ? 'Trước' : 'Sau'})</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">{usedU}/{totalUnits} U</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      usedU / Math.max(1, totalUnits) > 0.85 ? 'bg-amber-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.round((usedU / Math.max(1, totalUnits)) * 100))}%` }}
                  />
                </div>
                <p className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {rackViewMode === '3d'
                    ? 'Kéo thả thiết bị trực tiếp vào khe U trên tủ 3D (hỗ trợ xoay 360° mặt trước & mặt sau), hoặc kéo thả thiết bị đang gá lên/xuống.'
                    : `Kéo thả thiết bị trực tiếp vào khe U mặt ${activeSide === 'front' ? 'trước' : 'sau'}, hoặc chọn vị trí U bên dưới.`}
                </p>
              </div>

              {/* Quick Add Catalog Presets into Rack (when project has few/no devices or user wants fast add) */}
              {onDropPresetIntoRack && (
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-1.5">
                  <div className="text-[10.5px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    <span>Thêm nhanh từ thư viện (kéo vào 3D):</span>
                    <span className="text-[9.5px] text-slate-400 font-normal">Kéo hoặc bấm +</span>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {rackableCatalogPresets.slice(0, 8).map(preset => (
                      <button
                        key={preset.name}
                        type="button"
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData('presetName', preset.name);
                          e.dataTransfer.effectAllowed = 'copyMove';
                          setDragInfo({ assetId: '', uHeight: preset.defaultUHeight });
                        }}
                        onDragEnd={() => {
                          setDragInfo(null);
                          setDropPreview(null);
                        }}
                        onClick={() => {
                          const targetU = findNearestAvailableU(
                            activeRack,
                            project.assets,
                            Math.max(1, totalUnits - 4),
                            preset.defaultUHeight,
                            undefined,
                            activeSide
                          );
                          if (targetU !== null) {
                            onDropPresetIntoRack(preset.name, activeRack.id, targetU, activeSide);
                          } else {
                            showAlert(`Không còn chỗ trống ${preset.defaultUHeight}U trên mặt ${activeSide === 'rear' ? 'sau' : 'trước'}!`);
                          }
                        }}
                        className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-blue-400 text-[10px] font-medium flex items-center gap-1 cursor-grab active:cursor-grabbing"
                        title={`Kéo vào khe U trên tủ hoặc bấm để thêm ${preset.name} (${preset.defaultUHeight}U · ${preset.powerWatts}W)`}
                      >
                        <Plus className="w-2.5 h-2.5 text-blue-500" />
                        <span className="truncate max-w-[115px]">{preset.name}</span>
                        <span className="font-mono text-[9px] text-slate-400">{preset.defaultUHeight}U</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Device Filter */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={deviceQuery}
                  onChange={e => setDeviceQuery(e.target.value)}
                  placeholder="Tìm thiết bị theo tên, model, IP..."
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:border-blue-500"
                />
              </div>

              {/* List of Equipment in Project */}
              <div className="flex-1 border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-slate-50 dark:bg-slate-800/30 flex flex-col overflow-hidden">
                <div className="font-bold text-slate-900 dark:text-white mb-2 flex items-center justify-between">
                  <span>Thiết Bị Hạ Tầng ({rackableDevices.length})</span>
                  <span className="text-[10px] text-slate-400 font-normal">Mặt {activeSide === 'front' ? 'Trước' : 'Sau'}</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[400px]">
                  {rackableDevices.map(dev => {
                    const currentEntry = occupiedEntries.find(e => e.devId === dev.id);
                    const currentU = currentEntry?.startU;
                    const isInstalledOnActiveSide = currentU !== undefined;
                    const isInstalledElsewhere = dev.rackId && (dev.rackId !== activeRack.id || (dev.rackSide || 'front') !== activeSide);
                    const uHeight = getAssetUHeight(dev);

                    return (
                      <div
                        key={dev.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('deviceId', dev.id);
                          e.dataTransfer.setData('text/plain', dev.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragInfo({ assetId: dev.id, uHeight });
                        }}
                        onDragEnd={() => {
                          setDragInfo(null);
                          setDropPreview(null);
                        }}
                        className={`p-2.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing flex flex-col gap-1.5 ${
                          isInstalledOnActiveSide
                            ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 shadow-2xs'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                              <span className="truncate">{dev.name}</span>
                              <span className="text-[9px] font-mono px-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 shrink-0">
                                {uHeight}U
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {dev.vendor} · {dev.model} · {dev.powerWatts || 0}W
                              {isInstalledElsewhere && (
                                <span className="text-amber-600 dark:text-amber-400 ml-1">
                                  ({dev.rackSide === 'rear' ? 'Đang ở mặt Sau' : 'Đang ở tủ khác'})
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {isInstalledOnActiveSide ? (
                              <button
                                onClick={() => unmountSlot(currentU!, activeSide)}
                                className="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-950 dark:text-red-300 font-bold text-[10px] transition-colors"
                              >
                                Tháo ra
                              </button>
                            ) : (
                              <button
                                onClick={() => handleQuickAssign(dev.id)}
                                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] shadow-2xs transition-colors"
                              >
                                + Gá vào {activeSide === 'front' ? 'Trước' : 'Sau'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* U Slot Selector & U Height */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px]">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500">Cao:</span>
                            <select
                              value={uHeight}
                              onChange={e => onUpdateAsset(dev.id, { rackUnitHeight: parseInt(e.target.value, 10) })}
                              className="px-1 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-[10px]"
                            >
                              {[1, 2, 3, 4, 6].map(h => (
                                <option key={h} value={h}>{h}U</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-slate-500">Vị trí U:</span>
                            <select
                              value={currentU !== undefined ? String(currentU) : ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) {
                                  if (currentU !== undefined) unmountSlot(currentU, activeSide);
                                } else {
                                  assignToU(parseInt(val, 10), dev.id, activeSide);
                                }
                              }}
                              className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-blue-600 dark:text-blue-400 outline-none cursor-pointer"
                            >
                              <option value="">-- Chưa gán --</option>
                              {Array.from({ length: Math.max(1, totalUnits - uHeight + 1) }, (_, idx) => {
                                const candidateU = totalUnits - uHeight + 1 - idx;
                                const isCurrent = currentU === candidateU;
                                const isFree = canPlaceDeviceAtU(activeRack, project.assets, candidateU, uHeight, dev.id, activeSide);
                                return (
                                  <option key={candidateU} value={candidateU} disabled={!isFree && !isCurrent}>
                                    {uHeight > 1 ? `U${candidateU < 10 ? `0${candidateU}` : candidateU}–U${candidateU + uHeight - 1}` : `U${candidateU < 10 ? `0${candidateU}` : candidateU}`} {!isFree && !isCurrent ? '(Đã chiếm)' : ''}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW B: DEVICE ADVANCED PORT MATRIX & VLAN CONFIGURATION
  // (Only for Switches, Routers, Firewalls, Cameras, Servers)
  // -------------------------------------------------------------
  if (asset) {
    return (
      <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Cấu hình cổng ${asset.name}`}>
        <div className="w-full h-dvh sm:h-auto sm:max-w-4xl sm:max-h-[92dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Cấu Hình Chi Tiết & Ma Trận Cổng (Port Matrix)
                </h2>
                <div className="text-[11px] text-slate-500">
                  {asset.name} · {asset.vendor} {asset.model} · IP: {asset.ipAddress} · Asset Tag: {asset.assetTag}
                </div>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-400 uppercase">Địa chỉ MAC</div>
                <div className="font-mono font-bold mt-1">{asset.macAddress}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-400 uppercase">Công suất điện</div>
                <div className="font-mono font-bold text-amber-500 mt-1">{asset.powerWatts} Watts</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-400 uppercase">Tổng số cổng</div>
                <div className="font-mono font-bold text-blue-500 mt-1">{asset.ports.length} Interfaces</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="text-[10px] text-slate-400 uppercase">Vị trí tủ Rack</div>
                <div className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-1">
                  {asset.rackUnitStart ? `U${asset.rackUnitStart}` : 'Chưa gán'}
                </div>
              </div>
            </div>

            {/* Port Matrix Table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Danh Sách Cổng & Cấu Hình Mạng (Interface Matrix)
                </h3>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Tên Cổng</th>
                      <th className="py-2 px-3">Loại Chuẩn</th>
                      <th className="py-2 px-3">Tốc Độ</th>
                      <th className="py-2 px-3">PoE</th>
                      <th className="py-2 px-3">Trạng Thái</th>
                      <th className="py-2 px-3">VLAN Gán</th>
                      <th className="py-2 px-3">Cáp nối / Patch đích</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono text-[11px]">
                    {asset.ports.map((pt, idx) => {
                      const linkedCab = pt.connectedCableId
                        ? project.cables.find(c => c.id === pt.connectedCableId)
                        : undefined;
                      const targetAsset = pt.connectedTarget?.deviceId
                        ? project.assets[pt.connectedTarget.deviceId]
                        : undefined;
                      const patchedAsset = pt.patchedToDeviceId
                        ? project.assets[pt.patchedToDeviceId]
                        : undefined;
                      const otherAssets = Object.values(project.assets).filter(a => a.id !== asset.id);
                      return (
                      <tr key={pt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">{pt.name}</td>
                        <td className="py-2 px-3 text-slate-500">{pt.type}</td>
                        <td className="py-2 px-3 text-blue-600">{pt.speed}</td>
                        <td className="py-2 px-3">
                          {pt.poe ? <span className="text-amber-600 font-bold">PoE+ (30W)</span> : <span className="text-slate-400">-</span>}
                        </td>
                        <td className="py-2 px-3">
                          <button
                            onClick={() => {
                              const updatedPorts = [...asset.ports];
                              updatedPorts[idx] = {
                                ...pt,
                                status: pt.status === 'up' ? 'down' : 'up'
                              };
                              onUpdateAsset(asset.id, { ports: updatedPorts });
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pt.status === 'up' 
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' 
                                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                            }`}
                          >
                            {pt.status.toUpperCase()}
                          </button>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={pt.vlan || asset.vlan}
                            onChange={(e) => {
                              const updatedPorts = [...asset.ports];
                              updatedPorts[idx] = { ...pt, vlan: e.target.value };
                              onUpdateAsset(asset.id, { ports: updatedPorts });
                            }}
                            className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] w-20"
                          />
                        </td>
                        <td className="py-2 px-3 font-sans">
                          <div className="space-y-1">
                            {linkedCab && (
                              <div className="text-[10.5px] font-mono text-blue-600 dark:text-blue-400 truncate max-w-[180px]">
                                {linkedCab.cableCode}{targetAsset ? ` → ${targetAsset.name}` : ''}
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <select
                                aria-label={`Patch đích cho cổng ${pt.name}`}
                                value={pt.patchedToDeviceId || ''}
                                onChange={(e) => {
                                  const nextDevId = e.target.value || undefined;
                                  const updatedPorts = [...asset.ports];
                                  updatedPorts[idx] = {
                                    ...pt,
                                    patchedToDeviceId: nextDevId,
                                    patchedToPortId: nextDevId ? pt.patchedToPortId || 'P01' : undefined
                                  };
                                  onUpdateAsset(asset.id, { ports: updatedPorts });
                                }}
                                className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-[10.5px] max-w-[125px]"
                              >
                                <option value="">-- Patch đích --</option>
                                {otherAssets.map(o => (
                                  <option key={o.id} value={o.id}>{o.name}</option>
                                ))}
                              </select>
                              {pt.patchedToDeviceId && (
                                <input
                                  type="text"
                                  aria-label={`Cổng patch đích của ${pt.name}`}
                                  value={pt.patchedToPortId || ''}
                                  placeholder={patchedAsset?.ports[0]?.name || 'P01'}
                                  onChange={(e) => {
                                    const updatedPorts = [...asset.ports];
                                    updatedPorts[idx] = { ...pt, patchedToPortId: e.target.value };
                                    onUpdateAsset(asset.id, { ports: updatedPorts });
                                  }}
                                  className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[10.5px] w-14"
                                />
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
