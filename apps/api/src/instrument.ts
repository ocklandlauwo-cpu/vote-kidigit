// Sentry error monitoring (Tech Stack 6.1). Imported first by main.ts and worker.ts, before
// anything else loads, as @sentry/nestjs requires. Does nothing when SENTRY_DSN is empty.
// Events are scrubbed by scrubSentryEvent (no bodies, cookies, query strings, credential
// headers, link tokens or voting codes).
import * as Sentry from '@sentry/nestjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scrubSentryEvent } from './common/sentry-scrub.js';

// Configuration is validated later by ConfigModule; here only the DSN is needed early.
const envFile = join(__dirname, '..', '.env');
if (!process.env.SENTRY_DSN && existsSync(envFile)) process.loadEnvFile(envFile);

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    serverName: process.env.PROCESS_ROLE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubSentryEvent,
  });
}
