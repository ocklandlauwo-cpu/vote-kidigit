import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContextService } from './request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** A caller-supplied request ID is kept only when it is short and plain (it reaches logs). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Starts the request context for every HTTP request: a request ID (the caller's X-Request-Id
 * when safe, otherwise a new UUID, echoed in the response) and an anonymous identity that
 * authentication fills in later.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const supplied = req.header(REQUEST_ID_HEADER);
    const requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    this.requestContext.run({ requestId, orgId: null, userId: null, isPlatformAdmin: false }, () =>
      next(),
    );
  }
}
