# HDDT v1.2.1 r4 — test report

## Scope

Hotfix route PDF MISA production. App version vẫn là **1.2.1**; `r4` chỉ là source revision.

## Contract đã khóa

- Metadata: `POST /tra-cuu/GetInvoiceDataByTransactionID`, form `transactionID=<TransactionID>`.
- `customData` trong metadata = `ext` của PDF handler.
- PDF: `GET /tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>`.
- Khi đã có `customData`, adapter không gọi `GetRequestTimeEnCode`.
- PDF chỉ hợp lệ nếu bắt đầu bằng `%PDF-`.

## Static verification

- TypeScript/TSX parser: chạy trên toàn bộ source; yêu cầu 0 diagnostics cú pháp.
- `.mjs`: `node --check` cho toàn bộ script.
- `tsc -p tsconfig.server.json`: môi trường đóng gói không có `node_modules`, nên full typecheck vẫn bị chặn bởi dependency typings; output được kiểm tra để bảo đảm không tái xuất hiện lỗi cục bộ trong `misa.ts`.

## Regression fixtures

`tests/unit/tvan.test.ts` có fixture production:

- `customData = 0K7QE2QR`
- `TransactionID = VLF4IVJPR_J7`
- assert route `/tra-cuu/tra-cuu/DownloadHandler.ashx`
- assert `Type=pdf`, `Viewer=1`, `ext=0K7QE2QR`, `Code=VLF4IVJPR_J7`
- assert không gọi `GetRequestTimeEnCode` khi có `customData`

Backward compatibility vẫn được test riêng khi metadata không có `customData`.

## Executable adapter harness

Đã transpile trực tiếp các module runtime liên quan (`shared/utils`, `tvan/extract`, `tvan/http`, `tvan/types`, `tvan/adapters/misa`) bằng TypeScript hệ thống và chạy `MisaTvanAdapter.downloadPdf()` với HTTP mock.

Kết quả PASS, đúng 2 request production:

```text
POST https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID
GET https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=0K7QE2QR&Code=VLF4IVJPR_J7
```

Không gọi `GetRequestTimeEnCode` khi response metadata có `customData`.
