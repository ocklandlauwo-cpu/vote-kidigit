import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { verifyPassword } from '../auth/passwords.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ownerClient, uniqueSuffix } from '../testing/db.js';
import { createPlatformAdmin, PlatformAdminInputSchema } from './create-platform-admin.js';

describe('create-platform-admin', () => {
  let app: TestingModule;
  let owner: PrismaClient;
  const userIds: string[] = [];

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.user.deleteMany({ where: { id: { in: userIds } } });
    await owner.$disconnect();
    await app.close();
  });

  it('creates an active platform administrator with a hashed password', async () => {
    const email = `admin-${uniqueSuffix()}@example.test`;
    const id = await createPlatformAdmin(app, {
      email,
      fullName: 'Platform Admin',
      password: 'Msimamizi2027',
    });
    userIds.push(id);

    const user = await owner.user.findUniqueOrThrow({ where: { id } });
    expect(user).toMatchObject({
      organizationId: null,
      isPlatformAdmin: true,
      status: 'active',
      fullName: 'Platform Admin',
    });
    expect(user.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash && (await verifyPassword(user.passwordHash, 'Msimamizi2027'))).toBe(
      true,
    );
    expect(await owner.passwordHistory.count({ where: { userId: id } })).toBe(1);
    const audit = await owner.auditLog.findFirstOrThrow({ where: { entityId: id } });
    expect(audit.action).toBe('platform_admin.create');
    expect(JSON.stringify(audit)).not.toContain('Msimamizi2027');
  });

  it('refuses an email that is already taken', async () => {
    const email = `admin-${uniqueSuffix()}@example.test`;
    userIds.push(
      await createPlatformAdmin(app, { email, fullName: 'First', password: 'Msimamizi2027' }),
    );
    await expect(
      createPlatformAdmin(app, {
        email: email.toUpperCase(),
        fullName: 'Second',
        password: 'Msimamizi2027',
      }),
    ).rejects.toThrow('already exists');
  });

  it('enforces the password policy on its input', () => {
    const result = PlatformAdminInputSchema.safeParse({
      email: 'a@example.test',
      fullName: 'Admin',
      password: 'weak',
    });
    expect(result.success).toBe(false);
  });
});
