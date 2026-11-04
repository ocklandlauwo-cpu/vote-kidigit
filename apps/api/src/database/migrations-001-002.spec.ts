// Integration test for migrations 001_helpers and 002_enums, run as vk_api (the application
// role): schema privileges, helper functions, generic triggers and the enum definitions.
import { pgEnums } from '@vote-kidigit/shared';
import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../config/config.module.js';
import * as PrismaEnums from '../generated/prisma/enums.js';
import { PrismaService } from './prisma.service.js';

describe('migrations 001_helpers and 002_enums', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [PrismaService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('schemas and privileges', () => {
    it('gives vk_api usage of public, app and audit but nothing on ballot', async () => {
      const rows = await prisma.$queryRaw<{ schema: string; usage: boolean; create: boolean }[]>`
        SELECT s AS schema,
               has_schema_privilege('vk_api', s, 'USAGE') AS usage,
               has_schema_privilege('vk_api', s, 'CREATE') AS create
        FROM unnest(ARRAY['public', 'app', 'audit', 'ballot']) AS s`;
      expect(rows).toEqual([
        { schema: 'public', usage: true, create: false },
        { schema: 'app', usage: true, create: false },
        { schema: 'audit', usage: true, create: false },
        { schema: 'ballot', usage: false, create: false },
      ]);
    });

    it('runs as a role that is not the owner and cannot bypass RLS', async () => {
      const [row] = await prisma.$queryRaw<{ role: string; bypass: boolean; owner: string }[]>`
        SELECT current_user AS role, r.rolbypassrls AS bypass,
               pg_get_userbyid(n.nspowner) AS owner
        FROM pg_roles r, pg_namespace n
        WHERE r.rolname = current_user AND n.nspname = 'app'`;
      expect(row).toEqual({ role: 'vk_api', bypass: false, owner: 'vk_owner' });
    });

    it('lets vk_api, and not PUBLIC, execute the app functions', async () => {
      const rows = await prisma.$queryRaw<{ fn: string; api: boolean; anyone: boolean }[]>`
        SELECT p.proname AS fn,
               has_function_privilege('vk_api', p.oid, 'EXECUTE') AS api,
               EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))
                       WHERE grantee = 0 AND privilege_type = 'EXECUTE') AS anyone
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'app' ORDER BY p.proname`;
      // 001's helpers are present; later migrations add more, and every app function follows
      // the same rule (Backend Schema 11: EXECUTE revoked from PUBLIC, granted to vk_api).
      expect(rows.map((r) => r.fn)).toEqual(
        expect.arrayContaining([
          'current_org_id',
          'current_user_id',
          'forbid_change',
          'is_platform_admin',
          'set_updated_at',
        ]),
      );
      for (const row of rows) expect(row).toMatchObject({ api: true, anyone: false });
    });

    it('has the pg_trgm extension', async () => {
      const rows = await prisma.$queryRaw<{ extname: string }[]>`
        SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
      expect(rows).toHaveLength(1);
    });
  });

  describe('generic triggers', () => {
    it('app.forbid_change rejects UPDATE and DELETE with IMMUTABLE_RECORD', async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`CREATE TEMP TABLE immutable_probe (id int) ON COMMIT DROP`;
        await tx.$executeRaw`CREATE TRIGGER immutable_probe_guard BEFORE UPDATE OR DELETE
          ON immutable_probe FOR EACH ROW EXECUTE FUNCTION app.forbid_change()`;
        await tx.$executeRaw`INSERT INTO immutable_probe VALUES (1)`;
        for (const statement of [
          'UPDATE immutable_probe SET id = 2',
          'DELETE FROM immutable_probe',
        ]) {
          await tx.$executeRaw`SAVEPOINT probe`;
          await expect(tx.$executeRawUnsafe(statement)).rejects.toThrow('IMMUTABLE_RECORD');
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT probe`;
        }
      });
    });

    it('app.set_updated_at stamps updated_at on UPDATE', async () => {
      const stamped = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`CREATE TEMP TABLE updated_probe (id int, updated_at timestamptz)
          ON COMMIT DROP`;
        await tx.$executeRaw`CREATE TRIGGER updated_probe_stamp BEFORE UPDATE ON updated_probe
          FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()`;
        await tx.$executeRaw`INSERT INTO updated_probe VALUES (1, '2000-01-01T00:00:00Z')`;
        await tx.$executeRaw`UPDATE updated_probe SET id = 2`;
        const [row] = await tx.$queryRaw<{ recent: boolean }[]>`
          SELECT updated_at > now() - interval '1 minute' AS recent FROM updated_probe`;
        return row?.recent;
      });
      expect(stamped).toBe(true);
    });
  });

  describe('enums (Backend Schema 3)', () => {
    it('match between PostgreSQL, Prisma and the shared Zod enums, in order', async () => {
      const rows = await prisma.$queryRaw<{ name: string; labels: string[] }[]>`
        SELECT t.typname::text AS name,
               array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public'
        GROUP BY t.typname ORDER BY t.typname`;
      const database = Object.fromEntries(rows.map((r) => [r.name, r.labels]));
      expect(database).toEqual(
        Object.fromEntries(Object.entries(pgEnums).map(([k, v]) => [k, [...v]])),
      );

      // Prisma enum objects: { value: 'value' } in declaration order
      const prismaLabels = Object.values(PrismaEnums as Record<string, unknown>)
        .filter((value) => typeof value === 'object' && value !== null)
        .map((value) => Object.values(value as Record<string, string>));
      expect(prismaLabels).toHaveLength(Object.keys(pgEnums).length);
      for (const labels of Object.values(pgEnums)) expect(prismaLabels).toContainEqual([...labels]);
    });
  });
});
