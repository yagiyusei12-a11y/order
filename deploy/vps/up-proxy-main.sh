#!/usr/bin/env bash
# 新メイン VPS: Caddy 起動
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
# 送迎・在庫の PHP 経路を先に固定（Caddy :9000 回帰防止）
if [[ -d /var/www/harunoyukoto/public/zaiko ]]; then
  bash "$DIR/install-harunoyukoto-php-main.sh"
else
  echo "WARN: /var/www/harunoyukoto/public/zaiko missing; skip nginx php install" >&2
fi

docker_cmd() {
  if docker info &>/dev/null; then docker "$@"
  elif sudo docker info &>/dev/null; then sudo docker "$@"
  else echo "Docker not running"; exit 1; fi
}
docker_cmd compose -f docker-compose.proxy-main.yml up -d
docker_cmd compose -f docker-compose.proxy-main.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
  || docker_cmd compose -f docker-compose.proxy-main.yml restart caddy
docker_cmd compose -f docker-compose.proxy-main.yml ps
echo "Main proxy up."
