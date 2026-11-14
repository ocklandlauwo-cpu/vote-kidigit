#!/usr/bin/env bash
# Step 34 · Tech Stack 9.7 — activates an uploaded release on the server. Run by the deploy
# workflow as vk, from inside the release folder:
#   PUBLIC_HTML=/home/<user>/domains/<domain>/public_html bash deploy/release.sh
# 1. links the shared .env; 2. installs dependencies from the lockfile; 3. migrates the database
# as vk_owner; 4. publishes the frontends; 5. points /home/vk/current here and reloads PM2
# (cluster reload: no downtime); 6. keeps the newest 5 releases for rollback.
set -euo pipefail
: "${PUBLIC_HTML:?Set PUBLIC_HTML to the document root of the domain}"
RELEASE=$(cd "$(dirname "$0")/.." && pwd)
RELEASES=/home/vk/releases
KEEP=5
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh"
cd "$RELEASE"

[[ -f /home/vk/shared/.env ]] || { echo "Missing /home/vk/shared/.env" >&2; exit 1; }
ln -sfn /home/vk/shared/.env apps/api/.env

# Production dependencies, plus the API's dev tools for `prisma migrate deploy` (the Prisma CLI
# is a devDependency). The lockfile decides every version; nothing is upgraded here.
pnpm install --frozen-lockfile --filter @vote-kidigit/api... --config.confirmModulesPurge=false

# Forward-only migrations as vk_owner (MIGRATION_DATABASE_URL). A failed migration stops the
# release before anything is switched: the old release keeps serving.
pnpm --filter @vote-kidigit/api exec prisma migrate deploy

# Frontends: the voter app at the root, the staff portal in app/. Hashed assets from older
# builds stay for a day, so pages already open keep loading their chunks.
rsync -a apps/voter/dist/ "$PUBLIC_HTML/" --exclude app/
rsync -a apps/staff/dist/ "$PUBLIC_HTML/app/"
find "$PUBLIC_HTML/assets" "$PUBLIC_HTML/app/assets" -type f -mtime +1 -delete 2>/dev/null || true

ln -sfn "$RELEASE" /home/vk/current.next
mv -Tf /home/vk/current.next /home/vk/current
pm2 startOrReload /home/vk/current/deploy/ecosystem.config.cjs --update-env
pm2 save

# Keep the newest releases (by modification time), never the live one.
live=$(readlink -f /home/vk/current)
ls -1dt "$RELEASES"/*/ | tail -n +$((KEEP + 1)) | while read -r old; do
  [[ $(readlink -f "$old") == "$live" ]] || rm -rf "$old"
done

echo "Released $(basename "$RELEASE")"
