#!/usr/bin/env bash
# Step 33 · Tech Stack 9.2, Backend Schema 2.2 — PostgreSQL 18.6 from PGDG, tuned for 8 GB RAM,
# locked to that version, with WAL archiving for point-in-time recovery (PRD NFR-11), the three
# database roles (deploy/sql/000_roles.sql: vk_owner, vk_api, vk_readonly) and pg_trgm.
# Run as root from the repository checkout, once:
#   sudo bash deploy/provision/03-postgres.sh
# The role passwords are asked for (or taken from VK_OWNER_PW, VK_API_PW, VK_RO_PW). Put the
# vk_owner and vk_api passwords into /home/vk/shared/.env (MIGRATION_DATABASE_URL, DATABASE_URL).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }
cd "$(dirname "$0")/../.."

PG_VERSION=18.6
PG=/usr/pgsql-18/bin
DATA=/var/lib/pgsql/18/data
WAL_ARCHIVE=/var/lib/pgsql/18/wal-archive
DB=vote_kidigit

ask() { # ask VAR "prompt": keeps an exported value, otherwise reads it without echo
  local name=$1 value
  if [[ -z "${!name:-}" ]]; then
    read -r -s -p "$2: " value
    echo
    printf -v "$name" '%s' "$value"
  fi
  value=${!name}
  [[ ${#value} -ge 16 ]] || { echo "$name: use at least 16 characters." >&2; exit 1; }
}

if ! rpm -q "postgresql18-server-${PG_VERSION}" >/dev/null 2>&1; then
  dnf -y install https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
  dnf -qy module disable postgresql
  dnf -y install "postgresql18-server-${PG_VERSION}" "postgresql18-${PG_VERSION}" \
    "postgresql18-contrib-${PG_VERSION}"
  dnf versionlock add 'postgresql18*'
fi
[[ -f "$DATA/PG_VERSION" ]] || "$PG/postgresql-18-setup" initdb
install -d -m 700 -o postgres -g postgres "$WAL_ARCHIVE"

# Local password logins for the application roles only; localhost only (Tech Stack 9.2).
HBA="$DATA/pg_hba.conf"
if ! grep -q 'vote-kidigit roles' "$HBA"; then
  tmp=$(mktemp)
  {
    echo '# vote-kidigit roles (deploy/provision/03-postgres.sh)'
    echo "host  $DB  vk_owner,vk_api,vk_readonly  127.0.0.1/32  scram-sha-256"
    echo "host  $DB  vk_owner,vk_api,vk_readonly  ::1/128       scram-sha-256"
    echo "host  ${DB}_restore_test  vk_owner  127.0.0.1/32  scram-sha-256"
    cat "$HBA"
  } > "$tmp"
  install -m 600 -o postgres -g postgres "$tmp" "$HBA"
  rm -f "$tmp"
fi

systemctl enable --now postgresql-18
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
ALTER SYSTEM SET listen_addresses = 'localhost';
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '5GB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = 'test ! -f ${WAL_ARCHIVE}/%f && cp %p ${WAL_ARCHIVE}/%f';
ALTER SYSTEM SET archive_timeout = '300';
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
ALTER SYSTEM SET timezone = 'UTC';
ALTER SYSTEM SET log_connections = 'on';
ALTER SYSTEM SET log_disconnections = 'on';
SQL
systemctl restart postgresql-18

ask VK_OWNER_PW 'Password for vk_owner (migrations)'
ask VK_API_PW 'Password for vk_api (the application)'
ask VK_RO_PW 'Password for vk_readonly (support queries)'
# The passwords travel in the environment (never in psql's arguments, which `ps` shows) and
# psql reads them with \getenv. Root reads the SQL file and pipes it in: postgres cannot.
export VK_OWNER_PW VK_API_PW VK_RO_PW
{
  printf '\\getenv owner_pw VK_OWNER_PW\n\\getenv api_pw VK_API_PW\n\\getenv ro_pw VK_RO_PW\n'
  cat deploy/sql/000_roles.sql
} | sudo --preserve-env=VK_OWNER_PW,VK_API_PW,VK_RO_PW -u postgres \
  psql -q -d postgres -v db_name="$DB"

# Root's backup scripts connect as vk_owner (dumps, restore test) and vk_readonly (open-events
# check), never as a superuser: code a database owner controls never runs with superuser rights.
pgpass_escape() { sed -e 's/\\/\\\\/g' -e 's/:/\\:/g' <<<"$1"; }
umask 077
{
  echo "127.0.0.1:5432:*:vk_owner:$(pgpass_escape "$VK_OWNER_PW")"
  echo "127.0.0.1:5432:*:vk_readonly:$(pgpass_escape "$VK_RO_PW")"
} > /root/.pgpass
chmod 600 /root/.pgpass

sudo -u postgres psql -tAc 'SHOW server_version'
echo "PostgreSQL ready. Next: sudo bash deploy/provision/04-redis.sh"
