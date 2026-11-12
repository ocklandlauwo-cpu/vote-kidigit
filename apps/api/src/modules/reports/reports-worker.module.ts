import { Module } from '@nestjs/common';
import { EVENT_ACCESS, PrismaEventAccess } from '../../auth/event-access.js';
import { QueueModule } from '../../queue/queue.module.js';
import { FilesService } from '../files/files.service.js';
import { PdfRenderer } from './pdf-renderer.js';
import { ReportRunner } from './report-runner.js';
import { ReportsProcessor } from './reports.processor.js';

/**
 * Worker side of reports: the processor, the runner and the one shared browser. Like the CSV
 * import worker it provides FilesService itself (FilesModule brings AuthModule).
 */
@Module({
  imports: [QueueModule],
  providers: [
    ReportsProcessor,
    ReportRunner,
    PdfRenderer,
    FilesService,
    { provide: EVENT_ACCESS, useClass: PrismaEventAccess },
  ],
})
export class ReportsWorkerModule {}
