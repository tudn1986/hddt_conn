# HDDT v1.1.0 — Frontend FIX2

Ngày: 12/09/2026

Bản FIX2 tham khảo `InvoicePage.fixed(2).tsx` do người dùng cung cấp, nhưng merge có chọn lọc lên v1.1.0 để giữ nguyên dual-source standard/POS và các contract backend hiện hành.

## Nội dung sửa

1. **Menu chương trình**
   - Header cố định theo viewport bằng `position: sticky`.
   - Sider menu cố định dưới header, cao theo viewport và tự scroll khi cần.
   - Content có `min-width: 0` để thanh cuộn bảng nằm trong vùng bảng thay vì làm tràn toàn trang.

2. **Thanh trượt động bảng hóa đơn**
   - Chiều cao bảng tính theo vị trí thực tế của bảng và chiều cao viewport.
   - Recalculate khi resize, số dòng/filter/direction thay đổi.
   - Có `ResizeObserver` để đồng bộ khi layout thay đổi.
   - `scroll.x` được tính từ tổng width cột, không hard-code 1900/2100.

3. **Độ rộng cột và tên đối tác**
   - Mở rộng các cột định danh/tổng tiền hợp lý.
   - Cột `Đối tác` tăng lên 320px.
   - Bỏ ellipsis ở tên đối tác; cho phép wrap để hiển thị đầy đủ.

4. **Tình trạng hóa đơn**
   - Hiển thị riêng `invoiceStatus` (`tthai`) với nhãn:
     - 1: Hóa đơn mới
     - 2: Hóa đơn thay thế
     - 3: Hóa đơn điều chỉnh
     - 4: Đã bị thay thế
     - 5: Đã bị điều chỉnh
     - 6: Đã bị hủy
   - `processingStatus` (`ttxly`) vẫn là cột riêng `Trạng thái xử lý`.
   - Thêm filter đa chọn theo tình trạng hóa đơn.
   - Drawer chi tiết hiển thị cả tình trạng hóa đơn và trạng thái xử lý.

## File thay đổi

- `src/web/App.tsx`
- `src/web/invoice-page.css`
- `src/web/pages/InvoicePage.tsx`
- `src/web/pages/invoice-filters.ts`
- `tests/unit/invoice-filters.test.ts`

## Kiểm tra

- TypeScript transpile/syntax check toàn bộ `src` + `tests`: 49 file, 0 lỗi parse.
- Full `pnpm verify` chưa chạy trong môi trường đóng gói này vì không có `node_modules`; cần chạy trên máy Windows/macOS có dependencies trước khi phát hành native.
