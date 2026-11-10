import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { EmailModule } from './mail/email.module.js';
import { ImportsWorkerModule } from './modules/voters/imports-worker.module.js';

/** Worker entry (vk-worker): BullMQ processors and the 1-minute scheduler, no HTTP. */
@Module({
  imports: [AppModule, EmailModule, ImportsWorkerModule],
})
export class WorkerModule {}
