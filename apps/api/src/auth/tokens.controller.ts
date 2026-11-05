import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AcceptInviteRequestSchema,
  ForgotPasswordRequestSchema,
  type MeResponse,
  ResetPasswordRequestSchema,
  SESSION_EXPIRES_HEADER,
  type TokenInfoResponse,
} from '@vote-kidigit/shared';
import type { Request, Response } from 'express';
import { zodDto } from '../common/zod-validation.pipe.js';
import { Public, SkipCsrf } from './decorators.js';
import { TokensService } from './tokens.service.js';

class ForgotPasswordBody extends zodDto(ForgotPasswordRequestSchema) {}
class AcceptInviteBody extends zodDto(AcceptInviteRequestSchema) {}
class ResetPasswordBody extends zodDto(ResetPasswordRequestSchema) {}

/**
 * Invitation and password-reset links (Backend Schema 8.2, 12.2). All public and sign-in-like
 * (no session yet, so no CSRF token), 10 requests per minute per IP.
 */
@Controller('v1/auth')
@Public()
@SkipCsrf()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  /** POST /api/v1/auth/forgot — always 202, whether or not the email has an account. */
  @Post('forgot')
  @HttpCode(202)
  forgot(@Body() body: ForgotPasswordBody): Promise<void> {
    return this.tokens.forgot(body);
  }

  /** GET /api/v1/auth/tokens/:token */
  @Get('tokens/:token')
  info(@Param('token') token: string): Promise<TokenInfoResponse> {
    return this.tokens.info(token);
  }

  /** POST /api/v1/auth/invite/accept — signs the new user in. */
  @Post('invite/accept')
  @HttpCode(200)
  async acceptInvite(
    @Body() body: AcceptInviteBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const me = await this.tokens.acceptInvite(body, req);
    res.setHeader(SESSION_EXPIRES_HEADER, me.sessionExpiresAt);
    return me;
  }

  /** POST /api/v1/auth/reset */
  @Post('reset')
  @HttpCode(204)
  reset(@Body() body: ResetPasswordBody): Promise<void> {
    return this.tokens.reset(body);
  }
}
