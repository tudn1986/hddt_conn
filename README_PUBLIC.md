# HDDT_CONN — Public Web Production

Bản này được chuyển từ Local WebUI single-session sang public web một replica, đa phiên cô lập.

## Quick start

1. Đọc `docs/PUBLIC_DOCKER_DEPLOYMENT.md`.
2. `cp .env.example .env` và thay domain, email ACME, admin token ngẫu nhiên.
3. Chạy `pnpm run verify` trên máy build.
4. Trên Docker host: `docker compose config --quiet && docker compose build --pull app && docker compose up -d`.
5. Hoàn thành các acceptance checks trong tài liệu trước khi mở cho người dùng.

## Data rule

- Business data persistence: **user computer**.
- Server persistence: **configuration/runtime/security metadata and redacted logs only**.
- Settings production: **only the local storage directory picker**.

## Important limitation

Run exactly one `app` replica. Horizontal scaling is not supported by the in-memory connector/session design in this release.
