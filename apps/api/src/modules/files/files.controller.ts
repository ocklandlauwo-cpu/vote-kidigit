import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthState } from '../../auth/auth.types.js';
import { CurrentAuth, SignedIn } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { FilesService } from './files.service.js';

/** Uploaded files, served only after the organization and permission check (Backend Schema 7.6). */
@Controller('v1/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** GET /api/v1/files/:fileId — the permission depends on the file kind (FilesService.open). */
  @Get(':fileId')
  @SignedIn()
  async get(
    @CurrentAuth() auth: AuthState,
    @Param('fileId', IdParamPipe) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, length, stream } = await this.files.open(auth, fileId);
    // A file id never changes content, so browsers may keep it; private because it needs a session.
    res.set({
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${file.sha256}"`,
    });
    return new StreamableFile(stream, {
      type: file.mimeType,
      length,
      disposition: 'inline',
    });
  }
}
