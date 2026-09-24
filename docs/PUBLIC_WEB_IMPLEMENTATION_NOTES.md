# Public Web Implementation Inventory

## Current critical gaps

| Area | Current state | Production requirement |
|---|---|---|
| App session | One process-wide `SessionService` decorated as `app.session` | Resolve a unique `SessionContext` from a secure browser cookie on every request |
| CSRF | One process-wide random token returned by `/api/app/status` | Per-session token, constant-time validation, rotate with session ID |
| Login throttling | One global in-memory failure array | Per-IP + per-session bounded limiter |
| GDT connector | One connector/cookie jar/token/challenge for all users | One connector per session; destroy on logout/revoke/expiry |
| Download queue | One global queue and listeners; writes XML/ZIP/manifest under server dataRoot | Per-session queue; return bytes to browser, never persist business files on server |
| Dataset | Server writes/reads/lists JSON paths | Browser builds, validates and writes local files; server validation may be transient only |
| TVAN | One global token/challenge/batch registry; batch PDF and ZIP written to app data | One TVAN service per session; in-memory batch archive with strict quota/TTL or direct streaming |
| Settings | Global mutable server config and server folder opener | Production API read-only public capabilities; Settings UI only selects local browser directory |
| Accounts | Last username persisted globally | Browser-local preference only; never shared between users |
| Admin/audit | None | Separate admin bearer secret; metadata-only session list/revoke and bounded redacted audit events |
| Docker | Non-root only; writable root and host volumes for business files; published backend port | Read-only root, tmpfs, cap-drop, no-new-privileges, internal network, HTTPS reverse proxy |

## Endpoint/state mapping

- `/api/app/status`: currently reads global auth/session and leaks server dataRoot/port; must establish/resolve browser session and return only public metadata + per-session CSRF.
- `/api/auth/*`: global connector and global login limiter; must use request context, rotate/reissue cookie after successful login, and isolate failures.
- `/api/invoices/*`: all authenticated requests must consume request context connector; large response bodies remain transient.
- `/api/datasets/save|open|list`: incompatible with public design and removed/disabled in production. `/import` may validate transiently, but client-side validation is preferred for local workflow.
- `/api/downloads/*`: current global queue and server filesystem writes are incompatible. Replacement API downloads one validated invoice artefact per request and streams it; batching/saving is client-side.
- `/api/tvan/*`: current global maps and filesystem batch archive are incompatible. Service must be owned by session context; archive is kept in RAM with quotas and short TTL, then consumed/deleted.
- `/api/settings`: production must not accept mutable server configuration. Local storage directory is a browser handle and cannot be represented by a server path.
- `/api/admin/sessions*`: new, authenticated independently, metadata only, supports list and revoke.

## Mutable state owners after migration

- Process-wide: immutable runtime config, `SessionRegistry`, bounded metadata audit log, static TVAN adapter registry.
- Per session: GDT connector, CSRF secret, login limiter, TVAN tokens/challenges/batches, download job state, timestamps, abort controller.
- Per request: parsed invoice business data and generated export/download buffers; release references after response.
- Browser only: invoice dataset, chosen directory handle (IndexedDB), dataset files, downloaded XML/ZIP/PDF and UI preferences.

## Files requiring primary changes

- `src/server/app.ts`, route modules, `services/session.service.ts`
- `services/download.service.ts`, `services/dataset.service.ts`, `tvan/pdf.service.ts`, `tvan/backport.service.ts`
- `src/web/api/client.ts`, `pages/SettingsPage.tsx`, `InvoicePage.tsx`, `DownloadPage.tsx`, `LoginPage.tsx`, `App.tsx`
- shared models/schemas for public session/admin/download contracts
- Dockerfile, compose/Portainer stacks, env example, reverse-proxy config, deployment docs and tests

## Explicit deployment boundary

The in-memory registry supports **one application replica**. Scale-out requires a session coordinator capable of preserving connector/TVAN affinity or sticky routing with a safe shared revocation plane. The production compose therefore pins one backend replica and documents this constraint.
