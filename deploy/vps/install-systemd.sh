#!/usr/bin/env bash
# systemd で常時起動（要 sudo）。プロジェクトが ~/order 以外なら ORDER_HOME を設定して実行。
# ORDER_HOME=/path/to/order sudo -E bash deploy/vps/install-systemd.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ORDER_HOME="${ORDER_HOME:-$ROOT}"
SERVICE_NAME="order-app"
NODE_BIN="$(command -v node)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/vps/install-systemd.sh"
  exit 1
fi

if [[ ! -f "${ORDER_HOME}/dist/index.js" ]]; then
  echo "ERROR: ${ORDER_HOME}/dist/index.js がありません（TypeScript のビルドが未実行です）。"
  echo "先に実行: cd ${ORDER_HOME} && bash deploy/vps/bootstrap.sh"
  echo "または: cd ${ORDER_HOME} && npm ci && npm run build"
  exit 1
fi

UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
cat >"$UNIT" <<EOF
[Unit]
Description=Order (Fastify) mobile order API
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SUDO_USER:-ubuntu}
Group=${SUDO_USER:-ubuntu}
WorkingDirectory=${ORDER_HOME}
EnvironmentFile=${ORDER_HOME}/.env
ExecStart=${NODE_BIN} dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"
systemctl status "${SERVICE_NAME}.service" --no-pager || true
echo "Installed ${UNIT}. Logs: journalctl -u ${SERVICE_NAME} -f"
