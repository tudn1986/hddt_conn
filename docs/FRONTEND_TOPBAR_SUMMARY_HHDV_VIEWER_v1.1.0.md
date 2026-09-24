# HDDT-CONN v1.1.0 — Top Bar, InvoiceSummaryBar và HHDV Fullpage Viewer

## Phạm vi triển khai

### 1. Top bar duy nhất
- Chuyển menu hướng dữ liệu: Mua vào, Bán ra, Tải hóa đơn XML, Kết xuất Form PMKT, Cài đặt lên Header.
- Chuyển cụm tác vụ: Lưu dữ liệu, Mở dữ liệu, Xuất Excel, Xếp XML, Xóa lọc, Kết quả lên Header.
- Tên ứng dụng ở vùng giữa: `hddt-conn`.
- Bên phải: `MST`, đăng xuất/đăng nhập khi phù hợp và `Thoát`.
- Bỏ render thanh menu cấp hai.
- Header cao 48px để tăng diện tích làm việc.

### 2. Summary mới
Thay toàn bộ summary cũ bằng:

```text
InvoiceSummaryBar
├── InvoiceCountSummary
└── CurrencySummaryCard[]
```

Tất cả nằm cùng một hàng, cao cố định 68px.

Mỗi `CurrencySummaryCard` là grid 2×2:

```text
┌─────────────┬────────────────────┐
│ Currency    │ Tiền HHDV          │
├─────────────┼────────────────────┤
│ Tổng TT     │ Tiền thuế          │
└─────────────┴────────────────────┘
```

Label nghiệp vụ của các quadrant được cung cấp qua Tooltip + focus + `aria-label`, không hiển thị trực tiếp để tiết kiệm không gian.

Chuẩn hóa tiền tệ:
- `VND`, `VNĐ`, `Đ`, `D`, rỗng/null -> `VND`.
- Các currency khác giữ mã đã normalize.

Khi có nhiều currency, card chạy trên một horizontal strip; không wrap xuống dòng nên không tăng chiều cao summary.

### 3. Bỏ expand column
- Không còn cột dấu `+`.
- `computeInvoiceTableMetrics()` chỉ tính thêm chiều rộng cột selection.
- Không render `expandable` trong Ant Design Table.

### 4. Mở chi tiết HHDV từ ô tiền
Hai cột:
- `Tiền HHDV` (`subtotal`)
- `Tiền thuế` (`vatAmount`)

trở thành trigger xem detail.

Hành vi:
- Hover: Tooltip thông báo `Nhấp đúp để xem chi tiết HHDV`.
- Double-click: mở HHDV viewer.
- Keyboard: Enter/Space cũng mở viewer.
- Không thay đổi hành vi của cột `Tổng tiền thanh toán`.

### 5. HHDV fullpage popup
`InvoiceLinesModal` là popup gần toàn màn hình, giữ design language hiện tại:
- Header light blue/subtle.
- Zebra rows.
- Hover row.
- Số căn phải.
- Table có horizontal scroll khi cần.
- `Esc`, nút `Đóng` hoặc click backdrop để đóng.
- Có các nút `Rộng −`, `Rộng +`, `Cao −`, `Cao +`, `Toàn trang`.
- Người dùng cũng có thể kéo góc dưới bên phải để resize cả chiều ngang và dọc.
- Nếu invoice chưa có `lines[]`, hiển thị Empty state; không phát sinh API tự động.

## File thay đổi

```text
src/web/App.tsx
src/web/invoice-page.css
src/web/pages/InvoicePage.tsx
src/web/pages/invoice-table-layout.ts
src/web/components/invoices/InvoiceSummaryBar.tsx      (new)
src/web/components/invoices/InvoiceLinesModal.tsx      (new)
tests/unit/invoice-table-layout.test.ts
```

## Kiểm tra đã thực hiện
- TypeScript transpile syntax: đạt cho toàn bộ TS/TSX thay đổi.
- Runtime smoke cho `computeInvoiceTableMetrics`: controls width chỉ còn selection width.
- CSS brace balance: đạt.
- Không còn `expandable`, `expandedRowKeys`, `InlineLines`, `expandWidth` trong luồng bảng hóa đơn.
