# Frontend invoice column visibility — v1.1.0

## Mục tiêu

Giảm số cell cần render mặc định trong bảng hóa đơn và làm giao diện gọn hơn bằng menu ẩn/hiện cột ở phần **Thông tin hóa đơn**.

## Cột mặc định

Ô chọn hóa đơn luôn hiển thị với chiều rộng 52 px. Các cột dữ liệu mặc định gồm:

1. Ngày
2. Ký hiệu
3. Số hóa đơn
4. MST đối tác (MST bán ở mua vào / MST mua ở bán ra)
5. Tên đối tác
6. Loại tiền tệ
7. Tiền hàng
8. Tiền thuế
9. Tổng tiền thanh toán
10. Tình trạng hóa đơn

## Menu cột

Nút **Cột hiển thị** nằm ở góc phải tiêu đề bảng. Người dùng có thể bật/tắt từng cột dữ liệu. Có hai thao tác nhanh:

- **Mặc định**: quay về bộ cột mặc định ở trên.
- **Hiện tất cả**: bật toàn bộ cột dữ liệu hiện có.

Cột bị tắt được loại khỏi cấu hình `columns` truyền vào Ant Design Table, không chỉ bị che bằng CSS; do đó số cell/DOM cần render giảm tương ứng.

## File thay đổi

- `src/web/pages/InvoicePage.tsx`
- `src/web/invoice-page.css`

## Kiểm tra

Đã kiểm tra cú pháp/transpile TSX bằng TypeScript. Không thể chạy full build/test trong môi trường đóng gói hiện tại vì dependency cục bộ chưa có sẵn và bước cài dependency không hoàn tất.
