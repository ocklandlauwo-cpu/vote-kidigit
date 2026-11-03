import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { describeConnection, errorReason } from '../common/connection-errors.js';
import type { Env } from '../config/env.schema.js';

const CONNECT_TIMEOUT_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 2000;

/**
 * Shared ioredis client (REDIS_URL) for rate limits, live turnout counters and lockouts.
 * BullMQ creates its own connections in step 20.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly target: string;
  private readonly state: { started: boolean };
  /** Last connection error; connect() itself rejects with a generic "Connection is closed". */
  private lastError: unknown;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('REDIS_URL', { infer: true });
    // No retries until the first connection succeeds, so a bad URL fails fast and leaves no
    // reconnect timer behind; afterwards, reconnect with a capped backoff through Redis blips.
    const state = { started: false };
    super(url, {
      lazyConnect: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) =>
        state.started ? Math.min(attempt * 200, MAX_RECONNECT_DELAY_MS) : null,
    });
    this.state = state;
    this.target = describeConnection(url);
    this.on('error', (error: unknown) => {
      this.lastError = error;
      if (this.state.started) this.logger.warn(`Redis connection error: ${errorReason(error)}`);
    });
  }

  /** Fails fast at startup with a readable message when Redis is unreachable or rejects auth. */
  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
      await this.ping();
      this.state.started = true;
    } catch (error) {
      this.closeIfOpen();
      const reason = errorReason(this.lastError ?? error);
      throw new Error(`Cannot connect to Redis at ${this.target}: ${reason}`, { cause: error });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.state.started = false;
    if (this.status === 'ready') await this.quit();
    else this.closeIfOpen();
  }

  // ioredis's disconnect() arms a 2 s force-destroy timer that only the socket's close event
  // clears; on a connection that already ended that event never comes, so skip it.
  private closeIfOpen(): void {
    if (this.status !== 'end') this.disconnect();
  }

  /** True when PING succeeds; used by the health endpoint. */
  async isHealthy(): Promise<boolean> {
    try {
      return (await this.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
