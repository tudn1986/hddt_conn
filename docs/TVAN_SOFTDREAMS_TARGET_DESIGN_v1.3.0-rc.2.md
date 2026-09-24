# TVAN SoftDreams / EasyInvoice — Target Design v1.3.0-rc.2

## 1. Phạm vi

Tài liệu này ghi nhận implementation trên nhánh `dev` cho provider chuẩn
`tvan_softdreams`. Đây là phần bổ sung provider-specific; không thay đổi flow
MISA, Viettel hoặc `tvan_invoice`, và không thay đổi generic TVAN viewer.

Mục tiêu là lấy PDF do chính workflow EasyInvoice tạo, không tự dựng PDF thay thế:

```text
InvoiceDocument
  -> validate seller-specific portal
  -> bootstrap ASP.NET session
  -> CAPTCHA
  -> Search/Search
  -> parse InvData + showInv token + render model
  -> build browser-equivalent representation
  -> prepare provider artifact
  -> download original ZIP/PDF
  -> normalize PDF
  -> cache/singleflight
  -> local View / Download PDF / Download original
```

## 2. Provider boundary

Registry vẫn trả `tvan_softdreams`. Adapter match theo provider code compatibility
hoặc MST giải pháp `0105987432`.
Portal chỉ được fetch nếu hostname khớp seller tax code:

```text
<sellerTaxCode>hd.easyinvoice.vn
<sellerTaxCode>hd.easyinvoice.com.vn
```

Mỗi redirect hop tiếp tục bị pin cùng hostname; HTTPS không downgrade HTTP.
Cookie, opaque invoice token, CAPTCHA private state và representation HTML không
được trả frontend.

## 3. Search transaction

`GET /Search/Index` tạo session và final page URL. `GET /Captcha/Show` dùng
cùng cookie jar. User submit CAPTCHA tạo normal form navigation:

```text
POST /Search/Search
Content-Type: application/x-www-form-urlencoded
Origin: <portal-origin>
Referer: <final-search-page>
body: typeSearch=&FKey=<...>&Capcha=<...>
```

Bước Search không gửi `X-Requested-With`.

Parser thuần nằm tại:

```text
src/server/tvan/adapters/softdreams/search-parser.ts
```

Parser dùng parse5 để đọc `#InvData.value`, JSON.parse và lấy chính xác
`InvData.str`. Token chỉ lấy từ call `showInv(data.str, ..., '<token>')`;
không có generic Base64 scan.
Render model chỉ parse known literal fields, không eval JavaScript provider:

- IsAutoRow
- IsRowPerPage
- DiffRowBreaking
- DiffFooterBreaking
- DiffEmptyRowAppended
- IsAppendEmptyRow
- Layout
- toolbarType

Sau Search thành công, transaction được commit ở `search_verified` trước khi
render/prepare. Lỗi converter sau đó không làm mất CAPTCHA/Search context.

## 4. Representation renderer

Renderer nằm tại:

```text
src/server/tvan/adapters/softdreams/representation-renderer.ts
```

Fast path dùng deterministic row pagination khi model cho phép. Exact path được
chọn khi layout phụ thuộc DOM metrics, đặc biệt
`IsAutoRow=true && IsRowPerPage=false`.

Exact path dùng một Chromium process được reuse, context/page riêng theo render,
network bị block, script/provider event handler bị loại, container 808px và
metrics thật từ DOM. Concurrency mặc định là 2, cấu hình bằng
`HDDT_TVAN_RENDER_CONCURRENCY` (1..8).

Runtime Docker cài Chromium và đặt:

```text
HDDT_CHROMIUM_EXECUTABLE=/usr/bin/chromium
```
Nếu exact renderer không có Chromium, hệ thống fail với
`TVAN_SOFTDREAMS_RENDERER_UNAVAILABLE`; không fallback sang approximate PDF.

## 5. Prepare/download state machine

Ephemeral transaction v2 có các stage public tương ứng:

```text
captcha_ready
search_verified
representation_ready
artifact_descriptor_ready
original_ready
pdf_ready
```

Prepare endpoint theo `toolbarType`:

```text
default:
POST /Invoice/DownloadPdfAndFileAttachFromAvailableHtml

DA_LIEU:
POST /Invoice/DownloadFileFromHtml
isImage=false
```

Prepare là AJAX: cùng cookie jar, Search result Referer, Origin và
`X-Requested-With: XMLHttpRequest`.

Provider HTTP 408 trả
`TVAN_SOFTDREAMS_PREPARE_DOWNLOAD_TIMEOUT` với metadata public an toàn:

```json
{
  "retryable": true,
  "retryMode": "manual",
  "retryStage": "prepare_artifact",
  "preserveContext": true,
  "outcomeUnknown": true
}
```
UI có thể gọi prepare lại mà không xin CAPTCHA mới khi transaction còn TTL.

Artifact download dùng cùng provider session. Bytes được sniff:
`%PDF-` => PDF, `PK...` => ZIP, giá trị khác => reject.
ZIP giữ safe extraction hiện tại; original ZIP/PDF được giữ riêng với normalized PDF.

## 6. Cache + singleflight

`TvanPdfService` key state/cache theo provider + SHA-256 document fingerprint.
P3 không dùng provider-only token key.

Service giữ:

```text
artifactCache: fingerprint -> original + PDF + TTL
inflightArtifacts: fingerprint -> Promise
```

View, Download PDF, Download original và batch cùng invoice join cùng một
in-flight operation. Cache hit không gọi lại provider.

## 7. Local API

Existing generic TVAN APIs vẫn được giữ để compatibility.

Các API artifact-centric bổ sung:

```text
POST /api/tvan/pdf/status
POST /api/tvan/pdf/prepare-artifact
POST /api/tvan/pdf/view
POST /api/tvan/pdf/download
POST /api/tvan/artifact/download-original
```
Mọi mutation dùng local session + CSRF hiện có. File response dùng local bytes;
không expose direct `/Invoice/Download?fileGuid=...` URL.

## 8. UI

SoftDream card chỉ render cho `tvan_softdreams`/SoftDream compatibility.
Flow:

```text
Lấy CAPTCHA
 -> Xác thực
 -> search_verified
 -> tự prepare artifact
 -> ready: Xem PDF | Tải PDF | Tải file gốc
```

Nếu prepare lỗi nhưng `preserveContext=true`, UI hiển thị
`Thử tạo file lại` và không ép CAPTCHA mới.

MISA, Viettel và `tvan_invoice` tiếp tục dùng các card/route đã triển khai riêng.
Cột TVAN/filter TVAN trong invoice table được giữ nguyên.

## 9. Regression

Regression hiện có bao phủ:

- parser #InvData và exact showInv token;
- embedded image Base64 không bị nhận nhầm token;
- fail-closed khi showInv contract không tồn tại;
- Search không X-Requested-With, prepare có X-Requested-With;
- common prepare ZIP -> normalized PDF;
- DA_LIEU -> DownloadFileFromHtml + isImage=false;
- provider 408 giữ representation/search context và retry không Search lại;
- deterministic row renderer và exact-renderer selection;
- cache + singleflight giữa prepare/view/original;
- CSRF và safe headers cho local artifact APIs;
- per-invoice P3 state isolation.

Fixture parser hiện là sanitized production-contract fixture được dựng từ contract
trong specification. Repository chưa có file capture gốc `sample1.2.txt`; khi
capture sanitized được cung cấp, fixture này phải được thay/bổ sung bằng capture
thật và giữ cùng assertions.

## 10. Runtime/rollback

DEV chạy từ Git worktree branch `dev`:

```text
/opt/hddt_conn/dev/HDDT-public-production
```

Docker DEV:

```text
container: hddt_conn_dev
port: 8288 -> 3210
connector: live
```

Production 8188 không thuộc phạm vi deployment này.
