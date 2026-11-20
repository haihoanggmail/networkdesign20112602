import type { CanvasPerformanceMode } from '../../types/infrastructure';
import { resolveCanvasPerformancePolicy } from '../../utils/canvasPerformance';
import { Quadtree } from '../../utils/spatialIndex';
import { resolveEntityColorHex } from '../core/CADColorPalette';
import { isCADEntityInSpace, isCADLayerVisible } from '../core/CADDocument';
import {
  Affine2D,
  IDENTITY_2D,
  applyAffine2D,
  buildInsertTransform2D,
  decomposeAffine2D
} from '../core/CADTransform';
import type { CADDocument, CADEntity, CADSpaceFilter, Point2D } from '../core/CADTypes';
import { cadPointToNetworkCanvas } from '../core/CADUnderlayTransform';
import { computeEntityBounds2D, isValidBounds } from '../geometry/CADBounds';
import { decodeAutoCadText, stripMTextFormatting, tessellateEllipse, tessellatePolyline, tessellateSpline } from '../geometry/CADCurve';
import { extractViewportSummary } from '../geometry/CADGeometry';
import {
  CADInteractionOverlay,
  renderCADSelectionAndOverlays
} from './CADSelectionRenderer';
import {
  renderCADDimensionLabel,
  renderCADMTextEntity,
  renderCADTextEntity
} from './CADTextRenderer';
import {
  CADViewportState,
  cadWorldToScreen,
  getVisibleWorldBounds
} from './CADViewport';

const MAX_INSERT_RENDER_DEPTH = 20;

export interface CADRenderOptions {
  lightBackground?: boolean;
  showGrid?: boolean;
  selectedIds?: Set<string>;
  hoveredId?: string | null;
  overlay?: CADInteractionOverlay;
  performanceMode?: CanvasPerformanceMode;
  /** Filter entities rendered by CAD space ('model' | 'paper' | 'all') */
  activeSpace?: CADSpaceFilter;
  /** True while actively dragging/panning; uses cached bitmap snapshot when available */
  isPanning?: boolean;
  /** Hides tiny text & sub-pixel entities when deeply zoomed out (defaults to true) */
  cullTinyDetailsOnZoomOut?: boolean;
}

export interface CADRenderStats {
  renderedCount: number;
  skippedDetailCount: number;
  totalCount: number;
  usedPanCache: boolean;
}

export interface CADDetailCullingThresholds {
  minTextPx: number;
  minDimPx: number;
  minEntityExtentPx: number;
  minLineLengthPx: number;
  minCircleRadiusPx: number;
  skipHatchFill: boolean;
}

export function resolveCadDetailCullingThresholds(
  mode: CanvasPerformanceMode | undefined,
  entityCount: number,
  lowDetailMode: boolean
): CADDetailCullingThresholds {
  if (mode === 'high_quality') {
    return {
      minTextPx: 2.2,
      minDimPx: 8,
      minEntityExtentPx: 1,
      minLineLengthPx: 0.4,
      minCircleRadiusPx: 0.4,
      skipHatchFill: false
    };
  }
  const isHeavy = entityCount > 1200 || mode === 'high_performance';
  return {
    minTextPx: isHeavy || lowDetailMode ? 6.0 : 3.8,
    minDimPx: isHeavy || lowDetailMode ? 22 : 14,
    minEntityExtentPx: isHeavy || lowDetailMode ? 2.5 : 1.2,
    minLineLengthPx: isHeavy || lowDetailMode ? 1.1 : 0.7,
    minCircleRadiusPx: isHeavy || lowDetailMode ? 1.0 : 0.6,
    skipHatchFill: lowDetailMode && isHeavy
  };
}

function getLineDashForEntity(entity: CADEntity, doc: CADDocument): number[] {
  const ltName =
    entity.lineType && entity.lineType !== 'BYLAYER' && entity.lineType !== 'BYBLOCK'
      ? entity.lineType.toUpperCase()
      : (doc.layers[entity.layer]?.lineType || 'CONTINUOUS').toUpperCase();

  if (!ltName || ltName === 'CONTINUOUS' || ltName === 'BYLAYER') return [];
  if (ltName.includes('DASH')) return [8, 5];
  if (ltName.includes('CENTER')) return [14, 4, 3, 4];
  if (ltName.includes('DOT')) return [2, 4];
  if (ltName.includes('HIDDEN')) return [5, 4];
  const lt = doc.lineTypes[ltName];
  if (lt && lt.pattern.length > 0) {
    return lt.pattern.slice(0, 6).map(v => Math.max(2, Math.min(20, Math.abs(v) || 2)));
  }
  return [];
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: CADViewportState, lightBg: boolean): void {
  const vis = getVisibleWorldBounds(vp, 0);
  const worldSpan = Math.max(vis.maxX - vis.minX, vis.maxY - vis.minY);
  const rawStep = worldSpan / 14;
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1e-3, rawStep))));
  let step = pow10;
  if (rawStep / pow10 > 5) step = pow10 * 5;
  else if (rawStep / pow10 > 2) step = pow10 * 2;

  const startX = Math.floor(vis.minX / step) * step;
  const startY = Math.floor(vis.minY / step) * step;

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = lightBg ? 'rgba(148, 163, 184, 0.22)' : 'rgba(51, 65, 85, 0.36)';

  ctx.beginPath();
  for (let x = startX; x <= vis.maxX; x += step) {
    const s = cadWorldToScreen({ x, y: 0 }, vp);
    ctx.moveTo(s.x, 0);
    ctx.lineTo(s.x, vp.height);
  }
  for (let y = startY; y <= vis.maxY; y += step) {
    const s = cadWorldToScreen({ x: 0, y }, vp);
    ctx.moveTo(0, s.y);
    ctx.lineTo(vp.width, s.y);
  }
  ctx.stroke();

  // Origin axes (0,0)
  const origin = cadWorldToScreen({ x: 0, y: 0 }, vp);
  if (origin.x >= -50 && origin.x <= vp.width + 50 && origin.y >= -50 && origin.y <= vp.height + 50) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(origin.x + 28, origin.y);
    ctx.stroke();

    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(origin.x, origin.y - 28);
    ctx.stroke();
  }
  ctx.restore();
}

export class CADCanvasRenderer {
  private spatialTree: Quadtree<CADEntity> | null = null;
  private cachedDocRef: CADDocument | null = null;
  private cachedEntityCount = -1;
  private cachedUpdatedAt = '';
  private panCacheCanvas: HTMLCanvasElement | null = null;
  private panCacheMeta: {
    docId: string;
    updatedAt: string;
    entityCount: number;
    lightBackground: boolean;
    activeSpace: CADSpaceFilter;
    vp: CADViewportState;
    dpr: number;
  } | null = null;

  invalidatePanCache(): void {
    this.panCacheMeta = null;
  }

  hasValidPanCache(
    doc: CADDocument,
    vp: CADViewportState,
    lightBackground: boolean,
    activeSpace: CADSpaceFilter = 'all'
  ): boolean {
    if (!this.panCacheCanvas || !this.panCacheMeta) return false;
    const m = this.panCacheMeta;
    return (
      m.docId === doc.id &&
      m.updatedAt === doc.updatedAt &&
      m.entityCount === doc.entities.length &&
      m.lightBackground === lightBackground &&
      m.activeSpace === activeSpace &&
      Math.abs(m.vp.scale - vp.scale) <= 1e-9 * Math.max(1, vp.scale)
    );
  }

  updateBitmapCacheFromCanvas(
    sourceCanvas: HTMLCanvasElement,
    doc: CADDocument,
    vp: CADViewportState,
    lightBackground: boolean,
    dpr: number,
    activeSpace: CADSpaceFilter = 'all'
  ): void {
    if (typeof document === 'undefined' || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
      return;
    }
    if (!this.panCacheCanvas) {
      this.panCacheCanvas = document.createElement('canvas');
    }
    if (
      this.panCacheCanvas.width !== sourceCanvas.width ||
      this.panCacheCanvas.height !== sourceCanvas.height
    ) {
      this.panCacheCanvas.width = sourceCanvas.width;
      this.panCacheCanvas.height = sourceCanvas.height;
    }
    const cacheCtx = this.panCacheCanvas.getContext('2d');
    if (!cacheCtx) return;
    cacheCtx.clearRect(0, 0, this.panCacheCanvas.width, this.panCacheCanvas.height);
    cacheCtx.drawImage(sourceCanvas, 0, 0);
    this.panCacheMeta = {
      docId: doc.id,
      updatedAt: doc.updatedAt,
      entityCount: doc.entities.length,
      lightBackground,
      activeSpace,
      vp: { ...vp },
      dpr
    };
  }

  /**
   * Allows tests or headless environments to attach an offscreen bitmap cache surface directly.
   */
  setPanCacheForTest(
    cacheSurface: HTMLCanvasElement,
    doc: CADDocument,
    vp: CADViewportState,
    lightBackground: boolean,
    dpr = 1,
    activeSpace: CADSpaceFilter = 'all'
  ): void {
    this.panCacheCanvas = cacheSurface;
    this.panCacheMeta = {
      docId: doc.id,
      updatedAt: doc.updatedAt,
      entityCount: doc.entities.length,
      lightBackground,
      activeSpace,
      vp: { ...vp },
      dpr
    };
  }

  getSpatialTree(doc: CADDocument): Quadtree<CADEntity> {
    if (
      this.spatialTree &&
      this.cachedDocRef === doc &&
      this.cachedEntityCount === doc.entities.length &&
      this.cachedUpdatedAt === doc.updatedAt
    ) {
      return this.spatialTree;
    }

    this.spatialTree = Quadtree.fromItems(
      doc.entities,
      ent => {
        const eb = ent.bounds && isValidBounds(ent.bounds) ? ent.bounds : computeEntityBounds2D(ent, doc.blocks);
        if (!isValidBounds(eb)) return null;
        return {
          x: eb.minX,
          y: eb.minY,
          width: Math.max(1, eb.maxX - eb.minX),
          height: Math.max(1, eb.maxY - eb.minY)
        };
      },
      { maxItems: 24, maxDepth: 8 }
    );
    this.cachedDocRef = doc;
    this.cachedEntityCount = doc.entities.length;
    this.cachedUpdatedAt = doc.updatedAt;
    return this.spatialTree;
  }

  queryVisibleEntities(doc: CADDocument, vp: CADViewportState): CADEntity[] {
    const vis = getVisibleWorldBounds(vp, 80);
    const tree = this.getSpatialTree(doc);
    return tree.queryRect({
      x: vis.minX,
      y: vis.minY,
      width: Math.max(1, vis.maxX - vis.minX),
      height: Math.max(1, vis.maxY - vis.minY)
    });
  }

  render(
    ctx: CanvasRenderingContext2D,
    doc: CADDocument,
    vp: CADViewportState,
    options?: CADRenderOptions
  ): CADRenderStats {
    const lightBg = Boolean(options?.lightBackground);
    const activeSpace: CADSpaceFilter = options?.activeSpace ?? 'all';
    ctx.save();
    ctx.fillStyle = lightBg ? '#f8fafc' : '#0b111e';
    ctx.fillRect(0, 0, vp.width, vp.height);

    // Bitmap Caching fast-path while panning: translate snapshot instead of re-tessellating all vectors
    if (options?.isPanning && this.hasValidPanCache(doc, vp, lightBg, activeSpace) && this.panCacheCanvas && this.panCacheMeta) {
      if (options?.showGrid !== false) {
        drawGrid(ctx, vp, lightBg);
      }
      const oldVp = this.panCacheMeta.vp;
      const dx = (oldVp.centerX - vp.centerX) * vp.scale + (vp.width - oldVp.width) / 2;
      const dy = (vp.centerY - oldVp.centerY) * vp.scale + (vp.height - oldVp.height) / 2;
      ctx.drawImage(this.panCacheCanvas, dx, dy, oldVp.width, oldVp.height);
      if (options?.overlay) {
        renderCADSelectionAndOverlays(ctx, [], vp, options.overlay);
      }
      ctx.restore();
      return {
        renderedCount: doc.entities.length,
        skippedDetailCount: 0,
        totalCount: doc.entities.length,
        usedPanCache: true
      };
    }

    if (options?.showGrid !== false) {
      drawGrid(ctx, vp, lightBg);
    }

    const perfPolicy = resolveCanvasPerformancePolicy(options?.performanceMode, {
      nodeCount: 0,
      cableCount: 0,
      rackCount: 0,
      roomCount: 0,
      trayCount: 0,
      cadEntityCount: doc.entities.length,
      zoom: vp.scale,
      isPanning: Boolean(options?.isPanning)
    });

    const cullDetails = options?.cullTinyDetailsOnZoomOut !== false;
    const detailThresholds = resolveCadDetailCullingThresholds(
      options?.performanceMode,
      doc.entities.length,
      perfPolicy.lowDetailMode
    );

    const candidates =
      doc.entities.length > perfPolicy.cullingThresholds.cadEntities
        ? this.queryVisibleEntities(doc, vp)
        : doc.entities;

    let renderedCount = 0;
    let skippedDetailCount = 0;
    const selectedEntities: CADEntity[] = [];

    for (const ent of candidates) {
      if (ent.visible === false) continue;
      if (!isCADEntityInSpace(ent, activeSpace)) continue;
      if (!isCADLayerVisible(doc, ent.layer)) continue;

      const isSelected = Boolean(options?.selectedIds?.has(ent.id));
      const isHovered = options?.hoveredId === ent.id;
      if (isSelected) selectedEntities.push(ent);

      const drew = this.drawEntity(ctx, ent, doc, vp, {
        lightBackground: lightBg,
        isSelected,
        isHovered,
        transform: IDENTITY_2D,
        depth: 0,
        visitedBlocks: new Set<string>(),
        cullDetails,
        detailThresholds
      });
      if (drew) renderedCount++;
      else skippedDetailCount++;
    }

    renderCADSelectionAndOverlays(ctx, selectedEntities, vp, options?.overlay);
    ctx.restore();

    return {
      renderedCount,
      skippedDetailCount,
      totalCount: doc.entities.length,
      usedPanCache: false
    };
  }

  private drawEntity(
    ctx: CanvasRenderingContext2D,
    entity: CADEntity,
    doc: CADDocument,
    vp: CADViewportState,
    state: {
      lightBackground: boolean;
      isSelected: boolean;
      isHovered: boolean;
      parentBlockColorHex?: string;
      transform: Affine2D;
      depth: number;
      visitedBlocks: Set<string>;
      cullDetails: boolean;
      detailThresholds: CADDetailCullingThresholds;
    }
  ): boolean {
    const allowSkip = state.cullDetails && !state.isSelected && !state.isHovered;
    const th = state.detailThresholds;

    // Early bounds-based sub-pixel cull for top-level entities on deep zoom out
    if (allowSkip && state.depth === 0 && entity.bounds && isValidBounds(entity.bounds)) {
      const spanPx = Math.max(
        (entity.bounds.maxX - entity.bounds.minX) * vp.scale,
        (entity.bounds.maxY - entity.bounds.minY) * vp.scale
      );
      if (entity.type !== 'POINT' && spanPx < th.minEntityExtentPx) {
        return false;
      }
    }

    if (allowSkip && (entity.type === 'TEXT' || entity.type === 'ATTRIB' || entity.type === 'ATTDEF' || entity.type === 'MTEXT')) {
      const dec = state.transform === IDENTITY_2D ? null : decomposeAffine2D(state.transform);
      const scaleAvg = dec ? (Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2 : 1;
      const fontSizePx = entity.height * scaleAvg * vp.scale;
      if (fontSizePx < th.minTextPx) {
        return false;
      }
    }

    if (allowSkip && entity.type === 'POINT' && th.minEntityExtentPx >= 2.0) {
      return false;
    }

    if (allowSkip && entity.type === 'HATCH' && th.skipHatchFill) {
      return false;
    }

    const baseColor = resolveEntityColorHex(entity, doc, {
      lightBackground: state.lightBackground,
      parentBlockColorHex: state.parentBlockColorHex
    });
    const strokeColor = state.isSelected ? '#38bdf8' : state.isHovered ? '#facc15' : baseColor;
    const lineWidth = state.isSelected ? 2 : state.isHovered ? 1.8 : 1.15;

    const toScreen = (p: Point2D): Point2D =>
      cadWorldToScreen(applyAffine2D(state.transform, p), vp);

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(state.isSelected ? [] : getLineDashForEntity(entity, doc));

    let didDraw = true;

    switch (entity.type) {
      case 'LINE': {
        const a = toScreen(entity.start);
        const b = toScreen(entity.end);
        if (allowSkip && Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < th.minLineLengthPx) {
          didDraw = false;
          break;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        break;
      }
      case 'POINT': {
        const p = toScreen(entity.position);
        ctx.beginPath();
        ctx.moveTo(p.x - 3, p.y - 3);
        ctx.lineTo(p.x + 3, p.y + 3);
        ctx.moveTo(p.x + 3, p.y - 3);
        ctx.lineTo(p.x - 3, p.y + 3);
        ctx.stroke();
        break;
      }
      case 'CIRCLE': {
        const c = toScreen(entity.center);
        const dec = decomposeAffine2D(state.transform);
        const rPx = entity.radius * ((Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2) * vp.scale;
        if (rPx < (allowSkip ? th.minCircleRadiusPx : 0.4)) {
          didDraw = false;
          break;
        }
        ctx.beginPath();
        ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'ARC': {
        const c = toScreen(entity.center);
        const dec = decomposeAffine2D(state.transform);
        const rPx = entity.radius * ((Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2) * vp.scale;
        if (rPx < (allowSkip ? th.minCircleRadiusPx : 0.4)) {
          didDraw = false;
          break;
        }
        const sRad = (-(entity.startAngle + dec.rotationDeg) * Math.PI) / 180;
        const eRad = (-(entity.endAngle + dec.rotationDeg) * Math.PI) / 180;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rPx, sRad, eRad, !dec.hasNegativeFlip);
        ctx.stroke();
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pts = tessellatePolyline(entity.vertices, entity.closed, 16);
        if (pts.length >= 2) {
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const sp = toScreen(pts[i]);
            if (i === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'SPLINE': {
        const pts = tessellateSpline(entity, 36);
        if (pts.length >= 2) {
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const sp = toScreen(pts[i]);
            if (i === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'ELLIPSE': {
        const pts = tessellateEllipse(entity, 36);
        if (pts.length >= 2) {
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const sp = toScreen(pts[i]);
            if (i === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'HATCH': {
        ctx.save();
        ctx.globalAlpha = entity.solidFill ? 0.25 : 0.14;
        for (const loop of entity.boundaryLoops) {
          if (loop.length < 2) continue;
          ctx.beginPath();
          loop.forEach((p, idx) => {
            const sp = toScreen(p);
            if (idx === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          });
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.55;
          ctx.stroke();
          ctx.globalAlpha = entity.solidFill ? 0.25 : 0.14;
        }
        ctx.restore();
        break;
      }
      case 'SOLID':
      case '3DFACE': {
        const src = entity.type === 'SOLID' ? entity.points : entity.vertices;
        ctx.beginPath();
        src.forEach((p, idx) => {
          const sp = toScreen(p);
          if (idx === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        });
        ctx.closePath();
        if (entity.type === 'SOLID') {
          ctx.save();
          ctx.globalAlpha = 0.28;
          ctx.fill();
          ctx.restore();
        }
        ctx.stroke();
        break;
      }
      case 'TEXT':
      case 'ATTRIB':
      case 'ATTDEF':
        renderCADTextEntity(ctx, entity, vp, strokeColor, state.transform, doc);
        break;
      case 'MTEXT':
        renderCADMTextEntity(ctx, entity, vp, strokeColor, state.transform, doc);
        break;
      case 'DIMENSION': {
        let dimScreenSpan = Infinity;
        if (entity.defPoint2 && entity.defPoint3) {
          const a = toScreen(entity.defPoint2);
          const b = toScreen(entity.defPoint3);
          dimScreenSpan = Math.hypot(b.x - a.x, b.y - a.y);
          if (allowSkip && dimScreenSpan < th.minEntityExtentPx) {
            didDraw = false;
            break;
          }
          const d = toScreen(entity.defPoint);
          const mid = toScreen(entity.textMidPoint);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(d.x, d.y);
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(mid.x, mid.y);
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(mid.x, mid.y);
          ctx.stroke();

          // Architectural tick marks scaled cleanly
          const ds = doc.dimStyles[entity.style] || doc.dimStyles[entity.style?.toUpperCase()] || doc.dimStyles['STANDARD'];
          const tickPx = Math.max(3, Math.min(8, ((ds?.dimasz || 180) * (ds?.dimscale || 1)) * vp.scale * 0.45));
          if (!allowSkip || dimScreenSpan >= 28) {
            ctx.beginPath();
            ctx.moveTo(d.x - tickPx, d.y + tickPx);
            ctx.lineTo(d.x + tickPx, d.y - tickPx);
            ctx.moveTo(mid.x - tickPx, mid.y + tickPx);
            ctx.lineTo(mid.x + tickPx, mid.y - tickPx);
            ctx.stroke();
          }
        }
        if (!allowSkip || dimScreenSpan >= th.minDimPx) {
          renderCADDimensionLabel(ctx, entity, doc, vp, strokeColor, state.transform);
        }
        break;
      }
      case 'LEADER':
      case 'MLEADER': {
        if (entity.vertices.length >= 2) {
          const a = toScreen(entity.vertices[0]);
          const b = toScreen(entity.vertices[entity.vertices.length - 1]);
          if (allowSkip && Math.hypot(b.x - a.x, b.y - a.y) < th.minEntityExtentPx) {
            didDraw = false;
            break;
          }
          ctx.beginPath();
          entity.vertices.forEach((v, idx) => {
            const sp = toScreen(v);
            if (idx === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          });
          ctx.stroke();
        }
        break;
      }
      case 'INSERT': {
        const blk = doc.blocks[entity.blockName];
        if (blk && state.depth < MAX_INSERT_RENDER_DEPTH && !state.visitedBlocks.has(entity.blockName)) {
          state.visitedBlocks.add(entity.blockName);
          const localM = buildInsertTransform2D(
            entity.position,
            entity.scale,
            entity.rotation,
            blk.basePoint
          );
          const nextTransform: Affine2D = [
            state.transform[0] * localM[0] + state.transform[2] * localM[1],
            state.transform[1] * localM[0] + state.transform[3] * localM[1],
            state.transform[0] * localM[2] + state.transform[2] * localM[3],
            state.transform[1] * localM[2] + state.transform[3] * localM[3],
            state.transform[0] * localM[4] + state.transform[2] * localM[5] + state.transform[4],
            state.transform[1] * localM[4] + state.transform[3] * localM[5] + state.transform[5]
          ];
          for (const sub of blk.entities) {
            if (sub.visible === false) continue;
            if (!isCADLayerVisible(doc, sub.layer)) continue;
            this.drawEntity(ctx, sub, doc, vp, {
              ...state,
              parentBlockColorHex: baseColor,
              transform: nextTransform,
              depth: state.depth + 1
            });
          }
          state.visitedBlocks.delete(entity.blockName);
        } else {
          const p = toScreen(entity.position);
          ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
        }
        if (entity.attributes && (!allowSkip || !th.skipHatchFill)) {
          const dec = state.transform === IDENTITY_2D ? null : decomposeAffine2D(state.transform);
          const scaleAvg = dec ? (Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2 : 1;
          for (const att of entity.attributes) {
            const rawSize = att.height * scaleAvg * vp.scale;
            if (allowSkip && rawSize < th.minTextPx) continue;
            const sp = toScreen(att.position);
            const size = Math.max(5, Math.min(20, rawSize));
            ctx.font = `${size}px Inter, sans-serif`;
            ctx.fillText(decodeAutoCadText(att.text), sp.x, sp.y);
          }
        }
        break;
      }
      case 'UNKNOWN': {
        const vpSummary = extractViewportSummary(entity);
        if (vpSummary && vpSummary.width > 0 && vpSummary.height > 0 && entity.previewPoint) {
          const tl = toScreen({
            x: entity.previewPoint.x - vpSummary.width / 2,
            y: entity.previewPoint.y + vpSummary.height / 2
          });
          const br = toScreen({
            x: entity.previewPoint.x + vpSummary.width / 2,
            y: entity.previewPoint.y - vpSummary.height / 2
          });
          const wPx = Math.abs(br.x - tl.x);
          const hPx = Math.abs(br.y - tl.y);
          ctx.strokeStyle = state.isSelected ? '#38bdf8' : '#06b6d4';
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(Math.min(tl.x, br.x), Math.min(tl.y, br.y), wPx, hPx);
          ctx.setLineDash([]);
          ctx.fillStyle = state.isSelected ? '#38bdf8' : '#22d3ee';
          ctx.font = '600 10px Inter, sans-serif';
          ctx.fillText(
            `VIEWPORT${vpSummary.viewportId !== undefined ? ` #${vpSummary.viewportId}` : ''}`,
            Math.min(tl.x, br.x) + 6,
            Math.min(tl.y, br.y) + 14
          );
          break;
        }
        if (entity.previewPoint) {
          const p = toScreen(entity.previewPoint);
          ctx.strokeStyle = state.isSelected ? '#38bdf8' : '#f59e0b';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 6);
          ctx.lineTo(p.x + 6, p.y);
          ctx.lineTo(p.x, p.y + 6);
          ctx.lineTo(p.x - 6, p.y);
          ctx.closePath();
          ctx.stroke();
        }
        break;
      }
    }

    ctx.restore();
    return didDraw;
  }
}

export const sharedCadCanvasRenderer = new CADCanvasRenderer();

/**
 * Renders the loaded CADDocument directly as a locked, non-destructive vector Underlay onto HACHIHI's
 * 2D Network Design canvas, aligned cleanly with Network pan/zoom & CADUnderlayAlignment.
 */
export function renderCadUnderlayOnNetworkCanvas(
  ctx: CanvasRenderingContext2D,
  doc: CADDocument,
  pan: { x: number; y: number },
  zoom: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (!doc.underlay.enabled) return;

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.globalAlpha = Math.max(0.05, Math.min(1, doc.underlay.opacity ?? 0.72));

  const mapPt = (pt: Point2D): Point2D => {
    const np = cadPointToNetworkCanvas(pt, doc.underlay);
    return { x: np.x * zoom + pan.x, y: np.y * zoom + pan.y };
  };

  const drawPolyline = (pts: Point2D[], color: string) => {
    if (pts.length < 2) return;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const sp = mapPt(pts[i]);
      if (i === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();
  };

  const drawOne = (
    ent: CADEntity,
    transform: Affine2D,
    depth: number,
    visited: Set<string>,
    parentColor?: string
  ) => {
    if (ent.visible === false || !isCADLayerVisible(doc, ent.layer)) return;
    const color = resolveEntityColorHex(ent, doc, {
      lightBackground: false,
      parentBlockColorHex: parentColor
    });
    const xf = (p: Point2D) => applyAffine2D(transform, p);

    switch (ent.type) {
      case 'LINE':
        drawPolyline([xf(ent.start), xf(ent.end)], color);
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        drawPolyline(tessellatePolyline(ent.vertices, ent.closed, 12).map(xf), color);
        break;
      case 'ARC': {
        const pts: Point2D[] = [];
        let s = ent.startAngle;
        let e = ent.endAngle;
        if (e <= s) e += 360;
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
          const rad = ((s + ((e - s) * i) / steps) * Math.PI) / 180;
          pts.push(xf({ x: ent.center.x + ent.radius * Math.cos(rad), y: ent.center.y + ent.radius * Math.sin(rad) }));
        }
        drawPolyline(pts, color);
        break;
      }
      case 'CIRCLE': {
        const pts: Point2D[] = [];
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
          const rad = (i / steps) * Math.PI * 2;
          pts.push(xf({ x: ent.center.x + ent.radius * Math.cos(rad), y: ent.center.y + ent.radius * Math.sin(rad) }));
        }
        drawPolyline(pts, color);
        break;
      }
      case 'ELLIPSE':
        drawPolyline(tessellateEllipse(ent, 24).map(xf), color);
        break;
      case 'SPLINE':
        drawPolyline(tessellateSpline(ent, 24).map(xf), color);
        break;
      case 'TEXT':
      case 'MTEXT': {
        const rawTxt = ent.type === 'TEXT' ? decodeAutoCadText(ent.text) : stripMTextFormatting(ent.plainText || ent.rawText);
        const hPx = ent.height * (doc.underlay.scaleToCanvasPx || 0.05) * zoom;
        if (rawTxt && hPx >= 5) {
          const sp = mapPt(xf(ent.position));
          ctx.fillStyle = color;
          ctx.font = `${Math.min(24, hPx)}px Inter, sans-serif`;
          ctx.fillText(rawTxt.split('\n')[0].slice(0, 60), sp.x, sp.y);
        }
        break;
      }
      case 'INSERT': {
        const blk = doc.blocks[ent.blockName];
        if (!blk || depth > 12 || visited.has(ent.blockName)) break;
        visited.add(ent.blockName);
        const lm = buildInsertTransform2D(ent.position, ent.scale, ent.rotation, blk.basePoint);
        const nextT: Affine2D = [
          transform[0] * lm[0] + transform[2] * lm[1],
          transform[1] * lm[0] + transform[3] * lm[1],
          transform[0] * lm[2] + transform[2] * lm[3],
          transform[1] * lm[2] + transform[3] * lm[3],
          transform[0] * lm[4] + transform[2] * lm[5] + transform[4],
          transform[1] * lm[4] + transform[3] * lm[5] + transform[5]
        ];
        for (const sub of blk.entities) {
          drawOne(sub, nextT, depth + 1, visited, color);
        }
        visited.delete(ent.blockName);
        break;
      }
      default:
        break;
    }
  };

  ctx.lineWidth = 1;
  const visited = new Set<string>();
  for (const ent of doc.entities) {
    drawOne(ent, IDENTITY_2D, 0, visited);
  }
  ctx.restore();
}
