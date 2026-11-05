import { Module } from '@nestjs/common';
import { UserTokensService } from '../auth/user-tokens.service.js';
import { QueueModule } from '../queue/queue.module.js';
import { EmailProcessor } from './email.processor.js';
import { MailModule } from './mail.module.js';

/** Worker side of the email queue: the processor that creates link tokens and sends mail. */
@Module({
  imports: [QueueModule, MailModule],
  providers: [EmailProcessor, UserTokensService],
})
export class EmailModule {}
