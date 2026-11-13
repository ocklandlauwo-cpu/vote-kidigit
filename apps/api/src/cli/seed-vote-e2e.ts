// CLI for end-to-end tests only (Implementation Plan step 24): creates an organization with an
// Open event (two categories, contesters and one voter with a known code) and prints what the
// browser test needs as one JSON line. Refuses to run in production.
//   node apps/api/dist/cli/seed-vote-e2e.js [--kiosk] [--staff] [--tie]
// With --kiosk it also launches a kiosk for the event and prints its token and PIN.
// With --staff it adds staff accounts (password E2E_STAFF_PASSWORD): an Org Super Admin, a
// moderator and an observer mapped to the event, and a moderator mapped to nothing.
// With --tie it adds a second Open event whose one seat is tied 1–1, ready to close.
// The event is set up as Draft and then opened through app.transition_event(), like the product.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { AppModule } from '../app.module.js';
import { hashPassword } from '../auth/passwords.js';
import type { Env } from '../config/env.schema.js';
import { RequestContextService, systemContext } from '../context/request-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { CodesService } from '../modules/voters/codes.service.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const E2E_STAFF_PASSWORD = 'Uchaguzi2027E2E';

type StaffKey = 'superAdmin' | 'moderator' | 'observer' | 'unmappedModerator';

export interface SeededVote {
  organizationId: string;
  eventId: string;
  eventName: string;
  membershipId: string;
  code: string;
  voterName: string;
  categories: { name: string; contesters: string[]; choose: number }[];
  kiosk?: { token: string; pin: string };
  staff?: Record<StaffKey, string> & { password: string };
  tie?: { eventId: string; eventName: string; contesters: string[] };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-vote-e2e is for test databases only.');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const requestContext = app.get(RequestContextService);
    const codes = new CodesService(app.get(ConfigService<Env, true>));
    const tag = randomUUID().slice(0, 8);
    const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const ctx = { ...systemContext(randomUUID()), actorLabel: 'E2E seed' };

    const organizationId = await requestContext.run({ ...ctx, isPlatformAdmin: true }, () =>
      prisma.withContext({ ...ctx, isPlatformAdmin: true, orgId: null }, async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: `E2E ${tag}`,
            slug: `e2e-${tag}`,
            contactPhone: '+255754000111',
            helpPhone: '+255754000222',
          },
          select: { id: true },
        });
        await tx.$executeRaw`SELECT app.create_default_roles(${org.id}::uuid)`;
        return org.id;
      }),
    );

    const orgCtx = { ...ctx, orgId: organizationId };
    const seeded = await requestContext.run(orgCtx, () =>
      prisma.withContext(orgCtx, async (tx) => {
        const eventName = `Uchaguzi E2E ${tag}`;
        const event = await tx.votingEvent.create({
          data: {
            organizationId,
            name: eventName,
            startAt: new Date(Date.now() - 60_000),
            endAt: new Date(Date.now() + 8 * 3_600_000),
          },
          select: { id: true },
        });
        const plan = [
          { name: 'Mwenyekiti', contesters: ['Asha Mollel', 'Juma Ali', 'Neema Mushi'], choose: 1 },
          {
            name: 'Wajumbe',
            contesters: ['Baraka Said', 'Rehema Kweka', 'Daudi Lyimo'],
            choose: 2,
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
              exactCount: item.choose,
            },
            select: { id: true },
          });
          for (const fullName of item.contesters) {
            await tx.contester.create({
              data: { organizationId, eventId: event.id, categoryId: category.id, fullName },
            });
          }
        }
        const membershipId = `E2E-${tag}`;
        await tx.voter.create({
          data: {
            organizationId,
            eventId: event.id,
            fullName: 'Amina Hassan',
            membershipId,
            phone: '+255712000001',
            gender: 'female',
            codeHmac: codes.fingerprint(code),
            codeCiphertext: codes.encrypt(code),
            codeGeneratedAt: new Date(),
          },
        });
        await tx.$queryRaw`SELECT id FROM app.transition_event(${event.id}::uuid, 'open'::event_status, NULL)`;
        let kiosk: SeededVote['kiosk'];
        if (process.argv.includes('--kiosk')) {
          const officer = await tx.user.create({
            data: {
              organizationId,
              email: `kiosk-${tag}@example.test`,
              fullName: 'Afisa wa Kiosk',
              status: 'active',
            },
            select: { id: true },
          });
          const token = randomBytes(32).toString('base64url');
          const pin = '4821';
          await tx.kioskSession.create({
            data: {
              organizationId,
              eventId: event.id,
              deviceLabel: 'E2E Tablet',
              tokenHash: new Uint8Array(createHash('sha256').update(token).digest()),
              pinHash: await hashPassword(pin),
              launchedBy: officer.id,
            },
          });
          kiosk = { token, pin };
        }
        let staff: SeededVote['staff'];
        if (process.argv.includes('--staff')) {
          const passwordHash = await hashPassword(E2E_STAFF_PASSWORD);
          const people: [StaffKey, string, string, 'moderator' | 'observer' | null][] = [
            ['superAdmin', 'org_super_admin', 'Neema Msimamizi Mkuu', null],
            ['moderator', 'moderator', 'Musa Msimamizi', 'moderator'],
            ['observer', 'observer', 'Olivia Mtazamaji', 'observer'],
            ['unmappedModerator', 'moderator', 'Upendo Hajapangiwa', null],
          ];
          const emails = {} as Record<StaffKey, string>;
          for (const [key, systemKey, fullName, assignment] of people) {
            const email = `${key.toLowerCase()}-${tag}@example.test`;
            const role = await tx.role.findFirstOrThrow({
              where: { organizationId, systemKey },
              select: { id: true },
            });
            const user = await tx.user.create({
              data: {
                organizationId,
                email,
                fullName,
                status: 'active',
                passwordHash,
                isOrgSuperAdmin: systemKey === 'org_super_admin',
              },
              select: { id: true },
            });
            await tx.userRole.create({
              data: { userId: user.id, roleId: role.id, organizationId },
            });
            if (assignment) {
              await tx.eventAssignment.create({
                data: { organizationId, eventId: event.id, userId: user.id, type: assignment },
              });
            }
            emails[key] = email;
          }
          staff = { ...emails, password: E2E_STAFF_PASSWORD };
        }

        let tie: SeededVote['tie'];
        if (process.argv.includes('--tie')) {
          const tieName = `Sare E2E ${tag}`;
          const tieEvent = await tx.votingEvent.create({
            data: {
              organizationId,
              name: tieName,
              startAt: new Date(Date.now() - 60_000),
              endAt: new Date(Date.now() + 8 * 3_600_000),
            },
            select: { id: true },
          });
          const seat = await tx.category.create({
            data: {
              organizationId,
              eventId: tieEvent.id,
              name: 'Katibu',
              displayOrder: 0,
              selectionMode: 'exact',
              exactCount: 1,
            },
            select: { id: true },
          });
          const contesters = ['Halima Juma', 'Petro Mrema'];
          const ids: string[] = [];
          for (const fullName of contesters) {
            const contester = await tx.contester.create({
              data: { organizationId, eventId: tieEvent.id, categoryId: seat.id, fullName },
              select: { id: true },
            });
            ids.push(contester.id);
          }
          const voterIds: string[] = [];
          for (const [i, fullName] of ['Mpiga Kwanza', 'Mpiga Pili'].entries()) {
            const voter = await tx.voter.create({
              data: {
                organizationId,
                eventId: tieEvent.id,
                fullName,
                membershipId: `SARE-${tag}-${i}`,
                phone: '+255712000002',
                gender: 'male',
              },
              select: { id: true },
            });
            voterIds.push(voter.id);
          }
          await tx.$queryRaw`SELECT id FROM app.transition_event(${tieEvent.id}::uuid, 'open'::event_status, NULL)`;
          // One vote each: a tie for the only seat.
          for (const [i, voterId] of voterIds.entries()) {
            const selections = JSON.stringify([
              { categoryId: seat.id, choice: 'contester', contesterIds: [ids[i]] },
            ]);
            await tx.$queryRaw`SELECT app.cast_ballot(${voterId}::uuid, ${tieEvent.id}::uuid, ${selections}::jsonb, 'web'::vote_channel)`;
          }
          tie = { eventId: tieEvent.id, eventName: tieName, contesters };
        }
        return { eventId: event.id, eventName, membershipId, plan, kiosk, staff, tie };
      }),
    );

    const output: SeededVote = {
      organizationId,
      eventId: seeded.eventId,
      eventName: seeded.eventName,
      membershipId: seeded.membershipId,
      code,
      voterName: 'Amina Hassan',
      categories: seeded.plan,
      ...(seeded.kiosk && { kiosk: seeded.kiosk }),
      ...(seeded.staff && { staff: seeded.staff }),
      ...(seeded.tie && { tie: seeded.tie }),
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('seed-vote-e2e.js')) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
