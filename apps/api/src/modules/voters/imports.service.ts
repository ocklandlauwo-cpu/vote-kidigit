import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CreateImportResponse,
  type ImportProblem,
  ImportProblemSchema,
  type ImportQuery,
  type VoterImport,
} from '@vote-kidigit/shared';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { IMPORT_JOB, type ImportJob } from '../../queue/import-jobs.js';
import { IMPORTS_QUEUE } from '../../queue/queue.module.js';
import { FilesService, type Upload } from '../files/files.service.js';
import { errorRowsCsv } from './csv-validation.js';
import { ImportRunner } from './import-runner.js';

const ProblemsSchema = z.array(ImportProblemSchema);
const MappingSchema = z.object({ missing: z.array(z.string()) }).nullable();

/** A text file: no NUL bytes in its first 8 KB (spreadsheets saved as .xlsx are refused). */
const looksLikeText = (data: Buffer) => !data.subarray(0, 8192).includes(0);

/**
 * CSV voter imports, API side (App Flow 6.6, Backend Schema 12.7): upload → the worker validates
 * → staff look at the preview → confirm → the worker imports. Draft events only.
 */
@Injectable()
export class ImportsService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly runner: ImportRunner,
    private readonly requestContext: RequestContextService,
    @InjectQueue(IMPORTS_QUEUE) private readonly queue: Queue<ImportJob>,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_CSV_MB', { infer: true }) * 1024 * 1024;
  }

  /** POST /events/:eventId/imports: stores the file and queues its validation. */
  async create(eventId: string, upload: Upload | undefined): Promise<CreateImportResponse> {
    if (!upload) {
      throw new AppError('VALIDATION_FAILED', 'Choose a CSV file.', {
        source: 'body',
        issues: [{ path: 'file', code: 'required', message: 'required' }],
      });
    }
    if (upload.size > this.maxBytes) throw new AppError('FILE_TOO_LARGE');
    if (!upload.originalname.toLowerCase().endsWith('.csv') || !looksLikeText(upload.buffer)) {
      throw new AppError('FILE_TYPE', 'Use a .csv file.');
    }
    const ctx = this.context();
    const id = await this.files.withDocument(
      'csv_import',
      upload,
      { mimeType: 'text/csv', extension: 'csv' },
      async (tx, file) => {
        await this.assertDraft(tx, eventId);
        const created = await tx.voterImport.create({
          data: { organizationId: ctx.orgId, eventId, fileId: file.id, createdBy: ctx.userId },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'voter.import.upload',
          entityType: 'voter_imports',
          entityId: created.id,
          eventId,
          after: { fileName: upload.originalname, sizeBytes: upload.size },
        });
        return created.id;
      },
    );
    await this.enqueue(IMPORT_JOB.validate, id);
    return { id };
  }

  /** GET /events/:eventId/imports/:importId: status, counters and a page of row problems. */
  get(eventId: string, importId: string, query: ImportQuery): Promise<VoterImport> {
    return this.prisma.withContext(this.context(), (tx) => this.load(tx, eventId, importId, query));
  }

  /** POST …/confirm: imports the rows without errors (in the worker). */
  async confirm(eventId: string, importId: string): Promise<VoterImport> {
    const result = await this.prisma.withContext(this.context(), async (tx) => {
      await this.assertDraft(tx, eventId);
      const updated = await tx.voterImport.updateMany({
        where: { id: importId, eventId, status: 'validated' },
        data: { status: 'importing' },
      });
      if (updated.count === 0) {
        await this.findImport(tx, eventId, importId);
        throw new AppError('INVALID_TRANSITION', 'Only a validated import can be confirmed.');
      }
      await this.audit.record(tx, {
        action: 'voter.import.confirm',
        entityType: 'voter_imports',
        entityId: importId,
        eventId,
      });
      return this.load(tx, eventId, importId, { page: 1, pageSize: 25 });
    });
    await this.enqueue(IMPORT_JOB.confirm, importId);
    return result;
  }

  /** GET …/errors.csv (VTR-05): the rejected rows with their reasons, to fix and upload again. */
  errorsCsv(eventId: string, importId: string): Promise<string> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.findImport(tx, eventId, importId);
      const { result } = await this.runner.validation(tx, importId);
      return errorRowsCsv(result);
    });
  }

  private async load(
    tx: Tx,
    eventId: string,
    importId: string,
    query: ImportQuery,
  ): Promise<VoterImport> {
    const row = await this.findImport(tx, eventId, importId);
    const all: ImportProblem[] = ProblemsSchema.parse(row.errors);
    const problems = query.severity ? all.filter((p) => p.severity === query.severity) : all;
    const start = (query.page - 1) * query.pageSize;
    return {
      id: row.id,
      status: row.status,
      fileName: row.file?.originalName ?? null,
      totalRows: row.totalRows,
      validRows: row.validRows,
      warningRows: row.warningRows,
      errorRows: row.errorRows,
      importedRows: row.importedRows,
      failureReason: row.failureReason,
      missingColumns: MappingSchema.parse(row.columnMapping)?.missing ?? [],
      problems: {
        items: problems.slice(start, start + query.pageSize),
        total: problems.length,
        page: query.page,
        pageSize: query.pageSize,
      },
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private async findImport(tx: Tx, eventId: string, importId: string) {
    const row = await tx.voterImport.findFirst({
      where: { id: importId, eventId },
      include: { file: { select: { originalName: true } } },
    });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async assertDraft(tx: Tx, eventId: string): Promise<void> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { status: true },
    });
    if (!event) throw new AppError('NOT_FOUND');
    if (event.status !== 'draft') throw new AppError('EVENT_LOCKED');
  }

  private enqueue(name: string, importId: string) {
    const ctx = this.context();
    return this.queue.add(name, { importId, organizationId: ctx.orgId, requestId: ctx.requestId });
  }

  /** Platform administrators have no organization and no events of their own. */
  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
