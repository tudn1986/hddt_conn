# HDDT v1.1.0 — Thiết kế lại thanh tra cứu, tác vụ dữ liệu, hàng tổng hợp và sửa độ rộng bảng hóa đơn

## 1. Phạm vi hiệu chỉnh

Bản hiệu chỉnh này xử lý bốn vấn đề quan sát được sau khi áp dụng phiên bản responsive trước:

1. cột mở chi tiết `+` vẫn có thể bị Ant Design/browser kéo giãn, tạo vùng trắng lớn ở **đầu bảng**;
2. thanh tra cứu chiếm nhiều chiều cao và chứa hai nhóm lựa chọn kỹ thuật không cần xuất hiện thường xuyên: **Nguồn hóa đơn** và **ttxly**;
3. các nút lưu/mở/xuất dữ liệu làm thanh tra cứu bị dài và chia thành hai hàng;
4. hàng tổng hợp chiếm nhiều chiều cao do mỗi nhóm tiền tệ dùng một `Card head` riêng.

Mục tiêu là tăng diện tích hiển thị bảng dữ liệu, giữ thao tác chính gần bộ lọc, tách rõ **điều hướng chương trình** và **tác vụ dữ liệu**, đồng thời khóa chắc chắn chiều rộng cột điều khiển của Ant Design Table.

---

## 2. Bố cục mục tiêu

### 2.1. Hàng menu trên cùng

Hàng menu được chia thành hai nhóm thị giác nhưng nằm cùng một cao độ:

```text
┌──────────────────── Điều hướng chương trình ────────────────────┬──────────── Tác vụ dữ liệu ────────────┐
│ Mua vào | Bán ra | Tải hóa đơn XML | Kết xuất Form PMKT | Cài đặt │ Lưu dữ liệu | Mở dữ liệu | Xuất Excel │
│                                                                    │ Xếp hàng XML | Xóa lọc | Kết quả      │
└────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────┘
```

Nhóm tác vụ dữ liệu dùng nền xanh rất nhạt và đường biên riêng để người dùng nhận biết đây không phải tab điều hướng.

Ở màn hình HD, toàn bộ hàng menu cho phép **horizontal scroll nhẹ** nếu không đủ chỗ, thay vì wrap làm tăng chiều cao giao diện.

### 2.2. Thanh điều kiện tra cứu

Ẩn khỏi giao diện hai nhóm lựa chọn:

- `HĐĐT thường`, `Máy tính tiền`;
- `ttxly = 5`, `ttxly = 6`, `ttxly = 8`.

Logic tra cứu vẫn giữ mặc định nghiệp vụ:

```ts
statuses = ['5', '6', '8']
purchase sources = ['standard', 'pos']
sales sources = ['standard']
```

Thanh tra cứu mới:

```text
[Khoảng ngày] [Loại/mẫu số] [MST đối tác] [Số hóa đơn] [Ký hiệu]
[Tra cứu] [Lấy chi tiết HHDV] [Lấy chi tiết HHDV tất cả] [Lọc nhanh...]
```

Trên Full HD/2K các phần tử thường nằm trên một hàng. Trên HD/HD+ trình duyệt được phép wrap hợp lý ở khu vực nút hoặc lọc nhanh, nhưng không tạo một hàng tác vụ dữ liệu riêng như phiên bản trước.

### 2.3. Hàng tổng hợp

Không dùng `Card title/head` cho từng ô tiền nữa. Tiêu đề được đặt trực tiếp trong body card.

Mục tiêu chiều cao:

- khoảng `64–72px` trên desktop;
- vẫn hiển thị được hai loại tiền phổ biến, ví dụ VND và USD;
- nếu có nhiều loại tiền hơn, chỉ phần danh sách tiền có scroll nhỏ bên trong.

Mô phỏng:

```text
┌ Đang hiển thị số HĐ ┐ ┌ Đã có chi tiết HHDV ┐ ┌ Tiền trước thuế ───────┐ ┌ Tiền VAT ─────────────┐ ┌ Tổng thanh toán ─────┐
│ 226  / 226 dataset   │ │ 222                  │ │ USD       698.080,66   │ │ USD                  0 │ │ USD      1.372.873,32 │
│                      │ │                      │ │ VND    2.686.139.533   │ │ VND          3.582.840 │ │ VND    2.868.040.009 │
└──────────────────────┘ └──────────────────────┘ └────────────────────────┘ └────────────────────────┘ └────────────────────────┘
```

---

## 3. Sửa triệt để vùng trắng bất hợp lý ở đầu bảng

### 3.1. Hiện tượng thực tế

Ảnh kiểm tra cho thấy nút `+` nằm gần giữa vùng trắng rộng hàng trăm pixel, sau đó mới tới checkbox và các cột dữ liệu. Điều này chứng tỏ phần width dư vẫn đang bị cấp cho **expand column** do Ant Design tự sinh.

Phiên bản trước đã truyền:

```tsx
expandable.columnWidth
rowSelection.columnWidth
```

nhưng điều đó **chưa đủ** khi đồng thời có:

- table layout mặc định dạng `auto`;
- `virtual` table;
- expand/selection column do Ant Design sinh ngoài mảng `columns`;
- `fixed: 'left'` được bật kể cả khi bảng mặc định không hề overflow ngang.

Trong trường hợp đó, browser vẫn có quyền phân phối width dư khác với ma trận width mong muốn.

### 3.2. Giải pháp mới

Áp dụng đồng thời bốn lớp bảo vệ.

#### A. Ép table layout cố định

```tsx
<Table tableLayout="fixed" ... />
```

và CSS:

```css
.invoice-data-table .ant-table-container table,
.invoice-data-table .ant-table-content table,
.invoice-data-table .ant-table-body table {
  table-layout: fixed !important;
}
```

#### B. Khóa width ở cả `<col>` và cell

Table nhận CSS variables:

```tsx
style={{
  '--invoice-expand-width': `${tableLayout.expandWidth}px`,
  '--invoice-selection-width': `${tableLayout.selectionWidth}px`,
} as React.CSSProperties}
```

Sau đó ép `width/min-width/max-width` cho:

- `col.ant-table-expand-icon-col`;
- `col.ant-table-selection-col`;
- `.ant-table-row-expand-icon-cell`;
- `.ant-table-selection-column`.

Do đó expand column không thể nhận thêm phần width dư.

#### C. Không fixed cột điều khiển khi không cần

```tsx
const tableHasHorizontalOverflow =
  tableMetrics.intrinsicWidth > tableMetrics.viewportWidth;
```

Chỉ khi có overflow thật sự mới bật:

```tsx
expandable.fixed = 'left'
rowSelection.fixed = true
```

Với bộ cột mặc định thường vừa màn hình, hai cột điều khiển hoạt động như cột bình thường và không tạo layer fixed thừa.

#### D. Phần width dư chỉ được hấp thụ ở cuối bảng

`computeInvoiceTableMetrics()` tiếp tục tạo spacer kỹ thuật khi tổng width nghiệp vụ nhỏ hơn viewport.

Ví dụ vùng bảng Full HD khoảng `1888px`, tổng cột mặc định khoảng `1484px`:

```text
| +36 | □44 | Ngày100 | KH88 | Số105 | MST115 | Đối tác340 | ... | Trạng thái145 | spacer ~404 |
^                                                                                         ^
BẮT ĐẦU DỮ LIỆU NGAY Ở TRÁI                                           PHẦN DƯ NẰM Ở CUỐI BẢNG
```

Không còn bố cục sai:

```text
|               vùng trắng rất lớn +               | □ | Ngày | KH | ... |
```

---

## 4. Ma trận width nghiệp vụ

Ma trận width vẫn dùng theo chiều rộng thực của vùng bảng.

| Cột | HD `<1440` | HD+ `1440–1799` | 1080p `1800–2199` | 2K `>=2200` |
|---|---:|---:|---:|---:|
| `+` | 36 | 36 | 36 | 36 |
| Checkbox | 40 | 44 | 44 | 44 |
| Ngày | 92 | 96 | 100 | 100 |
| Ký hiệu | 72 | 80 | 88 | 90 |
| Số hóa đơn | 88 | 96 | 105 | 110 |
| MST | 104 | 110 | 115 | 120 |
| Tên đối tác | 220 | 260 | 340 | 420 |
| Loại tiền tệ | 72 | 80 | 86 | 90 |
| Tiền hàng | 112 | 125 | 140 | 150 |
| Tiền thuế | 104 | 115 | 130 | 140 |
| Tổng thanh toán | 128 | 140 | 155 | 165 |
| Tình trạng hóa đơn | 124 | 132 | 145 | 155 |

Các cột mã/ngày/tiền không được phóng đại theo màn hình. `Tên đối tác` là cột nhận nhiều không gian nhất vì dữ liệu văn bản dài.

---

## 5. Hành vi theo kích thước màn hình

### HD — khoảng 1366×768

- menu tác vụ dùng button `small`, nếu tổng width vượt màn hình thì scroll ngang tại chính hàng menu;
- thanh tra cứu dùng width input compact;
- có thể wrap phần `Lọc nhanh` xuống cuối nếu browser zoom hoặc viewport nhỏ;
- hàng tổng hợp khoảng 64–72px;
- bảng dùng profile HD, font 12px;
- expand 36px, checkbox 40px.

### HD+ — khoảng 1600×900

- phần lớn toolbar nằm một hàng;
- tên đối tác 260px;
- bảng mặc định không cần horizontal scroll.

### Full HD — 1920×1080

- toolbar và ba nút nghiệp vụ chính nằm cùng hàng với bộ lọc;
- tên đối tác 340px;
- các cột tiền 130–155px;
- phần dư chuyển về cuối bảng.

### 2K — 2560×1440

- không scale font theo màn hình;
- tên đối tác tối đa 420px theo profile;
- các cột mã vẫn giữ width hữu hạn;
- khoảng dư còn lại ở cuối bảng, không kéo giãn `+`, checkbox, ngày, MST hoặc tiền tệ.

---

## 6. Thay đổi mã nguồn

### `src/web/App.tsx`

- thêm vùng `app-data-actions` trên cùng hàng với `Menu`;
- nhận `InvoiceMenuActions` do `InvoicePage` đăng ký;
- chuyển các nút:
  - **Lưu JSON** → **Lưu dữ liệu**;
  - **Mở JSON** → **Mở dữ liệu**;
  - **Xuất Excel**;
  - **Xếp hàng XML đã chọn** → **Xếp hàng XML (n)**;
  - **Xóa bộ lọc cột** → **Xóa lọc**;
  - **Kết quả gần nhất** → **Kết quả**;
- dùng nền riêng cho nhóm tác vụ dữ liệu.

### `src/web/pages/InvoicePage.tsx`

- thêm interface `InvoiceMenuActions`;
- đăng ký callbacks lên `App` bằng proxy ổn định qua `useRef`;
- ẩn hai selector `sources` và `statuses`;
- cố định query mặc định `sources/statuses` trong logic `queryAuto`;
- đổi nhãn:
  - `Tra cứu tự động` → `Tra cứu`;
  - `Lấy chi tiết đã chọn` → `Lấy chi tiết HHDV`;
  - `Lấy chi tiết tất cả` → `Lấy chi tiết HHDV tất cả`;
- đặt ba nút trên ngay sau `Số hóa đơn` và `Ký hiệu`;
- rút gọn hàng tổng hợp bằng `CompactCountSummary` và `CurrencySummary` không có card head;
- thêm `tableLayout="fixed"`;
- chỉ fixed expand/selection khi bảng overflow thật sự;
- truyền CSS variables khóa width control columns.

### `src/web/invoice-page.css`

- bố cục menu 2 nhóm;
- nền riêng cho nhóm tác vụ dữ liệu;
- width compact cho input tra cứu;
- summary card 64–72px;
- khóa `<col>`/cell của expand và selection;
- ép `table-layout: fixed`;
- responsive override cho HD.

`src/web/pages/invoice-table-layout.ts` không cần đổi thuật toán trong lượt này; ma trận width và spacer cuối bảng được giữ lại, nhưng giờ được browser thực thi đúng nhờ fixed layout và khóa width ở DOM table thực tế.

---

## 7. Tiêu chí nghiệm thu

1. Với bộ cột mặc định, nút `+` phải nằm sát mép trái bảng và cột của nó chỉ khoảng 36px.
2. Checkbox nằm ngay sau cột `+`, width 40–44px.
3. Không còn vùng trắng lớn trước checkbox.
4. Nguồn hóa đơn và ttxly không còn xuất hiện trên thanh tra cứu.
5. `Tra cứu`, `Lấy chi tiết HHDV`, `Lấy chi tiết HHDV tất cả` nằm sau `Số hóa đơn`, `Ký hiệu`.
6. `Lưu dữ liệu`, `Mở dữ liệu`, `Xuất Excel` xuất hiện trên hàng menu chính và được phân biệt bằng nền nhóm khác.
7. `Xếp hàng XML` trên menu phải disable khi chưa chọn hóa đơn hoặc chưa đăng nhập.
8. `Xóa lọc` xóa cả lọc nhanh và các filter trên header cột.
9. Hàng tổng hợp thấp hơn rõ rệt so với bản trước nhưng vẫn đọc đủ VND/USD.
10. Khi bật nhiều cột vượt viewport, horizontal scroll xuất hiện và `+`/checkbox mới chuyển sang fixed-left.
11. HD, HD+, 1080p và 2K không làm các cột mã/ngày bị phóng đại vô nghĩa.

