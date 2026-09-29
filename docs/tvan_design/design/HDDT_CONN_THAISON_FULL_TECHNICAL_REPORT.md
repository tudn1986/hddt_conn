# BÁO CÁO KỸ THUẬT HOÀN CHỈNH
## Luồng xử lý hóa đơn điện tử Thái Sơn trên HDDT_CONN

> **Phạm vi báo cáo**
>
> Báo cáo này mô tả đầy đủ đặc điểm nhận diện, phân loại phiên bản/protocol từ dataset, luồng xử lý xem/tải PDF bản thể hiện hóa đơn điện tử của nhà cung cấp Thái Sơn, thiết kế tích hợp trên HDDT_CONN, phạm vi mã nguồn, đánh giá tác động toàn ứng dụng, kiểm kê before/after và kết quả kiểm thử regression.
>
> Cơ sở đối chiếu gồm:
>
> - tài liệu thiết kế Thái Sơn;
> - dataset 13 hóa đơn;
> - HAR thực tế;
> - source hiện tại;
> - runtime DEV trên cổng `8288`;
> - kết quả kiểm thử toàn bộ ứng dụng và kiểm thử lặp nhiều vòng các NCC HDDT.

---

# 1. Kết luận tổng thể

Thái Sơn **không phải một protocol duy nhất chỉ vì cùng `msttcgp = 0101300842`**.

Trong triển khai hiện tại:

```text
msttcgp = 0101300842
        ↓
nhận diện provider family = Thái Sơn
        ↓
đọc Mã TC / DC TC từ dataset
        ↓
phân loại portal protocol profile
        ↓
shared_v1 hoặc tenant_v1
```

Kiến trúc vẫn giữ nguyên nguyên tắc:

```text
InvoiceDocument
    ↓
TvanRegistry.resolve()
    ↓
ThaisonTvanAdapter
    ↓
provider-specific private state
    ↓
artifact / PDF
    ↓
TvanPdfService
    ↓
Presentation API
    ↓
WebUI generic presentation flow
```

Các boundary quan trọng:

- `TvanAdapter` là provider boundary;
- `TvanPdfService` quản lý challenge/token/cache/artifact lifecycle;
- frontend không gọi trực tiếp portal Thái Sơn;
- cookie, CAPTCHA state, `CaptchaDeText`, provider UUID và BrowserContext không đi xuống frontend;
- viewer chỉ nhận PDF từ local API;
- batch dùng cùng orchestration hiện hữu;
- không đưa logic Thái Sơn vào financial engine, dataset engine hay GDT connector.

---

# 2. Nhận biết Thái Sơn và nhận biết “phiên bản” từ dataset

## 2.1. Nhận diện provider

Provider được nhận diện trước tiên bằng:

```text
msttcgp / providers.solution.taxCode
        =
0101300842
        ↓
providerCode = tvan_thaison
providerFamily = thaison
adapterId = thaison-einvoice-v1
adapterVersion = 1.0.0
```

Cần phân biệt hai khái niệm:

```text
Adapter version:
    thaison-einvoice-v1 @ 1.0.0

Portal protocol profile bên trong adapter:
    shared_v1
    tenant_v1
```

Tức là:

> **13 hóa đơn cùng adapter version nhưng không nhất thiết chạy cùng một protocol.**

---

## 2.2. Dataset hiện có

Dataset hiện có:

```text
recordCount = 13
detailCount = 13
direction   = purchase
source      = standard
```

Toàn bộ 13 hóa đơn đều thuộc provider family Thái Sơn theo `msttcgp = 0101300842`.

Dataset cũ chưa normalize đầy đủ:

```text
lookup.lookupBaseUrl
lookup.lookupCode
```

Mà `Mã TC` và `DC TC` vẫn chủ yếu nằm trong:

```text
rawDetail.ttkhac[]
```

với cấu trúc:

```json
{
  "ttruong": "DC TC",
  "dlieu": "https://einvoice.vn/tra-cuu"
}
```

và:

```json
{
  "ttruong": "Mã TC",
  "dlieu": "683DG3XS7EN"
}
```

Do đó semantics này phải do adapter Thái Sơn xử lý, không biến `Mã TC`/`DC TC` thành generic aliases áp dụng cho mọi NCC HDDT.

---

# 3. Phân loại 13 hóa đơn Thái Sơn hiện tại

| # | Hóa đơn | Ngày HĐ VN | Người bán | Mã TC | DC TC trong dataset | Profile chạy hiện tại |
|---:|---|---|---|---|---|---|
| 1 | `C25TVC-365` | 30/05/2025 | Vinacal | `683DE41E95I` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 2 | `C25TVC-436` | 26/06/2025 | Vinacal | `683DFZ6Q3CB` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 3 | `C25NBT-60` | 31/07/2025 | QKT Bắc Thái | `4E9DG5PCGOJ` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 4 | `C25TVC-539` | 29/07/2025 | Vinacal | `683DG3XS7EN` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 5 | `C25TDM-1139` | 17/07/2025 | Delmar | `1D2DGQRRCBH` | `Delmarhan.einvoice.com.vn` | `tenant_v1` |
| 6 | `C25NBT-71` | 29/08/2025 | QKT Bắc Thái | `4E9DH3B5XFM` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 7 | `C25THS-181` | 26/08/2025 | HSE | `899DHZ6L97Z` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 8 | `C25TSD-50925` | 30/09/2025 | Thái Sơn | `XVUQQCU61` | không có | `shared_v1` canonical fallback |
| 9 | `C25NBT-82` | 30/09/2025 | QKT Bắc Thái | `4E9DI476XIZ` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 10 | `C25THD-23` | 17/09/2025 | Vina Hồng Dương | `715DIQMKTL3` | `vinahongduong.einvoice.com.vn` | `shared_v1` canonical fallback |
| 11 | `C25NBT-96` | 31/10/2025 | QKT Bắc Thái | `4E9DJ5EWLIA` | `einvoice.vn/tra-cuu` | `shared_v1` |
| 12 | `C25TSD-53011` | 10/10/2025 | Thái Sơn | `1MHEYN152` | không có | `shared_v1` canonical fallback |
| 13 | `C25NBT-108` | 28/11/2025 | QKT Bắc Thái | `4E9DK2GY64Z` | `einvoice.vn/tra-cuu` | `shared_v1` |

---

# 4. Rule phân loại profile

Rule hiện tại:

```text
msttcgp != 0101300842
    → không phải Thái Sơn

msttcgp == 0101300842
    ↓
có Mã TC?
    không
        → unsupported / fail closed

    có
        ↓
DC TC = verified Delmar tenant
        → tenant_v1

DC TC = einvoice.vn/tra-cuu
        → shared_v1

DC TC thiếu
        → shared_v1 qua canonical fallback
          https://einvoice.vn/tra-cuu

DC TC = tenant *.einvoice.com.vn chưa có tenant protocol riêng
        → hiện fallback shared_v1 theo rule vận hành hiện tại

host ngoài domain family cho phép
        → reject / fail closed
```

Một điểm cần lưu ý:

> Source hiện tại đã tiến xa hơn tài liệu thiết kế ban đầu.

Thiết kế gốc từng yêu cầu:

```text
missing DC TC
    → readiness false
```

Sau khi có evidence vận hành rằng các hóa đơn còn lại vẫn tra cứu được bằng `Mã TC` trên portal chung, source đã bổ sung canonical fallback.

Do đó tài liệu thiết kế cũ nên được cập nhật thành revision mới để phản ánh đúng runtime hiện tại.

---

# 5. Luồng `shared_v1` — `einvoice.vn/tra-cuu`

Đây là flow áp dụng cho đa số dataset.

## 5.1. Vì sao phải dùng browser session

Portal không thể coi CAPTCHA đơn thuần là:

```text
GET CAPTCHA image
        ↓
POST code
```

CAPTCHA gắn với:

```text
browser session
cookie jar
page state
CaptchaDeText
document
lookup code
```

Luồng thực tế:

```text
Shared Chromium process
        ↓
BrowserContext riêng cho hóa đơn A
        ↓
Page riêng trong context A
        ↓
GET https://einvoice.vn/tra-cuu
        ↓
portal sinh cookie + CaptchaDeText + CAPTCHA image
        ↓
backend lấy CAPTCHA image
        ↓
frontend chỉ nhận public challenge
        ↓
người dùng nhập CAPTCHA
        ↓
backend dùng lại CHÍNH Page/BrowserContext đó
```

Frontend chỉ nhận:

```text
challenge id
imageBase64
imageMimeType
expiresAt
```

Frontend không nhận:

```text
cookie
CaptchaDeText
BrowserContext
Page
full provider session state
```

---

# 6. Shared CAPTCHA bootstrap

Browser manager:

```text
1 Chromium process dùng chung
+
N BrowserContext riêng
```

Mỗi BrowserContext bind với:

```text
document.key
lookup code
challenge id
expiresAt
```

Default context limit:

```text
HDDT_THAISON_MAX_CONTEXTS || 2
```

Clamp:

```text
1 .. 6
```

Challenge TTL khoảng:

```text
5 phút
```

---

# 7. Shared CAPTCHA submit

HAR thực tế xác nhận form submit có:

```text
MaNhanHoaDon
CaptchaDeText
CaptchaInputText
```

Ví dụ:

```text
MaNhanHoaDon = 4E9DI476XIZ
CaptchaDeText = <opaque provider token>
CaptchaInputText = <user input>
```

Adapter không thực hiện một HTTP request hoàn toàn độc lập.

Thay vào đó dùng **real form navigation** trên chính page:

```text
HTMLFormElement.prototype.submit.call(form)
        +
page.waitForNavigation({
  waitUntil: 'domcontentloaded'
})
```

Lý do:

- giữ đúng cookie jar;
- giữ browser session;
- giữ provider state;
- không làm mất CAPTCHA binding;
- phản ánh đúng hành vi portal.

---

# 8. Phát hiện PDF sau CAPTCHA

Đây là điểm quan trọng được sửa qua các hotfix cuối.

Portal không nhất thiết trả PDF bằng:

```html
<a href="/pdf/...">
```

HAR thực tế C25NBT-82 cho thấy browser gọi:

```text
GET
https://einvoice.vn/tra-cuu/xem-hoa-don?code=4E9DI476XIZ
```

Response có:

```text
Content-Disposition:
inline; filename=6_C25NBT_82.pdf

Content-Type:
application/pdf
```

Tuy nhiên URL có thể nằm trong JavaScript hoặc iframe assignment.

Do đó parser phải tìm cả:

```text
href="..."
'/tra-cuu/xem-hoa-don?...'
"/tra-cuu/xem-hoa-don?..."
'/tra-cuu/tai-hoa-don-dien-tu?...'
```

Sau đó enforce:

```text
same origin
exact allowed path
lookup code match
```

---

# 9. Candidate priority của shared flow

Thứ tự:

```text
1. /tra-cuu/xem-hoa-don?code=<Mã TC>

2. /tra-cuu/tai-hoa-don-dien-tu?format=pdf
```

Primary candidate:

```text
/xem-hoa-don?code=...
```

là viewer route đã có evidence thực tế trả PDF.

Fallback:

```text
/tai-hoa-don-dien-tu?format=pdf
```

không được mặc định coi chắc chắn là PDF.

---

# 10. Vì sao không dùng `Response.body()` thông thường

Chromium có PDF viewer nội bộ.

Một HTTP response có thể là:

```text
Content-Type: application/pdf
```

nhưng body mà Chromium expose qua một số API lại biến thành:

```html
<html>
  <body>
    <embed type="application/pdf" ...>
  </body>
</html>
```

Vì vậy adapter dùng CDP Response-stage interception:

```text
Fetch.enable
  requestStage = Response
        ↓
Fetch.requestPaused
        ↓
Fetch.takeResponseBodyAsStream
        ↓
IO.read chunks
        ↓
raw provider bytes
        ↓
magic validation
```

Nhờ đó lấy bytes trước khi Chromium PDF viewer transform.

---

# 11. Raw PDF streaming và byte guard

Adapter enforce hai tầng giới hạn:

```text
declared Content-Length
        +
actual streamed bytes
```

Pseudo-flow:

```text
response paused
    ↓
check Content-Length
    ↓
takeResponseBodyAsStream
    ↓
read 64 KiB chunks
    ↓
sum actual bytes
    ↓
if > max → abort
    ↓
validate %PDF-
```

Redirect cũng được kiểm tra:

```text
same origin only
```

Off-origin redirect:

```text
reject
```

---

# 12. Lỗi ZIP từng xuất hiện trên DEV

HAR DEV từng ghi:

```text
/tra-cuu/tai-hoa-don-dien-tu
status = 200
type   = text/html
head   = 504b030414...
```

Hex:

```text
50 4b 03 04
```

là ZIP local-file-header magic.

Nguyên nhân:

```text
parser cũ bỏ sót JS/iframe viewer URL
        ↓
không chọn /xem-hoa-don?code=...
        ↓
rơi xuống /tai-hoa-don-dien-tu
        ↓
provider trả ZIP
        ↓
ensurePdf() reject
```

Sau hotfix:

```text
HTML/JS
   ↓
extract viewer URL
   ↓
/xem-hoa-don?code=...
   ↓
raw provider PDF
```

---

# 13. Luồng `tenant_v1` — Delmar

Delmar dùng profile riêng.

Dataset:

```text
DC TC:
http://Delmarhan.einvoice.com.vn

Mã TC:
1D2DGQRRCBH
```

Flow:

```text
GET tenant landing
      ↓
parse CAPTCHA bootstrap
      ↓
CAPTCHA image
      ↓
user input
      ↓
POST /xem-hoa-don
      ↓
search_verified
      ↓
GET /Download/DetailHoaDon
      ↓
server-side parse HTML
      ↓
validate invoice identity
      ↓
parse download UUID/path
      ↓
GET /tai-ve-hoa-don/{uuid}
      ↓
original artifact
      ↓
PDF / ZIP detection
```

Form:

```text
MA_NHAN_HOA_DON = lookupCode
CaptchaDeText    = private provider value
CaptchaInputText = user answer
```

---

# 14. Tenant HTML detail

`/Download/DetailHoaDon` trả HTML có thể chứa:

```text
script
style
base64 images
provider markup
download descriptor
```

HTML này được coi là **untrusted provider content**.

Không được:

```text
render trực tiếp bằng dangerouslySetInnerHTML
iframe vào HDDT_CONN origin
thực thi provider JavaScript
coi HTML local-print là provider PDF
```

Được phép:

```text
server-side parse
extract invoice metadata
extract provider UUID
extract download descriptor
use as private evidence
```

---

# 15. Download descriptor tenant

Từ HTML detail, adapter tìm route dạng:

```text
/tai-ve-hoa-don/{uuid}
```

Rules:

```text
UUID canonical
allowed path
same portal origin
không lấy arbitrary host từ HTML
không dùng portalInvoiceId GDT thay UUID provider
multiple conflicting UUID → fail closed
```

---

# 16. Original artifact

Original artifact có thể là:

```text
application/pdf
```

hoặc:

```text
application/zip
```

Nhưng adapter không tin MIME đơn thuần.

Magic detection:

```text
%PDF-
    → PDF

PK\x03\x04
    → ZIP

HTML / JSON / unknown
    → reject
```

---

# 17. Normalized PDF decision tree

```text
Original artifact
    ↓
PDF?
    ├── yes
    │     ↓
    │   validate
    │     ↓
    │   pdf_ready
    │
    └── no
          ↓
        ZIP?
          ↓
        inspect entries
          ├── exactly one valid PDF
          │       ↓
          │     pdf_ready
          │
          ├── multiple PDFs
          │       ↓
          │     deterministic identity matching
          │       ↓
          │     ambiguous → fail closed
          │
          └── no PDF
                  ↓
              original_ready
```

Nếu chỉ có XML/HTML:

```text
không tự render thành provider PDF
```

Nếu sau này có local-render feature thì phải:

```text
gắn label khác
version review
sandbox browser
disable network/script
deterministic fonts/page size
```

và không gọi đó là:

```text
PDF gốc NCC
```

---

# 18. ZIP safety

ZIP xử lý bằng safe streaming parser.

Các rule:

```text
lazy entries
entry count <= 100
reject encrypted entry
reject path traversal
reject absolute path
reject NUL
per-entry uncompressed limit
total uncompressed limit
magic validation
no full filesystem extraction
finally close stream/ZIP
```

---

# 19. Invoice identity validation

Không cache hoặc trả artifact trước khi chứng minh artifact thuộc invoice đang chọn.

Validation layers:

```text
generic validation
+
provider-specific identity validation
```

Generic:

```text
size
content type
magic
safe filename
safe redirect
safe host
ZIP safety
```

Provider-specific:

```text
seller tax code
template number
series
invoice number
issue date
buyer tax code
grand total
```

Strong identity conflict:

```text
TVAN_THAISON_INVOICE_MISMATCH
```

Không cache artifact khi mismatch.

---

# 20. State machine

Generic design:

```text
new
 ↓
captcha_ready
 ↓
search_verified
 ↓
representation_ready
 ↓
artifact_descriptor_ready
 ↓
original_ready
 ↓
pdf_ready
```

`tenant_v1` có thể đi đầy đủ state trên.

`shared_v1` thực tế rút gọn:

```text
new
 ↓
captcha_ready
 ↓
CAPTCHA verify + portal search
 ↓
capture provider PDF
 ↓
pdf_ready
```

---

# 21. Tích hợp vào HDDT_CONN

Full path:

```text
InvoiceDocument
       ↓
TvanRegistry.resolve()
       ↓
msttcgp = 0101300842
       ↓
ThaisonTvanAdapter
       ↓
resolveThaisonLookup()
       ↓
shared_v1 / tenant_v1
       ↓
challenge/private state
       ↓
artifact/PDF
       ↓
TvanPdfService
       ↓
cache + singleflight + token lifecycle
       ↓
presentation API
       ↓
WebUI
       ↓
local PDF viewer / download
```

---

# 22. API

Không tạo endpoint riêng cho Thái Sơn.

Sử dụng API facade chung:

```text
POST /api/presentation/status
POST /api/presentation/prepare
POST /api/presentation/challenge
POST /api/presentation/view
POST /api/presentation/download
POST /api/presentation/download-original
```

Compatibility `/api/tvan/...` và batch vẫn chạy qua `TvanPdfService`.

---

# 23. WebUI

Flow:

```text
User bấm Xem bản thể hiện
        ↓
preparePresentation(document)
        ↓
CAPTCHA?
        ├── no
        │    ↓
        │  artifact ready
        │
        └── yes
             ↓
           modal CAPTCHA
             ↓
           submit challenge
             ↓
           refresh status
             ↓
           view local PDF
```

Không tạo production request logic riêng trong một `ThaisonPresentationCard`.

Frontend chỉ cần:

```text
provider registration
labels
capability
generic CAPTCHA UI
generic view/download flow
```

---

# 24. Phạm vi mã nguồn mới

Các module mới hoàn toàn:

| File | Trách nhiệm |
|---|---|
| `src/server/tvan/adapters/thaison.ts` | adapter orchestration, profile dispatch, state/token/artifact |
| `src/server/tvan/adapters/thaison-browser.ts` | shared portal BrowserContext/CAPTCHA/PDF capture |
| `src/server/tvan/adapters/thaison/lookup.ts` | nhận diện provider/profile, `Mã TC`, `DC TC` |
| `src/server/tvan/adapters/thaison/http.ts` | tenant HTTP/cookie/same-origin safety |
| `src/server/tvan/adapters/thaison/parser.ts` | structural HTML/CAPTCHA/download descriptor parser |
| `src/server/tvan/adapters/thaison/artifact.ts` | ZIP/PDF detection, ZIP safety, PDF normalization |

Current SHA-256:

```text
src/server/tvan/adapters/thaison.ts
e05bfd1c4c738b0f98718d3c1761caf43bf44188af792609a072e84b09a889f7

src/server/tvan/adapters/thaison-browser.ts
831a3261374b7198b00a85f0f8af353b0454e820100aeac40a7ab77f47059f69

src/server/tvan/adapters/thaison/lookup.ts
dfacd12b5ab6e6f759f34138cb637148acdf57a87d28240842bd47ac91f01586

src/server/tvan/adapters/thaison/http.ts
df98ec9286ea7e756a34a45a7becb0e992d9c5ab0dfbad9ce2f885e4c9977a2e

src/server/tvan/adapters/thaison/parser.ts
089b6f47c8e958ca6c9c77edef4d7e13395a0dc035c6a239ddb01c668e84a9b3

src/server/tvan/adapters/thaison/artifact.ts
5048a9e946bf525b614af8d502df493a2cfa7bd291797c2900b1b8cb04f078cf
```

---

# 25. Shared production files thay đổi

| File | Semantic delta | Mục đích |
|---|---:|---|
| `src/server/presentation/manifest.ts` | `+1` | đăng ký manifest Thái Sơn |
| `src/server/tvan/registry.ts` | `+2 / -1` | import/register adapter |
| `src/server/tvan/types.ts` | `+11 / -5` | original-only artifact + generic hooks |
| `src/server/tvan/pdf.service.ts` | `+47 / -19` | original-ready/PDF-ready, discriminator, challenge lifecycle |
| `src/shared/provider-resolution.ts` | `+5` | map MSTTCGP → `tvan_thaison` |
| `src/shared/provider-research.ts` | `+1 / -1` | metadata research |
| `src/shared/tvan-catalog/index.ts` | `+1` | catalog entry |
| `src/web/components/InvoiceProviderResearchPanel.tsx` | `+10 / -4` | labels/field visibility/CAPTCHA |
| `src/web/pages/InvoicePage.tsx` | `+2` | provider visibility |

Lưu ý:

> Không được quy toàn bộ diff của `pdf.service.ts` cho riêng Thái Sơn.

Một phần diff là genericization dùng chung với FAST.

---

# 26. Không thay đổi generic lookup semantics

`src/shared/lookup/index.ts` không có semantic delta so baseline Thái Sơn.

Điều này có nghĩa:

```text
Mã TC
DC TC
```

không bị đưa thành generic global aliases.

Đây là chủ đích kiến trúc đúng.

---

# 27. Core change: optional PDF artifact

Trước đây contract ngầm định:

```text
artifact
  ├── original
  └── pdf mandatory
```

Thái Sơn cho thấy có trường hợp:

```text
original ZIP ready
PDF chưa sẵn sàng
```

Do đó model được mở rộng:

```text
TvanPreparedArtifact<false>
```

Semantic:

```text
original mandatory
pdf optional
```

`TvanPdfService` phân biệt:

```text
original_ready
pdf_ready
```

Nếu user gọi view/download PDF khi chỉ có original:

```text
TVAN_PDF_NOT_READY
```

---

# 28. Core change: `cacheDiscriminator`

Một document có thể có raw provider metadata khác nhau nhưng normalized fingerprint chưa phản ánh.

Do đó thêm:

```ts
cacheDiscriminator?(document)
```

Cache key:

```text
adapter runtime key
+
document fingerprint
+
provider-specific discriminator
```

Thái Sơn discriminator phải bao phủ:

```text
portal identity
lookup code
document identity
```

Nhờ đó không reuse artifact sai lookup/session.

---

# 29. Core change: `challengeSingleUse`

Trước đây logic từng đặc biệt hóa FAST:

```text
if providerCode === tvan_fast
```

Hiện generic:

```text
adapter.challengeSingleUse === true
```

FAST và Thái Sơn shared browser đều có thể khai báo.

Semantics:

```text
challenge submit
    ↓
success OR failure
    ↓
challenge consumed
```

Không reuse ảnh CAPTCHA cũ.

---

# 30. Browser concurrency và lifecycle

Shared manager:

```text
one shared Chromium process
many isolated BrowserContexts
```

Context quota:

```text
default = 2
min     = 1
max     = 6
```

Một lỗi cũ từng gây:

```text
TVAN_THAISON_BROWSER_BUSY
```

do logical quota có thể không được release sớm khi `context.close()` treo.

Lifecycle được harden theo hướng:

```text
cleanup session maps
        ↓
clear TTL timer
        ↓
release quota idempotently
        ↓
close context bounded / independently
```

Đồng thời có close listener idempotent để tránh double-decrement.

---

# 31. Security properties

Private backend state không trả frontend:

```text
cookie
CaptchaDeText
full lookup code in logs
raw HTML
download UUID
provider BrowserContext
provider Page
```

Challenge bind theo:

```text
provider
document.key
lookup identity
portal origin
```

Network restrictions:

```text
HTTPS
same-origin redirect
allowed paths
blocked unrelated external resources
response byte limits
```

---

# 32. Logging policy

Được log:

```text
provider code
adapter version
masked host/path
stage
HTTP status
content type
elapsed time
safe error code
byte count
magic head hex
```

Không log:

```text
cookie
CAPTCHA answer
CaptchaDeText
full Mã TC
download UUID đầy đủ
raw HTML
raw XML
raw ZIP
personal data không cần thiết
```

---

# 33. Error taxonomy chính

Các lỗi provider-specific:

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
TVAN_THAISON_PDF_INVALID
```

Generic:

```text
TVAN_RESPONSE_TOO_LARGE
TVAN_PDF_NOT_READY
```

---

# 34. Retry policy

```text
network timeout / transient 5xx
    → retryable

wrong CAPTCHA / expired CAPTCHA
    → challenge mới
    → không retry âm thầm

missing input
    → non-retryable

rejected host
    → non-retryable

invoice mismatch
    → non-retryable

artifact fetch failure sau search_verified
    → có thể preserve provider context
      nếu private state còn hạn
```

---

# 35. Đánh giá tác động toàn ứng dụng

| Khu vực | Tác động |
|---|---|
| GDT query/download | không đổi nghiệp vụ |
| financial normalization | không đổi |
| invoice key/relation | không đổi |
| dataset schema bắt buộc | không đổi |
| presentation public routes | không đổi signature |
| API client | không thêm Thái Sơn-specific API |
| generic PDF viewer | không đổi |
| batch engine | dùng lại orchestration hiện có |
| provider adapters khác | không đổi protocol |
| registry/provider resolution | thêm mapping/registration |
| TVAN core | thêm generic hooks |
| browser runtime | thêm Chromium workload cho shared Thái Sơn |
| WebUI | capability/labels/generic CAPTCHA flow |

Mức tác động:

```text
UI/routes/data:
    thấp

TVAN core:
    trung bình

Thái Sơn adapter:
    cao nhưng cô lập
```

---

# 36. Các test mới cho Thái Sơn

Các file:

```text
tests/unit/thaison.test.ts
tests/unit/thaison-parser.test.ts
tests/unit/thaison-artifact.test.ts
tests/integration/thaison-flow.test.ts
```

Coverage:

```text
provider resolution
portal profile classification
missing DC fallback
tenant resolution
CAPTCHA bootstrap
CAPTCHA private/public separation
challenge/document binding
single-use lifecycle
JS viewer URL extraction
iframe URL extraction
candidate priority
raw PDF capture
browser context cleanup
quota management
descriptor ambiguity
invoice identity
original PDF
ZIP artifact
XML-only ZIP
multi-PDF ambiguity
ZIP size limits
original_ready
pdf_ready
cache discriminator
API integration
session isolation
```

---

# 37. Toàn bộ NCC HDDT đang có trong registry

Registry hiện có 10 adapters:

| Provider | Adapter |
|---|---|
| MISA | `tvan_misa` |
| M-Invoice | `tvan_invoice` |
| SoftDreams | `tvan_softdreams` |
| Viettel | `tvan_viettel` |
| Ehoadondientu | `ehoadondientu` |
| VNPT | `tvan_vnpt` |
| ACMAN | `tvan_acman` |
| PVOIL | `tvan_pvoil` |
| FAST | `tvan_fast` |
| Thái Sơn | `tvan_thaison` |

---

# 38. Kiểm thử toàn bộ ứng dụng

Command:

```bash
pnpm run verify
```

Kết quả:

```text
TypeScript / lint
PASS

Vitest
41 test files
252 tests
PASS

server build
PASS

web build
PASS

smoke
PASS
```

Smoke output:

```json
{
  "ok": true,
  "version": "1.3.0-rc.2",
  "invoices": 2,
  "streamedDownloads": 1,
  "serverBusinessFiles": 0
}
```

Audit log:

```text
/opt/hddt_conn/dev/scope-backups/
thaison-final-audit-20260929-024600/
full-verify.log
```

---

# 39. Provider regression chạy lặp nhiều lần

Bộ provider-regression gồm:

```text
20 test files
130 tests
```

Nội dung:

```text
MISA
M-Invoice
SoftDreams
Viettel
VNPT
ehoadondientu
ACMAN
PVOIL
FAST
Thái Sơn
TVAN service
artifact cache
session isolation
presentation artifact API
lookup/provider mapping
```

Chạy 5 vòng:

```text
Round 1
20/20 files
130/130 PASS

Round 2
20/20 files
130/130 PASS

Round 3
20/20 files
130/130 PASS

Round 4
20/20 files
130/130 PASS

Round 5
20/20 files
130/130 PASS
```

Tổng:

```text
650 provider-regression test executions
0 failure
0 flaky failure
```

Log:

```text
provider-round-1.log
provider-round-2.log
provider-round-3.log
provider-round-4.log
provider-round-5.log
provider-loop-summary.txt
```

---

# 40. Tổng số lượt test trong audit này

```text
252 full-suite executions
+
650 repeated provider executions
=
902 test executions PASS
```

Lưu ý:

> Đây là số lượt test được thực thi, không phải 902 test case unique.

650 lượt provider là test cố ý chạy lặp để phát hiện:

```text
flaky state
session leak
cache leak
browser quota leak
race condition
regression giữa adapters
```

---

# 41. Live Chromium stress test

Ngoài unit/integration mock, đã chạy trực tiếp trên Docker image đang deploy.

Test:

```text
create CAPTCHA challenge
        ↓
verify image
        ↓
discard challenge
        ↓
repeat
```

5 lần liên tiếp:

```text
Round 1
image/png
10,610 bytes
PASS

Round 2
image/png
10,878 bytes
PASS

Round 3
image/png
10,523 bytes
PASS

Round 4
image/png
10,967 bytes
PASS

Round 5
image/png
10,219 bytes
PASS
```

TTL mỗi challenge:

```text
~300,000 ms
```

Final:

```json
{
  "ok": true,
  "rounds": 5
}
```

Không phát sinh:

```text
TVAN_THAISON_BROWSER_BUSY
```

---

# 42. Mức kiểm chứng E2E thực tế

Cần phân biệt ba cấp độ.

## 42.1. Automated protocol tests

Đã PASS:

```text
state machine
browser session semantics
challenge lifecycle
PDF detection
ZIP handling
cache
API integration
```

## 42.2. Live browser bootstrap

Đã PASS với Chromium thật:

```text
einvoice.vn
CAPTCHA thật
5 lần liên tiếp
```

## 42.3. Real after-CAPTCHA E2E

Bước này cần:

```text
CAPTCHA do người dùng đọc/nhập
```

Không có thiết kế auto-solve hoặc CAPTCHA bypass.

HAR thực tế là evidence cho:

```text
POST form thật
session thật
viewer route thật
application/pdf thật
```

Không nên tuyên bố:

```text
fully automated live E2E 13/13
```

vì điều đó sẽ yêu cầu tự động giải CAPTCHA, trái với thiết kế hiện tại.

---

# 43. Kiểm kê before/after

Baseline:

```text
/opt/hddt_conn/dev/scope-backups/
thaison-pdf-phase1-20260928-083135/
baseline-reconstructed
```

Final audit:

```text
/opt/hddt_conn/dev/scope-backups/
thaison-final-audit-20260929-024600/
```

Artifacts audit:

```text
before-after-inventory.tsv
thaison-feature-files.txt
git-status.txt
dev-runtime.txt
full-verify.log
provider-loop-summary.txt
provider-round-1.log
provider-round-2.log
provider-round-3.log
provider-round-4.log
provider-round-5.log
thaison-live-captcha-stress.log
```

Inventory sử dụng:

```text
semantic diff
ignore EOL-only noise
SHA-256
```

---

# 44. Phân biệt Thái Sơn với các thay đổi ngoài scope

Working tree còn các thay đổi độc lập:

```text
ACMAN
FAST
selected-dataset
dataset coverage
local workspace
```

Các thay đổi đó:

```text
không được tính là feature Thái Sơn
không reset
không revert
không overwrite
```

Đây là yêu cầu quan trọng để audit chính xác.

---

# 45. Runtime DEV hiện tại

DEV:

```text
http://10.10.2.45:8288
```

Health:

```json
{
  "ok": true,
  "version": "1.3.0-rc.2"
}
```

Container:

```text
644771c3da05dfaf867f5b427cdfff65201fa3fc024820bda80cf4b7e4d9ac84
```

Image:

```text
sha256:7b87315b211882cb7aac53ae52d52c185bbcaccb085620eeb1c06e7ee38adeea
```

State:

```text
healthy
```

---

# 46. Gap còn lại số 1 — wrong-CAPTCHA UX

Backend Thái Sơn:

```text
challengeSingleUse = true
```

Tức là:

```text
CAPTCHA submitted
        ↓
success OR failure
        ↓
browser challenge consumed
```

Tuy nhiên frontend hiện có:

```ts
const isFast = providerName === 'FAST';
const isSingleUseCaptcha = isFast;
```

Do đó:

```text
FAST wrong CAPTCHA
    ↓
frontend auto-refresh challenge

Thái Sơn wrong CAPTCHA
    ↓
backend challenge đã consumed
    ↓
frontend hiện chưa auto-refresh giống FAST
```

Happy path không bị ảnh hưởng.

Nhưng UX đúng hơn nên là:

```text
single-use capability
    ↓
generic UI auto-refresh
```

thay vì hard-code provider name.

Đây là gap nhỏ nhưng thật.

---

# 47. Gap còn lại số 2 — metadata `provider-research`

`provider-research.ts` vẫn có note từ giai đoạn cũ, đại ý:

```text
tenant đã có evidence
portal chung chưa suy đoán
```

Trong khi runtime hiện tại đã có:

```text
shared portal HAR evidence
live Chromium evidence
shared protocol implementation
```

Do đó đây là:

```text
documentation/UI metadata debt
```

không phải runtime blocker.

---

# 48. Hardening tùy chọn — ZIP fallback trên shared portal

Shared flow hiện ưu tiên:

```text
/xem-hoa-don?code=...
```

đây là đúng.

Fallback:

```text
/tai-hoa-don-dien-tu?format=pdf
```

đã có evidence có thể trả ZIP.

Hiện tại:

```text
primary viewer PDF
    → success

fallback ZIP
    → không phải %PDF
    → diagnostic/reject
```

Hardening tốt hơn trong iteration sau:

```text
fallback response
      ↓
magic detection
      ├── PDF
      │    → normalized PDF
      │
      └── ZIP
           ↓
         artifact.ts
           ↓
         original_ready / pdf_ready
```

Như vậy shared flow cũng tận dụng được ZIP artifact pipeline tenant.

---

# 49. Đánh giá kiến trúc

Kiến trúc hiện tại đúng hướng:

```text
provider-specific protocol
        ↓
adapter
        ↓
generic TvanPdfService
        ↓
generic presentation API
        ↓
generic UI
```

Không có:

```text
Thái Sơn-specific business flow
```

cắm trực tiếp vào:

```text
routes
API client
financial engine
GDT connector
invoice relation engine
dataset persistence model
```

---

# 50. Đánh giá regression risk

Ba thay đổi core quan trọng:

```text
optional normalized PDF
challengeSingleUse
cacheDiscriminator
```

Đây là những điểm có rủi ro ảnh hưởng provider khác cao nhất.

Tuy nhiên đã chạy:

```text
5 provider-regression rounds
650 provider test executions
0 failure
```

và:

```text
full verify
252 tests
PASS
```

Do đó chưa thấy regression trên các NCC đã triển khai.

---

# 51. Trạng thái hoàn thiện

Có thể coi các phần sau đã hoàn thiện:

```text
provider identification
MSTTCGP mapping
shared profile
Delmar tenant profile
CAPTCHA backend isolation
same-session browser flow
PDF viewer URL extraction
raw PDF capture
ZIP artifact handling
identity validation
cache discriminator
artifact lifecycle
presentation API integration
generic WebUI integration
full regression
provider repeated regression
live CAPTCHA bootstrap stress
```

Chưa nên gọi release là:

```text
absolutely no remaining work
```

vì còn:

```text
1. wrong-CAPTCHA Thái Sơn chưa auto-refresh ở frontend
2. provider-research note cũ
3. optional hardening shared ZIP fallback
```

---

# 52. Kết luận cuối cùng

Hóa đơn Thái Sơn trong HDDT_CONN phải được hiểu theo hai tầng:

```text
Tầng 1:
msttcgp = 0101300842
→ provider family Thái Sơn

Tầng 2:
dataset lookup metadata + evidence
→ chọn portal protocol profile
```

Hiện tại:

```text
shared_v1
    → einvoice.vn/tra-cuu
    → browser same-session
    → CAPTCHA
    → form navigation
    → JS/iframe viewer URL
    → raw CDP PDF stream

tenant_v1
    → Delmar tenant
    → HTTP/cookie session
    → CAPTCHA
    → /xem-hoa-don
    → /Download/DetailHoaDon
    → UUID
    → ZIP/PDF original
    → normalized PDF nếu đủ evidence
```

Tính năng đã được tích hợp đúng kiến trúc adapter của HDDT_CONN, giữ nguyên boundary của GDT/dataset/financial logic, không đưa protocol Thái Sơn vào generic UI/API business logic.

Kết quả kiểm thử hiện tại:

```text
Full application:
41 test files
252 tests
PASS

Repeated provider regression:
20 files × 5 rounds
130 tests/round
650 executions
PASS

Total audit executions:
902
PASS

Live Chromium CAPTCHA bootstrap:
5/5
PASS

DEV health:
healthy
```

Trạng thái hiện tại:

```text
Core Thái Sơn PDF flow:
đã triển khai và regression-safe theo bộ test hiện có.

Release hardening còn:
- generic wrong-CAPTCHA auto-refresh cho Thái Sơn;
- cập nhật provider-research metadata;
- tùy chọn xử lý ZIP fallback shared bằng artifact pipeline.
```
