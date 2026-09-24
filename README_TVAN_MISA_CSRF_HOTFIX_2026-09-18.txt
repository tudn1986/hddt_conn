HDDT v1.3.0-rc.1 - TVAN MISA / local CSRF hotfix

Observed symptom
----------------
POST /api/tvan/presentation-link/resolve returned:
  {"error":"CSRF_INVALID","message":"Thieu hoac sai ma bao ve phien cuc bo."}

Root cause
----------
The tvan_misa adapter itself was already present and unchanged. The failure happened
before the TVAN route/adapter ran. Portable Windows is served at http://127.0.0.1,
while the production server selected the Secure __Host-hddt_session cookie unless
HDDT_INSECURE_HTTP=1 was set. If that Secure cookie is not retained/sent on loopback
HTTP, a protected POST is attached to a new server-side session and its CSRF token
does not match the token held by the WebUI.

Files changed
-------------
1. Start-HDDT.cmd
   - sets HDDT_INSECURE_HTTP=1 and HDDT_BIND_HOST=127.0.0.1 for portable Windows.
2. HDDT-Tray.ps1
   - applies the same defaults when the tray script is started directly.
3. scripts/start.mjs
   - local loopback production start automatically selects the local HTTP cookie.
4. src/web/api/client.ts
   - if a protected request gets CSRF_INVALID, refreshes /api/app/status and retries
     the mutation once with the current session token. Also self-initializes CSRF if
     a mutation happens before the initial status call completes.

TVAN MISA inventory
-------------------
No adapter rewrite was required for this error. Existing flow remains:
  src/server/tvan/adapters/misa.ts
    POST https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID
    body: transactionID=<TransactionID>
    read customData
    build:
    https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx
      ?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>

The route is:
  POST /api/tvan/presentation-link/resolve

and remains protected by the local session CSRF check.
