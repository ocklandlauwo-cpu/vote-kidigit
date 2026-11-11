-- This is an empty migration.
-- Hand-written below this line
-- 022 (security review of 020): thresholds compare the exact share of valid votes, never the
-- rounded display percent (59.96% must not pass a 60% threshold); cancelling an Open event seals
-- its ballots like a close does.

CREATE OR REPLACE FUNCTION app.freeze_results(p_event_id uuid) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_version smallint;
  v_snapshot uuid;
  v_registered int;
  v_voted int;
  c public.categories%ROWTYPE;
  v_eligible int;
  v_cvoted int;
  v_valid int;
  v_skipped int;
  v_active int;
  v_quorum boolean;
  v_threshold_met boolean;
  v_tie boolean;
  v_qualified int;
  v_cut int;
  v_next int;
  v_yes int;
  v_no int;
BEGIN
  SELECT organization_id INTO v_org FROM public.voting_events WHERE id = p_event_id;
  UPDATE public.result_snapshots SET is_current = false WHERE event_id = p_event_id AND is_current;
  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.result_snapshots WHERE event_id = p_event_id;
  SELECT count(*) INTO v_registered FROM public.voters WHERE event_id = p_event_id AND deleted_at IS NULL;
  SELECT count(DISTINCT voter_id) INTO v_voted FROM public.voter_participation WHERE event_id = p_event_id;
  INSERT INTO public.result_snapshots (organization_id, event_id, version, is_current,
                                       registered_voters, voters_voted, content_hash)
    VALUES (v_org, p_event_id, v_version, true, v_registered, v_voted, repeat('0', 64))
    RETURNING id INTO v_snapshot;

  DROP TABLE IF EXISTS pg_temp.freeze_tally;
  CREATE TEMP TABLE freeze_tally ON COMMIT DROP AS SELECT * FROM app.tally_event(p_event_id);

  FOR c IN SELECT * FROM public.categories
           WHERE event_id = p_event_id AND is_active ORDER BY display_order LOOP
    v_eligible := CASE WHEN c.eligibility = 'all' THEN v_registered
      ELSE (SELECT count(*) FROM public.category_voters cv
            JOIN public.voters v ON v.id = cv.voter_id AND v.deleted_at IS NULL
            WHERE cv.category_id = c.id) END;
    SELECT count(*) INTO v_cvoted FROM public.voter_participation WHERE category_id = c.id;
    SELECT coalesce(sum(t.votes) FILTER (WHERE t.choice <> 'skipped'), 0),
           coalesce(sum(t.votes) FILTER (WHERE t.choice = 'skipped'), 0)
      INTO v_valid, v_skipped
      FROM pg_temp.freeze_tally t WHERE t.category_id = c.id;
    SELECT count(*) INTO v_active FROM public.contesters WHERE category_id = c.id AND status = 'active';
    v_quorum := CASE WHEN c.quorum_pct IS NULL THEN NULL
                     ELSE v_eligible > 0 AND v_cvoted * 100.0 / v_eligible >= c.quorum_pct END;
    v_tie := false;
    v_threshold_met := NULL;

    IF v_active = 1 THEN
      -- Yes / No: two rows for the only contester.
      INSERT INTO public.result_rows (snapshot_id, organization_id, category_id, contester_id,
                                      choice, votes, percent, rank, is_winner)
        SELECT v_snapshot, v_org, c.id, k.id, ch.choice, coalesce(t.votes, 0),
               CASE WHEN v_valid > 0 THEN round(coalesce(t.votes, 0) * 100.0 / v_valid, 1) ELSE 0 END,
               1, false
        FROM public.contesters k
        CROSS JOIN (VALUES ('yes'::choice_kind), ('no'::choice_kind)) ch(choice)
        LEFT JOIN pg_temp.freeze_tally t
          ON t.category_id = c.id AND t.contester_id = k.id AND t.choice = ch.choice
        WHERE k.category_id = c.id AND k.status = 'active';
      SELECT coalesce(max(votes) FILTER (WHERE choice = 'yes'), 0),
             coalesce(max(votes) FILTER (WHERE choice = 'no'), 0)
        INTO v_yes, v_no
        FROM public.result_rows WHERE snapshot_id = v_snapshot AND category_id = c.id;
      UPDATE public.result_rows SET rank = CASE
          WHEN choice = 'yes' THEN CASE WHEN v_yes >= v_no THEN 1 ELSE 2 END
          ELSE CASE WHEN v_no >= v_yes THEN 1 ELSE 2 END END
        WHERE snapshot_id = v_snapshot AND category_id = c.id;
      IF c.threshold_pct IS NOT NULL THEN
        v_threshold_met := (v_yes + v_no) > 0 AND v_yes * 100.0 / (v_yes + v_no) >= c.threshold_pct;
      END IF;
      IF coalesce(v_quorum, true) AND v_yes > v_no AND coalesce(v_threshold_met, true) THEN
        UPDATE public.result_rows SET is_winner = true
          WHERE snapshot_id = v_snapshot AND category_id = c.id AND choice = 'yes';
      END IF;
    ELSE
      INSERT INTO public.result_rows (snapshot_id, organization_id, category_id, contester_id,
                                      choice, votes, percent, rank, is_winner)
        SELECT v_snapshot, v_org, c.id, k.id, 'contester', coalesce(t.votes, 0),
               CASE WHEN v_valid > 0 THEN round(coalesce(t.votes, 0) * 100.0 / v_valid, 1) ELSE 0 END,
               rank() OVER (ORDER BY coalesce(t.votes, 0) DESC), false
        FROM public.contesters k
        LEFT JOIN pg_temp.freeze_tally t
          ON t.category_id = c.id AND t.contester_id = k.id AND t.choice = 'contester'
        WHERE k.category_id = c.id AND k.status = 'active';

      -- Who can win: at least one vote and, with a threshold, at least that share.
      SELECT count(*) INTO v_qualified FROM public.result_rows
        WHERE snapshot_id = v_snapshot AND category_id = c.id AND votes > 0
          AND (c.threshold_pct IS NULL OR votes * 100.0 >= c.threshold_pct * v_valid);
      IF c.threshold_pct IS NOT NULL THEN v_threshold_met := v_qualified >= c.seats; END IF;

      IF coalesce(v_quorum, true) THEN
        IF v_qualified <= c.seats THEN
          UPDATE public.result_rows SET is_winner = true
            WHERE snapshot_id = v_snapshot AND category_id = c.id AND votes > 0
              AND (c.threshold_pct IS NULL OR votes * 100.0 >= c.threshold_pct * v_valid);
        ELSE
          SELECT votes INTO v_cut FROM public.result_rows
            WHERE snapshot_id = v_snapshot AND category_id = c.id AND votes > 0
              AND (c.threshold_pct IS NULL OR votes * 100.0 >= c.threshold_pct * v_valid)
            ORDER BY votes DESC OFFSET c.seats - 1 LIMIT 1;
          SELECT votes INTO v_next FROM public.result_rows
            WHERE snapshot_id = v_snapshot AND category_id = c.id AND votes > 0
              AND (c.threshold_pct IS NULL OR votes * 100.0 >= c.threshold_pct * v_valid)
            ORDER BY votes DESC OFFSET c.seats LIMIT 1;
          -- A tie at the last seat: only those strictly above the tied group win for now.
          v_tie := v_cut = v_next;
          UPDATE public.result_rows SET is_winner = true
            WHERE snapshot_id = v_snapshot AND category_id = c.id
              AND (c.threshold_pct IS NULL OR votes * 100.0 >= c.threshold_pct * v_valid)
              AND CASE WHEN v_tie THEN votes > v_cut ELSE votes >= v_cut END;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.result_category_stats (snapshot_id, organization_id, category_id,
      eligible_voters, voters_voted, valid_votes, skipped, quorum_met, threshold_met, has_tie)
      VALUES (v_snapshot, v_org, c.id, v_eligible, v_cvoted, v_valid, v_skipped, v_quorum,
              v_threshold_met, v_tie);
  END LOOP;

  UPDATE public.result_snapshots SET content_hash = app.result_hash(v_snapshot) WHERE id = v_snapshot;
  RETURN v_snapshot;
END $$;

CREATE OR REPLACE FUNCTION app.resolve_tie(p_snapshot_id uuid, p_category_id uuid, p_outcome tie_outcome,
                                p_winner_ids uuid[], p_reason text) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_org uuid := app.current_org_id();
  v_snap public.result_snapshots%ROWTYPE;
  v_seats int;
  v_threshold numeric;
  v_won int;
  v_top int;
  v_ids uuid[] := coalesce(p_winner_ids, '{}');
  v_valid int;
BEGIN
  SELECT * INTO v_snap FROM public.result_snapshots
    WHERE id = p_snapshot_id AND organization_id = v_org AND is_current FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_snap.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'RESULTS_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.result_category_stats
                 WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id AND has_tie)
     OR EXISTS (SELECT 1 FROM public.tie_resolutions
                WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id)
     OR p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'P0001';
  END IF;
  SELECT seats, threshold_pct INTO v_seats, v_threshold FROM public.categories WHERE id = p_category_id;
  SELECT valid_votes INTO v_valid FROM public.result_category_stats
    WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id;
  SELECT count(*) INTO v_won FROM public.result_rows
    WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id AND is_winner;
  -- The tied group: the most-voted contesters not yet winning.
  SELECT max(votes) INTO v_top FROM public.result_rows
    WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id AND NOT is_winner AND votes > 0
      AND (v_threshold IS NULL OR votes * 100.0 >= v_threshold * v_valid);
  IF p_outcome = 'contester' THEN
    IF cardinality(v_ids) = 0 OR cardinality(v_ids) > v_seats - v_won
       OR cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x)
       OR EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE NOT EXISTS (
            SELECT 1 FROM public.result_rows r
            WHERE r.snapshot_id = p_snapshot_id AND r.category_id = p_category_id
              AND r.contester_id = x AND NOT r.is_winner AND r.votes = v_top)) THEN
      RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.result_rows SET is_winner = true
      WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id
        AND contester_id = ANY (v_ids) AND choice = 'contester';
  ELSIF cardinality(v_ids) > 0 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.tie_resolutions (organization_id, snapshot_id, category_id, outcome,
                                      winner_contester_ids, reason, resolved_by)
    VALUES (v_org, p_snapshot_id, p_category_id, p_outcome, v_ids, btrim(p_reason),
            app.current_user_id());
  UPDATE public.result_snapshots SET content_hash = app.result_hash(p_snapshot_id)
    WHERE id = p_snapshot_id;
END $$;

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

  ELSE
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  RETURN e;
END $$;
