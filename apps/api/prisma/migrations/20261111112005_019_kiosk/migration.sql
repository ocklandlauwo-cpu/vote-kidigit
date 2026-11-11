-- CreateTable
CREATE TABLE "kiosk_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "device_label" TEXT NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "launched_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "ended_by" UUID,

    CONSTRAINT "kiosk_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_code_sends" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kiosk_session_id" UUID NOT NULL,
    "voter_id" UUID NOT NULL,
    "used_alternate_phone" BOOLEAN NOT NULL,
    "alternate_phone_hmac" BYTEA,
    "alternate_phone_last3" CHAR(3),
    "sms_message_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_code_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_sessions_token_hash_key" ON "kiosk_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "kiosk_sessions_event_id_idx" ON "kiosk_sessions"("event_id");

-- CreateIndex
CREATE INDEX "kiosk_sessions_organization_id_idx" ON "kiosk_sessions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_sessions_id_organization_id_key" ON "kiosk_sessions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "kiosk_code_sends_event_id_alternate_phone_hmac_idx" ON "kiosk_code_sends"("event_id", "alternate_phone_hmac");

-- CreateIndex
CREATE INDEX "kiosk_code_sends_kiosk_session_id_idx" ON "kiosk_code_sends"("kiosk_session_id");

-- CreateIndex
CREATE INDEX "kiosk_code_sends_organization_id_idx" ON "kiosk_code_sends"("organization_id");

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_launched_by_fkey" FOREIGN KEY ("launched_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_sessions" ADD CONSTRAINT "kiosk_sessions_ended_by_fkey" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_code_sends" ADD CONSTRAINT "kiosk_code_sends_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_code_sends" ADD CONSTRAINT "kiosk_code_sends_kiosk_session_id_organization_id_fkey" FOREIGN KEY ("kiosk_session_id", "organization_id") REFERENCES "kiosk_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_code_sends" ADD CONSTRAINT "kiosk_code_sends_voter_id_organization_id_fkey" FOREIGN KEY ("voter_id", "organization_id") REFERENCES "voters"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_code_sends" ADD CONSTRAINT "kiosk_code_sends_sms_message_id_fkey" FOREIGN KEY ("sms_message_id") REFERENCES "sms_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written below this line
-- 019_kiosk (Backend Schema 7.4, 7.5, 11.8, 2.4): kiosk sessions, the codes they send, the
-- other-phone limit and the bootstrap lookup of a kiosk token.

ALTER TABLE public.kiosk_sessions ADD CONSTRAINT kiosk_sessions_device_label
  CHECK (length(trim(device_label)) BETWEEN 1 AND 80);
ALTER TABLE public.kiosk_sessions ADD CONSTRAINT kiosk_sessions_ended
  CHECK ((ended_at IS NULL) = (ended_by IS NULL) OR ended_by IS NULL);
ALTER TABLE public.kiosk_code_sends ADD CONSTRAINT kiosk_code_sends_alternate
  CHECK (used_alternate_phone = (alternate_phone_hmac IS NOT NULL)
         AND (alternate_phone_hmac IS NULL) = (alternate_phone_last3 IS NULL));

-- Code sends are a record: never changed (only removed with the organization in tests).
CREATE TRIGGER kiosk_code_sends_immutable BEFORE UPDATE ON public.kiosk_code_sends
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

-- 11.8 app.limit_alternate_phone(): one other phone serves at most 3 distinct voters per event.
-- The advisory lock serializes concurrent sends to the same number, so two kiosks cannot both
-- pass the count.
CREATE FUNCTION app.limit_alternate_phone() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.alternate_phone_hmac IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.event_id::text || encode(NEW.alternate_phone_hmac, 'hex'), 0));
  IF (SELECT count(DISTINCT voter_id) FROM public.kiosk_code_sends
      WHERE event_id = NEW.event_id AND alternate_phone_hmac = NEW.alternate_phone_hmac
        AND voter_id <> NEW.voter_id) >= 3 THEN
    RAISE EXCEPTION 'ALT_PHONE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER kiosk_code_sends_alternate_limit BEFORE INSERT ON public.kiosk_code_sends
  FOR EACH ROW EXECUTE FUNCTION app.limit_alternate_phone();

-- RLS (10.1): tenant template. Platform admins may read sessions (devices), not code sends
-- (they name voters).
ALTER TABLE public.kiosk_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY kiosk_sessions_tenant ON public.kiosk_sessions FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
CREATE POLICY kiosk_sessions_platform_read ON public.kiosk_sessions FOR SELECT TO vk_api
  USING (app.is_platform_admin());

ALTER TABLE public.kiosk_code_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY kiosk_code_sends_tenant ON public.kiosk_code_sends FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kiosk_sessions TO vk_api;
GRANT SELECT, INSERT, DELETE ON public.kiosk_code_sends TO vk_api;
REVOKE UPDATE ON public.kiosk_code_sends FROM vk_api;
-- vk_readonly: everything but the token and PIN hashes.
REVOKE ALL ON public.kiosk_sessions FROM vk_readonly;
GRANT SELECT (id, organization_id, event_id, device_label, launched_by, started_at, last_seen_at,
              ended_at, ended_by) ON public.kiosk_sessions TO vk_readonly;
GRANT SELECT ON public.kiosk_code_sends TO vk_readonly;

-- 2.4 app.resolve_kiosk_token(): the running session behind a device's token hash, before the
-- organization is known.
CREATE FUNCTION app.resolve_kiosk_token(p_token_hash bytea)
RETURNS TABLE (session_id uuid, organization_id uuid, event_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT k.id, k.organization_id, k.event_id
  FROM public.kiosk_sessions k
  WHERE k.token_hash = p_token_hash AND k.ended_at IS NULL
$$;
REVOKE ALL ON FUNCTION app.resolve_kiosk_token(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_kiosk_token(bytea) TO vk_api;
