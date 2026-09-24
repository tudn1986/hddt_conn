# Trạng thái nghiệm thu 1.3.0-rc.1

Đây là **release candidate để triển khai trên môi trường staging và nghiệm thu**, chưa được gắn nhãn production-ready tuyệt đối trên Internet.

## Đã kiểm chứng tự động

- TypeScript/lint, 130 tests, production build và application smoke test đều đạt.
- Hai browser session giả lập có cookie/CSRF/GDT context độc lập; logout một phiên không ảnh hưởng phiên kia.
- Dataset endpoint server bị khóa; XML/ZIP được stream; smoke test xác nhận không sinh business file trong server data root.
- Trang Cài đặt production chỉ còn chọn nơi lưu phía browser.

## Bắt buộc nghiệm thu trước khi public

- Build/chạy Compose thật, HTTPS/Caddy, read-only root, non-root, tmpfs và healthcheck trên Docker host.
- Test Chrome/Edge thật: chọn thư mục, reload/khôi phục quyền, lưu–mở lại dataset, fallback Downloads.
- Test race revoke TVAN có upstream chậm; theo dõi `/tmp` và xác nhận không còn artefact sau revoke/TTL.
- Load test nhiều phiên/batch đồng thời trong giới hạn 1 replica và 512 MB tmpfs; điều chỉnh `HDDT_TVAN_BATCH_MAX_BYTES`, `HDDT_MAX_SESSIONS` và memory limit.
- Xác nhận CIDR proxy thực tế, thay `172.16.0.0/12` bằng subnet Docker riêng hẹp nhất có thể.

Không mở dịch vụ public nếu chưa hoàn thành checklist trên. Docker CLI không có trên máy build hiện tại nên phần container/HTTPS chưa được kiểm chứng tại đây.
