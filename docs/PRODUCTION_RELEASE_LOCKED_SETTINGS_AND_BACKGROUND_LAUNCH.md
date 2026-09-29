# hddt-conn v1.1.0 — Production locked settings & background launcher

## 1. Thông số khóa trong production

Các giá trị release được khai báo tại:

```text
src/shared/release-config.ts
```

Giá trị:

| Thông số | Production |
|---|---:|
| Endpoint danh sách bán ra | `/api/query/invoices/sold` |
| Luồng lấy chi tiết | `1` |
| Luồng tải XML/ZIP | `1` |
| Delay request | `200 ms` |
| Số lần thử tối đa | `3` |

`SettingsService` áp lại các giá trị này khi đọc và lưu cấu hình nếu
`NODE_ENV=production`. Vì vậy file `config.json` cũ hoặc request PUT trực tiếp
không thể thay đổi các thông số release.

Ở frontend, các control vẫn còn nguyên trong `SettingsPage.tsx` nhưng chỉ render
khi `import.meta.env.DEV === true`. Đây là cơ chế “ẩn trong production, giữ để
debug” thay vì xóa mã nguồn.

## 2. Cách debug các thông số bị ẩn

Chạy development:

```bash
pnpm dev
```

Mở **Cài đặt**. Nhóm `Thông số release — chỉ hiện khi debug/dev` sẽ hiện lại và
có thể thay đổi tạm thời. Backend development không ép release profile.

Chạy production/local dist:

```bash
pnpm build
pnpm start
```

`scripts/start.mjs` đặt `NODE_ENV=production`, do đó backend khóa các giá trị.
Vite production build đồng thời ẩn các control.

## 3. Windows — chạy nền và system tray

Portable Windows chứa:

```text
Start-HDDT.vbs
HDDT-Tray.ps1
Start-HDDT.cmd
runtime/node.exe + app/dist/server/index.js
```

### Launcher khuyến nghị

Double-click:

```text
Start-HDDT.vbs
```

VBS khởi động PowerShell với `WindowStyle Hidden`. `HDDT-Tray.ps1` chạy
`runtime/node.exe + app/dist/server/index.js` với:

```text
UseShellExecute = false
CreateNoWindow   = true
WindowStyle      = Hidden
```

Do đó không có cửa sổ console màu đen thường trực.

Tray controller tạo biểu tượng **hddt-conn** trong Windows system tray:

- double-click icon: mở WebUI;
- right-click → **Mở hddt-conn**: mở WebUI;
- right-click → **Thoát hddt-conn**: gọi `/api/app/exit` với CSRF token lấy từ
  local status endpoint, sau đó đóng tray controller;
- nếu graceful shutdown thất bại, launcher mới fallback sang stop process.

`Start-HDDT.cmd` vẫn được giữ làm fallback/debug. Khi phát hành cho người dùng,
nên hướng dẫn dùng `Start-HDDT.vbs` hoặc tạo shortcut tới file này.

## 4. macOS — chạy nền, không mở Terminal

macOS không có “system tray” theo mô hình Windows; tương đương gần nhất là menu
bar. Bản v1.1.0 này giải quyết mục tiêu chính là **không để cửa sổ Terminal vô
nghĩa trên desktop**.

Khi chạy package script trên macOS, `package-portable.mjs` tạo:

```text
Start HDDT.app
```

bằng `/usr/bin/osacompile`, sau đó đặt `LSUIElement=true` và ad-hoc codesign.
Application launcher chạy:

```text
nohup ./hddt-server ... &
```

và thoát ngay. Server tiếp tục chạy nền, tự mở WebUI trong browser, không tạo
Terminal window và không giữ Dock icon.

`Start HDDT.command` vẫn có trong release làm fallback/debug; file này cũng chạy
portable server detached nhưng tùy cấu hình Terminal có thể flash cửa sổ trong
thời gian rất ngắn. Vì vậy production nên dùng `Start HDDT.app`.

### Nếu cần icon menu bar thường trực trên macOS

Cần một native menu-bar controller (AppKit/Swift hoặc một desktop wrapper như
Electron/Tauri). Đây là thay đổi kiến trúc phân phối lớn hơn và không cần thiết
chỉ để loại bỏ cửa sổ console. Với v1.1.0, WebUI đã có nút **Thoát** để dừng
server nền.

## 5. Build Windows x64

Trên Windows x64:

```cmd
BUILD-PORTABLE-WINDOWS.cmd
```

hoặc:

```cmd
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm verify
pnpm package:win-x64
```

Output:

```text
release/HDDT_v1.1.0_windows_x64.zip
```

Sau giải nén, chạy `Start-HDDT.vbs`.

## 6. Build macOS

Apple Silicon:

```bash
./BUILD-PORTABLE-macOS.command
```

hoặc:

```bash
pnpm package:mac-arm64
```

Intel:

```bash
pnpm package:mac-x64
```

Output:

```text
release/HDDT_v1.1.0_macos_arm64.zip
release/HDDT_v1.1.0_macos_x64.zip
```

Sau giải nén, chạy `Start HDDT.app`.

## 7. Lưu ý signing/notarization macOS

Package script hiện dùng ad-hoc signing cho binary nội bộ. Nếu phân phối cho
người dùng ngoài tổ chức, nên ký cả `hddt-server` và `Start HDDT.app` bằng
Developer ID Application rồi notarize/staple artifact để tránh cảnh báo
Gatekeeper.
