#!/usr/bin/env bash
# Step 33 · Tech Stack 9.8 — monthly restore test (and the step 33 "done when"): restores the
# newest daily dump into a scratch database, checks that the main tables came back with rows
# and that the ballot schema, the immutability triggers and the RLS policies are there, then
# drops the copy. Run as root:  restore-test.sh [dump-file]
#
# The restore and every check connect AS vk_owner (root's ~/.pgpass), into a scratch database
# vk_owner owns: no superuser session ever runs what the dump contains, so a function, view or
# operator in it cannot gain superuser rights (SET ROLE would not be enough: RESET ROLE undoes
# it). The postgres superuser only creates and drops the empty scratch database. pg_trgm is a
# trusted extension, which the database owner may create.
set -euo pipefail
DUMP=${1:-$(ls -1t /var/backups/vote-kidigit/daily/*.dump | head -1)}
SCRATCH=vote_kidigit_restore_test
OWNER=(-h 127.0.0.1 -p 5432 -w -U vk_owner)
[[ -f $DUMP ]] || { echo "No dump found." >&2; exit 1; }

superuser() { sudo -u postgres psql -v ON_ERROR_STOP=1 -tA -d postgres -c "$1"; }
as_owner() { psql "${OWNER[@]}" -d "$SCRATCH" -v ON_ERROR_STOP=1 -tA -c "$1"; }
superuser "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)"
superuser "CREATE DATABASE $SCRATCH OWNER vk_owner"
trap 'superuser "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)" >/dev/null' EXIT

pg_restore "${OWNER[@]}" --no-owner --exit-on-error -d "$SCRATCH" "$DUMP"

echo "Restored $(basename "$DUMP") into $SCRATCH:"
fail=0
for table in organizations users voting_events voters _prisma_migrations; do
  rows=$(as_owner "SELECT count(*) FROM public.$table")
  printf '  %-20s %s rows\n' "$table" "$rows"
  [[ $table == _prisma_migrations && $rows -eq 0 ]] && fail=1
done
for check in \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ballot'" \
  "SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%immutable%'" \
  "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'"; do
  value=$(as_owner "$check")
  printf '  %s\n    → %s\n' "$check" "$value"
  [[ $value -gt 0 ]] || fail=1
done
[[ $fail -eq 0 ]] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED"; exit 1; }
