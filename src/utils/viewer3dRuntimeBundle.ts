export const VIEWER_3D_RUNTIME_ASSET_PATH = '/assets/viewer-3d-runtime.js';

let cachedRuntimePromise: Promise<string> | null = null;

function resolveAssetUrl(): string {
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = typeof metaEnv?.BASE_URL === 'string' && metaEnv.BASE_URL ? metaEnv.BASE_URL : '/';
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}${VIEWER_3D_RUNTIME_ASSET_PATH}`;
}

async function fetchViewerRuntimeInternal(): Promise<string> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const res = await fetch(resolveAssetUrl(), { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error(`Không thể tải offline 3D viewer runtime (${res.status}).`);
    }
    const text = await res.text();
    if (!text || !text.includes('HachihiViewer3D')) {
      throw new Error('Tệp 3D viewer runtime không hợp lệ.');
    }
    return text;
  }

  // Node / SSR / unit-test runtime fallback reading directly from public/assets
  if (typeof process !== 'undefined' && process.versions?.node) {
    const nodeFs = 'node:fs/promises';
    const nodePath = 'node:path';
    const fs = await import(/* @vite-ignore */ nodeFs);
    const path = await import(/* @vite-ignore */ nodePath);
    const filePath = path.resolve(process.cwd(), 'public/assets/viewer-3d-runtime.js');
    return fs.readFile(filePath, 'utf8');
  }

  throw new Error('Môi trường hiện tại không hỗ trợ tải offline 3D viewer runtime.');
}

/**
 * Lazily loads the offline Three.js HTML viewer runtime from the static public asset
 * (`/assets/viewer-3d-runtime.js`), keeping the 817 KB runtime completely out of
 * Vite's initial application bundle and TypeScript compilation graph.
 */
export function loadViewer3DRuntimeJs(): Promise<string> {
  if (!cachedRuntimePromise) {
    cachedRuntimePromise = fetchViewerRuntimeInternal().catch(err => {
      cachedRuntimePromise = null;
      throw err;
    });
  }
  return cachedRuntimePromise;
}

export function resetViewer3DRuntimeCacheForTests(): void {
  cachedRuntimePromise = null;
}
