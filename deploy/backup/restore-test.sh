#!/usr/bin/env bash
# Step 33 · Tech Stack 9.8 — monthly restore test (and the step 33 "done when"): restores the
# newest daily dump into a scratch database, checks that the main tables came back with rows
# and that the ballot schema and the immutability triggers are there, then drops the copy.
# Run as root:  restore-test.sh [dump-file]
set -euo pipefail
DUMP=${1:-$(ls -1t /var/backups/vote-kidigit/daily/*.dump | head -1)}
SCRATCH=vote_kidigit_restore_test
[[ -f $DUMP ]] || { echo "No dump found." >&2; exit 1; }

psql_pg() { sudo -u postgres psql -v ON_ERROR_STOP=1 -tA "$@"; }
psql_pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH"
psql_pg -d postgres -c "CREATE DATABASE $SCRATCH"
trap 'psql_pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null' EXIT

# --no-owner: the scratch copy belongs to postgres; roles exist already on this server.
sudo -u postgres pg_restore --no-owner --exit-on-error -d "$SCRATCH" < "$DUMP"

echo "Restored $(basename "$DUMP") into $SCRATCH:"
fail=0
for table in organizations users voting_events voters _prisma_migrations; do
  rows=$(psql_pg -d "$SCRATCH" -c "SELECT count(*) FROM public.$table")
  printf '  %-20s %s rows\n' "$table" "$rows"
  [[ $table == _prisma_migrations && $rows -eq 0 ]] && fail=1
done
for check in \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ballot'" \
  "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%immutable%'" \
  "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'"; do
  value=$(psql_pg -d "$SCRATCH" -c "$check")
  printf '  %-70s %s\n' "$check" "$value"
  [[ $value -gt 0 ]] || fail=1
done
[[ $fail -eq 0 ]] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED"; exit 1; }
