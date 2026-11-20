import { CableEdge, DeviceAsset, DevicePort, PortType } from '../types/infrastructure';

export type PortCompatibilityLevel = 'ok' | 'warning' | 'error';

export interface PortCompatibilityResult {
  compatible: boolean;
  level: PortCompatibilityLevel;
  reasons: string[];
  suggestedCableType?: CableEdge['cableType'];
}

export type PortMediaFamily = 'copper' | 'fiber' | 'power' | 'console';

export function getPortMediaFamily(portType: PortType): PortMediaFamily {
  switch (portType) {
    case 'POWER_C13':
      return 'power';
    case 'CONSOLE':
      return 'console';
    case 'SFP_PLUS_10G':
    case 'QSFP_40G':
    case 'QSFP28_100G':
    case 'FIBER_LC':
    case 'FIBER_SC':
      return 'fiber';
    case 'RJ45_1G':
    case 'RJ45_10G':
    default:
      return 'copper';
  }
}

export function getPortBandwidthGbps(port: Pick<DevicePort, 'type' | 'speed'>): number {
  const speedText = (port.speed || '').toUpperCase().trim();
  const match = speedText.match(/(\d+(?:\.\d+)?)\s*(G|M)/);
  if (match) {
    const val = Number(match[1]);
    if (Number.isFinite(val) && val > 0) {
      return match[2] === 'M' ? val / 1000 : val;
    }
  }
  if (port.type === 'QSFP28_100G') return 100;
  if (port.type === 'QSFP_40G') return 40;
  if (
    port.type === 'RJ45_10G' ||
    port.type === 'SFP_PLUS_10G' ||
    port.type === 'FIBER_LC' ||
    port.type === 'FIBER_SC'
  ) {
    return 10;
  }
  return 1;
}

function isPortOccupied(port: DevicePort): boolean {
  return port.status === 'up' || Boolean(port.connectedCableId) || Boolean(port.connectedTarget);
}

function resolveSuggestedCableType(
  sourcePort?: DevicePort,
  targetPort?: DevicePort
): CableEdge['cableType'] | undefined {
  if (!sourcePort && !targetPort) return 'CAT6_UTP';
  const ref = sourcePort || targetPort!;
  const family = getPortMediaFamily(ref.type);
  if (family === 'power') return 'POWER_AC';
  if (family === 'fiber') {
    if (ref.type === 'FIBER_SC' || ref.type === 'FIBER_LC') return 'FIBER_SM_OS2';
    return 'FIBER_MM_OM4';
  }
  const gbps = Math.min(
    sourcePort ? getPortBandwidthGbps(sourcePort) : 10,
    targetPort ? getPortBandwidthGbps(targetPort) : 10
  );
  return gbps >= 10 ? 'CAT6A_STP' : 'CAT6_UTP';
}

export function evaluatePortPairCompatibility(
  sourceAsset: Pick<DeviceAsset, 'id' | 'name'> | undefined,
  sourcePort: DevicePort | undefined,
  targetAsset: Pick<DeviceAsset, 'id' | 'name'> | undefined,
  targetPort: DevicePort | undefined
): PortCompatibilityResult {
  if (sourceAsset && targetAsset && sourceAsset.id === targetAsset.id) {
    return {
      compatible: false,
      level: 'error',
      reasons: ['Không thể nối dây cáp từ một thiết bị vào chính nó.']
    };
  }

  const errorReasons: string[] = [];
  const warningReasons: string[] = [];

  if (sourcePort && isPortOccupied(sourcePort)) {
    errorReasons.push(`Cổng nguồn ${sourcePort.name} đang được nối với tuyến cáp khác.`);
  }
  if (targetPort && isPortOccupied(targetPort)) {
    errorReasons.push(`Cổng đích ${targetPort.name} đang được nối với tuyến cáp khác.`);
  }

  if (sourcePort && targetPort) {
    const srcFamily = getPortMediaFamily(sourcePort.type);
    const tgtFamily = getPortMediaFamily(targetPort.type);

    if (srcFamily !== tgtFamily) {
      if (srcFamily === 'power' || tgtFamily === 'power') {
        errorReasons.push(
          `Không thể nối cổng nguồn AC (${sourcePort.type}) với cổng dữ liệu/điều khiển (${targetPort.type}).`
        );
      } else if (srcFamily === 'console' || tgtFamily === 'console') {
        errorReasons.push(
          `Cổng quản trị Console (${sourcePort.type === 'CONSOLE' ? sourcePort.name : targetPort.name}) chỉ nối với cổng Console tương ứng.`
        );
      } else {
        errorReasons.push(
          `Không tương thích vật lý: cổng ${srcFamily === 'copper' ? 'đồng RJ45' : 'quang SFP/Fiber'} (${sourcePort.name}) không thể nối trực tiếp với cổng ${tgtFamily === 'copper' ? 'đồng RJ45' : 'quang SFP/Fiber'} (${targetPort.name}).`
        );
      }
    } else if (srcFamily === 'fiber' && sourcePort.type !== targetPort.type) {
      const isPlugA = sourcePort.type === 'FIBER_LC' || sourcePort.type === 'FIBER_SC';
      const isPlugB = targetPort.type === 'FIBER_LC' || targetPort.type === 'FIBER_SC';
      if (isPlugA && isPlugB) {
        warningReasons.push(
          `Khác đầu nối quang (${sourcePort.type} ↔ ${targetPort.type}): cần dùng dây nhảy quang chuyển đầu LC–SC.`
        );
      }
    }

    if (errorReasons.length === 0 && (srcFamily === 'copper' || srcFamily === 'fiber')) {
      const srcGbps = getPortBandwidthGbps(sourcePort);
      const tgtGbps = getPortBandwidthGbps(targetPort);
      if (srcGbps !== tgtGbps) {
        const minGbps = Math.min(srcGbps, tgtGbps);
        warningReasons.push(
          `Chênh lệch tốc độ (${sourcePort.speed} ↔ ${targetPort.speed}): kết nối sẽ chạy ở mức ${minGbps >= 1 ? `${minGbps} Gbps` : `${Math.round(minGbps * 1000)} Mbps`}.`
        );
      }
    }
  }

  if (errorReasons.length > 0) {
    return {
      compatible: false,
      level: 'error',
      reasons: errorReasons
    };
  }

  const suggestedCableType = resolveSuggestedCableType(sourcePort, targetPort);

  if (warningReasons.length > 0) {
    return {
      compatible: true,
      level: 'warning',
      reasons: warningReasons,
      suggestedCableType
    };
  }

  return {
    compatible: true,
    level: 'ok',
    reasons: [],
    suggestedCableType
  };
}

export function pickBestCompatiblePortPair(
  sourcePorts: DevicePort[],
  targetPorts: DevicePort[]
): { sourcePortId?: string; targetPortId?: string } {
  const freeSrc = sourcePorts.filter(p => !isPortOccupied(p));
  const freeTgt = targetPorts.filter(p => !isPortOccupied(p));

  if (freeSrc.length === 0 && freeTgt.length === 0) {
    return {
      sourcePortId: sourcePorts[0]?.id,
      targetPortId: targetPorts[0]?.id
    };
  }

  if (freeSrc.length === 0) {
    return { sourcePortId: sourcePorts[0]?.id, targetPortId: freeTgt[0]?.id || targetPorts[0]?.id };
  }
  if (freeTgt.length === 0) {
    return { sourcePortId: freeSrc[0]?.id, targetPortId: targetPorts[0]?.id };
  }

  // Pass 1: exact ok match
  for (const s of freeSrc) {
    for (const t of freeTgt) {
      const res = evaluatePortPairCompatibility(undefined, s, undefined, t);
      if (res.level === 'ok') {
        return { sourcePortId: s.id, targetPortId: t.id };
      }
    }
  }

  // Pass 2: warning-level compatible match (e.g. 1G <-> 10G copper)
  for (const s of freeSrc) {
    for (const t of freeTgt) {
      const res = evaluatePortPairCompatibility(undefined, s, undefined, t);
      if (res.compatible) {
        return { sourcePortId: s.id, targetPortId: t.id };
      }
    }
  }

  return { sourcePortId: freeSrc[0]?.id, targetPortId: freeTgt[0]?.id };
}
