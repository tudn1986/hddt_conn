# THIẾT KẾ & TRIỂN KHAI TVAN CATALOG DATABASE CHO HDDT PUBLIC v1.3.0-rc.1

**Phạm vi:** HDDT-public-production `1.3.0-rc.1`  
**Môi trường mục tiêu:** Docker/Portainer trên `vm300` (`10.10.2.45`), WebUI port `8188`  
**Trang quản trị:** `http://10.10.2.45:8188/admin`  
**Nguyên tắc phát hành:** **Giữ nguyên version `1.3.0-rc.1`**, chỉ cập nhật source nội bộ và build lại Docker image hiện tại.

---

## 1. Mục tiêu

Bổ sung một tab **`TVAN Catalog`** trong trang `/admin` để phục vụ phát triển, kiểm tra và hoàn thiện các adapter TVAN.

Backend sẽ:

1. Quan sát dữ liệu hóa đơn đi qua hệ thống từ hai nhóm nguồn:
   - **Dataset import**: `POST /api/datasets/import`.
   - **GDT query**:
     - `POST /api/invoices/query`.
     - `POST /api/invoices/query-auto`.
2. Tìm và trích các dấu hiệu nhận diện TVAN từ `InvoiceDocument`.
3. Gom nhóm theo tổ chức/nhà cung cấp TVAN.
4. Lưu **metadata TVAN đã tổng hợp** vào database SQLite.
5. Cung cấp API Admin để tìm kiếm, lọc, phân trang và xem chi tiết.
6. Hiển thị danh sách trên tab **TVAN Catalog** tại `/admin`.

Mục tiêu của database **không phải** lưu dataset hóa đơn trên server. Database chỉ lưu dữ liệu phục vụ catalog/quan sát TVAN.

---

## 2. Hiện trạng source v1.3.0-rc.1

Source hiện tại đã có các thành phần có thể tái sử dụng:

- `src/server/routes/dataset.routes.ts`
  - `/api/datasets/import` validate dataset bằng `DatasetService.import()`.
  - Dataset sau khi validate được trả lại browser và hiện không được persist trên server.
- `src/server/routes/invoice.routes.ts`
  - `/api/invoices/query`.
  - `/api/invoices/query-auto`.
  - Các kết quả GDT được normalize thành `InvoiceDocument`.
- `src/server/tvan/registry.ts`
  - Có `TvanRegistry`.
  - Có các adapter hiện tại: MISA, M-Invoice, SoftDreams, Viettel.
- `src/server/tvan/extract.ts`
  - Có `collectDocumentFields()`.
  - Có `findNamedValue()`.
  - Có `providerCodeOf()`.
  - Có `lookupCodeOf()`.
- `src/shared/models/index.ts`
  - `InvoiceDocument` đã có:
    - `providerCode`.
    - `lookup`.
    - `dynamicFields`.
    - `rawSummary`.
    - `rawDetail`.
- `src/server/routes/admin.routes.ts`
  - Admin API dùng `Authorization: Bearer <HDDT_ADMIN_TOKEN>`.
- `src/web/pages/AdminPage.tsx`
  - Đã có Admin WebUI, session list, audit log, revoke session.
- Docker:
  - Runtime là `node:22-bookworm-slim`.
  - `HDDT_APP_DATA_DIR=/data/app`.
  - `/data/app` được mount vào volume Docker `hddt_metadata`.
  - Root filesystem của container vẫn `read_only`.
- `package.json` yêu cầu Node `>=22.12`.

### 2.1. Lựa chọn database

Giải pháp đề xuất dùng:

```text
SQLite thông qua module tích hợp sẵn: node:sqlite
```

Database:

```text
/data/app/tvan-catalog.sqlite
```

Lý do:

- Không cần thêm package npm.
- Không cần sửa `pnpm-lock.yaml`.
- Không cần cài native build dependency.
- `node:sqlite` không còn cần cờ `--experimental-sqlite` từ Node 22.13; Docker build mục tiêu dùng `node:22-bookworm-slim` và phải được build với `--pull` để tránh base image 22.12 cũ.
- Phù hợp mô hình **một app replica** hiện tại.
- File SQLite nằm trong volume `hddt_metadata`, nên tồn tại sau khi container recreate/restart.
- Có transaction, index, filter, aggregate và migration schema rõ ràng hơn JSON file.

> `node:sqlite` phù hợp với runtime Node 22 đang dùng trong source hiện tại. Nếu sau này đổi Node major version, phải chạy lại test compatibility trước khi deploy.

---

# 3. Nguyên tắc dữ liệu

## 3.1. Dữ liệu được phép lưu

Database TVAN Catalog có thể lưu:

- `providerCode`.
- MST/mã tổ chức TVAN nếu phát hiện được.
- Tên hiển thị nhà cung cấp.
- Tình trạng có/không có adapter.
- CAPTCHA mode.
- Khả năng PDF.
- Portal/host đã quan sát.
- Origin/link tra cứu đã chuẩn hóa.
- Path/pattern tra cứu đã **sanitize**.
- Tên field/path trong JSON/XML dùng để nhận diện TVAN.
- Nguồn quan sát:
  - `dataset_import`.
  - `gdt_query`.
  - `gdt_query_auto`.
- Tổng số document đã quan sát.
- `firstSeenAt`.
- `lastSeenAt`.
- Số lần quan sát theo nguồn.
- Thống kê batch scan.

## 3.2. Dữ liệu không được lưu

Không lưu vào TVAN Catalog:

- Toàn bộ dataset.
- Raw JSON hóa đơn.
- Raw XML hóa đơn.
- PDF/ZIP.
- Invoice key.
- Số hóa đơn.
- Mã tra cứu cụ thể của từng hóa đơn.
- Token GDT.
- Cookie GDT.
- TVAN token.
- CAPTCHA answer.
- Password.
- Bearer token.
- Admin token.

Như vậy database là **development metadata catalog**, không phải business-data database.

---

# 4. Luồng kiến trúc

## 4.1. Dataset import

Luồng hiện tại:

```text
Browser
   |
   | POST /api/datasets/import
   v
DatasetService.import()
   |
   | validate
   v
DatasetFile
   |
   v
trả lại Browser
```

Luồng mới:

```text
Browser
   |
   | POST /api/datasets/import
   v
DatasetService.import()
   |
   | validate
   v
DatasetFile
   |
   +------> TvanCatalogService.observeDocuments()
   |               |
   |               +--> extract TVAN metadata
   |               +--> aggregate trong memory theo request
   |               +--> SQLite transaction
   |
   v
trả lại Browser
```

Dataset **không được lưu nguyên bản** vào SQLite.

## 4.2. GDT query thường

```text
POST /api/invoices/query
        |
        v
GDT connector
        |
        v
normalizeInvoice()
        |
        v
InvoiceDocument[]
        |
        +--> TvanCatalogService.observeDocuments(
        |       source = "gdt_query"
        |   )
        |
        v
Response về Browser
```

## 4.3. GDT query-auto

```text
POST /api/invoices/query-auto
        |
        v
InvoiceQueryService.queryAuto()
        |
        +--> list query
        +--> hydrate detail
        +--> normalizeInvoice()
        |
        v
QueryAutoResult.documents
        |
        +--> TvanCatalogService.observeDocuments(
        |       source = "gdt_query_auto"
        |   )
        |
        v
Response về Browser
```

`query-auto` là điểm rất quan trọng vì document sau hydration thường có `rawDetail` và dynamic fields đầy đủ hơn, giúp phát hiện TVAN chính xác hơn.

---

# 5. Thiết kế module

Đề xuất chia thành ba lớp.

## 5.1. `src/shared/tvan-catalog/index.ts`

Pure functions, không truy cập database.

Nhiệm vụ:

- Trích dấu hiệu TVAN từ `InvoiceDocument`.
- Normalize:
  - provider code.
  - MST.
  - hostname.
  - origin.
  - URL.
  - field name/path.
- Sanitize lookup URL.
- Tạo identity alias.
- Deduplicate observation trong một request.
- Không chứa secret.
- Dễ unit test.

Ví dụ model nội bộ:

```ts
export type TvanObservationSource =
  | 'dataset_import'
  | 'gdt_query'
  | 'gdt_query_auto';

export interface TvanObservation {
  providerCode?: string;
  providerTaxCode?: string;
  displayName?: string;

  adapterSupported: boolean;
  pdfSupported: boolean;
  captchaMode?: string;

  aliases: Array<{
    type: 'provider_code' | 'tax_code' | 'host';
    value: string;
  }>;

  endpoints: Array<{
    kind: 'provider_portal' | 'lookup_portal';
    origin: string;
    host: string;
    pathPattern?: string;
  }>;

  mappings: Array<{
    semanticRole: string;
    fieldName: string;
    fieldPath: string;
  }>;
}
```

---

## 5.2. `src/server/services/tvan-catalog-db.service.ts`

Chịu trách nhiệm SQLite:

- Mở database.
- Tạo schema.
- Migration.
- PRAGMA.
- Transaction.
- Query/filter/pagination.
- Upsert.
- Merge provider identity khi nhiều alias trỏ tới cùng tổ chức.
- Close database khi server shutdown.

Database path mặc định:

```text
<appDataDir>/tvan-catalog.sqlite
```

Trong Docker:

```text
/data/app/tvan-catalog.sqlite
```

Khuyến nghị PRAGMA:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

Vì ứng dụng hiện chỉ hỗ trợ **một app replica**, SQLite phù hợp với mô hình này.

---

## 5.3. `src/server/services/tvan-catalog.service.ts`

Lớp orchestration:

```text
InvoiceDocument[]
        |
        v
extract / normalize
        |
        v
deduplicate observations trong request
        |
        v
resolve aliases
        |
        v
upsert database trong 1 transaction
```

API đề xuất:

```ts
class TvanCatalogService {
  observeDocuments(
    documents: InvoiceDocument[],
    source: TvanObservationSource
  ): Promise<TvanObserveResult>;

  listProviders(filter: TvanCatalogFilter): TvanCatalogListResult;

  getProvider(id: number): TvanCatalogProviderDetail | undefined;

  getStats(): TvanCatalogStats;

  close(): void;
}
```

### 5.3.1. Quy tắc không làm hỏng luồng chính

TVAN Catalog là chức năng quan sát phục vụ phát triển. Nếu ghi database thất bại:

- Log lỗi server.
- Không trả raw data vào log.
- **Không làm hỏng query hóa đơn đang chạy**.

Ví dụ route:

```ts
try {
  app.tvanCatalog.observeDocuments(documents, 'gdt_query');
} catch (error) {
  request.log.error({ err: error }, 'tvan_catalog_observe_failed');
}
```

Có thể bổ sung health/status của catalog trong Admin để biết khi database gặp lỗi.

---

# 6. Thiết kế database

## 6.1. Bảng `tvan_catalog_meta`

Theo dõi schema DB.

```sql
CREATE TABLE IF NOT EXISTS tvan_catalog_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

Ví dụ:

```text
schema_version = 1
created_at     = 2026-...
```

---

## 6.2. Bảng `tvan_providers`

Một record đại diện cho một tổ chức/provider TVAN đã được resolve.

```sql
CREATE TABLE IF NOT EXISTS tvan_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    provider_code TEXT,
    provider_tax_code TEXT,
    display_name TEXT,

    adapter_supported INTEGER NOT NULL DEFAULT 0,
    pdf_supported INTEGER NOT NULL DEFAULT 0,
    captcha_mode TEXT,

    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,

    seen_documents INTEGER NOT NULL DEFAULT 0,
    seen_dataset_import INTEGER NOT NULL DEFAULT 0,
    seen_gdt_query INTEGER NOT NULL DEFAULT 0,
    seen_gdt_query_auto INTEGER NOT NULL DEFAULT 0,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Index:

```sql
CREATE INDEX IF NOT EXISTS idx_tvan_provider_code
ON tvan_providers(provider_code);

CREATE INDEX IF NOT EXISTS idx_tvan_provider_tax_code
ON tvan_providers(provider_tax_code);

CREATE INDEX IF NOT EXISTS idx_tvan_provider_last_seen
ON tvan_providers(last_seen_at DESC);
```

---

## 6.3. Bảng `tvan_provider_aliases`

Dùng để resolve một provider từ nhiều dấu hiệu.

```sql
CREATE TABLE IF NOT EXISTS tvan_provider_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    alias_type TEXT NOT NULL,
    alias_value TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    seen_count INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY(provider_id)
      REFERENCES tvan_providers(id)
      ON DELETE CASCADE,

    UNIQUE(alias_type, alias_value)
);
```

`alias_type`:

```text
provider_code
tax_code
host
```

Ví dụ:

```text
provider_code | tvan_softdreams
tax_code      | 0105987432
host          | easyinvoice.com.vn
```

### Quy tắc resolve

Một document tạo ra tập alias.

Backend:

1. Tìm provider theo các alias.
2. Nếu chưa tồn tại:
   - tạo provider.
3. Nếu tìm được một provider:
   - update provider.
4. Nếu nhiều alias đang trỏ tới nhiều provider:
   - merge trong transaction.
   - giữ provider có ID cũ nhất.
   - chuyển alias/endpoint/mapping về provider giữ lại.
   - xóa record trùng.

Cơ chế này giúp catalog dần tự hoàn thiện khi dataset mới chứa nhiều thông tin hơn dataset cũ.

---

# 7. Portal và link tra cứu

## 7.1. Bảng `tvan_endpoints`

```sql
CREATE TABLE IF NOT EXISTS tvan_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,

    endpoint_kind TEXT NOT NULL,
    origin TEXT NOT NULL,
    host TEXT NOT NULL,
    path_pattern TEXT NOT NULL DEFAULT '',

    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    seen_count INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY(provider_id)
      REFERENCES tvan_providers(id)
      ON DELETE CASCADE,

    UNIQUE(provider_id, endpoint_kind, origin, path_pattern)
);
```

`endpoint_kind`:

```text
provider_portal
lookup_portal
```

Không nên chỉ có một trường `portal`, vì một số hệ thống có:

- Portal chính của TVAN.
- Lookup portal riêng theo khách hàng/MST.
- Subdomain lookup khác nhau.

Ví dụ kiến trúc:

```text
Provider:
SoftDreams EasyInvoice

Provider portal:
https://easyinvoice.vn

Observed lookup host:
<MST>hd.easyinvoice.com.vn
```

---

## 7.2. Sanitize link tra cứu

Không lưu lookup code thật.

Ví dụ URL thực:

```text
https://abc.example.vn/tra-cuu?code=AAABBBCCC
```

Database chỉ lưu:

```text
origin:
https://abc.example.vn

path_pattern:
/tra-cuu?code=:lookupCode
```

Nếu path chứa mã động:

```text
/lookup/AAABBBCCC
```

thì lưu:

```text
/lookup/:lookupCode
```

Các query parameter không cần thiết phải bỏ hoàn toàn.

---

# 8. Mapping field nhận diện TVAN

## 8.1. Bảng `tvan_field_mappings`

```sql
CREATE TABLE IF NOT EXISTS tvan_field_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,

    semantic_role TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_path TEXT NOT NULL,

    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    seen_count INTEGER NOT NULL DEFAULT 1,

    FOREIGN KEY(provider_id)
      REFERENCES tvan_providers(id)
      ON DELETE CASCADE,

    UNIQUE(provider_id, semantic_role, field_name, field_path)
);
```

`semantic_role` có thể gồm:

```text
provider_code
provider_tax_code
provider_name
lookup_portal
lookup_url
lookup_code
lookup_code_type
unknown_tvan_candidate
```

Ví dụ:

```text
semantic_role     provider_tax_code
field_name        MSTTCGP
field_path        rawDetail...
```

Mục đích là biết **field/path nào thực tế đang xuất hiện** trong dữ liệu để phục vụ phát triển adapter.

Không lưu raw JSON chứa field đó.

---

# 9. Thống kê nguồn scan

## 9.1. Bảng `tvan_ingest_batches`

```sql
CREATE TABLE IF NOT EXISTS tvan_ingest_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    source_type TEXT NOT NULL,
    observed_at TEXT NOT NULL,

    document_count INTEGER NOT NULL,
    provider_count INTEGER NOT NULL,
    duration_ms INTEGER,

    status TEXT NOT NULL DEFAULT 'ok'
);
```

Không lưu session ID, username, MST tài khoản GDT hay invoice IDs trong bảng này.

`source_type`:

```text
dataset_import
gdt_query
gdt_query_auto
```

Mục đích:

- biết catalog được cập nhật từ đâu;
- kiểm tra hook hoạt động;
- thống kê số lượng document đã scan;
- hỗ trợ debug hiệu năng.

---

# 10. Thuật toán trích TVAN

Ưu tiên dữ liệu theo thứ tự:

## 10.1. Provider code

```ts
document.providerCode
document.lookup?.providerCode
providerCodeOf(document)
```

Normalize:

```text
trim
lowercase
```

## 10.2. Adapter Registry

Dùng:

```ts
const registry = new TvanRegistry();
const capability = registry.capability(document);
```

Lấy:

```text
providerCode
displayName
supported
captchaMode
priority
```

`pdfSupported` có thể suy ra từ adapter được resolve/capability hiện tại.

## 10.3. MST tổ chức TVAN

Tìm trong dynamic/raw field qua `collectDocumentFields()` / `findNamedValue()`.

Candidate field name nên gồm các biến thể đã quan sát được trong source/dataset, ví dụ:

```text
msttcgp
MSTTCGP
tvandnkntt
```

Không nên hard-code chỉ một field.

## 10.4. Portal/link

Nguồn:

```text
document.lookup
dynamicFields
rawSummary
rawDetail
adapter-specific knowledge
```

URL phải được parse bằng `new URL()` trước khi ghi DB.

## 10.5. Performance

Không thực hiện SQL `INSERT` cho từng hóa đơn ngay trong vòng lặp.

Nên:

```text
documents
   |
   v
scan
   |
   v
Map<providerIdentity, AggregatedObservation>
   |
   v
1 SQLite transaction
```

Ví dụ dataset 20.000 hóa đơn có 4 TVAN:

```text
20.000 InvoiceDocument
        ↓
4 provider aggregate
20 endpoint aggregate
40 mapping aggregate
        ↓
một transaction
```

Điều này giảm đáng kể I/O.

---

# 11. API Admin

Tất cả API bên dưới tiếp tục dùng:

```http
Authorization: Bearer <HDDT_ADMIN_TOKEN>
```

và tuân theo Origin/CSRF policy hiện tại.

## 11.1. Danh sách TVAN

```http
GET /api/admin/tvan-catalog
```

Query parameters đề xuất:

```text
q
providerCode
providerTaxCode
supported
source
host
seenFrom
seenTo
page
pageSize
sort
order
```

Ví dụ:

```text
/api/admin/tvan-catalog?q=softdreams&page=1&pageSize=50
```

Response:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 50
}
```

## 11.2. Chi tiết provider

```http
GET /api/admin/tvan-catalog/:id
```

Response gồm:

```text
provider
aliases
endpoints
fieldMappings
sourceStatistics
```

## 11.3. Thống kê

```http
GET /api/admin/tvan-catalog/stats
```

Ví dụ:

```json
{
  "providers": 7,
  "supportedProviders": 4,
  "unsupportedProviders": 3,
  "observedDocuments": 18000,
  "lastObservedAt": "..."
}
```

---

# 12. Thiết kế tab `/admin` → `TVAN Catalog`

Trang `/admin` đề xuất dùng Tabs:

```text
[ Sessions ] [ TVAN Catalog ] [ Audit log ]
```

## 12.1. Toolbar

```text
Tìm kiếm [________________________]

Provider [Tất cả ▼]
MST TVAN [______________]
Adapter [Tất cả / Supported / Unsupported]
Nguồn [Tất cả / Dataset / GDT / Query-auto]

[Refresh]
```

## 12.2. Bảng chính

Các cột:

```text
Provider
MST TVAN
Tên đầy đủ
Adapter
PDF
CAPTCHA
Portal / Host
Số document quan sát
Dataset
GDT
Query-auto
First seen
Last seen
Chi tiết
```

## 12.3. Drawer/Modal chi tiết

Hiển thị:

### Thông tin

```text
Provider code
MST TVAN
Display name
Adapter supported
PDF supported
CAPTCHA mode
First seen
Last seen
Seen documents
```

### Aliases

```text
provider_code
tax_code
host
```

### Portal / Lookup endpoints

```text
kind
origin
host
path pattern
seen count
first seen
last seen
```

### Field mappings

```text
semantic role
field name
field path
seen count
```

---

# 13. Các file cần THÊM MỚI

## 13.1. Backend

```text
src/server/services/tvan-catalog-db.service.ts
src/server/services/tvan-catalog.service.ts
src/shared/tvan-catalog/index.ts
```

## 13.2. Tests

```text
tests/unit/tvan-catalog.test.ts
tests/integration/admin-tvan-catalog.test.ts
```

## 13.3. Documentation

Khuyến nghị thêm:

```text
docs/tvan_design/design/TVAN_CATALOG_DATABASE_DESIGN_v1.3.0-rc.1.md
```

Chính là tài liệu thiết kế này.

---

# 14. Các file cần THAY THẾ / SỬA

## 14.1. `src/server/app.ts`

Thay đổi:

1. Import `TvanCatalogService`.
2. Khởi tạo:

```ts
const tvanCatalog = new TvanCatalogService(settings);
```

3. Decorate:

```ts
app.decorate('tvanCatalog', tvanCatalog);
```

4. Bổ sung vào Fastify type:

```ts
interface FastifyInstance {
  ...
  tvanCatalog: TvanCatalogService;
}
```

5. Close database:

```ts
app.addHook('onClose', async () => {
  tvanCatalog.close();
  await sessions.close();
});
```

Không thay:

```ts
const APP_VERSION = '1.3.0-rc.1';
```

---

## 14.2. `src/server/routes/dataset.routes.ts`

Hiện tại:

```ts
return app.dataset.import(parsed.data.dataset);
```

Sửa logic thành:

```ts
const imported = app.dataset.import(parsed.data.dataset);

app.tvanCatalog.observeDocuments(
  imported.documents.map((item) => item.normalized),
  'dataset_import'
);

return imported;
```

Phần catalog nên được bọc error isolation để DB lỗi không làm mất chức năng mở dataset.

---

## 14.3. `src/server/routes/invoice.routes.ts`

### `/api/invoices/query`

Sau khi:

```ts
const documents = page.items.map(...)
```

thêm:

```ts
app.tvanCatalog.observeDocuments(documents, 'gdt_query');
```

### `/api/invoices/query-auto`

Sau:

```ts
const result = await service.queryAuto(...)
```

thêm:

```ts
app.tvanCatalog.observeDocuments(
  result.documents,
  'gdt_query_auto'
);
```

Nên scan `query-auto` **sau khi hydration hoàn thành** để tận dụng `rawDetail`.

---

## 14.4. `src/server/routes/admin.routes.ts`

Thêm:

```text
GET /api/admin/tvan-catalog
GET /api/admin/tvan-catalog/stats
GET /api/admin/tvan-catalog/:id
```

Tất cả gọi lại `requireAdmin(request)` hiện có.

Không tạo cơ chế auth riêng.

---

## 14.5. `src/shared/models/index.ts`

Thêm các public model cho Admin UI:

```text
TvanCatalogProvider
TvanCatalogProviderDetail
TvanCatalogEndpoint
TvanCatalogFieldMapping
TvanCatalogStats
TvanCatalogFilter
TvanCatalogListResult
```

Không thêm raw invoice vào các type này.

---

## 14.6. `src/web/pages/AdminPage.tsx`

Sửa từ dashboard sessions/audit hiện tại thành tab layout:

```text
Sessions
TVAN Catalog
Audit log
```

Bổ sung:

- state filter;
- pagination;
- load list;
- load stats;
- detail drawer;
- Refresh;
- empty state;
- error state.

Admin Token tiếp tục nằm trong `sessionStorage` như implementation hiện tại.

---

# 15. Các file KHÔNG cần thay đổi

Nếu dùng `node:sqlite` như thiết kế này thì **không cần** thay:

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
Dockerfile
VERSION
```

Cũng không bắt buộc đổi Portainer Stack vì database nằm dưới:

```text
/data/app
```

mà volume hiện tại đã mount:

```yaml
volumes:
  - hddt_metadata:/data/app
```

---

# 16. Tài liệu deployment/security cần cập nhật sau khi code hoàn thành

Do trước đây tài liệu public mô tả `hddt_metadata` chỉ chứa config/runtime/log, khi triển khai TVAN Catalog database cần cập nhật ít nhất:

```text
docs/PUBLIC_DOCKER_DEPLOYMENT.md
docs/PUBLIC_DOCKER_DEPLOYMENT_VIE.md
docs/ADMIN_WEBUI_V1.3.0-RC.1.md
```

Nội dung mới phải nêu rõ file được phép:

```text
config.json
runtime.json
*.log
tvan-catalog.sqlite
tvan-catalog.sqlite-wal
tvan-catalog.sqlite-shm
```

và vẫn cấm:

```text
invoice dataset
raw invoice JSON/XML
ZIP
PDF
lookup code cụ thể
secret/token/cookie
```

---

# 17. Giữ nguyên version `1.3.0-rc.1`

Không sửa:

```text
VERSION
package.json -> version
src/server/app.ts -> APP_VERSION
```

Vẫn là:

```text
1.3.0-rc.1
```

Có thể dùng **source revision nội bộ** trong tài liệu vận hành, ví dụ:

```text
v1.3.0-rc.1 + Admin TVAN Catalog DB patch
```

Nhưng không thay app version trả về API.

Nếu image Docker hiện tại là:

```text
hddt_conn:1.3.0-rc.1-admin-ui-r1
```

có thể **build đè cùng tag này** theo yêu cầu.

---

# 18. Hướng dẫn chuẩn bị file patch trên Windows

Tạo một thư mục, ví dụ:

```text
D:\HDDT_PATCH_TVAN_CATALOG\
```

Bên trong giữ đúng cấu trúc source:

```text
D:\HDDT_PATCH_TVAN_CATALOG\
└── src\
    ├── server\
    │   ├── app.ts
    │   ├── routes\
    │   │   ├── admin.routes.ts
    │   │   ├── dataset.routes.ts
    │   │   └── invoice.routes.ts
    │   └── services\
    │       ├── tvan-catalog-db.service.ts
    │       └── tvan-catalog.service.ts
    ├── shared\
    │   ├── models\
    │   │   └── index.ts
    │   └── tvan-catalog\
    │       └── index.ts
    └── web\
        └── pages\
            └── AdminPage.tsx

tests\
├── unit\
│   └── tvan-catalog.test.ts
└── integration\
    └── admin-tvan-catalog.test.ts
```

Nếu cập nhật docs thì thêm:

```text
docs\
└── TVAN_CATALOG_DATABASE_DESIGN_v1.3.0-rc.1.md
```

---

# 19. Backup source trên VM300 trước khi dùng WinSCP

SSH vào:

```bash
ssh <user>@10.10.2.45
```

Chuyển tới release:

```bash
cd /opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1
```

Backup source hiện tại:

```bash
sudo tar -czf \
  HDDT-public-production_before_tvan_catalog_$(date +%Y%m%d_%H%M%S).tgz \
  HDDT-public-production
```

Kiểm tra:

```bash
ls -lh *.tgz
```

Không xóa backup cho tới khi build và acceptance test hoàn tất.

---

# 20. Backup database/metadata volume trước khi update

Xác định volume:

```bash
docker volume ls | grep hddt
```

Nếu Stack đang dùng volume:

```text
hddt-public_hddt_metadata
```

nên backup khi app dừng để SQLite/WAL nhất quán:

```bash
docker stop hddt-public
```

Sau đó:

```bash
mkdir -p /opt/hddt_conn/backup

docker run --rm \
  -v hddt-public_hddt_metadata:/src:ro \
  -v /opt/hddt_conn/backup:/backup \
  alpine \
  tar -czf /backup/hddt_metadata_before_tvan_catalog.tgz -C /src .
```

Khởi động lại nếu chưa deploy ngay:

```bash
docker start hddt-public
```

> Tên volume thực tế có thể có prefix khác. Kiểm tra bằng `docker volume ls`.

---

# 21. WinSCP — kết nối VM300

## 21.1. Tạo session

Trong WinSCP:

```text
File protocol: SFTP
Host name:     10.10.2.45
Port number:   22
User name:     <ubuntu-user>
Password/key:  <theo cấu hình VM>
```

Kết nối.

## 21.2. Thư mục đích

Source hiện tại:

```text
/opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1/HDDT-public-production/
```

---

# 22. WinSCP — phương án A: user có quyền ghi trực tiếp `/opt/hddt_conn`

Nếu owner/permission cho phép, dùng WinSCP upload trực tiếp.

## 22.1. File mới

Copy:

```text
src/server/services/tvan-catalog-db.service.ts
src/server/services/tvan-catalog.service.ts
src/shared/tvan-catalog/index.ts
tests/unit/tvan-catalog.test.ts
tests/integration/admin-tvan-catalog.test.ts
```

WinSCP sẽ tạo thư mục:

```text
src/shared/tvan-catalog/
```

nếu chưa có.

## 22.2. File thay thế

Overwrite:

```text
src/server/app.ts
src/server/routes/admin.routes.ts
src/server/routes/dataset.routes.ts
src/server/routes/invoice.routes.ts
src/shared/models/index.ts
src/web/pages/AdminPage.tsx
```

Chọn:

```text
Overwrite
```

khi WinSCP hỏi.

---

# 23. WinSCP — phương án B: user không có quyền ghi `/opt`

Đây là phương án an toàn hơn khi `/opt/hddt_conn` do root sở hữu.

Upload patch vào:

```text
/home/<user>/hddt_patch_tvan_catalog/
```

Sau đó SSH:

```bash
cd /home/<user>/hddt_patch_tvan_catalog
```

Dùng `rsync`:

```bash
sudo rsync -av \
  ./ \
  /opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1/HDDT-public-production/
```

`rsync` sẽ:

- ghi đè các file có trong patch;
- thêm file mới;
- không xóa các file source khác.

Đây là cách được khuyến nghị hơn việc xóa toàn bộ source.

---

# 24. Không nên xóa toàn bộ source khi chỉ cập nhật patch

Với thay đổi TVAN Catalog, không cần:

```bash
rm -rf HDDT-public-production/*
```

Nên chỉ:

```text
ADD các file mới
OVERWRITE các file được liệt kê
```

Lợi ích:

- giảm rủi ro thiếu file;
- dễ kiểm soát;
- dễ rollback;
- WinSCP nhanh hơn;
- tránh vô tình xóa config/docs/deploy script đang dùng.

---

# 25. Kiểm tra file sau khi WinSCP upload

SSH:

```bash
cd /opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1/HDDT-public-production
```

Kiểm tra file mới:

```bash
ls -l \
  src/server/services/tvan-catalog-db.service.ts \
  src/server/services/tvan-catalog.service.ts \
  src/shared/tvan-catalog/index.ts \
  tests/unit/tvan-catalog.test.ts \
  tests/integration/admin-tvan-catalog.test.ts
```

Kiểm tra version vẫn giữ nguyên:

```bash
cat VERSION
node -p "require('./package.json').version"
```

Kết quả phải là:

```text
1.3.0-rc.1
1.3.0-rc.1
```

Có thể kiểm tra APP_VERSION:

```bash
grep "APP_VERSION" src/server/app.ts
```

Phải vẫn là:

```text
1.3.0-rc.1
```

---

# 26. Chạy kiểm tra source trước Docker build

Nếu VM đã có Node/pnpm phù hợp:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
```

Tốt nhất:

```bash
pnpm run verify
```

Do thiết kế dùng `node:sqlite`, không cần thêm dependency vào package.

Nếu VM chỉ dùng Docker build, bước build Docker cũng sẽ chạy:

```text
pnpm install --frozen-lockfile
pnpm run build
```

theo Dockerfile hiện tại.

---

# 27. Build lại Docker — KHÔNG tăng version

Chuyển đến source:

```bash
cd /opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1/HDDT-public-production
```

Nếu đang dùng image tag:

```text
hddt_conn:1.3.0-rc.1-admin-ui-r1
```

build lại **cùng tag**:

```bash
docker build --pull --no-cache \
  -t hddt_conn:1.3.0-rc.1-admin-ui-r1 .
```

Không đổi `VERSION`.

Kiểm tra image mới:

```bash
docker image inspect \
  hddt_conn:1.3.0-rc.1-admin-ui-r1 \
  --format 'ID={{.Id}} Created={{.Created}}'
```

Ghi lại Image ID.

---

# 28. Update Stack trên Portainer

Vào:

```text
Portainer
→ Stacks
→ hddt-public
→ Editor
```

Image vẫn giữ:

```yaml
image: hddt_conn:1.3.0-rc.1-admin-ui-r1
```

Không cần sửa version/tag nếu chủ đích build đè cùng tag.

Kiểm tra các biến hiện tại:

```yaml
HDDT_PUBLIC_URL: http://10.10.2.45:8188
HDDT_ALLOWED_ORIGINS: http://10.10.2.45:8188
HDDT_INSECURE_HTTP: "1"
HDDT_ADMIN_TOKEN: ${HDDT_ADMIN_TOKEN}
```

Volume phải còn:

```yaml
volumes:
  - hddt_metadata:/data/app
```

Sau đó:

```text
Update the stack
```

### Quan trọng

Vì image là image local được build trên vm300:

```text
KHÔNG bật Re-pull image
```

Portainer phải recreate container bằng image local vừa build.

---

# 29. Xác nhận container dùng image mới

Image ID local:

```bash
docker image inspect \
  hddt_conn:1.3.0-rc.1-admin-ui-r1 \
  --format '{{.Id}}'
```

Container image ID:

```bash
docker inspect hddt-public \
  --format '{{.Image}}'
```

Hai giá trị phải tương ứng.

Kiểm tra:

```bash
docker ps --filter name=hddt-public
```

Log:

```bash
docker logs --tail 200 hddt-public
```

---

# 30. Kiểm tra SQLite database

Sau khi app start, file dự kiến:

```text
/data/app/tvan-catalog.sqlite
```

Kiểm tra từ container:

```bash
docker exec hddt-public \
  node -e "const fs=require('fs'); console.log(fs.existsSync('/data/app/tvan-catalog.sqlite'))"
```

Kết quả:

```text
true
```

Do container không nhất thiết có CLI `sqlite3`, việc kiểm tra schema nên thực hiện qua API/test hoặc bằng Node `node:sqlite`.

Ví dụ đọc table list:

```bash
docker exec hddt-public node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/data/app/tvan-catalog.sqlite', { readOnly: true });
console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all());
db.close();
"
```

---

# 31. Acceptance test — Dataset Import hook

## 31.1. Trước test

Vào:

```text
http://10.10.2.45:8188/admin
```

Đăng nhập Admin.

Chọn tab:

```text
TVAN Catalog
```

Ghi lại:

```text
provider count
observed document count
last seen
```

## 31.2. Mở dataset JSON từ WebUI

Dùng chức năng mở dataset hiện tại.

Dataset sẽ đi qua:

```text
POST /api/datasets/import
```

Sau đó Admin:

```text
TVAN Catalog → Refresh
```

Kỳ vọng:

- provider mới xuất hiện nếu dataset có TVAN mới;
- counter tăng;
- nguồn `dataset_import` tăng;
- `lastSeenAt` cập nhật;
- không có raw invoice trong DB.

---

# 32. Acceptance test — GDT query hook

Đăng nhập GDT trên WebUI.

Chạy query thường.

Sau đó:

```text
/admin
→ TVAN Catalog
→ Refresh
```

Kỳ vọng:

```text
seen_gdt_query > 0
```

nếu response có TVAN metadata.

---

# 33. Acceptance test — GDT query-auto hook

Chạy Query Auto/Incremental Sync.

Sau khi hoàn tất:

```text
/admin
→ TVAN Catalog
→ Refresh
```

Kỳ vọng:

```text
seen_gdt_query_auto > 0
```

Do query-auto có hydration detail, số mapping/endpoint có thể nhiều hơn query thường.

---

# 34. Acceptance test — tìm kiếm và lọc

Kiểm tra:

```text
search theo providerCode
search theo tên provider
filter MST TVAN
filter supported / unsupported
filter source
filter host
sort last seen
pagination
```

Ví dụ API:

```bash
curl -fsS \
  -H "Authorization: Bearer $HDDT_ADMIN_TOKEN" \
  "http://127.0.0.1:8188/api/admin/tvan-catalog?q=softdreams&page=1&pageSize=50"
```

GET không yêu cầu CSRF nhưng vẫn yêu cầu Admin Token.

---

# 35. Acceptance test — persistence

Ghi nhận catalog.

Restart container:

```bash
docker restart hddt-public
```

Sau khi healthy:

```text
/admin → TVAN Catalog
```

Kỳ vọng:

- catalog vẫn còn;
- `firstSeenAt` không mất;
- database không reset;
- chỉ session GDT trong RAM bị mất theo kiến trúc hiện tại.

Đây là khác biệt chính so với phương án RAM-only.

---

# 36. Kiểm tra không lưu dữ liệu hóa đơn

Liệt kê metadata volume:

```bash
docker run --rm \
  -v hddt-public_hddt_metadata:/data:ro \
  alpine \
  find /data -maxdepth 3 -type f -printf '%p\n'
```

Cho phép:

```text
config.json
runtime.json
*.log
tvan-catalog.sqlite
tvan-catalog.sqlite-wal
tvan-catalog.sqlite-shm
```

Không được xuất hiện:

```text
*.xml
*.pdf
invoice dataset JSON
*.zip
```

Database cũng không được có các cột chứa:

```text
raw_summary
raw_detail
invoice_number
invoice_key
lookup_code
token
cookie
captcha_answer
```

---

# 37. Performance test

Test với dataset lớn.

Theo dõi:

```bash
docker stats hddt-public
```

Đặc biệt kiểm tra:

- thời gian import trước/sau patch;
- CPU;
- RAM;
- event-loop responsiveness;
- database size.

Quy tắc:

- scan document trong RAM;
- aggregate trước;
- một transaction cho mỗi request;
- không `INSERT` từng field của từng invoice nếu đã trùng trong cùng batch.

---

# 38. Database size và retention

TVAN Catalog chỉ giữ metadata aggregate nên kích thước dự kiến nhỏ hơn rất nhiều so với dataset.

Có thể bổ sung housekeeping sau:

```text
xóa ingest batch quá cũ
giữ provider/endpoint/mapping lâu dài
VACUUM theo lịch bảo trì
```

Không nên tự xóa provider chỉ vì lâu không thấy, vì catalog phục vụ phát triển.

---

# 39. Backup

Database nằm trong `hddt_metadata`, vì vậy backup volume hiện tại sẽ bao gồm TVAN Catalog.

Khuyến nghị stop app trước backup:

```bash
docker stop hddt-public
```

Backup:

```bash
docker run --rm \
  -v hddt-public_hddt_metadata:/src:ro \
  -v /opt/hddt_conn/backup:/backup \
  alpine \
  tar -czf /backup/hddt_metadata_$(date +%Y%m%d_%H%M%S).tgz -C /src .
```

Start:

```bash
docker start hddt-public
```

---

# 40. Rollback source/image

Vì version giữ nguyên, rollback dựa vào source backup hoặc image ID cũ.

## 40.1. Source

Khôi phục tar backup đã tạo trước khi patch.

Ví dụ:

```bash
cd /opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1
```

Đổi source hiện tại:

```bash
sudo mv HDDT-public-production HDDT-public-production_failed_patch
```

Restore backup:

```bash
sudo tar -xzf HDDT-public-production_before_tvan_catalog_<timestamp>.tgz
```

Build lại image cùng tag.

## 40.2. Database

Code cũ sẽ không dùng `tvan-catalog.sqlite`.

Có thể giữ file database để deploy lại sau.

Nếu muốn rollback hoàn toàn dữ liệu TVAN Catalog:

```bash
docker stop hddt-public
```

Sau đó rename database trong volume thay vì xóa ngay.

Không xóa toàn bộ `hddt_metadata`.

---

# 41. Migration database

Version ứng dụng vẫn:

```text
1.3.0-rc.1
```

Nhưng database phải có schema version riêng:

```text
TVAN_CATALOG_SCHEMA_VERSION = 1
```

Khi thay schema trong tương lai:

```text
app version: 1.3.0-rc.1
catalog schema: 2
```

vẫn có thể migration riêng.

Migration phải:

- chạy transaction;
- idempotent;
- backup trước thay đổi phá vỡ;
- không dựa vào app version.

---

# 42. Error handling

Các lỗi database nên có code nội bộ:

```text
TVAN_CATALOG_DB_OPEN_FAILED
TVAN_CATALOG_DB_MIGRATION_FAILED
TVAN_CATALOG_QUERY_FAILED
TVAN_CATALOG_WRITE_FAILED
```

Admin API có thể trả:

```text
500
```

nhưng message public không được chứa:

```text
SQL raw values
filesystem secret
invoice data
```

Log server chỉ chứa stack/error metadata đã redacted.

---

# 43. Logging

Có thể log:

```text
source_type
documents_scanned
providers_observed
duration_ms
database_write_ms
```

Không log:

```text
raw document
lookup code
invoice number
token
cookie
captcha
```

Ví dụ:

```text
tvan_catalog_observed
source=gdt_query_auto
documents=1240
providers=4
duration_ms=180
```

---

# 44. Unit test tối thiểu

`tests/unit/tvan-catalog.test.ts` nên test:

1. Normalize provider code.
2. Tìm MST TVAN từ dynamic/raw field.
3. Extract portal URL.
4. Sanitize lookup code.
5. Không trả raw invoice.
6. Deduplicate provider.
7. Deduplicate endpoint.
8. Deduplicate mapping.
9. Resolve alias.
10. Unknown provider.
11. Adapter supported.
12. Unsupported provider.

---

# 45. Integration test tối thiểu

`tests/integration/admin-tvan-catalog.test.ts`:

1. Admin API không token → `401`.
2. Sai token → `401`.
3. Dataset import → catalog được cập nhật.
4. GDT query → catalog được cập nhật.
5. Query-auto → catalog được cập nhật.
6. GET list filter provider.
7. GET filter tax code.
8. GET detail.
9. Restart/reopen service với cùng DB → data vẫn tồn tại.
10. Database không chứa invoice key/raw payload.
11. Admin response không chứa lookup code cụ thể.
12. DB lỗi không làm query hóa đơn thất bại nếu catalog ở chế độ best-effort.

---

# 46. Checklist trước khi Update Stack

```text
[ ] Backup source
[ ] Backup hddt_metadata
[ ] Upload đúng file mới bằng WinSCP
[ ] Overwrite đúng file sửa
[ ] VERSION vẫn 1.3.0-rc.1
[ ] package.json version vẫn 1.3.0-rc.1
[ ] APP_VERSION vẫn 1.3.0-rc.1
[ ] pnpm typecheck pass
[ ] unit test pass
[ ] integration test pass
[ ] docker build pass
[ ] ghi lại Image ID mới
[ ] Portainer không Re-pull local image
[ ] Update/Recreate stack
[ ] container healthy
[ ] /api/health = 200
[ ] /admin mở được
[ ] TVAN Catalog hiển thị
[ ] dataset import hook hoạt động
[ ] GDT query hook hoạt động
[ ] query-auto hook hoạt động
[ ] SQLite tồn tại trong /data/app
[ ] restart container vẫn giữ catalog
[ ] không có invoice file trong metadata volume
```

---

# 47. Danh sách file triển khai cuối cùng

## ADD

```text
src/server/services/tvan-catalog-db.service.ts
src/server/services/tvan-catalog.service.ts
src/shared/tvan-catalog/index.ts
tests/unit/tvan-catalog.test.ts
tests/integration/admin-tvan-catalog.test.ts
docs/tvan_design/design/TVAN_CATALOG_DATABASE_DESIGN_v1.3.0-rc.1.md
```

## MODIFY / REPLACE

```text
src/server/app.ts
src/server/routes/admin.routes.ts
src/server/routes/dataset.routes.ts
src/server/routes/invoice.routes.ts
src/shared/models/index.ts
src/web/pages/AdminPage.tsx
```

## DOCS NÊN CẬP NHẬT SAU IMPLEMENTATION

```text
docs/PUBLIC_DOCKER_DEPLOYMENT.md
docs/PUBLIC_DOCKER_DEPLOYMENT_VIE.md
docs/ADMIN_WEBUI_V1.3.0-RC.1.md
```

## KHÔNG ĐỔI VERSION

```text
VERSION
package.json -> version
src/server/app.ts -> APP_VERSION
```

## KHÔNG CẦN ĐỔI DEPENDENCY NẾU DÙNG `node:sqlite`

```text
package.json dependencies
pnpm-lock.yaml
Dockerfile
```

---

# 48. Kết luận

Phương án TVAN Catalog Database cho `1.3.0-rc.1` nên được triển khai theo nguyên tắc:

```text
Dataset import ─┐
                ├──> Extract TVAN metadata
GDT query ──────┤
                ├──> Aggregate
GDT query-auto ─┘
                       |
                       v
                 SQLite /data/app
                       |
                       v
              /api/admin/tvan-catalog
                       |
                       v
                  /admin
               TVAN Catalog
```

Database chỉ giữ **TVAN development metadata đã tổng hợp**, không biến Docker backend thành kho lưu dataset hóa đơn.

Về triển khai vận hành:

```text
Sửa source
   ↓
WinSCP ADD/OVERWRITE đúng file
   ↓
giữ version 1.3.0-rc.1
   ↓
docker build --no-cache cùng image tag
   ↓
Portainer Update Stack
   ↓
test /admin → TVAN Catalog
```

Đây là phương án phù hợp với kiến trúc Docker hiện tại, giữ được persistence qua restart, hỗ trợ tìm kiếm/lọc phục vụ phát triển adapter, đồng thời hạn chế tối đa việc lưu business data trên server.
