// Writes apps/api/.env for the development PC from apps/api/.env.example: local database and
// Redis URLs for docker-compose.dev.yml, fresh random secrets, and dev placeholders for
// external services. Never overwrites an existing .env. Usage: node scripts/dev-env.mjs
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(root, 'apps/api/.env.example');
const envPath = join(root, 'apps/api/.env');

if (existsSync(envPath)) {
  console.log('apps/api/.env already exists; left unchanged.');
  process.exit(0);
}

const pgPort = process.env.DEV_PG_PORT ?? '5433';
const redisPort = process.env.DEV_REDIS_PORT ?? '6380';
const apiPw = process.env.DEV_API_PW ?? 'vk_api_dev';
const ownerPw = process.env.DEV_OWNER_PW ?? 'vk_owner_dev';
const redisPw = process.env.DEV_REDIS_PW ?? 'vk_redis_dev';

const values = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:5174',
  DATABASE_URL: `postgresql://vk_api:${apiPw}@127.0.0.1:${pgPort}/vote_kidigit`,
  MIGRATION_DATABASE_URL: `postgresql://vk_owner:${ownerPw}@127.0.0.1:${pgPort}/vote_kidigit`,
  REDIS_URL: `redis://:${redisPw}@127.0.0.1:${redisPort}/0`,
  SESSION_SECRET: randomBytes(48).toString('base64url'),
  BALLOT_TOKEN_SECRET: randomBytes(48).toString('base64url'),
  CODE_HMAC_KEY: randomBytes(64).toString('hex'),
  CODE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DEPLOY_HEALTH_SECRET: randomBytes(24).toString('base64url'),
  // External services are faked in development (FakeSmsAdapter, log mail transport).
  SMS_DRIVER: 'fake',
  BEEM_BASE_URL: 'https://apisms.beem.africa',
  BEEM_API_KEY: 'dev',
  BEEM_SECRET_KEY: 'dev',
  BEEM_DEFAULT_SENDER_ID: 'VOTEKIDIGIT',
  BEEM_DLR_SECRET: randomBytes(24).toString('base64url'),
  USSD_CALLBACK_SECRET: randomBytes(24).toString('base64url'),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_USER: 'dev',
  SMTP_PASSWORD: 'dev',
  STORAGE_DIR: join(root, 'storage').replaceAll('\\', '/'),
};

const output = readFileSync(examplePath, 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match || !(match[1] in values)) return line;
    return `${match[1]}=${values[match[1]]}`;
  })
  .join('\n');

writeFileSync(envPath, output, { encoding: 'utf8', mode: 0o600 });
console.log('Wrote apps/api/.env with local URLs and fresh secrets.');
