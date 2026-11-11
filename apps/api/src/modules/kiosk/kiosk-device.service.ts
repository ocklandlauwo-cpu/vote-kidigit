// The kiosk device (App Flow 10, Backend Schema 8.3, 12.9): its welcome card, the heartbeat, exit
// with the staff PIN (3 wrong lock exit for 5 minutes), and sending a voter's existing code by
// SMS: to the voter's phone, at most twice and 60 seconds apart, or once to someone else's phone
// approved by the staff PIN (3 voters per number per event). A voter who already voted in
// everything open gets no code. Unknown membership IDs count against the device.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type KioskDeviceSession,
  type KioskSendCodeRequest,
  type KioskSendCodeResponse,
  normalizeMembershipId,
  normalizePhone,
} from '@vote-kidigit/shared';
import { createHmac } from 'node:crypto';
import { AuditService } from '../../audit/audit.service.js';
import { verifyPassword } from '../../auth/passwords.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { BatchesService } from '../messages/batches.service.js';
import { VoteService } from '../vote/vote.service.js';
import type { KioskDevice } from './kiosk-token.guard.js';

/** App Flow 10.1: three wrong PINs lock exit (and approvals) for 5 minutes. */
const PIN_MAX_FAILURES = 3;
const PIN_LOCK_SECONDS = 5 * 60;
/** App Flow 10.3: a second send after 60 seconds, then "see the officer". */
const MAX_SENDS = 2;
const RESEND_AFTER_MS = 60_000;
/** Unknown membership IDs: 5 per device, then 15 minutes (as for sign-in). */
const UNKNOWN_MAX = 5;
const UNKNOWN_LOCK_SECONDS = 15 * 60;

@Injectable()
export class KioskDeviceService {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly batches: BatchesService,
    private readonly vote: VoteService,
    private readonly requestContext: RequestContextService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('BALLOT_TOKEN_SECRET', { infer: true });
  }

  /** GET /vote/kiosk/session (KSK-01). */
  async session(kiosk: KioskDevice): Promise<KioskDeviceSession> {
    const deviceLabel = await this.prisma.withContext(this.context(), async (tx) => {
      const row = await tx.kioskSession.findUniqueOrThrow({
        where: { id: kiosk.sessionId },
        select: { deviceLabel: true },
      });
      return row.deviceLabel;
    });
    return { deviceLabel, event: await this.vote.eventCard(kiosk.eventId) };
  }

  /** POST /vote/kiosk/heartbeat: every 60 s, so the control room sees the device alive. */
  heartbeat(kiosk: KioskDevice): Promise<void> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await tx.kioskSession.update({
        where: { id: kiosk.sessionId },
        data: { lastSeenAt: new Date() },
      });
    });
  }

  /** POST /vote/kiosk/exit: the staff PIN ends the session on the device. */
  async exit(kiosk: KioskDevice, pin: string): Promise<void> {
    await this.checkPin(kiosk, pin);
    await this.prisma.withContext(this.context(), async (tx) => {
      await tx.kioskSession.update({
        where: { id: kiosk.sessionId },
        data: { endedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'kiosk.exit',
        entityType: 'kiosk_sessions',
        entityId: kiosk.sessionId,
        eventId: kiosk.eventId,
      });
    });
  }

  /** POST /vote/kiosk/send-code (KSK-02, KSK-03, KSK-03a). */
  async sendCode(kiosk: KioskDevice, body: KioskSendCodeRequest): Promise<KioskSendCodeResponse> {
    const unknownKey = `kioskfail:${kiosk.sessionId}`;
    if (Number((await this.redis.get(unknownKey)) ?? 0) >= UNKNOWN_MAX) {
      const ttl = await this.redis.ttl(unknownKey);
      throw new AppError('VOTER_LOCKED', 'Too many unknown numbers on this device.', {
        lockedUntil: new Date(Date.now() + Math.max(ttl, 0) * 1000).toISOString(),
      });
    }

    const found = await this.prisma.withContext(this.context(), (tx) =>
      this.findVoter(tx, kiosk.eventId, body.membershipId),
    );
    if (found.eventStatus !== 'open') throw new AppError('VOTING_CLOSED');
    if (!found.voter) {
      const count = await this.redis.incr(unknownKey);
      if (count === 1 || count >= UNKNOWN_MAX) {
        await this.redis.expire(unknownKey, UNKNOWN_LOCK_SECONDS);
      }
      // "Namba hii haipo kwenye orodha ya wapiga kura" (App Flow 10.3).
      throw new AppError('NOT_FOUND', 'This number is not on the voter list.', {
        attemptsLeft: Math.max(UNKNOWN_MAX - count, 0),
      });
    }
    const voter = found.voter;
    if (found.votedAt && !found.canVote) {
      return { state: 'voted', votedAt: found.votedAt.toISOString() };
    }

    let toAddress = voter.phone;
    let alternate: { hmac: Uint8Array<ArrayBuffer>; last3: string } | null = null;
    if (body.alternatePhone) {
      await this.checkPin(kiosk, body.staffPin ?? '');
      const phone = normalizePhone(body.alternatePhone);
      if (!phone) {
        throw new AppError('VALIDATION_FAILED', 'Enter a Tanzanian mobile number.', {
          source: 'body',
          issues: [{ path: 'alternatePhone', code: 'invalid_phone', message: 'invalid' }],
        });
      }
      const altKey = `kioskalt:${kiosk.sessionId}:${voter.id}`;
      if (!(await this.redis.set(altKey, '1', 'EX', 24 * 3600, 'NX'))) {
        throw new AppError('RATE_LIMITED', 'The other phone was used already.', {
          reason: 'SEE_OFFICER',
        });
      }
      toAddress = phone;
      alternate = {
        hmac: new Uint8Array(createHmac('sha256', this.secret).update(`phone:${phone}`).digest()),
        last3: phone.slice(-3),
      };
    } else {
      await this.claimSend(kiosk.sessionId, voter.id);
    }

    // One transaction: the message row, then the code-send row that points at it. The limit
    // trigger (ALT_PHONE_LIMIT) rolls both back, so nothing is queued or sent.
    let created: { batchId: string; messageIds: string[] } | null;
    try {
      created = await this.prisma.withContext(this.context(), async (tx) => {
        const batch = await this.batches.create(tx, {
          eventId: kiosk.eventId,
          type: 'code_delivery',
          channel: 'sms',
          audience: 'single',
          voterId: voter.id,
          toAddress,
        });
        await tx.kioskCodeSend.create({
          data: {
            organizationId: kiosk.orgId,
            eventId: kiosk.eventId,
            kioskSessionId: kiosk.sessionId,
            voterId: voter.id,
            usedAlternatePhone: alternate !== null,
            alternatePhoneHmac: alternate?.hmac ?? null,
            alternatePhoneLast3: alternate?.last3 ?? null,
            smsMessageId: batch?.messageIds[0] ?? null,
          },
        });
        await this.audit.record(tx, {
          action: alternate ? 'kiosk.code_sent_other_phone' : 'kiosk.code_sent',
          entityType: 'voters',
          entityId: voter.id,
          eventId: kiosk.eventId,
          after: {
            kioskSessionId: kiosk.sessionId,
            ...(alternate && { phone: `••••••••••${alternate.last3}`, approvedBy: 'staff PIN' }),
          },
        });
        return batch;
      });
    } catch (error) {
      // A refused other phone may be replaced by another number.
      if (alternate) await this.redis.del(`kioskalt:${kiosk.sessionId}:${voter.id}`);
      throw error;
    }
    if (created) await this.batches.enqueue(created.messageIds);
    const used = Number(
      (await this.redis.hget(this.sendKey(kiosk.sessionId, voter.id), 'count')) ?? 0,
    );
    return {
      state: 'sent',
      phoneLast3: toAddress.slice(-3),
      sendsLeft: alternate ? 0 : Math.max(MAX_SENDS - used, 0),
    };
  }

  // -------------------------------------------------------------------------------------------

  private async findVoter(tx: Tx, eventId: string, membershipId: string) {
    const event = await tx.votingEvent.findFirstOrThrow({
      where: { id: eventId },
      select: { status: true },
    });
    const voter = await tx.voter.findFirst({
      where: {
        eventId,
        membershipIdNormalized: normalizeMembershipId(membershipId),
        deletedAt: null,
      },
      select: { id: true, phone: true },
    });
    if (!voter) return { eventStatus: event.status, voter: null, votedAt: null, canVote: false };
    const [row] = await tx.$queryRaw<{ voted_at: Date | null; can_vote: boolean }[]>`
      SELECT (SELECT min(voted_at) FROM public.voter_participation WHERE voter_id = ${voter.id}::uuid) AS voted_at,
             EXISTS (SELECT 1 FROM public.categories c
                     WHERE c.event_id = ${eventId}::uuid AND c.is_active
                       AND app.category_is_votable(c.id)
                       AND app.voter_is_eligible(${voter.id}::uuid, c.id)
                       AND NOT EXISTS (SELECT 1 FROM public.voter_participation p
                                       WHERE p.category_id = c.id AND p.voter_id = ${voter.id}::uuid)) AS can_vote`;
    return {
      eventStatus: event.status,
      voter,
      votedAt: row?.voted_at ?? null,
      canVote: row?.can_vote ?? false,
    };
  }

  private sendKey(sessionId: string, voterId: string): string {
    return `kiosksend:${sessionId}:${voterId}`;
  }

  /** At most two sends to the voter's phone per device, the second after 60 seconds. */
  private async claimSend(sessionId: string, voterId: string): Promise<void> {
    const key = this.sendKey(sessionId, voterId);
    const [count, last] = await this.redis.hmget(key, 'count', 'last');
    const sent = Number(count ?? 0);
    if (sent >= MAX_SENDS) {
      // "Tafadhali muone msimamizi wa uchaguzi".
      throw new AppError('RATE_LIMITED', 'See the election officer.', { reason: 'SEE_OFFICER' });
    }
    const wait = Number(last ?? 0) + RESEND_AFTER_MS - Date.now();
    if (sent > 0 && wait > 0) {
      throw new AppError('RATE_LIMITED', 'Wait before sending again.', {
        reason: 'WAIT',
        retryAfterSeconds: Math.ceil(wait / 1000),
      });
    }
    await this.redis.hset(key, 'count', String(sent + 1), 'last', String(Date.now()));
    await this.redis.expire(key, 24 * 3600);
  }

  /** The staff PIN of this kiosk; 3 wrong lock it for 5 minutes. */
  private async checkPin(kiosk: KioskDevice, pin: string): Promise<void> {
    const key = `kioskpin:${kiosk.sessionId}`;
    if (Number((await this.redis.get(key)) ?? 0) >= PIN_MAX_FAILURES) {
      const ttl = await this.redis.ttl(key);
      throw new AppError('KIOSK_PIN_INVALID', 'Too many wrong PINs.', {
        lockedUntil: new Date(Date.now() + Math.max(ttl, 0) * 1000).toISOString(),
      });
    }
    const pinHash = await this.prisma.withContext(this.context(), async (tx) => {
      const row = await tx.kioskSession.findUniqueOrThrow({
        where: { id: kiosk.sessionId },
        select: { pinHash: true },
      });
      return row.pinHash;
    });
    if (/^\d{4,6}$/.test(pin) && (await verifyPassword(pinHash, pin))) {
      await this.redis.del(key);
      return;
    }
    const failures = await this.redis.incr(key);
    if (failures === 1 || failures >= PIN_MAX_FAILURES) {
      await this.redis.expire(key, PIN_LOCK_SECONDS);
    }
    throw new AppError('KIOSK_PIN_INVALID', 'The staff PIN is incorrect.', {
      attemptsLeft: Math.max(PIN_MAX_FAILURES - failures, 0),
    });
  }

  private context() {
    return this.requestContext.getOrThrow();
  }
}
