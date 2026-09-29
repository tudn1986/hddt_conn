# HDDT v1.2.1 r6 — MISA supervised presentation flow

App version remains **1.2.1**. `r6` is a source revision used to validate the MISA production contract before re-enabling fully automatic PDF viewing.

## Goal

Separate the MISA presentation flow into observable steps inside **Chi tiết hóa đơn → Tổng quan**:

1. Show the invoice lookup code / `TransactionID` already present in normalized GDT data.
2. Only after the user presses **Xem bản thể hiện hóa đơn**, the local backend calls:

   `POST https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID`

   body:

   `transactionID=<Mã tra cứu>`
3. Read `customData` from that response.
4. Construct, but do not fetch automatically, the confirmed production URL:

   `https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>`
5. Return the result to the frontend. The user explicitly clicks the full URL to open it in a new browser tab.

## UI supervision card

For `tvan_misa`, the Overview tab now shows a card named **Bản thể hiện hóa đơn · MISA (giám sát)** below the existing invoice descriptions.

The card exposes only non-secret diagnostic data:

- status;
- lookup code;
- metadata API and HTTP method;
- form request body;
- returned `customData`;
- full DownloadHandler URL;
- backend resolution timestamp;
- each backend stage (`lookup_code`, `metadata`, `custom_data`, `presentation_link`).

No CAPTCHA/session token is part of this response shape.

## Security

- Metadata network traffic remains backend-only.
- Metadata host is hard-coded/allow-listed by the MISA adapter.
- The browser receives only the constructed public MISA URL.
- The external URL opens only after an explicit user click (`target=_blank`, `noopener noreferrer`).
- This supervised endpoint does not proxy or download the PDF.

## Why this flow

It makes production validation deterministic:

- if `customData` is missing, the fault is the metadata contract;
- if `customData` is correct but the link fails in a new tab, the fault is the DownloadHandler contract/environment;
- only after both steps are confirmed should automatic in-app PDF retrieval be treated as accepted for MISA.
