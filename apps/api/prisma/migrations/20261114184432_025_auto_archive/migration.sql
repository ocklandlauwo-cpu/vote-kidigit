-- Hand-written below this line
-- Migration 025 (Implementation Plan step 39): automatic archiving and code expiry.
--   * app.due_transitions() also returns 'archive_event' for events whose results were published
--     (or which were cancelled) more than the organization's archive_after_days ago (PRD 4.2,
--     Backend Schema 4: organizations.archive_after_days). The worker archives them as System.
--   * app.transition_event() clears every voter's code on → archived (PRD COD-08).
-- Both functions are replaced whole; the rest of their bodies is unchanged from 016 / 022.

CREATE OR REPLACE FUNCTION app.due_transitions(p_now timestamptz)
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
  UNION ALL
  SELECT e.id, NULL::uuid, e.organization_id, 'reminder_before_open'
  FROM public.voting_events e
  WHERE e.status = 'scheduled' AND e.is_active AND e.deleted_at IS NULL
    AND e.reminder_before_open_hours IS NOT NULL
    AND e.start_at - make_interval(hours => e.reminder_before_open_hours) <= p_now
    AND e.start_at > p_now
    AND NOT EXISTS (SELECT 1 FROM public.sms_batches b
                    WHERE b.event_id = e.id AND b.type = 'reminder_before_open')
  UNION ALL
  SELECT e.id, NULL::uuid, e.organization_id, 'reminder_before_close'
  FROM public.voting_events e
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

CREATE OR REPLACE FUNCTION app.transition_event(
  p_event_id uuid,
  p_to event_status,
  p_reason text DEFAULT NULL,
  p_new_end_at timestamptz DEFAULT NULL,
  p_results_token text DEFAULT NULL
) RETURNS public.voting_events
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  e public.voting_events;
BEGIN
  SELECT * INTO e FROM public.voting_events
  WHERE id = p_event_id AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR e.organization_id IS DISTINCT FROM app.current_org_id() THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  -- PRD 4.3: a deactivated event cannot change status.
  IF NOT e.is_active THEN
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  IF e.status = 'draft' AND p_to = 'scheduled' THEN
    IF EXISTS (SELECT 1 FROM app.publish_checklist(p_event_id) WHERE NOT ok) THEN
      RAISE EXCEPTION 'CHECKLIST_FAILED' USING ERRCODE = 'P0001';
    END IF;
    IF e.start_at <= now() THEN
      RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.voting_events SET status = 'scheduled' WHERE id = p_event_id RETURNING * INTO e;

  ELSIF e.status IN ('draft', 'scheduled') AND p_to = 'open' THEN
    IF e.status = 'draft' AND EXISTS (SELECT 1 FROM app.publish_checklist(p_event_id) WHERE NOT ok) THEN
      RAISE EXCEPTION 'CHECKLIST_FAILED' USING ERRCODE = 'P0001';
    END IF;
    IF e.end_at <= now() THEN
      RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.voting_events SET status = 'open', opened_at = now()
    WHERE id = p_event_id RETURNING * INTO e;

  ELSIF e.status = 'scheduled' AND p_to = 'draft' THEN
    IF e.first_code_sent_at IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.voting_events SET status = 'draft' WHERE id = p_event_id RETURNING * INTO e;

  ELSIF e.status = 'open' AND p_to = 'closed' THEN
    UPDATE public.voting_events SET status = 'closed', closed_at = now()
    WHERE id = p_event_id RETURNING * INTO e;
    UPDATE public.categories SET closed_at = now() WHERE event_id = p_event_id AND closed_at IS NULL;
    PERFORM app.seal_ballots(p_event_id);
    PERFORM app.freeze_results(p_event_id);

  ELSIF e.status = 'closed' AND p_to = 'open' THEN
    IF p_new_end_at IS NULL OR p_new_end_at <= now()
       OR p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
      RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.voting_events
      SET status = 'open', end_at = p_new_end_at, reopen_count = reopen_count + 1, closed_at = NULL
      WHERE id = p_event_id RETURNING * INTO e;
    -- Categories closed by the event close open again; manually closed ones stay closed.
    UPDATE public.categories SET closed_at = NULL
      WHERE event_id = p_event_id AND manual_state <> 'closed';
    UPDATE public.result_snapshots SET is_current = false WHERE event_id = p_event_id AND is_current;

  ELSIF e.status = 'closed' AND p_to = 'results_published' THEN
    IF p_results_token IS NULL OR char_length(p_results_token) < 20 THEN
      RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.result_snapshots s
               JOIN public.result_category_stats st ON st.snapshot_id = s.id AND st.has_tie
               WHERE s.event_id = p_event_id AND s.is_current
                 AND NOT EXISTS (SELECT 1 FROM public.tie_resolutions tr
                                 WHERE tr.snapshot_id = s.id AND tr.category_id = st.category_id)) THEN
      RAISE EXCEPTION 'UNRESOLVED_TIES' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.voting_events
      SET status = 'results_published', results_published_at = now(),
          public_results_token = p_results_token
      WHERE id = p_event_id RETURNING * INTO e;
    UPDATE public.result_snapshots SET published_at = now(), content_hash = app.result_hash(id)
      WHERE event_id = p_event_id AND is_current;

  ELSIF e.status IN ('draft', 'scheduled', 'open') AND p_to = 'cancelled' THEN
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
      RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.voting_events SET status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason)
    WHERE id = p_event_id RETURNING * INTO e;
    -- Voting ends here too: nothing must link the ballots cast so far to their voters.
    IF EXISTS (SELECT 1 FROM ballot.ballots WHERE event_id = p_event_id) THEN
      PERFORM app.seal_ballots(p_event_id);
    END IF;

  ELSIF e.status IN ('results_published', 'cancelled') AND p_to = 'archived' THEN
    UPDATE public.voting_events SET status = 'archived', archived_at = now()
    WHERE id = p_event_id RETURNING * INTO e;
    -- PRD COD-08: codes expire when the event is archived. Both copies go (the HMAC and the
    -- re-send copy), so no code of an archived event can sign in or be sent again.
    UPDATE public.voters SET code_hmac = NULL, code_ciphertext = NULL
    WHERE event_id = p_event_id AND code_hmac IS NOT NULL;

  ELSE
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  RETURN e;
END $$;
