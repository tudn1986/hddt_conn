# Triển khai bản v1.3.0-rc.1 có Admin WebUI lên VM300

## 1. Giải nén source mới

Ví dụ:

```bash
sudo mkdir -p /opt/hddt_conn/releases/v1.3.0-rc.1-admin-ui
sudo chown -R "$USER":"$USER" /opt/hddt_conn
cd /opt/hddt_conn/releases/v1.3.0-rc.1-admin-ui
unzip HDDT-public-production-v1.3.0-rc.1-admin-ui.zip
cd HDDT-public-production
```

## 2. Build image với tag riêng

```bash
docker build --pull -t hddt_conn:1.3.0-rc.1-admin-ui .
```

Kiểm tra:

```bash
docker image inspect hddt_conn:1.3.0-rc.1-admin-ui --format '{{.RepoTags}}'
```

## 3. Cập nhật Portainer Stack

Trong Portainer → Stacks → stack HDDT hiện tại → Editor, đổi image thành:

```yaml
image: hddt_conn:1.3.0-rc.1-admin-ui
```

Bảo đảm các biến sau vẫn đúng:

```yaml
HDDT_PUBLIC_URL: http://10.10.2.45:8188
HDDT_ALLOWED_ORIGINS: http://10.10.2.45:8188
HDDT_INSECURE_HTTP: "1"
HDDT_ADMIN_TOKEN: ${HDDT_ADMIN_TOKEN}
```

Trong Environment variables của Stack, `HDDT_ADMIN_TOKEN` phải là secret dài tối thiểu 32 ký tự.

Chọn **Update the stack** / recreate container.

## 4. Kiểm tra

```bash
curl -fsS http://127.0.0.1:8188/api/health
curl -fsS http://127.0.0.1:8188/api/app/status
```

Mở WebUI chính:

```text
http://10.10.2.45:8188
```

Mở Admin WebUI:

```text
http://10.10.2.45:8188/admin
```

Đăng nhập `/admin` bằng đúng `HDDT_ADMIN_TOKEN`.

## 5. Nghiệm thu Admin WebUI

- Trang `/admin` hiển thị form Admin Token khi chưa đăng nhập.
- Token sai bị từ chối; token đúng mở dashboard.
- Dashboard hiển thị số session hoạt động và số session đã login GDT.
- Bảng session có Username/MST, trạng thái login, thời gian tạo, hoạt động gần nhất, hết hạn, IP hash.
- Refresh cập nhật danh sách và audit log.
- Revoke một session khác làm session đó biến mất và browser tương ứng phải tạo/login lại session.
- Không thể Revoke chính browser session đang dùng để quản trị.
- Đăng xuất Admin xóa token khỏi `sessionStorage` của tab.

## 6. Rollback

Trong Stack đổi lại image trước đó, ví dụ:

```yaml
image: hddt_conn:1.3.0-rc.1
```

sau đó Update Stack. Recreate app sẽ làm mất các session đang nằm trong RAM nhưng không ảnh hưởng file nghiệp vụ trên máy người dùng.
