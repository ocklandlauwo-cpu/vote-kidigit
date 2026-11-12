// Builds one report job (worker only, in the organization's context as System): reads the data,
// renders the PDF or Excel file, stores it as a `report` file and marks the job completed in the
// same transaction. A failure is kept on the job as an error code; staff ask again.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AuditEntry,
  AuditExportFiltersSchema,
  DEFAULT_LANGUAGE,
  type Language,
  languages,
} from '@vote-kidigit/shared';
import { AuditQueryService } from '../../audit/audit-query.service.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { ReportType } from '../../generated/prisma/enums.js';
import { FilesService } from '../files/files.service.js';
import { PdfRenderer } from './pdf-renderer.js';
import { resultsReportData, votersReportData } from './report-data.js';
import { footerTemplate } from './templates/html.js';
import { reportText } from './templates/report-text.js';
import { resultsReportHtml } from './templates/results-report.js';
import { votersReportHtml } from './templates/voters-report.js';
import { auditWorkbook, votersWorkbook } from './templates/workbooks.js';

/** The audit export stops here; narrow the filters for more. */
export const AUDIT_EXPORT_MAX_ROWS = 100_000;
const AUDIT_PAGE = 1_000;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Built {
  bytes: Buffer;
  mimeType: string;
  extension: 'pdf' | 'xlsx';
  /** Without extension, e.g. "matokeo-uchaguzi-mkuu-2027". */
  baseName: string;
}

const BASE_NAMES: Record<Language, Record<ReportType, string>> = {
  sw: {
    results_pdf: 'matokeo',
    voters_pdf: 'wapiga-kura',
    voters_xlsx: 'wapiga-kura',
    audit_xlsx: 'kumbukumbu',
  },
  en: { results_pdf: 'results', voters_pdf: 'voters', voters_xlsx: 'voters', audit_xlsx: 'audit' },
};

/** "Uchaguzi Mkuu 2027" → "uchaguzi-mkuu-2027": safe in a file name. */
export function slug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 60) || 'report'
  );
}

const asLanguage = (value: string | undefined): Language =>
  (languages as readonly string[]).includes(value ?? '') ? (value as Language) : DEFAULT_LANGUAGE;

@Injectable()
export class ReportRunner {
  private readonly logger = new Logger(ReportRunner.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly files: FilesService,
    private readonly pdf: PdfRenderer,
    private readonly auditQuery: AuditQueryService,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  async run(reportJobId: string): Promise<void> {
    const ctx = this.requestContext.getOrThrow();
    const job = await this.prisma.withContext(ctx, async (tx) => {
      const found = await tx.reportJob.findUnique({
        where: { id: reportJobId },
        include: { requester: { select: { fullName: true, language: true } } },
      });
      if (!found || found.status !== 'queued') return null;
      await tx.reportJob.update({
        where: { id: reportJobId },
        data: { status: 'running', progress: 10 },
      });
      return found;
    });
    if (!job) return;
    try {
      const built = await this.build(job);
      const date = new Date().toISOString().slice(0, 10);
      const name = `${built.baseName}-${date}.${built.extension}`;
      await this.files.withDocument(
        'report',
        { buffer: built.bytes, originalname: name, size: built.bytes.length },
        { mimeType: built.mimeType, extension: built.extension },
        async (tx, file) => {
          await tx.reportJob.update({
            where: { id: reportJobId },
            data: { status: 'completed', progress: 100, fileId: file.id, completedAt: new Date() },
          });
        },
      );
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL';
      if (code === 'INTERNAL') {
        this.logger.error({ message: 'Report failed', reportJobId, type: job.type, error });
      }
      await this.prisma.withContext(ctx, (tx) =>
        tx.reportJob.update({
          where: { id: reportJobId },
          data: { status: 'failed', error: code, completedAt: new Date() },
        }),
      );
    }
  }

  private async build(job: {
    id: string;
    type: ReportType;
    eventId: string | null;
    params: unknown;
    requester: { fullName: string; language: string } | null;
  }): Promise<Built> {
    const ctx = this.requestContext.getOrThrow();
    const language = asLanguage(job.requester?.language);
    const text = reportText[language];
    const common = {
      language,
      generatedAt: new Date(),
      generatedBy: job.requester?.fullName ?? 'System',
      font: await this.pdf.fontDataUri(),
    };
    const progress = (value: number) =>
      this.prisma.withContext(ctx, (tx) =>
        tx.reportJob.update({ where: { id: job.id }, data: { progress: value } }),
      );

    if (job.type === 'audit_xlsx') {
      const { entries, eventNames, timeZone, eventName } = await this.auditEntries(job);
      await progress(70);
      return {
        bytes: await auditWorkbook({
          language,
          timeZone,
          entries,
          eventNames,
          generatedAt: common.generatedAt,
        }),
        mimeType: XLSX,
        extension: 'xlsx',
        baseName: [BASE_NAMES[language].audit_xlsx, eventName && slug(eventName)]
          .filter(Boolean)
          .join('-'),
      };
    }

    const eventId = job.eventId;
    if (!eventId) throw new AppError('NOT_FOUND');
    if (job.type === 'results_pdf') {
      const data = await this.prisma.withContext(ctx, (tx) =>
        resultsReportData(tx, this.files, eventId, this.appUrl, common),
      );
      await progress(50);
      const footer = footerTemplate(
        `${data.event.name} · ${text.version(data.snapshot.version)} · ${data.snapshot.contentHash.slice(0, 16)}`,
        text.page,
        text.of,
      );
      return {
        bytes: await this.pdf.render(resultsReportHtml(data), footer),
        mimeType: 'application/pdf',
        extension: 'pdf',
        baseName: `${BASE_NAMES[language].results_pdf}-${slug(data.event.name)}`,
      };
    }

    const data = await this.prisma.withContext(ctx, (tx) =>
      votersReportData(tx, this.files, eventId, common),
    );
    await progress(50);
    const baseName = `${BASE_NAMES[language][job.type]}-${slug(data.event.name)}`;
    if (job.type === 'voters_xlsx') {
      return { bytes: await votersWorkbook(data), mimeType: XLSX, extension: 'xlsx', baseName };
    }
    return {
      bytes: await this.pdf.render(
        votersReportHtml(data),
        footerTemplate(data.event.name, text.page, text.of),
      ),
      mimeType: 'application/pdf',
      extension: 'pdf',
      baseName,
    };
  }

  /** The audit entries of the job's filters, newest first, read a page at a time. */
  private async auditEntries(job: { eventId: string | null; params: unknown }) {
    const ctx = this.requestContext.getOrThrow();
    const filters = AuditExportFiltersSchema.parse(job.params);
    return this.prisma.withContext(
      ctx,
      async (tx) => {
        const organization = await tx.organization.findUniqueOrThrow({
          where: { id: ctx.orgId ?? '' },
          select: { timeZone: true },
        });
        const entries: AuditEntry[] = [];
        for (let page = 1; entries.length < AUDIT_EXPORT_MAX_ROWS; page += 1) {
          const result = await this.auditQuery.list(tx, {
            ...filters,
            organizationId: ctx.orgId,
            ...(job.eventId && { eventId: job.eventId }),
            page,
            pageSize: AUDIT_PAGE,
          });
          entries.push(...result.items);
          if (result.items.length < AUDIT_PAGE) break;
        }
        const eventIds = [...new Set(entries.flatMap((e) => (e.eventId ? [e.eventId] : [])))];
        const events = await tx.votingEvent.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, name: true },
        });
        const eventNames = new Map(events.map((event) => [event.id, event.name]));
        return {
          entries: entries.slice(0, AUDIT_EXPORT_MAX_ROWS),
          eventNames,
          timeZone: organization.timeZone,
          eventName: job.eventId ? (eventNames.get(job.eventId) ?? null) : null,
        };
      },
      { timeout: 120_000 },
    );
  }
}
