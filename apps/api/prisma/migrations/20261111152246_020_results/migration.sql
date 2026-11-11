-- CreateTable
CREATE TABLE "result_snapshots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "version" SMALLINT NOT NULL,
    "is_current" BOOLEAN NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_voters" INTEGER NOT NULL,
    "voters_voted" INTEGER NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "result_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_category_stats" (
    "snapshot_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "eligible_voters" INTEGER NOT NULL,
    "voters_voted" INTEGER NOT NULL,
    "valid_votes" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "quorum_met" BOOLEAN,
    "threshold_met" BOOLEAN,
    "has_tie" BOOLEAN NOT NULL,

    CONSTRAINT "result_category_stats_pkey" PRIMARY KEY ("snapshot_id","category_id")
);

-- CreateTable
CREATE TABLE "result_rows" (
    "snapshot_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "contester_id" UUID NOT NULL,
    "choice" "choice_kind" NOT NULL,
    "votes" INTEGER NOT NULL,
    "percent" DECIMAL(5,1) NOT NULL,
    "rank" SMALLINT NOT NULL,
    "is_winner" BOOLEAN NOT NULL,

    CONSTRAINT "result_rows_pkey" PRIMARY KEY ("snapshot_id","category_id","contester_id","choice")
);

-- CreateTable
CREATE TABLE "tie_resolutions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "outcome" "tie_outcome" NOT NULL,
    "winner_contester_ids" UUID[],
    "reason" TEXT NOT NULL,
    "resolved_by" UUID NOT NULL,
    "resolved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tie_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "result_snapshots_organization_id_idx" ON "result_snapshots"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_snapshots_event_id_version_key" ON "result_snapshots"("event_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "result_snapshots_one_current_key" ON "result_snapshots"("event_id") WHERE (is_current);

-- CreateIndex
CREATE UNIQUE INDEX "result_snapshots_id_organization_id_key" ON "result_snapshots"("id", "organization_id");

-- CreateIndex
CREATE INDEX "result_category_stats_organization_id_idx" ON "result_category_stats"("organization_id");

-- CreateIndex
CREATE INDEX "result_rows_organization_id_idx" ON "result_rows"("organization_id");

-- CreateIndex
CREATE INDEX "tie_resolutions_organization_id_idx" ON "tie_resolutions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "tie_resolutions_snapshot_id_category_id_key" ON "tie_resolutions"("snapshot_id", "category_id");

-- AddForeignKey
ALTER TABLE "result_snapshots" ADD CONSTRAINT "result_snapshots_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_category_stats" ADD CONSTRAINT "result_category_stats_snapshot_id_organization_id_fkey" FOREIGN KEY ("snapshot_id", "organization_id") REFERENCES "result_snapshots"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_category_stats" ADD CONSTRAINT "result_category_stats_category_id_organization_id_fkey" FOREIGN KEY ("category_id", "organization_id") REFERENCES "categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_rows" ADD CONSTRAINT "result_rows_snapshot_id_organization_id_fkey" FOREIGN KEY ("snapshot_id", "organization_id") REFERENCES "result_snapshots"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_rows" ADD CONSTRAINT "result_rows_category_id_organization_id_fkey" FOREIGN KEY ("category_id", "organization_id") REFERENCES "categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_rows" ADD CONSTRAINT "result_rows_contester_id_fkey" FOREIGN KEY ("contester_id") REFERENCES "contesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tie_resolutions" ADD CONSTRAINT "tie_resolutions_snapshot_id_organization_id_fkey" FOREIGN KEY ("snapshot_id", "organization_id") REFERENCES "result_snapshots"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tie_resolutions" ADD CONSTRAINT "tie_resolutions_category_id_organization_id_fkey" FOREIGN KEY ("category_id", "organization_id") REFERENCES "categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tie_resolutions" ADD CONSTRAINT "tie_resolutions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written below this line
-- 020_results (Backend Schema 6.4–6.7, 11.5, 11.7): sealing ballots at close, tallying, frozen
-- results with winners and ties, tie resolution, publication, and the transitions close, reopen
-- and publish results.

ALTER TABLE public.result_snapshots ADD CONSTRAINT result_snapshots_hash CHECK (content_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE public.result_snapshots ADD CONSTRAINT result_snapshots_counts
  CHECK (registered_voters >= 0 AND voters_voted >= 0);
ALTER TABLE public.tie_resolutions ADD CONSTRAINT tie_resolutions_reason
  CHECK (char_length(btrim(reason)) >= 10);
ALTER TABLE public.tie_resolutions ADD CONSTRAINT tie_resolutions_winners
  CHECK ((outcome = 'contester') = (cardinality(winner_contester_ids) > 0));

-- ---------------------------------------------------------------------------------------------
-- Sealing (change log 11 Nov 2026). The ballot tables stay immutable for everyone; the only
-- rewrite allowed is app.seal_ballots(), which marks its own transaction. vk_api has no access to
-- the ballot schema at all, so only the owner could set the mark, and the owner can already
-- disable triggers.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.forbid_ballot_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.sealing', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_RECORD' USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER ballots_immutable ON ballot.ballots;
DROP TRIGGER selections_immutable ON ballot.ballot_selections;
CREATE TRIGGER ballots_immutable BEFORE UPDATE OR DELETE ON ballot.ballots
  FOR EACH ROW EXECUTE FUNCTION app.forbid_ballot_change();
CREATE TRIGGER selections_immutable BEFORE UPDATE OR DELETE ON ballot.ballot_selections
  FOR EACH ROW EXECUTE FUNCTION app.forbid_ballot_change();

-- app.seal_ballots(): the event's ballots and selections as fresh rows (new random ids, same
-- received_hour) inserted in random order, the originals deleted, in the close transaction.
CREATE FUNCTION app.seal_ballots(p_event_id uuid) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, ballot, app, pg_temp
AS $$
DECLARE
  v_selections_before bigint;
  v_selections_after bigint;
BEGIN
  PERFORM set_config('app.sealing', 'on', true);
  DROP TABLE IF EXISTS pg_temp.seal_map;
  CREATE TEMP TABLE seal_map ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid() AS new_id, received_hour
    FROM ballot.ballots WHERE event_id = p_event_id;
  SELECT count(*) INTO v_selections_before
    FROM ballot.ballot_selections s JOIN pg_temp.seal_map m ON m.old_id = s.ballot_id;

  INSERT INTO ballot.ballots (id, event_id, received_hour)
    SELECT new_id, p_event_id, received_hour FROM pg_temp.seal_map ORDER BY random();
  INSERT INTO ballot.ballot_selections (ballot_id, category_id, contester_id, choice)
    SELECT m.new_id, s.category_id, s.contester_id, s.choice
    FROM ballot.ballot_selections s JOIN pg_temp.seal_map m ON m.old_id = s.ballot_id
    ORDER BY random();
  DELETE FROM ballot.ballot_selections s USING pg_temp.seal_map m WHERE s.ballot_id = m.old_id;
  DELETE FROM ballot.ballots b USING pg_temp.seal_map m WHERE b.id = m.old_id;

  SELECT count(*) INTO v_selections_after
    FROM ballot.ballot_selections s JOIN ballot.ballots b ON b.id = s.ballot_id
    WHERE b.event_id = p_event_id;
  IF v_selections_after <> v_selections_before THEN
    RAISE EXCEPTION 'INTERNAL' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.sealing', '', true);
END $$;

-- 11.7 app.tally_event(): the only reader of ballots; totals only.
CREATE FUNCTION app.tally_event(p_event_id uuid)
RETURNS TABLE (category_id uuid, contester_id uuid, choice choice_kind, votes bigint)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public, ballot, app
AS $$
  SELECT s.category_id, s.contester_id, s.choice, count(*)
  FROM ballot.ballot_selections s
  JOIN ballot.ballots b ON b.id = s.ballot_id
  JOIN public.categories c ON c.id = s.category_id
  WHERE b.event_id = p_event_id AND c.organization_id = app.current_org_id()
  GROUP BY s.category_id, s.contester_id, s.choice
$$;

-- content_hash: SHA-256 of the canonical JSON of a snapshot (stats, rows and tie resolutions,
-- in display order and contester order). jsonb's text form is deterministic.
CREATE FUNCTION app.result_hash(p_snapshot_id uuid) RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, public
AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'event', s.event_id,
    'version', s.version,
    'registered', s.registered_voters,
    'voted', s.voters_voted,
    'categories', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'category', st.category_id,
        'eligible', st.eligible_voters,
        'voted', st.voters_voted,
        'valid', st.valid_votes,
        'skipped', st.skipped,
        'quorumMet', st.quorum_met,
        'thresholdMet', st.threshold_met,
        'hasTie', st.has_tie,
        'rows', (SELECT jsonb_agg(jsonb_build_object(
                   'contester', r.contester_id, 'choice', r.choice, 'votes', r.votes,
                   'percent', r.percent, 'rank', r.rank, 'winner', r.is_winner)
                   ORDER BY r.contester_id, r.choice)
                 FROM public.result_rows r
                 WHERE r.snapshot_id = st.snapshot_id AND r.category_id = st.category_id),
        'tie', (SELECT jsonb_build_object(
                   'outcome', tr.outcome,
                   'winners', (SELECT jsonb_agg(w ORDER BY w) FROM unnest(tr.winner_contester_ids) w),
                   'reason', tr.reason)
                 FROM public.tie_resolutions tr
                 WHERE tr.snapshot_id = st.snapshot_id AND tr.category_id = st.category_id))
        ORDER BY c.display_order, c.id)
      FROM public.result_category_stats st
      JOIN public.categories c ON c.id = st.category_id
      WHERE st.snapshot_id = s.id), '[]'::jsonb)
  )::text, 'UTF8')), 'hex')
  FROM public.result_snapshots s
  WHERE s.id = p_snapshot_id
$$;

-- 11.7 app.freeze_results(): the next snapshot version with stats, rows, ranks and winners.
CREATE FUNCTION app.freeze_results(p_event_id uuid) RETURNS uuid
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
          AND (c.threshold_pct IS NULL OR percent >= c.threshold_pct);
      IF c.threshold_pct IS NOT NULL THEN v_threshold_met := v_qualified >= c.seats; END IF;

      IF coalesce(v_quorum, true) THEN
        IF v_qualified <= c.seats THEN
          UPDATE public.result_rows SET is_winner = true
            WHERE snapshot_id = v_snapshot AND category_id = c.id AND votes > 0
              AND (c.threshold_pct IS NULL OR percent >= c.threshold_pct);
        ELSE
          SELECT votes INTO v_cut FROM public.result_rows
            WHERE snapshot_id = v_snapshot AND category_id = c.id AND votes > 0
              AND (c.threshold_pct IS NULL OR percent >= c.threshold_pct)
            ORDER BY votes DESC OFFSET c.seats - 1 LIMIT 1;
          SELECT votes INTO v_next FROM public.result_rows
            WHERE snapshot_id = v_snapshot AND category_id = c.id AND votes > 0
              AND (c.threshold_pct IS NULL OR percent >= c.threshold_pct)
            ORDER BY votes DESC OFFSET c.seats LIMIT 1;
          -- A tie at the last seat: only those strictly above the tied group win for now.
          v_tie := v_cut = v_next;
          UPDATE public.result_rows SET is_winner = true
            WHERE snapshot_id = v_snapshot AND category_id = c.id
              AND (c.threshold_pct IS NULL OR percent >= c.threshold_pct)
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

-- 11.7 app.resolve_tie(): decides the last seat of a tied category, with a reason.
CREATE FUNCTION app.resolve_tie(p_snapshot_id uuid, p_category_id uuid, p_outcome tie_outcome,
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
  SELECT count(*) INTO v_won FROM public.result_rows
    WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id AND is_winner;
  -- The tied group: the most-voted contesters not yet winning.
  SELECT max(votes) INTO v_top FROM public.result_rows
    WHERE snapshot_id = p_snapshot_id AND category_id = p_category_id AND NOT is_winner AND votes > 0
      AND (v_threshold IS NULL OR percent >= v_threshold);
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

-- Nothing changes once results are published (Backend Schema 6.4–6.7).
CREATE FUNCTION app.forbid_after_publish() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_snapshot uuid;
BEGIN
  IF TG_TABLE_NAME = 'result_snapshots' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'RESULTS_PUBLISHED' USING ERRCODE = 'P0001';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_snapshot := CASE WHEN TG_OP = 'INSERT' THEN NEW.snapshot_id ELSE OLD.snapshot_id END;
  IF EXISTS (SELECT 1 FROM public.result_snapshots WHERE id = v_snapshot AND published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'RESULTS_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER result_snapshots_published BEFORE UPDATE OR DELETE ON public.result_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.forbid_after_publish();
CREATE TRIGGER result_category_stats_published BEFORE INSERT OR UPDATE OR DELETE ON public.result_category_stats
  FOR EACH ROW EXECUTE FUNCTION app.forbid_after_publish();
CREATE TRIGGER result_rows_published BEFORE INSERT OR UPDATE OR DELETE ON public.result_rows
  FOR EACH ROW EXECUTE FUNCTION app.forbid_after_publish();
CREATE TRIGGER tie_resolutions_published BEFORE INSERT OR UPDATE OR DELETE ON public.tie_resolutions
  FOR EACH ROW EXECUTE FUNCTION app.forbid_after_publish();

-- 11.5 app.transition_event(): adds close (seal, freeze), reopen and publish results.
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

  ELSIF e.status IN ('results_published', 'cancelled') AND p_to = 'archived' THEN
    UPDATE public.voting_events SET status = 'archived', archived_at = now()
    WHERE id = p_event_id RETURNING * INTO e;

  ELSE
    RAISE EXCEPTION 'INVALID_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  RETURN e;
END $$;

-- RLS (10.1): tenant template; results are written only by the functions above.
ALTER TABLE public.result_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY result_snapshots_tenant ON public.result_snapshots FOR ALL TO vk_api
  USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id());
ALTER TABLE public.result_category_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY result_category_stats_tenant ON public.result_category_stats FOR ALL TO vk_api
  USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id());
ALTER TABLE public.result_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY result_rows_tenant ON public.result_rows FOR ALL TO vk_api
  USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id());
ALTER TABLE public.tie_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tie_resolutions_tenant ON public.tie_resolutions FOR ALL TO vk_api
  USING (organization_id = app.current_org_id()) WITH CHECK (organization_id = app.current_org_id());

REVOKE ALL ON public.result_snapshots, public.result_category_stats, public.result_rows,
  public.tie_resolutions FROM vk_api;
GRANT SELECT ON public.result_snapshots, public.result_category_stats, public.result_rows,
  public.tie_resolutions TO vk_api, vk_readonly;

-- Ballots are read only at close: vk_api cannot tally, freeze or seal by itself.
REVOKE ALL ON FUNCTION app.seal_ballots(uuid), app.tally_event(uuid), app.freeze_results(uuid)
  FROM PUBLIC, vk_api;
REVOKE ALL ON FUNCTION app.resolve_tie(uuid, uuid, tie_outcome, uuid[], text), app.result_hash(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_tie(uuid, uuid, tie_outcome, uuid[], text), app.result_hash(uuid)
  TO vk_api;
