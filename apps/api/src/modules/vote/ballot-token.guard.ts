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
import { BallotAuthorizer } from './ballot-authorizer.js';
import type { BallotSession } from './vote-session.js';

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
  constructor(private readonly authorizer: BallotAuthorizer) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    req.voter = { token: token ?? '', session: await this.authorizer.authorize(token) };
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
