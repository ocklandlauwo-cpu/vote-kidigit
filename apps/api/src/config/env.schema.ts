import { z } from 'zod';

// Environment variables of the API and worker (Tech Stack 10, Backend Schema 13.5).
// Validated once at startup; the process refuses to start on any missing or malformed value.

const PLACEHOLDER_PREFIX = 'CHANGE_ME';

const text = z.string().trim().min(1, 'is empty');
const port = z.coerce.number().int().min(1).max(65535);
const minutes = z.coerce.number().int().min(1).max(1440);
const megabytes = z.coerce.number().int().min(1).max(100);
const secret = (minLength: number) =>
  text.min(minLength, `must be at least ${minLength} characters (generate a random value)`);

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: 'must be a postgresql:// URL with user, password, host, port and database',
});
const redisUrl = z.url({ protocol: /^rediss?$/, error: 'must be a redis:// URL' });

const timeZone = text.refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be an IANA time zone such as Africa/Dar_es_Salaam');

const hmacKey = text.regex(/^[0-9a-f]{128}$/i, 'must be 64 random bytes as hex (128 characters)');

const aesKey = text.refine(
  (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32,
  'must be 32 random bytes as base64',
);

export const envSchema = z
  .object({
    // App
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: port,
    APP_URL: z.url({ protocol: /^https?$/ }),
    PROCESS_ROLE: z.enum(['api', 'worker']),
    DEFAULT_TIMEZONE: timeZone,

    // Database
    DATABASE_URL: postgresUrl,
    MIGRATION_DATABASE_URL: postgresUrl,
    /**
     * Connections per process (step 31 load test). 4 API instances and the worker at 15 each
     * stay under PostgreSQL's max_connections = 100 (Tech Stack 9.2).
     */
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(15),

    // Redis
    REDIS_URL: redisUrl,
    /** BullMQ key prefix (Backend Schema 7.9: bull:*); tests use one per Jest worker. */
    QUEUE_PREFIX: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .default('bull'),

    // Security
    SESSION_SECRET: secret(32),
    BALLOT_TOKEN_SECRET: secret(32),
    CODE_HMAC_KEY: hmacKey,
    CODE_ENCRYPTION_KEY: aesKey,
    DEPLOY_HEALTH_SECRET: secret(24),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(60),
    VOTER_IDLE_MINUTES: minutes,
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20),
    LOGIN_LOCK_MINUTES: minutes,

    // SMS (Beem Africa). The fake driver records messages instead of sending them.
    SMS_DRIVER: z.enum(['fake', 'beem']).default('fake'),
    BEEM_BASE_URL: z.url({ protocol: /^https?$/ }),
    BEEM_API_KEY: text,
    BEEM_SECRET_KEY: text,
    BEEM_DEFAULT_SENDER_ID: text.max(11, 'must be at most 11 characters'),
    BEEM_DLR_SECRET: secret(16),

    // USSD
    USSD_SHORT_CODE: text,
    USSD_CALLBACK_SECRET: secret(16),
    /**
     * Addresses the aggregator calls from (comma-separated). Empty allows any address: the
     * secret in the callback URL is then the only check, as for development and tests.
     */
    USSD_ALLOWED_IPS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((ip) => ip.trim())
          .filter(Boolean),
      ),

    // Email
    SMTP_HOST: text,
    SMTP_PORT: port,
    SMTP_USER: text,
    SMTP_PASSWORD: text,
    MAIL_FROM: text,
    /** Receives the public website's contact and demo requests (App Flow 4.1). */
    CONTACT_TO_EMAIL: z.email(),

    // Storage
    STORAGE_DIR: text,
    MAX_UPLOAD_MB: megabytes,
    MAX_CSV_MB: megabytes,

    // Monitoring (optional)
    SENTRY_DSN: z
      .union([z.literal(''), z.url()])
      .optional()
      .transform((value) => value || undefined),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && value.startsWith(PLACEHOLDER_PREFIX)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'still has its CHANGE_ME placeholder',
        });
      }
    }
    if (env.SMS_DRIVER !== 'beem') {
      ctx.addIssue({ code: 'custom', path: ['SMS_DRIVER'], message: 'must be beem in production' });
    }
    if (!env.APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must use https in production' });
    }
  });

export type Env = z.output<typeof envSchema>;

/**
 * Validates raw environment variables. The error lists every problem by variable name
 * and never includes a value, so it is safe to log.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    const missing = issue.code === 'invalid_type' && raw[key] === undefined;
    return `  - ${key}: ${missing ? 'is missing' : issue.message}`;
  });
  throw new Error(
    `Invalid environment configuration (see apps/api/.env.example):\n${problems.join('\n')}`,
  );
}
