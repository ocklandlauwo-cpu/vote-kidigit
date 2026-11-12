-- CreateTable
CREATE TABLE "report_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID,
    "type" "report_type" NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'queued',
    "params" JSONB NOT NULL DEFAULT '{}',
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "file_id" UUID,
    "requested_by" UUID,
    "error" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_jobs_organization_id_created_at_idx" ON "report_jobs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "report_jobs_event_id_created_at_idx" ON "report_jobs"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "report_jobs_file_id_idx" ON "report_jobs"("file_id");

-- CreateIndex
CREATE INDEX "report_jobs_requested_by_idx" ON "report_jobs"("requested_by");

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written below this line

ALTER TABLE public.report_jobs
  ADD CONSTRAINT report_jobs_progress CHECK (progress BETWEEN 0 AND 100),
  -- Only the audit export may be organization-wide.
  ADD CONSTRAINT report_jobs_event CHECK (event_id IS NOT NULL OR type = 'audit_xlsx'),
  -- A finished job has its time; its file may be deleted later (file_id SET NULL).
  ADD CONSTRAINT report_jobs_done CHECK (
    status NOT IN ('completed', 'failed') OR completed_at IS NOT NULL);

CREATE TRIGGER report_jobs_updated_at BEFORE UPDATE ON public.report_jobs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- app.check_file_ref() learns report_jobs.file_id: a job points only at a report file of its
-- own organization.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.check_file_ref() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  v_file uuid;
  v_org uuid;
BEGIN
  IF TG_TABLE_NAME = 'organizations' THEN
    v_file := NEW.logo_file_id;
    v_org := NEW.id;
  ELSIF TG_TABLE_NAME = 'categories' THEN
    v_file := NEW.picture_file_id;
    v_org := NEW.organization_id;
  ELSIF TG_TABLE_NAME IN ('voter_imports', 'report_jobs') THEN
    v_file := NEW.file_id;
    v_org := NEW.organization_id;
  ELSE
    v_file := NEW.photo_file_id;
    v_org := NEW.organization_id;
  END IF;
  IF v_file IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.files f
    WHERE f.id = v_file AND f.organization_id = v_org AND f.kind = TG_ARGV[0]::file_kind) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER report_jobs_file BEFORE INSERT OR UPDATE OF file_id
  ON public.report_jobs FOR EACH ROW EXECUTE FUNCTION app.check_file_ref('report');

-- Row-level security (Backend Schema 10.2 template)
ALTER TABLE public.report_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_jobs_tenant ON public.report_jobs FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
CREATE POLICY report_jobs_platform_read ON public.report_jobs FOR SELECT TO vk_api
  USING (app.is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_jobs TO vk_api;
GRANT SELECT ON public.report_jobs TO vk_readonly;
