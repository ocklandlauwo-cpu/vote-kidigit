// Control room (CTL-01, App Flow 6.10; Backend Schema 12.5): turnout overall, per category and
// per channel, countdowns, kiosks and alerts. Never anything per contester before close.
import { z } from 'zod';
import { CategoryStatusSchema } from './categories.js';
import { KioskSessionSchema } from './kiosk.js';
import { BatchSchema } from './messages.js';

export const LiveCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: CategoryStatusSchema,
  manualState: z.enum(['auto', 'open', 'closed']),
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  /** Voters who voted in this category, of those eligible for it. */
  voted: z.number().int(),
  eligible: z.number().int(),
});
export type LiveCategory = z.infer<typeof LiveCategorySchema>;

export const liveAlertKinds = ['lockouts', 'sms_failures', 'closing_soon'] as const;

export const LiveAlertSchema = z.object({
  kind: z.enum(liveAlertKinds),
  /** lockouts: voters locked out; sms_failures: failed messages in the last batch. */
  count: z.number().int().nullable(),
  /** closing_soon: the category (null for the whole event) and when. */
  categoryId: z.uuid().nullable(),
  name: z.string().nullable(),
  at: z.iso.datetime().nullable(),
});
export type LiveAlert = z.infer<typeof LiveAlertSchema>;

export const LiveSchema = z.object({
  status: z.string(),
  endAt: z.iso.datetime(),
  turnout: z.object({
    voted: z.number().int(),
    registered: z.number().int(),
    percent: z.number(),
  }),
  categories: z.array(LiveCategorySchema),
  channels: z.object({ web: z.number().int(), ussd: z.number().int(), kiosk: z.number().int() }),
  notVoted: z.number().int(),
  lastBatch: BatchSchema.nullable(),
  /** Running kiosks; null when the caller may not operate kiosks. */
  kiosks: z.array(KioskSessionSchema).nullable(),
  alerts: z.array(LiveAlertSchema),
  updatedAt: z.iso.datetime(),
});
export type Live = z.infer<typeof LiveSchema>;
