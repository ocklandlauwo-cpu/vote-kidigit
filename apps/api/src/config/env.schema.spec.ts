import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.schema.js';

function validRawEnv(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    APP_URL: 'http://localhost:5174',
    PROCESS_ROLE: 'api',
    DEFAULT_TIMEZONE: 'Africa/Dar_es_Salaam',
    DATABASE_URL: 'postgresql://vk_api:api-secret-pw@127.0.0.1:5433/vote_kidigit',
    MIGRATION_DATABASE_URL: 'postgresql://vk_owner:owner-secret-pw@127.0.0.1:5433/vote_kidigit',
    REDIS_URL: 'redis://:redis-secret-pw@127.0.0.1:6380/0',
    SESSION_SECRET: randomBytes(48).toString('base64url'),
    BALLOT_TOKEN_SECRET: randomBytes(48).toString('base64url'),
    CODE_HMAC_KEY: randomBytes(64).toString('hex'),
    CODE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DEPLOY_HEALTH_SECRET: randomBytes(24).toString('base64url'),
    SESSION_IDLE_MINUTES: '15',
    VOTER_IDLE_MINUTES: '10',
    LOGIN_MAX_ATTEMPTS: '5',
    LOGIN_LOCK_MINUTES: '15',
    SMS_DRIVER: 'beem',
    BEEM_BASE_URL: 'https://sms.example.test',
    BEEM_API_KEY: 'beem-key',
    BEEM_SECRET_KEY: 'beem-secret-key',
    BEEM_DEFAULT_SENDER_ID: 'VOTEKIDIGIT',
    BEEM_DLR_SECRET: randomBytes(24).toString('base64url'),
    USSD_SHORT_CODE: '*150*00#',
    USSD_CALLBACK_SECRET: randomBytes(24).toString('base64url'),
    SMTP_HOST: 'mail.example.test',
    SMTP_PORT: '587',
    SMTP_USER: 'no-reply@example.test',
    SMTP_PASSWORD: 'smtp-secret-pw',
    MAIL_FROM: 'Vote-Kidigit <no-reply@example.test>',
    STORAGE_DIR: '/home/vk/storage',
    MAX_UPLOAD_MB: '2',
    MAX_CSV_MB: '10',
    SENTRY_DSN: '',
  };
}

function errorOf(raw: Record<string, unknown>): string {
  try {
    validateEnv(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected validation to fail');
}

describe('validateEnv', () => {
  it('accepts a complete configuration and coerces numbers', () => {
    const env = validateEnv(validRawEnv());
    expect(env.PORT).toBe(3000);
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('names every missing variable', () => {
    const raw: Record<string, unknown> = validRawEnv();
    delete raw.DATABASE_URL;
    delete raw.REDIS_URL;
    const message = errorOf(raw);
    expect(message).toContain('DATABASE_URL: is missing');
    expect(message).toContain('REDIS_URL: is missing');
  });

  it('rejects a DATABASE_URL that is not a PostgreSQL URL', () => {
    const message = errorOf({ ...validRawEnv(), DATABASE_URL: 'mysql://root@localhost/db' });
    expect(message).toContain('DATABASE_URL: must be a postgresql:// URL');
  });

  it('rejects empty values, bad keys and an unknown time zone', () => {
    const message = errorOf({
      ...validRawEnv(),
      SMTP_HOST: '',
      CODE_HMAC_KEY: 'abc',
      CODE_ENCRYPTION_KEY: randomBytes(16).toString('base64'),
      DEFAULT_TIMEZONE: 'Mars/Olympus_Mons',
    });
    expect(message).toContain('SMTP_HOST: is empty');
    expect(message).toContain('CODE_HMAC_KEY: must be 64 random bytes as hex');
    expect(message).toContain('CODE_ENCRYPTION_KEY: must be 32 random bytes as base64');
    expect(message).toContain('DEFAULT_TIMEZONE: must be an IANA time zone');
  });

  it('refuses CHANGE_ME placeholders and plain http in production only', () => {
    const raw = { ...validRawEnv(), BEEM_API_KEY: 'CHANGE_ME' };
    expect(() => validateEnv(raw)).not.toThrow();

    const message = errorOf({ ...raw, NODE_ENV: 'production' });
    expect(message).toContain('BEEM_API_KEY: still has its CHANGE_ME placeholder');
    expect(message).toContain('APP_URL: must use https in production');
  });

  it('never includes values in the error message', () => {
    const raw = validRawEnv();
    const message = errorOf({ ...raw, PORT: 'not-a-port', SESSION_SECRET: 'short-secret' });
    for (const value of Object.values(raw)) {
      if (value.length >= 8) expect(message).not.toContain(value);
    }
    expect(message).not.toContain('short-secret');
  });
});
