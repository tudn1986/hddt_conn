# Kiểm kê dự án hddt_conn — v1.3.1-1

Kiểm kê ngày 2026-11-02 trên `/home/tu/hddt_git` (docker1), cơ sở: `main` @ `9020ab4` (v1.3.1).

## 1. Tổng quan

| Hạng mục | Giá trị |
|---|---|
| Mục đích | WebUI kết nối GDT và các nhà cung cấp HĐĐT (TVAN) để tra cứu, tải, xuất hóa đơn |
| Stack | TypeScript, Fastify 5, React 18, Ant Design 5, Vite 8, Zod 4, ExcelJS, Playwright-core |
| Công cụ | pnpm 11.19, Node ≥ 22.13 (Docker dùng node:22-bookworm-slim) |
| Mã nguồn | ~26.800 dòng trong `src/` (server, shared, web), 50 file test |
| Baseline | `tsc` sạch; 41 file / 252 test pass trước thay đổi (42 / 255 sau) |

## 2. Cấu trúc

- `src/server`: `app.ts` (hooks, CSRF, rate limit, CSP), `index.ts` (khởi động, instance lock), `routes/` (auth, admin, invoice, dataset, download, export, settings, tvan, presentation), `services/` (session, dataset, download, invoice-query, settings, tvan-catalog), `gdt/connector.ts` (GDT live/mock), `tvan/adapters/` (acman, ehoadondientu, fast, invoice, misa, pvoil, softdreams, thaison, viettel, vnpt), `tvan/pdf.service.ts`, `export/`.
- `src/shared`: models, schemas (Zod), normalizer, invoice-relations, incremental-sync, tvan-catalog, solution-provider, release-config, `version.ts`.
- `src/web`: `App.tsx` (lazy route), pages (Invoice, Download, AccountingExport, Settings, Admin, TvanBackport, Login), components, `storage/local-workspace.ts` (dữ liệu nghiệp vụ nằm ở trình duyệt).
- `deploy/`: Caddyfile, stack Portainer cho vm300 (nhiều biến thể phiên bản cũ), script backup/restore/prepare/build-update.
- `scripts/`: dev, start, smoke, package-portable/source, check-scripts, check-version.
- Gói phát hành: Windows x64 portable, Linux x64, macOS (script build), Docker.

## 3. Git

- Nhánh: `main`, `release/v1.3.1`, `dev`, `feature/presentation-pdf-architecture`, `acman-pdf-dev-20260927`; tag `v1.3.0-rc.2`, `v1.3.1`, `dev-baseline-20260924`.
- Remote: `github` (tudn1986/hddt_conn) và `origin` (bare repo cục bộ).
- 3 worktree: thư mục này (`main`) và hai worktree ở `/opt/hddt_conn/dev/` (`dev` @ `b162a56`, `feature/presentation-pdf-architecture` @ `77be915`).
- `.git` nặng ~213 MB do `release/hddt_conn_v1.3.1.zip` và `release/hddt_conn_v1.3.1_windows_x64.zip` bị track dù `release/` nằm trong `.gitignore`.

## 4. Phát hiện và xử lý trong v1.3.1-1

| # | Phát hiện | Xử lý |
|---|---|---|
| 1 | Version hard-code ≥ 8 nơi; tag compose/.env còn `1.3.0-public` | Đã xử lý: `version.ts` + `check-version.mjs` |
| 2 | Mỗi request không cookie (cả file tĩnh/bot) tạo session đầy đủ | Đã xử lý: chỉ tạo cho `/api/*` |
| 3 | `InvoicePage.tsx` 2.649 dòng, 56 `useState`, chứa cả 4 card TVAN | Đã tách một phần (còn ~1.700 dòng, 56 `useState` ở component chính) |
| 4 | 2 file `.backup` bị track; code chết `if (false && …)` | Đã xử lý |
| 5 | Domain `inv.dangkhoi.net` hard-code trong compose | Đã xử lý: đọc từ env, mặc định giữ nguyên |
| 6 | Zip release nằm trong git | Chưa xử lý (xem 5) |
| 7 | Nhiều file stack Portainer phiên bản cũ trong `deploy/` | Chưa xử lý (xem 5) |

## 5. Đề xuất tiếp theo (chưa thực hiện)

Ưu tiên cao
- **Gộp `dev` vào dòng phát hành** sau khi review: có thêm ACMAN/PVOIL và sửa PDF MISA/Viettel mà `main` chưa có.
- **Chuyển zip phát hành sang GitHub Releases** thay vì commit vào git; sửa workflow Windows (đang hard-code tên file và version `1.3.1`, chỉ chạy trên `release/v1.3.1`). Muốn thu nhỏ `.git` phải viết lại lịch sử, cần thống nhất trước.
- **Rate limit** hiện tính cả file tĩnh và dùng bộ nhớ trong tiến trình; cân nhắc chỉ tính `/api/*` hoặc giao cho reverse proxy.

Ưu tiên trung bình
- **Chia nhỏ state của `InvoicePage`** (56 `useState`) thành hook theo chức năng (bộ lọc, bảng, TVAN batch, đồng bộ tăng dần); mỗi hook có test riêng.
- **Gộp stack Portainer**: giữ một stack hiện hành cho vm300, chuyển bản cũ vào `deploy/archive/`.
- **`check-version` trong CI** và workflow build cho từng bản phát hành lấy version từ `VERSION`.
- Chạy ứng dụng với `HDDT_ADMIN_TOKEN` tách theo môi trường; tài liệu hóa quy trình chạy song song instance dev trên vm300 (project name, volume, cổng, hostname riêng; cookie `__Host-` không phân biệt cổng).

UX (cần thử trên giao diện thật trước khi làm)
- Bảng hóa đơn: kiểm tra lại các hạng mục từ audit thiết kế trước (nền nội dung, zebra, breakpoint tablet, form truy vấn trên màn hình hẹp).
- Drawer chi tiết: hiển thị trạng thái đang tải khi lazy-load lần đầu (hiện fallback rỗng).
- Thông báo lỗi TVAN (CAPTCHA, giới hạn batch) nên nêu rõ bước người dùng cần làm.

## 6. Giới hạn đã biết (kế thừa từ v1.3.1)

- Hóa đơn được chọn chưa tải chi tiết sẽ không có dòng `ChiTiet`.
- PDF batch TVAN phụ thuộc năng lực nhà cung cấp, CAPTCHA và giới hạn batch.
- Hóa đơn loại 06 từ một số nhà cung cấp không có tiền HHDV trong danh sách tóm tắt.
- Endpoint POS bán ra chưa có dữ liệu xác thực; hồ sơ AMIS mới là nền tảng ánh xạ.
- Chưa chạy thử với tài khoản GDT thật.
