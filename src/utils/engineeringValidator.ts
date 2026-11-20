import { CableEdge, DeviceAsset, DevicePort, ProjectState } from '../types/infrastructure';
import { getRackStatistics } from './rackGeometry';
import {
  computeProjectPoeSummary,
  computeSwitchPoeBreakdown,
  computeUpsBatteryRuntime,
  getActiveProjectAssets
} from './poeCalculator';
import { computeOpticalLinkBudget } from './cableRouting';
import { evaluatePortPairCompatibility, getPortMediaFamily } from './portCompatibility';
import { normalizeScalePxPerMeter } from './scaleUtils';

export type AuditSeverity = 'error' | 'warning' | 'info';

export interface AuditIssue {
  id: string;
  severity: AuditSeverity;
  category: 'ip' | 'port' | 'vlan' | 'rack' | 'power' | 'connectivity';
  title: string;
  description: string;
  targetType: 'node' | 'edge' | 'rack';
  targetId: string;
}

export interface UpsPowerDomainAudit {
  domainId: string;
  domainLabel: string;
  upsAssetIds: string[];
  upsNames: string[];
  installedCapacityWatts: number;
  effectiveCapacityWatts: number;
  redundancyMode: 'standalone' | 'parallel' | 'n_plus_1';
  loadWatts: number;
  deviceCount: number;
  utilizationPct: number | null;
  runtimeMinutes: number;
  status: 'adequate' | 'warning' | 'overload' | 'no_ups' | 'idle';
}

export interface EngineeringSummary {
  totalDevices: number;
  totalCables: number;
  totalPowerWatts: number;
  estimatedCurrentAmps220V: number;
  totalPoeWattsEstimate: number;
  upsCapacityWatts: number;
  estimatedUpsRuntimeMinutes: number;
  errorCount: number;
  warningCount: number;
}

export interface EngineeringAuditReport {
  issues: AuditIssue[];
  summary: EngineeringSummary;
  powerDomains?: UpsPowerDomainAudit[];
}

export type AuditReport = EngineeringAuditReport;

export interface ResolvedUpsPower {
  activeWatts: number;
  ratedVa: number;
  powerFactor: number;
  hasInvalidSpecs: boolean;
  invalidReason?: string;
}

/**
 * Resolves true UPS active power capacity P(W) from declared active Watts or P(W) = S(VA) * PF (default 0.8),
 * never equating VA = W and flagging physically impossible W > VA or invalid PF specs.
 */
export function resolveUpsActiveWatts(asset: DeviceAsset): ResolvedUpsPower {
  const rawPowerW =
    typeof asset.powerWatts === 'number' && Number.isFinite(asset.powerWatts)
      ? Math.max(0, asset.powerWatts)
      : 0;
  const rawVa =
    typeof asset.upsSpecs?.ratedVa === 'number' && Number.isFinite(asset.upsSpecs.ratedVa)
      ? Math.max(0, asset.upsSpecs.ratedVa)
      : 0;
  const rawPf = asset.upsSpecs?.powerFactor;
  const hasBadPf = rawPf !== undefined && (!Number.isFinite(rawPf) || rawPf <= 0 || rawPf > 1);
  const pf = !hasBadPf && typeof rawPf === 'number' ? rawPf : 0.8;

  if (rawVa > 0 && rawPowerW > rawVa) {
    return {
      activeWatts: Math.round(rawVa * pf),
      ratedVa: rawVa,
      powerFactor: pf,
      hasInvalidSpecs: true,
      invalidReason: `Công suất tác dụng (${rawPowerW}W) lớn hơn công suất biểu kiến (${rawVa}VA)`
    };
  }

  if (hasBadPf) {
    const fallbackW =
      rawPowerW > 0 ? Math.round(rawPowerW) : rawVa > 0 ? Math.round(rawVa * 0.8) : 0;
    return {
      activeWatts: fallbackW,
      ratedVa: rawVa,
      powerFactor: 0.8,
      hasInvalidSpecs: true,
      invalidReason: `Hệ số công suất PF (${rawPf}) không hợp lệ (cần 0 < PF <= 1)`
    };
  }

  const activeWatts =
    rawPowerW > 0 ? Math.round(rawPowerW) : rawVa > 0 ? Math.round(rawVa * pf) : 0;
  return {
    activeWatts,
    ratedVa: rawVa,
    powerFactor: pf,
    hasInvalidSpecs: false
  };
}

export interface IpVlanMatrixRow {
  assetId: string;
  nodeId?: string;
  name: string;
  category: string;
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  vlan: string;
  macAddress: string;
  rackLocation: string;
  duplicateIp: boolean;
}

export interface CidrRange {
  cidr: string;
  networkInt: number;
  broadcastInt: number;
  prefix: number;
}

export function parseIpv4ToInt(ip: string): number | null {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    acc = (acc * 256) + n;
  }
  return acc >>> 0;
}

export function parseCidrRange(cidr: string): CidrRange | null {
  const [ipPart, prefixPart] = String(cidr || '').trim().split('/');
  if (!ipPart || prefixPart === undefined || !/^\d{1,2}$/.test(prefixPart)) return null;
  const prefix = Number(prefixPart);
  if (prefix < 0 || prefix > 32) return null;
  const ipInt = parseIpv4ToInt(ipPart);
  if (ipInt === null) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0;
  return { cidr: `${ipPart}/${prefix}`, networkInt, broadcastInt, prefix };
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const ipInt = parseIpv4ToInt(ip);
  const range = parseCidrRange(cidr);
  if (ipInt === null || !range) return false;
  return ipInt >= range.networkInt && ipInt <= range.broadcastInt;
}

export function doCidrsOverlap(cidrA: string, cidrB: string): boolean {
  const a = parseCidrRange(cidrA);
  const b = parseCidrRange(cidrB);
  if (!a || !b) return false;
  return a.networkInt <= b.broadcastInt && b.networkInt <= a.broadcastInt;
}

export interface PatchScheduleRow {
  id: string;
  sourceKind: 'cable' | 'manual_patch';
  cableCode: string;
  patchPanelOrSource: string;
  sourcePort: string;
  targetDevice: string;
  targetPort: string;
  cableType: string;
  bandwidth: string;
  lengthMeters: number;
  vlan: string;
  roomName: string;
  status: string;
  notes: string;
}

/**
 * Runs deterministic engineering validation across the active ProjectState:
 * 1. Duplicate IP addresses
 * 2. Port conflicts (2+ cables claiming same device + non-Auto portId)
 * 3. VLAN mismatch across connected devices/cables
 * 4. Isolated/unconnected network devices
 * 5. Rack U-overflow & weight overload
 * 6. Power-domain-aware UPS capacity (W = VA * PF, Peukert battery runtime) & PoE budget checks
 * 7. Subnet CIDR validity, overlaps, IP containment & declared VLAN checks
 * 8. L2 switching loop detection across 2+ switches with routed-port exclusion and structured STP/LACP verification
 */
export type L2LoopStatus = 'suspected_loop' | 'protected_redundancy' | 'unverified';
export type L2LoopKind = 'parallel_links' | 'ring_topology';

export interface L2SwitchingLoop {
  nodeIds: string[];
  cableIds: string[];
  cycleLabels: string[];
  status: L2LoopStatus;
  kind: L2LoopKind;
  reason: string;
}

function findAssetPort(asset: DeviceAsset | undefined, portIdOrName?: string): DevicePort | undefined {
  if (!asset || !portIdOrName || portIdOrName === 'Auto') return undefined;
  return (asset.ports || []).find(p => p.id === portIdOrName || p.name === portIdOrName);
}

function hasStructuredStpEnabled(asset: DeviceAsset | undefined): boolean {
  const mode = asset?.l2Config?.stpMode;
  return mode === 'stp' || mode === 'rstp' || mode === 'mstp' || mode === 'pvst';
}

function hasTextRedundancyHint(cables: CableEdge[]): boolean {
  return cables.some(c =>
    /\b(STP|RSTP|MSTP|LACP|LAG|ISL|MLAG|STACK|VPC)\b/i.test(
      `${c.cableCode || ''} ${c.label || ''} ${c.notes || ''}`
    )
  );
}

export function detectL2SwitchingLoops(project: ProjectState): L2SwitchingLoop[] {
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const switchIds = new Set<string>();
  for (const n of project.nodes) {
    const asset = n.assetId ? project.assets[n.assetId] : undefined;
    const cat = asset?.category;
    if (cat === 'switch' || cat === 'core_switch') {
      switchIds.add(n.id);
    }
  }
  if (switchIds.size < 2) return [];

  const pairCablesMap = new Map<string, CableEdge[]>();
  const adjSimple = new Map<string, Map<string, CableEdge[]>>();
  switchIds.forEach(id => adjSimple.set(id, new Map()));

  for (const c of project.cables) {
    if (c.cableType === 'POWER_AC') continue;
    if (!switchIds.has(c.sourceNodeId) || !switchIds.has(c.targetNodeId)) continue;
    if (c.sourceNodeId === c.targetNodeId) continue;

    const srcNode = nodeMap.get(c.sourceNodeId);
    const tgtNode = nodeMap.get(c.targetNodeId);
    const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;
    const srcPort = findAssetPort(srcAsset, c.sourcePortId);
    const tgtPort = findAssetPort(tgtAsset, c.targetPortId);

    // Exclude routed L3 links from L2 broadcast domain
    if (srcPort?.portMode === 'routed' || tgtPort?.portMode === 'routed') {
      continue;
    }

    const pairKey =
      c.sourceNodeId < c.targetNodeId
        ? `${c.sourceNodeId}::${c.targetNodeId}`
        : `${c.targetNodeId}::${c.sourceNodeId}`;
    const list = pairCablesMap.get(pairKey) || [];
    list.push(c);
    pairCablesMap.set(pairKey, list);

    const srcNeighbors = adjSimple.get(c.sourceNodeId)!;
    const fwdList = srcNeighbors.get(c.targetNodeId) || [];
    fwdList.push(c);
    srcNeighbors.set(c.targetNodeId, fwdList);

    const tgtNeighbors = adjSimple.get(c.targetNodeId)!;
    const revList = tgtNeighbors.get(c.sourceNodeId) || [];
    revList.push(c);
    tgtNeighbors.set(c.sourceNodeId, revList);
  }

  const loops: L2SwitchingLoop[] = [];

  // 1. Detect 2-switch parallel-link multi-edges (Port-Channel vs broadcast loop)
  for (const [pairKey, cablesBetween] of pairCablesMap.entries()) {
    if (cablesBetween.length < 2) continue;
    const [idA, idB] = pairKey.split('::');
    const nodeA = nodeMap.get(idA);
    const nodeB = nodeMap.get(idB);
    const assetA = nodeA?.assetId ? project.assets[nodeA.assetId] : undefined;
    const assetB = nodeB?.assetId ? project.assets[nodeB.assetId] : undefined;

    const isAllLacp = cablesBetween.every(c => {
      const sNode = nodeMap.get(c.sourceNodeId);
      const tNode = nodeMap.get(c.targetNodeId);
      const sAsset = sNode?.assetId ? project.assets[sNode.assetId] : undefined;
      const tAsset = tNode?.assetId ? project.assets[tNode.assetId] : undefined;
      const sPort = findAssetPort(sAsset, c.sourcePortId);
      const tPort = findAssetPort(tAsset, c.targetPortId);
      return Boolean(
        sPort?.portMode === 'lacp_member' &&
          tPort?.portMode === 'lacp_member' &&
          sPort.lacpGroup?.trim() &&
          tPort.lacpGroup?.trim() &&
          sPort.lacpGroup.trim() === tPort.lacpGroup.trim()
      );
    });

    const sharedMlagDomain = Boolean(
      assetA?.l2Config?.mlagDomain?.trim() &&
        assetA.l2Config.mlagDomain.trim() === assetB?.l2Config?.mlagDomain?.trim()
    );
    const bothStp = hasStructuredStpEnabled(assetA) && hasStructuredStpEnabled(assetB);

    let status: L2LoopStatus = 'suspected_loop';
    let reason =
      'Phát hiện nhiều cáp đấu song song giữa 2 Switch mà chưa cấu hình LACP (Port-Channel), MLAG hoặc STP/RSTP.';
    if (isAllLacp) {
      status = 'protected_redundancy';
      reason = 'Các tuyến song song đã ghép kênh LACP đồng nhất hai đầu.';
    } else if (sharedMlagDomain) {
      status = 'protected_redundancy';
      reason = 'Hai Switch thuộc cùng miền MLAG/Stack.';
    } else if (bothStp) {
      status = 'protected_redundancy';
      reason = 'Cả hai Switch đã bật STP/RSTP trong cấu hình thiết bị.';
    } else if (hasTextRedundancyHint(cablesBetween)) {
      status = 'unverified';
      reason =
        'Có ghi chú RSTP/LACP bằng chữ trên cáp nhưng thiếu cấu hình LACP trên cổng hoặc chế độ STP trên Switch.';
    }

    loops.push({
      nodeIds: [idA, idB],
      cableIds: cablesBetween.map(c => c.id),
      cycleLabels: [nodeA?.label || idA, nodeB?.label || idB],
      status,
      kind: 'parallel_links',
      reason
    });
  }

  // 2. Detect >= 3-switch ring topologies
  if (switchIds.size >= 3) {
    const visited = new Set<string>();
    const seenRingSignatures = new Set<string>();

    const dfs = (current: string, parentId: string | null, stack: string[]) => {
      visited.add(current);
      stack.push(current);

      const neighbors = adjSimple.get(current);
      if (neighbors) {
        for (const [nextId] of neighbors.entries()) {
          if (nextId === parentId) continue;
          const idxInStack = stack.indexOf(nextId);
          if (idxInStack !== -1) {
            const cycleNodeIds = stack.slice(idxInStack);
            if (cycleNodeIds.length >= 3) {
              const sig = [...cycleNodeIds].sort().join('|');
              if (!seenRingSignatures.has(sig)) {
                seenRingSignatures.add(sig);
                const ringCables: CableEdge[] = [];
                for (let i = 0; i < cycleNodeIds.length; i++) {
                  const u = cycleNodeIds[i];
                  const v = cycleNodeIds[(i + 1) % cycleNodeIds.length];
                  const hopCables = adjSimple.get(u)?.get(v) || [];
                  if (hopCables.length > 0) ringCables.push(hopCables[0]);
                }

                const allStp = cycleNodeIds.every(id => {
                  const node = nodeMap.get(id);
                  const asset = node?.assetId ? project.assets[node.assetId] : undefined;
                  return hasStructuredStpEnabled(asset);
                });

                let status: L2LoopStatus = 'suspected_loop';
                let reason =
                  'Phát hiện mạch vòng giữa các Switch mà chưa cấu hình STP/RSTP trên từng Switch trong vòng.';
                if (allStp) {
                  status = 'protected_redundancy';
                  reason = 'Tất cả Switch trong mạch vòng đã bật STP/RSTP.';
                } else if (hasTextRedundancyHint(ringCables)) {
                  status = 'unverified';
                  reason =
                    'Cáp có ghi chú RSTP/STP bằng chữ nhưng thiếu khai báo stpMode có cấu trúc trên toàn bộ Switch.';
                }

                loops.push({
                  nodeIds: cycleNodeIds,
                  cableIds: ringCables.map(c => c.id),
                  cycleLabels: cycleNodeIds.map(id => nodeMap.get(id)?.label || id),
                  status,
                  kind: 'ring_topology',
                  reason
                });
              }
            }
          } else if (!visited.has(nextId)) {
            dfs(nextId, current, stack);
          }
        }
      }

      stack.pop();
    };

    for (const swId of switchIds) {
      if (!visited.has(swId)) {
        dfs(swId, null, []);
      }
    }
  }

  return loops;
}

export function runEngineeringAudit(project: ProjectState): EngineeringAuditReport {
  const issues: AuditIssue[] = [];
  const { assets } = getActiveProjectAssets(project);

  // 1. Duplicate IP check
  const ipMap = new Map<string, string[]>();
  for (const a of assets) {
    const ip = (a.ipAddress || '').trim();
    if (!ip || ip === '0.0.0.0' || ip.toLowerCase() === 'dhcp') continue;
    const list = ipMap.get(ip) || [];
    list.push(a.id);
    ipMap.set(ip, list);
  }
  for (const [ip, assetIds] of ipMap.entries()) {
    if (assetIds.length > 1) {
      const names = assetIds.map(id => project.assets[id]?.name || id).join(', ');
      const firstNode = project.nodes.find(n => n.assetId === assetIds[0]);
      issues.push({
        id: `dup_ip_${ip}`,
        severity: 'error',
        category: 'ip',
        title: `Trùng địa chỉ IP: ${ip}`,
        description: `${assetIds.length} thiết bị đang dùng chung IP ${ip}: ${names}.`,
        targetType: 'node',
        targetId: firstNode?.id || ''
      });
    }
  }

  // 2. Port conflict check (same node + specific portId used on multiple cables)
  const portUseMap = new Map<string, string[]>();
  for (const c of project.cables) {
    if (c.sourcePortId && c.sourcePortId !== 'Auto') {
      const key = `${c.sourceNodeId}::${c.sourcePortId}`;
      portUseMap.set(key, [...(portUseMap.get(key) || []), c.id]);
    }
    if (c.targetPortId && c.targetPortId !== 'Auto') {
      const key = `${c.targetNodeId}::${c.targetPortId}`;
      portUseMap.set(key, [...(portUseMap.get(key) || []), c.id]);
    }
  }
  for (const [key, cableIds] of portUseMap.entries()) {
    if (cableIds.length > 1) {
      const [nodeId, portId] = key.split('::');
      const nodeLabel = project.nodes.find(n => n.id === nodeId)?.label || nodeId;
      issues.push({
        id: `dup_port_${key}`,
        severity: 'error',
        category: 'port',
        title: `Xung đột cổng ${portId} trên ${nodeLabel}`,
        description: `${cableIds.length} dây cáp đang đấu cùng vào cổng ${portId}.`,
        targetType: 'edge',
        targetId: cableIds[0]
      });
    }
  }

  // 3. VLAN mismatch, physical port compatibility, media vs cable type & TIA-568 / optical distance checks
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const clearAuditOccupation = (port: DevicePort | undefined): DevicePort | undefined =>
    port
      ? { ...port, status: 'unlinked', connectedCableId: undefined, connectedTarget: undefined }
      : port;

  for (const c of project.cables) {
    const srcNode = nodeMap.get(c.sourceNodeId);
    const tgtNode = nodeMap.get(c.targetNodeId);
    const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;

    const srcPort =
      srcAsset && c.sourcePortId && c.sourcePortId !== 'Auto'
        ? srcAsset.ports.find(p => p.id === c.sourcePortId || p.name === c.sourcePortId)
        : undefined;
    const tgtPort =
      tgtAsset && c.targetPortId && c.targetPortId !== 'Auto'
        ? tgtAsset.ports.find(p => p.id === c.targetPortId || p.name === c.targetPortId)
        : undefined;

    // 3a. Physical Port-to-Port Compatibility Check (port occupation is checked separately in Section 2)
    if (srcPort && tgtPort) {
      const compat = evaluatePortPairCompatibility(
        srcAsset,
        clearAuditOccupation(srcPort),
        tgtAsset,
        clearAuditOccupation(tgtPort)
      );
      if (compat.level === 'error') {
        issues.push({
          id: `port_incompat_${c.id}`,
          severity: 'error',
          category: 'port',
          title: `Cổng không tương thích trên ${c.cableCode}`,
          description: compat.reasons[0] || `Cổng ${srcPort.name} (${srcPort.type}) không thể nối với ${tgtPort.name} (${tgtPort.type}).`,
          targetType: 'edge',
          targetId: c.id
        });
      } else if (compat.level === 'warning') {
        issues.push({
          id: `port_speed_warn_${c.id}`,
          severity: 'warning',
          category: 'port',
          title: `Chênh lệch chuẩn/tốc độ cổng trên ${c.cableCode}`,
          description: compat.reasons[0] || `Kiểm tra thông số cổng ${srcPort.name} ↔ ${tgtPort.name}.`,
          targetType: 'edge',
          targetId: c.id
        });
      }
    }

    // 3b. CableType vs Endpoint Port Media Family Check
    const srcFamily = srcPort ? getPortMediaFamily(srcPort.type) : undefined;
    const tgtFamily = tgtPort ? getPortMediaFamily(tgtPort.type) : undefined;
    if (c.cableType === 'POWER_AC') {
      if ((srcFamily && srcFamily !== 'power') || (tgtFamily && tgtFamily !== 'power')) {
        issues.push({
          id: `media_power_mismatch_${c.id}`,
          severity: 'error',
          category: 'port',
          title: `Sai dây nguồn đấu cổng dữ liệu (${c.cableCode})`,
          description: `Dây nguồn AC (${c.cableCode}) đang gắn vào cổng mạng/quản trị không phải cổng nguồn.`,
          targetType: 'edge',
          targetId: c.id
        });
      }
    } else if (c.cableType === 'FIBER_SM_OS2' || c.cableType === 'FIBER_MM_OM4') {
      if (srcFamily === 'copper' || tgtFamily === 'copper') {
        issues.push({
          id: `media_fiber_on_rj45_${c.id}`,
          severity: 'error',
          category: 'port',
          title: `Đấu cáp quang vào cổng RJ45 (${c.cableCode})`,
          description: `Tuyến cáp quang ${c.cableCode} đang đấu vào cổng đồng RJ45 (${srcPort?.name || tgtPort?.name}).`,
          targetType: 'edge',
          targetId: c.id
        });
      }
    }

    // 3c. TIA-568 Distance Limits & Optical Link Budget
    const len = Number(c.lengthMeters) || 0;
    if ((c.cableType === 'CAT6_UTP' || c.cableType === 'CAT6A_STP') && len > 100) {
      issues.push({
        id: `copper_distance_${c.id}`,
        severity: 'error',
        category: 'connectivity',
        title: `Vượt giới hạn 100m cáp đồng (${c.cableCode})`,
        description: `Tuyến ${c.cableCode} dài ${len}m vượt ngưỡng tối đa 100m chuẩn TIA-568 đối với cáp xoắn đôi.`,
        targetType: 'edge',
        targetId: c.id
      });
    } else if (
      c.cableType === 'CAT6_UTP' &&
      (c.bandwidth === '10G' || c.bandwidth === '25G' || c.bandwidth === '40G' || c.bandwidth === '100G') &&
      len > 55
    ) {
      issues.push({
        id: `cat6_10g_distance_${c.id}`,
        severity: 'warning',
        category: 'connectivity',
        title: `CAT6 UTP chạy ${c.bandwidth} vượt 55m (${c.cableCode})`,
        description: `Tuyến ${c.cableCode} dài ${len}m dùng CAT6_UTP ở tốc độ ${c.bandwidth} vượt giới hạn 55m chuẩn TIA-568-C.2 / IEEE 802.3an; nên nâng cấp lên CAT6A_STP hoặc cáp quang.`,
        targetType: 'edge',
        targetId: c.id
      });
    } else if (c.cableType === 'DAC_10G' && len > 7) {
      issues.push({
        id: `dac_distance_${c.id}`,
        severity: 'warning',
        category: 'connectivity',
        title: `Cáp DAC vượt 7m (${c.cableCode})`,
        description: `Tuyến DAC ${c.cableCode} dài ${len}m vượt chuẩn thụ động 7m; cân nhắc chuyển sang cáp quang hoặc AOC.`,
        targetType: 'edge',
        targetId: c.id
      });
    } else if (c.cableType === 'FIBER_SM_OS2' || c.cableType === 'FIBER_MM_OM4') {
      if (
        c.cableType === 'FIBER_MM_OM4' &&
        len > 400 &&
        (c.bandwidth === '10G' || c.bandwidth === '25G' || c.bandwidth === '40G' || c.bandwidth === '100G')
      ) {
        issues.push({
          id: `om4_distance_${c.id}`,
          severity: 'warning',
          category: 'connectivity',
          title: `Quang OM4 vượt tầm 400m (${c.cableCode})`,
          description: `Tuyến OM4 ${c.cableCode} dài ${len}m ở tốc độ ${c.bandwidth} vượt khuyến nghị 400m; cân nhắc dùng quang Single-mode OS2.`,
          targetType: 'edge',
          targetId: c.id
        });
      }
      const opticalBudget = computeOpticalLinkBudget({
        cableType: c.cableType,
        lengthMeters: len,
        connectorCount: c.fiberConnectors,
        spliceCount: c.fiberSplices,
        transceiverBudgetDb: c.transceiverBudgetDb
      });
      if (opticalBudget.status === 'exceeded') {
        issues.push({
          id: `optical_budget_exceeded_${c.id}`,
          severity: 'error',
          category: 'connectivity',
          title: `Vượt quỹ suy hao quang (${c.cableCode})`,
          description: `Tổng suy hao ${opticalBudget.totalLossDb} dB vượt ngưỡng thu phát ${opticalBudget.transceiverBudgetDb} dB (âm ${Math.abs(opticalBudget.marginDb)} dB).`,
          targetType: 'edge',
          targetId: c.id
        });
      } else if (opticalBudget.status === 'marginal') {
        issues.push({
          id: `optical_budget_marginal_${c.id}`,
          severity: 'warning',
          category: 'connectivity',
          title: `Suy hao quang sát ngưỡng (${c.cableCode})`,
          description: `Quỹ dự phòng quang trên ${c.cableCode} chỉ còn +${opticalBudget.marginDb} dB (${opticalBudget.totalLossDb}/${opticalBudget.transceiverBudgetDb} dB).`,
          targetType: 'edge',
          targetId: c.id
        });
      }
    }

    if (c.cableType === 'POWER_AC') continue;
    if (srcAsset && tgtAsset && srcAsset.vlan && tgtAsset.vlan) {
      const srcVlans = srcAsset.vlan.split(',').map(v => v.trim()).filter(Boolean);
      const tgtVlans = tgtAsset.vlan.split(',').map(v => v.trim()).filter(Boolean);
      const hasOverlap = srcVlans.some(v => tgtVlans.includes(v));
      if (!hasOverlap && srcVlans.length === 1 && tgtVlans.length === 1) {
        issues.push({
          id: `vlan_mismatch_${c.id}`,
          severity: 'warning',
          category: 'vlan',
          title: `Lệch VLAN trên tuyến ${c.cableCode}`,
          description: `${srcAsset.name} (VLAN ${srcAsset.vlan}) nối với ${tgtAsset.name} (VLAN ${tgtAsset.vlan}) không trùng VLAN.`,
          targetType: 'edge',
          targetId: c.id
        });
      }
    }
  }

  // 4. Unconnected device nodes
  const connectedNodeIds = new Set<string>();
  project.cables.forEach(c => {
    connectedNodeIds.add(c.sourceNodeId);
    connectedNodeIds.add(c.targetNodeId);
  });
  for (const node of project.nodes) {
    if (node.type === 'rack' || node.type === 'text' || node.type === 'zone' || node.type === 'legend') continue;
    if (!connectedNodeIds.has(node.id)) {
      issues.push({
        id: `unconnected_${node.id}`,
        severity: 'warning',
        category: 'connectivity',
        title: `Thiết bị chưa đấu cáp: ${node.label}`,
        description: `Nút ${node.label} chưa có kết nối cáp nào trên sơ đồ.`,
        targetType: 'node',
        targetId: node.id
      });
    }
  }

  // 5. Rack structural checks (overflow U & overweight)
  for (const rack of project.racks) {
    const stats = getRackStatistics(rack, project.assets);
    if (stats.overflowItems.length > 0) {
      issues.push({
        id: `rack_overflow_${rack.id}`,
        severity: 'error',
        category: 'rack',
        title: `Vượt chiều cao U tại ${rack.name}`,
        description: `${stats.overflowItems.length} thiết bị vượt quá giới hạn ${rack.totalUnits}U của tủ.`,
        targetType: 'rack',
        targetId: rack.id
      });
    }
    if (stats.isOverweight) {
      issues.push({
        id: `rack_weight_${rack.id}`,
        severity: 'error',
        category: 'rack',
        title: `Quá tải trọng tại ${rack.name}`,
        description: `Tổng tải ${stats.totalWeightKg.toFixed(1)} kg vượt giới hạn ${stats.maxLoadKg} kg.`,
        targetType: 'rack',
        targetId: rack.id
      });
    }
  }

  // 6. Power-Domain-Aware Electrical, PoE & UPS Capacity Calculation
  const floorMap = new Map(project.floors.map(f => [f.id, f]));
  const rackMap = new Map(project.racks.map(r => [r.id, r]));
  const firstNodeByAssetId = new Map<string, ProjectState['nodes'][number]>();
  for (const n of project.nodes) {
    if (n.assetId && !firstNodeByAssetId.has(n.assetId)) {
      firstNodeByAssetId.set(n.assetId, n);
    }
  }

  // Build power feeder graph (POWER_AC cables + fedByUpsId / fedByPduId)
  const powerAdjByAssetId = new Map<string, Set<string>>();
  for (const c of project.cables) {
    if (c.cableType !== 'POWER_AC') continue;
    const srcA = nodeMap.get(c.sourceNodeId)?.assetId;
    const tgtA = nodeMap.get(c.targetNodeId)?.assetId;
    if (!srcA || !tgtA || srcA === tgtA) continue;
    if (!powerAdjByAssetId.has(srcA)) powerAdjByAssetId.set(srcA, new Set());
    if (!powerAdjByAssetId.has(tgtA)) powerAdjByAssetId.set(tgtA, new Set());
    powerAdjByAssetId.get(srcA)!.add(tgtA);
    powerAdjByAssetId.get(tgtA)!.add(srcA);
  }

  const fedUpsIdsByAssetId = new Map<string, Set<string>>();
  const linkFedUps = (assetId: string, upsId: string) => {
    if (!fedUpsIdsByAssetId.has(assetId)) fedUpsIdsByAssetId.set(assetId, new Set());
    fedUpsIdsByAssetId.get(assetId)!.add(upsId);
  };

  // Explicit asset.fedByUpsId and fedByPduId -> pdu.fedByUpsId
  for (const a of assets) {
    if (a.category === 'ups') continue;
    if (a.fedByUpsId && project.assets[a.fedByUpsId]?.category === 'ups') {
      linkFedUps(a.id, a.fedByUpsId);
    } else if (a.fedByPduId) {
      const pdu = project.assets[a.fedByPduId];
      if (pdu?.fedByUpsId && project.assets[pdu.fedByUpsId]?.category === 'ups') {
        linkFedUps(a.id, pdu.fedByUpsId);
      }
    }
  }

  // Traverse POWER_AC cables downstream from each UPS (passing through intermediate PDUs / panels)
  const upsAssets = assets.filter(a => a.category === 'ups');
  for (const ups of upsAssets) {
    const seen = new Set<string>([ups.id]);
    const queue: string[] = [ups.id];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const neighbors = powerAdjByAssetId.get(currId);
      if (!neighbors) continue;
      for (const nextId of neighbors) {
        if (seen.has(nextId)) continue;
        seen.add(nextId);
        const nextAsset = project.assets[nextId];
        if (!nextAsset || nextAsset.category === 'ups') continue;
        linkFedUps(nextId, ups.id);
        if (nextAsset.category === 'pdu' || nextAsset.category === 'electrical_panel') {
          queue.push(nextId);
        }
      }
    }
  }

  const resolveDomainInfo = (
    asset: DeviceAsset
  ): { id: string; label: string } => {
    const explicit = (asset.upsSpecs?.powerDomain || asset.powerDomain || '').trim();
    if (explicit) {
      return { id: `domain:${explicit}`, label: `Miền điện: ${explicit}` };
    }
    if (asset.rackId) {
      const rackName = rackMap.get(asset.rackId)?.name || asset.rackId;
      return { id: `rack:${asset.rackId}`, label: rackName };
    }
    const fId = asset.floorId || firstNodeByAssetId.get(asset.id)?.floorId;
    if (fId) {
      const flrName = floorMap.get(fId)?.name || fId;
      return { id: `floor:${fId}`, label: flrName };
    }
    return { id: 'default', label: 'Mặc định (Toàn sơ đồ)' };
  };

  interface DomainBucket {
    domainId: string;
    domainLabel: string;
    upsAssets: DeviceAsset[];
    upsActiveWattsList: number[];
    installedCapacityWatts: number;
    loadWatts: number;
    deviceCount: number;
    firstTargetNodeId: string;
  }

  const domainBuckets = new Map<string, DomainBucket>();
  const ensureBucket = (domainId: string, domainLabel: string): DomainBucket => {
    let b = domainBuckets.get(domainId);
    if (!b) {
      b = {
        domainId,
        domainLabel,
        upsAssets: [],
        upsActiveWattsList: [],
        installedCapacityWatts: 0,
        loadWatts: 0,
        deviceCount: 0,
        firstTargetNodeId: ''
      };
      domainBuckets.set(domainId, b);
    }
    return b;
  };

  const upsDomainByUpsId = new Map<string, { id: string; label: string }>();
  const floorDomainsWithUps = new Set<string>();
  const rackDomainsWithUps = new Set<string>();

  for (const ups of upsAssets) {
    const dom = resolveDomainInfo(ups);
    upsDomainByUpsId.set(ups.id, dom);
    if (dom.id.startsWith('floor:')) floorDomainsWithUps.add(dom.id);
    if (dom.id.startsWith('rack:')) rackDomainsWithUps.add(dom.id);

    const firstNode = firstNodeByAssetId.get(ups.id);
    const resolvedPower = resolveUpsActiveWatts(ups);
    const bucket = ensureBucket(dom.id, dom.label);
    bucket.upsAssets.push(ups);
    bucket.upsActiveWattsList.push(resolvedPower.activeWatts);
    bucket.installedCapacityWatts += resolvedPower.activeWatts;
    if (!bucket.firstTargetNodeId && firstNode?.id) {
      bucket.firstTargetNodeId = firstNode.id;
    }

    if (resolvedPower.hasInvalidSpecs) {
      issues.push({
        id: `ups_invalid_specs_${ups.id}`,
        severity: 'warning',
        category: 'power',
        title: `Thông số công suất UPS không nhất quán: ${ups.name}`,
        description: `${resolvedPower.invalidReason}. Hệ thống sử dụng ${resolvedPower.activeWatts}W (S×PF) để kiểm tra an toàn.`,
        targetType: 'node',
        targetId: firstNode?.id || ''
      });
    }

    if (resolvedPower.activeWatts <= 0) {
      issues.push({
        id: `ups_missing_capacity_${ups.id}`,
        severity: 'warning',
        category: 'power',
        title: `UPS chưa khai báo công suất định mức: ${ups.name}`,
        description: `UPS "${ups.name}" đang có công suất 0W nên không được tính vào khả năng cấp tải dự phòng.`,
        targetType: 'node',
        targetId: firstNode?.id || ''
      });
    }

    const upsSpecs = ups.upsSpecs;
    if (!(upsSpecs && upsSpecs.batteryAh > 0 && upsSpecs.batteryVoltageV > 0 && upsSpecs.batteryCount > 0)) {
      issues.push({
        id: `ups_missing_battery_specs_${ups.id}`,
        severity: 'warning',
        category: 'power',
        title: `UPS chưa khai báo thông số ắc quy: ${ups.name}`,
        description: `Cần nhập dung lượng (Ah), điện áp (V) và số bình ắc quy cho UPS "${ups.name}" để tính chính xác thời gian lưu điện.`,
        targetType: 'node',
        targetId: firstNode?.id || ''
      });
    }
  }

  let totalPowerWatts = 0;
  for (const a of assets) {
    if (a.category === 'ups') continue;
    const w =
      typeof a.powerWatts === 'number' && Number.isFinite(a.powerWatts) ? Math.max(0, a.powerWatts) : 0;
    totalPowerWatts += w;

    // Resolve power domain for load device (feeder link > explicit domain > rack UPS > floor UPS > fallback)
    let dom: { id: string; label: string } | undefined;
    const feederUpsIds = fedUpsIdsByAssetId.get(a.id);
    if (feederUpsIds && feederUpsIds.size > 0) {
      const primaryUpsId = Array.from(feederUpsIds)[0];
      dom = upsDomainByUpsId.get(primaryUpsId);
    }
    if (!dom) {
      const explicitDom = (a.powerDomain || '').trim();
      if (explicitDom) {
        dom = { id: `domain:${explicitDom}`, label: `Miền điện: ${explicitDom}` };
      } else if (a.rackId && rackDomainsWithUps.has(`rack:${a.rackId}`)) {
        dom = {
          id: `rack:${a.rackId}`,
          label: rackMap.get(a.rackId)?.name || a.rackId
        };
      } else {
        const fId = a.floorId || firstNodeByAssetId.get(a.id)?.floorId;
        if (fId && floorDomainsWithUps.has(`floor:${fId}`)) {
          dom = { id: `floor:${fId}`, label: floorMap.get(fId)?.name || fId };
        } else {
          dom = resolveDomainInfo(a);
        }
      }
    }

    const bucket = ensureBucket(dom.id, dom.label);
    bucket.loadWatts += w;
    bucket.deviceCount += 1;
    if (!bucket.firstTargetNodeId) {
      const fn = firstNodeByAssetId.get(a.id);
      if (fn?.id) bucket.firstTargetNodeId = fn.id;
    }
  }

  let upsCapacityWatts = 0;
  const activeDomainRuntimes: number[] = [];
  const powerDomains: UpsPowerDomainAudit[] = [];

  for (const bucket of domainBuckets.values()) {
    const hasNPlus1 =
      bucket.upsAssets.length >= 2 &&
      bucket.upsAssets.some(u => u.upsSpecs?.redundancyMode === 'n_plus_1');
    const hasParallel =
      bucket.upsAssets.length >= 2 &&
      bucket.upsAssets.some(u => u.upsSpecs?.redundancyMode === 'parallel');
    const redundancyMode: UpsPowerDomainAudit['redundancyMode'] = hasNPlus1
      ? 'n_plus_1'
      : hasParallel
      ? 'parallel'
      : 'standalone';

    let effectiveCapacityWatts = bucket.installedCapacityWatts;
    if (redundancyMode === 'n_plus_1') {
      const maxSingle = Math.max(0, ...bucket.upsActiveWattsList);
      effectiveCapacityWatts = Math.max(0, bucket.installedCapacityWatts - maxSingle);
    }

    upsCapacityWatts += effectiveCapacityWatts;

    // Aggregate battery banks for this domain & apply Peukert runtime against domain's real loadWatts
    let domainTotalRawWh = 0;
    let effWeighted = 0;
    let dodWeighted = 0;
    let batteryBankCount = 0;
    let singleUpsSpecs: DeviceAsset['upsSpecs'] | undefined;

    for (const u of bucket.upsAssets) {
      const sp = u.upsSpecs;
      if (sp && sp.batteryAh > 0 && sp.batteryVoltageV > 0 && sp.batteryCount > 0) {
        const rawWh = sp.batteryAh * sp.batteryVoltageV * sp.batteryCount;
        domainTotalRawWh += rawWh;
        effWeighted += rawWh * (sp.inverterEfficiency ?? 0.85);
        dodWeighted += rawWh * (sp.dodFactor ?? 0.8);
        batteryBankCount += 1;
        singleUpsSpecs = sp;
      }
    }

    let domainRuntimeMinutes = 0;
    if (bucket.loadWatts > 0 && domainTotalRawWh > 0) {
      if (batteryBankCount === 1 && singleUpsSpecs) {
        domainRuntimeMinutes = computeUpsBatteryRuntime({
          totalLoadWatts: bucket.loadWatts,
          batteryAh: singleUpsSpecs.batteryAh,
          batteryVoltageV: singleUpsSpecs.batteryVoltageV,
          batteryCount: singleUpsSpecs.batteryCount,
          inverterEfficiency: singleUpsSpecs.inverterEfficiency,
          dodFactor: singleUpsSpecs.dodFactor
        }).runtimeMinutes;
      } else {
        domainRuntimeMinutes = computeUpsBatteryRuntime({
          totalLoadWatts: bucket.loadWatts,
          batteryAh: domainTotalRawWh / 12,
          batteryVoltageV: 12,
          batteryCount: 1,
          inverterEfficiency: effWeighted / domainTotalRawWh,
          dodFactor: dodWeighted / domainTotalRawWh
        }).runtimeMinutes;
      }
      if (domainRuntimeMinutes > 0) {
        activeDomainRuntimes.push(domainRuntimeMinutes);
      }
    }

    const utilizationPct =
      effectiveCapacityWatts > 0 ? Math.round((bucket.loadWatts / effectiveCapacityWatts) * 100) : null;

    let domainStatus: UpsPowerDomainAudit['status'] = 'adequate';
    if (bucket.upsAssets.length === 0) {
      domainStatus = 'no_ups';
    } else if (bucket.loadWatts === 0) {
      domainStatus = 'idle';
    } else if (effectiveCapacityWatts > 0 && bucket.loadWatts > effectiveCapacityWatts) {
      domainStatus = 'overload';
    } else if (effectiveCapacityWatts > 0 && bucket.loadWatts > effectiveCapacityWatts * 0.85) {
      domainStatus = 'warning';
    }

    if (bucket.upsAssets.length > 0 && effectiveCapacityWatts > 0 && bucket.loadWatts > effectiveCapacityWatts * 0.85) {
      const isOverload = bucket.loadWatts > effectiveCapacityWatts;
      const scopeHint =
        bucket.domainId === 'default' ? '' : ` [${bucket.domainLabel}]`;
      issues.push({
        id: `ups_overload_${bucket.domainId}`,
        severity: isOverload ? 'error' : 'warning',
        category: 'power',
        title: isOverload
          ? `Quá tải công suất UPS${scopeHint}`
          : `Tải UPS vượt ngưỡng an toàn 85%${scopeHint}`,
        description: `Phụ tải trong miền ${bucket.domainLabel} đạt ${bucket.loadWatts}W vượt ${isOverload ? 'công suất khả dụng' : 'ngưỡng 85%'} (${effectiveCapacityWatts}W${redundancyMode !== 'standalone' ? ` · dự phòng ${redundancyMode.toUpperCase()}` : ''}).`,
        targetType: bucket.firstTargetNodeId ? 'node' : 'rack',
        targetId: bucket.firstTargetNodeId || project.racks[0]?.id || ''
      });
    }

    if (bucket.upsAssets.length > 0 || bucket.loadWatts > 0) {
      powerDomains.push({
        domainId: bucket.domainId,
        domainLabel: bucket.domainLabel,
        upsAssetIds: bucket.upsAssets.map(u => u.id),
        upsNames: bucket.upsAssets.map(u => u.name),
        installedCapacityWatts: bucket.installedCapacityWatts,
        effectiveCapacityWatts,
        redundancyMode,
        loadWatts: bucket.loadWatts,
        deviceCount: bucket.deviceCount,
        utilizationPct,
        runtimeMinutes: domainRuntimeMinutes,
        status: domainStatus
      });
    }
  }

  const poeSummary = computeProjectPoeSummary(project);
  const totalPoeWattsEstimate = poeSummary.totalPoeWatts;

  if (poeSummary.status === 'overload') {
    const primaryPse = poeSummary.pseDevices[0];
    issues.push({
      id: 'poe_budget_overload',
      severity: 'error',
      category: 'power',
      title: 'Quá tải ngân sách nguồn PoE',
      description: `Tổng tiêu thụ PoE (${poeSummary.totalPoeWatts}W từ ${poeSummary.poweredDeviceCount} thiết bị) vượt ngân sách PSE khả dụng (${poeSummary.totalPoeBudgetWatts}W).`,
      targetType: 'node',
      targetId: primaryPse?.nodeId || ''
    });
  } else if (poeSummary.status === 'no_pse') {
    issues.push({
      id: 'poe_missing_pse',
      severity: 'warning',
      category: 'power',
      title: 'Chưa có thiết bị cấp nguồn PoE (Switch/NVR)',
      description: `Dự án có ${poeSummary.poweredDeviceCount} thiết bị dùng nguồn PoE (${poeSummary.totalPoeWatts}W) nhưng chưa khai báo Switch PoE hoặc NVR PoE.`,
      targetType: 'node',
      targetId: poeSummary.devices[0]?.nodeId || ''
    });
  }

  // Per-switch PoE allocation & overload check
  const switchPoeBreakdown = computeSwitchPoeBreakdown(project);
  for (const sw of switchPoeBreakdown.switches) {
    if (sw.status === 'overload') {
      issues.push({
        id: `poe_switch_overload_${sw.assetId}`,
        severity: 'error',
        category: 'power',
        title: `Quá tải PoE trên ${sw.name}`,
        description: `${sw.name} đang cấp ${sw.consumedWatts}W cho ${sw.connectedPds.length} thiết bị PoE, vượt ngân sách ${sw.budgetWatts}W.`,
        targetType: 'node',
        targetId: sw.nodeId || ''
      });
    } else if (sw.status === 'warning') {
      issues.push({
        id: `poe_switch_warning_${sw.assetId}`,
        severity: 'warning',
        category: 'power',
        title: `PoE gần ngưỡng tải trên ${sw.name} (${sw.utilizationPct}%)`,
        description: `${sw.name} đang dùng ${sw.consumedWatts}W/${sw.budgetWatts}W (${sw.utilizationPct}%).`,
        targetType: 'node',
        targetId: sw.nodeId || ''
      });
    }
  }

  // 7. Subnet & VLAN Directory Validation
  const subnets = project.subnets || [];
  const vlans = project.vlans || [];
  const validSubnets: Array<{ spec: (typeof subnets)[number]; range: CidrRange }> = [];

  for (const sub of subnets) {
    const parsed = parseCidrRange(sub.cidr);
    if (!parsed) {
      issues.push({
        id: `invalid_cidr_${sub.id}`,
        severity: 'error',
        category: 'ip',
        title: `CIDR không hợp lệ: ${sub.cidr}`,
        description: `Subnet "${sub.name}" có định dạng CIDR không hợp lệ (ví dụ đúng: 10.10.20.0/24).`,
        targetType: 'node',
        targetId: ''
      });
    } else {
      validSubnets.push({ spec: sub, range: parsed });
    }
  }

  for (let i = 0; i < validSubnets.length; i++) {
    for (let j = i + 1; j < validSubnets.length; j++) {
      if (doCidrsOverlap(validSubnets[i].spec.cidr, validSubnets[j].spec.cidr)) {
        issues.push({
          id: `overlap_cidr_${validSubnets[i].spec.id}_${validSubnets[j].spec.id}`,
          severity: 'error',
          category: 'ip',
          title: `Chồng dải Subnet: ${validSubnets[i].spec.cidr} ↔ ${validSubnets[j].spec.cidr}`,
          description: `Hai Subnet "${validSubnets[i].spec.name}" và "${validSubnets[j].spec.name}" có dải địa chỉ IP trùng lặp.`,
          targetType: 'node',
          targetId: ''
        });
      }
    }
  }

  if (validSubnets.length > 0) {
    for (const a of assets) {
      const ip = (a.ipAddress || '').trim();
      if (!ip || ip === '0.0.0.0' || ip.toLowerCase() === 'dhcp' || parseIpv4ToInt(ip) === null) continue;
      const matchingSubnet = validSubnets.find(s => isIpInCidr(ip, s.spec.cidr));
      const firstNode = project.nodes.find(n => n.assetId === a.id);
      if (!matchingSubnet) {
        issues.push({
          id: `ip_outside_subnet_${a.id}`,
          severity: 'warning',
          category: 'ip',
          title: `IP ngoài danh bạ Subnet: ${a.name} (${ip})`,
          description: `Thiết bị ${a.name} có IP ${ip} không thuộc bất kỳ dải CIDR nào đã khai báo trong Danh bạ Subnet.`,
          targetType: 'node',
          targetId: firstNode?.id || ''
        });
      } else if (matchingSubnet.spec.vlanId !== undefined && a.vlan) {
        const assetVlanNums = a.vlan
          .split(',')
          .map(v => Number(v.trim()))
          .filter(n => Number.isFinite(n) && n > 0);
        if (assetVlanNums.length === 1 && assetVlanNums[0] !== matchingSubnet.spec.vlanId) {
          issues.push({
            id: `ip_vlan_subnet_mismatch_${a.id}`,
            severity: 'error',
            category: 'vlan',
            title: `Lệch Subnet–VLAN: ${a.name}`,
            description: `IP ${ip} thuộc Subnet "${matchingSubnet.spec.name}" (VLAN ${matchingSubnet.spec.vlanId}) nhưng thiết bị gán VLAN ${assetVlanNums[0]}.`,
            targetType: 'node',
            targetId: firstNode?.id || ''
          });
        }
      }
    }
  }

  if (vlans.length > 0) {
    const declaredVlanSet = new Set(vlans.map(v => String(v.vlanId)));
    for (const a of assets) {
      const rawVlans = (a.vlan || '').split(',').map(v => v.trim()).filter(Boolean);
      const undeclared = rawVlans.filter(v => /^\d+$/.test(v) && !declaredVlanSet.has(v));
      if (undeclared.length > 0) {
        const firstNode = project.nodes.find(n => n.assetId === a.id);
        issues.push({
          id: `undeclared_vlan_${a.id}`,
          severity: 'warning',
          category: 'vlan',
          title: `VLAN chưa khai báo: VLAN ${undeclared.join(', ')} (${a.name})`,
          description: `Thiết bị ${a.name} sử dụng VLAN ${undeclared.join(', ')} chưa có trong Danh bạ VLAN của dự án.`,
          targetType: 'node',
          targetId: firstNode?.id || ''
        });
      }
    }
  }

  // 8. Trustworthy L2 Switching Loop Detection
  const l2Loops = detectL2SwitchingLoops(project);
  for (const loop of l2Loops) {
    if (loop.status === 'protected_redundancy') continue;
    const isSuspected = loop.status === 'suspected_loop';
    issues.push({
      id: `l2_loop_${loop.kind}_${loop.nodeIds.join('_')}`,
      severity: isSuspected ? 'error' : 'warning',
      category: 'connectivity',
      title: isSuspected
        ? `Vòng lặp L2 chưa có chống lặp: ${loop.cycleLabels.join(' ↔ ')}`
        : `Chưa xác minh chống lặp L2 (chỉ có ghi chú chữ): ${loop.cycleLabels.join(' ↔ ')}`,
      description: loop.reason,
      targetType: 'node',
      targetId: loop.nodeIds[0] || ''
    });
  }

  const estimatedCurrentAmps220V = Number((totalPowerWatts / (220 * 0.85)).toFixed(1));
  const estimatedUpsRuntimeMinutes =
    activeDomainRuntimes.length > 0 ? Math.min(...activeDomainRuntimes) : 0;

  return {
    issues,
    powerDomains,
    summary: {
      totalDevices: assets.length,
      totalCables: project.cables.length,
      totalPowerWatts,
      estimatedCurrentAmps220V,
      totalPoeWattsEstimate,
      upsCapacityWatts,
      estimatedUpsRuntimeMinutes,
      errorCount: issues.filter(i => i.severity === 'error').length,
      warningCount: issues.filter(i => i.severity === 'warning').length
    }
  };
}

/**
 * Generates a sorted IP/VLAN plan matrix from all project assets.
 */
export function buildIpVlanMatrix(project: ProjectState): IpVlanMatrixRow[] {
  const { assets } = getActiveProjectAssets(project);
  const ipCounts = new Map<string, number>();
  assets.forEach(a => {
    const ip = (a.ipAddress || '').trim();
    if (ip) ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
  });

  return assets
    .map(a => {
      const node = project.nodes.find(n => n.assetId === a.id);
      const rack = project.racks.find(r => r.id === a.rackId);
      return {
        assetId: a.id,
        nodeId: node?.id,
        name: a.name,
        category: a.category,
        ipAddress: a.ipAddress || '—',
        subnetMask: a.subnetMask || '—',
        gateway: a.gateway || '—',
        vlan: a.vlan || '—',
        macAddress: a.macAddress || '—',
        rackLocation: rack && a.rackUnitStart ? `${rack.name} · U${a.rackUnitStart}` : '—',
        duplicateIp: Boolean(a.ipAddress && (ipCounts.get(a.ipAddress.trim()) || 0) > 1)
      };
    })
    .sort((a, b) => a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }));
}

/**
 * Generates unified Patch Panel & Cable Schedule rows from canvas cables + manual PatchLink mappings.
 */
export function buildPatchAndCableSchedule(project: ProjectState): PatchScheduleRow[] {
  const nodeMap = new Map(project.nodes.map(n => [n.id, n]));
  const roomMap = new Map(project.rooms.map(r => [r.id, r]));

  const cableRows: PatchScheduleRow[] = project.cables.map(c => {
    const srcNode = nodeMap.get(c.sourceNodeId);
    const tgtNode = nodeMap.get(c.targetNodeId);
    const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;
    const room = tgtAsset?.roomId ? roomMap.get(tgtAsset.roomId) : srcAsset?.roomId ? roomMap.get(srcAsset.roomId) : undefined;

    return {
      id: c.id,
      sourceKind: 'cable',
      cableCode: c.cableCode,
      patchPanelOrSource: srcAsset?.name || srcNode?.label || c.sourceNodeId,
      sourcePort: c.sourcePortId || 'Auto',
      targetDevice: tgtAsset?.name || tgtNode?.label || c.targetNodeId,
      targetPort: c.targetPortId || 'Auto',
      cableType: c.cableType,
      bandwidth: c.bandwidth,
      lengthMeters: c.lengthMeters || 0,
      vlan: c.vlan || tgtAsset?.vlan || srcAsset?.vlan || '—',
      roomName: room?.name || '—',
      status: c.status,
      notes: c.notes || c.label || ''
    };
  });

  const patchRows: PatchScheduleRow[] = (project.patchLinks || []).map(p => {
    const panelAsset = project.assets[p.patchPanelAssetId];
    return {
      id: p.id,
      sourceKind: 'manual_patch',
      cableCode: p.cableCode || 'PATCH',
      patchPanelOrSource: panelAsset?.name || p.patchPanelAssetId,
      sourcePort: p.patchPort,
      targetDevice: p.targetDeviceName,
      targetPort: p.targetPort || 'Wall-Jack',
      cableType: 'CAT6A_STP',
      bandwidth: '1G',
      lengthMeters: 0,
      vlan: p.vlan || panelAsset?.vlan || '—',
      roomName: p.roomName || '—',
      status: 'active',
      notes: p.notes || ''
    };
  });

  return [...cableRows, ...patchRows].sort((a, b) =>
    a.cableCode.localeCompare(b.cableCode, undefined, { numeric: true })
  );
}

function escapeCsvCell(val: string | number): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatScheduleCsv(rows: PatchScheduleRow[]): string {
  const header = [
    'Ma Cap',
    'Nguon / Patch Panel',
    'Cong Nguon',
    'Thiet Bi Dich',
    'Cong Dich',
    'Loai Cap',
    'Bang Thong',
    'Chieu Dai (m)',
    'VLAN',
    'Phong / Khu Vuc',
    'Trang Thai',
    'Ghi Chu'
  ].join(',');
  const lines = rows.map(r =>
    [
      r.cableCode,
      r.patchPanelOrSource,
      r.sourcePort,
      r.targetDevice,
      r.targetPort,
      r.cableType,
      r.bandwidth,
      r.lengthMeters,
      r.vlan,
      r.roomName,
      r.status,
      r.notes
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return [header, ...lines].join('\n');
}

export interface BulkStaticIpCsvResult {
  updatedAssets: Record<string, ProjectState['assets'][string]>;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
}

/**
 * E3: Parses bulk static IP CSV lines (`target,ipAddress,subnetMask,gateway,vlan`) and updates matching project assets.
 * `target` matches asset name, assetTag, or existing ipAddress (case-insensitive).
 */
export function parseAndApplyBulkStaticIpsCsv(
  csvText: string,
  project: ProjectState
): BulkStaticIpCsvResult {
  const nextAssets: Record<string, ProjectState['assets'][string]> = { ...project.assets };
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { updatedAssets: nextAssets, updatedCount: 0, skippedCount: 0, errors: ['Nội dung CSV trống.'] };
  }

  const errors: string[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  const assetList = Object.values(nextAssets);
  const startIdx = /^(name|ten|thiet|device|asset|target)/i.test(lines[0]) ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(/[,\t;]/).map(c => c.trim().replace(/^"|"$/g, ''));
    const [targetKey, newIp, mask, gateway, vlan] = cols;
    if (!targetKey || !newIp) {
      skippedCount++;
      continue;
    }
    if (parseIpv4ToInt(newIp) === null) {
      errors.push(`Dòng ${i + 1}: IP "${newIp}" không hợp lệ.`);
      skippedCount++;
      continue;
    }

    const needle = targetKey.toLowerCase();
    const matched = assetList.find(
      a =>
        a.name.toLowerCase() === needle ||
        a.assetTag.toLowerCase() === needle ||
        (a.ipAddress || '').toLowerCase() === needle
    );

    if (!matched) {
      errors.push(`Dòng ${i + 1}: Không tìm thấy thiết bị "${targetKey}".`);
      skippedCount++;
      continue;
    }

    nextAssets[matched.id] = {
      ...nextAssets[matched.id],
      ipAddress: newIp,
      ...(mask ? { subnetMask: mask } : {}),
      ...(gateway ? { gateway } : {}),
      ...(vlan ? { vlan } : {})
    };
    updatedCount++;
  }

  return {
    updatedAssets: nextAssets,
    updatedCount,
    skippedCount,
    errors
  };
}

export type WallMaterialType = 'concrete' | 'brick' | 'drywall' | 'glass' | 'wood';

export const WALL_ATTENUATION_DB: Record<WallMaterialType, number> = {
  concrete: 12,
  brick: 8,
  drywall: 3,
  glass: 2,
  wood: 4
};

export interface WallSegment2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: WallMaterialType;
  opaque?: boolean;
}

function segmentsIntersect2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const ccw = (p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number) =>
    (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
  return (
    ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
  );
}

/**
 * E6: Collects architectural wall segments from rooms & explicit `wall` nodes on a floor.
 */
export function collectFloorWallSegments(project: ProjectState, floorId?: string): WallSegment2D[] {
  const segments: WallSegment2D[] = [];
  for (const room of project.rooms) {
    if (floorId && room.floorId !== floorId) continue;
    const mat: WallMaterialType = room.type === 'server_room' ? 'concrete' : 'brick';
    const x1 = room.x;
    const y1 = room.y;
    const x2 = room.x + room.width;
    const y2 = room.y + room.height;
    segments.push(
      { x1, y1, x2, y2: y1, material: mat, opaque: true },
      { x1: x2, y1, x2, y2, material: mat, opaque: true },
      { x1: x2, y1: y2, x2: x1, y2, material: mat, opaque: true },
      { x1, y1: y2, x2: x1, y2: y1, material: mat, opaque: true }
    );
  }
  for (const n of project.nodes) {
    if (n.type !== 'wall') continue;
    if (floorId && n.floorId && n.floorId !== floorId) continue;
    const mat = ((n.customData?.wallMaterial as string) || 'concrete') as WallMaterialType;
    const resolvedMat: WallMaterialType = mat in WALL_ATTENUATION_DB ? mat : 'concrete';
    const isHoriz = n.width >= n.height;
    segments.push({
      x1: isHoriz ? n.x : n.x + n.width / 2,
      y1: isHoriz ? n.y + n.height / 2 : n.y,
      x2: isHoriz ? n.x + n.width : n.x + n.width / 2,
      y2: isHoriz ? n.y + n.height / 2 : n.y + n.height,
      material: resolvedMat,
      opaque: resolvedMat !== 'glass'
    });
  }
  return segments;
}

/**
 * E6: Evaluates wall crossings between two points for Wi-Fi attenuation (dB) and CCTV line-of-sight occlusion.
 */
export function computeSegmentWallCrossings(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  wallSegments: WallSegment2D[]
): {
  crossingCount: number;
  totalAttenuationDb: number;
  blockedLineOfSight: boolean;
} {
  let crossingCount = 0;
  let totalAttenuationDb = 0;
  let blockedLineOfSight = false;

  for (const wall of wallSegments) {
    if (segmentsIntersect2D(p1.x, p1.y, p2.x, p2.y, wall.x1, wall.y1, wall.x2, wall.y2)) {
      crossingCount++;
      totalAttenuationDb += WALL_ATTENUATION_DB[wall.material] ?? 8;
      if (wall.opaque !== false) {
        blockedLineOfSight = true;
      }
    }
  }

  return { crossingCount, totalAttenuationDb, blockedLineOfSight };
}

/**
 * E6: Estimates received Wi-Fi RSSI (dBm) at a target point accounting for free-space path loss + wall attenuation.
 */
export function estimateWifiRssiDbm(
  apCenter: { x: number; y: number },
  targetPoint: { x: number; y: number },
  txPowerDbm: number,
  pxPerMeter: number,
  wallSegments: WallSegment2D[]
): {
  distanceMeters: number;
  wallCrossings: number;
  wallLossDb: number;
  estimatedRssiDbm: number;
  signalQuality: 'excellent' | 'good' | 'fair' | 'weak';
} {
  const distPx = Math.hypot(targetPoint.x - apCenter.x, targetPoint.y - apCenter.y);
  const safeScale = normalizeScalePxPerMeter(pxPerMeter);
  const distanceMeters = Math.max(1, Math.round((distPx / safeScale) * 10) / 10);
  // Simplified indoor 5GHz path loss model: FSPL(1m) ~ 47 dB + 22 * log10(d)
  const pathLossDb = 47 + 22 * Math.log10(distanceMeters);
  const wallInfo = computeSegmentWallCrossings(apCenter, targetPoint, wallSegments);
  const estimatedRssiDbm = Math.round((txPowerDbm - pathLossDb - wallInfo.totalAttenuationDb) * 10) / 10;

  const signalQuality: 'excellent' | 'good' | 'fair' | 'weak' =
    estimatedRssiDbm >= -55
      ? 'excellent'
      : estimatedRssiDbm >= -67
      ? 'good'
      : estimatedRssiDbm >= -78
      ? 'fair'
      : 'weak';

  return {
    distanceMeters,
    wallCrossings: wallInfo.crossingCount,
    wallLossDb: wallInfo.totalAttenuationDb,
    estimatedRssiDbm,
    signalQuality
  };
}

