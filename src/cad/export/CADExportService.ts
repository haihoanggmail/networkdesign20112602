import type { ProjectState } from '../../types/infrastructure';
import {
  buildCadDocumentPdfArtifact,
  exportCadDocumentToPdf,
  type CadPdfArtifact,
  type ExportCadPdfOptions
} from '../../utils/pdfExporter';
import { resolveLayerColorHex } from '../core/CADColorPalette';
import { isCADLayerVisible } from '../core/CADDocument';
import type { CADDocument } from '../core/CADTypes';
import { getCADUnitMeta } from '../core/CADUnits';
import { decodeAutoCadText } from '../geometry/CADCurve';
import { computeSmartFitExtents } from '../geometry/CADBounds';
import { renderCADDocumentToSvg } from '../rendering/CADSVGRenderer';
import { validateCadDocumentForExport } from './CADExportValidator';
import { writeRoundTripDxf } from './DXFRoundTripWriter';
import { writeCleanDxf, writeCombinedCadAndNetworkDxf } from './DXFWriter';

export type CADExportFormat =
  | 'dxf-roundtrip'
  | 'dxf-clean'
  | 'dxf-combined'
  | 'svg'
  | 'html'
  | 'pdf-a4'
  | 'pdf-a3';

function escapeHtmlText(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function triggerDownload(content: BlobPart, mimeType: string, fileName: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function buildSafeCadExportFileName(baseName: string, suffix: string, ext: string): string {
  const clean = (baseName || 'hachihi_cad').replace(/[^\w\u00C0-\u1EF9-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${clean || 'hachihi_cad'}${suffix}.${ext}`;
}

export class CADExportService {
  exportToRoundTripDxfString(doc: CADDocument): string {
    validateCadDocumentForExport(doc);
    return writeRoundTripDxf(doc);
  }

  exportToCleanDxfString(doc: CADDocument): string {
    validateCadDocumentForExport(doc);
    return writeCleanDxf(doc);
  }

  exportCombinedDxfString(
    doc: CADDocument,
    project: ProjectState,
    options?: { floorScope?: string }
  ): string {
    validateCadDocumentForExport(doc);
    return writeCombinedCadAndNetworkDxf(doc, project, options);
  }

  exportToSvgString(doc: CADDocument): string {
    const fitExtents = computeSmartFitExtents(doc);
    const spanX = Math.max(1e-3, fitExtents.maxX - fitExtents.minX);
    const spanY = Math.max(1e-3, fitExtents.maxY - fitExtents.minY);
    const aspect = spanX / spanY;
    const width = aspect >= 1 ? 1800 : Math.max(800, Math.round(1400 * aspect));
    const height = aspect >= 1 ? Math.max(800, Math.round(1800 / aspect)) : 1400;
    return renderCADDocumentToSvg(doc, {
      width,
      height,
      lightBackground: false,
      extents: fitExtents,
      maxEntities: 120000,
      padding: Math.max(36, Math.round(Math.min(width, height) * 0.04))
    });
  }

  /**
   * Generates a standalone offline HTML viewer embedding crisp CAD vector SVG
   * with interactive mouse-wheel zoom, drag pan, Fit, Text toggle, Layer filter & Theme toggle.
   */
  exportToHtmlString(
    doc: CADDocument,
    options?: { lightBackground?: boolean; maxEntities?: number }
  ): string {
    const lightBg = Boolean(options?.lightBackground);
    const fitExtents = computeSmartFitExtents(doc);
    const spanX = Math.max(1e-3, fitExtents.maxX - fitExtents.minX);
    const spanY = Math.max(1e-3, fitExtents.maxY - fitExtents.minY);
    const aspect = spanX / spanY;
    const svgW = aspect >= 1 ? 1920 : Math.max(960, Math.round(1600 * aspect));
    const svgH = aspect >= 1 ? Math.max(960, Math.round(1920 / aspect)) : 1600;
    const pad = Math.max(48, Math.round(Math.min(svgW, svgH) * 0.055));
    const rawSvg = renderCADDocumentToSvg(doc, {
      width: svgW,
      height: svgH,
      lightBackground: lightBg,
      extents: fitExtents,
      padding: pad,
      maxEntities: options?.maxEntities ?? 150000,
      vectorEffectNonScalingStroke: true,
      fitMode: 'smart',
      minTextSvgSize: 0.12,
      tagEntitiesForInteractiveHtml: true
    });
    const safeTitle = escapeHtmlText(doc.name || 'HACHIHI CAD Drawing');
    const safeVersion = escapeHtmlText(doc.metadata.acadVersion.split(' ')[0]);
    const unitMeta = getCADUnitMeta(doc.header.$INSUNITS);
    const visibleLayerCount = Object.values(doc.layers).filter(l => l.visible && !l.frozen).length;

    const layerCounts: Record<string, number> = {};
    for (const ent of doc.entities) {
      const lbl = decodeAutoCadText(ent.layer);
      layerCounts[lbl] = (layerCounts[lbl] || 0) + 1;
    }
    const layerItems = Object.values(doc.layers)
      .filter(l => isCADLayerVisible(doc, l.name))
      .map(l => ({
        name: decodeAutoCadText(l.name),
        color: resolveLayerColorHex(l, lightBg),
        count: layerCounts[decodeAutoCadText(l.name)] || 0
      }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 80);

    const layerRowsHtml = layerItems
      .map(
        item => `<label class="layer-row">
          <input type="checkbox" checked data-layer-toggle="${escapeHtmlText(item.name)}" />
          <span class="swatch" style="background:${escapeHtmlText(item.color)}"></span>
          <span class="layer-name" title="${escapeHtmlText(item.name)}">${escapeHtmlText(item.name)}</span>
          <span class="layer-count">${item.count}</span>
        </label>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${safeTitle} — HACHIHI CAD Interactive Viewer</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: ${lightBg ? '#f8fafc' : '#0b111e'};
      color: ${lightBg ? '#0f172a' : '#f1f5f9'};
    }
    body.theme-light { background: #f8fafc; color: #0f172a; }
    body.theme-dark { background: #0b111e; color: #f1f5f9; }
    body.hide-cad-text .cad-text { display: none; }
    .topbar {
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(51, 65, 85, 0.9);
      color: #f8fafc;
      backdrop-filter: blur(8px);
      font-size: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
      max-width: calc(100vw - 24px);
    }
    .topbar .badge {
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(6, 182, 212, 0.18);
      color: #67e8f9;
      font-weight: 700;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .topbar .title {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 280px;
    }
    .topbar .meta {
      color: #94a3b8;
      font-size: 11px;
      white-space: nowrap;
    }
    #cad-stage {
      width: 100vw;
      height: 100vh;
      cursor: grab;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    #cad-stage.panning { cursor: grabbing; }
    #cad-stage svg {
      width: 100%;
      height: 100%;
      display: block;
      user-select: none;
    }
    @media print {
      .topbar, .hud, .layer-drawer { display: none !important; }
      html, body, #cad-stage {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      #cad-stage svg {
        width: 100% !important;
        height: 100% !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
      }
    }
    .layer-drawer {
      position: fixed;
      right: 16px;
      bottom: 66px;
      z-index: 25;
      width: 268px;
      max-height: 55vh;
      display: none;
      flex-direction: column;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(51, 65, 85, 0.95);
      color: #e2e8f0;
      backdrop-filter: blur(10px);
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.45);
      font-size: 12px;
    }
    .layer-drawer.open { display: flex; }
    .layer-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.8);
      font-weight: 600;
      font-size: 11px;
    }
    .layer-drawer-actions {
      display: flex;
      gap: 6px;
    }
    .layer-drawer-actions button {
      border: 1px solid rgba(71, 85, 105, 0.8);
      background: rgba(30, 41, 59, 0.9);
      color: #67e8f9;
      border-radius: 6px;
      padding: 2px 6px;
      font-size: 10px;
      cursor: pointer;
    }
    .layer-drawer-list {
      overflow-y: auto;
      padding: 4px 6px;
    }
    .layer-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;
    }
    .layer-row:hover { background: rgba(51, 65, 85, 0.45); }
    .layer-row .swatch {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      flex-shrink: 0;
      border: 1px solid rgba(255,255,255,0.25);
    }
    .layer-row .layer-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    }
    .layer-row .layer-count {
      font-size: 10px;
      color: #94a3b8;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .hud {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.9);
      border: 1px solid rgba(51, 65, 85, 0.9);
      color: #e2e8f0;
      backdrop-filter: blur(8px);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
      font-size: 12px;
    }
    .hud button {
      border: 1px solid transparent;
      background: transparent;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .hud button:hover { background: rgba(51, 65, 85, 0.75); color: #ffffff; }
    .hud button.primary { background: rgba(6, 182, 212, 0.22); color: #67e8f9; }
    .hud button.primary:hover { background: rgba(6, 182, 212, 0.36); color: #ffffff; }
    .hud button.active { background: rgba(16, 185, 129, 0.22); color: #6ee7b7; border-color: rgba(16, 185, 129, 0.4); }
    .hud .zoom-label {
      min-width: 52px;
      text-align: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 700;
      color: #22d3ee;
    }
    .hud .sep { width: 1px; height: 18px; background: rgba(71, 85, 105, 0.8); margin: 0 2px; }
    @media (max-width: 640px) { .topbar .meta { display: none; } }
  </style>
</head>
<body class="${lightBg ? 'theme-light' : 'theme-dark'}">
  <div class="topbar">
    <span class="badge">CAD HTML</span>
    <span class="title">${safeTitle}</span>
    <span class="meta">${safeVersion} · ${doc.entities.length.toLocaleString('vi-VN')} đối tượng · ${visibleLayerCount} lớp · ${escapeHtmlText(unitMeta.shortLabel)}</span>
  </div>

  <div id="cad-stage">${rawSvg}</div>

  <div class="layer-drawer" id="layer-drawer">
    <div class="layer-drawer-header">
      <span>Lớp CAD (${layerItems.length})</span>
      <div class="layer-drawer-actions">
        <button type="button" id="btn-layers-all">Hiện hết</button>
        <button type="button" id="btn-layers-none">Ẩn hết</button>
      </div>
    </div>
    <div class="layer-drawer-list">${layerRowsHtml || '<div style="padding:8px;color:#94a3b8;font-size:11px;">Không có lớp nào hiển thị.</div>'}</div>
  </div>

  <div class="hud" id="cad-hud">
    <button type="button" id="btn-zoom-out" title="Thu nhỏ (-)">−</button>
    <button type="button" id="btn-zoom-reset" class="zoom-label" title="Đặt lại 100%">100%</button>
    <button type="button" id="btn-zoom-in" title="Phóng to (+)">+</button>
    <div class="sep"></div>
    <button type="button" id="btn-zoom-fit" class="primary" title="Vừa cụm bản vẽ chính (F)">Vừa khung</button>
    <button type="button" id="btn-toggle-text" class="active" title="Bật / Tắt chữ & kích thước">Chữ</button>
    <button type="button" id="btn-toggle-layers" title="Bật / Tắt bảng Lớp CAD">Lớp</button>
    <button type="button" id="btn-toggle-bg" title="Đổi nền Sáng / Tối">Nền</button>
  </div>

  <script>
    (function () {
      var stage = document.getElementById('cad-stage');
      var svg = stage ? stage.querySelector('svg') : null;
      var zoomLabel = document.getElementById('btn-zoom-reset');
      var btnIn = document.getElementById('btn-zoom-in');
      var btnOut = document.getElementById('btn-zoom-out');
      var btnFit = document.getElementById('btn-zoom-fit');
      var btnBg = document.getElementById('btn-toggle-bg');
      var btnText = document.getElementById('btn-toggle-text');
      var btnLayers = document.getElementById('btn-toggle-layers');
      var drawer = document.getElementById('layer-drawer');
      var btnAll = document.getElementById('btn-layers-all');
      var btnNone = document.getElementById('btn-layers-none');
      if (!stage || !svg) return;

      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      var INITIAL = { x: 0, y: 0, w: ${svgW}, h: ${svgH} };
      var vb = { x: INITIAL.x, y: INITIAL.y, w: INITIAL.w, h: INITIAL.h };
      var MIN_W = 2;
      var MAX_W = INITIAL.w * 20;

      function applyViewBox() {
        svg.setAttribute('viewBox', vb.x.toFixed(2) + ' ' + vb.y.toFixed(2) + ' ' + vb.w.toFixed(2) + ' ' + vb.h.toFixed(2));
        if (zoomLabel) {
          var pct = Math.round((INITIAL.w / vb.w) * 100);
          zoomLabel.textContent = pct + '%';
        }
      }

      function zoomAtClient(factor, clientX, clientY) {
        var rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var scale = Math.max(vb.w / rect.width, vb.h / rect.height);
        var renderedW = vb.w / scale;
        var renderedH = vb.h / scale;
        var offsetX = (rect.width - renderedW) / 2;
        var offsetY = (rect.height - renderedH) / 2;
        var rx = (clientX - rect.left - offsetX) / Math.max(1, renderedW);
        var ry = (clientY - rect.top - offsetY) / Math.max(1, renderedH);
        var worldX = vb.x + rx * vb.w;
        var worldY = vb.y + ry * vb.h;
        var nextW = Math.max(MIN_W, Math.min(MAX_W, vb.w / factor));
        var nextH = (nextW / INITIAL.w) * INITIAL.h;
        vb.w = nextW;
        vb.h = nextH;
        vb.x = worldX - rx * vb.w;
        vb.y = worldY - ry * vb.h;
        applyViewBox();
      }

      function resetView() {
        vb = { x: INITIAL.x, y: INITIAL.y, w: INITIAL.w, h: INITIAL.h };
        applyViewBox();
      }

      stage.addEventListener('wheel', function (e) {
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomAtClient(factor, e.clientX, e.clientY);
      }, { passive: false });

      var dragging = false;
      var startClient = { x: 0, y: 0 };
      var startVb = { x: 0, y: 0 };

      stage.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.button !== 1) return;
        dragging = true;
        startClient = { x: e.clientX, y: e.clientY };
        startVb = { x: vb.x, y: vb.y };
        stage.classList.add('panning');
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      });

      stage.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var rect = stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var scale = Math.max(vb.w / rect.width, vb.h / rect.height);
        vb.x = startVb.x - (e.clientX - startClient.x) * scale;
        vb.y = startVb.y - (e.clientY - startClient.y) * scale;
        applyViewBox();
      });

      function endDrag() {
        dragging = false;
        stage.classList.remove('panning');
      }
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);

      if (btnIn) btnIn.addEventListener('click', function () {
        var r = stage.getBoundingClientRect();
        zoomAtClient(1.25, r.left + r.width / 2, r.top + r.height / 2);
      });
      if (btnOut) btnOut.addEventListener('click', function () {
        var r = stage.getBoundingClientRect();
        zoomAtClient(1 / 1.25, r.left + r.width / 2, r.top + r.height / 2);
      });
      if (btnFit) btnFit.addEventListener('click', resetView);
      if (zoomLabel) zoomLabel.addEventListener('click', resetView);
      if (btnBg) btnBg.addEventListener('click', function () {
        var bgRect = svg.querySelector('rect');
        var isLight = document.body.classList.contains('theme-light');
        if (isLight) {
          document.body.classList.remove('theme-light');
          document.body.classList.add('theme-dark');
          if (bgRect) bgRect.setAttribute('fill', '#0b111e');
        } else {
          document.body.classList.remove('theme-dark');
          document.body.classList.add('theme-light');
          if (bgRect) bgRect.setAttribute('fill', '#f8fafc');
        }
      });

      if (btnText) btnText.addEventListener('click', function () {
        var hidden = document.body.classList.toggle('hide-cad-text');
        btnText.classList.toggle('active', !hidden);
      });

      function setLayerVisible(layerName, visible) {
        var nodes = svg.querySelectorAll('[data-layer]');
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].getAttribute('data-layer') === layerName) {
            nodes[i].style.display = visible ? '' : 'none';
          }
        }
      }

      if (btnLayers && drawer) {
        btnLayers.addEventListener('click', function () {
          var isOpen = drawer.classList.toggle('open');
          btnLayers.classList.toggle('active', isOpen);
        });
        drawer.addEventListener('change', function (e) {
          var t = e.target;
          if (t && t.getAttribute && t.hasAttribute('data-layer-toggle')) {
            setLayerVisible(t.getAttribute('data-layer-toggle'), !!t.checked);
          }
        });
        if (btnAll) btnAll.addEventListener('click', function () {
          var boxes = drawer.querySelectorAll('input[data-layer-toggle]');
          for (var i = 0; i < boxes.length; i++) {
            boxes[i].checked = true;
            setLayerVisible(boxes[i].getAttribute('data-layer-toggle'), true);
          }
        });
        if (btnNone) btnNone.addEventListener('click', function () {
          var boxes = drawer.querySelectorAll('input[data-layer-toggle]');
          for (var i = 0; i < boxes.length; i++) {
            boxes[i].checked = false;
            setLayerVisible(boxes[i].getAttribute('data-layer-toggle'), false);
          }
        });
      }

      window.addEventListener('keydown', function (e) {
        if (e.key === 'f' || e.key === 'F') resetView();
        else if (e.key === '+' || e.key === '=') {
          var r1 = stage.getBoundingClientRect();
          zoomAtClient(1.2, r1.left + r1.width / 2, r1.top + r1.height / 2);
        } else if (e.key === '-') {
          var r2 = stage.getBoundingClientRect();
          zoomAtClient(1 / 1.2, r2.left + r2.width / 2, r2.top + r2.height / 2);
        }
      });

      applyViewBox();
    })();
  </script>
</body>
</html>`;
  }

  downloadRoundTripDxf(doc: CADDocument): void {
    const content = this.exportToRoundTripDxfString(doc);
    triggerDownload(content, 'application/dxf', buildSafeCadExportFileName(doc.name, '_roundtrip', 'dxf'));
  }

  downloadCleanDxf(doc: CADDocument): void {
    const content = this.exportToCleanDxfString(doc);
    triggerDownload(content, 'application/dxf', buildSafeCadExportFileName(doc.name, '_clean', 'dxf'));
  }

  downloadCombinedDxf(
    doc: CADDocument,
    project: ProjectState,
    options?: { floorScope?: string }
  ): void {
    const content = this.exportCombinedDxfString(doc, project, options);
    triggerDownload(
      content,
      'application/dxf',
      buildSafeCadExportFileName(`${doc.name}_${project.name}`, '_combined', 'dxf')
    );
  }

  downloadSvg(doc: CADDocument): void {
    const svg = this.exportToSvgString(doc);
    triggerDownload(svg, 'image/svg+xml;charset=utf-8', buildSafeCadExportFileName(doc.name, '', 'svg'));
  }

  downloadHtml(doc: CADDocument, options?: { lightBackground?: boolean }): void {
    const html = this.exportToHtmlString(doc, options);
    triggerDownload(html, 'text/html;charset=utf-8', buildSafeCadExportFileName(doc.name, '_viewer', 'html'));
  }

  async exportToPdfArtifact(
    doc: CADDocument,
    options?: ExportCadPdfOptions
  ): Promise<CadPdfArtifact> {
    return buildCadDocumentPdfArtifact(doc, options);
  }

  async downloadPdf(
    doc: CADDocument,
    options?: ExportCadPdfOptions
  ): Promise<CadPdfArtifact> {
    return exportCadDocumentToPdf(doc, options);
  }
}

export const cadExportService = new CADExportService();

