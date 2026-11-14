import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type PublicContactRequest, PublicContactRequestSchema } from '@vote-kidigit/shared';
import { Public } from '../../auth/decorators.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { QueueModule } from '../../queue/queue.module.js';
import { PublicService } from './public.service.js';

// The body is a union (contact | demo), which a class cannot extend; the pipe still validates it
// with the schema, so the handler receives a PublicContactRequest.
class ContactBody extends (zodDto(PublicContactRequestSchema) as unknown as new () => object) {}

/** Public website endpoints (Implementation Plan step 38). */
@Controller('v1/public')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  /**
   * POST /api/v1/public/contact — contact (PUB-04) and demo (PUB-05) forms. 202: the email goes
   * out from the worker. 5 a minute per address keeps the team mailbox from being flooded.
   */
  @Post('contact')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  contact(@Body() body: ContactBody): Promise<void> {
    return this.service.contact(body as PublicContactRequest);
  }
}

@Module({
  imports: [QueueModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
