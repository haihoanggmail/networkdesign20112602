import { resolveEntityColorHex } from '../core/CADColorPalette';
import { isCADLayerVisible } from '../core/CADDocument';
import { Affine2D, IDENTITY_2D, applyAffine2D, buildInsertTransform2D, decomposeAffine2D } from '../core/CADTransform';
import type { BoundingBox2D, CADDocument, CADEntity, Point2D } from '../core/CADTypes';
import { computeSmartFitExtents } from '../geometry/CADBounds';
import {
  decodeAutoCadText,
  stripMTextFormatting,
  tessellateArc,
  tessellateEllipse,
  tessellatePolyline,
  tessellateSpline
} from '../geometry/CADCurve';
import { formatDimensionDisplayText } from './CADTextRenderer';

function escapeXml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface CADSvgRenderOptions {
  width?: number;
  height?: number;
  lightBackground?: boolean;
  maxEntities?: number;
  vectorEffectNonScalingStroke?: boolean;
  /** Explicit extents to fit into; defaults to computeSmartFitExtents(doc) unless fitMode === 'raw' */
  extents?: BoundingBox2D;
  fitMode?: 'smart' | 'raw';
  /** Optional SVG pixel padding around fitted drawing (defaults to ~3% of min dimension) */
  padding?: number;
  /** Minimum SVG coordinate font-size before skipping sub-pixel labels (default 0.2) */
  minTextSvgSize?: number;
  /** Annotate elements with data-layer & class="cad-text" for interactive HTML viewer toggles */
  tagEntitiesForInteractiveHtml?: boolean;
}

/**
 * Generates a pure vector SVG preview/export string for a CADDocument without any DOM or unsafe HTML.
 * Uses proportional world-scaled typography (no giant fixed font floor) and decoded Unicode labels.
 */
export function renderCADDocumentToSvg(
  doc: CADDocument,
  options?: CADSvgRenderOptions
): string {
  const width = options?.width ?? 800;
  const height = options?.height ?? 520;
  const lightBg = Boolean(options?.lightBackground);
  const maxEntities = options?.maxEntities ?? 50000;
  const nonScalingAttr = options?.vectorEffectNonScalingStroke
    ? ' vector-effect="non-scaling-stroke"'
    : '';
  const strokeWidthAttr = options?.vectorEffectNonScalingStroke ? '1.15' : '1';
  const minTextSvgSize = options?.minTextSvgSize ?? 0.2;
  const tagInteractive = Boolean(options?.tagEntitiesForInteractiveHtml);

  const ext =
    options?.extents ??
    (options?.fitMode === 'raw' ? doc.extents : computeSmartFitExtents(doc));
  const spanX = Math.max(1e-3, ext.maxX - ext.minX);
  const spanY = Math.max(1e-3, ext.maxY - ext.minY);
  const defaultPad = Math.max(24, Math.round(Math.min(width, height) * 0.03));
  const pad = Math.min(
    Math.floor(Math.min(width, height) * 0.2),
    Math.max(8, options?.padding ?? defaultPad)
  );
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const cx = (ext.minX + ext.maxX) / 2;
  const cy = (ext.minY + ext.maxY) / 2;

  const mapPt = (p: Point2D): Point2D => ({
    x: Number((width / 2 + (p.x - cx) * scale).toFixed(2)),
    y: Number((height / 2 - (p.y - cy) * scale).toFixed(2))
  });

  const fragments: string[] = [];

  const emitEntity = (
    ent: CADEntity,
    transform: Affine2D,
    depth: number,
    visited: Set<string>,
    parentColor?: string,
    parentLayer?: string
  ) => {
    if (fragments.length >= maxEntities) return;
    if (ent.visible === false || !isCADLayerVisible(doc, ent.layer)) return;
    const color = resolveEntityColorHex(ent, doc, {
      lightBackground: lightBg,
      parentBlockColorHex: parentColor
    });
    const xf = (p: Point2D) => applyAffine2D(transform, p);
    const layerLabel = decodeAutoCadText(parentLayer || ent.layer);
    const layerAttr = tagInteractive ? ` data-layer="${escapeXml(layerLabel)}"` : '';
    const dec = transform === IDENTITY_2D ? null : decomposeAffine2D(transform);
    const scaleAvg = dec ? (Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2 : 1;

    switch (ent.type) {
      case 'LINE': {
        const a = mapPt(xf(ent.start));
        const b = mapPt(xf(ent.end));
        fragments.push(
          `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
        );
        break;
      }
      case 'CIRCLE': {
        const c = mapPt(xf(ent.center));
        const r = Number((ent.radius * scaleAvg * scale).toFixed(2));
        if (r > 0.15) {
          fragments.push(
            `<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case 'ARC': {
        const pts = tessellateArc(ent.center, ent.radius, ent.startAngle, ent.endAngle, 20).map(p => mapPt(xf(p)));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
        fragments.push(
          `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
        );
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pts = tessellatePolyline(ent.vertices, ent.closed, 12).map(p => mapPt(xf(p)));
        if (pts.length >= 2) {
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
          fragments.push(
            `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case 'ELLIPSE': {
        const pts = tessellateEllipse(ent, 24).map(p => mapPt(xf(p)));
        if (pts.length >= 2) {
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
          fragments.push(
            `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case 'SPLINE': {
        const pts = tessellateSpline(ent, 24).map(p => mapPt(xf(p)));
        if (pts.length >= 2) {
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
          fragments.push(
            `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case 'HATCH': {
        const fillOpacity = ent.solidFill ? '0.2' : '0.08';
        for (const loop of ent.boundaryLoops) {
          if (loop.length < 2) continue;
          const pts = loop.map(p => mapPt(xf(p)));
          const d = `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')} Z`;
          fragments.push(
            `<path d="${d}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-opacity="0.45" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case 'SOLID': {
        const pts = ent.points.map(p => mapPt(xf(p)));
        if (pts.length >= 3) {
          const d = `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')} Z`;
          fragments.push(
            `<path d="${d}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case '3DFACE': {
        const pts = ent.vertices.map(p => mapPt(xf(p)));
        if (pts.length >= 3) {
          const d = `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')} Z`;
          fragments.push(
            `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.7" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case 'TEXT':
      case 'ATTRIB':
      case 'MTEXT': {
        const rawContent =
          ent.type === 'MTEXT'
            ? stripMTextFormatting(ent.plainText || ent.rawText)
            : decodeAutoCadText(ent.text);
        if (!rawContent) break;

        const svgSize = Math.min(180, Math.max(0, ent.height * scaleAvg * scale));
        if (svgSize < minTextSvgSize) break;

        const lines = rawContent.split('\n').slice(0, 8);
        const p = mapPt(xf(ent.position));
        const rotDeg = ((ent.rotation || 0) + (dec?.rotationDeg || 0)) % 360;
        const rotAttr =
          Math.abs(rotDeg) > 0.25 ? ` transform="rotate(${(-rotDeg).toFixed(2)} ${p.x} ${p.y})"` : '';

        let anchor: 'start' | 'middle' | 'end' = 'start';
        if (ent.type === 'TEXT') {
          if (ent.hAlign === 1 || ent.hAlign === 4) anchor = 'middle';
          else if (ent.hAlign === 2) anchor = 'end';
        } else if (ent.type === 'MTEXT') {
          const a = ent.attachmentPoint || 1;
          if (a === 2 || a === 5 || a === 8) anchor = 'middle';
          else if (a === 3 || a === 6 || a === 9) anchor = 'end';
        }

        const textClass = tagInteractive ? ' class="cad-text"' : '';
        const lineH = Number((svgSize * 1.25).toFixed(3));
        const fontStr = svgSize < 1 ? svgSize.toFixed(3) : svgSize.toFixed(2);
        const contentXml =
          lines.length === 1
            ? escapeXml(lines[0].slice(0, 120))
            : lines
                .map(
                  (ln, idx) =>
                    `<tspan x="${p.x}" dy="${idx === 0 ? 0 : lineH}">${escapeXml(ln.slice(0, 120))}</tspan>`
                )
                .join('');
        fragments.push(
          `<text${textClass}${layerAttr} x="${p.x}" y="${p.y}" fill="${color}" font-size="${fontStr}" text-anchor="${anchor}" font-family="Inter, Segoe UI, sans-serif"${rotAttr}>${contentXml}</text>`
        );
        break;
      }
      case 'DIMENSION': {
        const p2 = ent.defPoint2 ? mapPt(xf(ent.defPoint2)) : null;
        const p3 = ent.defPoint3 ? mapPt(xf(ent.defPoint3)) : null;
        const dPt = mapPt(xf(ent.defPoint));
        const mid = mapPt(xf(ent.textMidPoint));
        if (p2 && p3) {
          fragments.push(
            `<path d="M${p2.x} ${p2.y} L${dPt.x} ${dPt.y} L${mid.x} ${mid.y} M${p3.x} ${p3.y} L${mid.x} ${mid.y}" fill="none" stroke="${color}" stroke-width="${strokeWidthAttr}" stroke-opacity="0.75"${nonScalingAttr}${layerAttr} />`
          );
        }
        const label = formatDimensionDisplayText(ent, doc);
        if (label) {
          const ds = doc.dimStyles[ent.style] || doc.dimStyles['STANDARD'];
          const dimTextWorld =
            (ds?.dimtxt || doc.header.$TEXTSIZE || 0) * (ds?.dimscale || doc.header.$DIMSCALE || 1);
          const fallbackDimH = Math.max(1, (ent.measuredValue || 100) * 0.055);
          const resolvedWorldH = dimTextWorld > 0 ? dimTextWorld : fallbackDimH;
          const dimFontSize = Math.min(24, Math.max(0, resolvedWorldH * scaleAvg * scale));
          if (dimFontSize >= minTextSvgSize) {
            const textClass = tagInteractive ? ' class="cad-text"' : '';
            const fontStr = dimFontSize < 1 ? dimFontSize.toFixed(3) : dimFontSize.toFixed(2);
            const rotDeg = ((ent.rotation || 0) + (dec?.rotationDeg || 0)) % 360;
            const rotAttr =
              Math.abs(rotDeg) > 0.25 ? ` transform="rotate(${(-rotDeg).toFixed(2)} ${mid.x} ${mid.y})"` : '';
            fragments.push(
              `<text${textClass}${layerAttr} x="${mid.x}" y="${mid.y}" fill="${color}" font-size="${fontStr}" text-anchor="middle" font-family="Inter, Segoe UI, sans-serif"${rotAttr}>${escapeXml(label.slice(0, 48))}</text>`
            );
          }
        }
        break;
      }
      case 'LEADER':
      case 'MLEADER': {
        if (ent.vertices.length >= 2) {
          const pts = ent.vertices.map(v => mapPt(xf(v)));
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
          fragments.push(
            `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidthAttr}"${nonScalingAttr}${layerAttr} />`
          );
        }
        break;
      }
      case 'INSERT': {
        const blk = doc.blocks[ent.blockName];
        if (!blk || depth > 10 || visited.has(ent.blockName)) break;
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
          emitEntity(sub, nextT, depth + 1, visited, color, ent.layer);
        }
        visited.delete(ent.blockName);
        break;
      }
      default:
        break;
    }
  };

  const visited = new Set<string>();
  for (const ent of doc.entities) {
    emitEntity(ent, IDENTITY_2D, 0, visited);
  }

  const bg = lightBg ? '#f8fafc' : '#0b111e';
  const bodyMarkup = tagInteractive
    ? `<g id="cad-content">${fragments.join('')}</g>`
    : fragments.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${bg}"/>${bodyMarkup}</svg>`;
}

