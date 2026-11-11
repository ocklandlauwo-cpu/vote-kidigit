-- CreateTable
CREATE TABLE "voter_participation" (
    "voter_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel" "vote_channel" NOT NULL,
    "voted_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "voter_participation_pkey" PRIMARY KEY ("voter_id","category_id")
);

-- CreateTable
CREATE TABLE "ballot"."ballots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "received_hour" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ballots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ballot"."ballot_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ballot_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "contester_id" UUID,
    "choice" "choice_kind" NOT NULL,

    CONSTRAINT "ballot_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voter_participation_event_id_category_id_idx" ON "voter_participation"("event_id", "category_id");

-- CreateIndex
CREATE INDEX "voter_participation_organization_id_idx" ON "voter_participation"("organization_id");

-- CreateIndex
CREATE INDEX "ballot_selections_category_id_contester_id_idx" ON "ballot"."ballot_selections"("category_id", "contester_id");

-- CreateIndex
CREATE UNIQUE INDEX "ballot_selections_ballot_category_contester_key" ON "ballot"."ballot_selections"("ballot_id", "category_id", "contester_id");

-- AddForeignKey
ALTER TABLE "voter_participation" ADD CONSTRAINT "voter_participation_voter_id_organization_id_fkey" FOREIGN KEY ("voter_id", "organization_id") REFERENCES "voters"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter_participation" ADD CONSTRAINT "voter_participation_category_id_event_id_organization_id_fkey" FOREIGN KEY ("category_id", "event_id", "organization_id") REFERENCES "categories"("id", "event_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballot"."ballots" ADD CONSTRAINT "ballots_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "voting_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballot"."ballot_selections" ADD CONSTRAINT "ballot_selections_ballot_id_fkey" FOREIGN KEY ("ballot_id") REFERENCES "ballot"."ballots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballot"."ballot_selections" ADD CONSTRAINT "ballot_selections_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ballot"."ballot_selections" ADD CONSTRAINT "ballot_selections_contester_id_fkey" FOREIGN KEY ("contester_id") REFERENCES "contesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written below this line
-- 017_ballot (Backend Schema 6.1–6.3, 10.3, 10.4, 11.1, 11.4): the secret ballot. Who voted
-- (public.voter_participation) and what was voted (ballot.*) never reference each other.

-- A skipped category has no contester; one skip per ballot and category all the same.
DROP INDEX ballot.ballot_selections_ballot_category_contester_key;
CREATE UNIQUE INDEX ballot_selections_ballot_category_contester_key
  ON ballot.ballot_selections (ballot_id, category_id, contester_id) NULLS NOT DISTINCT;
ALTER TABLE ballot.ballot_selections ADD CONSTRAINT ballot_selections_skip_check
  CHECK ((choice = 'skipped') = (contester_id IS NULL));

-- ---------------------------------------------------------------------------------------------
-- Immutability (11.1): no UPDATE, DELETE or TRUNCATE, for anyone.
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER participation_immutable BEFORE UPDATE OR DELETE ON public.voter_participation
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER participation_no_truncate BEFORE TRUNCATE ON public.voter_participation
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER ballots_immutable BEFORE UPDATE OR DELETE ON ballot.ballots
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER ballots_no_truncate BEFORE TRUNCATE ON ballot.ballots
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER selections_immutable BEFORE UPDATE OR DELETE ON ballot.ballot_selections
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER selections_no_truncate BEFORE TRUNCATE ON ballot.ballot_selections
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_change();

-- ---------------------------------------------------------------------------------------------
-- RLS (10.1, 10.3). Participation: the tenant template without the platform read (10.2: platform
-- admins never see individual voters). Ballots: RLS on and no policy, so only the owner's
-- SECURITY DEFINER functions reach them.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.voter_participation ENABLE ROW LEVEL SECURITY;
CREATE POLICY voter_participation_tenant ON public.voter_participation FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());

ALTER TABLE ballot.ballots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ballot.ballot_selections ENABLE ROW LEVEL SECURITY;

-- Grants (10.4): vk_api reads participation (turnout, "already voted") and writes it only
-- through app.cast_ballot(). Nothing in the ballot schema is granted to anyone.
REVOKE ALL ON public.voter_participation FROM vk_api;
GRANT SELECT ON public.voter_participation TO vk_api, vk_readonly;
REVOKE ALL ON ballot.ballots, ballot.ballot_selections FROM PUBLIC, vk_api, vk_readonly;

-- ---------------------------------------------------------------------------------------------
-- 11.4 app.cast_ballot(): the only way to vote. SECURITY DEFINER (vk_owner) so it can write the
-- ballot schema; it filters by the caller's organization itself. Each category of the submission
-- is checked on its own: closed, ineligible, already voted or rule not met is reported and the
-- others are still recorded. The voter row lock serializes submissions of the same voter; the
-- participation primary key is the final guard against a double vote. It never returns which
-- contester was chosen, and the API must not log p_selections.
--
-- Differences from the Backend Schema text: a missing event raises VOTING_CLOSED (the text's
-- comparison is NULL for a missing row and would pass); a missing voter raises NOT_FOUND (12.1
-- has no VOTER_NOT_FOUND); malformed ids and choices are rejected as CATEGORY_NOT_FOUND or
-- RULE_NOT_MET instead of failing the whole call; received_hour is truncated in UTC.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.cast_ballot(p_voter_id uuid, p_event_id uuid, p_selections jsonb,
                                p_channel vote_channel)
RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, ballot, app
AS $$
DECLARE
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_none constant jsonb := '[]'::jsonb;
  v_org uuid := app.current_org_id();
  v_now timestamptz := clock_timestamp();
  v_event public.voting_events%ROWTYPE;
  v_cat public.categories%ROWTYPE;
  v_sel jsonb;
  v_given jsonb;
  v_ids uuid[];
  v_choice choice_kind;
  v_active int;
  v_n int;
  v_ballot uuid;
  v_recorded uuid[] := '{}';
  v_rejected jsonb := c_none;
BEGIN
  IF jsonb_typeof(p_selections) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'VALIDATION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the voter row: concurrent submissions of the same voter run one after the other.
  PERFORM 1 FROM public.voters
    WHERE id = p_voter_id AND event_id = p_event_id AND organization_id = v_org
      AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_event FROM public.voting_events
    WHERE id = p_event_id AND organization_id = v_org AND deleted_at IS NULL
    FOR SHARE;
  -- Hard close (PRD 4.3 rule 4): nothing is accepted once the event is not Open or has ended.
  IF NOT FOUND OR v_event.status <> 'open' OR v_now >= v_event.end_at THEN
    RAISE EXCEPTION 'VOTING_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  FOR v_sel IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
    IF jsonb_typeof(v_sel) IS DISTINCT FROM 'object'
       OR coalesce(v_sel->>'categoryId', '') !~ c_uuid THEN
      v_rejected := v_rejected || jsonb_build_object(
        'categoryId', CASE WHEN jsonb_typeof(v_sel) = 'object' THEN v_sel->'categoryId' END,
        'reason', 'CATEGORY_NOT_FOUND');
      CONTINUE;
    END IF;
    SELECT * INTO v_cat FROM public.categories
      WHERE id = (v_sel->>'categoryId')::uuid AND event_id = p_event_id
        AND organization_id = v_org;
    IF NOT FOUND THEN
      v_rejected := v_rejected || jsonb_build_object('categoryId', v_sel->>'categoryId',
                                                     'reason', 'CATEGORY_NOT_FOUND');
      CONTINUE;
    ELSIF NOT app.category_is_votable(v_cat.id) THEN
      v_rejected := v_rejected || jsonb_build_object('categoryId', v_cat.id, 'reason', 'CATEGORY_CLOSED');
      CONTINUE;
    ELSIF NOT app.voter_is_eligible(p_voter_id, v_cat.id) THEN
      v_rejected := v_rejected || jsonb_build_object('categoryId', v_cat.id, 'reason', 'NOT_ELIGIBLE');
      CONTINUE;
    ELSIF EXISTS (SELECT 1 FROM public.voter_participation
                  WHERE voter_id = p_voter_id AND category_id = v_cat.id) THEN
      v_rejected := v_rejected || jsonb_build_object('categoryId', v_cat.id, 'reason', 'ALREADY_VOTED');
      CONTINUE;
    END IF;

    -- Shape of the choice: a known kind and a list of well-formed ids.
    v_given := coalesce(v_sel->'contesterIds', c_none);
    IF coalesce(v_sel->>'choice', '') NOT IN ('contester', 'yes', 'no', 'skipped')
       OR jsonb_typeof(v_given) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_given) x
                  WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ c_uuid) THEN
      v_rejected := v_rejected || jsonb_build_object('categoryId', v_cat.id, 'reason', 'RULE_NOT_MET');
      CONTINUE;
    END IF;
    v_choice := (v_sel->>'choice')::choice_kind;
    v_ids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(v_given) x);
    SELECT count(*) INTO v_active FROM public.contesters
      WHERE category_id = v_cat.id AND status = 'active';
    SELECT count(*) INTO v_n FROM public.contesters
      WHERE category_id = v_cat.id AND status = 'active' AND id = ANY (v_ids);

    IF NOT (
         -- Skip, where the category allows it
         (v_choice = 'skipped' AND v_cat.allow_skip AND cardinality(v_ids) = 0)
         -- Yes / No on the only contester
      OR (v_active = 1 AND v_choice IN ('yes', 'no') AND cardinality(v_ids) = 1 AND v_n = 1)
         -- Contesters: all active, in this category, no duplicates, as many as the rule says
      OR (v_active > 1 AND v_choice = 'contester' AND v_n = cardinality(v_ids)
          AND cardinality(v_ids) = (SELECT count(DISTINCT x) FROM unnest(v_ids) x)
          AND CASE v_cat.selection_mode
                WHEN 'exact' THEN cardinality(v_ids) = v_cat.exact_count
                ELSE cardinality(v_ids) BETWEEN v_cat.min_count AND v_cat.max_count END)
    ) THEN
      v_rejected := v_rejected || jsonb_build_object('categoryId', v_cat.id, 'reason', 'RULE_NOT_MET');
      CONTINUE;
    END IF;

    -- The primary key blocks any double vote, whatever happened above.
    INSERT INTO public.voter_participation (voter_id, category_id, event_id, organization_id,
                                            channel, voted_at)
      VALUES (p_voter_id, v_cat.id, p_event_id, v_org, p_channel, v_now);

    IF v_ballot IS NULL THEN
      INSERT INTO ballot.ballots (event_id, received_hour)
        VALUES (p_event_id, date_trunc('hour', v_now, 'UTC'))
        RETURNING id INTO v_ballot;
    END IF;

    IF v_choice = 'skipped' THEN
      INSERT INTO ballot.ballot_selections (ballot_id, category_id, contester_id, choice)
        VALUES (v_ballot, v_cat.id, NULL, 'skipped');
    ELSE
      INSERT INTO ballot.ballot_selections (ballot_id, category_id, contester_id, choice)
        SELECT v_ballot, v_cat.id, x, v_choice FROM unnest(v_ids) x;
    END IF;
    v_recorded := v_recorded || v_cat.id;
  END LOOP;

  RETURN jsonb_build_object('recorded', to_jsonb(v_recorded), 'rejected', v_rejected,
                            'votedAt', v_now);
END
$$;
REVOKE ALL ON FUNCTION app.cast_ballot(uuid, uuid, jsonb, vote_channel) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.cast_ballot(uuid, uuid, jsonb, vote_channel) TO vk_api;
