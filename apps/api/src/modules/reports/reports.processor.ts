import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextService, systemContext } from '../../context/request-context.js';
import type { ReportJobData } from '../../queue/report-jobs.js';
import { REPORTS_QUEUE } from '../../queue/queue.module.js';
import { ReportRunner } from './report-runner.js';

/** Runs report jobs (worker only), two at a time: the shared browser renders at most 2 PDFs. */
@Processor(REPORTS_QUEUE, { concurrency: 2 })
export class ReportsProcessor extends WorkerHost {
  constructor(
    private readonly runner: ReportRunner,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  async process(job: Job<ReportJobData>): Promise<void> {
    const { reportJobId, organizationId, requestId } = job.data;
    await this.requestContext.run(systemContext(requestId, organizationId), () =>
      this.runner.run(reportJobId),
    );
  }
}
