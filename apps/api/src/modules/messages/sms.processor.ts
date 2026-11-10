import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { RequestContextService, systemContext } from '../../context/request-context.js';
import { SMS_JOB, type SendMessageJob } from '../../queue/sms-jobs.js';
import { SMS_QUEUE } from '../../queue/queue.module.js';
import { MessageSender } from './message-sender.js';

/**
 * Sends messages from the sms queue (worker only), several at a time. A retryable failure
 * throws, so BullMQ tries again with backoff; the last attempt records the failure. A message of
 * a paused batch stays in the queue as a delayed job (no attempt used), which Resume promotes.
 */
/** How often a held job looks again, in case Resume could not promote it. */
const HELD_RECHECK_MS = 60_000;

@Processor(SMS_QUEUE, { concurrency: 20 })
export class SmsProcessor extends WorkerHost {
  constructor(
    private readonly sender: MessageSender,
    private readonly requestContext: RequestContextService,
  ) {
    super();
  }

  async process(job: Job<SendMessageJob>, token?: string): Promise<void> {
    if (job.name !== SMS_JOB.send) return;
    const { messageId, organizationId, requestId } = job.data;
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const outcome = await this.requestContext.run(systemContext(requestId, organizationId), () =>
      this.sender.send(messageId, lastAttempt),
    );
    if (outcome === 'held') {
      await job.moveToDelayed(Date.now() + HELD_RECHECK_MS, token);
      throw new DelayedError();
    }
  }
}
