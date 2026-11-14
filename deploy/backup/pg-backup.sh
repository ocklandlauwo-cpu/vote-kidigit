#!/usr/bin/env bash
# Step 33 · Tech Stack 9.8 — database dumps. Run by root's cron (deploy/backup/crontab):
#   pg-backup.sh daily    every night; keeps 14
#   pg-backup.sh hourly   every hour, but only while an event is Open; keeps 48
# Custom-format dumps (pg_restore can restore one table). The uploaded files are copied by
# offsite-rsync.sh; the WAL archive gives point-in-time recovery between dumps.
#
# Connects as vk_readonly (the check) and vk_owner (the dump) with root's ~/.pgpass, written by
# deploy/provision/03-postgres.sh — never as a superuser, so nothing a database owner controls
# (tables swapped for views, functions, operators) can run with superuser rights.
set -euo pipefail
MODE=${1:-daily}
DB=vote_kidigit
ROOT=/var/backups/vote-kidigit
PGCONN=(-h 127.0.0.1 -p 5432 -w)
case $MODE in
  daily) KEEP=14 ;;
  hourly) KEEP=48 ;;
  *) echo "Usage: $0 daily|hourly" >&2; exit 2 ;;
esac

if [[ $MODE == hourly ]]; then
  open=$(psql "${PGCONN[@]}" -U vk_readonly -d "$DB" -tAc \
    "SELECT count(*) FROM public.voting_events WHERE status = 'open' AND deleted_at IS NULL")
  [[ $open -gt 0 ]] || exit 0
fi

umask 077
target="$ROOT/$MODE/${DB}-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump "${PGCONN[@]}" -U vk_owner --format=custom --compress=6 "$DB" > "$target.partial"
mv "$target.partial" "$target"

# Keep the newest $KEEP dumps of this kind.
ls -1t "$ROOT/$MODE"/*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# WAL segments older than 7 days are no longer needed for point-in-time recovery.
find /var/lib/pgsql/18/wal-archive -type f -mtime +7 -delete

logger -t vote-kidigit-backup "pg_dump $MODE ok: $(basename "$target") $(stat -c %s "$target") bytes"
