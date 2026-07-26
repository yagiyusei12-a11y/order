#!/usr/bin/env bash
# 送迎(/sougei)・在庫(/zaiko) を Nginx :9083 + PHP-FPM で確実に公開する。
# Caddy は php_fastcgi :9000 ではなく reverse_proxy :9083 を使うこと。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_SRC="$DIR/harunoyukoto-php.nginx"
CADDYFILE="$DIR/Caddyfile"
NGINX_DEST="/etc/nginx/sites-available/harunoyukoto-php"
NGINX_LINK="/etc/nginx/sites-enabled/harunoyukoto-php"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$NGINX_SRC" ]] || die "missing $NGINX_SRC"
[[ -f "$CADDYFILE" ]] || die "missing $CADDYFILE"

# 過去の誤り: Caddy が存在しない PHP-FPM TCP :9000 を見に行って 502 になる
# （コメント行の「禁止: php_fastcgi :9000」は除外）
if grep -E '^[[:space:]]*php_fastcgi[[:space:]].*:9000' "$CADDYFILE" >/dev/null 2>&1; then
  die "Caddyfile must NOT use php_fastcgi :9000 (sougei/zaiko 502). Use reverse_proxy host.docker.internal:9083"
fi

if ! grep -E '^[[:space:]]*reverse_proxy[[:space:]]+host\.docker\.internal:9083' "$CADDYFILE" >/dev/null 2>&1; then
  die "Caddyfile must reverse_proxy /sougei|/zaiko to host.docker.internal:9083"
fi
if ! grep -E '@sougei|path /sougei' "$CADDYFILE" >/dev/null 2>&1; then
  die "Caddyfile missing /sougei|/zaiko handle"
fi

command -v nginx >/dev/null || die "nginx not installed"
systemctl is-active --quiet php8.3-fpm || systemctl is-active --quiet php-fpm \
  || die "php-fpm is not active"

sudo cp "$NGINX_SRC" "$NGINX_DEST"
sudo ln -sfn "$NGINX_DEST" "$NGINX_LINK"
sudo nginx -t
sudo systemctl reload nginx

# 疎通（失敗しても install 自体は成功扱いだが警告）
if curl -sf -o /dev/null -w '' --connect-timeout 2 http://127.0.0.1:9083/zaiko/index.php; then
  echo "harunoyukoto-php: nginx :9083 OK (zaiko)"
else
  echo "WARN: nginx :9083 did not respond for /zaiko/index.php" >&2
fi

echo "Installed $NGINX_DEST and enabled site."
