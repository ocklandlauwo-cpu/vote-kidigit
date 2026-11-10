import { Module } from '@nestjs/common';
import { EVENT_ACCESS, PrismaEventAccess } from '../../auth/event-access.js';
import { QueueModule } from '../../queue/queue.module.js';
import { FilesService } from '../files/files.service.js';
import { CodesService } from './codes.service.js';
import { ImportRunner } from './import-runner.js';
import { ImportsProcessor } from './imports.processor.js';

/**
 * Worker side of CSV imports: the processor that validates files and inserts voters. It provides
 * FilesService itself: FilesModule brings AuthModule (sessions, throttling), which the worker has
 * no use for.
 */
@Module({
  imports: [QueueModule],
  providers: [
    ImportsProcessor,
    ImportRunner,
    CodesService,
    FilesService,
    { provide: EVENT_ACCESS, useClass: PrismaEventAccess },
  ],
})
export class ImportsWorkerModule {}
