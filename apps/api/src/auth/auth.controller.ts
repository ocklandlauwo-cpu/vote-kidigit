import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  type MeResponse,
  SESSION_EXPIRES_HEADER,
  UpdateMeRequestSchema,
} from '@vote-kidigit/shared';
import type { Request, Response } from 'express';
import { zodDto } from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import type { AuthState } from './auth.types.js';
import { CurrentAuth, Public, SignedIn, SkipCsrf } from './decorators.js';
import { SESSION_COOKIE } from './session.service.js';

class LoginBody extends zodDto(LoginRequestSchema) {}
class UpdateMeBody extends zodDto(UpdateMeRequestSchema) {}
class ChangePasswordBody extends zodDto(ChangePasswordRequestSchema) {}

/** Staff sign-in and sign-out (Backend Schema 12.2). */
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/v1/auth/login — 10 attempts per minute per IP (Backend Schema 12.1). */
  @Post('login')
  @HttpCode(200)
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const me = await this.auth.login(body, req);
    // Public route: AuthGuard did not run, so announce the expiry here.
    res.setHeader(SESSION_EXPIRES_HEADER, me.sessionExpiresAt);
    return me;
  }

  /** POST /api/v1/auth/logout */
  @Post('logout')
  @SignedIn()
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthState,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(auth, req);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}

/** The signed-in user's own profile (Backend Schema 12.2). */
@Controller('v1/me')
@SignedIn()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  /** GET /api/v1/me */
  @Get()
  me(@CurrentAuth() auth: AuthState, @Req() req: Request): MeResponse {
    return this.auth.toMe(auth, req);
  }

  /** PATCH /api/v1/me */
  @Patch()
  update(
    @CurrentAuth() auth: AuthState,
    @Body() body: UpdateMeBody,
    @Req() req: Request,
  ): Promise<MeResponse> {
    return this.auth.updateMe(auth, body, req);
  }

  /** POST /api/v1/me/password — 5 attempts per 15 minutes; wrong ones also count to the lockout. */
  @Post('password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  changePassword(
    @CurrentAuth() auth: AuthState,
    @Body() body: ChangePasswordBody,
    @Req() req: Request,
  ): Promise<void> {
    return this.auth.changePassword(auth, body, req);
  }
}
