# Bàn giao mã nguồn — hddt_conn v1.3.1-2

Ngày bàn giao: 2026-11-03. Phiên bản: `1.3.1-2` (xem `VERSION`, `src/shared/version.ts`).

> Semver: `1.3.1-2` là bản pre-release nên về thứ tự semver nhỏ hơn `1.3.1`. Nếu cần được coi là bản sau `1.3.1`, đổi sang `1.3.2` hoặc `1.3.1+2`.

## 1. Gói bàn giao

| Hạng mục | Vị trí |
|---|---|
| Mã nguồn (Git) | https://github.com/tudn1986/hddt_conn, nhánh `release/v1.3.1-2` |
| Gói mã nguồn | `hddt_conn_v1.3.1-2.zip` (tạo bằng `pnpm package:source`; `RELEASE_MANIFEST.json` bên trong liệt kê SHA-256 từng file) |
| Gói Windows portable | `release/hddt_conn_v1.3.1-2_windows_x64.zip` trên nhánh `release/v1.3.1-2`, do workflow `release-windows.yml` build |
| Ghi chú phát hành | `docs/RELEASE_NOTES_v1.3.1-2.md` (và bản `-1`) |
| Kiểm kê, đề xuất | `docs/INVENTORY_v1.3.1-1.md` |

Gói mã nguồn không chứa `node_modules`, `dist`, `release`, `.git`, `.env*` (trừ `.env.example`), log hay file sao lưu.

## 2. Dựng lại từ mã nguồn

Yêu cầu: Node.js ≥ 22.13, pnpm 11.19.0 (`corepack enable`).

```bash
pnpm install --frozen-lockfile
pnpm verify          # lint (tsc + kiểm tra version) → test → build → smoke
pnpm start           # chạy bản đã build (NODE_ENV=production)
pnpm dev             # phát triển
```

Kết quả `pnpm verify` trên bản này: 44 file / 264 test pass; smoke test báo `version 1.3.1-2`.

Đóng gói: `pnpm package:source` (mã nguồn), `pnpm package:win-x64` (Windows, chạy trên Windows x64). Phát hành Windows chuẩn: đẩy nhánh `release/v*` lên GitHub, workflow build, kiểm tra zip, kiểm tra `/api/health`, rồi tự commit zip vào chính nhánh đó. Version lấy từ file `VERSION`.

## 3. Quy ước quan trọng

- Version chỉ khai báo ở `VERSION`, `package.json`, `src/shared/version.ts`; `pnpm lint` (`scripts/check-version.mjs`) fail nếu lệch hoặc nếu `compose.yml`/`.env.example` còn tag cũ.
- Session máy chủ chỉ tạo cho `/api/*`, không tạo cho file tĩnh.
- Dataset ghi JSON nén một lần (`DatasetService.save`); `open` chấp nhận file thụt lề cũ tới 2× giới hạn `storage.maxDatasetBytes`.
- Xuất Excel dùng ExcelJS streaming qua `src/server/export/xlsx-stream.ts`; dòng phải được `commit()` từng dòng, độ rộng cột tính trước.
- Thông số bản phát hành bị khóa khi `NODE_ENV=production` (`src/shared/release-config.ts`): tải chi tiết và tải XML/ZIP 1 luồng, giãn 200 ms, thử lại tối đa 3 lần.
- Không thêm endpoint GDT bằng suy đoán; mọi URL TVAN phải qua allow-list adapter.

## 4. Biến môi trường chính

| Biến | Ý nghĩa |
|---|---|
| `HDDT_PORT` | Cổng ưu tiên (mặc định 3210) |
| `HDDT_FIXED_PORT=1` | Giữ cố định cổng, không tự chọn cổng khác (cổng bận thì không khởi động) |
| `HDDT_BIND_HOST` | Mặc định `127.0.0.1` |
| `HDDT_INSECURE_HTTP=1` | Dùng cookie không `Secure` cho HTTP loopback (launcher Windows đặt sẵn) |
| `HDDT_NO_OPEN_BROWSER=1` | Không tự mở trình duyệt |
| `HDDT_DATA_ROOT` | Thư mục dữ liệu mặc định (mặc định `<home>/HDDT_DATA`) |
| `HDDT_APP_DATA_DIR` | Thư mục cấu hình (mặc định `%APPDATA%\HDDT`). Không đặt trên Windows portable: `HDDT-Tray.ps1` đọc cố định `%APPDATA%\HDDT\runtime.json` |
| `HDDT_CONNECTOR` | `mock` hoặc `live` |
| `HDDT_ADMIN_TOKEN` | Bắt buộc cho triển khai Docker/quản trị (≥ 32 ký tự ngẫu nhiên) |
| `HDDT_PUBLIC_URL`, `HDDT_ALLOWED_ORIGINS`, `HDDT_TRUST_PROXY_CIDRS` | Đứng sau reverse proxy |
| `HDDT_RATE_LIMIT_PER_MINUTE`, `HDDT_MAX_SESSIONS` | Giới hạn yêu cầu (mặc định 300) và số session (mặc định 500) |
| `HDDT_CHROMIUM_EXECUTABLE`, `HDDT_TVAN_*`, `HDDT_FAST_MAX_CONTEXTS`, `HDDT_THAISON_MAX_CONTEXTS` | Tự động hóa trình duyệt và tinh chỉnh PDF TVAN |

## 5. Tài liệu: bản nào còn đúng

- Còn dùng: `README.md` (người dùng Windows), `docs/RELEASE_NOTES_v1.3.1-*.md`, `docs/INVENTORY_v1.3.1-1.md`, `docs/PRODUCTION_RELEASE_LOCKED_SETTINGS_AND_BACKGROUND_LAUNCH.md` (phần launcher/tray), `docs/source/HDDT_v1.0.0_SPEC.md` (hành vi gốc: cổng, một instance, cấu trúc lưu trữ).
- Lạc hậu một phần: `docs/DEVELOPER_GUIDE.md`, `docs/DEPLOYMENT_GUIDE.md` (ghi v1.2.1 và Node SEA; gói thực tế dùng `runtime\node.exe` dạng thư mục), các tài liệu `DOCKER_PORTAINER_VM300_*` và `DEPLOY_PORTAINER_VM300_*` (phiên bản cũ).

## 6. Chưa được kiểm chứng

- Chưa chạy với tài khoản GDT thật; chưa kiểm tra endpoint POS bán ra.
- Chưa chạy `HDDT_CONN.exe` trên máy Windows thật (workflow chỉ kiểm tra bằng `node.exe` đi kèm).
- Số đo hiệu năng lấy từ dữ liệu giả lập trên Linux.

## 7. Việc còn tồn đọng

1. Lưu dataset lớn chặn tiến trình vài giây (≈3,5 s với 10.000 hóa đơn); `HDDT-Tray.ps1` có thể coi server không phản hồi nếu bị chặn quá ~6–10 s.
2. Launcher chưa đặt `--max-old-space-size`.
3. Gói Windows có ~7.600 file; cân nhắc gộp server thành vài file.
4. Các file `release/*.zip` bị theo dõi trong git (workflow cố ý `git add -f`); nên chuyển sang GitHub Releases.
5. Nhánh `dev` đã nằm trong `main`. Công việc đang dở chưa commit trong hai worktree dưới `/opt/hddt_conn/dev/` (adapter `icorp.ts`, `PRESENTATION_PDF_PROVIDER_ARCHITECTURE.md`, sửa `provider-resolution`, `registry`, `InvoicePage`…) **không** nằm trong bản bàn giao này.
6. Cập nhật `DEVELOPER_GUIDE.md`, `DEPLOYMENT_GUIDE.md` cho khớp 1.3.1-2.
7. Tạo tag và GitHub Release cho `v1.3.1-2`.
