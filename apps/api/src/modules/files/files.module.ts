import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../../auth/auth.module.js';
import type { Env } from '../../config/env.schema.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

/**
 * Uploads and file serving. Modules with upload endpoints import this one: it also exports the
 * Multer settings (memory storage, one file of at most MAX_UPLOAD_MB; larger is 413
 * FILE_TOO_LARGE before the whole body is read).
 */
@Module({
  imports: [
    AuthModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: {
          fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024,
          files: 1,
          fields: 5,
        },
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService, MulterModule],
})
export class FilesModule {}
