#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${HDDT_BASE_DIR:-/opt/hddt_conn}"
SOURCE_DIR="${1:-$BASE_DIR/releases/HDDT-v1.2.1-r12/HDDT-v1.2.1-source}"
IMAGE_TAG="${2:-1.2.1-r12}"

if [[ ! -f "$SOURCE_DIR/Dockerfile" || ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "ERROR: Không tìm thấy source/Dockerfile tại: $SOURCE_DIR" >&2
  exit 2
fi

sudo mkdir -p \
  "$BASE_DIR/data/app" \
  "$BASE_DIR/data/files" \
  "$BASE_DIR/releases" \
  "$BASE_DIR/backups"

# Container chạy bằng user node (UID/GID 1000 trong official node image).
sudo chown -R 1000:1000 "$BASE_DIR/data"
sudo chmod -R u+rwX,go-rwx "$BASE_DIR/data"

cd "$SOURCE_DIR"
echo "[HDDT] Building hddt_conn:$IMAGE_TAG ..."
docker build --pull -t "hddt_conn:$IMAGE_TAG" .

echo "[HDDT] Image ready:"
docker image inspect "hddt_conn:$IMAGE_TAG" --format 'ID={{.Id}} Created={{.Created}} Size={{.Size}}'

echo
echo "Bước tiếp theo: Portainer > Stacks > Add stack > Web editor"
echo "Dán nội dung deploy/portainer-stack.yml và đặt HDDT_IMAGE_TAG=$IMAGE_TAG"
