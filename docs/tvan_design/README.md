# TVAN Design & Source Reference

Thư mục này gom tài liệu thiết kế, flow NCC HDDT/TVAN và snapshot mã nguồn liên quan để review/audit tập trung.

## Cấu trúc

```text
docs/tvan_design/
├── README.md
├── SHA256SUMS.txt
├── design/
│   ├── kiến trúc Presentation/TVAN
│   ├── flow MISA / M-Invoice / SoftDreams / Viettel
│   ├── TVAN Catalog
│   └── thiết kế, implementation, inventory và báo cáo Thái Sơn
└── source/
    ├── runtime/
    │   └── snapshot source production liên quan TVAN/Presentation
    └── tests/
        └── snapshot unit/integration tests liên quan
```

## Quy tắc quan trọng

- `source/` là **snapshot tham chiếu** tại thời điểm tạo tài liệu.
- Source production thật vẫn nằm tại `src/...`; build/runtime **không import** code trong `docs/tvan_design/source/`.
- Khi sửa adapter/runtime, phải sửa source thật trước, chạy test, sau đó refresh snapshot nếu cần.
- Không dùng snapshot này làm nguồn deploy.
- Không đưa cookie/token/CAPTCHA answer/HAR chưa sanitize vào thư mục này.

## Provider adapters trong snapshot

- `tvan_misa`
- `tvan_invoice` (M-Invoice)
- `tvan_softdreams`
- `tvan_viettel`
- `ehoadondientu`
- `tvan_vnpt`
- `tvan_acman`
- `tvan_pvoil`
- `tvan_fast`
- `tvan_thaison`

## Tài liệu Thái Sơn chính

- `design/HDDT_CONN_THAISON_PRESENTATION_DESIGN.md`
- `design/HDDT_CONN_THAISON_FULL_TECHNICAL_REPORT.md`
- `design/THAISON_EINVOICE_PDF_IMPLEMENTATION.md`
- `design/THAISON_EINVOICE_CHANGE_INVENTORY_20260928.md`

## Refresh source snapshot

Ví dụ:

```bash
rm -rf docs/tvan_design/source/runtime/src/server/tvan
cp -a src/server/tvan docs/tvan_design/source/runtime/src/server/tvan
```

Sau khi refresh, cập nhật lại `SHA256SUMS.txt`.
