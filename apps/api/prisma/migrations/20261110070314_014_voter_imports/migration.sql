-- CreateTable
CREATE TABLE "voter_imports" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "file_id" UUID,
    "status" "import_status" NOT NULL DEFAULT 'uploaded',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "warning_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "column_mapping" JSONB,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "created_by" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voter_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voter_imports_event_id_idx" ON "voter_imports"("event_id");

-- CreateIndex
CREATE INDEX "voter_imports_organization_id_idx" ON "voter_imports"("organization_id");

-- CreateIndex
CREATE INDEX "voter_imports_file_id_idx" ON "voter_imports"("file_id");

-- CreateIndex
CREATE INDEX "voter_imports_created_by_idx" ON "voter_imports"("created_by");

-- AddForeignKey
ALTER TABLE "voter_imports" ADD CONSTRAINT "voter_imports_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "voting_events"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter_imports" ADD CONSTRAINT "voter_imports_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voter_imports" ADD CONSTRAINT "voter_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written below this line

ALTER TABLE public.voter_imports
  ADD CONSTRAINT voter_imports_counters CHECK (
    total_rows >= 0 AND valid_rows >= 0 AND warning_rows >= 0 AND error_rows >= 0
    AND imported_rows >= 0);

CREATE TRIGGER voter_imports_updated_at BEFORE UPDATE ON public.voter_imports
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- app.check_file_ref() (migration 013) learns voter_imports.file_id: an import points only at a
-- CSV file of its own organization.
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
  ELSIF TG_TABLE_NAME = 'voter_imports' THEN
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

CREATE TRIGGER voter_imports_file BEFORE INSERT OR UPDATE OF file_id
  ON public.voter_imports FOR EACH ROW EXECUTE FUNCTION app.check_file_ref('csv_import');

-- Row-level security (Backend Schema 10.2 template)
ALTER TABLE public.voter_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY voter_imports_tenant ON public.voter_imports FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
CREATE POLICY voter_imports_platform_read ON public.voter_imports FOR SELECT TO vk_api
  USING (app.is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voter_imports TO vk_api;
GRANT SELECT ON public.voter_imports TO vk_readonly;
