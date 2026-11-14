// Public website forms (App Flow 4.1 PUB-04, PUB-05; Implementation Plan step 38):
// POST /api/v1/public/contact. Both forms post here; the worker emails the Vote-Kidigit team and
// nothing is stored. The staff-free voter app validates with the same schemas.
import { z } from 'zod';
import { EmailSchema } from './auth.js';
import { normalizePhone } from './voters.js';

export const CONTACT_MESSAGE_MAX = 2000;
export const EXPECTED_VOTERS_MAX = 1_000_000;

/** Empty form fields arrive as ""; optional fields treat them as missing. */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** A Tanzanian number in any common form (stored +255…), or another country's in E.164. */
export const ContactPhoneSchema = z
  .string()
  .trim()
  .max(30)
  .transform((value, ctx) => {
    const compact = value.replace(/[\s\-().]/g, '');
    const phone = normalizePhone(value) ?? (/^\+[1-9]\d{7,14}$/.test(compact) ? compact : null);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'invalid phone number' });
      return z.NEVER;
    }
    return phone;
  });

/** YYYY-MM-DD, a real calendar day. */
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'invalid date');

const common = {
  name: z.string().trim().min(2).max(100),
  email: EmailSchema,
  /** Language of the page the visitor used, so the team can answer in it. */
  language: z.enum(['sw', 'en']).default('sw'),
  /** Honeypot: hidden from people, filled by bots. Accepted, then silently dropped. */
  website: z.string().max(200).optional(),
};

export const ContactMessageSchema = z.object({
  kind: z.literal('contact'),
  ...common,
  phone: z.preprocess(blankToUndefined, ContactPhoneSchema.optional()),
  message: z.string().trim().min(10).max(CONTACT_MESSAGE_MAX),
});

export const DemoRequestSchema = z.object({
  kind: z.literal('demo'),
  ...common,
  organization: z.string().trim().min(2).max(150),
  phone: ContactPhoneSchema,
  expectedVoters: z.number().int().min(1).max(EXPECTED_VOTERS_MAX),
  preferredDate: DateSchema,
  message: z.preprocess(blankToUndefined, z.string().trim().max(CONTACT_MESSAGE_MAX).optional()),
});

export const PublicContactRequestSchema = z.discriminatedUnion('kind', [
  ContactMessageSchema,
  DemoRequestSchema,
]);

export type ContactMessage = z.output<typeof ContactMessageSchema>;
export type DemoRequest = z.output<typeof DemoRequestSchema>;
export type PublicContactRequest = z.output<typeof PublicContactRequestSchema>;
/** A request without the honeypot: what the team email is made from. */
export type PublicContactPayload = Omit<ContactMessage, 'website'> | Omit<DemoRequest, 'website'>;
