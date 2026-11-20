import React, { useRef, useState } from 'react';
import {
  Compass,
  GitBranch,
  Layers,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Check,
  X
} from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { QUICK_TOUR_STORAGE_KEY } from '../../config/appInfo';

export { QUICK_TOUR_STORAGE_KEY };

interface QuickTourOverlayProps {
  isOpen: boolean;
  onClose: (markCompleted?: boolean) => void;
}

const TOUR_STEPS = [
  {
    step: 1,
    duration: '15 giây',
    title: 'Chọn không gian thiết kế & Quản lý dự án',
    icon: Compass,
    description:
      'Thanh trên cùng gom toàn bộ 8 chế độ (Sơ đồ logic, Đa chi nhánh, Mặt bằng, Tủ rack, Cáp quang, Camera, Wi-Fi, Hệ thống điện) vào 1 ô chọn duy nhất. Nhấn vào tên dự án để mở Trung tâm dự án hoặc dùng Ctrl+K để tìm nhanh mọi lệnh và thiết bị.',
    tip: 'Mọi thay đổi tự động lưu an toàn vào IndexedDB ngay trên trình duyệt.'
  },
  {
    step: 2,
    duration: '15 giây',
    title: 'Vẽ sơ đồ bằng thanh công cụ dọc & Thư viện',
    icon: GitBranch,
    description:
      'Kéo thiết bị từ thư viện bên trái (tự động mở sẵn nhóm phù hợp chế độ đang dùng). Thanh công cụ dọc bên trái bản vẽ cung cấp 7 thao tác chính: Chọn (V), Kéo (H), Nối dây (C), Phòng (R), Chữ (T), Chú giải (L) và Đo khoảng cách (M).',
    tip: 'Nhấp đúp vào thiết bị để mở cấu hình chuyên sâu, nhấp đúp vào dây cáp để sửa nhãn trực tiếp.'
  },
  {
    step: 3,
    duration: '15 giây',
    title: 'Điều chỉnh khung nhìn, Lớp & Tự động hóa',
    icon: Layers,
    description:
      'Góc dưới phải bản vẽ tập trung toàn bộ điều khiển khung nhìn: Lớp hiển thị, Nền bản vẽ, Bản đồ thu nhỏ, Zoom và Vừa khung. Trong bảng Thuộc tính bên phải, bạn có thể tự động gán dải IP, theo dõi công suất PoE và dự toán vật tư cáp.',
    tip: 'Dùng nút Tự định tuyến cáp trong menu Thêm để đi dây vuông góc tránh vật cản.'
  },
  {
    step: 4,
    duration: '15 giây',
    title: 'Kiểm tra kỹ thuật & Xuất hồ sơ bàn giao',
    icon: ShieldCheck,
    description:
      'Nhấn Kiểm tra trên thanh trên để phát hiện trùng IP, xung đột VLAN, quá tải tủ Rack hoặc thiếu nguồn PoE. Sau khi đạt kiểm tra, nhấn Xuất để tạo bản vẽ PDF A4, Excel BOM, AutoCAD DXF hoặc trình xem HTML độc lập.',
    tip: 'Bạn có thể mở lại hướng dẫn 60 giây bất cứ lúc nào từ menu "⋯ Thêm".'
  }
];

export const QuickTourOverlay: React.FC<QuickTourOverlayProps> = ({ isOpen, onClose }) => {
  const [stepIdx, setStepIdx] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, () => onClose(true));

  if (!isOpen) return null;

  const current = TOUR_STEPS[stepIdx] || TOUR_STEPS[0];
  const Icon = current.icon;
  const isLast = stepIdx === TOUR_STEPS.length - 1;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Hướng dẫn nhanh 60 giây"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4 no-print"
      onClick={() => onClose(true)}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#155EEF] text-white flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#155EEF] dark:text-blue-400">
                Làm quen trong 60 giây · Bước {current.step}/{TOUR_STEPS.length} ({current.duration})
              </div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {current.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose(true)}
            aria-label="Đóng hướng dẫn nhanh"
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
            {current.description}
          </p>

          <div className="px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-white">Mẹo: </span>
            {current.tip}
          </div>

          {/* Step progress bar */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {TOUR_STEPS.map((st, idx) => (
              <button
                key={st.step}
                type="button"
                onClick={() => setStepIdx(idx)}
                aria-label={`Chuyển sang bước ${st.step}`}
                className={`h-1.5 rounded-full transition-colors ${
                  idx <= stepIdx ? 'bg-[#155EEF]' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onClose(true)}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
          >
            Bỏ qua
          </button>

          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={() => setStepIdx(i => Math.max(0, i - 1))}
                className="ent-btn-secondary"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Trước</span>
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                onClick={() => setStepIdx(i => Math.min(TOUR_STEPS.length - 1, i + 1))}
                className="ent-btn-primary"
              >
                <span>Tiếp theo</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onClose(true)}
                className="ent-btn-primary"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Bắt đầu thiết kế</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
