import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';

/** HTTP entry (vk-api): controllers for the staff portal, voter API, USSD and webhooks. */
@Module({
  imports: [AppModule],
})
export class ApiModule {}
