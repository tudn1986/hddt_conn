# HDDT v1.2.1 — Hướng dẫn người dùng

> v1.2.1 bổ sung xem/tải **bản thể hiện PDF theo TVAN**, tải hàng loạt theo P1 → P2 → P3 và trang **TVAN Backport**. Luồng HĐĐT thường / Máy tính tiền, dataset, XML/ZIP và báo cáo từ v1.1.0 được giữ nguyên.

# Hướng dẫn người dùng HDDT v1.2.1

## 1. Khởi động

Giải nén trọn gói portable, rồi chạy `Start-HDDT.cmd` trên Windows hoặc chuột phải **Open** file `Start HDDT.command` trên macOS. Trình duyệt mở WebUI tại `127.0.0.1`; không mở port ra mạng LAN.

Lần đầu, vào **Cài đặt** để chọn `dataRoot`. Mỗi MST có một thư mục con trực tiếp trong đó.

## 2. Chọn kết nối và đăng nhập

Màn hình đăng nhập có hai lựa chọn:

- **GDT live**: nhập MST, mật khẩu và Captcha thật.
- **Demo / Mock**: MST hợp lệ bất kỳ, mật khẩu bất kỳ, Captcha `AB12`; không gọi GDT.

Checkbox chỉ nhớ **MST**. Ứng dụng không lưu mật khẩu, Captcha, Bearer token hoặc Cookie. Sau đăng nhập, header hiển thị MST và trạng thái connector.

Nếu phiên hết hạn, ứng dụng giữ dataset/task trong RAM, tạm dừng tác vụ liên quan và yêu cầu đăng nhập lại.

## 3. Tra cứu hóa đơn

Tại **Hóa đơn / Chứng từ**:

1. Chọn tab **Mua vào** hoặc **Bán ra**.
2. Chọn khoảng ngày và bộ lọc tùy chọn.
3. Bấm **Tra cứu**.
4. Dùng **Trang trước/Trang sau** để đi qua cursor API.
5. Có thể lọc nhanh dữ liệu đã tải bằng ô tìm kiếm cục bộ.

Với live, tab Bán ra sử dụng endpoint đã xác minh `/api/query/invoices/sold`. Detail và tải XML/ZIP dùng cùng locator hóa đơn như luồng mua vào.

## 4. Lấy và xem chi tiết

Chọn các dòng rồi bấm **Lấy chi tiết đã chọn**, hoặc dùng **Lấy chi tiết tất cả**. Drawer chi tiết gồm:

1. Tổng quan.
2. Người bán.
3. Người mua.
4. Hàng hóa/dịch vụ.
5. Thuế và tổng tiền.
6. Tra cứu/TVAN.
7. Trường mở rộng.
8. Raw JSON.

Nút **Dừng** ngừng nhận kết quả vào giao diện; request đang ở backend được phép kết thúc an toàn.

## 5. Xem bản thể hiện PDF theo TVAN

- **Nhấp đúp vào Số hóa đơn** để xem bản thể hiện PDF trong viewer của ứng dụng.
- Người dùng không nhập MST người bán, mã tra cứu, URL hay API. Backend lấy các trường này từ dữ liệu hóa đơn (`providerCode/ngcnhat`, `lookup`, trường mở rộng và raw payload).
- Với TVAN không yêu cầu CAPTCHA, PDF được tải trực tiếp.
- Với TVAN có CAPTCHA, ứng dụng chỉ hiển thị CAPTCHA cần thiết; sau khi xác thực backend giữ token trong RAM theo thời hạn của token.
- Token TVAN không được trả ra WebUI và không được lưu xuống disk.

Tải hàng loạt: tích chọn hóa đơn và bấm **Tải PDF bản thể hiện**. Hàng đợi xử lý theo thứ tự:

1. **P1** — TVAN không CAPTCHA.
2. **P2** — CAPTCHA một lần, token dùng lại cho nhiều hóa đơn.
3. **P3** — CAPTCHA từng hóa đơn; token bị xóa ngay sau lần tải hiện tại.

Kết quả được gom thành ZIP cùng `manifest.json`, trong đó ghi task thành công/thất bại mà không làm hỏng cả lô.

## 6. TVAN Backport

Mở menu **TVAN Backport** khi gặp nhà cung cấp chưa có adapter PDF. Dán raw JSON và/hoặc XML quan sát được từ DevTools, nhập mã TVAN rồi chọn **Phân tích** hoặc **Lưu mẫu backport**.

Backend chỉ phân tích/lưu cục bộ payload; các URL nằm trong payload không được thực thi như proxy. Mẫu được dùng để nhận diện trường mã tra cứu, MST, endpoint CAPTCHA/PDF và xây adapter mới. Không chia sẻ payload chứa dữ liệu nhạy cảm ra ngoài nếu chưa rà soát.

## 7. Dataset JSON ngoại tuyến

- **Lưu JSON** ghi atomically vào `<dataRoot>/<MST>/HDDT_<PURCHASE|SALES>_...json`.
- **Mở JSON** chọn file qua file picker; backend kiểm tra schema, count, key, direction và giới hạn dung lượng.
- Có thể chọn **Mở dataset JSON ngoại tuyến** ngay màn hình đăng nhập. Báo cáo và Excel dùng được mà không cần phiên GDT.

Dataset chứa dữ liệu doanh nghiệp/đối tác và raw portal. Hãy mã hóa ổ đĩa, sao lưu phù hợp và kiểm tra trước khi chia sẻ.

## 8. Tải XML/ZIP hàng loạt

Từ grid, chọn hóa đơn rồi bấm **Xếp hàng XML đã chọn**. Tại trang **Tải XML / ZIP**, cũng có thể xếp hàng toàn bộ dữ liệu đang có cho XML, ZIP hoặc cả hai.

Điều khiển:

- **Start**: bắt đầu worker.
- **Pause/Resume**: tạm dừng hoặc tiếp tục.
- **Retry failed**: đưa task lỗi về pending.
- **Xóa hoàn thành**: xóa task done/skipped khỏi RAM, không xóa file.
- **Mở thư mục dữ liệu**: mở `<dataRoot>/<MST>/`.

File được viết qua `.part`, xác thực XML/ZIP và ghi SHA-256 vào `download-manifest.json`. File hợp lệ đã tồn tại được đánh dấu `skipped`; bật overwrite qua Local API khi thực sự cần.

## 9. Báo cáo và Excel

Trang **Kết xuất kế toán** có báo cáo theo đối tác, thuế suất động, loại chứng từ và dòng hàng hóa. Báo cáo Excel chuẩn gồm các sheet:

- `HoaDon`
- `ChiTiet`
- `Thue`
- `TraCuu`
- `Dynamic`

MST, số hóa đơn và mã tra cứu được định dạng text; nội dung có nguy cơ Excel formula injection được escape.

Hai profile AMIS nền tương ứng mua vào/bán ra. Chúng minh họa mapping/validation, chưa được coi là file import-ready khi chưa có workbook mẫu chính thức.

## 10. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Không lấy được Captcha | Kiểm tra Internet, thử làm mới; xác nhận đang ở GDT live hay mock. |
| Sai Captcha/login | Mật khẩu bị xóa khỏi form; lấy Captcha mới và nhập lại. |
| Session expired | Đăng nhập lại rồi Resume queue. |
| Bán ra live chưa cấu hình | Capture endpoint hợp lệ và nhập `salesPath` trong Cài đặt. |
| File bị corrupt/trùng | Kiểm tra task error; không sửa tay manifest; dùng overwrite có chủ đích. |
| Port mặc định bận | Ứng dụng chọn port loopback trống và ghi vào runtime metadata. |
| Không mở được folder | Mở `dataRoot` thủ công; Linux cần file manager hỗ trợ `xdg-open`. |

Log nằm trong thư mục cấu hình ứng dụng và tự dọn sau 7 ngày. Log không được thiết kế để chứa bí mật.
