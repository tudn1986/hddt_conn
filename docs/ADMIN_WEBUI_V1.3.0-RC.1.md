# HDDT Admin WebUI — v1.3.0-rc.1

Bản source tùy biến này bổ sung trang quản trị tại `/admin`.

## Truy cập trên VM300

```text
http://10.10.2.45:8188/admin
```

Đăng nhập bằng giá trị `HDDT_ADMIN_TOKEN` đã cấu hình cho container. Token phải dài tối thiểu 32 ký tự.

## Chức năng

- Xem số lượng session đang hoạt động.
- Xem Username/MST của session đã đăng nhập GDT.
- Xem trạng thái đăng nhập, thời gian tạo, hoạt động gần nhất và hết hạn.
- Xem IP hash (không hiển thị IP gốc), session admin ID và audit metadata.
- Refresh dữ liệu.
- Revoke từng session. Không cho phép revoke chính browser session đang dùng để quản trị.
- Xem 200 audit event gần nhất.
- Đăng xuất Admin bằng cách xóa token khỏi `sessionStorage` của tab.

## Mô hình bảo mật

Admin Token không được đưa vào URL và không được server ghi vào metadata. WebUI giữ token trong `sessionStorage` của tab và gửi `Authorization: Bearer <token>` tới các API admin hiện hữu. Thao tác `DELETE` vẫn phải vượt qua CSRF protection của ứng dụng.

Không hiển thị password GDT, bearer token GDT/TVAN, cookie, CAPTCHA, invoice JSON/XML/ZIP/PDF hay secret session.


## TVAN Catalog database

Trang `/admin` có thêm tab **TVAN Catalog**. Backend quan sát metadata TVAN từ `POST /api/datasets/import`, `POST /api/invoices/query` và `POST /api/invoices/query-auto`, sau đó lưu metadata tổng hợp vào `/data/app/tvan-catalog.sqlite`. Database không lưu raw invoice JSON/XML, PDF/ZIP, mã tra cứu cụ thể, token, cookie hoặc CAPTCHA answer.

Các API quản trị bổ sung:

```text
GET /api/admin/tvan-catalog
GET /api/admin/tvan-catalog/stats
GET /api/admin/tvan-catalog/:id
```

Tất cả tiếp tục yêu cầu `Authorization: Bearer <HDDT_ADMIN_TOKEN>`.
