// Integration test (Implementation Plan step 6): withContext sets the request context as
// transaction-local settings and isolates it per transaction. Needs migrations 001-002 applied.
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../config/config.module.js';
import { PrismaService, type DbContext, type Tx } from './prisma.service.js';

interface SeenContext {
  orgId: string | null;
  userId: string | null;
  isPlatformAdmin: boolean;
  requestId: string | null;
}

async function readContext(tx: Tx | PrismaService): Promise<SeenContext> {
  const [row] = await tx.$queryRaw<SeenContext[]>`SELECT
    app.current_org_id()::text AS "orgId",
    app.current_user_id()::text AS "userId",
    app.is_platform_admin() AS "isPlatformAdmin",
    NULLIF(current_setting('app.request_id', true), '') AS "requestId"`;
  if (!row) throw new Error('no row');
  return row;
}

function context(overrides: Partial<DbContext> = {}): DbContext {
  return {
    orgId: randomUUID(),
    userId: randomUUID(),
    isPlatformAdmin: false,
    requestId: randomUUID(),
    ...overrides,
  };
}

/** Resolves once `count` callers have arrived, so transactions overlap for certain. */
function barrier(count: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const all = new Promise<void>((resolve) => (release = resolve));
  return () => {
    arrived += 1;
    if (arrived === count) release();
    return all;
  };
}

describe('PrismaService.withContext', () => {
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

  it('exposes the context to SQL through the app.* helper functions', async () => {
    const ctx = context({ isPlatformAdmin: true });
    const seen = await prisma.withContext(ctx, (tx) => readContext(tx));
    expect(seen).toEqual({
      orgId: ctx.orgId,
      userId: ctx.userId,
      isPlatformAdmin: true,
      requestId: ctx.requestId,
    });
  });

  it('maps a missing organization and user to NULL and platform admin to false', async () => {
    const ctx = context({ orgId: null, userId: null });
    const seen = await prisma.withContext(ctx, (tx) => readContext(tx));
    expect(seen).toMatchObject({ orgId: null, userId: null, isPlatformAdmin: false });
  });

  it('isolates the context of concurrent transactions', async () => {
    const contexts = Array.from({ length: 8 }, () => context());
    const allInside = barrier(contexts.length);

    const seen = await Promise.all(
      contexts.map((ctx) =>
        prisma.withContext(ctx, async (tx) => {
          const before = await readContext(tx);
          await allInside(); // every transaction is open with its own settings at this point
          const after = await readContext(tx);
          return { before, after };
        }),
      ),
    );

    seen.forEach(({ before, after }, i) => {
      expect(before.orgId).toBe(contexts[i]?.orgId);
      expect(after.orgId).toBe(contexts[i]?.orgId);
      expect(after.userId).toBe(contexts[i]?.userId);
    });
    expect(new Set(seen.map((s) => s.after.orgId)).size).toBe(contexts.length);
  });

  it('leaves nothing behind on pooled connections after the transaction', async () => {
    await Promise.all(Array.from({ length: 10 }, () => prisma.withContext(context(), readContext)));

    const afterwards = await Promise.all(Array.from({ length: 20 }, () => readContext(prisma)));
    for (const seen of afterwards) {
      expect(seen).toEqual({ orgId: null, userId: null, isPlatformAdmin: false, requestId: null });
    }
  });

  it('rolls back and rethrows when the callback fails', async () => {
    await expect(
      prisma.withContext(context(), async (tx) => {
        await tx.$executeRaw`CREATE TEMP TABLE with_context_probe (id int) ON COMMIT DROP`;
        await tx.$executeRaw`INSERT INTO with_context_probe VALUES (1)`;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('rejects a malformed organization or user id before touching the database', async () => {
    await expect(
      prisma.withContext(context({ orgId: "x'; DROP TABLE users; --" }), readContext),
    ).rejects.toThrow('withContext: orgId must be a UUID or null');
    await expect(
      prisma.withContext(context({ userId: 'not-a-uuid' }), readContext),
    ).rejects.toThrow('withContext: userId must be a UUID or null');
  });
});
