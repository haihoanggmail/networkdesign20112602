import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, Share, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSHint, setShowIOSHint] = useState(false);

  if (isInstalled || (!isInstallable && !isIOS)) return null;

  if (isIOS) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowIOSHint(prev => !prev)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold text-xs"
          title="Cài đặt ứng dụng lên iPhone / iPad"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Cài ứng dụng</span>
        </button>

        {showIOSHint && (
          <div className="absolute right-0 mt-1.5 w-64 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl z-50 text-xs text-slate-700 dark:text-slate-200">
            <div className="flex items-center justify-between font-bold mb-1">
              <span>Cài đặt trên iOS / Safari</span>
              <button onClick={() => setShowIOSHint(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
              Nhấn biểu tượng <Share className="w-3 h-3 inline text-blue-600" /> <strong>Chia sẻ</strong> ở thanh Safari rồi chọn <strong>Thêm vào Màn hình chính</strong>.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        void install();
      }}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold text-xs transition-colors"
      title="Cài đặt HACHIHI thành ứng dụng độc lập (dùng ngoại tuyến)"
    >
      <Download className="w-3.5 h-3.5" />
      <span className="hidden xl:inline">Cài ứng dụng</span>
    </button>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-xs font-semibold">
      <WifiOff className="w-3 h-3" />
      <span>Ngoại tuyến · Lưu IndexedDB</span>
    </span>
  );
};
