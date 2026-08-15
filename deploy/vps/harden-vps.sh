#!/usr/bin/env bash
# Harden any Ubuntu/Debian VPS: key-only SSH + fail2ban.
# Safe to re-run. Requires working key-based SSH already (do NOT run if password-only).
#
# Usage:
#   sudo bash harden-vps.sh
#   sudo HARDEN_USER=ubuntu bash harden-vps.sh
#   sudo HARDEN_USER=root bash harden-vps.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo/root: sudo bash harden-vps.sh"
  exit 1
fi

# Prefer explicit HARDEN_USER, then SUDO_USER, then ubuntu if home exists, else root
if [[ -n "${HARDEN_USER:-}" ]]; then
  TARGET_USER="$HARDEN_USER"
elif [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  TARGET_USER="$SUDO_USER"
elif [[ -d /home/ubuntu ]]; then
  TARGET_USER="ubuntu"
else
  TARGET_USER="root"
fi

if [[ "$TARGET_USER" == "root" ]]; then
  TARGET_HOME="/root"
else
  TARGET_HOME="/home/${TARGET_USER}"
fi

echo "[harden] host=$(hostname) target_user=${TARGET_USER} home=${TARGET_HOME}"

echo "[harden] SSH: disable password login (key-only)"
mkdir -p /etc/ssh/sshd_config.d
# OpenSSH uses first-obtained value; put our file before cloud-init's 50-*.
cat >/etc/ssh/sshd_config.d/00-order-hardening.conf <<'EOF'
# Managed by harden-vps.sh — key-only SSH
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
EOF

# Neutralize cloud-init override that re-enables passwords
if [[ -f /etc/ssh/sshd_config.d/50-cloud-init.conf ]]; then
  cp -a /etc/ssh/sshd_config.d/50-cloud-init.conf "/etc/ssh/sshd_config.d/50-cloud-init.conf.bak.$(date +%Y%m%d%H%M%S)" || true
  cat >/etc/ssh/sshd_config.d/50-cloud-init.conf <<'EOF'
# Overridden by harden-vps.sh (was often PasswordAuthentication yes)
PasswordAuthentication no
EOF
fi

# If PermitRootLogin prohibit-password but we need root key login on this host, keep it
# (prohibit-password still allows root with pubkey — OK)

sshd -t
if systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null; then
  :
else
  systemctl restart ssh 2>/dev/null || systemctl restart sshd
fi

echo "[harden] verify effective sshd settings:"
sshd -T | grep -iE 'passwordauthentication|permitrootlogin|pubkeyauthentication|maxauthtries|x11forwarding' || true

echo "[harden] install/enable fail2ban"
export DEBIAN_FRONTEND=noninteractive
if ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq fail2ban
fi

mkdir -p /etc/fail2ban/jail.d
cat >/etc/fail2ban/jail.d/order-sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 3
findtime = 10m
bantime = 1h
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1w

[recidive]
enabled = true
logpath = /var/log/fail2ban.log
banaction = %(banaction_allports)s
bantime = 1w
findtime = 1d
maxretry = 3
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban
sleep 1
fail2ban-client status 2>/dev/null || true
fail2ban-client status sshd 2>/dev/null | head -15 || true

echo "[harden] lock down ${TARGET_USER} authorized_keys perms"
if [[ -d "${TARGET_HOME}/.ssh" ]]; then
  chown -R "${TARGET_USER}:${TARGET_USER}" "${TARGET_HOME}/.ssh" 2>/dev/null || chown -R "${TARGET_USER}:root" "${TARGET_HOME}/.ssh" || true
  chmod 700 "${TARGET_HOME}/.ssh"
  if [[ -f "${TARGET_HOME}/.ssh/authorized_keys" ]]; then
    sed -i 's/^[[:space:]]*//' "${TARGET_HOME}/.ssh/authorized_keys"
    chmod 600 "${TARGET_HOME}/.ssh/authorized_keys"
    chown "${TARGET_USER}:${TARGET_USER}" "${TARGET_HOME}/.ssh/authorized_keys" 2>/dev/null || true
  fi
fi

install -d -m 0755 /var/lib/order-watchdog
if [[ -f "${TARGET_HOME}/.ssh/authorized_keys" ]]; then
  sha256sum "${TARGET_HOME}/.ssh/authorized_keys" | awk '{print $1}' >/var/lib/order-watchdog/authorized_keys.sha256
  echo "${TARGET_USER}" >/var/lib/order-watchdog/harden-user.txt
  chmod 644 /var/lib/order-watchdog/authorized_keys.sha256 /var/lib/order-watchdog/harden-user.txt
fi

# Quick malware cron scan (report + strip known pipe-to-shell)
echo "[harden] scan crontabs for remote pipe-to-shell"
CRON_PIPE_RE='(wget|curl).*\|\s*(/bin/)?(ba)?sh|193\.32\.162\.73|/d/[a-f0-9]+/init\.sh'
for cron_user in root ubuntu "${TARGET_USER}"; do
  id "$cron_user" >/dev/null 2>&1 || continue
  if crontab -u "$cron_user" -l 2>/dev/null | grep -qE "$CRON_PIPE_RE"; then
    echo "[harden] CLEANING suspicious crontab for $cron_user"
    crontab -u "$cron_user" -l 2>/dev/null | grep -E "$CRON_PIPE_RE" || true
    cleaned="$(crontab -u "$cron_user" -l 2>/dev/null | grep -vE "$CRON_PIPE_RE" || true)"
    if [[ -n "$(echo "$cleaned" | sed '/^[[:space:]]*$/d' | sed '/^#/d')" ]]; then
      echo "$cleaned" | crontab -u "$cron_user" -
    else
      crontab -u "$cron_user" -r 2>/dev/null || true
    fi
  fi
done

# Block known C2 if ufw present
if command -v ufw >/dev/null 2>&1; then
  ufw deny out to 193.32.162.73 comment 'malware-c2-block' 2>/dev/null || true
  ufw deny from 193.32.162.73 comment 'malware-c2-block' 2>/dev/null || true
fi

echo "[harden] done on $(hostname)."
echo "  Reconnect with SSH key to confirm. Password login should be denied."
