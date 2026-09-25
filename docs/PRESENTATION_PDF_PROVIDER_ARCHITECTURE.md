# HDDT_CONN — Kiến trúc xem/tải bản thể hiện PDF theo nhà cung cấp

> **Trạng thái:** Tài liệu thiết kế chuẩn (target architecture), áp dụng cho phát triển mới và refactor tăng dần.
>
> **Phạm vi:** Tính năng xác định, chuẩn bị, xem và tải **bản thể hiện PDF do phần mềm/NCC HDDT cung cấp**.
>
> **Nguyên tắc tương thích:** Không refactor “big bang”; các adapter đã chạy ổn định tiếp tục hoạt động cho tới khi có adapter phiên bản mới thay thế có kiểm chứng.

## 1. Mục tiêu

HDDT_CONN cần cung cấp cho WebUI một trải nghiệm thống nhất:

- xác định phần mềm/NCC HDDT của hóa đơn;
- xác định có hỗ trợ lấy bản thể hiện hay không;
- thực hiện các bước tra cứu/xác thực riêng của NCC;
- xem PDF trên WebUI;
- tải PDF;
- khi NCC trả file gốc ZIP/PDF, cho phép giữ/tải file gốc nếu phù hợp;
- đảm bảo file trả về đúng hóa đơn đã chọn;
- không làm lộ cookie/token/challenge/private state của NCC ra frontend;
- cho phép bổ sung NCC hoặc phiên bản workflow mới với phạm vi thay đổi nhỏ, độc lập.

Mục tiêu cuối cùng của subsystem là **Presentation Artifact**, không phải “mã tra cứu”.
## 2. Vấn đề cần giải quyết

Các phần mềm HDDT không có một chuẩn duy nhất cho luồng xem/tải bản thể hiện.

Tên credential có thể là:

- Mã tra cứu;
- Mã số bí mật;
- Số bảo mật;
- Fkey/FKey;
- TransactionID;
- reservationCode;
- token/checkCode;
- hoặc dữ liệu chỉ xuất hiện sau một bước tra cứu trung gian.

Cùng một NCC còn có thể thay đổi:

- portal/domain;
- API endpoint;
- tên field;
- CAPTCHA;
- cookie/session;
- cách tạo file PDF;
- response metadata;
- đường tải file;
- hoặc workflow theo từng thế hệ phần mềm.

Vì vậy **không được chuẩn hóa tất cả credential thành một logic chung duy nhất**.
## 3. Nguyên tắc thiết kế

### 3.1. Chuẩn hóa contract, không chuẩn hóa nghiệp vụ NCC

Core chỉ chuẩn hóa:

- đầu vào hóa đơn;
- capability/readiness;
- challenge lifecycle;
- artifact lifecycle;
- trạng thái;
- view/download API;
- cache;
- kiểm tra an toàn file;
- audit.

Adapter tự chịu trách nhiệm:

- tên mã/credential;
- cách tìm credential;
- URL/API;
- request body/query/header;
- CAPTCHA/session/token;
- parse HTML/JSON/XML;
- cách tạo/tải file;
- validation đặc thù NCC.

### 3.2. PDF là điểm hội tụ

Các workflow khác nhau phải hội tụ về một contract cuối:

```text
Provider-specific workflow
        ↓
PresentationArtifact
        ↓
View | Download | Cache | Batch
```
### 3.3. Provider và adapter là hai khái niệm khác nhau

Một provider family có thể có nhiều adapter:

```text
M-Invoice
  ├─ minvoice-searchinvoice-v1
  └─ minvoice-portal-v2

VNPT
  ├─ vnpt-central-v1
  ├─ vnpt-home-v1
  └─ vnpt-api-v2
```

Không giả định quan hệ 1 provider = 1 implementation vĩnh viễn.

### 3.4. Adapter ổn định là bất biến về behavior

Khi NCC thay đổi workflow lớn:

- không sửa sâu adapter cũ đang chạy;
- tạo adapter version mới;
- thêm rule chọn adapter mới;
- giữ regression adapter cũ;
- rollback bằng cách đổi selection, không phục hồi code thủ công.

### 3.5. Fail closed

Không suy đoán endpoint hoặc fetch URL tùy ý từ payload hóa đơn.
Chỉ sử dụng host/route đã có evidence và allow-list.
## 4. Kiến trúc tổng thể

```text
React WebUI
   │
   │ Stable local API
   ▼
Presentation Orchestrator
   ├─ Provider/Adapter Resolver
   ├─ Capability + Readiness
   ├─ Challenge/Session Manager
   ├─ Artifact Cache/Store
   └─ Validation Coordinator
          │
          ▼
Provider Adapter Registry
   ├─ MISA adapters
   ├─ M-Invoice adapters
   ├─ Viettel adapters
   ├─ SoftDreams adapters
   ├─ VNPT adapters
   ├─ ACMAN adapters
   ├─ PVOIL adapters
   └─ future providers
          │
          ▼
Shared Infrastructure
   ├─ safe HTTP/redirect
   ├─ cookie/session
   ├─ GDT XML bridge
   ├─ CAPTCHA state
   ├─ ZIP/PDF helpers
   ├─ timeout/size limit
   └─ audit/security
```
## 5. Quan hệ với mã nguồn hiện tại

Mã nguồn hiện tại đã có các khối nền tảng phù hợp để chuyển đổi tăng dần:

- `TvanRegistry`: chọn adapter;
- `TvanAdapter`: contract provider;
- `TvanPdfService`: orchestration, token/challenge/cache/batch;
- `TvanAdapterContext.loadInvoiceXml`: bridge tải XML GDT;
- generic routes `/api/tvan/...`;
- `TvanPreparedArtifact`: original + normalized PDF;
- `TvanArtifactStatus`: lifecycle artifact.

Các adapter hiện đang đăng ký gồm:

| Provider code | Display name | CAPTCHA | Priority |
|---|---|---:|---:|
| `tvan_misa` | MISA meInvoice | none | P1 |
| `tvan_invoice` | M-Invoice | none | P1 |
| `tvan_softdreams` | SoftDreams EasyInvoice | per_invoice | P3 |
| `tvan_viettel` | Viettel SInvoice | session | P2 |
| `ehoadondientu` | ehoadondientu.com | none | P1 |
| `tvan_vnpt` | VNPT Invoice | per_invoice | P3 |
| `tvan_acman` | ACMAN AC-Invoice | none | P1 |
| `tvan_pvoil` | PVOIL eInvoice | per_invoice | P3 |

Tài liệu này không yêu cầu đổi ngay các interface trên; mục tiêu là xác định boundary để tiến hóa an toàn.
## 6. Mô hình domain đề xuất

### 6.1. Provider family

```ts
interface PresentationProviderFamily {
  id: string;              // minvoice, vnpt, misa...
  displayName: string;
}
```

### 6.2. Adapter identity

```ts
interface PresentationAdapterIdentity {
  adapterId: string;       // minvoice-searchinvoice-v1
  providerFamily: string;  // minvoice
  version: string;         // 1.0.0
}
```

`adapterId + version` phải được ghi vào trace/artifact metadata để phục vụ audit và rollback.

### 6.3. Provider evidence

Không ép mọi credential thành một field chung có ý nghĩa cố định.
```ts
interface ProviderEvidence {
  kind:
    | 'provider_code'
    | 'solution_tax_code'
    | 'transport_tax_code'
    | 'lookup_field'
    | 'lookup_url'
    | 'xml_field'
    | 'provider_response';

  name?: string;           // tên gốc: Mã tra cứu, Fkey...
  path?: string;           // ttkhac[], TTChung/TTKhac...
  value: unknown;
  source: 'dataset' | 'gdt_xml' | 'provider' | 'config';
}
```

Evidence phải giữ tên/path gốc để debug.
Adapter được phép diễn giải evidence theo rule riêng.

### 6.4. Capability và Readiness

Hai khái niệm bắt buộc tách biệt:

- **supported**: hệ thống có adapter phù hợp cho provider/version này;
- **ready**: hiện tại đã đủ dữ liệu/state để lấy artifact hay chưa.

Thiếu Fkey/mã tra cứu không đồng nghĩa provider không được hỗ trợ.
Ví dụ:

```json
{
  "provider": "minvoice",
  "adapterId": "minvoice-searchinvoice-v1",
  "supported": true,
  "ready": false,
  "recoverable": true,
  "requirements": [
    {
      "type": "lookup_credential",
      "resolveFrom": ["dataset", "gdt_xml"]
    }
  ]
}
```

### 6.5. Presentation Artifact

```ts
interface PresentationArtifact {
  content: Buffer;
  contentType: 'application/pdf';
  fileName: string;

  providerFamily: string;
  adapterId: string;
  adapterVersion: string;

  obtainedAt: string;
  expiresAt?: string;

  validation: PresentationValidation;
}
```
## 7. Stable API cho WebUI

Frontend chỉ nên biết các hành động nghiệp vụ chung:

```text
status
prepare
submit challenge
view
download PDF
download original (nếu có)
```

Façade ổn định triển khai cho WebUI:

```text
GET  /api/presentation/adapters
POST /api/presentation/status
POST /api/presentation/prepare
POST /api/presentation/challenge
POST /api/presentation/resolve-link
POST /api/presentation/view
POST /api/presentation/download
POST /api/presentation/download-original
```

Các route `/api/tvan/...` hiện hữu tiếp tục được giữ làm compatibility layer cho batch, card giám sát và client cũ:

```text
POST /api/tvan/pdf/status
POST /api/tvan/pdf/prepare-view
POST /api/tvan/pdf/prepare-artifact
POST /api/tvan/pdf/captcha
POST /api/tvan/pdf/view
POST /api/tvan/pdf/download
POST /api/tvan/artifact/download-original
```

Không thêm logic kiểu:

```ts
if (provider === 'vnpt') ...
if (provider === 'minvoice') ...
```

vào WebUI ngoài rendering component theo capability chung hoặc supervised diagnostic component có phạm vi rõ ràng.
## 8. Pipeline chung

```text
1. InvoiceDocument
2. Resolve provider family
3. Resolve adapter version
4. Adapter capability()
5. Resolve provider-specific inputs
6. Nếu cần: challenge/session/auth
7. Resolve presentation descriptor
8. Fetch/prepare original artifact
9. Normalize thành PDF nếu original là ZIP
10. Validate generic
11. Validate provider-specific identity
12. Cache artifact
13. Trả local view/download
```

### 8.1. Generic validation

Core bắt buộc kiểm tra:

- response size;
- timeout;
- MIME/sniffing;
- PDF magic `%PDF-`;
- ZIP safety nếu có;
- filename sanitization;
- redirect allow-list;
- không downgrade HTTPS nếu provider policy không cho phép.

### 8.2. Provider-specific validation

Adapter tự kiểm tra identity phù hợp với provider/version.
Ví dụ có thể gồm:

- seller tax code;
- invoice number;
- template/series canonicalization;
- total;
- provider metadata;
- lookup code;
- provider-generated invoice id.

Không tạo một validator toàn cục ép mọi NCC dùng cùng quy tắc.

## 9. Provider-specific lookup resolver

Mỗi adapter/version phải sở hữu logic lookup của chính nó.

Ví dụ:

```text
M-Invoice:
  Mã tra cứu / Số bảo mật / alias đã xác nhận
  → map sang API parameter sobaomat

SoftDreams:
  Fkey + seller-specific portal
  → CAPTCHA/Search transaction

Viettel:
  Mã số bí mật/reservationCode
  → CAPTCHA session token

VNPT:
  Fkey/mã tra cứu
  → portal/version-specific transaction
```

Helper chung chỉ được làm việc cơ học như đọc dynamic field/XML node; **precedence và semantics thuộc adapter**.
## 10. M-Invoice — định hướng thiết kế

Đối với M-Invoice, evidence thực tế cho thấy cần phân biệt:

- tên hiển thị/nguồn dữ liệu: `Mã tra cứu`, `Số bảo mật` hoặc alias theo phiên bản;
- API parameter hiện tại: `sobaomat`;
- solution provider MST có thể xuất hiện dạng `0106026495-001`;
- provider family root là `0106026495`.

Adapter không nên yêu cầu duy nhất literal `Số bảo mật`.

Lookup precedence nên thuộc riêng adapter M-Invoice:

```text
1. field trực tiếp đã được adapter xác nhận
2. rawDetail provider-specific fields
3. rawSummary provider-specific fields
4. normalized lookup tương thích
5. GDT XML fallback
6. nếu vẫn thiếu → ready=false, không supported=false
```

Khi nhiều nguồn trả credential khác nhau, fail closed với lỗi conflict; không tự chọn một giá trị.
## 11. Versioning provider adapter

### 11.1. Khi nào tạo adapter version mới

Tạo version mới khi thay đổi một trong các contract quan trọng:

- domain/portal architecture;
- auth model;
- CAPTCHA model;
- lookup semantics;
- sequence request;
- response schema;
- cách provider tạo artifact;
- endpoint download;
- cookie/session model;
- validation identity.

Không cần adapter mới khi chỉ:

- thêm alias tương đương đã kiểm chứng;
- tăng timeout hợp lý;
- bổ sung parser field backward-compatible;
- sửa bug không thay contract.

### 11.2. Không overwrite workflow lịch sử

Ví dụ:

```text
vnpt-central-v1
vnpt-home-v1
vnpt-api-v2
```

có thể cùng tồn tại trong một provider module.
## 12. Adapter selection

Resolver phải deterministic và trả evidence selection.

Thứ tự ưu tiên đề xuất:

1. explicit presentation mapping từ solution provider tax code/version;
2. exact provider-specific signature;
3. known portal/domain signature;
4. legacy provider code compatibility;
5. fallback adapter match;
6. unsupported.

Kết quả nên có:

```json
{
  "providerFamily": "vnpt",
  "adapterId": "vnpt-home-v1",
  "confidence": "high",
  "evidence": [
    {"kind": "solution_tax_code", "value": "..."},
    {"kind": "lookup_url", "value": "..."}
  ]
}
```

Nếu hai adapter cùng match ở cùng confidence và không có tie-break rule, phải fail ambiguous thay vì chọn theo thứ tự array ngầm định.
## 13. Cấu trúc thư mục mục tiêu

Không bắt buộc đổi ngay, nhưng code mới nên tiến tới:

```text
src/server/presentation/
  orchestrator.ts
  registry.ts
  contracts/
  infrastructure/
  providers/
    minvoice/
      manifest.ts
      adapters/
        searchinvoice-v1.ts
      parsers/
      validators/
      tests/
    vnpt/
      manifest.ts
      adapters/
        central-v1.ts
        home-v1.ts
    softdreams/
    viettel/
    misa/
    acman/
    pvoil/
```

Trong giai đoạn chuyển tiếp, có thể giữ đường dẫn `src/server/tvan/` và áp dụng cùng boundary logic.

Mục tiêu là module hóa, **không phải đổi tên thư mục bằng mọi giá**.
## 14. Manifest provider/adapter

Mỗi adapter nên có metadata khai báo tĩnh:

```ts
export const manifest = {
  adapterId: 'minvoice-searchinvoice-v1',
  providerFamily: 'minvoice',
  version: '1.0.0',

  captchaMode: 'none',
  priority: 'P1',

  allowedHosts: [
    'tracuuhoadon.minvoice.com.vn'
  ],

  capabilities: {
    viewPdf: true,
    downloadPdf: true,
    downloadOriginal: false
  }
};
```

Host/route/config nhạy cảm tới security phải nằm trong provider module, không do invoice payload tự quyết định.
## 15. Shared infrastructure được phép dùng chung

Các adapter nên dùng chung:

- safe fetch + timeout;
- redirect validation;
- response size limit;
- cookie parser/jar utility;
- CAPTCHA state store;
- token TTL;
- GDT XML bridge;
- PDF/ZIP sniffing;
- safe filename;
- artifact cache;
- singleflight;
- logging/audit;
- cancellation/AbortSignal.

Không dùng chung bằng cách gom logic request của nhiều provider vào một “mega adapter”.

## 16. State và private context

Private state provider có thể chứa:

- cookies;
- anti-forgery token;
- opaque token;
- provider artifact id;
- HTML representation;
- search response;
- challenge metadata.

Private state:

- chỉ giữ backend;
- có TTL;
- gắn với session và document fingerprint;
- không log secret;
- không trả frontend;
- xóa khi hết hạn/logout nếu phù hợp.
## 17. Cache và document fingerprint

Cache artifact nên key ít nhất theo:

```text
adapterId
+ adapterVersion
+ canonical document fingerprint
```

Không chỉ key theo provider.

Fingerprint nên dựa trên identity ổn định của invoice:

- invoice source;
- seller tax code;
- template number;
- series;
- invoice number;
- và field bổ sung nếu provider cần.

Nếu adapter version thay đổi, cache cũ không được tự động xem là artifact do version mới tạo.

## 18. Local view/download

Frontend nên mở/tải file qua HDDT_CONN local API.

Không yêu cầu frontend gọi trực tiếp provider URL vì:

- tránh lộ token/cookie;
- tránh CORS;
- provider URL có thể hết hạn;
- local backend có thể validate PDF;
- có audit/cache;
- không phụ thuộc thay đổi route NCC.
## 19. Bổ sung nhà cung cấp HDDT mới

Quy trình bắt buộc:

### Bước 1 — Thu thập evidence

Tối thiểu cần:

- dataset/raw JSON;
- XML GDT;
- PDF đúng hóa đơn nếu có;
- browser capture hoặc API contract;
- provider identity: MSTTCGP/tvandnkntt/provider code/domain;
- credential names/path;
- CAPTCHA/session behavior;
- endpoint xem/tải;
- response/error samples.

Không implement endpoint theo suy đoán.

### Bước 2 — Xác định provider family

Tách rõ:

- solution provider;
- transport/TVAN nếu có;
- presentation provider;
- seller-specific portal nếu có.

### Bước 3 — Thiết kế adapter version đầu tiên

Đặt `providerFamily`, `adapterId`, `version`, allow-list, CAPTCHA mode và priority.
### Bước 4 — Viết parser/lookup resolver riêng

Không thêm alias NCC mới vào generic lookup nếu alias có semantics đặc thù.

Chỉ dùng helper generic để duyệt cấu trúc.

### Bước 5 — Viết validation

Phải có ít nhất:

- generic PDF validation;
- invoice identity validation phù hợp provider.

### Bước 6 — Fixture và contract tests

Fixture phải sanitize secret/cookie/token.

Test tối thiểu:

- detect/match;
- capability;
- missing input;
- XML fallback nếu có;
- challenge flow nếu có;
- successful PDF;
- wrong invoice/mismatch;
- provider error;
- redirect ngoài allow-list;
- invalid content;
- timeout/oversize.

### Bước 7 — Registry integration

Thêm adapter vào registry/manifest loader và rule selection.
Không sửa logic provider khác.

### Bước 8 — Regression toàn subsystem

Chạy:

- provider test mới;
- toàn bộ TVAN/presentation tests;
- typecheck;
- integration;
- build;
- smoke DEV.

### Bước 9 — DEV acceptance

Chỉ deploy DEV.
Xác nhận:

- đúng PDF;
- view/download;
- retry;
- session expiry;
- batch nếu hỗ trợ;
- không ảnh hưởng provider cũ.

### Bước 10 — Release

Ghi adapterId/version, evidence level, provider/version hỗ trợ, hạn chế chưa xác minh và rollback route/version.

## 20. Khi NCC thay đổi cách xem/tải PDF

Không bắt đầu bằng sửa adapter đang production.
Trước tiên xác định thay đổi thuộc loại backward-compatible hay breaking.

### 20.1. Backward-compatible

Có thể patch adapter hiện tại nếu:

- thêm alias mới nhưng alias cũ vẫn hợp lệ;
- response thêm field;
- provider đổi header không ảnh hưởng contract cũ;
- parser cần chấp nhận thêm representation tương đương.

Yêu cầu:

- fixture cũ vẫn pass;
- fixture mới pass;
- behavior cũ không đổi.

### 20.2. Breaking workflow

Tạo adapter version mới khi:

- endpoint cũ bỏ;
- CAPTCHA/auth mới;
- portal generation mới;
- request sequence mới;
- credential meaning đổi;
- response artifact model đổi;
- domain architecture đổi.

Ví dụ:

```text
minvoice-searchinvoice-v1
→ giữ nguyên

minvoice-portal-v2
→ implementation mới
```

### 20.3. Selection transition

Có thể route bằng:

- invoice issue period;
- provider software version;
- MSTTCGP family/subcode;
- portal/domain;
- presence of signature fields;
- controlled feature flag.

Không route chỉ dựa trên “adapter mới nhất”.

### 20.4. Rollback

Rollback ưu tiên:

1. disable selection rule của adapter mới;
2. quay về adapter cũ nếu evidence phù hợp;
3. giữ source/version mới để điều tra.

Không rollback bằng cách xóa code hoặc chép đè source thủ công.

## 21. Database/catalog và configuration

Catalog được dùng để:

- ghi nhận provider identities;
- aliases;
- observed hosts;
- field paths;
- adapter coverage;
- evidence history.

Catalog **không được biến thành executable request template tùy ý** nếu request đó có thể bypass allow-list/security.

Configuration phù hợp cho:

- enable/disable adapter;
- timeout;
- retry;
- known non-secret aliases;
- feature flag;
- rollout percentage nếu sau này cần.

Code adapter vẫn chịu trách nhiệm cho:

- security-critical host validation;
- parsing;
- auth;
- request sequence;
- secret handling;
- artifact validation.

## 22. Testing strategy

### 22.1. Contract suite chung

Mọi adapter phải vượt qua contract chung:

- stable identity;
- deterministic match;
- capability không throw với input hợp lệ;
- unsupported/readiness rõ ràng;
- download trả đúng content type;
- secret không xuất hiện trong trace public.

### 22.2. Regression per adapter/version

CI nên có matrix logic:

```text
core presentation ........ PASS
misa-* ................... PASS
minvoice-* ............... PASS
viettel-* ................ PASS
softdreams-* ............. PASS
vnpt-* ................... PASS
...
```

Một provider mới không được làm thay đổi expected result của fixture provider cũ.

### 22.3. Golden evidence

Khi có dataset + XML + expected PDF của cùng hóa đơn, sử dụng làm fixture tham chiếu đã sanitize:

- identity mapping;
- lookup extraction;
- generated request;
- PDF validation.

Không commit production cookie/token/HAR chưa sanitize.

## 23. Observability và diagnostic

Mỗi transaction nên có safe trace:

- provider family;
- adapterId/version;
- selected-by evidence;
- stage;
- endpoint host/path đã mask query secret;
- HTTP status;
- content type;
- elapsed time;
- retry state;
- validation outcome.

Không log:

- cookie;
- bearer token;
- CAPTCHA secret;
- full lookup secret nếu không cần;
- raw HTML/XML chứa dữ liệu nhạy cảm trong application log.

Diagnostic UI có thể hiển thị evidence đã mask để phát triển adapter mà không làm thay đổi generic viewer.

## 24. Security requirements

Bắt buộc cho mọi adapter:

1. HTTPS-first; chỉ ngoại lệ có evidence và review riêng.
2. Host allow-list theo adapter.
3. Validate từng redirect hop.
4. Timeout.
5. Max response bytes.
6. Reject content không đúng expected artifact.
7. Không eval JavaScript provider.
8. Không fetch URL arbitrary từ raw invoice.
9. Không expose private provider state cho frontend.
10. Sanitized filename/path.
11. ZIP defense.
12. Token/challenge TTL.
13. Session isolation.
14. CSRF/origin policy cho local API.
15. Audit safe metadata.

Mọi ngoại lệ security phải được ghi trong tài liệu provider-specific.

## 25. Batch

Batch sử dụng cùng adapter/orchestrator với single invoice.

Không viết một implementation batch riêng cho NCC.

Priority hiện tại P1/P2/P3 có thể tiếp tục dùng để điều phối CAPTCHA cost, nhưng priority không được dùng để suy ra provider semantics.

## 26. Phân tách file gốc và PDF chuẩn hóa

Một provider có thể trả:

- PDF trực tiếp;
- ZIP chứa PDF/XML/attachment;
- artifact descriptor rồi mới download;
- HTML representation rồi yêu cầu provider generate file.

Core nên giữ hai khái niệm:

```text
original artifact
normalized presentation PDF
```

Nếu original là ZIP:

- lưu/tải original nếu policy cho phép;
- extract an toàn;
- chọn đúng PDF theo adapter rule;
- validate;
- trả PDF chuẩn hóa cho viewer.

Không tự dựng PDF thay thế từ dữ liệu hóa đơn nếu mục tiêu là “bản thể hiện do NCC phát hành”, trừ khi provider flow chính thức yêu cầu HTML → provider-generated file.

## 27. UI behavior

UI chung chỉ cần trạng thái:

- chưa hỗ trợ;
- cần chuẩn bị;
- cần CAPTCHA;
- đang chuẩn bị;
- sẵn sàng;
- lỗi retryable;
- lỗi không retryable.

Các chi tiết provider chỉ xuất hiện trong supervised/debug component, không chi phối generic viewer.

## 28. Lộ trình chuyển đổi từ kiến trúc hiện tại

### Giai đoạn A — giữ nguyên behavior

- giữ `TvanAdapter`;
- thêm quy ước adapter identity/version;
- chuẩn hóa capability/readiness về mặt semantics;
- bổ sung tài liệu/test.

### Giai đoạn B — module hóa provider

Di chuyển logic theo provider folder nhưng không đổi request flow.

### Giai đoạn C — versioned adapters

Khi provider thay đổi, tạo version mới thay vì sửa adapter cũ.

### Giai đoạn D — registry/manifest loader

Giảm hard-code trong constructor registry.
Registry load danh mục adapter từ một nơi duy nhất.

### Giai đoạn E — presentation naming

Nếu cần, đổi tên public/internal từ TVAN PDF sang Presentation subsystem qua compatibility wrapper; không bắt buộc cho correctness.

## 29. Các anti-pattern cần tránh

- Một hàm global `findAnyLookupCode()` quyết định semantics cho mọi NCC.
- Một field `securityCode` bắt buộc cho mọi provider.
- UI chứa request flow riêng từng NCC.
- Registry chọn “first match wins” khi match mơ hồ.
- Sửa adapter cũ để hỗ trợ breaking portal mới.
- Cho invoice payload quyết định arbitrary download URL.
- Download PDF nhưng không validate identity.
- Dùng một token cache chung chỉ theo provider.
- Log full lookup/token/cookie.
- Tự dựng PDF từ normalized data rồi gọi đó là bản thể hiện NCC.

## 30. Definition of Done cho adapter mới/version mới

Adapter chỉ được xem là hoàn thành khi:

- provider/version identification có evidence;
- lookup resolver có test;
- security allow-list xác định;
- challenge/session flow có test nếu có;
- successful PDF fixture pass;
- wrong invoice fixture bị reject;
- timeout/redirect/invalid content pass;
- generic view pass;
- generic download pass;
- batch compatibility được đánh giá;
- adapter cũ regression pass;
- tài liệu provider-specific được cập nhật;
- DEV acceptance hoàn tất.

## 31. Tài liệu provider-specific

Mỗi provider/version nên có tài liệu riêng ghi:

- evidence;
- provider identity;
- lookup semantics;
- API/browser flow;
- state machine;
- security boundary;
- known errors;
- retry policy;
- fixture coverage;
- limitations;
- release/version history.

Tài liệu lịch sử hiện có như M-Invoice, MISA, Viettel và SoftDreams tiếp tục được giữ để phục vụ trace release.

## 32. Quy tắc cập nhật tài liệu

Khi thêm adapter hoặc thay version:

1. cập nhật tài liệu provider-specific;
2. cập nhật bảng adapter hiện hành nếu provider mới được register;
3. ghi adapterId/version trong release note;
4. ghi thay đổi selection rule;
5. ghi migration/rollback;
6. không chỉnh sửa lại lịch sử evidence của release cũ.

## 33. Impact assessment gate trước khi sửa mã nguồn

Trước mọi patch liên quan presentation PDF phải ghi nhận tối thiểu:

- file/module dự kiến thay đổi;
- provider/adapter version bị tác động;
- contract dùng chung có thay đổi hay không;
- WebUI/API/batch/cache/session có bị tác động hay không;
- provider regression suites cần chạy;
- dữ liệu/evidence nào chứng minh patch;
- rollback plan;
- lý do không thể giải quyết bằng adapter version riêng nếu patch chạm core.

Nếu thay đổi chạm contract dùng chung, phải ưu tiên compatibility wrapper hoặc additive change trước breaking change.

## 34. Kết luận kiến trúc

Ranh giới chuẩn của HDDT_CONN là:

```text
KHÔNG CHUẨN HÓA
────────────────────────────────
Mã tra cứu / Fkey / mã bí mật /
CAPTCHA / token / endpoint /
HTML / cookie / workflow NCC
             │
             │ Provider Adapter Boundary
             ▼
CHUẨN HÓA
────────────────────────────────
Presentation Artifact PDF
+ status
+ validation
+ metadata
+ local view/download
```

Thiết kế này cho phép thêm NCC mới hoặc thêm phiên bản workflow mới với thay đổi cục bộ trong provider module, trong khi WebUI, batch engine và các provider đã triển khai tiếp tục dùng contract ổn định.

