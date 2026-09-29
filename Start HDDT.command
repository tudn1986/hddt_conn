#!/bin/bash
set -e
cd "$(dirname "$0")"

# Portable production: run the bundled Node runtime from the app directory.
if [ -x "./runtime/node" ] && [ -f "./app/dist/server/index.js" ]; then
  (
    cd ./app
    NODE_ENV=production HDDT_INSECURE_HTTP=1 HDDT_BIND_HOST=127.0.0.1       nohup ../runtime/node dist/server/index.js >/dev/null 2>&1 </dev/null &
  )
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
