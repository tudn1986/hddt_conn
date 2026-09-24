# hddt-conn v1.3.0-rc.2

## Mục tiêu bản RC.2

Bản `1.3.0-rc.2` hoàn thiện hai yêu cầu nghiệp vụ:

1. Mã hàng hóa/dịch vụ (`InvoiceLine.itemCode`) xuất ra sheet `ChiTiet` của báo cáo Excel và hiển thị rõ trên báo cáo frontend.
2. Các tác vụ xuất/tải hàng loạt Excel, PDF và XML chỉ nhận tập hóa đơn/chứng từ người dùng đã tick chọn tại màn hình Quản lý hóa đơn.

## Thay đổi chính

### Selection dùng chung toàn ứng dụng

Selection được nâng từ state cục bộ của `InvoicePage` lên `App.tsx`. Nhờ đó tập hóa đơn đã chọn được dùng nhất quán khi:

- Xuất báo cáo Excel từ màn hình Quản lý hóa đơn.
- Tải XML từ thanh tác vụ hoặc trang Tải XML/ZIP.
- Tải PDF bản thể hiện theo batch TVAN.
- Mở tab Kết xuất Form PMKT; báo cáo trên màn hình và file Excel/Profile chỉ dùng tập đã chọn.

Nếu chưa chọn hóa đơn, các nút xuất tương ứng bị vô hiệu hóa hoặc hiển thị cảnh báo yêu cầu chọn dữ liệu.

### Mã hàng hóa/dịch vụ

Dữ liệu `itemCode` vốn đã được normalizer lấy từ `mhhdvu`, `ma` hoặc `itemCode`. RC.2 đưa trường này ra các bề mặt báo cáo:

- Sheet `ChiTiet`: thêm cột `Mã hàng hóa/dịch vụ` ngay sau `STT dòng`.
- Cột mã được định dạng Excel Text (`@`) để giữ các mã có số 0 đầu và tránh Excel tự đổi kiểu.
- Cửa sổ `Chi tiết HHDV`: đổi tên cột thành `Mã hàng hóa/dịch vụ`.
- Tab `Kết xuất Form PMKT` → `Báo cáo trên màn hình` → `Hàng hóa/dịch vụ`: thêm cột `Mã hàng hóa/dịch vụ`.

### UX xuất dữ liệu

Thanh tác vụ hiển thị trực tiếp số hóa đơn đang chọn:

- `Xuất Excel (n)`
- `Tải XML (n)`
- `Tải PDF (n)`

Tên file Excel có thêm số lượng hóa đơn, ví dụ `HDDT_Report_purchase_2HD_<timestamp>.xlsx`.

## File mã nguồn thay đổi chính

- `src/web/App.tsx`
- `src/web/pages/InvoicePage.tsx`
- `src/web/pages/DownloadPage.tsx`
- `src/web/pages/AccountingExportPage.tsx`
- `src/web/components/invoices/InvoiceLinesModal.tsx`
- `src/server/export/excel-report.ts`
- `tests/helpers.ts`
- `tests/unit/export.test.ts`

Ngoài ra cập nhật version runtime/package và script đóng gói source sang `1.3.0-rc.2`.

## Kiểm tra trong môi trường tạo RC.2

- Kiểm tra cú pháp TypeScript/TSX bằng TypeScript transpile trên toàn bộ `src` + `tests`: đạt, 92 file, 0 lỗi cú pháp.
- `node --check` cho các script `.mjs` thay đổi: đạt.
- Full `npm test`, `npm run build`, `npm run verify`: chưa chạy được vì source bundle không chứa `node_modules`; cài dependency online bị timeout và chế độ offline thiếu cache `@ant-design/icons`.

Trước khi đưa lên production cần chạy `npm ci`/`pnpm install` trong môi trường có registry, sau đó chạy `npm run verify` và kiểm thử thực tế với hóa đơn có/không có `itemCode`.
