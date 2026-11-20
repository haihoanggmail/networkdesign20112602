import assert from 'node:assert/strict';
import { CableEdge } from '../../types/infrastructure';
import {
  migrateAndValidateProject,
  CURRENT_SCHEMA_VERSION,
  computeProjectChecksum,
  saveRecoverySnapshot,
  listRecoverySnapshots,
  loadLatestValidRecoverySnapshot,
  verifyRecoveryEnvelope,
  clearRecoverySnapshots,
  safeLoadFromStorage,
  RECOVERY_SNAPSHOTS_KEY,
  RECOVERY_STORAGE_KEY,
  AUTO_SNAPSHOT_INTERVAL_MS,
  createProjectSnapshotRecord,
  selectSnapshotIdsToPrune,
  formatByteSize,
  prepareRecoveryEnvelopePayload,
  commitPreparedRecoveryEnvelope,
  toProjectSummaryFromState,
  MAX_LOCALSTORAGE_RECOVERY_CHARS
} from '../projectStorage';
import { saveRecoverySnapshotOffThread, disposeComputeWorkerForTests } from '../computeWorkerClient';
import {
  SHORTCUT_DEFINITIONS,
  getDefaultShortcutKeymap,
  matchesShortcutCombo,
  formatShortcutDisplay,
  findShortcutConflict,
  loadShortcutKeymap,
  saveShortcutKeymap
} from '../../hooks/useKeyboardShortcuts';
import { createSaveCoordinator } from '../saveCoordinator';
import { validateChatRequest, buildSystemInstruction } from '../../server/chatValidation';
import {
  isOriginAllowed,
  extractTrustedClientIp,
  verifyOptionalChatSecret,
  classifyAndSanitizeAiError
} from '../../server/chatSecurity';
import {
  checkRateLimitShared,
  resetInMemoryRateLimitState,
  recordDailyTokenUsage
} from '../../server/chatRateLimit';
import { getAiRuntimeConfig } from '../../server/chatTypes';
import { buildHealthPayload, handleChatRequest } from '../../server/chatService';
import { generatePureSvgMarkup } from '../svgExport';
import { importNetworkScannerData } from '../scannerImport';
import {
  WORKSPACE_PRESETS,
  getWorkspacePresetMeta,
  computeNextHiddenLayersForPreset
} from '../workspacePresets';
import { DEVICE_CATALOG, searchDeviceCatalog } from '../../data/deviceCatalog';
import { computeLegendLayoutMetrics } from '../legendGenerator';
import {
  createEnterpriseTopologyProject,
  createMultiFloorSampleOfficeProject,
  createServerRackProject
} from '../../data/templates';
import {
  areStatesStructurallyEqual,
  pruneOrphanAssets,
  syncAssetPortsWithCables
} from '../../store/useProjectStore';
import { pruneOrphanPatchLinks } from '../../store/slices/rackDeviceHelpers';
import {
  PACKAGE_FORMAT_TAG,
  PACKAGE_FORMAT_VERSION,
  createProjectPackage,
  inspectProjectImportPayload,
  cloneProjectForNewImport
} from '../projectPackage';
import { createEmptyCADDocument } from '../../cad/core/CADDocument';
import {
  LAYER_CATALOG,
  classifyDeviceLayer,
  computeAutoLayeringPlan,
  computeLayerObjectCounts,
  isNodeEffectivelyLocked,
  isRoomEffectivelyLocked,
  isCableEffectivelyLocked,
  isTrayEffectivelyLocked,
  resolveNodeLayer
} from '../layerPolicy';
import {
  getPanelCollapseStorageKey,
  loadPanelCollapsed,
  savePanelCollapsed
} from '../panelCollapseStorage';
import {
  matchesAccentInsensitiveQuery,
  searchHelpCatalog,
  stripVietnameseDiacritics
} from '../helpCatalog';
import {
  APP_VERSION,
  BRAND_INFO,
  buildFeedbackFormUrl,
  formatFeedbackPrefillUrl,
  isFeedbackFormConfigured
} from '../../config/appInfo';
import {
  checkImportPayloadSize,
  isSafeSvgContent,
  MAX_BUNDLE_PROJECTS,
  MAX_EXCEL_FILE_BYTES,
  MAX_IMPORT_JSON_BYTES,
  MAX_PROJECT_ASSETS,
  MAX_PROJECT_CABLES,
  MAX_PROJECT_NODES,
  MAX_SCANNER_FILE_BYTES,
  sanitizeSafeImageUrl
} from '../security';
import type { CustomDevicePreset } from '../../data/deviceCatalog';
import type {
  ProjectRevision,
  ProjectState,
  ProjectSummary
} from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runStorageSecurityAndPolicyTests(runTest: TestFn): Promise<void> {
  // 2. Project Storage Migration & Validation Tests
  await runTest('projectStorage: migrates V3 template cleanly and rejects corrupt JSON', () => {
    const rackProject = createServerRackProject();
    const legacyV3Payload = {
      ...rackProject,
      schemaVersion: undefined,
      racks: rackProject.racks.map(r => {
        const clone = { ...r } as Record<string, unknown>;
        delete clone.rearSlots;
        return clone;
      })
    };

    const migrated = migrateAndValidateProject(legacyV3Payload);
    assert.equal(migrated.ok, true);
    if (migrated.ok) {
      assert.equal(migrated.project.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(migrated.project.racks.length, rackProject.racks.length);
      assert.ok(migrated.project.racks.every(r => typeof r.rearSlots === 'object'));
      assert.equal(Object.keys(migrated.project.assets).length, Object.keys(rackProject.assets).length);
    }

    assert.equal(migrateAndValidateProject(null).ok, false);
    assert.equal(migrateAndValidateProject({ foo: 'bar' }).ok, false);
    assert.equal(migrateAndValidateProject({ assets: {}, nodes: 'not-an-array' }).ok, false);
  });

  // 14. Port Status Synchronization & Hidden Node Migration Tests
  await runTest('store & storage: syncAssetPortsWithCables links/unlinks ports & migrateAndValidateProject preserves node.hidden', () => {
    const proj = createEnterpriseTopologyProject();
    const deviceNodes = proj.nodes.filter(n => n.type !== 'rack' && n.assetId && (proj.assets[n.assetId]?.ports?.length || 0) >= 2);
    assert.ok(deviceNodes.length >= 2);

    const nSrc = deviceNodes[0];
    const nTgt = deviceNodes[1];
    const aSrc = proj.assets[nSrc.assetId!];
    const aTgt = proj.assets[nTgt.assetId!];
    const pSrc = aSrc.ports[0];
    const pTgt = aTgt.ports[0];

    const linkedCable: CableEdge = {
      id: 'cab_port_sync_1',
      cableCode: 'SYNC-01',
      diagramMode: 'topology',
      sourceNodeId: nSrc.id,
      sourcePortId: pSrc.id,
      targetNodeId: nTgt.id,
      targetPortId: pTgt.id,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#155eef',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 12,
      status: 'active'
    };

    const syncedUp = syncAssetPortsWithCables(proj.assets, proj.nodes, [linkedCable]);
    const updatedSrcPort = syncedUp[aSrc.id].ports.find(p => p.id === pSrc.id)!;
    const updatedTgtPort = syncedUp[aTgt.id].ports.find(p => p.id === pTgt.id)!;
    assert.equal(updatedSrcPort.status, 'up');
    assert.equal(updatedSrcPort.connectedCableId, 'cab_port_sync_1');
    assert.deepEqual(updatedSrcPort.connectedTarget, { deviceId: aTgt.id, portId: pTgt.id });
    assert.equal(updatedTgtPort.status, 'up');
    assert.equal(updatedTgtPort.connectedCableId, 'cab_port_sync_1');
    assert.deepEqual(updatedTgtPort.connectedTarget, { deviceId: aSrc.id, portId: pSrc.id });

    // Removing the cable resets both ports back to 'unlinked'
    const syncedDown = syncAssetPortsWithCables(syncedUp, proj.nodes, []);
    const clearedSrcPort = syncedDown[aSrc.id].ports.find(p => p.id === pSrc.id)!;
    const clearedTgtPort = syncedDown[aTgt.id].ports.find(p => p.id === pTgt.id)!;
    assert.equal(clearedSrcPort.status, 'unlinked');
    assert.equal(clearedSrcPort.connectedCableId, undefined);
    assert.equal(clearedSrcPort.connectedTarget, undefined);
    assert.equal(clearedTgtPort.status, 'unlinked');

    // Hidden node preservation across migration
    proj.nodes[0].hidden = true;
    proj.nodes[1].hidden = false;
    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) throw new Error('Expected valid migration');
    assert.equal(migrated.project.nodes[0].hidden, true);
    assert.equal(migrated.project.nodes[1].hidden, undefined);
  });

  // 20. Project Package (.hachihi.json) Deep Round-Trip Export -> SHA-256 -> Import Equality Tests
  await runTest('projectPackage: deep round-trip preserves full ProjectState, embedded images, custom devices, and revisions', async () => {
    const base = createEnterpriseTopologyProject();
    const rackProj = createServerRackProject();

    const embeddedBgDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const customImageDataUrl =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjMTU1RUVGIi8+PC9zdmc+';

    // Compose rich multi-mode project covering topology, floorplan, rack, cctv, wifi, electrical, VLANs, subnets, patchLinks
    base.settings.backgroundImageUrl = embeddedBgDataUrl;
    base.settings.isDarkMode = true;
    base.settings.ipRangeStart = '10.99.0.10';
    base.settings.ipRangeEnd = '10.99.0.200';
    base.settings.ipSubnetMask = '255.255.255.0';
    base.settings.ipGateway = '10.99.0.1';
    base.racks = rackProj.racks;
    base.assets = { ...base.assets, ...rackProj.assets };
    base.vlans = [
      { id: 'vlan_10', vlanId: 10, name: 'MGMT', color: '#155EEF', purpose: 'Management VLAN' }
    ];
    base.subnets = [
      { id: 'sub_10', name: 'Core Subnet', cidr: '10.99.0.0/24', gateway: '10.99.0.1', vlanId: 10, notes: 'Core Subnet' }
    ];
    base.patchLinks = [
      {
        id: 'pl_1',
        patchPanelAssetId: Object.keys(base.assets)[0],
        patchPort: 'P01',
        targetDeviceName: 'CORE-SW-01',
        targetPort: 'Gi1/0/1',
        cableCode: 'CORE-PP01',
        vlan: '10'
      }
    ];

    const customPreset: CustomDevicePreset = {
      id: 'custom_edge_gw_x1',
      createdAt: '2026-06-01T08:00:00.000Z',
      name: 'Edge Gateway Custom X1',
      category: 'router',
      vendor: 'HachihiCustomVendor',
      model: 'EGW-X1-999',
      defaultUHeight: 1,
      powerWatts: 48,
      weightKg: 3.5,
      defaultPorts: [
        { name: 'Eth0', type: 'RJ45_1G', speed: '1 Gbps', poe: false },
        { name: 'SFP1', type: 'SFP_PLUS_10G', speed: '10 Gbps', poe: false }
      ],
      description: 'Custom Edge Gateway preset',
      defaultWidth: 140,
      defaultHeight: 60,
      color: '#155EEF',
      iconName: 'Router'
    };

    const customAssetId = 'ast_custom_egw';
    base.assets[customAssetId] = {
      id: customAssetId,
      name: 'EGW-CUSTOM-01',
      category: 'router',
      vendor: customPreset.vendor,
      model: customPreset.model,
      assetTag: 'TAG-CUSTOM-01',
      serialNumber: 'SN-CUSTOM-99',
      ipAddress: '10.99.0.1',
      subnetMask: '255.255.255.0',
      gateway: '10.99.0.254',
      macAddress: 'AA:BB:CC:DD:EE:01',
      vlan: '10',
      status: 'online',
      powerWatts: 48,
      poeBudgetWatts: 180,
      customImageUrl: customImageDataUrl,
      ports: [
        { id: 'p_eth0', name: 'Eth0', type: 'RJ45_1G', speed: '1 Gbps', poe: false, status: 'up' }
      ]
    };

    base.nodes.push(
      {
        id: 'nd_custom_1',
        diagramMode: 'topology',
        floorId: base.activeFloorId,
        type: 'device',
        assetId: customAssetId,
        label: 'EGW-CUSTOM-01',
        x: 360,
        y: 260,
        width: 140,
        height: 60,
        rotation: 0,
        customImageUrl: customImageDataUrl,
        style: { backgroundColor: '#155EEF', borderColor: '#1e293b', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
      },
      {
        id: 'nd_wifi_1',
        diagramMode: 'wifi',
        floorId: base.activeFloorId,
        type: 'device',
        label: 'AP-MIMO-01',
        x: 520,
        y: 300,
        width: 80,
        height: 80,
        rotation: 0,
        customData: { coverageRadiusMeters: 18 },
        style: { backgroundColor: '#0284c7', borderColor: '#0369a1', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
      },
      {
        id: 'nd_elec_1',
        diagramMode: 'electrical',
        floorId: base.activeFloorId,
        type: 'device',
        label: 'MSB-PANEL-01',
        x: 200,
        y: 420,
        width: 130,
        height: 70,
        rotation: 0,
        style: { backgroundColor: '#f59e0b', borderColor: '#b45309', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
      }
    );

    if (base.cables.length > 0) {
      base.cables[0].controlPoints = [{ x: 240, y: 180 }, { x: 320, y: 240 }];
      base.cables[0].label = 'UPLINK-TRUNK-01';
    }

    const extraLibraryPreset: CustomDevicePreset = {
      id: 'custom_lib_spare',
      createdAt: '2026-06-01T08:30:00.000Z',
      name: 'Spare Industrial Switch',
      category: 'switch',
      vendor: 'SpareTech',
      model: 'IND-SW-12',
      defaultUHeight: 1,
      powerWatts: 30,
      weightKg: 2.2,
      defaultPorts: [
        { name: 'Gi0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true }
      ],
      description: 'Spare industrial switch in custom library',
      defaultWidth: 140,
      defaultHeight: 56,
      color: '#0f172a',
      iconName: 'Network'
    };

    const revisions: ProjectRevision[] = [
      {
        id: 'rev_snap_1',
        projectId: base.id,
        label: 'Chốt thiết kế giai đoạn 1',
        createdAt: '2026-06-01T10:00:00.000Z',
        author: 'Kỹ sư A',
        nodeCount: base.nodes.length,
        assetCount: Object.keys(base.assets).length,
        rackCount: base.racks.length,
        cableCount: base.cables.length,
        snapshot: structuredClone(base)
      }
    ];

    const preMig = migrateAndValidateProject(base);
    assert.equal(preMig.ok, true);
    if (!preMig.ok) throw new Error('Expected valid fixture migration');

    const pkgResult = await createProjectPackage(preMig.project, {
      includeRevisions: true,
      includeFullCustomLibrary: true,
      embedExternalImages: true,
      revisionsOverride: revisions,
      customLibraryOverride: [customPreset, extraLibraryPreset],
      exportedBy: 'Kỹ sư A'
    });

    assert.equal(pkgResult.pkg.manifest.format, PACKAGE_FORMAT_TAG);
    assert.equal(pkgResult.pkg.manifest.formatVersion, PACKAGE_FORMAT_VERSION);
    assert.equal(pkgResult.pkg.checksum.algorithm, 'SHA-256');
    assert.equal(pkgResult.pkg.checksum.digest.length, 64);

    const inspection = await inspectProjectImportPayload(pkgResult.jsonString, [], 'export_test.hachihi.json');
    assert.equal(inspection.ok, true);
    if (!inspection.ok || inspection.kind !== 'package') {
      throw new Error('Expected valid package inspection');
    }

    assert.equal(inspection.integrityStatus, 'valid');
    assert.equal(inspection.isNewerFormat, false);
    assert.equal(inspection.isNewerSchema, false);
    assert.equal(inspection.skippedFields.length, 0);
    assert.equal(inspection.revisions.length, 1);
    assert.ok(inspection.usedCustomDevices.some(d => d.id === customPreset.id));
    assert.equal(inspection.fullCustomLibrary.length, 2);
    assert.equal(inspection.embeddedImageCount, 2);

    // Deep equality check across every structural collection of ProjectState (JSON-canonical to ignore explicit undefined keys)
    const canonicalClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    assert.deepEqual(canonicalClone(inspection.project.buildings), canonicalClone(pkgResult.pkg.project.buildings));
    assert.deepEqual(canonicalClone(inspection.project.floors), canonicalClone(pkgResult.pkg.project.floors));
    assert.deepEqual(canonicalClone(inspection.project.rooms), canonicalClone(pkgResult.pkg.project.rooms));
    assert.deepEqual(canonicalClone(inspection.project.racks), canonicalClone(pkgResult.pkg.project.racks));
    assert.deepEqual(canonicalClone(inspection.project.assets), canonicalClone(pkgResult.pkg.project.assets));
    assert.deepEqual(canonicalClone(inspection.project.nodes), canonicalClone(pkgResult.pkg.project.nodes));
    assert.deepEqual(canonicalClone(inspection.project.cables), canonicalClone(pkgResult.pkg.project.cables));
    assert.deepEqual(canonicalClone(inspection.project.vlans), canonicalClone(pkgResult.pkg.project.vlans));
    assert.deepEqual(canonicalClone(inspection.project.subnets), canonicalClone(pkgResult.pkg.project.subnets));
    assert.deepEqual(canonicalClone(inspection.project.patchLinks), canonicalClone(pkgResult.pkg.project.patchLinks));
    assert.deepEqual(canonicalClone(inspection.project.settings), canonicalClone(pkgResult.pkg.project.settings));
    assert.equal(inspection.project.activeMode, pkgResult.pkg.project.activeMode);
  });

  // 21. Project Package Tampering Detection & Newer Version Warning Tests
  await runTest('projectPackage: detects SHA-256 tampering and warns on newer format/schema versions', async () => {
    const base = createEnterpriseTopologyProject();
    const { pkg } = await createProjectPackage(base, {
      includeRevisions: false,
      includeFullCustomLibrary: false,
      revisionsOverride: [],
      customLibraryOverride: []
    });

    // Mutate project name without updating checksum -> tampered
    const tampered = structuredClone(pkg);
    tampered.project.name = `${tampered.project.name} (TAMPERED)`;
    const tamperedRes = await inspectProjectImportPayload(JSON.stringify(tampered), []);
    assert.equal(tamperedRes.ok, true);
    if (!tamperedRes.ok || tamperedRes.kind !== 'package') throw new Error('Expected package result');
    assert.equal(tamperedRes.integrityStatus, 'tampered');

    // Mutate manifest formatVersion & schemaVersion higher than current app -> newer version warning
    const newer = structuredClone(pkg);
    newer.manifest.formatVersion = PACKAGE_FORMAT_VERSION + 2;
    newer.manifest.schemaVersion = CURRENT_SCHEMA_VERSION + 3;
    const newerRes = await inspectProjectImportPayload(JSON.stringify(newer), []);
    assert.equal(newerRes.ok, true);
    if (!newerRes.ok || newerRes.kind !== 'package') throw new Error('Expected package result');
    assert.equal(newerRes.isNewerFormat, true);
    assert.equal(newerRes.isNewerSchema, true);
    assert.ok(Boolean(newerRes.newerVersionReason));
  });

  // 22. Unknown Field Reporting, Legacy Raw V3 JSON Import, & Conflict-Safe New ID Cloning Tests
  await runTest('projectPackage: reports skipped unknown fields, imports legacy raw JSON, and clones safely on ID conflict', async () => {
    const base = createEnterpriseTopologyProject();
    const rawWithUnknown = {
      ...structuredClone(base),
      schemaVersion: 3,
      experimentalFutureField: { foo: 'bar' },
      settings: {
        ...base.settings,
        unknownSettingBeta: true
      }
    };

    const existingList: ProjectSummary[] = [
      {
        id: base.id,
        name: base.name,
        author: base.author,
        version: base.version,
        lastModified: base.lastModified,
        lastSavedAt: base.lastModified,
        nodeCount: base.nodes.length,
        assetCount: Object.keys(base.assets).length,
        rackCount: base.racks.length,
        cableCount: base.cables.length
      }
    ];

    const rawRes = await inspectProjectImportPayload(JSON.stringify(rawWithUnknown), existingList, 'legacy_v3.json');
    assert.equal(rawRes.ok, true);
    if (!rawRes.ok || rawRes.kind !== 'raw_project') {
      throw new Error('Expected legacy raw_project inspection');
    }

    assert.equal(rawRes.integrityStatus, 'legacy_raw');
    assert.ok(rawRes.skippedFields.includes('project.experimentalFutureField'));
    assert.ok(rawRes.skippedFields.includes('settings.unknownSettingBeta'));
    assert.equal(rawRes.conflictingProject?.id, base.id);

    // Safe "Import as New Copy" generates fresh project ID & remaps all revision IDs
    const fakeRev: ProjectRevision = {
      id: 'rev_old_1',
      projectId: rawRes.project.id,
      label: 'Snapshot 1',
      createdAt: '2026-05-01T00:00:00.000Z',
      author: 'Tester',
      nodeCount: 1,
      assetCount: 1,
      rackCount: 0,
      cableCount: 0,
      snapshot: structuredClone(rawRes.project)
    };
    const cloned = cloneProjectForNewImport(rawRes.project, [fakeRev]);
    assert.notEqual(cloned.project.id, rawRes.project.id);
    assert.ok(cloned.project.id.startsWith('proj_'));
    assert.equal(cloned.revisions.length, 1);
    assert.equal(cloned.revisions[0].projectId, cloned.project.id);
    assert.equal(cloned.revisions[0].snapshot.id, cloned.project.id);
    assert.notEqual(cloned.revisions[0].id, fakeRev.id);
  });

  // 25. Layer Policy Lock Enforcement Tests
  await runTest('layerPolicy: resolves layers and enforces lockedLayers for nodes, rooms, cables & read-only mode', () => {
    const rackNode = { type: 'rack' as const, assetId: undefined, locked: false };
    const textNode = { type: 'text' as const, assetId: undefined, locked: false };
    const deviceNode = { type: 'device' as const, assetId: 'ast_sw1', locked: false };

    assert.equal(resolveNodeLayer(rackNode), 'racks');
    assert.equal(resolveNodeLayer(textNode), 'labels');
    assert.equal(resolveNodeLayer(deviceNode), 'devices');

    const lockDevicesSettings = { lockedLayers: ['devices' as const, 'rooms' as const] };
    assert.equal(isNodeEffectivelyLocked(deviceNode, lockDevicesSettings), true);
    assert.equal(isNodeEffectivelyLocked(rackNode, lockDevicesSettings), false);
    assert.equal(isRoomEffectivelyLocked({ locked: false }, lockDevicesSettings), true);
    assert.equal(isCableEffectivelyLocked({ id: 'cab_1' }, lockDevicesSettings), false);

    // Individual node/room lock or read-only mode always forces lock
    assert.equal(isNodeEffectivelyLocked({ ...rackNode, locked: true }, {}), true);
    assert.equal(isNodeEffectivelyLocked(rackNode, {}, undefined, true), true);
    assert.equal(isCableEffectivelyLocked({ id: 'cab_1' }, {}, true), true);
  });

  // 26. Help Catalog Accent-Insensitive Search Tests
  await runTest('helpCatalog: strips Vietnamese diacritics and matches unaccented technical queries', () => {
    assert.equal(stripVietnameseDiacritics('Khóa lớp & Tỉ lệ Đường dây'), 'khoa lop & ti le duong day');

    const lockResults = searchHelpCatalog('khoa lop');
    assert.ok(lockResults.some(t => t.id === 'help-layer-lock'));

    const bomResults = searchHelpCatalog('bom vat tu');
    assert.ok(bomResults.some(t => t.id === 'help-bom'));

    const scaleResults = searchHelpCatalog('ti le');
    assert.ok(scaleResults.some(t => t.id === 'help-scale-measure'));

    const filteredByCat = searchHelpCatalog('', 'tu-rack');
    assert.ok(filteredByCat.length >= 2);
    assert.ok(filteredByCat.every(t => t.category === 'tu-rack'));
  });

  // 27. Brand & Single-Source SemVer 3.1.1 Versioning Tests
  await runTest('appInfo & projectPackage: stamps single-source version 3.1.1 and HACHIHI brand constants', async () => {
    assert.equal(APP_VERSION, '3.1.1');
    assert.equal(BRAND_INFO.websiteUrl, 'https://hachihi.vn');
    assert.equal(BRAND_INFO.hotlineDisplay, '093 384 2126');

    const proj = createEnterpriseTopologyProject();
    const { pkg } = await createProjectPackage(proj, {
      includeRevisions: false,
      includeFullCustomLibrary: false,
      revisionsOverride: [],
      customLibraryOverride: []
    });
    assert.equal(pkg.manifest.appVersion, APP_VERSION);
  });

  // 31. Layer Policy Trays, Counts & SVG Hidden Layer Filter Tests (Group 1)
  await runTest('layerPolicy & svgExport: includes trays & semantic layers, enforces tray locks, counts objects per layer & filters hidden SVG layers', () => {
    assert.ok(LAYER_CATALOG.some(l => l.id === 'trays'));
    assert.ok(LAYER_CATALOG.some(l => l.id === 'network'));
    assert.ok(LAYER_CATALOG.some(l => l.id === 'iot'));
    assert.ok(LAYER_CATALOG.some(l => l.id === 'electrical'));
    assert.equal(LAYER_CATALOG.length, 12);

    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: false }, { lockedLayers: ['trays'] }), true);
    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: true }, {}), true);
    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: false }, {}, true), true);
    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: false }, {}), false);

    const sample = createMultiFloorSampleOfficeProject();
    sample.cableTrays = [
      { id: 'tray_1', name: 'Máng trục chính', floorId: sample.activeFloorId, kind: 'network_tray', widthPx: 24, points: [{ x: 100, y: 100 }, { x: 400, y: 100 }] }
    ];
    const counts = computeLayerObjectCounts(sample, sample.activeFloorId);
    assert.equal(counts.trays, 1);
    assert.ok(counts.racks >= 1);
    assert.ok(counts.devices >= 1);
    assert.ok(counts.cables >= 1);

    const hiddenSvg = generatePureSvgMarkup({
      ...sample,
      settings: {
        ...sample.settings,
        hiddenLayers: ['cables', 'cable_labels']
      }
    });
    assert.ok(!hiddenSvg.includes('data-layer="cable-labeling"'));
  });

  // 32. Unified Command Center Accent-Insensitive Matching Tests (Group 3)
  await runTest('helpCatalog: matches unaccented Vietnamese commands & help topics for unified Command Center', () => {
    assert.equal(matchesAccentInsensitiveQuery('Xem Thống kê Vật tư & Dự toán (BOM)', 'bom vat tu'), true);
    assert.equal(matchesAccentInsensitiveQuery('In / Xuất bản vẽ PDF A4', 'xuat pdf'), true);
    assert.equal(matchesAccentInsensitiveQuery('Tự định tuyến toàn bộ tuyến cáp', 'tu dinh tuyen'), true);
    assert.equal(matchesAccentInsensitiveQuery('Kiểm tra kỹ thuật · Kiểm tra trùng IP', 'ip trung'), true);

    const wireGuide = searchHelpCatalog('huong dan noi day');
    assert.ok(wireGuide.some(t => t.id === 'help-drag-connect'));
  });

  // 34. Feedback URL Safety Tests
  await runTest('appInfo: buildFeedbackFormUrl returns null when unconfigured without emitting placeholder entry IDs', () => {
    assert.equal(isFeedbackFormConfigured(''), false);
    assert.equal(formatFeedbackPrefillUrl('', {}, { activeMode: 'topology', deviceType: 'Desktop' }), null);
    assert.equal(isFeedbackFormConfigured(), true);
    const built = buildFeedbackFormUrl({ activeMode: 'topology', deviceType: 'Desktop' });
    assert.ok(built?.startsWith('https://forms.gle/qEkFLC1sCtZmRRcU8'));
    assert.equal(built?.includes('entry.'), false);
  });

  // 35. Security Payload Limits, SVG Guard & Populated Feedback Prefill Tests (A3 & A5)
  await runTest('security & appInfo: enforces import payload/entity caps, blocks unsafe SVG images/use & formats feedback prefill URL cleanly', async () => {
    assert.equal(
      formatFeedbackPrefillUrl('https://docs.google.com/forms/d/e/test/viewform', {}, { activeMode: 'fiber', deviceType: 'Desktop' }),
      'https://docs.google.com/forms/d/e/test/viewform?usp=pp_url'
    );
    const fullPrefill = formatFeedbackPrefillUrl(
      'https://docs.google.com/forms/d/e/test/viewform',
      {
        version: 'entry.1001',
        build: 'entry.1002',
        mode: 'entry.1003',
        device: 'entry.1004'
      },
      { activeMode: 'floorplan', deviceType: 'Tablet', version: '3.1.1', buildHash: 'abc123' }
    );
    assert.ok(fullPrefill?.includes('entry.1001=3.1.1'));
    assert.ok(fullPrefill?.includes('entry.1002=abc123'));
    assert.ok(fullPrefill?.includes('entry.1003=floorplan'));
    assert.ok(fullPrefill?.includes('entry.1004=Tablet'));

    // Reject dangerous <image> and <use> SVG patterns
    assert.equal(isSafeSvgContent('<svg><image href="https://evil.example/track.png"/></svg>'), false);
    assert.equal(isSafeSvgContent('<svg><use xlink:href="https://evil.example/sprite.svg#x"/></svg>'), false);
    assert.equal(isSafeSvgContent('<svg viewBox="0 0 24 24"><rect width="24" height="24" fill="#155eef"/></svg>'), true);

    // Reject oversized file size checks & project node limit
    const sizeFail = checkImportPayloadSize({ size: MAX_IMPORT_JSON_BYTES + 1024 }, MAX_IMPORT_JSON_BYTES, 'test.hachihi.json');
    assert.equal(sizeFail.ok, false);
    const scannerSample = createMultiFloorSampleOfficeProject();
    assert.throws(() => {
      const fakeBigScanner = 'x'.repeat(MAX_SCANNER_FILE_BYTES + 128);
      importNetworkScannerData(fakeBigScanner, scannerSample);
    }, /vượt quá giới hạn an toàn/i);

    const tooManyNodes = Array.from({ length: MAX_PROJECT_NODES + 1 }, (_, i) => ({
      id: `n_${i}`,
      diagramMode: 'topology',
      type: 'device',
      label: `N${i}`,
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
    }));
    const capRes = migrateAndValidateProject({ assets: {}, nodes: tooManyNodes });
    assert.equal(capRes.ok, false);
  });

  // 36. Deep 8-Mode + CableTray + Directory + Unknown-Field Round-Trip Package Tests (D6)
  await runTest('projectPackage: preserves all 8 design modes, cableTrays, VLAN/Subnet/PatchLink & reports unknown fields on round-trip', async () => {
    const base = createMultiFloorSampleOfficeProject();
    const modes: Array<ProjectState['activeMode']> = [
      'topology',
      'floorplan',
      'rack',
      'fiber',
      'cctv',
      'wifi',
      'electrical',
      'multisite'
    ];
    modes.forEach((mode, idx) => {
      base.nodes.push({
        id: `mode_node_${idx}`,
        diagramMode: mode,
        floorId: base.activeFloorId,
        type: 'text',
        label: `Mode ${mode}`,
        x: 100 + idx * 40,
        y: 120,
        width: 120,
        height: 48,
        rotation: 0,
        style: { backgroundColor: '#0284c7', borderColor: '#0f172a', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
      });
    });
    base.cableTrays = [
      {
        id: 'tray_rt_1',
        name: 'Máng cáp trục chính',
        floorId: base.activeFloorId,
        kind: 'network_tray',
        widthPx: 32,
        points: [{ x: 50, y: 50 }, { x: 450, y: 50 }]
      }
    ];
    base.vlans = [{ id: 'v10', vlanId: 10, name: 'VLAN 10 Data' }];
    base.subnets = [{ id: 's10', name: 'Office LAN', cidr: '10.10.10.0/24', vlanId: 10, gateway: '10.10.10.1' }];
    base.patchLinks = [{ id: 'p1', patchPanelAssetId: 'pp_1', patchPort: 'P01', targetDeviceName: 'SW-01', targetPort: 'Gi1/0/1' }];

    const { jsonString } = await createProjectPackage(base, { embedExternalImages: false });
    const parsedPkg = JSON.parse(jsonString) as Record<string, unknown>;
    (parsedPkg.project as Record<string, unknown>).experimentalExtension = 'kept_in_skipped_report';

    const inspected = await inspectProjectImportPayload(parsedPkg, []);
    assert.equal(inspected.ok, true);
    if (inspected.ok && inspected.kind === 'package') {
      assert.equal(inspected.project.cableTrays?.length, 1);
      assert.equal(inspected.project.cableTrays?.[0].name, 'Máng cáp trục chính');
      assert.equal(inspected.project.vlans?.length, 1);
      assert.equal(inspected.project.subnets?.length, 1);
      assert.equal(inspected.project.patchLinks?.length, 1);
      for (const m of modes) {
        assert.ok(inspected.project.nodes.some(n => n.diagramMode === m));
      }
      assert.ok(inspected.skippedFields.includes('project.experimentalExtension'));
    }
  });

  // 44. Auto-Layering (Network / IoT / Electrical), Scalable Legend Table & Adjustable Wi-Fi Coverage Radius
  await runTest('auto-layering, scalable legend & adjustable Wi-Fi coverage work end-to-end across policy, SVG export & migration', () => {
    const sample = createMultiFloorSampleOfficeProject();
    const floorId = sample.activeFloorId;

    // Add IoT Sensor and Electrical UPS/PDU alongside existing switches/APs
    const sensorAssetId = 'asset_sensor_test';
    const upsAssetId = 'asset_ups_test';
    const apAssetId = 'asset_ap_test';
    const baseStyle = {
      backgroundColor: '#0d9488',
      borderColor: '#115e59',
      borderWidth: 2,
      borderStyle: 'solid' as const,
      opacity: 1
    };
    const netDefaults = {
      serialNumber: 'SN-TEST-001',
      ipAddress: '',
      subnetMask: '255.255.255.0',
      gateway: '10.1.0.1',
      macAddress: '00:11:22:33:44:55',
      vlan: '10'
    };
    sample.assets[sensorAssetId] = {
      ...netDefaults,
      id: sensorAssetId,
      name: 'Cảm biến Nhiệt độ Tầng 1',
      assetTag: 'IOT-SNS-01',
      status: 'online',
      category: 'sensor',
      vendor: 'Aqara',
      model: 'TH-Sensor',
      ports: [],
      powerWatts: 2
    };
    sample.assets[upsAssetId] = {
      ...netDefaults,
      id: upsAssetId,
      name: 'UPS Online 3kVA',
      assetTag: 'PWR-UPS-01',
      status: 'online',
      category: 'ups',
      vendor: 'APC',
      model: 'SRT3000',
      ports: [],
      powerWatts: 120
    };
    sample.assets[apAssetId] = {
      ...netDefaults,
      id: apAssetId,
      name: 'AP Wi-Fi 6 Sảnh',
      assetTag: 'WIFI-AP-01',
      status: 'online',
      category: 'ap',
      vendor: 'UniFi',
      model: 'U6-Pro',
      ipAddress: '10.1.0.88',
      ports: [],
      powerWatts: 18,
      wifiSpecs: {
        ssid: 'HACHIHI-PRO',
        bands: '2.4GHz + 5GHz',
        channel24: 6,
        channel5: 36,
        txPowerDbm: 23,
        coverageRadiusMeters: 24.5,
        maxClients: 200,
        standard: 'Wi-Fi 6 (802.11ax)'
      }
    };

    const sensorNode = {
      id: 'node_sensor_test',
      type: 'device' as const,
      diagramMode: 'topology' as const,
      floorId,
      x: 160,
      y: 160,
      width: 112,
      height: 82,
      rotation: 0,
      style: baseStyle,
      label: 'Cảm biến Nhiệt độ',
      assetId: sensorAssetId
    };
    const upsNode = {
      id: 'node_ups_test',
      type: 'device' as const,
      diagramMode: 'topology' as const,
      floorId,
      x: 320,
      y: 160,
      width: 112,
      height: 82,
      rotation: 0,
      style: baseStyle,
      label: 'UPS 3kVA',
      assetId: upsAssetId
    };
    const apNode = {
      id: 'node_ap_test',
      type: 'device' as const,
      diagramMode: 'topology' as const,
      floorId,
      x: 520,
      y: 260,
      width: 112,
      height: 82,
      rotation: 0,
      style: baseStyle,
      label: 'AP Wi-Fi 6 Sảnh',
      assetId: apAssetId,
      customData: { coverageRadiusMeters: 24.5 }
    };
    sample.nodes.push(sensorNode, upsNode, apNode);

    // 1) Classify devices by semantic type
    const swNode = sample.nodes.find(n => n.type === 'device' && sample.assets[n.assetId || '']?.category === 'switch') || sample.nodes[0];
    assert.equal(classifyDeviceLayer(swNode, sample.assets), 'network');
    assert.equal(classifyDeviceLayer(sensorNode, sample.assets), 'iot');
    assert.equal(classifyDeviceLayer(apNode, sample.assets), 'iot');
    assert.equal(classifyDeviceLayer(upsNode, sample.assets), 'electrical');

    // Unset layerId remains backward-compatible as 'devices'
    assert.equal(resolveNodeLayer(sensorNode, sample.assets), 'devices');

    // 2) Auto-layering assigns semantic layerId, updates counts & respects hidden/locked semantic layers
    const plan = computeAutoLayeringPlan(sample);
    assert.ok(plan.summary.updatedCount >= 3);
    const layeredProject: ProjectState = {
      ...sample,
      nodes: plan.nodes,
      settings: {
        ...sample.settings,
        autoLayeringEnabled: true,
        lockedLayers: ['electrical'],
        hiddenLayers: ['iot']
      }
    };
    const counts = computeLayerObjectCounts(layeredProject, floorId);
    assert.ok(counts.network >= 1);
    assert.ok(counts.iot >= 2);
    assert.ok(counts.electrical >= 1);

    const layeredSensor = layeredProject.nodes.find(n => n.id === 'node_sensor_test')!;
    const layeredUps = layeredProject.nodes.find(n => n.id === 'node_ups_test')!;
    assert.equal(resolveNodeLayer(layeredSensor, layeredProject.assets), 'iot');
    assert.equal(resolveNodeLayer(layeredUps, layeredProject.assets), 'electrical');
    assert.equal(isNodeEffectivelyLocked(layeredUps, layeredProject.settings, layeredProject.assets, false), true);
    assert.equal(isNodeEffectivelyLocked(layeredSensor, layeredProject.settings, layeredProject.assets, false), false);

    // 3) Hidden 'iot' layer hides sensor & AP in pure SVG export, while visible AP with Wi-Fi coverage renders exact radius
    const hiddenIotSvg = generatePureSvgMarkup(layeredProject);
    assert.ok(!hiddenIotSvg.includes('Cảm biến Nhiệt độ'));

    const visibleWifiProject: ProjectState = {
      ...layeredProject,
      settings: {
        ...layeredProject.settings,
        showCoverageRadius: true,
        hiddenLayers: []
      }
    };
    const wifiSvg = generatePureSvgMarkup(visibleWifiProject);
    const expectedRadiusPx = String(24.5 * (visibleWifiProject.settings.scale || 30));
    assert.ok(wifiSvg.includes(`r="${expectedRadiusPx}"`), `Expected Wi-Fi SVG circle radius ${expectedRadiusPx}`);

    // 4) Scalable Legend metrics: compact vs wide 2-column & pure SVG clipPath
    const compactLegend = computeLegendLayoutMetrics(230, 140, 6);
    assert.equal(compactLegend.columns, 1);
    assert.equal(compactLegend.isCompact, true);
    assert.ok(compactLegend.scale < 0.85);

    const wideLegend = computeLegendLayoutMetrics(620, 420, 6);
    assert.equal(wideLegend.columns, 2);
    assert.equal(wideLegend.isCompact, false);
    assert.ok(wideLegend.scale >= 1.1);

    visibleWifiProject.nodes.push({
      id: 'node_legend_scaled',
      type: 'legend',
      diagramMode: visibleWifiProject.activeMode,
      floorId,
      x: 80,
      y: 420,
      width: 600,
      height: 360,
      rotation: 0,
      style: {
        backgroundColor: '#ffffff',
        borderColor: '#1d4ed8',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1
      },
      label: 'BẢNG CHÚ GIẢI KÝ HIỆU THIẾT BỊ',
      customData: { legendScale: 1.25 }
    });
    const legendSvg = generatePureSvgMarkup(visibleWifiProject);
    assert.ok(legendSvg.includes('legend-clip-0'));
    assert.ok(legendSvg.includes('BẢNG CHÚ GIẢI KÝ HIỆU THIẾT BỊ'));

    // 5) Migration preserves semantic node.layerId, legendScale, and autoLayeringEnabled
    const migrated = migrateAndValidateProject(visibleWifiProject);
    assert.equal(migrated.ok, true);
    assert.equal(migrated.project.settings.autoLayeringEnabled, true);
    assert.equal(
      migrated.project.nodes.find(n => n.id === 'node_sensor_test')?.layerId,
      'iot'
    );
    assert.equal(
      migrated.project.nodes.find(n => n.id === 'node_legend_scaled')?.customData?.legendScale,
      1.25
    );
  });

  // 46. UI/UX 4.0 Workspace Presets & Accent-Insensitive Device/Port Catalog Search Tests
  await runTest('workspacePresets & deviceCatalog: resolves 4 presets, unhides required layers, and searches devices by Vietnamese unaccented text and port specs', () => {
    assert.equal(WORKSPACE_PRESETS.length, 4);
    const elecPreset = getWorkspacePresetMeta('electrical_design');
    assert.equal(elecPreset.targetMode, 'electrical');
    assert.equal(elecPreset.preferredRightTab, 'power');

    const auditPreset = getWorkspacePresetMeta('audit_review');
    assert.equal(auditPreset.leftCollapsed, true);
    assert.equal(auditPreset.rightCollapsed, false);
    assert.equal(auditPreset.showIpAddresses, true);

    const nextHidden = computeNextHiddenLayersForPreset(
      ['electrical', 'cables', 'rooms', 'trays'],
      elecPreset
    );
    assert.equal(nextHidden.includes('electrical'), false);
    assert.equal(nextHidden.includes('cables'), false);
    assert.equal(nextHidden.includes('rooms'), true);

    // Accent-insensitive Vietnamese search in catalog
    const sensorHits = searchDeviceCatalog(DEVICE_CATALOG, 'cam bien');
    assert.ok(sensorHits.some(d => d.category === 'sensor' || d.category === 'iot'));

    const powerHits = searchDeviceCatalog(DEVICE_CATALOG, 'phan phoi nguon');
    assert.ok(powerHits.some(d => d.category === 'pdu' || d.category === 'ups'));

    // Port spec search (SFP+, QSFP28, RJ45, PoE)
    const qsfpHits = searchDeviceCatalog(DEVICE_CATALOG, 'QSFP28');
    assert.ok(qsfpHits.some(d => d.category === 'core_switch'));

    const sfpHits = searchDeviceCatalog(DEVICE_CATALOG, 'SFP+');
    assert.ok(sfpHits.length >= 2);
  });

  // 57. P0 #1 — SaveCoordinator Single-Flight Queue, Dirty Versioning & Failure Retention
  await runTest('saveCoordinator (P0#1): prevents stale save clears, re-drains mid-save edits, retains dirty on error, flushes cleanly', async () => {
    const writes: Array<{ val: string; version: number }> = [];
    let releaseFirst!: () => void;
    let blockFirst = true;
    let failNext = false;

    const coordinator = createSaveCoordinator<{ id: string; text: string }>({
      debounceMs: 10,
      onPersist: async (snap, version) => {
        if (blockFirst) {
          blockFirst = false;
          await new Promise<void>(resolve => {
            releaseFirst = resolve;
          });
        }
        if (failNext) {
          return { ok: false, error: 'IndexedDB Quota Exceeded' };
        }
        writes.push({ val: snap.text, version });
        return { ok: true };
      }
    });

    // 1) Schedule v1 and start flush; while v1 is in-flight, markDirty v2
    const p1 = coordinator.saveNow({ id: 'p1', text: 'v1' });
    // Yield a microtask so onPersist enters await
    await new Promise(r => setTimeout(r, 5));
    coordinator.markDirty({ id: 'p1', text: 'v2-mid-save' });
    assert.equal(coordinator.getStatus().hasUnsavedChanges, true);

    releaseFirst();
    const res1 = await p1;
    assert.equal(res1.ok, true);
    // Coordinator must have automatically drained v2 without clearing dirty prematurely!
    assert.equal(writes.length, 2);
    assert.equal(writes[1].val, 'v2-mid-save');
    assert.equal(coordinator.getStatus().hasUnsavedChanges, false);
    assert.equal(coordinator.getStatus().dirtyVersion, coordinator.getStatus().committedVersion);

    // 2) Persist failure keeps hasUnsavedChanges=true and sets storageError; subsequent save succeeds
    failNext = true;
    const failRes = await coordinator.saveNow({ id: 'p1', text: 'v3-fail' });
    assert.equal(failRes.ok, false);
    assert.equal(coordinator.getStatus().hasUnsavedChanges, true);
    assert.equal(coordinator.getStatus().storageError, 'IndexedDB Quota Exceeded');

    failNext = false;
    const retryRes = await coordinator.flush({ id: 'p1', text: 'v3-recovered' });
    assert.equal(retryRes.ok, true);
    assert.equal(coordinator.getStatus().hasUnsavedChanges, false);
    assert.equal(coordinator.getStatus().storageError, null);
    assert.equal(writes[writes.length - 1].val, 'v3-recovered');

    coordinator.dispose();
  });

  // 58. P0 #2 — 3-Tier Emergency Recovery Ring & Checksum Integrity Verification
  await runTest('projectStorage (P0#2): maintains 3-snapshot rotating ring, verifies FNV-1a checksum & rejects tampered envelopes', () => {
    const storeMap = new Map<string, string>();
    const prevLS = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      get length() {
        return storeMap.size;
      },
      clear: () => storeMap.clear(),
      getItem: (k: string) => (storeMap.has(k) ? storeMap.get(k)! : null),
      key: (i: number) => Array.from(storeMap.keys())[i] ?? null,
      removeItem: (k: string) => {
        storeMap.delete(k);
      },
      setItem: (k: string, v: string) => {
        storeMap.set(k, String(v));
      }
    };

    try {
      clearRecoverySnapshots();
      const base = createEnterpriseTopologyProject();
      // Save 4 snapshots -> ring must cap to 3 newest
      for (let i = 1; i <= 4; i++) {
        const clone: ProjectState = {
          ...structuredClone(base),
          name: `Project Snap ${i}`,
          lastModified: new Date(1_750_000_000_000 + i * 60_000).toISOString()
        };
        const res = saveRecoverySnapshot(clone, i === 4 ? 'crash_guard' : 'autosave');
        assert.equal(res.ok, true);
      }

      const listed = listRecoverySnapshots();
      assert.equal(listed.length, 3);
      assert.ok(listed.every(e => e.ok));
      if (listed[0].ok) {
        assert.equal(listed[0].envelope.projectName, 'Project Snap 4');
        assert.equal(listed[0].envelope.checksum, computeProjectChecksum(listed[0].envelope.project));
      }

      // Corrupt primary recovery + newest ring entry -> list rejects tampered & loads valid fallback (#3)
      const rawRing = JSON.parse(storeMap.get(RECOVERY_SNAPSHOTS_KEY)!) as Array<Record<string, unknown>>;
      rawRing[0] = {
        ...rawRing[0],
        checksum: 'fnv1a-deadbeef'
      };
      storeMap.set(RECOVERY_SNAPSHOTS_KEY, JSON.stringify(rawRing));
      storeMap.set(RECOVERY_STORAGE_KEY, JSON.stringify(rawRing[0]));

      const afterTamper = listRecoverySnapshots();
      assert.equal(afterTamper[0].ok, false);
      const latestValid = loadLatestValidRecoverySnapshot();
      assert.ok(latestValid, 'Should gracefully fall back to valid snapshot #3');
      assert.equal(latestValid.envelope.projectName, 'Project Snap 3');
      assert.equal(safeLoadFromStorage(RECOVERY_STORAGE_KEY), null);

      const reVerified = verifyRecoveryEnvelope(rawRing[1]);
      assert.equal(reVerified.ok, true);
    } finally {
      if (prevLS === undefined) {
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as unknown as { localStorage: Storage }).localStorage = prevLS;
      }
    }
  });

  // 61. P0 #5 — Unified AI API Security Layer (Validation, Origin, IP Spoof Prevention, Fail-Closed Redis, Error Sanitization)
  await runTest('server chat security (P0#5): validates bounds, stops IP/Origin spoofing, verifies secret & enforces fail-closed limiter', async () => {
    // 1) Validation boundaries
    assert.equal(validateChatRequest({ message: 'Kiểm tra tủ rack MDF' }).ok, true);
    assert.equal(validateChatRequest({ message: '' }).ok, false);
    assert.equal(validateChatRequest({ message: 'x'.repeat(5000) }).ok, false);
    assert.equal(validateChatRequest({ message: 'ok' }, 600 * 1024).ok, false);

    const sysPrompt = buildSystemInstruction('rack_power', { projectName: 'HACHIHI Test', deviceCount: 12, rackCount: 2 });
    assert.ok(sysPrompt.includes('HACHIHI Test'));

    // 2) Trusted client IP extraction ignores spoofed left XFF entry when platform headers exist
    assert.equal(
      extractTrustedClientIp({
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'x-vercel-forwarded-for': '203.0.113.99'
      }),
      '203.0.113.99'
    );
    assert.equal(
      extractTrustedClientIp({ 'x-forwarded-for': '9.9.9.9, 198.51.100.7' }),
      '198.51.100.7'
    );

    // 3) Origin allowlist & optional timing-safe secret
    assert.equal(isOriginAllowed({ host: 'app.hachihi.vn', origin: 'https://app.hachihi.vn' }, {}), true);
    assert.equal(isOriginAllowed({ host: 'app.hachihi.vn', origin: 'https://evil.example.com' }, {}), false);
    assert.equal(verifyOptionalChatSecret({}, undefined), true);
    assert.equal(verifyOptionalChatSecret({}, 'top-secret'), false);
    assert.equal(verifyOptionalChatSecret({ 'x-hachihi-token': 'top-secret' }, 'top-secret'), true);

    // 4) Rate limiting & fail-closed Redis behavior (minimum per-minute safety floor is 3)
    resetInMemoryRateLimitState();
    const cfgMem = getAiRuntimeConfig({ CHAT_RATE_LIMIT_PER_MIN: '3', CHAT_RATE_LIMIT_PER_HOUR: '10', CHAT_DAILY_LIMIT: '50' });
    assert.equal((await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_000 })).allowed, true);
    assert.equal((await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_100 })).allowed, true);
    assert.equal((await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_150 })).allowed, true);
    const blocked = await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_200 });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.statusCode, 429);

    await recordDailyTokenUsage(1_000, { config: cfgMem, now: 100_200 });

    const cfgRedisFailClosed = getAiRuntimeConfig({
      NODE_ENV: 'production',
      UPSTASH_REDIS_REST_URL: 'https://redis.invalid',
      UPSTASH_REDIS_REST_TOKEN: 'tok'
    });
    const redisOutage = await checkRateLimitShared('192.0.2.11', {
      config: cfgRedisFailClosed,
      fetchImpl: async () => {
        throw new Error('Redis connection refused');
      }
    });
    assert.equal(redisOutage.allowed, false);
    assert.equal(redisOutage.statusCode, 503);

    // 5) Sanitized error mapping never leaks raw API keys
    const keyErr = classifyAndSanitizeAiError(new Error('403 API_KEY_INVALID AIzaSySecretLeak123'));
    assert.equal(keyErr.statusCode, 403);
    assert.equal(keyErr.error.includes('AIzaSySecretLeak123'), false);
    const timeoutErr = classifyAndSanitizeAiError(new Error('GEMINI_TIMEOUT'));
    assert.equal(timeoutErr.statusCode, 504);
  });

  // 65. CA-05 — SaveCoordinator Debounce, Deferral While Dragging, Error Retention, Flush, Reset & Dispose (8+ assertions)
  await runTest('saveCoordinator (CA-05): debounce coalescing, repeated deferral while dragging, flush bypass, error/reject retention, reset, dispose & version invariant', async () => {
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    const writes: Array<{ val: string; version: number }> = [];
    let isDragging = false;
    let mode: 'ok' | 'err_obj' | 'throw_err' = 'ok';
    const statuses: Array<{ dirtyVersion: number; committedVersion: number; hasUnsavedChanges: boolean; storageError: string | null }> = [];

    const coord = createSaveCoordinator<{ seq: string }>({
      debounceMs: 25,
      shouldDeferAutoSave: () => isDragging,
      onStatusChange: st => {
        statuses.push({
          dirtyVersion: st.dirtyVersion,
          committedVersion: st.committedVersion,
          hasUnsavedChanges: st.hasUnsavedChanges,
          storageError: st.storageError
        });
        assert.ok(
          st.committedVersion <= st.dirtyVersion,
          `Invariant committedVersion (${st.committedVersion}) <= dirtyVersion (${st.dirtyVersion}) must always hold`
        );
      },
      onPersist: async (snap, version) => {
        if (mode === 'err_obj') return { ok: false, error: 'Disk full' };
        if (mode === 'throw_err') throw new Error('IndexedDB transaction aborted');
        writes.push({ val: snap.seq, version });
        return { ok: true };
      }
    });

    // Case 1: Rapid edits coalesce into a single write (debounce)
    coord.scheduleSave({ seq: 'edit-1' });
    coord.scheduleSave({ seq: 'edit-2' });
    coord.scheduleSave({ seq: 'edit-3' });
    assert.equal(coord.getStatus().hasUnsavedChanges, true);
    await wait(55);
    assert.equal(writes.length, 1, 'Multiple rapid scheduleSave calls must coalesce into 1 write');
    assert.equal(writes[0].val, 'edit-3');
    assert.equal(coord.getStatus().hasUnsavedChanges, false);

    // Case 2 & 3: Error return & rejected promise retain hasUnsavedChanges=true and set storageError
    mode = 'err_obj';
    const failObjRes = await coord.saveNow({ seq: 'fail-obj' });
    assert.equal(failObjRes.ok, false);
    assert.equal(coord.getStatus().hasUnsavedChanges, true);
    assert.equal(coord.getStatus().storageError, 'Disk full');

    mode = 'throw_err';
    const failThrowRes = await coord.saveNow({ seq: 'fail-throw' });
    assert.equal(failThrowRes.ok, false);
    assert.equal(coord.getStatus().hasUnsavedChanges, true);
    assert.equal(coord.getStatus().storageError, 'IndexedDB transaction aborted');

    mode = 'ok';
    const recovered = await coord.flush({ seq: 'recovered' });
    assert.equal(recovered.ok, true);
    assert.equal(coord.getStatus().hasUnsavedChanges, false);
    assert.equal(coord.getStatus().storageError, null);

    // Case 4: shouldDeferAutoSave keeps deferring repeatedly across multiple cycles while dragging
    const writesBeforeDrag = writes.length;
    isDragging = true;
    coord.scheduleSave({ seq: 'drag-step-1' }, 15);
    await wait(70); // > 4x debounce cycles while still dragging
    assert.equal(writes.length, writesBeforeDrag, 'Auto-save must stay deferred across multiple cycles while dragging');
    assert.equal(coord.getStatus().hasUnsavedChanges, true);

    isDragging = false;
    await wait(45);
    assert.equal(writes.length, writesBeforeDrag + 1, 'Auto-save must drain automatically once dragging ends');
    assert.equal(writes[writes.length - 1].val, 'drag-step-1');
    assert.equal(coord.getStatus().hasUnsavedChanges, false);

    // Case 5: flush() on tab close bypasses deferral and drains pending debounced write immediately
    isDragging = true;
    coord.scheduleSave({ seq: 'tab-close-snap' }, 500);
    const flushRes = await coord.flush();
    assert.equal(flushRes.ok, true);
    assert.equal(writes[writes.length - 1].val, 'tab-close-snap');
    assert.equal(coord.getStatus().hasUnsavedChanges, false);
    isDragging = false;

    // Case 6: reset() clears dirty/error state and cancels pending debounce timer
    mode = 'err_obj';
    await coord.saveNow({ seq: 'before-reset-err' });
    assert.equal(coord.getStatus().hasUnsavedChanges, true);
    mode = 'ok';
    const writesBeforeReset = writes.length;
    coord.scheduleSave({ seq: 'cancelled-by-reset' }, 30);
    coord.reset({ seq: 'fresh-project' }, '2026-11-18T00:00:00.000Z');
    assert.equal(coord.getStatus().hasUnsavedChanges, false);
    assert.equal(coord.getStatus().storageError, null);
    assert.equal(coord.getStatus().dirtyVersion, coord.getStatus().committedVersion);
    await wait(50);
    assert.equal(writes.length, writesBeforeReset, 'reset() must cancel pending debounce timer');

    // Case 7: dispose() cancels pending timers and ignores subsequent scheduled writes
    const writesBeforeDispose = writes.length;
    coord.scheduleSave({ seq: 'pending-before-dispose' }, 20);
    coord.dispose();
    await wait(45);
    assert.equal(writes.length, writesBeforeDispose, 'dispose() must cancel pending debounced save');
    assert.ok(statuses.length >= 10, 'Status listener must have emitted transitions throughout lifecycle');
  });

  // 66. CA-07 & CA-08 — Health Payload, Offline 503 Fallback, Fail-Open/Closed Rate Limit, Import Limits & SVG XSS Guard
  await runTest('chatService & security (CA-07 & CA-08): /api/health aiConfigured flag, chat fallback & comprehensive import/SVG sanitization', async () => {
    // CA-07: Health payload & offline fallback when GEMINI_API_KEY is missing or placeholder
    const prevKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      const healthOff = buildHealthPayload('3.1.1');
      assert.equal(healthOff.aiConfigured, false);
      assert.equal(healthOff.service, 'hachihi-designer-api');

      const chatNoKey = await handleChatRequest({
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
        body: { message: 'Kiểm tra mạng', history: [], persona: 'architect', modelMode: 'fast' }
      });
      assert.equal(chatNoKey.statusCode, 503);

      process.env.GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
      assert.equal(buildHealthPayload().aiConfigured, false);

      process.env.GEMINI_API_KEY = 'AIzaTestFakeValidLengthKey123456';
      assert.equal(buildHealthPayload().aiConfigured, true);
    } finally {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevKey;
    }

    // CA-07: Fail-open fallback to memory in dev when Redis fails vs fail-closed in production
    resetInMemoryRateLimitState();
    const devFailOpenCfg = getAiRuntimeConfig({
      NODE_ENV: 'development',
      UPSTASH_REDIS_REST_URL: 'https://redis.invalid',
      UPSTASH_REDIS_REST_TOKEN: 'tok'
    });
    const devOutage = await checkRateLimitShared('198.51.100.55', {
      config: devFailOpenCfg,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      }
    });
    assert.equal(devOutage.allowed, true);
    assert.equal(devOutage.store, 'memory');

    // CA-08: All payload & entity caps + SVG <image>/<use> base64 XSS rejection
    assert.equal(
      checkImportPayloadSize({ size: MAX_EXCEL_FILE_BYTES + 1 }, MAX_EXCEL_FILE_BYTES, 'bom.xlsx').ok,
      false
    );
    const overBundle = await inspectProjectImportPayload({
      projects: Array.from({ length: MAX_BUNDLE_PROJECTS + 1 }, () => ({ assets: {}, nodes: [] }))
    });
    assert.equal(overBundle.ok, false);

    const tooManyAssets: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_PROJECT_ASSETS; i++) {
      tooManyAssets[`a_${i}`] = { id: `a_${i}`, name: `D${i}`, category: 'switch' };
    }
    assert.equal(migrateAndValidateProject({ assets: tooManyAssets, nodes: [] }).ok, false);

    const tooManyCables = Array.from({ length: MAX_PROJECT_CABLES + 1 }, (_, i) => ({
      id: `cab_${i}`,
      sourceNodeId: 'n1',
      targetNodeId: 'n2'
    }));
    assert.equal(migrateAndValidateProject({ assets: {}, nodes: [], cables: tooManyCables }).ok, false);

    const xssSvgB64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://evil.example/a.png"/></svg>',
      'utf8'
    ).toString('base64');
    assert.equal(sanitizeSafeImageUrl(`data:image/svg+xml;base64,${xssSvgB64}`), undefined);
    const safeSvgB64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#155eef"/></svg>',
      'utf8'
    ).toString('base64');
    assert.ok(sanitizeSafeImageUrl(`data:image/svg+xml;base64,${safeSvgB64}`));
    assert.equal(isSafeSvgContent('<svg><use href="https://cdn.evil/x.svg#i"/></svg>'), false);
    assert.equal(isSafeSvgContent('<svg><image xlink:href="http://evil.local/p.png"/></svg>'), false);
    assert.equal(
      sanitizeSafeImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')?.startsWith('data:image/png;base64,'),
      true
    );
  });

  // 67. Custom Quick-Action Keybindings & Periodic IndexedDB Snapshot Logic
  await runTest('useKeyboardShortcuts & projectStorage: supports Auto-Route / Auto-Assign IP / Export keybindings & 10-min snapshot creation/pruning', () => {
    const defaults = getDefaultShortcutKeymap();
    assert.equal(defaults.auto_route, 'ctrl+shift+r');
    assert.equal(defaults.auto_assign_ip, 'ctrl+shift+i');
    assert.equal(defaults.export_project, 'ctrl+e');

    const quickTaskDefs = SHORTCUT_DEFINITIONS.filter(d => d.category === 'Tác vụ nhanh').map(d => d.id);
    assert.deepEqual(quickTaskDefs, ['auto_route', 'auto_assign_ip', 'export_project']);
    assert.equal(formatShortcutDisplay(defaults.auto_route), 'Ctrl+Shift+R');
    assert.equal(formatShortcutDisplay(defaults.auto_assign_ip), 'Ctrl+Shift+I');
    assert.equal(formatShortcutDisplay(defaults.export_project), 'Ctrl+E');

    const fakeKeyEvent = (key: string, opts: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) =>
      ({
        key,
        ctrlKey: Boolean(opts.ctrlKey),
        metaKey: false,
        shiftKey: Boolean(opts.shiftKey),
        altKey: Boolean(opts.altKey)
      }) as KeyboardEvent;

    assert.equal(matchesShortcutCombo(fakeKeyEvent('r', { ctrlKey: true, shiftKey: true }), defaults.auto_route), true);
    assert.equal(matchesShortcutCombo(fakeKeyEvent('i', { ctrlKey: true, shiftKey: true }), defaults.auto_assign_ip), true);
    assert.equal(matchesShortcutCombo(fakeKeyEvent('e', { ctrlKey: true }), defaults.export_project), true);

    assert.equal(AUTO_SNAPSHOT_INTERVAL_MS, 10 * 60 * 1000);

    const proj = createEnterpriseTopologyProject();
    const snapAuto1 = createProjectSnapshotRecord(proj, 'auto_interval');
    snapAuto1.id = 'snap_auto_1';
    snapAuto1.createdAt = '2026-06-01T10:00:00.000Z';

    const snapManual = createProjectSnapshotRecord(proj, 'manual', 'Mốc bàn giao');
    snapManual.id = 'snap_manual_1';
    snapManual.createdAt = '2026-06-01T10:05:00.000Z';

    const snapAuto2 = createProjectSnapshotRecord(proj, 'auto_interval');
    snapAuto2.id = 'snap_auto_2';
    snapAuto2.createdAt = '2026-06-01T10:10:00.000Z';

    const snapPreRestore = createProjectSnapshotRecord(proj, 'pre_restore');
    snapPreRestore.id = 'snap_prerestore_1';
    snapPreRestore.createdAt = '2026-06-01T10:15:00.000Z';

    assert.equal(snapManual.label, 'Mốc bàn giao');
    assert.equal(snapManual.trigger, 'manual');
    assert.ok(snapManual.checksum.startsWith('fnv1a-'));
    assert.ok(typeof snapManual.byteSize === 'number' && snapManual.byteSize > 100);
    assert.equal(formatByteSize(512), '512 B');
    assert.equal(formatByteSize(10240), '10.0 KB');
    assert.equal(formatByteSize(1572864), '1.50 MB');
    assert.equal(snapManual.nodeCount, proj.nodes.length);
    assert.equal(snapManual.cableCount, proj.cables.length);
    assert.equal(snapManual.checksum, computeProjectChecksum(snapManual.snapshot));

    // When pruning down to max=2 out of 4 snapshots, oldest auto_interval snapshots are pruned first while keeping manual & pre_restore
    const pruneIds = selectSnapshotIdsToPrune([snapAuto1, snapManual, snapAuto2, snapPreRestore], 2);
    assert.deepEqual(pruneIds, ['snap_auto_1', 'snap_auto_2']);

    assert.equal(defaults.tool_select, 'v');
    assert.equal(defaults.tool_connect, 'c');
    assert.equal(defaults.tool_rack, 'shift+r');

    const toolDefs = SHORTCUT_DEFINITIONS.filter(d => d.category === 'Công cụ').map(d => d.id);
    assert.ok(toolDefs.includes('tool_select'));
    assert.ok(toolDefs.includes('tool_connect'));
    assert.ok(toolDefs.includes('tool_rack'));
    assert.equal(formatShortcutDisplay(defaults.tool_rack), 'Shift+R');
    assert.equal(matchesShortcutCombo(fakeKeyEvent('r', { shiftKey: true }), defaults.tool_rack), true);

    assert.equal(findShortcutConflict(defaults, 'tool_rack', 'v')?.id, 'tool_select');
    assert.equal(findShortcutConflict(defaults, 'tool_select', 'v'), undefined);
    assert.equal(findShortcutConflict(defaults, 'tool_rack', 'alt+k'), undefined);

    // Verify localStorage persistence for custom Auto-Route, Auto-Assign IP, Export & Tool keybindings
    const lsMap = new Map<string, string>();
    const prevWindow = (globalThis as unknown as { window?: unknown }).window;
    (globalThis as unknown as { window: { localStorage: Storage } }).window = {
      localStorage: {
        get length() {
          return lsMap.size;
        },
        clear: () => lsMap.clear(),
        getItem: (k: string) => (lsMap.has(k) ? lsMap.get(k)! : null),
        key: (i: number) => Array.from(lsMap.keys())[i] ?? null,
        removeItem: (k: string) => {
          lsMap.delete(k);
        },
        setItem: (k: string, v: string) => {
          lsMap.set(k, String(v));
        }
      }
    };
    try {
      const customized = {
        ...defaults,
        auto_route: 'alt+r',
        auto_assign_ip: 'alt+i',
        export_project: 'ctrl+shift+e',
        tool_select: 'q',
        tool_connect: 'k',
        tool_rack: 'alt+b'
      };
      saveShortcutKeymap(customized);
      const reloaded = loadShortcutKeymap();
      assert.equal(reloaded.auto_route, 'alt+r');
      assert.equal(reloaded.auto_assign_ip, 'alt+i');
      assert.equal(reloaded.export_project, 'ctrl+shift+e');
      assert.equal(reloaded.tool_select, 'q');
      assert.equal(reloaded.tool_connect, 'k');
      assert.equal(reloaded.tool_rack, 'alt+b');
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as unknown as { window?: unknown }).window;
      } else {
        (globalThis as unknown as { window?: unknown }).window = prevWindow;
      }
    }
  });

  // 68. Off-Thread Recovery Envelope Preparation, Ring Cache & Quota Safety Tests
  await runTest('projectStorage & computeWorkerClient: prepares/commits recovery envelopes with ring cache, quota safety & summary upsert', async () => {
    const lsMap = new Map<string, string>();
    const prevLS = (globalThis as unknown as { localStorage?: unknown }).localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      get length() {
        return lsMap.size;
      },
      clear: () => lsMap.clear(),
      getItem: (k: string) => (lsMap.has(k) ? lsMap.get(k)! : null),
      key: (i: number) => Array.from(lsMap.keys())[i] ?? null,
      removeItem: (k: string) => {
        lsMap.delete(k);
      },
      setItem: (k: string, v: string) => {
        lsMap.set(k, String(v));
      }
    };

    try {
      clearRecoverySnapshots();
      const proj = createEnterpriseTopologyProject();

      // Prepare & commit 2 revisions via prepared payload helper (exercises cached ring serialization)
      const prep1 = prepareRecoveryEnvelopePayload(proj, 'autosave');
      assert.equal(prep1.ok, true);
      if (!prep1.ok) throw new Error('Expected prep1 ok');
      const commit1 = commitPreparedRecoveryEnvelope(prep1.payload.envelope, prep1.payload.serializedPrimary);
      assert.equal(commit1.ok, true);

      const proj2 = { ...proj, name: `${proj.name} R2`, lastModified: new Date(Date.now() + 1000).toISOString() };
      const resOffThread = await saveRecoverySnapshotOffThread(proj2, 'autosave');
      assert.equal(resOffThread.ok, true);

      const latest = loadLatestValidRecoverySnapshot();
      assert.ok(latest);
      assert.equal(latest?.project.name, proj2.name);

      // Concurrent latest-wins: earlier call should not overwrite newer name when settled
      const summary = toProjectSummaryFromState(proj2);
      assert.equal(summary.id, proj2.id);
      assert.equal(summary.name, proj2.name);
      assert.equal(summary.nodeCount, proj2.nodes.length);
      assert.equal(summary.cableCount, proj2.cables.length);

      // Oversized payload beyond MAX_LOCALSTORAGE_RECOVERY_CHARS gracefully skips localStorage write without error
      const hugeFakeJson = 'x'.repeat(MAX_LOCALSTORAGE_RECOVERY_CHARS + 10);
      const quotaRes = commitPreparedRecoveryEnvelope(prep1.payload.envelope, hugeFakeJson);
      assert.equal(quotaRes.ok, true);
      if (quotaRes.ok) {
        assert.equal(quotaRes.skippedLocalStorageQuota, true);
      }

      clearRecoverySnapshots();
    } finally {
      disposeComputeWorkerForTests();
      if (prevLS === undefined) {
        delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
      } else {
        (globalThis as unknown as { localStorage?: unknown }).localStorage = prevLS;
      }
    }
  });

  // 69. SaveCoordinator Generation Guard Against Stale Persist Clobber After Project Switch (reset)
  await runTest('saveCoordinator: discards stale in-flight persist callbacks when reset() is called during project transition', async () => {
    let resolveFirst!: (val: { ok: true } | { ok: false; error: string }) => void;
    let savedCallCount = 0;
    let errorCallCount = 0;
    const staleSavedIds: string[] = [];

    const oldProj = { ...createEnterpriseTopologyProject(), id: 'proj_old', name: 'Old Project' };
    const newProj = { ...createEnterpriseTopologyProject(), id: 'proj_new', name: 'New Project' };

    const coordinator = createSaveCoordinator<typeof oldProj>({
      debounceMs: 1,
      onPersist: proj => {
        if (proj.id === 'proj_old') {
          return new Promise(resolve => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve({ ok: true });
      },
      onPersistSuccess: proj => {
        savedCallCount += 1;
        staleSavedIds.push(proj.id);
      },
      onStatusChange: status => {
        if (status.storageError) errorCallCount += 1;
      }
    });

    coordinator.scheduleSave(oldProj);
    await new Promise(r => setTimeout(r, 15));

    // Switch project mid-flight via reset() before proj_old persist resolves
    coordinator.reset(newProj, newProj.lastSavedAt || null);
    resolveFirst({ ok: true });
    await new Promise(r => setTimeout(r, 10));

    assert.equal(savedCallCount, 0, 'Stale onPersistSuccess from previous project must be ignored after reset()');
    assert.equal(errorCallCount, 0);

    // Subsequent save for newProj must succeed cleanly
    const resNew = await coordinator.saveNow(newProj);
    assert.equal(resNew.ok, true);
    assert.deepEqual(staleSavedIds, ['proj_new']);
    coordinator.dispose();
  });

  // 70. Structural Equality (cableTrays/schemaVersion) & Orphan Asset Pruning Tests
  await runTest('store (Sprint 1): tracks cableTrays/schemaVersion equality & prunes orphan assets and patchLinks safely', () => {
    const base = createMultiFloorSampleOfficeProject();
    assert.equal(areStatesStructurallyEqual(base, base), true);

    const trayEdited: ProjectState = {
      ...base,
      cableTrays: [
        {
          id: 'tray_eq_1',
          name: 'Máng Cáp Chính',
          floorId: base.activeFloorId,
          kind: 'network_tray',
          widthPx: 30,
          points: [
            { x: 100, y: 100 },
            { x: 300, y: 100 }
          ]
        }
      ]
    };
    assert.equal(areStatesStructurallyEqual(base, trayEdited), false);

    const schemaEdited: ProjectState = { ...base, schemaVersion: (base.schemaVersion || 4) + 1 };
    assert.equal(areStatesStructurallyEqual(base, schemaEdited), false);

    const orphanId = 'ast_orphan_deleted';
    const rackMountedId = Object.values(base.racks[0].slots || {})[0];
    assert.ok(rackMountedId, 'Expected rack-mounted asset in multi-floor sample project');
    const firstNodeWithAsset = base.nodes.find(n => n.assetId && n.type !== 'rack')!;
    assert.ok(firstNodeWithAsset);
    const remainingNodeAssetId = firstNodeWithAsset.assetId!;

    const expandedAssets = {
      ...base.assets,
      [orphanId]: {
        ...structuredClone(base.assets[remainingNodeAssetId]),
        id: orphanId,
        name: 'ORPHAN-DEV'
      }
    };
    const pruned = pruneOrphanAssets(expandedAssets, base.nodes, base.racks);
    assert.equal(Boolean(pruned[orphanId]), false, 'Orphan asset must be pruned');
    assert.equal(Boolean(pruned[rackMountedId]), true, 'Rack-mounted asset must be preserved even without canvas node');
    assert.equal(Boolean(pruned[remainingNodeAssetId]), true, 'Canvas-referenced asset must be preserved');

    // PatchLink referencing removed asset is pruned while referencing existing asset stays
    const links = [
      { id: 'pl_drop', patchPanelAssetId: orphanId, patchPort: 'P01', targetDeviceName: 'PC-1' },
      { id: 'pl_keep', patchPanelAssetId: remainingNodeAssetId, patchPort: 'P02', targetDeviceName: 'PC-2' }
    ];
    const prunedLinks = pruneOrphanPatchLinks(links, expandedAssets, pruned)!;
    assert.equal(prunedLinks.length, 1);
    assert.equal(prunedLinks[0].id, 'pl_keep');
  });

  await runTest('projectPackage + CAD lifecycle: bundles, verifies SHA-256, inspects & remaps linked CADDocuments', async () => {
    const base = createEnterpriseTopologyProject();
    const cadDoc = createEmptyCADDocument('MatBang_Tang1', { projectId: base.id });
    cadDoc.entities.push({
      id: 'cad_line_1',
      handle: '100',
      type: 'LINE',
      layer: '0',
      colorIndex: 7,
      lineType: 'BYLAYER',
      lineWeight: -1,
      visible: true,
      preservationTier: 'supported',
      start: { x: 0, y: 0, z: 0 },
      end: { x: 5000, y: 0, z: 0 }
    });

    const pkgRes = await createProjectPackage(base, {
      includeRevisions: false,
      includeFullCustomLibrary: false,
      embedExternalImages: false,
      revisionsOverride: [],
      customLibraryOverride: [],
      cadDocumentsOverride: [cadDoc]
    });

    assert.equal(pkgRes.pkg.manifest.counts.cadDocuments, 1);
    assert.equal(pkgRes.pkg.resources.cadDocuments?.length, 1);

    const inspected = await inspectProjectImportPayload(pkgRes.jsonString, []);
    assert.equal(inspected.ok, true);
    if (!inspected.ok || inspected.kind !== 'package') {
      throw new Error('Expected valid package inspection with CAD documents');
    }
    assert.equal(inspected.integrityStatus, 'valid');
    assert.equal(inspected.cadDocuments.length, 1);
    assert.equal(inspected.cadDocuments[0].projectId, base.id);
    assert.equal(inspected.cadDocuments[0].entities.length, 1);

    const cloned = cloneProjectForNewImport(inspected.project, inspected.revisions, inspected.cadDocuments);
    assert.notEqual(cloned.project.id, base.id);
    assert.equal(cloned.cadDocuments.length, 1);
    assert.notEqual(cloned.cadDocuments[0].id, cadDoc.id);
    assert.equal(cloned.cadDocuments[0].projectId, cloned.project.id);
    assert.equal(cloned.cadDocuments[0].entities.length, 1);
  });

  await runTest('panelCollapseStorage: saves, loads, and falls back safely for PropertiesPanel, LayerPanel, and sidebars', () => {
    const backing = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      }
    };

    assert.equal(loadPanelCollapsed('properties', false, fakeStorage), false);
    assert.equal(loadPanelCollapsed('layers', true, fakeStorage), true);

    assert.equal(savePanelCollapsed('properties', true, fakeStorage), true);
    assert.equal(savePanelCollapsed('layers', true, fakeStorage), true);
    assert.equal(savePanelCollapsed('left', false, fakeStorage), true);
    assert.equal(savePanelCollapsed('cad_left', true, fakeStorage), true);
    assert.equal(savePanelCollapsed('cad_right', false, fakeStorage), true);

    assert.equal(backing.get(getPanelCollapseStorageKey('properties')), 'true');
    assert.equal(backing.get(getPanelCollapseStorageKey('layers')), 'true');
    assert.equal(loadPanelCollapsed('properties', false, fakeStorage), true);
    assert.equal(loadPanelCollapsed('layers', false, fakeStorage), true);
    assert.equal(loadPanelCollapsed('left', true, fakeStorage), false);
    assert.equal(loadPanelCollapsed('cad_left', false, fakeStorage), true);
    assert.equal(loadPanelCollapsed('cad_right', true, fakeStorage), false);

    // Invalid raw values fall back gracefully
    backing.set(getPanelCollapseStorageKey('properties'), 'invalid-flag');
    assert.equal(loadPanelCollapsed('properties', false, fakeStorage), false);

    // Storage errors do not throw
    const failingStorage = {
      getItem: () => {
        throw new Error('Quota / blocked');
      },
      setItem: () => {
        throw new Error('Quota / blocked');
      }
    };
    assert.equal(loadPanelCollapsed('layers', true, failingStorage), true);
    assert.equal(savePanelCollapsed('layers', false, failingStorage), false);
  });
}

runStandaloneSuite(import.meta.url, runStorageSecurityAndPolicyTests);
