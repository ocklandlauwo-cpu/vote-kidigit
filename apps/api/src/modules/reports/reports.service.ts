// Reports, API side (Backend Schema 12.10, App Flow 11.3): a request becomes a report_jobs row
// and a job on the reports queue; the worker renders it. For events up to 5,000 voters the
// request waits for the file, so the download starts at once; larger ones answer "queued" and
// the screen polls the job ("Tunaandaa PDF…") and lists it under recent downloads.
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import {
  type AuditExportFilters,
  type EventReportType,
  INSTANT_REPORT_MAX_VOTERS,
  type ReportJob,
} from '@vote-kidigit/shared';
import type { Queue } from 'bullmq';
import { setTimeout as sleep } from 'node:timers/promises';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ReportType } from '../../generated/prisma/enums.js';
import { REPORTS_QUEUE } from '../../queue/queue.module.js';
import { REPORT_JOB, type ReportJobData } from '../../queue/report-jobs.js';
import { currentSnapshot } from '../results/snapshot.js';

/** How long a request waits for a small report before answering "queued". */
export const INSTANT_WAIT_MS = 25_000;
const POLL_MS = 200;
const RECENT = 10;

const jobInclude = {
  file: { select: { originalName: true } },
  requester: { select: { fullName: true } },
} as const;

type JobRow = Prisma.ReportJobGetPayload<{ include: typeof jobInclude }>;

function view(row: JobRow): ReportJob {
  const done = row.status === 'completed' && row.fileId;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    progress: row.progress,
    downloadUrl: done ? `/api/v1/files/${row.fileId}` : null,
    fileName: done ? (row.file?.originalName ?? null) : null,
    requestedBy: row.requester?.fullName ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly requestContext: RequestContextService,
    @InjectQueue(REPORTS_QUEUE) private readonly queue: Queue<ReportJobData>,
  ) {}

  /** POST /events/:eventId/reports */
  async create(eventId: string, type: EventReportType): Promise<ReportJob> {
    const { id, instant } = await this.prisma.withContext(this.context(), async (tx) => {
      await this.assertEvent(tx, eventId);
      if (type === 'results_pdf' && !(await this.resultsReady(tx, eventId))) {
        throw new AppError('INVALID_TRANSITION', 'Results are not ready yet.', {
          reason: 'RESULTS_NOT_READY',
        });
      }
      const voters = await tx.voter.count({ where: { eventId, deletedAt: null } });
      const created = await this.insert(tx, type, eventId, {});
      return { id: created, instant: voters <= INSTANT_REPORT_MAX_VOTERS };
    });
    return this.start(id, instant);
  }

  /** POST /audit/exports (organization) and POST /events/:eventId/audit/exports. */
  async createAuditExport(eventId: string | null, filters: AuditExportFilters): Promise<ReportJob> {
    const id = await this.prisma.withContext(this.context(), async (tx) => {
      if (eventId) await this.assertEvent(tx, eventId);
      return this.insert(tx, 'audit_xlsx', eventId, filters);
    });
    return this.start(id, true);
  }

  /** GET /events/:eventId/reports: recent downloads of the event, newest first. */
  list(eventId: string): Promise<ReportJob[]> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const rows = await tx.reportJob.findMany({
        where: { eventId, type: { not: 'audit_xlsx' } },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
        include: jobInclude,
      });
      return rows.map(view);
    });
  }

  /**
   * GET /events/:eventId/reports/:jobId, GET /events/:eventId/audit/exports/:jobId and
   * GET /audit/exports/:jobId: a job of that event (or of no event) and of that kind only.
   */
  get(jobId: string, scope: { eventId: string | null; audit: boolean }): Promise<ReportJob> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const row = await tx.reportJob.findFirst({
        where: {
          id: jobId,
          eventId: scope.eventId,
          type: scope.audit ? 'audit_xlsx' : { not: 'audit_xlsx' },
        },
        include: jobInclude,
      });
      if (!row) throw new AppError('NOT_FOUND');
      return view(row);
    });
  }

  private async insert(
    tx: Tx,
    type: ReportType,
    eventId: string | null,
    params: AuditExportFilters,
  ): Promise<string> {
    const ctx = this.context();
    const job = await tx.reportJob.create({
      data: { organizationId: ctx.orgId, eventId, type, params, requestedBy: ctx.userId },
      select: { id: true },
    });
    await this.audit.record(tx, {
      action: type === 'audit_xlsx' ? 'audit.export' : 'reports.download',
      entityType: 'report_jobs',
      entityId: job.id,
      eventId,
      after: type === 'audit_xlsx' ? { type, filters: params } : { type },
    });
    return job.id;
  }

  /** Queues the job after its row committed; waits for small reports. */
  private async start(id: string, wait: boolean): Promise<ReportJob> {
    const ctx = this.context();
    await this.queue.add(
      REPORT_JOB.generate,
      { reportJobId: id, organizationId: ctx.orgId, requestId: ctx.requestId },
      { jobId: `report-${id}` },
    );
    const deadline = Date.now() + (wait ? INSTANT_WAIT_MS : 0);
    for (;;) {
      const row = await this.prisma.withContext(ctx, (tx) =>
        tx.reportJob.findUniqueOrThrow({ where: { id }, include: jobInclude }),
      );
      const finished = row.status === 'completed' || row.status === 'failed';
      if (finished || Date.now() >= deadline) return view(row);
      await sleep(POLL_MS);
    }
  }

  private async assertEvent(tx: Tx, eventId: string): Promise<void> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { id: true },
    });
    if (!event) throw new AppError('NOT_FOUND');
  }

  private async resultsReady(tx: Tx, eventId: string): Promise<boolean> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId },
      select: { cancelledAt: true },
    });
    return !event?.cancelledAt && (await currentSnapshot(tx, eventId)) !== null;
  }

  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
