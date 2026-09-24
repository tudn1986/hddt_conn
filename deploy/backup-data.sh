#!/usr/bin/env bash
set -euo pipefail
BASE_DIR="${HDDT_BASE_DIR:-/opt/hddt_conn}"
BACKUP_DIR="$BASE_DIR/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/hddt-data-$STAMP.tar.gz"

sudo mkdir -p "$BACKUP_DIR"
if [[ ! -d "$BASE_DIR/data" ]]; then
  echo "ERROR: Không tìm thấy $BASE_DIR/data" >&2
  exit 2
fi

sudo tar -C "$BASE_DIR" -czf "$OUT" data
sudo chown "${SUDO_USER:-$USER}:${SUDO_USER:-$USER}" "$OUT" 2>/dev/null || true
sha256sum "$OUT" | tee "$OUT.sha256"
echo "Backup: $OUT"
