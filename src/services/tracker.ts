export type TrackAction = 'visit' | 'template' | 'save' | 'export';

const SESSION_STORAGE_KEY = 'hachihi_track_session_id';

function generateId(prefix: string): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {
    // fallback below
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let cachedVisitId: string | null = null;
let cachedSessionId: string | null = null;
let hasTrackedVisit = false;

export function getVisitId(): string {
  if (!cachedVisitId) {
    cachedVisitId = generateId('v');
  }
  return cachedVisitId;
}

export function getOrCreateSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (existing && existing.trim()) {
        cachedSessionId = existing.trim().slice(0, 80);
        return cachedSessionId;
      }
      const created = generateId('s');
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
      cachedSessionId = created;
      return created;
    }
  } catch {
    // ignore private-mode / sandboxed storage errors
  }
  cachedSessionId = generateId('s');
  return cachedSessionId;
}

export function detectClientDevice(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent || '';

  let formFactor = 'Desktop';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
    formFactor = 'Tablet';
  } else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) {
    formFactor = 'Mobile';
  }

  let os = 'Other';
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\/|FxiOS\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';

  return `${formFactor} · ${os} · ${browser}`;
}

export function getClientLanguage(): string {
  if (typeof navigator === 'undefined') return 'vi';
  return (navigator.language || 'vi').slice(0, 32);
}

export function getClientResolution(): string {
  if (typeof window === 'undefined') return '';
  const w = window.screen?.width || window.innerWidth || 0;
  const h = window.screen?.height || window.innerHeight || 0;
  return w > 0 && h > 0 ? `${w}x${h}` : '';
}

export function resetVisitTrackerForTest(): void {
  hasTrackedVisit = false;
  cachedVisitId = null;
  cachedSessionId = null;
}

export function trackEvent(action: TrackAction, detail = ''): void {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;

    const payload = {
      visitId: getVisitId(),
      sessionId: getOrCreateSessionId(),
      action,
      detail: String(detail || '').slice(0, 300),
      device: detectClientDevice(),
      language: getClientLanguage(),
      resolution: getClientResolution()
    };

    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {
      // Never surface tracking errors to users
    });
  } catch {
    // Ignore all tracking errors silently
  }
}

export function trackVisit(): void {
  if (hasTrackedVisit) return;
  hasTrackedVisit = true;
  const path =
    typeof window !== 'undefined' && window.location?.pathname ? window.location.pathname : '/';
  trackEvent('visit', path);
}

export function trackTemplate(detail: string): void {
  trackEvent('template', detail);
}

export function trackSave(detail = ''): void {
  trackEvent('save', detail);
}

export function trackExport(detail: string): void {
  trackEvent('export', detail);
}
