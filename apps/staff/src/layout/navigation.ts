// Sidebar menu by role (App Flow 3.3, Design System 8.1): an item appears only when the user holds
// at least one permission behind it. Platform administrators hold only platform permissions, so
// they get the platform versions of Audit log and Settings.
import type { MeResponse, PermissionKey } from '@vote-kidigit/shared';
import type { ParseKeys } from 'i18next';
import { hasAnyPermission } from '../auth/useAuth';

export type NavIcon =
  'dashboard' | 'organizations' | 'events' | 'users' | 'roles' | 'audit' | 'settings';

export interface NavItem {
  key: string;
  path: string;
  label: ParseKeys;
  icon: NavIcon;
  group: 'work' | 'admin';
}

interface NavRule extends NavItem {
  /** Any of these permissions shows the item; empty means every signed-in user. */
  anyOf: readonly PermissionKey[];
}

const RULES: NavRule[] = [
  {
    key: 'dashboard',
    path: '/',
    label: 'nav.dashboard',
    icon: 'dashboard',
    group: 'work',
    anyOf: [],
  },
  {
    key: 'organizations',
    path: '/platform/orgs',
    label: 'nav.organizations',
    icon: 'organizations',
    group: 'work',
    anyOf: ['platform.orgs.manage'],
  },
  {
    key: 'events',
    path: '/events',
    label: 'nav.events',
    icon: 'events',
    group: 'work',
    anyOf: ['event.view', 'event.create'],
  },
  {
    key: 'users',
    path: '/users',
    label: 'nav.users',
    icon: 'users',
    group: 'admin',
    anyOf: ['staff.manage'],
  },
  {
    key: 'roles',
    path: '/roles',
    label: 'nav.roles',
    icon: 'roles',
    group: 'admin',
    anyOf: ['roles.manage'],
  },
  {
    key: 'platform-audit',
    path: '/platform/audit',
    label: 'nav.audit',
    icon: 'audit',
    group: 'admin',
    anyOf: ['platform.audit.view'],
  },
  {
    key: 'audit',
    path: '/audit',
    label: 'nav.audit',
    icon: 'audit',
    group: 'admin',
    anyOf: ['audit.view.org'],
  },
  {
    key: 'platform-settings',
    path: '/platform/settings',
    label: 'nav.settings',
    icon: 'settings',
    group: 'admin',
    anyOf: ['platform.settings.manage'],
  },
  {
    key: 'settings',
    path: '/settings',
    label: 'nav.settings',
    icon: 'settings',
    group: 'admin',
    anyOf: ['org.settings.manage'],
  },
];

export function navItems(me: MeResponse): NavItem[] {
  return RULES.filter((rule) => rule.anyOf.length === 0 || hasAnyPermission(me, rule.anyOf)).map(
    ({ key, path, label, icon, group }) => ({ key, path, label, icon, group }),
  );
}

/** The menu key of the section a path belongs to ('/users/123' → 'users'). */
export function activeNavKey(items: NavItem[], pathname: string): string | undefined {
  const match = items
    .filter((item) => (item.path === '/' ? pathname === '/' : pathname.startsWith(item.path)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match?.key;
}
