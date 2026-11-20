import type {
  CADAttribEntity,
  CADDimensionEntity,
  CADDocument,
  CADMTextEntity,
  CADTextEntity,
  CADTextStyle,
  Point2D
} from '../core/CADTypes';
import { Affine2D, applyAffine2D, decomposeAffine2D } from '../core/CADTransform';
import { decodeAutoCadText, stripMTextFormatting } from '../geometry/CADCurve';
import { cadWorldToScreen, CADViewportState } from './CADViewport';

const CAD_FONT_FAMILY = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif';

function resolveFontFamilyFromStyle(style?: CADTextStyle): string {
  const font = (style?.fontFile || '').toLowerCase();
  if (font.includes('arial') || font.includes('helvetica') || font.includes('swiss')) {
    return 'Arial, Helvetica, Inter, sans-serif';
  }
  if (font.includes('times') || font.includes('serif') || font.includes('romanc')) {
    return '"Times New Roman", Georgia, serif';
  }
  if (font.includes('courier') || font.includes('mono') || font.includes('consolas')) {
    return '"Courier New", ui-monospace, monospace';
  }
  return CAD_FONT_FAMILY;
}

function resolveTextStyle(doc: CADDocument | undefined, styleName?: string): CADTextStyle | undefined {
  if (!doc) return undefined;
  if (!styleName) return doc.textStyles['STANDARD'];
  return (
    doc.textStyles[styleName] ||
    doc.textStyles[styleName.toUpperCase()] ||
    doc.textStyles['STANDARD']
  );
}

export function formatDimensionDisplayText(entity: CADDimensionEntity, doc: CADDocument): string {
  const ds = doc.dimStyles[entity.style] || doc.dimStyles[entity.style?.toUpperCase()] || doc.dimStyles['STANDARD'];
  const decimals = ds?.dimdec ?? 2;
  const lfac = ds?.dimlfac ?? 1;
  const val = (entity.measuredValue || 0) * lfac;
  const formatted = Number.isFinite(val) ? val.toFixed(Math.max(0, Math.min(4, decimals))) : '0';
  if (!entity.text || entity.text === '<>') {
    return formatted;
  }
  return decodeAutoCadText(entity.text).replace(/<>/g, formatted);
}

function drawTextScreenSpace(
  ctx: CanvasRenderingContext2D,
  screenPos: Point2D,
  lines: string[],
  fontSizePx: number,
  rotationDeg: number,
  color: string,
  hAlign: 'left' | 'center' | 'right' = 'left',
  vBaseline: 'alphabetic' | 'top' | 'middle' | 'bottom' = 'alphabetic',
  styleOpts?: { widthFactor?: number; obliqueAngle?: number; fontFamily?: string }
): void {
  if (fontSizePx < 1.5 || lines.length === 0) return;

  const widthFactor = Math.max(0.25, Math.min(4, styleOpts?.widthFactor ?? 1));
  const obliqueDeg = Math.max(-45, Math.min(45, styleOpts?.obliqueAngle ?? 0));
  const fontFamily = styleOpts?.fontFamily || CAD_FONT_FAMILY;

  ctx.save();
  ctx.translate(screenPos.x, screenPos.y);
  if (rotationDeg) {
    ctx.rotate((-rotationDeg * Math.PI) / 180);
  }
  if (Math.abs(widthFactor - 1) > 1e-3 || Math.abs(obliqueDeg) > 1e-3) {
    const skewX = Math.abs(obliqueDeg) > 1e-3 ? -Math.tan((obliqueDeg * Math.PI) / 180) : 0;
    ctx.transform(widthFactor, 0, skewX, 1, 0, 0);
  }
  ctx.font = `${Math.max(5, fontSizePx)}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = hAlign;
  ctx.textBaseline = vBaseline;

  const lineH = fontSizePx * 1.28;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 0, i * lineH);
  }
  ctx.restore();
}

export function renderCADTextEntity(
  ctx: CanvasRenderingContext2D,
  entity: CADTextEntity | CADAttribEntity,
  vp: CADViewportState,
  color: string,
  worldTransform?: Affine2D,
  doc?: CADDocument
): void {
  const text = decodeAutoCadText(entity.text);
  if (!text) return;
  const ts = resolveTextStyle(doc, entity.style);
  const dec = worldTransform ? decomposeAffine2D(worldTransform) : null;
  const worldPos = worldTransform ? applyAffine2D(worldTransform, entity.position) : entity.position;
  const screenPos = cadWorldToScreen(worldPos, vp);
  const scaleAvg = dec ? (Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2 : 1;
  const rawH = entity.height > 0 ? entity.height : ts?.fixedHeight || 2.5;
  const fontSizePx = rawH * scaleAvg * vp.scale;
  const rot = (entity.rotation || 0) + (dec?.rotationDeg || 0);

  let hAlign: 'left' | 'center' | 'right' = 'left';
  if (entity.type === 'TEXT') {
    if (entity.hAlign === 1 || entity.hAlign === 4) hAlign = 'center';
    else if (entity.hAlign === 2) hAlign = 'right';
  }
  const widthFactor = entity.type === 'TEXT' && entity.widthFactor ? entity.widthFactor : ts?.widthFactor ?? 1;
  const obliqueAngle = entity.type === 'TEXT' && entity.obliqueAngle ? entity.obliqueAngle : ts?.obliqueAngle ?? 0;

  drawTextScreenSpace(ctx, screenPos, [text], fontSizePx, rot, color, hAlign, 'alphabetic', {
    widthFactor,
    obliqueAngle,
    fontFamily: resolveFontFamilyFromStyle(ts)
  });
}

export function renderCADMTextEntity(
  ctx: CanvasRenderingContext2D,
  entity: CADMTextEntity,
  vp: CADViewportState,
  color: string,
  worldTransform?: Affine2D,
  doc?: CADDocument
): void {
  const raw = entity.plainText || entity.rawText;
  const content = raw ? stripMTextFormatting(raw) : '';
  if (!content) return;
  const ts = resolveTextStyle(doc, entity.style);
  const dec = worldTransform ? decomposeAffine2D(worldTransform) : null;
  const worldPos = worldTransform ? applyAffine2D(worldTransform, entity.position) : entity.position;
  const screenPos = cadWorldToScreen(worldPos, vp);
  const scaleAvg = dec ? (Math.abs(dec.scaleX) + Math.abs(dec.scaleY)) / 2 : 1;
  const rawH = entity.height > 0 ? entity.height : ts?.fixedHeight || 2.5;
  const fontSizePx = rawH * scaleAvg * vp.scale;
  const rot = (entity.rotation || 0) + (dec?.rotationDeg || 0);

  const attach = entity.attachmentPoint || 1;
  const hAlign: 'left' | 'center' | 'right' =
    attach === 2 || attach === 5 || attach === 8
      ? 'center'
      : attach === 3 || attach === 6 || attach === 9
        ? 'right'
        : 'left';
  const vBaseline: 'top' | 'middle' | 'bottom' =
    attach >= 7 ? 'bottom' : attach >= 4 ? 'middle' : 'top';

  const lines = content.split('\n').slice(0, 40);
  drawTextScreenSpace(ctx, screenPos, lines, fontSizePx, rot, color, hAlign, vBaseline, {
    widthFactor: ts?.widthFactor ?? 1,
    obliqueAngle: ts?.obliqueAngle ?? 0,
    fontFamily: resolveFontFamilyFromStyle(ts)
  });
}

export function renderCADDimensionLabel(
  ctx: CanvasRenderingContext2D,
  entity: CADDimensionEntity,
  doc: CADDocument,
  vp: CADViewportState,
  color: string,
  worldTransform?: Affine2D
): void {
  const label = formatDimensionDisplayText(entity, doc);
  const ds = doc.dimStyles[entity.style] || doc.dimStyles[entity.style?.toUpperCase()] || doc.dimStyles['STANDARD'];
  const txtH = (ds?.dimtxt || doc.header.$TEXTSIZE || 180) * (ds?.dimscale || doc.header.$DIMSCALE || 1);
  const worldPos = worldTransform ? applyAffine2D(worldTransform, entity.textMidPoint) : entity.textMidPoint;
  const screenPos = cadWorldToScreen(worldPos, vp);
  const fontSizePx = Math.max(9, Math.min(28, txtH * vp.scale));
  drawTextScreenSpace(ctx, screenPos, [label], fontSizePx, entity.rotation || 0, color, 'center', 'middle');
}
