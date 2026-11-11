// Ballot tokens (Backend Schema 8.3): 32 random bytes, base64url, sent as Authorization: Bearer
// and kept only in Redis, with an idle expiry. The Redis key is an HMAC of the token, so a copy of
// Redis does not hold usable tokens.
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';
import type { VoteChannel } from '../../generated/prisma/enums.js';
import { RedisService } from '../../redis/redis.service.js';

export interface BallotSession {
  voterId: string;
  eventId: string;
  orgId: string;
  channel: VoteChannel;
  /** Seeds this voter's contester order, so a refresh keeps it. */
  seed: string;
  /** Set by "Ndiyo, ni mimi"; the ballot needs it. */
  identityConfirmed: boolean;
  /** codeCheck() of the voter's code at sign-in; the guard compares it on every request. */
  codeCheck: string;
}

export const BALLOT_PREFIX = 'ballot:';

@Injectable()
export class VoteSessions {
  private readonly secret: string;
  private readonly idleSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('BALLOT_TOKEN_SECRET', { infer: true });
    this.idleSeconds = config.get('VOTER_IDLE_MINUTES', { infer: true }) * 60;
  }

  private key(token: string): string {
    return `${BALLOT_PREFIX}${createHmac('sha256', this.secret).update(`token:${token}`).digest('hex')}`;
  }

  async create(session: Omit<BallotSession, 'seed' | 'identityConfirmed'>): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const full: BallotSession = {
      ...session,
      seed: randomBytes(16).toString('hex'),
      identityConfirmed: false,
    };
    await this.redis.set(this.key(token), JSON.stringify(full), 'EX', this.idleSeconds);
    return token;
  }

  /** The session, with its idle timer restarted; null when unknown or expired. */
  async get(token: string): Promise<BallotSession | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const key = this.key(token);
    const raw = await this.redis.getex(key, 'EX', this.idleSeconds);
    return raw ? (JSON.parse(raw) as BallotSession) : null;
  }

  async save(token: string, session: BallotSession): Promise<void> {
    await this.redis.set(this.key(token), JSON.stringify(session), 'EX', this.idleSeconds, 'XX');
  }

  async end(token: string): Promise<void> {
    await this.redis.del(this.key(token));
  }
}
