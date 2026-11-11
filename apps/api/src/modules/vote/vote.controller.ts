// Voter API routes (Backend Schema 12.11). All are @Public() for the staff guards; after sign-in
// BallotTokenGuard checks the ballot token. Request bodies here are never logged.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  type ConfirmIdentityResponse,
  type NotMeResponse,
  SubmitBallotRequestSchema,
  type SubmitBallotResponse,
  type VoterBallot,
  type VoterEventCard,
  VoterSignInRequestSchema,
  type VoterSignInResponse,
  type VoterStatus,
} from '@vote-kidigit/shared';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorators.js';
import { AppError } from '../../common/app-error.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import type { Env } from '../../config/env.schema.js';
import type { OpenedFile } from '../files/files.service.js';
import { BallotTokenGuard, CurrentVoter, type VoterRequest } from './ballot-token.guard.js';
import { KIOSK_HEADER } from '../kiosk/kiosk-token.guard.js';
import { verifyFileLink } from './vote-links.js';
import { VoteService } from './vote.service.js';

class SignInBody extends zodDto(VoterSignInRequestSchema) {}
class SubmitBody extends zodDto(SubmitBallotRequestSchema) {}

function serve(res: Response, opened: OpenedFile, cache: string): StreamableFile {
  res.set({
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    ETag: `"${opened.file.sha256}"`,
  });
  return new StreamableFile(opened.stream, {
    type: opened.file.mimeType,
    length: opened.length,
    disposition: 'inline',
  });
}

@Controller('v1/vote')
export class VoteController {
  private readonly secret: string;

  constructor(
    private readonly vote: VoteService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('BALLOT_TOKEN_SECRET', { infer: true });
  }

  /** GET /api/v1/vote/events/:eventId — the sign-in page's event card. */
  @Get('events/:eventId')
  @Public()
  eventCard(@Param('eventId', IdParamPipe) eventId: string): Promise<VoterEventCard> {
    return this.vote.eventCard(eventId);
  }

  /** GET /api/v1/vote/events/:eventId/logo */
  @Get('events/:eventId/logo')
  @Public()
  async logo(
    @Param('eventId', IdParamPipe) eventId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return serve(res, await this.vote.eventLogo(eventId), 'public, max-age=3600');
  }

  /** GET /api/v1/vote/files/:fileId?e&x&s — a picture through a signed link. */
  @Get('files/:fileId')
  @Public()
  async file(
    @Param('fileId', IdParamPipe) fileId: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const eventId = verifyFileLink(this.secret, fileId, query);
    if (!eventId) throw new AppError('NOT_FOUND');
    return serve(res, await this.vote.openEventFile(fileId, eventId), 'private, max-age=3600');
  }

  /** POST /api/v1/vote/sign-in — rate-limited per IP on top of the attempt counter. */
  @Post('sign-in')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  signIn(@Body() body: SignInBody, @Req() req: Request): Promise<VoterSignInResponse> {
    const kioskToken = req.headers[KIOSK_HEADER];
    return this.vote.signIn(body, {
      ip: req.ip ?? null,
      kioskToken: typeof kioskToken === 'string' ? kioskToken : null,
    });
  }

  /** POST /api/v1/vote/confirm-identity — "Ndiyo, ni mimi". */
  @Post('confirm-identity')
  @HttpCode(200)
  @Public()
  @UseGuards(BallotTokenGuard)
  confirmIdentity(@CurrentVoter() voter: VoterRequest): Promise<ConfirmIdentityResponse> {
    return this.vote.confirmIdentity(voter.token, voter.session);
  }

  /** POST /api/v1/vote/not-me — "Si mimi". */
  @Post('not-me')
  @HttpCode(200)
  @Public()
  @UseGuards(BallotTokenGuard)
  notMe(@CurrentVoter() voter: VoterRequest): Promise<NotMeResponse> {
    return this.vote.notMe(voter.token, voter.session);
  }

  /** GET /api/v1/vote/status (VTR-WEB-07). */
  @Get('status')
  @Public()
  @UseGuards(BallotTokenGuard)
  status(@CurrentVoter() voter: VoterRequest): Promise<VoterStatus> {
    return this.vote.status(voter.session);
  }

  /** GET /api/v1/vote/ballot */
  @Get('ballot')
  @Public()
  @UseGuards(BallotTokenGuard)
  ballot(@CurrentVoter() voter: VoterRequest): Promise<VoterBallot> {
    return this.vote.ballot(voter.session);
  }

  /** POST /api/v1/vote/ballot — after the review screen. */
  @Post('ballot')
  @HttpCode(200)
  @Public()
  @UseGuards(BallotTokenGuard)
  submit(
    @CurrentVoter() voter: VoterRequest,
    @Body() body: SubmitBody,
  ): Promise<SubmitBallotResponse> {
    return this.vote.submit(voter.token, voter.session, body);
  }

  /** POST /api/v1/vote/finish — "Maliza". */
  @Post('finish')
  @HttpCode(204)
  @Public()
  @UseGuards(BallotTokenGuard)
  finish(@CurrentVoter() voter: VoterRequest): Promise<void> {
    return this.vote.finish(voter.token);
  }
}
