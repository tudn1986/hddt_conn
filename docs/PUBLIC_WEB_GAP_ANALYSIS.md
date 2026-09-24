# PUBLIC_WEB_GAP_ANALYSIS — HDDT public web gap inventory

**Scope:** static review of the current workspace source under `src/server/**`, selected `src/web/**`, and the available design file `docs/source/HDDT_v1.0.0_SPEC.md`. No application source was edited. Important limitation: the only design document available to this subagent is the original **local WebUI** spec; any separate public-web design copied in the parent transcript was not visible here. Therefore this report is an evidence-based public-web gap analysis against the current source, not a conformance statement to an unseen design.

**Mechanical endpoint count:** 45 Fastify route declarations were found across `src/server/app.ts` and `src/server/routes/*.ts`.

## Executive conclusion

The codebase has already moved part-way from local-singleton state toward browser-session state: `SessionRegistry` creates a per-cookie `SessionContext`, per-session CSRF token, per-session `SessionService`/GDT connector, and per-session login failure counters. That is a significant improvement over a single process-wide GDT login.

However the application is still **not public-web complete**. Remaining blockers are concentrated in:

- local-only process/OS controls (`/api/app/exit`, folder openers);
- global config/settings/account files exposed over HTTP;
- server-side business data persistence (`dataRoot` datasets/XML/ZIP manifests, TVAN PDF batches, raw backport samples);
- global `DownloadService` and global `TvanPdfService` state still decorated on the app;
- routes that use opaque IDs, paths or MST values without durable tenant ownership checks;
- public-web auth being a browser session cookie/CSRF layer, but not yet an account/tenant/RBAC model.

## Current security middleware and binding evidence

- `src/server/app.ts` creates Fastify with `bodyLimit = min(maxDatasetBytes + 1MB, 256MB)` and `requestTimeout = 120s`.
- `onRequest` creates/resolves `__Host-hddt_session`, attaches `request.sessionContext`, sets no-store/no-cache and security headers, and emits CSP only in production.
- `SessionRegistry` stores per-session `csrfToken`, `loginFailures`, `AbortController`, and `SessionService` in memory. It has idle/absolute expiry, max-session eviction and an in-memory audit ring.
- `preHandler` rejects disallowed `Origin` and checks `x-hddt-csrf` for all non-GET/HEAD/OPTIONS API calls using the current session CSRF token.
- `index.ts` binds to `HDDT_BIND_HOST` or `127.0.0.1` by default. A public deployment can bind more widely, so route-level public safety still matters.
- No proxy/IP trust model, app-user account model, RBAC or tenant database was found. The cookie/CSRF session identifies a browser session, not a durable customer/account tenant.

## Endpoint inventory: endpoint -> mutable state -> effects -> public status

| Endpoint | Handler | Mutable state / ownership | Filesystem effect | Network effect | Public-web status |
|---|---|---|---|---|---|
| `GET /api/app/status` | `app.ts` | Reads `request.sessionContext`; returns per-session CSRF and session info | none | none | **Mostly OK for same-site app**, but CSRF token exposure must remain same-origin only; not a substitute for tenant auth. |
| `POST /api/app/exit` | `app.ts` | Destroys current session then exits process | process termination | none | **Block** in public web: remote process DoS/local-only. |
| `POST /api/auth/session` | `auth.routes.ts` | Mutates current session's GDT captcha state | none | GDT captcha | **Conditionally OK** after app auth/rate limits; currently pre-login session cookie only. |
| `GET /api/auth/captcha` | `auth.routes.ts` | Same as above | none | GDT captcha | **Conditionally OK**. |
| `POST /api/auth/login` | `auth.routes.ts` | Per-session loginFailures; per-session GDT token/cookies; rotates session cookie/CSRF | none | GDT login | **Improved**, but still lacks tenant/user account layer and global brute-force/IP limits. |
| `POST /api/auth/logout` | `auth.routes.ts` | Destroys current session only | none | GDT logout/clear | **OK** if session cookie is protected. |
| `POST /api/auth/heartbeat` | `auth.routes.ts` | Reads current session expiry | none | none | **OK**, but unauthenticated sessions can keep themselves active within TTL. |
| `POST /api/invoices/query-auto` | `invoice.routes.ts` | Uses current session connector; per-request service | none | GDT list/detail | **Conditionally OK** after app auth/quotas; business data returned to browser. |
| `POST /api/invoices/query` | `invoice.routes.ts` | Current session connector | none | GDT list | **Conditionally OK**. |
| `POST /api/invoices/detail` | `invoice.routes.ts` | Current session connector | none | GDT detail | **Conditionally OK**. |
| `POST /api/invoices/details` | `invoice.routes.ts` | Current session connector; request-local concurrency | none | multiple GDT detail | **Conditionally OK** with quotas/rate limits. |
| `POST /api/datasets/save` | `dataset.routes.ts` | Body `accountTaxCode`; only compares to session username if logged in | Writes full business dataset JSON under `<dataRoot>/<MST>/HDDT_*.json` | none | **Block/redesign**: server-side business-data write; MST/body is not tenant authorization. |
| `POST /api/datasets/open` | `dataset.routes.ts` | Client supplies server `filePath` | Reads server file under dataRoot | none | **Block/redesign**: path-based server business-data read; use opaque IDs with owner ACL or client-side files. |
| `POST /api/datasets/import` | `dataset.routes.ts` | In-memory validation only | none | none | **Conditionally OK** with body/auth limits. |
| `GET /api/datasets` | `dataset.routes.ts` | Query `accountTaxCode` controls directory | Lists files under `<dataRoot>/<MST>` and returns paths | none | **Block/redesign**: cross-tenant listing/IDOR risk; bind MST to tenant and hide paths. |
| `POST /api/downloads/queue` | `download.routes.ts` | Requires current session auth, but mutates global `app.downloads` | none immediately | none | **Broken/redesign**: global queue is not session scoped; app-level connector getter currently throws in this branch. |
| `POST /api/downloads/start` | `download.routes.ts` | Starts global `app.downloads` | Writes XML/ZIP/manifest if connector worked | GDT XML/ZIP | **Block/redesign**: shared queue/server persistence; likely broken due singleton placeholder. |
| `POST /api/downloads/pause` | `download.routes.ts` | Mutates global pause state; no auth check in route | none immediate | none | **Block**: unauthenticated/global control. |
| `POST /api/downloads/resume` | `download.routes.ts` | Requires session auth, resumes global queue | may write files | GDT downloads | **Block/redesign**. |
| `POST /api/downloads/retry` | `download.routes.ts` | Mutates global tasks; no auth check in route | none immediate | none | **Block**. |
| `GET /api/downloads/status` | `download.routes.ts` | Reads global queue | leaks shared task metadata | none | **Block/redesign**: per-session/tenant queue required. |
| `POST /api/downloads/clear-completed` | `download.routes.ts` | Mutates global queue; no auth check in route | none immediate | none | **Block**. |
| `POST /api/downloads/open-folder` | `download.routes.ts` | Uses current session username | Ensures dir; spawns OS file manager | OS command | **Block** in public web. |
| `GET /api/downloads/events` | `download.routes.ts` | Registers listener on global queue | none | SSE | **Block/redesign**: per-user stream, auth, listener limits. |
| `POST /api/exports/report` | `export.routes.ts` | In-memory documents from body | Streams XLSX response | none | **Conditionally OK** with auth/body quotas; no persistent write. |
| `GET /api/exports/profiles` | `export.routes.ts` | Immutable profile map | none | none | **Safe**. |
| `POST /api/exports/profile` | `export.routes.ts` | In-memory documents/profile | Streams XLSX response | none | **Conditionally OK** with auth/body quotas. |
| `GET /api/settings` | `settings.routes.ts` | Reads global config | exposes config | none | **Block/admin-only**. |
| `PUT /api/settings` | `settings.routes.ts` | Mutates global config; changes current session connector mode/options if fingerprint changes | Writes `config.json`; ensure dataRoot | none immediate | **Block/admin-only**: global config mutation. |
| `POST /api/settings/open-data-root` | `settings.routes.ts` | Reads global config | Ensures dir; spawns OS file manager | OS command | **Block**. |
| `GET /api/accounts` | `settings.routes.ts` | Reads global accounts file | none | none | **Block/redesign**: local remembered usernames are private data. |
| `POST /api/tvan/capabilities` | `tvan.routes.ts` | Uses global `app.tvanPdf` registry only | none | none | **Conditionally OK** with auth/body limits. |
| `POST /api/tvan/pdf/prepare-view` | `tvan.routes.ts` | May create global TVAN challenge/token state | none | TVAN captcha | **Redesign**: TVAN state must be session/tenant scoped. |
| `POST /api/tvan/presentation-link/resolve` | `tvan.routes.ts` | Reads global TVAN context/token | none | TVAN provider | **Redesign** with session-scoped context and quotas. |
| `POST /api/tvan/supervised/prepare` | `tvan.routes.ts` | Creates global challenge/probe state | none | TVAN provider | **Redesign**. |
| `POST /api/tvan/supervised/download-plan` | `tvan.routes.ts` | Reads global context | none | usually none | **Conditionally OK** after session scoping. |
| `POST /api/tvan/pdf/captcha` | `tvan.routes.ts` | Consumes global challenge; sets global token | none | TVAN verify | **Redesign**: challenge ID alone is not ownership. |
| `POST /api/tvan/pdf/view` | `tvan.routes.ts` | Uses/clears global TVAN provider token | streams PDF | TVAN download | **Redesign**: token/challenge race and cross-session leak. |
| `POST /api/tvan/pdf/batch/start` | `tvan.routes.ts` | Creates global batch by ID | Writes PDF files/ZIP under appData | TVAN downloads | **Block/redesign**: server-side business-data artifacts and IDOR risk. |
| `GET /api/tvan/pdf/batch/:id` | `tvan.routes.ts` | Reads global batch by opaque ID only | none | none | **Redesign**: unpredictable ID is not authorization. |
| `POST /api/tvan/pdf/batch/:id/captcha` | `tvan.routes.ts` | Mutates global batch/challenge/token | may continue file writes | TVAN verify/download | **Redesign**. |
| `GET /api/tvan/pdf/batch/:id/archive` | `tvan.routes.ts` | Reads global batch by ID | Reads ZIP archive | none | **Redesign**: owner ACL and retention required. |
| `POST /api/tvan/backport/analyze` | `tvan.routes.ts` | In-memory analysis | none | none | **Admin-only/conditional**; payloads can contain sensitive samples. |
| `POST /api/tvan/backport/samples` | `tvan.routes.ts` | none | Writes raw JSON/XML sample under appData | none | **Block/admin-only**. |
| `GET /api/tvan/backport/samples` | `tvan.routes.ts` | none | Reads sample metadata from appData | none | **Block/admin-only**. |

## Singleton and cross-session leakage inventory

### Improved/session-scoped state

- `src/server/services/session-registry.service.ts`: `contexts` map holds per-cookie session state. This scopes `SessionService`, GDT connector, CSRF and login failures by session. It is still in-memory only and not a durable tenant identity model.
- `src/server/services/session.service.ts` and `src/server/gdt/connector.ts`: still mutable, but now instantiated per `SessionContext` by `SessionRegistry.create()`, so GDT cookies/token/captcha are no longer process-wide for invoice routes.
- `src/server/routes/auth.routes.ts`: login failure counter moved from route-global array to `context.loginFailures`.

### Remaining unsafe or public-incomplete singletons

- `src/server/app.ts`: still decorates global `settings`, `dataset`, `downloads`, `tvanPdf`, `tvanBackport`; also still exposes local lifecycle route.
- `src/server/services/download.service.ts`: `tasks`, `running`, `paused`, `listeners`, `manifestWrite` remain process-global. This should be moved into `SessionContext` or a tenant job store.
- `src/server/tvan/pdf.service.ts`: `tokens`, `challenges`, `batches` maps remain process-global. CAPTCHA challenge IDs and batch IDs are bearer capabilities unless bound to session/tenant.
- `src/server/services/settings.service.ts`: `config` and `accounts` remain global mutable memory mirrored to JSON files.
- `src/server/tvan/backport.service.ts`: global appData sample repository.

### Mostly safe immutable singletons

- `src/server/export/profile-engine.ts` static `PROFILES` map.
- TVAN adapter constants/registry metadata, subject to outbound-network allowlist testing.

## Filesystem and data-write inventory

### Persistent business-data writes

1. `DatasetService.save()` writes normalized/raw invoice datasets to `<dataRoot>/<MST>/HDDT_*.json`.
2. `DownloadService.writeFileAtomically()` and `appendManifest()` write XML/ZIP and `download-manifest.json` under `<dataRoot>/<MST>`.
3. `TvanPdfService.startBatch/runBatch/buildArchive()` writes PDFs and ZIP archives under `<appData>/tvan-pdf-batches`.
4. `TvanBackportService.save()` writes raw JSON/XML backport samples under `<appData>/tvan-backport`.

### Runtime/config/log writes

- `SettingsService.saveConfig/loadConfig/rememberUsername/forgetLastUsername/writeRuntime/removeRuntime/cleanupLogs` writes config, accounts, runtime metadata and logs.
- `index.ts` writes/removes process lock and runtime metadata.

### Safer ephemeral/in-memory generation

- `export.routes.ts` creates XLSX buffers and streams responses without persistent files.

Public-web recommendation: avoid persistent server storage for invoice/customer artifacts unless the product explicitly adds tenant ACLs, encryption, retention, deletion, audit and backup policy. Streaming responses or encrypted session-scoped temporary storage with cleanup are more realistic than an absolute ban on all filesystem writes.

## Outbound network inventory and threats

- GDT outbound traffic in `LiveGdtConnector` is constrained to `https://hoadondientu.gdt.gov.vn` and configured paths must remain under `/api/`. This is good SSRF containment.
- TVAN outbound traffic is provider-specific (MISA, Viettel, Softdreams/EasyInvoice, Minvoice). `tvan/http.ts` performs URL allowlist and redirect checks; adapters still need tests for redirects, DNS/private-address SSRF assumptions, cookie forwarding, response size and timeout behavior.
- OS process spawning appears in folder-opening routes and must be removed from public mode.

## File change recommendations

### Must change / redesign before public web

- `src/server/app.ts`
  - Add `DeploymentMode = local | public` and fail closed for local-only routes.
  - Keep `SessionRegistry`, but add real app-user/tenant authentication and authorization.
  - Remove `/api/app/exit` in public mode.
  - Move mutable user-bearing services (`downloads`, `tvanPdf`) out of app-global decorations or wrap them with owner-aware stores.

- `src/server/services/session-registry.service.ts`
  - Add persistent account/tenant binding or integrate with external auth.
  - Consider IP/user-agent binding policy, secure cookie settings behind reverse proxies, and audit export/admin visibility.

- `src/server/routes/auth.routes.ts`
  - Add global/IP/account rate limiting in addition to per-session failures.
  - Require HTTPS/Secure cookies in public mode; document proxy headers and `HDDT_INSECURE_HTTP` handling.

- `src/server/routes/invoice.routes.ts` and `src/server/services/invoice-query.service.ts`
  - Add tenant quotas, concurrency limits, audit events and cancellation cleanup.

- `src/server/routes/download.routes.ts` and `src/server/services/download.service.ts`
  - Make queue per session/tenant or replace with a tenant job store.
  - Remove `open-folder` route.
  - Require auth for pause/retry/clear/status/events and enforce owner checks.
  - Rework filesystem output into browser downloads or owner-scoped temporary/object storage.

- `src/server/routes/dataset.routes.ts` and `src/server/services/dataset.service.ts`
  - Remove client-supplied server paths.
  - Bind all dataset operations to authenticated tenant; return opaque dataset IDs if server storage remains.
  - Prefer client-side import/export for public web.

- `src/server/routes/settings.routes.ts` and `src/server/services/settings.service.ts`
  - Move settings/accounts to admin-only or environment/deployment config.
  - Remove `open-data-root` in public mode.

- `src/server/routes/tvan.routes.ts` and `src/server/tvan/pdf.service.ts`
  - Scope `tokens/challenges/batches` by session/tenant.
  - Add owner ACL checks for every batch/challenge/archive endpoint.
  - Replace batch filesystem storage with owner-scoped temporary/object storage and retention.

- `src/server/tvan/backport.service.ts`
  - Admin/developer-only; redact raw samples or remove from public build.

- `src/web/api/client.ts` and UI pages
  - Support app-user authentication/tenant state, not only auto-created browser sessions.
  - Stop using/displaying server local paths as durable references.

- `deploy/**`, `compose.yml`, `Dockerfile`, launch scripts
  - Provide a public deployment profile: TLS/reverse-proxy assumptions, trusted origins, secure cookies, disabled local routes, body/rate limits and log redaction.

### Tests to add/change

- Route enumeration/public-mode denylist test for `/api/app/exit`, folder openers, settings/account routes and backport samples.
- Concurrent two-user tests for login/query/logout proving GDT session isolation remains intact.
- Download queue two-user tests proving no pause/retry/status/event leakage after redesign.
- TVAN challenge/batch IDOR tests proving challenge IDs, batch IDs and archive URLs cannot cross sessions.
- Dataset IDOR/path traversal/symlink tests proving no cross-tenant file read/write/listing.
- SSRF/redirect/cookie-forwarding tests for all TVAN adapters and GDT configurable paths.
- Quota/rate-limit tests for captcha/login/query/detail/export/TVAN flows.

## Suggested migration direction

1. Keep `SessionRegistry` as the browser-session foundation, but bind it to a real authenticated tenant/account model.
2. Add `public` deployment mode that disables local lifecycle, folder and global-settings routes by construction.
3. Move `DownloadService` and `TvanPdfService` state into session/tenant scope or a proper owner-aware job store.
4. Replace server path APIs with opaque IDs and owner authorization.
5. Decide product policy for server persistence of invoice data. If no persistence, stream artifacts to the browser. If persistence, implement tenant storage, retention, deletion, encryption and audit first.

## Bottom line

The current source is closer to public readiness than the original local-only design because GDT sessions and CSRF are now per browser session. But it is still not safe to expose as a public multi-user web service until local-only routes are disabled, downloads/TVAN/datasets/settings are tenant-scoped, server-side business-data writes are redesigned, and ownership tests prevent IDOR/cross-session leakage.
