# Release notes — hddt_conn v1.3.1-2

Bản vá dữ liệu lớn: sửa lỗi dataset lưu được nhưng không mở lại được, giảm thời gian/bộ nhớ khi lưu và xuất Excel.
Không đổi API, định dạng nghiệp vụ hay giao diện.

> Lưu ý semver: `1.3.1-2` là bản pre-release nên về mặt thứ tự semver nhỏ hơn `1.3.1`.

## Sửa lỗi

### Dataset lưu được nhưng không mở lại được
- Khi lưu, kích thước được đo trên JSON **nén**; file thực ghi ra lại là JSON **thụt lề** (lớn hơn 1,6–1,9 lần), còn khi mở thì so kích thước file thật với cùng giới hạn (mặc định 200 MB).
- Hệ quả: với khoảng 22.700–36.000 hóa đơn mỗi kỳ, dataset lưu thành công nhưng báo `DATASET_TOO_LARGE` khi mở lại (đo thực tế: 24.000 hóa đơn → file 212 MB, không mở được).
- Đã sửa: dataset giờ ghi JSON nén, đo đúng kích thước sẽ ghi, và dùng cùng giới hạn khi mở. Dataset cũ (thụt lề) vẫn mở được, chấp nhận tối đa 2× giới hạn cấu hình.

## Hiệu năng và bộ nhớ

Đo trên docker1 (Linux), cùng mã server, dữ liệu giả lập ~5,6 KB/hóa đơn × 5 dòng, heap Node 2 GB. Thời gian dao động do máy dùng chung.

| Hạng mục | v1.3.1-1 | v1.3.1-2 |
|---|---|---|
| File dataset 10.000 hóa đơn | 88,2 MB | 56,7 MB (−36%) |
| Lưu dataset 10.000 hóa đơn | 5,9 s; RSS đỉnh 686 MB | 3,8 s; RSS đỉnh 588 MB |
| Mở dataset 10.000 hóa đơn | 4,0 s; RSS đỉnh 967 MB | 2,9 s; RSS đỉnh 664 MB |
| Dataset 24.000 hóa đơn | lưu OK, **mở lỗi** (212 MB) | lưu 7,7 s, mở 6,7 s (137 MB) |
| Xuất báo cáo Excel 20.000 hóa đơn | 30,8 s; RAM tăng 1,83 GB; RSS đỉnh 2,6 GB | 28,3 s; RAM tăng 0,44 GB; RSS đỉnh 1,2 GB |

### Thay đổi
- `dataset.service.ts`: tuần tự hóa đúng một lần (trước đây hai lần cộng một lần parse lại), không clone phần raw rồi bỏ đi; `atomicWriteText` mới trong `shared/utils`.
- `excel-report.ts`, `profile-engine.ts`: dùng ExcelJS `WorkbookWriter` (streaming) qua `export/xlsx-stream.ts`. Bộ nhớ không còn tăng theo số dòng; bố cục giữ nguyên (xem bên dưới).
- `atomicWriteJson` (cài đặt, tải xuống…) giữ nguyên hành vi.

### Khác biệt có chủ đích của file Excel
- Đã so sánh từng ô giữa v1.3.1-1 và v1.3.1-2 trên cả 3 báo cáo (báo cáo chung, AMIS mua vào, AMIS bán ra): giá trị, định dạng văn bản `@`, in đậm/nền tiêu đề, độ rộng cột, dòng cố định, bộ lọc và số dòng/cột giống hệt.
- Khác: ô chuỗi rỗng không còn được ghi thành ô riêng (hiển thị vẫn là ô trống).
- Khác: file lớn hơn khoảng 30% vì chuỗi được ghi trực tiếp thay vì bảng chuỗi dùng chung (đổi lấy bộ nhớ thấp).

## Kiểm thử
- Mới `tests/unit/dataset-size-limits.test.ts` (5 test): ghi nén một dòng; mở lại được mọi dataset đã lưu kể cả khi bản thụt lề sẽ vượt giới hạn; mở được dataset cũ trong ngưỡng cho phép; từ chối file vượt ngưỡng mà không parse; từ chối lưu khi vượt giới hạn và không để lại file.
- Mới `tests/unit/export-streaming.test.ts` (4 test): bố cục báo cáo, đủ số dòng với 1.200 hóa đơn, tập rỗng dòng/thuế, lỗi profile không làm hỏng lần xuất sau.

## Chưa xử lý
- Lưu dataset lớn vẫn chặn tiến trình server vài giây (≈3,5 s với 10.000 hóa đơn, ≈7 s với 24.000) do `JSON.stringify` và kiểm tra schema chạy đồng bộ. Khay hệ thống Windows có thể coi server không phản hồi nếu bị chặn quá ~6–10 s; cần chỉnh `HDDT-Tray.ps1` riêng.
- Launcher chưa đặt `--max-old-space-size`; heap theo mặc định của Node theo RAM máy.
- Gói Windows vẫn gồm ~7.600 file.
