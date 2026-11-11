// Kiosk routes (Backend Schema 12.9): staff launch, list and end kiosks for an event; the device
// itself (X-Kiosk-Token, no staff session) reads its session, beats, exits with the PIN and sends
// voters their codes.
import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  KioskExitRequestSchema,
  type KioskDeviceSession,
  KioskSendCodeRequestSchema,
  type KioskSendCodeResponse,
  type KioskSessionList,
  LaunchKioskRequestSchema,
  type LaunchKioskResponse,
} from '@vote-kidigit/shared';
import type { Request, Response } from 'express';
import { AuthService } from '../../auth/auth.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, Public, RequirePermission } from '../../auth/decorators.js';
import { SESSION_COOKIE } from '../../auth/session.service.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { KioskDeviceService } from './kiosk-device.service.js';
import { CurrentKiosk, type KioskDevice, KioskTokenGuard } from './kiosk-token.guard.js';
import { KioskService } from './kiosk.service.js';

class LaunchBody extends zodDto(LaunchKioskRequestSchema) {}
class ExitBody extends zodDto(KioskExitRequestSchema) {}
class SendCodeBody extends zodDto(KioskSendCodeRequestSchema) {}

const EventId = () => Param('eventId', IdParamPipe);

@Controller('v1/events/:eventId/kiosk-sessions')
export class KioskController {
  constructor(
    private readonly kiosks: KioskService,
    private readonly auth: AuthService,
  ) {}

  /**
   * POST /api/v1/events/:eventId/kiosk-sessions (KSK-00). The device is handed to voters, so
   * the staff session that launched it ends in the same request; if that fails, the new kiosk is
   * ended too (fail closed) and the error returned.
   */
  @Post()
  @RequirePermission('kiosk.operate')
  async launch(
    @CurrentAuth() auth: AuthState,
    @EventId() eventId: string,
    @Body() body: LaunchBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LaunchKioskResponse> {
    const launched = await this.kiosks.launch(eventId, body);
    try {
      await this.auth.logout(auth, req);
    } catch (error) {
      await this.kiosks.end(eventId, launched.id);
      throw error;
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return launched;
  }

  /** GET /api/v1/events/:eventId/kiosk-sessions */
  @Get()
  @RequirePermission('kiosk.operate')
  list(@EventId() eventId: string): Promise<KioskSessionList> {
    return this.kiosks.list(eventId);
  }

  /** POST /api/v1/events/:eventId/kiosk-sessions/:sessionId/end */
  @Post(':sessionId/end')
  @HttpCode(204)
  @RequirePermission('kiosk.operate')
  end(
    @EventId() eventId: string,
    @Param('sessionId', IdParamPipe) sessionId: string,
  ): Promise<void> {
    return this.kiosks.end(eventId, sessionId);
  }
}

@Controller('v1/vote/kiosk')
export class KioskDeviceController {
  constructor(private readonly device: KioskDeviceService) {}

  /** GET /api/v1/vote/kiosk/session (KSK-01) */
  @Get('session')
  @Public()
  @UseGuards(KioskTokenGuard)
  session(@CurrentKiosk() kiosk: KioskDevice): Promise<KioskDeviceSession> {
    return this.device.session(kiosk);
  }

  /** POST /api/v1/vote/kiosk/heartbeat */
  @Post('heartbeat')
  @HttpCode(204)
  @Public()
  @UseGuards(KioskTokenGuard)
  heartbeat(@CurrentKiosk() kiosk: KioskDevice): Promise<void> {
    return this.device.heartbeat(kiosk);
  }

  /** POST /api/v1/vote/kiosk/exit — the staff PIN; 3 wrong lock it for 5 minutes. */
  @Post('exit')
  @HttpCode(204)
  @Public()
  @UseGuards(KioskTokenGuard)
  exit(@CurrentKiosk() kiosk: KioskDevice, @Body() body: ExitBody): Promise<void> {
    return this.device.exit(kiosk, body.pin);
  }

  /** POST /api/v1/vote/kiosk/send-code (KSK-02, KSK-03a) */
  @Post('send-code')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(KioskTokenGuard)
  sendCode(
    @CurrentKiosk() kiosk: KioskDevice,
    @Body() body: SendCodeBody,
  ): Promise<KioskSendCodeResponse> {
    return this.device.sendCode(kiosk, body);
  }
}
