# HDDT v1.2.1 r3 — Review thiết kế/mã nguồn CLA1 cho TVAN PDF

## Phạm vi review

Đã đọc `hddt_features_design.md`, `misa.connector.ts`, `viettel.connector.ts`, `pdf-viewer.service.ts`, `batch-download.service.ts`, `backport.service.ts`, `api.routes.ts` và các component viewer/batch trong `CLA1.zip`.

## Phần được kế thừa

- Capability theo nhà cung cấp: MISA không CAPTCHA/P1; Viettel CAPTCHA có token tái sử dụng/P2; provider chưa biết có thể là P3.
- Adapter/provider boundary: UI không biết endpoint, mã tra cứu hay token nội bộ.
- Token cache server-side với TTL và cơ chế re-auth khi token bị provider từ chối.
- Batch group theo provider và thứ tự P1 → P2 → P3.
- Backport nhận raw JSON/XML để mở rộng mapping cho TVAN mới.
- Viettel challenge route ưu tiên `/api/services/einvoiceuaa/api/captcha/get`.

## Phần không copy nguyên mẫu CLA1

### MISA XML không phải PDF

`CLA1/misa.connector.ts` có fallback chuyển XML sang HTML/Buffer nhưng vẫn trả `contentType: application/pdf`. Đây chỉ là scaffold/MVP và không đáp ứng yêu cầu “bản thể hiện PDF”. HDDT giữ validation `%PDF-` bắt buộc và dùng route download của MISA thay vì giả lập PDF.

### Viettel download contract

CLA1 sample mô tả GET `downloadPDF` với các giá trị trong headers. Capture production người dùng cung cấp lại thể hiện request body JSON gồm `supplierTaxCode`, `reservationCode`, `recaptcha`. HDDT ưu tiên capture production và tiếp tục dùng POST JSON.

### CAPTCHA challenge chưa có capture production

CLA1 cho biết `/captcha/get`, nhưng file capture hiện có chỉ chứng minh `/captcha/verify` và `downloadPDF`, chưa chứng minh method/body/shape ảnh của endpoint challenge. Vì vậy revision 3:

- ưu tiên `/captcha/get`;
- thử GET rồi các POST shape giới hạn, cùng-origin;
- parse ảnh ở payload lồng nhau;
- tuyệt đối không yêu cầu người dùng nhập `offsetX` khi không có ảnh;
- nếu vẫn thất bại, Backport cần capture request/response challenge thật để khóa mapping.

## MISA evidence mới dùng trong r3

Hai capture `GetInvoiceDataByTransactionID` trả `customData` 8 ký tự (`1_73XNGR`, `G0NL2642`). HDDT dùng chúng như ứng viên `ext` cho `downloadhandler.ashx`. Vì chưa có evidence khẳng định `customData` luôn đồng nhất với request-time token, adapter luôn giữ fallback `GetRequestTimeEnCode` nếu ứng viên này không cho PDF.

## Pipeline áp dụng chung

`InvoiceDocument (GDT)` → `resolve provider/lookup context` → `query/auth provider` → `fetch + validate PDF` → `viewer` hoặc `batch ZIP`.

Batch không truyền token ra browser. P2 chỉ dừng một lần khi chưa có token hợp lệ; P3 dừng từng hóa đơn. Kết quả lỗi từng task được ghi vào manifest mà không hủy các PDF tải thành công.
