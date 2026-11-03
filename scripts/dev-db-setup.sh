#!/usr/bin/env bash
# Development PC setup (Implementation Plan step 3):
#   1. start PostgreSQL 18.6 and Redis 7.2 from docker-compose.dev.yml
#   2. create the vk_owner / vk_api / vk_readonly roles and the vote_kidigit and
#      vote_kidigit_test databases with deploy/sql/000_roles.sql
#   3. write apps/api/.env (only if it does not exist yet)
# Safe to re-run. Passwords are development-only defaults; override with DEV_*_PW variables.
set -euo pipefail

cd "$(dirname "$0")/.."

OWNER_PW="${DEV_OWNER_PW:-vk_owner_dev}"
API_PW="${DEV_API_PW:-vk_api_dev}"
RO_PW="${DEV_RO_PW:-vk_readonly_dev}"
COMPOSE=(docker compose -f docker-compose.dev.yml)

echo "Starting PostgreSQL and Redis..."
"${COMPOSE[@]}" up -d --wait

for db in vote_kidigit vote_kidigit_test; do
  echo "Creating roles and database ${db}..."
  "${COMPOSE[@]}" exec -T postgres psql -q -U postgres -d postgres \
    -v owner_pw="$OWNER_PW" -v api_pw="$API_PW" -v ro_pw="$RO_PW" -v db_name="$db" \
    -f - < deploy/sql/000_roles.sql
done

# Development only: Prisma migrate dev creates a temporary shadow database as the owner.
"${COMPOSE[@]}" exec -T postgres psql -q -U postgres -d postgres -c 'ALTER ROLE vk_owner CREATEDB;'

node scripts/dev-env.mjs

echo "Done. PostgreSQL on 127.0.0.1:5433, Redis on 127.0.0.1:6380."
