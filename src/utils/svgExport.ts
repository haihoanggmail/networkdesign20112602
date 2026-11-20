import { ProjectState } from '../types/infrastructure';
import { computeCablePath, computeCableBundleLayout, resolveCableLabelTransform } from './cableRouting';
import {
  CANVAS_RACK_COLLAPSED_BODY_H,
  CANVAS_RACK_FOOTER_H,
  CANVAS_RACK_HEADER_H,
  CANVAS_RACK_RAIL_W,
  getAssetUHeight,
  getEffectiveRackDisplayHeight,
  getRackCanvasMetrics,
  getRackSlotsForSide,
  getRackStatistics,
  getSlotSpanRect,
  isRackMountedTopologyShadowNode,
  isRackNodeCollapsed,
  layoutRackNodesForElevationMode
} from './rackGeometry';
import { resolveCanvasAppearance } from './canvasBackgrounds';
import { buildProjectLegendData, computeLegendLayoutMetrics } from './legendGenerator';
import { getCategoryAccentColor, isStandardCatalogNodeColor } from '../data/deviceCatalog';
import { sanitizeSafeImageUrl } from './security';
import { resolveNodeLayer } from './layerPolicy';
import { normalizeScalePxPerMeter } from './scaleUtils';
import {
  buildSectorSvgPath,
  cameraRangeMetersToCanvasPx,
  resolveCameraFov,
  resolveWifiCoverage,
  wifiRadiusMetersToCanvasPx
} from './coverageUtils';

export interface DiagramBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface PureSvgExportOptions {
  darkTheme?: boolean;
  includeTitleBlock?: boolean;
  boundsOverride?: DiagramBounds;
  whiteBackground?: boolean;
  /**
   * Optional explicit floor scope:
   * - `'__ALL__'`: include all floors (ignore activeFloorId filter)
   * - string floorId: restrict nodes/rooms/trays to that floor even in topology/electrical/rack modes
   */
  floorScopeId?: string;
  /** Skips emitting <pattern id="pure-grid"> (useful inside composite multi-floor sheets). */
  skipGridPattern?: boolean;
}

interface BrandBadgeDef {
  shortCode: string;
  accentColor: string;
  bgColor: string;
}

const BRAND_LOGO_MAP: Record<string, BrandBadgeDef> = {
  logo_cisco: { shortCode: 'CISCO', accentColor: '#049fd9', bgColor: '#0c4a6e' },
  logo_mikrotik: { shortCode: 'MT', accentColor: '#f8fafc', bgColor: '#1e293b' },
  logo_fortinet: { shortCode: 'FTNT', accentColor: '#ef4444', bgColor: '#450a0a' },
  logo_aruba: { shortCode: 'ARUBA', accentColor: '#f97316', bgColor: '#431407' },
  logo_ubiquiti: { shortCode: 'UniFi', accentColor: '#38bdf8', bgColor: '#0f172a' },
  logo_ruijie: { shortCode: 'RG', accentColor: '#60a5fa', bgColor: '#172554' },
  logo_h3c: { shortCode: 'H3C', accentColor: '#f43f5e', bgColor: '#3b0764' },
  logo_tplink: { shortCode: 'OMADA', accentColor: '#2dd4bf', bgColor: '#134e4a' },
  logo_dell: { shortCode: 'DELL', accentColor: '#38bdf8', bgColor: '#082f49' },
  logo_hikvision: { shortCode: 'HIK', accentColor: '#f87171', bgColor: '#1e1b4b' },
  logo_apc: { shortCode: 'APC', accentColor: '#4ade80', bgColor: '#052e16' },
  logo_hachihi: { shortCode: 'HCH', accentColor: '#ffffff', bgColor: '#1d4ed8' }
};

function renderPureSvgCategoryGlyph(
  category: string,
  cx: number,
  cy: number,
  size: number,
  strokeColor: string
): string {
  const s = size * 0.36;
  const cat = (category || '').toLowerCase();
  const sw = Math.max(1.2, size * 0.065).toFixed(2);
  const stroke = escapeXml(strokeColor);

  if (cat === 'router' || cat === 'gateway') {
    return [
      `<circle cx="${cx}" cy="${cy}" r="${(s * 0.92).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${sw}" />`,
      `<path d="M ${(cx - s * 0.65).toFixed(1)} ${cy} L ${(cx + s * 0.65).toFixed(1)} ${cy} M ${cx} ${(cy - s * 0.65).toFixed(1)} L ${cx} ${(cy + s * 0.65).toFixed(1)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" />`
    ].join('');
  }
  if (cat === 'firewall') {
    return [
      `<path d="M ${cx} ${(cy - s * 0.95).toFixed(1)} L ${(cx + s * 0.8).toFixed(1)} ${(cy - s * 0.55).toFixed(1)} V ${(cy + s * 0.1).toFixed(1)} C ${(cx + s * 0.8).toFixed(1)} ${(cy + s * 0.65).toFixed(1)} ${cx} ${(cy + s * 0.98).toFixed(1)} ${cx} ${(cy + s * 0.98).toFixed(1)} C ${cx} ${(cy + s * 0.98).toFixed(1)} ${(cx - s * 0.8).toFixed(1)} ${(cy + s * 0.65).toFixed(1)} ${(cx - s * 0.8).toFixed(1)} ${(cy + s * 0.1).toFixed(1)} V ${(cy - s * 0.55).toFixed(1)} Z" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`
    ].join('');
  }
  if (cat === 'ap') {
    return [
      `<path d="M ${(cx - s * 0.88).toFixed(1)} ${(cy - s * 0.15).toFixed(1)} A ${(s * 1.1).toFixed(1)} ${(s * 1.1).toFixed(1)} 0 0 1 ${(cx + s * 0.88).toFixed(1)} ${(cy - s * 0.15).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" />`,
      `<path d="M ${(cx - s * 0.55).toFixed(1)} ${(cy + s * 0.2).toFixed(1)} A ${(s * 0.7).toFixed(1)} ${(s * 0.7).toFixed(1)} 0 0 1 ${(cx + s * 0.55).toFixed(1)} ${(cy + s * 0.2).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" />`,
      `<circle cx="${cx}" cy="${(cy + s * 0.62).toFixed(1)}" r="${(s * 0.22).toFixed(1)}" fill="${stroke}" />`
    ].join('');
  }
  if (cat === 'camera' || cat === 'nvr') {
    return [
      `<rect x="${(cx - s * 0.92).toFixed(1)}" y="${(cy - s * 0.52).toFixed(1)}" width="${(s * 1.32).toFixed(1)}" height="${(s * 1.04).toFixed(1)}" rx="2" fill="none" stroke="${stroke}" stroke-width="${sw}" />`,
      `<polygon points="${(cx + s * 0.42).toFixed(1)},${(cy - s * 0.12).toFixed(1)} ${(cx + s * 0.95).toFixed(1)},${(cy - s * 0.48).toFixed(1)} ${(cx + s * 0.95).toFixed(1)},${(cy + s * 0.48).toFixed(1)} ${(cx + s * 0.42).toFixed(1)},${(cy + s * 0.12).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`
    ].join('');
  }
  if (cat === 'ups' || cat === 'pdu' || cat === 'electrical_panel') {
    return `<polygon points="${(cx + s * 0.15).toFixed(1)},${(cy - s * 0.95).toFixed(1)} ${(cx - s * 0.58).toFixed(1)},${(cy + s * 0.08).toFixed(1)} ${cx},${(cy + s * 0.08).toFixed(1)} ${(cx - s * 0.15).toFixed(1)},${(cy + s * 0.95).toFixed(1)} ${(cx + s * 0.58).toFixed(1)},${(cy - s * 0.08).toFixed(1)} ${cx},${(cy - s * 0.08).toFixed(1)}" fill="${stroke}" />`;
  }
  if (cat === 'cloud') {
    return `<path d="M ${(cx - s * 0.55).toFixed(1)} ${(cy + s * 0.55).toFixed(1)} H ${(cx + s * 0.62).toFixed(1)} A ${(s * 0.42).toFixed(1)} ${(s * 0.42).toFixed(1)} 0 0 0 ${(cx + s * 0.52).toFixed(1)} ${(cy - s * 0.28).toFixed(1)} A ${(s * 0.55).toFixed(1)} ${(s * 0.55).toFixed(1)} 0 0 0 ${(cx - s * 0.5).toFixed(1)} ${(cy - s * 0.2).toFixed(1)} A ${(s * 0.4).toFixed(1)} ${(s * 0.4).toFixed(1)} 0 0 0 ${(cx - s * 0.55).toFixed(1)} ${(cy + s * 0.55).toFixed(1)} Z" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
  }
  if (cat === 'odf' || cat === 'patch_panel') {
    return [
      `<rect x="${(cx - s * 0.9).toFixed(1)}" y="${(cy - s * 0.48).toFixed(1)}" width="${(s * 1.8).toFixed(1)}" height="${(s * 0.96).toFixed(1)}" rx="1.5" fill="none" stroke="${stroke}" stroke-width="${sw}" />`,
      `<circle cx="${(cx - s * 0.5).toFixed(1)}" cy="${cy}" r="${(s * 0.14).toFixed(1)}" fill="${stroke}" />`,
      `<circle cx="${cx}" cy="${cy}" r="${(s * 0.14).toFixed(1)}" fill="${stroke}" />`,
      `<circle cx="${(cx + s * 0.5).toFixed(1)}" cy="${cy}" r="${(s * 0.14).toFixed(1)}" fill="${stroke}" />`
    ].join('');
  }
  if (cat === 'server' || cat === 'storage') {
    return [
      `<rect x="${(cx - s * 0.85).toFixed(1)}" y="${(cy - s * 0.82).toFixed(1)}" width="${(s * 1.7).toFixed(1)}" height="${(s * 0.7).toFixed(1)}" rx="1.5" fill="none" stroke="${stroke}" stroke-width="${sw}" />`,
      `<rect x="${(cx - s * 0.85).toFixed(1)}" y="${(cy + s * 0.12).toFixed(1)}" width="${(s * 1.7).toFixed(1)}" height="${(s * 0.7).toFixed(1)}" rx="1.5" fill="none" stroke="${stroke}" stroke-width="${sw}" />`,
      `<circle cx="${(cx - s * 0.5).toFixed(1)}" cy="${(cy - s * 0.47).toFixed(1)}" r="${(s * 0.12).toFixed(1)}" fill="${stroke}" />`,
      `<circle cx="${(cx - s * 0.5).toFixed(1)}" cy="${(cy + s * 0.47).toFixed(1)}" r="${(s * 0.12).toFixed(1)}" fill="${stroke}" />`
    ].join('');
  }
  if (cat === 'workstation' || cat === 'printer') {
    return [
      `<rect x="${(cx - s * 0.88).toFixed(1)}" y="${(cy - s * 0.72).toFixed(1)}" width="${(s * 1.76).toFixed(1)}" height="${(s * 1.12).toFixed(1)}" rx="1.8" fill="none" stroke="${stroke}" stroke-width="${sw}" />`,
      `<path d="M ${(cx - s * 0.45).toFixed(1)} ${(cy + s * 0.72).toFixed(1)} H ${(cx + s * 0.45).toFixed(1)} M ${cx} ${(cy + s * 0.4).toFixed(1)} V ${(cy + s * 0.72).toFixed(1)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" />`
    ].join('');
  }
  // Default Switch / Core Switch
  return [
    `<rect x="${(cx - s * 0.92).toFixed(1)}" y="${(cy - s * 0.55).toFixed(1)}" width="${(s * 1.84).toFixed(1)}" height="${(s * 1.1).toFixed(1)}" rx="2" fill="none" stroke="${stroke}" stroke-width="${sw}" />`,
    `<path d="M ${(cx - s * 0.55).toFixed(1)} ${(cy - s * 0.18).toFixed(1)} H ${(cx + s * 0.55).toFixed(1)} M ${(cx + s * 0.25).toFixed(1)} ${(cy - s * 0.36).toFixed(1)} L ${(cx + s * 0.55).toFixed(1)} ${(cy - s * 0.18).toFixed(1)} L ${(cx + s * 0.25).toFixed(1)} ${cy}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`,
    `<path d="M ${(cx + s * 0.55).toFixed(1)} ${(cy + s * 0.22).toFixed(1)} H ${(cx - s * 0.55).toFixed(1)} M ${(cx - s * 0.25).toFixed(1)} ${(cy + s * 0.04).toFixed(1)} L ${(cx - s * 0.55).toFixed(1)} ${(cy + s * 0.22).toFixed(1)} L ${(cx - s * 0.25).toFixed(1)} ${(cy + s * 0.4).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" />`
  ].join('');
}

export function computeViewportDiagramBounds(
  pan: { x: number; y: number },
  zoom: number,
  viewportSize: { w: number; h: number }
): DiagramBounds | undefined {
  if (!viewportSize || viewportSize.w <= 0 || viewportSize.h <= 0 || zoom <= 0) {
    return undefined;
  }
  return {
    minX: Math.round(-pan.x / zoom),
    minY: Math.round(-pan.y / zoom),
    width: Math.max(240, Math.round(viewportSize.w / zoom)),
    height: Math.max(180, Math.round(viewportSize.h / zoom))
  };
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function computePureDiagramBounds(
  project: ProjectState,
  options?: PureSvgExportOptions
): DiagramBounds {
  const isFloorMode = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);
  const scope = options?.floorScopeId;
  const activeFloorFilter =
    scope === '__ALL__' ? '' : scope || (isFloorMode ? project.activeFloorId : '');
  const floorplanRackNodes = project.nodes.filter(n => !n.hidden && n.type === 'rack' && n.diagramMode === 'floorplan');
  const rawNodes = project.nodes.filter(n => {
    if (n.hidden) return false;
    if (activeFloorFilter && n.floorId && n.floorId !== activeFloorFilter) return false;
    if (isFloorMode && isRackMountedTopologyShadowNode(n, project.assets, floorplanRackNodes, project.racks)) {
      return false;
    }
    if (project.activeMode === 'rack') return n.diagramMode === 'rack' || n.type === 'rack';
    return true;
  });
  const activeNodes =
    project.activeMode === 'rack'
      ? layoutRackNodesForElevationMode(rawNodes.filter(n => n.type === 'rack'), project.racks)
      : rawNodes;

  const activeRooms = project.rooms.filter(r => {
    if (activeFloorFilter && r.floorId && r.floorId !== activeFloorFilter) return false;
    return true;
  });

  const activeTrays = (project.cableTrays || []).filter(tr => {
    if (activeFloorFilter && tr.floorId && tr.floorId !== activeFloorFilter) return false;
    return true;
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  activeNodes.forEach(n => {
    const effH = n.type === 'rack' ? getEffectiveRackDisplayHeight(n) : n.height;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + effH + 42);
  });

  activeRooms.forEach(r => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  });

  activeTrays.forEach(tr => {
    tr.points.forEach(pt => {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    });
  });

  const hiddenLayers = new Set(project.settings.hiddenLayers || []);
  if (!hiddenLayers.has('cables')) {
    const activeNodeIds = new Set(activeNodes.map(n => n.id));
    (project.cables || []).forEach(c => {
      if (!c.controlPoints || c.controlPoints.length === 0) return;
      if (!activeNodeIds.has(c.sourceNodeId) || !activeNodeIds.has(c.targetNodeId)) return;
      c.controlPoints.forEach(pt => {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      });
    });
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, width: 1200, height: 800 };
  }

  const pad = 70;
  return {
    minX: Math.round(minX - pad),
    minY: Math.round(minY - pad),
    width: Math.max(480, Math.round(maxX - minX + pad * 2)),
    height: Math.max(360, Math.round(maxY - minY + pad * 2))
  };
}

/**
 * Generates a pure, self-contained Vector SVG string WITHOUT <foreignObject>,
 * guaranteeing crystal-clear SVG CAD export and reliable canvas PNG rasterization
 * across all browsers (Chrome, Firefox, Edge, Safari).
 */
export function generatePureSvgMarkup(
  project: ProjectState,
  options?: PureSvgExportOptions
): string {
  const bounds = options?.boundsOverride || computePureDiagramBounds(project, options);
  const whiteBg = Boolean(options?.whiteBackground);
  const appearance = resolveCanvasAppearance(
    whiteBg
      ? {
          ...project.settings,
          backgroundPreset: 'pure_white',
          backgroundColor: '#ffffff',
          backgroundPattern: 'none',
          showGrid: false
        }
      : project.settings,
    whiteBg ? false : options?.darkTheme
  );
  const dark = whiteBg ? false : appearance.isDarkCanvas;
  const bg = whiteBg ? '#ffffff' : appearance.backgroundColor;
  const textPrimary = whiteBg ? '#0f172a' : appearance.labelColor;
  const textMuted = whiteBg ? '#475569' : appearance.mutedLabelColor;
  const roomStroke = dark ? '#475569' : '#94a3b8';
  const scalePxPerMeter = normalizeScalePxPerMeter(project.settings.scale);

  const hiddenLayers = new Set(project.settings.hiddenLayers || []);
  const hideRooms = hiddenLayers.has('rooms');
  const hideTrays = hiddenLayers.has('trays');
  const hideCables = hiddenLayers.has('cables');
  const hideWifi = hiddenLayers.has('wifi');
  const hideFov = hiddenLayers.has('fov');
  const hideLabels = hiddenLayers.has('labels');
  const hideCableLabels = hiddenLayers.has('cable_labels') || hideLabels;
  const isFloorBased = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);
  const scope = options?.floorScopeId;
  const activeFloorFilter =
    scope === '__ALL__' ? '' : scope || (isFloorBased ? project.activeFloorId : '');

  const floorplanRackNodes = project.nodes.filter(n => !n.hidden && n.type === 'rack' && n.diagramMode === 'floorplan');
  const rawVisibleNodes = project.nodes.filter(n => {
    if (n.hidden) return false;
    if (activeFloorFilter && n.floorId && n.floorId !== activeFloorFilter) return false;
    if (isFloorBased && isRackMountedTopologyShadowNode(n, project.assets, floorplanRackNodes, project.racks)) {
      return false;
    }
    if (project.activeMode === 'rack') return n.diagramMode === 'rack' || n.type === 'rack';
    const layer = resolveNodeLayer(n, project.assets);
    if (hiddenLayers.has(layer)) return false;
    return true;
  });
  const visibleNodes =
    project.activeMode === 'rack'
      ? layoutRackNodesForElevationMode(rawVisibleNodes.filter(n => n.type === 'rack'), project.racks)
      : rawVisibleNodes;

  const visibleRooms = hideRooms
    ? []
    : project.rooms.filter(r => {
        if (activeFloorFilter && r.floorId && r.floorId !== activeFloorFilter) return false;
        return true;
      });

  const visibleTrays = hideTrays
    ? []
    : (project.cableTrays || []).filter(tr => {
        if (activeFloorFilter && tr.floorId && tr.floorId !== activeFloorFilter) return false;
        return tr.points && tr.points.length >= 2;
      });

  const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`
  );
  parts.push(`<rect class="svg-bg" x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(bg)}" />`);

  // Canvas background grid pattern matching live view (skipped when solid whiteBackground or skipGridPattern is requested)
  if (!whiteBg && !options?.skipGridPattern && appearance.pattern !== 'none') {
    const g = project.settings.gridSize || 20;
    const dotColor = appearance.gridColor;
    let patternShape = `<circle cx="1.5" cy="1.5" r="1.1" fill="${escapeXml(dotColor)}" />`;
    if (appearance.pattern === 'lines') {
      patternShape = `<path d="M ${g} 0 L 0 0 0 ${g}" fill="none" stroke="${escapeXml(dotColor)}" stroke-width="0.7" stroke-opacity="0.7" />`;
    } else if (appearance.pattern === 'cross') {
      patternShape = `<path d="M 1 4 L 7 4 M 4 1 L 4 7" fill="none" stroke="${escapeXml(dotColor)}" stroke-width="0.9" />`;
    }
    parts.push(`<defs><pattern id="pure-grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse">${patternShape}</pattern></defs>`);
    parts.push(`<rect class="svg-grid-overlay" x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="url(#pure-grid)" />`);
  }

  const safeWorldBg = sanitizeSafeImageUrl(appearance.imageUrl);
  if (safeWorldBg && appearance.imageMode === 'world') {
    parts.push(`<image href="${escapeXml(safeWorldBg)}" x="0" y="0" width="1600" height="1000" preserveAspectRatio="xMidYMid meet" opacity="${appearance.imageOpacity}" />`);
  }

  // 1. Rooms (matching CanvasRoomNode header bar, riser dashed border, and m² area)
  for (const room of visibleRooms) {
    const fill = dark ? '#1e293b' : (room.color || '#f8fafc');
    const hdrFill = dark ? '#334155' : '#e2e8f0';
    const areaSqm = ((room.width * room.height) / (scalePxPerMeter * scalePxPerMeter)).toFixed(0);
    const dashAttr = room.type === 'utility_riser' ? 'stroke-dasharray="6 4"' : '';
    parts.push(`<g data-layer="room">`);
    parts.push(`<rect class="svg-room-body" x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}" rx="4" fill="${escapeXml(fill)}" fill-opacity="0.82" stroke="${roomStroke}" stroke-width="${Math.max(2, room.wallThickness || 3)}" ${dashAttr} />`);
    parts.push(`<rect class="svg-room-hdr" x="${room.x}" y="${room.y}" width="${room.width}" height="22" rx="4" fill="${hdrFill}" fill-opacity="0.88" />`);
    parts.push(`<text class="svg-room-title" x="${room.x + 8}" y="${room.y + 15}" fill="${dark ? '#e2e8f0' : '#334155'}" font-size="10.5" font-weight="700">${escapeXml(room.name)} · ${areaSqm}m²</text>`);
    parts.push(`</g>`);
  }

  // 1b. Cable Trays & Conduits (matching CanvasTraysLayer)
  if (visibleTrays.length > 0) {
    parts.push(`<g data-layer="cable-trays">`);
    for (const tray of visibleTrays) {
      const ptsStr = tray.points.map(p => `${p.x},${p.y}`).join(' ');
      const trayW = Math.max(8, tray.widthPx || 16);
      const baseColor = escapeXml(
        tray.color || (tray.kind === 'power_tray' ? '#e11d48' : tray.kind === 'conduit' ? '#0d9488' : '#0284c7')
      );
      const dashKind = tray.kind === 'conduit' ? '' : 'stroke-dasharray="4 5"';
      parts.push(`<g opacity="0.88">`);
      parts.push(`<polyline points="${ptsStr}" fill="none" stroke="${baseColor}" stroke-width="${trayW}" stroke-opacity="0.14" stroke-linecap="round" stroke-linejoin="round" />`);
      parts.push(`<polyline points="${ptsStr}" fill="none" stroke="${baseColor}" stroke-width="${Math.max(2, trayW * 0.72).toFixed(1)}" stroke-opacity="0.32" ${dashKind} stroke-linecap="butt" stroke-linejoin="round" />`);
      parts.push(`<polyline points="${ptsStr}" fill="none" stroke="${baseColor}" stroke-width="1.4" stroke-opacity="0.75" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" />`);
      if (!hideLabels && tray.name) {
        const midIdx = Math.floor(tray.points.length / 2);
        const midPt = tray.points[midIdx] || tray.points[0];
        const prevPt = tray.points[Math.max(0, midIdx - 1)] || midPt;
        const labelX = (prevPt.x + midPt.x) / 2;
        const labelY = (prevPt.y + midPt.y) / 2 - trayW / 2 - 8;
        const badgeW = Math.min(180, tray.name.length * 6.2 + 16);
        parts.push(`<g transform="translate(${labelX.toFixed(1)}, ${labelY.toFixed(1)})">`);
        parts.push(`<rect class="svg-tray-badge" x="${(-badgeW / 2).toFixed(1)}" y="-8" width="${badgeW.toFixed(1)}" height="14" rx="3" fill="${dark ? '#0f172a' : '#ffffff'}" fill-opacity="0.92" stroke="${baseColor}" stroke-opacity="0.6" stroke-width="0.9" />`);
        parts.push(`<text x="0" y="2" text-anchor="middle" fill="${baseColor}" font-size="8" font-weight="700">${escapeXml(tray.name)}</text>`);
        parts.push(`</g>`);
      }
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  }

  // 1c. Logical Group Frames
  const groupBoxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();
  for (const n of visibleNodes) {
    if (!n.groupId) continue;
    const effH = n.type === 'rack' ? getEffectiveRackDisplayHeight(n) : n.height;
    const g = groupBoxes.get(n.groupId);
    if (g) {
      g.minX = Math.min(g.minX, n.x);
      g.minY = Math.min(g.minY, n.y);
      g.maxX = Math.max(g.maxX, n.x + n.width);
      g.maxY = Math.max(g.maxY, n.y + effH);
      g.count += 1;
    } else {
      groupBoxes.set(n.groupId, { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + effH, count: 1 });
    }
  }
  for (const g of groupBoxes.values()) {
    if (g.count < 2) continue;
    parts.push(`<g data-layer="group-frame">`);
    parts.push(`<rect x="${g.minX - 10}" y="${g.minY - 14}" width="${g.maxX - g.minX + 20}" height="${g.maxY - g.minY + 24}" rx="10" fill="#3b82f6" fill-opacity="0.04" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="6 4" />`);
    parts.push(`<text x="${g.minX - 4}" y="${g.minY - 18}" fill="#2563eb" font-size="9" font-weight="700" font-family="ui-monospace, monospace">NHÓM (${g.count})</text>`);
    parts.push(`</g>`);
  }

  // 1d. Wi-Fi Heatmap & Camera FOV Coverage Underlays (rendered beneath devices matching DesignCanvas)
  const nonRackNonLegend = visibleNodes.filter(n => n.type !== 'rack' && n.type !== 'legend');
  if (project.settings.showCoverageRadius) {
    for (const node of nonRackNonLegend) {
      const asset = node.assetId ? project.assets[node.assetId] : undefined;
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      const wifiCov = resolveWifiCoverage(node, asset);
      if (!hideWifi && wifiCov) {
        const radPx = wifiRadiusMetersToCanvasPx(wifiCov.radiusMeters, project.settings.scale);
        const nodeRotDeg = node.rotation || 0;
        parts.push(`<g data-layer="wifi-heatmap">`);
        if (wifiCov.isDirectional) {
          const innerSector = buildSectorSvgPath(cx, cy, radPx * 0.55, nodeRotDeg, wifiCov.angleDeg);
          const outerSector = buildSectorSvgPath(cx, cy, radPx, nodeRotDeg, wifiCov.angleDeg);
          parts.push(`<path d="${innerSector}" fill="#10b981" fill-opacity="0.16" stroke="#059669" stroke-width="1" stroke-dasharray="3 3" />`);
          parts.push(`<path d="${outerSector}" fill="#06b6d4" fill-opacity="0.09" stroke="#0891b2" stroke-width="1.5" stroke-dasharray="5 5" />`);
          if (!hideLabels) {
            const rotRad = (nodeRotDeg * Math.PI) / 180;
            const lx = cx + radPx * 0.68 * Math.cos(rotRad);
            const ly = cy + radPx * 0.68 * Math.sin(rotRad);
            parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="700">${wifiCov.radiusMeters}m · ${wifiCov.angleDeg}° (${wifiCov.areaSqm} m²)</text>`);
          }
        } else {
          parts.push(`<circle cx="${cx}" cy="${cy}" r="${(radPx * 0.55).toFixed(1)}" fill="#10b981" fill-opacity="0.16" stroke="#059669" stroke-width="1" stroke-dasharray="3 3" />`);
          parts.push(`<circle cx="${cx}" cy="${cy}" r="${radPx.toFixed(1)}" fill="#06b6d4" fill-opacity="0.08" stroke="#0891b2" stroke-width="1.5" stroke-dasharray="5 5" />`);
          if (!hideLabels) {
            parts.push(`<text x="${cx}" y="${(cy - radPx - 6).toFixed(1)}" text-anchor="middle" fill="#059669" font-size="9.5" font-weight="700">${wifiCov.radiusMeters}m (${wifiCov.areaSqm} m²)</text>`);
          }
        }
        parts.push(`</g>`);
      }
      const camFov = resolveCameraFov(node, asset);
      if (!hideFov && camFov) {
        const range = cameraRangeMetersToCanvasPx(camFov.rangeMeters, project.settings.scale);
        const nodeRotDeg = node.rotation || 0;
        const rot = (nodeRotDeg * Math.PI) / 180;
        parts.push(`<g data-layer="camera-fov">`);
        if (camFov.isOmnidirectional) {
          parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${range.toFixed(1)}" fill="#f59e0b" fill-opacity="0.20" stroke="#d97706" stroke-width="1.5" stroke-dasharray="4 4" />`);
        } else {
          const dPath = buildSectorSvgPath(cx, cy, range, nodeRotDeg, camFov.fovAngle);
          parts.push(`<path d="${dPath}" fill="#f59e0b" fill-opacity="0.22" stroke="#d97706" stroke-width="1.5" stroke-dasharray="4 4" />`);
        }
        if (!hideLabels) {
          const lx = camFov.isOmnidirectional ? cx : cx + range * 0.65 * Math.cos(rot);
          const ly = camFov.isOmnidirectional ? cy - range - 6 : cy + range * 0.65 * Math.sin(rot);
          parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="#b45309" font-size="9" font-weight="700">FOV ${camFov.fovAngle}° (${camFov.rangeMeters}m)</text>`);
        }
        parts.push(`</g>`);
      }
    }
  }

  // 2. 19" Server Racks (matching CanvasRackNode rails, bay, U-slot grid, category plates, status dot & footer)
  const rackNodes = visibleNodes.filter(n => n.type === 'rack');
  for (const rn of rackNodes) {
    const rack = project.racks.find(
      r => r.id === rn.customData?.rackId || r.id === rn.id || r.name === rn.label
    );
    const units = rack?.totalUnits || rn.customData?.totalUnits || 42;
    const isCollapsed = isRackNodeCollapsed(rn);
    const displayH = getEffectiveRackDisplayHeight(rn);
    const m = getRackCanvasMetrics(rn, units);
    const stats = rack ? getRackStatistics(rack, project.assets) : null;
    const hasRackWarning = Boolean(stats && (stats.overflowItems.length > 0 || stats.isOverweight));
    const usedU = stats?.frontUsedUnits || 0;
    const freeU = Math.max(0, units - usedU);

    const rackRot = rn.rotation || 0;
    const rackCx = rn.x + rn.width / 2;
    const rackCy = rn.y + displayH / 2;
    parts.push(
      rackRot
        ? `<g data-layer="rack" transform="rotate(${rackRot}, ${rackCx.toFixed(1)}, ${rackCy.toFixed(1)})">`
        : `<g data-layer="rack">`
    );
    parts.push(`<rect x="${rn.x}" y="${rn.y}" width="${rn.width}" height="${displayH}" rx="6" fill="#0b1120" stroke="${hasRackWarning ? '#ef4444' : '#334155'}" stroke-width="2" />`);
    parts.push(`<rect x="${rn.x + 1}" y="${rn.y + 1}" width="${rn.width - 2}" height="${CANVAS_RACK_HEADER_H}" rx="5" fill="#1e293b" />`);
    parts.push(`<text x="${rn.x + 10}" y="${rn.y + 21}" fill="#f8fafc" font-size="10.5" font-weight="700">${escapeXml(rack?.name || rn.label)} (${units}U)</text>`);
    parts.push(`<rect x="${rn.x + rn.width - 52}" y="${rn.y + 8}" width="44" height="17" rx="4" fill="#0f766e" />`);
    parts.push(`<text x="${rn.x + rn.width - 30}" y="${rn.y + 19.5}" text-anchor="middle" fill="#ffffff" font-size="8.5" font-weight="700" font-family="ui-monospace, monospace">TRƯỚC</text>`);

    if (isCollapsed) {
      const slotsObj = rack ? getRackSlotsForSide(rack, 'front') : {};
      const devCount = Object.keys(slotsObj).length;
      const barW = Math.max(24, rn.width - 28);
      const fillW = Math.round(barW * Math.min(1, usedU / Math.max(1, units)));
      parts.push(`<rect x="${rn.x + 8}" y="${rn.y + CANVAS_RACK_HEADER_H + 5}" width="${rn.width - 16}" height="${CANVAS_RACK_COLLAPSED_BODY_H - 10}" rx="4" fill="#0f172a" stroke="#1e293b" stroke-width="1" />`);
      parts.push(`<rect x="${rn.x + 14}" y="${rn.y + CANVAS_RACK_HEADER_H + 11}" width="${barW}" height="6" rx="3" fill="#1e293b" />`);
      parts.push(`<rect x="${rn.x + 14}" y="${rn.y + CANVAS_RACK_HEADER_H + 11}" width="${fillW}" height="6" rx="3" fill="${hasRackWarning ? '#ef4444' : '#0ea5e9'}" />`);
      parts.push(`<text x="${rn.x + 14}" y="${rn.y + CANVAS_RACK_HEADER_H + 27}" fill="#cbd5e1" font-size="8.5" font-family="ui-monospace, monospace">${devCount} thiết bị · Chi tiết thu gọn</text>`);
    } else {
      // Left 19" U-Rail + Inner Bay
      parts.push(`<rect x="${rn.x + 4}" y="${m.slotsY}" width="${CANVAS_RACK_RAIL_W - 6}" height="${m.availableSlotsHeight}" rx="2" fill="#0f172a" />`);
      parts.push(`<rect x="${m.slotsX}" y="${m.slotsY}" width="${m.slotsWidth}" height="${m.availableSlotsHeight}" fill="#020617" stroke="#1e293b" stroke-width="1" />`);

      const labelStep = m.slotH >= 11 ? 1 : m.slotH >= 7 ? 2 : 5;
      for (let idx = 0; idx < units; idx++) {
        const uNum = units - idx;
        const rowY = m.slotsY + idx * m.slotH;
        parts.push(`<line x1="${m.slotsX}" y1="${(rowY + m.slotH).toFixed(1)}" x2="${m.slotsX + m.slotsWidth}" y2="${(rowY + m.slotH).toFixed(1)}" stroke="#1e293b" stroke-width="0.6" />`);
        if (m.slotH >= 6 && (uNum === units || uNum === 1 || uNum % labelStep === 0)) {
          const uLabel = uNum < 10 ? `U0${uNum}` : `U${uNum}`;
          parts.push(`<text x="${rn.x + CANVAS_RACK_RAIL_W - 6}" y="${(rowY + m.slotH * 0.72).toFixed(1)}" text-anchor="end" fill="#64748b" font-size="${m.slotH >= 12 ? '8' : '6.5'}" font-weight="600" font-family="ui-monospace, monospace">${uLabel}</text>`);
        }
      }

      if (rack) {
        const slots = getRackSlotsForSide(rack, 'front');
        for (const [uStr, assetId] of Object.entries(slots)) {
          const startU = parseInt(uStr, 10);
          const asset = project.assets[assetId];
          if (!asset || Number.isNaN(startU)) continue;
          const uH = getAssetUHeight(asset);
          const isOverflow = startU < 1 || startU + uH - 1 > units;
          const clampedU = Math.max(1, Math.min(units, startU));
          const rect = getSlotSpanRect(clampedU, uH, units, m.slotH);
          const px = m.slotsX + 2;
          const py = m.slotsY + rect.top + 0.8;
          const pw = Math.max(20, m.slotsWidth - 4);
          const ph = Math.max(4, rect.height - 1.6);
          const accent = isOverflow ? '#ef4444' : getCategoryAccentColor(asset.category);
          const statusDot = isOverflow ? '#ef4444' : asset.status === 'online' ? '#22c55e' : '#f59e0b';
          const uTag = uH > 1 ? `U${startU}-${startU + uH - 1}` : `U${startU}`;

          parts.push(`<rect x="${px}" y="${py.toFixed(1)}" width="${pw}" height="${ph.toFixed(1)}" rx="2" fill="${isOverflow ? '#450a0a' : '#1e293b'}" stroke="${escapeXml(accent)}" stroke-width="1.1" />`);
          parts.push(`<rect x="${px}" y="${py.toFixed(1)}" width="4" height="${ph.toFixed(1)}" rx="1" fill="${escapeXml(accent)}" />`);
          if (ph >= 8) {
            parts.push(`<circle cx="${px + 10}" cy="${(py + ph / 2).toFixed(1)}" r="${Math.min(2.5, ph / 4).toFixed(1)}" fill="${statusDot}" />`);
            parts.push(`<text x="${px + 16}" y="${(py + ph / 2 + 3).toFixed(1)}" fill="#f8fafc" font-size="${Math.min(9.5, Math.max(6.5, ph * 0.55)).toFixed(1)}" font-weight="600">${escapeXml(asset.name.slice(0, 22))}${isOverflow ? ' ⚠' : ''}</text>`);
          }
          if (ph >= 10 && pw >= 120) {
            parts.push(`<text x="${px + pw - 6}" y="${(py + ph / 2 + 2.5).toFixed(1)}" text-anchor="end" fill="#94a3b8" font-size="7.5" font-family="ui-monospace, monospace">${uTag}</text>`);
          }
        }
      }
    }

    // Rack Footer
    parts.push(`<rect x="${rn.x + 1}" y="${rn.y + displayH - CANVAS_RACK_FOOTER_H - 1}" width="${rn.width - 2}" height="${CANVAS_RACK_FOOTER_H}" rx="4" fill="${hasRackWarning ? '#450a0a' : '#111827'}" />`);
    parts.push(`<text x="${rn.x + 10}" y="${rn.y + displayH - 8}" fill="${hasRackWarning ? '#fca5a5' : '#94a3b8'}" font-size="8" font-family="ui-monospace, monospace">${usedU}U dùng · ${freeU}U trống</text>`);
    parts.push(`<text x="${rn.x + rn.width - 10}" y="${rn.y + displayH - 8}" text-anchor="end" fill="${stats?.isOverweight ? '#f87171' : '#34d399'}" font-size="8.5" font-weight="700" font-family="ui-monospace, monospace">${stats?.totalPowerWatts || 0}W · ${(stats?.totalWeightKg || 0).toFixed(0)}kg</text>`);
    parts.push(`</g>`);
  }

  // 3. Cables (grouped visually as parallel Cable Bundles when sharing a corridor)
  const exportableCables = hideCables
    ? []
    : project.cables.filter(
        c => nodeMap.has(c.sourceNodeId) && nodeMap.has(c.targetNodeId)
      );
  const bundleLayout = computeCableBundleLayout(exportableCables, id => {
    const n = nodeMap.get(id);
    if (!n) return null;
    const effH = n.type === 'rack' ? getEffectiveRackDisplayHeight(n) : n.height;
    return { x: n.x, y: n.y, width: n.width, height: effH };
  });

  // 3a. Bundle tie-wrap jacket collars
  for (const bundle of bundleLayout.bundles) {
    const angleDeg = (Math.atan2(bundle.tangent.y, bundle.tangent.x) * 180) / Math.PI;
    const collarH = bundle.spanWidthPx + 8;
    parts.push(`<g transform="translate(${bundle.midPoint.x}, ${bundle.midPoint.y}) rotate(${angleDeg.toFixed(1)})">`);
    parts.push(`<rect x="-11" y="${(-collarH / 2).toFixed(1)}" width="22" height="${collarH.toFixed(1)}" rx="6" fill="#eff6ff" fill-opacity="${dark ? '0.22' : '0.85'}" stroke="#60a5fa" stroke-width="1.1" stroke-dasharray="3 2" />`);
    parts.push(`<line x1="-5" y1="${(-(bundle.spanWidthPx / 2 + 2)).toFixed(1)}" x2="-5" y2="${(bundle.spanWidthPx / 2 + 2).toFixed(1)}" stroke="#3b82f6" stroke-width="1.5" />`);
    parts.push(`<line x1="5" y1="${(-(bundle.spanWidthPx / 2 + 2)).toFixed(1)}" x2="5" y2="${(bundle.spanWidthPx / 2 + 2).toFixed(1)}" stroke="#3b82f6" stroke-width="1.5" />`);
    parts.push(`</g>`);
  }

  // 3b. Individual parallel cable strands
  for (const cable of exportableCables) {
    const src = nodeMap.get(cable.sourceNodeId);
    const tgt = nodeMap.get(cable.targetNodeId);
    if (!src || !tgt) continue;
    const pathInfo = bundleLayout.cablePaths.get(cable.id) || computeCablePath(cable, src, tgt);
    const dash = cable.lineStyle === 'dashed' ? 'stroke-dasharray="6 4"' : '';
    parts.push(`<g>`);
    parts.push(`<path d="${pathInfo.d}" fill="none" stroke="${escapeXml(cable.color || '#0284c7')}" stroke-width="${cable.strokeWidth || 2}" ${dash} stroke-linecap="round" stroke-linejoin="round" />`);
    parts.push(`</g>`);
  }

  // 3c. Consolidated bundle summary badges
  if (project.settings.showCableCodes && !hideCableLabels) {
    for (const bundle of bundleLayout.bundles) {
      const badgeW = Math.max(76, bundle.summaryLabel.length * 5.8 + 14);
      const labelYOffset = -(bundle.spanWidthPx / 2 + 17);
      parts.push(`<g transform="translate(${bundle.midPoint.x}, ${bundle.midPoint.y + labelYOffset})">`);
      parts.push(`<rect class="svg-bundle-badge" x="${(-badgeW / 2).toFixed(1)}" y="-9" width="${badgeW.toFixed(1)}" height="18" rx="9" fill="${dark ? '#0f172a' : '#ffffff'}" stroke="#2563eb" stroke-width="1.2" />`);
      parts.push(`<text class="svg-bundle-text" x="0" y="3" text-anchor="middle" fill="${dark ? '#93c5fd' : '#1e3a8a'}" font-size="8.5" font-weight="700" font-family="ui-monospace, monospace">${escapeXml(bundle.summaryLabel)}</text>`);
      parts.push(`</g>`);
    }
  }

  // 3d. Dedicated Cable Labeling Overlay Layer
  if (!hideCableLabels) {
    parts.push(`<g data-layer="cable-labeling">`);
    for (const cable of exportableCables) {
      const src = nodeMap.get(cable.sourceNodeId);
      const tgt = nodeMap.get(cable.targetNodeId);
      if (!src || !tgt) continue;
      const isBundled = bundleLayout.cableToBundleId.has(cable.id);
      const hasCustomLabel = Boolean(cable.label && cable.label.trim().length > 0);
      if (!(project.settings.showCableCodes || hasCustomLabel) || isBundled) continue;

      const pathInfo = bundleLayout.cablePaths.get(cable.id) || computeCablePath(cable, src, tgt);
      const lt = resolveCableLabelTransform(cable, pathInfo);
      const badgeText = hasCustomLabel ? lt.text : `${cable.cableCode} (${cable.bandwidth})`;
      const bw = Math.max(lt.badgeWidth, Math.min(360, Math.round(badgeText.length * lt.fontSize * 0.64 + lt.fontSize * 2 + 8)));
      const bh = lt.badgeHeight;
      const halfH = bh / 2;
      const dotR = Math.max(2.4, Math.min(4.2, lt.fontSize * 0.28));
      const cableStroke = escapeXml(cable.color || '#0284c7');

      parts.push(`<g transform="translate(${lt.x.toFixed(1)}, ${lt.y.toFixed(1)}) rotate(${lt.angleDeg.toFixed(1)})">`);
      parts.push(`<rect class="svg-cable-badge" x="${(-bw / 2).toFixed(1)}" y="${(-halfH).toFixed(1)}" width="${bw}" height="${bh}" rx="4" fill="${dark ? '#0f172a' : '#ffffff'}" fill-opacity="0.96" stroke="${cableStroke}" stroke-width="1.1" />`);
      parts.push(`<circle cx="${(-bw / 2 + dotR + 5).toFixed(1)}" cy="0" r="${dotR.toFixed(1)}" fill="${cableStroke}" />`);
      parts.push(`<text class="svg-cable-text" x="${(dotR + 1.5).toFixed(1)}" y="${(lt.fontSize * 0.35).toFixed(1)}" text-anchor="middle" fill="${dark ? '#f1f5f9' : '#0f172a'}" font-size="${lt.fontSize}" font-weight="${hasCustomLabel ? '700' : '600'}">${escapeXml(badgeText)}</text>`);
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  }

  // 4. Legend Documentation Tables (pure SVG with proportional scaling, totals badge & footer)
  const legendNodes = visibleNodes.filter(n => n.type === 'legend');
  legendNodes.forEach((ln, lnIdx) => {
    const legendData = buildProjectLegendData(project, {
      scope: ln.customData?.legendScope || 'all',
      includeCables: ln.customData?.legendIncludeCables ?? true,
      title: ln.customData?.legendTitle || ln.label
    });
    const metrics = computeLegendLayoutMetrics(
      ln.width,
      ln.height,
      legendData.components.length,
      typeof ln.customData?.legendScale === 'number' ? ln.customData.legendScale : undefined
    );
    const s = metrics.scale;
    const headerH = Math.round(34 * s);
    const footerH = Math.round(18 * s);
    const fontTitle = (11 * s).toFixed(1);
    const fontSub = (8.8 * s).toFixed(1);
    const fontRow = (10 * s).toFixed(1);
    const fontCount = (10.5 * s).toFixed(1);
    const fontCable = (9.5 * s).toFixed(1);
    const iconSize = Math.round(16 * s);
    const rowStep = Math.round(25 * s);
    const clipId = `legend-clip-${lnIdx}`;

    const legendCx = ln.x + ln.width / 2;
    const legendCy = ln.y + ln.height / 2;
    const legendRot = ln.rotation ? ` transform="rotate(${ln.rotation} ${legendCx} ${legendCy})"` : '';
    parts.push(`<defs><clipPath id="${clipId}"><rect x="${ln.x}" y="${ln.y}" width="${ln.width}" height="${ln.height}" rx="6" /></clipPath></defs>`);
    parts.push(`<g${legendRot}><g clip-path="url(#${clipId})">`);
    parts.push(`<rect class="svg-legend-bg" x="${ln.x}" y="${ln.y}" width="${ln.width}" height="${ln.height}" rx="6" fill="${dark ? '#0f172a' : '#ffffff'}" stroke="${escapeXml(ln.style?.borderColor || '#1d4ed8')}" stroke-width="2" />`);
    parts.push(`<rect x="${ln.x}" y="${ln.y}" width="${ln.width}" height="${headerH}" rx="6" fill="#1d4ed8" />`);
    parts.push(`<text x="${ln.x + 12}" y="${ln.y + Math.round(headerH * 0.62)}" fill="#ffffff" font-size="${fontTitle}" font-weight="700">${escapeXml(legendData.title.slice(0, 36))}</text>`);
    parts.push(`<text x="${ln.x + ln.width - 10}" y="${ln.y + Math.round(headerH * 0.62)}" text-anchor="end" fill="#dbeafe" font-size="${fontSub}" font-weight="700" font-family="ui-monospace, monospace">${legendData.totalDevices} TB · ${legendData.totalCables} Cáp</text>`);

    let rowY = ln.y + headerH + Math.round(18 * s);
    const maxBodyY = ln.y + ln.height - footerH - 4;
    if (metrics.columns === 2) {
      const colW = (ln.width - 24) / 2;
      for (let i = 0; i < legendData.components.length; i += 2) {
        if (rowY > maxBodyY) break;
        for (let c = 0; c < 2; c += 1) {
          const item = legendData.components[i + c];
          if (!item) continue;
          const colX = ln.x + 10 + c * (colW + 6);
          parts.push(`<rect x="${colX}" y="${rowY - Math.round(iconSize * 0.72)}" width="${iconSize}" height="${iconSize}" rx="3" fill="${escapeXml(item.accentColor)}" />`);
          parts.push(renderPureSvgCategoryGlyph(item.category, colX + iconSize / 2, rowY - Math.round(iconSize * 0.22), iconSize * 0.85, '#ffffff'));
          parts.push(`<text class="svg-legend-title" x="${colX + iconSize + 6}" y="${rowY}" fill="${dark ? '#f1f5f9' : '#0f172a'}" font-size="${fontRow}" font-weight="600">${escapeXml(item.label.slice(0, 22))}</text>`);
          parts.push(`<text x="${colX + colW - 4}" y="${rowY}" text-anchor="end" fill="#2563eb" font-size="${fontCount}" font-weight="800" font-family="ui-monospace, monospace">×${item.count}</text>`);
        }
        rowY += rowStep;
      }
    } else {
      for (const item of legendData.components) {
        if (rowY > maxBodyY) break;
        parts.push(`<rect x="${ln.x + 12}" y="${rowY - Math.round(iconSize * 0.72)}" width="${iconSize}" height="${iconSize}" rx="3" fill="${escapeXml(item.accentColor)}" />`);
        parts.push(renderPureSvgCategoryGlyph(item.category, ln.x + 12 + iconSize / 2, rowY - Math.round(iconSize * 0.22), iconSize * 0.85, '#ffffff'));
        parts.push(`<text class="svg-legend-title" x="${ln.x + 18 + iconSize}" y="${rowY}" fill="${dark ? '#f1f5f9' : '#0f172a'}" font-size="${fontRow}" font-weight="600">${escapeXml(item.label)} (${escapeXml(item.subLabel.slice(0, 22))})</text>`);
        parts.push(`<text x="${ln.x + ln.width - 14}" y="${rowY}" text-anchor="end" fill="#2563eb" font-size="${fontCount}" font-weight="800" font-family="ui-monospace, monospace">×${item.count}</text>`);
        parts.push(`<line class="svg-legend-div" x1="${ln.x + 10}" y1="${rowY + Math.round(8 * s)}" x2="${ln.x + ln.width - 10}" y2="${rowY + Math.round(8 * s)}" stroke="${dark ? '#1e293b' : '#e2e8f0'}" stroke-width="0.8" />`);
        rowY += rowStep;
      }
    }

    for (const cab of legendData.cables) {
      if (rowY > maxBodyY) break;
      parts.push(`<line x1="${ln.x + 12}" y1="${rowY - 3}" x2="${ln.x + 28}" y2="${rowY - 3}" stroke="${escapeXml(cab.color)}" stroke-width="3" />`);
      parts.push(`<text class="svg-legend-sub" x="${ln.x + 36}" y="${rowY}" fill="${dark ? '#cbd5e1' : '#334155'}" font-size="${fontCable}" font-weight="600">${escapeXml(cab.label)}</text>`);
      parts.push(`<text class="svg-legend-sub" x="${ln.x + ln.width - 14}" y="${rowY}" text-anchor="end" fill="${dark ? '#94a3b8' : '#475569'}" font-size="${fontCable}" font-weight="700" font-family="ui-monospace, monospace">×${cab.count} (${cab.totalMeters}m)</text>`);
      rowY += Math.round(22 * s);
    }

    // Legend footer bar
    parts.push(`<rect class="svg-legend-footer-bg" x="${ln.x}" y="${ln.y + ln.height - footerH}" width="${ln.width}" height="${footerH}" fill="${dark ? '#1e293b' : '#f8fafc'}" />`);
    parts.push(`<line class="svg-legend-div" x1="${ln.x}" y1="${ln.y + ln.height - footerH}" x2="${ln.x + ln.width}" y2="${ln.y + ln.height - footerH}" stroke="${dark ? '#334155' : '#e2e8f0'}" stroke-width="0.9" />`);
    parts.push(`<text class="svg-legend-footer-txt" x="${ln.x + 10}" y="${ln.y + ln.height - Math.round(footerH * 0.3)}" fill="${dark ? '#94a3b8' : '#64748b'}" font-size="${(8.2 * s).toFixed(1)}">Tự đồng bộ · ${Math.round(s * 100)}%${metrics.columns === 2 ? ' · 2 cột' : ''}</text>`);
    parts.push(`</g></g>`);
  });

  // 5. Device, Wall, Zone, Shape & Annotation Nodes (pure SVG)
  for (const node of nonRackNonLegend) {
    const asset = node.assetId ? project.assets[node.assetId] : undefined;
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const rotTransform = node.rotation
      ? ` transform="rotate(${node.rotation} ${cx} ${cy})"`
      : '';

    if (node.type === 'text') {
      const hasCustomBg = node.style?.backgroundColor && node.style.backgroundColor !== 'transparent';
      const noteBg = hasCustomBg ? node.style.backgroundColor : (dark ? '#1e293b' : '#ffffff');
      const noteBorder = node.style?.borderColor || '#94a3b8';
      const noteText = node.style?.textColor || textPrimary;
      parts.push(`<g${rotTransform}>`);
      parts.push(`<rect${!hasCustomBg ? ' class="svg-card-neutral"' : ''} x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" fill="${escapeXml(noteBg)}" fill-opacity="0.94" stroke="${escapeXml(noteBorder)}" stroke-width="1.2" stroke-dasharray="4 3" />`);
      parts.push(`<text${!node.style?.textColor ? ' class="svg-label-primary"' : ''} x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${escapeXml(noteText)}" font-size="${node.style?.fontSize || 11.5}" font-weight="600">${escapeXml(node.label)}</text>`);
      parts.push(`</g>`);
      continue;
    }

    if (node.type === 'zone') {
      const zBorder = node.style?.borderColor || '#155eef';
      const zBg = node.style?.backgroundColor && node.style.backgroundColor !== 'transparent'
        ? node.style.backgroundColor
        : '#eff6ff';
      parts.push(`<g${rotTransform}>`);
      parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${escapeXml(zBg)}" fill-opacity="0.32" stroke="${escapeXml(zBorder)}" stroke-width="1.5" stroke-dasharray="6 4" />`);
      parts.push(`<text x="${node.x + 10}" y="${node.y + 18}" fill="${escapeXml(zBorder)}" font-size="10.5" font-weight="700">${escapeXml(node.label)}</text>`);
      parts.push(`</g>`);
      continue;
    }

    if (node.type === 'wall') {
      const wallBg = node.style?.backgroundColor || (dark ? '#475569' : '#64748b');
      const wallBorder = node.style?.borderColor || (dark ? '#94a3b8' : '#334155');
      parts.push(`<g${rotTransform}>`);
      parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="2" fill="${escapeXml(wallBg)}" stroke="${escapeXml(wallBorder)}" stroke-width="1.5" />`);
      if (!hideLabels && node.label) {
        parts.push(`<text class="svg-label-muted" x="${cx}" y="${node.y + node.height + 12}" text-anchor="middle" fill="${textMuted}" font-size="9.5" font-weight="600">${escapeXml(node.label)}</text>`);
      }
      parts.push(`</g>`);
      continue;
    }

    const rawBg = node.style?.backgroundColor || '#1d4ed8';
    const useEnterpriseCard = !node.style?.shape && isStandardCatalogNodeColor(rawBg);
    const categoryAccent = getCategoryAccentColor(asset?.category || node.type);
    const bgColor = useEnterpriseCard ? (dark ? '#1e293b' : '#ffffff') : rawBg;
    const borderColor = useEnterpriseCard
      ? (dark ? '#334155' : '#cbd5e1')
      : (node.style?.borderColor || '#334155');
    const radius = node.style?.shape === 'circle'
      ? Math.max(node.width, node.height) / 2
      : node.style?.shape === 'rect'
      ? 2
      : 8;

    const isDirectional =
      Boolean(resolveCameraFov(node, asset)) ||
      Boolean(resolveWifiCoverage(node, asset)?.isDirectional);
    const sx = !isDirectional && node.flipX ? -1 : 1;
    const sy = !isDirectional && node.flipY ? -1 : 1;
    const mirrorTransform =
      sx !== 1 || sy !== 1
        ? ` transform="translate(${cx}, ${cy}) scale(${sx}, ${sy}) translate(${-cx}, ${-cy})"`
        : '';

    parts.push(`<g data-layer="device">`);
    parts.push(`<g${rotTransform}>`);
    parts.push(`<rect${useEnterpriseCard ? ' class="svg-card-neutral"' : ''} x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${radius}" fill="${escapeXml(bgColor)}" stroke="${escapeXml(borderColor)}" stroke-width="${useEnterpriseCard ? 1.4 : (node.style?.borderWidth || 2)}" />`);

    // Status Dot (mirrored along flipX/flipY when non-directional)
    const dotPadX = node.style?.shape === 'circle' ? Math.max(12, node.width * 0.16) : 8;
    const dotPadY = node.style?.shape === 'circle' ? Math.max(10, node.height * 0.16) : 8;
    const dotCx = sx < 0 ? node.x + dotPadX : node.x + node.width - dotPadX;
    const dotCy = sy < 0 ? node.y + node.height - dotPadY : node.y + dotPadY;
    const statusFill = !asset || asset.status === 'online' ? '#16a34a' : asset.status === 'standby' ? '#f59e0b' : '#dc2626';
    parts.push(`<circle cx="${dotCx.toFixed(1)}" cy="${dotCy.toFixed(1)}" r="2.8" fill="${statusFill}" />`);

    const imgUrl = sanitizeSafeImageUrl(node.customImageUrl || asset?.customImageUrl);
    const iconTag = node.customIcon || asset?.customIcon;
    const badgeSize = Math.min(36, Math.max(20, Math.min(node.width, node.height) * 0.62));
    const brandDef = iconTag ? BRAND_LOGO_MAP[iconTag] : undefined;

    if (imgUrl) {
      const imgSize = Math.min(node.width, node.height) * 0.66;
      if (mirrorTransform) parts.push(`<g data-mirror="${sx},${sy}"${mirrorTransform}>`);
      parts.push(`<image href="${escapeXml(imgUrl)}" x="${cx - imgSize / 2}" y="${cy - imgSize / 2}" width="${imgSize}" height="${imgSize}" preserveAspectRatio="xMidYMid meet" />`);
      if (mirrorTransform) parts.push(`</g>`);
    } else if (brandDef) {
      const bx = cx - badgeSize / 2;
      const by = cy - badgeSize / 2;
      const fs = brandDef.shortCode.length >= 5 ? '7' : brandDef.shortCode.length >= 4 ? '8' : '9.5';
      parts.push(`<rect x="${bx}" y="${by}" width="${badgeSize}" height="${badgeSize}" rx="6" fill="${brandDef.bgColor}" stroke="${brandDef.accentColor}" stroke-width="1.4" />`);
      parts.push(`<text x="${cx}" y="${cy + 3.2}" text-anchor="middle" fill="${brandDef.accentColor}" font-size="${fs}" font-weight="800">${escapeXml(brandDef.shortCode)}</text>`);
    } else if (iconTag && iconTag.startsWith('iso_')) {
      const s = Math.min(node.width, node.height) * 0.28;
      const isoTag = iconTag.replace(/^iso_/, '').slice(0, 6).toUpperCase();
      if (mirrorTransform) parts.push(`<g data-mirror="${sx},${sy}"${mirrorTransform}>`);
      parts.push(`<polygon points="${cx},${cy - s} ${cx + s * 1.15},${cy - s * 0.35} ${cx},${cy + s * 0.3} ${cx - s * 1.15},${cy - s * 0.35}" fill="#f8fafc" fill-opacity="0.92" stroke="#0f172a" stroke-width="1.2" />`);
      parts.push(`<polygon points="${cx - s * 1.15},${cy - s * 0.35} ${cx},${cy + s * 0.3} ${cx},${cy + s * 1.05} ${cx - s * 1.15},${cy + s * 0.4}" fill="#cbd5e1" stroke="#0f172a" stroke-width="1.2" />`);
      parts.push(`<polygon points="${cx + s * 1.15},${cy - s * 0.35} ${cx},${cy + s * 0.3} ${cx},${cy + s * 1.05} ${cx + s * 1.15},${cy + s * 0.4}" fill="#94a3b8" stroke="#0f172a" stroke-width="1.2" />`);
      if (mirrorTransform) parts.push(`</g>`);
      parts.push(`<text x="${cx}" y="${cy + s * 0.1}" text-anchor="middle" fill="#0f172a" font-size="6.5" font-weight="800">${escapeXml(isoTag)}</text>`);
    } else if (useEnterpriseCard) {
      parts.push(`<rect x="${cx - badgeSize / 2}" y="${cy - badgeSize / 2}" width="${badgeSize}" height="${badgeSize}" rx="7" fill="${escapeXml(categoryAccent)}" />`);
      if (mirrorTransform) parts.push(`<g data-mirror="${sx},${sy}"${mirrorTransform}>`);
      parts.push(renderPureSvgCategoryGlyph(asset?.category || node.type, cx, cy, badgeSize, '#ffffff'));
      if (mirrorTransform) parts.push(`</g>`);
    } else {
      parts.push(`<rect x="${cx - badgeSize / 2}" y="${cy - badgeSize / 2}" width="${badgeSize}" height="${badgeSize}" rx="7" fill="rgba(0,0,0,0.24)" />`);
      if (mirrorTransform) parts.push(`<g data-mirror="${sx},${sy}"${mirrorTransform}>`);
      parts.push(renderPureSvgCategoryGlyph(asset?.category || node.type, cx, cy, badgeSize, node.style?.iconColor || '#ffffff'));
      if (mirrorTransform) parts.push(`</g>`);
    }
    parts.push(`</g>`);

    if (!hideLabels) {
      const labelText = asset?.name || node.label;
      parts.push(`<text class="svg-label-primary" x="${cx}" y="${node.y + node.height + 14}" text-anchor="middle" fill="${textPrimary}" font-size="11" font-weight="700">${escapeXml(labelText)}</text>`);
      if (project.settings.showIpAddresses && (asset?.ipAddress || asset?.vlan)) {
        const ipVlan = [
          asset?.ipAddress || '',
          asset?.vlan ? `V${String(asset.vlan).split(',')[0].trim()}` : ''
        ]
          .filter(Boolean)
          .join(' · ');
        const pillW = Math.max(54, Math.min(180, ipVlan.length * 5.6 + 12));
        parts.push(`<rect class="svg-ip-pill" x="${(cx - pillW / 2).toFixed(1)}" y="${node.y + node.height + 18}" width="${pillW.toFixed(1)}" height="14" rx="3" fill="${dark ? '#0f172a' : '#f1f5f9'}" stroke="${dark ? '#334155' : '#e2e8f0'}" stroke-width="0.7" />`);
        parts.push(`<text class="svg-ip-text" x="${cx}" y="${node.y + node.height + 28}" text-anchor="middle" fill="${textMuted}" font-size="9" font-family="ui-monospace, monospace">${escapeXml(ipVlan)}</text>`);
      }
    }
    parts.push(`</g>`);
  }

  if (options?.includeTitleBlock) {
    const tbW = 340;
    const tbH = 44;
    const tbX = bounds.minX + bounds.width - tbW - 14;
    const tbY = bounds.minY + bounds.height - tbH - 14;
    parts.push(`<rect class="svg-titleblock" x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" rx="4" fill="${dark ? '#0f172a' : '#ffffff'}" fill-opacity="0.95" stroke="#1d4ed8" stroke-width="1.5" />`);
    parts.push(`<text class="svg-titleblock-title" x="${tbX + 10}" y="${tbY + 17}" fill="${dark ? '#93c5fd' : '#1e3a8a'}" font-size="10.5" font-weight="700">${escapeXml(project.name)}</text>`);
    parts.push(`<text class="svg-titleblock-sub" x="${tbX + 10}" y="${tbY + 33}" fill="${dark ? '#94a3b8' : '#475569'}" font-size="9">HACHIHI Designer · ${escapeXml(project.author)} · v${escapeXml(project.version)}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join('\n');
}

/**
 * Generates a pure Vector SVG showing the entire multi-floor building in 2D:
 * - In unified schematic/rack modes (`topology`, `electrical`, `multisite`, `rack`), renders the complete
 *   inter-floor diagram (`floorScopeId: '__ALL__'`).
 * - In floor-based modes (`floorplan`, `cctv`, `wifi`, `fiber`), lays out every floor side-by-side
 *   in a multi-floor architectural sheet so floors with overlapping coordinates remain crystal clear.
 */
export function generateCompositeBuildingSvgMarkup(
  project: ProjectState,
  options?: PureSvgExportOptions
): string {
  const sortedFloors = [...(project.floors || [])].sort((a, b) => a.level - b.level);
  const isFloorBased = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);
  if (sortedFloors.length <= 1 || !isFloorBased) {
    return generatePureSvgMarkup(project, { ...options, floorScopeId: '__ALL__' });
  }

  const whiteBg = Boolean(options?.whiteBackground);
  const appearance = resolveCanvasAppearance(
    whiteBg
      ? {
          ...project.settings,
          backgroundPreset: 'pure_white',
          backgroundColor: '#ffffff',
          backgroundPattern: 'none',
          showGrid: false
        }
      : project.settings,
    whiteBg ? false : options?.darkTheme
  );
  const dark = whiteBg ? false : appearance.isDarkCanvas;
  const bg = whiteBg ? '#ffffff' : appearance.backgroundColor;

  const cols = sortedFloors.length <= 2 ? sortedFloors.length : 2;
  const cardW = 860;
  const headerH = 34;
  const gap = 28;
  const pad = 32;

  const cards = sortedFloors.map(floor => {
    const b = computePureDiagramBounds(project, { floorScopeId: floor.id });
    const aspect = b.height / Math.max(1, b.width);
    const bodyH = Math.max(320, Math.min(680, Math.round(cardW * aspect)));
    const innerSvg = generatePureSvgMarkup(project, {
      ...options,
      floorScopeId: floor.id,
      boundsOverride: b,
      includeTitleBlock: false,
      skipGridPattern: true
    });
    const innerContentMatch = innerSvg.match(/^<svg[^>]*>([\s\S]*)<\/svg>$/);
    const innerContent = innerContentMatch ? innerContentMatch[1] : '';
    const floorNodes = project.nodes.filter(n => !n.hidden && n.floorId === floor.id);
    const floorRacks = floorNodes.filter(n => n.type === 'rack').length;
    return {
      floor,
      bounds: b,
      bodyH,
      totalH: headerH + bodyH,
      innerContent,
      nodeCount: floorNodes.length,
      rackCount: floorRacks
    };
  });

  const rows = Math.ceil(cards.length / cols);
  const rowHeights: number[] = [];
  for (let r = 0; r < rows; r++) {
    let maxH = 0;
    for (let c = 0; c < cols; c++) {
      const card = cards[r * cols + c];
      if (card) maxH = Math.max(maxH, card.totalH);
    }
    rowHeights.push(maxH);
  }

  const totalW = pad * 2 + cols * cardW + Math.max(0, cols - 1) * gap;
  const titleBlockSpace = options?.includeTitleBlock ? 64 : 0;
  const totalH =
    pad * 2 +
    rowHeights.reduce((sum, h) => sum + h, 0) +
    Math.max(0, rows - 1) * gap +
    titleBlockSpace;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`
  );
  parts.push(`<rect class="svg-bg" x="0" y="0" width="${totalW}" height="${totalH}" fill="${escapeXml(bg)}" />`);

  let curY = pad;
  for (let r = 0; r < rows; r++) {
    const rowH = rowHeights[r];
    for (let c = 0; c < cols; c++) {
      const card = cards[r * cols + c];
      if (!card) continue;
      const x = pad + c * (cardW + gap);
      const y = curY;
      parts.push(`<g data-layer="floor-card" data-floor-id="${escapeXml(card.floor.id)}" data-floor-layer="${escapeXml(card.floor.id)}">`);
      parts.push(
        `<rect class="svg-card-neutral" x="${x}" y="${y}" width="${cardW}" height="${card.totalH}" rx="10" fill="${dark ? '#0f172a' : '#ffffff'}" stroke="${dark ? '#334155' : '#cbd5e1'}" stroke-width="1.6" />`
      );
      parts.push(
        `<rect class="svg-room-hdr" x="${x + 1}" y="${y + 1}" width="${cardW - 2}" height="${headerH - 1}" rx="9" fill="${dark ? '#1e293b' : '#e2e8f0'}" />`
      );
      parts.push(
        `<text class="svg-room-title" x="${x + 14}" y="${y + 22}" fill="${dark ? '#f1f5f9' : '#0f172a'}" font-size="13" font-weight="700">${escapeXml(card.floor.name)}</text>`
      );
      parts.push(
        `<text class="svg-label-muted" x="${x + cardW - 14}" y="${y + 22}" text-anchor="end" fill="${dark ? '#94a3b8' : '#475569'}" font-size="11" font-family="ui-monospace, monospace">${card.nodeCount} phần tử · ${card.rackCount} Rack</text>`
      );
      parts.push(
        `<svg x="${x + 2}" y="${y + headerH}" width="${cardW - 4}" height="${card.bodyH - 2}" viewBox="${card.bounds.minX} ${card.bounds.minY} ${card.bounds.width} ${card.bounds.height}" preserveAspectRatio="xMidYMid meet">${card.innerContent}</svg>`
      );
      parts.push(`</g>`);
    }
    curY += rowH + gap;
  }

  if (options?.includeTitleBlock) {
    const tbW = 380;
    const tbH = 44;
    const tbX = totalW - tbW - pad;
    const tbY = totalH - tbH - 12;
    parts.push(`<rect class="svg-titleblock" x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" rx="4" fill="${dark ? '#0f172a' : '#ffffff'}" fill-opacity="0.96" stroke="#1d4ed8" stroke-width="1.5" />`);
    parts.push(`<text class="svg-titleblock-title" x="${tbX + 10}" y="${tbY + 17}" fill="${dark ? '#93c5fd' : '#1e3a8a'}" font-size="10.5" font-weight="700">${escapeXml(project.name)} — Toàn bộ (${sortedFloors.length} tầng)</text>`);
    parts.push(`<text class="svg-titleblock-sub" x="${tbX + 10}" y="${tbY + 33}" fill="${dark ? '#94a3b8' : '#475569'}" font-size="9">HACHIHI Designer · ${escapeXml(project.author)} · v${escapeXml(project.version)}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join('\n');
}

function rasterizeSvgToPngDownload(
  svgMarkup: string,
  bounds: DiagramBounds,
  backgroundColor: string,
  filename: string,
  onSuccess?: () => void,
  onError?: (msg: string) => void
) {
  try {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const urlApi = window.URL || window.webkitURL || window;
    const blobUrl = urlApi.createObjectURL(svgBlob);

    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(2, 4800 / Math.max(1, bounds.width), 3600 / Math.max(1, bounds.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        urlApi.revokeObjectURL(blobUrl);
        onError?.('Trình duyệt không hỗ trợ kết xuất Canvas PNG.');
        return;
      }
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      urlApi.revokeObjectURL(blobUrl);
      onSuccess?.();
    };
    img.onerror = () => {
      urlApi.revokeObjectURL(blobUrl);
      onError?.('Không thể kết xuất hình ảnh PNG từ SVG.');
    };
    img.src = blobUrl;
  } catch (err) {
    onError?.(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Exports pure SVG rasterized to crisp 2x PNG (works reliably without foreignObject tainting).
 */
export function exportProjectToPng(
  project: ProjectState,
  onSuccess: () => void,
  onError: (msg: string) => void
) {
  const bounds = computePureDiagramBounds(project);
  const svgMarkup = generatePureSvgMarkup(project, {
    darkTheme: project.settings.isDarkMode,
    includeTitleBlock: true
  });
  const appearance = resolveCanvasAppearance(project.settings, project.settings.isDarkMode);
  const safeName = project.name.trim().replace(/\s+/g, '_') || 'HACHIHI_Project';
  rasterizeSvgToPngDownload(
    svgMarkup,
    bounds,
    appearance.backgroundColor,
    `${safeName}_HighRes.png`,
    onSuccess,
    onError
  );
}

/**
 * Instantly exports the exact current canvas viewport as a crisp PNG with a default white (#ffffff) background.
 */
export function exportCurrentViewToPng(
  project: ProjectState,
  viewport?: { pan: { x: number; y: number }; zoom: number; viewportSize: { w: number; h: number } },
  options?: { whiteBackground?: boolean; includeTitleBlock?: boolean },
  onSuccess?: () => void,
  onError?: (msg: string) => void
) {
  const whiteBackground = options?.whiteBackground ?? true;
  const bounds =
    (viewport ? computeViewportDiagramBounds(viewport.pan, viewport.zoom, viewport.viewportSize) : undefined) ||
    computePureDiagramBounds(project);
  const svgMarkup = generatePureSvgMarkup(project, {
    darkTheme: whiteBackground ? false : project.settings.isDarkMode,
    includeTitleBlock: options?.includeTitleBlock ?? false,
    boundsOverride: bounds,
    whiteBackground
  });
  const appearance = resolveCanvasAppearance(project.settings, project.settings.isDarkMode);
  const safeName = project.name.trim().replace(/\s+/g, '_') || 'HACHIHI_Project';
  rasterizeSvgToPngDownload(
    svgMarkup,
    bounds,
    whiteBackground ? '#ffffff' : appearance.backgroundColor,
    `${safeName}_QuickView.png`,
    onSuccess,
    onError
  );
}
