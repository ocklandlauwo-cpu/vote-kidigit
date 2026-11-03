import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';

/** Worker entry (vk-worker): BullMQ processors and the 1-minute scheduler, no HTTP. */
@Module({
  imports: [AppModule],
})
export class WorkerModule {}
