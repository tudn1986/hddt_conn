# HDDT_CONN — Thiết kế bổ sung tính năng xem bản thể hiện hóa đơn Thái Sơn EInvoice

> **Mục tiêu tài liệu:** mô tả thiết kế và kế hoạch triển khai mã nguồn để bổ sung khả năng xem/tải bản thể hiện cho hóa đơn `tvan_thaison`, dựa trên dataset JSON và HAR được cung cấp, đồng thời giữ tuyệt đối các boundary và quy ước hiện hữu của HDDT_CONN `v1.3.0-rc.2`.
>
> **Phạm vi:** thiết kế kỹ thuật, mapping dữ liệu, state machine, adapter, orchestration, UI/API integration, bảo mật, kiểm thử và rollout. Tài liệu không coi dữ liệu một lần trong HAR là cấu hình production và không thay thế bước nghiệm thu với evidence bổ sung.

## 1. Kết luận kiến trúc

Tính năng phải được triển khai dưới dạng **adapter mới, có version**:

- `providerCode`: `tvan_thaison`
- `providerFamily`: `thaison`
- `adapterId`: `thaison-einvoice-v1`
- `adapterVersion`: `1.0.0`
- `displayName`: `Thái Sơn EInvoice`
- `captchaMode`: `per_invoice`
- `priority`: `P3`

Không thêm nhánh nghiệp vụ Thái Sơn vào `InvoicePage`, `TvanPdfService`, presentation routes hoặc API client. Adapter mới phải hội tụ về contract hiện hữu:

```text
InvoiceDocument
  → TvanRegistry.resolve()
  → ThaisonTvanAdapter
  → CAPTCHA/private transaction state
  → original artifact (ZIP hoặc PDF, nếu provider cung cấp)
  → normalized presentation PDF
  → TvanPdfService cache/singleflight/batch
  → /api/presentation/view|download|download-original
  → PDF viewer hiện tại
```

Các điểm giữ nguyên:

1. `TvanAdapter` là boundary nghiệp vụ provider.
2. `TvanPdfService` sở hữu challenge/token/cache/artifact lifecycle.
3. Cookie, CAPTCHA state, lookup result HTML và download UUID chỉ tồn tại ở backend theo session/document.
4. Frontend chỉ dùng presentation facade chung.
5. Viewer chỉ nhận PDF từ local API; không nhúng HTML provider và không gọi trực tiếp portal.
6. Batch dùng cùng adapter/orchestrator, không có implementation riêng.
7. Adapter khác và expected behavior hiện tại không đổi.

## 2. Evidence và mức tin cậy

### 2.1. Đã quan sát trực tiếp

Dataset có 13 hóa đơn `tvan_thaison`. Với hóa đơn khớp HAR:

| Ý nghĩa | Nguồn/path | Giá trị mẫu | Tin cậy |
|---|---|---|---|
| Provider code | `normalized.providerCode` | `tvan_thaison` | Cao |
| Portal tenant | `rawDetail.ttkhac[ttruong="DC TC"].dlieu` | `http://Delmarhan.einvoice.com.vn` | Cao cho mẫu |
| Mã nhận hóa đơn | `rawDetail.ttkhac[ttruong="Mã TC"].dlieu` | `1D2DGQRRCBH` | Cao cho mẫu |
| TVAN/solution tax code | `rawDetail.tvandnkntt` | `0101300842` | Cao |
| Seller tax code | `normalized.seller.taxCode` | `0311996400-001` | Cao |
| Mẫu/ký hiệu/số | normalized invoice identity | `1 / C25TDM / 1139` | Cao |
| GDT portal UUID | `normalized.portalInvoiceId` | UUID GDT | Cao; không dùng làm lookup/download id |

HAR chứng minh trình tự cho một tenant/một hóa đơn:

```text
POST /xem-hoa-don
  MA_NHAN_HOA_DON=<Mã TC>
  CaptchaDeText=<opaque challenge id>
  CaptchaInputText=<user answer>
        ↓ HTTP 200 result HTML
GET /Download/DetailHoaDon
        ↓ HTTP 200 HTML representation
GET /tai-ve-hoa-don/{provider-generated UUID}
        ↓ HTTP 200 application/zip
```

### 2.2. Chưa được chứng minh

- Endpoint và response của bước khởi tạo portal/CAPTCHA.
- Có hay không ASP.NET/session cookie hoặc anti-forgery state.
- Cách `CaptchaDeText` được tạo và TTL của nó.
- ZIP chứa những file gì; có PDF gốc hay không.
- Cấu trúc có đồng nhất giữa các tenant `*.einvoice.com.vn` hay không.
- HTML detail có luôn chứa đủ MST người bán, mẫu số, ký hiệu, số, ngày và tổng tiền hay không.
- Provider có endpoint PDF chính thức hay chỉ HTML/ZIP.

Mọi hạng mục trên là **release gate**, không được lấp bằng suy đoán.

## 3. Mapping dữ liệu provider

### 3.1. Không thay đổi semantics generic một cách rộng

Hiện normalized `lookup` của 13 bản ghi chỉ có provider code/confidence. Không nên thêm alias `DC TC` hoặc `Mã TC` vào một hàm generic dùng cho mọi provider. Semantics thuộc adapter Thái Sơn.

Adapter đọc theo precedence riêng:

```text
Portal URL:
1. document.lookup.lookupBaseUrl nếu provider mapping đã chuẩn hóa và adapter xác nhận
2. named raw/dynamic field "DC TC"
3. named raw/dynamic field "Địa chỉ tra cứu" (chỉ sau khi có fixture xác nhận)
4. thiếu → readiness false / capability reason rõ ràng

Lookup code:
1. document.lookup.lookupCode nếu provider mapping đã chuẩn hóa và adapter xác nhận
2. named raw/dynamic field "Mã TC"
3. named raw/dynamic field "Mã tra cứu" (chỉ sau khi có fixture xác nhận)
4. thiếu → readiness false / capability reason rõ ràng

Provider identity:
1. document.providerCode hoặc lookup.providerCode = tvan_thaison
2. provider solution/transport mapping được xác nhận
3. tvandnkntt = 0101300842 nếu catalog xác nhận đây là identity Thái Sơn
4. domain signature chỉ dùng như evidence phụ, không override identity mâu thuẫn
```

### 3.2. Internal lookup model

```ts
interface ThaisonLookup {
  sellerTaxCode: string;
  portalOrigin: string;
  portalHost: string;
  portalProtocol: 'http:' | 'https:';
  lookupCode: string;
  providerTaxCode?: string;
}
```

Validation đầu vào:

- `sellerTaxCode` bắt buộc.
- `lookupCode` giới hạn chiều dài và character set dựa trên fixture; trước khi có đủ mẫu, cho phép conservative `[A-Za-z0-9_-]{6,128}`.
- Portal phải là URL HTTP/HTTPS, không có username/password, fragment hoặc port lạ nếu chưa có evidence.
- Host phải khớp policy Thái Sơn đã review; không fetch arbitrary host lấy từ invoice.
- Chuẩn hóa hostname lowercase; giữ nguyên scheme quan sát nhưng ưu tiên HTTPS khi tenant hỗ trợ đúng flow.

### 3.3. Normalizer/catalog integration

Nên bổ sung provider-specific normalization có phạm vi hẹp để:

```ts
lookup = {
  providerCode: 'tvan_thaison',
  lookupCode: <Mã TC>,
  lookupCodeType: 'ma_nhan_hoa_don',
  lookupBaseUrl: <DC TC>,
  sourceSection: 'invoice.ttkhac',
  sourceField: 'Mã TC/DC TC',
  confidence: 'high'
}
```

Nếu thay đổi normalizer hiện hữu làm tăng rủi ro hồi quy, adapter vẫn phải đọc raw/dynamic fields để tương thích dataset cũ. Dataset đã lưu không được yêu cầu migration bắt buộc.

## 4. Adapter selection

### 4.1. Registry

Thêm `ThaisonTvanAdapter` vào default registry. Resolver phải deterministic:

1. explicit `document.providers.presentation.adapterCode === 'tvan_thaison'`;
2. explicit `providerCodeOf(document) === 'tvan_thaison'`;
3. solution/transport tax code mapping đã xác nhận;
4. host signature allow-listed chỉ khi không có identity mâu thuẫn.

Không chọn adapter chỉ vì hostname kết thúc bằng `einvoice.com.vn`; domain family có thể chứa tenant hoặc sản phẩm khác.

### 4.2. Manifest

Thêm vào `src/server/presentation/manifest.ts`:

```ts
tvan_thaison: {
  providerFamily: 'thaison',
  adapterId: 'thaison-einvoice-v1',
  adapterVersion: '1.0.0',
}
```

Version phải tham gia `TvanPdfService.adapterRuntimeKey()` nên cache của version mới không tái sử dụng artifact của version cũ.

## 5. State machine

### 5.1. Trạng thái nghiệp vụ

Dùng các stage chung hiện có, không mở rộng public enum nếu chưa cần:

```text
new
  └─ getCaptchaChallenge() → captcha_ready
       └─ verifyCaptcha()/POST lookup → search_verified
            └─ prepareArtifact()/GET detail → representation_ready
                 └─ parse download descriptor → artifact_descriptor_ready
                      └─ GET original → original_ready
                           └─ extract/obtain + validate PDF → pdf_ready
```

Nếu provider chỉ có HTML và chưa có PDF trong ZIP, dừng ở `original_ready` hoặc `representation_ready`; không đánh dấu `pdf_ready` bằng một PDF tự dựng chưa được phê duyệt.

### 5.2. Private state

```ts
interface ThaisonTransactionState {
  version: 1;
  providerCode: 'tvan_thaison';
  documentKey: string;
  fingerprint: string;
  stage:
    | 'captcha_ready'
    | 'search_verified'
    | 'representation_ready'
    | 'artifact_descriptor_ready'
    | 'original_ready'
    | 'pdf_ready';
  lookup: ThaisonLookup;
  cookieHeader?: string;
  captcha?: {
    opaqueId: string;
    issuedAt: number;
  };
  search?: {
    resultUrl: string;
    htmlDigest: string;
    verifiedAt: number;
  };
  representation?: {
    html: string;
    htmlDigest: string;
    fetchedAt: number;
  };
  descriptor?: {
    downloadPath: string;
    downloadId: string;
    resolvedAt: number;
  };
  original?: {
    contentType: 'application/zip' | 'application/pdf';
    fileName: string;
    digest: string;
  };
  expiresAt: number;
}
```

Yêu cầu:

- serialized state nằm trong `TvanPdfService.tokens`, key theo adapter runtime + document fingerprint vì `captchaMode = per_invoice`;
- không trả state/cookie/opaque id/download UUID về frontend;
- không log HTML, cookie, CAPTCHA, lookup code đầy đủ hoặc URL chứa secret;
- TTL conservative 10 phút cho đến khi capture xác định TTL thật;
- logout/session disposal xóa state qua lifecycle hiện hữu;
- mỗi challenge bind với `document.key`, portal host và lookup code digest;
- concurrent call cùng document dùng singleflight artifact cache hiện hữu; challenge không được dùng chéo document.

### 5.3. CAPTCHA flow đề xuất

`getCaptchaChallenge()`:

1. resolve + validate lookup;
2. GET portal landing/lookup page theo evidence bổ sung;
3. merge `Set-Cookie` vào backend cookie jar tối giản;
4. parse opaque `CaptchaDeText` và ảnh CAPTCHA từ DOM/API đã capture;
5. trả `TvanCaptchaChallenge` chỉ gồm ảnh/prompt/id công khai;
6. giữ opaque state + cookie trong `privateState`.

`verifyCaptcha()`:

1. đối chiếu private state với document;
2. POST form URL-encoded tới `/xem-hoa-don`:
   - `MA_NHAN_HOA_DON = lookupCode`
   - `CaptchaDeText = private opaque id`
   - `CaptchaInputText = user answer`
3. gửi `Origin`, `Referer`, browser-like `Accept`, cookie backend;
4. parse response theo DOM structural markers, không regex toàn HTML;
5. phân loại CAPTCHA sai/not found/provider error;
6. xác thực metadata hóa đơn từ result/detail trước khi lưu `search_verified`;
7. mask request trace: chỉ field names, không ghi lookup/captcha values.

## 6. HTTP/session policy

Không dùng `fetchWithTimeout()` trực tiếp nếu flow cần cookie merge và hỗ trợ HTTP tenant tương tự SoftDreams. Tạo helper private trong adapter hoặc shared helper chỉ khi có ít nhất hai adapter cùng semantics.

Policy bắt buộc:

- allow-list hostname theo adapter;
- mỗi redirect hop phải giữ trong host/scheme policy;
- tối đa 5 redirects;
- timeout từ `context.timeoutMs`;
- response byte limit từ `context.maxDownloadBytes`;
- browser-compatible User-Agent thống nhất với project;
- cookie jar chỉ chứa name/value từ `Set-Cookie`, không expose frontend;
- reject cross-host redirect;
- nếu portal ban đầu HTTP, chỉ cho phép HTTP→HTTPS cùng host; không HTTPS→HTTP;
- không nhận arbitrary download absolute URL từ HTML; chỉ nhận relative path/UUID đúng pattern;
- xóa cookie/state khi transaction hết hạn hoặc mismatch.

### 6.1. Host allow-list

Không hard-code duy nhất `delmarhan.einvoice.com.vn`. Đồng thời không cho phép wildcard mù `*.einvoice.com.vn` chỉ từ payload.

Thiết kế khuyến nghị:

```text
allowed =
  exact normalized host from verified `DC TC`
  AND suffix in reviewed Thái Sơn domain families
  AND provider identity matches `tvan_thaison`
  AND no public-suffix confusion / username / alternate port
```

Danh sách suffix/domain family phải được khóa trong adapter manifest sau khi có tenant thứ hai và review security.

## 7. Representation và artifact pipeline

### 7.1. HTML detail

`/Download/DetailHoaDon` trả HTML có script/style/base64 image. Đây là nội dung không tin cậy.

Không được:

- nhúng HTML vào `dangerouslySetInnerHTML`;
- mở HTML trong iframe cùng origin HDDT_CONN;
- chạy JavaScript provider bằng Playwright/eval;
- coi HTML→print local là “PDF gốc NCC” nếu chưa có policy chính thức.

Được phép:

- parse server-side bằng `parse5`;
- loại script/event handlers nếu cần lưu representation evidence;
- dùng HTML để trích metadata và download descriptor;
- giữ HTML private, TTL-bound, không trả frontend.

### 7.2. Download descriptor

Từ HTML lookup result, parse structural links/scripts để lấy đúng relative path:

```text
/tai-ve-hoa-don/{uuid}
```

Rules:

- UUID phải đúng canonical pattern;
- path phải đúng route allow-listed;
- host được ghép từ `portalOrigin`, không lấy host mới từ HTML;
- nếu nhiều UUID/path mâu thuẫn: fail closed `TVAN_THAISON_DOWNLOAD_DESCRIPTOR_AMBIGUOUS`;
- không dùng UUID đã capture hoặc `portalInvoiceId`.

### 7.3. Original artifact

Fetch download route với cookie/referer private state. Chấp nhận tạm thời:

- `application/zip` + ZIP magic;
- `application/pdf` + `%PDF-` nếu tenant trả PDF trực tiếp.

Reject HTML/JSON/error page dù HTTP 200.

Original ZIP/PDF được trả qua `download-original` theo contract hiện hữu.

### 7.4. Normalized PDF decision

Thứ tự bắt buộc:

1. Nếu original là PDF: validate và dùng làm normalized PDF.
2. Nếu ZIP có đúng một PDF hợp lệ: chọn file đó.
3. Nếu ZIP có nhiều PDF: adapter chọn deterministic theo identity/file manifest; nếu không đủ bằng chứng → ambiguous/fail closed.
4. Nếu ZIP không có PDF nhưng có provider-approved PDF endpoint: fetch endpoint đó.
5. Nếu chỉ có HTML/XML: **không tự render PDF trong release đầu**. Ghi capability là original-ready nhưng view PDF chưa sẵn sàng cho đến khi có quyết định sản phẩm và golden fixture.

Nếu sau này chính thức dùng HTML→PDF, cần adapter version mới hoặc minor behavior review, Chromium sandbox, disable network/script, deterministic fonts/page size và nhãn rõ “PDF chuẩn hóa từ bản thể hiện HTML của NCC”.

### 7.5. ZIP safety

Tái sử dụng pattern đang có:

- `yauzl` lazy entries;
- `isSafeZipEntryName()`;
- reject encrypted entry;
- entry count ≤ 100;
- per-entry và total uncompressed size ≤ configured max;
- reject path traversal/absolute path/NUL;
- validate magic chứ không tin extension;
- không extract ra filesystem nếu không cần;
- close stream/ZIP trong `finally`.

## 8. Identity validation

Không cache hoặc trả PDF trước khi chứng minh artifact thuộc hóa đơn được chọn.

### 8.1. Tầng validation

**Generic:**

- size/content type/magic;
- safe filename;
- safe redirect/host;
- ZIP safety.

**Provider-specific:**

- seller tax code;
- template number nếu representation có;
- series;
- invoice number với canonicalization leading zero;
- issue date nếu có;
- buyer tax code/tổng tiền như secondary evidence;
- lookup code hoặc provider UUID chỉ là transaction evidence, không thay invoice identity.

### 8.2. Validation source precedence

1. metadata trong provider response/download manifest;
2. parsed HTML detail;
3. XML/PDF text only if deterministic, safe parser is available;
4. filename only as weak evidence, không đủ một mình.

Nếu một strong identity field mâu thuẫn, throw:

```text
TVAN_THAISON_INVOICE_MISMATCH (422, non-retryable)
```

Không ghi artifact/cache khi mismatch.

## 9. Error taxonomy

Provider-specific codes tối thiểu:

```text
TVAN_THAISON_PORTAL_MISSING
TVAN_THAISON_PORTAL_INVALID
TVAN_THAISON_PORTAL_REJECTED
TVAN_THAISON_LOOKUP_CODE_MISSING
TVAN_THAISON_CAPTCHA_BOOTSTRAP_FAILED
TVAN_THAISON_CAPTCHA_IMAGE_INVALID
TVAN_THAISON_CAPTCHA_INVALID
TVAN_THAISON_CHALLENGE_MISMATCH
TVAN_THAISON_SEARCH_HTTP_ERROR
TVAN_THAISON_LOOKUP_NOT_FOUND
TVAN_THAISON_LOOKUP_RESPONSE_INVALID
TVAN_THAISON_INVOICE_MISMATCH
TVAN_THAISON_DETAIL_HTTP_ERROR
TVAN_THAISON_DETAIL_INVALID
TVAN_THAISON_DOWNLOAD_DESCRIPTOR_MISSING
TVAN_THAISON_DOWNLOAD_DESCRIPTOR_AMBIGUOUS
TVAN_THAISON_DOWNLOAD_HTTP_ERROR
TVAN_THAISON_ARTIFACT_INVALID
TVAN_THAISON_ZIP_UNSAFE
TVAN_THAISON_PDF_NOT_FOUND
```

Retry policy:

- timeout/5xx/transient network: retryable;
- CAPTCHA sai/hết hạn: challenge mới, không retry âm thầm;
- missing input/host rejected/mismatch: non-retryable;
- artifact generation/download failure sau `search_verified`: `preserveContext=true`, `retryStage='prepare_artifact'` nếu private state còn hạn.

## 10. UI/API behavior

### 10.1. API

Không thêm endpoint mới. Adapter chạy qua:

- `POST /api/presentation/status`
- `POST /api/presentation/prepare`
- `POST /api/presentation/challenge`
- `POST /api/presentation/view`
- `POST /api/presentation/download`
- `POST /api/presentation/download-original`

Compatibility `/api/tvan/...` và batch tiếp tục hoạt động qua `TvanPdfService`.

### 10.2. WebUI

Chỉ cần thêm `tvan_thaison` vào khả năng hiển thị hành động PDF theo cách hiện hữu. Luồng chung:

```text
Người dùng bấm Xem bản thể hiện
  → preparePresentation(document)
  → nếu challenge: modal CAPTCHA chung
  → submitPresentationChallenge()
  → viewTvanPdf()/local blob
  → PDF viewer modal hiện tại
```

Không tạo `ThaisonPresentationCard` production nếu generic flow đã đủ. Panel research/debug có thể hiển thị safe stage/evidence đã mask, nhưng không chứa logic request.

UI state:

- chưa hỗ trợ/thiếu portal hoặc mã;
- cần CAPTCHA;
- đang xác thực;
- đang chuẩn bị artifact;
- sẵn sàng xem/tải PDF;
- chỉ sẵn sàng tải original nếu ZIP chưa có PDF;
- retryable/non-retryable message theo code.

## 11. Cache, concurrency và batch

- Cache key hiện tại đã gồm adapter runtime + fingerprint. Cần bổ sung lookup code/base URL vào fingerprint hiện hữu đã có; chúng hiện đã được đưa vào `documentFingerprint()` nếu normalized lookup được map.
- Với dataset cũ chưa normalized lookup, adapter nên yêu cầu fingerprint có provider-specific digest. Nếu core fingerprint chưa thấy raw fields, giải pháp sạch là bổ sung optional adapter cache discriminator; không nhét raw payload vào key toàn cục mà không review.
- `captchaMode='per_invoice'` ngăn token dùng chung giữa hóa đơn.
- Không cho hai hóa đơn dùng chung transaction/download UUID.
- Batch P3 tuần tự tới challenge; sau submit CAPTCHA tiếp tục bằng cơ chế batch hiện hữu.
- Artifact cache TTL không vượt private-state TTL.
- Singleflight chỉ áp dụng khi đã đủ state; không gộp hai challenge creation ngoài ý muốn.

## 12. Logging và dữ liệu nhạy cảm

Được log:

- provider family/code;
- adapter id/version;
- masked host/path;
- stage;
- HTTP status/content type/elapsed time;
- retry/validation outcome;
- digest hoặc last 4 ký tự của lookup code nếu thật sự cần diagnostic.

Không log:

- cookie;
- CAPTCHA answer;
- `CaptchaDeText` value;
- full `Mã TC`;
- download UUID đầy đủ;
- raw HTML/ZIP/XML;
- buyer/seller personal data ngoài metadata cần thiết.

Fixture commit vào repo phải sanitize tenant secrets, CAPTCHA, cookie và UUID; cấu trúc vẫn phải đủ để parser/test hoạt động.

## 13. Backward compatibility

- Không đổi schema dataset bắt buộc; dữ liệu cũ vẫn mở được.
- Không đổi route signature hoặc frontend call contract.
- Không sửa behavior của 8 adapter hiện có.
- `TvanArtifactStage`, `PresentationStatusResult`, `PresentationPrepareResult` giữ nguyên nếu không có requirement mới.
- Adapter selection explicit mapping phải thắng fallback; thêm Thái Sơn không được làm `matches()` của provider khác đổi kết quả.
- Nếu normalizer bổ sung lookup fields, output cũ chỉ được enriched; key/financial fields/relation không đổi.
