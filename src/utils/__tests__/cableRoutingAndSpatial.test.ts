import assert from 'node:assert/strict';
import { DeviceAsset, CableEdge } from '../../types/infrastructure';
import { migrateAndValidateProject } from '../projectStorage';
import {
  computeCablePath,
  computeBundledCablePath,
  computeCableBundleLayout,
  estimateCableLengthMeters,
  computeRealTimeCableLengthBreakdown,
  normalizeReadableAngleDeg,
  resolveCableLabelTransform,
  CABLE_SIGNAL_COLOR_PRESETS,
  getDefaultCableColorForType,
  normalizeCableColor,
  computeAutoRoutedWaypoints,
  computeProjectCableSummary
} from '../cableRouting';
import {
  BRAND_LOGO_OPTIONS,
  DEVICE_ICON_OPTIONS,
  ISOMETRIC_ICON_OPTIONS,
  getIsometricIconOption
} from '../deviceIcons';
import { generatePureSvgMarkup } from '../svgExport';
import { generateProjectDxf } from '../dxfExporter';
import {
  computeSmartSnap,
  computeSnapToGridAutoAlign,
  detectOverlappingNodes
} from '../snapGuides';
import { CANVAS_BACKGROUND_PRESETS, resolveCanvasAppearance } from '../canvasBackgrounds';
import { buildProjectLegendData, computeRecommendedLegendSize } from '../legendGenerator';
import { createEnterpriseTopologyProject, createMultiFloorSampleOfficeProject } from '../../data/templates';
import {
  parseSubnetMaskToPrefix,
  prefixToSubnetMask,
  validateIpPlanConfig,
  autoAssignTopologyIps
} from '../ipAutoAssign';
import { createProjectPackage, inspectProjectImportPayload } from '../projectPackage';
import { computeZoomToPointerPan } from '../spatialIndex';
import { applySmartCopyPasteToProject } from '../../store/slices/useNodesSlice';
import { shouldUseRasterCableLayer } from '../../components/canvas/CanvasCablesLayer';
import {
  computeStaticWorkerBundleLayout,
  drawCableSceneToContext
} from '../../workers/cableRender.worker';
import {
  normalizeCanvasPerformanceMode,
  resolveCanvasPerformancePolicy
} from '../canvasPerformance';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runCableRoutingAndSpatialTests(runTest: TestFn): Promise<void> {
  // 5. Cable Routing Tests
  await runTest('cableRouting: computes straight, orthogonal, 1-point quadratic & multi-point Catmull-Rom curves', () => {
    const r1 = { x: 0, y: 0, width: 100, height: 40 };
    const r2 = { x: 300, y: 200, width: 100, height: 40 };

    const straight: CableEdge = {
      id: 'c1', cableCode: 'C1', diagramMode: 'topology', sourceNodeId: 'a', targetNodeId: 'b',
      cableType: 'CAT6_UTP', bandwidth: '1G', color: '#000', routingType: 'straight',
      lineStyle: 'solid', strokeWidth: 2, lengthMeters: 15, status: 'active'
    };
    const sRes = computeCablePath(straight, r1, r2);
    assert.equal(sRes.d, 'M 50 20 L 350 220');

    const ortho: CableEdge = { ...straight, routingType: 'orthogonal' };
    const oRes = computeCablePath(ortho, r1, r2);
    assert.ok(oRes.d.includes('200 20'));

    const quad: CableEdge = { ...straight, routingType: 'curved', controlPoints: [{ x: 200, y: 40 }] };
    const qRes = computeCablePath(quad, r1, r2);
    assert.ok(qRes.d.includes(' Q '));

    const spline: CableEdge = {
      ...straight,
      routingType: 'curved',
      controlPoints: [{ x: 150, y: 50 }, { x: 260, y: 180 }]
    };
    const cRes = computeCablePath(spline, r1, r2);
    assert.ok(cRes.d.includes(' C '));

    const meters = estimateCableLengthMeters(straight, r1, r2, 30, 1.15);
    assert.ok(meters >= 10);
  });

  // 5b. Cable Bundle Grouping & Export Parity Tests
  await runTest('cableRouting: groups bidirectional & shared-corridor cables into non-overlapping bundles', () => {
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      node_a: { x: 100, y: 100, width: 64, height: 64 },
      node_b: { x: 460, y: 180, width: 64, height: 64 },
      node_c: { x: 105, y: 380, width: 64, height: 64 }
    };
    const getRect = (id: string) => boxes[id] || null;

    const baseCable: Omit<CableEdge, 'id' | 'cableCode' | 'sourceNodeId' | 'targetNodeId'> = {
      diagramMode: 'topology',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#2563eb',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 20,
      status: 'active'
    };

    const cables: CableEdge[] = [
      { ...baseCable, id: 'c_1', cableCode: 'LAN-01', sourceNodeId: 'node_a', targetNodeId: 'node_b', routingType: 'orthogonal' },
      { ...baseCable, id: 'c_2', cableCode: 'LAN-02', sourceNodeId: 'node_b', targetNodeId: 'node_a', routingType: 'orthogonal' },
      { ...baseCable, id: 'c_3', cableCode: 'LAN-03', sourceNodeId: 'node_a', targetNodeId: 'node_b', routingType: 'curved', bandwidth: '10G' },
      { ...baseCable, id: 'c_single', cableCode: 'LAN-99', sourceNodeId: 'node_a', targetNodeId: 'node_c', routingType: 'straight' },
      {
        ...baseCable,
        id: 'c_manual',
        cableCode: 'LAN-MAN',
        sourceNodeId: 'node_a',
        targetNodeId: 'node_b',
        routingType: 'straight',
        controlPoints: [{ x: 280, y: 40 }]
      }
    ];

    const layout = computeCableBundleLayout(cables, getRect);
    assert.equal(layout.bundles.length, 1);
    const bundle = layout.bundles[0];
    assert.equal(bundle.cables.length, 3);
    assert.equal(bundle.totalMeters, 60);
    assert.ok(bundle.summaryLabel.includes('×3 Cáp'));

    // Orthogonal & curved strands inside the bundle must have distinct midPoints and symmetric offsets
    const p1 = layout.cablePaths.get('c_1')!;
    const p2 = layout.cablePaths.get('c_2')!;
    const p3 = layout.cablePaths.get('c_3')!;
    assert.notEqual(p1.midPoint.x, p2.midPoint.x);
    assert.notEqual(p2.d, p3.d);
    assert.equal(layout.cableOffsets.get('c_2'), 0); // Middle strand of 3
    assert.ok((layout.cableOffsets.get('c_1') || 0) < 0);
    assert.ok((layout.cableOffsets.get('c_3') || 0) > 0);

    // Straight bundled helper separates parallel strands along canonical normal
    const sPos = computeBundledCablePath(
      { ...cables[3], sourceNodeId: 'node_a', targetNodeId: 'node_b' },
      boxes.node_a,
      boxes.node_b,
      8,
      bundle.normal
    );
    const sNeg = computeBundledCablePath(
      { ...cables[3], sourceNodeId: 'node_a', targetNodeId: 'node_b' },
      boxes.node_a,
      boxes.node_b,
      -8,
      bundle.normal
    );
    assert.notEqual(sPos.midPoint.y, sNeg.midPoint.y);

    // Single cable and cable with manual controlPoints remain unbundled
    assert.equal(layout.cableToBundleId.has('c_single'), false);
    assert.equal(layout.cableOffsets.get('c_single'), 0);
    assert.equal(layout.cableToBundleId.has('c_manual'), false);
    assert.equal(layout.cableOffsets.get('c_manual'), 0);

    // SVG export renders consolidated bundle summary label and suppresses individual bundled badges
    const proj = createEnterpriseTopologyProject();
    const firstTwoNodes = proj.nodes.filter(n => n.type !== 'rack').slice(0, 2);
    assert.equal(firstTwoNodes.length, 2);
    proj.settings.showCableCodes = true;
    proj.cables = [
      {
        ...baseCable,
        id: 'exp_b1',
        cableCode: 'MEMBER-ALPHA',
        sourceNodeId: firstTwoNodes[0].id,
        targetNodeId: firstTwoNodes[1].id,
        routingType: 'straight'
      },
      {
        ...baseCable,
        id: 'exp_b2',
        cableCode: 'MEMBER-BETA',
        sourceNodeId: firstTwoNodes[1].id,
        targetNodeId: firstTwoNodes[0].id,
        routingType: 'straight'
      }
    ];
    const bundledSvg = generatePureSvgMarkup(proj, { darkTheme: false, includeTitleBlock: false });
    assert.ok(bundledSvg.includes('×2 Cáp'));
    assert.equal(bundledSvg.includes('MEMBER-ALPHA'), false);
    assert.equal(bundledSvg.includes('MEMBER-BETA'), false);
  });

  // 7. Smart Alignment Guides (Nodes + Container Edges) & Canvas Background Tests
  await runTest('snapGuides & canvasBackgrounds: aligns horizontally/vertically with nodes & containers and renders SVG background presets', () => {
    const dragged = { x: 204, y: 153, width: 100, height: 50 };
    const targets = [
      { id: 'node_other', x: 200, y: 320, width: 160, height: 50, sourceKind: 'node' as const, label: 'Switch-01' },
      { id: 'room_container', x: 50, y: 150, width: 420, height: 300, sourceKind: 'container' as const, label: 'Server Room' }
    ];

    const res = computeSmartSnap(dragged, targets, 8);
    assert.equal(res.dx, -4); // snaps left edge x=204 -> x=200 of node_other
    assert.equal(res.dy, -3); // snaps top edge y=153 -> y=150 of room_container
    assert.equal(res.guides.length, 2);

    const vGuide = res.guides.find(g => g.orientation === 'vertical');
    const hGuide = res.guides.find(g => g.orientation === 'horizontal');
    assert.ok(vGuide);
    assert.ok(hGuide);
    assert.equal(vGuide.pos, 200);
    assert.equal(vGuide.kind, 'edge');
    assert.equal(vGuide.sourceKind, 'node');
    assert.equal(hGuide.pos, 150);
    assert.equal(hGuide.kind, 'edge');
    assert.equal(hGuide.sourceKind, 'container');

    // Center alignment with container centerline (x=260, y=300)
    const centerRes = computeSmartSnap({ x: 212, y: 278, width: 100, height: 50 }, targets, 8);
    const vCenter = centerRes.guides.find(g => g.orientation === 'vertical');
    const hCenter = centerRes.guides.find(g => g.orientation === 'horizontal');
    assert.equal(vCenter?.kind, 'center');
    assert.equal(vCenter?.pos, 260);
    assert.equal(hCenter?.kind, 'center');
    assert.equal(hCenter?.pos, 300);

    // Canvas Background presets & SVG parity
    const blueprint = CANVAS_BACKGROUND_PRESETS.find(p => p.id === 'blueprint_blue');
    assert.ok(blueprint);
    const proj = createEnterpriseTopologyProject();
    proj.settings.backgroundPreset = blueprint.id;
    proj.settings.backgroundColor = blueprint.backgroundColor;
    proj.settings.backgroundPattern = blueprint.pattern;
    proj.settings.showGrid = true;

    const appearance = resolveCanvasAppearance(proj.settings);
    assert.equal(appearance.backgroundColor, '#0f294a');
    assert.equal(appearance.isDarkCanvas, true);
    assert.equal(appearance.pattern, 'lines');

    const bpSvg = generatePureSvgMarkup(proj, { includeTitleBlock: false });
    assert.ok(bpSvg.includes('#0f294a'));
    assert.ok(bpSvg.includes('<path d="M '));
  });

  // 8. Custom Cable Colors, Signal Presets, Brand Logos & SVG Export Parity Tests
  await runTest('cableColors & deviceIcons: normalizes colors, tracks distinct bundle colors, and exports custom cable/shape/logo SVG', () => {
    assert.equal(normalizeCableColor('  #EC4899  '), '#ec4899');
    assert.equal(normalizeCableColor('invalid-color', '#0284c7'), '#0284c7');
    assert.equal(getDefaultCableColorForType('POWER_AC'), '#dc2626');
    assert.equal(getDefaultCableColorForType('FIBER_SM_OS2'), '#f59e0b');
    assert.ok(CABLE_SIGNAL_COLOR_PRESETS.length >= 8);
    assert.ok(DEVICE_ICON_OPTIONS.length >= 20);
    assert.ok(BRAND_LOGO_OPTIONS.length >= 12);

    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      n1: { x: 100, y: 100, width: 120, height: 60 },
      n2: { x: 420, y: 120, width: 120, height: 60 }
    };
    const bundleLayout = computeCableBundleLayout(
      [
        {
          id: 'cb_red',
          cableCode: 'PWR-01',
          diagramMode: 'topology',
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          cableType: 'POWER_AC',
          bandwidth: '1G',
          color: '#dc2626',
          routingType: 'straight',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 10,
          status: 'active'
        },
        {
          id: 'cb_pink',
          cableCode: 'HA-01',
          diagramMode: 'topology',
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          cableType: 'DAC_10G',
          bandwidth: '10G',
          color: '#ec4899',
          routingType: 'straight',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 10,
          status: 'active'
        }
      ],
      id => boxes[id] || null
    );
    assert.equal(bundleLayout.bundles.length, 1);
    assert.deepEqual(bundleLayout.bundles[0].distinctColors.sort(), ['#dc2626', '#ec4899']);

    const proj = createEnterpriseTopologyProject();
    const targetNode = proj.nodes.find(n => n.type !== 'rack')!;
    targetNode.width = 180;
    targetNode.height = 120;
    targetNode.style.shape = 'circle';
    targetNode.customIcon = 'logo_cisco';
    targetNode.customImageUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    proj.cables[0].color = '#ec4899';

    const svg = generatePureSvgMarkup(proj, { includeTitleBlock: false });
    assert.ok(svg.includes('#ec4899'));
    assert.ok(svg.includes('data:image/svg+xml;base64'));
    assert.ok(svg.includes('rx="90"'));
  });

  // 9. Snap-to-Grid Auto-Align & Isometric 2D Icon Library Tests
  await runTest('snapGuides & isometricIcons: auto-aligns multi-node horizontal/vertical on grid & resolves isometric icons', () => {
    const nodes = [
      { id: 'n1', x: 113, y: 127, width: 80, height: 60 },
      { id: 'n2', x: 254, y: 189, width: 80, height: 60 },
      { id: 'n3', x: 182, y: 155, width: 80, height: 60, locked: true }
    ];

    const hRes = computeSnapToGridAutoAlign(nodes, 'horizontal', 20, { evenSpacing: true });
    assert.equal(hRes.has('n3'), false); // locked node untouched
    const hn1 = hRes.get('n1')!;
    const hn2 = hRes.get('n2')!;
    assert.equal(hn1.y % 20, 0);
    assert.equal(hn2.y % 20, 0);
    assert.equal(hn1.y, hn2.y); // aligned onto same horizontal row
    assert.equal(hn1.x % 20, 0);
    assert.equal(hn2.x % 20, 0);
    assert.ok(hn2.x >= hn1.x + 80); // non-overlapping grid spacing

    const vRes = computeSnapToGridAutoAlign(nodes, 'vertical', 20, { evenSpacing: true });
    const vn1 = vRes.get('n1')!;
    const vn2 = vRes.get('n2')!;
    assert.equal(vn1.x, vn2.x); // aligned onto same vertical column
    assert.equal(vn1.x % 20, 0);
    assert.equal(vn1.y % 20, 0);
    assert.equal(vn2.y % 20, 0);
    assert.ok(vn2.y >= vn1.y + 60);

    const gridOnly = computeSnapToGridAutoAlign(nodes, 'grid-only', 20);
    assert.deepEqual(gridOnly.get('n1'), { x: 120, y: 120 });
    assert.deepEqual(gridOnly.get('n2'), { x: 260, y: 180 });

    assert.equal(ISOMETRIC_ICON_OPTIONS.length, 5);
    assert.ok(getIsometricIconOption('iso_switch_network'));
    assert.ok(getIsometricIconOption('iso_patch_panel'));
    assert.ok(getIsometricIconOption('iso_ups_unit'));
    assert.ok(getIsometricIconOption('iso_router_firewall'));
    assert.ok(getIsometricIconOption('iso_server_rack'));

    const proj = createEnterpriseTopologyProject();
    const firstNode = proj.nodes.find(n => n.type !== 'rack')!;
    firstNode.customImageUrl = undefined;
    firstNode.customIcon = 'iso_switch_network';
    const isoSvg = generatePureSvgMarkup(proj, { includeTitleBlock: false });
    assert.ok(isoSvg.includes('SWITCH'));
  });

  // 10. Legend Generator & Direct Cable Text Label Export Tests
  await runTest('legendGenerator & cableLabels: aggregates components/icons/cables, persists custom labels & exports SVG/DXF', () => {
    const proj = createEnterpriseTopologyProject();
    const deviceNodes = proj.nodes.filter(n => n.type !== 'rack' && n.type !== 'legend');
    assert.ok(deviceNodes.length >= 2);
    deviceNodes[0].customIcon = 'logo_cisco';
    deviceNodes[1].customImageUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

    // Assign a full-length custom text label to a non-bundled cable
    const firstNonBundledCable = proj.cables[0];
    assert.ok(firstNonBundledCable);
    firstNonBundledCable.label = 'Uplink-10G-Core-VLAN20';
    proj.cables = [firstNonBundledCable];
    proj.settings.showCableCodes = false; // custom cable label should still render even when cableCode badge toggle is off

    const legendData = buildProjectLegendData(proj, {
      scope: 'all',
      includeCables: true,
      title: 'CHÚ GIẢI HỆ THỐNG MẠNG'
    });
    assert.equal(legendData.totalDevices, proj.nodes.filter(n => n.type !== 'legend' && n.type !== 'text').length);
    assert.equal(legendData.totalCables, 1);
    assert.ok(legendData.components.some(c => c.customIcon === 'logo_cisco'));
    assert.ok(legendData.components.some(c => c.customImageUrl?.startsWith('data:image/svg+xml')));
    assert.ok(legendData.cables.length >= 1);

    const recSize = computeRecommendedLegendSize(legendData);
    assert.ok(recSize.width >= 300 && recSize.height >= 150);

    // Place legend node on canvas and verify pure SVG & DXF output + storage migration preservation
    proj.nodes.push({
      id: 'node_legend_test',
      diagramMode: proj.activeMode,
      floorId: proj.activeFloorId,
      type: 'legend',
      label: 'CHÚ GIẢI HỆ THỐNG MẠNG',
      x: 900,
      y: 80,
      width: recSize.width,
      height: recSize.height,
      rotation: 0,
      style: {
        backgroundColor: '#ffffff',
        borderColor: '#1d4ed8',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1
      },
      customData: {
        legendScope: 'all',
        legendIncludeCables: true,
        legendTitle: 'CHÚ GIẢI HỆ THỐNG MẠNG'
      }
    });

    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) throw new Error('Expected valid migration');
    const savedLegend = migrated.project.nodes.find(n => n.type === 'legend');
    assert.ok(savedLegend);
    assert.equal(savedLegend.customData?.legendTitle, 'CHÚ GIẢI HỆ THỐNG MẠNG');
    assert.equal(migrated.project.cables[0].label, 'Uplink-10G-Core-VLAN20');

    const svg = generatePureSvgMarkup(migrated.project, { includeTitleBlock: false });
    assert.equal(svg.includes('<foreignObject'), false);
    assert.ok(svg.includes('CHÚ GIẢI HỆ THỐNG MẠNG'));
    assert.ok(svg.includes('Uplink-10G-Core-VLAN20'));

    const dxf = generateProjectDxf(migrated.project);
    assert.ok(dxf.includes('Uplink-10G-Core-VLAN20'));
  });

  // 11. Overlap Warning Detection & Real-Time Cable Length Calculation Tests
  await runTest('snapGuides & cableRouting: detects node overlaps (ignoring adjacent edge-touch) & calculates real-time cable length breakdown', () => {
    const overlapCheck = detectOverlappingNodes([
      { id: 'n_a', x: 100, y: 100, width: 120, height: 80 },
      { id: 'n_b', x: 180, y: 140, width: 100, height: 60 }, // overlaps n_a by 40x40
      { id: 'n_touch', x: 220, y: 100, width: 80, height: 35 } // touches n_a right edge (x=220), no overlap with n_b (y+h=135 < 140)
    ]);
    assert.equal(overlapCheck.overlappingNodeIds.has('n_a'), true);
    assert.equal(overlapCheck.overlappingNodeIds.has('n_b'), true);
    assert.equal(overlapCheck.overlappingNodeIds.has('n_touch'), false);
    assert.equal(overlapCheck.pairs.length, 1);
    assert.deepEqual(overlapCheck.pairs[0].overlapRect, { x: 180, y: 140, width: 40, height: 40 });
    assert.equal(overlapCheck.overlapCountByNodeId.get('n_a'), 1);

    const r1 = { x: 0, y: 0, width: 100, height: 40 };     // center (50, 20)
    const r2 = { x: 350, y: 20, width: 100, height: 40 };  // center (400, 40)
    const straightCable: CableEdge = {
      id: 'cab_len_1',
      cableCode: 'LEN-01',
      diagramMode: 'topology',
      sourceNodeId: 's1',
      targetNodeId: 's2',
      cableType: 'CAT6A_STP',
      bandwidth: '10G',
      color: '#2563eb',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 10,
      status: 'active'
    };

    const bd1 = computeRealTimeCableLengthBreakdown(straightCable, r1, r2, {
      pxPerMeter: 35,
      slackFactor: 1.0,
      floorLevelDiff: 0
    });
    // Horizontal distance ~350.6px / 35 px/m = ~10.02m
    assert.ok(bd1.pathPixels >= 350 && bd1.pathPixels <= 352);
    assert.ok(Math.abs(bd1.horizontalMeters - 10.02) < 0.1);
    assert.equal(bd1.verticalRiseMeters, 0);
    assert.equal(bd1.isCrossFloor, false);

    // Cross-floor curved cable with control point & +15% slack
    const curvedCrossFloor: CableEdge = {
      ...straightCable,
      routingType: 'curved',
      controlPoints: [{ x: 225, y: 160 }]
    };
    const bd2 = computeRealTimeCableLengthBreakdown(curvedCrossFloor, r1, r2, {
      pxPerMeter: 25,
      slackFactor: 1.15,
      floorLevelDiff: 2,
      floorHeightMeters: 4
    });
    assert.ok(bd2.pathPixels > bd1.pathPixels); // curved detour is longer than straight line
    assert.equal(bd2.verticalRiseMeters, 8);
    assert.equal(bd2.isCrossFloor, true);
    assert.equal(bd2.waypointCount, 1);
    assert.ok(bd2.slackMeters > 0);
    assert.ok(bd2.totalEstimatedMeters > bd2.horizontalMeters + bd2.verticalRiseMeters);
  });

  // 12. Cable Labeling Layer, Auto Path Orientation, Custom Rotation & Font Size Tests
  await runTest('cableLabeling: auto-orients along path, supports manual rotation & font size, persists & renders Cable Labeling SVG overlay', () => {
    assert.equal(normalizeReadableAngleDeg(100, 100), 45);
    assert.equal(normalizeReadableAngleDeg(-100, -100), 45); // never upside down
    assert.equal(normalizeReadableAngleDeg(0, 100), -90);
    assert.equal(normalizeReadableAngleDeg(0, -100), -90);

    const rA = { x: 0, y: 0, width: 100, height: 40 };
    const rB = { x: 200, y: 200, width: 100, height: 40 };
    const baseCable: CableEdge = {
      id: 'cab_lbl_1',
      cableCode: 'LBL-01',
      diagramMode: 'topology',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      cableType: 'FIBER_SM_OS2',
      bandwidth: '10G',
      color: '#f59e0b',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 20,
      status: 'active',
      label: 'Backbone-OS2'
    };

    const diagPath = computeCablePath(baseCable, rA, rB);
    assert.equal(diagPath.midAngleDeg, 45);
    const autoTransform = resolveCableLabelTransform(baseCable, diagPath);
    assert.equal(autoTransform.isAutoOriented, true);
    assert.equal(autoTransform.angleDeg, 45);
    assert.equal(autoTransform.text, 'Backbone-OS2');
    assert.equal(autoTransform.fontSize, 9.5);

    const verticalOrthoPath = computeCablePath({ ...baseCable, routingType: 'orthogonal' }, rA, rB);
    assert.equal(verticalOrthoPath.midAngleDeg, -90);

    const curvedPath = computeCablePath({ ...baseCable, routingType: 'curved' }, rA, rB);
    assert.ok(curvedPath.midAngleDeg > 0 && curvedPath.midAngleDeg < 90);

    const customStyledCable: CableEdge = {
      ...baseCable,
      labelAutoOrient: false,
      labelRotation: -25,
      labelFontSize: 15
    };
    const customTransform = resolveCableLabelTransform(customStyledCable, diagPath);
    assert.equal(customTransform.isAutoOriented, false);
    assert.equal(customTransform.angleDeg, -25);
    assert.equal(customTransform.fontSize, 15);
    assert.ok(customTransform.badgeHeight >= 28);

    // Project storage persistence + SVG Cable Labeling overlay & layer toggle
    const proj = createEnterpriseTopologyProject();
    proj.cables = [
      {
        ...proj.cables[0],
        label: 'Trunk-Core-Rotated',
        labelAutoOrient: false,
        labelRotation: -25,
        labelFontSize: 15
      }
    ];
    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) throw new Error('Expected valid migration');
    assert.equal(migrated.project.cables[0].labelRotation, -25);
    assert.equal(migrated.project.cables[0].labelFontSize, 15);
    assert.equal(migrated.project.cables[0].labelAutoOrient, false);

    const svgVisible = generatePureSvgMarkup(migrated.project, { includeTitleBlock: false });
    assert.ok(svgVisible.includes('data-layer="cable-labeling"'));
    assert.ok(svgVisible.includes('rotate(-25.0)'));
    assert.ok(svgVisible.includes('font-size="15"'));
    assert.ok(svgVisible.includes('Trunk-Core-Rotated'));

    migrated.project.settings.hiddenLayers = ['cable_labels'];
    const svgHidden = generatePureSvgMarkup(migrated.project, { includeTitleBlock: false });
    assert.equal(svgHidden.includes('data-layer="cable-labeling"'), false);
    assert.equal(svgHidden.includes('Trunk-Core-Rotated'), false);
  });

  // 13. Cable Auto-Route Obstacle-Avoidance Algorithm Tests
  await runTest('cableRouting: computeAutoRoutedWaypoints avoids interior obstacles with orthogonal bends & lane spread', () => {
    const src = { x: 40, y: 200, width: 120, height: 60 }; // center (100, 230)
    const tgt = { x: 640, y: 200, width: 120, height: 60 }; // center (700, 230)
    const blocker = { id: 'obs_rack', x: 300, y: 120, width: 160, height: 220 }; // directly blocks horizontal y=230

    const res = computeAutoRoutedWaypoints(src, tgt, [blocker], { clearancePx: 22 });
    assert.equal(res.routingType, 'orthogonal');
    assert.equal(res.usedFallback, false);
    assert.ok(res.avoidedObstacles >= 1);
    assert.ok(res.controlPoints.length >= 2);

    const routedCable: CableEdge = {
      id: 'cab_auto_1',
      cableCode: 'AUTO-01',
      diagramMode: 'topology',
      sourceNodeId: 'src',
      targetNodeId: 'tgt',
      cableType: 'CAT6A_STP',
      bandwidth: '10G',
      color: '#0284c7',
      routingType: res.routingType,
      controlPoints: res.controlPoints,
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active'
    };
    const path = computeCablePath(routedCable, src, tgt);
    assert.ok(path.pts.length >= 4);

    // Every segment along the routed path must be strictly horizontal or vertical
    // and must NOT pass through the interior of the blocker obstacle
    for (let i = 0; i < path.pts.length - 1; i++) {
      const a = path.pts[i];
      const b = path.pts[i + 1];
      const isOrtho = Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01;
      assert.equal(isOrtho, true, `Expected orthogonal segment between (${a.x},${a.y}) and (${b.x},${b.y})`);

      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const hitsBlockerInterior =
        maxX > blocker.x && minX < blocker.x + blocker.width &&
        maxY > blocker.y && minY < blocker.y + blocker.height;
      assert.equal(hitsBlockerInterior, false, 'Auto-routed segment must not pierce blocker interior');
    }

    // Parallel lane separation when occupiedSegments are passed for a second cable
    const occupied = path.pts.slice(0, -1).map((p, idx) => ({ a: p, b: path.pts[idx + 1] }));
    const resSecond = computeAutoRoutedWaypoints(src, tgt, [blocker], {
      clearancePx: 22,
      corridorPenalty: 25,
      occupiedSegments: occupied
    });
    assert.equal(resSecond.routingType, 'orthogonal');
    assert.ok(resSecond.controlPoints.length >= 2);
  });

  // 16. Topology-Based Auto IP Assignment & Subnet Validation Tests
  await runTest('ipAutoAssign: validates subnet masks/ranges & numbers devices along topology BFS skipping passive nodes', () => {
    assert.equal(parseSubnetMaskToPrefix('255.255.255.0'), 24);
    assert.equal(parseSubnetMaskToPrefix('255.255.252.0'), 22);
    assert.equal(parseSubnetMaskToPrefix('255.255.255.128'), 25);
    assert.equal(parseSubnetMaskToPrefix('255.0.255.0'), null);
    assert.equal(prefixToSubnetMask(27), '255.255.255.224');

    const badSubnet = validateIpPlanConfig({
      ipRangeStart: '10.10.1.5',
      ipRangeEnd: '10.10.2.50',
      ipSubnetMask: '255.255.255.0',
      ipGateway: '10.10.1.1'
    });
    assert.equal(badSubnet.valid, false);

    const badRangeOrder = validateIpPlanConfig({
      ipRangeStart: '192.168.10.50',
      ipRangeEnd: '192.168.10.10',
      ipSubnetMask: '255.255.255.0',
      ipGateway: '192.168.10.1'
    });
    assert.equal(badRangeOrder.valid, false);

    const validPlan = validateIpPlanConfig({
      ipRangeStart: '10.20.0.10',
      ipRangeEnd: '10.20.0.30',
      ipSubnetMask: '255.255.255.192',
      ipGateway: '10.20.0.1'
    });
    assert.equal(validPlan.valid, true);
    assert.equal(validPlan.cidrNotation, '10.20.0.0/26');
    assert.equal(validPlan.availableHostCount, 21);

    // Build a small topology: Cloud -> Router -> PatchPanel (passive) -> AccessSwitch -> AP
    const proj = createEnterpriseTopologyProject();
    proj.settings.ipRangeStart = '10.50.0.1';
    proj.settings.ipRangeEnd = '10.50.0.20';
    proj.settings.ipSubnetMask = '255.255.255.0';
    proj.settings.ipGateway = '10.50.0.1';

    const makeAsset = (id: string, name: string, category: DeviceAsset['category'], ip = ''): DeviceAsset => ({
      id,
      name,
      assetTag: id.toUpperCase(),
      serialNumber: `SN-${id.toUpperCase()}`,
      category,
      vendor: 'Test',
      model: 'M1',
      ipAddress: ip,
      macAddress: '00:11:22:33:44:55',
      subnetMask: '',
      gateway: '',
      vlan: '1',
      status: 'online',
      powerWatts: 10,
      ports: []
    });

    proj.assets = {
      a_cloud: makeAsset('a_cloud', 'ISP Cloud', 'cloud'),
      a_gw: makeAsset('a_gw', 'Edge Router', 'router'),
      a_pp: makeAsset('a_pp', 'Patch Panel 24P', 'patch_panel'),
      a_sw: makeAsset('a_sw', 'Access Switch', 'switch'),
      a_ap: makeAsset('a_ap', 'WiFi AP', 'ap', '10.50.0.15')
    };

    const baseNode = (id: string, assetId: string, label: string, x: number, type: 'device' | 'cloud' = 'device') => ({
      id,
      diagramMode: 'topology' as const,
      floorId: proj.activeFloorId,
      type,
      assetId,
      label,
      x,
      y: 100,
      width: 120,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155EEF', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid' as const, opacity: 1 }
    });

    proj.nodes = [
      baseNode('n_ap', 'a_ap', 'WiFi AP', 600),
      baseNode('n_sw', 'a_sw', 'Access Switch', 420),
      baseNode('n_pp', 'a_pp', 'Patch Panel 24P', 280),
      baseNode('n_gw', 'a_gw', 'Edge Router', 150),
      baseNode('n_cloud', 'a_cloud', 'ISP Cloud', 20, 'cloud')
    ];

    const makeCable = (id: string, s: string, t: string): CableEdge => ({
      id,
      cableCode: id.toUpperCase(),
      diagramMode: 'topology',
      sourceNodeId: s,
      targetNodeId: t,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#155eef',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 10,
      status: 'active'
    });

    proj.cables = [
      makeCable('c1', 'n_cloud', 'n_gw'),
      makeCable('c2', 'n_gw', 'n_pp'),
      makeCable('c3', 'n_pp', 'n_sw'),
      makeCable('c4', 'n_sw', 'n_ap')
    ];

    // Preserve existing valid AP IP (10.50.0.15) first
    const resPreserve = autoAssignTopologyIps(proj, { preserveExistingValid: true });
    assert.equal(resPreserve.ok, true);
    assert.equal(resPreserve.preservedCount, 1);
    assert.equal(resPreserve.assignedCount, 2);
    assert.equal(resPreserve.updatedAssets.a_cloud.ipAddress, '');
    assert.equal(resPreserve.updatedAssets.a_pp.ipAddress, '');
    assert.equal(resPreserve.updatedAssets.a_gw.ipAddress, '10.50.0.1');
    assert.equal(resPreserve.updatedAssets.a_sw.ipAddress, '10.50.0.2');
    assert.equal(resPreserve.updatedAssets.a_ap.ipAddress, '10.50.0.15');
    assert.equal(resPreserve.updatedAssets.a_sw.subnetMask, '255.255.255.0');
    assert.equal(resPreserve.updatedAssets.a_sw.gateway, '10.50.0.1');

    // Full renumber along topology order: Router -> (PatchPanel skipped) -> Switch -> AP
    const resFull = autoAssignTopologyIps(proj, { preserveExistingValid: false });
    assert.equal(resFull.ok, true);
    assert.equal(resFull.assignedCount, 3);
    assert.equal(resFull.updatedAssets.a_gw.ipAddress, '10.50.0.1');
    assert.equal(resFull.updatedAssets.a_sw.ipAddress, '10.50.0.2');
    assert.equal(resFull.updatedAssets.a_ap.ipAddress, '10.50.0.3');
  });

  // 17. Project Cable Material BOM Summary Tests
  await runTest('cableRouting: computeProjectCableSummary aggregates counts, meters, reserve, and rolls per type', () => {
    const emptyBom = computeProjectCableSummary([]);
    assert.equal(emptyBom.totalCount, 0);
    assert.equal(emptyBom.totalMeters, 0);
    assert.equal(emptyBom.totalWithReserveMeters, 0);
    assert.equal(emptyBom.byType.length, 0);

    const sampleCables: CableEdge[] = [
      {
        id: 'cab1',
        cableCode: 'C-01',
        diagramMode: 'topology',
        sourceNodeId: 'n1',
        targetNodeId: 'n2',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 200,
        status: 'active'
      },
      {
        id: 'cab2',
        cableCode: 'C-02',
        diagramMode: 'topology',
        sourceNodeId: 'n1',
        targetNodeId: 'n3',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 150,
        status: 'active'
      },
      {
        id: 'cab3',
        cableCode: 'F-01',
        diagramMode: 'fiber',
        sourceNodeId: 'n1',
        targetNodeId: 'n4',
        cableType: 'FIBER_SM_OS2',
        bandwidth: '10G',
        color: '#f59e0b',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 150,
        status: 'active'
      }
    ];

    const bom = computeProjectCableSummary(sampleCables);
    assert.equal(bom.totalCount, 3);
    assert.equal(bom.totalMeters, 500);
    assert.equal(bom.totalWithReserveMeters, 550);
    assert.equal(bom.byType.length, 2);
    assert.equal(bom.byType[0].cableType, 'CAT6_UTP');
    assert.equal(bom.byType[0].count, 2);
    assert.equal(bom.byType[0].totalMeters, 350);
    assert.equal(bom.byType[0].percentage, 70);
    assert.equal(bom.byType[0].estimatedRolls305m, 2);
    assert.equal(bom.byType[1].cableType, 'FIBER_SM_OS2');
    assert.equal(bom.byType[1].count, 1);
    assert.equal(bom.byType[1].totalMeters, 150);
    assert.equal(bom.byType[1].percentage, 30);
    assert.equal(bom.byType[1].estimatedRolls305m, undefined);
  });

  // 33. Auto-Routing Obstacle Avoidance & Manual Control Point Preservation Tests (Group 4)
  await runTest('cableRouting: auto-routes around obstacles cleanly and preserves manual controlPoints during bundling', () => {
    const src = { x: 40, y: 180, width: 80, height: 60 };
    const tgt = { x: 440, y: 180, width: 80, height: 60 };
    const obstacle = { id: 'obs_mid', x: 230, y: 130, width: 100, height: 160 };

    const routed = computeAutoRoutedWaypoints(src, tgt, [obstacle], { clearancePx: 20 });
    assert.equal(routed.routingType, 'orthogonal');
    assert.ok(routed.avoidedObstacles >= 1);
    assert.ok(routed.controlPoints.length >= 2);

    const path = computeCablePath(
      {
        id: 'cab_auto',
        cableCode: 'AUTO-01',
        diagramMode: 'topology',
        sourceNodeId: 's',
        targetNodeId: 't',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#0284c7',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 10,
        status: 'active',
        controlPoints: routed.controlPoints
      },
      src,
      tgt
    );
    assert.ok(path.lengthPx > 400);

    const manualCable: CableEdge = {
      id: 'cab_manual',
      cableCode: 'MAN-01',
      diagramMode: 'topology',
      sourceNodeId: 's',
      targetNodeId: 't',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active',
      controlPoints: [{ x: 280, y: 80 }]
    };
    const bundle = computeCableBundleLayout([manualCable], id => (id === 's' ? src : tgt));
    assert.equal(bundle.cableOffsets.get('cab_manual'), 0);
  });

  // 42. Draggable Reference Guide Lines: Smart Snap & Package Persistence
  await runTest('snapGuides & projectPackage: snaps dragged nodes to horizontal/vertical reference guide lines and persists guideLines', async () => {
    const snapRes = computeSmartSnap(
      { x: 196, y: 147, width: 100, height: 50 },
      [],
      8,
      [
        { orientation: 'vertical', pos: 200 },
        { orientation: 'horizontal', pos: 150 }
      ]
    );
    assert.equal(snapRes.dx, 4);
    assert.equal(snapRes.dy, 3);
    assert.equal(snapRes.guides.length, 2);
    assert.ok(snapRes.guides.every(g => g.sourceKind === 'guide'));

    const sample = createMultiFloorSampleOfficeProject();
    sample.settings.guideLines = [
      { id: 'g_h1', orientation: 'horizontal', pos: 240, floorId: sample.activeFloorId },
      { id: 'g_v1', orientation: 'vertical', pos: 360, floorId: sample.activeFloorId }
    ];
    const mig = migrateAndValidateProject(sample);
    assert.equal(mig.ok, true);
    if (mig.ok) {
      assert.equal(mig.project.settings.guideLines?.length, 2);
      assert.equal(mig.project.settings.guideLines?.[0].pos, 240);
      assert.equal(mig.project.settings.guideLines?.[1].orientation, 'vertical');
    }

    const { jsonString } = await createProjectPackage(sample, {
      includeRevisions: false,
      includeFullCustomLibrary: false,
      embedExternalImages: false,
      revisionsOverride: [],
      customLibraryOverride: []
    });
    const parsed = await inspectProjectImportPayload(jsonString, []);
    assert.equal(parsed.ok, true);
    if (parsed.ok && parsed.kind === 'package') {
      assert.equal(parsed.skippedFields.length, 0);
      assert.equal(parsed.project.settings.guideLines?.length, 2);
    }
  });

  // 43. Pixel-Perfect Zoom-to-Mouse-Pointer & Smart Copy-Paste Tests
  await runTest('spatialIndex & nodesSlice: computeZoomToPointerPan locks world point under cursor & applySmartCopyPasteToProject preserves relative cables + customData', () => {
    const pointerX = 523;
    const pointerY = 347;
    let pan = { x: 140, y: -85 };
    let zoom = 1.15;

    const worldX = (pointerX - pan.x) / zoom;
    const worldY = (pointerY - pan.y) / zoom;

    const samePan = computeZoomToPointerPan(pan, zoom, zoom, pointerX, pointerY);
    assert.deepEqual(samePan, pan);

    const zoomSteps = [zoom * 1.1, zoom * 1.1 * 1.1, 3.0, 2.4, 0.2];
    for (const nextZoom of zoomSteps) {
      pan = computeZoomToPointerPan(pan, zoom, nextZoom, pointerX, pointerY);
      zoom = nextZoom;
      const reprojectedX = pan.x + worldX * zoom;
      const reprojectedY = pan.y + worldY * zoom;
      assert.ok(Math.abs(reprojectedX - pointerX) < 1e-9, `Expected X drift < 1e-9, got ${Math.abs(reprojectedX - pointerX)}`);
      assert.ok(Math.abs(reprojectedY - pointerY) < 1e-9, `Expected Y drift < 1e-9, got ${Math.abs(reprojectedY - pointerY)}`);
    }

    // Smart Copy-Paste: relative cables, shifted waypoints, port sync, groupId, rack slots & deep-cloned customData
    const proj = createEnterpriseTopologyProject();
    proj.settings.snapToGrid = true;
    proj.settings.gridSize = 20;

    const deviceNodes = proj.nodes.filter(n => n.type === 'device' && n.assetId);
    assert.ok(deviceNodes.length >= 3);
    const nodeA = deviceNodes[0];
    const nodeB = deviceNodes[1];
    const nodeExternal = deviceNodes[2];

    nodeA.x = 120;
    nodeA.y = 100;
    nodeA.locked = true;
    nodeA.groupId = 'grp_core_test';
    nodeA.customData = {
      wifiCoverageRadiusMeters: 22,
      cctvFovDeg: 95,
      locked: true,
      nestedMeta: { role: 'core-a', tags: ['v1', 'v2'] }
    } as unknown as typeof nodeA.customData & { nestedMeta: { role: string; tags: string[] } };

    nodeB.x = 320;
    nodeB.y = 180;
    nodeB.groupId = 'grp_core_test';

    const assetA = proj.assets[nodeA.assetId!];
    const assetB = proj.assets[nodeB.assetId!];
    assetA.ports = [
      { id: 'p_a1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1G', status: 'up', connectedCableId: 'cab_internal', connectedTarget: { deviceId: assetB.id, portId: 'p_b1' }, vlan: '20' },
      { id: 'p_a2', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1G', status: 'up', connectedCableId: 'cab_external', connectedTarget: { deviceId: nodeExternal.assetId!, portId: 'Gi0/1' }, vlan: '10' }
    ];
    assetB.ports = [
      { id: 'p_b1', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1G', status: 'up', connectedCableId: 'cab_internal', connectedTarget: { deviceId: assetA.id, portId: 'p_a1' }, vlan: '20' }
    ];

    proj.cables = [
      {
        id: 'cab_internal',
        cableCode: 'INT-01',
        diagramMode: proj.activeMode,
        sourceNodeId: nodeA.id,
        targetNodeId: nodeB.id,
        sourcePortId: 'p_a1',
        targetPortId: 'p_b1',
        cableType: 'CAT6A_STP',
        bandwidth: '10G',
        vlan: '20',
        label: 'Trunk-A-B',
        color: '#2563eb',
        routingType: 'orthogonal',
        controlPoints: [{ x: 220, y: 140 }],
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 12,
        status: 'active'
      },
      {
        id: 'cab_external',
        cableCode: 'EXT-01',
        diagramMode: proj.activeMode,
        sourceNodeId: nodeA.id,
        targetNodeId: nodeExternal.id,
        sourcePortId: 'p_a2',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#0284c7',
        routingType: 'straight',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 10,
        status: 'active'
      }
    ];

    const res = applySmartCopyPasteToProject(proj, [nodeA.id, nodeB.id], {
      targetCanvasPos: { x: 604, y: 407 }
    });
    assert.equal(res.createdNodeIds.length, 2);
    assert.equal(res.createdCableIds.length, 1);

    const clonedA = res.nextState.nodes.find(n => n.id === res.createdNodeIds[0])!;
    const clonedB = res.nextState.nodes.find(n => n.id === res.createdNodeIds[1])!;
    assert.ok(clonedA && clonedB);

    // Snapped targetCanvasPos: (604, 407) -> (600, 400); delta from min (120, 100) is (+480, +300)
    assert.equal(clonedA.x, 600);
    assert.equal(clonedA.y, 400);
    assert.equal(clonedB.x, 800);
    assert.equal(clonedB.y, 480);
    assert.equal(clonedA.locked, false);
    assert.equal(clonedA.customData?.locked, false);
    assert.equal(clonedA.customData?.wifiCoverageRadiusMeters, 22);
    assert.equal(clonedA.customData?.cctvFovDeg, 95);

    // Deep-clone isolation check
    const clonedCustom = clonedA.customData as unknown as { nestedMeta: { role: string; tags: string[] } };
    clonedCustom.nestedMeta.tags.push('mutated');
    assert.equal((nodeA.customData as unknown as typeof clonedCustom).nestedMeta.tags.length, 2);

    // Group ID remapped within pasted cluster
    assert.ok(clonedA.groupId);
    assert.equal(clonedA.groupId, clonedB.groupId);
    assert.notEqual(clonedA.groupId, 'grp_core_test');

    // Internal cable preserved with shifted waypoints & synced asset ports
    const clonedCable = res.nextState.cables.find(c => c.id === res.createdCableIds[0])!;
    assert.equal(clonedCable.sourceNodeId, clonedA.id);
    assert.equal(clonedCable.targetNodeId, clonedB.id);
    assert.equal(clonedCable.sourcePortId, 'p_a1');
    assert.equal(clonedCable.targetPortId, 'p_b1');
    assert.equal(clonedCable.vlan, '20');
    assert.equal(clonedCable.label, 'Trunk-A-B');
    assert.deepEqual(clonedCable.controlPoints, [{ x: 700, y: 440 }]);

    const clonedAssetA = res.nextState.assets[clonedA.assetId!]!;
    const clonedAssetB = res.nextState.assets[clonedB.assetId!]!;
    const portA1 = clonedAssetA.ports.find(p => p.id === 'p_a1')!;
    const portA2 = clonedAssetA.ports.find(p => p.id === 'p_a2')!;
    assert.equal(portA1.status, 'up');
    assert.equal(portA1.connectedTarget?.deviceId, clonedAssetB.id);
    assert.equal(portA1.connectedTarget?.portId, 'p_b1');
    assert.equal(portA1.connectedCableId, clonedCable.id);
    // External cable was NOT duplicated, so p_a2 is cleanly freed
    assert.equal(portA2.status, 'unlinked');
    assert.equal(portA2.connectedTarget, undefined);
    assert.equal(portA2.connectedCableId, undefined);

    // Cascade mode produces non-overlapping copy
    const cascadeRes = applySmartCopyPasteToProject(res.nextState, [clonedA.id, clonedB.id]);
    assert.equal(cascadeRes.createdNodeIds.length, 2);
    const cascadedA = cascadeRes.nextState.nodes.find(n => n.id === cascadeRes.createdNodeIds[0])!;
    assert.ok(cascadedA.x > clonedA.x && cascadedA.y > clonedA.y);
  });

  // 44. OffscreenCanvas Cable Worker Routing & Static/Interactive Layer Separation
  await runTest('cableRender.worker & CanvasCablesLayer: activates OffscreenCanvas during node drag and computes/draws static cables off-thread', () => {
    assert.equal(shouldUseRasterCableLayer(10, false, false), false);
    assert.equal(shouldUseRasterCableLayer(30, false, false), false);
    assert.equal(shouldUseRasterCableLayer(30, false, true), true);
    assert.equal(shouldUseRasterCableLayer(30, true, false), true);
    assert.equal(shouldUseRasterCableLayer(120, false, false), true);

    const staticCable = {
      id: 'cab_static_w1',
      cableCode: 'CBL-W1',
      diagramMode: 'topology' as const,
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      cableType: 'CAT6_UTP' as const,
      bandwidth: '1G' as const,
      color: '#0284c7',
      routingType: 'orthogonal' as const,
      lineStyle: 'solid' as const,
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active' as const
    };
    const draggingCable = {
      ...staticCable,
      id: 'cab_moving_w2',
      targetNodeId: 'n3',
      color: '#dc2626'
    };

    const rectEntries: Array<[string, { x: number; y: number; width: number; height: number }]> = [
      ['n1', { x: 40, y: 40, width: 100, height: 60 }],
      ['n2', { x: 260, y: 120, width: 100, height: 60 }],
      ['n3', { x: 440, y: 200, width: 100, height: 60 }]
    ];

    const layout = computeStaticWorkerBundleLayout([staticCable, draggingCable], rectEntries);
    assert.ok(layout.cablePaths.has('cab_static_w1'));
    assert.ok(layout.cablePaths.has('cab_moving_w2'));

    const strokedColors: string[] = [];
    const fakeCtx = {
      lineCap: 'butt',
      lineJoin: 'miter',
      strokeStyle: '#000',
      fillStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      rect: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {
        strokedColors.push(String(fakeCtx.strokeStyle));
      },
      setLineDash: () => {},
      translate: () => {},
      rotate: () => {},
      fillText: () => {}
    } as unknown as CanvasRenderingContext2D;

    drawCableSceneToContext(fakeCtx, {
      cables: [staticCable, draggingCable],
      bundles: layout.bundles,
      cableToBundleId: layout.cableToBundleId,
      cablePaths: layout.cablePaths,
      collapsedBundleIds: new Set<string>(),
      interactiveCableIds: new Set<string>(['cab_moving_w2']),
      viewport: { width: 800, height: 600, dpr: 1, panX: 0, panY: 0, zoom: 1 },
      options: {
        active: true,
        showCableLabels: false,
        showCableCodes: false,
        isPanning: false,
        isTransformingNodes: true
      }
    });

    assert.deepEqual(strokedColors, ['#0284c7']);
  });

  // 45. Canvas Performance & Render Mode Policies (Auto / High Quality / High Performance)
  await runTest('canvasPerformance: resolves Auto, High Quality, and High Performance culling, LOD & 3D policies', () => {
    assert.equal(normalizeCanvasPerformanceMode('auto'), 'auto');
    assert.equal(normalizeCanvasPerformanceMode('high_quality'), 'high_quality');
    assert.equal(normalizeCanvasPerformanceMode('high_performance'), 'high_performance');
    assert.equal(normalizeCanvasPerformanceMode('invalid_mode'), 'auto');

    // High Quality: disables coarse culling, keeps shadows/filters & vector cables even at low zoom
    const hq = resolveCanvasPerformancePolicy('high_quality', {
      nodeCount: 250,
      cableCount: 300,
      rackCount: 30,
      roomCount: 20,
      trayCount: 40,
      cadEntityCount: 5000,
      zoom: 0.25,
      isPanning: true
    });
    assert.equal(hq.effectiveTier, 'quality');
    assert.equal(hq.spatialCullingActive, false);
    assert.equal(hq.cullingThresholds.devices, Number.POSITIVE_INFINITY);
    assert.equal(hq.cullingThresholds.cadEntities, Number.POSITIVE_INFINITY);
    assert.equal(hq.lowDetailMode, false);
    assert.equal(hq.enableShadowsAndFilters, true);
    assert.equal(hq.showFineSubDetails, true);
    assert.equal(hq.maxDpr, 2);
    assert.equal(hq.threeRenderQuality, 'high');
    assert.equal(hq.threeShadowsEnabled, true);
    assert.equal(
      shouldUseRasterCableLayer(500, true, true, {
        dense: hq.rasterCableDenseThreshold,
        pan: hq.rasterCablePanThreshold
      }),
      false
    );

    // High Performance (Field Mode): tight culling, throttled redraw, DPR=1, LOD on low zoom or pan
    const hpZoomOut = resolveCanvasPerformancePolicy('high_performance', {
      nodeCount: 18,
      cableCount: 22,
      rackCount: 2,
      roomCount: 2,
      trayCount: 1,
      cadEntityCount: 200,
      zoom: 0.65,
      isPanning: false
    });
    assert.equal(hpZoomOut.effectiveTier, 'performance');
    assert.equal(hpZoomOut.spatialCullingActive, true);
    assert.equal(hpZoomOut.cullingThresholds.devices, 12);
    assert.equal(hpZoomOut.cullingThresholds.cadEntities, 150);
    assert.equal(hpZoomOut.lowDetailMode, true);
    assert.equal(hpZoomOut.showFineSubDetails, false);
    assert.equal(hpZoomOut.enableShadowsAndFilters, false);
    assert.equal(hpZoomOut.redrawThrottleMs, 34);
    assert.equal(hpZoomOut.maxDpr, 1);
    assert.equal(hpZoomOut.threeRenderQuality, 'low');
    assert.equal(hpZoomOut.threeShadowsEnabled, false);
    assert.equal(
      shouldUseRasterCableLayer(22, false, false, {
        dense: hpZoomOut.rasterCableDenseThreshold,
        pan: hpZoomOut.rasterCablePanThreshold
      }),
      true
    );

    // Auto (Smart Adaptive): light scene disables culling, heavy scene enables culling & performance tier
    const autoLight = resolveCanvasPerformancePolicy('auto', {
      nodeCount: 10,
      cableCount: 8,
      rackCount: 2,
      roomCount: 3,
      trayCount: 2,
      cadEntityCount: 50,
      zoom: 1.0,
      isPanning: false
    });
    assert.equal(autoLight.effectiveTier, 'balanced');
    assert.equal(autoLight.spatialCullingActive, false);
    assert.equal(autoLight.enableShadowsAndFilters, true);

    const autoHeavy = resolveCanvasPerformancePolicy('auto', {
      nodeCount: 85,
      cableCount: 95,
      rackCount: 10,
      roomCount: 12,
      trayCount: 14,
      cadEntityCount: 1500,
      zoom: 0.55,
      isPanning: false
    });
    assert.equal(autoHeavy.effectiveTier, 'performance');
    assert.equal(autoHeavy.spatialCullingActive, true);
    assert.equal(autoHeavy.lowDetailMode, true);
    assert.equal(autoHeavy.enableShadowsAndFilters, false);
    assert.equal(autoHeavy.redrawThrottleMs, 16);
  });
}

runStandaloneSuite(import.meta.url, runCableRoutingAndSpatialTests);
