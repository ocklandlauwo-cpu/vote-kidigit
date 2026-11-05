-- 009_platform_settings (Backend Schema 4.10, PLT-04). Runs as vk_owner. One row of
-- platform-wide settings; a platform table, so it has no organization_id.

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "default_session_timeout_minutes" SMALLINT NOT NULL DEFAULT 15,
    "ussd_short_code" TEXT,
    "support_phone" TEXT,
    "support_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Hand-written below this line

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_single_row CHECK (id = 1),
  ADD CONSTRAINT platform_settings_timeout_range
    CHECK (default_session_timeout_minutes BETWEEN 5 AND 60);

CREATE TRIGGER platform_settings_updated_at BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

INSERT INTO public.platform_settings (id) VALUES (1);

-- Everyone reads (voter screens show the support contact and USSD code); only platform admins
-- change it. The single row is never inserted or deleted by the API.
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_read ON public.platform_settings FOR SELECT TO vk_api
  USING (true);
CREATE POLICY platform_settings_update ON public.platform_settings FOR UPDATE TO vk_api
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

REVOKE ALL ON public.platform_settings FROM vk_api;
GRANT SELECT, UPDATE ON public.platform_settings TO vk_api;
GRANT SELECT ON public.platform_settings TO vk_readonly;
