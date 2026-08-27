#!/usr/bin/env bash
# 非常用カゴヤ VPS（Ubuntu）の初回パッケージ導入。sudo で実行。
# 対象: 133.18.180.76 など order-app 専用箱。daiko は入れない。
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/vps/provision-standby.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git gnupg lsb-release ufw

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "${SUDO_USER:-ubuntu}" || true

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v2[0-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "Provision OK. node=$(command -v node) $(node -v) docker=$(command -v docker)"
echo "Re-login may be needed for docker group (or use sudo docker)."
