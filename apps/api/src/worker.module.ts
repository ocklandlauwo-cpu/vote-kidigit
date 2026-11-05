import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { EmailModule } from './mail/email.module.js';

/** Worker entry (vk-worker): BullMQ processors and the 1-minute scheduler, no HTTP. */
@Module({
  imports: [AppModule, EmailModule],
})
export class WorkerModule {}
