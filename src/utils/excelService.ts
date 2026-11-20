import ExcelJS from 'exceljs';
import { ProjectState, DeviceAsset, DevicePort, DiagramNode, ServerRack } from '../types/infrastructure';
import { DEVICE_CATALOG } from '../data/deviceCatalog';
import { APP_BUILD_HASH, APP_VERSION } from '../config/appInfo';
import { BomFilterOptions, computeProjectBomStats } from './bomAggregator';
import { getAssetUHeight, getRackStatistics } from './rackGeometry';
import { checkImportPayloadSize, MAX_EXCEL_FILE_BYTES } from './security';
import { normalizeScalePxPerMeter } from './scaleUtils';
import { trackExport, trackTemplate } from '../services/tracker';

const MAX_EXCEL_IMPORT_ROWS = 2000;

interface ExcelColumnDef {
  header: string;
  key: string;
  width: number;
}

function addStyledSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  columns: ExcelColumnDef[],
  rows: Array<Record<string, string | number>>
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));
  rows.forEach(row => ws.addRow(row));

  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1D4ED8' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF1E40AF' } },
      bottom: { style: 'thin', color: { argb: 'FF1E40AF' } },
      left: { style: 'thin', color: { argb: 'FF3B82F6' } },
      right: { style: 'thin', color: { argb: 'FF3B82F6' } }
    };
  });

  for (let r = 2; r <= rows.length + 1; r++) {
    const dataRow = ws.getRow(r);
    dataRow.eachCell(cell => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } }
      };
    });
  }

  if (columns.length > 0 && rows.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: columns.length }
    };
  }

  return ws;
}

async function triggerWorkbookDownload(wb: ExcelJS.Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a pre-formatted Excel template (.xlsx) via ExcelJS
 */
export async function downloadExcelTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HACHIHI Network & Electrical Designer';

  const columns: ExcelColumnDef[] = [
    { header: 'Mã Tài Sản (Asset Tag)', key: 'assetTag', width: 20 },
    { header: 'Tên Thiết Bị', key: 'name', width: 22 },
    { header: 'Loại Thiết Bị', key: 'category', width: 16 },
    { header: 'Hãng Sản Xuất', key: 'vendor', width: 16 },
    { header: 'Model', key: 'model', width: 22 },
    { header: 'Địa Chỉ IP', key: 'ip', width: 16 },
    { header: 'Subnet Mask', key: 'mask', width: 16 },
    { header: 'Gateway', key: 'gateway', width: 16 },
    { header: 'VLAN', key: 'vlan', width: 12 },
    { header: 'Tầng', key: 'floor', width: 24 },
    { header: 'Phòng', key: 'room', width: 28 },
    { header: 'Tủ Rack', key: 'rack', width: 28 },
    { header: 'Mặt Tủ (front/rear)', key: 'rackSide', width: 18 },
    { header: 'Vị Trí U', key: 'uSlot', width: 12 },
    { header: 'Số U', key: 'uHeight', width: 8 },
    { header: 'Công Suất (W)', key: 'watts', width: 14 },
    { header: 'Khối Lượng (kg)', key: 'weight', width: 15 },
    { header: 'Trạng Thái', key: 'status', width: 12 }
  ];

  const sampleRows = [
    {
      assetTag: 'AST-0001',
      name: 'SW-CORE-01',
      category: 'core_switch',
      vendor: 'Cisco',
      model: 'Nexus 9336C-FX2',
      ip: '10.10.0.1',
      mask: '255.255.255.0',
      gateway: '10.10.0.254',
      vlan: '10, 20, 99',
      floor: 'Tầng 1 - Sảnh & Lễ tân',
      room: 'Phòng Server / MDF Tầng 1',
      rack: 'Rack MDF-01 (42U Server Room)',
      rackSide: 'front',
      uSlot: 40,
      uHeight: 1,
      watts: 450,
      weight: 10.2,
      status: 'online'
    },
    {
      assetTag: 'AST-0002',
      name: 'SW-ACCESS-FL01',
      category: 'switch',
      vendor: 'Cisco',
      model: 'Catalyst C9300-24P',
      ip: '10.10.1.2',
      mask: '255.255.255.0',
      gateway: '10.10.1.1',
      vlan: '10, 20',
      floor: 'Tầng 1 - Sảnh & Lễ tân',
      room: 'Phòng Server / MDF Tầng 1',
      rack: 'Rack MDF-01 (42U Server Room)',
      rackSide: 'front',
      uSlot: 36,
      uHeight: 1,
      watts: 380,
      weight: 7.4,
      status: 'online'
    },
    {
      assetTag: 'AST-0003',
      name: 'SRV-DATABASE-01',
      category: 'server',
      vendor: 'Dell',
      model: 'PowerEdge R760',
      ip: '10.10.50.11',
      mask: '255.255.255.0',
      gateway: '10.10.50.1',
      vlan: '50',
      floor: 'Tầng 1 - Sảnh & Lễ tân',
      room: 'Phòng Server / MDF Tầng 1',
      rack: 'Rack MDF-01 (42U Server Room)',
      rackSide: 'front',
      uSlot: 24,
      uHeight: 2,
      watts: 750,
      weight: 28.5,
      status: 'online'
    },
    {
      assetTag: 'AST-0004',
      name: 'CAM-CONG-CHINH',
      category: 'camera',
      vendor: 'Hikvision',
      model: 'DS-2CD2186G2-ISU',
      ip: '10.10.100.11',
      mask: '255.255.255.0',
      gateway: '10.10.100.1',
      vlan: '100',
      floor: 'Tầng 1 - Sảnh & Lễ tân',
      room: 'Sảnh Lễ tân & Check-in',
      rack: '',
      rackSide: '',
      uSlot: '',
      uHeight: 0,
      watts: 12,
      weight: 0.6,
      status: 'online'
    }
  ];

  addStyledSheet(wb, 'Mau_Thiet_Bi', columns, sampleRows);
  await triggerWorkbookDownload(wb, 'HACHIHI_Mau_Nhap_Thiet_Bi.xlsx');
  trackTemplate('excel_device');
}

/**
 * Builds a comprehensive 6-sheet ExcelJS workbook:
 * 1. Tong_Quan
 * 2. BOM_Vat_Tu
 * 3. Danh_Sach_Thiet_Bi
 * 4. Ket_Noi_Cap
 * 5. Tu_Rack_Chi_Tiet
 * 6. Theo_Khu_Vuc
 */
export function buildProjectExcelWorkbook(project: ProjectState): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = project.author || 'HACHIHI Designer';
  wb.created = new Date();

  const assets = Object.values(project.assets);
  const totalWatts = assets.reduce((s, a) => s + (a.powerWatts || 0), 0);
  const totalWeightKg = assets.reduce((s, a) => s + (a.weightKg || 0), 0);
  const totalCableMeters = project.cables.reduce((s, c) => s + (c.lengthMeters || 0), 0);

  // 1. Sheet: Tong_Quan
  addStyledSheet(
    wb,
    'Tong_Quan',
    [
      { header: 'Hạng Mục', key: 'item', width: 32 },
      { header: 'Giá Trị', key: 'value', width: 34 },
      { header: 'Ghi Chú', key: 'note', width: 42 }
    ],
    [
      { item: 'Tên Dự Án', value: project.name, note: `HACHIHI Network & Electrical Designer v${APP_VERSION} (${APP_BUILD_HASH})` },
      { item: 'Kỹ Sư / Tác Giả', value: project.author, note: '' },
      { item: 'Phiên Bản Tài Liệu', value: project.version, note: `Ứng dụng v${APP_VERSION}` },
      { item: 'Thời Gian Xuất', value: new Date().toLocaleString('vi-VN'), note: '' },
      { item: 'Tổng Số Tòa Nhà', value: project.buildings.length, note: '' },
      { item: 'Tổng Số Tầng', value: project.floors.length, note: '' },
      { item: 'Tổng Số Phòng / Khu Vực', value: project.rooms.length, note: '' },
      { item: 'Tổng Số Tủ Rack', value: project.racks.length, note: '' },
      { item: 'Tổng Số Thiết Bị', value: assets.length, note: '' },
      { item: 'Tổng Số Tuyến Cáp', value: project.cables.length, note: `Tổng chiều dài: ${totalCableMeters.toFixed(1)} m` },
      { item: 'Tổng Công Suất Điện (W)', value: totalWatts, note: `${(totalWatts / 1000).toFixed(2)} kW` },
      { item: 'Tổng Khối Lượng Thiết Bị (kg)', value: Number(totalWeightKg.toFixed(1)), note: '' }
    ]
  );

  // 2. Sheet: BOM_Vat_Tu
  const bomMap = new Map<string, {
    category: string;
    vendor: string;
    model: string;
    qty: number;
    uEach: number;
    wattsEach: number;
    weightEach: number;
  }>();

  assets.forEach(a => {
    const key = `${a.category}__${a.vendor}__${a.model}`;
    const existing = bomMap.get(key);
    const uH = a.rackId ? getAssetUHeight(a) : 0;
    if (existing) {
      existing.qty += 1;
    } else {
      bomMap.set(key, {
        category: a.category,
        vendor: a.vendor,
        model: a.model,
        qty: 1,
        uEach: uH,
        wattsEach: a.powerWatts || 0,
        weightEach: a.weightKg || 0
      });
    }
  });

  const bomRows: Array<Record<string, string | number>> = Array.from(bomMap.values()).map((item, idx) => ({
    stt: idx + 1,
    category: item.category,
    vendor: item.vendor,
    model: item.model,
    unit: 'Cái',
    qty: item.qty,
    uSize: item.uEach || '-',
    wattsEach: item.wattsEach,
    totalWatts: item.wattsEach * item.qty,
    totalWeight: Number((item.weightEach * item.qty).toFixed(1))
  }));

  project.racks.forEach(rk => {
    bomRows.push({
      stt: bomRows.length + 1,
      category: 'rack_cabinet',
      vendor: 'HACHIHI',
      model: `Tủ Rack ${rk.totalUnits}U (${rk.widthMm}x${rk.depthMm}mm)`,
      unit: 'Tủ',
      qty: 1,
      uSize: rk.totalUnits,
      wattsEach: 0,
      totalWatts: 0,
      totalWeight: 110
    });
  });

  const cableBomMap = new Map<string, { type: string; totalMeters: number }>();
  project.cables.forEach(c => {
    const existing = cableBomMap.get(c.cableType);
    if (existing) {
      existing.totalMeters += c.lengthMeters || 0;
    } else {
      cableBomMap.set(c.cableType, { type: c.cableType, totalMeters: c.lengthMeters || 0 });
    }
  });
  cableBomMap.forEach(cb => {
    bomRows.push({
      stt: bomRows.length + 1,
      category: 'cabling',
      vendor: 'Standard',
      model: cb.type,
      unit: 'Mét (m)',
      qty: Number(cb.totalMeters.toFixed(1)),
      uSize: '-',
      wattsEach: 0,
      totalWatts: 0,
      totalWeight: 0
    });
  });

  const bomSheet = addStyledSheet(
    wb,
    'BOM_Vat_Tu',
    [
      { header: 'STT', key: 'stt', width: 7 },
      { header: 'Nhóm Thiết Bị', key: 'category', width: 16 },
      { header: 'Hãng Sản Xuất', key: 'vendor', width: 18 },
      { header: 'Model / Mã Hiệu', key: 'model', width: 30 },
      { header: 'Đơn Vị', key: 'unit', width: 10 },
      { header: 'Số Lượng', key: 'qty', width: 12 },
      { header: 'Kích Cỡ (U)', key: 'uSize', width: 12 },
      { header: 'Công Suất Đơn Vị (W)', key: 'wattsEach', width: 20 },
      { header: 'Tổng Công Suất (W)', key: 'totalWatts', width: 20 },
      { header: 'Tổng Khối Lượng (kg)', key: 'totalWeight', width: 20 }
    ],
    bomRows
  );

  // Convert Total Watts column (I) into live Excel formulas (=F{r}*H{r}) and append live SUM row
  if (bomRows.length > 0) {
    for (let r = 2; r <= bomRows.length + 1; r++) {
      const staticVal = Number(bomRows[r - 2].totalWatts) || 0;
      bomSheet.getCell(`I${r}`).value = { formula: `F${r}*H${r}`, result: staticVal };
    }
    const lastDataRow = bomRows.length + 1;
    const sumRowIdx = lastDataRow + 1;
    const totalW = bomRows.reduce((s, r) => s + (Number(r.totalWatts) || 0), 0);
    const totalKg = Number(bomRows.reduce((s, r) => s + (Number(r.totalWeight) || 0), 0).toFixed(1));
    const sumRow = bomSheet.getRow(sumRowIdx);
    sumRow.getCell(4).value = 'TỔNG CỘNG BOM VẬT TƯ';
    sumRow.getCell(9).value = { formula: `SUM(I2:I${lastDataRow})`, result: totalW };
    sumRow.getCell(10).value = { formula: `SUM(J2:J${lastDataRow})`, result: totalKg };
    sumRow.eachCell(cell => {
      cell.font = { bold: true, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      cell.border = { top: { style: 'thin', color: { argb: 'FF1D4ED8' } } };
    });
  }

  // 3. Sheet: Danh_Sach_Thiet_Bi
  const devicesRows = assets.map((a, idx) => {
    const floor = project.floors.find(f => f.id === a.floorId)?.name || 'Chưa gán';
    const room = project.rooms.find(r => r.id === a.roomId)?.name || 'Chưa gán';
    const rack = project.racks.find(rk => rk.id === a.rackId)?.name || '';
    const uHeight = getAssetUHeight(a);

    return {
      stt: idx + 1,
      assetTag: a.assetTag,
      name: a.name,
      category: a.category,
      vendor: a.vendor,
      model: a.model,
      ip: a.ipAddress,
      mask: a.subnetMask,
      gateway: a.gateway,
      mac: a.macAddress,
      vlan: a.vlan,
      floor,
      room,
      rack,
      rackSide: a.rackId ? (a.rackSide === 'rear' ? 'Sau' : 'Trước') : '',
      uPos: a.rackUnitStart ? (uHeight > 1 ? `U${a.rackUnitStart}-U${a.rackUnitStart + uHeight - 1}` : `U${a.rackUnitStart}`) : '',
      watts: a.powerWatts || 0,
      weight: a.weightKg || 0,
      ports: a.ports?.length || 0,
      status: a.status
    };
  });

  addStyledSheet(
    wb,
    'Danh_Sach_Thiet_Bi',
    [
      { header: 'STT', key: 'stt', width: 7 },
      { header: 'Mã Tài Sản', key: 'assetTag', width: 15 },
      { header: 'Tên Thiết Bị', key: 'name', width: 22 },
      { header: 'Phân Loại', key: 'category', width: 15 },
      { header: 'Hãng Sản Xuất', key: 'vendor', width: 16 },
      { header: 'Model', key: 'model', width: 22 },
      { header: 'Địa Chỉ IP', key: 'ip', width: 16 },
      { header: 'Subnet Mask', key: 'mask', width: 16 },
      { header: 'Gateway', key: 'gateway', width: 16 },
      { header: 'MAC', key: 'mac', width: 18 },
      { header: 'VLAN', key: 'vlan', width: 12 },
      { header: 'Tầng', key: 'floor', width: 24 },
      { header: 'Phòng', key: 'room', width: 24 },
      { header: 'Tủ Rack', key: 'rack', width: 24 },
      { header: 'Mặt Tủ', key: 'rackSide', width: 10 },
      { header: 'Vị Trí U', key: 'uPos', width: 12 },
      { header: 'Công Suất (W)', key: 'watts', width: 14 },
      { header: 'Khối Lượng (kg)', key: 'weight', width: 15 },
      { header: 'Số Cổng', key: 'ports', width: 10 },
      { header: 'Trạng Thái', key: 'status', width: 12 }
    ],
    devicesRows
  );

  // 4. Sheet: Ket_Noi_Cap
  const cablesRows = project.cables.map((c, idx) => {
    const srcNode = project.nodes.find(n => n.id === c.sourceNodeId);
    const tgtNode = project.nodes.find(n => n.id === c.targetNodeId);
    const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
    const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;

    return {
      stt: idx + 1,
      code: c.cableCode,
      label: c.label || '',
      type: c.cableType,
      bw: c.bandwidth,
      length: c.lengthMeters,
      srcName: srcNode?.label || 'Chưa rõ',
      srcIp: srcAsset?.ipAddress || '',
      srcPort: c.sourcePortId || 'Auto',
      tgtName: tgtNode?.label || 'Chưa rõ',
      tgtIp: tgtAsset?.ipAddress || '',
      tgtPort: c.targetPortId || 'Auto',
      vlan: c.vlan || '',
      routing: c.routingType,
      status: c.status,
      notes: c.notes || ''
    };
  });

  addStyledSheet(
    wb,
    'Ket_Noi_Cap',
    [
      { header: 'STT', key: 'stt', width: 7 },
      { header: 'Mã Dây Cáp', key: 'code', width: 15 },
      { header: 'Nhãn', key: 'label', width: 16 },
      { header: 'Loại Cáp', key: 'type', width: 16 },
      { header: 'Băng Thông', key: 'bw', width: 12 },
      { header: 'Chiều Dài (m)', key: 'length', width: 14 },
      { header: 'Thiết Bị Nguồn', key: 'srcName', width: 20 },
      { header: 'IP Nguồn', key: 'srcIp', width: 15 },
      { header: 'Cổng Nguồn', key: 'srcPort', width: 14 },
      { header: 'Thiết Bị Đích', key: 'tgtName', width: 20 },
      { header: 'IP Đích', key: 'tgtIp', width: 15 },
      { header: 'Cổng Đích', key: 'tgtPort', width: 14 },
      { header: 'VLAN', key: 'vlan', width: 12 },
      { header: 'Định Tuyến', key: 'routing', width: 14 },
      { header: 'Trạng Thái', key: 'status', width: 12 },
      { header: 'Ghi Chú', key: 'notes', width: 24 }
    ],
    cablesRows
  );

  // 5. Sheet: Tu_Rack_Chi_Tiet
  const rackDetailsRows: Array<Record<string, string | number>> = [];
  project.racks.forEach(rk => {
    const stats = getRackStatistics(rk, project.assets);
    const floorName = project.floors.find(f => f.id === rk.floorId)?.name || 'Chưa gán';
    const roomName = project.rooms.find(r => r.id === rk.roomId)?.name || 'Chưa gán';

    const slotRows: Array<{ side: string; startU: number; devId: string }> = [];
    Object.entries(rk.slots || {}).forEach(([u, devId]) => {
      slotRows.push({ side: 'Trước (Front)', startU: parseInt(u, 10), devId });
    });
    Object.entries(rk.rearSlots || {}).forEach(([u, devId]) => {
      slotRows.push({ side: 'Sau (Rear)', startU: parseInt(u, 10), devId });
    });
    slotRows.sort((a, b) => b.startU - a.startU);

    if (slotRows.length === 0) {
      rackDetailsRows.push({
        rackName: rk.name,
        size: `${rk.totalUnits}U (${rk.widthMm}x${rk.depthMm}mm)`,
        loc: `${floorName} / ${roomName}`,
        uSummary: `${stats.frontUsedUnits}U / ${stats.frontFreeUnits}U`,
        watts: stats.totalPowerWatts,
        load: `${stats.totalWeightKg.toFixed(1)} / ${stats.maxLoadKg}`,
        side: '-',
        uPos: '-',
        devName: '(Tủ trống)',
        model: '-',
        ip: '-'
      });
    } else {
      slotRows.forEach(row => {
        const dev = project.assets[row.devId];
        const uH = getAssetUHeight(dev);
        rackDetailsRows.push({
          rackName: rk.name,
          size: `${rk.totalUnits}U (${rk.widthMm}x${rk.depthMm}mm)`,
          loc: `${floorName} / ${roomName}`,
          uSummary: `${stats.frontUsedUnits}U / ${stats.frontFreeUnits}U`,
          watts: stats.totalPowerWatts,
          load: `${stats.totalWeightKg.toFixed(1)} / ${stats.maxLoadKg}`,
          side: row.side,
          uPos: uH > 1 ? `U${row.startU}-U${row.startU + uH - 1}` : `U${row.startU}`,
          devName: dev?.name || row.devId,
          model: dev?.model || '',
          ip: dev?.ipAddress || ''
        });
      });
    }
  });

  addStyledSheet(
    wb,
    'Tu_Rack_Chi_Tiet',
    [
      { header: 'Tủ Rack', key: 'rackName', width: 26 },
      { header: 'Kích Thước', key: 'size', width: 22 },
      { header: 'Vị Trí', key: 'loc', width: 32 },
      { header: 'U Đã Dùng / Trống (Trước)', key: 'uSummary', width: 22 },
      { header: 'Tổng Công Suất Tủ (W)', key: 'watts', width: 20 },
      { header: 'Tổng Tải Tủ (kg)', key: 'load', width: 18 },
      { header: 'Mặt Gá', key: 'side', width: 14 },
      { header: 'Vị Trí U', key: 'uPos', width: 12 },
      { header: 'Thiết Bị', key: 'devName', width: 22 },
      { header: 'Model', key: 'model', width: 22 },
      { header: 'IP', key: 'ip', width: 16 }
    ],
    rackDetailsRows
  );

  // 6. Sheet: Theo_Khu_Vuc
  const areaRows: Array<Record<string, string | number>> = [];
  project.floors.forEach(fl => {
    const roomsOnFloor = project.rooms.filter(r => r.floorId === fl.id);
    const assetsOnFloor = assets.filter(a => a.floorId === fl.id);
    const floorWatts = assetsOnFloor.reduce((s, a) => s + (a.powerWatts || 0), 0);

    areaRows.push({
      floor: fl.name,
      room: '(Toàn tầng)',
      type: fl.description,
      area: Number((fl.widthMeters * fl.depthMeters).toFixed(1)),
      count: assetsOnFloor.length,
      watts: floorWatts
    });

    roomsOnFloor.forEach(rm => {
      const assetsInRoom = assetsOnFloor.filter(a => a.roomId === rm.id);
      const roomWatts = assetsInRoom.reduce((s, a) => s + (a.powerWatts || 0), 0);
      const roomScale = normalizeScalePxPerMeter(project.settings?.scale);
      const areaM2 = (rm.width * rm.height) / (roomScale ** 2);
      areaRows.push({
        floor: fl.name,
        room: rm.name,
        type: rm.type,
        area: Number(areaM2.toFixed(1)),
        count: assetsInRoom.length,
        watts: roomWatts
      });
    });
  });

  addStyledSheet(
    wb,
    'Theo_Khu_Vuc',
    [
      { header: 'Tầng', key: 'floor', width: 26 },
      { header: 'Phòng / Khu Vực', key: 'room', width: 28 },
      { header: 'Loại Không Gian', key: 'type', width: 26 },
      { header: 'Diện Tích (m²)', key: 'area', width: 16 },
      { header: 'Số Thiết Bị', key: 'count', width: 14 },
      { header: 'Công Suất (W)', key: 'watts', width: 16 }
    ],
    areaRows
  );

  return wb;
}

/**
 * Builds the 6-sheet ExcelJS workbook into an in-memory Uint8Array buffer
 * so it can be downloaded directly or packaged in a handover ZIP bundle.
 */
export async function buildProjectExcelUint8Array(project: ProjectState): Promise<Uint8Array> {
  const wb = buildProjectExcelWorkbook(project);
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/**
 * Exports current project state to a 6-sheet Excel file (.xlsx) via ExcelJS
 */
export async function exportProjectToExcel(project: ProjectState) {
  const wb = buildProjectExcelWorkbook(project);
  const fileName = `${project.name.replace(/\s+/g, '_')}_Ho_So_Ha_Tang.xlsx`;
  await triggerWorkbookDownload(wb, fileName);
  trackExport('excel');
}

/**
 * Builds a dedicated 6-sheet BOM Cost & Estimation Workbook with live cross-sheet Excel formulas:
 * 1. Tong_Hop
 * 2. Chi_Tiet_BOM
 * 3. Theo_Tang
 * 4. Cap_Tung_Tuyen
 * 5. Phu_Kien_Suy_Ra
 * 6. Gia_Dinh_BOM
 */
export function buildDetailedBomExcelWorkbook(
  project: ProjectState,
  options?: BomFilterOptions
): ExcelJS.Workbook {
  const stats = computeProjectBomStats(project, options);
  const wb = new ExcelJS.Workbook();
  wb.creator = `${project.author || 'HACHIHI'} · v${APP_VERSION}`;
  wb.created = new Date();

  // 1. Tong_Hop
  addStyledSheet(
    wb,
    'Tong_Hop',
    [
      { header: 'Chỉ tiêu Dự toán', key: 'item', width: 34 },
      { header: 'Giá trị', key: 'value', width: 24 },
      { header: 'Đơn vị / Ghi chú', key: 'note', width: 46 }
    ],
    [
      { item: 'Dự án', value: project.name, note: `HACHIHI v${APP_VERSION} (${APP_BUILD_HASH})` },
      { item: 'Thiết bị hoạt động', value: stats.kpis.deviceCount, note: `${stats.kpis.networkDeviceCount} TB mạng · ${stats.kpis.electricalDeviceCount} TB điện` },
      { item: 'Tủ Server Rack 19"', value: stats.kpis.rackCount, note: `${stats.kpis.usedRackU}/${stats.kpis.totalRackU}U đã lắp đặt` },
      { item: 'Số tuyến cáp', value: stats.kpis.cableCount, note: `Tổng chiều dài gốc: ${stats.kpis.rawCableMeters} m` },
      { item: 'Tổng cáp đặt hàng (kèm dự phòng & hao hụt)', value: stats.kpis.totalCableWithReserveMeters, note: 'm (tính từ giả định ở sheet Gia_Dinh_BOM)' },
      { item: 'Tổng công suất điện', value: stats.kpis.totalPowerWatts, note: `W (${stats.kpis.totalPowerKw} kW) · Đề xuất UPS >= ${stats.kpis.recommendedUpsVa} VA` },
      { item: 'Tổng khối lượng thiết bị & tủ', value: stats.kpis.totalWeightKg, note: 'kg' },
      { item: 'Dự toán Thiết bị & Tủ Rack (VNĐ)', value: stats.kpis.devicesTotalVnd, note: 'VNĐ (chưa VAT)' },
      { item: 'Dự toán Dây cáp (VNĐ)', value: stats.kpis.cablesTotalVnd, note: 'VNĐ (tính theo mét đặt hàng)' },
      { item: 'Dự toán Phụ kiện & Máng cáp (VNĐ)', value: stats.kpis.accessoriesTotalVnd, note: 'VNĐ' },
      { item: 'TỔNG DỰ TOÁN VẬT TƯ TẠM TÍNH (VNĐ)', value: stats.kpis.estimatedGrandTotalVnd, note: 'VNĐ' },
      { item: `Vật tư phụ thi công (${stats.quotation.auxMaterialPct}%)`, value: stats.quotation.auxMaterialCostVnd, note: 'Hạt mạng, dây thít, ống ruột gà...' },
      { item: `Nhân công thi công (${stats.quotation.laborWorkdays} công)`, value: stats.quotation.laborTotalVnd, note: `${stats.quotation.laborWorkdays} công × ${stats.quotation.laborUnitPriceVnd.toLocaleString('vi-VN')} đ/công` },
      { item: 'TỔNG BÁO GIÁ HOÀN THIỆN (VNĐ)', value: stats.quotation.finalQuotationTotalVnd, note: 'Vật tư + Vật tư phụ + Nhân công (chưa VAT)' },
      { item: 'Đối soát chéo tổng mét cáp (Tuyến / Loại / Tầng)', value: stats.precision.isConsistent ? 'Khớp hoàn toàn' : `Lệch ${stats.precision.deltaMeters} m`, note: `${stats.precision.routeTotalMeters}m / ${stats.precision.typeTotalMeters}m / ${stats.precision.floorTotalMeters}m` }
    ]
  );

  // 2. Chi_Tiet_BOM (Devices + Cables with SKU, VND pricing & live formulas)
  const detailRows: Array<Record<string, string | number>> = [];
  stats.deviceRows.forEach((d, i) => {
    detailRows.push({
      stt: i + 1,
      sku: d.sku,
      group: 'Thiết bị & Tủ Rack',
      type: d.categoryLabel,
      spec: `${d.vendor} · ${d.model}`,
      unit: d.unit,
      qty: d.quantity,
      unitW: d.unitWatts,
      totalW: d.totalWatts,
      unitKg: d.unitWeightKg,
      totalKg: d.totalWeightKg,
      unitPrice: d.unitPriceVnd,
      totalPrice: d.totalPriceVnd,
      note: d.devicePreviews.slice(0, 6).join(', ')
    });
  });
  const cableStartIdx = detailRows.length + 2;
  stats.cableRows.forEach(c => {
    const verticalNote = c.verticalRiseMeters > 0 ? ` · +${c.verticalRiseMeters}m vượt tầng` : '';
    const dropNote = c.dropHeightMeters > 0 ? ` · +${c.dropHeightMeters}m thả trần` : '';
    detailRows.push({
      stt: detailRows.length + 1,
      sku: c.sku,
      group: 'Dây cáp kết nối',
      type: c.label,
      spec: `${c.count} tuyến · gốc ${c.rawMeters}m${verticalNote}${dropNote} · +${c.serviceLoopMeters}m đầu cáp · +${c.lossPct}%`,
      unit: 'm',
      qty: c.totalWithReserveMeters,
      unitW: 0,
      totalW: 0,
      unitKg: 0,
      totalKg: 0,
      unitPrice: c.unitPriceVnd,
      totalPrice: c.totalPriceVnd,
      note: c.estimatedSpools ? `~${c.estimatedSpools} cuộn (${c.spoolLengthMeters}m/cuộn)` : `${c.count} tuyến`
    });
  });

  const detailWs = addStyledSheet(
    wb,
    'Chi_Tiet_BOM',
    [
      { header: 'STT', key: 'stt', width: 7 },
      { header: 'Mã SKU', key: 'sku', width: 18 },
      { header: 'Nhóm', key: 'group', width: 18 },
      { header: 'Hạng mục', key: 'type', width: 24 },
      { header: 'Hãng / Quy cách', key: 'spec', width: 34 },
      { header: 'ĐVT', key: 'unit', width: 8 },
      { header: 'Số lượng', key: 'qty', width: 12 },
      { header: 'CS đơn vị (W)', key: 'unitW', width: 14 },
      { header: 'Tổng CS (W)', key: 'totalW', width: 14 },
      { header: 'KL đơn vị (kg)', key: 'unitKg', width: 14 },
      { header: 'Tổng KL (kg)', key: 'totalKg', width: 14 },
      { header: 'Đơn giá (VNĐ)', key: 'unitPrice', width: 16 },
      { header: 'Thành tiền (VNĐ)', key: 'totalPrice', width: 18 },
      { header: 'Ghi chú', key: 'note', width: 32 }
    ],
    detailRows
  );

  if (detailRows.length > 0) {
    for (let r = 2; r < cableStartIdx; r++) {
      const item = detailRows[r - 2];
      detailWs.getCell(`I${r}`).value = { formula: `G${r}*H${r}`, result: Number(item.totalW) || 0 };
      detailWs.getCell(`K${r}`).value = { formula: `G${r}*J${r}`, result: Number(item.totalKg) || 0 };
      detailWs.getCell(`M${r}`).value = { formula: `G${r}*L${r}`, result: Number(item.totalPrice) || 0 };
    }
    const lastRow = detailRows.length + 1;
    for (let r = cableStartIdx; r <= lastRow; r++) {
      const item = detailRows[r - 2];
      detailWs.getCell(`M${r}`).value = { formula: `ROUND(G${r}*L${r},0)`, result: Number(item.totalPrice) || 0 };
    }
    const sumRow = detailWs.getRow(lastRow + 1);
    sumRow.getCell(5).value = 'TỔNG CỘNG CHI TIẾT BOM';
    sumRow.getCell(9).value = { formula: `SUM(I2:I${lastRow})`, result: stats.kpis.totalPowerWatts };
    sumRow.getCell(11).value = { formula: `SUM(K2:K${lastRow})`, result: stats.kpis.totalWeightKg };
    sumRow.getCell(13).value = {
      formula: `SUM(M2:M${lastRow})`,
      result: stats.kpis.devicesTotalVnd + stats.kpis.cablesTotalVnd
    };
    sumRow.eachCell(c => {
      c.font = { bold: true, size: 11 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    });
  }

  // 3. Theo_Tang
  addStyledSheet(
    wb,
    'Theo_Tang',
    [
      { header: 'Tầng', key: 'floorName', width: 28 },
      { header: 'Số phòng', key: 'roomCount', width: 12 },
      { header: 'Diện tích (m²)', key: 'areaM2', width: 14 },
      { header: 'Thiết bị', key: 'deviceCount', width: 12 },
      { header: 'Tủ Rack', key: 'rackCount', width: 12 },
      { header: 'Tuyến cáp', key: 'cableCount', width: 12 },
      { header: 'Tổng điện (W)', key: 'totalPowerWatts', width: 16 },
      { header: 'Khối lượng (kg)', key: 'totalWeightKg', width: 16 }
    ],
    stats.floorRows.map(fl => ({
      floorName: fl.floorName,
      roomCount: fl.roomCount,
      areaM2: fl.areaM2,
      deviceCount: fl.deviceCount,
      rackCount: fl.rackCount,
      cableCount: fl.cableCount,
      totalPowerWatts: fl.totalPowerWatts,
      totalWeightKg: fl.totalWeightKg
    }))
  );

  // 4. Cap_Tung_Tuyen (live cross-sheet formula referencing Gia_Dinh_BOM)
  const floorById = new Map(project.floors.map(f => [f.id, f]));
  const nodeById = new Map(project.nodes.map(n => [n.id, n]));

  const routeRows = (project.cables || []).map((c, idx) => {
    const srcNode = nodeById.get(c.sourceNodeId);
    const tgtNode = nodeById.get(c.targetNodeId);
    const src = srcNode?.label || '—';
    const tgt = tgtNode?.label || '—';
    const rawM = Number(c.lengthMeters) || 0;
    const isDac = c.cableType === 'DAC_10G';
    const isFiber = c.cableType === 'FIBER_SM_OS2' || c.cableType === 'FIBER_MM_OM4';
    const srcFl = srcNode?.floorId ? floorById.get(srcNode.floorId) : undefined;
    const tgtFl = tgtNode?.floorId ? floorById.get(tgtNode.floorId) : undefined;
    const verticalM =
      !isDac && srcFl && tgtFl && srcFl.id !== tgtFl.id
        ? Math.round(Math.abs(srcFl.level - tgtFl.level) * stats.assumptions.floorHeightMeters * 10) / 10
        : 0;
    const dropM = isDac ? 0 : Math.round(stats.assumptions.dropHeightMeters * 2 * 10) / 10;
    const loopM = isDac || c.cableType === 'POWER_AC' ? 0 : stats.assumptions.serviceLoopMetersPerEnd * 2;
    const loss = isFiber ? stats.assumptions.fiberLossPct : isDac ? 0 : stats.assumptions.copperLossPct;
    const totalM = Math.round((rawM + verticalM + dropM + loopM) * (1 + loss / 100) * 10) / 10;
    return {
      stt: idx + 1,
      code: c.cableCode || c.id,
      type: c.cableType,
      src,
      tgt,
      rawMeters: rawM,
      verticalMeters: verticalM,
      dropMeters: dropM,
      loopMeters: loopM,
      lossPct: loss,
      totalMeters: totalM
    };
  });

  const routesWs = addStyledSheet(
    wb,
    'Cap_Tung_Tuyen',
    [
      { header: 'STT', key: 'stt', width: 7 },
      { header: 'Mã tuyến cáp', key: 'code', width: 16 },
      { header: 'Loại cáp', key: 'type', width: 16 },
      { header: 'Thiết bị nguồn', key: 'src', width: 22 },
      { header: 'Thiết bị đích', key: 'tgt', width: 22 },
      { header: 'Dài ngang (m)', key: 'rawMeters', width: 14 },
      { header: 'Vượt tầng (m)', key: 'verticalMeters', width: 14 },
      { header: 'Thả trần 2 đầu (m)', key: 'dropMeters', width: 18 },
      { header: 'Đầu cáp A/B (m)', key: 'loopMeters', width: 16 },
      { header: 'Hao hụt (%)', key: 'lossPct', width: 12 },
      { header: 'Tổng đặt hàng (m)', key: 'totalMeters', width: 18 }
    ],
    routeRows
  );

  if (routeRows.length > 0) {
    for (let r = 2; r <= routeRows.length + 1; r++) {
      const item = routeRows[r - 2];
      const isDac = item.type === 'DAC_10G';
      const isBulk = !isDac && item.type !== 'POWER_AC';
      const isFiber = item.type === 'FIBER_SM_OS2' || item.type === 'FIBER_MM_OM4';
      if (!isDac) {
        routesWs.getCell(`H${r}`).value = { formula: 'Gia_Dinh_BOM!$B$8*2', result: item.dropMeters };
      }
      if (isBulk) {
        routesWs.getCell(`I${r}`).value = { formula: 'Gia_Dinh_BOM!$B$2*2', result: item.loopMeters };
      }
      if (!isDac) {
        routesWs.getCell(`J${r}`).value = {
          formula: isFiber ? 'Gia_Dinh_BOM!$B$4' : 'Gia_Dinh_BOM!$B$3',
          result: item.lossPct
        };
      }
      routesWs.getCell(`K${r}`).value = {
        formula: `ROUND((F${r}+G${r}+H${r}+I${r})*(1+J${r}/100),1)`,
        result: item.totalMeters
      };
    }
    const lastR = routeRows.length + 1;
    const sumR = routesWs.getRow(lastR + 1);
    sumR.getCell(4).value = 'TỔNG CHIỀU DÀI CÁP';
    sumR.getCell(6).value = {
      formula: `SUM(F2:F${lastR})`,
      result: routeRows.reduce((s, x) => s + x.rawMeters, 0)
    };
    sumR.getCell(7).value = {
      formula: `SUM(G2:G${lastR})`,
      result: Number(routeRows.reduce((s, x) => s + x.verticalMeters, 0).toFixed(1))
    };
    sumR.getCell(11).value = {
      formula: `SUM(K2:K${lastR})`,
      result: Number(routeRows.reduce((s, x) => s + x.totalMeters, 0).toFixed(1))
    };
    sumR.eachCell(c => {
      c.font = { bold: true, size: 11 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    });
  }

  // 5. Phu_Kien_Suy_Ra
  addStyledSheet(
    wb,
    'Phu_Kien_Suy_Ra',
    [
      { header: 'Mã SKU', key: 'sku', width: 18 },
      { header: 'Nhóm', key: 'group', width: 18 },
      { header: 'Tên vật tư / phụ kiện', key: 'name', width: 38 },
      { header: 'Quy cách', key: 'spec', width: 38 },
      { header: 'ĐVT', key: 'unit', width: 10 },
      { header: 'SL tính toán', key: 'calcQty', width: 14 },
      { header: 'SL đề xuất đặt', key: 'orderQty', width: 15 },
      { header: 'Đơn giá (VNĐ)', key: 'unitPrice', width: 16 },
      { header: 'Thành tiền (VNĐ)', key: 'totalPrice', width: 18 },
      { header: 'Quy tắc truy vết từ bản vẽ', key: 'sourceRule', width: 42 }
    ],
    stats.inferredAccessories.map(acc => ({
      sku: acc.sku,
      group: acc.group,
      name: acc.name,
      spec: acc.spec,
      unit: acc.unit,
      calcQty: acc.calculatedQty,
      orderQty: acc.orderQty,
      unitPrice: acc.unitPriceVnd,
      totalPrice: acc.totalPriceVnd,
      sourceRule: acc.sourceRule
    }))
  );

  // 5b. Theo_He_Thong (Multi-view System Summary)
  addStyledSheet(
    wb,
    'Theo_He_Thong',
    [
      { header: 'Hệ thống', key: 'systemLabel', width: 36 },
      { header: 'Thiết bị', key: 'deviceCount', width: 12 },
      { header: 'Tuyến cáp', key: 'cableCount', width: 12 },
      { header: 'Mét cáp đặt hàng (m)', key: 'cableMeters', width: 20 },
      { header: 'Công suất (W)', key: 'totalPowerWatts', width: 15 },
      { header: 'Dự toán (VNĐ)', key: 'estimatedCostVnd', width: 20 },
      { header: 'Chi tiết hạng mục', key: 'items', width: 45 }
    ],
    stats.systemRows.map(sys => ({
      systemLabel: sys.systemLabel,
      deviceCount: sys.deviceCount,
      cableCount: sys.cableCount,
      cableMeters: sys.cableMeters,
      totalPowerWatts: sys.totalPowerWatts,
      estimatedCostVnd: sys.estimatedCostVnd,
      items: sys.itemSummaries.join('; ')
    }))
  );

  // 6. Gia_Dinh_BOM (Input cells referenced by live Excel formulas)
  addStyledSheet(
    wb,
    'Gia_Dinh_BOM',
    [
      { header: 'Thông số giả định BOM', key: 'param', width: 40 },
      { header: 'Giá trị áp dụng', key: 'value', width: 18 },
      { header: 'Đơn vị', key: 'unit', width: 14 },
      { header: 'Giải thích công thức', key: 'note', width: 48 }
    ],
    [
      { param: 'Dự phòng mỗi đầu cáp (Service loop)', value: stats.assumptions.serviceLoopMetersPerEnd, unit: 'm / đầu', note: 'Cộng thêm 2 đầu mỗi tuyến trước khi nhân hao hụt' },
      { param: 'Hệ số hao hụt cáp đồng', value: stats.assumptions.copperLossPct, unit: '%', note: 'Áp dụng cho Cat6, Cat6A và dây nguồn' },
      { param: 'Hệ số hao hụt cáp quang', value: stats.assumptions.fiberLossPct, unit: '%', note: 'Áp dụng cho OS2 và OM4' },
      { param: 'Quy cách cuộn cáp đồng', value: stats.assumptions.copperSpoolMeters, unit: 'm / cuộn', note: 'Làm tròn lên số nguyên cuộn (mặc định 305m)' },
      { param: 'Quy cách cuộn cáp quang', value: stats.assumptions.fiberSpoolMeters, unit: 'm / cuộn', note: 'Làm tròn lên số nguyên cuộn (mặc định 1000m)' },
      { param: 'Hệ số dự phòng công suất UPS', value: stats.assumptions.upsHeadroomPct, unit: '%', note: 'Hệ số an toàn trước khi quy đổi VA (cos φ = 0.8)' },
      { param: 'Chiều cao thả trần / lên xuống (Drop)', value: stats.assumptions.dropHeightMeters, unit: 'm / đầu', note: 'Cộng 2 đầu mỗi tuyến (trừ DAC) trước khi nhân hao hụt' },
      { param: 'Chiều cao thông tầng chuẩn', value: stats.assumptions.floorHeightMeters, unit: 'm / tầng', note: 'Nhân với số tầng chênh lệch của tuyến cáp liên tầng' }
    ]
  );

  return wb;
}

export async function exportBomDetailedExcel(project: ProjectState, options?: BomFilterOptions) {
  const wb = buildDetailedBomExcelWorkbook(project, options);
  const fileName = `${project.name.replace(/\s+/g, '_')}_BOM_Du_Toan.xlsx`;
  await triggerWorkbookDownload(wb, fileName);
  trackExport('excel_bom');
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function extractCsvRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length && rows.length < MAX_EXCEL_IMPORT_ROWS + 1; i++) {
    const vals = parseCsvLine(lines[i]);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) rec[h] = vals[idx] || '';
    });
    rows.push(rec);
  }
  return rows;
}

function cellToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).trim();
  }
  if (typeof val === 'object') {
    if ('text' in val && typeof val.text === 'string') return val.text.trim();
    if ('result' in val && val.result !== undefined) return String(val.result).trim();
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map(rt => rt.text).join('').trim();
    }
  }
  return '';
}

/**
 * Parses uploaded Excel (.xlsx) or CSV file cleanly via ExcelJS and merges devices into project safely
 */
export async function parseExcelDevices(file: File, project: ProjectState): Promise<{
  newAssets: Record<string, DeviceAsset>;
  newNodes: DiagramNode[];
  updatedRacks: ServerRack[];
  importedCount: number;
}> {
  const sizeCheck = checkImportPayloadSize(file, MAX_EXCEL_FILE_BYTES, file.name || 'tệp Excel/CSV');
  if (!sizeCheck.ok) {
    throw new Error(sizeCheck.error);
  }
  const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
  let rawRows: Array<Record<string, string>> = [];

  if (isCsv) {
    const text = await file.text();
    rawRows = extractCsvRows(text);
  } else {
    const buffer = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    if (!wb.worksheets.length) {
      throw new Error('File Excel không có sheet dữ liệu nào.');
    }

    const ws =
      wb.worksheets.find(s => s.name.includes('Thiet_Bi') || s.name.includes('Devices')) ||
      wb.worksheets[0];

    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      headers[colNum] = cellToString(cell.value);
    });

    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      if (rawRows.length > MAX_EXCEL_IMPORT_ROWS) return;
      const rec: Record<string, string> = {};
      let hasAny = false;
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const key = headers[colNum];
        const val = cellToString(cell.value);
        if (key && val !== '') {
          rec[key] = val;
          hasAny = true;
        }
      });
      if (hasAny) rawRows.push(rec);
    });
  }

  if (rawRows.length === 0) {
    throw new Error('Sheet Excel/CSV trống, không tìm thấy dòng thiết bị nào.');
  }
  if (rawRows.length > MAX_EXCEL_IMPORT_ROWS) {
    throw new Error(`Số lượng dòng (${rawRows.length}) vượt quá giới hạn an toàn (${MAX_EXCEL_IMPORT_ROWS} dòng).`);
  }

  const newAssets = { ...project.assets };
  const newNodes = [...project.nodes];
  const updatedRacks = project.racks.map(r => ({
    ...r,
    slots: { ...r.slots },
    rearSlots: { ...(r.rearSlots || {}) }
  }));

  let dropX = 350;
  let dropY = 200;
  let importedCount = 0;

  rawRows.forEach((row, idx) => {
    const rawName = row['Tên Thiết Bị'] || row['Device Name'];
    if (!rawName && !row['Mã Tài Sản'] && !row['Mã Tài Sản (Asset Tag)']) return;

    importedCount++;
    const assetTag = String(row['Mã Tài Sản (Asset Tag)'] || row['Mã Tài Sản'] || `AST-${String(idx + 1).padStart(4, '0')}`);
    const name = String(rawName || `Device-${idx + 1}`);
    const category = String(row['Loại Thiết Bị'] || row['Phân Loại'] || 'switch').toLowerCase().trim();
    const vendor = String(row['Hãng Sản Xuất'] || row['Hãng'] || 'Cisco');
    const model = String(row['Model'] || 'Standard');
    const ipAddress = String(row['Địa Chỉ IP'] || row['IP Address'] || `192.168.10.${50 + idx}`);
    const subnetMask = String(row['Subnet Mask'] || '255.255.255.0');
    const gateway = String(row['Gateway'] || '192.168.10.1');
    const vlan = row['VLAN'] !== undefined && row['VLAN'] !== '' ? String(row['VLAN']) : '10';
    const powerWatts = parseInt(row['Công Suất (W)'], 10) || 150;
    const weightKg = parseFloat(row['Khối Lượng (kg)']) || 5;
    const uHeightRaw = parseInt(row['Số U'], 10);

    const assetId = `dev_import_${Date.now()}_${idx}`;
    const preset = DEVICE_CATALOG.find(d => d.category === category) || DEVICE_CATALOG[0];

    const rackName = row['Tủ Rack']?.trim();
    const sideRaw = String(row['Mặt Tủ (front/rear)'] || row['Mặt Tủ'] || 'front').toLowerCase();
    const rackSide: 'front' | 'rear' = sideRaw.includes('rear') || sideRaw.includes('sau') ? 'rear' : 'front';
    const uSlotRaw = row['Vị Trí U (1-42)'] || row['Vị Trí U'];
    const uSlot = uSlotRaw ? parseInt(uSlotRaw.replace(/\D/g, ''), 10) : undefined;

    let targetRackId: string | undefined = undefined;
    if (rackName) {
      const matchedRack = updatedRacks.find(r => r.name.toLowerCase().includes(rackName.toLowerCase()));
      if (matchedRack) {
        targetRackId = matchedRack.id;
        if (uSlot && uSlot >= 1 && uSlot <= matchedRack.totalUnits) {
          if (rackSide === 'rear') {
            matchedRack.rearSlots[uSlot] = assetId;
          } else {
            matchedRack.slots[uSlot] = assetId;
          }
        }
      }
    }

    const floorName = row['Tầng']?.trim();
    const matchedFloor = floorName ? project.floors.find(f => f.name.toLowerCase().includes(floorName.toLowerCase())) : undefined;
    const roomName = row['Phòng']?.trim();
    const matchedRoom = roomName ? project.rooms.find(r => r.name.toLowerCase().includes(roomName.toLowerCase())) : undefined;

    const ports: DevicePort[] = preset.defaultPorts.map((p, pIdx) => ({
      id: `port_${pIdx + 1}`,
      name: p.name,
      type: p.type,
      poe: p.poe,
      speed: p.speed,
      status: 'unlinked'
    }));

    const newAsset: DeviceAsset = {
      id: assetId,
      name,
      category: preset.category,
      vendor,
      model,
      assetTag,
      serialNumber: `SN${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
      ipAddress,
      subnetMask,
      gateway,
      macAddress: `00:50:56:${Math.floor(Math.random() * 90 + 10)}:${Math.floor(Math.random() * 90 + 10)}:FF`,
      vlan,
      status: 'online',
      powerWatts,
      weightKg,
      floorId: matchedFloor?.id || project.activeFloorId,
      roomId: matchedRoom?.id,
      rackId: targetRackId,
      rackUnitStart: uSlot,
      rackUnitHeight: !Number.isNaN(uHeightRaw) && uHeightRaw >= 1 ? uHeightRaw : (preset.defaultUHeight || 1),
      rackSide: targetRackId ? rackSide : undefined,
      ports
    };

    newAssets[assetId] = newAsset;

    newNodes.push({
      id: `node_import_${Date.now()}_${idx}`,
      diagramMode: project.activeMode,
      floorId: matchedFloor?.id || project.activeFloorId,
      type: 'device',
      assetId,
      label: name,
      x: dropX,
      y: dropY,
      width: preset.defaultWidth,
      height: preset.defaultHeight,
      rotation: 0,
      style: {
        backgroundColor: preset.color,
        borderColor: '#334155',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1,
        textColor: '#ffffff'
      }
    });

    dropX += 180;
    if (dropX > 900) {
      dropX = 350;
      dropY += 100;
    }
  });

  return { newAssets, newNodes, updatedRacks, importedCount };
}
