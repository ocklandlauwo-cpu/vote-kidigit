import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * HTTP settings shared by main.ts and the HTTP tests, so tests run the same pipeline:
 *  - routes under /api,
 *  - trust exactly one proxy (the DirectAdmin web server) for the client IP used by rate
 *    limits and the audit log (Tech Stack 9.5),
 *  - security headers from Helmet.
 * Filters, pipes, guards and middleware are registered in ApiModule, so they apply everywhere.
 */
export function configureHttpApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1);
  app.use(helmet());
}
