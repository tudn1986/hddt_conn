#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 /path/to/HDDT-v1.2.1-source <image-tag>" >&2
  echo "Example: $0 /opt/hddt_conn/releases/HDDT-v1.2.1-r13/HDDT-v1.2.1-source 1.2.1-r13" >&2
  exit 2
fi

SOURCE_DIR="$1"
IMAGE_TAG="$2"

cd "$SOURCE_DIR"
docker build --pull -t "hddt_conn:$IMAGE_TAG" .
docker image inspect "hddt_conn:$IMAGE_TAG" --format 'ID={{.Id}} Created={{.Created}} Size={{.Size}}'

echo
echo "Image hddt_conn:$IMAGE_TAG đã sẵn sàng."
echo "Portainer > Stacks > hddt-conn > Editor/Environment variables: đổi HDDT_IMAGE_TAG=$IMAGE_TAG rồi Update the stack."
