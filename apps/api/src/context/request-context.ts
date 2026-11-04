import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is acting in the current request or job (Backend Schema 2.3). Written into the
 * transaction-local settings app.org_id, app.user_id, app.is_platform_admin and app.request_id
 * by PrismaService.withContext, where RLS policies read them.
 */
export interface RequestContext {
  requestId: string;
  /** Organization being acted in; null for platform-wide and not-yet-resolved requests. */
  orgId: string | null;
  /** Signed-in staff user; null for voter, kiosk, USSD and system work. */
  userId: string | null;
  isPlatformAdmin: boolean;
}

/**
 * Holds the RequestContext for the duration of a request or worker job using AsyncLocalStorage,
 * so any service can read it without being request-scoped. The context object is mutable:
 * authentication (step 9) and event resolution fill in orgId / userId after the middleware.
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  /** Runs `fn` with `context` as the current context (HTTP middleware, worker jobs, tests). */
  run<T>(context: RequestContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /** The current context, or undefined outside a request or job. */
  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  /** The current context; throws when called outside a request or job (a programming error). */
  getOrThrow(): RequestContext {
    const context = this.storage.getStore();
    if (!context)
      throw new Error('No request context: call within a request or RequestContextService.run()');
    return context;
  }
}
