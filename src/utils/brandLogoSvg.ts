export function getHachihiLogoSvgMarkup(
  size = 28,
  variant: 'light' | 'dark' = 'light',
  idSuffix = 'mark'
): string {
  const gradId = `hachihiSvgBg_${idSuffix}`;
  const isDark = variant === 'dark';
  const startStop = isDark ? '#2563EB' : '#155EEF';
  const endStop = isDark ? '#1E293B' : '#0F172A';
  const frameStroke = isDark ? '#7DD3FC' : '#60A5FA';
  const frameOpacity = isDark ? '0.62' : '0.45';
  const outerBorder = isDark
    ? '<rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.25" stroke="#38BDF8" stroke-opacity="0.35" stroke-width="1.5"/>'
    : '<rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.25" stroke="#1E40AF" stroke-opacity="0.22" stroke-width="1.5"/>';

  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;flex-shrink:0;">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${startStop}"/>
      <stop offset="100%" stop-color="${endStop}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#${gradId})"/>
  ${outerBorder}
  <rect x="6" y="6" width="52" height="52" rx="10" stroke="${frameStroke}" stroke-opacity="${frameOpacity}" stroke-width="1.25"/>
  <path d="M19 16V48M45 16V48M19 32H45" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 20V27L29 32L24 37V44M40 20V27L35 32L40 37V44" stroke="#38BDF8" stroke-opacity="0.88" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="19" cy="16" r="3" fill="#38BDF8"/>
  <circle cx="45" cy="16" r="3" fill="#FBBF24"/>
  <circle cx="19" cy="48" r="3" fill="#38BDF8"/>
  <circle cx="45" cy="48" r="3" fill="#FBBF24"/>
  <circle cx="19" cy="32" r="3.2" fill="#38BDF8"/>
  <circle cx="45" cy="32" r="3.2" fill="#FBBF24"/>
  <circle cx="32" cy="32" r="3.4" fill="#38BDF8"/>
</svg>`;
}
