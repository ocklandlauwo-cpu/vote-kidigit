import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module.js';
import { ScheduleProcessor } from './schedule.processor.js';
import { SchedulerRunner } from './scheduler.js';

/** Worker side of the 1-minute scheduler (auto open of events, auto close of categories). */
@Module({
  imports: [QueueModule],
  providers: [ScheduleProcessor, SchedulerRunner],
})
export class ScheduleWorkerModule {}
