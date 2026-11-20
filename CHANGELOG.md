# Nhật ký thay đổi (CHANGELOG)

Tài liệu này ghi nhận các thay đổi quan trọng của **HACHIHI Network & Electrical Designer** theo chuẩn [Keep a Changelog](https://keepachangelog.com/vi/1.0.0/) và đánh số phiên bản theo [SemVer](https://semver.org/).

## [Chưa phát hành - Nhóm CA] - 2026-11-18

### Sửa lỗi & Độ tin cậy
- **Vệ sinh phát hành & PWA (CA-01, CA-03)**: Gỡ bỏ toàn bộ thư mục dư `public/assets/aistudio/`, cập nhật `.gitignore` bỏ qua `dev-dist/`, `playwright-report/`, `test-results/`, bổ sung bước kiểm tra kích thước `public/` (< 1 MB), danh sách precache `dist/sw.js` và lưu artifact báo cáo Playwright trong CI (`.github/workflows/ci.yml`).
- **Logo Vector SVG Sáng/Tối (CA-02)**: Thay thế hoàn toàn ảnh raster JPG 488 KB bằng vector SVG sắc nét hỗ trợ chế độ Sáng/Tối trong `HachihiLogo`, khung tên PDF (`pdfExporter.ts`) và đầu trang trình xem HTML (`htmlViewerExporter.ts`).
- **Tài liệu & cấu hình môi trường (CA-04)**: Bổ sung `CHAT_DAILY_TOKEN_LIMIT`, `CHAT_RATE_LIMIT_FAIL_CLOSED` và hướng dẫn khởi tạo Node 22+ / `.env` / Playwright vào `README.md` và `.env.example`; loại bỏ chuỗi định danh nội bộ khỏi header gọi API Gemini trong `chatService.ts`.
- **SaveCoordinator (CA-05)**: Khắc phục cơ chế `shouldDeferAutoSave` lặp lại nhiều chu kỳ khi người dùng đang kéo thả đối tượng; bổ sung 8 kịch bản test đơn vị bao phủ debounce, giữ trạng thái lỗi, hoãn lưu khi kéo, `flush()` khi đóng tab, `reset()`, `dispose()` và bất biến `committedVersion <= dirtyVersion`.
- **Bảo mật & Trợ lý AI (CA-06, CA-07, CA-08)**: Bổ sung kiểm tra vi phạm CSP & lỗi runtime vào E2E; tăng cường unit test cho `/api/health`, chế độ fallback ngoại tuyến/rate-limit và kiểm tra giới hạn kích thước/số đối tượng + chặn XSS `<image>`/`<use>` trong SVG base64.
- **Chốt mốc BOM & Tối ưu nạp mẫu (CA-13, CA-18)**: Bổ sung nút **Chốt mốc BOM hiện tại** ngay trong tab *So sánh BOM* của `BomStatisticsModal` để lưu snapshot đối chiếu tức thì; tách mẫu mặc định (`defaultStarterTemplate.ts`) và tải lười `data/templates.ts` khỏi bundle khởi đầu.
- **Mở rộng Playwright E2E (CA-14)**: Mở rộng từ 1 ca lên **10 ca kiểm thử E2E** trên cả 3 khung kích thước (`desktop-wide`, `tablet-medium`, `mobile-narrow`).

## [3.1.1] - 2026-11-16

### Thêm mới
- **Nút Mô hình 3D trực tiếp & kéo thả di chuyển trong 3D**: Đưa nút chuyển đổi `Mô hình 3D` / `Thoát 3D` (`data-testid="toggle-3d-btn"`) ra ngoài thanh công cụ (và mục đầu tiên trong ngăn kéo di động); hỗ trợ kéo thả thiết bị và tủ Rack trực tiếp trên mặt phẳng 3D theo thời gian thực (cập nhật tuyến cáp 3D sống, đồng bộ tọa độ 2D, snap lưới khi thả và hỗ trợ Undo/Redo).
- **Thông số ắc quy UPS thực tế (`upsSpecs`)**: Cho phép khai báo dung lượng (`Ah`), điện áp hệ (`V`), số bình, hiệu suất inverter và DoD trên từng UPS trong bảng thuộc tính; máy tính lưu điện đồng bộ trực tiếp theo thông số UPS.
- **Quy trình CI tự động (GitHub Actions)**: Tự động chạy `npm run lint`, `npm test`, `npm run build` và Playwright E2E trên mọi push/PR; đồng bộ `package-lock.json` chuẩn `npm ci` (gỡ bỏ `bun.lock` lệch chuẩn).
- **Công thức BOM theo chiều đứng (`verticalRiseMeters`, `dropHeightMeters`)**: Hỗ trợ cấu hình chiều cao thả trần mỗi đầu (m) và chiều cao thông tầng (m/tầng), tích hợp trực tiếp vào giao diện BOM, CSV và các công thức sống sheet `Cap_Tung_Tuyen` / `Gia_Dinh_BOM` trong Excel.
- **Truy vết BOM → Bản vẽ**: Nhấp vào dòng thiết bị, loại cáp hoặc tầng trong hộp thoại BOM để định vị và chọn trực tiếp đối tượng tương ứng trên bản vẽ.
- **Cảnh báo kiểm soát dữ liệu BOM**: Phát hiện thêm tuyến cáp chưa gán cổng (`Auto`) và thiết bị hoạt động thiếu thông số Model/Công suất (W).

### Cải tiến bảo mật & ổn định
- **Khắc phục P0 kiểm tra UPS**: Loại bỏ ngưỡng tối thiểu giả định `Math.max(w, 1500)` và công thức ước lượng cứng `0.45 * 60` trong `engineeringValidator.ts`; chỉ cộng công suất thực tế đã khai báo và phát cảnh báo khi UPS chưa có công suất định mức hoặc thiếu thông số ắc quy.
- **Đồng bộ giới hạn tần suất AI Serverless (`/api/gemini/chat`)**: Áp dụng đủ bộ đếm phút, giờ và hạn mức ngày toàn cục cùng cơ chế dọn bộ nhớ khi chưa cấu hình Upstash Redis, đồng bộ hoàn toàn với `server.ts`.
- **Giới hạn kích thước & số lượng đối tượng khi nhập tệp**: Kiểm tra ngưỡng dung lượng an toàn trước khi đọc/parse tệp `.hachihi.json` (15 MB), Excel/CSV (10 MB), NetworkScanner (5 MB), gói nhiều dự án (50 dự án), giới hạn nút/cáp/thiết bị và chặn thẻ SVG `<image>`/`<use>` trỏ ra ngoài trước khi rasterize.
- **Giữ nguyên máng cáp khi lưu/khôi phục**: Bổ sung chuẩn hóa `cableTrays` trong pipeline di chuyển/nhập dự án.
- **Tài liệu biến môi trường**: Bổ sung bảng mô tả đầy đủ tất cả biến môi trường tùy chọn trong `README.md` và `.env.example`.

## [3.1.0] - 2026-11-15

### Thêm mới
- **Tab Giới thiệu HACHIHI (`AboutModal`)**: Hiển thị logo chính thức (Sáng/Tối), trang web `hachihi.vn`, hotline `093 384 2126`, hỗ trợ kỹ thuật `09-1800-1944`, số phiên bản, mã build, danh sách tính năng chuyên nghiệp và tuyên bố lưu dữ liệu cục bộ.
- **Kênh Góp ý (Google Form)**: Nút truy cập nhanh từ thanh trên, menu chính và hộp thoại Giới thiệu; tự động điền sẵn phiên bản, mã build, chế độ thiết kế và thiết bị (không đính kèm dữ liệu bản vẽ) và kiểm tra trạng thái ngoại tuyến.
- **Đánh số phiên bản thống nhất từ `package.json`**: Tiêm hằng số phiên bản, mã build (`git short hash`) và ngày phát hành vào giao diện, thanh trạng thái, gói dự án `.hachihi.json`, khung tên PDF, sheet `Gia_Dinh_BOM` Excel, chân trang HTML viewer và tệp AutoCAD DXF.
- **Hộp thông báo "Có gì mới"**: Tự động hiển thị một lần sau khi ứng dụng cập nhật phiên bản mới.
- **Nâng cấp BOM & Giả định**: Bổ sung giả định hao hụt cáp đồng/quang riêng biệt, dự phòng đầu cáp (`service loop`), làm tròn quy cách cuộn cáp, danh mục phụ kiện suy ra theo quy tắc thi công, kiểm soát đối soát chéo và xuất thêm sheet `Phu_Kien_Suy_Ra` + `Gia_Dinh_BOM` với công thức Excel sống.
- **Khóa theo lớp (`layerPolicy`) & Trợ giúp tìm kiếm không dấu (`helpCatalog`)**: Chuẩn hóa kiểm tra khóa/ẩn theo lớp và thanh tìm kiếm hướng dẫn tiếng Việt không dấu trong Hướng dẫn sử dụng.
- **Cấu hình bảo mật & kiểm thử**: Thêm `vercel.json` với header CSP/bảo mật, cấu hình Playwright E2E và nâng cấp giới hạn tần suất dùng kho Redis dùng chung cho serverless API.

### Thay đổi
- **Cấu trúc Menu chính 6 nhóm (`≡`)**: Tổ chức lại toàn bộ lệnh vào 6 nhóm rõ ràng (*Dự án*, *Thiết kế*, *Dữ liệu hạ tầng*, *Tính toán và kiểm tra*, *Xuất hồ sơ*, *Trợ giúp*) và giữ thanh trên gọn ~9 mục chính.
- **Thống nhất thuật ngữ tiếng Việt**: *Topology* → *Sơ đồ logic*, *Hub* → *Trung tâm dự án*, *HUD* → *Điều khiển khung nhìn*, *Audit* → *Kiểm tra kỹ thuật*, *BOM* → *Vật tư (BOM)*.
- **Trợ lý AI theo trạng thái mạng & API**: Tự động ẩn nút chat AI trực tuyến khi không có cấu hình máy chủ hoặc đang ngoại tuyến.
- **Tối ưu PWA precache**: Loại trừ các gói nặng (`three`, `pdf`, `exceljs`, `recharts`) khỏi precache ban đầu và dùng runtime cache.

### Gỡ bỏ
- Xóa các tệp tài nguyên dư thừa trong `public/assets/aistudio/` và gỡ bỏ thư viện `motion` không sử dụng.

## [3.0.0] - 2026-11-01

### Thêm mới
- Nền tảng thiết kế đa chế độ (8 chế độ Logic, Mặt bằng, Tủ Rack 19", Cáp quang, Camera, Wi-Fi, Hệ thống điện) lưu cục bộ bằng IndexedDB + PWA.
- Tự động đi tuyến cáp tránh vật cản, tính toán PoE theo switch, kiểm tra kỹ thuật và xuất hồ sơ PDF/DXF/SVG/HTML/Excel.
