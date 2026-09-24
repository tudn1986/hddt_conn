# HDDT v1.1.0 — Frontend UX/UI Phase 1 + Phase 2 Implementation

## Phạm vi

Bản source này triển khai nhóm công việc UX/UI Đợt 1 và Đợt 2 theo tài liệu kế hoạch frontend, với nguyên tắc ưu tiên desktop/data-centric và **không tăng chiều cao Summary card**.

## Các điểm đã triển khai

### Đợt 1

- Design tokens dùng chung cho màu, typography, spacing, radius, shadow, transition.
- Nền content `#fafafa`, surface/table/card màu trắng.
- Navigation và Data Actions có visual grouping riêng.
- Query bar giữ compact, chỉ để các trường tra cứu thường dùng ở hàng chính.
- Table tiếp tục dùng width profile HD / HD+ / 1080p / 2K dựa trên container.
- Expand column và selection column giữ width cố định.
- Tên đối tác tối đa 2 dòng; identifier một dòng + ellipsis.
- Tiền căn phải, `tabular-nums`, format theo `vi-VN`; VND không hiển thị phần thập phân.
- Zebra row, hover row, selected row và sorted/filter active state.
- Status tag có icon + text + color.
- Column chooser có preset `Mặc định`, `Tối giản`, `Kế toán`, `Đầy đủ` và lưu lựa chọn.
- Horizontal scroll chỉ có khi intrinsic width lớn hơn viewport; có affordance shadow hai mép.
- Virtual table được giữ nguyên.

### Đợt 2

- Lọc nâng cao đóng/mở; không chiếm chiều cao khi không sử dụng.
- Filter chips cho các điều kiện local đang áp dụng, có thể xóa từng chip hoặc xóa tất cả.
- Quick search có placeholder mô tả phạm vi và debounce 160ms.
- Empty state có hướng dẫn xóa bộ lọc.
- Loading vẫn gắn với đúng button/table thay vì khóa toàn trang.
- Expanded HHDV có visual hierarchy riêng.
- Lưu cấu hình cột bằng `localStorage` có schema version.
- Lưu quick search/filter/advanced-open trong `sessionStorage`.
- Contextual action bar chỉ xuất hiện khi có dòng được chọn.
- Keyboard workflow: `Ctrl/Cmd + S` lưu dữ liệu, `Ctrl/Cmd + E` xuất Excel, `Esc` đóng lọc nâng cao.
- Focus-visible được chuẩn hóa.
- Pattern card/table được áp dụng thêm cho Download và Accounting Export.

## Summary card

Không tăng chiều cao:

```text
min-height: 64px
max-height: 72px
```

Mục đích là giữ vùng tổng hợp đủ đọc nhưng ưu tiên chiều cao viewport cho bảng hóa đơn.

## File mã nguồn thay đổi/thêm mới

```text
src/web/main.tsx
src/web/App.tsx
src/web/ui-tokens.css                         # mới
src/web/invoice-page.css
src/web/pages/InvoicePage.tsx
src/web/pages/invoice-ui-preferences.ts       # mới
src/web/pages/DownloadPage.tsx
src/web/pages/AccountingExportPage.tsx
tests/unit/invoice-ui-preferences.test.ts     # mới
```

`src/web/pages/invoice-table-layout.ts` được giữ nguyên vì ma trận width HD/HD+/1080p/2K của bản trước đã phù hợp với phương án Đợt 1.

## Kiểm tra đã thực hiện

- TypeScript transpile syntax check cho toàn bộ TS/TSX đã sửa: đạt.
- Strict typecheck cho các module thuần `invoice-ui-preferences.ts`, `invoice-filters.ts`, `invoice-table-layout.ts`: đạt với cấu hình bundler và shim Buffer tối thiểu.
- Không chạy full Vite build/test vì source package không có `node_modules` và môi trường không thể tải package manager/dependency từ Internet.
