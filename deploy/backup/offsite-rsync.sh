#!/usr/bin/env bash
# Step 33 · Tech Stack 9.8 — nightly copy of the dumps, the WAL archive and the uploaded files
# to storage outside the VPS. Run by root's cron. OFFSITE is an rsync target reachable with an
# SSH key only, for example backup@backup.example.org:vote-kidigit/
#   OFFSITE=backup@host:vote-kidigit/ offsite-rsync.sh
# Never copied: apps/api/.env (secrets are kept separately) and generated PDFs (regenerable).
set -euo pipefail
: "${OFFSITE:?Set OFFSITE to the rsync target, e.g. backup@host:vote-kidigit/}"
RSYNC=(rsync -a --delete-after --partial -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes")

"${RSYNC[@]}" /var/backups/vote-kidigit/ "${OFFSITE%/}/dumps/"
"${RSYNC[@]}" /var/lib/pgsql/18/wal-archive/ "${OFFSITE%/}/wal/"
"${RSYNC[@]}" --exclude '*/report/*' /home/vk/storage/ "${OFFSITE%/}/storage/"

logger -t vote-kidigit-backup "off-site rsync ok to ${OFFSITE%%:*}"
