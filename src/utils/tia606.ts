import {
  CableEdge,
  CablePoint,
  ProjectState
} from '../types/infrastructure';
import {
  calculateTrayAwareCableLengthMeters,
  computeCablePath,
  type RectBox
} from './cableRouting';
import { computeProjectBomStats } from './bomAggregator';
import { getActiveProjectAssets } from './poeCalculator';

export { calculateTrayAwareCableLengthMeters };

function sanitizeToken(raw: string, fallback: string, maxLen = 8): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return (cleaned || fallback).slice(0, maxLen);
}

/**
 * Generates a standardized TIA/EIA-606-B cable identifier:
 * Format: [Floor].[Room].[Rack].[SrcDevice].[SrcPort]-[DstDevice].[DstPort]
 */
export function generateTia606CableCode(cable: CableEdge, project: ProjectState): string {
  const srcNode = project.nodes.find(n => n.id === cable.sourceNodeId);
  const tgtNode = project.nodes.find(n => n.id === cable.targetNodeId);

  const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
  const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;

  const floorObj = project.floors.find(f => f.id === (srcAsset?.floorId || srcNode?.floorId || project.activeFloorId));
  const floorCode = floorObj
    ? floorObj.level < 0
      ? `B${Math.abs(floorObj.level)}`
      : `F${String(floorObj.level).padStart(2, '0')}`
    : 'F01';

  const roomObj = project.rooms.find(r => r.id === srcAsset?.roomId);
  const roomCode = roomObj ? sanitizeToken(roomObj.name, 'RM', 5) : 'ZONE';

  const rackObj = project.racks.find(r => r.id === srcAsset?.rackId);
  const rackCode = rackObj ? sanitizeToken(rackObj.name, 'RK01', 6) : 'TR01';

  const srcDevCode = sanitizeToken(srcAsset?.name || srcNode?.label || 'SRC', 'SRC', 8);
  const tgtDevCode = sanitizeToken(tgtAsset?.name || tgtNode?.label || 'DST', 'DST', 8);

  const srcPort = sanitizeToken(cable.sourcePortId || 'P1', 'P1', 5);
  const tgtPort = sanitizeToken(cable.targetPortId || 'P1', 'P1', 5);

  return `${floorCode}.${roomCode}.${rackCode}.${srcDevCode}.${srcPort}-${tgtDevCode}.${tgtPort}`;
}

/**
 * Applies TIA/EIA-606-B cable labeling across all cables in a project.
 */
export function applyTia606LabelsToProject(project: ProjectState): CableEdge[] {
  return project.cables.map(cable => {
    const code = generateTia606CableCode(cable, project);
    return {
      ...cable,
      cableCode: code,
      label: code
    };
  });
}


/**
 * Computes parallel bundle offsets (px) for cables sharing identical or near-parallel corridors
 * so parallel runs fan out cleanly instead of stacking visually on top of one another.
 */
export function computeCableBundleOffsets(
  cables: CableEdge[],
  getRect: (nodeId: string) => RectBox | null,
  spacingPx = 6
): Map<string, number> {
  const groups = new Map<string, CableEdge[]>();

  cables.forEach(c => {
    const r1 = getRect(c.sourceNodeId);
    const r2 = getRect(c.targetNodeId);
    if (!r1 || !r2) return;
    // Bucket corridor signature by unordered rounded endpoint grid (40px grid)
    const ax = Math.round((r1.x + r1.width / 2) / 40);
    const ay = Math.round((r1.y + r1.height / 2) / 40);
    const bx = Math.round((r2.x + r2.width / 2) / 40);
    const by = Math.round((r2.y + r2.height / 2) / 40);
    const keyA = `${ax},${ay}`;
    const keyB = `${bx},${by}`;
    const corridorKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    const list = groups.get(corridorKey) || [];
    list.push(c);
    groups.set(corridorKey, list);
  });

  const offsets = new Map<string, number>();
  groups.forEach(list => {
    if (list.length <= 1) {
      if (list[0]) offsets.set(list[0].id, 0);
      return;
    }
    const mid = (list.length - 1) / 2;
    list.forEach((c, idx) => {
      offsets.set(c.id, Number(((idx - mid) * spacingPx).toFixed(1)));
    });
  });

  return offsets;
}

/**
 * Applies a subtle perpendicular lateral offset to a cable's computed path when bundled.
 */
export function computeBundledCablePath(
  cable: CableEdge,
  r1: RectBox,
  r2: RectBox,
  bundleOffsetPx = 0
) {
  if (!bundleOffsetPx || (cable.controlPoints && cable.controlPoints.length > 0)) {
    return computeCablePath(cable, r1, r2);
  }
  const cx1 = r1.x + r1.width / 2;
  const cy1 = r1.y + r1.height / 2;
  const cx2 = r2.x + r2.width / 2;
  const cy2 = r2.y + r2.height / 2;
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = (-dy / len) * bundleOffsetPx;
  const ny = (dx / len) * bundleOffsetPx;

  return computeCablePath(
    cable,
    { ...r1, x: r1.x + nx, y: r1.y + ny },
    { ...r2, x: r2.x + nx, y: r2.y + ny }
  );
}

export interface BomCostItem {
  code: string;
  category: 'Cáp & Vật Tư' | 'Máng & Ống Gen' | 'Nhân Công TCVN';
  name: string;
  unit: string;
  quantity: number;
  unitPriceVnd: number;
  totalVnd: number;
  note: string;
}

export interface BomCostSummary {
  items: BomCostItem[];
  materialTotalVnd: number;
  laborTotalVnd: number;
  grandTotalVnd: number;
}

/**
 * Estimates full TCVN Bill of Quantities (Materials + Construction Labor) in VND
 * for project tendering and Excel BOQ export.
 */
export function estimateBomWithLabor(project: ProjectState): BomCostSummary {
  const items: BomCostItem[] = [];
  const bom = computeProjectBomStats(project);

  const rowByType = new Map(bom.cableRows.map(r => [r.cableType, r]));
  const cat6Meters = Math.round((rowByType.get('CAT6_UTP')?.totalWithReserveMeters || 0) * 10) / 10;
  const cat6aMeters = Math.round((rowByType.get('CAT6A_STP')?.totalWithReserveMeters || 0) * 10) / 10;
  const fiberMeters =
    Math.round(
      ((rowByType.get('FIBER_SM_OS2')?.totalWithReserveMeters || 0) +
        (rowByType.get('FIBER_MM_OM4')?.totalWithReserveMeters || 0)) *
        10
    ) / 10;
  const powerMeters = Math.round((rowByType.get('POWER_AC')?.totalWithReserveMeters || 0) * 10) / 10;
  const dacCount = rowByType.get('DAC_10G')?.count || 0;

  if (cat6Meters > 0) {
    const row = rowByType.get('CAT6_UTP');
    const unitPrice = row?.unitPriceVnd || 12500;
    items.push({
      code: 'VT-CAT6',
      category: 'Cáp & Vật Tư',
      name: 'Cáp mạng Cat6 UTP 4-pair (LS/AMP chính hãng)',
      unit: 'Mét',
      quantity: cat6Meters,
      unitPriceVnd: unitPrice,
      totalVnd: Math.round(cat6Meters * unitPrice),
      note: `Gồm dây dư đấu nối & hao hụt ${bom.assumptions.copperLossPct}%`
    });
  }
  if (cat6aMeters > 0) {
    const row = rowByType.get('CAT6A_STP');
    const unitPrice = row?.unitPriceVnd || 24000;
    items.push({
      code: 'VT-CAT6A',
      category: 'Cáp & Vật Tư',
      name: 'Cáp mạng chống nhiễu Cat6A STP 10G',
      unit: 'Mét',
      quantity: cat6aMeters,
      unitPriceVnd: unitPrice,
      totalVnd: Math.round(cat6aMeters * unitPrice),
      note: `Cho đường trục Uplink / Wi-Fi 6 (gồm hao hụt ${bom.assumptions.copperLossPct}%)`
    });
  }
  if (fiberMeters > 0) {
    const smRow = rowByType.get('FIBER_SM_OS2');
    const mmRow = rowByType.get('FIBER_MM_OM4');
    const unitPrice = smRow?.unitPriceVnd || mmRow?.unitPriceVnd || 18000;
    const totalFiberVnd = Math.round((smRow?.totalPriceVnd || 0) + (mmRow?.totalPriceVnd || 0)) || Math.round(fiberMeters * unitPrice);
    items.push({
      code: 'VT-FO',
      category: 'Cáp & Vật Tư',
      name: 'Cáp quang Single-mode / Multi-mode Indoor-Outdoor',
      unit: 'Mét',
      quantity: fiberMeters,
      unitPriceVnd: unitPrice,
      totalVnd: totalFiberVnd,
      note: `Trục đứng Riser & liên tầng (gồm hao hụt ${bom.assumptions.fiberLossPct}%)`
    });
  }
  if (powerMeters > 0) {
    const row = rowByType.get('POWER_AC');
    const unitPrice = row?.unitPriceVnd || 32000;
    items.push({
      code: 'VT-PWR',
      category: 'Cáp & Vật Tư',
      name: 'Cáp điện Cadivi Cu/PVC/PVC 3x2.5mm²',
      unit: 'Mét',
      quantity: powerMeters,
      unitPriceVnd: unitPrice,
      totalVnd: Math.round(powerMeters * unitPrice),
      note: 'Cấp nguồn UPS / Tủ Rack'
    });
  }
  if (dacCount > 0) {
    const row = rowByType.get('DAC_10G');
    const unitPrice = row?.unitPriceVnd || 650000;
    items.push({
      code: 'VT-DAC10G',
      category: 'Cáp & Vật Tư',
      name: 'Cáp DAC 10G SFP+ Twinax Passive',
      unit: 'Sợi',
      quantity: dacCount,
      unitPriceVnd: unitPrice,
      totalVnd: Math.round(dacCount * unitPrice),
      note: 'Đấu nối nội tủ Rack / Switch Stack'
    });
  }

  // Cable Trays & Conduits length reconciled with computeProjectBomStats
  const accTray = bom.inferredAccessories.find(a => a.id === 'acc_tray_straight');
  const accConduit = bom.inferredAccessories.find(a => a.id === 'acc_conduit_pvc');
  const trayMeters = accTray ? accTray.orderQty : 0;
  const conduitMeters = accConduit ? accConduit.orderQty : 0;

  if (trayMeters > 0 && accTray) {
    items.push({
      code: 'MG-TRAY',
      category: 'Máng & Ống Gen',
      name: accTray.name,
      unit: accTray.unit,
      quantity: trayMeters,
      unitPriceVnd: accTray.unitPriceVnd,
      totalVnd: accTray.totalPriceVnd,
      note: accTray.sourceRule
    });
  }
  if (conduitMeters > 0 && accConduit) {
    items.push({
      code: 'MG-PVC',
      category: 'Máng & Ống Gen',
      name: accConduit.name,
      unit: accConduit.unit,
      quantity: conduitMeters,
      unitPriceVnd: accConduit.unitPriceVnd,
      totalVnd: accConduit.totalPriceVnd,
      note: accConduit.sourceRule
    });
  }

  // Labor estimation based on active assets & canonical cable lengths (TCVN norms)
  const { assets } = getActiveProjectAssets(project);
  const cameraCount = assets.filter(a => a.category === 'camera').length;
  const apCount = assets.filter(a => a.category === 'ap').length;
  const rackCount = bom.kpis.rackCount;
  const totalPullMeters = Math.round((cat6Meters + cat6aMeters + fiberMeters + powerMeters) * 10) / 10;

  if (totalPullMeters > 0) {
    items.push({
      code: 'NC-CAP',
      category: 'Nhân Công TCVN',
      name: 'Nhân công kéo rải cáp, bấm đầu RJ45/hàn quang & đo kiểm Fluke',
      unit: 'Mét',
      quantity: totalPullMeters,
      unitPriceVnd: 15000,
      totalVnd: totalPullMeters * 15000,
      note: 'Bao gồm dán nhãn chuẩn TIA/EIA-606-B'
    });
  }

  if (trayMeters + conduitMeters > 0) {
    const qty = trayMeters + conduitMeters;
    items.push({
      code: 'NC-GEN',
      category: 'Nhân Công TCVN',
      name: 'Nhân công khoan đục tường, lắp đặt máng cáp & ống gen',
      unit: 'Mét',
      quantity: qty,
      unitPriceVnd: 45000,
      totalVnd: qty * 45000,
      note: 'Theo định mức thi công điện nhẹ TCVN'
    });
  }

  if (cameraCount > 0) {
    items.push({
      code: 'NC-CAM',
      category: 'Nhân Công TCVN',
      name: 'Nhân công lắp đặt, căn chỉnh góc quay & cấu hình Camera IP',
      unit: 'Bộ',
      quantity: cameraCount,
      unitPriceVnd: 250000,
      totalVnd: cameraCount * 250000,
      note: 'Bao gồm hộp kỹ thuật & chân đế'
    });
  }

  if (apCount > 0) {
    items.push({
      code: 'NC-AP',
      category: 'Nhân Công TCVN',
      name: 'Nhân công gắn trần, cấu hình Roaming & phát sóng Wi-Fi AP',
      unit: 'Bộ',
      quantity: apCount,
      unitPriceVnd: 220000,
      totalVnd: apCount * 220000,
      note: 'Tối ưu kênh 2.4/5GHz tránh nhiễu'
    });
  }

  if (rackCount > 0) {
    items.push({
      code: 'NC-RACK',
      category: 'Nhân Công TCVN',
      name: 'Nhân công lắp dựng tủ Rack 19", gá thiết bị & đấu nối Patch Panel',
      unit: 'Tủ',
      quantity: rackCount,
      unitPriceVnd: 1500000,
      totalVnd: rackCount * 1500000,
      note: 'Bao gồm bó gọn dây nhảy & tiếp địa tủ'
    });
  }

  const materialTotalVnd = items
    .filter(i => i.category !== 'Nhân Công TCVN')
    .reduce((sum, i) => sum + i.totalVnd, 0);
  const laborTotalVnd = items
    .filter(i => i.category === 'Nhân Công TCVN')
    .reduce((sum, i) => sum + i.totalVnd, 0);

  return {
    items,
    materialTotalVnd,
    laborTotalVnd,
    grandTotalVnd: materialTotalVnd + laborTotalVnd
  };
}
