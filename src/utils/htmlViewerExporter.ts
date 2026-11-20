import { DesignMode, ProjectState } from '../types/infrastructure';
import { generateCompositeBuildingSvgMarkup, generatePureSvgMarkup } from './svgExport';
import { getDesignModeMeta } from './designModes';
import { APP_BUILD_HASH, APP_PRODUCT_NAME, APP_VERSION, BRAND_INFO } from '../config/appInfo';
import { getHachihiLogoSvgMarkup } from './brandLogoSvg';
import { trackExport } from '../services/tracker';
import {
  scanProjectFloors,
  serializeFloorContext
} from '../services/export/exportService';
import type { ExportFloorScope } from '../services/export/exportTypes';

export type HtmlViewerContentScope = '2d' | '3d' | 'both';

export interface HtmlViewerExportOptions {
  contentScope?: HtmlViewerContentScope;
  background3D?: 'light' | 'dark';
  floorScope?: ExportFloorScope;
  viewer3DRuntimeJs?: string;
}

export async function loadViewer3DRuntimeJs(): Promise<string> {
  const mod = await import('./viewer3dRuntimeBundle');
  return mod.loadViewer3DRuntimeJs();
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeEmbedJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildViewerProjectPayload(
  project: ProjectState,
  options?: HtmlViewerExportOptions
): Record<string, unknown> {
  const settingsCopy = { ...(project.settings || {}) } as Record<string, unknown>;
  delete settingsCopy.backgroundImageDataUrl;
  if (options?.background3D) {
    settingsCopy.isDarkMode = options.background3D === 'dark';
  }

  const sanitizedNodes = (project.nodes || []).map(node => {
    if (!node.customData) return node;
    const customCopy = { ...(node.customData as Record<string, unknown>) };
    delete customCopy.image;
    delete customCopy.dataUrl;
    return {
      ...node,
      customData: customCopy
    };
  });

  return {
    id: project.id,
    name: project.name,
    author: project.author,
    version: project.version,
    schemaVersion: project.schemaVersion,
    lastModified: project.lastModified,
    activeMode: project.activeMode,
    activeBuildingId: project.activeBuildingId,
    activeFloorId: project.activeFloorId,
    settings: settingsCopy,
    buildings: project.buildings || [],
    floors: project.floors || [],
    rooms: project.rooms || [],
    racks: project.racks || [],
    nodes: sanitizedNodes,
    cables: project.cables || [],
    cableTrays: project.cableTrays || [],
    vlans: project.vlans || [],
    subnets: project.subnets || [],
    patchLinks: project.patchLinks || [],
    assets: project.assets || {}
  };
}

/**
 * Exports a self-contained, zero-dependency interactive HTML Viewer (.html)
 * supporting full 360° 3D WebGL orbit rotation (horizontal & vertical), multi-direction camera presets,
 * floor cutaway/explode controls, click-to-inspect 3D elements, plus 2D CAD SVG pan/zoom and searchable BOM tables offline.
 */
export function generateStandaloneViewerHtml(
  project: ProjectState,
  options?: HtmlViewerExportOptions
): string {
  const contentScope: HtmlViewerContentScope = options?.contentScope ?? 'both';
  const startIn3D = contentScope !== '2d';
  const assets = Object.values(project.assets);
  const viewerPayload = buildViewerProjectPayload(project, options);
  const floorScopeReq: ExportFloorScope = options?.floorScope ?? 'all';
  const floorMetadata = scanProjectFloors(project, floorScopeReq);
  const floorContextPayload = serializeFloorContext(project, floorScopeReq);
  const embeddedProjectJson = safeEmbedJson(viewerPayload);
  const embeddedFloorContextJson = safeEmbedJson(floorContextPayload);
  const isFloorBasedMode = floorMetadata.isFloorBasedMode;
  const sortedFloors = [...project.floors].sort((a, b) => a.level - b.level);
  const hasMultiFloors = floorMetadata.hasMultipleFloors;
  const defaultFloor2d = hasMultiFloors
    ? options?.floorScope && floorMetadata.resolvedFloorId !== '__ALL__'
      ? floorMetadata.resolvedFloorId
      : isFloorBasedMode && sortedFloors.some(f => f.id === project.activeFloorId)
        ? project.activeFloorId
        : '__ALL__'
    : '__SINGLE__';
  const defaultFloor3d = hasMultiFloors
    ? options?.floorScope && floorMetadata.resolvedFloorId !== '__ALL__'
      ? floorMetadata.resolvedFloorId
      : '__ALL__'
    : '__SINGLE__';

  // Collect distinct 2D diagram modes available for this project so HTML viewer isn't stuck on 1 mode
  const view2dModes: DesignMode[] = [project.activeMode];
  if (project.activeMode !== 'floorplan' && (hasMultiFloors || project.rooms.length > 0)) {
    view2dModes.push('floorplan');
  }
  if (project.activeMode !== 'topology' && project.nodes.length > 0) {
    view2dModes.push('topology');
  }
  if (project.activeMode !== 'rack' && project.racks.length > 0) {
    view2dModes.push('rack');
  }

  const mode2dOptionsHtml =
    view2dModes.length > 1
      ? view2dModes
          .map(modeId => {
            const meta = getDesignModeMeta(modeId);
            const sel = modeId === project.activeMode ? ' selected' : '';
            return `<option value="${escapeHtml(modeId)}"${sel}>${escapeHtml(meta.label)}</option>`;
          })
          .join('')
      : '';

  const floorOptionsHtml = hasMultiFloors
    ? [
        `<option value="__ALL__"${defaultFloor3d === '__ALL__' ? ' selected' : ''}>Toàn bộ tòa nhà (${sortedFloors.length} tầng)</option>`,
        ...sortedFloors.map(f => {
          const sel = f.id === defaultFloor3d ? ' selected' : '';
          return `<option value="${escapeHtml(f.id)}"${sel}>${escapeHtml(f.name)}</option>`;
        })
      ].join('')
    : '';

  const floor2dOptionsHtml = hasMultiFloors
    ? [
        `<option value="__ALL__"${defaultFloor2d === '__ALL__' ? ' selected' : ''}>Toàn bộ tòa nhà (${sortedFloors.length} tầng)</option>`,
        ...sortedFloors.map(f => {
          const sel = f.id === defaultFloor2d ? ' selected' : '';
          return `<option value="${escapeHtml(f.id)}"${sel}>${escapeHtml(f.name)}</option>`;
        })
      ].join('')
    : '';

  let initialSvgMarkup = '';
  const view2dTemplates: string[] = [];
  for (const modeId of view2dModes) {
    const modeProject: ProjectState =
      modeId === project.activeMode ? project : { ...project, activeMode: modeId };
    if (hasMultiFloors) {
      const allSvg = generateCompositeBuildingSvgMarkup(modeProject, {
        darkTheme: false,
        includeTitleBlock: true
      });
      if (modeId === project.activeMode && defaultFloor2d === '__ALL__') {
        initialSvgMarkup = allSvg;
      }
      view2dTemplates.push(
        `<template data-view2d-mode="${escapeHtml(modeId)}" data-floor2d-id="__ALL__">${allSvg}</template>`
      );

      for (const f of sortedFloors) {
        const floorSvg = generatePureSvgMarkup(
          { ...modeProject, activeFloorId: f.id },
          { darkTheme: false, includeTitleBlock: true, floorScopeId: f.id }
        );
        if (modeId === project.activeMode && f.id === defaultFloor2d) {
          initialSvgMarkup = floorSvg;
        }
        view2dTemplates.push(
          `<template data-view2d-mode="${escapeHtml(modeId)}" data-floor2d-id="${escapeHtml(f.id)}">${floorSvg}</template>`
        );
      }
    } else {
      const singleSvg = generatePureSvgMarkup(modeProject, {
        darkTheme: false,
        includeTitleBlock: true
      });
      if (modeId === project.activeMode) {
        initialSvgMarkup = singleSvg;
      }
      view2dTemplates.push(
        `<template data-view2d-mode="${escapeHtml(modeId)}" data-floor2d-id="__SINGLE__">${singleSvg}</template>`
      );
    }
  }
  const svgMarkup =
    initialSvgMarkup ||
    generatePureSvgMarkup(project, { darkTheme: false, includeTitleBlock: true });
  const floor2dTemplatesHtml = view2dTemplates.join('\n');

  const deviceRowsHtml = assets
    .map(
      a => `
    <tr>
      <td><code>${escapeHtml(a.assetTag)}</code></td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${escapeHtml(a.category)}</td>
      <td>${escapeHtml(a.vendor)} ${escapeHtml(a.model)}</td>
      <td><code>${escapeHtml(a.ipAddress || '—')}</code></td>
      <td>${escapeHtml(a.vlan || '—')}</td>
      <td>${a.powerWatts || 0} W</td>
    </tr>`
    )
    .join('');

  const cableRowsHtml = project.cables
    .map(c => {
      const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
      const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
      return `
      <tr>
        <td><code>${escapeHtml(c.cableCode)}</code></td>
        <td>${escapeHtml(src)}</td>
        <td>${escapeHtml(tgt)}</td>
        <td>${escapeHtml(c.cableType)}</td>
        <td>${escapeHtml(c.bandwidth)}</td>
        <td>${c.lengthMeters || 0} m</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; base-uri 'none';" />
  <title>${escapeHtml(project.name)} — HACHIHI Interactive 3D &amp; 2D Viewer</title>
  <style>
    :root {
      --bg-app: #f8fafc;
      --bg-surface: #ffffff;
      --bg-subtle: #f1f5f9;
      --bg-card-hud: rgba(255, 255, 255, 0.94);
      --border-col: #e2e8f0;
      --border-btn: #cbd5e1;
      --text-main: #0f172a;
      --text-muted: #475569;
      --text-accent: #1d4ed8;
      --hdr-bg: #1d4ed8;
      --hdr-border: #1e40af;
      --vp2d-bg: #eef2f6;
      --table-hover: #f8fafc;
      --code-bg: #f1f5f9;
    }
    body.theme-dark {
      --bg-app: #090e1a;
      --bg-surface: #0f172a;
      --bg-subtle: #1e293b;
      --bg-card-hud: rgba(15, 23, 42, 0.94);
      --border-col: #1e293b;
      --border-btn: #334155;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-accent: #60a5fa;
      --hdr-bg: #0f172a;
      --hdr-border: #1e293b;
      --vp2d-bg: #0b1120;
      --table-hover: #1e293b;
      --code-bg: #1e293b;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-app);
      color: var(--text-main);
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      transition: background 0.18s ease, color 0.18s ease;
    }
    header {
      background: var(--hdr-bg);
      border-bottom: 1px solid var(--hdr-border);
      color: #fff;
      padding: 8px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    header h1 { margin: 0; font-size: 14.5px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    header .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255,255,255,0.18);
      letter-spacing: 0.03em;
    }
    header .meta { font-size: 11px; opacity: 0.9; margin-top: 1px; }
    .hdr-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hdr-collapse-btn {
      background: rgba(255,255,255,0.14);
      border: 1px solid rgba(255,255,255,0.28);
      color: #ffffff;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .hdr-collapse-btn:hover { background: rgba(255,255,255,0.25); border-color: rgba(255,255,255,0.45); }
    .collapsed-strip {
      background: var(--hdr-bg);
      border-bottom: 1px solid var(--hdr-border);
      color: #ffffff;
      padding: 3px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 11.5px;
      flex-shrink: 0;
    }
    .toolbar {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-col);
      padding: 6px 12px;
      display: flex;
      gap: 5px;
      align-items: center;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .btn-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    .divider { width: 1px; height: 20px; background: var(--border-col); margin: 0 3px; }
    button, select {
      -webkit-appearance: none;
      appearance: none;
      border: 1px solid var(--border-btn);
      background: var(--bg-surface);
      color: var(--text-main);
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
      font-family: inherit;
      outline: none;
      user-select: none;
      line-height: 1.35;
    }
    select {
      padding-right: 22px;
      background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
      background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50%;
      background-size: 4px 4px, 4px 4px;
      background-repeat: no-repeat;
    }
    button:hover, select:hover { background-color: var(--bg-subtle); border-color: #94a3b8; }
    button:focus-visible, select:focus-visible { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.45); }
    button.active { background: #1d4ed8; color: #ffffff; border-color: #1d4ed8; }
    button.active:hover { background: #1e40af; }
    button.active-teal { background: #0f766e; color: #ffffff; border-color: #0f766e; }
    button.active-amber { background: #d97706; color: #ffffff; border-color: #d97706; }
    .theme-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--bg-subtle);
    }
    body.theme-dark .theme-btn {
      background: #1e293b;
      color: #fde68a;
      border-color: #475569;
    }
    .icon-btn-compact {
      padding: 4px 7px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text-muted);
    }
    .restore-pill {
      position: fixed;
      top: 8px;
      right: 12px;
      z-index: 40;
      background: var(--bg-card-hud);
      color: var(--text-main);
      border: 1px solid var(--border-btn);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.22);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .restore-pill.footer-restore {
      top: auto;
      bottom: 8px;
      right: 12px;
    }
    .spacer { flex: 1 1 12px; }
    main { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; position: relative; }
    .viewport-2d {
      flex: 1 1 0%;
      min-height: 520px;
      overflow: hidden;
      background: var(--vp2d-bg);
      position: relative;
      cursor: grab;
      touch-action: none;
      transition: background 0.18s ease;
    }
    .viewport-2d:active { cursor: grabbing; }
    #stage {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      width: 100%;
      height: 100%;
      will-change: transform;
    }
    #stage svg { width: 100%; height: 100%; display: block; }
    /* Seamless 2D CAD SVG Dark Mode Overrides */
    body.theme-dark #stage svg .svg-bg { fill: #0b1120 !important; }
    body.theme-dark #stage svg .svg-grid-overlay { opacity: 0.24; }
    body.theme-dark #stage svg .svg-room-body { fill: #172033 !important; stroke: #475569 !important; }
    body.theme-dark #stage svg .svg-room-hdr { fill: #263449 !important; }
    body.theme-dark #stage svg .svg-room-title { fill: #e2e8f0 !important; }
    body.theme-dark #stage svg .svg-tray-badge { fill: #0f172a !important; }
    body.theme-dark #stage svg .svg-card-neutral { fill: #1e293b !important; stroke: #475569 !important; }
    body.theme-dark #stage svg .svg-label-primary { fill: #f1f5f9 !important; }
    body.theme-dark #stage svg .svg-label-muted { fill: #94a3b8 !important; }
    body.theme-dark #stage svg .svg-ip-pill { fill: #0f172a !important; stroke: #334155 !important; }
    body.theme-dark #stage svg .svg-ip-text { fill: #cbd5e1 !important; }
    body.theme-dark #stage svg .svg-cable-badge { fill: #0f172a !important; }
    body.theme-dark #stage svg .svg-cable-text { fill: #f1f5f9 !important; }
    body.theme-dark #stage svg .svg-bundle-badge { fill: #0f172a !important; }
    body.theme-dark #stage svg .svg-bundle-text { fill: #93c5fd !important; }
    body.theme-dark #stage svg .svg-legend-bg { fill: #0f172a !important; }
    body.theme-dark #stage svg .svg-legend-div { stroke: #334155 !important; }
    body.theme-dark #stage svg .svg-legend-title { fill: #f1f5f9 !important; }
    body.theme-dark #stage svg .svg-legend-sub { fill: #cbd5e1 !important; }
    body.theme-dark #stage svg .svg-legend-footer-bg { fill: #1e293b !important; }
    body.theme-dark #stage svg .svg-legend-footer-txt { fill: #94a3b8 !important; }
    body.theme-dark #stage svg .svg-titleblock { fill: #0f172a !important; stroke: #3b82f6 !important; }
    body.theme-dark #stage svg .svg-titleblock-title { fill: #93c5fd !important; }
    body.theme-dark #stage svg .svg-titleblock-sub { fill: #94a3b8 !important; }

    .viewport-3d {
      flex: 1 1 0%;
      min-height: 540px;
      position: relative;
      overflow: hidden;
      background: #e8eff7;
      user-select: none;
    }
    .viewport-3d.theme-dark { background: #0b1120; }
    #canvas3dHost {
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
    }
    #labels3dLayer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 5;
    }
    .label-3d-tag {
      position: absolute;
      transform: translate(-50%, -100%);
      background: rgba(15, 23, 42, 0.88);
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.45);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.28);
    }
    .hud-card {
      position: absolute;
      z-index: 10;
      background: var(--bg-card-hud);
      color: var(--text-main);
      border: 1px solid var(--border-btn);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      font-size: 11.5px;
      -webkit-backdrop-filter: blur(6px);
      backdrop-filter: blur(6px);
    }
    .hud-mini-btn {
      padding: 2px 6px;
      font-size: 10.5px;
      border-radius: 5px;
      background: var(--bg-subtle);
      color: var(--text-muted);
      border: 1px solid var(--border-col);
    }
    .hud-icon-btn {
      padding: 1px 6px;
      font-size: 11px;
      line-height: 1.25;
      border-radius: 5px;
      background: var(--bg-subtle);
      color: var(--text-muted);
      border: 1px solid var(--border-col);
    }
    #xyzGizmoPanel {
      top: 10px;
      right: 10px;
      padding: 5px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    #xyzGizmoPanel .gizmo-head {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    #xyzGizmoPanel[data-collapsed="true"] svg { display: none; }
    #xyzGizmoPanel .gizmo-cap { font-size: 9.5px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em; }
    #dockBottomLeft {
      bottom: 12px;
      left: 10px;
      padding: 6px 9px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      max-width: calc(100% - 20px);
    }
    #dockBottomLeft[data-collapsed="true"] .dock-main-controls,
    #dockBottomLeft[data-collapsed="true"] #dockRenderSub { display: none; }
    #dockBottomLeft:not([data-collapsed="true"]) .dock-collapsed-bar { display: none; }
    .dock-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .dock-sub-row {
      padding-top: 5px;
      border-top: 1px dashed var(--border-col);
      width: 100%;
    }
    #dockBottomLeft label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
    }
    #dockBottomLeft input[type="range"] { width: 78px; accent-color: #1d4ed8; cursor: pointer; }
    #dockBottomLeft button, #dockBottomLeft select { padding: 3px 8px; font-size: 11px; }
    #dockBottomLeft select { padding-right: 20px; }
    #inspector3dCard {
      top: 108px;
      right: 10px;
      width: 266px;
      max-height: calc(100% - 170px);
      overflow-y: auto;
      padding: 9px 11px;
    }
    #inspector3dCard[data-collapsed="true"] .insp-body-wrap { display: none; }
    #inspector3dCard .insp-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
      border-bottom: 1px solid var(--border-col);
      padding-bottom: 6px;
      margin-bottom: 7px;
    }
    #inspector3dCard[data-collapsed="true"] .insp-head { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }
    #inspector3dCard .insp-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    #inspector3dCard .insp-title { font-weight: 700; font-size: 12.5px; word-break: break-word; }
    #inspector3dCard .insp-sub { font-size: 10.5px; color: var(--text-muted); margin-top: 2px; }
    #inspector3dCard .insp-close { padding: 2px 7px; font-size: 12px; line-height: 1.2; }
    .insp-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 11px; margin-bottom: 8px; }
    .insp-grid .k { color: var(--text-muted); font-weight: 600; }
    .insp-grid .v { font-weight: 600; word-break: break-word; text-align: right; }
    .insp-u-list {
      margin: 6px 0 8px;
      padding: 6px;
      border-radius: 6px;
      background: rgba(148, 163, 184, 0.14);
      max-height: 140px;
      overflow-y: auto;
      font-size: 10.5px;
    }
    .insp-u-item { display: flex; justify-content: space-between; gap: 6px; padding: 2px 0; border-bottom: 1px dashed rgba(148,163,184,0.28); }
    .insp-u-item:last-child { border-bottom: none; }
    #btnFocusObject { width: 100%; background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    #btnFocusObject:hover { background: #1e40af; }
    #webglFallback {
      position: absolute;
      inset: 0;
      z-index: 25;
      background: rgba(15, 23, 42, 0.96);
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      gap: 10px;
    }
    .webgl-diag-card {
      max-width: 480px;
      width: 100%;
      background: rgba(30, 41, 59, 0.92);
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 12px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    }
    .webgl-diag-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      font-size: 11px;
      color: #cbd5e1;
    }
    .webgl-diag-meta code {
      background: rgba(15, 23, 42, 0.85);
      color: #fbbf24;
      border: 1px solid rgba(251, 191, 36, 0.35);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .webgl-diag-msg {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
      color: #cbd5e1;
      word-break: break-word;
    }
    .webgl-diag-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin-top: 4px;
    }
    .btn-retry-3d {
      background: #1d4ed8;
      color: #ffffff;
      border-color: #2563eb;
      font-weight: 600;
    }
    .btn-retry-3d:hover { background: #1e40af; }
    .btn-fallback-2d {
      background: rgba(51, 65, 85, 0.9);
      color: #f8fafc;
      border-color: #475569;
    }
    .btn-fallback-2d:hover { background: #475569; }
    .tables { max-width: 1280px; width: 100%; margin: 16px auto; padding: 0 20px 40px; overflow-x: auto; }
    .table-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .search-input {
      border: 1px solid var(--border-btn);
      background: var(--bg-surface);
      color: var(--text-main);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      min-width: 240px;
      font-family: inherit;
      outline: none;
    }
    .search-input:focus { border-color: #3b82f6; }
    table { width: 100%; border-collapse: collapse; background: var(--bg-surface); border: 1px solid var(--border-col); margin-top: 8px; font-size: 12px; }
    th, td { border: 1px solid var(--border-col); padding: 8px 10px; text-align: left; }
    th { background: var(--bg-subtle); font-weight: 700; color: var(--text-main); }
    tbody tr:hover { background: var(--table-hover); }
    code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: 11px; font-family: ui-monospace, monospace; }
    footer {
      border-top: 1px solid var(--border-col);
      background: var(--bg-surface);
      padding: 6px 16px;
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      flex-shrink: 0;
    }
    .hidden { display: none !important; }
    @media (max-width: 768px) {
      #inspector3dCard { width: calc(100% - 20px); top: auto; bottom: 68px; max-height: 40vh; }
    }
  </style>
</head>
<body>
  <header id="appHeader">
    <div style="display:flex;align-items:center;gap:10px;min-width:0;">
      ${getHachihiLogoSvgMarkup(28, 'light', 'viewer_hdr')}
      <div style="min-width:0;">
        <h1>
          <span>${escapeHtml(project.name)}</span>
          <span class="badge">3D / 2D OFFLINE VIEWER</span>
        </h1>
        <div class="meta">HACHIHI Infrastructure Viewer · Tác giả: ${escapeHtml(project.author)} · Phiên bản: ${escapeHtml(project.version)}</div>
      </div>
    </div>
    <div class="hdr-right">
      <div class="meta">${assets.length} Thiết bị · ${project.racks.length} Tủ Rack · ${project.cables.length} Tuyến cáp · ${project.floors.length} Tầng</div>
      <button type="button" id="btnToggleHeader" class="hdr-collapse-btn" title="Thu gọn thanh tiêu đề">Thu gọn ▴</button>
    </div>
  </header>

  <div id="headerCollapsedBar" class="collapsed-strip hidden">
    <span style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(project.name)}</span>
    <button type="button" id="btnExpandHeader" class="hdr-collapse-btn" title="Mở rộng thanh tiêu đề">Mở tiêu đề ▾</button>
  </div>

  <div id="mainToolbar" class="toolbar">
    <div id="controls3dGroup" class="btn-group${startIn3D ? '' : ' hidden'}">
      <button type="button" data-preset="iso" class="preset-btn active" title="Góc nhìn Isometric (Phím 1)">Isometric</button>
      <button type="button" data-preset="top" class="preset-btn" title="Chiếu bằng từ trên xuống (Phím 2)">Trên xuống</button>
      <button type="button" data-preset="front" class="preset-btn" title="Nhìn trực diện (Phím 3)">Trực diện</button>
      <button type="button" data-preset="back" class="preset-btn" title="Nhìn từ mặt sau (Phím 4)">Mặt sau</button>
      <button type="button" data-preset="left" class="preset-btn" title="Nhìn từ bên trái (Phím 5)">Bên trái</button>
      <button type="button" data-preset="right" class="preset-btn" title="Nhìn từ bên phải (Phím 6)">Bên phải</button>
      <button type="button" data-preset="backIso" class="preset-btn" title="Góc chéo phía sau (Phím 7)">Chéo sau</button>
      <span class="divider"></span>
      <button type="button" id="btnAutoRotate" title="Tự động xoay ngang 360° (Phím R)">Xoay 360°</button>
      <button type="button" id="btn3dZoomIn" title="Phóng to">+</button>
      <button type="button" id="btn3dZoomOut" title="Thu nhỏ">-</button>
      <button type="button" id="btn3dFit" title="Đưa toàn bộ công trình vào giữa khung hình (Phím F)">Vừa khung</button>
    </div>

    <div id="controls2dGroup" class="btn-group${startIn3D ? ' hidden' : ''}">
      ${mode2dOptionsHtml ? `<select id="selMode2d" title="Chọn chế độ bản vẽ 2D">${mode2dOptionsHtml}</select>` : ''}
      ${floor2dOptionsHtml ? `<select id="selFloor2d" title="Chọn tầng hiển thị trong Sơ đồ 2D">${floor2dOptionsHtml}</select>` : ''}
      <button type="button" id="btnZoomIn">Phóng to (+)</button>
      <button type="button" id="btnZoomOut">Thu nhỏ (-)</button>
      <button type="button" id="btnReset">Vừa màn hình</button>
    </div>

    <span class="spacer"></span>

    <div class="btn-group">
      <button type="button" id="tab3D" class="${startIn3D ? 'active' : ''}">Không gian 3D</button>
      <button type="button" id="tabDiag" class="${startIn3D ? '' : 'active'}">Sơ đồ 2D</button>
      <button type="button" id="tabDevices">Thiết bị (${assets.length})</button>
      <button type="button" id="tabCables">Cáp nối (${project.cables.length})</button>
      <span class="divider"></span>
      <button type="button" id="btn3dTheme" class="theme-btn" title="Chuyển đổi giao diện Sáng / Tối toàn cục">
        <svg id="iconThemeSun" class="hidden" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
        <svg id="iconThemeMoon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        <span id="lblThemeToggle">Nền tối</span>
      </button>
      <button type="button" id="btnToggleToolbar" class="icon-btn-compact" title="Thu gọn thanh công cụ để xem toàn màn hình">▴</button>
    </div>
  </div>

  <button type="button" id="toolbarRestorePill" class="restore-pill hidden" title="Mở lại thanh công cụ">Mở công cụ ▾</button>

  <main>
    <div id="view3D" class="viewport-3d${startIn3D ? '' : ' hidden'}">
      <div id="canvas3dHost"></div>
      <div id="labels3dLayer" class="hidden"></div>

      <div id="xyzGizmoPanel" class="hud-card" data-collapsed="false" title="Trục tọa độ XYZ (Nhấp X/Y/Z để chuyển hướng camera)">
        <div class="gizmo-head">
          <span class="gizmo-cap">XYZ</span>
          <button type="button" id="btnToggleGizmo" class="hud-icon-btn" title="Thu gọn / Mở rộng la bàn XYZ">−</button>
        </div>
        <svg width="76" height="76" viewBox="0 0 76 76" style="overflow:visible">
          <circle cx="38" cy="38" r="30" fill="none" stroke="rgba(148,163,184,0.28)" stroke-width="1" />
          <g id="gizmoLayer">
            <g id="gizmoX" style="cursor:pointer">
              <line id="gizmoNegX" x1="38" y1="38" x2="26" y2="38" stroke="#ef4444" stroke-opacity="0.35" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" />
              <line id="gizmoPosX" x1="38" y1="38" x2="60" y2="38" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round" />
              <circle id="gizmoDotX" cx="60" cy="38" r="2.8" fill="#ef4444" />
              <text id="gizmoTxtX" x="68" y="41" fill="#ef4444" font-size="10" font-weight="700" text-anchor="middle">X</text>
            </g>
            <g id="gizmoY" style="cursor:pointer">
              <line id="gizmoNegY" x1="38" y1="38" x2="38" y2="50" stroke="#22c55e" stroke-opacity="0.35" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" />
              <line id="gizmoPosY" x1="38" y1="38" x2="38" y2="16" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" />
              <circle id="gizmoDotY" cx="38" cy="16" r="2.8" fill="#22c55e" />
              <text id="gizmoTxtY" x="38" y="10" fill="#22c55e" font-size="10" font-weight="700" text-anchor="middle">Y</text>
            </g>
            <g id="gizmoZ" style="cursor:pointer">
              <line id="gizmoNegZ" x1="38" y1="38" x2="46" y2="29" stroke="#3b82f6" stroke-opacity="0.35" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" />
              <line id="gizmoPosZ" x1="38" y1="38" x2="24" y2="53" stroke="#3b82f6" stroke-width="2.4" stroke-linecap="round" />
              <circle id="gizmoDotZ" cx="24" cy="53" r="2.8" fill="#3b82f6" />
              <text id="gizmoTxtZ" x="18" y="61" fill="#3b82f6" font-size="10" font-weight="700" text-anchor="middle">Z</text>
            </g>
          </g>
          <circle cx="38" cy="38" r="2.8" fill="#64748b" />
        </svg>
      </div>

      <div id="inspector3dCard" class="hud-card hidden" data-collapsed="false">
        <div class="insp-head">
          <div style="min-width:0;">
            <div id="inspTitle" class="insp-title">Đối tượng</div>
            <div id="inspSub" class="insp-sub">Chi tiết kỹ thuật</div>
          </div>
          <div class="insp-actions">
            <button type="button" id="inspCollapse" class="hud-icon-btn" title="Thu gọn / Mở rộng chi tiết">−</button>
            <button type="button" id="inspClose" class="insp-close" title="Đóng bảng chi tiết">×</button>
          </div>
        </div>
        <div class="insp-body-wrap">
          <div id="inspBody"></div>
          <button type="button" id="btnFocusObject">Hướng camera vào đây</button>
        </div>
      </div>

      <div id="dockBottomLeft" class="hud-card" data-collapsed="false">
        <div class="dock-collapsed-bar">
          <button type="button" id="btnExpandDock" class="active" title="Mở bảng điều khiển 3D">Điều khiển 3D ▴</button>
        </div>
        <div class="dock-row dock-main-controls">
          ${floorOptionsHtml ? `<label>Tầng: <select id="selFloor3d">${floorOptionsHtml}</select></label>` : ''}
          <label title="Điều chỉnh khoảng cách giãn tầng / lớp 3D">
            <span>Giãn tầng:</span>
            <input type="range" id="rngExplode3d" min="0" max="2" step="0.1" value="0" />
            <span id="valExplode3d">0.0</span>
          </label>
          <button type="button" id="togRooms3d" class="active">Phòng &amp; Tường</button>
          <button type="button" id="togCables3d" class="active">Dây cáp 3D</button>
          <button type="button" id="togAxes3d" class="active">Trục XYZ</button>
          <button type="button" id="togLabels3d">Nhãn tên</button>
          <button type="button" id="btnToggleRender3d" title="Tùy chọn hiển thị: Khung dây, Chất lượng, Bóng đổ, Nhiệt 3D">Hiển thị ▾</button>
          <button type="button" id="btnCollapseDock" class="hud-mini-btn" title="Thu gọn thanh điều khiển 3D">Thu gọn ▾</button>
        </div>
        <div id="dockRenderSub" class="dock-row dock-sub-row hidden">
          <button type="button" id="togWireframe3d" title="Bật/tắt chế độ khung dây (Phím W)">Khung dây</button>
          <span style="font-size:10.5px;color:var(--text-muted);font-weight:600;">Chất lượng:</span>
          <button type="button" id="qualLow3d" class="qual-btn" data-qual="low">Thấp</button>
          <button type="button" id="qualMed3d" class="qual-btn" data-qual="medium">TB</button>
          <button type="button" id="qualHigh3d" class="qual-btn active" data-qual="high">Cao</button>
          <button type="button" id="togShadows3d" class="active-amber">Bóng đổ</button>
          <button type="button" id="togThermal3d" class="active-teal">Nhiệt 3D</button>
        </div>
      </div>

      <div id="webglFallback" class="hidden" role="alert" aria-live="polite">
        <div class="webgl-diag-card">
          <strong id="webglFallbackTitle">Không thể khởi tạo khung hình 3D WebGL</strong>
          <div class="webgl-diag-meta">
            <span>Bước: <code id="webglErrorStep">—</code></span>
            <span>Mã: <code id="webglErrorCode">—</code></span>
          </div>
          <p id="webglErrorMsg" class="webgl-diag-msg">Vui lòng thử khởi tạo lại 3D hoặc chuyển sang tab Sơ đồ 2D để xem bản vẽ CAD.</p>
          <div class="webgl-diag-actions">
            <button type="button" id="btnRetry3D" class="btn-retry-3d">Thử lại 3D</button>
            <button type="button" id="btnFallback2D" class="btn-fallback-2d">Mở Sơ đồ 2D</button>
          </div>
        </div>
      </div>
    </div>

    <div id="viewDiag" class="viewport-2d${startIn3D ? ' hidden' : ''}">
      <div id="stage">${svgMarkup}</div>
    </div>
    ${floor2dTemplatesHtml}

    <div id="viewDevices" class="tables hidden">
      <div class="table-bar">
        <h2 style="margin:0;font-size:16px;">Danh sách Thiết bị (${assets.length})</h2>
        <input id="filterDevices" class="search-input" type="search" placeholder="Tìm theo tên, mã TS, IP, model..." />
      </div>
      <table>
        <thead><tr><th>Mã TS</th><th>Tên</th><th>Loại</th><th>Model</th><th>IP</th><th>VLAN</th><th>Công suất</th></tr></thead>
        <tbody id="tbodyDevices">${deviceRowsHtml}</tbody>
      </table>
    </div>

    <div id="viewCables" class="tables hidden">
      <div class="table-bar">
        <h2 style="margin:0;font-size:16px;">Danh bạ Đấu nối Cáp (${project.cables.length})</h2>
        <input id="filterCables" class="search-input" type="search" placeholder="Tìm theo mã cáp, thiết bị nguồn/đích..." />
      </div>
      <table>
        <thead><tr><th>Mã cáp</th><th>Nguồn</th><th>Đích</th><th>Loại cáp</th><th>Băng thông</th><th>Dài (m)</th></tr></thead>
        <tbody id="tbodyCables">${cableRowsHtml}</tbody>
      </table>
    </div>
  </main>

  <footer id="appFooter">
    <span>${escapeHtml(APP_PRODUCT_NAME)} · Phiên bản ${escapeHtml(APP_VERSION)} (${escapeHtml(APP_BUILD_HASH)})</span>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span>${escapeHtml(BRAND_INFO.websiteLabel)} · Hotline: ${escapeHtml(BRAND_INFO.hotlineDisplay)}</span>
      <button type="button" id="btnToggleFooter" class="hud-mini-btn" title="Thu gọn thanh chân trang">Thu gọn ▾</button>
    </div>
  </footer>
  <button type="button" id="footerRestorePill" class="restore-pill footer-restore hidden" title="Hiển thị lại thanh chân trang">Thông tin ▴</button>

  <script type="application/json" id="hachihi-project-data">${embeddedProjectJson}</script>
  <script type="application/json" id="hachihi-floor-metadata">${embeddedFloorContextJson}</script>
  <script>${options?.viewer3DRuntimeJs ?? ''}</script>
  <script>
    (function(){
      var dataEl = document.getElementById('hachihi-project-data');
      var floorMetaEl = document.getElementById('hachihi-floor-metadata');
      var baseProject = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
      var floorContext = floorMetaEl ? JSON.parse(floorMetaEl.textContent || '{}') : {};
      window.HachihiProjectData = Object.assign({}, baseProject, floorContext);
      var startIn3D = ${startIn3D ? 'true' : 'false'};
      var view3dEl = document.getElementById('view3D');

      var globalState = {
        isDark: Boolean(baseProject.settings && baseProject.settings.isDarkMode)
      };

      var onThemeChanged = null;
      function syncGlobalTheme(){
        document.body.classList.toggle('theme-dark', globalState.isDark);
        if(view3dEl) view3dEl.classList.toggle('theme-dark', globalState.isDark);
        var lbl = document.getElementById('lblThemeToggle');
        var sun = document.getElementById('iconThemeSun');
        var moon = document.getElementById('iconThemeMoon');
        if(lbl) lbl.textContent = globalState.isDark ? 'Chế độ sáng' : 'Chế độ tối';
        if(sun) sun.classList.toggle('hidden', !globalState.isDark);
        if(moon) moon.classList.toggle('hidden', globalState.isDark);
        if(onThemeChanged) onThemeChanged(globalState.isDark);
      }
      syncGlobalTheme();

      var btnTheme = document.getElementById('btn3dTheme');
      if(btnTheme){
        btnTheme.onclick = function(){
          globalState.isDark = !globalState.isDark;
          syncGlobalTheme();
        };
      }

      // --- Collapsible Global Bars (Header, Toolbar, Footer, HUDs) ---
      var viewer3d = null;
      function triggerResize(){
        if(viewer3d) viewer3d.resize();
      }
      var appHeader = document.getElementById('appHeader');
      var headerCollapsedBar = document.getElementById('headerCollapsedBar');
      var btnToggleHeader = document.getElementById('btnToggleHeader');
      var btnExpandHeader = document.getElementById('btnExpandHeader');
      if(btnToggleHeader){
        btnToggleHeader.onclick = function(){
          appHeader.classList.add('hidden');
          headerCollapsedBar.classList.remove('hidden');
          triggerResize();
        };
      }
      if(btnExpandHeader){
        btnExpandHeader.onclick = function(){
          headerCollapsedBar.classList.add('hidden');
          appHeader.classList.remove('hidden');
          triggerResize();
        };
      }

      var mainToolbar = document.getElementById('mainToolbar');
      var toolbarRestorePill = document.getElementById('toolbarRestorePill');
      var btnToggleToolbar = document.getElementById('btnToggleToolbar');
      if(btnToggleToolbar){
        btnToggleToolbar.onclick = function(){
          mainToolbar.classList.add('hidden');
          toolbarRestorePill.classList.remove('hidden');
          triggerResize();
        };
      }
      if(toolbarRestorePill){
        toolbarRestorePill.onclick = function(){
          toolbarRestorePill.classList.add('hidden');
          mainToolbar.classList.remove('hidden');
          triggerResize();
        };
      }

      var appFooter = document.getElementById('appFooter');
      var footerRestorePill = document.getElementById('footerRestorePill');
      var btnToggleFooter = document.getElementById('btnToggleFooter');
      if(btnToggleFooter){
        btnToggleFooter.onclick = function(){
          appFooter.classList.add('hidden');
          footerRestorePill.classList.remove('hidden');
          triggerResize();
        };
      }
      if(footerRestorePill){
        footerRestorePill.onclick = function(){
          footerRestorePill.classList.add('hidden');
          appFooter.classList.remove('hidden');
          triggerResize();
        };
      }

      var xyzGizmoPanel = document.getElementById('xyzGizmoPanel');
      var btnToggleGizmo = document.getElementById('btnToggleGizmo');
      if(xyzGizmoPanel && btnToggleGizmo){
        btnToggleGizmo.onclick = function(){
          var nextCol = xyzGizmoPanel.getAttribute('data-collapsed') !== 'true';
          xyzGizmoPanel.setAttribute('data-collapsed', nextCol ? 'true' : 'false');
          btnToggleGizmo.textContent = nextCol ? '+' : '−';
        };
      }

      var dockBottomLeft = document.getElementById('dockBottomLeft');
      var btnCollapseDock = document.getElementById('btnCollapseDock');
      var btnExpandDock = document.getElementById('btnExpandDock');
      if(dockBottomLeft && btnCollapseDock && btnExpandDock){
        btnCollapseDock.onclick = function(){ dockBottomLeft.setAttribute('data-collapsed', 'true'); };
        btnExpandDock.onclick = function(){ dockBottomLeft.setAttribute('data-collapsed', 'false'); };
      }

      var btnToggleRender3d = document.getElementById('btnToggleRender3d');
      var dockRenderSub = document.getElementById('dockRenderSub');
      if(btnToggleRender3d && dockRenderSub){
        btnToggleRender3d.onclick = function(){
          var hiddenNow = dockRenderSub.classList.toggle('hidden');
          btnToggleRender3d.textContent = hiddenNow ? 'Hiển thị ▾' : 'Hiển thị ▴';
          btnToggleRender3d.classList.toggle('active', !hiddenNow);
        };
      }

      var inspCardEl = document.getElementById('inspector3dCard');
      var inspCollapseBtn = document.getElementById('inspCollapse');
      if(inspCardEl && inspCollapseBtn){
        inspCollapseBtn.onclick = function(){
          var nextCol = inspCardEl.getAttribute('data-collapsed') !== 'true';
          inspCardEl.setAttribute('data-collapsed', nextCol ? 'true' : 'false');
          inspCollapseBtn.textContent = nextCol ? '+' : '−';
        };
      }

      // --- 2D Pan, Zoom (Pointer-Anchored) & Multi-Floor Switch ---
      var stage = document.getElementById('stage');
      var vp2d = document.getElementById('viewDiag');
      var scale = 1, tx = 0, ty = 0, dragging2d = false, sx = 0, sy = 0;
      function apply2d(){ stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
      function zoom2dAt(factor, clientX, clientY){
        var rect = vp2d.getBoundingClientRect();
        var px = (typeof clientX === 'number' ? clientX : rect.left + rect.width / 2) - rect.left;
        var py = (typeof clientY === 'number' ? clientY : rect.top + rect.height / 2) - rect.top;
        var nextScale = Math.min(8, Math.max(0.25, scale * factor));
        var ratio = nextScale / scale;
        tx = px - (px - tx) * ratio;
        ty = py - (py - ty) * ratio;
        scale = nextScale;
        apply2d();
      }
      vp2d.addEventListener('pointerdown', function(e){
        if(e.button !== 0 && e.pointerType === 'mouse') return;
        dragging2d = true;
        sx = e.clientX - tx;
        sy = e.clientY - ty;
      });
      window.addEventListener('pointermove', function(e){
        if(!dragging2d) return;
        tx = e.clientX - sx;
        ty = e.clientY - sy;
        apply2d();
      });
      window.addEventListener('pointerup', function(){ dragging2d = false; });
      window.addEventListener('pointercancel', function(){ dragging2d = false; });
      vp2d.addEventListener('wheel', function(e){
        e.preventDefault();
        zoom2dAt(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
      }, { passive: false });
      document.getElementById('btnZoomIn').onclick = function(){ zoom2dAt(1.2); };
      document.getElementById('btnZoomOut').onclick = function(){ zoom2dAt(0.82); };
      document.getElementById('btnReset').onclick = function(){ scale = 1; tx = 0; ty = 0; apply2d(); };

      var selFloor2d = document.getElementById('selFloor2d');
      var selMode2d = document.getElementById('selMode2d');
      var selFloor3dEl = document.getElementById('selFloor3d');
      var defaultMode2d = ${safeEmbedJson(project.activeMode)};
      var defaultFloor2d = ${safeEmbedJson(defaultFloor2d)};
      var defaultFloor3d = ${safeEmbedJson(defaultFloor3d)};
      var activeViewerFloorScope = startIn3D ? defaultFloor3d : defaultFloor2d;
      var onViewer3dFloorChange = null;

      function applyFloorLayerVisibility(fid){
        var layerEls = stage ? stage.querySelectorAll('[data-floor-layer]') : [];
        for(var i = 0; i < layerEls.length; i++){
          var layerFid = layerEls[i].getAttribute('data-floor-layer');
          layerEls[i].style.display = (!fid || fid === '__ALL__' || fid === '__SINGLE__' || layerFid === fid) ? '' : 'none';
        }
        var cards = stage ? stage.querySelectorAll('[data-layer="floor-card"][data-floor-id]') : [];
        for(var j = 0; j < cards.length; j++){
          cards[j].style.cursor = 'pointer';
          cards[j].onclick = (function(targetFloorId){
            return function(){ setActiveViewerFloor(targetFloorId); };
          })(cards[j].getAttribute('data-floor-id'));
        }
      }

      function sync2dStageView(){
        var mid = selMode2d ? selMode2d.value : defaultMode2d;
        var fid = selFloor2d ? selFloor2d.value : activeViewerFloorScope;
        var tpls = document.querySelectorAll('template[data-floor2d-id]');
        var matched = null;
        for(var i = 0; i < tpls.length; i++){
          var tMode = tpls[i].getAttribute('data-view2d-mode') || defaultMode2d;
          var tFloor = tpls[i].getAttribute('data-floor2d-id');
          if(tMode === mid && tFloor === fid){
            matched = tpls[i];
            break;
          }
          if(!matched && tFloor === fid){
            matched = tpls[i];
          }
        }
        if(matched){
          stage.innerHTML = matched.innerHTML;
          scale = 1; tx = 0; ty = 0; apply2d();
        }
        applyFloorLayerVisibility(fid);
      }

      function setActiveViewerFloor(fid){
        if(!fid) return;
        activeViewerFloorScope = fid;
        if(window.HachihiProjectData){
          window.HachihiProjectData.activeFloorScope = fid;
        }
        if(selFloor2d && selFloor2d.value !== fid){
          selFloor2d.value = fid;
        }
        sync2dStageView();
        if(selFloor3dEl && selFloor3dEl.value !== fid){
          selFloor3dEl.value = fid;
        }
        if(onViewer3dFloorChange){
          onViewer3dFloorChange(fid);
        }
      }

      if(selFloor2d){
        selFloor2d.addEventListener('change', function(){
          setActiveViewerFloor(selFloor2d.value);
        });
      }
      if(selMode2d){
        selMode2d.addEventListener('change', sync2dStageView);
      }
      applyFloorLayerVisibility(defaultFloor2d);

      window.HachihiFloorNav = {
        getFloors: function(){
          return (window.HachihiProjectData && window.HachihiProjectData.floors) ? window.HachihiProjectData.floors : (baseProject.floors || []);
        },
        getActiveFloor: function(){
          return activeViewerFloorScope;
        },
        setFloor: function(fid){
          setActiveViewerFloor(fid);
        }
      };

      // --- Searchable BOM Tables ---
      function wireTableFilter(inputId, tbodyId){
        var inp = document.getElementById(inputId);
        var tb = document.getElementById(tbodyId);
        if(!inp || !tb) return;
        inp.addEventListener('input', function(){
          var q = (inp.value || '').toLowerCase().trim();
          var rows = tb.querySelectorAll('tr');
          for(var i = 0; i < rows.length; i++){
            var txt = (rows[i].textContent || '').toLowerCase();
            rows[i].style.display = !q || txt.indexOf(q) !== -1 ? '' : 'none';
          }
        });
      }
      wireTableFilter('filterDevices', 'tbodyDevices');
      wireTableFilter('filterCables', 'tbodyCables');

      // --- 3D Interactive Scene Engine ---
      function escText(v){
        return String(v == null ? '' : v)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function disposeViewer3d(){
        if(viewer3d && typeof viewer3d.dispose === 'function'){
          viewer3d.dispose();
        }
        viewer3d = null;
      }

      function showWebglDiagnostic(step, code, err){
        var fallbackEl = document.getElementById('webglFallback');
        var stepEl = document.getElementById('webglErrorStep');
        var codeEl = document.getElementById('webglErrorCode');
        var msgEl = document.getElementById('webglErrorMsg');
        if(stepEl) stepEl.textContent = String(step || 'unknown');
        if(codeEl) codeEl.textContent = String(code || 'WEBGL_INIT_ERROR');
        var detail = err && err.message ? String(err.message) : '';
        var baseMsg =
          code === 'WEBGL_CONTEXT_LOST'
            ? 'Ngữ cảnh đồ họa WebGL 3D đã bị ngắt kết nối. Nhấn "Thử lại 3D" để khôi phục hoặc chuyển sang Sơ đồ 2D.'
            : 'Không thể khởi tạo bộ kết xuất 3D WebGL trên trình duyệt này. Vui lòng thử lại hoặc xem bản vẽ ở Sơ đồ 2D.';
        if(msgEl){
          msgEl.textContent = detail ? baseMsg + ' (' + detail + ')' : baseMsg;
        }
        disposeViewer3d();
        if(fallbackEl) fallbackEl.classList.remove('hidden');
      }

      function hideWebglDiagnostic(){
        var fallbackEl = document.getElementById('webglFallback');
        if(fallbackEl) fallbackEl.classList.add('hidden');
      }

      function probeWebglSupport(){
        try {
          var probeCanvas = document.createElement('canvas');
          var gl =
            probeCanvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
            probeCanvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
            probeCanvas.getContext('experimental-webgl');
          return Boolean(gl);
        } catch (_e) {
          return false;
        }
      }

      function init3DViewer(){
        if(viewer3d) return;
        hideWebglDiagnostic();
        var Runtime = window.HachihiViewer3D;
        var host = document.getElementById('canvas3dHost');
        if(!Runtime || !host){
          showWebglDiagnostic('runtime-check', 'RUNTIME_MISSING', new Error('Thiếu Runtime 3D hoặc khung chứa #canvas3dHost'));
          return;
        }
        if(!probeWebglSupport()){
          showWebglDiagnostic('webgl-capability', 'WEBGL_UNSUPPORTED', new Error('Trình duyệt chưa bật WebGL hoặc GPU không khả dụng'));
          return;
        }

        var initStep = 'renderer-create';
        var renderer = null;
        var controls = null;
        var ro = null;
        var worldRoot = null;
        var shadowTex = null;
        var lockBadgeTex = null;
        var rafId = 0;
        var isDisposed = false;
        var onKeyDownHandler = null;
        var onPointerDownHandler = null;
        var onPointerUpHandler = null;
        var onDblClickHandler = null;
        var onContextLostHandler = null;

        function cleanupLocalResources(){
          if(isDisposed) return;
          isDisposed = true;
          if(rafId !== 0){
            cancelAnimationFrame(rafId);
            rafId = 0;
          }
          if(ro){
            try { ro.disconnect(); } catch (_e) {}
            ro = null;
          }
          if(onKeyDownHandler){
            window.removeEventListener('keydown', onKeyDownHandler);
            onKeyDownHandler = null;
          }
          if(renderer && renderer.domElement){
            if(onPointerDownHandler) renderer.domElement.removeEventListener('pointerdown', onPointerDownHandler);
            if(onPointerUpHandler) renderer.domElement.removeEventListener('pointerup', onPointerUpHandler);
            if(onDblClickHandler) renderer.domElement.removeEventListener('dblclick', onDblClickHandler);
            if(onContextLostHandler) renderer.domElement.removeEventListener('webglcontextlost', onContextLostHandler);
          }
          if(controls){
            try { controls.dispose(); } catch (_e) {}
            controls = null;
          }
          if(worldRoot && Runtime.disposeObjectTree){
            try { Runtime.disposeObjectTree(worldRoot); worldRoot.clear(); } catch (_e) {}
          }
          if(shadowTex && shadowTex.dispose){ try { shadowTex.dispose(); } catch (_e) {} }
          if(lockBadgeTex && lockBadgeTex.dispose){ try { lockBadgeTex.dispose(); } catch (_e) {} }
          if(renderer){
            try { renderer.dispose(); } catch (_e) {}
            renderer = null;
          }
          if(host){
            host.innerHTML = '';
          }
          onThemeChanged = null;
          onViewer3dFloorChange = null;
        }

        try {
          var THREE = Runtime.THREE;
          var OrbitControls = Runtime.OrbitControls;
          var isSoftwareGl = Runtime.detectSoftwareGl();
          renderer = new THREE.WebGLRenderer({
            antialias: !isSoftwareGl,
            powerPreference: isSoftwareGl ? 'low-power' : 'high-performance'
          });

          var hasManyFloors = Array.isArray(baseProject.floors) && baseProject.floors.length > 1;
          var initViewAllFloors = hasManyFloors && (activeViewerFloorScope === '__ALL__' || activeViewerFloorScope === '__SINGLE__' || !activeViewerFloorScope);
          var initActiveFloorId = (!initViewAllFloors && activeViewerFloorScope && activeViewerFloorScope !== '__ALL__' && activeViewerFloorScope !== '__SINGLE__')
            ? activeViewerFloorScope
            : (baseProject.activeFloorId || '');

          var state = {
            viewAllFloors: initViewAllFloors,
            activeFloorId: initActiveFloorId,
            explodeSpread: 0,
            showRooms: true,
            showCables: true,
            showAxes: true,
            showLabels: false,
            autoRotate: false,
            wireframeMode: false,
            renderQuality: isSoftwareGl ? 'medium' : 'high',
            shadowsEnabled: !isSoftwareGl,
            showThermalHeatmap: true,
            activePreset: 'iso',
            selectedId: undefined,
            selectedType: undefined
          };

          function computeDpr(){
            if(Runtime.getPixelRatioForQuality){
              return Runtime.getPixelRatioForQuality(state.renderQuality, window.devicePixelRatio || 1, isSoftwareGl);
            }
            return Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2);
          }

          initStep = 'renderer-mount';
          var w = host.clientWidth || window.innerWidth || 1000;
          var h = host.clientHeight || 600;
          renderer.setPixelRatio(computeDpr());
          renderer.setSize(w, h);
          if(THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.domElement.style.display = 'block';
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = '100%';
          renderer.domElement.style.touchAction = 'none';
          host.innerHTML = '';
          host.appendChild(renderer.domElement);

          onContextLostHandler = function(e){
            if(e && e.preventDefault) e.preventDefault();
            showWebglDiagnostic('context-lost', 'WEBGL_CONTEXT_LOST', new Error('WebGL rendering context lost'));
          };
          renderer.domElement.addEventListener('webglcontextlost', onContextLostHandler, false);

          initStep = 'scene-setup';
          var scene = new THREE.Scene();
          var camera = new THREE.PerspectiveCamera(42, w / h, 0.2, 220);
          camera.position.set(13, 11.5, 13.5);

          controls = new OrbitControls(camera, renderer.domElement);
          controls.enableDamping = !isSoftwareGl;
          controls.dampingFactor = 0.08;
          controls.maxPolarAngle = Math.PI / 2 - 0.03;
          controls.minPolarAngle = 0.04;
          controls.minDistance = 2.5;
          controls.maxDistance = 60;
          controls.autoRotateSpeed = 1.6;
          controls.target.set(0, 0.4, 0);
          controls.update();

          var studioRig = Runtime.setupStudioEnvironment(scene, renderer, globalState.isDark, isSoftwareGl);
          if(studioRig.setShadowsEnabled){
            studioRig.setShadowsEnabled(state.shadowsEnabled && !isSoftwareGl);
          }
          if(studioRig.setRenderQuality){
            studioRig.setRenderQuality(state.renderQuality, isSoftwareGl, state.shadowsEnabled && !isSoftwareGl);
          }

          shadowTex = Runtime.createContactShadowTexture();
          lockBadgeTex = Runtime.createLockBadgeTexture();
          worldRoot = new THREE.Group();
          worldRoot.name = 'infrastructure_world_root';
          scene.add(worldRoot);

        var axesGroup = Runtime.createWorldAxesHelper(2.6);
        axesGroup.visible = state.showAxes;
        scene.add(axesGroup);

        var worldBounds = { minX: -8, maxX: 8, minY: 0, maxY: 3, minZ: -6, maxZ: 6, centerX: 0, centerY: 0.4, centerZ: 0, size: 16 };
        var nodeGroups = new Map();
        var transitioning = false;
        var targetCamPos = new THREE.Vector3();
        var targetCtrlTarget = new THREE.Vector3();
        var rotMatrix = new THREE.Matrix4();
        var labelEls = [];
        var labelsLayer = document.getElementById('labels3dLayer');
        var labelProjVec = new THREE.Vector3();

        function syncLabelsOverlay(){
          if(!labelsLayer) return;
          if(!state.showLabels){
            labelsLayer.classList.add('hidden');
            return;
          }
          labelsLayer.classList.remove('hidden');
          var width = host.clientWidth || 1;
          var height = host.clientHeight || 1;
          var idx = 0;
          nodeGroups.forEach(function(entry){
            var pos = entry.group.position;
            var yOff = entry.node.type === 'rack' ? 2.45 : 0.95;
            labelProjVec.set(pos.x, pos.y + yOff, pos.z).project(camera);
            if(labelProjVec.z > 1 || labelProjVec.z < -1) return;
            var sxPx = (labelProjVec.x * 0.5 + 0.5) * width;
            var syPx = (-labelProjVec.y * 0.5 + 0.5) * height;
            if(sxPx < -40 || sxPx > width + 40 || syPx < -20 || syPx > height + 40) return;

            var el = labelEls[idx];
            if(!el){
              el = document.createElement('div');
              el.className = 'label-3d-tag';
              labelsLayer.appendChild(el);
              labelEls.push(el);
            }
            el.style.display = 'block';
            el.style.left = sxPx.toFixed(1) + 'px';
            el.style.top = syPx.toFixed(1) + 'px';
            el.textContent = entry.node.label || entry.node.id;
            idx++;
          });
          for(var j = idx; j < labelEls.length; j++){
            labelEls[j].style.display = 'none';
          }
        }

        function updateCornerGizmo(){
          Runtime.extractCameraRotationMatrix(camera, rotMatrix);
          var projected = Runtime.projectCornerAxesFromCameraMatrix(rotMatrix, 38, 22, 9);
          var layer = document.getElementById('gizmoLayer');
          for(var i = 0; i < projected.length; i++){
            var item = projected[i];
            var grp = document.getElementById('gizmo' + item.axis);
            var posL = document.getElementById('gizmoPos' + item.axis);
            var negL = document.getElementById('gizmoNeg' + item.axis);
            var dot = document.getElementById('gizmoDot' + item.axis);
            var txt = document.getElementById('gizmoTxt' + item.axis);
            if(!grp || !posL || !negL || !dot || !txt) continue;
            posL.setAttribute('x2', item.px.toFixed(1));
            posL.setAttribute('y2', item.py.toFixed(1));
            negL.setAttribute('x2', item.nx.toFixed(1));
            negL.setAttribute('y2', item.ny.toFixed(1));
            dot.setAttribute('cx', item.px.toFixed(1));
            dot.setAttribute('cy', item.py.toFixed(1));
            txt.setAttribute('x', item.tx.toFixed(1));
            txt.setAttribute('y', (item.ty + 3.2).toFixed(1));
            grp.setAttribute('opacity', item.opacity.toFixed(2));
            if(layer) layer.appendChild(grp);
          }
        }

        var needsRender = true;
        var lastTime = performance.now();

        function scheduleFrame(){
          if(isDisposed || rafId !== 0) return;
          rafId = requestAnimationFrame(tick);
        }
        function requestRender(){
          if(isDisposed) return;
          needsRender = true;
          scheduleFrame();
        }

        function tick(now){
          rafId = 0;
          if(isDisposed || !renderer || !controls) return;
          var dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
          lastTime = now;
          var stillAnimating = false;

          if(transitioning){
            var alpha = isSoftwareGl ? 1 : 1 - Math.exp(-9 * dt);
            camera.position.lerp(targetCamPos, alpha);
            controls.target.lerp(targetCtrlTarget, alpha);
            if(camera.position.distanceTo(targetCamPos) < 0.04 && controls.target.distanceTo(targetCtrlTarget) < 0.04){
              camera.position.copy(targetCamPos);
              controls.target.copy(targetCtrlTarget);
              transitioning = false;
            } else {
              stillAnimating = true;
            }
          }

          var dampingChanged = controls.update();
          if(needsRender || dampingChanged || stillAnimating || state.autoRotate){
            needsRender = false;
            renderer.render(scene, camera);
            updateCornerGizmo();
            syncLabelsOverlay();
          }

          if(stillAnimating || state.autoRotate || (controls.enableDamping && dampingChanged)){
            scheduleFrame();
          }
        }

        function computePose(preset){
          var cx = worldBounds.centerX, cy = worldBounds.centerY, cz = worldBounds.centerZ;
          var span = Math.max(12, worldBounds.size);
          var pos = new THREE.Vector3();
          var tgt = new THREE.Vector3(cx, cy, cz);
          if(preset === 'top'){
            pos.set(cx + 0.01, cy + span * 1.12, cz + 0.01);
          } else if(preset === 'front'){
            pos.set(cx, cy + span * 0.14, cz + span * 0.94);
          } else if(preset === 'back'){
            pos.set(cx, cy + span * 0.14, cz - span * 0.94);
          } else if(preset === 'left'){
            pos.set(cx - span * 0.94, cy + span * 0.14, cz + 0.01);
          } else if(preset === 'right'){
            pos.set(cx + span * 0.94, cy + span * 0.14, cz + 0.01);
          } else if(preset === 'backIso'){
            pos.set(cx - span * 0.72, cy + span * 0.56, cz - span * 0.76);
          } else {
            pos.set(cx + span * 0.72, cy + span * 0.56, cz + span * 0.76);
          }
          return { pos: pos, tgt: tgt };
        }

        function applyPreset(preset, immediate){
          state.activePreset = preset;
          var btns = document.querySelectorAll('.preset-btn');
          for(var i = 0; i < btns.length; i++){
            btns[i].classList.toggle('active', btns[i].getAttribute('data-preset') === preset);
          }
          var pose = computePose(preset);
          targetCamPos.copy(pose.pos);
          targetCtrlTarget.copy(pose.tgt);
          if(immediate){
            camera.position.copy(targetCamPos);
            controls.target.copy(targetCtrlTarget);
            controls.update();
            transitioning = false;
          } else {
            transitioning = true;
          }
          requestRender();
        }

        function rebuildWorld(reframe){
          var keepSet = new Set([shadowTex, lockBadgeTex]);
          Runtime.disposeObjectTree(worldRoot, keepSet);
          worldRoot.clear();

          var projForBuild = Object.assign({}, baseProject, {
            activeFloorId: state.activeFloorId || baseProject.activeFloorId,
            settings: Object.assign({}, baseProject.settings || {}, { isDarkMode: globalState.isDark })
          });

          var effShadow = state.shadowsEnabled && !isSoftwareGl;
          var populated = Runtime.populateInfrastructure3DWorld(
            worldRoot,
            projForBuild,
            state.selectedId,
            {
              showRooms: state.showRooms,
              showCables: state.showCables,
              explodeSpread: state.explodeSpread,
              castShadow: effShadow,
              shadowTex: shadowTex,
              lockBadgeTex: lockBadgeTex,
              viewAllFloors: state.viewAllFloors,
              renderQuality: state.renderQuality,
              wireframe: state.wireframeMode,
              showThermalHeatmap: state.showThermalHeatmap
            }
          );

          if(Runtime.applyGlobalShadowMapping){
            Runtime.applyGlobalShadowMapping(renderer, scene, effShadow);
          }
          if(Runtime.applySceneWireframeMode && state.wireframeMode){
            Runtime.applySceneWireframeMode(worldRoot, true);
          }
          if(!isSoftwareGl && renderer.compile){
            renderer.compile(scene, camera);
          }

          worldBounds = populated.bounds;
          nodeGroups = populated.nodeGroups;
          controls.maxDistance = Math.max(48, worldBounds.size * 2.8);
          camera.far = Math.max(180, worldBounds.size * 6);
          camera.updateProjectionMatrix();

          if(reframe){
            applyPreset(state.activePreset, true);
          } else {
            requestRender();
          }
        }

        initStep = 'world-build';
        rebuildWorld(true);

        initStep = 'initial-render';
        needsRender = false;
        renderer.render(scene, camera);
        updateCornerGizmo();
        syncLabelsOverlay();

        onThemeChanged = function(isDark){
          if(isDisposed) return;
          studioRig.updateTheme(isDark);
          rebuildWorld(false);
        };

        controls.addEventListener('change', requestRender);
        controls.addEventListener('start', function(){ transitioning = false; });

        ro = new ResizeObserver(function(){
          if(isDisposed || view3dEl.classList.contains('hidden')) return;
          var nw = host.clientWidth || 800;
          var nh = host.clientHeight || 500;
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
          requestRender();
        });
        ro.observe(host);

        // --- Raycaster Click-to-Inspect ---
        var raycaster = new THREE.Raycaster();
        var pointerNdc = new THREE.Vector2();
        var downClient = null;
        var inspTitle = document.getElementById('inspTitle');
        var inspSub = document.getElementById('inspSub');
        var inspBody = document.getElementById('inspBody');
        var focusedWorldPoint = null;

        function findRackBySelect(selectId, node){
          var racks = baseProject.racks || [];
          for(var i = 0; i < racks.length; i++){
            var r = racks[i];
            if(r.id === selectId || (node && node.customData && r.id === node.customData.rackId) || (node && r.name === node.label)){
              return r;
            }
          }
          return null;
        }

        function showInspectorForHit(picked){
          if(!picked){
            state.selectedId = undefined;
            state.selectedType = undefined;
            focusedWorldPoint = null;
            inspCardEl.classList.add('hidden');
            rebuildWorld(false);
            return;
          }
          state.selectedId = picked.selectId;
          state.selectedType = picked.selectType;
          focusedWorldPoint = picked.point.clone();

          if(picked.selectType === 'edge'){
            var cable = (baseProject.cables || []).find(function(c){ return c.id === picked.selectId; });
            if(!cable) return;
            var srcNode = (baseProject.nodes || []).find(function(n){ return n.id === cable.sourceNodeId; });
            var tgtNode = (baseProject.nodes || []).find(function(n){ return n.id === cable.targetNodeId; });
            inspTitle.textContent = cable.cableCode || 'Tuyến cáp';
            inspSub.textContent = (srcNode ? srcNode.label : 'Nguồn') + ' → ' + (tgtNode ? tgtNode.label : 'Đích');
            inspBody.innerHTML =
              '<div class="insp-grid">' +
              '<span class="k">Loại cáp</span><span class="v">' + escText(cable.cableType || '—') + '</span>' +
              '<span class="k">Băng thông</span><span class="v">' + escText(cable.bandwidth || '—') + '</span>' +
              '<span class="k">Chiều dài</span><span class="v">' + escText((cable.lengthMeters || 0) + ' m') + '</span>' +
              '<span class="k">Kiểu đi dây</span><span class="v">' + escText(cable.routingType || 'orthogonal') + '</span>' +
              '</div>';
            inspCardEl.classList.remove('hidden');
            rebuildWorld(false);
            return;
          }

          var entry = nodeGroups.get(picked.nodeId);
          var node = entry ? entry.node : (baseProject.nodes || []).find(function(n){ return n.id === picked.nodeId; });
          if(!node) return;
          if(entry){
            focusedWorldPoint.copy(entry.group.position);
            focusedWorldPoint.y += node.type === 'rack' ? 1.1 : 0.45;
          }
          var asset = node.assetId && baseProject.assets ? baseProject.assets[node.assetId] : null;
          var floorObj = (baseProject.floors || []).find(function(f){ return f.id === node.floorId; });

          if(picked.selectType === 'rack'){
            var rack = findRackBySelect(picked.selectId, node);
            var rackAssets = Object.values(baseProject.assets || {}).filter(function(a){ return rack && a.rackId === rack.id; });
            rackAssets.sort(function(a, b){ return (b.uPosition || 0) - (a.uPosition || 0); });
            var usedU = rackAssets.reduce(function(sum, a){ return sum + (a.uHeight || 1); }, 0);
            var totalW = rackAssets.reduce(function(sum, a){ return sum + (a.powerWatts || 0); }, 0);
            inspTitle.textContent = (rack && rack.name) || node.label || 'Tủ Rack';
            inspSub.textContent = 'Tủ Rack · ' + usedU + '/' + ((rack && rack.totalUnits) || (rack && rack.totalU) || 42) + 'U · ' + totalW + 'W';
            var html = '<div class="insp-grid">' +
              (floorObj ? '<span class="k">Tầng</span><span class="v">' + escText(floorObj.name) + '</span>' : '') +
              '<span class="k">Thiết bị trong tủ</span><span class="v">' + rackAssets.length + '</span>' +
              '<span class="k">Tổng công suất</span><span class="v">' + totalW + ' W</span>' +
              '</div>';
            if(rackAssets.length > 0){
              html += '<div class="insp-u-list">' + rackAssets.map(function(a){
                return '<div class="insp-u-item"><span><strong>U' + (a.uPosition || '?') + '</strong> · ' + escText(a.name) + '</span><span>' + escText(a.ipAddress || a.model || a.category || '') + '</span></div>';
              }).join('') + '</div>';
            }
            inspBody.innerHTML = html;
          } else {
            inspTitle.textContent = (asset && asset.name) || node.label || 'Thiết bị';
            inspSub.textContent = asset ? ((asset.vendor || '') + ' ' + (asset.model || '')).trim() || asset.category : node.type;
            inspBody.innerHTML =
              '<div class="insp-grid">' +
              (asset && asset.assetTag ? '<span class="k">Mã TS</span><span class="v">' + escText(asset.assetTag) + '</span>' : '') +
              (floorObj ? '<span class="k">Tầng</span><span class="v">' + escText(floorObj.name) + '</span>' : '') +
              (asset && asset.ipAddress ? '<span class="k">IP</span><span class="v">' + escText(asset.ipAddress) + '</span>' : '') +
              (asset && asset.vlan ? '<span class="k">VLAN</span><span class="v">' + escText(asset.vlan) + '</span>' : '') +
              (asset && asset.powerWatts ? '<span class="k">Công suất</span><span class="v">' + escText(asset.powerWatts + ' W') + '</span>' : '') +
              '<span class="k">Tọa độ CAD</span><span class="v">X:' + Math.round(node.x) + ' · Y:' + Math.round(node.y) + '</span>' +
              '</div>';
          }
          inspCardEl.classList.remove('hidden');
          rebuildWorld(false);
        }

        function pickAt(clientX, clientY){
          var rect = renderer.domElement.getBoundingClientRect();
          pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
          pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointerNdc, camera);
          var hits = raycaster.intersectObjects(worldRoot.children, true);
          for(var i = 0; i < hits.length; i++){
            var ud = hits[i].object.userData || {};
            if(ud.selectType === 'edge' && (ud.selectId || ud.cableId)){
              return { selectType: 'edge', selectId: String(ud.selectId || ud.cableId), nodeId: '', point: hits[i].point };
            }
            if(ud.selectType && ud.selectId && ud.nodeId){
              return { selectType: ud.selectType, selectId: String(ud.selectId), nodeId: String(ud.nodeId), point: hits[i].point };
            }
          }
          return null;
        }

        onPointerDownHandler = function(e){
          if(e.button === 0) downClient = { x: e.clientX, y: e.clientY };
          else downClient = null;
        };
        onPointerUpHandler = function(e){
          if(!downClient || e.button !== 0) return;
          var dist = Math.hypot(e.clientX - downClient.x, e.clientY - downClient.y);
          downClient = null;
          if(dist <= 5){
            showInspectorForHit(pickAt(e.clientX, e.clientY));
          }
        };
        onDblClickHandler = function(e){
          var picked = pickAt(e.clientX, e.clientY);
          if(picked){
            showInspectorForHit(picked);
            if(focusedWorldPoint){
              var dir = camera.position.clone().sub(controls.target).normalize();
              targetCtrlTarget.copy(focusedWorldPoint);
              targetCamPos.copy(focusedWorldPoint).add(dir.multiplyScalar(5.5));
              targetCamPos.y = Math.max(focusedWorldPoint.y + 1.8, targetCamPos.y);
              transitioning = true;
              requestRender();
            }
          }
        };
        renderer.domElement.addEventListener('pointerdown', onPointerDownHandler);
        renderer.domElement.addEventListener('pointerup', onPointerUpHandler);
        renderer.domElement.addEventListener('dblclick', onDblClickHandler);

        document.getElementById('inspClose').onclick = function(){ showInspectorForHit(null); };
        document.getElementById('btnFocusObject').onclick = function(){
          if(!focusedWorldPoint) return;
          var dir = camera.position.clone().sub(controls.target).normalize();
          targetCtrlTarget.copy(focusedWorldPoint);
          targetCamPos.copy(focusedWorldPoint).add(dir.multiplyScalar(5.2));
          targetCamPos.y = Math.max(focusedWorldPoint.y + 1.6, targetCamPos.y);
          transitioning = true;
          requestRender();
        };

        // --- Camera Toolbar & Keyboard Shortcuts ---
        var presetButtons = document.querySelectorAll('.preset-btn');
        for(var p = 0; p < presetButtons.length; p++){
          presetButtons[p].onclick = function(){
            applyPreset(this.getAttribute('data-preset'), false);
          };
        }
        document.getElementById('gizmoX').onclick = function(){ applyPreset('right', false); };
        document.getElementById('gizmoY').onclick = function(){ applyPreset('top', false); };
        document.getElementById('gizmoZ').onclick = function(){ applyPreset('front', false); };

        var btnAutoRotate = document.getElementById('btnAutoRotate');
        btnAutoRotate.onclick = function(){
          state.autoRotate = !state.autoRotate;
          controls.autoRotate = state.autoRotate;
          btnAutoRotate.classList.toggle('active-teal', state.autoRotate);
          requestRender();
        };

        document.getElementById('btn3dZoomIn').onclick = function(){
          transitioning = false;
          var dir = camera.position.clone().sub(controls.target);
          var d = Math.max(controls.minDistance, dir.length() * 0.78);
          camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(d));
          controls.update();
          requestRender();
        };
        document.getElementById('btn3dZoomOut').onclick = function(){
          transitioning = false;
          var dir = camera.position.clone().sub(controls.target);
          var d = Math.min(controls.maxDistance, dir.length() * 1.25);
          camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(d));
          controls.update();
          requestRender();
        };
        document.getElementById('btn3dFit').onclick = function(){ applyPreset(state.activePreset, false); };

        onViewer3dFloorChange = function(v){
          if(v === '__ALL__' || v === '__SINGLE__'){
            state.viewAllFloors = hasManyFloors;
          } else {
            state.viewAllFloors = false;
            state.activeFloorId = v;
          }
          rebuildWorld(true);
        };

        var selFloor = document.getElementById('selFloor3d');
        if(selFloor){
          selFloor.onchange = function(){
            setActiveViewerFloor(selFloor.value);
          };
        }

        var rngExplode = document.getElementById('rngExplode3d');
        var valExplode = document.getElementById('valExplode3d');
        if(rngExplode){
          rngExplode.oninput = function(){
            state.explodeSpread = parseFloat(rngExplode.value) || 0;
            if(valExplode) valExplode.textContent = state.explodeSpread.toFixed(1);
            rebuildWorld(false);
          };
        }

        function wireToggle(btnId, key, activeCls, onAfter){
          var btn = document.getElementById(btnId);
          if(!btn) return;
          btn.classList.toggle(activeCls, Boolean(state[key]));
          btn.onclick = function(){
            state[key] = !state[key];
            btn.classList.toggle(activeCls, Boolean(state[key]));
            if(onAfter) onAfter();
          };
        }
        wireToggle('togRooms3d', 'showRooms', 'active', function(){ rebuildWorld(false); });
        wireToggle('togCables3d', 'showCables', 'active', function(){ rebuildWorld(false); });
        wireToggle('togAxes3d', 'showAxes', 'active', function(){
          axesGroup.visible = state.showAxes;
          xyzGizmoPanel.classList.toggle('hidden', !state.showAxes);
          requestRender();
        });
        wireToggle('togLabels3d', 'showLabels', 'active', function(){ syncLabelsOverlay(); });
        wireToggle('togWireframe3d', 'wireframeMode', 'active', function(){
          if(Runtime.applySceneWireframeMode){
            Runtime.applySceneWireframeMode(worldRoot, state.wireframeMode);
            requestRender();
          } else {
            rebuildWorld(false);
          }
        });
        wireToggle('togShadows3d', 'shadowsEnabled', 'active-amber', function(){
          var eff = state.shadowsEnabled && !isSoftwareGl;
          if(studioRig.setShadowsEnabled) studioRig.setShadowsEnabled(eff);
          else if(Runtime.applyGlobalShadowMapping) Runtime.applyGlobalShadowMapping(renderer, scene, eff);
          requestRender();
        });
        wireToggle('togThermal3d', 'showThermalHeatmap', 'active-teal', function(){
          rebuildWorld(false);
        });

        var qualButtons = document.querySelectorAll('.qual-btn');
        function syncQualButtons(){
          for(var q = 0; q < qualButtons.length; q++){
            qualButtons[q].classList.toggle('active', qualButtons[q].getAttribute('data-qual') === state.renderQuality);
          }
        }
        syncQualButtons();
        for(var q = 0; q < qualButtons.length; q++){
          qualButtons[q].onclick = function(){
            state.renderQuality = this.getAttribute('data-qual') || 'high';
            syncQualButtons();
            renderer.setPixelRatio(computeDpr());
            if(studioRig.setRenderQuality){
              studioRig.setRenderQuality(state.renderQuality, isSoftwareGl, state.shadowsEnabled && !isSoftwareGl);
            }
            rebuildWorld(false);
          };
        }

        onKeyDownHandler = function(e){
          if(isDisposed || view3dEl.classList.contains('hidden')) return;
          if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
          if(e.key === '1') applyPreset('iso', false);
          else if(e.key === '2') applyPreset('top', false);
          else if(e.key === '3') applyPreset('front', false);
          else if(e.key === '4') applyPreset('back', false);
          else if(e.key === '5') applyPreset('left', false);
          else if(e.key === '6') applyPreset('right', false);
          else if(e.key === '7') applyPreset('backIso', false);
          else if(e.key === 'f' || e.key === 'F') applyPreset(state.activePreset, false);
          else if(e.key === 'r' || e.key === 'R') btnAutoRotate.click();
          else if(e.key === 'w' || e.key === 'W') {
            var wfBtn = document.getElementById('togWireframe3d');
            if(wfBtn) wfBtn.click();
          } else if(e.key === 'l' || e.key === 'L') {
            var lbBtn = document.getElementById('togLabels3d');
            if(lbBtn) lbBtn.click();
          }
        };
        window.addEventListener('keydown', onKeyDownHandler);

        viewer3d = {
          resize: function(){
            if(isDisposed || !renderer || view3dEl.classList.contains('hidden')) return;
            var nw = host.clientWidth || 800;
            var nh = host.clientHeight || 500;
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
            requestRender();
          },
          dispose: cleanupLocalResources
        };
        } catch (err) {
          var errCode =
            initStep === 'renderer-create'
              ? 'RENDERER_INIT_FAILED'
              : initStep === 'world-build'
              ? 'SCENE_BUILD_FAILED'
              : initStep === 'initial-render'
              ? 'FIRST_RENDER_FAILED'
              : 'WEBGL_INIT_ERROR';
          cleanupLocalResources();
          showWebglDiagnostic(initStep, errCode, err);
        }
      }

      // --- Tab Switching ---
      var tabs = [
        { btn: 'tab3D', view: 'view3D', ctrl: 'controls3dGroup' },
        { btn: 'tabDiag', view: 'viewDiag', ctrl: 'controls2dGroup' },
        { btn: 'tabDevices', view: 'viewDevices', ctrl: null },
        { btn: 'tabCables', view: 'viewCables', ctrl: null }
      ];
      function showTab(targetBtn){
        for(var i = 0; i < tabs.length; i++){
          var t = tabs[i];
          var isMatch = t.btn === targetBtn;
          document.getElementById(t.view).classList.toggle('hidden', !isMatch);
          document.getElementById(t.btn).classList.toggle('active', isMatch);
          if(t.ctrl){
            document.getElementById(t.ctrl).classList.toggle('hidden', !isMatch);
          }
        }
        if(targetBtn === 'tab3D'){
          if(!viewer3d) init3DViewer();
          else viewer3d.resize();
        }
      }
      document.getElementById('tab3D').onclick = function(){ showTab('tab3D'); };
      document.getElementById('tabDiag').onclick = function(){ showTab('tabDiag'); };
      document.getElementById('tabDevices').onclick = function(){ showTab('tabDevices'); };
      document.getElementById('tabCables').onclick = function(){ showTab('tabCables'); };
      document.getElementById('btnFallback2D').onclick = function(){ showTab('tabDiag'); };
      var btnRetry3DEl = document.getElementById('btnRetry3D');
      if(btnRetry3DEl){
        btnRetry3DEl.onclick = function(){
          disposeViewer3d();
          hideWebglDiagnostic();
          init3DViewer();
        };
      }
      window.addEventListener('pagehide', disposeViewer3d);

      if(startIn3D){
        init3DViewer();
      }
    })();
  </script>
</body>
</html>`;
}

export async function generateStandaloneViewerHtmlAsync(
  project: ProjectState,
  options?: HtmlViewerExportOptions
): Promise<string> {
  const viewer3DRuntimeJs = options?.viewer3DRuntimeJs ?? (await loadViewer3DRuntimeJs());
  return generateStandaloneViewerHtml(project, {
    ...options,
    viewer3DRuntimeJs
  });
}

export async function exportProjectToHtmlViewer(
  project: ProjectState,
  options?: HtmlViewerExportOptions
): Promise<void> {
  const html = await generateStandaloneViewerHtmlAsync(project, options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix = options?.contentScope === '3d' ? '_3D_Viewer.html' : '_Viewer.html';
  link.download = `${project.name.replace(/\s+/g, '_')}${suffix}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  trackExport(`html:${options?.contentScope || '2d'}`);
}
