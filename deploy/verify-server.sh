#!/usr/bin/env bash
# Step 33 "done when" — checks every version, service, port and setting the server needs
# (Tech Stack 3, 4, 9; docs/SECURITY.md 5), prints PASS / FAIL per line, exits 1 on any FAIL.
# Run as root after deploy/provision/*.sh:
#   sudo bash deploy/verify-server.sh [domain]        e.g. vote.example.co.tz
# The Redis password and database URL are read from /home/vk/shared/.env.
set -uo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
DOMAIN=${1:-}
ENV_FILE=/home/vk/shared/.env
failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }
warn() { printf 'WARN  %s\n' "$1"; }
check() { # check "description" command...
  local name=$1; shift
  if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi
}
equals() { # equals "description" expected actual
  if [[ $3 == "$2" ]]; then pass "$1 = $2"; else fail "$1: expected $2, got ${3:-nothing}"; fi
}
envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }

echo "== System"
check 'Rocky Linux 9' grep -q 'Rocky Linux release 9' /etc/rocky-release
check 'user vk exists' id vk
for service in crond firewalld postgresql-18 redis pm2-vk; do
  check "service $service enabled and running" bash -c "systemctl is-enabled $service && systemctl is-active $service"
done

echo "== Versions"
as_vk() { sudo -iu vk bash -lc "$1" 2>/dev/null; }
equals 'Node.js' v24.22.2 "$(as_vk 'node --version')"
equals 'PM2' 6.0.14 "$(as_vk 'pm2 --version')"
equals 'pnpm (Corepack)' 11.28.10 "$(as_vk 'cd /home/vk/current 2>/dev/null && pnpm --version')"
equals 'PostgreSQL' 18.6 "$(sudo -u postgres psql -tAc 'SHOW server_version' | cut -d' ' -f1)"
redis_version=$(redis-server --version | grep -oE 'v=[0-9.]+' | cut -d= -f2)
[[ $redis_version == 7.2.* ]] && pass "Redis $redis_version (7.2)" || fail "Redis: expected 7.2.x, got ${redis_version:-nothing}"
check 'PostgreSQL version-locked' bash -c "dnf versionlock list | grep -q postgresql18"
check 'Redis version-locked' bash -c "dnf versionlock list | grep -q redis"

echo "== Network (only web, SSH and DirectAdmin are reachable)"
listening() { ss -ltnH "( sport = :$1 )" | awk '{print $4}'; }
for port in 5432 6379 3000; do
  addresses=$(listening $port)
  if [[ -z $addresses ]]; then
    [[ $port == 3000 ]] && warn "port 3000: API not running yet" || fail "port $port: nothing listening"
  elif grep -qvE '^(127\.0\.0\.1|\[::1\]):' <<<"$addresses"; then
    fail "port $port listens beyond localhost: $(tr '\n' ' ' <<<"$addresses")"
  else
    pass "port $port on localhost only"
  fi
done
open=$(firewall-cmd --list-all)
for port in 5432 6379 3000; do
  grep -qE "ports:.*\b$port/tcp" <<<"$open" && fail "firewall opens $port" || pass "firewall keeps $port closed"
done
for service in http https ssh; do
  grep -qE "services:.*\b$service\b" <<<"$open" && pass "firewall allows $service" || fail "firewall: $service not allowed"
done

echo "== PostgreSQL settings and roles"
setting() { sudo -u postgres psql -tAc "SHOW $1"; }
equals 'listen_addresses' localhost "$(setting listen_addresses)"
equals 'max_connections' 100 "$(setting max_connections)"
equals 'shared_buffers' 2GB "$(setting shared_buffers)"
equals 'wal_level' replica "$(setting wal_level)"
equals 'archive_mode' on "$(setting archive_mode)"
equals 'TimeZone' UTC "$(setting TimeZone)"
equals 'password_encryption' scram-sha-256 "$(setting password_encryption)"
roles=$(sudo -u postgres psql -tAc "SELECT rolname || ':' || rolbypassrls || ':' || rolsuper FROM pg_roles WHERE rolname LIKE 'vk\_%' ORDER BY 1" | tr '\n' ' ')
equals 'roles (name:bypassrls:superuser)' 'vk_api:f:f vk_owner:f:f vk_readonly:t:f ' "$roles"
check 'database vote_kidigit owned by vk_owner' bash -c "sudo -u postgres psql -tAc \"SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE datname = 'vote_kidigit' AND rolname = 'vk_owner'\" | grep -q 1"
check 'pg_trgm installed' bash -c "sudo -u postgres psql -d vote_kidigit -tAc \"SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'\" | grep -q 1"
archiver=$(sudo -u postgres psql -tAc 'SELECT failed_count FROM pg_stat_archiver')
equals 'WAL archive failures' 0 "$archiver"

echo "== Redis settings"
redis_password=$(envval REDIS_URL | sed -nE 's|^rediss?://:([^@]*)@.*|\1|p')
if [[ -z $redis_password ]]; then
  fail "REDIS_URL with a password in $ENV_FILE"
else
  rc() { REDISCLI_AUTH="$redis_password" redis-cli --no-auth-warning "$@"; }
  equals 'Redis PING' PONG "$(rc ping)"
  equals 'maxmemory-policy' noeviction "$(rc config get maxmemory-policy | tail -1)"
  equals 'appendonly' yes "$(rc config get appendonly | tail -1)"
  equals 'maxmemory' 805306368 "$(rc config get maxmemory | tail -1)"
  check 'Redis refuses requests without the password' bash -c "redis-cli ping 2>&1 | grep -q NOAUTH"
fi

echo "== Chromium libraries (PDFs)"
for package in nss atk at-spi2-atk cups-libs libdrm libxkbcommon libXcomposite libXdamage \
  libXrandr libXScrnSaver mesa-libgbm pango alsa-lib gtk3; do
  rpm -q "$package" >/dev/null 2>&1 || fail "package $package missing"
done
pass 'Chromium library check done'

echo "== Files"
check '/home/vk/storage owned by vk, not world-readable' bash -c "[[ \$(stat -c '%U %a' /home/vk/storage) == 'vk 750' ]]"
check "$ENV_FILE owned by vk, mode 600" bash -c "[[ \$(stat -c '%U %a' $ENV_FILE) == 'vk 600' ]]"
check 'NODE_ENV=production in .env' bash -c "[[ \$(grep -E '^NODE_ENV=' $ENV_FILE | cut -d= -f2) == production ]]"
check 'SMS_DRIVER=beem in .env' bash -c "[[ \$(grep -E '^SMS_DRIVER=' $ENV_FILE | cut -d= -f2) == beem ]]"
check 'backups folder only for root' bash -c "[[ \$(stat -c '%U %a' /var/backups/vote-kidigit) == 'root 700' ]]"
check 'backup crontab installed' bash -c "crontab -l | grep -q pg-backup.sh"
latest=$(ls -1t /var/backups/vote-kidigit/daily/*.dump 2>/dev/null | head -1)
if [[ -z $latest ]]; then
  warn 'no daily dump yet (run /usr/local/sbin/pg-backup.sh daily, then restore-test.sh)'
elif [[ $(( $(date +%s) - $(stat -c %Y "$latest") )) -lt 93600 ]]; then
  pass "daily dump less than 26 h old: $(basename "$latest")"
else
  fail "newest daily dump is older than 26 h: $(basename "$latest")"
fi

if [[ -n $DOMAIN ]]; then
  echo "== HTTPS ($DOMAIN)"
  headers=$(curl -sSI "https://$DOMAIN/" 2>&1)
  check 'HTTPS answers' grep -qE '^HTTP/[0-9.]+ 200' <<<"$headers"
  for header in 'strict-transport-security: max-age=31536000' "content-security-policy: frame-ancestors 'none'" \
    'x-content-type-options: nosniff' 'referrer-policy: same-origin'; do
    grep -qi "^$header" <<<"$headers" && pass "header $header" || fail "header missing: $header"
  done
  check 'TLS 1.0 refused' bash -c "! curl -sS --tlsv1.0 --tls-max 1.0 -o /dev/null https://$DOMAIN/"
  check 'TLS 1.1 refused' bash -c "! curl -sS --tlsv1.1 --tls-max 1.1 -o /dev/null https://$DOMAIN/"
  check 'HTTP redirects to HTTPS' bash -c "curl -sSI http://$DOMAIN/ | grep -qiE '^location: https://'"
  check 'API health through the proxy' bash -c "curl -fsS https://$DOMAIN/api/health | grep -q ok"
fi

echo
if [[ $failures -eq 0 ]]; then echo "SERVER CHECK PASSED"; else echo "SERVER CHECK FAILED: $failures"; exit 1; fi
