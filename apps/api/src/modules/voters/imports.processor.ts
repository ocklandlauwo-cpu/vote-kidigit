import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { RequestContextService, systemContext } from '../../context/request-context.js';
import { IMPORT_JOB, type ImportJob } from '../../queue/import-jobs.js';
import { IMPORTS_QUEUE } from '../../queue/queue.module.js';
import { ImportRunner } from './import-runner.js';

/** Runs CSV import jobs (worker only), in the organization of the import. */
@Processor(IMPORTS_QUEUE)
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    private readonly runner: ImportRunner,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  async process(job: Job<ImportJob>): Promise<void> {
    const { importId, organizationId, requestId } = job.data;
    await this.requestContext.run(systemContext(requestId, organizationId), async () => {
      switch (job.name) {
        case IMPORT_JOB.validate:
          return this.runner.validate(importId);
        case IMPORT_JOB.confirm:
          return this.runner.confirm(importId);
        default:
          this.logger.warn({ msg: 'unknown import job', job: job.name });
      }
    });
  }
}
