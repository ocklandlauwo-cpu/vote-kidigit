// Results (Backend Schema 12.10, App Flow 6.12–6.14, 11): the frozen snapshot for staff, tie
// resolution through app.resolve_tie(), publication through app.transition_event() (blocked while
// a tie is open), the public link, and the public and voter views, which show winners only when
// the event says so. Before close there are no numbers at all.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  EventResults,
  PublicResults,
  PublishResultsRequest,
  ResolveTieRequest,
  VoterResults,
} from '@vote-kidigit/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { transitionEvent } from '../events/lifecycle.service.js';
import { BatchesService } from '../messages/batches.service.js';
import { signFileLink } from '../vote/vote-links.js';
import { currentSnapshot, snapshotInclude, toSnapshot } from './snapshot.js';

const RESULT_STATES = ['closed', 'results_published', 'archived'];


@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);
  private readonly appUrl: string;
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly batches: BatchesService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/+$/, '');
    this.secret = config.get('BALLOT_TOKEN_SECRET', { infer: true });
  }

  /** GET /events/:eventId/results (RES-01, RES-02). */
  get(eventId: string): Promise<EventResults> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.event(tx, eventId);
      const base = {
        publicUrl: event.publicResultsToken
          ? `${this.appUrl}/results/${event.publicResultsToken}`
          : null,
        publicEnabled: event.publicResultsEnabled,
        visibility: event.resultsVisibility,
      };
      if (
        !RESULT_STATES.includes(event.status) ||
        (event.status === 'archived' && event.cancelledAt)
      ) {
        return { state: 'not_closed', snapshot: null, unresolvedTies: 0, ...base };
      }
      const snapshot = await currentSnapshot(tx, eventId);
      if (!snapshot) return { state: 'not_closed', snapshot: null, unresolvedTies: 0, ...base };
      const view = toSnapshot(snapshot, (fileId) =>
        fileId ? `/api/v1/files/${fileId}` : null,
      );
      return {
        state: snapshot.publishedAt ? 'published' : 'closed',
        snapshot: view,
        unresolvedTies: view.categories.filter((c) => c.hasTie && !c.tie).length,
        ...base,
      };
    });
  }

  /** POST /events/:eventId/results/ties (RES-03). */
  async resolveTie(eventId: string, body: ResolveTieRequest): Promise<EventResults> {
    await this.prisma.withContext(this.context(), async (tx) => {
      const snapshot = await currentSnapshot(tx, eventId);
      if (!snapshot) throw new AppError('NOT_FOUND');
      await tx.$executeRaw`
        SELECT app.resolve_tie(${snapshot.id}::uuid, ${body.categoryId}::uuid,
                               ${body.outcome}::tie_outcome, ${body.winnerIds ?? []}::uuid[],
                               ${body.reason})`;
      await this.audit.record(tx, {
        action: 'results.tie_resolve',
        entityType: 'result_snapshots',
        entityId: snapshot.id,
        eventId,
        after: { categoryId: body.categoryId, outcome: body.outcome, winnerIds: body.winnerIds },
        reason: body.reason,
      });
    });
    return this.get(eventId);
  }

  /** POST /events/:eventId/results/publish: the typed name must match. */
  async publish(eventId: string, body: PublishResultsRequest): Promise<EventResults> {
    await this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.event(tx, eventId);
      if (body.confirmName.trim() !== event.name.trim()) {
        throw new AppError('VALIDATION_FAILED', 'Type the event name to confirm.', {
          source: 'body',
          issues: [{ path: 'confirmName', code: 'mismatch', message: 'does not match' }],
        });
      }
      await transitionEvent(
        tx,
        eventId,
        'results_published',
        null,
        null,
        randomBytes(24).toString('base64url'),
      );
      await this.audit.record(tx, {
        action: 'results.publish',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { status: event.status },
        after: { status: 'results_published' },
      });
    });
    // App Flow 6.14: voters are told by SMS; a failure to queue never undoes the publication.
    try {
      await this.batches.send({
        eventId,
        type: 'results_published',
        channel: 'sms',
        audience: 'all',
      });
    } catch (error: unknown) {
      this.logger.warn({
        message: 'Results SMS not queued',
        errorCode: error instanceof AppError ? error.code : 'UNKNOWN',
      });
    }
    return this.get(eventId);
  }

  /** POST /events/:eventId/results/public-link: turn the public page on or off. */
  async setPublicLink(eventId: string, enabled: boolean): Promise<EventResults> {
    await this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.event(tx, eventId);
      await tx.votingEvent.update({
        where: { id: eventId },
        data: { publicResultsEnabled: enabled },
      });
      await this.audit.record(tx, {
        action: 'results.public_link',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        before: { publicResultsEnabled: event.publicResultsEnabled },
        after: { publicResultsEnabled: enabled },
      });
    });
    return this.get(eventId);
  }

  /** GET /results/:token (RES-04): only published results, only while the link is on. */
  async publicResults(token: string): Promise<PublicResults> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new AppError('NOT_FOUND');
    const bootstrap = { ...this.requestContext.getOrThrow(), orgId: null, isPlatformAdmin: false };
    const [found] = await this.prisma.withContext(
      bootstrap,
      (tx) =>
        tx.$queryRaw<{ event_id: string; organization_id: string }[]>`
        SELECT event_id, organization_id FROM app.resolve_results_token(${token})`,
    );
    if (!found) throw new AppError('NOT_FOUND');
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = found.organization_id;
    return this.prisma.withContext(this.context(), async (tx) => {
      const view = await this.publicView(tx, found.event_id);
      const event = await this.event(tx, found.event_id);
      if (!event.publicResultsEnabled) throw new AppError('NOT_FOUND');
      return view;
    });
  }

  /** GET /vote/results (VTR-WEB-08): the same view plus when the voter voted. */
  voterResults(eventId: string, voterId: string): Promise<VoterResults> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const view = await this.publicView(tx, eventId);
      const first = await tx.voterParticipation.findFirst({
        where: { voterId },
        orderBy: { votedAt: 'asc' },
        select: { votedAt: true },
      });
      return { ...view, votedAt: first?.votedAt.toISOString() ?? null };
    });
  }

  // -------------------------------------------------------------------------------------------

  private async publicView(tx: Tx, eventId: string): Promise<PublicResults> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      include: { organization: true },
    });
    const published =
      event &&
      (event.status === 'results_published' || (event.status === 'archived' && !event.cancelledAt));
    if (!event || !published) throw new AppError('NOT_FOUND');
    const snapshot = await tx.resultSnapshot.findFirst({
      where: { eventId, isCurrent: true, publishedAt: { not: null } },
      include: snapshotInclude,
    });
    if (!snapshot) throw new AppError('NOT_FOUND');
    const full = event.resultsVisibility === 'full';
    const view = toSnapshot(snapshot, (fileId) => signFileLink(this.secret, fileId, eventId));
    return {
      event: {
        name: event.name,
        organizationName: event.organization.name,
        logoUrl: event.organization.logoFileId ? `/api/v1/vote/events/${eventId}/logo` : null,
        primaryColor: event.organization.primaryColor,
        timeZone: event.organization.timeZone,
        closedAt: event.closedAt?.toISOString() ?? null,
        publishedAt: snapshot.publishedAt?.toISOString() ?? null,
      },
      visibility: event.resultsVisibility,
      version: snapshot.version,
      contentHash: snapshot.contentHash,
      turnout: full ? { registered: snapshot.registeredVoters, voted: snapshot.votersVoted } : null,
      categories: view.categories.map((category) => ({
        name: category.name,
        seats: category.seats,
        votersVoted: full ? category.votersVoted : null,
        quorumMet: category.quorumMet,
        tieNote: category.tie ? category.tie.reason : null,
        // Winners only: no counts and no other contesters.
        rows: category.rows
          .filter((row) => full || row.isWinner)
          .map((row) => ({
            name: row.name,
            party: row.party,
            photoUrl: row.photoUrl,
            choice: row.choice,
            votes: full ? row.votes : null,
            percent: full ? row.percent : null,
            isWinner: row.isWinner,
          })),
      })),
    };
  }

  private async event(tx: Tx, eventId: string) {
    const event = await tx.votingEvent.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event) throw new AppError('NOT_FOUND');
    return event;
  }

  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
