# HDDT v1.2.1 — Verification Report

**Ngày:** 2026-09-13  
**Phạm vi:** hotfix TVAN representation PDF trên source v1.2.0.

## 1. Lỗi production được sửa

### Viettel slider CAPTCHA

Triệu chứng v1.2.0: backend có thể nhận response có `token`/`offsetX` nhưng không map được ảnh slider; frontend vì vậy hiển thị ô nhập số `offset X` trong khi người dùng không có ảnh CAPTCHA để giải.

v1.2.1:

- parser đi xuyên payload lồng nhau/JSON-string;
- nhận `originalImageBase64`, `jigsawImageBase64` và các alias ảnh nền/mảnh ghép phổ biến;
- token challenge chỉ nằm trong backend private state;
- nếu chỉ có token mà không có ảnh thì **không** trả challenge mù cho frontend;
- frontend hiển thị ảnh CAPTCHA, mảnh ghép, thanh trượt và dải chỉ vị trí X; người dùng không nhập `offsetX` thủ công;
- verify vẫn gửi đúng body đã capture: `{ token, offsetX }`;
- token sau verify tiếp tục được tái sử dụng cho nhiều PDF P2.

### MISA PDF

Triệu chứng v1.2.0: adapter probe sai route metadata ưu tiên (`GetEinvoiceByTransactionID`) và không gửi đúng form body từ capture đã cung cấp, nên dừng với thông báo chưa biết route PDF.

v1.2.1:

- ưu tiên `POST https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID`;
- form body ưu tiên `transactionID=<TransactionID>`;
- tiếp tục parse mọi URL PDF/download/view nếu response có trả;
- nếu response chỉ chứa XML/data hóa đơn, fallback sang luồng public `GetRequestTimeEnCode` + `downloadhandler.ashx`;
- mọi response chỉ được nhận là PDF khi magic bytes bắt đầu bằng `%PDF-`;
- redirect vẫn bị kiểm tra allow-list từng hop.

## 2. Verification đã chạy

| Gate | Kết quả |
|---|---|
| TypeScript/TSX syntax transpile | PASS — 81 file TS/TSX, 0 lỗi parse cú pháp |
| Script syntax/check | PASS |
| MISA observed endpoint/body + documented PDF fallback (mock runtime) | PASS |
| Viettel visible slider mapping + verify + reusable token (mock runtime) | PASS |
| Viettel token-only challenge không tạo blind offset UI | PASS |
| TVAN redirect allow-list | PASS |

## 3. Những gate chưa thể chạy trong container hiện tại

- `npm/pnpm verify`, Vitest đầy đủ và Vite production build: không có `node_modules`, registry không khả dụng từ môi trường đóng gói.
- Live acceptance Viettel/MISA: container không phân giải DNS ra Internet, vì vậy không thể gọi endpoint production để xác nhận response hiện thời.
- Portable SEA Windows/macOS: cần build/smoke trên đúng OS/architecture.

Các gate trên được ghi là **NOT RUN/BLOCKED**, không coi là PASS.

## 4. UAT cần chạy sau khi cập nhật

1. Viettel: double-click một hóa đơn `tvan_viettel`; modal phải có ảnh CAPTCHA và slider, không còn ô nhập `offset X`.
2. Kéo slider và xác thực; PDF phải mở. Sau đó mở/tải một hóa đơn Viettel khác trong thời gian token còn hạn để xác nhận không hỏi lại CAPTCHA.
3. MISA: double-click hóa đơn có `TransactionID`; PDF phải mở trực tiếp, không hỏi CAPTCHA.
4. Bulk chọn hỗn hợp MISA + Viettel: MISA chạy P1 trước; Viettel chỉ hỏi CAPTCHA một lần cho nhóm P2.
5. Nếu Viettel vẫn không lấy được ảnh, lưu raw response của **endpoint cấp CAPTCHA** vào TVAN Backport. Nếu MISA vẫn không tải được PDF, lưu raw request/response của **request tải PDF thực tế**, không chỉ request lấy XML dữ liệu hóa đơn.

## 5. Kết luận

v1.2.1 sửa đúng hai regression thể hiện trong UAT v1.2.0 và vượt qua các runtime gate độc lập có thể thực thi trong môi trường đóng gói. Release vẫn cần live TVAN acceptance trước khi gắn nhãn production-certified.

## Revision 2 — server TypeScript compile blocker

UAT chạy `tsc -p tsconfig.server.json` phát hiện:

- `misa.ts`: `visited` là `Set<string>` nhưng `assertAllowedUrl()` trả `URL`.

Đã sửa bằng cách tạo `const targetKey = target.href` và sử dụng `targetKey` cho `visited.has/add`. Đây là lỗi compile-time, không thay đổi request/response contract TVAN.

Version audit của revision này xác nhận các điểm runtime/release chính đều là `1.2.1`: `VERSION`, `package.json`, `/api/app/status`, Login/Settings UI, tray health check, smoke test và packaging scripts.

Môi trường đóng gói hiện không có `node_modules`, vì vậy không thể chạy full project `tsc` với dependency typings tại đây. Kiểm tra syntax toàn bộ TS/TSX và kiểm tra type tối thiểu cho pattern `URL -> href -> Set<string>` được chạy độc lập; full `tsc -p tsconfig.server.json` cần chạy ở môi trường dependency-enabled (như UAT đã dùng để phát hiện lỗi ban đầu).

## Revision 3 — CLA1 review + MISA/Viettel route refinement

### Thay đổi được kiểm tra

- MISA production `customData` 8 ký tự được dùng như ứng viên `ext`; nếu ứng viên không tải được PDF thì **vẫn** fallback sang `GetRequestTimeEnCode` (không khóa fallback chuẩn).
- Parser `GetRequestTimeEnCode` lấy `SubString(55,8)` từ **raw response trước khi JSON decode**, tương ứng browser sample của MISA.
- Viettel ưu tiên route challenge `/captcha/get` theo CLA1; khi GET chỉ có token, thử POST bounded shapes trên cùng route trước các compatibility route.
- Viettel không bao giờ trả challenge “offset mù” nếu chưa có ảnh.
- Verify/PDF contract tiếp tục theo capture production: `{token, offsetX}` và JSON `{supplierTaxCode, reservationCode, recaptcha}`.
- Batch P1 → P2 → P3 được chạy bằng runtime harness; P2 hỏi CAPTCHA đúng một lần và dùng lại token, P3 hỏi lại từng invoice.

### Gate đã chạy ở r3

| Gate | Kết quả |
|---|---|
| TS/TSX parser | PASS — 81 file, 0 parse error |
| `.mjs` `node --check` | PASS — 7 file |
| MISA `customData` → downloadhandler ext | PASS (runtime mock) |
| MISA stale/invalid customData → `GetRequestTimeEnCode` raw-offset fallback | PASS (runtime mock) |
| Viettel `/captcha/get` GET token-only → POST image → verify → reusable token → PDF | PASS (runtime mock) |
| Viettel token-only không sinh blind-offset challenge | PASS (runtime mock) |
| Redirect allow-list | PASS (runtime mock) |
| Batch P1 → P2 reusable-once → P3 per-invoice | PASS (runtime mock) |

### Full `tsc -p tsconfig.server.json`

Đã chạy thử trong container và **BLOCKED bởi dependency typings không có trong source environment** (`@types/node`, `fastify`, `exceljs`, `yazl`, `zod`, ... do không có `node_modules`). Trong output hiện tại không còn lỗi r2 `Set<string>.has(URL)`/`Set<string>.add(URL)` tại `misa.ts`; các lỗi adapter còn thấy trong full tsc của container là do thiếu `Buffer`/Node typings. Vì dependency tree không hiện diện, gate này vẫn ghi **BLOCKED**, không ghi PASS.

### Live provider acceptance

Container không phân giải DNS production nên không thể xác nhận live MISA/Viettel. Với Viettel, endpoint challenge thực tế vẫn cần capture request/response nếu `/captcha/get` GET/POST không trả ảnh. Với MISA, r3 đã tận dụng thêm `customData` từ capture nhưng vẫn giữ đường fallback chính thức; nếu live vẫn lỗi thì cần capture request tải PDF thật để xác nhận cookie/header hoặc route mới.


## Revision 4 — MISA production route confirmation

Browser capture xác nhận `customData` từ `GetInvoiceDataByTransactionID` chính là `ext`. Adapter ưu tiên chính xác `GET /tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>`. Executable adapter harness PASS với `customData=0K7QE2QR`, `TransactionID=VLF4IVJPR_J7`; không gọi `GetRequestTimeEnCode` khi `customData` hiện diện. App version giữ nguyên 1.2.1.
