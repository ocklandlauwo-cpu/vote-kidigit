-- This is an empty migration.
-- Hand-written below this line

-- ---------------------------------------------------------------------------------------------
-- app.event_counts(): registered and voted counts per event for the dashboards (App Flow 5.2).
-- Platform admins have no access to voters or participation (Backend Schema 10), yet DSH-01 shows
-- turnout and voter counts; this returns numbers only, for events the caller's context may see:
-- any event for a platform admin, otherwise events of app.current_org_id().
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.event_counts(p_event_ids uuid[])
RETURNS TABLE (event_id uuid, registered bigint, voted bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT e.id,
         (SELECT count(*) FROM public.voters v
          WHERE v.event_id = e.id AND v.deleted_at IS NULL),
         (SELECT count(DISTINCT p.voter_id) FROM public.voter_participation p
          WHERE p.event_id = e.id)
  FROM public.voting_events e
  WHERE e.id = ANY (p_event_ids)
    AND e.deleted_at IS NULL
    AND (app.is_platform_admin() OR e.organization_id = app.current_org_id())
$$;

REVOKE ALL ON FUNCTION app.event_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_counts(uuid[]) TO vk_api;
