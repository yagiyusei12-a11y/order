#!/usr/bin/env bash
# Caddy を Docker で起動（80/443）。アプリが localhost:3000 で動いていること。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

docker_cmd() {
  if docker info &>/dev/null; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

docker_cmd compose -f docker-compose.proxy.yml up -d
docker_cmd compose -f docker-compose.proxy.yml ps
echo "Proxy up. Check https://moder.harunoyukoto.jp (DNS must point here first)"
