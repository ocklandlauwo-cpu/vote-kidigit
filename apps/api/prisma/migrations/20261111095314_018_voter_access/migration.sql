-- This is an empty migration.

-- Hand-written below this line
-- 018_voter_access (Backend Schema 2.4): the context bootstrap functions for requests that arrive
-- before the organization is known (voter sign-in, the voter event card, public results). Each is
-- SECURITY DEFINER (vk_owner) with a pinned search_path, returns only what is needed to set the
-- context, and leaves Draft, deactivated and deleted events out.

-- app.resolve_event(): the organization and status of an event a voter link points at.
CREATE FUNCTION app.resolve_event(p_event_id uuid)
RETURNS TABLE (organization_id uuid, status event_status)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT e.organization_id, e.status
  FROM public.voting_events e
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
    AND e.is_active
    AND e.status <> 'draft'
    AND o.deleted_at IS NULL
$$;

-- app.find_voter_by_credentials(): voters whose membership ID and code fingerprint both match,
-- in one event or (without p_event_id) in any. The membership ID is compared the way the
-- generated column stores it (upper case, no whitespace).
CREATE FUNCTION app.find_voter_by_credentials(p_membership_id text, p_code_hmac bytea,
                                              p_event_id uuid DEFAULT NULL)
RETURNS TABLE (voter_id uuid, event_id uuid, organization_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT v.id, v.event_id, v.organization_id
  FROM public.voters v
  JOIN public.voting_events e ON e.id = v.event_id
  JOIN public.organizations o ON o.id = v.organization_id
  WHERE v.membership_id_normalized = upper(regexp_replace(p_membership_id, '\s', '', 'g'))
    AND v.code_hmac = p_code_hmac
    AND v.deleted_at IS NULL
    AND (p_event_id IS NULL OR v.event_id = p_event_id)
    AND e.deleted_at IS NULL
    AND e.is_active
    AND e.status <> 'draft'
    AND o.deleted_at IS NULL
$$;

-- app.resolve_results_token(): the event behind a public results link (RES-04).
CREATE FUNCTION app.resolve_results_token(p_token text)
RETURNS TABLE (event_id uuid, organization_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT e.id, e.organization_id
  FROM public.voting_events e
  WHERE e.public_results_token = p_token
    AND p_token IS NOT NULL
    AND e.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION app.resolve_event(uuid), app.find_voter_by_credentials(text, bytea, uuid),
  app.resolve_results_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_event(uuid), app.find_voter_by_credentials(text, bytea, uuid),
  app.resolve_results_token(text) TO vk_api;
