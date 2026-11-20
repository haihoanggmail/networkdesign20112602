import ExcelJS from 'exceljs';
import {
  Building,
  CableEdge,
  CableType,
  DeviceAsset,
  DeviceCategory,
  DevicePort,
  DiagramNode,
  Floor,
  ProjectState,
  Room
} from '../types/infrastructure';
import { DEVICE_CATALOG } from '../data/deviceCatalog';
import { DEFAULT_CANVAS_SETTINGS } from './projectStorage';
import { checkImportPayloadSize, MAX_EXCEL_FILE_BYTES } from './security';
import { trackExport, trackTemplate } from '../services/tracker';

export type TreeLayoutMode = 'vertical' | 'horizontal' | 'by_floor';
export type TreeApplyMode = 'new_project' | 'merge';

export interface ParsedRouterTreeRow {
  rowIndex: number;
  name: string;
  parents: string[];
  category: DeviceCategory;
  vendor: string;
  model: string;
  ipAddress: string;
  subnetMask: string;
  gateway: string;
  vlan: string;
  floorName: string;
  cableType: CableType;
  cableLabel: string;
  bandwidth: CableEdge['bandwidth'];
  parentPort: string;
  localPort: string;
  powerWatts: number;
  notes: string;
}

export interface RouterTreeLinkInfo {
  id: string;
  parentName: string;
  childName: string;
  cableType: CableType;
  cableLabel: string;
  bandwidth: CableEdge['bandwidth'];
  parentPort: string;
  localPort: string;
  isCrossFloor: boolean;
}

export interface RouterTreeNodeInfo extends ParsedRouterTreeRow {
  depth: number; // 1-based (T1 = root, T2, T3...)
  childNames: string[];
  totalDescendantCount: number;
  parentLinks: RouterTreeLinkInfo[];
  missingParents: string[];
}

export interface ParsedRouterTreeResult {
  fileName: string;
  suggestedProjectName: string;
  nodes: RouterTreeNodeInfo[];
  links: RouterTreeLinkInfo[];
  floors: string[];
  maxDepth: number;
  rootNames: string[];
  warnings: string[];
}

export interface ComputedTreeLayout {
  positions: Map<string, { x: number; y: number; width: number; height: number }>;
  floorBands: Array<{ floorName: string; x: number; y: number; width: number; height: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const MAX_TREE_ROWS = 500;

const SAMPLE_ROUTER_TREE_ROWS: Array<Record<string, string | number>> = [
  {
    name: 'Router-A1',
    parent: '',
    category: 'router',
    vendor: 'MikroTik',
    model: 'CCR2116-12G-4S+',
    ip: '10.0.0.1',
    vlan: '1, 10, 20',
    floor: 'Tầng 1',
    cableType: 'Quang OS2 (10G)',
    parentPort: '',
    localPort: '',
    watts: 85,
    notes: 'Router Gốc (Uplink Trung tâm)'
  },
  {
    name: 'Router-B1',
    parent: 'Router-A1',
    category: 'core_switch',
    vendor: 'Cisco',
    model: 'Catalyst C9500-24Y4C',
    ip: '10.1.0.1',
    vlan: '10',
    floor: 'Tầng 2',
    cableType: 'Quang OS2 (10G)',
    parentPort: 'SFP+1',
    localPort: 'SFP+1',
    watts: 140,
    notes: 'Phân phối chính Tầng 2'
  },
  {
    name: 'Router-B2',
    parent: 'Router-A1',
    category: 'core_switch',
    vendor: 'Cisco',
    model: 'Catalyst C9500-24Y4C',
    ip: '10.2.0.1',
    vlan: '20',
    floor: 'Tầng 2',
    cableType: 'Quang OS2 (10G)',
    parentPort: 'SFP+2',
    localPort: 'SFP+1',
    watts: 140,
    notes: 'Phân phối dự phòng Tầng 2'
  },
  {
    name: 'Router-C1',
    parent: 'Router-B1',
    category: 'switch',
    vendor: 'Aruba',
    model: 'CX 6200F 24G',
    ip: '10.1.1.1',
    vlan: '10',
    floor: 'Tầng 3',
    cableType: 'Cat6A STP (10G)',
    parentPort: 'eth1',
    localPort: 'wan1',
    watts: 65,
    notes: 'Switch nhánh C1'
  },
  {
    name: 'Router-C2',
    parent: 'Router-B1',
    category: 'switch',
    vendor: 'Aruba',
    model: 'CX 6200F 24G',
    ip: '10.1.2.1',
    vlan: '10',
    floor: 'Tầng 3',
    cableType: 'Cat6A STP (10G)',
    parentPort: 'eth2',
    localPort: 'wan1',
    watts: 65,
    notes: 'Switch nhánh C2 (kết nối xuống tầng 4)'
  },
  {
    name: 'Router-C3',
    parent: 'Router-B1',
    category: 'switch',
    vendor: 'Aruba',
    model: 'CX 6200F 24G',
    ip: '10.1.3.1',
    vlan: '10',
    floor: 'Tầng 3',
    cableType: 'Cat6A STP (10G)',
    parentPort: 'eth3',
    localPort: 'wan1',
    watts: 65,
    notes: 'Switch nhánh C3'
  },
  {
    name: 'Router-C4',
    parent: 'Router-B1',
    category: 'switch',
    vendor: 'Aruba',
    model: 'CX 6200F 24G',
    ip: '10.1.4.1',
    vlan: '10',
    floor: 'Tầng 3',
    cableType: 'Cat6A STP (10G)',
    parentPort: 'eth4',
    localPort: 'wan1',
    watts: 65,
    notes: 'Switch nhánh C4'
  },
  {
    name: 'Router-D1',
    parent: 'Router-C2',
    category: 'ap',
    vendor: 'Ubiquiti',
    model: 'UniFi U6-Pro',
    ip: '10.1.2.11',
    vlan: '30',
    floor: 'Tầng 4',
    cableType: 'Cat6 UTP (1G)',
    parentPort: 'lan1',
    localPort: 'wan1',
    watts: 18,
    notes: 'Điểm truy cập tầng 4 - Khu A'
  },
  {
    name: 'Router-D2',
    parent: 'Router-C2',
    category: 'ap',
    vendor: 'Ubiquiti',
    model: 'UniFi U6-Pro',
    ip: '10.1.2.12',
    vlan: '30',
    floor: 'Tầng 4',
    cableType: 'Cat6 UTP (1G)',
    parentPort: 'lan2',
    localPort: 'wan1',
    watts: 18,
    notes: 'Điểm truy cập tầng 4 - Khu B'
  },
  {
    name: 'Router-D3',
    parent: 'Router-C2',
    category: 'ap',
    vendor: 'Ubiquiti',
    model: 'UniFi U6-Pro',
    ip: '10.1.2.13',
    vlan: '30',
    floor: 'Tầng 4',
    cableType: 'Cat6 UTP (1G)',
    parentPort: 'lan3',
    localPort: 'wan1',
    watts: 18,
    notes: 'Điểm truy cập tầng 4 - Khu C'
  }
];

function stripAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
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

function parseCsvLine(line: string, delimiter: ',' | ';' = ','): string[] {
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
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectExplicitCategory(raw: string): DeviceCategory | null {
  const s = stripAccents(raw);
  if (!s) return null;
  if (s.includes('core')) return 'core_switch';
  if (s.includes('firewall') || s.includes('tuong lua') || /\bfw\b/.test(s)) return 'firewall';
  if (s.includes('router') || s.includes('dinh tuyen') || /\brt\b/.test(s)) return 'router';
  if (s.includes('switch') || s.includes('chia mang') || /\bsw\b/.test(s)) return 'switch';
  if (/\bap\b/.test(s) || s.includes('wifi') || s.includes('wi-fi') || s.includes('access point')) return 'ap';
  if (s.includes('cam bien') || s.includes('sensor')) return 'sensor';
  if (s.includes('cam')) return 'camera';
  if (s.includes('nvr') || s.includes('dau ghi')) return 'nvr';
  if (s.includes('server') || s.includes('may chu')) return 'server';
  if (s.includes('storage') || s.includes('nas') || s.includes('san')) return 'storage';
  if (s.includes('odf')) return 'odf';
  if (s.includes('patch')) return 'patch_panel';
  if (s.includes('ups') || s.includes('luu dien')) return 'ups';
  if (s.includes('pdu')) return 'pdu';
  if (s.includes('gateway')) return 'gateway';
  if (s.includes('iot')) return 'iot';
  if (s.includes('printer') || s.includes('may in')) return 'printer';
  if (
    /\bpc\b/.test(s) ||
    s.includes('workstation') ||
    s.includes('laptop') ||
    s.includes('desktop') ||
    s.includes('may tinh') ||
    s.includes('ip phone')
  ) {
    return 'workstation';
  }
  if (s.includes('cloud') || s.includes('internet') || s.includes('wan')) return 'cloud';
  return null;
}

function normalizeCategory(raw: string): DeviceCategory {
  return detectExplicitCategory(raw) ?? 'router';
}

function normalizeCableSpec(raw: string): {
  cableType: CableType;
  cableLabel: string;
  bandwidth: CableEdge['bandwidth'];
} {
  const trimmed = raw.trim();
  const s = stripAccents(trimmed);
  if (s.includes('os2') || s.includes('single') || s.includes('quang') || s.includes('fiber')) {
    if (s.includes('om4') || s.includes('multi')) {
      return { cableType: 'FIBER_MM_OM4', cableLabel: trimmed || 'Quang OM4 (10G)', bandwidth: '10G' };
    }
    const bw: CableEdge['bandwidth'] = s.includes('100g')
      ? '100G'
      : s.includes('40g')
      ? '40G'
      : s.includes('25g')
      ? '25G'
      : '10G';
    return { cableType: 'FIBER_SM_OS2', cableLabel: trimmed || 'Quang OS2 (10G)', bandwidth: bw };
  }
  if (s.includes('cat6a') || s.includes('stp')) {
    return { cableType: 'CAT6A_STP', cableLabel: trimmed || 'Cat6A STP (10G)', bandwidth: '10G' };
  }
  if (s.includes('dac')) {
    return { cableType: 'DAC_10G', cableLabel: trimmed || 'DAC 10G', bandwidth: '10G' };
  }
  if (s.includes('power') || s.includes('nguon') || s.includes('ac')) {
    return { cableType: 'POWER_AC', cableLabel: trimmed || 'Nguồn AC', bandwidth: '1G' };
  }
  return { cableType: 'CAT6_UTP', cableLabel: trimmed || 'Cat6 UTP (1G)', bandwidth: '1G' };
}

function getColumnValue(row: Record<string, string>, aliases: string[]): string {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const target = stripAccents(alias);
    const matchedKey = keys.find(k => {
      const nk = stripAccents(k);
      return nk === target || nk.includes(target);
    });
    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey].trim() !== '') {
      return row[matchedKey].trim();
    }
  }
  return '';
}

function buildRouterTreeResultFromRows(
  rawRows: Array<Record<string, string>>,
  fileName: string
): ParsedRouterTreeResult {
  const warnings: string[] = [];
  const parsedRows: ParsedRouterTreeRow[] = [];
  const seenNames = new Set<string>();

  rawRows.forEach((row, idx) => {
    const rawName = getColumnValue(row, [
      'ten thiet bi',
      'thiet bi',
      'ten router',
      'router',
      'device name',
      'name',
      'node'
    ]);
    if (!rawName) return;

    const cleanName = rawName.trim();
    if (seenNames.has(cleanName.toLowerCase())) {
      warnings.push(`Dòng ${idx + 2}: Thiết bị "${cleanName}" bị trùng tên — bỏ qua dòng trùng.`);
      return;
    }
    seenNames.add(cleanName.toLowerCase());

    const parentRaw = getColumnValue(row, [
      'router cha',
      'thiet bi cha',
      'cha (uplink)',
      'uplink',
      'parent'
    ]);
    const parents = parentRaw
      ? parentRaw
          .split(/[,;]+/)
          .map(p => p.trim())
          .filter(Boolean)
      : [];

    const categoryRaw = getColumnValue(row, ['loai thiet bi', 'phan loai', 'category', 'type']);
    const vendor = getColumnValue(row, ['hang san xuat', 'hang', 'vendor']) || 'MikroTik';
    const model = getColumnValue(row, ['model', 'ma hieu']) || 'Standard';
    const ipAddress = getColumnValue(row, ['dia chi ip', 'ip address', 'ip']) || `10.0.${Math.floor(idx / 200)}.${(idx % 200) + 1}`;
    const subnetMask = getColumnValue(row, ['subnet mask', 'mask']) || '255.255.255.0';
    const gateway = getColumnValue(row, ['gateway']) || '10.0.0.1';
    const vlan = getColumnValue(row, ['vlan']) || '10';
    const floorName = getColumnValue(row, ['tang / khu vuc', 'tang', 'khu vuc', 'floor']) || 'Tầng 1';
    const cableRaw = getColumnValue(row, ['loai cap', 'cap ket noi', 'cable type', 'cable']) || 'Cat6 UTP (1G)';
    const cableSpec = normalizeCableSpec(cableRaw);
    const parentPort = getColumnValue(row, ['cong cha', 'cong uplink', 'parent port', 'source port']) || '';
    const localPort = getColumnValue(row, ['cong con', 'cong thiet bi', 'local port', 'target port']) || '';
    const wattsRaw = parseInt(getColumnValue(row, ['cong suat', 'watts', 'power']), 10);
    const notes = getColumnValue(row, ['ghi chu', 'notes', 'mo ta']);

    parsedRows.push({
      rowIndex: idx + 1,
      name: cleanName,
      parents,
      category: categoryRaw ? normalizeCategory(categoryRaw) : parents.length === 0 ? 'router' : 'switch',
      vendor,
      model,
      ipAddress,
      subnetMask,
      gateway,
      vlan,
      floorName,
      cableType: cableSpec.cableType,
      cableLabel: cableSpec.cableLabel,
      bandwidth: cableSpec.bandwidth,
      parentPort,
      localPort,
      powerWatts: Number.isFinite(wattsRaw) && wattsRaw > 0 ? wattsRaw : 45,
      notes
    });
  });

  if (parsedRows.length === 0) {
    throw new Error('Không tìm thấy thiết bị hợp lệ nào trong file Excel (cần có cột "Tên Thiết Bị" / "Thiết bị").');
  }

  const rowByLowerName = new Map<string, ParsedRouterTreeRow>();
  parsedRows.forEach(r => rowByLowerName.set(r.name.toLowerCase(), r));

  const childrenMap = new Map<string, string[]>();
  parsedRows.forEach(r => childrenMap.set(r.name, []));

  const links: RouterTreeLinkInfo[] = [];
  const missingParentsMap = new Map<string, string[]>();

  parsedRows.forEach(row => {
    const missing: string[] = [];
    row.parents.forEach((pName, pIdx) => {
      const parentRow = rowByLowerName.get(pName.toLowerCase());
      if (!parentRow) {
        missing.push(pName);
        warnings.push(`"${row.name}" tham chiếu Router Cha "${pName}" không có trong bảng.`);
        return;
      }
      if (parentRow.name === row.name) {
        warnings.push(`"${row.name}" tự trỏ tới chính mình — bỏ qua liên kết vòng.`);
        return;
      }
      const list = childrenMap.get(parentRow.name) || [];
      if (!list.includes(row.name)) list.push(row.name);
      childrenMap.set(parentRow.name, list);

      links.push({
        id: `link_${parentRow.name}_${row.name}_${pIdx}`,
        parentName: parentRow.name,
        childName: row.name,
        cableType: row.cableType,
        cableLabel: row.cableLabel,
        bandwidth: row.bandwidth,
        parentPort: row.parentPort || (row.cableType.startsWith('FIBER') ? `SFP+${list.length}` : `eth${list.length}`),
        localPort: row.localPort || (row.cableType.startsWith('FIBER') ? 'SFP+1' : 'wan1'),
        isCrossFloor: parentRow.floorName.toLowerCase() !== row.floorName.toLowerCase()
      });
    });
    missingParentsMap.set(row.name, missing);
  });

  // Compute depths via BFS from roots (nodes with no valid parents)
  const validParentsOf = new Map<string, string[]>();
  parsedRows.forEach(r => {
    const valids = r.parents
      .map(p => rowByLowerName.get(p.toLowerCase())?.name)
      .filter((p): p is string => Boolean(p && p !== r.name));
    validParentsOf.set(r.name, valids);
  });

  const roots = parsedRows.filter(r => (validParentsOf.get(r.name) || []).length === 0);
  if (roots.length === 0 && parsedRows.length > 0) {
    roots.push(parsedRows[0]);
    warnings.push(`Phát hiện vòng lặp phân cấp; chọn "${parsedRows[0].name}" làm nút gốc tạm thời.`);
  }

  const depthMap = new Map<string, number>();
  const queue: Array<{ name: string; depth: number }> = roots.map(r => ({ name: r.name, depth: 1 }));
  roots.forEach(r => depthMap.set(r.name, 1));

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const kids = childrenMap.get(cur.name) || [];
    for (const kid of kids) {
      const nextDepth = cur.depth + 1;
      const prevDepth = depthMap.get(kid);
      if (prevDepth === undefined || (nextDepth < prevDepth && nextDepth <= 20)) {
        depthMap.set(kid, nextDepth);
        queue.push({ name: kid, depth: nextDepth });
      }
    }
  }
  parsedRows.forEach(r => {
    if (!depthMap.has(r.name)) depthMap.set(r.name, 1);
  });

  // Compute total descendants safely (cycle-guarded)
  const countDescendants = (startName: string): number => {
    const visited = new Set<string>([startName]);
    const q = [...(childrenMap.get(startName) || [])];
    let count = 0;
    while (q.length > 0) {
      const n = q.shift()!;
      if (visited.has(n)) continue;
      visited.add(n);
      count++;
      for (const k of childrenMap.get(n) || []) {
        if (!visited.has(k)) q.push(k);
      }
    }
    return count;
  };

  const linksByChild = new Map<string, RouterTreeLinkInfo[]>();
  links.forEach(l => {
    const arr = linksByChild.get(l.childName) || [];
    arr.push(l);
    linksByChild.set(l.childName, arr);
  });

  const nodes: RouterTreeNodeInfo[] = parsedRows.map(r => ({
    ...r,
    depth: depthMap.get(r.name) || 1,
    childNames: childrenMap.get(r.name) || [],
    totalDescendantCount: countDescendants(r.name),
    parentLinks: linksByChild.get(r.name) || [],
    missingParents: missingParentsMap.get(r.name) || []
  }));

  const floors: string[] = [];
  nodes.forEach(n => {
    if (!floors.includes(n.floorName)) floors.push(n.floorName);
  });

  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 1);
  const suggestedProjectName = fileName.replace(/\.(xlsx|csv|xls)$/i, '') || 'So_Do_Router_Da_Tang';

  return {
    fileName,
    suggestedProjectName,
    nodes,
    links,
    floors,
    maxDepth,
    rootNames: roots.map(r => r.name),
    warnings
  };
}

/**
 * Generates the default 4-floor multi-tier Router Parent-Child sample preview directly
 */
export function buildSampleRouterTreePreview(): ParsedRouterTreeResult {
  const stringRows: Array<Record<string, string>> = SAMPLE_ROUTER_TREE_ROWS.map(r => ({
    'Tên Thiết Bị': String(r.name),
    'Router Cha': String(r.parent),
    'Loại Thiết Bị': String(r.category),
    'Hãng Sản Xuất': String(r.vendor),
    'Model': String(r.model),
    'Địa Chỉ IP': String(r.ip),
    'VLAN': String(r.vlan),
    'Tầng / Khu Vực': String(r.floor),
    'Loại Cáp': String(r.cableType),
    'Cổng Cha': String(r.parentPort),
    'Cổng Con': String(r.localPort),
    'Công Suất (W)': String(r.watts),
    'Ghi Chú': String(r.notes)
  }));
  return buildRouterTreeResultFromRows(stringRows, 'HACHIHI_Mau_So_Do_Router_Da_Tang.xlsx');
}

type ExcelRouterTreeExportRow = {
  name: string;
  parent: string;
  category: string;
  vendor: string;
  model: string;
  ip: string;
  vlan: string;
  floor: string;
  cableType: string;
  parentPort: string;
  localPort: string;
  watts: number;
  notes: string;
};

function formatCableTypeForExcel(cableType: CableType): string {
  switch (cableType) {
    case 'FIBER_SM_OS2':
      return 'Quang OS2 (10G)';
    case 'FIBER_MM_OM4':
      return 'Quang OM4 (10G)';
    case 'CAT6A_STP':
      return 'Cat6A STP (10G)';
    case 'DAC_10G':
      return 'DAC 10G';
    case 'POWER_AC':
      return 'Nguồn AC';
    default:
      return 'Cat6 UTP (1G)';
  }
}

function buildWorkbookFromRouterTreeRows(rows: ExcelRouterTreeExportRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HACHIHI Network & Electrical Designer';

  const ws = wb.addWorksheet('So_Do_Router_Cay', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  const columns = [
    { header: 'Tên Thiết Bị', key: 'name', width: 22 },
    { header: 'Router Cha', key: 'parent', width: 22 },
    { header: 'Loại Thiết Bị', key: 'category', width: 16 },
    { header: 'Hãng Sản Xuất', key: 'vendor', width: 16 },
    { header: 'Model', key: 'model', width: 24 },
    { header: 'Địa Chỉ IP', key: 'ip', width: 16 },
    { header: 'VLAN', key: 'vlan', width: 14 },
    { header: 'Tầng / Khu Vực', key: 'floor', width: 18 },
    { header: 'Loại Cáp', key: 'cableType', width: 20 },
    { header: 'Cổng Cha', key: 'parentPort', width: 12 },
    { header: 'Cổng Con', key: 'localPort', width: 12 },
    { header: 'Công Suất (W)', key: 'watts', width: 14 },
    { header: 'Ghi Chú', key: 'notes', width: 36 }
  ];

  ws.columns = columns;
  rows.forEach(r => ws.addRow(r));

  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF155EEF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  const guideWs = wb.addWorksheet('Huong_Dan_Nhap');
  guideWs.columns = [
    { header: 'Mục / Cột', key: 'col', width: 26 },
    { header: 'Bắt buộc', key: 'req', width: 14 },
    { header: 'Hướng dẫn nhập liệu', key: 'desc', width: 68 }
  ];
  [
    { col: 'Tên Thiết Bị', req: 'Có', desc: 'Tên duy nhất của Router / Switch / AP (VD: Router-A1, SW-T2-01).' },
    { col: 'Router Cha', req: 'Tùy chọn', desc: 'Để trống nếu là Router Gốc (T1). Nếu có nhiều đường uplink dự phòng, nhập cách nhau bởi dấu phẩy (VD: Router-A1, Router-A2).' },
    { col: 'Loại Thiết Bị', req: 'Tùy chọn', desc: 'router, core_switch, switch, ap, firewall, server, camera, workstation, odf...' },
    { col: 'Tầng / Khu Vực', req: 'Tùy chọn', desc: 'Tên tầng hoặc khu vực (VD: Tầng 1, Tầng 2). Các kết nối khác tầng sẽ tự đánh dấu (Liên tầng).' },
    { col: 'Loại Cáp', req: 'Tùy chọn', desc: 'Quang OS2 (10G), Quang OM4 (10G), Cat6A STP (10G), Cat6 UTP (1G), DAC 10G.' },
    { col: 'Cổng Cha / Cổng Con', req: 'Tùy chọn', desc: 'Tên cổng đấu nối hai đầu (VD: SFP+1 và wan1). Tự động điền nếu để trống.' }
  ].forEach(r => guideWs.addRow(r));

  const guideHeader = guideWs.getRow(1);
  guideHeader.height = 22;
  guideHeader.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  });

  return wb;
}

/**
 * Builds the standard 2-sheet Excel template: So_Do_Router_Cay + Huong_Dan_Nhap
 */
export function buildRouterTreeTemplateWorkbook(): ExcelJS.Workbook {
  return buildWorkbookFromRouterTreeRows(SAMPLE_ROUTER_TREE_ROWS as ExcelRouterTreeExportRow[]);
}

async function downloadWorkbookAsXlsx(wb: ExcelJS.Workbook, fileName: string): Promise<void> {
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
 * Downloads the standard 2-sheet Excel template: So_Do_Router_Cay + Huong_Dan_Nhap
 */
export async function downloadRouterTreeExcelTemplate() {
  const wb = buildRouterTreeTemplateWorkbook();
  await downloadWorkbookAsXlsx(wb, 'HACHIHI_Mau_So_Do_Router_Da_Tang.xlsx');
  trackTemplate('excel_router');
}

const CATEGORY_HIERARCHY_RANK: Record<DeviceCategory, number> = {
  cloud: 0,
  telecom_tower: 0,
  gateway: 1,
  router: 1,
  firewall: 2,
  core_switch: 3,
  switch: 4,
  odf: 4,
  patch_panel: 4,
  server: 5,
  storage: 5,
  nvr: 5,
  ap: 6,
  camera: 6,
  sensor: 6,
  iot: 6,
  ups: 6,
  pdu: 6,
  electrical_panel: 6,
  workstation: 7,
  printer: 7,
  rack: 8
};

/**
 * Extracts the active ProjectState topology into a parent-child Router Tree model
 * compatible with preview tabs and round-trip Excel export/import.
 */
export function extractRouterTreeFromProject(project: ProjectState): ParsedRouterTreeResult {
  const exportableNodes = (project.nodes || []).filter(
    n => n.type === 'device' || n.type === 'cloud' || n.type === 'telecom_tower'
  );

  if (exportableNodes.length === 0) {
    throw new Error('Dự án hiện tại chưa có thiết bị nào trên bản vẽ để trích xuất Cây Router.');
  }

  const floorNameById = new Map<string, string>();
  (project.floors || []).forEach(f => floorNameById.set(f.id, f.name));

  // Guarantee unique device names for clean parent-child referencing
  const usedNames = new Map<string, number>();
  const uniqueNameByNodeId = new Map<string, string>();

  exportableNodes.forEach(node => {
    const baseName = (node.label || project.assets?.[node.assetId || '']?.name || node.id).trim();
    const key = baseName.toLowerCase();
    const count = usedNames.get(key) || 0;
    usedNames.set(key, count + 1);
    uniqueNameByNodeId.set(node.id, count === 0 ? baseName : `${baseName} (${count + 1})`);
  });

  const nodeById = new Map(exportableNodes.map(n => [n.id, n]));
  const getNodeCategory = (node: DiagramNode): DeviceCategory => {
    const asset = node.assetId ? project.assets?.[node.assetId] : undefined;
    if (asset?.category) return asset.category;
    if (node.type === 'cloud') return 'cloud';
    if (node.type === 'telecom_tower') return 'telecom_tower';
    return detectExplicitCategory(node.label || '') ?? 'switch';
  };

  // Orient edges from upper-tier parent to lower-tier child without introducing cycles
  const parentsMap = new Map<string, Array<{ parentId: string; cable: CableEdge; parentIsSource: boolean }>>();
  const childrenGraph = new Map<string, Set<string>>();
  exportableNodes.forEach(n => {
    parentsMap.set(n.id, []);
    childrenGraph.set(n.id, new Set());
  });

  const hasPath = (startId: string, targetId: string): boolean => {
    if (startId === targetId) return true;
    const visited = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of childrenGraph.get(cur) || []) {
        if (next === targetId) return true;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };

  (project.cables || []).forEach(cable => {
    const srcNode = nodeById.get(cable.sourceNodeId);
    const tgtNode = nodeById.get(cable.targetNodeId);
    if (!srcNode || !tgtNode || srcNode.id === tgtNode.id) return;

    const srcRank = CATEGORY_HIERARCHY_RANK[getNodeCategory(srcNode)] ?? 5;
    const tgtRank = CATEGORY_HIERARCHY_RANK[getNodeCategory(tgtNode)] ?? 5;
    const parentIsSource = srcRank <= tgtRank;
    const parentId = parentIsSource ? srcNode.id : tgtNode.id;
    const childId = parentIsSource ? tgtNode.id : srcNode.id;

    // Skip duplicate parent link or cycle-forming link
    const existingParents = parentsMap.get(childId) || [];
    if (existingParents.some(p => p.parentId === parentId)) return;
    if (hasPath(childId, parentId)) return;

    existingParents.push({ parentId, cable, parentIsSource });
    parentsMap.set(childId, existingParents);
    childrenGraph.get(parentId)?.add(childId);
  });

  // Topological BFS ordering (roots first -> children -> remaining isolated devices)
  const orderedIds: string[] = [];
  const visitedOrder = new Set<string>();
  const rootIds = exportableNodes
    .filter(n => (parentsMap.get(n.id) || []).length === 0)
    .sort((a, b) => {
      const ra = CATEGORY_HIERARCHY_RANK[getNodeCategory(a)] ?? 5;
      const rb = CATEGORY_HIERARCHY_RANK[getNodeCategory(b)] ?? 5;
      return ra - rb;
    })
    .map(n => n.id);

  const bfsQueue = [...rootIds];
  while (bfsQueue.length > 0) {
    const curId = bfsQueue.shift()!;
    if (visitedOrder.has(curId)) continue;
    visitedOrder.add(curId);
    orderedIds.push(curId);
    for (const childId of childrenGraph.get(curId) || []) {
      if (!visitedOrder.has(childId)) bfsQueue.push(childId);
    }
  }
  exportableNodes.forEach(n => {
    if (!visitedOrder.has(n.id)) orderedIds.push(n.id);
  });

  const resolvePortLabel = (node: DiagramNode | undefined, portId?: string): string => {
    if (!portId) return '';
    const asset = node?.assetId ? project.assets?.[node.assetId] : undefined;
    const found = asset?.ports?.find(p => p.id === portId || p.name === portId);
    return found?.name || portId;
  };

  const rawRows: Array<Record<string, string>> = orderedIds.map(nodeId => {
    const node = nodeById.get(nodeId)!;
    const asset = node.assetId ? project.assets?.[node.assetId] : undefined;
    const cat = getNodeCategory(node);
    const parentEntries = parentsMap.get(nodeId) || [];
    const primaryLink = parentEntries[0];

    const parentNames = parentEntries
      .map(pe => uniqueNameByNodeId.get(pe.parentId))
      .filter((name): name is string => Boolean(name));

    const parentNode = primaryLink ? nodeById.get(primaryLink.parentId) : undefined;
    const parentPort = primaryLink
      ? resolvePortLabel(
          parentNode,
          primaryLink.parentIsSource ? primaryLink.cable.sourcePortId : primaryLink.cable.targetPortId
        )
      : '';
    const localPort = primaryLink
      ? resolvePortLabel(
          node,
          primaryLink.parentIsSource ? primaryLink.cable.targetPortId : primaryLink.cable.sourcePortId
        )
      : '';

    const floorName =
      floorNameById.get(asset?.floorId || node.floorId || '') ||
      project.floors?.[0]?.name ||
      'Tầng 1';

    return {
      'Tên Thiết Bị': uniqueNameByNodeId.get(nodeId) || node.label,
      'Router Cha': parentNames.join(', '),
      'Loại Thiết Bị': cat,
      'Hãng Sản Xuất': asset?.vendor || 'Generic',
      'Model': asset?.model || cat.toUpperCase(),
      'Địa Chỉ IP': asset?.ipAddress || '',
      'Subnet Mask': asset?.subnetMask || '255.255.255.0',
      'Gateway': asset?.gateway || '10.0.0.1',
      'VLAN': asset?.vlan || '10',
      'Tầng / Khu Vực': floorName,
      'Loại Cáp': primaryLink ? formatCableTypeForExcel(primaryLink.cable.cableType) : 'Cat6 UTP (1G)',
      'Cổng Cha': parentPort,
      'Cổng Con': localPort,
      'Công Suất (W)': String(asset?.powerWatts || 45),
      'Ghi Chú': primaryLink?.cable.notes || ''
    };
  });

  const safeFileBase = (project.name || 'HACHIHI_Project')
    .replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1E00-\u1EFF]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return buildRouterTreeResultFromRows(rawRows, `${safeFileBase || 'HACHIHI'}_Cay_Router.xlsx`);
}

export function buildRouterTreeExportWorkbook(project: ProjectState): ExcelJS.Workbook {
  const extracted = extractRouterTreeFromProject(project);
  const rows: ExcelRouterTreeExportRow[] = extracted.nodes.map(node => ({
    name: node.name,
    parent: node.parents.join(', '),
    category: node.category,
    vendor: node.vendor,
    model: node.model,
    ip: node.ipAddress,
    vlan: node.vlan,
    floor: node.floorName,
    cableType: node.cableLabel,
    parentPort: node.parentPort,
    localPort: node.localPort,
    watts: node.powerWatts,
    notes: node.notes
  }));
  return buildWorkbookFromRouterTreeRows(rows);
}

export async function exportProjectRouterTreeToExcel(project: ProjectState): Promise<void> {
  const wb = buildRouterTreeExportWorkbook(project);
  const safeBase = (project.name || 'HACHIHI_Project')
    .replace(/[^a-zA-Z0-9_\-\u00C0-\u024F\u1E00-\u1EFF]+/g, '_')
    .replace(/^_+|_+$/g, '');
  await downloadWorkbookAsXlsx(wb, `${safeBase || 'HACHIHI'}_Cay_Router.xlsx`);
  trackExport('excel_router');
}

const STANDARD_TREE_COLUMN_HEADERS = [
  'Tên Thiết Bị',
  'Router Cha',
  'Loại Thiết Bị',
  'Hãng Sản Xuất',
  'Model',
  'Địa Chỉ IP',
  'VLAN',
  'Tầng / Khu Vực',
  'Loại Cáp',
  'Cổng Cha',
  'Cổng Con',
  'Công Suất (W)',
  'Ghi Chú'
];

const HEADER_DETECT_KEYWORDS = [
  'ten thiet bi',
  'ten router',
  'router cha',
  'thiet bi cha',
  'device name',
  'parent',
  'dia chi ip',
  'ip address',
  'loai thiet bi',
  'loai cap',
  'cong cha',
  'cong con',
  'cong suat',
  'hang san xuat',
  'tang / khu vuc',
  'tang/khu vuc',
  'khu vuc',
  'ghi chu'
];

const HEADER_EXACT_KEYWORDS = new Set([
  'tang',
  'floor',
  'name',
  'ten',
  'thiet bi',
  'ip',
  'vlan',
  'model',
  'category',
  'vendor',
  'hang',
  'notes',
  'note'
]);

function parseDelimitedTableRows(
  lines: string[],
  delimiter: ',' | ';' | '\t'
): Array<Record<string, string>> {
  const splitLine = (line: string): string[] =>
    delimiter === '\t'
      ? line.split('\t').map(c => c.trim())
      : parseCsvLine(line, delimiter);

  const firstCells = splitLine(lines[0]);
  const hasIpInFirstRow = firstCells.some(cell => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(cell.trim()));
  const hasExplicitHeader =
    !hasIpInFirstRow &&
    firstCells.some(cell => {
      const norm = stripAccents(cell);
      if (!norm) return false;
      if (HEADER_EXACT_KEYWORDS.has(norm)) return true;
      return HEADER_DETECT_KEYWORDS.some(kw => norm === kw || norm.includes(kw));
    });

  const rawRows: Array<Record<string, string>> = [];

  if (hasExplicitHeader) {
    for (let i = 1; i < lines.length && rawRows.length < MAX_TREE_ROWS; i++) {
      const vals = splitLine(lines[i]);
      const rec: Record<string, string> = {};
      firstCells.forEach((h, idx) => {
        if (h) rec[h] = vals[idx] || '';
      });
      if (Object.values(rec).some(v => v !== '')) rawRows.push(rec);
    }
    return rawRows;
  }

  // Headerless TSV / CSV paste directly from Excel cells
  for (let i = 0; i < lines.length && rawRows.length < MAX_TREE_ROWS; i++) {
    const vals = splitLine(lines[i]);
    if (!vals[0]) continue;
    const rec: Record<string, string> = {};
    STANDARD_TREE_COLUMN_HEADERS.forEach((header, idx) => {
      if (vals[idx]) rec[header] = vals[idx];
    });
    // Smart fallback: 3-column paste like "Switch 01 | Router 01 | 10.0.0.2"
    if (vals[2] && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(vals[2]) && !rec['Địa Chỉ IP']) {
      rec['Địa Chỉ IP'] = vals[2];
      delete rec['Loại Thiết Bị'];
    }
    rawRows.push(rec);
  }

  return rawRows;
}

function isFloorSectionHeading(cleanText: string, hasChildren: boolean): boolean {
  const norm = stripAccents(cleanText);
  if (!norm) return false;
  const looksLikeHardware = /\b(router|switch|firewall|core|server|nas|san|camera|nvr|pc|laptop|ap|wifi|ups|pdu|odf|patch|printer)\b/i.test(
    norm
  );
  if (looksLikeHardware) return false;
  const matchesFloorPattern =
    /^(tang|floor|lau|khu vuc|khu|tang ham|ham|toa nha|building)\b/i.test(norm) ||
    /^b\d+\b/i.test(norm);
  return matchesFloorPattern && (hasChildren || !norm.includes('-'));
}

function extractInlineTreeSpecs(rawText: string): {
  cleanName: string;
  ipAddress: string;
  vlan: string;
  cableSpecText: string;
  wattsText: string;
} {
  let cleanName = rawText.trim();
  let ipAddress = '';
  let vlan = '';
  let cableSpecText = '';
  let wattsText = '';

  const trailingMetaMatch = cleanName.match(/^(.*?)\s*[([]\s*([^()[\]]+)\s*[)\]]\s*$/);
  if (trailingMetaMatch) {
    const candidateName = trailingMetaMatch[1].trim();
    const metaContent = trailingMetaMatch[2].trim();
    const hasTechToken =
      /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(metaContent) ||
      /\bvlan\b/i.test(metaContent) ||
      /\b(os2|om4|cat6a|cat6|dac|quang|fiber)\b/i.test(metaContent) ||
      /\b\d+\s*w\b/i.test(metaContent);

    if (candidateName && hasTechToken) {
      cleanName = candidateName;
      const ipMatch = metaContent.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
      if (ipMatch) ipAddress = ipMatch[1];
      const vlanMatch = metaContent.match(/\bvlan\s*[:=]?\s*(\d+(?:\s*,\s*\d+)*)/i);
      if (vlanMatch) vlan = vlanMatch[1].replace(/\s+/g, '');
      const wattsMatch = metaContent.match(/\b(\d+)\s*w\b/i);
      if (wattsMatch) wattsText = wattsMatch[1];
      if (/\b(os2|om4|cat6a|cat6|dac|quang|fiber)\b/i.test(metaContent)) {
        cableSpecText = metaContent;
      }
    }
  }

  return { cleanName, ipAddress, vlan, cableSpecText, wattsText };
}

function parseIndentedTreeLines(lines: string[]): Array<Record<string, string>> {
  const entries = lines
    .slice(0, MAX_TREE_ROWS)
    .map(raw => {
      const expanded = raw.replace(/\t/g, '    ');
      const prefixMatch = expanded.match(/^(?:[ \t│├└┌┐┘┴┼─|+\\]|-(?=[ \t─-])|\*(?=[ \t]))+/);
      const indent = prefixMatch ? prefixMatch[0].length : 0;
      const text = expanded.slice(indent).trim();
      return { indent, text };
    })
    .filter(item => item.text.length > 0);

  const stack: Array<{
    kind: 'floor' | 'device';
    name: string;
    indent: number;
    floorName: string;
    category?: DeviceCategory;
  }> = [];

  const rawRows: Array<Record<string, string>> = [];

  entries.forEach((entry, idx) => {
    const hasChildren = idx + 1 < entries.length && entries[idx + 1].indent > entry.indent;
    while (stack.length > 0 && stack[stack.length - 1].indent >= entry.indent) {
      stack.pop();
    }

    if (isFloorSectionHeading(entry.text, hasChildren)) {
      stack.push({
        kind: 'floor',
        name: entry.text,
        indent: entry.indent,
        floorName: entry.text
      });
      return;
    }

    const parentDevice = [...stack].reverse().find(f => f.kind === 'device');
    const activeFloorFrame = [...stack].reverse().find(f => f.kind === 'floor');
    const floorName = activeFloorFrame?.floorName || parentDevice?.floorName || 'Tầng 1';

    const specs = extractInlineTreeSpecs(entry.text);
    const explicitCat = detectExplicitCategory(specs.cleanName);
    const category: DeviceCategory =
      explicitCat ?? (!parentDevice && hasChildren ? 'router' : hasChildren ? 'switch' : 'workstation');

    const isCrossFloor = Boolean(parentDevice && parentDevice.floorName.toLowerCase() !== floorName.toLowerCase());
    const defaultCable =
      specs.cableSpecText ||
      (isCrossFloor ||
      parentDevice?.category === 'router' ||
      parentDevice?.category === 'core_switch' ||
      category === 'core_switch' ||
      category === 'odf'
        ? 'Quang OS2 (10G)'
        : 'Cat6 UTP (1G)');

    rawRows.push({
      'Tên Thiết Bị': specs.cleanName,
      'Router Cha': parentDevice ? parentDevice.name : '',
      'Loại Thiết Bị': category,
      'Hãng Sản Xuất': 'Generic',
      'Model': category.toUpperCase(),
      'Địa Chỉ IP': specs.ipAddress,
      'VLAN': specs.vlan || '10',
      'Tầng / Khu Vực': floorName,
      'Loại Cáp': defaultCable,
      'Công Suất (W)': specs.wattsText
    });

    stack.push({
      kind: 'device',
      name: specs.cleanName,
      indent: entry.indent,
      floorName,
      category
    });
  });

  return rawRows;
}

/**
 * Parses pasted text in any of 3 formats:
 * 1) Tab-separated Excel paste (TSV, with or without headers)
 * 2) Comma/semicolon-separated CSV
 * 3) Indented / ASCII box-drawing tree (e.g. Tầng 1 -> └── Router 01 -> ├── Switch 01 -> ├── PC 01)
 */
export function parseRouterTreeTextPayload(
  text: string,
  fileName = 'Dan_Truc_Tiep.txt'
): ParsedRouterTreeResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('Nội dung dán trống — hãy dán bảng Excel (TSV/CSV) hoặc cây phân cấp thiết bị.');
  }

  const sampleLines = lines.slice(0, Math.min(5, lines.length));
  const hasTabs = sampleLines.some(l => l.includes('\t'));
  const hasSemicolons = sampleLines.filter(l => l.includes(';') && !l.includes(',')).length >= 1;
  const hasCommas = sampleLines.filter(l => l.includes(',')).length >= Math.min(2, lines.length);
  const firstLineLooksLikeTree = /[├└│┌┐┘┴┼]/.test(lines[0]) || isFloorSectionHeading(lines[0].trim(), lines.length > 1);

  let rawRows: Array<Record<string, string>>;
  if (hasTabs) {
    rawRows = parseDelimitedTableRows(lines, '\t');
  } else if (hasSemicolons && !firstLineLooksLikeTree) {
    rawRows = parseDelimitedTableRows(lines, ';');
  } else if (hasCommas && !firstLineLooksLikeTree) {
    rawRows = parseDelimitedTableRows(lines, ',');
  } else {
    rawRows = parseIndentedTreeLines(lines);
  }

  if (rawRows.length === 0) {
    throw new Error('Không tìm thấy thiết bị hợp lệ nào trong văn bản đã dán.');
  }

  return buildRouterTreeResultFromRows(rawRows, fileName);
}

/**
 * Pure parser usable both in browser and in automated unit tests
 */
export async function parseRouterTreeExcelPayload(
  payload: ArrayBuffer | Uint8Array | string,
  fileName: string
): Promise<ParsedRouterTreeResult> {
  const textPayload =
    typeof payload === 'string'
      ? payload
      : fileName.toLowerCase().endsWith('.csv') || fileName.toLowerCase().endsWith('.txt')
      ? new TextDecoder('utf-8').decode(payload)
      : null;

  if (textPayload !== null) {
    return parseRouterTreeTextPayload(textPayload, fileName);
  }

  const rawRows: Array<Record<string, string>> = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(payload as unknown as ArrayBuffer);
  if (!wb.worksheets.length) {
    throw new Error('Tệp Excel không có sheet nào.');
  }
  const ws =
    wb.worksheets.find(s => /so_do|router|cay|thiet_bi|devices/i.test(s.name)) ||
    wb.worksheets[0];

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum] = cellToString(cell.value);
  });

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1 || rawRows.length >= MAX_TREE_ROWS) return;
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

  return buildRouterTreeResultFromRows(rawRows, fileName);
}

export async function parseRouterTreeExcelFile(file: File): Promise<ParsedRouterTreeResult> {
  const sizeCheck = checkImportPayloadSize(file, MAX_EXCEL_FILE_BYTES, file.name || 'tệp Excel');
  if (!sizeCheck.ok) {
    throw new Error(sizeCheck.error);
  }
  const lower = file.name.toLowerCase();
  const isText = lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv') || file.type === 'text/csv';
  if (isText) {
    const text = await file.text();
    return parseRouterTreeExcelPayload(text, file.name);
  }
  const buffer = await file.arrayBuffer();
  return parseRouterTreeExcelPayload(buffer, file.name);
}

/**
 * Computes clean non-overlapping node coordinates and optional floor bands
 * for 'vertical', 'horizontal', and 'by_floor' layouts.
 */
export function computeRouterTreeLayout(
  parsed: ParsedRouterTreeResult,
  layoutMode: TreeLayoutMode
): ComputedTreeLayout {
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const floorBands: Array<{ floorName: string; x: number; y: number; width: number; height: number }> = [];

  const nodeW = 156;
  const nodeH = 60;

  if (layoutMode === 'by_floor') {
    const gapX = 210;
    const bandPadX = 48;
    const bandPadTop = 44;
    const bandPadBottom = 30;
    const bandGapY = 34;

    let cursorY = 70;
    let maxBandRight = 640;

    parsed.floors.forEach(floorName => {
      const floorNodes = parsed.nodes
        .filter(n => n.floorName === floorName)
        .sort((a, b) => a.depth - b.depth || a.rowIndex - b.rowIndex);
      const bandWidth = Math.max(460, bandPadX * 2 + Math.max(1, floorNodes.length) * gapX - (gapX - nodeW));
      const bandHeight = bandPadTop + nodeH + bandPadBottom;

      floorBands.push({
        floorName,
        x: 60,
        y: cursorY,
        width: bandWidth,
        height: bandHeight
      });
      maxBandRight = Math.max(maxBandRight, 60 + bandWidth);

      floorNodes.forEach((n, idx) => {
        positions.set(n.name, {
          x: 60 + bandPadX + idx * gapX,
          y: cursorY + bandPadTop,
          width: nodeW,
          height: nodeH
        });
      });

      cursorY += bandHeight + bandGapY;
    });

    // Normalize all bands to share equal width for clean architectural presentation
    floorBands.forEach(b => {
      b.width = maxBandRight - b.x;
    });
  } else {
    // Hierarchical tree traversal (assigns primary parent tree so each node appears once in spanning tree)
    const nodeMap = new Map(parsed.nodes.map(n => [n.name, n]));
    const primaryChildren = new Map<string, string[]>();
    parsed.nodes.forEach(n => primaryChildren.set(n.name, []));

    const assignedParent = new Set<string>(parsed.rootNames);
    parsed.nodes.forEach(n => {
      if (assignedParent.has(n.name)) return;
      for (const pLink of n.parentLinks) {
        if (nodeMap.has(pLink.parentName)) {
          primaryChildren.get(pLink.parentName)!.push(n.name);
          assignedParent.add(n.name);
          break;
        }
      }
    });

    // Compute leaf-slot coordinates recursively for balanced symmetric tree spacing
    let leafCursor = 0;
    const slotMap = new Map<string, number>();
    const visited = new Set<string>();

    const placeSubtree = (name: string): number => {
      if (visited.has(name)) return slotMap.get(name) ?? leafCursor;
      visited.add(name);
      const kids = (primaryChildren.get(name) || []).filter(k => !visited.has(k));
      if (kids.length === 0) {
        const s = leafCursor;
        leafCursor += 1;
        slotMap.set(name, s);
        return s;
      }
      const kidSlots = kids.map(k => placeSubtree(k));
      const avg = (kidSlots[0] + kidSlots[kidSlots.length - 1]) / 2;
      slotMap.set(name, avg);
      return avg;
    };

    parsed.rootNames.forEach(r => placeSubtree(r));
    parsed.nodes.forEach(n => {
      if (!visited.has(n.name)) placeSubtree(n.name);
    });

    if (layoutMode === 'horizontal') {
      const levelGapX = 240;
      const slotGapY = 92;
      parsed.nodes.forEach(n => {
        const slot = slotMap.get(n.name) ?? 0;
        positions.set(n.name, {
          x: 80 + (n.depth - 1) * levelGapX,
          y: 80 + slot * slotGapY,
          width: nodeW,
          height: nodeH
        });
      });
    } else {
      // 'vertical' (Top -> Bottom)
      const slotGapX = 196;
      const levelGapY = 136;
      parsed.nodes.forEach(n => {
        const slot = slotMap.get(n.name) ?? 0;
        positions.set(n.name, {
          x: 80 + slot * slotGapX,
          y: 80 + (n.depth - 1) * levelGapY,
          width: nodeW,
          height: nodeH
        });
      });
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  positions.forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  });
  floorBands.forEach(b => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  });

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 500;
  }

  return {
    positions,
    floorBands,
    bounds: { minX, minY, maxX, maxY }
  };
}

function getTierNodeColors(depth: number, category: DeviceCategory): { bg: string; border: string } {
  if (depth === 1 || category === 'router') return { bg: '#1d4ed8', border: '#1e3a8a' };
  if (depth === 2 || category === 'core_switch') return { bg: '#0284c7', border: '#0369a1' };
  if (depth === 3 || category === 'switch') return { bg: '#0d9488', border: '#115e59' };
  return { bg: '#4f46e5', border: '#3730a3' };
}

function getCableColor(cableType: CableType): string {
  switch (cableType) {
    case 'FIBER_SM_OS2':
      return '#f59e0b';
    case 'FIBER_MM_OM4':
      return '#06b6d4';
    case 'CAT6A_STP':
      return '#2563eb';
    case 'DAC_10G':
      return '#7c3aed';
    case 'POWER_AC':
      return '#ef4444';
    default:
      return '#0ea5e9';
  }
}

/**
 * Builds a complete ProjectState (either a fresh project or merged into existingProject)
 * from the parsed Router Tree and chosen layoutMode.
 */
export function buildProjectFromRouterTree(
  parsed: ParsedRouterTreeResult,
  options: {
    layoutMode: TreeLayoutMode;
    applyMode: TreeApplyMode;
    projectName?: string;
    existingProject?: ProjectState;
  }
): {
  project: ProjectState;
  createdNodesCount: number;
  createdCablesCount: number;
  floorCount: number;
} {
  const { layoutMode, applyMode, projectName = '', existingProject } = options;
  const layout = computeRouterTreeLayout(parsed, layoutMode);
  const stamp = Date.now();

  const mergeBase = applyMode === 'merge' ? existingProject : undefined;
  const isMerge = Boolean(mergeBase);
  const buildingId = mergeBase?.activeBuildingId || `bldg_excel_${stamp}`;

  const buildings: Building[] = mergeBase && mergeBase.buildings.length > 0
    ? [...mergeBase.buildings]
    : [
        {
          id: buildingId,
          name: projectName.trim() || parsed.suggestedProjectName,
          totalFloors: Math.max(1, parsed.floors.length),
          basementFloors: 0,
          widthMeters: 40,
          depthMeters: 25,
          floorHeightMeters: 3.5,
          wallThicknessMm: 200,
          layoutStyle: 'rectangle'
        }
      ];

  const floors: Floor[] = mergeBase ? [...mergeBase.floors] : [];
  const floorIdByName = new Map<string, string>();
  floors.forEach(f => floorIdByName.set(f.name.toLowerCase(), f.id));

  parsed.floors.forEach((flName, idx) => {
    const existingId = floorIdByName.get(flName.toLowerCase());
    if (existingId) return;
    const levelMatch = flName.match(/(\d+)/);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : floors.length + idx + 1;
    const newId = `fl_excel_${stamp}_${idx + 1}`;
    floors.push({
      id: newId,
      buildingId,
      level,
      name: flName,
      description: `Nhập từ Excel (${parsed.fileName})`,
      widthMeters: 40,
      depthMeters: 25
    });
    floorIdByName.set(flName.toLowerCase(), newId);
  });

  // Compute merge offset if merging onto an existing canvas so nodes never overlap
  let offsetX = 0;
  let offsetY = 0;
  if (mergeBase && mergeBase.nodes.length > 0) {
    const maxExistingX = mergeBase.nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
    offsetX = Math.max(0, maxExistingX + 120 - layout.bounds.minX);
  }

  const targetFloorForCanvas = floors[0]?.id || mergeBase?.activeFloorId || '';
  const rooms: Room[] = mergeBase ? [...mergeBase.rooms] : [];

  if (layoutMode === 'by_floor') {
    layout.floorBands.forEach((band, idx) => {
      rooms.push({
        id: `room_band_${stamp}_${idx + 1}`,
        floorId: targetFloorForCanvas,
        name: band.floorName,
        type: 'office',
        x: Math.round(band.x + offsetX),
        y: Math.round(band.y + offsetY),
        width: Math.round(band.width),
        height: Math.round(band.height),
        color: '#e0f2fe',
        wallThickness: 8,
        description: `Phân khu ${band.floorName}`
      });
    });
  }

  const assets: Record<string, DeviceAsset> = mergeBase ? { ...mergeBase.assets } : {};
  const nodes: DiagramNode[] = mergeBase ? [...mergeBase.nodes] : [];
  const cables: CableEdge[] = mergeBase ? [...mergeBase.cables] : [];

  const nodeIdByName = new Map<string, string>();
  const assetIdByName = new Map<string, string>();

  parsed.nodes.forEach((item, idx) => {
    const pos = layout.positions.get(item.name) || { x: 100 + idx * 180, y: 120, width: 156, height: 60 };
    const preset = DEVICE_CATALOG.find(d => d.category === item.category) || DEVICE_CATALOG[0];
    const colors = getTierNodeColors(item.depth, item.category);

    const assetId = `dev_tree_${stamp}_${idx + 1}`;
    const nodeId = `node_tree_${stamp}_${idx + 1}`;
    const itemFloorId =
      layoutMode === 'by_floor'
        ? targetFloorForCanvas
        : floorIdByName.get(item.floorName.toLowerCase()) || targetFloorForCanvas;

    const ports: DevicePort[] = preset.defaultPorts.map((p, pIdx) => ({
      id: `port_${pIdx + 1}`,
      name: p.name,
      type: p.type,
      poe: p.poe,
      speed: p.speed,
      status: 'unlinked'
    }));

    assets[assetId] = {
      id: assetId,
      name: item.name,
      category: item.category,
      vendor: item.vendor,
      model: item.model,
      assetTag: `AST-${String(idx + 1).padStart(4, '0')}`,
      serialNumber: `SN-XL-${stamp.toString(36).toUpperCase().slice(-4)}-${idx + 1}`,
      ipAddress: item.ipAddress,
      subnetMask: item.subnetMask,
      gateway: item.gateway,
      macAddress: `00:50:56:${String((idx + 10) % 99).padStart(2, '0')}:${String((idx * 7 + 11) % 99).padStart(2, '0')}:AA`,
      vlan: item.vlan,
      status: 'online',
      powerWatts: item.powerWatts,
      weightKg: 4.5,
      floorId: itemFloorId,
      ports
    };

    nodes.push({
      id: nodeId,
      diagramMode: mergeBase ? mergeBase.activeMode : 'topology',
      floorId: itemFloorId,
      type: 'device',
      assetId,
      label: item.name,
      x: Math.round(pos.x + offsetX),
      y: Math.round(pos.y + offsetY),
      width: pos.width,
      height: pos.height,
      rotation: 0,
      style: {
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1,
        textColor: '#ffffff',
        iconColor: '#ffffff'
      }
    });

    nodeIdByName.set(item.name, nodeId);
    assetIdByName.set(item.name, assetId);
  });

  // Ensure every node on canvas is visible immediately in topology view (floorId matches activeFloorId in topology tree)
  // Note: for vertical/horizontal multi-floor topology trees, keep nodes visible on the active diagram floor
  // OR preserve floor assignment in asset.floorId so BOM/Floor counts stay accurate while topology tree stays connected!
  const topologyCanvasFloorId = targetFloorForCanvas;
  if (layoutMode !== 'by_floor') {
    nodes.forEach(n => {
      if (n.id.startsWith(`node_tree_${stamp}_`)) {
        n.floorId = topologyCanvasFloorId;
      }
    });
  }

  parsed.links.forEach((link, idx) => {
    const srcNodeId = nodeIdByName.get(link.parentName);
    const tgtNodeId = nodeIdByName.get(link.childName);
    if (!srcNodeId || !tgtNodeId) return;

    const srcPos = layout.positions.get(link.parentName);
    const tgtPos = layout.positions.get(link.childName);
    const planarMeters =
      srcPos && tgtPos
        ? Math.max(5, Math.round(Math.hypot(tgtPos.x - srcPos.x, tgtPos.y - srcPos.y) / 30))
        : 15;
    const riserExtra = link.isCrossFloor ? 12 : 0;

    cables.push({
      id: `cab_tree_${stamp}_${idx + 1}`,
      cableCode: `CAB-${String(idx + 1).padStart(3, '0')}`,
      diagramMode: mergeBase ? mergeBase.activeMode : 'topology',
      sourceNodeId: srcNodeId,
      targetNodeId: tgtNodeId,
      cableType: link.cableType,
      bandwidth: link.bandwidth,
      color: getCableColor(link.cableType),
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: link.cableType.startsWith('FIBER') ? 2.5 : 2,
      lengthMeters: planarMeters + riserExtra,
      vlan: parsed.nodes.find(n => n.name === link.childName)?.vlan || '10',
      status: 'active',
      label: `${link.parentPort} → ${link.localPort}`,
      notes: link.isCrossFloor ? 'Liên tầng' : undefined
    });
  });

  const nextProject: ProjectState = {
    ...(mergeBase || {}),
    id: mergeBase ? mergeBase.id : `proj_excel_${stamp}`,
    name: mergeBase ? mergeBase.name : projectName.trim() || parsed.suggestedProjectName,
    author: existingProject?.author || 'HACHIHI Engineer',
    version: existingProject?.version || '3.1.0',
    schemaVersion: existingProject?.schemaVersion || 5,
    lastModified: new Date().toISOString(),
    buildings,
    floors,
    rooms,
    cableTrays: mergeBase ? mergeBase.cableTrays : [],
    racks: mergeBase ? mergeBase.racks : [],
    assets,
    nodes,
    cables,
    vlans: mergeBase ? mergeBase.vlans : [],
    subnets: mergeBase ? mergeBase.subnets : [],
    patchLinks: mergeBase ? mergeBase.patchLinks : [],
    activeMode: mergeBase ? mergeBase.activeMode : 'topology',
    activeBuildingId: buildingId,
    activeFloorId: topologyCanvasFloorId,
    settings: mergeBase
      ? mergeBase.settings
      : {
          ...DEFAULT_CANVAS_SETTINGS,
          isDarkMode: Boolean(existingProject?.settings?.isDarkMode)
        }
  };

  return {
    project: nextProject,
    createdNodesCount: parsed.nodes.length,
    createdCablesCount: parsed.links.length,
    floorCount: parsed.floors.length
  };
}
