// The voter's ballot token (Authorization: Bearer) on /vote/* routes after sign-in. The routes
// are @Public() for the staff guards; this guard loads the session, restarts its idle timer and
// puts the voter's organization into the request context (actor: Voter).
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { type BallotSession, VoteSessions } from './vote-session.js';

export interface VoterRequest {
  token: string;
  session: BallotSession;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point
  namespace Express {
    interface Request {
      /** Set by BallotTokenGuard on voter routes. */
      voter?: VoterRequest;
    }
  }
}

@Injectable()
export class BallotTokenGuard implements CanActivate {
  constructor(
    private readonly sessions: VoteSessions,
    private readonly requestContext: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const token = match?.[1];
    const session = token ? await this.sessions.get(token) : null;
    // The voter app shows "Muda umeisha. Tafadhali ingia tena" (App Flow 13.1).
    if (!token || !session) throw new AppError('UNAUTHENTICATED');
    req.voter = { token, session };
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = session.orgId;
    ctx.actorType = 'voter';
    ctx.actorLabel = 'Voter';
    return true;
  }
}

/** The signed-in voter of a route behind BallotTokenGuard. */
export const CurrentVoter = createParamDecorator<unknown, VoterRequest>(
  (_data: unknown, ctx: ExecutionContext) => {
    const voter = ctx.switchToHttp().getRequest<Request>().voter;
    if (!voter) throw new AppError('UNAUTHENTICATED');
    return voter;
  },
);
