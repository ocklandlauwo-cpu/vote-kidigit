import { Body, Controller, HttpCode, Module, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../auth/decorators.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { ResultsModule } from '../results/results.module.js';
import { VoteModule } from '../vote/vote.module.js';
import { USSD_ADAPTERS } from './ussd-adapters.js';
import { UssdEngine } from './ussd-engine.js';

/**
 * POST /api/ussd/{provider}/callback?secret=… (Backend Schema 8.5, 12.12): the aggregator calls
 * this on every screen. Checked by USSD_CALLBACK_SECRET and, when set, USSD_ALLOWED_IPS.
 * Public (no staff session) and not throttled per address, because all callers arrive from the
 * aggregator's few addresses; sign-in lockouts still count per caller and per voter. Bodies are
 * never logged (they hold membership IDs and codes).
 */
@Controller('ussd')
export class UssdController {
  private readonly secret: Buffer;
  private readonly allowedIps: string[];

  constructor(
    private readonly engine: UssdEngine,
    config: ConfigService<Env, true>,
  ) {
    this.secret = Buffer.from(config.get('USSD_CALLBACK_SECRET', { infer: true }));
    this.allowedIps = config.get('USSD_ALLOWED_IPS', { infer: true });
  }

  @Post(':provider/callback')
  @HttpCode(200)
  @Public()
  @SkipThrottle()
  async callback(
    @Param('provider') provider: string,
    @Query('secret') secret: unknown,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string | Record<string, unknown>> {
    const adapter = Object.hasOwn(USSD_ADAPTERS, provider) ? USSD_ADAPTERS[provider] : undefined;
    if (!adapter) throw new AppError('NOT_FOUND');
    const given = Buffer.from(typeof secret === 'string' ? secret : '');
    if (given.length !== this.secret.length || !timingSafeEqual(given, this.secret)) {
      throw new AppError('UNAUTHENTICATED');
    }
    if (this.allowedIps.length > 0 && !this.allowedIps.includes(req.ip ?? '')) {
      throw new AppError('FORBIDDEN');
    }
    const turn = adapter.parse(body);
    if (!turn) throw new AppError('VALIDATION_FAILED');
    if ('end' in turn) {
      await this.engine.drop(turn.end);
      const reply = adapter.reply(body, { text: '', end: true });
      res.type(reply.contentType);
      return reply.body;
    }
    const reply = adapter.reply(body, await this.engine.handle(turn));
    res.type(reply.contentType);
    return reply.body;
  }
}

@Module({
  imports: [VoteModule, ResultsModule],
  controllers: [UssdController],
  providers: [UssdEngine],
})
export class UssdModule {}
