-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "kind" "file_kind" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "original_name" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" CHAR(64) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_path_key" ON "files"("storage_path");

-- CreateIndex
CREATE INDEX "files_organization_id_idx" ON "files"("organization_id");

-- CreateIndex
CREATE INDEX "files_created_by_idx" ON "files"("created_by");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_picture_file_id_fkey" FOREIGN KEY ("picture_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contesters" ADD CONSTRAINT "contesters_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voters" ADD CONSTRAINT "voters_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written below this line

-- ---------------------------------------------------------------------------------------------
-- A row may point only at a file of its own organization and of the matching kind, so a photo
-- cannot be borrowed from another organization or a report shown as a logo. SECURITY INVOKER:
-- as vk_api, RLS already hides other organizations' files.
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app.check_file_ref() RETURNS trigger
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

CREATE TRIGGER organizations_logo_file BEFORE INSERT OR UPDATE OF logo_file_id
  ON public.organizations FOR EACH ROW EXECUTE FUNCTION app.check_file_ref('org_logo');
CREATE TRIGGER categories_picture_file BEFORE INSERT OR UPDATE OF picture_file_id
  ON public.categories FOR EACH ROW EXECUTE FUNCTION app.check_file_ref('category_picture');
CREATE TRIGGER contesters_photo_file BEFORE INSERT OR UPDATE OF photo_file_id
  ON public.contesters FOR EACH ROW EXECUTE FUNCTION app.check_file_ref('contester_photo');
CREATE TRIGGER voters_photo_file BEFORE INSERT OR UPDATE OF photo_file_id
  ON public.voters FOR EACH ROW EXECUTE FUNCTION app.check_file_ref('voter_photo');

-- ---------------------------------------------------------------------------------------------
-- Row-level security (Backend Schema 10.2 template)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY files_tenant ON public.files FOR ALL TO vk_api
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());
CREATE POLICY files_platform_read ON public.files FOR SELECT TO vk_api
  USING (app.is_platform_admin());

-- Grants (Backend Schema 10.4). File rows are never updated: a new upload is a new row, so the
-- default UPDATE grant of migration 003 is taken back.
REVOKE UPDATE ON public.files FROM vk_api;
GRANT SELECT, INSERT, DELETE ON public.files TO vk_api;
GRANT SELECT ON public.files TO vk_readonly;
