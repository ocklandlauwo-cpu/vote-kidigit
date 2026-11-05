import { z } from 'zod';

// Permission catalogue (Backend Schema 9.1). The database table `permissions` is seeded from the
// same list (migration 008) and a test fails when the two disagree.

export const permissionScopes = ['org', 'event', 'platform'] as const;
export type PermissionScope = (typeof permissionScopes)[number];

export const PERMISSION_CATALOGUE = [
  { key: 'roles.manage', scope: 'org', module: 'Users' },
  { key: 'admins.manage', scope: 'org', module: 'Users' },
  { key: 'staff.manage', scope: 'org', module: 'Users' },
  { key: 'assignments.manage', scope: 'org', module: 'Users' },
  { key: 'org.settings.manage', scope: 'org', module: 'Settings' },
  { key: 'audit.view.org', scope: 'org', module: 'Audit' },
  { key: 'event.create', scope: 'org', module: 'Events' },
  { key: 'event.access_all', scope: 'org', module: 'Events' },
  { key: 'event.activate', scope: 'event', module: 'Events' },
  { key: 'event.reopen', scope: 'event', module: 'Events' },
  { key: 'event.archive', scope: 'event', module: 'Events' },
  { key: 'event.view', scope: 'event', module: 'Events' },
  { key: 'event.edit', scope: 'event', module: 'Events' },
  { key: 'event.publish', scope: 'event', module: 'Events' },
  { key: 'event.close', scope: 'event', module: 'Events' },
  { key: 'event.cancel', scope: 'event', module: 'Events' },
  { key: 'category.manage', scope: 'event', module: 'Setup' },
  { key: 'contester.manage', scope: 'event', module: 'Setup' },
  { key: 'voter.view', scope: 'event', module: 'Voters' },
  { key: 'voter.manage', scope: 'event', module: 'Voters' },
  { key: 'messages.send', scope: 'event', module: 'Messages' },
  { key: 'code.regenerate', scope: 'event', module: 'Messages' },
  { key: 'kiosk.operate', scope: 'event', module: 'Kiosk' },
  { key: 'turnout.view', scope: 'event', module: 'Results' },
  { key: 'results.view', scope: 'event', module: 'Results' },
  { key: 'results.resolve_tie', scope: 'event', module: 'Results' },
  { key: 'results.publish', scope: 'event', module: 'Results' },
  { key: 'reports.download', scope: 'event', module: 'Results' },
  { key: 'audit.view.event', scope: 'event', module: 'Audit' },
  { key: 'platform.orgs.manage', scope: 'platform', module: 'Platform' },
  { key: 'platform.settings.manage', scope: 'platform', module: 'Platform' },
  { key: 'platform.audit.view', scope: 'platform', module: 'Platform' },
] as const satisfies readonly { key: string; scope: PermissionScope; module: string }[];

export type PermissionKey = (typeof PERMISSION_CATALOGUE)[number]['key'];

export const permissionKeys = PERMISSION_CATALOGUE.map((p) => p.key) as [
  PermissionKey,
  ...PermissionKey[],
];

const scopes = new Map<string, PermissionScope>(PERMISSION_CATALOGUE.map((p) => [p.key, p.scope]));

/** The scope of a permission; undefined for a key not in the catalogue. */
export function permissionScope(key: string): PermissionScope | undefined {
  return scopes.get(key);
}

/** Org Super Admin always holds this one; the role editor shows it fixed. */
export const FIXED_SUPER_ADMIN_PERMISSIONS: readonly PermissionKey[] = ['roles.manage'];

/** Every platform administrator holds the platform permissions; they are not stored in roles. */
export const PLATFORM_PERMISSIONS = PERMISSION_CATALOGUE.filter((p) => p.scope === 'platform').map(
  (p) => p.key,
);

export const systemRoleKeys = ['org_super_admin', 'admin', 'moderator', 'observer'] as const;
export type SystemRoleKey = (typeof systemRoleKeys)[number];

/** GET /permissions: the catalogue for the role editor, in both languages. */
export const PermissionSchema = z.object({
  key: z.enum(permissionKeys),
  scope: z.enum(permissionScopes),
  module: z.string(),
  descriptionEn: z.string(),
  descriptionSw: z.string(),
  isFixedForSuperAdmin: z.boolean(),
});
export type Permission = z.infer<typeof PermissionSchema>;

export const PermissionListResponseSchema = z.object({ items: z.array(PermissionSchema) });
export type PermissionListResponse = z.infer<typeof PermissionListResponseSchema>;
