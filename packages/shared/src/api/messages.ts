// Messages to voters (PRD SMS-01–SMS-09, Backend Schema 7.1–7.3, 12.8, App Flow 6.7, Design
// System 11.7): templates with a fixed list of placeholders, Swahili defaults, rendering, the SMS
// segment count, and the request and response shapes of the Messages tab.
import { z } from 'zod';
import {
  BatchAudienceSchema,
  BatchStatusSchema,
  MessageChannelSchema,
  MessageStatusSchema,
  type MessageType,
  MessageTypeSchema,
  messageTypes,
} from '../constants/enums.js';
import { pageSchema, PaginationQuerySchema } from './common.js';

/** PRD SMS-03: the only placeholders a template may use. */
export const MESSAGE_PLACEHOLDERS = [
  'voter_name',
  'org_name',
  'event_name',
  'voting_code',
  'voting_link',
  'ussd_code',
  'start_time',
  'end_time',
  'results_link',
] as const;
export type MessagePlaceholder = (typeof MESSAGE_PLACEHOLDERS)[number];
export type PlaceholderValues = Partial<Record<MessagePlaceholder, string>>;

/** What a stored or shown message has instead of the voting code. */
export const REDACTED_CODE = '••••-••••';

/**
 * Built-in Swahili texts, used when neither the event nor the organization has its own
 * (Design System 11.7: name → what → code → when → how; code delivery within 160 characters).
 */
export const DEFAULT_TEMPLATES: Record<MessageType, { sms: string; subject: string }> = {
  code_delivery: {
    sms: '{org_name}: Msimbo wa kura {event_name}: {voting_code}. {start_time}-{end_time}. Piga kura {voting_link} au {ussd_code}',
    subject: 'Msimbo wako wa kupiga kura: {event_name}',
  },
  reminder_before_open: {
    sms: '{org_name}: Upigaji kura wa {event_name} unaanza {start_time} hadi {end_time}. Tumia msimbo uliotumiwa kwa SMS: {voting_link} au {ussd_code}',
    subject: 'Kura inaanza hivi karibuni: {event_name}',
  },
  voting_open: {
    sms: '{org_name}: Upigaji kura wa {event_name} umefunguliwa hadi {end_time}. Piga kura: {voting_link} au {ussd_code}',
    subject: 'Kura imefunguliwa: {event_name}',
  },
  reminder_before_close: {
    sms: '{org_name}: Upigaji kura wa {event_name} unafungwa {end_time}. Kama bado hujapiga kura: {voting_link} au {ussd_code}',
    subject: 'Kura inafungwa hivi karibuni: {event_name}',
  },
  vote_confirmation: {
    sms: '{org_name}: Kura yako katika {event_name} imepokelewa. Asante kwa kupiga kura.',
    subject: 'Kura yako imepokelewa: {event_name}',
  },
  results_published: {
    sms: '{org_name}: Matokeo ya {event_name} yametangazwa: {results_link}',
    subject: 'Matokeo: {event_name}',
  },
  event_cancelled: {
    sms: '{org_name}: Uchaguzi wa {event_name} umesitishwa. Msimbo wako hautatumika.',
    subject: 'Uchaguzi umesitishwa: {event_name}',
  },
  event_extended: {
    sms: '{org_name}: Muda wa kupiga kura katika {event_name} umeongezwa hadi {end_time}. Piga kura: {voting_link}',
    subject: 'Muda wa kura umeongezwa: {event_name}',
  },
};

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/** Placeholders in a text that are not in the list (a template with any is refused). */
export function unknownPlaceholders(text: string): string[] {
  const allowed = MESSAGE_PLACEHOLDERS as readonly string[];
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))].filter(
    (name) => !allowed.includes(name),
  );
}

export function renderTemplate(text: string, values: PlaceholderValues): string {
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    (MESSAGE_PLACEHOLDERS as readonly string[]).includes(name)
      ? (values[name as MessagePlaceholder] ?? '')
      : whole,
  );
}

// GSM 03.38: the basic set counts 1, the extension set 2 (ESC + char). Anything else forces
// UCS-2 (70 per SMS, 67 per part when split).
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€';

export interface SmsLength {
  encoding: 'gsm7' | 'ucs2';
  characters: number;
  segments: number;
}

/** PRD SMS-04: characters and the number of SMS the text is billed as. */
export function smsLength(text: string): SmsLength {
  let units = 0;
  let gsm = true;
  for (const char of text) {
    if (GSM_BASIC.includes(char)) units += 1;
    else if (GSM_EXTENDED.includes(char)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    return {
      encoding: 'gsm7',
      characters: units,
      segments: units <= 160 ? 1 : Math.ceil(units / 153),
    };
  }
  const length = [...text].length;
  return {
    encoding: 'ucs2',
    characters: length,
    segments: length <= 70 ? 1 : Math.ceil(length / 67),
  };
}

// ---------------------------------------------------------------------------------------------
// Templates (GET / PUT /events/:eventId/templates, POST …/templates/preview)
// ---------------------------------------------------------------------------------------------

export const templateSources = ['event', 'organization', 'default'] as const;

export const MessageTemplateSchema = z.object({
  type: MessageTypeSchema,
  channel: MessageChannelSchema,
  subject: z.string().nullable(),
  body: z.string(),
  /** Where the text comes from: this event, the organization default, or built in. */
  source: z.enum(templateSources),
});
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

export const TemplatesResponseSchema = z.object({ items: z.array(MessageTemplateSchema) });
export type TemplatesResponse = z.infer<typeof TemplatesResponseSchema>;

const templateBody = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((text) => unknownPlaceholders(text).length === 0, 'unknown placeholder');

/** PUT: the event's own texts; `body: null` removes the event text (back to the default). */
export const PutTemplatesRequestSchema = z
  .object({
    templates: z
      .array(
        z
          .object({
            type: MessageTypeSchema,
            channel: MessageChannelSchema,
            subject: z.string().trim().max(200).nullable().optional(),
            body: templateBody.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(messageTypes.length * 2),
  })
  .strict();
export type PutTemplatesRequest = z.infer<typeof PutTemplatesRequestSchema>;

export const PreviewTemplateRequestSchema = z
  .object({
    type: MessageTypeSchema,
    channel: MessageChannelSchema,
    body: z.string().max(2000),
    subject: z.string().max(200).nullable().optional(),
  })
  .strict();
export type PreviewTemplateRequest = z.infer<typeof PreviewTemplateRequestSchema>;

export const PreviewTemplateResponseSchema = z.object({
  text: z.string(),
  subject: z.string().nullable(),
  encoding: z.enum(['gsm7', 'ucs2']),
  characters: z.number().int(),
  segments: z.number().int(),
  unknownPlaceholders: z.array(z.string()),
});
export type PreviewTemplateResponse = z.infer<typeof PreviewTemplateResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Batches (POST / GET /events/:eventId/batches and controls)
// ---------------------------------------------------------------------------------------------

/** What staff send by hand: codes (App Flow 6.7 Send) and the reminder to non-voters. */
export const manualMessageTypes = ['code_delivery', 'reminder_before_close'] as const;
export const manualAudiences = ['all', 'not_sent', 'failed', 'not_voted'] as const;

export const CreateBatchRequestSchema = z
  .object({
    type: z.enum(manualMessageTypes),
    channel: MessageChannelSchema.default('sms'),
    audience: z.enum(manualAudiences),
  })
  .strict();
export type CreateBatchRequest = z.input<typeof CreateBatchRequestSchema>;

export const BatchEstimateQuerySchema = z.object({
  type: z.enum(manualMessageTypes),
  channel: MessageChannelSchema.default('sms'),
  audience: z.enum(manualAudiences),
});
export type BatchEstimateQuery = z.input<typeof BatchEstimateQuerySchema>;

export const BatchEstimateSchema = z.object({
  recipients: z.number().int(),
  /** SMS parts per message with typical values, and the total to be billed. */
  segments: z.number().int(),
  smsCount: z.number().int(),
});
export type BatchEstimate = z.infer<typeof BatchEstimateSchema>;

export const BatchSchema = z.object({
  id: z.uuid(),
  type: MessageTypeSchema,
  channel: MessageChannelSchema,
  audience: BatchAudienceSchema,
  status: BatchStatusSchema,
  totalCount: z.number().int(),
  sentCount: z.number().int(),
  deliveredCount: z.number().int(),
  failedCount: z.number().int(),
  /** Messages not yet sent or failed: queued or waiting for a retry. */
  pendingCount: z.number().int(),
  pausedReason: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type Batch = z.infer<typeof BatchSchema>;

export const BatchPageSchema = pageSchema(BatchSchema);
export type BatchPage = z.infer<typeof BatchPageSchema>;

export const BatchMessagesQuerySchema = PaginationQuerySchema.extend({
  status: MessageStatusSchema.optional(),
});
export type BatchMessagesQuery = z.infer<typeof BatchMessagesQuerySchema>;

export const BatchMessageSchema = z.object({
  id: z.uuid(),
  voterId: z.uuid().nullable(),
  voterName: z.string().nullable(),
  /** Phone with all but the last 3 digits hidden, or the email address. */
  to: z.string(),
  status: MessageStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
});
export type BatchMessage = z.infer<typeof BatchMessageSchema>;

export const BatchMessagePageSchema = pageSchema(BatchMessageSchema);
export type BatchMessagePage = z.infer<typeof BatchMessagePageSchema>;

/** A message in a voter's SMS history (EVT-05a): the redacted text, never the code. */
export const VoterMessageSchema = z.object({
  id: z.uuid(),
  type: MessageTypeSchema,
  channel: MessageChannelSchema,
  status: MessageStatusSchema,
  bodyRedacted: z.string(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
});
export type VoterMessage = z.infer<typeof VoterMessageSchema>;
