import type { ProjectState } from '../../types/infrastructure';
import {
  ExportBundleConfig,
  ExportContentScope,
  ExportDxfOptions,
  ExportFloorLayerMap,
  ExportFloorMetadata,
  ExportFloorScope,
  ExportFloorSummary,
  ExportHtmlViewerConfig,
  ExportPdfConfig,
  ExportPngConfig,
  PdfViewportTransformConfig,
  PdfViewportTransformResult,
  SerializedHachihiProjectData,
  sanitizeExportBaseName,
  triggerBlobDownload
} from './exportTypes';

const FLOOR_BASED_MODES = new Set(['floorplan', 'cctv', 'wifi', 'fiber']);

function escapeAttrAndText(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeSerializeJsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Scans ProjectState for floor definitions and maps rooms, nodes, racks, and cables to each floor.
 */
export function scanProjectFloors(
  project: ProjectState,
  floorScope: ExportFloorScope = 'all'
): ExportFloorMetadata {
  const sortedFloors = [...(project.floors || [])]
    .filter((f): f is NonNullable<typeof f> => Boolean(f && f.id))
    .sort((a, b) => a.level - b.level);
  const rooms = project.rooms || [];
  const nodes = (project.nodes || []).filter(n => !n.hidden);
  const racks = project.racks || [];
  const cables = project.cables || [];

  const roomFloorById = new Map<string, string>();
  for (const r of rooms) {
    roomFloorById.set(r.id, r.floorId);
  }

  const buildingFloorHeight = project.buildings?.[0]?.floorHeightMeters ?? 3.5;

  const nodeFloorById = new Map<string, string>();
  for (const n of nodes) {
    const assetRoomId = n.assetId ? project.assets?.[n.assetId]?.roomId : undefined;
    const fId = n.floorId || (assetRoomId ? roomFloorById.get(assetRoomId) : undefined) || project.activeFloorId;
    if (fId) nodeFloorById.set(n.id, fId);
  }

  const summaries: ExportFloorSummary[] = sortedFloors.map(floor => {
    const roomCount = rooms.filter(r => r.floorId === floor.id).length;
    const floorNodes = nodes.filter(n => nodeFloorById.get(n.id) === floor.id);
    const floorNodeIds = new Set(floorNodes.map(n => n.id));
    const rackCountFromRacks = racks.filter(r => {
      if (r.roomId && roomFloorById.get(r.roomId) === floor.id) return true;
      const matchingRackNode = floorNodes.find(
        n => n.customData?.rackId === r.id || (n.assetId && project.assets?.[n.assetId]?.rackId === r.id)
      );
      return Boolean(matchingRackNode);
    }).length;
    const rackCountFromNodes = floorNodes.filter(n => n.type === 'rack').length;
    const rackCount = Math.max(rackCountFromRacks, rackCountFromNodes);
    const cableCount = cables.filter(
      c => floorNodeIds.has(c.sourceNodeId) || floorNodeIds.has(c.targetNodeId)
    ).length;

    return {
      id: floor.id,
      name: floor.name,
      level: floor.level,
      buildingId: floor.buildingId,
      elevationMeters: Math.round((floor.level - 1) * buildingFloorHeight * 100) / 100,
      widthMeters: floor.widthMeters ?? 20,
      heightMeters: floor.depthMeters ?? 14,
      roomCount,
      nodeCount: floorNodes.length,
      rackCount,
      cableCount
    };
  });

  const hasMultipleFloors = summaries.length > 1;
  const isFloorBasedMode = FLOOR_BASED_MODES.has(project.activeMode);
  let resolvedFloorId: '__ALL__' | string = '__ALL__';

  if (!hasMultipleFloors) {
    resolvedFloorId = summaries[0]?.id || project.activeFloorId || '__SINGLE__';
  } else if (floorScope === 'active') {
    resolvedFloorId = summaries.some(f => f.id === project.activeFloorId)
      ? project.activeFloorId
      : '__ALL__';
  } else if (floorScope === 'all' || floorScope === '__ALL__' || !floorScope) {
    resolvedFloorId = '__ALL__';
  } else if (summaries.some(f => f.id === floorScope)) {
    resolvedFloorId = floorScope;
  }

  return {
    hasMultipleFloors,
    totalFloors: summaries.length,
    activeFloorId: project.activeFloorId,
    requestedFloorScope: floorScope,
    resolvedFloorId,
    isFloorBasedMode,
    floors: summaries
  };
}

/**
 * Serializes floor definitions, layer ownership maps, and metadata for client-side HTML viewer hydration.
 */
export function serializeFloorContext(
  project: ProjectState,
  floorScope: ExportFloorScope = 'all'
): SerializedHachihiProjectData {
  const floorMetadata = scanProjectFloors(project, floorScope);
  const rooms = project.rooms || [];
  const nodes = (project.nodes || []).filter(n => !n.hidden);
  const racks = project.racks || [];
  const cables = project.cables || [];

  const roomFloorById = new Map<string, string>();
  rooms.forEach(r => roomFloorById.set(r.id, r.floorId));

  const nodeFloorById = new Map<string, string>();
  nodes.forEach(n => {
    const assetRoomId = n.assetId ? project.assets?.[n.assetId]?.roomId : undefined;
    const fId = n.floorId || (assetRoomId ? roomFloorById.get(assetRoomId) : undefined) || project.activeFloorId;
    if (fId) nodeFloorById.set(n.id, fId);
  });

  const floorLayerIds: ExportFloorLayerMap = {};
  for (const floor of floorMetadata.floors) {
    const roomIds = rooms.filter(r => r.floorId === floor.id).map(r => r.id);
    const floorNodes = nodes.filter(n => nodeFloorById.get(n.id) === floor.id);
    const nodeIds = floorNodes.map(n => n.id);
    const nodeIdSet = new Set(nodeIds);
    const rackIds = racks
      .filter(
        r =>
          (r.roomId && roomFloorById.get(r.roomId) === floor.id) ||
          floorNodes.some(
            n => n.customData?.rackId === r.id || (n.assetId && project.assets?.[n.assetId]?.rackId === r.id)
          )
      )
      .map(r => r.id);
    const cableIds = cables
      .filter(c => nodeIdSet.has(c.sourceNodeId) || nodeIdSet.has(c.targetNodeId))
      .map(c => c.id);

    floorLayerIds[floor.id] = { roomIds, nodeIds, rackIds, cableIds };
  }

  return {
    id: project.id,
    name: project.name,
    author: project.author,
    version: project.version,
    activeMode: project.activeMode,
    activeBuildingId: project.activeBuildingId,
    activeFloorId: project.activeFloorId,
    activeFloorScope: floorMetadata.resolvedFloorId,
    floorMetadata,
    floors: floorMetadata.floors,
    floorLayerIds
  };
}

/**
 * Generates an accessible, clickable tab navigation strip for toggling between floors
 * in static exported HTML viewers when the project has more than one floor.
 */
export function buildFloorNavigationBarHtml(
  floorMetadata: ExportFloorMetadata,
  activeFloorSelection: string = floorMetadata.resolvedFloorId
): string {
  if (!floorMetadata.hasMultipleFloors) return '';

  const allSelected = activeFloorSelection === '__ALL__' || !activeFloorSelection;
  const allBtn = `<button type="button" class="floor-nav-btn${allSelected ? ' active' : ''}" data-floor-nav="__ALL__" aria-pressed="${allSelected ? 'true' : 'false'}" title="Hiển thị toàn bộ ${floorMetadata.totalFloors} tầng cùng lúc"><span>Toàn bộ tòa nhà</span><span class="floor-nav-count">${floorMetadata.totalFloors} tầng</span></button>`;

  const floorBtns = floorMetadata.floors
    .map(floor => {
      const isSelected = activeFloorSelection === floor.id;
      const countText = `${floor.nodeCount} TB`;
      const tooltip = `${floor.name} · ${floor.roomCount} phòng · ${floor.nodeCount} thiết bị · ${floor.cableCount} cáp`;
      return `<button type="button" class="floor-nav-btn${isSelected ? ' active' : ''}" data-floor-nav="${escapeAttrAndText(floor.id)}" aria-pressed="${isSelected ? 'true' : 'false'}" title="${escapeAttrAndText(tooltip)}"><span>${escapeAttrAndText(floor.name)}</span><span class="floor-nav-count">${escapeAttrAndText(countText)}</span></button>`;
    })
    .join('');

  return `<nav id="floorNavBar" class="floor-nav-bar" aria-label="Điều hướng tầng tòa nhà">
    <span class="floor-nav-label">Tầng hiển thị:</span>
    <div class="floor-nav-tabs" role="tablist" aria-label="Danh sách tầng">${allBtn}${floorBtns}</div>
  </nav>`;
}

/**
 * Guarantees any exported HTML document carries serialized window.HachihiProjectData,
 * #hachihi-floor-metadata JSON, clickable #floorNavBar (if multi-floor), and client-side
 * canvas-layer show/hide synchronization without server-side reloads.
 */
export function injectFloorNavigationIntoHtml(
  html: string,
  project: ProjectState,
  floorScope: ExportFloorScope = 'all'
): string {
  const floorContext = serializeFloorContext(project, floorScope);
  const metadataJson = safeSerializeJsonForScript(floorContext);
  let output = html;

  if (!output.includes('id="hachihi-floor-metadata"')) {
    const metadataTag = `<script type="application/json" id="hachihi-floor-metadata">${metadataJson}</script>`;
    output = output.includes('</body>')
      ? output.replace('</body>', `${metadataTag}\n</body>`)
      : `${output}\n${metadataTag}`;
  }

  if (!output.includes('window.HachihiProjectData')) {
    const hydrateScript = `<script>
(function(){
  try {
    var metaEl = document.getElementById('hachihi-floor-metadata');
    var parsedMeta = metaEl ? JSON.parse(metaEl.textContent || '{}') : ${metadataJson};
    window.HachihiProjectData = Object.assign(window.HachihiProjectData || {}, parsedMeta);
  } catch (e) {}
})();
</script>`;
    output = output.includes('</body>')
      ? output.replace('</body>', `${hydrateScript}\n</body>`)
      : `${output}\n${hydrateScript}`;
  }

  return output;
}

export const ExportService = {
  scanProjectFloors(project: ProjectState, floorScope: ExportFloorScope = 'all'): ExportFloorMetadata {
    return scanProjectFloors(project, floorScope);
  },

  getFloorMetadata(project: ProjectState, floorScope: ExportFloorScope = 'all'): ExportFloorMetadata {
    return scanProjectFloors(project, floorScope);
  },

  serializeFloorContext(
    project: ProjectState,
    floorScope: ExportFloorScope = 'all'
  ): SerializedHachihiProjectData {
    return serializeFloorContext(project, floorScope);
  },

  buildFloorNavigationHtml(
    project: ProjectState,
    floorScope: ExportFloorScope = 'all'
  ): string {
    const meta = scanProjectFloors(project, floorScope);
    return buildFloorNavigationBarHtml(meta, meta.resolvedFloorId);
  },

  async exportPng(project: ProjectState, config: ExportPngConfig) {
    const { runExportPng } = await import('./exportPng');
    return runExportPng(project, config);
  },

  async exportSvg(
    project: ProjectState,
    contentScope: ExportContentScope = '2d',
    floorScope: ExportFloorScope = 'all'
  ) {
    const { runExportSvg } = await import('./exportSvg');
    return runExportSvg(project, contentScope, floorScope);
  },

  async exportDxf(
    project: ProjectState,
    contentScope: ExportContentScope = '2d',
    floorScope: ExportFloorScope = 'all',
    options?: ExportDxfOptions
  ) {
    const { runExportDxf } = await import('./exportDxf');
    return runExportDxf(project, contentScope, floorScope, options);
  },

  async computePdfViewportTransform(
    project: ProjectState,
    config?: PdfViewportTransformConfig
  ): Promise<PdfViewportTransformResult> {
    const [{ computePureDiagramBounds }, { computeA4ScaleMetrics, computePdfViewportFitScale }, { computeSmartFitExtents }] =
      await Promise.all([
        import('../../utils/svgExport'),
        import('../../utils/pdfScale'),
        import('../../cad/geometry/CADBounds')
      ]);

    const paperSize = config?.paperSize || 'A4';
    const orientation = config?.orientation || 'landscape';
    const autoFit = config?.autoFit ?? true;
    const includeLegendPanel = config?.includeLegendPanel ?? true;

    let boundingBox: { minX: number; minY: number; width: number; height: number };
    if (config?.cadDocument) {
      const ext = computeSmartFitExtents(config.cadDocument);
      boundingBox = {
        minX: ext.minX,
        minY: ext.minY,
        width: Math.max(1, ext.maxX - ext.minX),
        height: Math.max(1, ext.maxY - ext.minY)
      };
    } else {
      const floorScopeId =
        config?.floorScope === 'active'
          ? project.activeFloorId
          : config?.floorScope === 'all' || !config?.floorScope
            ? '__ALL__'
            : config.floorScope;
      boundingBox = computePureDiagramBounds(project, { floorScopeId });
    }

    const scaleMatch = config?.drawingScale?.match(/1\s*:\s*(\d+(?:\.\d+)?)/);
    const targetScaleDenominator = scaleMatch ? Number(scaleMatch[1]) : undefined;
    const metrics = computeA4ScaleMetrics(boundingBox, project.settings.scale, orientation, {
      includeLegendPanel,
      paperSize,
      autoFit,
      targetScaleDenominator,
      margins: config?.margins
    });

    const transform = computePdfViewportFitScale(
      boundingBox.width,
      boundingBox.height,
      metrics.drawAreaWidthMm,
      metrics.drawAreaHeightMm,
      {
        autoFit,
        paddingMm: 2,
        targetScaleDenominator,
        pxPerMeter: project.settings.scale
      }
    );

    return {
      boundingBox,
      viewportMm: {
        width: metrics.drawAreaWidthMm,
        height: metrics.drawAreaHeightMm
      },
      transform,
      marginsMm: metrics.marginsMm,
      scaleRatioLabel: metrics.scaleRatioLabel,
      autoFit
    };
  },

  async exportPdf(project: ProjectState, config: ExportPdfConfig) {
    const { runExportPdf } = await import('./exportPdf');
    return runExportPdf(project, config);
  },

  async exportBundle(project: ProjectState, config: ExportBundleConfig) {
    const { runExportBundle } = await import('./exportBundle');
    return runExportBundle(project, config);
  },

  async generateHtmlViewerString(
    project: ProjectState,
    options?: ExportHtmlViewerConfig
  ): Promise<string> {
    const { generateStandaloneViewerHtmlAsync } = await import('../../utils/htmlViewerExporter');
    const rawHtml = await generateStandaloneViewerHtmlAsync(project, options);
    return injectFloorNavigationIntoHtml(rawHtml, project, options?.floorScope ?? 'all');
  },

  async exportHtmlViewer(project: ProjectState, options?: ExportHtmlViewerConfig) {
    const html = await this.generateHtmlViewerString(project, options);
    const baseName = sanitizeExportBaseName(project.name);
    const suffix = options?.contentScope === '3d' ? '_3D_Viewer.html' : '_Viewer.html';
    const filename = `${baseName}${suffix}`;
    triggerBlobDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
    const { trackExport } = await import('../../services/tracker');
    trackExport(`html:${options?.contentScope || '2d'}`);
    return { filename };
  }
};

export * from './exportTypes';
