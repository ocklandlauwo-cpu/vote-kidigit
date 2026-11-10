import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  BulkVotersRequestSchema,
  type BulkVotersResponse,
  type CreateImportResponse,
  CreateVoterRequestSchema,
  ImportQuerySchema,
  UpdateVoterRequestSchema,
  UPLOAD_FIELD,
  type VoterDetail,
  type VoterImport,
  VoterListQuerySchema,
  type VoterPage,
} from '@vote-kidigit/shared';
import { RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import type { Upload } from '../files/files.service.js';
import { voterCsvTemplate } from './csv-validation.js';
import { ImportsService } from './imports.service.js';
import { VotersService } from './voters.service.js';

class VoterListQuery extends zodDto(VoterListQuerySchema) {}
class CreateVoterBody extends zodDto(CreateVoterRequestSchema) {}
class UpdateVoterBody extends zodDto(UpdateVoterRequestSchema) {}
class BulkVotersBody extends zodDto(BulkVotersRequestSchema) {}
class ImportQuery extends zodDto(ImportQuerySchema) {}

const EventId = () => Param('eventId', IdParamPipe);
const VoterId = () => Param('voterId', IdParamPipe);
const ImportId = () => Param('importId', IdParamPipe);

/** A UTF-8 byte order mark, so spreadsheet programs read Swahili and other names correctly. */
const BOM = '\uFEFF';

/**
 * The multipart limit for CSV files is generous; ImportsService applies MAX_CSV_MB (it is
 * configuration, which a decorator cannot read).
 */
const CSV_UPLOAD_LIMIT = 50 * 1024 * 1024;

/** Voters, codes and CSV imports of an event (Backend Schema 12.7, EVT-05, EVT-06). */
@Controller('v1/events/:eventId')
export class VotersController {
  constructor(
    private readonly voters: VotersService,
    private readonly imports: ImportsService,
  ) {}

  /** GET /api/v1/events/:eventId/voters */
  @Get('voters')
  @RequirePermission('voter.view')
  list(@EventId() eventId: string, @Query() query: VoterListQuery): Promise<VoterPage> {
    return this.voters.list(eventId, query);
  }

  /** POST /api/v1/events/:eventId/voters */
  @Post('voters')
  @RequirePermission('voter.manage')
  create(@EventId() eventId: string, @Body() body: CreateVoterBody): Promise<VoterDetail> {
    return this.voters.create(eventId, body);
  }

  /** GET /api/v1/events/:eventId/voters/template.csv (declared before :voterId). */
  @Get('voters/template.csv')
  @RequirePermission('voter.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="wapiga-kura.csv"')
  // The guard reads :eventId for the event check; the template is the same for every event.
  template(): string {
    return `${BOM}${voterCsvTemplate()}\r\n`;
  }

  /** POST /api/v1/events/:eventId/voters/bulk */
  @Post('voters/bulk')
  @HttpCode(200)
  @RequirePermission('voter.manage')
  bulk(@EventId() eventId: string, @Body() body: BulkVotersBody): Promise<BulkVotersResponse> {
    return this.voters.bulk(eventId, body);
  }

  /** GET /api/v1/events/:eventId/voters/:voterId */
  @Get('voters/:voterId')
  @RequirePermission('voter.view')
  detail(@EventId() eventId: string, @VoterId() voterId: string): Promise<VoterDetail> {
    return this.voters.detail(eventId, voterId);
  }

  /** PATCH /api/v1/events/:eventId/voters/:voterId */
  @Patch('voters/:voterId')
  @RequirePermission('voter.manage')
  update(
    @EventId() eventId: string,
    @VoterId() voterId: string,
    @Body() body: UpdateVoterBody,
  ): Promise<VoterDetail> {
    return this.voters.update(eventId, voterId, body);
  }

  /** DELETE /api/v1/events/:eventId/voters/:voterId */
  @Delete('voters/:voterId')
  @HttpCode(204)
  @RequirePermission('voter.manage')
  remove(@EventId() eventId: string, @VoterId() voterId: string): Promise<void> {
    return this.voters.remove(eventId, voterId);
  }

  /** POST /api/v1/events/:eventId/voters/:voterId/photo — multipart field "file". */
  @Post('voters/:voterId/photo')
  @HttpCode(200)
  @RequirePermission('voter.manage')
  @UseInterceptors(FileInterceptor(UPLOAD_FIELD))
  uploadPhoto(
    @EventId() eventId: string,
    @VoterId() voterId: string,
    @UploadedFile() file: Upload | undefined,
  ): Promise<VoterDetail> {
    return this.voters.uploadPhoto(eventId, voterId, file);
  }

  /** DELETE /api/v1/events/:eventId/voters/:voterId/photo */
  @Delete('voters/:voterId/photo')
  @RequirePermission('voter.manage')
  removePhoto(@EventId() eventId: string, @VoterId() voterId: string): Promise<VoterDetail> {
    return this.voters.removePhoto(eventId, voterId);
  }

  /** POST /api/v1/events/:eventId/voters/:voterId/regenerate-code */
  @Post('voters/:voterId/regenerate-code')
  @HttpCode(200)
  @RequirePermission('code.regenerate')
  regenerateCode(@EventId() eventId: string, @VoterId() voterId: string): Promise<VoterDetail> {
    return this.voters.regenerateCode(eventId, voterId);
  }

  /** POST /api/v1/events/:eventId/imports — multipart field "file" (.csv). */
  @Post('imports')
  @RequirePermission('voter.manage')
  @UseInterceptors(
    FileInterceptor(UPLOAD_FIELD, { limits: { fileSize: CSV_UPLOAD_LIMIT, files: 1, fields: 5 } }),
  )
  createImport(
    @EventId() eventId: string,
    @UploadedFile() file: Upload | undefined,
  ): Promise<CreateImportResponse> {
    return this.imports.create(eventId, file);
  }

  /** GET /api/v1/events/:eventId/imports/:importId */
  @Get('imports/:importId')
  @RequirePermission('voter.manage')
  getImport(
    @EventId() eventId: string,
    @ImportId() importId: string,
    @Query() query: ImportQuery,
  ): Promise<VoterImport> {
    return this.imports.get(eventId, importId, query);
  }

  /** POST /api/v1/events/:eventId/imports/:importId/confirm */
  @Post('imports/:importId/confirm')
  @HttpCode(200)
  @RequirePermission('voter.manage')
  confirmImport(@EventId() eventId: string, @ImportId() importId: string): Promise<VoterImport> {
    return this.imports.confirm(eventId, importId);
  }

  /** GET /api/v1/events/:eventId/imports/:importId/errors.csv — rejected rows (VTR-05). */
  @Get('imports/:importId/errors.csv')
  @RequirePermission('voter.manage')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="makosa.csv"')
  async importErrors(@EventId() eventId: string, @ImportId() importId: string): Promise<string> {
    return `${BOM}${await this.imports.errorsCsv(eventId, importId)}\r\n`;
  }
}
