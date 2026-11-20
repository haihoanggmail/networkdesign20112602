export interface DWGProviderConfig {
  mode: 'wasm-local' | 'local-guide' | 'http-converter';
  endpointUrl: string;
  authHeader?: string;
}

const STORAGE_KEY = 'hachihi:cad:dwg-provider-config';

export function getDefaultDWGProviderConfig(): DWGProviderConfig {
  return {
    mode: 'wasm-local',
    endpointUrl: ''
  };
}

export function loadDWGProviderConfig(): DWGProviderConfig {
  if (typeof window === 'undefined') return getDefaultDWGProviderConfig();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultDWGProviderConfig();
    const parsed = JSON.parse(raw) as Partial<DWGProviderConfig>;
    const mode: DWGProviderConfig['mode'] =
      parsed.mode === 'http-converter'
        ? 'http-converter'
        : parsed.mode === 'local-guide'
          ? 'local-guide'
          : 'wasm-local';
    return {
      mode,
      endpointUrl: typeof parsed.endpointUrl === 'string' ? parsed.endpointUrl : '',
      authHeader: typeof parsed.authHeader === 'string' ? parsed.authHeader : undefined
    };
  } catch {
    return getDefaultDWGProviderConfig();
  }
}

export function saveDWGProviderConfig(config: DWGProviderConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage quota errors
  }
}

export function validateDwgConverterUrl(urlStr: string): { ok: true; url: URL } | { ok: false; error: string } {
  try {
    const u = new URL(urlStr.trim());
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(isLocal && u.protocol === 'http:')) {
      return {
        ok: false,
        error: 'Endpoint chuyển đổi DWG phải dùng HTTPS (hoặc http://localhost để chạy nội bộ).'
      };
    }
    return { ok: true, url: u };
  } catch {
    return { ok: false, error: 'Địa chỉ URL bộ chuyển đổi DWG không hợp lệ.' };
  }
}
