import { Module } from '@nestjs/common';

/**
 * Providers shared by the HTTP API and the worker: configuration (step 3),
 * Prisma (step 6), audit (step 8) and the feature services added in later steps.
 */
@Module({})
export class AppModule {}
