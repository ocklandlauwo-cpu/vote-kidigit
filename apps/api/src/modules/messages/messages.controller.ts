import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type Batch,
  BatchEstimateQuerySchema,
  type BatchEstimate,
  type BatchMessagePage,
  BatchMessagesQuerySchema,
  type BatchPage,
  CreateBatchRequestSchema,
  PaginationQuerySchema,
  PreviewTemplateRequestSchema,
  type PreviewTemplateResponse,
  PutTemplatesRequestSchema,
  type TemplatesResponse,
} from '@vote-kidigit/shared';
import { Public, RequirePermission } from '../../auth/decorators.js';
import { IdParamPipe } from '../../common/id-param.pipe.js';
import { zodDto } from '../../common/zod-validation.pipe.js';
import { BatchesService } from './batches.service.js';
import { DeliveryReports } from './delivery-reports.js';
import { TemplatesService } from './templates.service.js';

class PutTemplatesBody extends zodDto(PutTemplatesRequestSchema) {}
class PreviewBody extends zodDto(PreviewTemplateRequestSchema) {}
class CreateBatchBody extends zodDto(CreateBatchRequestSchema) {}
class EstimateQuery extends zodDto(BatchEstimateQuerySchema) {}
class PageQuery extends zodDto(PaginationQuerySchema) {}
class MessagesQuery extends zodDto(BatchMessagesQuerySchema) {}

const EventId = () => Param('eventId', IdParamPipe);
const BatchId = () => Param('batchId', IdParamPipe);

/** Templates and batches of an event (Backend Schema 12.8, EVT-07). */
@Controller('v1/events/:eventId')
export class MessagesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly batches: BatchesService,
  ) {}

  /** GET /api/v1/events/:eventId/templates */
  @Get('templates')
  @RequirePermission('event.view')
  listTemplates(@EventId() eventId: string): Promise<TemplatesResponse> {
    return this.templates.list(eventId);
  }

  /** PUT /api/v1/events/:eventId/templates */
  @Put('templates')
  @RequirePermission('messages.send')
  putTemplates(
    @EventId() eventId: string,
    @Body() body: PutTemplatesBody,
  ): Promise<TemplatesResponse> {
    return this.templates.put(eventId, body);
  }

  /** POST /api/v1/events/:eventId/templates/preview */
  @Post('templates/preview')
  @HttpCode(200)
  @RequirePermission('messages.send')
  preview(@EventId() eventId: string, @Body() body: PreviewBody): Promise<PreviewTemplateResponse> {
    return this.templates.preview(eventId, body);
  }

  /** GET /api/v1/events/:eventId/batches/estimate — recipients and SMS count before sending. */
  @Get('batches/estimate')
  @RequirePermission('messages.send')
  estimate(@EventId() eventId: string, @Query() query: EstimateQuery): Promise<BatchEstimate> {
    return this.batches.estimate(eventId, query);
  }

  /** POST /api/v1/events/:eventId/batches */
  @Post('batches')
  @RequirePermission('messages.send')
  create(@EventId() eventId: string, @Body() body: CreateBatchBody): Promise<Batch> {
    return this.batches.start(eventId, body);
  }

  /** GET /api/v1/events/:eventId/batches */
  @Get('batches')
  @RequirePermission('event.view')
  list(@EventId() eventId: string, @Query() query: PageQuery): Promise<BatchPage> {
    return this.batches.list(eventId, query);
  }

  /** GET /api/v1/events/:eventId/batches/:batchId/messages */
  @Get('batches/:batchId/messages')
  @RequirePermission('voter.view')
  messages(
    @EventId() eventId: string,
    @BatchId() batchId: string,
    @Query() query: MessagesQuery,
  ): Promise<BatchMessagePage> {
    return this.batches.messages(eventId, batchId, query);
  }

  /** POST /api/v1/events/:eventId/batches/:batchId/resume */
  @Post('batches/:batchId/resume')
  @HttpCode(200)
  @RequirePermission('messages.send')
  resume(@EventId() eventId: string, @BatchId() batchId: string): Promise<Batch> {
    return this.batches.resume(eventId, batchId);
  }

  /** POST /api/v1/events/:eventId/batches/:batchId/cancel */
  @Post('batches/:batchId/cancel')
  @HttpCode(200)
  @RequirePermission('messages.send')
  cancel(@EventId() eventId: string, @BatchId() batchId: string): Promise<Batch> {
    return this.batches.cancel(eventId, batchId);
  }

  /** POST /api/v1/events/:eventId/batches/:batchId/resend-failed */
  @Post('batches/:batchId/resend-failed')
  @HttpCode(200)
  @RequirePermission('messages.send')
  resendFailed(@EventId() eventId: string, @BatchId() batchId: string): Promise<Batch> {
    return this.batches.resendFailed(eventId, batchId);
  }
}

/**
 * POST /api/webhooks/beem/dlr?secret=… (Backend Schema 12.12). Public: Beem has no session; the
 * shared secret in the URL is the check. Always answers 200 for a known secret, so Beem does
 * not retry reports we choose to ignore. The body is never logged.
 */
@Controller('webhooks/beem')
export class BeemWebhookController {
  constructor(private readonly reports: DeliveryReports) {}

  @Post('dlr')
  @HttpCode(200)
  @Public()
  @SkipThrottle()
  async deliveryReport(
    @Query('secret') secret: unknown,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    this.reports.assertSecret(secret);
    await this.reports.handle(body);
    return { ok: true };
  }
}
