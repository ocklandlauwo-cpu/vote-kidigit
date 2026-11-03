import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * GET /api/health — public; says only whether the process can serve (Backend Schema 12.12).
 * GET /api/health/live-events (deploy safety check) is added in step 8.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    const [database, redis] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy()]);
    if (!database || !redis) throw new ServiceUnavailableException({ status: 'unavailable' });
    return { status: 'ok' };
  }
}
