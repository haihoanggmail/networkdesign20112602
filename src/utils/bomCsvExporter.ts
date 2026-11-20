import { ProjectState } from '../types/infrastructure';
import {
  BomFilterOptions,
  computeProjectBomStats
} from './bomAggregator';
import { sanitizeArchiveBaseName } from './handoverBundle';
import { trackExport } from '../services/tracker';

export interface BomCsvSummary {
  assetCount: number;
  bomGroupCount: number;
  cableCount: number;
  totalCableMeters: number;
  totalCableWithReserveMeters: number;
  rackCount: number;
  rackComponentCount: number;
}

export interface BomCsvResult {
  csv: string;
  csvWithBom: string;
  filename: string;
  summary: BomCsvSummary;
}

/**
 * Escapes a CSV cell according to RFC-4180 and neutralizes spreadsheet formula injection.
 */
export function escapeBomCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);

  // Neutralize Excel/Calc formula injection (while keeping plain negative numbers untouched)
  if (/^[=+\t\r@]/.test(text) || (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text))) {
    text = `'${text}`;
  }

  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatCsvRow(cells: Array<string | number | boolean | null | undefined>): string {
  return cells.map(escapeBomCsvCell).join(',');
}

function sanitizeTsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
}

const BOM_TABLE_HEADERS = [
  'STT',
  'Nhóm Hạng Mục',
  'Mã SKU',
  'Phân Loại',
  'Hãng Sản Xuất',
  'Model / Quy Cách',
  'Thiết Bị / Mã Tuyến',
  'Đơn Vị',
  'Số Lượng',
  'Gốc / Chiều Dài Thực (m)',
  'Dự Phòng Cáp',
  'Kích Cỡ (U)',
  'Công Suất Đơn Vị (W)',
  'Tổng Công Suất (W)',
  'Tổng Khối Lượng (kg)',
  'Đơn Giá (VNĐ)',
  'Thành Tiền (VNĐ)',
  'Ghi Chú'
];

function buildUnifiedBomRows(
  project: ProjectState,
  options?: BomFilterOptions
): {
  headers: string[];
  rows: Array<Array<string | number>>;
  stats: ReturnType<typeof computeProjectBomStats>;
} {
  const stats = computeProjectBomStats(project, options);
  const rows: Array<Array<string | number>> = [];
  let stt = 1;

  // 1. Devices & Rack Cabinets (grouped by category + vendor + model)
  for (const row of stats.deviceRows) {
    rows.push([
      stt++,
      'Thiết bị & Tủ Rack',
      row.sku,
      row.categoryLabel,
      row.vendor,
      row.model,
      row.devicePreviews.join('; '),
      row.unit,
      row.quantity,
      '',
      '',
      row.uSizeLabel,
      row.unitWatts,
      row.totalWatts,
      row.totalWeightKg,
      row.unitPriceVnd,
      row.totalPriceVnd,
      row.floorNames.join('; ')
    ]);
  }

  // 2. Cable Types & Lengths (with reserve + spool estimate)
  for (const cb of stats.cableRows) {
    const rollNote = cb.estimatedSpools && cb.spoolLengthMeters
      ? `~${cb.estimatedSpools} cuộn (${cb.spoolLengthMeters}m)`
      : `${cb.count} tuyến`;
    const extraParts: string[] = [];
    if (cb.verticalRiseMeters > 0) extraParts.push(`+${cb.verticalRiseMeters}m vượt tầng`);
    if (cb.dropHeightMeters > 0) extraParts.push(`+${cb.dropHeightMeters}m thả trần`);
    if (cb.serviceLoopMeters > 0) extraParts.push(`+${cb.serviceLoopMeters}m đầu cáp`);
    const extraSuffix = extraParts.length > 0 ? ` (${extraParts.join(', ')})` : ` (${cb.reserveMeters} m)`;
    rows.push([
      stt++,
      'Dây cáp & Đấu nối',
      cb.sku,
      'Cáp kết nối',
      cb.supplier,
      cb.label,
      cb.cableCodes.join('; '),
      'Mét (m)',
      cb.totalWithReserveMeters,
      cb.rawMeters,
      `+${cb.lossPct}%${extraSuffix}`,
      '—',
      0,
      0,
      0,
      cb.unitPriceVnd,
      cb.totalPriceVnd,
      rollNote
    ]);
  }

  // 3. Inferred Installation & Tray Accessories
  for (const acc of stats.inferredAccessories) {
    rows.push([
      stt++,
      'Phụ kiện & Máng cáp',
      acc.sku,
      acc.group,
      acc.supplier,
      acc.name,
      acc.spec,
      acc.unit,
      acc.orderQty,
      '',
      '',
      '—',
      0,
      0,
      0,
      acc.unitPriceVnd,
      acc.totalPriceVnd,
      acc.sourceRule
    ]);
  }

  // 4. Mounted Rack Components (Front & Rear slots)
  for (const comp of stats.rackComponents) {
    const endU = comp.uHeight > 1 ? `U${comp.startU}-U${comp.startU + comp.uHeight - 1}` : `U${comp.startU}`;
    rows.push([
      stt++,
      'Thành phần Tủ Rack',
      comp.assetTag || '—',
      comp.categoryLabel,
      comp.vendor || '—',
      comp.model || comp.deviceName,
      comp.assetTag ? `${comp.deviceName} (${comp.assetTag})` : comp.deviceName,
      'Vị trí U',
      1,
      '',
      '',
      `${comp.uHeight}U`,
      comp.powerWatts,
      comp.powerWatts,
      comp.weightKg,
      0,
      0,
      `${comp.rackName} · ${comp.sideLabel} · ${endU}`
    ]);
  }

  return {
    headers: BOM_TABLE_HEADERS,
    rows,
    stats
  };
}

/**
 * Generates a clean, uniform tabular BOM CSV summarizing all assets, cable lengths,
 * and mounted front/rear rack components so Microsoft Excel renders crisp columns immediately.
 */
export function buildBomCsvContent(
  project: ProjectState,
  _exportedAtIso?: string,
  options?: BomFilterOptions
): BomCsvResult {
  const { headers, rows, stats } = buildUnifiedBomRows(project, options);
  const lines: string[] = [formatCsvRow(headers)];

  if (rows.length === 0) {
    lines.push(formatCsvRow(['—', 'Chưa có vật tư nào phù hợp trong dự án']));
  } else {
    for (const r of rows) {
      lines.push(formatCsvRow(r));
    }
    lines.push(
      formatCsvRow([
        '',
        'TỔNG CỘNG DỰ ÁN',
        '',
        project.name || 'HACHIHI Project',
        '',
        `${stats.deviceRows.length} chủng loại TB · ${stats.cableRows.length} loại cáp`,
        `${stats.kpis.rackComponentCount} thành phần Rack`,
        '',
        stats.kpis.deviceCount + stats.kpis.rackCount,
        stats.kpis.rawCableMeters,
        `+${stats.reservePct}% -> ${stats.kpis.totalCableWithReserveMeters} m`,
        `${stats.kpis.usedRackU}/${stats.kpis.totalRackU}U`,
        '',
        stats.kpis.totalPowerWatts,
        stats.kpis.totalWeightKg,
        '',
        stats.kpis.estimatedGrandTotalVnd,
        `Đề xuất UPS >= ${stats.kpis.recommendedUpsVa} VA`
      ])
    );

    if (stats.quotation.auxMaterialPct > 0 || stats.quotation.laborWorkdays > 0) {
      lines.push(
        formatCsvRow([
          '',
          'Vật tư phụ thi công',
          '',
          `Hạt mạng, dây thít, ống ruột gà (+${stats.quotation.auxMaterialPct}%)`,
          '',
          `${stats.quotation.auxMaterialPct}% × ${stats.quotation.materialSubtotalVnd}`,
          '',
          '%',
          stats.quotation.auxMaterialPct,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          stats.quotation.auxMaterialCostVnd,
          'Hệ số vật tư phụ'
        ])
      );
      lines.push(
        formatCsvRow([
          '',
          'Nhân công thi công',
          '',
          'Chi phí nhân công lắp đặt & cấu hình',
          '',
          `${stats.quotation.laborWorkdays} công`,
          '',
          'Công',
          stats.quotation.laborWorkdays,
          '',
          '',
          '',
          '',
          '',
          '',
          stats.quotation.laborUnitPriceVnd,
          stats.quotation.laborTotalVnd,
          'Số công × Đơn giá nhân công'
        ])
      );
      lines.push(
        formatCsvRow([
          '',
          'TỔNG BÁO GIÁ HOÀN THIỆN',
          '',
          project.name || 'HACHIHI Project',
          '',
          'Vật tư + Vật tư phụ + Nhân công',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          stats.quotation.finalQuotationTotalVnd,
          'Tổng báo giá chốt thi công (chưa VAT)'
        ])
      );
    }
  }

  const csv = lines.join('\r\n');
  const baseName = sanitizeArchiveBaseName(project.name || 'HACHIHI_Project');

  return {
    csv,
    csvWithBom: `\uFEFF${csv}`,
    filename: `${baseName}_BOM.csv`,
    summary: {
      assetCount: Object.keys(project.assets || {}).length,
      bomGroupCount: stats.deviceRows.length,
      cableCount: stats.kpis.cableCount,
      totalCableMeters: stats.kpis.rawCableMeters,
      totalCableWithReserveMeters: stats.kpis.totalCableWithReserveMeters,
      rackCount: stats.kpis.rackCount,
      rackComponentCount: stats.kpis.rackComponentCount
    }
  };
}

/**
 * Builds clean Tab-Separated Values (TSV) for one-click "Sao chép BOM" clipboard paste into Excel.
 */
export function formatBomTsvForClipboard(
  project: ProjectState,
  options?: BomFilterOptions
): string {
  const { headers, rows } = buildUnifiedBomRows(project, options);
  const tsvLines = [
    headers.map(sanitizeTsvCell).join('\t'),
    ...rows.map(r => r.map(sanitizeTsvCell).join('\t'))
  ];
  return tsvLines.join('\n');
}

/**
 * Generates and downloads a UTF-8 BOM CSV file summarizing assets, cable lengths, and rack components.
 */
export function exportProjectBomCsv(
  project: ProjectState,
  options?: BomFilterOptions
): { filename: string; summary: BomCsvSummary } {
  const result = buildBomCsvContent(project, undefined, options);
  const blob = new Blob([result.csvWithBom], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  trackExport('bom_csv');
  return {
    filename: result.filename,
    summary: result.summary
  };
}
