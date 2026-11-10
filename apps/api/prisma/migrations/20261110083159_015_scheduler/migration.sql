-- This is an empty migration.
-- Hand-written below this line

-- ---------------------------------------------------------------------------------------------
-- 11.9 app.due_transitions(): what the worker's 1-minute sweep must do, across organizations.
-- SECURITY DEFINER (vk_owner) because the sweep has no organization yet; it returns only ids and
-- the action. The worker then acts on each item inside that item's organization through
-- app.transition_event() or a category update, so every check still runs.
--   open_event      Scheduled event whose start time has come
--   close_event     Open event whose end time has passed (acted on from step 27, with results)
--   close_category  Category of an Open event past its own closing time (automatic mode only:
--                   a category opened by hand ignores its times, as app.category_is_votable does)
-- Reminders join in step 21.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.due_transitions(p_now timestamptz)
RETURNS TABLE (event_id uuid, category_id uuid, organization_id uuid, action text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT e.id, NULL::uuid, e.organization_id, 'open_event'
  FROM public.voting_events e
  WHERE e.status = 'scheduled' AND e.start_at <= p_now AND e.is_active AND e.deleted_at IS NULL
  UNION ALL
  SELECT e.id, NULL::uuid, e.organization_id, 'close_event'
  FROM public.voting_events e
  WHERE e.status = 'open' AND e.end_at <= p_now AND e.deleted_at IS NULL
  UNION ALL
  SELECT c.event_id, c.id, c.organization_id, 'close_category'
  FROM public.categories c
  JOIN public.voting_events e ON e.id = c.event_id
  WHERE e.status = 'open' AND e.deleted_at IS NULL
    AND c.is_active AND c.manual_state = 'auto'
    AND c.closes_at IS NOT NULL AND c.closes_at <= p_now AND c.closed_at IS NULL
$$;

REVOKE ALL ON FUNCTION app.due_transitions(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.due_transitions(timestamptz) TO vk_api;
