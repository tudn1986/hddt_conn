# HDDT_CONN Public Web — Production Docker Deployment

## 1. Security model

This release runs one public HTTPS web application for multiple concurrent browser sessions.

- Each browser receives an opaque `__Host-hddt_session` cookie (`Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`).
- Each session owns its GDT connector, cookie jar, bearer token, CAPTCHA state and TVAN token/challenge/batch state.
- Session ID and CSRF token rotate after successful login.
- Logout, admin revoke, idle expiry and absolute expiry abort the context, clear secrets and remove session temp files.
- Invoice JSON, XML, ZIP and downloaded PDF are not persisted on the server. The browser writes them to a user-selected local directory through File System Access API; unsupported browsers fall back to normal browser downloads.
- Server persistence (`hddt_metadata`) contains application configuration/runtime metadata, logs, and the aggregate TVAN Catalog SQLite database. The TVAN Catalog stores provider/portal/mapping metadata and counters only; it must not store invoice datasets, raw invoice payloads, lookup codes, tokens, cookies, XML, ZIP or PDF.
- TVAN batch archives, when required, live under session-specific `/tmp` directories, expire after 10 minutes and are deleted after download or session destruction.

## 2. Prerequisites

- A Linux VM with Docker Engine 25+ and Compose v2 (or Portainer backed by a compatible engine).
- A public DNS `A/AAAA` record such as `hddt.example.com` pointing to the VM.
- Inbound TCP 80 and TCP/UDP 443 open. Do not expose port 3210.
- Outbound HTTPS access to GDT/TVAN endpoints and ACME certificate authorities.
- Recommended minimum: 2 vCPU, 2 GB RAM, 10 GB free disk for images/logs/metadata.

## 3. Prepare configuration

```bash
cp .env.example .env
openssl rand -base64 48
chmod 600 .env
```

Edit `.env`:

- `HDDT_DOMAIN`: public DNS name only, no scheme/path.
- `ACME_EMAIL`: certificate expiry contact.
- `HDDT_ADMIN_TOKEN`: paste the random value; minimum 32 characters. Never commit `.env`.
- Tune session/resource limits only after load testing.

Validate DNS before starting:

```bash
getent hosts "$HDDT_DOMAIN"
```

## 4. Build and start

```bash
docker compose config --quiet
docker compose build --pull --no-cache app
docker compose up -d
docker compose ps
docker compose logs --tail=100 app caddy
```

Caddy obtains and renews TLS automatically. Open `https://<HDDT_DOMAIN>` only after both services are healthy.

## 5. Production acceptance checks

```bash
curl -fsS "https://$HDDT_DOMAIN/api/app/status"
curl -sSI "https://$HDDT_DOMAIN/" | grep -Ei 'strict-transport-security|x-frame-options|x-content-type-options'
docker compose exec app id
docker inspect "$(docker compose ps -q app)" --format '{{json .HostConfig.ReadonlyRootfs}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}}'
```

Expected:

- Status returns `config.storageMode: "browser"` and no server data path.
- HTTPS/HSTS/security headers are present.
- App runs as non-root `node`.
- Root filesystem is read-only, all Linux capabilities are dropped and `no-new-privileges` is enabled.
- Two separate/private browser windows receive different cookies/CSRF values; logging out one does not log out the other.
- Saving a dataset opens the local directory picker or browser download; no invoice files appear in the metadata volume.

Inspect the metadata volume without dumping file contents:

```bash
docker run --rm -v hddt-public_hddt_metadata:/data:ro alpine find /data -maxdepth 3 -type f -printf '%p\n'
```

Allowed examples: `config.json`, `runtime.json`, `*.log`, `tvan-catalog.sqlite`, `tvan-catalog.sqlite-wal`, `tvan-catalog.sqlite-shm`. Invoice dataset names, raw invoice JSON/XML, ZIP, PDF, lookup codes and secrets are not allowed.

## 6. Admin session operations

This customized source bundle includes a same-origin Admin WebUI at `/admin`. Sign in with `HDDT_ADMIN_TOKEN` (minimum 32 characters). The token is kept in the current tab's `sessionStorage` and sent as an `Authorization: Bearer` header; it is never placed in the URL.

The dashboard shows active sessions, username/MST, GDT authentication state, created/last-seen/expiry timestamps, audit metadata, Refresh and per-session Revoke. It does not expose GDT/TVAN tokens, cookies, CAPTCHA answers or invoice data.

The bearer-protected APIs remain available for automation:

```bash
curl -fsS -H "Authorization: Bearer $HDDT_ADMIN_TOKEN" "https://$HDDT_DOMAIN/api/admin/sessions"
curl -fsS -H "Authorization: Bearer $HDDT_ADMIN_TOKEN" "https://$HDDT_DOMAIN/api/admin/audit?limit=100"
```

`DELETE /api/admin/sessions/<session-id>` also requires the same browser/API session cookie plus a valid `X-HDDT-CSRF` value. Using **Revoke** in `/admin` is recommended. Direct API clients must first obtain a CSRF token from `/api/app/status` while preserving the same cookie jar.

Rotate the admin token by updating `.env` and recreating only the app. Existing Admin tabs must sign in again after rotation:

```bash
docker compose up -d --no-deps --force-recreate app
```

## 7. Reverse proxy and network rules

The supplied Compose publishes only Caddy ports 80/443. `app:3210` is reachable only on the Compose network. If an existing trusted reverse proxy is used instead:

1. Remove the `caddy` service and do not add a host port for `app`.
2. Join the app to the proxy's private Docker network.
3. Terminate HTTPS at the proxy and forward to `app:3210`.
4. Preserve `Host` and `X-Forwarded-Proto`; configure exactly one trusted proxy hop.
5. Set `HDDT_ALLOWED_ORIGINS=https://exact.public.name` and `HDDT_PUBLIC_URL` to the same HTTPS origin.
6. Keep request body limits, timeouts, HSTS and Web/SSE buffering policy equivalent to the supplied Caddy configuration.

Never set `HDDT_INSECURE_HTTP=1` on a public deployment.

## 8. Backup and restore

Business data is on each user's computer and is not part of server backup.

Back up only metadata and Caddy certificate state:

```bash
docker compose stop
mkdir -p backup
docker run --rm -v hddt-public_hddt_metadata:/src:ro -v "$PWD/backup:/backup" alpine tar -czf /backup/hddt-metadata.tgz -C /src .
docker run --rm -v hddt-public_caddy_data:/src:ro -v "$PWD/backup:/backup" alpine tar -czf /backup/caddy-data.tgz -C /src .
docker compose start
```

Treat logs and `.env` as sensitive. Encrypt backups and apply a short retention policy. Do not add `/tmp` to backups.

Restore into empty volumes while services are stopped, then start and run acceptance checks.

## 9. Upgrade and rollback

```bash
git fetch --all --tags
git checkout <approved-release-tag>
docker compose build --pull app
docker compose up -d
```

Keep the previous immutable image tag. Roll back by restoring `HDDT_IMAGE_TAG`/source tag and running `docker compose up -d`. Session state is in RAM, so recreating the app logs users out; local business files remain unaffected.

## 10. Monitoring and incident response

- Monitor container health, restart count, memory, CPU, HTTP 4xx/5xx and disk usage.
- Alert on repeated 401/403/429, session-capacity evictions, unexpected files in metadata, or `/tmp` growth.
- On suspected session compromise: revoke the session ID, rotate the admin token if exposed, inspect redacted audit metadata, then restart `app` to invalidate all in-memory sessions if necessary.
- Never collect invoice request/response bodies in proxy access logs or APM tracing.

## 11. Scale limitation

This implementation intentionally supports **one app replica**. Session contexts contain non-serializable GDT/TVAN connector state in RAM. Do not set Compose replicas above one and do not put multiple app instances behind round-robin balancing. Scale-up vertically first. Horizontal scale requires a designed affinity/revocation coordinator and new cross-replica isolation tests.

## 12. Verification status for this source bundle

`pnpm run verify` passes locally: TypeScript/lint, 130 tests, production build and application smoke test. The smoke test confirms streamed download behavior and zero business files under the server data root. A real Docker/container smoke test was not run in the build workstation because the Docker CLI/runtime was unavailable; run sections 4–5 on the target Docker host before declaring the deployment live.
