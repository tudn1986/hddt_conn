# Thiết kế bảng thông tin hóa đơn responsive — HDDT v1.1.0

## 1. Mục tiêu

Tài liệu này mô tả phương án trình bày bảng **Thông tin hóa đơn** theo hướng:

- giữ đúng nhóm cột mặc định đã thống nhất;
- phân bổ chiều rộng theo **loại dữ liệu nghiệp vụ**, không chia đều theo `%`;
- xử lý tốt trên các nhóm màn hình máy tính HD, HD+, Full HD/1080p và 2K;
- không để cột mở chi tiết `+` hoặc cột chọn hóa đơn tự giãn và chiếm khoảng trắng lớn;
- hạn chế horizontal scroll khi chỉ dùng bộ cột mặc định;
- khi người dùng bật thêm nhiều cột, cho phép horizontal scroll có kiểm soát;
- giữ `virtual` table để không làm tăng tải render khi dataset lớn;
- số tiền, ngày, mã số thuế, số hóa đơn có cách căn chỉnh và typography phù hợp;
- tên đối tác là cột văn bản dài duy nhất được ưu tiên không gian và được phép hiển thị tối đa 2 dòng.

## 2. Vấn đề của giao diện trước khi hiệu chỉnh

Ảnh kiểm tra sau vòng responsive đầu tiên cho thấy vùng trống lớn vẫn xuất hiện ở phía trái: nút `+` nằm giữa một cột rất rộng rồi mới tới checkbox và các cột dữ liệu. Điều này xác nhận chỉ truyền `expandable.columnWidth`/`rowSelection.columnWidth` là chưa đủ.

Nguyên nhân thực tế là tổ hợp `table-layout: auto`, virtual table và các cột expand/selection do Ant Design sinh ngoài mảng `columns`; đồng thời phiên bản trước luôn bật fixed-left cho hai cột điều khiển. Browser vẫn có thể phân phối phần width dư cho expand column.

Vòng hiệu chỉnh mới áp dụng đồng thời: `tableLayout="fixed"`, khóa width ở cả `<col>` và cell bằng CSS variable, chỉ fixed-left khi có overflow thật sự, và tiếp tục dùng spacer ở **cuối bảng**. Chi tiết triển khai mới xem `docs/INVOICE_UI_COMPACT_TOOLBAR_TABLE_FIX_v1.1.0.md`.

## 3. Bộ cột mặc định

Bảng mặc định hiển thị theo thứ tự:

1. cột mở chi tiết `+` — luôn hiển thị;
2. checkbox chọn hóa đơn — luôn hiển thị;
3. Ngày;
4. Ký hiệu;
5. Số hóa đơn;
6. MST bán / MST mua tùy chiều dữ liệu;
7. Tên đối tác;
8. Loại tiền tệ;
9. Tiền hàng;
10. Tiền thuế;
11. Tổng tiền thanh toán;
12. Tình trạng hóa đơn.

Các cột khác tiếp tục nằm trong menu **Cột hiển thị** và chỉ render khi người dùng bật.

## 4. Nguyên tắc phân bổ chiều rộng

### 4.1. Không dùng phần trăm cho cột nghiệp vụ

Không dùng kiểu:

```tsx
width: '8%'
```

vì cùng một trường `Ngày` hoặc `MST` không cần thay đổi width theo tỷ lệ 1366 → 2560 px.

Mỗi profile có width pixel cụ thể. Breakpoint không dựa trực tiếp vào `window.screen.width`, mà dựa vào **chiều rộng thực tế của vùng chứa bảng**. Cách này vẫn đúng khi:

- browser không maximize;
- hệ điều hành dùng display scaling;
- người dùng chia đôi màn hình;
- app có thay đổi padding hoặc side panel trong tương lai.

### 4.2. Breakpoint triển khai

| Profile | Width thực tế vùng bảng | Mục tiêu |
|---|---:|---|
| HD / Compact | `< 1440px` | tiết kiệm chiều ngang, font/padding nhỏ hơn |
| HD+ / Standard | `1440–1799px` | cân bằng mật độ và khả năng đọc |
| 1080p / Comfortable | `1800–2199px` | bố cục desktop chính, Tên đối tác rộng hơn |
| 2K / Wide | `>= 2200px` | giữ giới hạn width hợp lý, phần dư nằm bên phải |

Với layout ứng dụng hiện tại có `Content padding: 16px` hai bên, khi app maximize thì gần tương ứng:

- 1366×768 → vùng bảng khoảng 1334px → HD;
- 1600×900 → khoảng 1568px → HD+;
- 1920×1080 → khoảng 1888px → 1080p;
- 2560×1440 → khoảng 2528px → 2K.

## 5. Ma trận chiều rộng cột

### 5.1. Các cột mặc định

Đơn vị: pixel.

| Cột | HD | HD+ | 1080p | 2K | Căn chỉnh / quy tắc |
|---|---:|---:|---:|---:|---|
| Mở chi tiết `+` | 36 | 36 | 36 | 36 | cố định, center |
| Checkbox | 40 | 44 | 44 | 44 | cố định, center |
| Ngày | 92 | 96 | 100 | 100 | center, 1 dòng |
| Ký hiệu | 72 | 80 | 88 | 90 | 1 dòng + ellipsis |
| Số hóa đơn | 88 | 96 | 105 | 110 | 1 dòng + ellipsis |
| MST đối tác | 104 | 110 | 115 | 120 | 1 dòng + ellipsis |
| Tên đối tác | 220 | 260 | 340 | 420 | tối đa 2 dòng + tooltip |
| Loại tiền tệ | 72 | 80 | 86 | 90 | center, 1 dòng |
| Tiền hàng | 112 | 125 | 140 | 150 | right, tabular nums |
| Tiền thuế | 104 | 115 | 130 | 140 | right, tabular nums |
| Tổng tiền thanh toán | 128 | 140 | 155 | 165 | right, tabular nums, semibold |
| Tình trạng hóa đơn | 124 | 132 | 145 | 155 | Tag 1 dòng + tooltip |

### 5.2. Các cột tùy chọn

| Cột | HD | HD+ | 1080p | 2K |
|---|---:|---:|---:|---:|
| Nguồn | 100 | 108 | 112 | 112 |
| Loại HĐ | 112 | 120 | 128 | 130 |
| Mẫu số | 82 | 88 | 92 | 96 |
| Trạng thái xử lý | 120 | 130 | 140 | 150 |
| TVAN | 110 | 120 | 135 | 145 |
| Mã tra cứu | 100 | 110 | 120 | 140 |
| Detail | 90 | 96 | 100 | 110 |
| Thao tác xem | 64 | 68 | 70 | 74 |

## 6. Giải pháp chống giãn sai cột

Đây là phần quan trọng nhất của phương án.

### 6.1. Khóa width cho hai cột do Ant Design tự sinh

`expandable.columnWidth` luôn được gán `36px`.

`rowSelection.columnWidth` được gán `40px` hoặc `44px` theo profile.

Do đó phần width dư không còn có thể bị dồn vào cột `+` hoặc checkbox.

### 6.2. Tính width theo tổng cột thực tế

Helper `computeInvoiceTableMetrics()` tính:

```text
controlsWidth = expandWidth + selectionWidth
visibleColumnsWidth = tổng width các cột người dùng đang bật
intrinsicWidth = controlsWidth + visibleColumnsWidth
```

Nếu:

```text
intrinsicWidth > viewportWidth
```

thì:

- `scroll.x = intrinsicWidth`;
- không tạo spacer;
- horizontal scroll xuất hiện.

Nếu:

```text
intrinsicWidth <= viewportWidth
```

thì:

- tạo một **layout spacer column** trống ở cuối bảng;
- spacer chỉ nhận đúng phần width còn dư;
- các cột dữ liệu giữ nguyên width nghiệp vụ;
- cột expand/checkbox không bị kéo giãn;
- trên 2K phần dư nằm rõ ràng ở bên phải bảng thay vì làm `Ngày`, `MST`, `VND` hoặc cột `+` trở nên vô lý.

Cột spacer là cột kỹ thuật, không xuất hiện trong menu **Cột hiển thị**, không chứa dữ liệu và không nhận tương tác.

## 7. Quy tắc typography và căn chỉnh

### 7.1. Ngày

- một dòng;
- center;
- width gần đúng với chuỗi `YYYY-MM-DD`;
- dùng `font-variant-numeric: tabular-nums`.

### 7.2. Ký hiệu, số hóa đơn, MST

Đây là identifier, không phải số dùng để tính toán.

- giữ một dòng;
- không wrap;
- ellipsis khi vượt width;
- tooltip hiển thị đầy đủ khi hover;
- không thêm separator số.

### 7.3. Tên đối tác

- là cột text dài được ưu tiên width;
- tối đa 2 dòng;
- line clamp;
- tooltip hiển thị tên đầy đủ;
- row vẫn có chiều cao kiểm soát được.

### 7.4. Loại tiền tệ

- center;
- không wrap;
- width nhỏ, ổn định.

### 7.5. Tiền hàng, tiền thuế, tổng thanh toán

- căn phải;
- không wrap;
- `font-variant-numeric: tabular-nums` để chữ số thẳng cột;
- `Tổng tiền thanh toán` dùng font weight cao hơn một mức để tạo phân cấp thị giác.

### 7.6. Tình trạng hóa đơn

- Tag không wrap;
- max-width theo cột;
- ellipsis khi cần;
- tooltip luôn có nhãn đầy đủ.

## 8. Mật độ hàng theo profile

| Profile | Font bảng | Padding dọc | Min row height | Partner line-height |
|---|---:|---:|---:|---:|
| HD | 12px | 5px | 44px | 17px |
| HD+ | 13px | 5px | 44px | 17px |
| 1080p | 13px | 6px | 46px | 18px |
| 2K | 13px | 7px | 48px | 18px |

Không phóng font theo 2K. Màn hình lớn được dùng để tăng breathing room và width của cột text, không biến bảng dữ liệu thành giao diện phóng to.

## 9. Mô phỏng theo độ phân giải

Các mô phỏng dưới đây dùng bộ 10 cột mặc định và giả định app maximize.

### 9.1. HD — 1366×768

Vùng bảng ước tính sau padding: khoảng `1332px` dùng để tính nội bộ.

```text
|+36|□40|Ngày92|KH72|Số HĐ88|MST104|Tên đối tác220|TT72|Tiền hàng112|Thuế104|Tổng128|Trạng thái124| spacer ~140 |
```

Tổng width nghiệp vụ + control: khoảng `1192px`.

Kết quả:

- không horizontal scroll với bộ cột mặc định;
- compact density;
- tên đối tác vẫn đủ 2 dòng;
- phần dư nằm bên phải, không nằm trước checkbox.

### 9.2. HD+ — 1600×900

```text
|+36|□44|Ngày96|KH80|Số HĐ96|MST110|Tên đối tác260|TT80|Tiền hàng125|Thuế115|Tổng140|Trạng thái132| spacer ~252 |
```

Tổng intrinsic khoảng `1314px` trên viewport bảng khoảng `1566px`.

Kết quả:

- không scroll mặc định;
- cột partner rộng hơn HD;
- các cột tiền tăng vừa đủ để giảm cảm giác chật.

### 9.3. Full HD / 1080p — 1920×1080

```text
|+36|□44|Ngày100|KH88|Số HĐ105|MST115|Tên đối tác340|TT86|Tiền hàng140|Thuế130|Tổng155|Trạng thái145| spacer ~402 |
```

Tổng intrinsic khoảng `1484px` trên viewport bảng khoảng `1886px`.

Kết quả:

- đây là layout desktop chính;
- tên đối tác rộng 340px;
- số tiền dễ quét theo chiều dọc;
- vẫn còn vùng trống bên phải để giao diện không bị kéo giãn quá mức.

### 9.4. 2K — 2560×1440

```text
|+36|□44|Ngày100|KH90|Số HĐ110|MST120|Tên đối tác420|TT90|Tiền hàng150|Thuế140|Tổng165|Trạng thái155| spacer ~906 |
```

Tổng intrinsic khoảng `1620px` trên viewport bảng khoảng `2526px`.

Kết quả:

- các cột ngắn không bị phóng to;
- tên đối tác đạt 420px nhưng không tăng vô hạn;
- vùng trống chủ động nằm bên phải;
- khi bật thêm các cột như Nguồn, Loại HĐ, TVAN, Mã tra cứu..., phần trống này được sử dụng trước khi cần horizontal scroll.

## 10. Khi bật toàn bộ cột

Ở HD, tổng width toàn bộ 18 cột dữ liệu + 2 cột control khoảng `1970px`, lớn hơn viewport khoảng `1332px`.

Khi đó:

```text
spacerWidth = 0
scroll.x = intrinsicWidth
```

Hai cột điều khiển bên trái được `fixed: left`; cột `Thao tác xem` nếu bật vẫn `fixed: right`. Người dùng có thể cuộn phần thông tin ở giữa mà vẫn giữ khả năng chọn/mở/xem hóa đơn.

## 11. Giải pháp triển khai trong mã nguồn

### 11.1. `src/web/pages/invoice-table-layout.ts`

File mới chứa toàn bộ logic thuần về layout:

- `InvoiceColumnKey`;
- profile HD / HD+ / Full HD / 2K;
- width của từng cột;
- `resolveInvoiceTableLayout(viewportWidth)`;
- `computeInvoiceTableMetrics(visibleColumnKeys, viewportWidth)`.

Tách logic này khỏi component giúp:

- dễ review;
- dễ thay đổi width mà không sửa render logic;
- test breakpoint và scroll bằng unit test;
- tránh `InvoicePage.tsx` chứa thêm nhiều magic number.

### 11.2. `src/web/pages/InvoicePage.tsx`

Các thay đổi chính:

- đo `tableViewportWidth` bằng `ResizeObserver`;
- chọn profile dựa trên width thực tế;
- tất cả `column.width` lấy từ `columnWidths`;
- khóa `expandable.columnWidth`;
- khóa `rowSelection.columnWidth`;
- fixed cột expand và checkbox về bên trái;
- tạo spacer column kỹ thuật nếu còn width dư;
- tính `scroll.x` bằng helper;
- dùng tooltip + ellipsis cho identifier;
- các cell tiền có class riêng để căn phải/tabular;
- status Tag có tooltip;
- menu cột hiển thị profile hiện tại và width vùng bảng.

### 11.3. `src/web/invoice-page.css`

CSS bổ sung:

- CSS variables cho density từng profile;
- padding/header/row height responsive;
- loại bỏ rule ép checkbox `52px` cũ;
- ép control columns không hấp thụ width dư;
- style identifier, money, partner, status;
- style spacer column;
- giữ scrollbar hiện có.

### 11.4. `tests/unit/invoice-table-layout.test.ts`

Unit test mới kiểm tra:

- 1330px → HD;
- 1568px → HD+;
- 1888px → Full HD;
- 2528px → 2K;
- cột expand luôn 36px;
- selection chỉ 40–44px;
- bộ cột mặc định dùng spacer thay vì stretch;
- bật toàn bộ cột ở HD tạo horizontal scroll.

## 12. Tác động hiệu năng

Phương án không tăng tải dữ liệu backend.

Ở frontend:

- tiếp tục chỉ truyền **các cột đang bật** vào `columns`;
- `virtual` vẫn bật;
- spacer chỉ là một cột rỗng, không chứa component nghiệp vụ;
- `ResizeObserver` chỉ cập nhật khi kích thước container thay đổi;
- state width chỉ set khi giá trị mới khác giá trị cũ;
- không tạo listener theo từng row.

Vì vậy thay đổi chủ yếu là layout/UX, không làm thay đổi mô hình tải invoice data.

## 13. Tiêu chí nghiệm thu

### HD 1366×768

- không còn vùng trắng lớn trước checkbox;
- 10 cột mặc định nhìn được mà không horizontal scroll trong chế độ maximize thông thường;
- row cao khoảng 44px;
- partner tối đa 2 dòng;
- Tag trạng thái không wrap.

### HD+ 1600×900

- cột Tên đối tác khoảng 260px;
- tiền căn phải;
- không có cột ngắn bị giãn bất thường.

### 1080p 1920×1080

- layout dùng profile Comfortable;
- Tên đối tác khoảng 340px;
- width dư nằm bên phải bảng;
- không làm `Ngày`, `Ký hiệu`, `MST`, `Loại tiền tệ` phình theo viewport.

### 2K 2560×1440

- Tên đối tác tối đa khoảng 420px theo profile;
- phần width dư nằm bên phải;
- khi bật thêm cột, dùng phần width dư trước;
- chỉ xuất hiện horizontal scroll khi tổng width cột thực tế vượt viewport.

### Menu Cột hiển thị

- ô chọn hóa đơn và cột `+` không nằm trong danh sách bật/tắt;
- `Mặc định` trả về đúng 10 cột nghiệp vụ;
- `Hiện tất cả` hoạt động;
- menu hiển thị profile layout đang áp dụng để hỗ trợ kiểm thử.

## 14. File thay đổi

Production source:

```text
src/web/pages/InvoicePage.tsx
src/web/pages/invoice-table-layout.ts   # file mới
src/web/invoice-page.css
```

Test:

```text
tests/unit/invoice-table-layout.test.ts # file mới
```

Tài liệu:

```text
docs/INVOICE_TABLE_RESPONSIVE_DESIGN_v1.1.0.md
```

## 15. Kiểm tra đã thực hiện trong môi trường chỉnh sửa

Đã thực hiện:

- TypeScript syntax transpile đối với `InvoicePage.tsx`, helper layout và unit test mới;
- `tsc --strict --noEmit` riêng cho `invoice-table-layout.ts`;
- chạy trực tiếp logic helper để xác nhận breakpoint và số liệu `intrinsicWidth / spacerWidth / scrollX`;
- xác nhận với toàn bộ cột trên HD: `spacerWidth = 0` và `scrollX > viewportWidth`.

Không chạy được full `npm test` / `npm build` trong môi trường chỉnh sửa hiện tại vì project package không kèm `node_modules` và các dependency frontend như React/Ant Design không được cài tại runtime. Việc kiểm thử full build nên được chạy trên môi trường phát triển của dự án sau khi `npm/pnpm install` hoàn tất.
