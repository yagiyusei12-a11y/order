#!/usr/bin/env bash
# Install order-watchdog systemd timer (every minute).
# Run on VPS: sudo bash deploy/vps/install-order-watchdog.sh
# Optional: echo 'ORDER_WATCHDOG_WEBHOOK_URL=https://...' | sudo tee /etc/order-watchdog.env
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/deploy/vps/order-watchdog.sh"
BIN="/usr/local/sbin/order-watchdog.sh"
UNIT_DIR="/etc/systemd/system"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/vps/install-order-watchdog.sh"
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC"
  exit 1
fi

# Strip CRLF so Windows checkouts do not break bash on the VPS
sed 's/\r$//' "$SRC" >"$BIN"
chmod 0755 "$BIN"
install -d -m 0755 /var/lib/order-watchdog
if [[ ! -f /etc/order-watchdog.env ]]; then
  cat >/etc/order-watchdog.env <<'EOF'
# Discord or Slack incoming webhook (optional). Leave empty to log-only.
# ORDER_WATCHDOG_WEBHOOK_URL=https://discord.com/api/webhooks/...
ORDER_WATCHDOG_COOLDOWN_SEC=1800
EOF
  chmod 0640 /etc/order-watchdog.env
fi

cat >"${UNIT_DIR}/order-watchdog.service" <<EOF
[Unit]
Description=Order app health + node integrity watchdog
After=network-online.target order-app.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${BIN}
Nice=10
EOF

cat >"${UNIT_DIR}/order-watchdog.timer" <<'EOF'
[Unit]
Description=Run order-watchdog every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=15s
Unit=order-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now order-watchdog.timer
systemctl start order-watchdog.service || true
systemctl status order-watchdog.timer --no-pager || true
echo "Installed. Logs: journalctl -t order-watchdog -f"
echo "Webhook: edit /etc/order-watchdog.env (ORDER_WATCHDOG_WEBHOOK_URL)"
