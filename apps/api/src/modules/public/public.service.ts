import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { PublicContactRequest } from '@vote-kidigit/shared';
import type { Queue } from 'bullmq';
import { RequestContextService } from '../../context/request-context.js';
import { type ContactJob, EMAIL_JOB } from '../../queue/email-jobs.js';
import { EMAIL_QUEUE } from '../../queue/queue.module.js';

/**
 * Public website forms (App Flow 4.1): queues one email to the Vote-Kidigit team. Nothing is
 * stored in the database and no account is created, so there is no audit entry either.
 */
@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly requestContext: RequestContextService,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
  ) {}

  async contact(body: PublicContactRequest): Promise<void> {
    const { website, ...request } = body;
    if (website) {
      // The hidden honeypot field was filled: a bot. Same answer, nothing sent.
      this.logger.log({ msg: 'contact form honeypot', kind: body.kind });
      return;
    }
    const job: ContactJob = {
      request,
      receivedAt: new Date().toISOString(),
      requestId: this.requestContext.getOrThrow().requestId,
    };
    await this.emailQueue.add(EMAIL_JOB.contact, job);
  }
}
