-- This is an empty migration.
-- Hand-written below this line
-- 021: platform administrators read results like other tenant tables (Backend Schema 10.2:
-- only voters, participation and messages are kept from them). 020 left these policies out.
CREATE POLICY result_snapshots_platform_read ON public.result_snapshots FOR SELECT TO vk_api
  USING (app.is_platform_admin());
CREATE POLICY result_category_stats_platform_read ON public.result_category_stats FOR SELECT TO vk_api
  USING (app.is_platform_admin());
CREATE POLICY result_rows_platform_read ON public.result_rows FOR SELECT TO vk_api
  USING (app.is_platform_admin());
CREATE POLICY tie_resolutions_platform_read ON public.tie_resolutions FOR SELECT TO vk_api
  USING (app.is_platform_admin());
