#!/usr/bin/env bash
# 非常用VPS: ~/order で Postgres・migrate・シード・build・systemd・Caddy
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "==> .env がありません。fill-env-secrets します"
  bash deploy/vps/fill-env-secrets.sh
fi

# プロキシ配下 + IP の HTTP でも Cookie が付く
if grep -q '^TRUST_PROXY=' .env; then
  sed -i 's/^TRUST_PROXY=.*/TRUST_PROXY=1/' .env
else
  echo "TRUST_PROXY=1" >> .env
fi
if grep -q '^COOKIE_SECURE=' .env; then
  sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=0/' .env
else
  echo "COOKIE_SECURE=0" >> .env
fi
if grep -q '^BOOTSTRAP_DISABLED=' .env; then
  sed -i 's/^BOOTSTRAP_DISABLED=.*/BOOTSTRAP_DISABLED=0/' .env
else
  echo "BOOTSTRAP_DISABLED=0" >> .env
fi

docker_cmd() {
  if docker info &>/dev/null; then
    docker "$@"
  elif sudo docker info &>/dev/null; then
    sudo docker "$@"
  else
    echo "Docker is not running. Run: sudo bash deploy/vps/provision-standby.sh"
    exit 1
  fi
}

echo "==> docker compose up (postgres)"
docker_cmd compose up -d

echo "==> wait for postgres"
for i in $(seq 1 30); do
  if docker_cmd compose exec -T postgres pg_isready -U order >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> npm ci"
npm ci

echo "==> prisma generate + migrate deploy"
npx prisma generate
npx prisma migrate deploy

echo "==> payment methods + はるのゆこと マスタ"
npx prisma db seed
npx tsx prisma/seed-standby-harunoyukoto.ts

echo "==> npm run build"
npm run build

echo "==> systemd order-app"
sudo bash deploy/vps/install-systemd.sh
sudo bash deploy/vps/install-order-watchdog.sh || true

echo "==> Caddy (standby)"
bash deploy/vps/up-proxy-standby.sh

sleep 2
curl -sS http://127.0.0.1:3000/health || true
echo ""
echo "Bootstrap standby OK."
echo "  Setup: http://133.18.180.76/staff-app/setup"
echo "  Health: http://133.18.180.76/health"
