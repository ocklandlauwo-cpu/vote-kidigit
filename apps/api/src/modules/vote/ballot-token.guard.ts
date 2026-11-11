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
import { PrismaService } from '../../database/prisma.service.js';
import { codeCheck } from './vote-links.js';
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
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const token = match?.[1];
    const session = token ? await this.sessions.get(token) : null;
    // The voter app shows "Muda umeisha. Tafadhali ingia tena" (App Flow 13.1).
    if (!token || !session) throw new AppError('UNAUTHENTICATED');
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = session.orgId;
    ctx.actorType = 'voter';
    ctx.actorLabel = 'Voter';
    // The session is only as good as what it was started with: the event must still resolve
    // (active, not deleted) and the voter must still exist with the same code.
    const valid = await this.prisma.withContext(ctx, async (tx) => {
      const [event] = await tx.$queryRaw<{ organization_id: string }[]>`
        SELECT organization_id FROM app.resolve_event(${session.eventId}::uuid)`;
      if (event?.organization_id !== session.orgId) return false;
      const voter = await tx.voter.findFirst({
        where: { id: session.voterId, eventId: session.eventId, deletedAt: null },
        select: { codeHmac: true },
      });
      return voter !== null && codeCheck(voter.codeHmac) === session.codeCheck;
    });
    if (!valid) {
      await this.sessions.end(token);
      throw new AppError('UNAUTHENTICATED');
    }
    req.voter = { token, session };
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
