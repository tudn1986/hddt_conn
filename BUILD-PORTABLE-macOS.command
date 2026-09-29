#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Runtime: $(node -p \"process.platform+' '+process.arch+' '+process.versions.node\")"
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12))process.exit(1)" || { echo 'Node.js 22.12+ is required.'; exit 1; }
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
command -v magick >/dev/null 2>&1 || { echo 'ImageMagick (magick) is required for the branded macOS icon.'; exit 1; }
pnpm verify
ARCH="$(node -p 'process.arch')"
if [ "$ARCH" = "arm64" ]; then
  pnpm package:mac-arm64
elif [ "$ARCH" = "x64" ]; then
  pnpm package:mac-x64
else
  echo "Unsupported macOS architecture: $ARCH" >&2
  exit 1
fi
echo "Built native artifact under release/."
