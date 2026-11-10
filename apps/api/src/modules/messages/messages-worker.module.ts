import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { MailModule } from '../../mail/mail.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { CodesService } from '../voters/codes.service.js';
import { MessageContent } from './message-content.js';
import { MessageSender } from './message-sender.js';
import { BeemSmsAdapter, FakeSmsAdapter, SMS_GATEWAY } from './sms-gateway.js';
import { SmsProcessor } from './sms.processor.js';

/** Worker side of messages: the sender and the SMS provider chosen by SMS_DRIVER. */
@Module({
  imports: [QueueModule, MailModule],
  providers: [
    SmsProcessor,
    MessageSender,
    MessageContent,
    CodesService,
    FakeSmsAdapter,
    BeemSmsAdapter,
    {
      provide: SMS_GATEWAY,
      inject: [ConfigService, FakeSmsAdapter, BeemSmsAdapter],
      useFactory: (config: ConfigService<Env, true>, fake: FakeSmsAdapter, beem: BeemSmsAdapter) =>
        config.get('SMS_DRIVER', { infer: true }) === 'beem' ? beem : fake,
    },
  ],
})
export class MessagesWorkerModule {}
