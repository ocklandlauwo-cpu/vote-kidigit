#!/usr/bin/env bash
# Step 33 · Tech Stack 9.3 — Redis 7.2 on localhost with a password, 768 MB, noeviction (BullMQ
# must never lose jobs silently) and the append-only file. Run as root, once:
#   sudo bash deploy/provision/04-redis.sh
# The password is asked for (or taken from REDIS_PASSWORD); put it into REDIS_URL in
# /home/vk/shared/.env as redis://:<password>@127.0.0.1:6379/0
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }

if ! rpm -q redis >/dev/null 2>&1; then
  dnf -y module enable redis:7
  dnf -y install redis
  dnf versionlock add redis
fi

if [[ -z "${REDIS_PASSWORD:-}" ]]; then
  read -r -s -p 'Redis password (at least 24 characters): ' REDIS_PASSWORD
  echo
fi
[[ ${#REDIS_PASSWORD} -ge 24 ]] || { echo 'Use at least 24 characters.' >&2; exit 1; }
# Letters, digits, - and _ only (it goes through sed and into a URL); `openssl rand -hex 24` fits.
[[ $REDIS_PASSWORD =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Use letters, digits, - and _ only.' >&2; exit 1; }

CONF=/etc/redis/redis.conf
[[ -f $CONF ]] || CONF=/etc/redis.conf
set_option() { # replace or append "name value"
  if grep -qE "^#?\s*$1\s" "$CONF"; then
    sed -i -E "s|^#?\s*$1\s.*|$1 $2|" "$CONF"
  else
    echo "$1 $2" >> "$CONF"
  fi
}
set_option bind '127.0.0.1 -::1'
set_option protected-mode yes
set_option port 6379
set_option requirepass "$REDIS_PASSWORD"
set_option maxmemory 768mb
set_option maxmemory-policy noeviction
set_option appendonly yes
chmod 640 "$CONF"

systemctl enable redis
systemctl restart redis
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli config get maxmemory-policy | tail -1
echo "Redis ready. Next: the web server routing (deploy/nginx/README.md), then deploy/backup."
