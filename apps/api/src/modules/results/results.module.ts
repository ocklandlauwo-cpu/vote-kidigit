import { Body, Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type EventResults,
  PublicLinkRequestSchema,
  type PublicResults,
  PublishResultsRequestSchema,
  ResolveTieRequestSchema,
} from '@vote-kidigit/shared';
import { AuthModule } from '../../auth/auth.module.js';
import { Public, RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { MessagesModule } from '../messages/messages.module.js';
import { ResultsService } from './results.service.js';

class ResolveTieBody extends zodDto(ResolveTieRequestSchema) {}
class PublishBody extends zodDto(PublishResultsRequestSchema) {}
class PublicLinkBody extends zodDto(PublicLinkRequestSchema) {}

const EventId = () => Param('eventId', IdParamPipe);

/** Results of an event for staff (Backend Schema 12.10, RES-01 to RES-03). */
@Controller('v1/events/:eventId/results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  /** GET /api/v1/events/:eventId/results */
  @Get()
  @RequirePermission('results.view')
  get(@EventId() eventId: string): Promise<EventResults> {
    return this.results.get(eventId);
  }

  /** POST /api/v1/events/:eventId/results/ties */
  @Post('ties')
  @HttpCode(200)
  @RequirePermission('results.resolve_tie')
  resolveTie(@EventId() eventId: string, @Body() body: ResolveTieBody): Promise<EventResults> {
    return this.results.resolveTie(eventId, body);
  }

  /** POST /api/v1/events/:eventId/results/publish */
  @Post('publish')
  @HttpCode(200)
  @RequirePermission('results.publish')
  publish(@EventId() eventId: string, @Body() body: PublishBody): Promise<EventResults> {
    return this.results.publish(eventId, body);
  }

  /** POST /api/v1/events/:eventId/results/public-link */
  @Post('public-link')
  @HttpCode(200)
  @RequirePermission('results.publish')
  publicLink(@EventId() eventId: string, @Body() body: PublicLinkBody): Promise<EventResults> {
    return this.results.setPublicLink(eventId, body.enabled);
  }
}

/** GET /api/v1/results/:token (RES-04): the public results page, no session. */
@Controller('v1/results')
export class PublicResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get(':token')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(@Param('token') token: string): Promise<PublicResults> {
    return this.results.publicResults(token);
  }
}

@Module({
  imports: [AuthModule, MessagesModule],
  controllers: [ResultsController, PublicResultsController],
  providers: [ResultsService],
  exports: [ResultsService],
})
export class ResultsModule {}
