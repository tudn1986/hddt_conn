# Hướng dẫn triển khai HDDT-public-production-v1.3.0-rc.1 lên VM300 bằng Portainer

## Phạm vi

-   VM: `vm300`
-   IP: `10.10.2.45`
-   Hệ điều hành: Ubuntu Server LTS
-   Gói nguồn: `HDDT-public-production-v1.3.0-rc.1.zip`
-   Port truy cập web yêu cầu: `8188`
-   URL LAN: `http://10.10.2.45:8188`

> **Lưu ý bảo mật quan trọng:** tài liệu Public Web gốc thiết kế
> production công khai qua **HTTPS** và không khuyến nghị
> `HDDT_INSECURE_HTTP=1`. Cấu hình port `8188` dưới đây là phương án
> **LAN/internal HTTP** cho VM300. Nếu ứng dụng được mở ra Internet, hãy
> dùng Caddy/reverse proxy HTTPS theo `PUBLIC_DOCKER_DEPLOYMENT_VIE.md`,
> không public trực tiếp `8188`.

## 1. Chuẩn bị VM300

SSH vào VM:

``` bash
ssh <user>@10.10.2.45
```

Kiểm tra Docker:

``` bash
docker version
docker compose version
```

Nếu VM300 chưa có Docker/Portainer, cài Docker Engine 25+ và Compose v2
trước. Khuyến nghị tối thiểu 2 vCPU, 2 GB RAM và 10 GB disk trống.

Tạo thư mục release:

``` bash
sudo mkdir -p /opt/hddt_conn/releases/v1.3.0-rc.1
sudo chown -R "$USER":"$USER" /opt/hddt_conn
```

Upload `HDDT-public-production-v1.3.0-rc.1.zip` vào:

``` text
/opt/hddt_conn/releases/v1.3.0-rc.1/
```

Giải nén:

``` bash
cd /opt/hddt_conn/releases/v1.3.0-rc.1
unzip HDDT-public-production-v1.3.0-rc.1.zip
cd HDDT-public-production
```

## 2. Build Docker image v1.3.0-rc.1

Source bundle dùng `Dockerfile` để build app. Build image trực tiếp trên
VM300:

``` bash
docker build --pull -t hddt_conn:1.3.0-rc.1 .
```

Kiểm tra:

``` bash
docker image inspect hddt_conn:1.3.0-rc.1 --format '{{.RepoTags}}'
```

Kết quả cần có tag `hddt_conn:1.3.0-rc.1`.

## 3. Tạo admin token

Tạo secret tối thiểu 32 ký tự:

``` bash
openssl rand -base64 48
```

Lưu giá trị này ở nơi an toàn. Không đưa token vào Git, ticket hoặc ảnh
chụp màn hình.

## 4. Tạo Stack trên Portainer

Vào:

`Portainer` → `Stacks` → `Add stack`

Đặt tên:

``` text
hddt-public
```

Chọn **Web editor** và dán stack sau:

``` yaml
services:
  app:
    image: hddt_conn:1.3.0-rc.1
    container_name: hddt-public
    restart: unless-stopped
    init: true

    ports:
      - "8188:3210"

    environment:
      NODE_ENV: production
      TZ: Asia/Ho_Chi_Minh
      HDDT_DOCKER: "1"
      HDDT_CONNECTOR: live
      HDDT_BIND_HOST: 0.0.0.0
      HDDT_PORT: "3210"
      HDDT_FIXED_PORT: "1"
      HDDT_NO_OPEN_BROWSER: "1"

      HDDT_APP_DATA_DIR: /data/app
      HDDT_DATA_ROOT: /tmp/disabled-business-data

      HDDT_PUBLIC_URL: http://10.10.2.45:8188
      HDDT_ALLOWED_ORIGINS: http://10.10.2.45:8188

      # Chỉ dùng cho LAN/internal HTTP.
      # Khi public Internet phải chuyển sang HTTPS và bỏ biến này.
      HDDT_INSECURE_HTTP: "1"

      HDDT_ADMIN_TOKEN: ${HDDT_ADMIN_TOKEN}
      HDDT_SESSION_IDLE_MS: "1800000"
      HDDT_SESSION_ABSOLUTE_MS: "28800000"
      HDDT_MAX_SESSIONS: "500"
      HDDT_RATE_LIMIT_PER_MINUTE: "300"
      HDDT_TVAN_BATCH_MAX_BYTES: "268435456"

    volumes:
      - hddt_metadata:/data/app

    tmpfs:
      - /tmp:size=512m,mode=1770,uid=1000,gid=1000

    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 256
    mem_limit: 1g
    cpus: 2.0

    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:3210/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s

    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  hddt_metadata:
```

Trong phần **Environment variables** của Stack, thêm:

``` text
HDDT_ADMIN_TOKEN=<token tạo ở bước 3>
```

Sau đó bấm **Deploy the stack**.

## 5. Firewall cho port 8188

Nếu UFW đang bật và chỉ muốn cho LAN `10.10.2.0/24` truy cập:

``` bash
sudo ufw allow from 10.10.2.0/24 to any port 8188 proto tcp
sudo ufw status
```

Không nên mở `8188` ra Internet.

## 6. Kiểm tra sau triển khai

Trên VM300:

``` bash
docker ps --filter name=hddt-public
docker logs --tail 100 hddt-public
curl -fsS http://127.0.0.1:8188/api/health
curl -fsS http://127.0.0.1:8188/api/app/status
```

Từ máy trong LAN, mở:

``` text
http://10.10.2.45:8188
```

Kiểm tra container chạy non-root và các hardening option:

``` bash
docker exec hddt-public id
docker inspect hddt-public --format '{{json .HostConfig.ReadonlyRootfs}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}}'
```

Mong đợi:

-   Container ở trạng thái `healthy`.
-   App truy cập được tại `http://10.10.2.45:8188`.
-   `api/app/status` hoạt động.
-   App chạy bằng user `node`, không phải root.
-   Root filesystem read-only.
-   Linux capabilities bị drop.
-   `no-new-privileges` được bật.
-   Dữ liệu hóa đơn không được lưu vào metadata volume.

## 7. Kiểm tra metadata volume

Xác định tên volume:

``` bash
docker volume ls | grep hddt
```

Kiểm tra danh sách file mà không dump nội dung:

``` bash
docker run --rm -v hddt-public_hddt_metadata:/data:ro alpine \
  find /data -maxdepth 3 -type f -printf '%p\n'
```

Tên volume thực tế có thể khác nếu Portainer thêm prefix theo stack. Chỉ
nên có metadata/config/runtime/log; không nên có XML, ZIP, PDF hoặc
dataset hóa đơn.

## 8. Cập nhật phiên bản

Build image mới bằng tag mới, ví dụ:

``` bash
cd /opt/hddt_conn/releases/<new-version>/HDDT-public-production
docker build --pull -t hddt_conn:<new-version> .
```

Trong Portainer sửa:

``` yaml
image: hddt_conn:<new-version>
```

Sau đó chọn **Update the stack**.

Việc recreate app sẽ làm mất session đang nằm trong RAM và người dùng
phải đăng nhập lại. File nghiệp vụ trên máy người dùng không bị ảnh
hưởng.

## 9. Rollback

Giữ image cũ:

``` bash
docker images hddt_conn
```

Khi cần rollback, sửa Stack về:

``` yaml
image: hddt_conn:1.3.0-rc.1
```

rồi **Update the stack**.

## 10. Phương án production HTTPS khuyến nghị

Nếu `vm300` có DNS/reverse proxy và ứng dụng cần phục vụ ngoài LAN:

-   Không publish trực tiếp `8188` ra Internet.
-   Không đặt `HDDT_INSECURE_HTTP=1`.
-   Terminate TLS tại Caddy/reverse proxy.
-   Forward proxy tới `app:3210` qua private Docker network.
-   Đặt `HDDT_PUBLIC_URL` và `HDDT_ALLOWED_ORIGINS` bằng đúng HTTPS
    origin.
-   Giữ đúng security headers, HSTS, timeout, request body limits và
    Web/SSE buffering policy như Caddy đi kèm source bundle.

Source bundle v1.3.0-rc.1 có `compose.yml` + `deploy/Caddyfile` cho mô
hình HTTPS chuẩn này.

## 11. Truy cập trang HDDT Admin

Sau khi build/deploy source tùy biến có Admin WebUI, truy cập:

```text
http://10.10.2.45:8188/admin
```

Đăng nhập bằng đúng giá trị `HDDT_ADMIN_TOKEN` đã khai báo trong Environment variables của Portainer Stack.

Trang quản trị cung cấp danh sách session, Username/MST, trạng thái login GDT, thời gian tạo/hoạt động gần nhất/hết hạn, audit log, Refresh và Revoke từng session.
