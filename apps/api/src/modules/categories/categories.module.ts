import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { FilesModule } from '../files/files.module.js';
import { VotersModule } from '../voters/voters.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { ContestersService } from './contesters.service.js';

/** Categories, their rules, eligibility and contesters (EVT-04, Backend Schema 12.6). */
@Module({
  imports: [AuthModule, FilesModule, VotersModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, ContestersService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
