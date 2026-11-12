import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { EmailModule } from './mail/email.module.js';
import { ScheduleWorkerModule } from './modules/events/schedule-worker.module.js';
import { MessagesWorkerModule } from './modules/messages/messages-worker.module.js';
import { ReportsWorkerModule } from './modules/reports/reports-worker.module.js';
import { ImportsWorkerModule } from './modules/voters/imports-worker.module.js';

/** Worker entry (vk-worker): BullMQ processors and the 1-minute scheduler, no HTTP. */
@Module({
  imports: [
    AppModule,
    EmailModule,
    ImportsWorkerModule,
    ScheduleWorkerModule,
    MessagesWorkerModule,
    ReportsWorkerModule,
  ],
})
export class WorkerModule {}
