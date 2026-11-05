-- 012_event_guard_fixes. Runs as vk_owner. No schema change: two fixes to the 011 guards,
-- found by the step 15 tests (011 is applied, so the functions are replaced here).
--  - guard_event_setup compared voters.membership_id_normalized, which PostgreSQL has not yet
--    computed in a BEFORE trigger (NULL in NEW), so every voter update outside Draft looked like
--    a setup change. The generated column is left out; membership_id itself is still compared.
--  - guard_event_update appended deleted_at with ||, which parsed the literal as an array, so
--    soft-deleting a Cancelled event failed. array_append is used instead.

-- Hand-written below this line

CREATE OR REPLACE FUNCTION app.guard_event_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  lifecycle text[] := ARRAY['status', 'opened_at', 'closed_at', 'results_published_at',
                            'cancelled_at', 'archived_at', 'cancel_reason', 'reopen_count'];
  allowed text[] := ARRAY['is_active', 'public_results_enabled', 'public_results_token',
                          'first_code_sent_at', 'reminder_before_open_hours',
                          'reminder_before_close_minutes', 'results_visibility', 'updated_at'];
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  key text;
BEGIN
  IF current_user = 'vk_owner' THEN
    RETURN NEW;
  END IF;
  FOREACH key IN ARRAY lifecycle LOOP
    IF new_row -> key IS DISTINCT FROM old_row -> key THEN
      RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled' THEN
    allowed := array_append(allowed, 'deleted_at');
  END IF;
  IF (new_row - allowed) IS DISTINCT FROM (old_row - allowed) THEN
    RAISE EXCEPTION 'EVENT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_event_setup() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event uuid;
  v_status event_status;
  allowed text[];
BEGIN
  IF current_user = 'vk_owner' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'category_voters' THEN
    SELECT c.event_id INTO v_event FROM public.categories c
    WHERE c.id = COALESCE(NEW.category_id, OLD.category_id);
    -- A voter is eligible only for categories of their own event.
    IF TG_OP <> 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.voters v WHERE v.id = NEW.voter_id AND v.event_id = v_event) THEN
      RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_event := OLD.event_id;
  ELSE
    v_event := NEW.event_id;
    IF TG_OP = 'UPDATE' AND NEW.event_id IS DISTINCT FROM OLD.event_id THEN
      RAISE EXCEPTION 'EVENT_LOCKED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT e.status INTO v_status FROM public.voting_events e WHERE e.id = v_event;
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'EVENT_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  allowed := CASE TG_TABLE_NAME
    WHEN 'categories' THEN
      CASE WHEN v_status = 'open' THEN ARRAY['manual_state', 'closed_at', 'is_active'] ELSE ARRAY[]::text[] END
    WHEN 'contesters' THEN
      CASE WHEN v_status = 'scheduled' THEN ARRAY['status', 'withdrawn_at'] ELSE ARRAY[]::text[] END
    WHEN 'voters' THEN
      ARRAY['code_hmac', 'code_ciphertext', 'code_status', 'code_generated_at', 'code_last_sent_at',
            'failed_attempts', 'locked_until',
            -- generated, not yet computed in a BEFORE trigger; follows membership_id
            'membership_id_normalized']
    ELSE ARRAY[]::text[]
  END || ARRAY['updated_at'];

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'EVENT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
