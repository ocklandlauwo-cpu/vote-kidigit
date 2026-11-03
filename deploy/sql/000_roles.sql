-- Database roles and database (Backend Schema 2.2, 10.1).
-- Run by the postgres superuser, once per server and once per database; safe to re-run.
--
--   psql -U postgres -d postgres \
--     -v owner_pw=... -v api_pw=... -v ro_pw=... -v db_name=vote_kidigit \
--     -f deploy/sql/000_roles.sql
--
-- vk_owner    owns every schema, table and function; used only by prisma migrate deploy
-- vk_api      the application (API and worker); cannot bypass RLS, owns nothing
-- vk_readonly support queries; reads everything except ballots and voting codes
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE vk_owner LOGIN PASSWORD %L', :'owner_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vk_owner') \gexec

SELECT format('CREATE ROLE vk_api LOGIN PASSWORD %L NOBYPASSRLS', :'api_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vk_api') \gexec

SELECT format('CREATE ROLE vk_readonly LOGIN PASSWORD %L BYPASSRLS', :'ro_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vk_readonly') \gexec

-- Keep attributes and passwords in line with this file when it is re-run.
-- (Development adds CREATEDB to vk_owner for Prisma's shadow database; see scripts/dev-db-setup.sh.)
ALTER ROLE vk_owner    LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS PASSWORD :'owner_pw';
ALTER ROLE vk_api      LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD :'api_pw';
ALTER ROLE vk_readonly LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS PASSWORD :'ro_pw';

SELECT format('CREATE DATABASE %I OWNER vk_owner', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') \gexec

SELECT format('ALTER DATABASE %I OWNER TO vk_owner', :'db_name') \gexec
SELECT format('ALTER DATABASE %I SET timezone TO %L', :'db_name', 'UTC') \gexec
