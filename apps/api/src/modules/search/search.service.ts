// Global search (App Flow 3.6, Backend Schema 12.4 GET /search): events, voters (by name or
// membership ID) and staff, at most SEARCH_LIMIT each, filtered by permission. A user without
// event.access_all finds only the events they are mapped to and the voters of those events.
// Platform admins find events only: they never read voters (Backend Schema 10).
import { Injectable } from '@nestjs/common';
import { normalizeMembershipId, SEARCH_LIMIT, type SearchResults } from '@vote-kidigit/shared';
import type { AuthState } from '../../auth/auth.types.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  search(auth: AuthState, q: string): Promise<SearchResults> {
    const has = (permission: string) => auth.permissions.includes(permission);
    const allEvents = auth.isPlatformAdmin || has('event.access_all');
    const visibleEvents: Prisma.VotingEventWhereInput = {
      deletedAt: null,
      isActive: true,
      ...(!allEvents && { assignments: { some: { userId: auth.userId } } }),
    };
    const contains = { contains: q, mode: 'insensitive' as const };
    return this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const [events, voters, staff] = await Promise.all([
        auth.isPlatformAdmin || has('event.view')
          ? tx.votingEvent.findMany({
              where: { ...visibleEvents, name: contains },
              orderBy: { startAt: 'desc' },
              take: SEARCH_LIMIT,
              select: { id: true, name: true, status: true },
            })
          : [],
        !auth.isPlatformAdmin && has('voter.view')
          ? tx.voter.findMany({
              where: {
                deletedAt: null,
                event: visibleEvents,
                OR: [
                  { fullName: contains },
                  { membershipIdNormalized: { contains: normalizeMembershipId(q) } },
                ],
              },
              orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
              take: SEARCH_LIMIT,
              select: {
                id: true,
                fullName: true,
                membershipId: true,
                event: { select: { id: true, name: true } },
              },
            })
          : [],
        !auth.isPlatformAdmin && has('staff.manage')
          ? tx.user.findMany({
              where: { deletedAt: null, OR: [{ fullName: contains }, { email: contains }] },
              orderBy: { fullName: 'asc' },
              take: SEARCH_LIMIT,
              select: { id: true, fullName: true, email: true },
            })
          : [],
      ]);
      return {
        events,
        voters: voters.map((voter) => ({
          id: voter.id,
          fullName: voter.fullName,
          membershipId: voter.membershipId,
          eventId: voter.event.id,
          eventName: voter.event.name,
        })),
        staff,
      };
    });
  }
}
