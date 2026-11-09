import { z } from 'zod';
import { EmailSchema, PhoneSchema } from './auth.js';
import { AuditQuerySchema } from './audit.js';
import { optionalText, TimeZoneSchema } from './common.js';
import { OrganizationNameSchema, SessionTimeoutSchema, SmsSenderIdSchema } from './platform.js';

// The organization's own settings (SYS-03) and onboarding (App Flow 7.4).

/** Onboarding checklist items, in order (App Flow 7.4 step 3). */
export const onboardingItems = [
  'timeZone',
  'branding',
  'smsSender',
  'moderator',
  'firstEvent',
] as const;
export type OnboardingItem = (typeof onboardingItems)[number];

export const OrganizationSettingsSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  /** GET /api/v1/files/:id of the logo, or null without one. */
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  timeZone: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  smsSenderId: z.string().nullable(),
  helpPhone: z.string().nullable(),
  sessionTimeoutMinutes: z.number().int(),
  archiveAfterDays: z.number().int(),
  onboarding: z.object({
    dismissed: z.boolean(),
    items: z.array(z.object({ key: z.enum(onboardingItems), done: z.boolean() })),
  }),
});
export type OrganizationSettings = z.infer<typeof OrganizationSettingsSchema>;

/** Stored upper case, as the database requires (Backend Schema 4.1). */
export const PrimaryColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'must be a colour like #0B6E8A')
  .transform((value) => value.toUpperCase());

/** SYS-03 sections each save their own fields. */
export const UpdateOrganizationSettingsRequestSchema = z
  .object({
    name: OrganizationNameSchema,
    primaryColor: optionalText(PrimaryColorSchema),
    timeZone: TimeZoneSchema,
    sessionTimeoutMinutes: SessionTimeoutSchema,
    smsSenderId: optionalText(SmsSenderIdSchema),
    helpPhone: optionalText(PhoneSchema),
    contactEmail: optionalText(EmailSchema),
    contactPhone: optionalText(PhoneSchema),
    archiveAfterDays: z.number().int().min(7).max(3650),
    /** Hides (true) or shows again (false) the setup checklist card. */
    onboardingDismissed: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');
export type UpdateOrganizationSettingsRequest = z.infer<
  typeof UpdateOrganizationSettingsRequestSchema
>;

/** GET /audit (SYS-01): date range, user, event and action type. */
export const OrgAuditQuerySchema = AuditQuerySchema.extend({ eventId: z.uuid().optional() });
export type OrgAuditQuery = z.infer<typeof OrgAuditQuerySchema>;
