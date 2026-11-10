import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { BatchesService } from './batches.service.js';
import { DeliveryReports } from './delivery-reports.js';
import { MessageContent } from './message-content.js';
import { BeemWebhookController, MessagesController } from './messages.controller.js';
import { TemplatesService } from './templates.service.js';

/** Messages to voters, API side: templates, batches and delivery reports (EVT-07). */
@Module({
  imports: [AuthModule, QueueModule],
  controllers: [MessagesController, BeemWebhookController],
  providers: [TemplatesService, BatchesService, MessageContent, DeliveryReports],
  exports: [BatchesService],
})
export class MessagesModule {}
