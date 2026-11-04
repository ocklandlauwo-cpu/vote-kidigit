import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { redactPath } from '../common/redaction.js';

/**
 * One log line per HTTP request: method, redacted path, status and duration. Never the body,
 * the query string or headers (Tech Stack 11.2).
 */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Http');

  use(req: Request, res: Response, next: NextFunction): void {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      this.logger.log({
        msg: 'request',
        method: req.method,
        path: redactPath(req.originalUrl),
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });
    next();
  }
}
