import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, SlidersHorizontal, X, Zap } from 'lucide-react';
import {
  CableEdge,
  CableTray,
  DeviceAsset,
  DiagramNode,
  Floor,
  ProjectState,
  RackSide,
  Room,
  SelectionState,
  ServerRack
} from '../../types/infrastructure';
import type { CADDocument } from '../../cad/core/CADTypes';
import { SnapToGridAlignMode } from '../../utils/snapGuides';
import { AuditIssue } from '../../utils/engineeringValidator';
import { AutoAssignIpResult } from '../../utils/ipAutoAssign';
import { computeProjectPoeSummary } from '../../utils/poeCalculator';
import { LayoutTier, UIDensity } from '../../hooks/useWorkspaceLayout';
import { loadPanelCollapsed, savePanelCollapsed } from '../../utils/panelCollapseStorage';
import { MultiNodeInspector } from './MultiNodeInspector';
import { FloorInspector, LegendNodeInspector, RoomInspector } from './LegendRoomInspector';
import { ProjectSettingsInspector } from './ProjectSettingsInspector';
import { CableMaterialSummaryPanel } from './CableMaterialSummaryPanel';
import { PowerEnergyTabPanel } from './PowerEnergyTabPanel';

const RackInspector = lazy(() =>
  import('./RackInspector').then(m => ({ default: m.RackInspector }))
);
const DeviceNodeInspector = lazy(() =>
  import('./DeviceNodeInspector').then(m => ({ default: m.DeviceNodeInspector }))
);
const CableInspector = lazy(() =>
  import('./CableInspector').then(m => ({ default: m.CableInspector }))
);
const CableTrayInspector = lazy(() =>
  import('./CableTrayInspector').then(m => ({ default: m.CableTrayInspector }))
);

interface PropertiesPanelProps {
  project: ProjectState;
  selection: SelectionState;
  auditIssues?: AuditIssue[];
  is3DView?: boolean;
  isReadOnlyMode?: boolean;
  onUpdateAsset: (assetId: string, partial: Partial<DeviceAsset>) => void;
  onUpdateNode: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onRotateNodes?: (nodeIds: string[], rotationDeg: number) => void;
  onMirrorNodes?: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  onUpdateWifiCoverage?: (nodeId: string, partial: { radiusMeters?: number; angleDeg?: number }) => void;
  onUpdateCameraFov?: (nodeId: string, partial: { fovAngle?: number; irDistanceMeters?: number }) => void;
  onSetNodeIconOrLogo?: (nodeId: string, payload: { customIcon?: string; customImageUrl?: string }) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onUpdateCable: (cableId: string, partial: Partial<CableEdge>) => void;
  onSetCableColor?: (cableId: string, color: string) => void;
  onSetCablesColorByType?: (cableType: CableEdge['cableType'], color: string) => void;
  onReconnectCableEndpoint?: (cableId: string, endpoint: 'source' | 'target', newNodeId: string) => void;
  onSelectCable?: (cableId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  onUpdateRoom: (roomId: string, partial: Partial<Room>) => void;
  onUpdateTray?: (trayId: string, partial: Partial<CableTray>) => void;
  onUpdateRack: (rackId: string, partial: Partial<ServerRack>) => void;
  onAssignDeviceToRackSlot?: (rackId: string, assetId: string, preferredU: number, side?: RackSide) => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onUpdateFloor: (floorId: string, partial: Partial<Floor>) => void;
  onUpdateSettings: (partial: Partial<ProjectState['settings']>) => void;
  onAutoAssignIps?: (options?: { preserveExistingValid?: boolean }) => AutoAssignIpResult;
  onUpdateProjectMeta?: (meta: Partial<Pick<ProjectState, 'name' | 'author' | 'version'>>) => void;
  onDuplicateProject?: () => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  onGroupNodes?: (nodeIds: string[]) => void;
  onUngroupNodes?: (nodeIds: string[]) => void;
  onAlignNodes?: (nodeIds: string[], alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistributeNodes?: (nodeIds: string[], axis: 'horizontal' | 'vertical') => void;
  onAutoAlignSnapToGrid?: (nodeIds: string[], mode: SnapToGridAlignMode, options?: { evenSpacing?: boolean }) => void;
  onDeleteCable: (cableId: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onDeleteTray?: (trayId: string) => void;
  onDeleteRack: (rackId: string) => void;
  onOpenDeepInspect: (id: string, rackView?: '2d' | '3d') => void;
  onCloneFloor: (floorId: string, newLevel: number, newName: string) => void;
  onResizeLegendToFit?: (nodeId: string) => void;
  onAutoRouteCable?: (cableId: string) => void;
  onAutoRouteAllCables?: () => void;
  hasCopiedStyle?: boolean;
  onCopyNodeStyle?: (nodeId: string) => void;
  onPasteNodeStyle?: (nodeIds: string[]) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onClosePanel?: () => void;
  requestedTab?: { tab: 'inspector' | 'power'; nonce: number };
  layoutTier?: LayoutTier;
  density?: UIDensity;
  highContrast?: boolean;
  reducedMotion?: boolean;
  onToggleDensity?: () => void;
  onToggleHighContrast?: () => void;
  onToggleReducedMotion?: () => void;
  onOpenBomModal?: () => void;
  onOpenBomSubnetsTab?: () => void;
  onAutoLayerDevices?: () => void;
  experienceMode?: 'basic' | 'advanced';
  cadDocument?: CADDocument | null;
  onSyncScaleFromCad?: () => void;
  onLockAllCadLayers?: (lock?: boolean) => void;
}

const POWER_RELEVANT_CATEGORIES = new Set([
  'core_switch',
  'switch',
  'router',
  'firewall',
  'server',
  'storage',
  'ups',
  'pdu',
  'electrical_panel',
  'ap',
  'camera',
  'nvr'
]);

export const PropertiesPanel: React.FC<PropertiesPanelProps> = React.memo(({
  project,
  selection,
  auditIssues = [],
  is3DView = false,
  isReadOnlyMode = false,
  onUpdateAsset,
  onUpdateNode,
  onRotateNodes,
  onUpdateWifiCoverage,
  onUpdateCameraFov,
  onSetNodeIconOrLogo,
  onToggleNodeLock,
  onToggleNodeVisibility,
  onUpdateCable,
  onSetCableColor,
  onSetCablesColorByType,
  onReconnectCableEndpoint,
  onSelectCable,
  onSelectNode,
  onUpdateRoom,
  onUpdateTray,
  onUpdateRack,
  onAssignDeviceToRackSlot,
  onRemoveDeviceFromRackSlot,
  onUpdateFloor,
  onUpdateSettings,
  onAutoAssignIps,
  onUpdateProjectMeta,
  onDuplicateProject,
  onDeleteNode,
  onDeleteNodes,
  onDuplicateNodes,
  onGroupNodes,
  onUngroupNodes,
  onAlignNodes,
  onDistributeNodes,
  onAutoAlignSnapToGrid,
  onDeleteCable,
  onDeleteRoom,
  onDeleteTray,
  onDeleteRack,
  onOpenDeepInspect,
  onCloneFloor,
  onResizeLegendToFit,
  onAutoRouteCable,
  onAutoRouteAllCables,
  hasCopiedStyle,
  onCopyNodeStyle,
  onPasteNodeStyle,
  isCollapsed,
  onToggleCollapse,
  onClosePanel,
  requestedTab,
  layoutTier = 'wide',
  density = 'compact',
  highContrast = false,
  reducedMotion = false,
  onToggleDensity,
  onToggleHighContrast,
  onToggleReducedMotion,
  onOpenBomModal,
  onOpenBomSubnetsTab,
  onAutoLayerDevices,
  experienceMode,
  cadDocument,
  onSyncScaleFromCad,
  onLockAllCadLayers
}) => {
  const resolvedExperienceMode = experienceMode ?? project.settings?.experienceMode ?? 'advanced';
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [activePanelTab, setActivePanelTab] = useState<'inspector' | 'power'>('inspector');
  const [isCableSummaryExpanded, setIsCableSummaryExpanded] = useState(false);
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(() =>
    loadPanelCollapsed('properties', false)
  );

  const effectiveCollapsed = isCollapsed ?? internalCollapsed;
  const handleToggleCollapse =
    onToggleCollapse ??
    (() => {
      setInternalCollapsed(prev => {
        const next = !prev;
        savePanelCollapsed('properties', next);
        return next;
      });
    });

  const poeSummary = useMemo(() => computeProjectPoeSummary(project), [project]);

  useEffect(() => {
    setConfirmDeleteKey(null);
  }, [selection.type, selection.id]);

  let selectedRack =
    selection.type === 'rack'
      ? project.racks.find(r => r.id === selection.id)
      : undefined;

  const selectedNode =
    selection.type === 'node'
      ? project.nodes.find(n => n.id === selection.id)
      : undefined;

  const selectedAsset = selectedNode?.assetId
    ? project.assets[selectedNode.assetId]
    : undefined;

  if (
    !selectedRack &&
    (selectedNode?.type === 'rack' ||
      selectedAsset?.category === 'rack' ||
      selectedNode?.label?.toLowerCase().includes('rack') ||
      selectedAsset?.model?.includes('42U'))
  ) {
    const rackId = selectedNode?.customData?.rackId || selectedNode?.id || selectedAsset?.id;
    selectedRack = project.racks.find(
      r => r.id === rackId || r.name === selectedNode?.label || r.id === selectedAsset?.id
    );
  }

  const selectedCable =
    selection.type === 'edge'
      ? project.cables.find(c => c.id === selection.id)
      : undefined;

  const selectedRoom =
    selection.type === 'room'
      ? project.rooms.find(r => r.id === selection.id)
      : undefined;

  const selectedTray =
    selection.type === 'tray'
      ? (project.cableTrays || []).find(t => t.id === selection.id)
      : undefined;

  const selectedFloor =
    selection.type === 'floor'
      ? project.floors.find(f => f.id === selection.id)
      : undefined;

  const selectedNodeIds =
    selection.type === 'node' && selection.id
      ? [selection.id, ...(selection.additionalIds || [])]
      : [];

  const showPowerTab = useMemo(() => {
    if (resolvedExperienceMode === 'basic') return false;
    if (project.activeMode === 'electrical') return true;
    if (selectedNodeIds.length > 1) return false;
    if (selection.type === 'none' || selection.type === 'canvas') return true;
    if (selectedRack) return true;
    if (selectedNode && selectedNode.type === 'device' && selectedAsset) {
      return POWER_RELEVANT_CATEGORIES.has(selectedAsset.category);
    }
    return false;
  }, [resolvedExperienceMode, project.activeMode, selectedNodeIds.length, selection.type, selectedRack, selectedNode, selectedAsset]);

  useEffect(() => {
    if (!showPowerTab && activePanelTab === 'power') {
      setActivePanelTab('inspector');
    }
  }, [showPowerTab, activePanelTab]);

  useEffect(() => {
    if (requestedTab) {
      setActivePanelTab(requestedTab.tab);
    }
  }, [requestedTab]);

  if (effectiveCollapsed) {
    return (
      <div className="w-12 h-full flex flex-col items-center py-3 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-slate-500 shrink-0 select-none">
        <button
          type="button"
          onClick={handleToggleCollapse}
          aria-label="Mở rộng bảng thuộc tính"
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-[#155EEF] transition-colors"
          title="Mở rộng bảng thuộc tính"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleToggleCollapse}
          className="mt-4 text-xs font-semibold text-slate-500 hover:text-[#155EEF] rotate-180 cursor-pointer"
          style={{ writingMode: 'vertical-rl' }}
        >
          Thuộc tính
        </button>
      </div>
    );
  }

  let inspectorContent: React.ReactNode;

  if (selectedNodeIds.length > 1) {
    const selectedNodes = project.nodes.filter(n => selectedNodeIds.includes(n.id));
    inspectorContent = (
      <MultiNodeInspector
        project={project}
        selectedNodeIds={selectedNodeIds}
        selectedNodes={selectedNodes}
        isReadOnlyMode={isReadOnlyMode}
        layoutTier={layoutTier}
        confirmDeleteKey={confirmDeleteKey}
        setConfirmDeleteKey={setConfirmDeleteKey}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
        onDeleteNodes={onDeleteNodes}
        onDuplicateNodes={onDuplicateNodes}
        onToggleNodeLock={onToggleNodeLock}
        onToggleNodeVisibility={onToggleNodeVisibility}
        onGroupNodes={onGroupNodes}
        onUngroupNodes={onUngroupNodes}
        onAlignNodes={onAlignNodes}
        onDistributeNodes={onDistributeNodes}
        onAutoAlignSnapToGrid={onAutoAlignSnapToGrid}
        onRotateNodes={onRotateNodes}
        onMirrorNodes={onMirrorNodes}
        hasCopiedStyle={hasCopiedStyle}
        onPasteNodeStyle={onPasteNodeStyle}
      />
    );
  } else if (selectedRack) {
    const rackNode =
      selectedNode && selectedNode.type === 'rack'
        ? selectedNode
        : project.nodes.find(
            n =>
              n.type === 'rack' &&
              (n.customData?.rackId === selectedRack.id || n.id === selectedRack.id || n.label === selectedRack.name)
          );
    inspectorContent = (
      <RackInspector
        project={project}
        selectedRack={selectedRack}
        selectedNode={rackNode}
        auditIssues={auditIssues}
        isReadOnlyMode={isReadOnlyMode}
        layoutTier={layoutTier}
        confirmDeleteKey={confirmDeleteKey}
        setConfirmDeleteKey={setConfirmDeleteKey}
        onUpdateRack={onUpdateRack}
        onUpdateNode={onUpdateNode}
        onDeleteRack={onDeleteRack}
        onOpenDeepInspect={onOpenDeepInspect}
        onRemoveDeviceFromRackSlot={onRemoveDeviceFromRackSlot}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
      />
    );
  } else if (selectedNode && selectedNode.type === 'legend') {
    inspectorContent = (
      <LegendNodeInspector
        project={project}
        selectedNode={selectedNode}
        isReadOnlyMode={isReadOnlyMode}
        layoutTier={layoutTier}
        confirmDeleteKey={confirmDeleteKey}
        setConfirmDeleteKey={setConfirmDeleteKey}
        onUpdateNode={onUpdateNode}
        onDeleteNode={onDeleteNode}
        onToggleNodeLock={onToggleNodeLock}
        onToggleNodeVisibility={onToggleNodeVisibility}
        onResizeLegendToFit={onResizeLegendToFit}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
      />
    );
  } else if (selectedNode) {
    inspectorContent = (
      <DeviceNodeInspector
        project={project}
        selectedNode={selectedNode}
        selectedAsset={selectedAsset}
        auditIssues={auditIssues}
        isReadOnlyMode={isReadOnlyMode}
        layoutTier={layoutTier}
        confirmDeleteKey={confirmDeleteKey}
        setConfirmDeleteKey={setConfirmDeleteKey}
        onUpdateAsset={onUpdateAsset}
        onUpdateNode={onUpdateNode}
        onMirrorNodes={onMirrorNodes}
        onUpdateWifiCoverage={onUpdateWifiCoverage}
        onUpdateCameraFov={onUpdateCameraFov}
        onUpdateSettings={onUpdateSettings}
        onSetNodeIconOrLogo={onSetNodeIconOrLogo}
        onToggleNodeLock={onToggleNodeLock}
        onToggleNodeVisibility={onToggleNodeVisibility}
        onDuplicateNodes={onDuplicateNodes}
        onDeleteNode={onDeleteNode}
        onDeleteCable={onDeleteCable}
        onSelectCable={onSelectCable}
        onAssignDeviceToRackSlot={onAssignDeviceToRackSlot}
        onRemoveDeviceFromRackSlot={onRemoveDeviceFromRackSlot}
        onOpenDeepInspect={onOpenDeepInspect}
        hasCopiedStyle={hasCopiedStyle}
        onCopyNodeStyle={onCopyNodeStyle}
        onPasteNodeStyle={onPasteNodeStyle}
        onAutoLayerDevices={onAutoLayerDevices}
        experienceMode={resolvedExperienceMode}
        onSwitchToAdvanced={() => onUpdateSettings({ experienceMode: 'advanced' })}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
      />
    );
  } else if (selectedCable) {
    inspectorContent = (
      <CableInspector
        project={project}
        selectedCable={selectedCable}
        auditIssues={auditIssues}
        isReadOnlyMode={isReadOnlyMode}
        layoutTier={layoutTier}
        confirmDeleteKey={confirmDeleteKey}
        setConfirmDeleteKey={setConfirmDeleteKey}
        onUpdateCable={onUpdateCable}
        onSetCableColor={onSetCableColor}
        onSetCablesColorByType={onSetCablesColorByType}
        onReconnectCableEndpoint={onReconnectCableEndpoint}
        onUpdateSettings={onUpdateSettings}
        onDeleteCable={onDeleteCable}
        onAutoRouteCable={onAutoRouteCable}
        onAutoRouteAllCables={onAutoRouteAllCables}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
      />
    );
  } else if (selectedTray && onUpdateTray && onDeleteTray) {
    inspectorContent = (
      <CableTrayInspector
        project={project}
        selectedTray={selectedTray}
        isReadOnlyMode={isReadOnlyMode}
        confirmDeleteKey={confirmDeleteKey}
        setConfirmDeleteKey={setConfirmDeleteKey}
        onUpdateTray={onUpdateTray}
        onDeleteTray={onDeleteTray}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
      />
    );
  } else if (selectedRoom) {
    inspectorContent = (
      <RoomInspector
        project={project}
        selectedRoom={selectedRoom}
        isReadOnlyMode={isReadOnlyMode}
        confirmDeleteKey={confirmDeleteKey}
        setConfirmDeleteKey={setConfirmDeleteKey}
        onUpdateRoom={onUpdateRoom}
        onDeleteRoom={onDeleteRoom}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
      />
    );
  } else if (selectedFloor) {
    inspectorContent = (
      <FloorInspector
        project={project}
        selectedFloor={selectedFloor}
        isReadOnlyMode={isReadOnlyMode}
        onUpdateFloor={onUpdateFloor}
        onCloneFloor={onCloneFloor}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
      />
    );
  } else {
    inspectorContent = (
      <ProjectSettingsInspector
        project={project}
        is3DView={is3DView}
        isReadOnlyMode={isReadOnlyMode}
        layoutTier={layoutTier}
        density={density}
        highContrast={highContrast}
        reducedMotion={reducedMotion}
        onUpdateSettings={onUpdateSettings}
        onAutoAssignIps={onAutoAssignIps}
        onUpdateProjectMeta={onUpdateProjectMeta}
        onDuplicateProject={onDuplicateProject}
        onToggleNodeVisibility={onToggleNodeVisibility}
        onAutoRouteAllCables={onAutoRouteAllCables}
        onSelectNode={onSelectNode}
        onToggleDensity={onToggleDensity}
        onToggleHighContrast={onToggleHighContrast}
        onToggleReducedMotion={onToggleReducedMotion}
        onToggleCollapse={handleToggleCollapse}
        onClosePanel={onClosePanel}
        onOpenBomModal={onOpenBomModal}
        onOpenBomSubnetsTab={onOpenBomSubnetsTab}
        cadDocument={cadDocument}
        onSyncScaleFromCad={onSyncScaleFromCad}
        onLockAllCadLayers={onLockAllCadLayers}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
      {/* Contextual Top-level Panel Tabs: Thuộc tính | Điện/Năng lượng */}
      {showPowerTab && (
        <div className="px-2.5 py-2 border-l border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex items-center justify-between gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Phân khu bảng thuộc tính"
            className="flex-1 grid grid-cols-2 gap-1 bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded-lg min-w-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activePanelTab === 'inspector'}
              onClick={() => setActivePanelTab('inspector')}
              className={`py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap truncate transition-colors ${
                activePanelTab === 'inspector'
                  ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Thuộc tính</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePanelTab === 'power'}
              onClick={() => setActivePanelTab('power')}
              className={`py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap truncate transition-colors ${
                activePanelTab === 'power'
                  ? 'bg-white dark:bg-slate-900 text-[#155EEF] dark:text-blue-400 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Zap
                className={`w-3.5 h-3.5 shrink-0 ${
                  poeSummary.status === 'overload'
                    ? 'text-rose-500'
                    : poeSummary.status === 'warning'
                    ? 'text-amber-500'
                    : ''
                }`}
              />
              <span className="truncate">Điện/Năng lượng</span>
            </button>
          </div>

          {activePanelTab === 'power' && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={handleToggleCollapse}
                aria-label="Thu gọn bảng thuộc tính"
                className="p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                title="Thu gọn"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              {onClosePanel && (
                <button
                  type="button"
                  onClick={onClosePanel}
                  aria-label="Đóng bảng thuộc tính"
                  className="p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  title="Đóng"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showPowerTab && activePanelTab === 'power' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <PowerEnergyTabPanel
            project={project}
            selection={selection}
            onSelectNode={onSelectNode}
          />
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-hidden">
            <Suspense
              fallback={
                <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                  Đang tải bảng thuộc tính...
                </div>
              }
            >
              {inspectorContent}
            </Suspense>
          </div>
          <CableMaterialSummaryPanel
            project={project}
            isExpanded={isCableSummaryExpanded}
            onToggleExpand={() => setIsCableSummaryExpanded(prev => !prev)}
            onOpenBomModal={onOpenBomModal}
          />
        </>
      )}
    </div>
  );
});
