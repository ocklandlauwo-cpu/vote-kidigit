// Who may give, edit and delete which roles (security review of step 14). Shared by the users and
// roles services so the same rules guard inviting, role changes, role edits and role deletion.
import { isAdminLevel } from '@vote-kidigit/shared';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';

export interface RoleFacts {
  id: string;
  systemKey: string | null;
  permissions: readonly string[];
}

export type Actor = Pick<AuthState, 'isOrgSuperAdmin' | 'permissions' | 'role'>;

/** Nobody hands out a permission they do not hold themselves (Org Super Admins hold them all). */
function holdsAll(actor: Actor, permissions: readonly string[]): boolean {
  return actor.isOrgSuperAdmin || permissions.every((key) => actor.permissions.includes(key));
}

/**
 * May the actor give this role to a user? Only an Org Super Admin gives that role; admin-level
 * roles need admins.manage; and the role's permissions must all be the actor's own.
 */
export function mayGrant(actor: Actor, role: RoleFacts): boolean {
  if (role.systemKey === 'org_super_admin') return actor.isOrgSuperAdmin;
  if (isAdminLevel(role.permissions) && !actor.permissions.includes('admins.manage')) return false;
  return holdsAll(actor, role.permissions);
}

/**
 * May the actor change a role's permissions to `next` (or delete it, with next = [])? Only an
 * Org Super Admin edits the Org Super Admin role or a role they hold themselves; admin-level
 * roles, before or after, need admins.manage; added permissions must be the actor's own.
 */
export function assertMayEditRole(actor: Actor, role: RoleFacts, next: readonly string[]): void {
  if (actor.isOrgSuperAdmin) return;
  if (role.systemKey === 'org_super_admin') {
    throw new AppError('FORBIDDEN', 'Only an Org Super Admin can change this role.');
  }
  if (actor.role?.id === role.id) {
    throw new AppError('FORBIDDEN', 'You cannot change the role you hold.');
  }
  if (
    (isAdminLevel(role.permissions) || isAdminLevel(next)) &&
    !actor.permissions.includes('admins.manage')
  ) {
    throw new AppError('FORBIDDEN', 'You cannot change admin-level roles.');
  }
  const added = next.filter((key) => !role.permissions.includes(key));
  if (!holdsAll(actor, added)) {
    throw new AppError('FORBIDDEN', 'You can only give permissions you hold yourself.');
  }
}

export interface UserFacts {
  isOrgSuperAdmin: boolean;
  /** Permissions of the user's role, or null without one. */
  permissions: readonly string[] | null;
}

/**
 * May the actor act on this user at all? Only an Org Super Admin acts on an Org Super Admin;
 * users with an admin-level role need admins.manage.
 */
export function assertMayManageUser(actor: Actor, user: UserFacts): void {
  if (user.isOrgSuperAdmin && !actor.isOrgSuperAdmin) {
    throw new AppError('FORBIDDEN', 'Only an Org Super Admin can change an Org Super Admin.');
  }
  if (
    user.permissions &&
    isAdminLevel(user.permissions) &&
    !actor.permissions.includes('admins.manage')
  ) {
    throw new AppError('FORBIDDEN', 'You cannot manage users with this role.');
  }
}
