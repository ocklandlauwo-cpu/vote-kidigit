import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Rate limits per staff session when signed in (Backend Schema 12.1: 300 / min per session),
 * otherwise per client IP (sign-in, voter and public endpoints).
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    if (request.session?.userId) return Promise.resolve(`session:${request.sessionID}`);
    return super.getTracker(req);
  }
}
