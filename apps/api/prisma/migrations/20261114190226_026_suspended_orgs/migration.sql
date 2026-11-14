-- Hand-written below this line
-- Migration 026 (Implementation Plan step 39): a suspended organization runs no events (PRD
-- ORG-05). Suspension is refused while an event is Open (Backend Schema 12.3); this stops the
-- 1-minute sweep from opening its Scheduled events or sending their reminders afterwards.
-- Closing, closing categories and archiving still run. Replaced whole; otherwise as in 025.

CREATE OR REPLACE FUNCTION app.due_transitions(p_now timestamptz)
RETURNS TABLE (event_id uuid, category_id uuid, organization_id uuid, action text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT e.id, NULL::uuid, e.organization_id, 'open_event'
  FROM public.voting_events e
  JOIN public.organizations o ON o.id = e.organization_id AND o.status = 'active'
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
  UNION ALL
  SELECT e.id, NULL::uuid, e.organization_id, 'reminder_before_open'
  FROM public.voting_events e
  JOIN public.organizations o ON o.id = e.organization_id AND o.status = 'active'
  WHERE e.status = 'scheduled' AND e.is_active AND e.deleted_at IS NULL
    AND e.reminder_before_open_hours IS NOT NULL
    AND e.start_at - make_interval(hours => e.reminder_before_open_hours) <= p_now
    AND e.start_at > p_now
    AND NOT EXISTS (SELECT 1 FROM public.sms_batches b
                    WHERE b.event_id = e.id AND b.type = 'reminder_before_open')
  UNION ALL
  SELECT e.id, NULL::uuid, e.organization_id, 'reminder_before_close'
  FROM public.voting_events e
  JOIN public.organizations o ON o.id = e.organization_id AND o.status = 'active'
  WHERE e.status = 'open' AND e.deleted_at IS NULL
    AND e.reminder_before_close_minutes IS NOT NULL
    AND e.end_at - make_interval(mins => e.reminder_before_close_minutes) <= p_now
    AND e.end_at > p_now
    AND NOT EXISTS (SELECT 1 FROM public.sms_batches b
                    WHERE b.event_id = e.id AND b.type = 'reminder_before_close')
  UNION ALL
  -- Automatic archiving (PRD 4.2): the organization's archive_after_days after results were
  -- published, or after the event was cancelled.
  SELECT e.id, NULL::uuid, e.organization_id, 'archive_event'
  FROM public.voting_events e
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.deleted_at IS NULL
    AND ((e.status = 'results_published' AND e.results_published_at IS NOT NULL
          AND e.results_published_at + make_interval(days => o.archive_after_days) <= p_now)
      OR (e.status = 'cancelled' AND e.cancelled_at IS NOT NULL
          AND e.cancelled_at + make_interval(days => o.archive_after_days) <= p_now))
$$;
