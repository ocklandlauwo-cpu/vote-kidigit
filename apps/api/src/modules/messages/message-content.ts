import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_TEMPLATES,
  type MessageTemplate,
  type PlaceholderValues,
  REDACTED_CODE,
} from '@vote-kidigit/shared';
import type { Env } from '../../config/env.schema.js';
import type { Tx } from '../../database/prisma.service.js';
import { AppError } from '../../common/app-error.js';
import type { MessageChannel, MessageType } from '../../generated/prisma/enums.js';

/** A typical code for previews and SMS counts (the stored text has REDACTED_CODE instead). */
export const SAMPLE_CODE = 'K7M4-Q9XR';

export interface EventFacts {
  id: string;
  name: string;
  startAt: Date;
  endAt: Date;
  organizationName: string;
  senderId: string | null;
  timeZone: string;
}

/** "20/11 08:00" in the organization's time zone: short enough for SMS. */
export function smsTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`;
}

/**
 * Templates and placeholder values for an event's messages (PRD SMS-03): the event's own text,
 * else the organization default, else the built-in Swahili default. The code is never filled
 * in here: stored texts carry REDACTED_CODE and the sender swaps in the real code.
 */
@Injectable()
export class MessageContent {
  private readonly appUrl: string;
  private readonly ussdFallback: string;

  constructor(config: ConfigService<Env, true>) {
    const appUrl: string = config.get('APP_URL', { infer: true });
    this.appUrl = appUrl.replace(/\/+$/, '');
    this.ussdFallback = config.get('USSD_SHORT_CODE', { infer: true });
  }

  async event(tx: Tx, eventId: string): Promise<EventFacts> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        id: true,
        name: true,
        startAt: true,
        endAt: true,
        organization: { select: { name: true, smsSenderId: true, timeZone: true } },
      },
    });
    if (!event) throw new AppError('NOT_FOUND');
    return {
      id: event.id,
      name: event.name,
      startAt: event.startAt,
      endAt: event.endAt,
      organizationName: event.organization.name,
      senderId: event.organization.smsSenderId,
      timeZone: event.organization.timeZone,
    };
  }

  /** Every type × channel with the text that applies to this event and where it comes from. */
  async templates(tx: Tx, eventId: string): Promise<MessageTemplate[]> {
    const rows = await tx.smsTemplate.findMany({
      where: { OR: [{ eventId }, { eventId: null }] },
      select: { eventId: true, type: true, channel: true, subject: true, body: true },
    });
    const items: MessageTemplate[] = [];
    for (const type of Object.keys(DEFAULT_TEMPLATES) as MessageType[]) {
      for (const channel of ['sms', 'email'] as MessageChannel[]) {
        const own = rows.find(
          (r) => r.eventId === eventId && r.type === type && r.channel === channel,
        );
        const org = rows.find(
          (r) => r.eventId === null && r.type === type && r.channel === channel,
        );
        const row = own ?? org;
        const fallback = DEFAULT_TEMPLATES[type];
        items.push({
          type,
          channel,
          subject: channel === 'email' ? (row?.subject ?? fallback.subject) : null,
          body: row?.body ?? fallback.sms,
          source: own ? 'event' : org ? 'organization' : 'default',
        });
      }
    }
    return items;
  }

  async template(tx: Tx, eventId: string, type: MessageType, channel: MessageChannel) {
    const all = await this.templates(tx, eventId);
    const found = all.find((t) => t.type === type && t.channel === channel);
    if (!found) throw new Error(`no template for ${type}/${channel}`);
    return found;
  }

  async values(
    tx: Tx,
    event: EventFacts,
    voter: { fullName: string } | null,
    code = REDACTED_CODE,
  ): Promise<PlaceholderValues> {
    const settings = await tx.platformSetting.findFirst({ select: { ussdShortCode: true } });
    return {
      voter_name: voter?.fullName ?? '',
      org_name: event.organizationName,
      event_name: event.name,
      voting_code: code,
      voting_link: `${this.appUrl}/vote/${event.id}`,
      ussd_code: settings?.ussdShortCode ?? this.ussdFallback,
      start_time: smsTime(event.startAt, event.timeZone),
      end_time: smsTime(event.endAt, event.timeZone),
      // The public results link arrives with results publication (step 28).
      results_link: '',
    };
  }
}
