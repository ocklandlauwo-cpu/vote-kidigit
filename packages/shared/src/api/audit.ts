import { z } from 'zod';
import { ActorTypeSchema } from '../constants/enums.js';
import { pageSchema, PaginationQuerySchema } from './common.js';

/** One audit log entry as the audit screens show it (SYS-01, PLT-05). */
export const AuditEntrySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid().nullable(),
  organizationName: z.string().nullable(),
  actorType: ActorTypeSchema,
  actorUserId: z.uuid().nullable(),
  actorLabel: z.string(),
  eventId: z.uuid().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditQuerySchema = PaginationQuerySchema.extend({
  /** Action key or its start, e.g. "auth." or "platform.org.suspend". */
  action: z.string().trim().max(100).optional(),
  actorUserId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

/** GET /platform/audit adds an Organization filter (PLT-05); "platform" = platform actions only. */
export const PlatformAuditQuerySchema = AuditQuerySchema.extend({
  organizationId: z.union([z.uuid(), z.literal('platform')]).optional(),
});
export type PlatformAuditQuery = z.infer<typeof PlatformAuditQuerySchema>;

export const AuditPageSchema = pageSchema(AuditEntrySchema);
export type AuditPage = z.infer<typeof AuditPageSchema>;
