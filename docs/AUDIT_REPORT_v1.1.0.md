# Audit mã nguồn HDDT v1.1.0

**Ngày audit:** 12/09/2026  
**Baseline:** HDDT v1.0.1 source + payload API live do người dùng cung cấp.  
**Phạm vi:** static review, contract review, syntax transpile, runtime self-check cho shared normalizer; full dependency test/build chưa chạy được trong môi trường audit vì không có `node_modules` và registry không truy cập được.

## 1. Kết luận

v1.1.0 đã chuyển kiến trúc từ single-source sang source-aware dual-source và sửa các mismatch quan trọng với payload GDT live. Không phát hiện lỗi cú pháp TypeScript/TSX sau patch. Các finding nghiêm trọng đã thấy qua review được sửa trước khi đóng gói source.

Trạng thái release nên được hiểu là **source candidate đã static-audit**, chưa phải binary production-certified cho tới khi `pnpm verify` và live acceptance test được chạy trên môi trường có dependencies/credential được ủy quyền.

## 2. Finding đã sửa

### A-01 — UI build regression từ v1.0.1

`InvoicePage.tsx` sử dụng `Modal` nhưng không import, đồng thời sử dụng `lastQueryLoadedCount` nhưng không khai báo state. Đã bổ sung import/state.

**Mức trước sửa:** Cao — có thể chặn frontend typecheck/build.

### A-02 — Dynamic fields không tương thích payload live

Parser cũ không đọc `ttruong/kdlieu`; lookup cũng không đọc `ttruong`. Payload standard/POS đều dùng cấu trúc này.

Đã sửa shared parser/lookup để ưu tiên `ttruong`, `kdlieu`, `dlieu`.

**Mức trước sửa:** Cao — mất metadata/lookup.

### A-03 — Normalizer thiếu live aliases

Đã sửa các nhóm:
- `thdon ?? tlhdon`;
- `nky/ntnhan/ncma/ncnhat`;
- bank/contact seller/buyer;
- `tentvandnkntt` provider fallback;
- `thtttoan` display value;
- `tsuat` text;
- POS line `mhhdvu`, `ttkhac`, `tthhdtrung`.

### A-04 — Cross-source identity collision

Key v1.0.1 không có source. v1.1.0 dùng:

```text
direction|source|sellerTaxCode|templateNo|series|invoiceNo
```

### A-05 — Query orchestration chưa source-aware

Đã đổi sang `month × source × status`; mỗi chain giữ cursor `state` riêng.

### A-06 — Detail/download có thể mất source

Connector/detail/download task/routes nay truyền `InvoiceSource` explicit. POS detail route vào `/api/sco-query/invoices/detail`; POS export route vào `/api/sco-query/invoices/export-xml`.

### A-07 — Legacy dataset key migration

Chỉ gán `invoiceSource=standard` nhưng giữ old key sẽ tạo identity không đồng nhất với v1.1.0. Đã migrate cả normalized/item key khi đọc legacy dataset.

### A-08 — Endpoint canonicalization

Validation prefix `/api/` trước URL normalization không đủ để chặn `/api/../outside`. Schema và connector nay canonicalize bằng `URL` rồi kiểm tra `pathname.startsWith('/api/')` + verified origin.

### A-09 — ZIP entry hardening/testability

ZIP extraction vẫn in-memory. Đã thêm exported guard để test traversal và chặn:
- empty/oversized name;
- NUL/CR/LF;
- backslash;
- absolute/drive path;
- path segment `.`/`..`.

Không dùng blanket `name.includes('..')`, tránh false-positive với tên hợp lệ `foo..bar`.

## 3. Security controls giữ nguyên/được củng cố

- GDT origin hard lock.
- Redirect manual.
- Loopback local server.
- CSRF + Origin protection.
- Pino redaction credential headers/fields.
- Token/cookie RAM-only.
- Captcha sanitization.
- Request timeout + response/download byte limits.
- Filter separator guard.
- ZIP magic/XML validation.
- Atomic download write + path confinement.

## 4. Residual risks

### R-01 POS export transport chưa live-verified đầy đủ

Path và POST method đã được cung cấp, nhưng response headers/body chưa có capture đầy đủ. Code chấp nhận ZIP hoặc invoice XML sau strict validation. Cần live acceptance trước rollout.

### R-02 POS status 5/6 chưa có payload đầy đủ

Code hỗ trợ independent statuses; cần capture để xác nhận field/nullability/response behavior.

### R-03 POS sales chưa xác minh

`posSalesPath` mặc định rỗng và connector fail-closed.

### R-04 Native packaging chưa chạy trong môi trường audit

SEA script bắt buộc đúng OS/arch. Windows/macOS binary phải được tạo và smoke-tested trên target runners.

### R-05 Full dependency typecheck/test/build chưa chạy tại đây

Môi trường audit không có `node_modules`; Corepack không truy cập được npm registry. Static transpile không thay thế Vitest/Vite/real TypeScript dependency-aware verification.

## 5. Audit checks đã chạy trong môi trường hiện tại

- TypeScript/TSX syntax transpile: **49 file TypeScript/TSX, 0 parse error** tại checkpoint; chạy lại ở release finalize.
- Global `tsc` dependency-less: lỗi chủ yếu `Cannot find module`, Node/React type absence; không dùng kết quả này làm pass của project typecheck.
- Shared normalizer runtime self-check: source-aware key, provider, lookup, multi-tax, POS itemCode và supplemental `tthhdtrung` đều map đúng trên fixture tổng hợp theo payload live.
- Grep contract: không còn call site dùng old signatures cho `getInvoiceDetail/downloadXml/downloadZip/normalizeInvoice/buildDocumentKey`.

## 6. Release gate bắt buộc trên CI/target

Trước khi phát hành binary nội bộ:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Sau đó smoke native artifact và live-test có kiểm soát.

## 7. Rating

| Hạng mục | Trạng thái |
|---|---|
| Kiến trúc dual-source | Đã triển khai source-level |
| Payload live compatibility | Đã sửa các field đã quan sát |
| Static syntax audit | Pass |
| Shared normalizer runtime check | Pass |
| Full unit/integration | Pending dependency-enabled environment |
| Production build | Pending dependency-enabled environment |
| Windows/macOS native smoke | Pending target OS |
| Live GDT acceptance | Pending authorized credential |

## 8. Evidence-driven runtime mapping check

Normalizer v1.1.0 đã được chạy trực tiếp trên 5 payload live được cung cấp (standard list 5/6, POS list 8, standard detail 6, POS detail 8). Không dùng OCR hay suy diễn schema cho check này. Các identity/source/status, dynamic fields, fallback `tlhdon`, provider POS, tax group, line item và supplemental line metadata đều map theo contract mục tiêu.

## Post-release audit correction (fix1)

Observed on Windows build kit:

1. `export.test.ts` expected seller MST in `H2`, but v1.1.0 inserted column `Nguồn` at column B. `H2` is now invoice number and seller MST is `I2`. This was a stale test assertion, not loss of leading zeros in Excel export. Test corrected and strengthened to resolve columns by semantic header, then assert both invoice number and seller MST text formatting.
2. `pnpm start` previously assumed `dist/` already existed. If `pnpm verify` failed before its build phase, `start` failed with `MODULE_NOT_FOUND`. Startup is now resilient: it builds automatically when `dist/server/index.js` or `dist/public` is missing.
