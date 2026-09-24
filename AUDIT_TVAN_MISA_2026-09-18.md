# Audit TVAN MISA - HDDT v1.3.0-rc.1 - 2026-09-18

## Ket luan

Loi `CSRF_INVALID` tai `POST /api/tvan/presentation-link/resolve` xay ra truoc khi route TVAN va `MisaTvanAdapter` duoc thuc thi. Day khong phai loi cua request MISA.

Ban full truoc hotfix van giu nguyen cac file MISA so voi source v1.3.0-rc.1 goc:

- `src/server/tvan/adapters/misa.ts` - unchanged
- `src/server/tvan/pdf.service.ts` - unchanged
- `src/server/tvan/registry.ts` - unchanged
- `src/server/tvan/types.ts` - unchanged
- `src/server/routes/tvan.routes.ts` - unchanged
- `src/web/pages/InvoicePage.tsx` - unchanged
- `tests/unit/tvan.test.ts` - unchanged

Cac patch truoc do co thay doi `src/web/api/client.ts`, nhung chi sua false session-expired cho HTTP 401 login; chua co co che tu dong dong bo lai CSRF.

## Luong MISA hien tai da co san

`src/server/tvan/adapters/misa.ts`:

1. Lay `TransactionID` / lookup code tu document.
2. POST `https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID`
3. Body: `transactionID=<TransactionID>`
4. Lay `customData` 8 ky tu.
5. Dung URL:
   `https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>`

Route local:

`POST /api/tvan/presentation-link/resolve`

Route nay dung `request.sessionContext.tvanPdf.resolvePresentationLink(...)` va duoc bao ve boi `X-HDDT-CSRF`.

## Nguyen nhan CSRF tren Windows portable

Windows portable chay production bundle tren:

`http://127.0.0.1:<port>`

Trong khi backend production mac dinh dung cookie:

`__Host-hddt_session; Secure`

Neu browser khong giu/gui Secure cookie tren `http://127.0.0.1`, request POST tiep theo tao mot session server moi. Header `X-HDDT-CSRF` cua WebUI thuoc session cu, do do backend tra:

`CSRF_INVALID - Thieu hoac sai ma bao ve phien cuc bo.`

## Hotfix da ap dung

### `Start-HDDT.cmd`

Dat mac dinh cho Windows local:

- `HDDT_INSECURE_HTTP=1`
- `HDDT_BIND_HOST=127.0.0.1`

Ap dung cho ca portable executable va source/developer fallback.

### `HDDT-Tray.ps1`

Neu tray script duoc chay truc tiep, cung tu dat hai bien tren neu caller chua override.

### `scripts/start.mjs`

Khi chay production local bang `npm/pnpm start`, neu bind host la loopback va khong phai Docker, tu dat `HDDT_INSECURE_HTTP=1` neu chua co override.

### `src/web/api/client.ts`

Bo sung mot lan recovery cho CSRF:

- Neu mutation chua co token: GET `/api/app/status` de lay token hien tai.
- Neu POST/PUT/DELETE nhan `403 CSRF_INVALID`: GET `/api/app/status`, cap nhat token va retry dung 1 lan.
- Khong retry vo han.

## File MISA khong sua trong hotfix nay

Khong sua `misa.ts`, vi loi hien tai bi chan o local CSRF truoc khi adapter duoc goi.
