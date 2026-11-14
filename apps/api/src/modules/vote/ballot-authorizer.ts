// Checks a voter's ballot token and enters the voter's organization (actor: Voter). Shared by
// BallotTokenGuard (web and kiosk routes) and the USSD engine, so both accept exactly the same
// sessions: the event must still resolve (active, not deleted) and the voter must still exist
// with the code the session was started with.
import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { codeCheck } from './vote-links.js';
import { type BallotSession, VoteSessions } from './vote-session.js';

@Injectable()
export class BallotAuthorizer {
  constructor(
    private readonly sessions: VoteSessions,
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** The session of `token`, with the request context moved into its organization. */
  async authorize(token: string | undefined): Promise<BallotSession> {
    const session = token ? await this.sessions.get(token) : null;
    // The voter app shows "Muda umeisha. Tafadhali ingia tena" (App Flow 13.1).
    if (!token || !session) throw new AppError('UNAUTHENTICATED');
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = session.orgId;
    ctx.actorType = 'voter';
    ctx.actorLabel = 'Voter';
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
    return session;
  }
}
