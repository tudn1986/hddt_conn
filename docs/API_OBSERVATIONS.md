# Quan sát API Cổng HĐĐT (đã khử bí mật)

Tài liệu này ghi contract dùng trong `LiveGdtConnector`. Nó không phải tài liệu API chính thức của GDT và có thể thay đổi.

## Nguồn bằng chứng

- Đặc tả `HDDT_v1.0.0_SPEC.md`.
- Tài liệu connector/XML-ZIP được cung cấp cùng dự án.
- Ảnh DevTools request detail được cung cấp ngày 09/09/2026.
- Mã v0.0.2 trước đó và fixture/mock, dùng để đối chiếu contract.

Ảnh DevTools có chứa Bearer token và Cookie phiên thật. Ảnh không được đưa vào source/release; mọi giá trị credential đều bị loại khỏi tài liệu này.

## Origin cố định

```text
https://hoadondientu.gdt.gov.vn
```

Live connector từ chối origin khác, URL có userinfo và endpoint không nằm dưới `/api/`.

## Captcha

```http
GET /api/captcha
```

Response quan sát:

```json
{
  "key": "<captcha-key>",
  "content": "<svg ...>...</svg>"
}
```

SVG được giới hạn dung lượng và từ chối script/event/foreignObject/external resource. Cookie từ response phải được giữ trong cùng cookie jar tới login.

## Đăng nhập

```http
POST /api/security-taxpayer/authenticate
Content-Type: application/json

{
  "username": "<MST>",
  "password": "<password>",
  "cvalue": "<captcha-text>",
  "ckey": "<captcha-key>"
}
```

Response thành công chứa token ở backend. Token/cookies không được trả từ Local API tới WebUI và không được ghi đĩa/log.

## Danh sách mua vào

```http
GET /api/query/invoices/purchase
  ?sort=tdlap:desc
  &size=<page-size>
  &search=tdlap=ge=DD/MM/YYYYT00:00:00;tdlap=le=DD/MM/YYYYT23:59:59;ttxly==5
  &state=<optional-cursor>
Authorization: Bearer <redacted>
```

Response dùng `datas[]`, `total` và có thể có `state`. Connector chặn state lặp vô hạn.

Filter bổ sung được ghép bằng tên field đã biết; giá trị chứa `;`, `=` hoặc CR/LF bị từ chối để tránh chèn search expression.

## Chi tiết hóa đơn

Ảnh DevTools xác nhận request:

```http
GET /api/query/invoices/detail
  ?nbmst=<MST người bán>
  &khhdon=<ký hiệu>
  &shdon=<số hóa đơn>
  &khmshdon=<mẫu số>
Accept: application/json, text/plain, */*
Authorization: Bearer <redacted>
Action: Xem%20h%C3%B3a%20%C4%91%C6%A1n%20(h%C3%B3a%20%C4%91i%E1%BB%87n%20t%E1%BB%AD)
```

`Action` phải là chuỗi ASCII percent-encoded; đưa Unicode thô vào HTTP header là không hợp lệ. Header `Action: xem-chi-tiet` trong ảnh thuộc **response**, không phải giá trị request.

Locator dùng bốn business key, không phụ thuộc duy nhất vào UUID `id`.

## Export XML/ZIP

```http
GET /api/query/invoices/export-xml
  ?nbmst=<MST người bán>
  &khhdon=<ký hiệu>
  &shdon=<số hóa đơn>
  &khmshdon=<mẫu số>
Authorization: Bearer <redacted>
```

Theo tài liệu/capture connector, endpoint tên `export-xml` trả một ZIP. Vì vậy:

- `downloadZip()` giữ nguyên gói ZIP;
- `downloadXml()` kiểm tra ZIP rồi trích đúng `invoice.xml`;
- nếu không có canonical name, chỉ chấp nhận khi ZIP có đúng một `.xml`;
- từ chối path traversal, symlink entry, encrypted entry, quá nhiều entry và zip bomb theo size limit.

## Danh sách bán ra

Endpoint danh sách bán ra đã được capture và xác minh trả HTTP 200: `GET /api/query/invoices/sold`, với `sort=tdlap:desc`, `size=15` và biểu thức ngày trong `search`. Endpoint detail dùng chung `/api/query/invoices/detail`; export XML/ZIP dùng chung `/api/query/invoices/export-xml` với locator `nbmst`, `khhdon`, `shdon`, `khmshdon`.

Quy trình bổ sung:

1. Capture request bán ra từ phiên được ủy quyền.
2. Xóa token, Cookie, MST/số hóa đơn nhạy cảm khỏi fixture.
3. Xác minh method/path/query/headers/response pagination.
4. Nhập path dưới `/api/` trong Cài đặt.
5. Thêm contract test trước khi đánh dấu capability liveSales.

## Mức xác minh của release này

- Contract tests dùng mock `fetch` kiểm tra URL, payload, cookie jar, Authorization, header Action, cursor và ZIP/XML.
- Integration/E2E smoke dùng `MockGdtConnector` và không cần Internet.
- Chưa chạy live bằng credential GDT trong môi trường build này.

---

# Evidence bổ sung 12/09/2026 cho target v1.1.0

## POS detail — đã xác minh

```http
GET /api/sco-query/invoices/detail
  ?nbmst=<MST người bán>
  &khhdon=<ký hiệu>
  &shdon=<số hóa đơn>
  &khmshdon=<mẫu số>
```

Payload xác nhận:
- locator giống standard;
- `hdhhdvu[]` có line item;
- `thttltsuat[]` có thể có nhiều nhóm thuế;
- line `ttkhac[]` dùng `ttruong/kdlieu/dlieu`;
- `tthhdtrung[]` chứa metadata dòng;
- `tentvandnkntt` có thể dùng làm provider fallback;
- có `qrcode`.

POS detail không còn là capability chưa xác minh.

## Standard detail `ttxly=6` — đã xác minh

```http
GET /api/query/invoices/detail
  ?nbmst=<MST người bán>
  &khhdon=<ký hiệu>
  &shdon=<số hóa đơn>
  &khmshdon=<mẫu số>
```

Payload xác nhận:
- `mhdon`, `thdon` có thể null;
- `tlhdon` vẫn có;
- business locator vẫn đầy đủ;
- `hdhhdvu[]` là line source;
- line có thể có `dvtte`, `tgia`.

## POS export XML/ZIP — path mới được cung cấp

```text
/api/sco-query/invoices/export-xml
  ?nbmst=<MST người bán>
  &khhdon=<ký hiệu>
  &shdon=<số hóa đơn>
  &khmshdon=<mẫu số>
```

Thông tin mới mô tả request là **POST**.

Chưa có đủ capture để xác minh:
- request body;
- required headers;
- response MIME;
- ZIP hay XML trực tiếp;
- filename.

Target v1.1.0 nên tách export transport theo source/method và chỉ bật capability POS export sau response capture/test hoàn chỉnh.
