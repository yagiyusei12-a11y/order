#!/usr/bin/env bash
# VPS 上でプロジェクト直下から実行: bash deploy/vps/bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Copy .env.example to .env and set POSTGRES_PASSWORD, DATABASE_URL, JWT_SECRET first."
  exit 1
fi

docker_cmd() {
  if docker info &>/dev/null; then
    docker "$@"
  elif sudo docker info &>/dev/null; then
    sudo docker "$@"
  else
    echo "Docker is not running or no permission. Try: sudo usermod -aG docker \$USER && newgrp docker"
    exit 1
  fi
}

echo "==> docker compose up (postgres)"
docker_cmd compose up -d

echo "==> npm ci"
npm ci

echo "==> prisma generate + migrate deploy"
npx prisma generate
npx prisma migrate deploy

echo "==> npm run build"
npm run build

echo ""
echo "Bootstrap OK."
echo "  Foreground:  npm run start"
echo "  Background:  sudo bash deploy/vps/install-systemd.sh"
echo "  HTTPS proxy: bash deploy/vps/up-proxy.sh   (needs DNS -> this server)"
