# Release notes — hddt_conn v1.3.1-1

Bản vá tối ưu kiến trúc/vận hành trên nền v1.3.1. Không đổi hành vi nghiệp vụ, API hay định dạng dataset.

> Lưu ý semver: `1.3.1-1` là bản pre-release nên về mặt thứ tự semver nhỏ hơn `1.3.1`.
> Nếu cần được coi là bản sau `1.3.1`, cân nhắc `1.3.2` hoặc `1.3.1+1`.

## Thay đổi

### Kiến trúc
- **Một nguồn version duy nhất**: `src/shared/version.ts` (`APP_VERSION`) được server, web, export Excel và metadata dataset dùng chung. Trước đây chuỗi version nằm rải rác ở hơn 8 chỗ.
- **`scripts/check-version.mjs`** (chạy trong `pnpm lint`): fail khi `VERSION`, `package.json`, `version.ts` lệch nhau, khi tag image mặc định trong `compose.yml`/`.env.example` lệch `VERSION`, hoặc khi có version bị hard-code lại trong `src/`.
- **Tách `InvoicePage.tsx`** (2.649 → ~1.700 dòng): drawer và 4 card trình bày TVAN (MISA, Invoice, Softdreams, Viettel) chuyển sang `components/invoices/InvoiceDrawer.tsx` và được lazy-load; trạng thái hóa đơn → `invoice-status.tsx`; định dạng tiền → `invoice-format.ts`. Chunk `InvoicePage` giảm 254,4 → 227,9 kB; drawer là chunk riêng 27,8 kB.

### Hoạt động / bảo mật
- **Session chỉ tạo cho `/api/*`**. Trước đây mọi request không có cookie (file tĩnh, bot, crawler) đều tạo một session đầy đủ, tốn RAM và có thể làm cạn `HDDT_MAX_SESSIONS`. CSP và các header bảo mật vẫn áp dụng cho file tĩnh. Rate limit không đổi.
- Xóa code chết `if (false && …)` trong `/api/app/exit`.

### Triển khai
- `compose.yml`: tag image mặc định `1.3.0-public` → `1.3.1-1`; `HDDT_PUBLIC_URL` và `HDDT_ALLOWED_ORIGINS` đọc từ biến môi trường (mặc định vẫn `https://inv.dangkhoi.net`, hành vi cũ giữ nguyên); truyền `HDDT_VERSION` làm build arg.
- `Dockerfile`: thêm nhãn OCI (`title`, `version`, `source`).
- `.env.example`: cập nhật tag và thêm `HDDT_PUBLIC_URL`, `HDDT_ALLOWED_ORIGINS`.

### Dọn dẹp
- Xóa `src/server/gdt/connector.ts.backup` và `src/web/api/client.ts.backup` (không được import ở đâu); thêm `*.backup` vào `.gitignore`.

## Kiểm thử
- Test mới `tests/integration/static-no-session.test.ts` (3 test): request không phải API không tạo session; request API đầu tiên vẫn tạo session và trả CSRF token; `/api/health` không tạo session.
- Smoke test đọc version từ `VERSION` thay vì hard-code.

## Chưa thay đổi (có chủ đích)
- Workflow `release-windows-v1.3.1.yml` và README còn trỏ tới artifact v1.3.1; cần workflow/README mới khi build gói Windows `1.3.1-1`.
- `release/*.zip` vẫn bị track trong git (workflow cố ý `git add -f`); xem `INVENTORY_v1.3.1-1.md`.
- Nhánh `dev` (ACMAN, PVOIL, PDF MISA/Viettel) chưa được gộp vào bản này.
