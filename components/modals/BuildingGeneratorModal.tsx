import React, { useRef, useState } from 'react';
import { Building } from '../../types/infrastructure';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Building2, X, Check, Layers, Sliders } from 'lucide-react';

interface BuildingGeneratorModalProps {
  existingBuilding?: Building;
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: {
    name: string;
    totalFloors: number;
    basementFloors: number;
    widthMeters: number;
    depthMeters: number;
    floorHeightMeters: number;
    wallThicknessMm: number;
    layoutStyle: 'rectangle' | 'L-shape' | 'U-shape';
  }) => void;
}

export const BuildingGeneratorModal: React.FC<BuildingGeneratorModalProps> = ({
  existingBuilding,
  isOpen,
  onClose,
  onGenerate
}) => {
  const [name, setName] = useState(existingBuilding?.name || 'HACHIHI Corporate Building');
  const [totalFloors, setTotalFloors] = useState(existingBuilding?.totalFloors || 5);
  const [basementFloors, setBasementFloors] = useState(existingBuilding?.basementFloors || 1);
  const [widthMeters, setWidthMeters] = useState(existingBuilding?.widthMeters || 30);
  const [depthMeters, setDepthMeters] = useState(existingBuilding?.depthMeters || 20);
  const [floorHeightMeters, setFloorHeightMeters] = useState(existingBuilding?.floorHeightMeters || 3.6);
  const [wallThicknessMm, setWallThicknessMm] = useState(existingBuilding?.wallThicknessMm || 200);
  const [layoutStyle, setLayoutStyle] = useState<'rectangle' | 'L-shape' | 'U-shape'>(existingBuilding?.layoutStyle || 'rectangle');
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate({
      name,
      totalFloors: Math.max(1, totalFloors),
      basementFloors: Math.max(0, basementFloors),
      widthMeters: Math.max(10, widthMeters),
      depthMeters: Math.max(10, depthMeters),
      floorHeightMeters: Math.max(2.5, floorHeightMeters),
      wallThicknessMm: Math.max(100, wallThicknessMm),
      layoutStyle
    });
    onClose();
  };

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Trình Tạo Tòa Nhà Nhiều Tầng Thông Minh">
      <div className="w-full h-dvh sm:h-auto sm:max-w-xl sm:max-h-[92dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe">
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                Trình Tạo Tòa Nhà Nhiều Tầng Thông Minh
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Tự động sinh cấu trúc các tầng, mặt bằng kiến trúc và trục kỹ thuật (Vertical Riser)
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            aria-label="Đóng hộp thoại tạo tòa nhà"
            className="touch-target p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400 hover:text-slate-600 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Tên tòa nhà / Dự án</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium"
              placeholder="Ví dụ: HACHIHI Building"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Số tầng nổi</label>
              <input
                type="number"
                min="1"
                max="50"
                value={totalFloors}
                onChange={e => setTotalFloors(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Tầng 1 đến Tầng {totalFloors}</span>
            </div>
            <div>
              <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Số tầng hầm</label>
              <input
                type="number"
                min="0"
                max="5"
                value={basementFloors}
                onChange={e => setBasementFloors(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Tầng hầm B1... B{basementFloors}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Chiều rộng (m)</label>
              <input
                type="number"
                min="10"
                value={widthMeters}
                onChange={e => setWidthMeters(parseFloat(e.target.value) || 30)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Chiều sâu (m)</label>
              <input
                type="number"
                min="10"
                value={depthMeters}
                onChange={e => setDepthMeters(parseFloat(e.target.value) || 20)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Chiều cao tầng (m)</label>
              <input
                type="number"
                step="0.1"
                value={floorHeightMeters}
                onChange={e => setFloorHeightMeters(parseFloat(e.target.value) || 3.6)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Kiểu mặt bằng</label>
              <select
                value={layoutStyle}
                onChange={e => setLayoutStyle(e.target.value as any)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value="rectangle">Hình Chữ Nhật Tiêu Chuẩn</option>
                <option value="L-shape">Chữ L (L-Shape)</option>
                <option value="U-shape">Chữ U (Courtyard U-Shape)</option>
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1 text-slate-700 dark:text-slate-300">Độ dày tường bao (mm)</label>
              <input
                type="number"
                step="50"
                value={wallThicknessMm}
                onChange={e => setWallThicknessMm(parseInt(e.target.value) || 200)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
              />
            </div>
          </div>

          {/* Acceptance criteria preview notice */}
          <div className="p-3 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-300 text-[11px] space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>Cơ chế bảo toàn dữ liệu tầng:</span>
            </div>
            <div>
              Hệ thống tự động bảo toàn mọi thiết bị, cáp và phòng ban của các tầng đã có sẵn. Đổi từ 5 tầng thành 7 tầng hoặc chỉnh sửa kích thước sẽ mở rộng không gian mà không làm mất dữ liệu cũ.
            </div>
          </div>

          {/* Modal Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1.5 shadow-sm"
            >
              <Check className="w-4 h-4" />
              <span>{existingBuilding ? 'Cập Nhật Tòa Nhà' : 'Sinh Cấu Trúc Tòa Nhà'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
