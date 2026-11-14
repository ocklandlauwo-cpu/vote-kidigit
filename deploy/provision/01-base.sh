#!/usr/bin/env bash
# Step 33 · Tech Stack 9.1, 9.4, 9.8 — base setup of the Rocky Linux 9 VPS. Run as root, once.
#   sudo bash deploy/provision/01-base.sh
# Installs the tools, the deploy user vk, the firewall rules, Chromium's libraries for PDFs and
# the storage and backup folders. PostgreSQL and Redis are never opened in the firewall.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }

dnf -y update
dnf -y install dnf-plugin-versionlock git rsync tar unzip cronie
systemctl enable --now crond

id vk >/dev/null 2>&1 || useradd -m -s /bin/bash vk

# Web, SSH and DirectAdmin only; 5432 (PostgreSQL) and 6379 (Redis) stay closed.
firewall-cmd --permanent --add-service={http,https,ssh}
firewall-cmd --permanent --add-port=2222/tcp
firewall-cmd --reload

# Chromium system libraries for Puppeteer's headless shell (Tech Stack 9.4).
dnf -y install nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite \
  libXdamage libXrandr libXScrnSaver mesa-libgbm pango alsa-lib gtk3

# Storage outside the web root (STORAGE_DIR), releases, and the shared .env (Tech Stack 9.6–9.8).
install -d -m 750 -o vk -g vk /home/vk/storage /home/vk/releases /home/vk/shared
# Database dumps: root's cron writes them (deploy/backup); only root reads them.
install -d -m 700 /var/backups/vote-kidigit /var/backups/vote-kidigit/daily \
  /var/backups/vote-kidigit/hourly

echo "Base setup done. Next, as vk: bash deploy/provision/02-node.sh"
