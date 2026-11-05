import { z } from 'zod';
import { UserStatusSchema } from '../constants/enums.js';
import { AuditEntrySchema } from './audit.js';
import { EmailSchema, PhoneSchema } from './auth.js';
import { optionalText, pageSchema, PaginationQuerySchema } from './common.js';
import { type PermissionKey, permissionKeys, permissionScope } from './permissions.js';

// Users and roles (Backend Schema 12.4, App Flow 7.1).

export const FullNameSchema = z.string().trim().min(2).max(120);

/**
 * Permissions that make a role admin-level: the organization-wide ones beyond the Moderator and
 * Observer defaults (Backend Schema 9.2). Managing a user who holds (or would get) such a role
 * needs admins.manage, so an Admin cannot hand out more than staff work (Backend Schema 12.4:
 * "+ admins.manage to invite an Admin").
 */
export const ADMIN_LEVEL_PERMISSIONS: readonly PermissionKey[] = [
  'staff.manage',
  'admins.manage',
  'roles.manage',
  'assignments.manage',
  'org.settings.manage',
  'audit.view.org',
  'event.access_all',
  'event.activate',
  'event.reopen',
  'event.archive',
];

export function isAdminLevel(permissions: readonly string[]): boolean {
  return permissions.some((key) => (ADMIN_LEVEL_PERMISSIONS as readonly string[]).includes(key));
}

export const RoleRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  systemKey: z.string().nullable(),
});
export type RoleRef = z.infer<typeof RoleRefSchema>;

/** A row of USR-01. Event mappings join with event_assignments (step 15). */
export const UserSummarySchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  status: UserStatusSchema,
  isOrgSuperAdmin: z.boolean(),
  role: RoleRefSchema.nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const UserListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: UserStatusSchema.optional(),
  roleId: z.uuid().optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const UserPageSchema = pageSchema(UserSummarySchema);
export type UserPage = z.infer<typeof UserPageSchema>;

/**
 * One line of a user's recent activity: who did what and when. The values changed, reasons and
 * IP addresses stay in the audit log, for audit.view.org (security review of step 14).
 */
export const ActivityItemSchema = AuditEntrySchema.pick({
  id: true,
  action: true,
  actorLabel: true,
  createdAt: true,
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;

/** USR-03 side panel. */
export const UserDetailSchema = UserSummarySchema.extend({
  /** The pending invitation of an invited user. */
  invitation: z.object({ sentAt: z.iso.datetime(), expiresAt: z.iso.datetime() }).nullable(),
  recentActivity: z.array(ActivityItemSchema),
});
export type UserDetail = z.infer<typeof UserDetailSchema>;

/** USR-02. Event mappings are added with the events tables (step 15). */
export const InviteUserRequestSchema = z.object({
  fullName: FullNameSchema,
  email: EmailSchema,
  phone: optionalText(PhoneSchema).optional(),
  roleId: z.uuid(),
});
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const InviteUserResponseSchema = z.object({
  user: UserDetailSchema,
  /** false: the user is saved but the invitation could not be queued ("Resend"). */
  invitationSent: z.boolean(),
});
export type InviteUserResponse = z.infer<typeof InviteUserResponseSchema>;

export const UpdateUserRequestSchema = z
  .object({
    fullName: FullNameSchema,
    phone: optionalText(PhoneSchema),
    roleId: z.uuid(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

/** GET /users/roles: the roles the invite and edit forms offer, and which the caller may give. */
export const AssignableRoleSchema = RoleRefSchema.extend({
  isSystem: z.boolean(),
  assignable: z.boolean(),
});
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

export const AssignableRoleListResponseSchema = z.object({ items: z.array(AssignableRoleSchema) });
export type AssignableRoleListResponse = z.infer<typeof AssignableRoleListResponseSchema>;

// Roles

/** Organization and event permissions only: platform permissions are never stored in roles. */
export const RolePermissionKeySchema = z
  .enum(permissionKeys)
  .refine((key) => permissionScope(key) !== 'platform', 'is a platform permission');

export const RoleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  systemKey: z.string().nullable(),
  isSystem: z.boolean(),
  userCount: z.number().int(),
  permissions: z.array(z.enum(permissionKeys)),
});
export type Role = z.infer<typeof RoleSchema>;

export const RoleListResponseSchema = z.object({ items: z.array(RoleSchema) });
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;

export const RoleNameSchema = z.string().trim().min(2).max(60);

export const CreateRoleRequestSchema = z.object({
  name: RoleNameSchema,
  description: optionalText(z.string().trim().max(200)).optional(),
  permissions: z.array(RolePermissionKeySchema).max(64),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

/** Default roles keep their name; their permissions can change (except fixed ones). */
export const UpdateRoleRequestSchema = z
  .object({
    name: RoleNameSchema,
    description: optionalText(z.string().trim().max(200)),
    permissions: z.array(RolePermissionKeySchema).max(64),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;

/** DELETE /roles/:roleId?moveToRoleId=… — a role in use needs a role for its users. */
export const DeleteRoleQuerySchema = z.object({ moveToRoleId: z.uuid().optional() });
export type DeleteRoleQuery = z.infer<typeof DeleteRoleQuerySchema>;
