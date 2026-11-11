// Control room (CTL-01, App Flow 6.10; Implementation Plan step 26): turnout from the
// participation records (overall, per category, per channel), the categories with their status
// and windows, the last message batch, running kiosks and alerts. Nothing per contester: ballots
// are not read here at all.
import { Injectable } from '@nestjs/common';
import type { Live, LiveAlert } from '@vote-kidigit/shared';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { KioskService } from '../kiosk/kiosk.service.js';
import { BatchesService } from '../messages/batches.service.js';

/** App Flow 6.10 / Backend Schema 8.3: alert after 3 lockouts, and 5 minutes before a close. */
const LOCKOUT_ALERT = 3;
const CLOSING_SOON_MS = 5 * 60_000;

@Injectable()
export class LiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly batches: BatchesService,
    private readonly kiosks: KioskService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /events/:eventId/live */
  async live(auth: AuthState, eventId: string): Promise<Live> {
    const now = new Date();
    const counts = await this.prisma.withContext(this.context(), async (tx) => {
      const event = await tx.votingEvent.findFirst({
        where: { id: eventId, deletedAt: null },
        select: { status: true, endAt: true },
      });
      if (!event) throw new AppError('NOT_FOUND');
      const registered = await tx.voter.count({ where: { eventId, deletedAt: null } });
      const [overall] = await tx.$queryRaw<{ voted: bigint }[]>`
        SELECT count(DISTINCT voter_id) AS voted FROM public.voter_participation
        WHERE event_id = ${eventId}::uuid`;
      const perCategory = await tx.voterParticipation.groupBy({
        by: ['categoryId'],
        where: { eventId },
        _count: { _all: true },
      });
      const perChannel = await tx.$queryRaw<{ channel: string; voters: bigint }[]>`
        SELECT channel::text, count(DISTINCT voter_id) AS voters FROM public.voter_participation
        WHERE event_id = ${eventId}::uuid GROUP BY channel`;
      const lockouts = await tx.auditLog.count({ where: { eventId, action: 'voter.locked' } });
      return {
        event,
        registered,
        voted: Number(overall?.voted ?? 0),
        perCategory,
        perChannel,
        lockouts,
      };
    });

    const categoryList = await this.categories.list(eventId);
    const votedIn = new Map(counts.perCategory.map((row) => [row.categoryId, row._count._all]));
    const channel = (name: string) =>
      Number(counts.perChannel.find((row) => row.channel === name)?.voters ?? 0);
    const lastBatch = (await this.batches.list(eventId, { page: 1, pageSize: 1 })).items[0] ?? null;
    const kiosks = auth.permissions.includes('kiosk.operate')
      ? (await this.kiosks.list(eventId)).items
      : null;

    const alerts: LiveAlert[] = [];
    if (counts.lockouts >= LOCKOUT_ALERT) {
      alerts.push({
        kind: 'lockouts',
        count: counts.lockouts,
        categoryId: null,
        name: null,
        at: null,
      });
    }
    if (lastBatch && (lastBatch.status === 'paused' || lastBatch.failedCount > 0)) {
      alerts.push({
        kind: 'sms_failures',
        count: lastBatch.failedCount,
        categoryId: null,
        name: null,
        at: null,
      });
    }
    const soon = (at: string | Date | null) =>
      at !== null &&
      new Date(at).getTime() > now.getTime() &&
      new Date(at).getTime() - now.getTime() <= CLOSING_SOON_MS;
    if (counts.event.status === 'open') {
      for (const category of categoryList.items) {
        if (category.status === 'open' && soon(category.closesAt)) {
          alerts.push({
            kind: 'closing_soon',
            count: null,
            categoryId: category.id,
            name: category.name,
            at: category.closesAt,
          });
        }
      }
      if (soon(counts.event.endAt)) {
        alerts.push({
          kind: 'closing_soon',
          count: null,
          categoryId: null,
          name: null,
          at: counts.event.endAt.toISOString(),
        });
      }
    }

    return {
      status: counts.event.status,
      endAt: counts.event.endAt.toISOString(),
      turnout: {
        voted: counts.voted,
        registered: counts.registered,
        percent:
          counts.registered > 0 ? Math.round((counts.voted / counts.registered) * 1000) / 10 : 0,
      },
      categories: categoryList.items.map((category) => ({
        id: category.id,
        name: category.name,
        status: category.status,
        manualState: category.manualState,
        opensAt: category.opensAt,
        closesAt: category.closesAt,
        voted: votedIn.get(category.id) ?? 0,
        eligible: category.eligibleVoters,
      })),
      channels: { web: channel('web'), ussd: channel('ussd'), kiosk: channel('kiosk') },
      notVoted: counts.registered - counts.voted,
      lastBatch,
      kiosks,
      alerts,
      updatedAt: now.toISOString(),
    };
  }

  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
