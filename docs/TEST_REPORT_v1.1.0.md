# HDDT v1.1.0 — Verification Report

**Ngày:** 12/09/2026

## 1. Môi trường kiểm chứng hiện tại

- Host build/audit: Linux x64.
- Node: 22.16.0.
- Global TypeScript: 5.8.3.
- Project `node_modules`: không có.
- `pnpm`: không cài local/global; Corepack cố tải từ registry nhưng DNS/network thất bại (`EAI_AGAIN`).

Do đó không tuyên bố đã chạy `pnpm test`, `pnpm build` hoặc native SEA package trong môi trường này.

## 2. Check đã thực hiện

### Syntax transpile

Tất cả file `.ts/.tsx` trong `src` và `tests` được parse/transpile bằng TypeScript global. Checkpoint trước finalize: 49 file TypeScript/TSX, 0 parse error.

### Static contract review

Đã rà call sites sau khi đổi interface:
- `normalizeInvoice(direction, source, summary, detail?)`;
- `getInvoiceDetail(source, locator)`;
- `downloadXml(source, locator)`;
- `downloadZip(source, locator)`;
- `buildDocumentKey(direction, source, locator)`.

Không còn call site source-level dùng signature cũ tại checkpoint.

### Shared normalizer runtime self-check

Fixture POS tổng hợp theo payload detail thực tế đã xác nhận:
- key `purchase|pos|...`;
- provider `tentvandnkntt`;
- lookup dynamic `Hilo-SearchKey`;
- tax summaries `8%` và `KCT`;
- line `mhhdvu`;
- `tthhdtrung` → `supplementalInfo`.

### Security regression review

- Endpoint canonicalization hardening.
- ZIP entry name guard.
- source-aware download key/task.
- dataset legacy key migration.

## 3. Tests được cập nhật trong source

- connector standard/POS routes + POS POST export;
- query-auto 2 sources × 3 statuses;
- normalizer live aliases;
- dynamic lookup `ttruong/kdlieu/dlieu`;
- source-aware filename/key;
- settings defaults/migration;
- ZIP traversal/control names;
- endpoint path canonicalization;
- detail/download interface stubs.

## 4. Verification còn phải chạy

Trên máy/CI có dependency:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`verify` gồm typecheck, tests, production build và HTTP mock smoke.

Trên Windows/macOS target cần chạy thêm portable package command rồi smoke executable.

## 5. Live verification còn cần

- POS list `ttxly=5/6`.
- POS pagination page 2 với `state`.
- POS export response headers/body.
- session-expired/error contracts.
- POS sales nếu đưa vào scope tương lai.

## 6. Kết luận

Source v1.1.0 đủ điều kiện **candidate for dependency-enabled CI verification**. Không gọi là native production release đã certified cho tới khi các gate ở trên pass.

## 7. Runtime check trực tiếp trên payload đính kèm

Sau khi transpile shared layer bằng TypeScript global, normalizer được chạy trực tiếp trên các file payload cung cấp:

- `standart_5.txt`: đọc `total=115`, có `state`, source `standard`, status 5, dynamic names như `PortalLink`, `Fkey`, `ProcessNote`, `GChu` không rơi về `unknown`.
- `standart_6.txt`: đọc `total=19`, có `state`, source `standard`, status 6; `thdon=null` vẫn lấy đúng `tlhdon`.
- `sco_8.txt`: đọc `total=26`, có `state`, source `pos`, status 8; provider và dynamic fields được giữ.
- `standart_6_detail.txt`: tạo key `purchase|standard|0304043037|1|K26THC|224346`, 1 line, fallback đúng loại hóa đơn.
- `sco_8_detail.txt`: tạo key `purchase|pos|0110269067|1|C26MHA|64929330`, provider `tvan_hilo`, 3 line, item codes `TRANSPORTATION_FEE/DISCOUNT/PLATFORM_FEE`, tax groups `8%/KCT`, QR và supplemental `BKSPTVChuyen`.

Các check này pass trong môi trường audit.

## Windows feedback correction (fix1)

A real Windows verification run reported 1 failed / 73 passed / 2 skipped because the Excel regression test still used pre-v1.1.0 column indexes. The test has been corrected:

The report layout places invoice number at H and seller tax code at I in v1.1.0, but the regression test now resolves these cells by header name (`Số hóa đơn`, `MST người bán`, `Tên người bán`) rather than hard-coded column letters. It asserts text format `@`, leading-zero preservation, and formula escaping.

The same run then attempted `pnpm start` after `verify` had stopped before the build phase. `start` is now implemented by `scripts/start.mjs` and builds missing `dist/` automatically.

A full dependency-backed test rerun is still required on Windows/macOS because this Linux audit environment does not contain `node_modules` and cannot access the npm registry.
