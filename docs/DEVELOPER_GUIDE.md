# HDDT v1.2.1 — Hướng dẫn kỹ thuật

> Contract chính: `InvoiceSource = standard | pos`; query-auto = `month × source × status`; detail/export route theo namespace `/query` hoặc `/sco-query`. Xem `DATA_ARCHITECTURE_CURRENT.md` và `PROJECT_ARCHITECTURE_CURRENT.md`.


## Kiến trúc

```text
React WebUI (same-origin)
        │ Local API + CSRF
        ▼
Fastify @ 127.0.0.1
  ├─ SessionService ── GdtConnector (live/mock) ── HTTPS GDT
  ├─ DatasetService ── versioned JSON
  ├─ DownloadService ── XML/ZIP + manifest
  ├─ TvanPdfService ── TVAN adapters + PDF P1/P2/P3
  ├─ TvanBackportService ── raw JSON/XML evidence store
  └─ Excel/Profile exporters ── XLSX
```

Frontend không nhận token/cookie và không gọi GDT. `SessionService` giữ một connector cùng phiên trong RAM. Lưu trữ file-based, không database.

## Cấu trúc mã nguồn

```text
src/
├── server/
│   ├── app.ts                 Fastify factory, headers, CSRF, routes
│   ├── index.ts               launcher, one-instance, loopback port
│   ├── gdt/
│   │   ├── connector.ts       live/mock portal connector
│   │   └── zip.ts             ZIP defense + XML extraction
│   ├── routes/                local API boundary + Zod validation
│   ├── services/              settings/session/dataset/download
│   ├── tvan/                  provider adapters, captcha/token, PDF batch, backport
│   └── export/                report workbook + profile engine
├── shared/
│   ├── models/                domain contracts
│   ├── schemas/               runtime validation
│   ├── normalizer/            summary/detail mapping
│   ├── dynamic-fields/        unknown-field preservation
│   ├── lookup/                semantic lookup extraction
│   ├── filenames/             exact filename/business date
│   └── utils/                 atomic IO, hashing, path/security helpers
└── web/
    ├── api/client.ts          same-origin client + CSRF
    └── pages/                 login, invoice, queue, reports, settings
```

## Toolchain

- Node.js 22.12+
- pnpm 11
- TypeScript strict
- Fastify 5
- React 18 + Ant Design 5
- Zod 4
- Vitest 5
- Vite 8
- ExcelJS 4
- yauzl/yazl
- esbuild + Node SEA + postject cho portable

## Lệnh phát triển

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`scripts/dev.mjs` tạo WebUI ban đầu, chạy Vite build-watch và TSX server-watch. Có thể dùng `pnpm dev:web` riêng cho Vite dev server ở `5173`; proxy API mặc định tới `3210`.

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test
pnpm build
pnpm smoke
pnpm audit
pnpm verify
```

## Local API

| Method | Route | Ghi chú |
|---|---|---|
| GET | `/api/app/status` | Bootstrap CSRF, session, capability |
| POST | `/api/app/exit` | Từ chối khi queue active nếu không `force` |
| GET | `/api/auth/captcha` | Bắt đầu/reset challenge |
| POST | `/api/auth/login` | Rate limit, không trả token |
| POST | `/api/auth/logout` | Xóa token/cookie trong RAM |
| POST | `/api/invoices/query` | Cursor page + normalized summaries |
| POST | `/api/invoices/detail` | Một composite locator |
| POST | `/api/invoices/details` | Bounded concurrency + partial on expiry |
| POST | `/api/datasets/save` | Atomic versioned JSON |
| POST | `/api/datasets/open` | Chỉ path thật bên trong dataRoot |
| POST | `/api/datasets/import` | Upload JSON, dùng offline |
| GET | `/api/datasets` | Liệt kê dataset theo MST |
| POST | `/api/downloads/queue` | XML/ZIP, dedupe, exact filename |
| POST | `/api/downloads/start|pause|resume|retry` | Queue controls |
| GET | `/api/downloads/status` | Không lộ target path |
| GET | `/api/downloads/events` | SSE state |
| POST | `/api/exports/report` | XLSX 5 sheet |
| GET | `/api/exports/profiles` | Profile metadata |
| POST | `/api/exports/profile` | Mapping + type/required validation |
| GET/PUT | `/api/settings` | Strict partial config |
| POST | `/api/tvan/pdf/prepare-view` | Capability/CAPTCHA challenge cho xem PDF |
| POST | `/api/tvan/pdf/captcha` | Verify CAPTCHA; private state/token giữ backend |
| POST | `/api/tvan/pdf/view` | Trả representation PDF inline |
| POST | `/api/tvan/pdf/batch/start` | Batch PDF, ưu tiên P1 → P2 → P3 |
| POST | `/api/tvan/pdf/batch/:id/captcha` | Tiếp tục batch sau CAPTCHA |
| GET | `/api/tvan/pdf/batch/:id/archive` | ZIP PDF + manifest |
| POST/GET | `/api/tvan/backport/*` | Phân tích/lưu raw JSON/XML TVAN |

Mọi mutation cần `X-HDDT-CSRF` lấy từ status. Origin nếu có phải là `http://127.0.0.1`, `http://localhost` hoặc `http://[::1]`.

## TVAN representation PDF v1.2.1

TVAN là subsystem riêng, không đưa endpoint nhà cung cấp vào frontend. `TvanRegistry` chọn adapter theo `providerCode/ngcnhat`; adapter tự lấy MST người bán, mã tra cứu và raw/dynamic fields từ `InvoiceDocument`.

- P1 / `none`: tải không CAPTCHA (MISA).
- P2 / `session`: CAPTCHA một lần, token RAM dùng lại tới TTL (Viettel).
- P3 / `per_invoice`: credential một lần/hóa đơn; engine xóa token ngay sau attempt.

Mọi URL/redirect TVAN phải HTTPS và nằm trong allow-list adapter. Backport không fetch URL người dùng dán. Xem `docs/TVAN_PDF_v1.2.1.md` và `docs/TEST_REPORT_v1.2.1.md`.

## Connector GDT

`GdtConnector` là boundary duy nhất cho portal. Live connector:

- khóa origin đúng `https://hoadondientu.gdt.gov.vn`;
- redirect manual, timeout và response-size limit;
- giữ cookies của Captcha cho request login;
- giữ Bearer token/cookies private trong instance;
- query bằng date expression + `state` cursor;
- detail dùng `nbmst`, `khhdon`, `shdon`, `khmshdon` và header Action percent-encoded quan sát được;
- export-xml phải trả ZIP hợp lệ; XML được lấy từ `invoice.xml` theo quy tắc không mơ hồ.

Không thêm endpoint live bằng suy đoán. Khi capture endpoint bán ra, nhập path `/api/...` tại Settings rồi bổ sung fixture/contract test trước khi phát hành.

## Normalization và raw data

`normalizeInvoice(direction, summary, detail?)` merge detail lên summary nhưng không thay bằng `null/undefined`. Nó tạo locator/key, parties, line, tax, lookup và dynamic fields. Dataset tách raw khỏi normalized để tránh nhân đôi, sau đó rehydrate khi mở.

Khi thêm alias portal:

1. Thêm alias vào normalizer.
2. Đánh dấu static key trong dynamic extractor để tránh duplicate.
3. Giữ trường cũ trong raw.
4. Thêm fixture/test vendor tương ứng.

## Queue và file integrity

Queue validate toàn bộ batch trước khi mutate. Worker tôn trọng concurrency/delay/retry, không tính session expiry là một lần retry. File mới được ghi mode `0600` qua `.part`; hard-link/rename chỉ publish nội dung hoàn chỉnh. Overwrite giữ `.bak` để phục hồi nếu commit lỗi. Manifest được serialize qua một Promise chain và dùng SHA-256.

Không đổi quy tắc tên file hoặc tự thêm `(1)`/`(2)`.

## Export profile

Profile khai báo sheet, target column, source path, type, required và transform. Source có thể là normalized path (`seller.taxCode`) hoặc `dynamic:<section>:<name>`. Text luôn qua formula-injection escape.

Xem `AMIS_PROFILE.md` trước khi thay mapping nền bằng template chính thức.

## Quy trình release

1. `pnpm install --frozen-lockfile`.
2. `pnpm audit` phải không có advisory đã biết.
3. Chạy `pnpm verify` ít nhất ba lần sạch.
4. Secret scan; không đưa HAR, screenshot, token/cookie hoặc `.env` thật vào repo.
5. Package SEA trên từng OS/architecture đích.
6. Kiểm tra ZIP, `SHA256SUMS.txt`, launcher, WebUI và smoke flow trên máy sạch.
7. Ghi rõ phần live nào đã/không được test trong release notes.
