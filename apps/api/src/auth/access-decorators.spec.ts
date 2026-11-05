// Every route of the API is @Public, @SignedIn or @RequirePermission (CLAUDE.md: every
// controller method has an explicit permission decorator). PermissionGuard refuses the others
// at run time; this test finds them before they ship.
import { Module } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PERMISSION_CATALOGUE, permissionScope } from '@vote-kidigit/shared';
import { ApiModule } from '../api.module.js';
import { ownerClient } from '../testing/db.js';
import { IS_PUBLIC, REQUIRED_PERMISSION, SIGNED_IN } from './decorators.js';

describe('access decorators', () => {
  it('marks every route of the API', async () => {
    @Module({ imports: [ApiModule, DiscoveryModule] })
    class ScanModule {}
    const moduleRef = await Test.createTestingModule({ imports: [ScanModule] }).compile();
    const reflector = moduleRef.get(Reflector);
    const scanner = new MetadataScanner();
    const scanned: string[] = [];
    const unmarked: string[] = [];
    const eventRoutesWithoutParam: string[] = [];

    for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      const type = wrapper.metatype;
      if (!instance || !type || typeof type !== 'function') continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata('path', handler) === undefined) continue; // not a route
        scanned.push(`${type.name}.${name}`);
        const targets = [handler, type];
        const key = reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION, targets);
        const marked =
          reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ||
          reflector.getAllAndOverride<boolean>(SIGNED_IN, targets) ||
          key !== undefined;
        if (!marked) unmarked.push(`${type.name}.${name}`);
        const path = [Reflect.getMetadata('path', type), Reflect.getMetadata('path', handler)]
          .map(String)
          .join('/');
        if (key && permissionScope(key) === 'event' && !path.includes(':eventId')) {
          eventRoutesWithoutParam.push(`${type.name}.${name}`);
        }
      }
    }
    await moduleRef.close();
    expect(scanned).toEqual(
      expect.arrayContaining([
        'AuthController.login',
        'MeController.me',
        'PermissionsController.list',
      ]),
    );
    expect(unmarked).toEqual([]);
    expect(eventRoutesWithoutParam).toEqual([]);
  });
});

describe('permission catalogue', () => {
  it('matches the permissions table seeded by migration 008', async () => {
    const owner = ownerClient();
    // Other test files add temporary test.* permissions while they run.
    const rows = await owner.permission.findMany({
      where: { NOT: { key: { startsWith: 'test.' } } },
      orderBy: { key: 'asc' },
    });
    await owner.$disconnect();
    expect(rows.map(({ key, scope, module }) => ({ key, scope, module }))).toEqual(
      [...PERMISSION_CATALOGUE]
        .map(({ key, scope, module }) => ({ key, scope, module }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    );
    for (const row of rows) {
      expect(row.descriptionEn.length).toBeGreaterThan(3);
      expect(row.descriptionSw.length).toBeGreaterThan(3);
    }
    expect(rows.filter((r) => r.isFixedForSuperAdmin).map((r) => r.key)).toEqual(['roles.manage']);
  });
});
