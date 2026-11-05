import type { MeResponse, PermissionKey } from '@vote-kidigit/shared';
import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '../auth/returnTo';
import { activeNavKey, navItems } from './navigation';

function me(permissions: PermissionKey[], isPlatformAdmin = false): MeResponse {
  return {
    id: '0190f0a1-2b3c-7d4e-8f90-123456789abc',
    email: 'a@example.test',
    fullName: 'A',
    phone: null,
    language: 'sw',
    themePreference: 'system',
    isPlatformAdmin,
    isOrgSuperAdmin: false,
    organization: null,
    role: null,
    permissions,
    mappedEventIds: [],
    csrfToken: 'x',
    sessionExpiresAt: new Date().toISOString(),
  };
}

// Backend Schema 9.2 defaults, enough for the menu.
const OBSERVER: PermissionKey[] = ['event.view', 'voter.view', 'results.view'];
const MODERATOR: PermissionKey[] = [...OBSERVER, 'event.create', 'event.edit'];
const ADMIN: PermissionKey[] = [
  ...MODERATOR,
  'staff.manage',
  'assignments.manage',
  'org.settings.manage',
  'audit.view.org',
  'event.access_all',
];
const SUPER_ADMIN: PermissionKey[] = [...ADMIN, 'roles.manage', 'admins.manage'];
const PLATFORM: PermissionKey[] = [
  'platform.orgs.manage',
  'platform.settings.manage',
  'platform.audit.view',
];

const keys = (user: MeResponse) => navItems(user).map((item) => item.key);

describe('sidebar menu by role (App Flow 3.3)', () => {
  it('Platform Super Admin', () => {
    expect(keys(me(PLATFORM, true))).toEqual([
      'dashboard',
      'organizations',
      'platform-audit',
      'platform-settings',
    ]);
  });

  it('Org Super Admin', () => {
    expect(keys(me(SUPER_ADMIN))).toEqual([
      'dashboard',
      'events',
      'users',
      'roles',
      'audit',
      'settings',
    ]);
  });

  it('Admin', () => {
    expect(keys(me(ADMIN))).toEqual(['dashboard', 'events', 'users', 'audit', 'settings']);
  });

  it('Moderator', () => {
    expect(keys(me(MODERATOR))).toEqual(['dashboard', 'events']);
  });

  it('Observer', () => {
    expect(keys(me(OBSERVER))).toEqual(['dashboard', 'events']);
  });

  it('marks the section of the current page', () => {
    const items = navItems(me(SUPER_ADMIN));
    expect(activeNavKey(items, '/')).toBe('dashboard');
    expect(activeNavKey(items, '/users/123')).toBe('users');
    expect(activeNavKey(items, '/events')).toBe('events');
    expect(activeNavKey(items, '/profile')).toBeUndefined();
  });
});

describe('safeReturnTo', () => {
  it('keeps paths inside the portal and refuses other sites', () => {
    expect(safeReturnTo('/users?page=2')).toBe('/users?page=2');
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
  });
});
