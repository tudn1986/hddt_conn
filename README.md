# hddt_conn

<p align="center">
  <img src="public/branding/hddt_conn_web_logo_horizontal.svg" alt="hddt_conn" width="620">
</p>

**hddt_conn** là ứng dụng hỗ trợ kế toán tra cứu, quản lý và khai thác dữ liệu hóa đơn điện tử trên một giao diện thống nhất.

**Phiên bản hiện tại: `v1.3.1`**

Ứng dụng có bản **Windows Portable**: tải về, giải nén và chạy trực tiếp, không cần cài Node.js hay các công cụ lập trình.

## Tính năng chính

- Tra cứu hóa đơn từ Cổng Hóa đơn điện tử.
- Xem danh sách và chi tiết hóa đơn.
- Quản lý hóa đơn mua vào, hóa đơn chuẩn và hóa đơn máy tính tiền/POS.
- Lưu dữ liệu đã tra cứu để sử dụng lại.
- Tải XML/ZIP khi nguồn dữ liệu hỗ trợ.
- Xem và tải **PDF bản thể hiện hóa đơn** từ các nhà cung cấp giải pháp HĐĐT đã được tích hợp.
- Tải nhiều PDF theo danh sách hóa đơn.
- Xuất dữ liệu phục vụ đối chiếu và công việc kế toán.
- Làm việc với dữ liệu đã lưu mà không phải tra cứu lại toàn bộ từ đầu.

## Nhà cung cấp giải pháp HĐĐT đã được hỗ trợ

| Nhà cung cấp / hệ thống | Hỗ trợ bản thể hiện |
|---|---|
| MISA | Có |
| M-Invoice | Có |
| SoftDreams | Có |
| Viettel | Có |
| Ehoadondientu | Có |
| VNPT | Có |
| ACMAN | Có |
| PVOIL | Có |
| FAST | Có |
| Thái Sơn EInvoice | Có |

> Khả năng lấy PDF của từng hóa đơn còn phụ thuộc vào thông tin tra cứu đi kèm hóa đơn, loại portal và yêu cầu CAPTCHA/session của từng nhà cung cấp.

## Xem PDF bản thể hiện hóa đơn

Khi hóa đơn thuộc nhà cung cấp đã được hỗ trợ:

1. Chọn hóa đơn cần xem.
2. Chọn **Xem bản thể hiện** hoặc **Tải PDF**.
3. Nếu nhà cung cấp không yêu cầu CAPTCHA, ứng dụng tiếp tục xử lý tự động.
4. Nếu nhà cung cấp yêu cầu CAPTCHA, ứng dụng hiển thị ảnh để người dùng nhập.
5. Sau khi CAPTCHA hợp lệ, ứng dụng tiếp tục tra cứu trong đúng phiên của hóa đơn và lấy PDF nếu nhà cung cấp cung cấp bản thể hiện.

Người dùng không cần tự mở website của từng nhà cung cấp và nhập lại toàn bộ thông tin hóa đơn.

## Vì sao hddt_conn không tự động giải CAPTCHA?

CAPTCHA là cơ chế được nhà cung cấp sử dụng để xác nhận thao tác tra cứu đang được thực hiện bởi người dùng thực.

hddt_conn **không tự giải và không tìm cách vượt CAPTCHA**.

Ứng dụng chỉ:

1. Lấy ảnh CAPTCHA từ đúng phiên tra cứu.
2. Hiển thị ảnh cho người dùng.
3. Nhận mã CAPTCHA do người dùng nhập.
4. Gửi mã trong chính phiên đó.
5. Tiếp tục lấy bản thể hiện hóa đơn.

Cách làm này giúp:

- tôn trọng cơ chế bảo vệ của website nhà cung cấp;
- không gửi CAPTCHA cho dịch vụ giải mã bên thứ ba;
- giữ đúng session của hóa đơn;
- hạn chế nguy cơ bị website nhà cung cấp chặn do hành vi tự động bất thường.

Nếu CAPTCHA sai hoặc hết hạn, hãy lấy CAPTCHA mới và nhập lại.

# Chạy bản Portable trên Windows

## 1. Tải bản Windows

Vào trang **Releases**:

https://github.com/tudn1986/hddt_conn/releases

Tải file:

```text
hddt_conn_v1.3.1_windows_x64.zip
```

## 2. Giải nén

Không chạy ứng dụng trực tiếp bên trong file ZIP.

Giải nén toàn bộ vào một thư mục riêng, ví dụ:

```text
C:\hddt_conn\
```

Sau khi giải nén, file chạy chính là:

```text
HDDT_CONN.exe
```

## 3. Khởi động

Double-click:

```text
HDDT_CONN.exe
```

Ứng dụng sẽ khởi động dịch vụ cục bộ, hiển thị biểu tượng **hddt_conn** ở Windows System Tray và mở WebUI trên trình duyệt.

Địa chỉ mặc định:

```text
http://127.0.0.1:3210
```

## 4. System Tray

Khi hddt_conn đang chạy:

- double-click biểu tượng tray để mở lại WebUI;
- right-click để mở menu;
- chọn **Thoát hddt_conn** để dừng ứng dụng.

## 5. Không cần cài môi trường lập trình

Bản Windows Portable đã chứa runtime cần thiết. Người dùng kế toán **không cần cài**:

- Node.js;
- pnpm;
- ImageMagick;
- winget;
- công cụ build.

Quy trình sử dụng chỉ là:

```text
Tải ZIP → Giải nén → Double-click HDDT_CONN.exe
```

## Trình duyệt

WebUI hoạt động trên trình duyệt thông thường.

Một số nhà cung cấp HĐĐT sử dụng luồng tra cứu cần browser automation. Máy Windows nên có:

- Google Chrome; hoặc
- Microsoft Edge.

# Dữ liệu người dùng

Trên Windows, dữ liệu ứng dụng mặc định được lưu tại:

```text
%APPDATA%\HDDT\
```

Không nên xóa thư mục này khi ứng dụng đang chạy.

# Một số lưu ý

Nếu ứng dụng báo đã có một phiên hddt_conn đang chạy, hãy kiểm tra biểu tượng hddt_conn ở System Tray trước khi mở thêm phiên mới.

Nếu PDF của một hóa đơn chưa xem được, nguyên nhân có thể là:

- CAPTCHA đã hết hạn hoặc nhập sai;
- hóa đơn không có mã tra cứu cần thiết;
- website nhà cung cấp đang tạm thời không truy cập được;
- loại portal của hóa đơn chưa được hỗ trợ;
- nhà cung cấp không cung cấp PDF cho luồng tra cứu đó.

Trong các trường hợp chưa đủ thông tin, ứng dụng ưu tiên dừng an toàn thay vì tự suy đoán đường dẫn tải hóa đơn.

# Bảo mật

Khi sử dụng hoặc báo lỗi, không chia sẻ:

- mật khẩu đăng nhập;
- Cookie;
- Authorization token;
- CAPTCHA answer;
- thông tin xác thực hoặc dữ liệu nhạy cảm không cần thiết.

CAPTCHA, cookie và trạng thái phiên tra cứu của nhà cung cấp được xử lý ở backend trong thời gian cần thiết cho phiên làm việc.

# Kiểm tra bản Windows

Bản Windows Portable hiện tại:

```text
hddt_conn_v1.3.1_windows_x64.zip
```

SHA-256:

```text
57a0185d7d078500f5f6a223fe0345e0beaa6aeecc7b51abfe14145327453e53
```

Có thể kiểm tra trên PowerShell:

```powershell
Get-FileHash .\hddt_conn_v1.3.1_windows_x64.zip -Algorithm SHA256
```

# Báo lỗi

Khi báo lỗi, nên cung cấp:

- phiên bản hddt_conn;
- số/ký hiệu hóa đơn có vấn đề;
- tên nhà cung cấp HĐĐT;
- nội dung thông báo lỗi;
- ảnh chụp màn hình nếu cần.

Không gửi mật khẩu, Cookie hoặc token đăng nhập.

# Tài liệu

Tài liệu chi tiết hơn nằm trong thư mục:

```text
docs/
docs/tvan_design/
```

# Phiên bản

```text
hddt_conn v1.3.1
```
