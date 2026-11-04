// Sentry error monitoring (Tech Stack 6.1). Imported first by main.ts and worker.ts, before
// anything else loads, as @sentry/nestjs requires. Does nothing when SENTRY_DSN is empty.
// Events are scrubbed: no request bodies, cookies, query strings or credential headers, and
// voting codes are masked in messages (Tech Stack 11.2).
import * as Sentry from '@sentry/nestjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { maskVotingCodes, redact } from './common/redaction.js';

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
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        const userAgent = event.request.headers?.['user-agent'];
        event.request.headers = userAgent ? { 'user-agent': userAgent } : {};
      }
      if (event.message) event.message = maskVotingCodes(event.message);
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = maskVotingCodes(exception.value);
      }
      if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
      return event;
    },
  });
}
