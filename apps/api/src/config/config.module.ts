import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema.js';

/**
 * Loads apps/api/.env when present (real environment variables win) and validates everything
 * with Zod. Inject `ConfigService<Env, true>` and read values with `{ infer: true }`.
 */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  // src/ and dist/ both sit one level below apps/api
  envFilePath: join(__dirname, '..', '..', '.env'),
  validate: validateEnv,
});
