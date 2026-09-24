# HDDT v1.0.1 — Auto query and invoice view

## API
POST `/api/invoices/query-auto` uses the existing local CSRF header `X-HDDT-CSRF`, loopback/origin guards, and authenticated server-side GDT session. No credentials or portal token are returned.

Body: `{ "direction": "purchase", "fromDate": "2024-01-15", "toDate": "2024-03-10", "status": "*" }`.
Direction remains `purchase` or `sales`. Dates must be real canonical YYYY-MM-DD dates, ordered ascending. Existing optional query filters (documentType, status, partnerTaxCode, invoiceNo, series) remain available. Do not supply a cursor or page other than 1. Page size is fixed to 100 internally. No invented live sales endpoint: configure only a captured, verified endpoint.

Dates split into inclusive calendar months using UTC. Each month starts a fresh opaque cursor chain. A short page does not terminate pagination if a next cursor exists. Repeated cursors, empty pages with cursors and missing cursors before advertised total produce warnings. Full composite keys (direction, seller MST, template number, series, invoice number) deduplicate summaries.

Response: `documents`, `total`, `warnings`, `partial`, `sessionExpired`, `chunks`, `completedChunks`, `pages`, `hydrated`. Documents preserve the existing `InvoiceDocument.lines`, raw summary/detail, parties, tax summaries and dynamic fields. `InvoiceLine.itemCode` additionally maps portal `ma` / `mhhdvu`.

Query and detail errors return structured warnings with stage, code and affected chunk/key. Failed details retain summaries. A session expiry returns HTTP 401 with the collected `documents` and `sessionExpired: true`; the client preserves this partial payload. It is not a successful complete query.

Detail concurrency follows settings, capped at five. Transient AppError failures retry with exponential backoff and configured retry count. Non-transient and authentication errors do not retry. Existing connector per-request timeout applies. Safety caps are 10,000 pages per month and approximately 50,000 collected documents (a final page may cross the threshold). Warnings identify truncated work. This endpoint retains results in memory, not in a new database.

## User guide
Choose the date range and click **Tra cứu tự động**. The server gathers monthly pages and details. Loading text is indeterminate; final counts are real, not fabricated live progress. Review warning rows before treating results as complete.

The separate sticky local filter bar combines five filters: invoice type, series, seller MST, direction-aware partner name (300ms debounce), and multi-select invoice status. Options come from loaded data. Clear resets filters. Existing quick search remains available.

The main table has no pagination and uses Ant Design virtual scrolling. Expand a row to see eight inline line columns: STT, item code, item name, unit, quantity, unit price, amount, VAT amount. The full drawer remains available for tax rates, raw data and other fields.

Save/open JSON, Excel export and XML/ZIP download workflows remain. Excel exports the loaded dataset, not only the local filtered subset. Retrying detail batches is split into requests of at most 500.

Stop aborts the aggregate browser request. The server checks disconnect/abort between operations; already-issued GDT calls may finish up to their existing timeout. It is not guaranteed instantaneous cancellation of an upstream request. Manual legacy detail Stop suppresses UI updates, not upstream cancellation.

## Compatibility and limits
Version is **1.0.1** as requested, despite the design proposal's 1.1.0 label. Dataset schema remains v1. No deployment, live credentials, schema migration, Zustand or new runtime service is required. The design document's performance estimates and prechecked acceptance lists are not test evidence. Browser virtual-expansion behavior and live portal throughput require user acceptance testing; no FPS, memory or live response-time guarantee is claimed.
