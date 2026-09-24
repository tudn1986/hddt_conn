# HDDT v1.2.1 — TVAN PDF hotfix

v1.2.1 là patch release cho hai lỗi UAT của v1.2.0.

## Viettel

- Không còn hiển thị ô nhập `offset X` khi backend chưa có ảnh CAPTCHA.
- Hỗ trợ payload slider có `originalImageBase64` / `jigsawImageBase64` kể cả khi nằm trong object lồng nhau.
- UI hiển thị ảnh nền, mảnh ghép, thanh trượt và chỉ báo vị trí X.
- Challenge token không đi ra frontend; frontend chỉ gửi challenge id của HDDT và thao tác người dùng.
- Sau verify, token Viettel tiếp tục được backend cache TTL và tái sử dụng cho P2.

## MISA

- Sửa lookup theo capture: `GetInvoiceDataByTransactionID`, form `transactionID=<id>`.
- Nếu metadata không trả URL PDF, dùng `GetRequestTimeEnCode` và `downloadhandler.ashx` theo public flow của MISA.
- Không yêu cầu CAPTCHA.

## Không thay đổi

- Dataset schema vẫn là schemaVersion 1.
- API GDT/query/detail/XML hiện hữu không đổi.
- Batch priority vẫn P1 → P2 → P3.
- TVAN Backport vẫn không fetch URL tùy ý và không trở thành SSRF proxy.

## Compile fix (revision 2)

UAT build phát hiện TypeScript error trong `src/server/tvan/adapters/misa.ts`: `assertAllowedUrl()` trả về `URL` nhưng tập `visited` được khai báo `Set<string>`. Revision 2 chuẩn hóa khóa vòng lặp bằng `target.href` trước khi gọi `visited.has()` / `visited.add()`. Thay đổi này không đổi giao thức MISA, chỉ sửa type-safety và chặn lặp URL theo chuỗi canonical.

Revision 2 cũng audit lại version vận hành: `VERSION`, `package.json`, server status, WebUI, tray/smoke/package scripts đều là **1.2.1**. Các tài liệu `v1.2.0` còn lại là tài liệu lịch sử/compatibility, không phải version runtime.

## Revision 3 — đối chiếu CLA1 và production capture

Revision 3 giữ nguyên **app version 1.2.1** và đối chiếu lại subsystem PDF với `CLA1.zip`.

### MISA

- Giữ `GetInvoiceDataByTransactionID` + `transactionID` làm bước query chính theo CLA1 và capture thực tế.
- Production capture trả `customData` 8 ký tự (`1_73XNGR`, `G0NL2642`). Adapter dùng giá trị này như **ứng viên `ext`** cho `downloadhandler.ashx` trước, không coi nó là PDF/XML.
- Nếu ứng viên `customData` không tải được PDF, adapter tiếp tục gọi `GetRequestTimeEnCode` và lấy 8 ký tự theo đúng browser flow công khai của MISA. Vì vậy `customData` sai/đã cũ không khóa mất fallback chuẩn.
- Không áp dụng fallback của `CLA1/misa.connector.ts` biến XML/HTML thành `Buffer` rồi gắn `application/pdf`; HDDT chỉ nhận file khi magic bytes bắt đầu `%PDF-`.

### Viettel

- Dùng `/api/services/einvoiceuaa/api/captcha/get` làm route challenge ưu tiên theo CLA1.
- Nếu GET chỉ trả token mà chưa có ảnh, adapter thử POST trên cùng route trước khi probe route compatibility khác; parser nhận payload lồng nhau, ảnh nền và mảnh ghép slider.
- Token challenge vẫn không ra frontend. Chỉ khi có ảnh CAPTCHA mới tạo challenge UI; token-only tiếp tục bị từ chối để không sinh ô nhập `offsetX` mù.
- Verify và download vẫn bám production capture đã cung cấp: `{token, offsetX}` -> token phiên; download PDF dùng JSON `{supplierTaxCode, reservationCode, recaptcha}`. Điểm này cố ý khác connector mẫu CLA1 dùng GET + headers vì production capture là evidence ưu tiên cao hơn.

### Batch

State machine hiện hữu được giữ: **P1 → P2 → P3**. P2 cache token theo provider và dùng lại cho cả nhóm; P3 xóa token sau từng hóa đơn kể cả khi download lỗi. Task lỗi không làm hỏng các task thành công khác; ZIP có `manifest.json`.

## Revision 4 — chốt route PDF MISA production

Revision 4 giữ nguyên **app version 1.2.1**.

Capture production xác nhận contract MISA:

1. `POST https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID`
   - body: `transactionID=<TransactionID>`
   - response: trường `customData`
2. PDF bản thể hiện:
   - `GET https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>`

Adapter r4 dùng `customData` **trực tiếp** làm `ext` và giữ đúng path cùng tên/casing query parameter đã quan sát (`Type`, `Viewer`, `ext`, `Code`). Ví dụ UAT: `ext=0K7QE2QR`, `Code=VLF4IVJPR_J7`.

`GetRequestTimeEnCode` không còn được gọi khi metadata đã có `customData`; nó chỉ được giữ làm backward-compatibility nếu một deployment cũ không trả `customData`. Response tải chỉ được chấp nhận khi magic bytes bắt đầu `%PDF-`.
