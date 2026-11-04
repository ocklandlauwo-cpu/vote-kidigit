import { Injectable } from '@nestjs/common';
import type { ActorType } from '@vote-kidigit/shared';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is acting in the current request or job (Backend Schema 2.3). orgId, userId,
 * isPlatformAdmin and requestId become transaction-local settings in PrismaService.withContext,
 * where RLS policies read them; the rest feeds the audit log and request logs.
 */
export interface RequestContext {
  requestId: string;
  /** Organization being acted in; null for platform-wide and not-yet-resolved requests. */
  orgId: string | null;
  /** Signed-in staff user; null for voter, kiosk, USSD and system work. */
  userId: string | null;
  isPlatformAdmin: boolean;
  /** Audit actor: a staff user, a voter (sign-in events only) or the system. */
  actorType: ActorType;
  /** "Name <email>" at the time, "Voter" or "System". */
  actorLabel: string;
  /** Client IP as seen through the reverse proxy (trust proxy = 1); null for jobs. */
  ip: string | null;
  userAgent: string | null;
}

/** Context for work that no person started: scheduler sweeps, queued jobs without a user. */
export function systemContext(requestId: string, orgId: string | null = null): RequestContext {
  return {
    requestId,
    orgId,
    userId: null,
    isPlatformAdmin: false,
    actorType: 'system',
    actorLabel: 'System',
    ip: null,
    userAgent: null,
  };
}

/**
 * One storage for the whole process, so code created outside Nest's dependency injection
 * (the logger) reads the same context as the injectable service.
 */
const storage = new AsyncLocalStorage<RequestContext>();

/** The current context outside dependency injection (logger, error reporting). */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Holds the RequestContext for the duration of a request or worker job, so any service can read
 * it without being request-scoped. The context object is mutable: authentication (step 9) and
 * event resolution fill in orgId, userId and the actor after the middleware has started it.
 */
@Injectable()
export class RequestContextService {
  /** Runs `fn` with `context` as the current context (HTTP middleware, worker jobs, tests). */
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  /** The current context, or undefined outside a request or job. */
  get(): RequestContext | undefined {
    return storage.getStore();
  }

  /** The current context; throws when called outside a request or job (a programming error). */
  getOrThrow(): RequestContext {
    const context = storage.getStore();
    if (!context) {
      throw new Error('No request context: call within a request or RequestContextService.run()');
    }
    return context;
  }
}
