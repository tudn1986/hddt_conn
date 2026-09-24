# THÔNG TIN / PAYLOAD CẦN BỔ SUNG ĐỂ ĐÓNG ĐẶC TẢ v1.1.0

**Ngày:** 12/09/2026

## P0 — bắt buộc để đóng implementation/live verification

### 1. POS export XML/ZIP

Đã biết:

```text
/api/sco-query/invoices/export-xml
?nbmst=...
&khhdon=...
&shdon=...
&khmshdon=...
```

Thông tin mới mô tả method là POST.

Cần capture thêm:
- method từ DevTools;
- request headers (`Action`, `End-Point`, `Referer`, `Content-Type`, ...);
- request body rỗng/JSON/form;
- response status;
- `Content-Type`;
- `Content-Disposition`;
- `Content-Length`;
- file response hoặc magic bytes;
- nếu ZIP: danh sách entry, tên XML, XML root/encoding;
- filename portal trả về;
- behavior XML/ZIP của cùng endpoint.

### 2. POS status coverage

Cần payload thật:
- `/api/sco-query/invoices/purchase ... ttxly==5`
- `/api/sco-query/invoices/purchase ... ttxly==6`

### 3. POS cursor page 2

Cần capture request tiếp theo khi page 1 trả `state` để xác nhận:
- vị trí query param `state`;
- có giữ `search`/`sort` không;
- cursor lifecycle.

### 4. Error contracts

Cần mẫu:
- 401/403 session expired;
- invalid locator;
- no result;
- detail error;
- export error.

## P1 — tăng coverage schema

- standard detail `ttxly=5`;
- standard detail `ttxly=8` nếu có;
- POS detail `ttxly=5`;
- POS detail `ttxly=6`;
- adjustment/replacement;
- negative amounts;
- multiple VAT rates;
- KCT/KKKNT;
- foreign currency;
- discount lines;
- invoice không có line;
- buyer không MST / có CCCD;
- dynamic field nhiều TVAN;
- POS XML sample.

## Sales

Nếu cần POS sales, capture riêng; không suy từ purchase:

```text
/api/sco-query/invoices/sold
```

nếu endpoint thực tế tồn tại, cùng list/detail/export/pagination/headers.

## v1.2.0 — bản thể hiện

### Xem bản thể hiện
Cần:
- endpoint;
- method;
- query/body;
- MIME;
- HTML/PDF/image/blob;
- dependency remote nếu HTML.

### Tải bản thể hiện
Cần:
- endpoint;
- method;
- filename;
- MIME;
- format file.

### Security
Cần xác định:
- HTML có script/external resource không;
- PDF/image validation;
- sandbox strategy;
- local preview architecture.

## Không cần gửi

Không cần cung cấp password, Bearer token, Cookie, CAPTCHA session thật. Nên redaction các credential và PII không cần thiết.

## Kết luận

Khoảng trống lớn nhất còn lại cho v1.1.0 hiện là:
1. transport/response POS export XML/ZIP;
2. POS list status 5/6;
3. page-2 cursor và error contracts.

Bản thể hiện được tách thành discovery riêng cho v1.2.0.
