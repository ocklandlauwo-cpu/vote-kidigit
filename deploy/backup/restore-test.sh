#!/usr/bin/env bash
# Step 33 · Tech Stack 9.8 — monthly restore test (and the step 33 "done when"): restores the
# newest daily dump into a scratch database, checks that the main tables came back with rows
# and that the ballot schema, the immutability triggers and the RLS policies are there, then
# drops the copy. Run as root:  restore-test.sh [dump-file]
#
# The dump holds objects vk_owner created, so it is restored AS vk_owner (pg_restore --role)
# into a database vk_owner owns: nothing in it ever runs as a superuser. pg_trgm is a trusted
# extension, which the database owner may create. The checks run with a catalog-only
# search_path, so no function of the restored schema can run as superuser either.
set -euo pipefail
DUMP=${1:-$(ls -1t /var/backups/vote-kidigit/daily/*.dump | head -1)}
SCRATCH=vote_kidigit_restore_test
[[ -f $DUMP ]] || { echo "No dump found." >&2; exit 1; }

psql_pg() { sudo -u postgres psql -v ON_ERROR_STOP=1 -tA "$@"; }
safe() { psql_pg -d "$SCRATCH" -c 'SET search_path = pg_catalog' -c "$1"; }
psql_pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH"
psql_pg -d postgres -c "CREATE DATABASE $SCRATCH OWNER vk_owner"
trap 'psql_pg -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null' EXIT

sudo -u postgres pg_restore --role=vk_owner --no-owner --exit-on-error -d "$SCRATCH" < "$DUMP"

echo "Restored $(basename "$DUMP") into $SCRATCH:"
fail=0
for table in organizations users voting_events voters _prisma_migrations; do
  rows=$(safe "SELECT count(*) FROM public.$table")
  printf '  %-20s %s rows\n' "$table" "$rows"
  [[ $table == _prisma_migrations && $rows -eq 0 ]] && fail=1
done
for check in \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema OPERATOR(pg_catalog.=) 'ballot'" \
  "SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname OPERATOR(pg_catalog.~~) '%immutable%'" \
  "SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname OPERATOR(pg_catalog.=) 'public'"; do
  value=$(safe "$check")
  printf '  %s\n    → %s\n' "$check" "$value"
  [[ $value -gt 0 ]] || fail=1
done
[[ $fail -eq 0 ]] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED"; exit 1; }
