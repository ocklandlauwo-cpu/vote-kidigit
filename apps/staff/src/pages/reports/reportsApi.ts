// Report jobs for the staff screens (App Flow 11.3): ask for a report, and when the server
// answers "queued" (events over 5,000 voters) poll it while showing "Tunaandaa PDF…", then start
// the download. Recent downloads of an event list the last ten.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AuditExportFilters,
  type EventReportType,
  type ReportJob,
  ReportJobListSchema,
  ReportJobSchema,
} from '@vote-kidigit/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import { EVENTS_KEY } from '../events/eventsApi';
import { startDownload } from './download';

const POLL_MS = 2_000;

export const reportsKey = (eventId: string) => [...EVENTS_KEY, eventId, 'reports'] as const;

export function useRecentReports(eventId: string, enabled = true) {
  return useQuery({
    queryKey: reportsKey(eventId),
    queryFn: () => api(`/v1/events/${eventId}/reports`, { schema: ReportJobListSchema }),
    enabled,
  });
}

const finished = (job: ReportJob) => job.status === 'completed' || job.status === 'failed';

/**
 * One report at a time: `start()` asks for it; a finished file downloads at once, a queued one
 * is polled until it is ready. `job` is the current job (progress, failure) for the screen.
 */
function useReportJob(paths: {
  create: string;
  status: (jobId: string) => string;
  /** Recent downloads to refresh, for event reports. */
  eventId?: string;
}) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<unknown>(null);
  const [requesting, setRequesting] = useState(false);

  function done(job: ReportJob) {
    if (job.status === 'completed' && job.downloadUrl) startDownload(job.downloadUrl);
    if (paths.eventId) void queryClient.invalidateQueries({ queryKey: reportsKey(paths.eventId) });
  }

  const polled = useQuery({
    queryKey: ['report-job', jobId],
    queryFn: async () => {
      const job = await api(paths.status(jobId ?? ''), { schema: ReportJobSchema });
      if (finished(job)) done(job);
      return job;
    },
    enabled: jobId !== null,
    refetchInterval: (query) => (query.state.data && finished(query.state.data) ? false : POLL_MS),
  });

  async function start(body: object) {
    setRequesting(true);
    setRequestError(null);
    try {
      const job = await api(paths.create, { method: 'POST', body, schema: ReportJobSchema });
      if (finished(job)) {
        queryClient.setQueryData(['report-job', job.id], job);
        done(job);
      }
      setJobId(job.id);
    } catch (error) {
      setRequestError(error);
    } finally {
      setRequesting(false);
    }
  }

  const job = polled.data ?? null;
  return {
    start,
    /** The request is on its way, or the worker is still preparing the file. */
    preparing: requesting || (job !== null && !finished(job)) || (jobId !== null && !job),
    job,
    /** The request was refused (e.g. results not ready) or the job failed. */
    failed: requestError !== null || job?.status === 'failed',
    requestError,
  };
}

export function useEventReport(eventId: string) {
  const report = useReportJob({
    create: `/v1/events/${eventId}/reports`,
    status: (jobId) => `/v1/events/${eventId}/reports/${jobId}`,
    eventId,
  });
  return { ...report, start: (type: EventReportType) => report.start({ type }) };
}

/** Audit export of the organization (no eventId) or of one event. */
export function useAuditExport(eventId?: string) {
  const base = eventId ? `/v1/events/${eventId}/audit/exports` : '/v1/audit/exports';
  const report = useReportJob({ create: base, status: (jobId) => `${base}/${jobId}` });
  return { ...report, start: (filters: AuditExportFilters) => report.start({ filters }) };
}
