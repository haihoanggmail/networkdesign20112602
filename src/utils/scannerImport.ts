import {
  ProjectState,
  DeviceAsset,
  DeviceCategory,
  DiagramNode,
  CableEdge
} from '../types/infrastructure';
import { DEVICE_CATALOG } from '../data/deviceCatalog';
import { checkImportPayloadSize, MAX_SCANNER_FILE_BYTES } from './security';

interface RawScannedHost {
  ip?: string;
  ipAddress?: string;
  mac?: string;
  macAddress?: string;
  hostname?: string;
  name?: string;
  vendor?: string;
  type?: string;
  category?: string;
  vlan?: string | number;
  subnet?: string;
  gateway?: string;
  uplinkIp?: string;
}

function classifyScannedHost(host: RawScannedHost): DeviceCategory {
  const hint = `${host.category || ''} ${host.type || ''} ${host.hostname || ''} ${host.name || ''} ${host.vendor || ''}`.toLowerCase();
  if (hint.includes('core')) return 'core_switch';
  if (hint.includes('switch') || hint.includes('cisco') || hint.includes('aruba')) return 'switch';
  if (hint.includes('firewall') || hint.includes('forti') || hint.includes('palo')) return 'firewall';
  if (hint.includes('router') || hint.includes('mikrotik') || hint.includes('gateway')) return 'router';
  if (hint.includes('cam') || hint.includes('hikvision') || hint.includes('dahua')) return 'camera';
  if (hint.includes('nvr')) return 'nvr';
  if (hint.includes('ap') || hint.includes('wifi') || hint.includes('unifi') || hint.includes('wireless')) return 'ap';
  if (hint.includes('server') || hint.includes('esxi') || hint.includes('proxmox') || hint.includes('nas')) return 'server';
  if (hint.includes('printer') || hint.includes('canon') || hint.includes('hp')) return 'printer';
  if (hint.includes('ups') || hint.includes('apc')) return 'ups';
  return 'workstation';
}

function parseScannerCsv(text: string): RawScannedHost[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const hosts: RawScannedHost[] = [];

  for (let i = 1; i < lines.length && hosts.length < 500; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => { rec[h] = cols[idx] || ''; });
    const ip = rec['ip'] || rec['ipaddress'] || rec['ip_address'] || rec['host'];
    if (!ip && !rec['hostname'] && !rec['name']) continue;
    hosts.push({
      ip,
      mac: rec['mac'] || rec['macaddress'] || rec['mac_address'],
      hostname: rec['hostname'] || rec['name'] || rec['device'],
      vendor: rec['vendor'] || rec['manufacturer'],
      type: rec['type'] || rec['category'] || rec['role'],
      vlan: rec['vlan'],
      subnet: rec['subnet'] || rec['netmask'],
      gateway: rec['gateway'],
      uplinkIp: rec['uplink'] || rec['uplink_ip']
    });
  }
  return hosts;
}

/**
 * Parses HachihiNetworkScanner JSON or CSV discovery results and builds
 * structured DeviceAssets, auto-laid-out DiagramNodes, and uplink CableEdges.
 */
export function importNetworkScannerData(
  rawText: string,
  project: ProjectState
): {
  assets: Record<string, DeviceAsset>;
  nodes: DiagramNode[];
  cables: CableEdge[];
  importedCount: number;
} {
  const sizeCheck = checkImportPayloadSize(rawText, MAX_SCANNER_FILE_BYTES, 'tệp NetworkScanner');
  if (!sizeCheck.ok) {
    throw new Error(sizeCheck.error);
  }
  let hosts: RawScannedHost[] = [];
  const trimmed = rawText.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      hosts = parsed as RawScannedHost[];
    } else if (parsed && typeof parsed === 'object' && 'hosts' in parsed && Array.isArray((parsed as { hosts: unknown }).hosts)) {
      hosts = (parsed as { hosts: RawScannedHost[] }).hosts;
    } else if (parsed && typeof parsed === 'object' && 'devices' in parsed && Array.isArray((parsed as { devices: unknown }).devices)) {
      hosts = (parsed as { devices: RawScannedHost[] }).devices;
    }
  } else {
    hosts = parseScannerCsv(trimmed);
  }

  if (hosts.length === 0) {
    throw new Error('Không tìm thấy thiết bị nào trong file quét mạng (JSON/CSV).');
  }

  const nextAssets = { ...project.assets };
  const nextNodes = [...project.nodes];
  const nextCables = [...project.cables];
  const ipToNodeId = new Map<string, string>();

  // Index existing nodes by IP
  project.nodes.forEach(n => {
    const a = n.assetId ? project.assets[n.assetId] : undefined;
    if (a?.ipAddress) ipToNodeId.set(a.ipAddress.trim(), n.id);
  });

  const stamp = Date.now();
  let col = 0;
  let row = 0;
  let importedCount = 0;
  let primarySwitchNodeId: string | undefined;

  hosts.slice(0, 500).forEach((host, idx) => {
    const ip = (host.ip || host.ipAddress || '').trim();
    const category = classifyScannedHost(host);
    const preset = DEVICE_CATALOG.find(p => p.category === category) || DEVICE_CATALOG[0];
    const assetId = `scan_dev_${stamp}_${idx}`;
    const nodeId = `scan_node_${stamp}_${idx}`;
    const name = (host.hostname || host.name || ip || `Host-${idx + 1}`).trim();

    const asset: DeviceAsset = {
      id: assetId,
      name,
      category,
      vendor: host.vendor || preset.vendor,
      model: preset.model,
      assetTag: `SCAN-${String(idx + 1).padStart(4, '0')}`,
      serialNumber: '',
      ipAddress: ip,
      subnetMask: host.subnet || '255.255.255.0',
      gateway: host.gateway || '',
      macAddress: host.mac || host.macAddress || '',
      vlan: host.vlan !== undefined && host.vlan !== '' ? String(host.vlan) : '1',
      status: 'online',
      powerWatts: preset.powerWatts,
      weightKg: preset.weightKg,
      floorId: project.activeFloorId,
      ports: preset.defaultPorts.map((p, pIdx) => ({
        id: `port_${pIdx + 1}`,
        name: p.name,
        type: p.type,
        poe: p.poe,
        speed: p.speed,
        status: 'unlinked'
      }))
    };

    const isInfra = ['router', 'firewall', 'core_switch', 'switch'].includes(category);
    const x = 140 + col * 190;
    const y = (isInfra ? 110 : 300) + row * 125;

    const node: DiagramNode = {
      id: nodeId,
      diagramMode: 'topology',
      floorId: project.activeFloorId,
      type: 'device',
      assetId,
      label: name,
      x,
      y,
      width: preset.defaultWidth,
      height: preset.defaultHeight,
      rotation: 0,
      style: {
        backgroundColor: preset.color,
        borderColor: '#334155',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1,
        textColor: '#ffffff',
        iconColor: '#ffffff'
      }
    };

    nextAssets[assetId] = asset;
    nextNodes.push(node);
    if (ip) ipToNodeId.set(ip, nodeId);
    if (!primarySwitchNodeId && (category === 'switch' || category === 'core_switch' || category === 'router')) {
      primarySwitchNodeId = nodeId;
    }

    importedCount++;
    col++;
    if (col >= 5) {
      col = 0;
      row++;
    }
  });

  // Auto-link hosts to uplinkIp / gateway / primary switch
  hosts.slice(0, 500).forEach((host, idx) => {
    const ip = (host.ip || host.ipAddress || '').trim();
    const srcNodeId = ip ? ipToNodeId.get(ip) : `scan_node_${stamp}_${idx}`;
    if (!srcNodeId) return;

    const targetKey = (host.uplinkIp || host.gateway || '').trim();
    const targetNodeId = (targetKey ? ipToNodeId.get(targetKey) : undefined) || primarySwitchNodeId;
    if (!targetNodeId || targetNodeId === srcNodeId) return;

    nextCables.push({
      id: `scan_cab_${stamp}_${idx}`,
      cableCode: `SCAN-${String(idx + 1).padStart(3, '0')}`,
      diagramMode: 'topology',
      sourceNodeId: srcNodeId,
      targetNodeId,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active'
    });
  });

  return { assets: nextAssets, nodes: nextNodes, cables: nextCables, importedCount };
}

export interface ScannerDiffChange {
  assetId: string;
  deviceName: string;
  action: 'updated' | 'added' | 'unchanged';
  changedFields: string[];
}

export interface ScannerDiffMergeResult {
  assets: Record<string, DeviceAsset>;
  nodes: DiagramNode[];
  cables: CableEdge[];
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  changes: ScannerDiffChange[];
}

function normalizeMac(mac?: string): string {
  return String(mac || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '');
}

/**
 * E7: Two-way diff merge for NetworkScanner exports. Matches existing assets by MAC or IP,
 * updates changed fields without duplicating nodes/cables, and adds newly discovered hosts.
 */
export function diffMergeNetworkScannerData(
  rawText: string,
  project: ProjectState
): ScannerDiffMergeResult {
  const sizeCheck = checkImportPayloadSize(rawText, MAX_SCANNER_FILE_BYTES, 'tệp NetworkScanner');
  if (!sizeCheck.ok) {
    throw new Error(sizeCheck.error);
  }

  let hosts: RawScannedHost[] = [];
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      hosts = parsed as RawScannedHost[];
    } else if (parsed && typeof parsed === 'object' && 'hosts' in parsed && Array.isArray((parsed as { hosts: unknown }).hosts)) {
      hosts = (parsed as { hosts: RawScannedHost[] }).hosts;
    } else if (parsed && typeof parsed === 'object' && 'devices' in parsed && Array.isArray((parsed as { devices: unknown }).devices)) {
      hosts = (parsed as { devices: RawScannedHost[] }).devices;
    }
  } else {
    hosts = parseScannerCsv(trimmed);
  }

  if (hosts.length === 0) {
    throw new Error('Không tìm thấy thiết bị nào trong file quét mạng (JSON/CSV).');
  }

  const nextAssets: Record<string, DeviceAsset> = { ...project.assets };
  const nextNodes: DiagramNode[] = [...project.nodes];
  const nextCables: CableEdge[] = [...project.cables];

  const byIp = new Map<string, string>();
  const byMac = new Map<string, string>();
  Object.values(project.assets).forEach(a => {
    const ip = (a.ipAddress || '').trim();
    if (ip) byIp.set(ip, a.id);
    const mac = normalizeMac(a.macAddress);
    if (mac.length >= 12) byMac.set(mac, a.id);
  });

  const changes: ScannerDiffChange[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  const newHostsToAdd: RawScannedHost[] = [];

  for (const host of hosts.slice(0, 500)) {
    const ip = (host.ip || host.ipAddress || '').trim();
    const macNorm = normalizeMac(host.mac || host.macAddress);
    const matchedId = (macNorm.length >= 12 ? byMac.get(macNorm) : undefined) || (ip ? byIp.get(ip) : undefined);

    if (!matchedId || !nextAssets[matchedId]) {
      newHostsToAdd.push(host);
      continue;
    }

    const existing = nextAssets[matchedId];
    const changedFields: string[] = [];
    const updated: DeviceAsset = { ...existing };

    const incomingName = (host.hostname || host.name || '').trim();
    if (incomingName && incomingName !== existing.name) {
      updated.name = incomingName;
      changedFields.push('Tên');
    }
    if (ip && ip !== existing.ipAddress) {
      updated.ipAddress = ip;
      changedFields.push('IP');
    }
    const rawMac = (host.mac || host.macAddress || '').trim();
    if (rawMac && normalizeMac(rawMac) !== normalizeMac(existing.macAddress)) {
      updated.macAddress = rawMac;
      changedFields.push('MAC');
    }
    if (host.vlan !== undefined && String(host.vlan).trim() !== '' && String(host.vlan).trim() !== existing.vlan) {
      updated.vlan = String(host.vlan).trim();
      changedFields.push('VLAN');
    }
    if (host.vendor && host.vendor.trim() && host.vendor.trim() !== existing.vendor) {
      updated.vendor = host.vendor.trim();
      changedFields.push('Hãng');
    }

    if (changedFields.length > 0) {
      nextAssets[matchedId] = updated;
      for (let i = 0; i < nextNodes.length; i++) {
        if (nextNodes[i].assetId === matchedId && updated.name !== nextNodes[i].label) {
          nextNodes[i] = { ...nextNodes[i], label: updated.name };
        }
      }
      updatedCount += 1;
      changes.push({ assetId: matchedId, deviceName: updated.name, action: 'updated', changedFields });
    } else {
      unchangedCount += 1;
      changes.push({ assetId: matchedId, deviceName: existing.name, action: 'unchanged', changedFields: [] });
    }
  }

  if (newHostsToAdd.length > 0) {
    const addedRes = importNetworkScannerData(JSON.stringify(newHostsToAdd), {
      ...project,
      assets: nextAssets,
      nodes: nextNodes,
      cables: nextCables
    });
    Object.assign(nextAssets, addedRes.assets);
    // Replace arrays cleanly preserving newly appended items
    nextNodes.splice(0, nextNodes.length, ...addedRes.nodes);
    nextCables.splice(0, nextCables.length, ...addedRes.cables);
    addedCount = addedRes.importedCount;
    for (const [id, asset] of Object.entries(addedRes.assets)) {
      if (!project.assets[id] && id.startsWith('scan_dev_')) {
        changes.push({ assetId: id, deviceName: asset.name, action: 'added', changedFields: ['Mới'] });
      }
    }
  }

  return {
    assets: nextAssets,
    nodes: nextNodes,
    cables: nextCables,
    addedCount,
    updatedCount,
    unchangedCount,
    changes
  };
}

