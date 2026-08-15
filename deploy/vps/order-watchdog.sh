#!/usr/bin/env bash
# Watchdog for order-app + node binary integrity (detects empty/immutable node, malware cron).
# Installed as systemd timer: order-watchdog.timer (every minute).
# Optional alert: set ORDER_WATCHDOG_WEBHOOK_URL in /etc/order-watchdog.env (Discord/Slack incoming webhook).
set -euo pipefail

STATE_DIR="${ORDER_WATCHDOG_STATE_DIR:-/var/lib/order-watchdog}"
STATE_FILE="${STATE_DIR}/last-alert"
COOLDOWN_SEC="${ORDER_WATCHDOG_COOLDOWN_SEC:-1800}"
HEALTH_URL="${ORDER_WATCHDOG_HEALTH_URL:-http://127.0.0.1:3000/health}"
SERVICE="${ORDER_WATCHDOG_SERVICE:-order-app}"
NODE_BIN="${ORDER_WATCHDOG_NODE_BIN:-/usr/bin/node}"
ENV_FILE="${ORDER_WATCHDOG_ENV:-/etc/order-watchdog.env}"
LOG_TAG="order-watchdog"

mkdir -p "$STATE_DIR"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

WEBHOOK_URL="${ORDER_WATCHDOG_WEBHOOK_URL:-}"

log() { logger -t "$LOG_TAG" "$*"; echo "$*"; }

problems=()

# --- node binary ---
if [[ ! -e "$NODE_BIN" ]]; then
  problems+=("node missing: $NODE_BIN")
elif [[ ! -s "$NODE_BIN" ]]; then
  problems+=("node empty (0 bytes): $NODE_BIN")
elif [[ ! -x "$NODE_BIN" ]]; then
  problems+=("node not executable: $NODE_BIN")
fi
if command -v lsattr >/dev/null 2>&1 && [[ -e "$NODE_BIN" ]]; then
  attrs="$(lsattr "$NODE_BIN" 2>/dev/null || true)"
  if echo "$attrs" | grep -q 'i'; then
    # lsattr format ----i---------e------- ; match immutable flag position carefully
    if echo "$attrs" | awk '{print $1}' | grep -q 'i'; then
      problems+=("node has immutable chattr +i: $NODE_BIN")
    fi
  fi
fi

# --- known malware fingerprints ---
if crontab -u ubuntu -l 2>/dev/null | grep -qE '193\.32\.162\.73|/d/[a-f0-9]+/init\.sh'; then
  problems+=("malware cron present in ubuntu crontab")
fi
if ss -ltn 2>/dev/null | grep -q '127.0.0.1:42780'; then
  problems+=("suspicious listener 127.0.0.1:42780 (past malware redis-masquerade)")
fi
for f in /tmp/.kworkerd /var/tmp/cpu-logind /tmp/XfUkTb2c; do
  if [[ -e "$f" ]]; then
    problems+=("malware artifact present: $f")
  fi
done

# --- service + health ---
if ! systemctl is-active --quiet "$SERVICE"; then
  problems+=("systemd $SERVICE not active ($(systemctl is-active "$SERVICE" 2>/dev/null || true))")
fi
if ! curl -sf --connect-timeout 3 --max-time 8 "$HEALTH_URL" >/dev/null; then
  problems+=("health check failed: $HEALTH_URL")
fi

# --- auto-heal (safe subset) ---
healed=()
if [[ ${#problems[@]} -gt 0 ]]; then
  # clear immutable + empty node
  if [[ -e "$NODE_BIN" ]] && { [[ ! -s "$NODE_BIN" ]] || lsattr "$NODE_BIN" 2>/dev/null | awk '{print $1}' | grep -q 'i'; }; then
    chattr -i "$NODE_BIN" 2>/dev/null || true
    if [[ ! -s "$NODE_BIN" ]] || [[ ! -x "$NODE_BIN" ]]; then
      rm -f "$NODE_BIN"
      DEBIAN_FRONTEND=noninteractive apt-get install --reinstall -y nodejs >/dev/null 2>&1 || true
      healed+=("reinstalled nodejs")
    else
      healed+=("cleared chattr +i on node")
    fi
  fi
  # remove malware cron lines
  if crontab -u ubuntu -l 2>/dev/null | grep -qE '193\.32\.162\.73|/d/[a-f0-9]+/init\.sh'; then
    crontab -u ubuntu -l 2>/dev/null | grep -vE '193\.32\.162\.73|/d/[a-f0-9]+/init\.sh' | crontab -u ubuntu - || crontab -u ubuntu -r || true
    healed+=("removed malware cron")
  fi
  # kill :42780 fake listener
  if ss -ltnp 2>/dev/null | grep -q '127.0.0.1:42780'; then
    pids="$(ss -ltnp 2>/dev/null | awk '/127\.0\.0\.1:42780/' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
    for p in $pids; do
      kill -9 "$p" 2>/dev/null || true
    done
    healed+=("killed :42780 listener")
  fi
  rm -f /tmp/.kworkerd /var/tmp/cpu-logind /tmp/XfUkTb2c /tmp/.redis-server.pid 2>/dev/null || true

  systemctl reset-failed "$SERVICE" 2>/dev/null || true
  systemctl restart "$SERVICE" 2>/dev/null || true
  sleep 2
  if curl -sf --connect-timeout 3 --max-time 8 "$HEALTH_URL" >/dev/null; then
    healed+=("restarted $SERVICE — health OK")
  else
    healed+=("restarted $SERVICE — health still FAIL")
  fi
fi

send_alert() {
  local text="$1"
  if [[ -z "$WEBHOOK_URL" ]]; then
    log "ALERT (no webhook): $text"
    return 0
  fi
  # Discord-compatible {content}; Slack also accepts text via same JSON in many hooks — use content+text
  payload="$(printf '{"content":%s,"text":%s}' "$(jq -Rn --arg t "$text" '$t')" "$(jq -Rn --arg t "$text" '$t')")"
  if ! command -v jq >/dev/null 2>&1; then
    # minimal escape
    esc="${text//'\'/'\\'}"; esc="${esc//\"/\\\"}"
    payload="{\"content\":\"$esc\",\"text\":\"$esc\"}"
  fi
  curl -sf --connect-timeout 5 --max-time 15 -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK_URL" >/dev/null || true
}

should_alert() {
  local now last
  now="$(date +%s)"
  if [[ -f "$STATE_FILE" ]]; then
    last="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
    if [[ "$((now - last))" -lt "$COOLDOWN_SEC" ]]; then
      return 1
    fi
  fi
  echo "$now" >"$STATE_FILE"
  return 0
}

if [[ ${#problems[@]} -eq 0 ]]; then
  log "ok"
  exit 0
fi

msg="[morder VPS] problems: $(IFS='; echo "${problems[*]}")"
if [[ ${#healed[@]} -gt 0 ]]; then
  msg+=" | heal: $(IFS='; echo "${healed[*]}")"
fi
log "$msg"
host="$(hostname -f 2>/dev/null || hostname)"
full=":warning: **order-watchdog** on \`${host}\`"$'\n'"${msg}"

if should_alert; then
  send_alert "$full"
fi

# exit non-zero if health still bad (systemd service will show failed for oneshot — useful in journal)
if ! curl -sf --connect-timeout 3 --max-time 8 "$HEALTH_URL" >/dev/null; then
  exit 1
fi
exit 0
