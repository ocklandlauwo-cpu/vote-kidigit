import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { describeConnection, prismaErrorReason } from '../common/connection-errors.js';
import type { Env } from '../config/env.schema.js';
import type { RequestContext } from '../context/request-context.js';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

/** The part of RequestContext that becomes transaction-local settings (Backend Schema 2.3). */
export type DbContext = Pick<RequestContext, 'orgId' | 'userId' | 'isPlatformAdmin' | 'requestId'>;

/** Transaction client handed to withContext callbacks; use it for every query in the callback. */
export type Tx = Prisma.TransactionClient;

export interface WithContextOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Maximum run time of the transaction in ms (Prisma default 5000). */
  timeout?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prisma client on the PostgreSQL driver adapter, connected as vk_api (DATABASE_URL), which
 * cannot bypass row level security. All application queries go through withContext.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly target: string;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('DATABASE_URL', { infer: true });
    super({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 5000 }) });
    this.target = describeConnection(url);
  }

  /** Fails fast at startup with a readable message when PostgreSQL is unreachable. */
  async onModuleInit(): Promise<void> {
    try {
      await this.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new Error(
        `Cannot connect to PostgreSQL at ${this.target}: ${prismaErrorReason(error)}`,
        { cause: error },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** True when a trivial query succeeds; used by the health endpoint. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Runs `fn` in one transaction whose first statement sets the request context as
   * transaction-local settings (set_config(..., true)): RLS policies see exactly this context,
   * and nothing outlives the transaction on the pooled connection (Backend Schema 1.3, 2.3).
   * Any error rolls the whole transaction back.
   */
  async withContext<T>(
    context: DbContext,
    fn: (tx: Tx) => Promise<T>,
    options: WithContextOptions = {},
  ): Promise<T> {
    assertUuidOrNull('orgId', context.orgId);
    assertUuidOrNull('userId', context.userId);

    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.org_id', ${context.orgId ?? ''}, true),
        set_config('app.user_id', ${context.userId ?? ''}, true),
        set_config('app.is_platform_admin', ${context.isPlatformAdmin ? 'true' : 'false'}, true),
        set_config('app.request_id', ${context.requestId}, true)`;
      return fn(tx);
    }, options);
  }
}

function assertUuidOrNull(name: string, value: string | null): void {
  if (value !== null && !UUID.test(value)) {
    throw new Error(`withContext: ${name} must be a UUID or null`);
  }
}
