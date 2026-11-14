#!/usr/bin/env bash
# Step 34 · Tech Stack 9.7 — switches back to the previous release (or a named one) and reloads.
# Run on the server as vk:
#   PUBLIC_HTML=/home/<user>/domains/<domain>/public_html bash /home/vk/current/deploy/rollback.sh [release-sha]
# Database migrations are forward-only and are NOT undone: roll back only to a release whose
# code works with the current schema (every release since the last migration does). Never
# while an event is Open.
set -euo pipefail
: "${PUBLIC_HTML:?Set PUBLIC_HTML to the document root of the domain}"
RELEASES=/home/vk/releases
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh"

live=$(readlink -f /home/vk/current)
if [[ -n ${1:-} ]]; then
  target="$RELEASES/$1"
else
  target=$(ls -1dt "$RELEASES"/*/ | while read -r dir; do
    dir=${dir%/}
    [[ $(readlink -f "$dir") != "$live" ]] && { echo "$dir"; break; }
  done)
fi
[[ -n ${target:-} && -d $target ]] || { echo "No release to roll back to." >&2; exit 1; }

rsync -a "$target/apps/voter/dist/" "$PUBLIC_HTML/" --exclude app/
rsync -a "$target/apps/staff/dist/" "$PUBLIC_HTML/app/"
ln -sfn "$target" /home/vk/current.next
mv -Tf /home/vk/current.next /home/vk/current
pm2 startOrReload /home/vk/current/deploy/ecosystem.config.cjs --update-env
pm2 save
echo "Rolled back from $(basename "$live") to $(basename "$target")"
