// Integration test: needs PostgreSQL from docker-compose.dev.yml (or the CI service) and apps/api/.env.
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { PrismaService } from './prisma.service.js';

function configWithDatabaseUrl(url: string): ConfigService<Env, true> {
  return { get: () => url } as unknown as ConfigService<Env, true>;
}

describe('PrismaService', () => {
  it('connects as vk_api, the role that cannot bypass row level security', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [PrismaService],
    }).compile();
    const prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();

    const [row] = await prisma.$queryRaw<{ role: string; bypass: boolean }[]>`
      SELECT current_user AS role, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ role: 'vk_api', bypass: false });
    expect(await prisma.isHealthy()).toBe(true);

    await moduleRef.close();
  });

  it('fails fast with a clear message, without the password, when DATABASE_URL is wrong', async () => {
    // AppConfigModule (imported above) has loaded apps/api/.env into process.env.
    const realUrl = new URL(process.env.DATABASE_URL ?? '');
    realUrl.password = 'definitely-wrong-password';
    const prisma = new PrismaService(configWithDatabaseUrl(realUrl.toString()));

    const failure = prisma.onModuleInit();
    await expect(failure).rejects.toThrow(
      `Cannot connect to PostgreSQL at ${realUrl.hostname}:${realUrl.port}/vote_kidigit as vk_api: ` +
        'password authentication failed for user "vk_api"',
    );
    await expect(failure).rejects.not.toThrow('definitely-wrong-password');
    await prisma.$disconnect();
  });

  it('fails fast when nothing listens at DATABASE_URL', async () => {
    const prisma = new PrismaService(
      configWithDatabaseUrl('postgresql://vk_api:pw@127.0.0.1:1/vote_kidigit'),
    );
    await expect(prisma.onModuleInit()).rejects.toThrow(
      'Cannot connect to PostgreSQL at 127.0.0.1:1/vote_kidigit as vk_api: database server not reachable',
    );
    await prisma.$disconnect();
  });
});
