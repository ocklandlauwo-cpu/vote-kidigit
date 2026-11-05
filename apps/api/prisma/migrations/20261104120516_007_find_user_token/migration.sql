-- 007_find_user_token (Backend Schema 8.2). Runs as vk_owner.
-- Invitation and password-reset links are opened without a session, before the organization is
-- known, so RLS on user_tokens and users would hide the token. This bootstrap function looks a
-- token up by the SHA-256 of its value and returns only what the set-password screens and the
-- accept / reset endpoints need. (Grouped with the bootstrap functions of 009 in the Backend
-- Schema; created here because the token flows arrive in step 10.)

CREATE FUNCTION app.find_user_token(p_token_hash bytea)
RETURNS TABLE (
  token_id uuid,
  user_id uuid,
  organization_id uuid,
  purpose text,
  expires_at timestamptz,
  used_at timestamptz,
  user_status user_status,
  is_platform_admin boolean,
  full_name text,
  email text,
  organization_name text
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.user_id, u.organization_id, t.purpose, t.expires_at, t.used_at, u.status,
         u.is_platform_admin, u.full_name, u.email, o.name
  FROM public.user_tokens t
  JOIN public.users u ON u.id = t.user_id AND u.deleted_at IS NULL
  LEFT JOIN public.organizations o ON o.id = u.organization_id AND o.deleted_at IS NULL
  WHERE t.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION app.find_user_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.find_user_token(bytea) TO vk_api;
