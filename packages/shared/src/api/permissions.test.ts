import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOGUE,
  PLATFORM_PERMISSIONS,
  permissionKeys,
  permissionScope,
} from './permissions.js';

describe('permission catalogue', () => {
  it('has 32 unique keys (Backend Schema 9.1)', () => {
    expect(permissionKeys).toHaveLength(32);
    expect(new Set(permissionKeys).size).toBe(32);
  });

  it('knows the scope of each key', () => {
    expect(permissionScope('event.publish')).toBe('event');
    expect(permissionScope('event.create')).toBe('org');
    expect(permissionScope('platform.orgs.manage')).toBe('platform');
    expect(permissionScope('nothing.here')).toBeUndefined();
  });

  it('lists the three platform permissions', () => {
    expect(PLATFORM_PERMISSIONS).toEqual([
      'platform.orgs.manage',
      'platform.settings.manage',
      'platform.audit.view',
    ]);
    expect(PERMISSION_CATALOGUE.filter((p) => p.scope === 'event')).toHaveLength(21);
  });
});
