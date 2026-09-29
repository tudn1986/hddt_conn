# HDDT v1.2.1 — TVAN Representation PDF Architecture

## Mục tiêu

Subsystem TVAN tách khỏi connector GDT. `InvoiceDocument` là input duy nhất từ WebUI; backend tự trích `providerCode/ngcnhat`, MST người bán, mã tra cứu và các trường mở rộng/raw payload. Frontend không nhận token TVAN và không cho người dùng nhập URL/API.

## Capability model

| Priority | CAPTCHA | Hành vi batch |
|---|---|---|
| P1 | `none` | tải trước, không dừng |
| P2 | `session` | lấy CAPTCHA một lần khi chưa có token; token dùng lại cho các hóa đơn cùng TVAN tới khi hết hạn |
| P3 | `per_invoice` | mỗi hóa đơn cần challenge/token riêng; token xóa ngay sau download |

Registry v1.2.1 có adapter MISA và Viettel. Adapter mới chỉ cần implement `TvanAdapter`; batch engine không phụ thuộc API cụ thể của nhà cung cấp.

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


## Hotfix v1.2.1 — CAPTCHA Viettel và route MISA

- Viettel: challenge slider chỉ được trả ra UI khi backend lấy được ảnh nền CAPTCHA. Adapter nhận thêm các trường ảnh phổ biến như `originalImageBase64` và `jigsawImageBase64`; token challenge vẫn chỉ ở backend. UI hiển thị ảnh + mảnh ghép + thanh trượt và tự chuyển vị trí thành `offsetX`. Payload token-only không còn biến thành ô nhập `offset X` mù.
- MISA: ưu tiên đúng capture production `POST /tra-cuu/GetInvoiceDataByTransactionID` với form `transactionID=<TransactionID>`, sau đó dò URL PDF trong response và fallback sang các `downloadhandler.ashx` công khai đã biết.
- Bảo mật: redirect vẫn được kiểm tra allow-list từng hop; token/captcha id không trả về frontend.

## Revision 3 — kiến trúc truy vấn/xem/tải sau khi review CLA1

`CLA1.zip` được dùng như tài liệu tham khảo cho capability model, provider connector, token cache và batch priority. HDDT không copy nguyên connector mẫu khi nó mâu thuẫn với capture production.

### Pipeline chuẩn hóa

1. **Resolve lookup context** từ `InvoiceDocument` đã lấy ở GDT: `ngcnhat/providerCode`, MST người bán, `TransactionID` hoặc `Mã số bí mật`, và URL tra cứu nếu có.
2. **Provider query/auth**: MISA query metadata bằng `GetInvoiceDataByTransactionID`; Viettel chỉ tạo/verify CAPTCHA khi chưa có token P2 hợp lệ. Backend giữ toàn bộ token/private challenge state.
3. **PDF fetch**: adapter tải đúng bản thể hiện PDF và bắt buộc xác nhận `%PDF-`; XML/HTML không được giả lập thành PDF.
4. **Viewer/batch** dùng chung adapter. Double-click gọi pipeline cho một hóa đơn; batch chỉ thay orchestration thành P1 → P2 → P3.

### Evidence precedence

Khi CLA1 và capture thực tế khác nhau, thứ tự ưu tiên là: **production capture người dùng cung cấp → tài liệu chính thức nhà cung cấp → CLA1 sample connector → probe compatibility có allow-list**. Cách này đặc biệt áp dụng cho Viettel download (capture dùng POST JSON, trong khi CLA1 sample dùng GET headers).

### MISA query → PDF

Production contract đã được chốt từ browser capture:

1. `POST https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID` với form `transactionID=<TransactionID>`.
2. Lấy `customData` trong response và dùng **trực tiếp** làm `ext`.
3. Tải bản thể hiện bằng `GET https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>`.

Adapter giữ đúng path và casing query parameter đã quan sát. `GetRequestTimeEnCode` chỉ còn là backward-compatibility khi metadata cũ không có `customData`. Chỉ response có magic bytes `%PDF-` mới được trả về viewer/batch.

### Viettel challenge → token → PDF

CLA1 xác định route challenge `/captcha/get`; capture thực tế xác định verify `/captcha/verify` với `{token, offsetX}` và PDF với `supplierTaxCode + reservationCode + recaptcha`. Revision 3 thử `/captcha/get` bằng GET trước, rồi POST khi response chỉ có token; chỉ tạo slider challenge khi đã map được ảnh nền. Token verify được cache RAM theo TTL và dùng lại cho nhiều hóa đơn P2.

## Revision 7 — Viettel supervised production acceptance

Tab **Chi tiết hóa đơn → Tổng quan** now contains a Viettel supervision card for `tvan_viettel`. It deliberately exposes the workflow as three explicit user-driven stages:

1. acquire a displayable CAPTCHA challenge while reporting the successful endpoint/method/status;
2. verify the user's solution and report a masked verify request plus session-token expiry;
3. show the exact production `downloadPDF?taxCode=...` POST plan with masked `recaptcha`, then fetch/open the PDF only after the user presses the final button.

The challenge token and reusable session token remain backend-only. The supervision API returns only safe request traces. This revision does not change the P2 batch semantics; once production acceptance is complete, the same cached token continues to support multiple Viettel invoices until expiry.
