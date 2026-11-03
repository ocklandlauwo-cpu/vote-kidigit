import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { HealthModule } from './health/health.module.js';

/** HTTP entry (vk-api): controllers for the staff portal, voter API, USSD and webhooks. */
@Module({
  imports: [AppModule, HealthModule],
})
export class ApiModule {}
