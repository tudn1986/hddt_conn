# HDDT v1.1.0 — Implementation: Tooltip/Popover quan hệ hóa đơn thay thế / điều chỉnh

## Phạm vi

Triển khai hiển thị quan hệ trực tiếp tại hai cột **Số hóa đơn** và **Tình trạng hóa đơn** theo tài liệu thiết kế `Thiết kế hiển thị quan hệ hóa đơn thay thế - điều chỉnh.md`.

Các quan hệ hỗ trợ:

- Hóa đơn mới **thay thế cho** hóa đơn gốc.
- Hóa đơn mới **điều chỉnh cho** hóa đơn gốc.
- Hóa đơn gốc **bị thay thế bởi** hóa đơn mới.
- Hóa đơn gốc **bị điều chỉnh bởi** một hoặc nhiều hóa đơn.

## Invariant mạng

Popover chỉ đọc dữ liệu đã có trong RAM:

```text
Hover       → 0 API request
Focus       → 0 API request
Click mở    → 0 API request
```

Không có `api.getInvoice()` trong relation component và không có `useEffect(open) => fetch(...)`.

## Kiến trúc

```text
GDT payload
    │
    ▼
normalizeInvoiceRelation()
    │
    ▼
InvoiceDocument.relation        (forward: child → original)
    │
    ├───────────────┐
    ▼               ▼
Business Index   Reverse Relation Index
    │               │
    └───────┬───────┘
            ▼
RelationTooltipViewModel
            │
      ┌─────┴─────┐
      ▼           ▼
Số hóa đơn    Tình trạng
      │           │
      └─────┬─────┘
            ▼
InvoiceRelationPopover
```

Business key:

```text
sellerTaxCode | templateNo | series | invoiceNo
```

Nếu một locator khớp nhiều record, UI đánh dấu **Không xác định duy nhất** và không tự chọn hóa đơn.

## UX

### Cột Số hóa đơn

Ví dụ:

```text
116 ↗
109 ↘
```

- `↗`: hóa đơn hiện tại trỏ tới hóa đơn gốc (replacement / adjustment).
- `↘`: hóa đơn hiện tại là hóa đơn gốc và có hóa đơn khác tác động lên nó.

### Cột Tình trạng

Badge trạng thái hiện tại là trigger của cùng ViewModel với cột Số hóa đơn để đảm bảo hai cột luôn hiển thị cùng một quan hệ.

### Nội dung popover

Hiển thị:

- Số hóa đơn liên quan.
- Ký hiệu.
- Mẫu số.
- Ngày lập theo `Asia/Ho_Chi_Minh`.
- Trạng thái có/không có trong dataset.
- `gchdgoc` tối đa 3 dòng.

Nếu hóa đơn liên quan có trong dataset, item có thể click để mở `InvoiceDrawer` hiện tại. Click này cũng không gọi API.

Nếu có nhiều điều chỉnh, hiển thị tối đa 3 hóa đơn trực tiếp và dòng `+ N hóa đơn khác`.

## File nguồn

### Mới

```text
src/shared/invoice-relations/keys.ts
src/shared/invoice-relations/normalize-relation.ts
src/shared/invoice-relations/relation-index.ts
src/shared/invoice-relations/relation-view-model.ts
src/shared/invoice-relations/index.ts
src/web/components/invoices/InvoiceRelationPopover.tsx
src/web/components/invoices/InvoiceRelationContent.tsx
tests/unit/invoice-relations.test.ts
```

### Hiệu chỉnh

```text
src/shared/normalizer/index.ts
src/web/pages/InvoicePage.tsx
src/web/invoice-page.css
```

## Hiệu năng

```text
normalize relation       O(n)
build business index     O(n)
build reverse index      O(n)
build view models        O(n)
hover/focus/click lookup O(1)
```

Index chỉ rebuild khi `documents` thay đổi, bao gồm sau incremental merge. Sort/filter không làm rebuild vì chúng chỉ tác động view.

## Trường hợp biên

- Original ngoài dataset: vẫn hiển thị locator forward; không coi là lỗi.
- Status 4/5 nhưng child ngoài dataset: hiển thị thông báo chưa có dữ liệu liên quan.
- Locator trùng nhiều record: không tự chọn.
- Relation locator thiếu: normalizer bỏ relation; row vẫn render bình thường.
- Chuỗi relation chỉ hiển thị quan hệ trực tiếp, không tự suy diễn quan hệ bắc cầu.

## Kiểm thử

Unit test bao phủ:

- normalize replacement.
- locator thiếu.
- business key 4 thành phần.
- forward + reverse replacement.
- original ngoài dataset.
- multiple adjustment.
- status 4/5 nhưng reverse relation chưa có.
- ambiguous locator.
- timezone `2026-08-29T17:00:00Z → 30/08/2026`.
