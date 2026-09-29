*** hddt_conn v1.3.1 ***

BAN PHAT HANH DUOC DONG GOI TU MA NGUON DA KIEM THU TREN DEV 8288.

THAY DOI CHINH v1.3.1
- Cap nhat logo WebUI, favicon va icon ung dung Windows/macOS.
- Windows: double-click HDDT_CONN.exe de khoi dong ung dung.
- HDDT_CONN.exe su dung icon moi; system tray cung su dung icon hddt_conn moi.
- Start-HDDT.vbs va Start-HDDT.cmd duoc giu lam fallback/debug.
- Xem docs/RELEASE_NOTES_v1.3.1.md.

hddt_conn v1.3.1 — Portable release

WINDOWS
1. Khuyến nghị: double-click "HDDT_CONN.exe".
2. Server chạy ẩn; biểu tượng hddt-conn xuất hiện ở system tray.
3. Double-click biểu tượng tray để mở WebUI.
4. Right-click > "Thoát hddt-conn" để dừng server.
5. "Start-HDDT.vbs" và "Start-HDDT.cmd" vẫn được giữ làm launcher/fallback debug.

macOS
1. Khuyến nghị: double-click "Start HDDT.app".
2. Server chạy nền và WebUI mở trong trình duyệt; không mở cửa sổ Terminal.
3. Nút "Thoát" trong WebUI dừng server.
4. "Start HDDT.command" được giữ làm fallback/debug.

Lưu ý: macOS không có system tray theo mô hình Windows. Bản portable hiện chạy
headless để không chiếm màn hình. Nếu cần một menu-bar icon thường trực trên
macOS, nên đóng gói một native menu-bar controller riêng ở phiên bản sau.

TVAN PDF v1.2.1
- Nhấp đúp Số hóa đơn để xem bản thể hiện PDF.
- Chọn nhiều hóa đơn > "Tải PDF bản thể hiện" để tải ZIP theo P1/P2/P3.
- Menu "TVAN Backport" nhận raw JSON/XML cho TVAN chưa hỗ trợ.
- Mã tra cứu/MST/API/token được backend xử lý; người dùng chỉ nhập CAPTCHA khi cần.

Financial totals — source revision r5 (app version vẫn 1.2.1)
- Sửa Tiền HHDV/Tiền thuế cho hdon=02 và 06/06_01, gồm MISA/Viettel/FPT.
- Ngoại tệ ưu tiên trường ...OC; type 06 thiếu tổng ở list sẽ lấy từ detail HHDV.
- Dataset cũ được sửa lại các ô tài chính còn trống khi mở/import nếu raw payload đủ dữ liệu.

MISA supervised PDF link — source revision r6 (app version vẫn 1.2.1)
- Chi tiết hóa đơn > Tổng quan có card giám sát riêng cho tvan_misa.
- Nút "Xem bản thể hiện hóa đơn" chỉ gọi backend lấy customData và dựng link MISA; chưa tự tải PDF.
- Link DownloadHandler đầy đủ chỉ mở tab mới khi người dùng chủ động bấm, giúp xác nhận từng bước production.


Docker production — revision r12
- Dockerfile multi-stage Node 22.
- Portainer Stack: deploy/portainer-stack.yml.
- VM300 guide: docs/DOCKER_PORTAINER_VM300_v1.2.1-r12.md.
- Persistent data: /data/app + /data/files mapped from /opt/hddt_conn/data on host.
- Docker mode uses explicit HDDT_ALLOWED_ORIGINS, fixed port and no browser auto-launch.
