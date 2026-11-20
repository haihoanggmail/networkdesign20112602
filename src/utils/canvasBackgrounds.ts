import { CanvasBackgroundPattern, CanvasSettings } from '../types/infrastructure';
import { isSafeSvgContent, sanitizeSafeImageUrl } from './security';

export interface CanvasBackgroundPreset {
  id: string;
  name: string;
  subtitle: string;
  backgroundColor: string;
  gridColor: string;
  pattern: CanvasBackgroundPattern;
  isDarkSurface: boolean;
}

export const CANVAS_BACKGROUND_PRESETS: CanvasBackgroundPreset[] = [
  {
    id: 'classic_light',
    name: 'Sáng Chuẩn CAD',
    subtitle: 'Nền sáng dịu, lưới chấm kỹ thuật',
    backgroundColor: '#f8fafc',
    gridColor: '#cbd5e1',
    pattern: 'dots',
    isDarkSurface: false
  },
  {
    id: 'pure_white',
    name: 'Trắng Tinh Khiết',
    subtitle: 'Sạch sẽ để in ấn & chèn tài liệu',
    backgroundColor: '#ffffff',
    gridColor: '#e2e8f0',
    pattern: 'dots',
    isDarkSurface: false
  },
  {
    id: 'sky_tint',
    name: 'Xanh Dương Nhạt',
    subtitle: 'Tông xanh nhẹ, đồng bộ giao diện',
    backgroundColor: '#eff6ff',
    gridColor: '#bfdbfe',
    pattern: 'lines',
    isDarkSurface: false
  },
  {
    id: 'engineering_grid',
    name: 'Giấy Kẻ Ô Kỹ Thuật',
    subtitle: 'Kẻ ô vuông CAD dễ căn thẳng hàng',
    backgroundColor: '#f1f5f9',
    gridColor: '#cbd5e1',
    pattern: 'lines',
    isDarkSurface: false
  },
  {
    id: 'blueprint_blue',
    name: 'Blueprint Kỹ Thuật',
    subtitle: 'Bản vẽ xanh đậm chuẩn kiến trúc',
    backgroundColor: '#0f294a',
    gridColor: '#1e4b82',
    pattern: 'lines',
    isDarkSurface: true
  },
  {
    id: 'dark_noc',
    name: 'Tối NOC / Data Center',
    subtitle: 'Nền tối tương phản cao cho màn hình',
    backgroundColor: '#0b1220',
    gridColor: '#243247',
    pattern: 'dots',
    isDarkSurface: true
  }
];

function computeHexLuminance(hex: string): number {
  const cleaned = hex.replace('#', '').trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map(ch => ch + ch)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0.95;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface ResolvedCanvasAppearance {
  presetId: string;
  backgroundColor: string;
  gridColor: string;
  pattern: CanvasBackgroundPattern;
  isDarkCanvas: boolean;
  labelColor: string;
  mutedLabelColor: string;
  imageUrl?: string;
  imageOpacity: number;
  imageMode: 'cover' | 'world';
}

export function resolveCanvasAppearance(
  settings: CanvasSettings,
  overrideDark?: boolean
): ResolvedCanvasAppearance {
  const matchedPreset = settings.backgroundPreset
    ? CANVAS_BACKGROUND_PRESETS.find(p => p.id === settings.backgroundPreset)
    : undefined;

  let backgroundColor = settings.backgroundColor || '#f8fafc';
  const usesDefaultLight = backgroundColor.toLowerCase() === '#f8fafc' && !settings.backgroundPreset;
  const darkUi = overrideDark ?? settings.isDarkMode;

  if (usesDefaultLight && darkUi) {
    backgroundColor = '#0f172a';
  } else if (matchedPreset && settings.backgroundPreset !== 'custom_color') {
    backgroundColor = settings.backgroundColor || matchedPreset.backgroundColor;
  }

  const isDarkCanvas = computeHexLuminance(backgroundColor) < 0.42;
  const pattern: CanvasBackgroundPattern = !settings.showGrid
    ? 'none'
    : settings.backgroundPattern || matchedPreset?.pattern || 'dots';

  const gridColor = matchedPreset
    ? matchedPreset.gridColor
    : isDarkCanvas
    ? '#334155'
    : '#cbd5e1';

  return {
    presetId: settings.backgroundPreset || (darkUi && usesDefaultLight ? 'dark_noc' : 'classic_light'),
    backgroundColor,
    gridColor,
    pattern,
    isDarkCanvas,
    labelColor: isDarkCanvas ? '#f8fafc' : '#0f172a',
    mutedLabelColor: isDarkCanvas ? '#94a3b8' : '#475569',
    imageUrl: sanitizeSafeImageUrl(settings.backgroundImageUrl),
    imageOpacity: typeof settings.backgroundImageOpacity === 'number'
      ? Math.min(1, Math.max(0.08, settings.backgroundImageOpacity))
      : 0.35,
    imageMode: settings.backgroundImageMode === 'world' ? 'world' : 'cover'
  };
}

/**
 * Reads an uploaded backdrop image, strips unsafe SVG payloads via rasterization to PNG,
 * and resizes overly large images safely so IndexedDB stays fast.
 */
export function processCanvasBackgroundImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      reject(new Error('Định dạng ảnh nền phải là PNG, JPG, WebP hoặc SVG.'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('Ảnh nền vượt quá 8 MB. Vui lòng chọn ảnh nhẹ hơn.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh nền.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const isSvg = file.type === 'image/svg+xml';

      if (isSvg) {
        const safeSvg = sanitizeSafeImageUrl(dataUrl, { allowSanitizedSvg: true });
        if (!safeSvg || !isSafeSvgContent(safeSvg.includes('base64,') ? atob(safeSvg.split(',')[1] || '') : decodeURIComponent(safeSvg.split(',')[1] || ''))) {
          reject(new Error('Tệp SVG chứa thẻ hoặc mã kịch bản không an toàn.'));
          return;
        }
      } else {
        const safeRaster = sanitizeSafeImageUrl(dataUrl, { allowSanitizedSvg: false });
        if (!safeRaster) {
          reject(new Error('Dữ liệu hình ảnh không hợp lệ.'));
          return;
        }
        if (file.size <= 450 * 1024) {
          resolve(safeRaster);
          return;
        }
      }

      const img = new window.Image();
      img.onload = () => {
        const maxDim = 1920;
        const naturalW = img.width || 1600;
        const naturalH = img.height || 1000;
        const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
        const targetW = Math.max(1, Math.round(naturalW * scale));
        const targetH = Math.max(1, Math.round(naturalH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Trình duyệt không hỗ trợ xử lý Canvas hình ảnh.'));
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL(isSvg ? 'image/png' : 'image/jpeg', isSvg ? 0.92 : 0.84));
      };
      img.onerror = () => reject(new Error('Không thể giải mã tệp ảnh nền.'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
