import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module.js';
import { BatchesService } from '../messages/batches.service.js';
import { MessageContent } from '../messages/message-content.js';
import { ScheduleProcessor } from './schedule.processor.js';
import { SchedulerRunner } from './scheduler.js';

/** Worker side of the 1-minute scheduler: auto open, auto close of categories, reminders. */
@Module({
  imports: [QueueModule],
  providers: [ScheduleProcessor, SchedulerRunner, BatchesService, MessageContent],
})
export class ScheduleWorkerModule {}
