#!/usr/bin/env bash
# Step 33 · Tech Stack 9.1 — Node.js 24.22.2 (nvm), pnpm through Corepack and PM2 6.0.14 for the
# deploy user. Run as vk, once:
#   bash deploy/provision/02-node.sh
# At the end PM2 prints a `sudo env PATH=… pm2 startup …` command: run it as root.
set -euo pipefail
[[ $(id -un) == vk ]] || { echo "Run as the vk user." >&2; exit 1; }

NODE_VERSION=24.22.2
PM2_VERSION=6.0.14
NVM_VERSION=v0.40.3

if [[ ! -s "$HOME/.nvm/nvm.sh" ]]; then
  curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
fi
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
corepack enable
npm install -g "pm2@${PM2_VERSION}"

node --version
pm2 --version
pm2 startup systemd
echo "Run the command printed above as root, then: sudo bash deploy/provision/03-postgres.sh"
