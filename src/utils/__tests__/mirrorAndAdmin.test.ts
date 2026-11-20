import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyNodesMirrorToProject, applyWifiCoverageToProject } from '../../store/slices/useNodesSlice';
import { populateInfrastructure3DWorld } from '../../components/canvas/three/proceduralDevices';
import { ThreeResourceRegistry } from '../../components/canvas/three/resourceRegistry';
import { generatePureSvgMarkup } from '../svgExport';
import { createEnterpriseTopologyProject } from '../../data/templates';
import {
  buildClearSessionCookieHeader,
  buildSessionSetCookieHeader,
  createSignedSessionToken,
  verifySignedSessionToken
} from '../../server/admin/adminSecurity';
import {
  validateManifestInput,
  validatePreviewPayload,
  validateTemplateSlug
} from '../../server/admin/templateValidation';
import { runStandaloneSuite, type TestFn } from './testHarness';
import type { DiagramNode, ProjectState } from '../../types/infrastructure';

const DEFAULT_STYLE: DiagramNode['style'] = {
  backgroundColor: '#155eef',
  borderColor: '#1e40af',
  borderWidth: 1.5,
  borderStyle: 'solid',
  opacity: 1,
  textColor: '#ffffff',
  shape: 'round'
};

function buildMirrorTestProject(): ProjectState {
  const base = createEnterpriseTopologyProject();
  const ws1: DiagramNode = {
    id: 'ws_mirror_1',
    type: 'device',
    diagramMode: 'floorplan',
    assetId: 'asset_ws_1',
    label: 'WS-01',
    x: 120,
    y: 120,
    width: 64,
    height: 64,
    rotation: 15,
    locked: false,
    style: { ...DEFAULT_STYLE }
  };
  const ws2: DiagramNode = {
    id: 'ws_unmirrored_2',
    type: 'device',
    diagramMode: 'floorplan',
    assetId: 'asset_ws_2',
    label: 'WS-02',
    x: 240,
    y: 120,
    width: 64,
    height: 64,
    rotation: 0,
    locked: false,
    style: { ...DEFAULT_STYLE }
  };
  const lockedWs: DiagramNode = {
    id: 'ws_locked_3',
    type: 'device',
    diagramMode: 'floorplan',
    assetId: 'asset_ws_2',
    label: 'WS-LOCKED',
    x: 360,
    y: 120,
    width: 64,
    height: 64,
    rotation: 0,
    locked: true,
    style: { ...DEFAULT_STYLE }
  };
  const camNode: DiagramNode = {
    id: 'cam_mirror_1',
    type: 'device',
    diagramMode: 'floorplan',
    assetId: 'asset_cam_1',
    label: 'CAM-01',
    x: 480,
    y: 120,
    width: 64,
    height: 64,
    rotation: 45,
    locked: false,
    style: { ...DEFAULT_STYLE }
  };
  const apNode: DiagramNode = {
    id: 'ap_mirror_1',
    type: 'device',
    diagramMode: 'floorplan',
    assetId: 'asset_ap_1',
    label: 'AP-01',
    x: 600,
    y: 120,
    width: 64,
    height: 64,
    rotation: 30,
    locked: false,
    style: { ...DEFAULT_STYLE }
  };

  return {
    ...base,
    nodes: [ws1, ws2, lockedWs, camNode, apNode],
    cables: [],
    assets: {
      asset_ws_1: {
        id: 'asset_ws_1',
        assetTag: 'WS-01',
        serialNumber: 'SN-WS-1',
        name: 'Workstation 1',
        category: 'workstation',
        vendor: 'Dell',
        model: 'OptiPlex',
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: 'AA:BB:CC:00:00:01',
        vlan: '10',
        ports: [],
        status: 'online',
        powerWatts: 120
      },
      asset_ws_2: {
        id: 'asset_ws_2',
        assetTag: 'WS-02',
        serialNumber: 'SN-WS-2',
        name: 'Workstation 2',
        category: 'workstation',
        vendor: 'Dell',
        model: 'OptiPlex',
        ipAddress: '10.0.0.11',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: 'AA:BB:CC:00:00:02',
        vlan: '10',
        ports: [],
        status: 'online',
        powerWatts: 120
      },
      asset_cam_1: {
        id: 'asset_cam_1',
        assetTag: 'CAM-01',
        serialNumber: 'SN-CAM-1',
        name: 'Camera 1',
        category: 'camera',
        vendor: 'Axis',
        model: 'P1455',
        ipAddress: '10.0.0.20',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: 'AA:BB:CC:00:00:03',
        vlan: '20',
        ports: [],
        status: 'online',
        powerWatts: 12,
        cameraSpecs: {
          resolution: '4MP',
          lensMm: 4,
          fovAngle: 90,
          irDistanceMeters: 25,
          nvrChannel: 1
        }
      },
      asset_ap_1: {
        id: 'asset_ap_1',
        assetTag: 'AP-01',
        serialNumber: 'SN-AP-1',
        name: 'AP 1',
        category: 'ap',
        vendor: 'Ubiquiti',
        model: 'U6-Mesh',
        ipAddress: '10.0.0.30',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: 'AA:BB:CC:00:00:04',
        vlan: '1',
        ports: [],
        status: 'online',
        powerWatts: 15,
        wifiSpecs: {
          standard: 'Wi-Fi 6',
          bands: '2.4GHz + 5GHz',
          txPowerDbm: 20,
          coverageRadiusMeters: 18,
          coverageAngleDeg: 360,
          maxClients: 150,
          ssid: 'CORP'
        }
      }
    }
  };
}

export async function runMirrorAndAdminTests(runTest: TestFn) {
  await runTest('mirror: applyNodesMirrorToProject toggles flipX/flipY, respects lock, and reflects directional rotation', () => {
    const base = buildMirrorTestProject();

    // Non-directional workstation horizontal toggle on/off + vertical toggle
    const afterH = applyNodesMirrorToProject(base, ['ws_mirror_1', 'ws_locked_3'], 'horizontal');
    const wsAfterH = afterH.nodes.find(n => n.id === 'ws_mirror_1')!;
    const lockedAfterH = afterH.nodes.find(n => n.id === 'ws_locked_3')!;
    assert.equal(wsAfterH.flipX, true);
    assert.equal(wsAfterH.flipY, undefined);
    assert.equal(wsAfterH.rotation, 15);
    assert.equal(lockedAfterH.flipX, undefined);

    const afterHV = applyNodesMirrorToProject(afterH, ['ws_mirror_1'], 'vertical');
    const wsAfterHV = afterHV.nodes.find(n => n.id === 'ws_mirror_1')!;
    assert.equal(wsAfterHV.flipX, true);
    assert.equal(wsAfterHV.flipY, true);

    const afterOff = applyNodesMirrorToProject(afterHV, ['ws_mirror_1'], 'horizontal');
    assert.equal(afterOff.nodes.find(n => n.id === 'ws_mirror_1')!.flipX, undefined);

    // Directional camera reflects rotation horizontally (180 - 45 = 135) and vertically (360 - 135 = 225)
    const camH = applyNodesMirrorToProject(base, ['cam_mirror_1'], 'horizontal');
    const camNodeH = camH.nodes.find(n => n.id === 'cam_mirror_1')!;
    assert.equal(camNodeH.flipX, true);
    assert.equal(camNodeH.rotation, 135);

    const camHV = applyNodesMirrorToProject(camH, ['cam_mirror_1'], 'vertical');
    const camNodeHV = camHV.nodes.find(n => n.id === 'cam_mirror_1')!;
    assert.equal(camNodeHV.flipY, true);
    assert.equal(camNodeHV.rotation, 225);

    // Omni AP does NOT alter rotation, while directional AP (120°) reflects rotation (180 - 30 = 150)
    const omniApH = applyNodesMirrorToProject(base, ['ap_mirror_1'], 'horizontal');
    assert.equal(omniApH.nodes.find(n => n.id === 'ap_mirror_1')!.rotation, 30);

    const dirApBase = applyWifiCoverageToProject(base, 'ap_mirror_1', { angleDeg: 120 });
    const dirApH = applyNodesMirrorToProject(dirApBase, ['ap_mirror_1'], 'horizontal');
    assert.equal(dirApH.nodes.find(n => n.id === 'ap_mirror_1')!.rotation, 150);
  });

  await runTest('mirror: pure SVG export and 3D world respect non-directional mirror and prevent directional double-flip', () => {
    const base = buildMirrorTestProject();
    let proj = applyNodesMirrorToProject(base, ['ws_mirror_1', 'cam_mirror_1'], 'horizontal');

    // Pure SVG export: workstation gets data-mirror="-1,1"; directional camera must NOT get data-mirror
    const svg = generatePureSvgMarkup(proj, { darkTheme: false, includeTitleBlock: false });
    assert.ok(svg.includes('data-mirror="-1,1"'), 'Expected mirrored workstation to emit data-mirror="-1,1"');
    const camBlockMatch = svg.match(/<g transform="rotate\(135 [^"]+">[\s\S]*?<\/g>\s*<text class="svg-label-primary"[^>]*>Camera 1<\/text>/);
    assert.ok(camBlockMatch, 'Expected rotated Camera 1 SVG block');
    assert.equal(camBlockMatch[0].includes('data-mirror='), false, 'Directional camera should not double-flip in SVG');

    // 3D world: ws_mirror_1 has visual_mirror_group.scale (-1, 1, 1) and DoubleSide material without mutating ws_unmirrored_2
    const registry = new ThreeResourceRegistry();
    const worldRoot = new THREE.Group();
    const populated = populateInfrastructure3DWorld(worldRoot, proj, null, {
      showRooms: false,
      showCables: false,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: new THREE.Texture(),
      interactiveUnlocked: false,
      registry
    });

    const ws1Group = populated.nodeGroups.get('ws_mirror_1')!.group;
    const ws1Mirror = ws1Group.getObjectByName('visual_mirror_group')!;
    assert.ok(ws1Mirror, 'Expected visual_mirror_group on ws_mirror_1');
    assert.deepEqual(ws1Mirror.scale.toArray(), [-1, 1, 1]);

    const ws1MeshSides: number[] = [];
    ws1Mirror.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material;
        const mats = Array.isArray(mat) ? mat : [mat];
        mats.forEach(m => ws1MeshSides.push(m.side));
      }
    });
    assert.ok(ws1MeshSides.length > 0 && ws1MeshSides.every(s => s === THREE.DoubleSide), 'Negative mirror determinant must clone materials with THREE.DoubleSide');

    const ws2Group = populated.nodeGroups.get('ws_unmirrored_2')!.group;
    const ws2Mirror = ws2Group.getObjectByName('visual_mirror_group')!;
    assert.deepEqual(ws2Mirror.scale.toArray(), [1, 1, 1]);
    let hasFrontSideOnSibling = false;
    ws2Mirror.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material;
        const mats = Array.isArray(mat) ? mat : [mat];
        if (mats.some(m => m.side === THREE.FrontSide)) hasFrontSideOnSibling = true;
      }
    });
    assert.ok(hasFrontSideOnSibling, 'Unmirrored sibling must preserve pooled FrontSide materials');

    const camMirror = populated.nodeGroups.get('cam_mirror_1')!.group.getObjectByName('visual_mirror_group')!;
    assert.deepEqual(camMirror.scale.toArray(), [1, 1, 1], 'Directional camera 3D mesh must not double-flip');

    // Dual-axis flip (determinant +1) sets scale (-1, 1, -1)
    proj = applyNodesMirrorToProject(proj, ['ws_mirror_1'], 'vertical');
    const worldDual = new THREE.Group();
    const populatedDual = populateInfrastructure3DWorld(worldDual, proj, null, {
      showRooms: false,
      showCables: false,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: new THREE.Texture(),
      interactiveUnlocked: false,
      registry
    });
    const ws1DualMirror = populatedDual.nodeGroups.get('ws_mirror_1')!.group.getObjectByName('visual_mirror_group')!;
    assert.deepEqual(ws1DualMirror.scale.toArray(), [-1, 1, -1]);

    registry.disposeAll();
  });

  await runTest('admin: template validation rejects unsafe slugs, bad modes, XSS SVGs, and spoofed raster headers', () => {
    assert.equal(validateTemplateSlug('01-network').ok, true);
    assert.equal(validateTemplateSlug('custom_campus_v2').ok, true);
    assert.equal(validateTemplateSlug('../secret').ok, false);
    assert.equal(validateTemplateSlug('catalog').ok, false);
    assert.equal(validateTemplateSlug('a/b').ok, false);

    const manifestOk = validateManifestInput(
      {
        id: 'tpl-campus',
        name: 'Campus Backbone',
        category: 'Enterprise',
        mode: 'topology',
        preview: '../../evil.svg'
      },
      '99-campus'
    );
    assert.equal(manifestOk.ok, true);
    if (manifestOk.ok) {
      assert.equal(manifestOk.manifest.preview, 'preview.svg');
      assert.equal(manifestOk.manifest.projectFile, 'project.json');
    }

    assert.equal(
      validateManifestInput({ name: 'Bad Mode', mode: 'invalid-mode' }, 'bad').ok,
      false
    );

    const safeSvg = validatePreviewPayload({
      filename: 'preview.svg',
      content: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>'
    });
    assert.equal(safeSvg.ok, true);

    const xssSvg = validatePreviewPayload({
      filename: 'preview.svg',
      content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    });
    assert.equal(xssSvg.ok, false);

    const spoofedPng = validatePreviewPayload({
      filename: 'preview.png',
      content: Buffer.from('NOT_A_PNG_FILE_AT_ALL').toString('base64'),
      isBase64: true
    });
    assert.equal(spoofedPng.ok, false);

    const validPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const validPng = validatePreviewPayload({
      filename: 'preview.png',
      content: validPngBytes.toString('base64'),
      isBase64: true
    });
    assert.equal(validPng.ok, true);
  });

  await runTest('admin: signed session tokens verify, expire, invalidate on env change, and emit secure cookies', () => {
    const env = {
      ADMIN_USERNAME: 'netadmin',
      ADMIN_PASSWORD: 'super-secret-password-123',
      ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      VERCEL: '1'
    };
    const t0 = 1_700_000_000_000;
    const token = createSignedSessionToken('netadmin', env, t0);
    assert.ok(token, 'Expected signed token');

    const verified = verifySignedSessionToken(token!, env, t0 + 60_000);
    assert.deepEqual(verified, { username: 'netadmin' });

    // Tampered signature rejected
    const tampered = `${token!.slice(0, -4)}xxxx`;
    assert.equal(verifySignedSessionToken(tampered, env, t0 + 60_000), null);

    // Expired token rejected (TTL is 4h)
    assert.equal(verifySignedSessionToken(token!, env, t0 + 5 * 60 * 60 * 1000), null);

    // Changed ADMIN_USERNAME invalidates existing token immediately
    assert.equal(
      verifySignedSessionToken(token!, { ...env, ADMIN_USERNAME: 'otheradmin' }, t0 + 60_000),
      null
    );

    const setCookie = buildSessionSetCookieHeader(token!, { 'x-forwarded-proto': 'https' }, env);
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=None'));
    assert.ok(setCookie.includes('Secure'));

    const clearCookie = buildClearSessionCookieHeader({ 'x-forwarded-proto': 'https' }, env);
    assert.ok(clearCookie.includes('Max-Age=0'));
  });
}

runStandaloneSuite(import.meta.url, runMirrorAndAdminTests);
