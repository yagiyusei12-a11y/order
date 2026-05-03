#!/usr/bin/env bash
# 空の POSTGRES_PASSWORD / DATABASE_URL / JWT_SECRET を自動埋めする（VPS 用）
#
#   bash deploy/vps/fill-env-secrets.sh
#     → DB パスワードはランダム生成（初回インストール向け）
#
#   bash deploy/vps/fill-env-secrets.sh --match-docker-default
#     → DB パスワードを order_local_dev に固定（.env が空のまま docker compose 済みで
#        Postgres を一度も消していないとき、コンテナ内のパスワードと一致させる）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MATCH_DEFAULT=0
if [[ "${1:-}" == "--match-docker-default" ]]; then
  MATCH_DEFAULT=1
fi
export MATCH_DEFAULT

if [[ ! -f .env ]]; then
  echo "==> .env がありません。.env.example から作ります"
  cp .env.example .env
fi

cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"
echo "==> 既存 .env をバックアップしました"

python3 <<'PY'
import os
import re
import secrets
import string
from pathlib import Path

path = Path(".env")
text = path.read_text(encoding="utf-8")

def rand_alnum(n: int) -> str:
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(n))

match_default = os.environ.get("MATCH_DEFAULT") == "1"
if match_default:
    pw = "order_local_dev"
    print("==> DB パスワードは docker-compose の既定 (order_local_dev) に合わせます")
else:
    pw = rand_alnum(24)
    print("==> DB パスワードはランダム生成しました（既に Postgres に別パスワードがある場合は down -v が必要なことがあります）")

jwt = rand_alnum(48)
db_url = f"postgresql://order:{pw}@localhost:5432/order?schema=public"

out_lines = []
for line in text.splitlines():
    if re.match(r"^\s*#", line) or not line.strip():
        out_lines.append(line)
        continue
    if line.startswith("POSTGRES_PASSWORD="):
        val = line.split("=", 1)[1].strip() if "=" in line else ""
        if not val or val in ('""', "''"):
            line = f"POSTGRES_PASSWORD={pw}"
    elif line.startswith("DATABASE_URL="):
        val = line.split("=", 1)[1].strip().strip('"') if "=" in line else ""
        if not val or "postgresql://" not in val:
            line = f'DATABASE_URL="{db_url}"'
    elif line.startswith("JWT_SECRET="):
        val = line.split("=", 1)[1].strip() if "=" in line else ""
        if not val or val in ('""', "''"):
            line = f"JWT_SECRET={jwt}"
    out_lines.append(line)

path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
print("==> POSTGRES_PASSWORD / DATABASE_URL / JWT_SECRET を書き込みました")
PY

echo ""
echo "次を続けて実行:"
echo "  docker compose up -d"
echo "  npx prisma migrate deploy"
echo "  npm run build"
echo "  sudo systemctl restart order-app"
