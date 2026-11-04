import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequestContextService } from '../context/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { DeploySecretGuard } from './deploy-secret.guard.js';

/** Health endpoints (Backend Schema 12.12). Never rate limited: probes and deploys call them. */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /api/health — public; says only whether the process can serve. */
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ status: string }> {
    const [database, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);
    if (database && redis) return { status: 'ok' };
    res.status(503);
    return { status: 'unavailable' };
  }

  /**
   * GET /api/health/live-events — deploy safety check (Tech Stack 9.7): the number of Open
   * events across all organizations; deploys abort when it is above 0. Requires the
   * X-Deploy-Secret header. Counts as a platform-wide read, which RLS allows for events.
   */
  @Get('live-events')
  @UseGuards(DeploySecretGuard)
  async liveEvents(): Promise<{ openEvents: number }> {
    const { requestId } = this.requestContext.getOrThrow();
    const context = { orgId: null, userId: null, isPlatformAdmin: true, requestId };
    const openEvents = await this.prisma.withContext(context, async (tx) => {
      // voting_events arrives in step 15; until then there can be no open event.
      const [table] = await tx.$queryRaw<{ exists: boolean }[]>`
        SELECT to_regclass('public.voting_events') IS NOT NULL AS exists`;
      if (!table?.exists) return 0;
      const [row] = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM public.voting_events WHERE status = 'open'`;
      return Number(row?.n ?? 0);
    });
    return { openEvents };
  }
}
