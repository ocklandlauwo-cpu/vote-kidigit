import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/app-error.js';
import type { Env } from '../config/env.schema.js';

export const DEPLOY_SECRET_HEADER = 'x-deploy-secret';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Allows the request only with the deploy secret (DEPLOY_HEALTH_SECRET) in X-Deploy-Secret.
 * Compared in constant time; anything else gets 404 so the endpoint is not revealed.
 */
@Injectable()
export class DeploySecretGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.expected = digest(config.get('DEPLOY_HEALTH_SECRET', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const supplied = context.switchToHttp().getRequest<Request>().header(DEPLOY_SECRET_HEADER);
    if (supplied && timingSafeEqual(digest(supplied), this.expected)) return true;
    throw new AppError('NOT_FOUND');
  }
}
