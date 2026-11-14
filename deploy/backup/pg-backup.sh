#!/usr/bin/env bash
# Step 33 · Tech Stack 9.8 — database dumps. Run by root's cron (deploy/backup/crontab):
#   pg-backup.sh daily    every night; keeps 14
#   pg-backup.sh hourly   every hour, but only while an event is Open; keeps 48
# Custom-format dumps (pg_restore can restore one table). The uploaded files are copied by
# offsite-rsync.sh; the WAL archive gives point-in-time recovery between dumps.
set -euo pipefail
MODE=${1:-daily}
DB=vote_kidigit
ROOT=/var/backups/vote-kidigit
case $MODE in
  daily) KEEP=14 ;;
  hourly) KEEP=48 ;;
  *) echo "Usage: $0 daily|hourly" >&2; exit 2 ;;
esac

if [[ $MODE == hourly ]]; then
  # Runs as superuser inside a database vk_owner controls: catalog-only search_path and
  # qualified operators, so no function or operator of the app's schema can run here.
  open=$(sudo -u postgres psql -d "$DB" -tA -c "SET search_path = pg_catalog" \
    -c "SELECT count(*) FROM public.voting_events WHERE status::text OPERATOR(pg_catalog.=) 'open' AND deleted_at IS NULL")
  [[ $open -gt 0 ]] || exit 0
fi

target="$ROOT/$MODE/${DB}-$(date -u +%Y%m%dT%H%M%SZ).dump"
sudo -u postgres pg_dump --format=custom --compress=6 "$DB" > "$target.partial"
mv "$target.partial" "$target"
chmod 600 "$target"

# Keep the newest $KEEP dumps of this kind.
ls -1t "$ROOT/$MODE"/*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# WAL segments older than 7 days are no longer needed for point-in-time recovery.
find /var/lib/pgsql/18/wal-archive -type f -mtime +7 -delete

logger -t vote-kidigit-backup "pg_dump $MODE ok: $(basename "$target") $(stat -c %s "$target") bytes"
