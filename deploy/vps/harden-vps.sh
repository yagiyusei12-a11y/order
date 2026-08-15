#!/usr/bin/env bash
# Harden VPS SSH / fail2ban for order host.
# Safe to re-run. Requires working key-based SSH for ubuntu (do NOT run if you only have password login).
# Usage on VPS: sudo bash deploy/vps/harden-vps.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/vps/harden-vps.sh"
  exit 1
fi

echo "[harden] SSH: disable password login (key-only)"
# OpenSSH uses first-obtained value; put our file before cloud-init's 50-*.
cat >/etc/ssh/sshd_config.d/00-order-hardening.conf <<'EOF'
# Managed by deploy/vps/harden-vps.sh — key-only SSH
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
  cp -a /etc/ssh/sshd_config.d/50-cloud-init.conf "/etc/ssh/sshd_config.d/50-cloud-init.conf.bak.$(date +%Y%m%d%H%M%S)"
  cat >/etc/ssh/sshd_config.d/50-cloud-init.conf <<'EOF'
# Overridden by order harden-vps.sh (was PasswordAuthentication yes)
PasswordAuthentication no
EOF
fi

sshd -t
systemctl reload ssh || systemctl reload sshd

echo "[harden] verify effective sshd settings:"
sshd -T | grep -iE 'passwordauthentication|permitrootlogin|pubkeyauthentication|maxauthtries|x11forwarding'

echo "[harden] fail2ban: stricter sshd + recidive"
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
fail2ban-client status sshd | head -20 || true

echo "[harden] lock down ubuntu authorized_keys perms"
if [[ -d /home/ubuntu/.ssh ]]; then
  chown -R ubuntu:ubuntu /home/ubuntu/.ssh
  chmod 700 /home/ubuntu/.ssh
  if [[ -f /home/ubuntu/.ssh/authorized_keys ]]; then
    # strip leading spaces that some tools leave
    sed -i 's/^[[:space:]]*//' /home/ubuntu/.ssh/authorized_keys
    chmod 600 /home/ubuntu/.ssh/authorized_keys
    chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys
  fi
fi

echo "[harden] baseline authorized_keys hash for watchdog"
install -d -m 0755 /var/lib/order-watchdog
if [[ -f /home/ubuntu/.ssh/authorized_keys ]]; then
  sha256sum /home/ubuntu/.ssh/authorized_keys | awk '{print $1}' >/var/lib/order-watchdog/authorized_keys.sha256
  chmod 644 /var/lib/order-watchdog/authorized_keys.sha256
fi

echo "[harden] ufw: ensure SSH/HTTP/HTTPS only from world (already typical)"
if command -v ufw >/dev/null 2>&1; then
  ufw status | head -5 || true
fi

echo "[harden] done. Reconnect with SSH key to confirm before closing this session."
echo "  ssh -i <key> ubuntu@$(hostname -I | awk '{print $1}')"
