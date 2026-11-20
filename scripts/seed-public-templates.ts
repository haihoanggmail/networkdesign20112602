import fs from 'node:fs';
import path from 'node:path';
import { ARCHITECTURE_TEMPLATES } from '../src/data/templates';
import { generateCompositeBuildingSvgMarkup } from '../src/utils/svgExport';
import { buildTemplateCatalogFromDir } from './build-template-catalog';

interface SeedMapping {
  folder: string;
  id: string;
  category: string;
  tags: string[];
}

const FOLDER_MAPPINGS: Record<string, SeedMapping> = {
  tpl_sample_multifloor_office: {
    folder: '01-network',
    id: 'network-office-001',
    category: 'Mạng LAN',
    tags: ['LAN', 'VLAN', 'Rack', 'Office', 'Sample']
  },
  tpl_cctv_security: {
    folder: '02-cctv',
    id: 'cctv-security-002',
    category: 'Camera',
    tags: ['Camera', 'CCTV', 'NVR', 'PoE']
  },
  tpl_rack_datacenter: {
    folder: '03-rack',
    id: 'rack-datacenter-003',
    category: 'Rack',
    tags: ['Rack', '42U', 'Server', 'UPS', 'ODF']
  },
  tpl_wifi_coverage: {
    folder: '04-wifi',
    id: 'wifi-coverage-004',
    category: 'Wi-Fi',
    tags: ['Wi-Fi', 'RF', 'Access Point', 'Heatmap']
  },
  tpl_building_hachihi2: {
    folder: '05-floorplan',
    id: 'floorplan-hachihi2-005',
    category: 'Mặt bằng',
    tags: ['Mặt bằng', 'CAD', '3D', 'Building']
  },
  tpl_fiber_cabling: {
    folder: '06-fiber',
    id: 'fiber-odf-006',
    category: 'Cáp quang',
    tags: ['Fiber', 'ODF', 'OS2', 'Backbone']
  },
  tpl_std_lan_star: {
    folder: '07-lan-star',
    id: 'lan-star-007',
    category: 'Mạng LAN',
    tags: ['LAN', 'PoE', 'Star', 'Router']
  },
  tpl_multisite_wan: {
    folder: '08-multisite',
    id: 'multisite-sdwan-008',
    category: 'Đa chi nhánh',
    tags: ['SD-WAN', 'WAN', 'VPN', 'Multi-Site']
  },
  tpl_std_core_dist_3tier: {
    folder: '09-datacenter',
    id: 'campus-core-dist-009',
    category: 'Data Center',
    tags: ['Core', 'Distribution', 'Access', '100G']
  },
  tpl_std_lan_vlan_dmz: {
    folder: '10-lan-dmz',
    id: 'lan-vlan-dmz-010',
    category: 'Mạng LAN',
    tags: ['DMZ', 'Firewall', 'VLAN', 'Security']
  },
  tpl_std_wan_dual_isp: {
    folder: '11-wan-dual-isp',
    id: 'wan-dual-isp-011',
    category: 'Đa chi nhánh',
    tags: ['Dual-ISP', 'Failover', 'IPsec', 'WAN']
  },
  tpl_std_collapsed_core: {
    folder: '12-collapsed-core',
    id: 'collapsed-core-012',
    category: 'Mạng LAN',
    tags: ['Collapsed Core', 'L3', 'Fiber', '3-Floor']
  },
  tpl_net_enterprise: {
    folder: '13-enterprise-logic',
    id: 'enterprise-logic-013',
    category: 'Mạng LAN',
    tags: ['Enterprise', 'HA', 'Firewall', 'Core']
  },
  tpl_net_small_office: {
    folder: '14-smb-office',
    id: 'smb-office-014',
    category: 'Mạng LAN',
    tags: ['SMB', 'Office', 'NAS', 'PoE']
  },
  tpl_building_5floors: {
    folder: '15-building-5floors',
    id: 'building-5floors-015',
    category: 'Mặt bằng',
    tags: ['Building', '5-Floor', 'Riser', 'Floorplan']
  }
};

function main() {
  const rootDir = path.resolve(process.cwd(), 'public', 'templates');
  fs.mkdirSync(rootDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);

  ARCHITECTURE_TEMPLATES.forEach((tpl, idx) => {
    const map = FOLDER_MAPPINGS[tpl.id] || {
      folder: `${String(idx + 1).padStart(2, '0')}-${tpl.mode}`,
      id: tpl.id,
      category: tpl.categoryName,
      tags: [tpl.badge, tpl.mode.toUpperCase()]
    };

    const folderDir = path.join(rootDir, map.folder);
    fs.mkdirSync(folderDir, { recursive: true });

    const project = tpl.createProject();
    const previewSvg = generateCompositeBuildingSvgMarkup(project, {
      darkTheme: false,
      includeTitleBlock: false,
      whiteBackground: true
    });

    const manifest = {
      id: map.id,
      legacyId: tpl.id,
      name: tpl.name,
      category: map.category,
      mode: tpl.mode,
      badge: tpl.badge,
      version: '1.0.0',
      updatedAt: today,
      author: 'HACHIHI',
      description: tpl.description,
      highlights: tpl.highlights || [
        `${project.floors?.length || 1} tầng`,
        `${Object.keys(project.assets).length} thiết bị`,
        `${project.cables.length} tuyến cáp`
      ],
      projectFile: 'project.json',
      preview: 'preview.svg',
      tags: map.tags
    };

    fs.writeFileSync(path.join(folderDir, 'template.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(folderDir, 'project.json'), `${JSON.stringify(project, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(folderDir, 'preview.svg'), previewSvg, 'utf8');
  });

  const catalog = buildTemplateCatalogFromDir(rootDir);
  console.log(`Seeded ${catalog.totalTemplates} templates into public/templates/ and generated catalog.json.`);
}

main();
