import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { QueueModule } from '../../queue/queue.module.js';
import { FilesModule } from '../files/files.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { CodesService } from './codes.service.js';
import { ImportRunner } from './import-runner.js';
import { ImportsService } from './imports.service.js';
import { VotersController } from './voters.controller.js';
import { VotersService } from './voters.service.js';

/** Voters, voting codes and CSV imports (EVT-05, EVT-06, Backend Schema 12.7). */
@Module({
  imports: [AuthModule, FilesModule, QueueModule, MessagesModule],
  controllers: [VotersController],
  providers: [VotersService, CodesService, ImportsService, ImportRunner],
  exports: [VotersService, CodesService],
})
export class VotersModule {}
