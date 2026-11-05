import { z } from 'zod';
import { OrgStatusSchema, UserStatusSchema } from '../constants/enums.js';
import { AuditEntrySchema } from './audit.js';
import { EmailSchema, PhoneSchema } from './auth.js';
import { optionalText, pageSchema, PaginationQuerySchema, TimeZoneSchema } from './common.js';

// Platform Super Admin endpoints (Backend Schema 12.3, App Flow 5.3).

export const DEFAULT_TIME_ZONE = 'Africa/Dar_es_Salaam';

export const OrganizationNameSchema = z.string().trim().min(2).max(120);
/** Registered NextSMS sender ID: up to 11 letters, digits or spaces. */
export const SmsSenderIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 ]{1,11}$/, 'must be 1–11 letters or digits');
export const SessionTimeoutSchema = z.number().int().min(5).max(60);
export const UssdShortCodeSchema = z
  .string()
  .trim()
  .regex(/^\*\d{2,6}(\*\d{1,4})*#$/, 'must look like *150*12#');

const SuperAdminSummarySchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  status: UserStatusSchema,
});

/** A row of PLT-01. Event and voter counts join with their tables (steps 15–16). */
export const OrganizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: OrgStatusSchema,
  superAdmin: SuperAdminSummarySchema.nullable(),
  staffCount: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;

export const OrganizationListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: OrgStatusSchema.optional(),
  sort: z.enum(['name', '-name', 'createdAt', '-createdAt']).default('-createdAt'),
});
export type OrganizationListQuery = z.infer<typeof OrganizationListQuerySchema>;

export const OrganizationPageSchema = pageSchema(OrganizationSummarySchema);
export type OrganizationPage = z.infer<typeof OrganizationPageSchema>;

/** PLT-03 Staff tab (read-only). */
export const OrganizationStaffSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  status: UserStatusSchema,
  isOrgSuperAdmin: z.boolean(),
  roleName: z.string().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
});
export type OrganizationStaff = z.infer<typeof OrganizationStaffSchema>;

export const OrganizationDetailSchema = OrganizationSummarySchema.extend({
  timeZone: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  smsSenderId: z.string().nullable(),
  helpPhone: z.string().nullable(),
  sessionTimeoutMinutes: z.number().int(),
  staff: z.array(OrganizationStaffSchema),
});
export type OrganizationDetail = z.infer<typeof OrganizationDetailSchema>;

/** PLT-02. The logo is uploaded separately once files exist (step 17). */
export const CreateOrganizationRequestSchema = z.object({
  name: OrganizationNameSchema,
  timeZone: TimeZoneSchema.default(DEFAULT_TIME_ZONE),
  contactEmail: optionalText(EmailSchema).optional(),
  contactPhone: optionalText(PhoneSchema).optional(),
  smsSenderId: optionalText(SmsSenderIdSchema).optional(),
  superAdmin: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: EmailSchema,
  }),
});
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequestSchema>;

export const CreateOrganizationResponseSchema = z.object({
  organization: OrganizationDetailSchema,
  /** false: the organization is saved but the invitation could not be queued ("Resend"). */
  invitationSent: z.boolean(),
});
export type CreateOrganizationResponse = z.infer<typeof CreateOrganizationResponseSchema>;

/** PLT-03 Settings tab. Omitted fields stay as they are; an empty string or null clears one. */
export const UpdateOrganizationRequestSchema = z
  .object({
    name: OrganizationNameSchema,
    timeZone: TimeZoneSchema,
    contactEmail: optionalText(EmailSchema),
    contactPhone: optionalText(PhoneSchema),
    smsSenderId: optionalText(SmsSenderIdSchema),
    helpPhone: optionalText(PhoneSchema),
    sessionTimeoutMinutes: SessionTimeoutSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequestSchema>;

/** Suspension needs a reason for the audit log; the UI also asks to type the name. */
export const SuspendOrganizationRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type SuspendOrganizationRequest = z.infer<typeof SuspendOrganizationRequestSchema>;

export const ReactivateOrganizationRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type ReactivateOrganizationRequest = z.infer<typeof ReactivateOrganizationRequestSchema>;

/** PLT-04. Default SMS templates join with sms_templates (step 21). */
export const PlatformSettingsSchema = z.object({
  defaultSessionTimeoutMinutes: z.number().int(),
  /** Shown to voters; null falls back to USSD_SHORT_CODE from the environment. */
  ussdShortCode: z.string().nullable(),
  supportPhone: z.string().nullable(),
  supportEmail: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;

export const UpdatePlatformSettingsRequestSchema = z
  .object({
    defaultSessionTimeoutMinutes: SessionTimeoutSchema,
    ussdShortCode: optionalText(UssdShortCodeSchema),
    supportPhone: optionalText(PhoneSchema),
    supportEmail: optionalText(EmailSchema),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');
export type UpdatePlatformSettingsRequest = z.infer<typeof UpdatePlatformSettingsRequestSchema>;

/** DSH-01 cards available so far; event, turnout and tie cards join from steps 15–28. */
export const PlatformDashboardSchema = z.object({
  organizations: z.object({
    total: z.number().int(),
    active: z.number().int(),
    suspended: z.number().int(),
  }),
  staffUsers: z.object({ active: z.number().int(), invited: z.number().int() }),
  recentActivity: z.array(AuditEntrySchema),
});
export type PlatformDashboard = z.infer<typeof PlatformDashboardSchema>;
