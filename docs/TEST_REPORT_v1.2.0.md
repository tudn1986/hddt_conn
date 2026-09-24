# HDDT v1.2.0 — Verification Report

**Ngày kiểm tra:** 2026-09-13  
**Phạm vi:** source release v1.2.0, subsystem TVAN representation PDF, batch P1/P2/P3 và TVAN Backport.

## 1. Evidence dùng để triển khai

- Source nền: HDDT/hddt-conn v1.1.0 production locked settings + tray.
- MISA: capture `GetInvoiceDataByTransactionID`, `GetEinvoiceByTransactionID`, `TransactionID`; hai mẫu cho thấy body `GetEinvoiceByTransactionID` có thể là raw TransactionID hoặc `code=<TransactionID>`.
- Viettel: capture xác nhận `captcha/verify` với challenge token + `offsetX`, token xác thực trả về, và `downloadPDF` dùng `supplierTaxCode + reservationCode + recaptcha`.
- Payload GDT: có `ngcnhat`/TVAN, `Mã số bí mật`, `TransactionID` trong các trường mở rộng; cùng dataset có nhiều TVAN như FPT, Viettel, MISA.

Không suy diễn endpoint cấp CAPTCHA Viettel là đã xác nhận: input chỉ có verify + download. Adapter chỉ probe một tập route cùng origin và trả lỗi/backport nếu không khớp.

## 2. Verification đã chạy

### 2.1 TypeScript/TSX syntax transpilation — PASS

Dùng TypeScript hệ thống để `transpileModule` toàn bộ `src/` và `tests/`:

- 78 file `.ts/.tsx`
- 0 syntax error

### 2.2 Script syntax — PASS

`node --check scripts/*.mjs`: tất cả script `.mjs` hợp lệ cú pháp.

### 2.3 TVAN core runtime harness — PASS

Do workspace không có `node_modules`, một harness độc lập đã transpile các module TVAN bằng TypeScript hệ thống rồi thực thi bằng Node với HTTP mock. Các gate pass:

1. `misa_public_pdf`: metadata MISA + fallback public `GetRequestTimeEnCode` / `downloadhandler.ashx`, chỉ nhận `%PDF-`.
2. `viettel_token_pdf`: challenge private state không lộ frontend, verify token, request PDF đúng `supplierTaxCode/reservationCode/recaptcha`.
3. `redirect_allowlist`: redirect TVAN sang host ngoài allow-list bị chặn với `TVAN_URL_REJECTED`.
4. `backport_analysis`: nhận đúng `Mã tra cứu` có dấu, `TransactionID`, URL và MST ứng viên.
5. `batch_p1_p2_p3`: thứ tự thực tế P1 → P2 → P3; P2 chỉ một CAPTCHA cho hai hóa đơn; P3 yêu cầu CAPTCHA riêng từng hóa đơn; archive state hoàn tất.

Runtime verification đã phát hiện và dẫn tới sửa hai lỗi trước khi release:

- P3 có thể lặp CAPTCHA vô hạn nếu trạng thái token không được xét đúng sau verify.
- Backport regex ban đầu bỏ sót field tiếng Việt có dấu `Mã tra cứu`.

### 2.4 Lookup extraction trên payload GDT thực tế — PASS

Chạy trực tiếp `extractLookup()` trên `tthai-1-ttxly-5-buy.txt` đã cung cấp:

- `tvan_viettel`: 3/3 mẫu trích được `Mã số bí mật`.
- `tvan_misa`: 10/10 mẫu trích được `TransactionID`.
- `tvan_fpt` và `tvan_invoice`: chưa có lookup code trong payload mẫu này, đúng mục tiêu chuyển qua Backport thay vì tự suy diễn.

## 3. Test source đã bổ sung

`tests/unit/tvan.test.ts` bao phủ:

- registry/capability MISA P1, Viettel P2, TVAN chưa hỗ trợ P3;
- MISA PDF fallback;
- Viettel challenge → token → PDF;
- redirect allow-list/SSRF guard;
- Backport analyzer;
- batch P1/P2/P3 và vòng đời token.

`tests/unit/normalizer.test.ts` bổ sung regression cho `TransactionID` trong lookup extraction.

## 4. Gate chưa chạy được trong môi trường đóng gói

### `pnpm verify` / Vitest / Vite production build — BLOCKED BY ENVIRONMENT

Workspace được cung cấp không có `node_modules`. Môi trường đóng gói không truy cập được npm registry/cache cần thiết, vì vậy không thể chạy dependency-enabled:

- `pnpm lint`
- `vitest run`
- `vite build`
- `smoke` trên build hoàn chỉnh

Không đánh dấu các gate này là pass giả. Khi chạy trên máy build có dependency, bắt buộc chạy:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

## 5. Live acceptance còn bắt buộc

- **Viettel:** verify/download endpoint đã có capture; endpoint **cấp challenge CAPTCHA** chưa có capture. Cần DevTools capture hoặc Backport payload hiện tại nếu các probe không khớp production.
- **MISA:** implementation bám payload đã cung cấp và flow public MISA; vẫn cần live acceptance với một số TransactionID hiện hành để xác nhận production response hiện tại.
- TVAN mới (FPT/BKAV/khác): v1.2.0 có Backport + adapter framework nhưng không tự bật download cho provider chưa có evidence.

## 6. Kết luận release

Source v1.2.0 đủ điều kiện **source release candidate** cho dependency-enabled CI/UAT. Không gọi là binary production-certified cho tới khi `pnpm verify` pass trên môi trường đầy đủ dependency và live acceptance TVAN ở mục 5 hoàn tất.
