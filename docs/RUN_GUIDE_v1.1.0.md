# Hướng dẫn chạy và đóng gói HDDT v1.1.0

## 1. Yêu cầu

- Node.js 22.12 trở lên.
- Corepack và pnpm 11.19.0.
- Windows x64 hoặc macOS arm64/x64 nếu tạo binary portable cho target tương ứng.
- Kết nối HTTPS outbound tới `hoadondientu.gdt.gov.vn` khi dùng connector live.

## 2. Chạy source lần đầu

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm verify
pnpm start  (v1.1.0-fix1: tự build nếu dist chưa tồn tại)
```

Sau `pnpm start`, mở địa chỉ loopback được in trong console nếu trình duyệt không tự mở.

Development:

```bash
pnpm dev
```

## 3. Chạy Demo / Mock

Trên màn hình đăng nhập chọn **Demo / Mock**. Dùng:
- MST hợp lệ 10 chữ số;
- mật khẩu bất kỳ;
- captcha `AB12`.

Mock không gửi request đến GDT và phù hợp để smoke-test UI/query/detail/download.

## 4. Kiểm chứng trước phát hành

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

Hoặc:

```bash
pnpm verify
```

Không bỏ qua bước này trên môi trường target/CI có dependency đầy đủ.

## 5. Build portable Windows

Trên Windows x64, PowerShell/CMD:

```cmd
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm verify
pnpm package:win-x64
```

Kết quả:

```text
release/HDDT_v1.1.0_windows_x64.zip
```

Gói gồm Node SEA executable, WebUI, launcher, checksum và tài liệu.

## 6. Build portable macOS

Apple Silicon:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm verify
pnpm package:mac-arm64
```

Intel:

```bash
pnpm package:mac-x64
```

Kết quả:

```text
release/HDDT_v1.1.0_macos_arm64.zip
release/HDDT_v1.1.0_macos_x64.zip
```

Script hiện ad-hoc codesign để chạy nội bộ. Phát hành rộng cần Developer ID signing và notarization của tổ chức.

## 7. Build source release

```bash
pnpm package:source
```

Kết quả là `HDDT-v1.1.0-source.zip` cùng `RELEASE_MANIFEST.json` SHA-256 theo file.

## 8. Cấu hình và dữ liệu

App-data mặc định:
- Windows: `%APPDATA%\HDDT\`
- macOS: `~/Library/Application Support/HDDT/`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/HDDT/`

`dataRoot` chứa dataset/XML/ZIP dưới thư mục MST đăng nhập.

Không lưu password, captcha, token hoặc cookie xuống disk.

## 9. Luồng live v1.1.0

Purchase query mặc định chọn cả:
- `standard` → `/api/query/invoices/purchase`
- `pos` → `/api/sco-query/invoices/purchase`

UI mặc định chọn `ttxly=5,6,8`; mỗi source/status có cursor chain độc lập.

Detail:
- standard → `/api/query/invoices/detail`
- POS → `/api/sco-query/invoices/detail`

Export:
- standard → `/api/query/invoices/export-xml`
- POS → `/api/sco-query/invoices/export-xml`, mặc định POST theo evidence cung cấp.

Downloader chỉ chấp nhận ZIP hợp lệ hoặc invoice XML hợp lệ.

## 10. Kiểm thử live có kiểm soát

Dùng tài khoản được ủy quyền và khoảng ngày nhỏ. Kiểm tra:
- captcha/login;
- standard và POS list;
- cursor không lặp;
- detail locator khớp list;
- source không đổi sau merge;
- POS export thực tế trả ZIP/XML mà validator chấp nhận;
- logout/restart xóa phiên RAM.

Không đưa Authorization/Cookie/password vào screenshot, issue hoặc log.

## 11. Rollback

v1.1.0 giữ dataset schemaVersion 1. Dataset v1.0.x được migrate-on-read trong RAM sang source `standard`; file gốc chỉ thay đổi nếu người dùng lưu lại.

Để rollback binary, dừng HDDT và chạy thư mục version trước. Không xóa `dataRoot`.

## 12. Phạm vi v1.2.0

Xem/tải **bản thể hiện hóa đơn** không có trong v1.1.0. Cần capture endpoint/MIME/filename/render security riêng trước khi triển khai v1.2.0.
