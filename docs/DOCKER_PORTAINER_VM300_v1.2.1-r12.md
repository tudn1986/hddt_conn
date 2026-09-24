# HDDT v1.2.1-r12 — Docker production trên VM300 / Portainer

## 1. Mục tiêu

Triển khai `hddt_conn` trên VM300:

- VM: `10.10.2.45`
- OS: Ubuntu Server 24.04 LTS
- Docker + Portainer đã cài
- WebUI host port mặc định: `8088`
- Container listen: `0.0.0.0:3210`
- Dữ liệu production nằm ngoài container tại `/opt/hddt_conn/data`
- Quản lý Start / Stop / Restart / Update bằng Portainer Stack

r12 giữ app version `1.2.1`; `r12` là source/deployment revision.

## 2. Những thay đổi Docker-specific trong r12

Bản portable cũ chỉ listen `127.0.0.1`, tự tìm port khác nếu port bận và chỉ chấp nhận Origin loopback. Điều đó không phù hợp container/LAN.

r12 thêm các biến môi trường, nhưng không thay đổi hành vi portable mặc định:

- `HDDT_DOCKER=1`: bật lifecycle Docker, dọn `runtime.json`/`instance.lock` cũ từ volume.
- `HDDT_BIND_HOST=0.0.0.0`: cho phép publish port qua Docker.
- `HDDT_PORT=3210`: port cố định trong container.
- `HDDT_FIXED_PORT=1`: không tự nhảy sang port ngẫu nhiên.
- `HDDT_NO_OPEN_BROWSER=1`: không gọi `xdg-open` trong container.
- `HDDT_APP_DATA_DIR=/data/app`: config/log/backport/runtime metadata.
- `HDDT_DATA_ROOT=/data/files`: dataset/XML/ZIP/export theo MST.
- `HDDT_ALLOWED_ORIGINS=http://10.10.2.45:8088`: giữ Origin/CSRF protection khi truy cập LAN.

Token/cookie/CAPTCHA live vẫn chỉ ở RAM theo thiết kế ứng dụng; Docker volume không được dùng để persist session bí mật.

## 3. Copy source từ Windows bằng WinSCP

Tạo thư mục đích qua SSH:

```bash
sudo mkdir -p /opt/hddt_conn/releases/HDDT-v1.2.1-r12
sudo chown -R $USER:$USER /opt/hddt_conn/releases
```

Trong WinSCP:

1. File protocol: `SFTP`
2. Host: `10.10.2.45`
3. Port: `22`
4. Login bằng user SSH của VM300.
5. Upload `HDDT-v1.2.1-r12-docker-production-source.zip` vào:

```text
/opt/hddt_conn/releases/HDDT-v1.2.1-r12/
```

## 4. Giải nén và kiểm checksum

SSH:

```bash
cd /opt/hddt_conn/releases/HDDT-v1.2.1-r12
sha256sum HDDT-v1.2.1-r12-docker-production-source.zip
unzip HDDT-v1.2.1-r12-docker-production-source.zip
cd HDDT-v1.2.1-source
```

Kiểm tra:

```bash
cat VERSION
ls -la Dockerfile .dockerignore deploy/portainer-stack.yml
```

`VERSION` phải là `1.2.1`.

## 5. Chuẩn bị volume và build image

Từ thư mục source:

```bash
chmod +x deploy/*.sh
./deploy/prepare-vm300.sh \
  /opt/hddt_conn/releases/HDDT-v1.2.1-r12/HDDT-v1.2.1-source \
  1.2.1-r12
```

Script sẽ:

- tạo `/opt/hddt_conn/data/app`
- tạo `/opt/hddt_conn/data/files`
- tạo `/opt/hddt_conn/backups`
- đặt owner UID/GID 1000 cho container user `node`
- build image `hddt_conn:1.2.1-r12`

Kiểm tra:

```bash
docker image ls hddt_conn
docker image inspect hddt_conn:1.2.1-r12 \
  --format 'ID={{.Id}} Created={{.Created}} Size={{.Size}}'
```

## 6. Tạo Portainer Stack

Portainer → **Stacks** → **Add stack**.

Tên:

```text
hddt-conn
```

Chọn **Web editor**, copy toàn bộ nội dung:

```text
deploy/portainer-stack.yml
```

Tại **Environment variables**, tạo:

```text
HDDT_IMAGE_TAG=1.2.1-r12
HDDT_HTTP_PORT=8088
HDDT_BASE_DIR=/opt/hddt_conn
HDDT_ALLOWED_ORIGINS=http://10.10.2.45:8088
```

Sau đó **Deploy the stack**.

## 7. Kiểm tra sau deploy

Portainer → Containers → `hddt-conn`:

- State: `running`
- Health: `healthy`
- Logs không có startup loop.

SSH:

```bash
docker ps --filter name=hddt-conn
docker logs --tail 100 hddt-conn
curl -s http://127.0.0.1:8088/api/app/status
```

Từ máy Windows trong LAN:

```text
http://10.10.2.45:8088
```

## 8. Nếu WebUI mở nhưng POST/API báo ORIGIN_REJECTED

Browser Origin phải có trong `HDDT_ALLOWED_ORIGINS`.

Ví dụ truy cập cả IP và hostname:

```text
HDDT_ALLOWED_ORIGINS=http://10.10.2.45:8088,http://vm300:8088
```

Portainer → Stack → Editor/Environment variables → sửa biến → **Update the stack**.

Không đặt `*`; Origin protection cố ý dùng allow-list chính xác.

## 9. Start / Stop / Restart

Trong Docker production, endpoint/nút **Thoát HDDT** không tắt process để tránh `restart: unless-stopped` khởi động container trở lại ngoài ý muốn. Server trả thông báo yêu cầu quản lý lifecycle bằng Portainer.

Dùng:

- Portainer → Containers → `hddt-conn` → **Stop / Start / Restart**; hoặc
- Portainer → Stacks → `hddt-conn` → **Stop / Update the stack**.

## 10. Dữ liệu persistent

Host:

```text
/opt/hddt_conn/data/app
/opt/hddt_conn/data/files
```

Container:

```text
/data/app
/data/files
```

`/data/app` chứa config/log/backport. `/data/files` là data root cho dataset/XML/ZIP/export.

Recreate container không làm mất hai thư mục này.

## 11. Backup

Trước mỗi update:

```bash
cd /opt/hddt_conn/releases/HDDT-v1.2.1-r12/HDDT-v1.2.1-source
./deploy/backup-data.sh
```

Kết quả:

```text
/opt/hddt_conn/backups/hddt-data-YYYYmmdd-HHMMSS.tar.gz
/opt/hddt_conn/backups/hddt-data-YYYYmmdd-HHMMSS.tar.gz.sha256
```

## 12. Update version/revision mới

Ví dụ `r13`:

1. WinSCP upload source r13 vào `/opt/hddt_conn/releases/HDDT-v1.2.1-r13/`.
2. Backup data.
3. Build image mới:

```bash
./deploy/build-update.sh \
  /opt/hddt_conn/releases/HDDT-v1.2.1-r13/HDDT-v1.2.1-source \
  1.2.1-r13
```

4. Portainer → `hddt-conn` Stack → đổi:

```text
HDDT_IMAGE_TAG=1.2.1-r13
```

5. **Update the stack**.

Không sửa file trực tiếp bên trong container.

## 13. Rollback

Nếu r13 lỗi:

Portainer → Stack → Environment variables:

```text
HDDT_IMAGE_TAG=1.2.1-r12
```

→ **Update the stack**.

Image cũ phải được giữ cho đến khi version mới nghiệm thu xong.

Nếu cần restore dữ liệu:

1. Stop container trong Portainer.
2. SSH:

```bash
./deploy/restore-data.sh /opt/hddt_conn/backups/hddt-data-....tar.gz
```

3. Start Stack/container lại.

## 14. Firewall LAN

Nếu UFW đang bật và LAN của bạn là `10.10.0.0/16`:

```bash
sudo ufw allow from 10.10.0.0/16 to any port 8088 proto tcp
sudo ufw status
```

Không public port `8088` trực tiếp ra Internet.

## 15. Outbound HTTPS cần thiết

Container cần DNS + HTTPS outbound tới GDT và các TVAN. Kiểm tra cơ bản:

```bash
docker exec hddt-conn node -e \
"Promise.all(['https://hoadondientu.gdt.gov.vn','https://www.meinvoice.vn','https://vinvoice.viettel.vn'].map(async u=>{try{const r=await fetch(u,{method:'HEAD',signal:AbortSignal.timeout(10000)});console.log(u,r.status)}catch(e){console.log(u,e.message)}}))"
```

HTTP status có thể không phải 200 do portal chặn HEAD; mục tiêu là xác nhận DNS/TLS/network không lỗi.

## 16. Nghiệm thu production

Sau khi Stack healthy:

- đăng nhập GDT;
- CAPTCHA/login;
- query mua vào/bán ra;
- mở detail;
- lưu/mở dataset;
- MISA/Viettel/TVAN supervised theo chức năng hiện có;
- thử restart container trong Portainer;
- xác nhận data còn nguyên;
- tạo backup;
- test Stop/Start/Restart từ Portainer.

Chỉ sau các bước này mới xóa image/source revision cũ.
