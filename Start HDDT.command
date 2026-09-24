#!/bin/bash
set -e
cd "$(dirname "$0")"

# Portable production: run the server detached so Terminal is not kept open.
if [ -x "./hddt-server" ]; then
  nohup ./hddt-server >/dev/null 2>&1 </dev/null &
  disown || true
  exit 0
fi

# Developer/source fallback stays attached for useful diagnostics.
if [ -f "dist/server/index.js" ] && command -v node >/dev/null 2>&1; then
  NODE_ENV=production node dist/server/index.js
  exit 0
fi

if [ -f "src/server/index.ts" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm dev
    exit 0
  fi
  if command -v npx >/dev/null 2>&1; then
    npx tsx src/server/index.ts
    exit 0
  fi
fi

echo "Khong tim thay runtime. Cai Node.js 22.12+ hoac dung goi portable."
read -r
