# Profile MISA AMIS

## Trạng thái

Release có hai profile nền:

- `amis-foundation-v1`: mua vào, đối tượng lấy từ người bán.
- `amis-sales-foundation-v1`: bán ra, đối tượng lấy từ người mua.

Đây là minh họa hoàn chỉnh cho engine mapping/validation, **không phải template import AMIS chính thức**. Không dùng cho hạch toán production trước khi so khớp với workbook mẫu do phiên bản AMIS mục tiêu xuất ra.

## Contract profile

```ts
interface ExportProfile {
  id: string;
  name: string;
  version: string;
  documentDirection?: 'purchase' | 'sales';
  sheets: Array<{
    name: string;
    columns: Array<{
      targetColumn: string;
      source: string;
      type: 'text' | 'number' | 'date' | 'vat-rate';
      required?: boolean;
      transform?: Array<'trim' | 'uppercase' | 'lowercase' | `default:${string}`>;
    }>;
  }>;
}
```

`source` hỗ trợ:

- normalized path: `seller.taxCode`, `issueDate`, `grandTotal`;
- dynamic field: `dynamic:<section>:<name>`.

Engine:

- validate direction;
- báo dòng/cột khi thiếu required;
- validate number/date;
- format identifier/text đúng kiểu Excel;
- escape formula injection;
- freeze header và auto-filter.

## Quy trình thay bằng template thật

1. Nhận file mẫu từ đúng phân hệ/phiên bản AMIS.
2. Lưu một bản fixture đã loại dữ liệu nhạy cảm.
3. Xác định sheet/header bắt buộc, enum, định dạng ngày/số và quy tắc đối tượng.
4. Tạo profile version mới; không sửa ngầm profile cũ đã phát hành.
5. Bổ sung fixture test so sánh tên sheet, thứ tự/header, type và các case thiếu dữ liệu.
6. Test mua vào/bán ra riêng; xác minh import trong môi trường AMIS thử nghiệm.
7. Chỉ sau đó đổi nhãn UI từ “mapping nền” sang “import-ready” cho profile/version đó.

Không hard-code lookup URL hoặc suy diễn field portal chưa có bằng chứng chỉ để lấp cột AMIS.
