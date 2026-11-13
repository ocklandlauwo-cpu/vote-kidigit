// CLI for the load test (Implementation Plan step 31, PRD NFR-01): creates a test organization
// with an Open event (two categories) and N voters with known codes, plus one Org Super Admin to
// read turnout and close the event, and writes what scripts/load/run.mjs needs to a JSON file.
//   node apps/api/dist/cli/seed-load.js --voters 5000 --out load-seed.json [--allow-production]
// The file holds every voter's code: it is test data, kept out of git, and deleted after the run.
// On the VPS (after step 34) it runs only with --allow-production, for a test organization.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { AppModule } from '../app.module.js';
import { hashPassword } from '../auth/passwords.js';
import type { Env } from '../config/env.schema.js';
import { RequestContextService, systemContext } from '../context/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { CodesService } from '../modules/voters/codes.service.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BATCH = 500;

export interface LoadSeed {
  organizationId: string;
  eventId: string;
  eventName: string;
  staff: { email: string; password: string };
  voters: { membershipId: string; code: string }[];
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const newCode = () =>
  Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) {
    throw new Error('seed-load creates a test organization; on production add --allow-production.');
  }
  const count = Number(argument('--voters') ?? '5000');
  const out = argument('--out');
  if (!out || !Number.isInteger(count) || count < 1) {
    throw new Error('Usage: seed-load --voters <n> --out <file.json> [--allow-production]');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const requestContext = app.get(RequestContextService);
    const codes = new CodesService(app.get(ConfigService<Env, true>));
    const tag = randomUUID().slice(0, 8);
    const ctx = { ...systemContext(randomUUID()), actorLabel: 'Load test seed' };
    const password = `Mzigo-${randomUUID()}`;
    const email = `load-${tag}@example.test`;

    const organizationId = await requestContext.run({ ...ctx, isPlatformAdmin: true }, () =>
      prisma.withContext({ ...ctx, isPlatformAdmin: true, orgId: null }, async (tx) => {
        const org = await tx.organization.create({
          data: { name: `Load test ${tag}`, slug: `load-${tag}`, smsSenderId: 'LOADTEST' },
          select: { id: true },
        });
        await tx.$executeRaw`SELECT app.create_default_roles(${org.id}::uuid)`;
        return org.id;
      }),
    );

    const orgCtx = { ...ctx, orgId: organizationId };
    const voters: LoadSeed['voters'] = Array.from({ length: count }, (_, i) => ({
      membershipId: `LT-${tag}-${String(i + 1).padStart(5, '0')}`,
      code: newCode(),
    }));
    const passwordHash = await hashPassword(password);

    const eventName = `Load test ${tag}`;
    const eventId = await requestContext.run(orgCtx, () =>
      prisma.withContext(
        orgCtx,
        async (tx) => {
          const role = await tx.role.findFirstOrThrow({
            where: { organizationId, systemKey: 'org_super_admin' },
            select: { id: true },
          });
          const user = await tx.user.create({
            data: {
              organizationId,
              email,
              fullName: 'Load Test Admin',
              status: 'active',
              passwordHash,
              isOrgSuperAdmin: true,
            },
            select: { id: true },
          });
          await tx.userRole.create({ data: { userId: user.id, roleId: role.id, organizationId } });
          const event = await tx.votingEvent.create({
            data: {
              organizationId,
              name: eventName,
              startAt: new Date(Date.now() - 60_000),
              endAt: new Date(Date.now() + 12 * 3_600_000),
            },
            select: { id: true },
          });
          const plan = [
            {
              name: 'Mwenyekiti',
              contesters: ['Asha Mollel', 'Juma Ali', 'Neema Mushi'],
              exact: 1,
            },
            {
              name: 'Wajumbe',
              contesters: ['Baraka Said', 'Rehema Kweka', 'Daudi Lyimo', 'Zawadi Mrema'],
              exact: 2,
            },
          ];
          for (const [i, item] of plan.entries()) {
            const category = await tx.category.create({
              data: {
                organizationId,
                eventId: event.id,
                name: item.name,
                displayOrder: i,
                selectionMode: 'exact',
                exactCount: item.exact,
              },
              select: { id: true },
            });
            for (const fullName of item.contesters) {
              await tx.contester.create({
                data: { organizationId, eventId: event.id, categoryId: category.id, fullName },
              });
            }
          }
          for (let start = 0; start < voters.length; start += BATCH) {
            await tx.voter.createMany({
              data: voters.slice(start, start + BATCH).map((voter, j) => ({
                organizationId,
                eventId: event.id,
                fullName: `Mpiga Kura ${start + j + 1}`,
                membershipId: voter.membershipId,
                phone: `+2557${String(10_000_000 + start + j).padStart(8, '0')}`,
                gender: (start + j) % 2 ? ('male' as const) : ('female' as const),
                codeHmac: codes.fingerprint(voter.code),
                codeCiphertext: codes.encrypt(voter.code),
                codeGeneratedAt: new Date(),
              })),
            });
          }
          await tx.$queryRaw`SELECT id FROM app.transition_event(${event.id}::uuid, 'open'::event_status, NULL)`;
          return event.id;
        },
        { timeout: 300_000 },
      ),
    );

    const seed: LoadSeed = {
      organizationId,
      eventId,
      eventName,
      staff: { email, password },
      voters,
    };
    await writeFile(out, JSON.stringify(seed), { mode: 0o600 });
    process.stdout.write(`Seeded ${count} voters for "${eventName}" (${eventId}) into ${out}\n`);
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('seed-load.js')) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
