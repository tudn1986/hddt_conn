# HDDT_CONN Public Web --- Triển khai Docker Production

## 1. Mô hình bảo mật

Bản phát hành này chạy một ứng dụng web HTTPS công khai cho nhiều phiên
trình duyệt đồng thời.

-   Mỗi trình duyệt nhận một cookie `__Host-hddt_session` dạng opaque
    (`Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`).
-   Mỗi phiên sở hữu connector GDT, cookie jar, bearer token, trạng thái
    CAPTCHA và trạng thái token/challenge/batch TVAN riêng.
-   Session ID và CSRF token được xoay (rotate) sau khi đăng nhập thành
    công.
-   Đăng xuất, admin thu hồi phiên, hết thời gian chờ (idle expiry) và
    hết thời hạn tuyệt đối (absolute expiry) sẽ hủy context, xóa secret
    và xóa các file tạm của phiên.
-   JSON hóa đơn, XML, ZIP và PDF tải xuống không được lưu bền vững trên
    máy chủ. Trình duyệt ghi chúng vào thư mục cục bộ do người dùng chọn
    thông qua File System Access API; trình duyệt không hỗ trợ sẽ dùng
    cơ chế tải xuống thông thường.
-   Phần lưu trữ bền vững trên server (`hddt_metadata`) chứa cấu hình
    ứng dụng, metadata runtime, log và database SQLite TVAN Catalog đã
    tổng hợp. TVAN Catalog chỉ lưu metadata provider/portal/mapping và
    bộ đếm; không được lưu dataset hóa đơn, raw payload hóa đơn, mã tra
    cứu, token, cookie, XML, ZIP hoặc PDF.
-   Các archive batch TVAN, khi cần, nằm trong thư mục `/tmp` riêng theo
    từng phiên, hết hạn sau 10 phút và bị xóa sau khi tải xuống hoặc khi
    phiên bị hủy.

## 2. Điều kiện tiên quyết

-   Một VM Linux có Docker Engine 25+ và Compose v2 (hoặc Portainer dùng
    Docker Engine tương thích).
-   Một bản ghi DNS công khai `A/AAAA`, ví dụ `hddt.example.com`, trỏ
    tới VM.
-   Mở inbound TCP 80 và TCP/UDP 443. Không public port 3210.
-   Có kết nối HTTPS outbound tới các endpoint GDT/TVAN và các CA cấp
    chứng thư ACME.
-   Cấu hình tối thiểu khuyến nghị: 2 vCPU, 2 GB RAM, 10 GB dung lượng
    trống cho image/log/metadata.

## 3. Chuẩn bị cấu hình

``` bash
cp .env.example .env
openssl rand -base64 48
chmod 600 .env
```

Sửa `.env`:

-   `HDDT_DOMAIN`: chỉ nhập tên DNS công khai, không có scheme/path.
-   `ACME_EMAIL`: email nhận thông báo hết hạn chứng thư.
-   `HDDT_ADMIN_TOKEN`: dán giá trị ngẫu nhiên đã tạo; tối thiểu 32 ký
    tự. Tuyệt đối không commit `.env`.
-   Chỉ tinh chỉnh giới hạn phiên/tài nguyên sau khi đã load test.

Kiểm tra DNS trước khi khởi động:

``` bash
getent hosts "$HDDT_DOMAIN"
```

## 4. Build và khởi động

``` bash
docker compose config --quiet
docker compose build --pull --no-cache app
docker compose up -d
docker compose ps
docker compose logs --tail=100 app caddy
```

Caddy tự động lấy và gia hạn TLS. Chỉ mở `https://<HDDT_DOMAIN>` sau khi
cả hai service ở trạng thái healthy.

## 5. Kiểm tra nghiệm thu production

``` bash
curl -fsS "https://$HDDT_DOMAIN/api/app/status"
curl -sSI "https://$HDDT_DOMAIN/" | grep -Ei 'strict-transport-security|x-frame-options|x-content-type-options'
docker compose exec app id
docker inspect "$(docker compose ps -q app)" --format '{{json .HostConfig.ReadonlyRootfs}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}}'
```

Kết quả mong đợi:

-   Status trả về `config.storageMode: "browser"` và không có server
    data path.
-   Có HTTPS/HSTS/các security header.
-   App chạy bằng user không phải root là `node`.
-   Root filesystem ở chế độ read-only, toàn bộ Linux capability bị drop
    và `no-new-privileges` được bật.
-   Hai cửa sổ trình duyệt riêng biệt/private nhận cookie/CSRF khác
    nhau; logout ở cửa sổ này không làm logout cửa sổ kia.
-   Khi lưu dataset, trình duyệt mở bộ chọn thư mục cục bộ hoặc tải file
    theo cơ chế download; không có file hóa đơn xuất hiện trong metadata
    volume.

Kiểm tra metadata volume mà không dump nội dung file:

``` bash
docker run --rm -v hddt-public_hddt_metadata:/data:ro alpine find /data -maxdepth 3 -type f -printf '%p\n'
```

Ví dụ được phép: `config.json`, `runtime.json`, `*.log`,
`tvan-catalog.sqlite`, `tvan-catalog.sqlite-wal`,
`tvan-catalog.sqlite-shm`. Không được có dataset hóa đơn, raw JSON/XML
hóa đơn, ZIP, PDF, mã tra cứu hoặc secret.

## 6. Thao tác quản trị phiên

Bản source tùy biến này có WebUI quản trị tại `/admin`. Với cấu hình VM300 trong tài liệu này, truy cập:

```text
http://10.10.2.45:8188/admin
```

Đăng nhập bằng `HDDT_ADMIN_TOKEN` (tối thiểu 32 ký tự). Token được giữ trong `sessionStorage` của tab quản trị và được gửi tới API bằng `Authorization: Bearer`; không đưa token vào URL.

Dashboard hiển thị session đang hoạt động, Username/MST, trạng thái đăng nhập GDT, thời gian tạo/hoạt động gần nhất/hết hạn, audit log, Refresh và Revoke từng session. WebUI không hiển thị GDT/TVAN token, cookie, CAPTCHA hoặc dữ liệu hóa đơn.

Các API quản trị vẫn có thể dùng cho tự động hóa:

```bash
curl -fsS -H "Authorization: Bearer $HDDT_ADMIN_TOKEN" "http://10.10.2.45:8188/api/admin/sessions"
curl -fsS -H "Authorization: Bearer $HDDT_ADMIN_TOKEN" "http://10.10.2.45:8188/api/admin/audit?limit=100"
```

Thao tác `DELETE /api/admin/sessions/<session-id>` còn yêu cầu cookie phiên và `X-HDDT-CSRF`; dùng nút **Revoke** trên `/admin` là cách khuyến nghị. Nếu gọi API trực tiếp, phải lấy CSRF từ `/api/app/status` trong cùng cookie jar trước khi gửi DELETE.

Xoay admin token bằng cách cập nhật Environment variable/`.env` và recreate app. Sau khi xoay token, các tab Admin đang mở phải đăng nhập lại.

## 7. Reverse proxy và quy tắc mạng

Compose đi kèm chỉ publish các port 80/443 của Caddy. `app:3210` chỉ
truy cập được trong mạng Compose. Nếu dùng reverse proxy tin cậy có sẵn:

1.  Xóa service `caddy` và không thêm host port cho `app`.
2.  Cho app tham gia private Docker network của proxy.
3.  Kết thúc HTTPS (TLS termination) tại proxy và forward tới
    `app:3210`.
4.  Giữ nguyên `Host` và `X-Forwarded-Proto`; cấu hình chính xác một
    trusted proxy hop.
5.  Đặt `HDDT_ALLOWED_ORIGINS=https://exact.public.name` và
    `HDDT_PUBLIC_URL` cùng một HTTPS origin.
6.  Giữ request body limit, timeout, HSTS và chính sách buffering
    Web/SSE tương đương cấu hình Caddy đi kèm.

Không bao giờ đặt `HDDT_INSECURE_HTTP=1` cho một triển khai công khai.

## 8. Sao lưu và khôi phục

Dữ liệu nghiệp vụ nằm trên máy tính của từng người dùng và không thuộc
phạm vi backup server.

Chỉ backup metadata và trạng thái chứng thư Caddy:

``` bash
docker compose stop
mkdir -p backup
docker run --rm -v hddt-public_hddt_metadata:/src:ro -v "$PWD/backup:/backup" alpine tar -czf /backup/hddt-metadata.tgz -C /src .
docker run --rm -v hddt-public_caddy_data:/src:ro -v "$PWD/backup:/backup" alpine tar -czf /backup/caddy-data.tgz -C /src .
docker compose start
```

Xem log và `.env` là dữ liệu nhạy cảm. Mã hóa backup và áp dụng thời
gian lưu giữ ngắn. Không đưa `/tmp` vào backup.

Khi restore, khôi phục vào các volume trống trong lúc service đang dừng,
sau đó khởi động và chạy lại các bước nghiệm thu.

## 9. Nâng cấp và rollback

``` bash
git fetch --all --tags
git checkout <approved-release-tag>
docker compose build --pull app
docker compose up -d
```

Giữ lại immutable image tag trước đó. Rollback bằng cách khôi phục
`HDDT_IMAGE_TAG`/source tag cũ và chạy `docker compose up -d`. Trạng
thái phiên nằm trong RAM nên việc tạo lại app sẽ làm người dùng logout;
các file nghiệp vụ cục bộ không bị ảnh hưởng.

## 10. Giám sát và ứng phó sự cố

-   Theo dõi container health, restart count, memory, CPU, HTTP 4xx/5xx
    và dung lượng đĩa.
-   Cảnh báo khi có 401/403/429 lặp lại, session-capacity eviction, file
    bất thường trong metadata hoặc `/tmp` tăng bất thường.
-   Khi nghi ngờ phiên bị xâm phạm: thu hồi session ID, xoay admin token
    nếu token bị lộ, kiểm tra audit metadata đã được redaction, sau đó
    restart `app` để vô hiệu hóa toàn bộ phiên trong RAM nếu cần.
-   Không bao giờ thu thập request/response body của hóa đơn trong proxy
    access log hoặc APM tracing.

## 11. Giới hạn scale

Thiết kế hiện tại chủ đích chỉ hỗ trợ **một app replica**. Session
context chứa trạng thái connector GDT/TVAN trong RAM không thể
serialize. Không đặt số replica Compose lớn hơn một và không đặt nhiều
app instance sau cơ chế round-robin load balancing. Trước tiên hãy scale
dọc (vertical). Scale ngang yêu cầu thiết kế cơ chế affinity/revocation
coordinator và các bài kiểm thử cách ly xuyên replica mới.

## 12. Trạng thái xác minh của source bundle này

`pnpm run verify` chạy đạt ở môi trường local: TypeScript/lint, 130
test, production build và application smoke test. Smoke test xác nhận cơ
chế streamed download và không có business file dưới server data root.
Docker/container smoke test thực tế chưa được chạy trên build
workstation do không có Docker CLI/runtime; cần chạy các mục 4--5 trên
Docker host đích trước khi xác nhận hệ thống production đã sẵn sàng.
