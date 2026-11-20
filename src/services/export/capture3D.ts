import type {
  CameraPresetId,
  Capture3DBackground,
  Capture3DRequestOptions,
  Capture3DResult
} from '../../contexts/ViewportContext';
import { CAMERA_PRESET_LABELS, Captured3DSnapshotInput } from './exportTypes';

export type Capture3DFn = (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Captures the active Three.js 3D viewport strictly via its WebGL capture handle.
 * Never falls back silently to 2D SVG if the 3D viewport is inactive or WebGL fails.
 */
export async function capture3DSnapshotStrict(
  captureFn: Capture3DFn | undefined,
  options?: {
    width?: number;
    height?: number;
    background?: Capture3DBackground;
    preset?: CameraPresetId;
  }
): Promise<Captured3DSnapshotInput> {
  if (!captureFn) {
    throw new Error(
      'Chưa thể xuất 3D vì khung nhìn 3D đang tắt hoặc chưa khởi tạo WebGL. Vui lòng chuyển sang chế độ 3D trước.'
    );
  }

  const result = await captureFn({
    width: options?.width ?? 1920,
    height: options?.height ?? 1080,
    background: options?.background ?? 'light',
    preset: options?.preset
  });

  if (!result || !result.blob || result.blob.size === 0 || !result.dataUrl.startsWith('data:image/png')) {
    throw new Error('Ảnh chụp 3D WebGL không hợp lệ hoặc khung hình trống.');
  }

  const bytes = await blobToUint8Array(result.blob);
  return {
    preset: result.preset,
    label: CAMERA_PRESET_LABELS[result.preset] || 'Góc nhìn 3D',
    dataUrl: result.dataUrl,
    bytes,
    width: result.width,
    height: result.height,
    background: result.background
  };
}

/**
 * Captures one or multiple camera presets sequentially from the active 3D WebGL scene
 * so concurrent render targets never collide.
 */
export async function capture3DAnglesStrict(
  captureFn: Capture3DFn | undefined,
  angles: CameraPresetId[],
  options?: {
    width?: number;
    height?: number;
    background?: Capture3DBackground;
  }
): Promise<Captured3DSnapshotInput[]> {
  if (!captureFn) {
    throw new Error(
      'Chưa thể xuất bản vẽ 3D vì khung nhìn 3D chưa sẵn sàng. Hãy chuyển sang chế độ 3D trước khi xuất.'
    );
  }

  const targetAngles: CameraPresetId[] = angles.length > 0 ? angles : ['iso'];
  const snapshots: Captured3DSnapshotInput[] = [];

  for (const preset of targetAngles) {
    const snap = await capture3DSnapshotStrict(captureFn, {
      width: options?.width ?? 1920,
      height: options?.height ?? 1080,
      background: options?.background ?? 'light',
      preset
    });
    snapshots.push(snap);
  }

  return snapshots;
}
