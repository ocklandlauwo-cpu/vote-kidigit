// Jobs on the reports queue (Backend Schema 7.7): the payload names the report_jobs row; the
// worker reads everything else from the database.

export const REPORT_JOB = { generate: 'generate' } as const;

export interface ReportJobData {
  reportJobId: string;
  organizationId: string;
  requestId: string;
}
