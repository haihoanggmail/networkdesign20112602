export type CollapsiblePanelId = 'left' | 'properties' | 'layers' | 'cad_left' | 'cad_right';

const PANEL_STORAGE_KEYS: Record<CollapsiblePanelId, string> = {
  left: 'hachihi_left_panel_collapsed_v1',
  properties: 'hachihi_properties_panel_collapsed_v1',
  layers: 'hachihi_layer_panel_collapsed_v1',
  cad_left: 'hachihi_cad_left_panel_collapsed_v1',
  cad_right: 'hachihi_cad_right_panel_collapsed_v1'
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(customStorage?: StorageLike | null): StorageLike | null {
  if (customStorage !== undefined) return customStorage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage as StorageLike;
    }
  } catch {
    return null;
  }
  return null;
}

export function getPanelCollapseStorageKey(panelId: CollapsiblePanelId): string {
  return PANEL_STORAGE_KEYS[panelId];
}

export function loadPanelCollapsed(
  panelId: CollapsiblePanelId,
  fallback = false,
  customStorage?: StorageLike | null
): boolean {
  const storage = resolveStorage(customStorage);
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(PANEL_STORAGE_KEYS[panelId]);
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  } catch {
    // ignore storage errors
  }
  return fallback;
}

export function savePanelCollapsed(
  panelId: CollapsiblePanelId,
  collapsed: boolean,
  customStorage?: StorageLike | null
): boolean {
  const storage = resolveStorage(customStorage);
  if (!storage) return false;
  try {
    storage.setItem(PANEL_STORAGE_KEYS[panelId], collapsed ? 'true' : 'false');
    return true;
  } catch {
    return false;
  }
}
