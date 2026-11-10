import { Injectable } from '@nestjs/common';
import {
  type PreviewTemplateRequest,
  type PreviewTemplateResponse,
  type PutTemplatesRequest,
  renderTemplate,
  smsLength,
  type TemplatesResponse,
  unknownPlaceholders,
} from '@vote-kidigit/shared';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { MessageContent, SAMPLE_CODE } from './message-content.js';

/** Message templates of an event (Backend Schema 12.8, App Flow 6.7, PRD SMS-03, SMS-04). */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly content: MessageContent,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /events/:eventId/templates: every type and channel, with where the text comes from. */
  list(eventId: string): Promise<TemplatesResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.content.event(tx, eventId);
      return { items: await this.content.templates(tx, eventId) };
    });
  }

  /** PUT /events/:eventId/templates: sets (or with body null removes) the event's own texts. */
  put(eventId: string, body: PutTemplatesRequest): Promise<TemplatesResponse> {
    const ctx = this.context();
    return this.prisma.withContext(ctx, async (tx) => {
      await this.content.event(tx, eventId);
      for (const item of body.templates) {
        const where = { eventId, type: item.type, channel: item.channel };
        if (item.body === null) {
          await tx.smsTemplate.deleteMany({ where });
          continue;
        }
        const data = {
          body: item.body,
          subject: item.channel === 'email' ? (item.subject ?? null) : null,
          updatedBy: ctx.userId,
        };
        const existing = await tx.smsTemplate.findFirst({ where, select: { id: true } });
        if (existing) await tx.smsTemplate.update({ where: { id: existing.id }, data });
        else {
          await tx.smsTemplate.create({
            data: { ...where, ...data, organizationId: ctx.orgId, language: 'sw' },
          });
        }
      }
      await this.audit.record(tx, {
        action: 'messages.templates.update',
        entityType: 'voting_events',
        entityId: eventId,
        eventId,
        after: { templates: body.templates.map((t) => `${t.type}/${t.channel}`) },
      });
      return { items: await this.content.templates(tx, eventId) };
    });
  }

  /** POST …/templates/preview: the text with sample data, its length and SMS count. */
  preview(eventId: string, body: PreviewTemplateRequest): Promise<PreviewTemplateResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.content.event(tx, eventId);
      const values = await this.content.values(tx, event, { fullName: 'Asha Mollel' }, SAMPLE_CODE);
      const text = renderTemplate(body.body, values);
      const length = smsLength(text);
      return {
        text,
        subject: body.subject ? renderTemplate(body.subject, values) : null,
        encoding: length.encoding,
        characters: length.characters,
        segments: body.channel === 'sms' ? length.segments : 0,
        unknownPlaceholders: unknownPlaceholders(`${body.body} ${body.subject ?? ''}`),
      };
    });
  }

  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
