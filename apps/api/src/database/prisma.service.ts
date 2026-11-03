import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { describeConnection, prismaErrorReason } from '../common/connection-errors.js';
import type { Env } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma client on the PostgreSQL driver adapter, connected as vk_api (DATABASE_URL).
 * Step 6 adds withContext(ctx, fn), which every request will use to set the RLS context.
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
}
