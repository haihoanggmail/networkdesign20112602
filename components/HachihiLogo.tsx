import React, { useId } from 'react';

interface HachihiLogoProps {
  size?: number;
  variant?: 'auto' | 'light' | 'dark';
  showWordmark?: boolean;
  className?: string;
}

const SIZE_CLASS_MAP: Record<number, string> = {
  16: 'w-4 h-4 rounded-[4px]',
  18: 'w-[18px] h-[18px] rounded-[4px]',
  20: 'w-5 h-5 rounded-[5px]',
  22: 'w-[22px] h-[22px] rounded-[5px]',
  24: 'w-6 h-6 rounded-md',
  28: 'w-7 h-7 rounded-md',
  32: 'w-8 h-8 rounded-lg',
  36: 'w-9 h-9 rounded-lg',
  40: 'w-10 h-10 rounded-xl',
  42: 'w-[42px] h-[42px] rounded-xl',
  48: 'w-12 h-12 rounded-xl',
  56: 'w-14 h-14 rounded-2xl',
  64: 'w-16 h-16 rounded-2xl'
};

function resolveSizeClass(size: number): string {
  if (SIZE_CLASS_MAP[size]) return SIZE_CLASS_MAP[size];
  const entries = Object.keys(SIZE_CLASS_MAP).map(Number);
  const closest = entries.reduce((prev, curr) =>
    Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
  );
  return SIZE_CLASS_MAP[closest];
}

export const HachihiLogo: React.FC<HachihiLogoProps> = ({
  size = 28,
  variant = 'auto',
  showWordmark = false,
  className = ''
}) => {
  const uid = useId().replace(/:/g, '');
  const gradientId = `hachihiLogoBg_${uid}`;

  const wordmarkTone =
    variant === 'dark'
      ? 'text-white'
      : variant === 'light'
      ? 'text-slate-900'
      : 'text-slate-900 dark:text-white';

  const ringClass =
    variant === 'dark'
      ? 'ring-1 ring-sky-400/35 shadow-xs'
      : variant === 'light'
      ? 'ring-1 ring-slate-900/12 shadow-xs'
      : 'ring-1 ring-slate-900/12 dark:ring-sky-400/35 shadow-xs';

  const gradStart = variant === 'dark' ? '#2563EB' : '#155EEF';
  const gradEnd = variant === 'dark' ? '#1E293B' : '#0F172A';
  const frameStroke = variant === 'dark' ? '#7DD3FC' : '#60A5FA';
  const frameStrokeOpacity = variant === 'dark' ? '0.62' : '0.45';
  const boxClass = resolveSizeClass(size);

  return (
    <span className={`inline-flex items-center gap-2 shrink-0 ${className}`}>
      <span
        className={`relative inline-flex items-center justify-center overflow-hidden shrink-0 ${ringClass} ${boxClass}`}
        role="img"
        aria-label="HACHIHI Network Designer"
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="w-full h-full block shrink-0"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={gradStart} />
              <stop offset="100%" stopColor={gradEnd} />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill={`url(#${gradientId})`} />
          <rect
            x="6"
            y="6"
            width="52"
            height="52"
            rx="10"
            stroke={frameStroke}
            strokeOpacity={frameStrokeOpacity}
            strokeWidth="1.25"
          />
          <path
            d="M19 16V48M45 16V48M19 32H45"
            stroke="#FFFFFF"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M24 20V27L29 32L24 37V44M40 20V27L35 32L40 37V44"
            stroke="#38BDF8"
            strokeOpacity="0.88"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="16" r="3" fill="#38BDF8" />
          <circle cx="45" cy="16" r="3" fill="#FBBF24" />
          <circle cx="19" cy="48" r="3" fill="#38BDF8" />
          <circle cx="45" cy="48" r="3" fill="#FBBF24" />
          <circle cx="19" cy="32" r="3.2" fill="#38BDF8" />
          <circle cx="45" cy="32" r="3.2" fill="#FBBF24" />
          <circle cx="32" cy="32" r="3.4" fill="#38BDF8" />
        </svg>
      </span>
      {showWordmark && (
        <span className={`font-bold tracking-tight text-sm whitespace-nowrap ${wordmarkTone}`}>
          HACHIHI
        </span>
      )}
    </span>
  );
};
