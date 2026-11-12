import { Body, Controller, Get, Module, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CreateAuditExportRequestSchema,
  CreateReportRequestSchema,
  type ReportJob,
} from '@vote-kidigit/shared';
import type { Response } from 'express';
import { AuthModule } from '../../auth/auth.module.js';
import { RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { QueueModule } from '../../queue/queue.module.js';
import { ReportsService } from './reports.service.js';

class CreateReportBody extends zodDto(CreateReportRequestSchema) {}
class CreateAuditExportBody extends zodDto(CreateAuditExportRequestSchema) {}

const EventId = () => Param('eventId', IdParamPipe);
const JobId = () => Param('jobId', IdParamPipe);
/** Rendering is the expensive part; 20 report requests a minute per session is plenty. */
const reportLimit = { default: { limit: 20, ttl: 60_000 } };

/** 200 with the download link when the file is ready, 202 while the worker is still on it. */
function answer(res: Response, job: ReportJob): ReportJob {
  res.status(job.status === 'queued' || job.status === 'running' ? 202 : 200);
  return job;
}

/** Event reports (Backend Schema 12.10): results PDF, registered voters PDF / Excel. */
@Controller('v1/events/:eventId')
export class EventReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** POST /api/v1/events/:eventId/reports */
  @Post('reports')
  @Throttle(reportLimit)
  @RequirePermission('reports.download')
  async create(
    @EventId() eventId: string,
    @Body() body: CreateReportBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReportJob> {
    return answer(res, await this.reports.create(eventId, body.type));
  }

  /** GET /api/v1/events/:eventId/reports: recent downloads. */
  @Get('reports')
  @RequirePermission('reports.download')
  list(@EventId() eventId: string): Promise<ReportJob[]> {
    return this.reports.list(eventId);
  }

  /** GET /api/v1/events/:eventId/reports/:jobId */
  @Get('reports/:jobId')
  @RequirePermission('reports.download')
  get(@EventId() eventId: string, @JobId() jobId: string): Promise<ReportJob> {
    return this.reports.get(jobId, { eventId, audit: false });
  }

  /** POST /api/v1/events/:eventId/audit/exports: the event's activity as Excel. */
  @Post('audit/exports')
  @Throttle(reportLimit)
  @RequirePermission('audit.view.event')
  async exportAudit(
    @EventId() eventId: string,
    @Body() body: CreateAuditExportBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReportJob> {
    return answer(res, await this.reports.createAuditExport(eventId, body.filters));
  }

  /** GET /api/v1/events/:eventId/audit/exports/:jobId */
  @Get('audit/exports/:jobId')
  @RequirePermission('audit.view.event')
  auditExport(@EventId() eventId: string, @JobId() jobId: string): Promise<ReportJob> {
    return this.reports.get(jobId, { eventId, audit: true });
  }
}

/** SYS-01 "Export to Excel": the organization's audit log. */
@Controller('v1/audit/exports')
export class AuditExportsController {
  constructor(private readonly reports: ReportsService) {}

  /** POST /api/v1/audit/exports */
  @Post()
  @Throttle(reportLimit)
  @RequirePermission('audit.view.org')
  async create(
    @Body() body: CreateAuditExportBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReportJob> {
    return answer(res, await this.reports.createAuditExport(null, body.filters));
  }

  /** GET /api/v1/audit/exports/:jobId */
  @Get(':jobId')
  @RequirePermission('audit.view.org')
  get(@JobId() jobId: string): Promise<ReportJob> {
    return this.reports.get(jobId, { eventId: null, audit: true });
  }
}

@Module({
  imports: [AuthModule, QueueModule],
  controllers: [EventReportsController, AuditExportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
