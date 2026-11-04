-- 005_find_user_for_login (Backend Schema 8.1). Runs as vk_owner.
-- Staff sign-in looks a user up by email before any organization context exists, which RLS on
-- users would otherwise hide. This bootstrap function is the only cross-tenant read of users
-- vk_api can make, and returns only what sign-in needs. (The Backend Schema groups it with the
-- other bootstrap functions in 009; it is created here because sign-in arrives in step 9.)

CREATE FUNCTION app.find_user_for_login(p_email text)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  password_hash text,
  status user_status,
  locked_until timestamptz,
  failed_login_count smallint,
  is_platform_admin boolean
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.organization_id, u.password_hash, u.status, u.locked_until,
         u.failed_login_count, u.is_platform_admin
  FROM public.users u
  WHERE u.email_normalized = lower(btrim(p_email)) AND u.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION app.find_user_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_user_for_login(text) TO vk_api;
