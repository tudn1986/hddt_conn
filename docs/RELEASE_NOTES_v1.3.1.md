# hddt_conn v1.3.1

## Phạm vi

Phiên bản 1.3.1 được đóng gói từ mã nguồn đang được kiểm thử trên Docker DEV port 8288.

## Thay đổi chính

- Cập nhật bộ nhận diện hddt_conn:
  - favicon WebUI mới;
  - logo ngang mới trên thanh điều hướng;
  - icon ứng dụng Windows/macOS mới;
  - icon system tray Windows mới.
- Windows portable có launcher chính `HDDT_CONN.exe` để người dùng dễ nhận biết và double-click.
- Giữ `Start-HDDT.vbs` và `Start-HDDT.cmd` làm fallback/debug.
- macOS `Start HDDT.app` được cấu hình icon `hddt_conn.icns` khi đóng gói native.
- Tên artifact portable chuẩn hóa thành:
  - `hddt_conn_v1.3.1_windows_x64.zip`;
  - `hddt_conn_v1.3.1_macos_arm64.zip`;
  - `hddt_conn_v1.3.1_macos_x64.zip`.
- Source package: `hddt_conn_v1.3.1.zip`.

## Windows

Sau khi giải nén:

1. Double-click `HDDT_CONN.exe`.
2. Ứng dụng khởi động server cục bộ và mở WebUI trong trình duyệt.
3. Biểu tượng hddt_conn xuất hiện ở Windows system tray.
4. Double-click icon tray để mở lại WebUI.
5. Right-click icon tray để mở/ẩn cửa sổ trạng thái hoặc thoát ứng dụng.

## macOS

Bản macOS vẫn dùng `Start HDDT.app` làm launcher chính. Packaging script gắn icon từ `assets/branding/hddt_conn_icon_app_1024.svg`.

## Kiểm thử phát hành

Trước khi tạo artifact phải chạy:

```bash
pnpm verify
```

Windows binary phải được build trên Windows x64. macOS binary phải được build trên đúng kiến trúc macOS đích do Node SEA không hỗ trợ cross-build tùy ý.

## Branding source

- `public/branding/hddt_conn_favicon.svg`
- `public/branding/hddt_conn_web_logo_horizontal.svg`
- `assets/branding/hddt_conn_icon_app_1024.svg`
- `assets/branding/hddt_conn_avatar_corporate.svg`


## Windows local build dependency

Windows local build does not require ImageMagick or `winget`.
`pnpm package:win-x64` uses the checked-in `assets/branding/hddt_conn.ico`.

ImageMagick remains relevant only to the macOS packaging path that generates `.icns`.
