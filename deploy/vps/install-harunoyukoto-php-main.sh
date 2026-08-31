#!/usr/bin/env bash
# 新メイン VPS: 送迎(/sougei)・在庫(/zaiko) を Nginx :9083 + PHP-FPM で公開する。
# Caddyfile.main は reverse_proxy 127.0.0.1:9083（php_fastcgi :9000 禁止）。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_SRC="$DIR/harunoyukoto-php.nginx"
CADDYFILE="$DIR/Caddyfile.main"
NGINX_DEST="/etc/nginx/sites-available/harunoyukoto-php"
NGINX_LINK="/etc/nginx/sites-enabled/harunoyukoto-php"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$NGINX_SRC" ]] || die "missing $NGINX_SRC"
[[ -f "$CADDYFILE" ]] || die "missing $CADDYFILE"

if grep -E '^[[:space:]]*php_fastcgi[[:space:]].*:9000' "$CADDYFILE" >/dev/null 2>&1; then
  die "Caddyfile.main must NOT use php_fastcgi :9000. Use reverse_proxy 127.0.0.1:9083"
fi
grep -E '^[[:space:]]*reverse_proxy[[:space:]]+127\.0\.0\.1:9083' "$CADDYFILE" >/dev/null \
  || die "Caddyfile.main must reverse_proxy /sougei|/zaiko to 127.0.0.1:9083"
grep -E 'path /sougei .*/zaiko' "$CADDYFILE" >/dev/null \
  || die "Caddyfile.main missing /zaiko path matcher"

command -v nginx >/dev/null || die "nginx not installed"
systemctl is-active --quiet php8.3-fpm || systemctl is-active --quiet php-fpm \
  || die "php-fpm is not active"
php -m 2>/dev/null | grep -qi pdo_sqlite || die "php pdo_sqlite missing"

[[ -d /var/www/harunoyukoto/public/sougei ]] || die "missing /var/www/harunoyukoto/public/sougei"
[[ -d /var/www/harunoyukoto/public/zaiko ]] || die "missing /var/www/harunoyukoto/public/zaiko (copy PHP + inventory.db first)"
[[ -f /var/www/harunoyukoto/public/zaiko/index.php ]] || die "missing zaiko/index.php"

sudo cp "$NGINX_SRC" "$NGINX_DEST"
sudo ln -sfn "$NGINX_DEST" "$NGINX_LINK"
# 同じ :9083 を聞く送迎専用サイトは外す
sudo rm -f /etc/nginx/sites-enabled/harunoyukoto-sougei
sudo nginx -t
sudo systemctl reload nginx

curl -sf -o /dev/null --connect-timeout 3 http://127.0.0.1:9083/sougei/menu.php \
  && echo "harunoyukoto-php: nginx :9083 OK (sougei)" \
  || echo "WARN: /sougei/menu.php not responding" >&2
if curl -sf -o /dev/null --connect-timeout 3 http://127.0.0.1:9083/zaiko/; then
  echo "harunoyukoto-php: nginx :9083 OK (zaiko)"
else
  echo "WARN: nginx :9083 did not respond for /zaiko/" >&2
fi

echo "Installed $NGINX_DEST (sougei + zaiko)."
