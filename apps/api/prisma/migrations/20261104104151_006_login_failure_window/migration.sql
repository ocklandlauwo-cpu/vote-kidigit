-- 006_login_failure_window. Runs as vk_owner. Wrong-password counts older than 24 hours start
-- again, the same sliding window the API applies to unknown emails, so the lockout behaves
-- identically for existing and non-existing accounts (security review of step 9).

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_failed_login_at" TIMESTAMPTZ(6);

-- Hand-written below this line
GRANT SELECT (last_failed_login_at) ON public.users TO vk_readonly;
