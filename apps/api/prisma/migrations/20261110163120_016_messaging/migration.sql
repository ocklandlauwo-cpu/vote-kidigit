-- CreateTable
CREATE TABLE "sms_templates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID,
    "type" "message_type" NOT NULL,
    "channel" "message_channel" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'sw',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_batches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" "message_type" NOT NULL,
    "channel" "message_channel" NOT NULL,
    "audience" "batch_audience" NOT NULL,
    "status" "batch_status" NOT NULL DEFAULT 'queued',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "paused_reason" TEXT,
    "created_by" UUID,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "batch_id" UUID,
    "voter_id" UUID,
    "channel" "message_channel" NOT NULL,
    "type" "message_type" NOT NULL,
    "to_address" TEXT NOT NULL,
    "body_redacted" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "status" "message_status" NOT NULL DEFAULT 'queued',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sms_templates_organization_id_idx" ON "sms_templates"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_templates_org_default_key" ON "sms_templates"("organization_id", "type", "channel") WHERE (event_id IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "sms_templates_event_key" ON "sms_templates"("event_id", "type", "channel") WHERE (event_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "sms_batches_event_id_created_at_idx" ON "sms_batches"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sms_batches_organization_id_idx" ON "sms_batches"("organization_id");

-- CreateIndex
CREATE INDEX "sms_batches_created_by_idx" ON "sms_batches"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_provider_message_id_key" ON "sms_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "sms_messages_batch_id_status_idx" ON "sms_messages"("batch_id", "status");

-- CreateIndex
CREATE INDEX "sms_messages_voter_id_created_at_idx" ON "sms_messages"("voter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sms_messages_event_id_idx" ON "sms_messages"("event_id");

-- CreateIndex
CREATE INDEX "sms_messages_organization_id_idx" ON "sms_messages"("organization_id");

-- AddForeignKey
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_batches" ADD CONSTRAINT "sms_batches_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_batches" ADD CONSTRAINT "sms_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "sms_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "voters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written below this line

ALTER TABLE public.sms_templates
  ADD CONSTRAINT sms_templates_body_length CHECK (char_length(body) BETWEEN 1 AND 2000),
  ADD CONSTRAINT sms_templates_subject_email CHECK (subject IS NULL OR channel = 'email');
ALTER TABLE public.sms_batches
  ADD CONSTRAINT sms_batches_counters CHECK (
    total_count >= 0 AND sent_count >= 0 AND delivered_count >= 0 AND failed_count >= 0);
ALTER TABLE public.sms_messages
  ADD CONSTRAINT sms_messages_attempts CHECK (attempts >= 0);

CREATE TRIGGER sms_templates_updated_at BEFORE UPDATE ON public.sms_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER sms_batches_updated_at BEFORE UPDATE ON public.sms_batches
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER sms_messages_updated_at BEFORE UPDATE ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 2.4 app.resolve_sms_message(): the delivery-report webhook arrives without an organization;
-- this returns only the message id and its organization, so the update runs under RLS.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.resolve_sms_message(p_provider_message_id text)
RETURNS TABLE (sms_message_id uuid, organization_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT m.id, m.organization_id FROM public.sms_messages m
  WHERE m.provider_message_id = p_provider_message_id
$$;
REVOKE ALL ON FUNCTION app.resolve_sms_message(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_sms_message(text) TO vk_api;

-- ---------------------------------------------------------------------------------------------
-- 11.9 app.due_transitions() learns the reminders (PRD SMS-06): before opening (scheduled
-- events, start_at - reminder_before_open_hours) and before closing (open events,
-- end_at - reminder_before_close_minutes), each once per event (no batch of that type yet).
-- ---------------------------------------------------------------------------------------------
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
$$;

-- Row-level security (Backend Schema 10.2). Platform admins do not read individual messages
-- (they carry voters' phones), as for voters.
ALTER TABLE public.sms_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY sms_templates_tenant ON public.sms_templates FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
CREATE POLICY sms_templates_platform_read ON public.sms_templates FOR SELECT TO vk_api
  USING (app.is_platform_admin());

ALTER TABLE public.sms_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY sms_batches_tenant ON public.sms_batches FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
CREATE POLICY sms_batches_platform_read ON public.sms_batches FOR SELECT TO vk_api
  USING (app.is_platform_admin());

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY sms_messages_tenant ON public.sms_messages FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_templates, public.sms_batches,
  public.sms_messages TO vk_api;
GRANT SELECT ON public.sms_templates, public.sms_batches TO vk_readonly;
-- Message rows hold voters' phones: vk_readonly reads them without the address.
REVOKE ALL ON public.sms_messages FROM vk_readonly;
GRANT SELECT (id, organization_id, event_id, batch_id, voter_id, channel, type, status, attempts,
              last_error, sent_at, delivered_at, failed_at, created_at, updated_at)
  ON public.sms_messages TO vk_readonly;
