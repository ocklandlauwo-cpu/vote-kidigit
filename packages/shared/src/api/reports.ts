// Reports (PRD REP-01, REP-02, Backend Schema 7.7 and 12.10, App Flow 11.3): the results PDF,
// the registered-voters report as PDF or Excel, and the audit export. A report is a job; small
// events get the file at once, larger ones show "Tunaandaa PDF…" until the worker is done.
import { z } from 'zod';
import { JobStatusSchema, ReportTypeSchema } from '../constants/enums.js';

/** Events up to this many voters download at once (App Flow 11.3); larger ones run in the background. */
export const INSTANT_REPORT_MAX_VOTERS = 5000;

/** Filters of an audit export: the same as the audit screen's, without paging. */
export const AuditExportFiltersSchema = z
  .object({
    action: z.string().trim().max(100).optional(),
    actorUserId: z.uuid().optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .strict();
export type AuditExportFilters = z.infer<typeof AuditExportFiltersSchema>;

/** The event reports of the Results and Voters tabs; audit exports have their own routes. */
export const EventReportTypeSchema = z.enum(['results_pdf', 'voters_pdf', 'voters_xlsx']);
export type EventReportType = z.infer<typeof EventReportTypeSchema>;

/** POST /events/:eventId/reports (reports.download) */
export const CreateReportRequestSchema = z.object({ type: EventReportTypeSchema }).strict();
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

/**
 * POST /audit/exports (audit.view.org) and POST /events/:eventId/audit/exports
 * (audit.view.event): the audit log as Excel, with the screen's filters.
 */
export const CreateAuditExportRequestSchema = z
  .object({ filters: AuditExportFiltersSchema.default({}) })
  .strict();
export type CreateAuditExportRequest = z.input<typeof CreateAuditExportRequestSchema>;

export const ReportJobSchema = z.object({
  id: z.uuid(),
  type: ReportTypeSchema,
  status: JobStatusSchema,
  /** 0–100 while running. */
  progress: z.number().int(),
  /** GET link of the finished file (staff session). */
  downloadUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  requestedBy: z.string().nullable(),
  /** A stable error code when the job failed. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type ReportJob = z.infer<typeof ReportJobSchema>;

/** GET /events/:eventId/reports: "Recent downloads". */
export const ReportJobListSchema = z.array(ReportJobSchema);
