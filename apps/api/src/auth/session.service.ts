import {
  Injectable,
  type NestMiddleware,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisStore } from 'connect-redis';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import session from 'express-session';
import { createClient, type RedisClientType } from 'redis';
import { describeConnection, errorReason } from '../common/connection-errors.js';
import type { Env } from '../config/env.schema.js';
import { RedisService } from '../redis/redis.service.js';
import './auth.types.js';

export const SESSION_COOKIE = 'vk.sid';
export const SESSION_PREFIX = 'sess:';
/** Redis set of a user's session ids, to end them all (password reset, deactivation). */
const userSessionsKey = (userId: string) => `sess-user:${userId}`;

/**
 * Staff sessions (Backend Schema 8.1): express-session with connect-redis. The cookie is
 * HttpOnly, SameSite=Strict and Secure in production; the idle timeout is the organization's
 * session_timeout_minutes, refreshed on every request (rolling). connect-redis requires the
 * node-redis client; everything else in the API uses ioredis.
 */
@Injectable()
export class SessionService implements NestMiddleware, OnModuleInit, OnModuleDestroy {
  private readonly client: RedisClientType;
  private readonly handler: RequestHandler;
  private readonly store: RedisStore;
  private readonly target: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly redis: RedisService,
  ) {
    const url = config.get('REDIS_URL', { infer: true });
    const defaultMinutes = config.get('SESSION_IDLE_MINUTES', { infer: true });
    this.target = describeConnection(url);
    this.client = createClient({ url });
    this.client.on('error', () => undefined); // surfaced by onModuleInit and request failures
    this.store = new RedisStore({
      client: this.client,
      prefix: SESSION_PREFIX,
      ttl: (data) => (data.timeoutMinutes ?? defaultMinutes) * 60,
    });
    this.handler = session({
      name: SESSION_COOKIE,
      secret: config.get('SESSION_SECRET', { infer: true }),
      store: this.store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      unset: 'destroy',
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.get('NODE_ENV', { infer: true }) === 'production',
        path: '/',
        maxAge: defaultMinutes * 60_000,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      throw new Error(
        `Cannot connect to Redis (sessions) at ${this.target}: ${errorReason(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  use(req: Request, res: Response, next: NextFunction): void {
    void this.handler(req, res, next);
  }

  /** Records that `sessionId` belongs to `userId`, so all of a user's sessions can be ended. */
  async track(userId: string, sessionId: string, timeoutMinutes: number): Promise<void> {
    const key = userSessionsKey(userId);
    await this.redis
      .multi()
      .sadd(key, sessionId)
      .expire(key, timeoutMinutes * 60 * 2)
      .exec();
  }

  /** Ends every session of a user, optionally keeping one (the caller's own). */
  async destroyAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    const key = userSessionsKey(userId);
    const ids = (await this.redis.smembers(key)).filter((id) => id !== exceptSessionId);
    if (ids.length > 0) {
      await this.redis.del(...ids.map((id) => `${SESSION_PREFIX}${id}`));
      await this.redis.srem(key, ...ids);
    }
  }

  async untrack(userId: string, sessionId: string): Promise<void> {
    await this.redis.srem(userSessionsKey(userId), sessionId);
  }
}
