import type { CADDocument, CADEntity, CADLayer } from './CADTypes';

/**
 * Standard AutoCAD Color Index (ACI 0..255) -> Hex RGB lookup.
 * Colors 1..9 are exact primary CAD colors; 10..249 cover standard hue/saturation bands;
 * 250..255 are grayscale ramp.
 */
const BASE_ACI_COLORS: Record<number, string> = {
  0: '#ffffff', // ByBlock
  1: '#ff0000', // Red
  2: '#ffff00', // Yellow
  3: '#00ff00', // Green
  4: '#00ffff', // Cyan
  5: '#0000ff', // Blue
  6: '#ff00ff', // Magenta
  7: '#e2e8f0', // White/Black adaptive default
  8: '#808080', // Dark gray
  9: '#c0c0c0', // Light gray
  250: '#333333',
  251: '#505050',
  252: '#696969',
  253: '#828282',
  254: '#bebebe',
  255: '#ffffff',
  256: '#e2e8f0' // ByLayer fallback
};

// Full 240-color ACI chroma table for indices 10..249
const CHROMA_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [255, 0, 0], [255, 127, 127], [165, 0, 0], [165, 82, 82], [127, 0, 0], [127, 63, 63], [76, 0, 0], [76, 38, 38], [38, 0, 0], [38, 19, 19],
  [255, 63, 0], [255, 159, 127], [165, 41, 0], [165, 103, 82], [127, 31, 0], [127, 79, 63], [76, 19, 0], [76, 47, 38], [38, 9, 0], [38, 23, 19],
  [255, 127, 0], [255, 191, 127], [165, 82, 0], [165, 124, 82], [127, 63, 0], [127, 95, 63], [76, 38, 0], [76, 57, 38], [38, 19, 0], [38, 28, 19],
  [255, 191, 0], [255, 223, 127], [165, 124, 0], [165, 145, 82], [127, 95, 0], [127, 111, 63], [76, 57, 0], [76, 66, 38], [38, 28, 0], [38, 33, 19],
  [255, 255, 0], [255, 255, 127], [165, 165, 0], [165, 165, 82], [127, 127, 0], [127, 127, 63], [76, 76, 0], [76, 76, 38], [38, 38, 0], [38, 38, 19],
  [191, 255, 0], [223, 255, 127], [124, 165, 0], [145, 165, 82], [95, 127, 0], [111, 127, 63], [57, 76, 0], [66, 76, 38], [28, 38, 0], [33, 38, 19],
  [127, 255, 0], [191, 255, 127], [82, 165, 0], [124, 165, 82], [63, 127, 0], [95, 127, 63], [38, 76, 0], [57, 76, 38], [19, 38, 0], [28, 38, 19],
  [63, 255, 0], [159, 255, 127], [41, 165, 0], [103, 165, 82], [31, 127, 0], [79, 127, 63], [19, 76, 0], [47, 76, 38], [9, 38, 0], [23, 38, 19],
  [0, 255, 0], [127, 255, 127], [0, 165, 0], [82, 165, 82], [0, 127, 0], [63, 127, 63], [0, 76, 0], [38, 76, 38], [0, 38, 0], [19, 38, 19],
  [0, 255, 63], [127, 255, 159], [0, 165, 41], [82, 165, 103], [0, 127, 31], [63, 127, 79], [0, 76, 19], [38, 76, 47], [0, 38, 9], [19, 38, 23],
  [0, 255, 127], [127, 255, 191], [0, 165, 82], [82, 165, 124], [0, 127, 63], [63, 127, 95], [0, 76, 38], [38, 76, 57], [0, 38, 19], [19, 38, 28],
  [0, 255, 191], [127, 255, 223], [0, 165, 124], [82, 165, 145], [0, 127, 95], [63, 127, 111], [0, 76, 57], [38, 76, 66], [0, 38, 28], [19, 38, 33],
  [0, 255, 255], [127, 255, 255], [0, 165, 165], [82, 165, 165], [0, 127, 127], [63, 127, 127], [0, 76, 76], [38, 76, 76], [0, 38, 38], [19, 38, 38],
  [0, 191, 255], [127, 223, 255], [0, 124, 165], [82, 145, 165], [0, 95, 127], [63, 111, 127], [0, 57, 76], [38, 66, 76], [0, 28, 38], [19, 33, 38],
  [0, 127, 255], [127, 191, 255], [0, 82, 165], [82, 124, 165], [0, 63, 127], [63, 95, 127], [0, 38, 76], [38, 57, 76], [0, 19, 38], [19, 28, 38],
  [0, 63, 255], [127, 159, 255], [0, 41, 165], [82, 103, 165], [0, 31, 127], [63, 79, 127], [0, 19, 76], [38, 47, 76], [0, 9, 38], [19, 23, 38],
  [0, 0, 255], [127, 127, 255], [0, 0, 165], [82, 82, 165], [0, 0, 127], [63, 63, 127], [0, 0, 76], [38, 38, 76], [0, 0, 38], [19, 19, 38],
  [63, 0, 255], [159, 127, 255], [41, 0, 165], [103, 82, 165], [31, 0, 127], [79, 63, 127], [19, 0, 76], [47, 38, 76], [9, 0, 38], [23, 19, 38],
  [127, 0, 255], [191, 127, 255], [82, 0, 165], [124, 82, 165], [63, 0, 127], [95, 63, 127], [38, 0, 76], [57, 38, 76], [19, 0, 38], [28, 19, 38],
  [191, 0, 255], [223, 127, 255], [124, 0, 165], [145, 82, 165], [95, 0, 127], [111, 63, 127], [57, 0, 76], [66, 38, 76], [28, 0, 38], [33, 19, 38],
  [255, 0, 255], [255, 127, 255], [165, 0, 165], [165, 82, 165], [127, 0, 127], [127, 63, 127], [76, 0, 76], [76, 38, 76], [38, 0, 38], [38, 19, 38],
  [255, 0, 191], [255, 127, 223], [165, 0, 124], [165, 82, 145], [127, 0, 95], [127, 63, 111], [76, 0, 57], [76, 38, 66], [38, 0, 28], [38, 19, 33],
  [255, 0, 127], [255, 127, 191], [165, 0, 82], [165, 82, 124], [127, 0, 63], [127, 63, 95], [76, 0, 38], [76, 38, 57], [38, 0, 19], [38, 19, 28],
  [255, 0, 63], [255, 127, 159], [165, 0, 41], [165, 82, 103], [127, 0, 31], [127, 63, 79], [76, 0, 19], [76, 38, 47], [38, 0, 9], [38, 19, 23]
];

function toHexByte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function trueColorToHex(trueColor: number): string {
  const masked = trueColor & 0xffffff;
  return `#${masked.toString(16).padStart(6, '0')}`;
}

export function aciToHex(aci: number, lightBackground = false): string {
  const abs = Math.abs(Math.trunc(aci));
  if (abs === 7 || abs === 256) {
    return lightBackground ? '#1e293b' : '#e2e8f0';
  }
  if (BASE_ACI_COLORS[abs]) {
    return BASE_ACI_COLORS[abs];
  }
  if (abs >= 10 && abs <= 249) {
    const rgb = CHROMA_RGB[abs - 10];
    if (rgb) {
      return `#${toHexByte(rgb[0])}${toHexByte(rgb[1])}${toHexByte(rgb[2])}`;
    }
  }
  return lightBackground ? '#1e293b' : '#e2e8f0';
}

export function hexToClosestAci(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 7;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  let bestAci = 7;
  let bestDist = Infinity;
  for (let i = 1; i <= 255; i++) {
    const candidateHex = aciToHex(i, false).replace('#', '');
    const cr = parseInt(candidateHex.slice(0, 2), 16);
    const cg = parseInt(candidateHex.slice(2, 4), 16);
    const cb = parseInt(candidateHex.slice(4, 6), 16);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestAci = i;
    }
  }
  return bestAci;
}

export function resolveLayerColorHex(layer?: CADLayer, lightBackground = false): string {
  if (!layer) return lightBackground ? '#1e293b' : '#e2e8f0';
  if (typeof layer.trueColor === 'number') {
    return trueColorToHex(layer.trueColor);
  }
  return aciToHex(layer.colorIndex, lightBackground);
}

export function resolveEntityColorHex(
  entity: CADEntity,
  doc: CADDocument,
  options?: { lightBackground?: boolean; parentBlockColorHex?: string }
): string {
  const lightBg = Boolean(options?.lightBackground);
  if (typeof entity.trueColor === 'number') {
    return trueColorToHex(entity.trueColor);
  }
  const aci = entity.colorIndex;
  if (aci === 0 && options?.parentBlockColorHex) {
    return options.parentBlockColorHex;
  }
  if (aci === undefined || aci === 256 || aci === 0) {
    const layer = doc.layers[entity.layer] || doc.layers['0'];
    return resolveLayerColorHex(layer, lightBg);
  }
  return aciToHex(aci, lightBg);
}

export const QUICK_ACI_SWATCHES: ReadonlyArray<{ aci: number; label: string }> = [
  { aci: 7, label: 'Trắng / Mặc định (7)' },
  { aci: 1, label: 'Đỏ (1)' },
  { aci: 2, label: 'Vàng (2)' },
  { aci: 3, label: 'Xanh lá (3)' },
  { aci: 4, label: 'Cyan (4)' },
  { aci: 5, label: 'Xanh dương (5)' },
  { aci: 6, label: 'Magenta (6)' },
  { aci: 8, label: 'Xám đậm (8)' },
  { aci: 9, label: 'Xám nhạt (9)' },
  { aci: 30, label: 'Cam (30)' }
];
