#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="${HDDT_BASE_DIR:-/opt/hddt_conn}"
ARCHIVE="${1:-}"

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Usage: $0 /opt/hddt_conn/backups/hddt-data-YYYYmmdd-HHMMSS.tar.gz" >&2
  exit 2
fi

if docker ps --format '{{.Names}}' | grep -qx 'hddt-conn'; then
  echo "ERROR: Hãy Stop container hddt-conn trong Portainer trước khi restore." >&2
  exit 3
fi

sudo mkdir -p "$BASE_DIR"
if [[ -d "$BASE_DIR/data" ]]; then
  sudo mv "$BASE_DIR/data" "$BASE_DIR/data.before-restore-$(date +%Y%m%d-%H%M%S)"
fi
sudo tar -C "$BASE_DIR" -xzf "$ARCHIVE"
sudo chown -R 1000:1000 "$BASE_DIR/data"
sudo chmod -R u+rwX,go-rwx "$BASE_DIR/data"
echo "Restore hoàn tất. Start lại Stack trong Portainer."
