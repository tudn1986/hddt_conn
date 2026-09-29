# HDDT v1.2.0 — TVAN Representation PDF Architecture

## Mục tiêu

Subsystem TVAN tách khỏi connector GDT. `InvoiceDocument` là input duy nhất từ WebUI; backend tự trích `providerCode/ngcnhat`, MST người bán, mã tra cứu và các trường mở rộng/raw payload. Frontend không nhận token TVAN và không cho người dùng nhập URL/API.

## Capability model

| Priority | CAPTCHA | Hành vi batch |
|---|---|---|
| P1 | `none` | tải trước, không dừng |
| P2 | `session` | lấy CAPTCHA một lần khi chưa có token; token dùng lại cho các hóa đơn cùng TVAN tới khi hết hạn |
| P3 | `per_invoice` | mỗi hóa đơn cần challenge/token riêng; token xóa ngay sau download |

Registry v1.2.0 có adapter MISA và Viettel. Adapter mới chỉ cần implement `TvanAdapter`; batch engine không phụ thuộc API cụ thể của nhà cung cấp.

## MISA

Evidence đầu vào có `GetInvoiceDataByTransactionID`, `GetEinvoiceByTransactionID` và `TransactionID`. Adapter:

1. trích `TransactionID` từ dynamic/raw/lookup;
2. đọc metadata public lookup;
3. nếu payload trả URL report/download, chỉ theo URL thuộc allow-list MISA;
4. fallback theo public-browser flow MISA đã công bố: `GetRequestTimeEnCode` + `download.meinvoice.vn/downloadhandler.ashx`;
5. chỉ chấp nhận response có PDF magic `%PDF-`.

Không lưu mã/token ra disk.

## Viettel

Evidence đầu vào xác nhận:

- verify CAPTCHA: `/api/services/einvoiceuaa/api/captcha/verify` với challenge token + `offsetX`;
- verify trả token phiên;
- PDF: `/api/services/einvoicequery/sync/utility/downloadPDF?taxCode=...` với `supplierTaxCode`, `reservationCode`, `recaptcha`;
- `reservationCode` map từ `Mã số bí mật` trong payload GDT.

Token phiên chỉ giữ RAM theo TTL. Một token P2 có thể dùng cho nhiều MST/mã tra cứu như evidence nghiệp vụ đã nêu. Nếu server trả 401/403/419/422, token bị xóa và batch/view quay về CAPTCHA.

Payload chưa cung cấp request/response endpoint **cấp challenge CAPTCHA**; adapter hiện thử một số route cùng origin phổ biến. Nếu không khớp, backend trả lỗi hướng người dùng tới Backport thay vì suy diễn request tùy ý.

## PDF viewer

Double-click `Số hóa đơn` gọi `prepare-view` rồi `view`. PDF được trả `inline` từ local backend và render trong iframe `blob:` của modal WebUI. CSP chỉ mở `frame-src 'self' blob:`; không frame nội dung remote.

## Batch

Batch tối đa 2.000 hóa đơn, sort P1 → P2 → P3. Task lỗi không chặn task sau. Thành công được lưu vào thư mục tạm app-data, sau đó đóng gói ZIP cùng `manifest.json`. Thư mục batch được dọn sau 6 giờ.

## Security

- Host TVAN hard-code theo adapter, HTTPS-only.
- Backport không fetch URL trong payload.
- Download có timeout + size limit + PDF magic validation.
- Tên file được sanitize.
- Challenge private state/token không trả frontend.
- CSRF/origin policy của Local API áp dụng cho toàn bộ route TVAN.
- Backport raw payload lưu cục bộ bằng atomic JSON mode 0600.

## Backport

Trang `TVAN Backport` nhận `providerCode`, raw JSON/XML và ghi chú. Analyzer phát hiện URL, lookup candidates, MST và field liên quan transaction/captcha/pdf/download. Mục tiêu là tạo evidence cho adapter mới mà không phải sửa flow batch/UI.
