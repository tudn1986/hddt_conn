# TVAN Catalog DB patch — file list (v1.3.0-rc.1)

Ứng dụng vẫn giữ version `1.3.0-rc.1`.

## File mới

```text
src/server/services/tvan-catalog-db.service.ts
src/server/services/tvan-catalog.service.ts
src/shared/tvan-catalog/index.ts
tests/unit/tvan-catalog.test.ts
tests/integration/admin-tvan-catalog.test.ts
docs/TVAN_CATALOG_DATABASE_DESIGN_v1.3.0-rc.1.md
docs/TVAN_CATALOG_PATCH_FILE_LIST_v1.3.0-rc.1.md
```

## File sửa / upload đè

```text
src/server/app.ts
src/server/routes/admin.routes.ts
src/server/routes/dataset.routes.ts
src/server/routes/invoice.routes.ts
src/shared/models/index.ts
src/web/pages/AdminPage.tsx
RELEASE_MANIFEST.json
docs/ADMIN_WEBUI_V1.3.0-RC.1.md
docs/PUBLIC_DOCKER_DEPLOYMENT.md
docs/PUBLIC_DOCKER_DEPLOYMENT_VIE.md
```

## File giữ nguyên

```text
VERSION
package.json
pnpm-lock.yaml
Dockerfile
```

## Thư mục đích trên VM300

```text
/opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1/HDDT-public-production/
```

Với WinSCP, copy **nội dung patch theo đúng cấu trúc đường dẫn** vào thư mục trên; chọn `Overwrite` cho file đã tồn tại. Không cần xóa toàn bộ source.

Sau upload:

```bash
cd /opt/hddt_conn/releases/HDDT-public-production-v1.3.0-rc.1/HDDT-public-production

docker build --pull --no-cache \
  -t hddt_conn:1.3.0-rc.1-admin-ui-r1 .
```

Sau đó Portainer → Stack `hddt-public` → **Update the stack**, giữ cùng image tag và **không bật Re-pull image**.
