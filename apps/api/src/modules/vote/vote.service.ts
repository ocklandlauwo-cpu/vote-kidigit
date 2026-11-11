// Voter API (Backend Schema 8.3, 8.4, 12.11; App Flow 8, 13.1). Voters have no staff session:
// sign-in finds the voter by membership ID and code through app.find_voter_by_credentials(),
// counts failed attempts (per voter in the database, per IP + membership ID in Redis) and hands
// out a ballot token. Everything after sign-in runs in the voter's organization as actor Voter.
// Never log codes, selections or request bodies here.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type BallotCategory,
  type ConfirmIdentityResponse,
  normalizeMembershipId,
  normalizeVotingCode,
  type NotMeResponse,
  type SubmitBallotRequest,
  type SubmitBallotResponse,
  VOTING_CODE_ALPHABET,
  VOTING_CODE_LENGTH,
  type VoterBallot,
  type VoterCategoryStatus,
  type VoterEventCard,
  type VoterEventState,
  type VoterSignInRequest,
  type VoterSignInResponse,
  type VoterStatus,
} from '@vote-kidigit/shared';
import { createHmac } from 'node:crypto';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { type DbContext, PrismaService, type Tx } from '../../database/prisma.service.js';
import type { EventStatus } from '../../generated/prisma/enums.js';
import { RedisService } from '../../redis/redis.service.js';
import { type OpenedFile, FilesService } from '../files/files.service.js';
import { BatchesService } from '../messages/batches.service.js';
import { CodesService } from '../voters/codes.service.js';
import { codeCheck, seededOrder, signFileLink } from './vote-links.js';
import type { BallotSession } from './vote-session.js';
import { VoteSessions } from './vote-session.js';

/** Backend Schema 8.3: 5 failures lock sign-in for 15 minutes. */
export const VOTER_MAX_ATTEMPTS = 5;
export const VOTER_LOCK_MINUTES = 15;
const FAIL_PREFIX = 'vfail:';
export const TURNOUT_PREFIX = 'turnout:';

interface SignInMeta {
  ip: string | null;
}

interface EventRow {
  id: string;
  name: string;
  status: EventStatus;
  startAt: Date;
  endAt: Date;
  cancelledAt: Date | null;
  showParty: boolean;
  organization: {
    name: string;
    logoFileId: string | null;
    primaryColor: string | null;
    timeZone: string;
    helpPhone: string | null;
    contactPhone: string | null;
  };
}

const eventSelect = {
  id: true,
  name: true,
  status: true,
  startAt: true,
  endAt: true,
  cancelledAt: true,
  showParty: true,
  organization: {
    select: {
      name: true,
      logoFileId: true,
      primaryColor: true,
      timeZone: true,
      helpPhone: true,
      contactPhone: true,
    },
  },
} as const;

/** Archived events show what they were before archiving (results or cancellation). */
function voterState(event: Pick<EventRow, 'status' | 'cancelledAt'>): VoterEventState {
  switch (event.status) {
    case 'scheduled':
    case 'open':
    case 'closed':
    case 'results_published':
    case 'cancelled':
      return event.status;
    case 'archived':
      return event.cancelledAt ? 'cancelled' : 'results_published';
    default:
      // Draft events are never resolved for voters.
      throw new AppError('NOT_FOUND');
  }
}

/** A typed code that cannot be a code (wrong length or letters) still costs an attempt. */
function plausibleCode(code: string): boolean {
  return (
    code.length === VOTING_CODE_LENGTH && [...code].every((c) => VOTING_CODE_ALPHABET.includes(c))
  );
}

@Injectable()
export class VoteService {
  private readonly logger = new Logger(VoteService.name);
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly codes: CodesService,
    private readonly sessions: VoteSessions,
    private readonly audit: AuditService,
    private readonly batches: BatchesService,
    private readonly files: FilesService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('BALLOT_TOKEN_SECRET', { infer: true });
  }

  // -------------------------------------------------------------------------------------------
  // Event card and sign-in
  // -------------------------------------------------------------------------------------------

  /** GET /vote/events/:eventId — the card on the sign-in page. */
  async eventCard(eventId: string): Promise<VoterEventCard> {
    const orgId = await this.resolveEvent(eventId);
    if (!orgId) throw new AppError('NOT_FOUND');
    this.enterOrganization(orgId);
    return this.prisma.withContext(this.context(), async (tx) =>
      this.card(await this.loadEvent(tx, eventId)),
    );
  }

  /** The organization logo of the sign-in card (public: the event card is public too). */
  async eventLogo(eventId: string): Promise<OpenedFile> {
    const orgId = await this.resolveEvent(eventId);
    if (!orgId) throw new AppError('NOT_FOUND');
    this.enterOrganization(orgId);
    const logoId = await this.prisma.withContext(this.context(), async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: orgId },
        select: { logoFileId: true },
      });
      return org?.logoFileId ?? null;
    });
    if (!logoId) throw new AppError('NOT_FOUND');
    return this.files.openWith(logoId, (_tx, file) => Promise.resolve(file.kind === 'logo'));
  }

  /** POST /vote/sign-in (Backend Schema 8.3). */
  async signIn(body: VoterSignInRequest, meta: SignInMeta): Promise<VoterSignInResponse> {
    const membership = normalizeMembershipId(body.membershipId);
    const code = normalizeVotingCode(body.code);
    // Redis counters: per IP + membership ID, and, without an event in the link, per membership
    // ID from any IP (changing IP must not reset it). With an event the voter row counts.
    const failKeys = [this.failKey(`ip:${body.eventId ?? 'any'}:${meta.ip ?? '-'}:${membership}`)];
    if (!body.eventId) failKeys.push(this.failKey(`member:any:${membership}`));
    for (const key of failKeys) {
      if (Number((await this.redis.get(key)) ?? 0) >= VOTER_MAX_ATTEMPTS) {
        throw this.locked(await this.lockEnd(key));
      }
    }

    let eventOrg: string | null = null;
    if (body.eventId) {
      eventOrg = await this.resolveEvent(body.eventId);
      if (!eventOrg) throw new AppError('NOT_FOUND');
      // Locked as a voter of this event?
      this.enterOrganization(eventOrg);
      const lockedUntil = await this.prisma.withContext(this.context(), async (tx) => {
        const voter = await tx.voter.findFirst({
          where: { eventId: body.eventId, membershipIdNormalized: membership, deletedAt: null },
          select: { lockedUntil: true },
        });
        return voter?.lockedUntil && voter.lockedUntil > new Date() ? voter.lockedUntil : null;
      });
      if (lockedUntil) throw this.locked(lockedUntil);
    }

    const matches = plausibleCode(code)
      ? await this.prisma.withContext(
          this.bootstrapContext(),
          (tx) =>
            tx.$queryRaw<{ voter_id: string; event_id: string; organization_id: string }[]>`
            SELECT voter_id, event_id, organization_id
            FROM app.find_voter_by_credentials(${membership}, ${this.codes.fingerprint(code)},
                                               ${body.eventId ?? null}::uuid)`,
        )
      : [];

    if (matches.length === 0) {
      return this.failSignIn(failKeys, body.eventId ?? null, eventOrg, membership);
    }
    if (matches.length > 1) {
      // Only possible without an event in the link (one membership ID per event).
      const events = [];
      for (const match of matches) {
        this.enterOrganization(match.organization_id);
        const event = await this.prisma.withContext(this.context(), (tx) =>
          this.loadEvent(tx, match.event_id),
        );
        events.push({ id: event.id, name: event.name, organizationName: event.organization.name });
      }
      throw new AppError('CHOOSE_EVENT', 'Choose the event to vote in.', { events });
    }

    const match = matches[0] as (typeof matches)[number];
    this.enterOrganization(match.organization_id);
    const result = await this.prisma.withContext(this.context(), async (tx) => {
      const voter = await tx.voter.findUniqueOrThrow({
        where: { id: match.voter_id },
        select: {
          id: true,
          fullName: true,
          membershipId: true,
          photoFileId: true,
          codeHmac: true,
          lockedUntil: true,
          failedAttempts: true,
        },
      });
      if (voter.lockedUntil && voter.lockedUntil > new Date()) return { locked: voter.lockedUntil };
      if (voter.failedAttempts > 0 || voter.lockedUntil) {
        await tx.voter.update({
          where: { id: voter.id },
          data: { failedAttempts: 0, lockedUntil: null },
        });
      }
      await this.audit.record(tx, {
        action: 'voter.sign_in',
        entityType: 'voters',
        entityId: voter.id,
        eventId: match.event_id,
      });
      return { voter, event: await this.loadEvent(tx, match.event_id) };
    });
    if (result.locked) throw this.locked(result.locked);

    await this.redis.del(...failKeys);
    const token = await this.sessions.create({
      codeCheck: codeCheck(result.voter.codeHmac),
      voterId: match.voter_id,
      eventId: match.event_id,
      orgId: match.organization_id,
      channel: 'web',
    });
    return {
      token,
      voter: {
        fullName: result.voter.fullName,
        membershipId: result.voter.membershipId,
        photoUrl: signFileLink(this.secret, result.voter.photoFileId, match.event_id),
      },
      event: this.card(result.event),
    };
  }

  /**
   * A failed sign-in: one more attempt for this IP + membership ID (Redis) and, when the event
   * is known, for that voter (database). The fifth locks sign-in for 15 minutes.
   */
  private async failSignIn(
    failKeys: string[],
    eventId: string | null,
    eventOrg: string | null,
    membership: string,
  ): Promise<never> {
    let count = 0;
    let lockKey = failKeys[0] ?? '';
    for (const key of failKeys) {
      const n = await this.redis.incr(key);
      if (n === 1 || n >= VOTER_MAX_ATTEMPTS) await this.redis.expire(key, VOTER_LOCK_MINUTES * 60);
      if (n > count) [count, lockKey] = [n, key];
    }
    let dbAttempts = 0;
    let lockedUntil: Date | null = null;
    if (eventId && eventOrg) {
      this.enterOrganization(eventOrg);
      const row = await this.prisma.withContext(this.context(), async (tx) => {
        const [updated] = await tx.$queryRaw<
          { id: string; failed_attempts: number; locked_until: Date | null }[]
        >`
          UPDATE public.voters
          SET failed_attempts = CASE WHEN locked_until IS NOT NULL AND locked_until <= now()
                                     THEN 1 ELSE failed_attempts + 1 END,
              locked_until = CASE
                WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now()
                           THEN 1 ELSE failed_attempts + 1 END) >= ${VOTER_MAX_ATTEMPTS}
                  THEN now() + make_interval(mins => ${VOTER_LOCK_MINUTES})
                WHEN locked_until <= now() THEN NULL
                ELSE locked_until END
          WHERE event_id = ${eventId}::uuid AND membership_id_normalized = ${membership}
            AND deleted_at IS NULL
          RETURNING id, failed_attempts, locked_until`;
        if (updated?.locked_until && updated.failed_attempts === VOTER_MAX_ATTEMPTS) {
          // Counted by the control room's lockout alert (step 26).
          await this.audit.record(tx, {
            action: 'voter.locked',
            entityType: 'voters',
            entityId: updated.id,
            eventId,
          });
        }
        return updated ?? null;
      });
      dbAttempts = row?.failed_attempts ?? 0;
      lockedUntil = row?.locked_until ?? null;
    }
    const used = Math.max(count, dbAttempts);
    if (used >= VOTER_MAX_ATTEMPTS) {
      throw this.locked(lockedUntil ?? (await this.lockEnd(lockKey)));
    }
    // Never says which of the two was wrong (App Flow 13.1).
    throw new AppError('INVALID_CREDENTIALS', 'Membership ID or code is incorrect.', {
      attemptsLeft: VOTER_MAX_ATTEMPTS - used,
    });
  }

  // -------------------------------------------------------------------------------------------
  // After sign-in (ballot token)
  // -------------------------------------------------------------------------------------------

  /** POST /vote/confirm-identity: "Ndiyo, ni mimi". */
  async confirmIdentity(token: string, session: BallotSession): Promise<ConfirmIdentityResponse> {
    await this.sessions.save(token, { ...session, identityConfirmed: true });
    const status = await this.status(session);
    return { next: status.canVote ? 'ballot' : 'status' };
  }

  /** POST /vote/not-me: "Si mimi" is logged and the session ends. */
  async notMe(token: string, session: BallotSession): Promise<NotMeResponse> {
    const contactPhone = await this.prisma.withContext(this.context(), async (tx) => {
      await this.audit.record(tx, {
        action: 'voter.identity.rejected',
        entityType: 'voters',
        entityId: session.voterId,
        eventId: session.eventId,
      });
      const event = await this.loadEvent(tx, session.eventId);
      return event.organization.contactPhone ?? event.organization.helpPhone;
    });
    await this.sessions.end(token);
    return { contactPhone };
  }

  /** POST /vote/finish: "Maliza". */
  async finish(token: string): Promise<void> {
    await this.sessions.end(token);
  }

  /** GET /vote/status (VTR-WEB-07, App Flow 8.3). */
  async status(session: BallotSession): Promise<VoterStatus> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.loadEvent(tx, session.eventId);
      const rows = await tx.$queryRaw<
        {
          id: string;
          name: string;
          opens_at: Date | null;
          closes_at: Date | null;
          voted_at: Date | null;
          votable: boolean;
          later: boolean;
        }[]
      >`
        SELECT c.id, c.name, c.opens_at, c.closes_at, p.voted_at,
               app.category_is_votable(c.id) AS votable,
               (c.closed_at IS NULL AND c.manual_state = 'auto' AND c.opens_at > now()) AS later
        FROM public.categories c
        LEFT JOIN public.voter_participation p
          ON p.category_id = c.id AND p.voter_id = ${session.voterId}::uuid
        WHERE c.event_id = ${session.eventId}::uuid AND c.is_active
          AND app.voter_is_eligible(${session.voterId}::uuid, c.id)
        ORDER BY c.display_order`;
      const state = voterState(event);
      const categories: VoterCategoryStatus[] = rows.map((row) => {
        let categoryState: VoterCategoryStatus['state'];
        if (row.voted_at) categoryState = 'voted';
        else if (state === 'scheduled') categoryState = 'opens_later';
        else if (state === 'open' && row.votable) categoryState = 'open';
        else if (state === 'open' && row.later) categoryState = 'opens_later';
        else categoryState = 'closed';
        const opensAt =
          categoryState === 'opens_later'
            ? row.opens_at && row.opens_at > event.startAt
              ? row.opens_at
              : event.startAt
            : row.opens_at;
        return {
          id: row.id,
          name: row.name,
          state: categoryState,
          votedAt: row.voted_at?.toISOString() ?? null,
          opensAt: opensAt?.toISOString() ?? null,
          closesAt: row.closes_at?.toISOString() ?? null,
        };
      });
      const voted = rows
        .map((row) => row.voted_at)
        .filter((at): at is Date => at !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      return {
        event: this.card(event),
        categories,
        canVote: categories.some((c) => c.state === 'open'),
        votedAt: voted[0]?.toISOString() ?? null,
      };
    });
  }

  /** GET /vote/ballot (Backend Schema 8.4): open, eligible, not-yet-voted categories. */
  async ballot(session: BallotSession): Promise<VoterBallot> {
    this.assertIdentity(session);
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.loadEvent(tx, session.eventId);
      if (event.status !== 'open') return { categories: [], showParty: event.showParty };
      const open = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM public.categories c
        WHERE c.event_id = ${session.eventId}::uuid AND c.is_active
          AND app.category_is_votable(c.id)
          AND app.voter_is_eligible(${session.voterId}::uuid, c.id)
          AND NOT EXISTS (SELECT 1 FROM public.voter_participation p
                          WHERE p.category_id = c.id AND p.voter_id = ${session.voterId}::uuid)`;
      const categories = await tx.category.findMany({
        where: { id: { in: open.map((row) => row.id) } },
        orderBy: { displayOrder: 'asc' },
        select: {
          id: true,
          name: true,
          pictureFileId: true,
          selectionMode: true,
          exactCount: true,
          minCount: true,
          maxCount: true,
          allowSkip: true,
          contesters: {
            where: { status: 'active' },
            select: { id: true, fullName: true, party: true, photoFileId: true },
          },
        },
      });
      return {
        showParty: event.showParty,
        categories: categories.map((c): BallotCategory => ({
          id: c.id,
          name: c.name,
          pictureUrl: signFileLink(this.secret, c.pictureFileId, session.eventId),
          rules: {
            selectionMode: c.selectionMode,
            exactCount: c.exactCount,
            minCount: c.minCount,
            maxCount: c.maxCount,
            allowSkip: c.allowSkip,
            yesNo: c.contesters.length === 1,
          },
          contesters: seededOrder(c.contesters, session.seed, c.id).map((k) => ({
            id: k.id,
            fullName: k.fullName,
            party: event.showParty ? k.party : null,
            photoUrl: signFileLink(this.secret, k.photoFileId, session.eventId),
          })),
        })),
      };
    });
  }

  /** POST /vote/ballot (Backend Schema 8.4): app.cast_ballot() re-checks everything. */
  async submit(
    token: string,
    session: BallotSession,
    body: SubmitBallotRequest,
  ): Promise<SubmitBallotResponse> {
    this.assertIdentity(session);
    const { result, names, firstVote } = await this.prisma.withContext(
      this.context(),
      async (tx) => {
        const before = await tx.voterParticipation.count({ where: { voterId: session.voterId } });
        const [row] = await tx.$queryRaw<{ result: CastResult }[]>`
          SELECT app.cast_ballot(${session.voterId}::uuid, ${session.eventId}::uuid,
                                 ${JSON.stringify(body.selections)}::jsonb,
                                 ${session.channel}::vote_channel) AS result`;
        if (!row) throw new Error('cast_ballot returned nothing');
        const ids = [
          ...row.result.recorded,
          ...row.result.rejected.map((r) => r.categoryId).filter((id) => typeof id === 'string'),
        ];
        const categories = await tx.category.findMany({
          where: { id: { in: ids }, eventId: session.eventId },
          select: { id: true, name: true },
        });
        return {
          result: row.result,
          names: new Map(categories.map((c) => [c.id, c.name])),
          firstVote: before === 0 && row.result.recorded.length > 0,
        };
      },
    );

    // The token is spent whatever was recorded (Backend Schema 8.3).
    await this.sessions.end(token);
    if (firstVote) await this.redis.incr(`${TURNOUT_PREFIX}${session.eventId}`);
    if (result.recorded.length > 0) {
      try {
        await this.batches.send({
          eventId: session.eventId,
          type: 'vote_confirmation',
          channel: 'sms',
          audience: 'single',
          voterId: session.voterId,
        });
      } catch (error: unknown) {
        // The vote is recorded; a missing confirmation SMS must not undo that answer.
        this.logger.warn({
          message: 'Vote confirmation not queued',
          errorCode: error instanceof AppError ? error.code : 'UNKNOWN',
        });
      }
    }
    return {
      recorded: result.recorded.map((id) => ({ categoryId: id, name: names.get(id) ?? '' })),
      rejected: result.rejected.map((r) => {
        const id = typeof r.categoryId === 'string' ? r.categoryId : null;
        return { categoryId: id, name: id ? (names.get(id) ?? null) : null, reason: r.reason };
      }),
      votedAt: new Date(result.votedAt).toISOString(),
    };
  }

  /** GET /vote/files/:fileId with a signed link: a picture of this event or its organization. */
  openEventFile(fileId: string, eventId: string): Promise<OpenedFile> {
    return this.resolveEvent(eventId).then((orgId) => {
      if (!orgId) throw new AppError('NOT_FOUND');
      this.enterOrganization(orgId);
      return this.files.openWith(fileId, async (tx: Tx, file) => {
        switch (file.kind) {
          case 'contester_photo':
            return (await tx.contester.count({ where: { photoFileId: file.id, eventId } })) > 0;
          case 'category_picture':
            return (await tx.category.count({ where: { pictureFileId: file.id, eventId } })) > 0;
          case 'voter_photo':
            return (await tx.voter.count({ where: { photoFileId: file.id, eventId } })) > 0;
          case 'logo':
            return (await tx.organization.count({ where: { logoFileId: file.id } })) > 0;
          default:
            return false;
        }
      });
    });
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private assertIdentity(session: BallotSession): void {
    if (!session.identityConfirmed) throw new AppError('FORBIDDEN');
  }

  private async resolveEvent(eventId: string): Promise<string | null> {
    const [row] = await this.prisma.withContext(
      this.bootstrapContext(),
      (tx) =>
        tx.$queryRaw<{ organization_id: string }[]>`
        SELECT organization_id FROM app.resolve_event(${eventId}::uuid)`,
    );
    return row?.organization_id ?? null;
  }

  private loadEvent(tx: Tx, eventId: string): Promise<EventRow> {
    return tx.votingEvent
      .findFirst({ where: { id: eventId, deletedAt: null }, select: eventSelect })
      .then((event) => {
        if (!event) throw new AppError('NOT_FOUND');
        return event;
      });
  }

  private card(event: EventRow): VoterEventCard {
    return {
      id: event.id,
      name: event.name,
      organizationName: event.organization.name,
      logoUrl: event.organization.logoFileId ? `/api/v1/vote/events/${event.id}/logo` : null,
      primaryColor: event.organization.primaryColor,
      timeZone: event.organization.timeZone,
      helpPhone: event.organization.helpPhone,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      state: voterState(event),
    };
  }

  /** Requests of voters act in the voter's organization, as actor Voter. */
  private enterOrganization(orgId: string): void {
    const ctx = this.requestContext.getOrThrow();
    ctx.orgId = orgId;
    ctx.actorType = 'voter';
    ctx.actorLabel = 'Voter';
  }

  private context(): DbContext {
    return this.requestContext.getOrThrow();
  }

  /** The bootstrap functions run before any organization is known. */
  private bootstrapContext(): DbContext {
    return { ...this.requestContext.getOrThrow(), orgId: null, isPlatformAdmin: false };
  }

  /** Redis keys hold an HMAC, never the membership ID or IP themselves. */
  private failKey(subject: string): string {
    return `${FAIL_PREFIX}${createHmac('sha256', this.secret).update(`fail:${subject}`).digest('hex')}`;
  }

  private async lockEnd(failKey: string): Promise<Date> {
    const ttl = await this.redis.ttl(failKey);
    return new Date(Date.now() + Math.max(ttl, 0) * 1000);
  }

  private locked(until: Date): AppError {
    return new AppError('VOTER_LOCKED', 'Too many attempts. Try again later.', {
      lockedUntil: until.toISOString(),
    });
  }
}

interface CastResult {
  recorded: string[];
  rejected: { categoryId: unknown; reason: SubmitBallotResponse['rejected'][number]['reason'] }[];
  votedAt: string;
}
