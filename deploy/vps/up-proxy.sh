#!/usr/bin/env bash
# Caddy を Docker で起動（80/443）。アプリが localhost:3000 で動いていること。
# /sougei・/zaiko は必ず Nginx :9083（install-harunoyukoto-php.sh）経由。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# 送迎・在庫の PHP 経路を先に固定（Caddy 再起動で消えない／誤設定を弾く）
bash "$DIR/install-harunoyukoto-php.sh"

docker_cmd() {
  if docker info &>/dev/null; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

docker_cmd compose -f docker-compose.proxy.yml up -d
docker_cmd compose -f docker-compose.proxy.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
  || docker_cmd compose -f docker-compose.proxy.yml restart caddy
docker_cmd compose -f docker-compose.proxy.yml ps
echo "Proxy up. Check https://morder.harunoyukoto.jp (DNS must point here first)"
echo "Also: https://harunoyukoto.com/sougei/menu.php  https://harunoyukoto.com/zaiko/"
