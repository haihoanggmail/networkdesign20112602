import React, { useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  Phone,
  Headphones,
  MessageSquarePlus,
  Compass,
  CheckCircle2,
  ShieldCheck,
  WifiOff
} from 'lucide-react';
import { DesignMode } from '../../types/infrastructure';
import {
  ABOUT_FEATURES,
  APP_BUILD_DATE,
  APP_BUILD_HASH,
  APP_PRODUCT_NAME,
  APP_VERSION,
  BRAND_INFO,
  buildFeedbackFormUrl,
  isFeedbackFormConfigured
} from '../../config/appInfo';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { HachihiLogo } from '../HachihiLogo';

interface AboutModalProps {
  isOpen: boolean;
  activeMode: DesignMode;
  onClose: () => void;
  onOpenQuickGuide: () => void;
}

type AboutTabId = 'info' | 'features' | 'contact';

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  activeMode,
  onClose,
  onOpenQuickGuide
}) => {
  const [activeTab, setActiveTab] = useState<AboutTabId>('info');
  const [offlineNotice, setOfflineNotice] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const isOnline = useOnlineStatus();

  useFocusTrap(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  const feedbackConfigured = isFeedbackFormConfigured();
  const feedbackUrl = buildFeedbackFormUrl({ activeMode });

  const handleOpenFeedback = (e: React.MouseEvent) => {
    if (!isOnline) {
      e.preventDefault();
      setOfflineNotice(true);
      return;
    }
    setOfflineNotice(false);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Giới thiệu HACHIHI Network & Electrical Designer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4 no-print"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full h-dvh sm:h-auto sm:max-w-2xl sm:max-h-[90dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-slate-100 pb-safe">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <HachihiLogo size={48} />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                {APP_PRODUCT_NAME}
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>Phiên bản {APP_VERSION}</span>
                <span aria-hidden="true">·</span>
                <span>Mã build: {APP_BUILD_HASH}</span>
                <span aria-hidden="true">·</span>
                <span>Phát hành: {APP_BUILD_DATE}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ Giới thiệu"
            className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wide Screen Tabs */}
        <div className="hidden sm:flex items-center gap-1 px-5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 shrink-0">
          {[
            { id: 'info' as const, label: 'Thông tin' },
            { id: 'features' as const, label: 'Tính năng' },
            { id: 'contact' as const, label: 'Liên hệ' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-[#155EEF] dark:text-blue-400 border border-slate-200 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body: Tabbed on sm+, single scrollable column on mobile */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-sm">
          {/* INFO SECTION */}
          <section className={`${activeTab === 'info' ? 'block' : 'hidden sm:hidden'} sm:block`}>
            <div className={`${activeTab !== 'info' ? 'hidden sm:hidden' : 'space-y-4'}`}>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Công cụ thiết kế hạ tầng mạng, mặt bằng nhiều tầng, tủ Server Rack 19 inch, hệ thống camera CCTV, Wi-Fi, cáp quang, điện kỹ thuật và dự toán bảng vật tư (BOM) chi tiết.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Trang web chính thức</div>
                  <a
                    href={BRAND_INFO.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#155EEF] dark:text-blue-400 hover:underline"
                  >
                    <span>{BRAND_INFO.websiteLabel}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Phiên bản &amp; Định dạng</div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
                    v{APP_VERSION} ({APP_BUILD_HASH})
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white">Lưu trữ an toàn tại trình duyệt</div>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                    {BRAND_INFO.localStorageNotice} Bản vẽ không tự động tải lên máy chủ bên ngoài; hãy xuất Gói dự án (.hachihi.json) định kỳ để sao lưu hoặc chuyển máy.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* FEATURES SECTION */}
          <section className={`${activeTab === 'features' ? 'block' : 'block sm:hidden'} ${activeTab === 'features' ? 'sm:block' : ''}`}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2.5 sm:hidden">
              Tính năng chuyên nghiệp
            </h3>
            <div className="space-y-2">
              {ABOUT_FEATURES.map((feat, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 text-xs text-slate-700 dark:text-slate-200 leading-relaxed"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          </section>

          {/* CONTACT SECTION */}
          <section className={`${activeTab === 'contact' ? 'block' : 'block sm:hidden'} ${activeTab === 'contact' ? 'sm:block' : ''}`}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2.5 sm:hidden">
              Thông tin liên hệ &amp; Hỗ trợ
            </h3>
            <div className="space-y-3">
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-[#155EEF] shrink-0" />
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Hotline tư vấn</div>
                      <a
                        href={BRAND_INFO.hotlineHref}
                        className="text-base font-bold text-slate-900 dark:text-white hover:text-[#155EEF] dark:hover:text-blue-400 font-mono tabular-nums"
                      >
                        {BRAND_INFO.hotlineDisplay}
                      </a>
                    </div>
                  </div>
                  <a
                    href={BRAND_INFO.hotlineHref}
                    className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#155EEF] whitespace-nowrap"
                  >
                    Gọi ngay
                  </a>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Headphones className="w-4 h-4 text-slate-500 shrink-0" />
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Hỗ trợ kỹ thuật</div>
                      <a
                        href={BRAND_INFO.supportHref}
                        className="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-[#155EEF] dark:hover:text-blue-400 font-mono tabular-nums"
                      >
                        {BRAND_INFO.supportDisplay}
                      </a>
                    </div>
                  </div>
                  <a
                    href={BRAND_INFO.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#155EEF] dark:text-blue-400 hover:underline whitespace-nowrap"
                  >
                    <span>{BRAND_INFO.websiteLabel}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {offlineNotice && (
                <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <WifiOff className="w-4 h-4 shrink-0" />
                  <span>Cần có kết nối Internet để gửi biểu mẫu góp ý trực tuyến.</span>
                </div>
              )}

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Khi gửi góp ý qua biểu mẫu, ứng dụng chỉ điền sẵn phiên bản, mã build, chế độ hiện tại và loại thiết bị — không đính kèm dữ liệu bản vẽ của bạn.
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {BRAND_INFO.copyright} · {BRAND_INFO.localStorageNotice}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenQuickGuide();
              }}
              className="h-9 px-3.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Compass className="w-3.5 h-3.5 text-[#155EEF]" />
              <span>Xem hướng dẫn nhanh</span>
            </button>

            {feedbackConfigured && feedbackUrl ? (
              <a
                href={feedbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleOpenFeedback}
                className="h-9 px-3.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                title="Mở biểu mẫu góp ý (Không đính kèm bản vẽ của bạn)"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Góp ý</span>
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Chưa cấu hình liên kết biểu mẫu góp ý"
                className="h-9 px-3.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-not-allowed"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Góp ý</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
