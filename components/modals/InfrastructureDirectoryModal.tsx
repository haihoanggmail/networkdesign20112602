import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  GitCompare,
  History,
  Network,
  Plus,
  RotateCcw,
  Save,
  Search,
  Table2,
  Trash2,
  X
} from 'lucide-react';
import {
  PatchLink,
  ProjectRevision,
  ProjectState,
  SubnetSpec,
  VlanSpec
} from '../../types/infrastructure';
import {
  buildPatchAndCableSchedule,
  doCidrsOverlap,
  formatScheduleCsv,
  isIpInCidr,
  parseAndApplyBulkStaticIpsCsv,
  parseCidrRange
} from '../../utils/engineeringValidator';
import { computeDetailedRevisionDiff, computeRevisionDiff } from '../../utils/projectStorage';
import { useFocusTrap } from '../../hooks/useFocusTrap';

type DirectoryTab = 'ipam' | 'schedule' | 'revisions';

interface InfrastructureDirectoryModalProps {
  isOpen: boolean;
  project: ProjectState;
  revisions: ProjectRevision[];
  isReadOnlyMode?: boolean;
  initialTab?: DirectoryTab;
  onClose: () => void;
  onUpsertVlan: (spec: Omit<VlanSpec, 'id'> & { id?: string }) => void;
  onDeleteVlan: (id: string) => void;
  onUpsertSubnet: (spec: Omit<SubnetSpec, 'id'> & { id?: string }) => void;
  onDeleteSubnet: (id: string) => void;
  onUpsertPatchLink: (link: Omit<PatchLink, 'id'> & { id?: string }) => void;
  onDeletePatchLink: (id: string) => void;
  onCreateRevision: (label: string, note?: string) => Promise<ProjectRevision | null>;
  onRestoreRevision: (revisionId: string) => Promise<boolean>;
  onDeleteRevision: (revisionId: string) => Promise<boolean>;
  onApplyBulkStaticIps?: (updatedAssets: ProjectState['assets']) => void;
  onSelectTarget?: (targetType: 'node' | 'edge', targetId: string) => void;
}

export const InfrastructureDirectoryModal: React.FC<InfrastructureDirectoryModalProps> = ({
  isOpen,
  project,
  revisions,
  isReadOnlyMode = false,
  initialTab = 'ipam',
  onClose,
  onUpsertVlan,
  onDeleteVlan,
  onUpsertSubnet,
  onDeleteSubnet,
  onUpsertPatchLink,
  onDeletePatchLink,
  onCreateRevision,
  onRestoreRevision,
  onDeleteRevision,
  onApplyBulkStaticIps,
  onSelectTarget
}) => {
  const [activeTab, setActiveTab] = useState<DirectoryTab>(initialTab);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  // VLAN form state
  const [vlanNum, setVlanNum] = useState('10');
  const [vlanName, setVlanName] = useState('');
  const [vlanPurpose, setVlanPurpose] = useState('');

  // Subnet form state
  const [subnetName, setSubnetName] = useState('');
  const [subnetCidr, setSubnetCidr] = useState('');
  const [subnetVlanId, setSubnetVlanId] = useState('');
  const [subnetGateway, setSubnetGateway] = useState('');
  const [subnetDhcp, setSubnetDhcp] = useState('');
  const [subnetError, setSubnetError] = useState<string | null>(null);

  // Patch Panel Schedule state
  const [scheduleQuery, setScheduleQuery] = useState('');
  const [patchPanelId, setPatchPanelId] = useState('');
  const [patchPort, setPatchPort] = useState('');
  const [patchTargetName, setPatchTargetName] = useState('');
  const [patchTargetPort, setPatchTargetPort] = useState('');
  const [patchCableCode, setPatchCableCode] = useState('');
  const [patchVlan, setPatchVlan] = useState('');
  const [patchRoom, setPatchRoom] = useState('');

  // Named Revisions state
  const [revLabel, setRevLabel] = useState('');
  const [revNote, setRevNote] = useState('');
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [revBanner, setRevBanner] = useState<string | null>(null);
  const [expandedRevId, setExpandedRevId] = useState<string | null>(null);

  // Bulk static IP CSV state
  const [bulkIpCsv, setBulkIpCsv] = useState('');
  const [bulkIpFeedback, setBulkIpFeedback] = useState<{ text: string; errors: string[] } | null>(null);

  const vlans = project.vlans || [];
  const subnets = project.subnets || [];
  const assets = Object.values(project.assets);

  const patchPanelAssets = useMemo(
    () => assets.filter(a => a.category === 'patch_panel' || a.category === 'odf' || a.category === 'switch'),
    [assets]
  );

  const scheduleRows = useMemo(() => buildPatchAndCableSchedule(project), [project]);
  const filteredSchedule = useMemo(() => {
    const q = scheduleQuery.trim().toLowerCase();
    if (!q) return scheduleRows;
    return scheduleRows.filter(r =>
      `${r.cableCode} ${r.patchPanelOrSource} ${r.sourcePort} ${r.targetDevice} ${r.targetPort} ${r.vlan} ${r.roomName}`
        .toLowerCase()
        .includes(q)
    );
  }, [scheduleRows, scheduleQuery]);

  if (!isOpen) return null;

  const handleAddVlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnlyMode) return;
    const num = Math.max(1, Math.min(4094, Math.round(Number(vlanNum) || 10)));
    onUpsertVlan({
      vlanId: num,
      name: vlanName.trim() || `VLAN ${num}`,
      purpose: vlanPurpose.trim() || undefined
    });
    setVlanName('');
    setVlanPurpose('');
  };

  const handleAddSubnet = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnlyMode) return;
    setSubnetError(null);
    const parsed = parseCidrRange(subnetCidr);
    if (!parsed) {
      setSubnetError('Định dạng CIDR không hợp lệ (ví dụ: 10.10.20.0/24).');
      return;
    }
    onUpsertSubnet({
      name: subnetName.trim() || `Subnet ${parsed.cidr}`,
      cidr: parsed.cidr,
      vlanId: subnetVlanId ? Number(subnetVlanId) : undefined,
      gateway: subnetGateway.trim() || undefined,
      dhcpRange: subnetDhcp.trim() || undefined
    });
    setSubnetName('');
    setSubnetCidr('');
    setSubnetGateway('');
    setSubnetDhcp('');
  };

  const handleAddPatchLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnlyMode) return;
    const panelId = patchPanelId || patchPanelAssets[0]?.id || 'PATCH-PANEL-01';
    if (!patchPort.trim() || !patchTargetName.trim()) return;
    onUpsertPatchLink({
      patchPanelAssetId: panelId,
      patchPort: patchPort.trim(),
      targetDeviceName: patchTargetName.trim(),
      targetPort: patchTargetPort.trim() || 'Wall-Jack',
      cableCode: patchCableCode.trim() || undefined,
      vlan: patchVlan.trim() || undefined,
      roomName: patchRoom.trim() || undefined
    });
    setPatchPort('');
    setPatchTargetName('');
    setPatchTargetPort('');
    setPatchCableCode('');
  };

  const handleDownloadCsv = () => {
    const csv = formatScheduleCsv(filteredSchedule);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_Patch_Cable_Schedule.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSaveRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnlyMode) return;
    const rev = await onCreateRevision(revLabel, revNote);
    if (rev) {
      setRevLabel('');
      setRevNote('');
      setRevBanner(`Đã lưu mốc "${rev.label}".`);
    }
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Danh bạ Hạ tầng: Subnet, Patch Panel & Phiên bản"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print"
    >
      <div className="w-full h-dvh sm:h-auto sm:max-w-5xl sm:max-h-[92dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Network className="w-5 h-5 text-blue-600 shrink-0" />
              <span className="truncate">Danh bạ Subnet/VLAN · Bảng Cáp · Lịch sử Phiên bản</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Quản trị IPAM chuẩn hóa, sơ đồ đấu nối Patch Panel &amp; điểm khôi phục phiên bản theo tên
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng danh bạ hạ tầng"
            className="touch-target p-1.5 rounded-md text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-only notice */}
        {isReadOnlyMode && (
          <div className="px-4 sm:px-6 py-2 bg-sky-50 dark:bg-sky-950/40 border-b border-sky-200 dark:border-sky-900 text-sky-800 dark:text-sky-200 flex items-center gap-2 text-[11px] font-medium shrink-0">
            <Eye className="w-3.5 h-3.5 shrink-0" />
            <span>Chế độ Chỉ xem: Có thể tra cứu và xuất CSV, các thao tác thêm/xóa/khôi phục đang bị khóa.</span>
          </div>
        )}

        {/* Segmented Tabs */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-1.5 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('ipam')}
            className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'ipam'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Subnet &amp; VLAN ({subnets.length} / {vlans.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'schedule'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            <span>Patch Panel &amp; Bảng Cáp ({scheduleRows.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('revisions')}
            className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'revisions'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Phiên bản đã lưu ({revisions.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* TAB 1: SUBNET & VLAN IPAM */}
          {activeTab === 'ipam' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: VLAN Directory */}
              <div className="lg:col-span-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Danh bạ VLAN</h3>
                  <span className="text-[11px] font-mono text-slate-500">{vlans.length} VLAN</span>
                </div>

                {!isReadOnlyMode && (
                  <form
                    onSubmit={handleAddVlan}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2"
                  >
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10.5px] text-slate-500 block mb-0.5">VLAN ID</label>
                        <input
                          type="number"
                          min={1}
                          max={4094}
                          value={vlanNum}
                          onChange={e => setVlanNum(e.target.value)}
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                          required
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10.5px] text-slate-500 block mb-0.5">Tên VLAN</label>
                        <input
                          type="text"
                          value={vlanName}
                          onChange={e => setVlanName(e.target.value)}
                          placeholder="VD: MGMT_CORE, CCTV"
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                          required
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={vlanPurpose}
                        onChange={e => setVlanPurpose(e.target.value)}
                        placeholder="Mục đích / Ghi chú (tuỳ chọn)"
                        className="flex-1 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" /> Thêm VLAN
                      </button>
                    </div>
                  </form>
                )}

                <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                  {vlans.length === 0 ? (
                    <div className="p-6 text-center text-slate-400">Chưa khai báo VLAN nào.</div>
                  ) : (
                    vlans.map(v => {
                      const assetHits = assets.filter(a =>
                        (a.vlan || '')
                          .split(',')
                          .map(s => s.trim())
                          .includes(String(v.vlanId))
                      ).length;
                      return (
                        <div
                          key={v.id}
                          className="px-3 py-2 bg-white dark:bg-slate-900 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 font-mono font-bold text-blue-700 dark:text-blue-300 text-[10.5px]">
                                VLAN {v.vlanId}
                              </span>
                              <span className="font-semibold truncate">{v.name}</span>
                            </div>
                            <div className="text-[10.5px] text-slate-500 mt-0.5 truncate">
                              {v.purpose || 'Không có mô tả'} ·{' '}
                              <span className="font-mono">{assetHits} thiết bị</span>
                            </div>
                          </div>
                          {!isReadOnlyMode && (
                            <button
                              type="button"
                              onClick={() => onDeleteVlan(v.id)}
                              aria-label={`Xóa VLAN ${v.vlanId}`}
                              className="p-1.5 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right: Subnet Directory */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">Danh bạ Subnet (IPAM)</h3>
                  <span className="text-[11px] font-mono text-slate-500">{subnets.length} Subnet</span>
                </div>

                {!isReadOnlyMode && (
                  <form
                    onSubmit={handleAddSubnet}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10.5px] text-slate-500 block mb-0.5">Tên Subnet</label>
                        <input
                          type="text"
                          value={subnetName}
                          onChange={e => setSubnetName(e.target.value)}
                          placeholder="VD: Văn phòng Tầng 2"
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 block mb-0.5">Dải mạng (CIDR)</label>
                        <input
                          type="text"
                          value={subnetCidr}
                          onChange={e => setSubnetCidr(e.target.value)}
                          placeholder="10.10.20.0/24"
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                          required
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 block mb-0.5">Liên kết VLAN</label>
                        <input
                          type="number"
                          min={1}
                          max={4094}
                          value={subnetVlanId}
                          onChange={e => setSubnetVlanId(e.target.value)}
                          placeholder="VD: 20"
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                      <div>
                        <label className="text-[10.5px] text-slate-500 block mb-0.5">Gateway</label>
                        <input
                          type="text"
                          value={subnetGateway}
                          onChange={e => setSubnetGateway(e.target.value)}
                          placeholder="10.10.20.1"
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 block mb-0.5">Dải DHCP Pool</label>
                        <input
                          type="text"
                          value={subnetDhcp}
                          onChange={e => setSubnetDhcp(e.target.value)}
                          placeholder="10.10.20.50-200"
                          className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                      </div>
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-1 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" /> Thêm Subnet
                      </button>
                    </div>
                    {subnetError && (
                      <div className="text-rose-600 text-[11px] font-medium">{subnetError}</div>
                    )}
                  </form>
                )}

                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[10.5px] text-slate-500 uppercase">
                        <th className="py-2 px-3">Subnet / CIDR</th>
                        <th className="py-2 px-2">VLAN</th>
                        <th className="py-2 px-2">Gateway / DHCP</th>
                        <th className="py-2 px-2 text-right">TB / Host</th>
                        <th className="py-2 px-2">Trạng thái</th>
                        {!isReadOnlyMode && <th className="py-2 px-2 text-right">Xóa</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {subnets.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-slate-400">
                            Chưa khai báo Subnet nào.
                          </td>
                        </tr>
                      ) : (
                        subnets.map(sub => {
                          const parsed = parseCidrRange(sub.cidr);
                          const overlaps = parsed
                            ? subnets.some(other => other.id !== sub.id && doCidrsOverlap(sub.cidr, other.cidr))
                            : false;
                          const hostCap = parsed
                            ? Math.max(0, parsed.broadcastInt - parsed.networkInt - 1)
                            : 0;
                          const usedCount = parsed
                            ? assets.filter(a => isIpInCidr(a.ipAddress, sub.cidr)).length
                            : 0;

                          return (
                            <tr key={sub.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                              <td className="py-2 px-3">
                                <div className="font-semibold text-slate-900 dark:text-white">{sub.name}</div>
                                <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
                                  {sub.cidr}
                                </div>
                              </td>
                              <td className="py-2 px-2 font-mono">
                                {sub.vlanId !== undefined ? `VLAN ${sub.vlanId}` : '—'}
                              </td>
                              <td className="py-2 px-2 font-mono text-[10.5px] text-slate-600 dark:text-slate-300">
                                <div>GW: {sub.gateway || '—'}</div>
                                {sub.dhcpRange && <div className="text-slate-400">DHCP: {sub.dhcpRange}</div>}
                              </td>
                              <td className="py-2 px-2 text-right font-mono tabular-nums">
                                {usedCount} / {hostCap}
                              </td>
                              <td className="py-2 px-2">
                                {!parsed ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold text-[10px]">
                                    <AlertTriangle className="w-3 h-3" /> Sai CIDR
                                  </span>
                                ) : overlaps ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold text-[10px]">
                                    <AlertTriangle className="w-3 h-3" /> Chồng dải
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold text-[10px]">
                                    <CheckCircle2 className="w-3 h-3" /> Hợp lệ
                                  </span>
                                )}
                              </td>
                              {!isReadOnlyMode && (
                                <td className="py-2 px-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => onDeleteSubnet(sub.id)}
                                    aria-label={`Xóa subnet ${sub.cidr}`}
                                    className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {!isReadOnlyMode && onApplyBulkStaticIps && (
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                        Nhập IP tĩnh hàng loạt (CSV)
                      </span>
                      <span className="text-[10.5px] font-mono text-slate-500">
                        Cột: tên/assetTag/IP cũ, IP mới, Subnet, Gateway, VLAN
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      value={bulkIpCsv}
                      onChange={e => setBulkIpCsv(e.target.value)}
                      placeholder={'SW-CORE-01,10.10.10.2,255.255.255.0,10.10.10.1,10\nAP-FL1-01,10.10.20.11,255.255.255.0,10.10.20.1,20'}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-[11px]"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-500 font-medium cursor-pointer text-[11px]">
                        <span>Nạp tệp CSV...</span>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          className="hidden"
                          onChange={async e => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            setBulkIpCsv(await f.text());
                            e.target.value = '';
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const res = parseAndApplyBulkStaticIpsCsv(bulkIpCsv, project);
                          if (res.updatedCount > 0) {
                            onApplyBulkStaticIps(res.updatedAssets);
                          }
                          setBulkIpFeedback({
                            text: `Đã cập nhật ${res.updatedCount} thiết bị · Bỏ qua ${res.skippedCount}.`,
                            errors: res.errors.slice(0, 5)
                          });
                        }}
                        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs"
                      >
                        Áp dụng IP hàng loạt
                      </button>
                    </div>
                    {bulkIpFeedback && (
                      <div className="text-[11px] space-y-0.5 text-slate-700 dark:text-slate-300">
                        <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {bulkIpFeedback.text}
                        </div>
                        {bulkIpFeedback.errors.map((err, i) => (
                          <div key={i} className="text-rose-600 dark:text-rose-400">
                            • {err}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: PATCH PANEL & CABLE SCHEDULE */}
          {activeTab === 'schedule' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={scheduleQuery}
                    onChange={e => setScheduleQuery(e.target.value)}
                    placeholder="Lọc mã cáp, Patch Panel, cổng, phòng, VLAN..."
                    className="w-full pl-8 pr-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-500 font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span>Xuất bảng cáp CSV ({filteredSchedule.length})</span>
                </button>
              </div>

              {!isReadOnlyMode && (
                <form
                  onSubmit={handleAddPatchLink}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 items-end"
                >
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-500 block mb-0.5">Patch Panel / ODF</label>
                    {patchPanelAssets.length > 0 ? (
                      <select
                        value={patchPanelId || patchPanelAssets[0].id}
                        onChange={e => setPatchPanelId(e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        {patchPanelAssets.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={patchPanelId}
                        onChange={e => setPatchPanelId(e.target.value)}
                        placeholder="PP-F1-01"
                        className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Cổng Panel *</label>
                    <input
                      type="text"
                      value={patchPort}
                      onChange={e => setPatchPort(e.target.value)}
                      placeholder="P01"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Thiết bị đích *</label>
                    <input
                      type="text"
                      value={patchTargetName}
                      onChange={e => setPatchTargetName(e.target.value)}
                      placeholder="AP-T2-01"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Ổ / Cổng đích</label>
                    <input
                      type="text"
                      value={patchTargetPort}
                      onChange={e => setPatchTargetPort(e.target.value)}
                      placeholder="RJ45-W01"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">Mã dây</label>
                    <input
                      type="text"
                      value={patchCableCode}
                      onChange={e => setPatchCableCode(e.target.value)}
                      placeholder="CAB-P01"
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-0.5">VLAN / Phòng</label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={patchVlan}
                        onChange={e => setPatchVlan(e.target.value)}
                        placeholder="VLAN"
                        className="w-1/2 px-1.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                      />
                      <input
                        type="text"
                        value={patchRoom}
                        onChange={e => setPatchRoom(e.target.value)}
                        placeholder="Phòng"
                        className="w-1/2 px-1.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center justify-center gap-1 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm đấu nối
                  </button>
                </form>
              )}

              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[10.5px] text-slate-500 uppercase">
                      <th className="py-2 px-3">Mã Cáp</th>
                      <th className="py-2 px-2">Nguồn / Patch Panel</th>
                      <th className="py-2 px-2">Cổng</th>
                      <th className="py-2 px-2">Đích</th>
                      <th className="py-2 px-2">Loại / Băng thông</th>
                      <th className="py-2 px-2 text-right">Dài</th>
                      <th className="py-2 px-2">VLAN / Phòng</th>
                      <th className="py-2 px-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredSchedule.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          Chưa có dữ liệu cáp hoặc đấu nối Patch Panel.
                        </td>
                      </tr>
                    ) : (
                      filteredSchedule.map(row => (
                        <tr key={`${row.sourceKind}_${row.id}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                            {row.cableCode}
                          </td>
                          <td className="py-2 px-2 font-medium">{row.patchPanelOrSource}</td>
                          <td className="py-2 px-2 font-mono text-[11px]">{row.sourcePort}</td>
                          <td className="py-2 px-2">
                            <span className="font-medium">{row.targetDevice}</span>{' '}
                            <span className="font-mono text-[10.5px] text-slate-400">({row.targetPort})</span>
                          </td>
                          <td className="py-2 px-2 font-mono text-[10.5px]">
                            {row.cableType} · {row.bandwidth}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums">
                            {row.lengthMeters > 0 ? `${row.lengthMeters}m` : '—'}
                          </td>
                          <td className="py-2 px-2 text-[10.5px]">
                            <span className="font-mono">{row.vlan}</span> · {row.roomName}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {row.sourceKind === 'cable' && onSelectTarget ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectTarget('edge', row.id);
                                  onClose();
                                }}
                                className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-[10.5px] font-semibold"
                              >
                                Xem dây
                              </button>
                            ) : !isReadOnlyMode && row.sourceKind === 'manual_patch' ? (
                              <button
                                type="button"
                                onClick={() => onDeletePatchLink(row.id)}
                                aria-label={`Xóa đấu nối ${row.sourcePort}`}
                                className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: NAMED REVISIONS */}
          {activeTab === 'revisions' && (
            <div className="space-y-4">
              {revBanner && (
                <div className="px-3 py-2 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-between text-[11px] font-semibold">
                  <span>{revBanner}</span>
                  <button type="button" onClick={() => setRevBanner(null)} className="underline">
                    Ẩn
                  </button>
                </div>
              )}

              {!isReadOnlyMode && (
                <form
                  onSubmit={handleSaveRevision}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-wrap gap-2 items-end"
                >
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-[10.5px] text-slate-500 block mb-0.5">Tên mốc phiên bản</label>
                    <input
                      type="text"
                      value={revLabel}
                      onChange={e => setRevLabel(e.target.value)}
                      placeholder="VD: v1.2 Trước khi đi lại cáp Tầng 3"
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium"
                      required
                    />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <label className="text-[10.5px] text-slate-500 block mb-0.5">Ghi chú thay đổi (tuỳ chọn)</label>
                    <input
                      type="text"
                      value={revNote}
                      onChange={e => setRevNote(e.target.value)}
                      placeholder="Chốt phương án IPAM & Core Switch..."
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Lưu mốc phiên bản</span>
                  </button>
                </form>
              )}

              <div className="space-y-2.5">
                {revisions.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
                    Chưa có mốc phiên bản nào được lưu cho dự án này.
                  </div>
                ) : (
                  revisions.map(rev => {
                    const diff = computeRevisionDiff(project, rev.snapshot);
                    const isConfirming = confirmRestoreId === rev.id;
                    const isExpanded = expandedRevId === rev.id;
                    const detailedDiff = isExpanded ? computeDetailedRevisionDiff(project, rev.snapshot) : null;

                    return (
                      <div
                        key={rev.id}
                        className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-white">{rev.label}</span>
                            <span className="text-[10.5px] font-mono text-slate-500">
                              {new Date(rev.createdAt).toLocaleString('vi-VN')} · {rev.author}
                            </span>
                          </div>
                          {rev.note && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-300">{rev.note}</div>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-[10.5px] font-mono text-slate-500">
                            <span>
                              Ảnh chụp: {rev.assetCount} TB · {rev.rackCount} Rack · {rev.cableCount} Cáp
                            </span>
                            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                              <GitCompare className="w-3 h-3" />
                              So với hiện tại: +{diff.addedAssets}/-{diff.removedAssets} TB, +{diff.addedCables}/-
                              {diff.removedCables} Cáp
                            </span>
                            <button
                              type="button"
                              onClick={() => setExpandedRevId(isExpanded ? null : rev.id)}
                              className="text-blue-600 dark:text-blue-400 hover:underline font-sans font-semibold"
                            >
                              {isExpanded ? 'Ẩn chi tiết' : 'Chi tiết thay đổi'}
                            </button>
                          </div>
                        </div>

                        {!isReadOnlyMode && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isConfirming ? (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const ok = await onRestoreRevision(rev.id);
                                    setConfirmRestoreId(null);
                                    if (ok) setRevBanner(`Đã khôi phục dự án về mốc "${rev.label}".`);
                                  }}
                                  className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px]"
                                >
                                  Xác nhận khôi phục
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRestoreId(null)}
                                  className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px]"
                                >
                                  Hủy
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRestoreId(rev.id)}
                                  className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:border-blue-500 font-semibold flex items-center gap-1"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
                                  <span>Khôi phục</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeleteRevision(rev.id)}
                                  aria-label={`Xóa mốc phiên bản ${rev.label}`}
                                  className="p-1.5 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        </div>
                        {detailedDiff && (
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] space-y-1 bg-slate-50/70 dark:bg-slate-800/30 p-2 rounded">
                            {detailedDiff.addedNodeLabels.length === 0 &&
                            detailedDiff.removedNodeLabels.length === 0 &&
                            detailedDiff.addedCableCodes.length === 0 &&
                            detailedDiff.removedCableCodes.length === 0 &&
                            detailedDiff.modifiedAssets.length === 0 ? (
                              <div className="text-slate-500">Không có sai khác thiết bị hoặc tuyến cáp so với bản hiện tại.</div>
                            ) : (
                              <>
                                {detailedDiff.addedNodeLabels.length > 0 && (
                                  <div className="text-emerald-700 dark:text-emerald-300">
                                    + Thiết bị thêm mới: {detailedDiff.addedNodeLabels.join(', ')}
                                  </div>
                                )}
                                {detailedDiff.removedNodeLabels.length > 0 && (
                                  <div className="text-rose-700 dark:text-rose-300">
                                    - Thiết bị đã xóa: {detailedDiff.removedNodeLabels.join(', ')}
                                  </div>
                                )}
                                {detailedDiff.addedCableCodes.length > 0 && (
                                  <div className="text-emerald-700 dark:text-emerald-300">
                                    + Cáp thêm mới: {detailedDiff.addedCableCodes.join(', ')}
                                  </div>
                                )}
                                {detailedDiff.removedCableCodes.length > 0 && (
                                  <div className="text-rose-700 dark:text-rose-300">
                                    - Cáp đã xóa: {detailedDiff.removedCableCodes.join(', ')}
                                  </div>
                                )}
                                {detailedDiff.modifiedAssets.map(mod => (
                                  <div key={mod.assetId} className="text-amber-700 dark:text-amber-300">
                                    ~ {mod.name}: {mod.changes.join(' · ')}
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
