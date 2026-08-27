#!/usr/bin/env bash
# 非常用VPS: Caddy のみ（PHP / daiko は入れない）
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

docker_cmd compose -f docker-compose.proxy-standby.yml up -d
docker_cmd compose -f docker-compose.proxy-standby.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
  || docker_cmd compose -f docker-compose.proxy-standby.yml restart caddy
docker_cmd compose -f docker-compose.proxy-standby.yml ps
echo "Standby proxy up."
echo "  HTTP:  http://133.18.180.76/health"
echo "  HTTPS after DNS: https://standby.morder.harunoyukoto.jp/health"
echo "  Cutover: https://morder.harunoyukoto.jp/health"
