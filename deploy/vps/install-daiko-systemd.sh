#!/usr/bin/env bash
# Daiko API を systemd で常駐。引数: リポジトリルート（既定 ~/order）
set -euo pipefail

REPO_ROOT="${1:-$HOME/order}"
DAIKO_DIR="$REPO_ROOT/daiko"
UNIT_DST="/etc/systemd/system/daiko-app.service"
UNIT_SRC="$DAIKO_DIR/deploy/daiko-app.service"

if [[ ! -f "$UNIT_SRC" ]]; then
  echo "missing $UNIT_SRC" >&2
  exit 1
fi

sudo cp "$UNIT_SRC" "$UNIT_DST"
sudo sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$DAIKO_DIR|" "$UNIT_DST"
sudo sed -i "s|^EnvironmentFile=.*|EnvironmentFile=$DAIKO_DIR/.env|" "$UNIT_DST"

sudo systemctl daemon-reload
sudo systemctl enable daiko-app
sudo systemctl restart daiko-app
echo "daiko-app started. Check: curl -sS http://127.0.0.1:3001/health"
