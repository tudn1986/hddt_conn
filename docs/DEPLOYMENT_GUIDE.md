# Hướng dẫn chạy và đóng gói HDDT v1.2.1

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
pnpm start
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
release/HDDT_v1.2.1_windows_x64.zip
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
release/HDDT_v1.2.1_macos_arm64.zip
release/HDDT_v1.2.1_macos_x64.zip
```

Script hiện ad-hoc codesign để chạy nội bộ. Phát hành rộng cần Developer ID signing và notarization của tổ chức.

## 7. Build source release

```bash
pnpm package:source
```

Kết quả là `HDDT-v1.2.1-source.zip` cùng `RELEASE_MANIFEST.json` SHA-256 theo file.

## 8. Cấu hình và dữ liệu

App-data mặc định:
- Windows: `%APPDATA%\HDDT\`
- macOS: `~/Library/Application Support/HDDT/`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/HDDT/`

`dataRoot` chứa dataset/XML/ZIP dưới thư mục MST đăng nhập.

Không lưu password, captcha, token hoặc cookie xuống disk.

## 9. Luồng live v1.2.1

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

v1.2.1 giữ dataset schemaVersion 1. Dataset v1.0.x được migrate-on-read trong RAM sang source `standard`; file gốc chỉ thay đổi nếu người dùng lưu lại.

Để rollback binary, dừng HDDT và chạy thư mục version trước. Không xóa `dataRoot`.

## 12. Bản thể hiện PDF / TVAN trong v1.2.1

v1.2.1 thêm subsystem adapter TVAN độc lập với connector GDT:

- MISA (`tvan_misa`): P1, lấy `TransactionID`, không yêu cầu CAPTCHA theo payload được cung cấp. Adapter ưu tiên link PDF do MISA trả về và có fallback public-browser đã được MISA mô tả.
- Viettel (`tvan_viettel`): P2, dùng `supplierTaxCode + reservationCode + recaptcha`; token xác thực được giữ RAM để tái sử dụng cho nhiều hóa đơn.
- TVAN chưa hỗ trợ: được đánh dấu unsupported/P3 và chuyển sang trang TVAN Backport để thu thập raw JSON/XML.

Các URL TVAN đều bị allow-list theo adapter; Backport không phải arbitrary URL proxy. PDF được kiểm tra magic `%PDF-` và giới hạn dung lượng trước khi trả về/lưu ZIP.

**Gate live còn cần thực hiện trên máy có Internet/credential phù hợp:** endpoint cấp CAPTCHA Viettel chưa có trong payload đầu vào (payload chỉ có verify + downloadPDF), vì vậy adapter thử một tập route cùng origin và nếu không khớp sẽ yêu cầu bổ sung capture qua Backport.

## 13. Production release: thông số khóa trong source

Bản production khóa trực tiếp các giá trị sau trong `src/shared/release-config.ts`:

```text
Endpoint danh sách bán ra: /api/query/invoices/sold
Luồng lấy chi tiết:        1
Luồng tải XML/ZIP:         1
Delay request:             200 ms
Số lần thử tối đa:         3
```

Các control tương ứng vẫn tồn tại trong `SettingsPage.tsx` để debug khi chạy
Vite development, nhưng được ẩn khi build production. Server production luôn
áp lại các giá trị release trong lúc đọc/lưu `config.json`, vì vậy config cũ
không thể vô tình ghi đè chúng.

## 14. Chạy nền / system tray

### Windows portable

Gói release chứa:

```text
Start-HDDT.vbs       launcher khuyến nghị, không mở console
HDDT-Tray.ps1        tray controller
Start-HDDT.cmd       fallback/debug
runtime/node.exe     Bundled Node.js runtime
app/dist/server/     Compiled server
app/node_modules/    Production runtime dependencies
```

Double-click `Start-HDDT.vbs`. Server được tạo với `CreateNoWindow=true` và
biểu tượng `hddt-conn` nằm trong Windows system tray. Double-click icon để mở
WebUI; right-click > `Thoát hddt-conn` để gọi endpoint shutdown cục bộ rồi đóng
tray controller.

### macOS portable

Khi chạy `pnpm package:mac-arm64` hoặc `pnpm package:mac-x64`, script đóng gói
tạo `Start HDDT.app` bằng `/usr/bin/osacompile`, đặt `LSUIElement=true` và ký
ad-hoc. Double-click application này để chạy server nền mà không mở Terminal.

macOS không có Windows-style system tray. Bản này ưu tiên yêu cầu thực tế là
**không để cửa sổ console/Terminal vô nghĩa trên màn hình**. Điều khiển thoát
được thực hiện bằng nút `Thoát` trên WebUI. Nếu muốn icon menu-bar thường trực,
cần native menu-bar wrapper riêng và nên ký/notarize cùng bản phân phối.
