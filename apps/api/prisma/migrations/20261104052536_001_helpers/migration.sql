-- 001_helpers (Backend Schema 2.1, 10.1, 11.1, 13.2). Runs as vk_owner.
-- Schemas, schema privileges, the request-context helpers read by RLS policies, and the
-- generic trigger functions. Tables arrive from 003 on.

-- pg_trgm is created by deploy/sql/000_roles.sql as superuser; it is a trusted extension, so the
-- owner may also create it here. This keeps Prisma's shadow database (created by vk_owner during
-- `prisma migrate dev`) identical to real databases.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ballot;
CREATE SCHEMA IF NOT EXISTS audit;

-- The ballot schema is reachable only through vk_owner's SECURITY DEFINER functions.
REVOKE ALL ON SCHEMA ballot FROM PUBLIC;
-- Nobody but the owner creates objects anywhere (PostgreSQL 15+ already revokes CREATE on
-- public from PUBLIC; stated here so it holds whatever the server defaults).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app, audit FROM PUBLIC;

GRANT USAGE ON SCHEMA public, app, audit TO vk_api, vk_readonly;

-- Functions created by vk_owner are not executable by PUBLIC (Backend Schema 11: SECURITY
-- DEFINER functions are granted to vk_api only). Default privileges for functions can only be
-- narrowed globally, not per schema, so this applies to every schema vk_owner creates them in.
ALTER DEFAULT PRIVILEGES FOR ROLE vk_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE vk_owner IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO vk_api;

-- ---------------------------------------------------------------------------------------------
-- Request context (Backend Schema 2.3): transaction-local settings written by
-- PrismaService.withContext and read by RLS policies.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE
AS $$ SELECT coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true' $$;

-- ---------------------------------------------------------------------------------------------
-- Generic triggers (Backend Schema 11.1)
-- ---------------------------------------------------------------------------------------------

-- updated_at on every mutable table:
--   CREATE TRIGGER {t}_updated_at BEFORE UPDATE ON public.{t}
--     FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE FUNCTION app.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Immutable tables (audit log, participation, ballots): BEFORE UPDATE OR DELETE / TRUNCATE.
-- The message is an API error code (Backend Schema 12.1).
CREATE FUNCTION app.forbid_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_RECORD' USING ERRCODE = 'P0001'; END $$;

-- Explicit grants (the default privileges above also cover functions added later).
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO vk_api;
