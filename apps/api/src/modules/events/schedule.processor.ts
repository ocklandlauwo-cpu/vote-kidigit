import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import type { Env } from '../../config/env.schema.js';
import { SCHEDULE_QUEUE } from '../../queue/queue.module.js';
import { SchedulerRunner, SWEEP_EVERY_MS } from './scheduler.js';

export const SWEEP_JOB = 'sweep';

/**
 * Runs the 1-minute sweep (worker only). The repeat is a BullMQ job scheduler stored in Redis:
 * one sweep per minute however many workers run, and it survives restarts. Tests share one
 * database across files, so under NODE_ENV=test the repeat is not registered: tests call
 * registerSweep() or SchedulerRunner.sweep() themselves.
 */
@Processor(SCHEDULE_QUEUE)
export class ScheduleProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly runner: SchedulerRunner,
    @InjectQueue(SCHEDULE_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) !== 'test') await this.registerSweep();
  }

  registerSweep() {
    return this.queue.upsertJobScheduler(SWEEP_JOB, { every: SWEEP_EVERY_MS }, { name: SWEEP_JOB });
  }

  async process(job: Job): Promise<void> {
    if (job.name === SWEEP_JOB) await this.runner.sweep();
  }
}
