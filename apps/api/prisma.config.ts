// Prisma CLI configuration (Prisma 7). The CLI connects as the owner role (vk_owner) through
// MIGRATION_DATABASE_URL; the running app connects as vk_api through DATABASE_URL.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer loads .env itself; production sets real environment variables instead.
const envFile = join(import.meta.dirname, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` needs no database, so a clone without .env can still build and typecheck;
  // migrate commands fail with Prisma's own "datasource url" error when the variable is missing.
  ...(process.env.MIGRATION_DATABASE_URL
    ? { datasource: { url: env('MIGRATION_DATABASE_URL') } }
    : {}),
});
