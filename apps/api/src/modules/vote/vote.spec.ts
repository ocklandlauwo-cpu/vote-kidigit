// Voter API (Implementation Plan step 23, Backend Schema 8.3, 8.4, 12.11; App Flow 8.2, 8.3,
// 13.1): sign-in, wrong codes and the 15-minute lock, several matching events, "Si mimi", every
// status screen state, the stable shuffle, a category closing before submit, and no code or
// choice in any log line.
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  formatVotingCode,
  type SubmitBallotResponse,
  type VoterBallot,
  type VoterEventCard,
  type VoterSignInResponse,
  type VoterStatus,
} from '@vote-kidigit/shared';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import type { EventStatus } from '../../generated/prisma/enums.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { RedisService } from '../../redis/redis.service.js';
import {
  createOrganization,
  deleteOrganizations,
  ownerClient,
  uniqueSuffix,
} from '../../testing/db.js';
import { createTestHttpApp, testIp } from '../../testing/http.js';
import { CodesService } from '../voters/codes.service.js';
import { TURNOUT_PREFIX } from './vote.service.js';

const codeOf = (res: request.Response) => (res.body as { code?: string }).code;
const details = (res: request.Response) =>
  (res.body as { details?: Record<string, unknown> }).details ?? {};

/** Codes for tests: 8 characters of the voting alphabet. */
function randomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(
    { length: 8 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
}

describe('voter API', () => {
  let app: NestExpressApplication;
  let logs: string[];
  let owner: PrismaClient;
  let codes: CodesService;
  let redis: RedisService;
  let orgId: string;
  let otherOrgId: string;

  const server = () => app.getHttpServer();
  const fromIp = () => {
    const ip = testIp();
    return {
      post: (path: string, body?: object, token?: string) => {
        const req = request(server()).post(`/api/v1/vote${path}`).set('X-Forwarded-For', ip);
        if (token) req.set('Authorization', `Bearer ${token}`);
        return req.send(body);
      },
      get: (path: string, token?: string) => {
        const req = request(server()).get(`/api/v1/vote${path}`).set('X-Forwarded-For', ip);
        if (token) req.set('Authorization', `Bearer ${token}`);
        return req;
      },
    };
  };

  async function createEvent(
    status: EventStatus,
    change: { org?: string; startAt?: Date; endAt?: Date } = {},
  ) {
    const startAt = change.startAt ?? new Date(Date.now() - 3_600_000);
    const event = await owner.votingEvent.create({
      data: {
        organizationId: change.org ?? orgId,
        name: `Uchaguzi ${uniqueSuffix()}`,
        startAt,
        endAt: change.endAt ?? new Date(Date.now() + 8 * 3_600_000),
        status,
        ...(['cancelled', 'archived'].includes(status) && {
          cancelledAt: new Date(),
          cancelReason: 'Mkutano umeahirishwa',
        }),
      },
    });
    return event.id;
  }

  let order = 0;
  async function createCategory(
    eventId: string,
    contesters: number,
    change: { opensAt?: Date; closedAt?: Date; org?: string } = {},
  ) {
    order += 1;
    const category = await owner.category.create({
      data: {
        organizationId: change.org ?? orgId,
        eventId,
        name: `Nafasi ${order}`,
        displayOrder: order,
        opensAt: change.opensAt ?? null,
        closedAt: change.closedAt ?? null,
      },
    });
    const ids: string[] = [];
    for (let i = 0; i < contesters; i += 1) {
      const contester = await owner.contester.create({
        data: {
          organizationId: change.org ?? orgId,
          eventId,
          categoryId: category.id,
          fullName: `Mgombea ${order}-${i}`,
        },
      });
      ids.push(contester.id);
    }
    return { id: category.id, name: category.name, contesters: ids };
  }

  async function createVoter(
    eventId: string,
    change: { org?: string; membershipId?: string; code?: string } = {},
  ) {
    const code = change.code ?? randomCode();
    const membershipId = change.membershipId ?? `M-${uniqueSuffix()}`;
    const voter = await owner.voter.create({
      data: {
        organizationId: change.org ?? orgId,
        eventId,
        fullName: 'Asha Mollel',
        membershipId,
        phone: '+255712000001',
        gender: 'female',
        codeHmac: codes.fingerprint(code),
        codeCiphertext: codes.encrypt(code),
        codeGeneratedAt: new Date(),
      },
    });
    return { id: voter.id, membershipId, code };
  }

  async function signIn(eventId: string, voter: { membershipId: string; code: string }) {
    const client = fromIp();
    const res = await client
      .post('/sign-in', { eventId, membershipId: voter.membershipId, code: voter.code })
      .expect(200);
    return {
      client,
      token: (res.body as VoterSignInResponse).token,
      body: res.body as VoterSignInResponse,
    };
  }

  beforeAll(async () => {
    ({ app, logs } = await createTestHttpApp());
    codes = app.get(CodesService);
    redis = app.get(RedisService);
    owner = ownerClient();
    orgId = await createOrganization(owner, 'Chama cha Walimu');
    otherOrgId = await createOrganization(owner, 'Chama cha Wakulima');
    await owner.organization.update({
      where: { id: orgId },
      data: { contactPhone: '+255754000111', helpPhone: '+255754000222' },
    });
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId, otherOrgId]);
    await owner.$disconnect();
    await app.close();
  });

  it('shows the event card, and nothing for a Draft event', async () => {
    const eventId = await createEvent('open');
    const card = (await fromIp().get(`/events/${eventId}`).expect(200)).body as VoterEventCard;
    expect(card).toMatchObject({
      id: eventId,
      organizationName: 'Chama cha Walimu',
      state: 'open',
      helpPhone: '+255754000222',
      timeZone: 'Africa/Dar_es_Salaam',
    });
    const draft = await createEvent('draft');
    await fromIp().get(`/events/${draft}`).expect(404);
    await fromIp().get(`/events/${randomUUID()}`).expect(404);
    const voter = await createVoter(draft);
    const res = await fromIp().post('/sign-in', {
      eventId: draft,
      membershipId: voter.membershipId,
      code: voter.code,
    });
    expect(res.status).toBe(404);
  });

  it('signs in with the code typed any way, and never logs it', async () => {
    const eventId = await createEvent('open');
    const voter = await createVoter(eventId);
    logs.length = 0;
    const typed = formatVotingCode(voter.code).toLowerCase().replace('-', ' - ');
    const res = await fromIp()
      .post('/sign-in', {
        eventId,
        membershipId: ` ${voter.membershipId.toLowerCase()} `,
        code: typed,
      })
      .expect(200);
    const body = res.body as VoterSignInResponse;
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.voter).toMatchObject({ fullName: 'Asha Mollel', membershipId: voter.membershipId });
    expect(body.event.id).toBe(eventId);
    const joined = logs.join('\n');
    expect(joined).not.toContain(voter.code);
    expect(joined).not.toContain(formatVotingCode(voter.code));
    expect(
      await owner.auditLog.count({
        where: { action: 'voter.sign_in', entityId: voter.id, actorType: 'voter' },
      }),
    ).toBe(1);
  });

  it('counts wrong codes, locks after 5 for 15 minutes, and unlocks', async () => {
    const eventId = await createEvent('open');
    const voter = await createVoter(eventId);
    const client = fromIp();
    const wrong = { eventId, membershipId: voter.membershipId, code: 'AAAA-AAAA' };
    for (let left = 4; left >= 1; left -= 1) {
      const res = await client.post('/sign-in', wrong).expect(401);
      expect(codeOf(res)).toBe('INVALID_CREDENTIALS');
      expect(details(res)).toEqual({ attemptsLeft: left });
    }
    const fifth = await client.post('/sign-in', wrong).expect(423);
    expect(codeOf(fifth)).toBe('VOTER_LOCKED');
    const until = new Date(String(details(fifth).lockedUntil)).getTime();
    expect(until).toBeGreaterThan(Date.now() + 14 * 60_000);
    // Locked: even the right code, even from another IP (the voter row is locked).
    await fromIp()
      .post('/sign-in', { eventId, membershipId: voter.membershipId, code: voter.code })
      .expect(423);
    expect(
      await owner.auditLog.count({ where: { action: 'voter.locked', entityId: voter.id } }),
    ).toBe(1);

    // 15 minutes later (moved back here), from another IP: signs in and the count restarts.
    await owner.voter.update({
      where: { id: voter.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await fromIp()
      .post('/sign-in', { eventId, membershipId: voter.membershipId, code: voter.code })
      .expect(200);
    expect(await owner.voter.findUniqueOrThrow({ where: { id: voter.id } })).toMatchObject({
      failedAttempts: 0,
      lockedUntil: null,
    });
  });

  it('locks by IP and membership ID when the link has no event', async () => {
    const eventId = await createEvent('open');
    const voter = await createVoter(eventId);
    const client = fromIp();
    for (let i = 0; i < 4; i += 1) {
      await client
        .post('/sign-in', { membershipId: voter.membershipId, code: 'BBBBBBBB' })
        .expect(401);
    }
    await client
      .post('/sign-in', { membershipId: voter.membershipId, code: 'BBBBBBBB' })
      .expect(423);
    await client
      .post('/sign-in', { membershipId: voter.membershipId, code: voter.code })
      .expect(423);
    // Another IP is blocked too: without an event the membership ID itself is counted.
    await fromIp()
      .post('/sign-in', { membershipId: voter.membershipId, code: voter.code })
      .expect(423);
    // With the event in the link, the voter row decides (not locked): signs in.
    await fromIp()
      .post('/sign-in', { eventId, membershipId: voter.membershipId, code: voter.code })
      .expect(200);
  });

  it('without an event, also locks the membership ID across IPs', async () => {
    const eventId = await createEvent('open');
    const voter = await createVoter(eventId);
    for (let i = 0; i < 4; i += 1) {
      await fromIp()
        .post('/sign-in', { membershipId: voter.membershipId, code: 'CCCCCCCC' })
        .expect(401);
    }
    await fromIp()
      .post('/sign-in', { membershipId: voter.membershipId, code: 'CCCCCCCC' })
      .expect(423);
    await fromIp()
      .post('/sign-in', { membershipId: voter.membershipId, code: voter.code })
      .expect(423);
  });

  it('ends a session when the code is regenerated or the event is deactivated', async () => {
    const eventId = await createEvent('open');
    const voter = await createVoter(eventId);
    const first = await signIn(eventId, voter);
    await first.client.get('/status', first.token).expect(200);
    await owner.voter.update({
      where: { id: voter.id },
      data: { codeHmac: codes.fingerprint('NEWC0DE2'.replace('0', 'Q')) },
    });
    await first.client.get('/status', first.token).expect(401);

    // Open events cannot be deactivated (CHECK); a Scheduled one can.
    const scheduled = await createEvent('scheduled', {
      startAt: new Date(Date.now() + 86_400_000),
      endAt: new Date(Date.now() + 2 * 86_400_000),
    });
    const other = await createVoter(scheduled);
    const second = await signIn(scheduled, other);
    await second.client.get('/status', second.token).expect(200);
    await owner.votingEvent.update({ where: { id: scheduled }, data: { isActive: false } });
    await second.client.get('/status', second.token).expect(401);
  });

  it('asks the voter to choose when the pair matches several events', async () => {
    const membershipId = `M-${uniqueSuffix()}`;
    const code = randomCode();
    const first = await createEvent('open');
    const second = await createEvent('scheduled', { org: otherOrgId });
    await createVoter(first, { membershipId, code });
    await createVoter(second, { membershipId, code, org: otherOrgId });
    const res = await fromIp().post('/sign-in', { membershipId, code }).expect(300);
    expect(codeOf(res)).toBe('CHOOSE_EVENT');
    const events = (details(res).events ?? []) as { id: string; organizationName: string }[];
    expect(events.map((e) => e.id).sort()).toEqual([first, second].sort());
    expect(events.map((e) => e.organizationName).sort()).toEqual([
      'Chama cha Wakulima',
      'Chama cha Walimu',
    ]);
    const chosen = await fromIp()
      .post('/sign-in', { eventId: second, membershipId, code })
      .expect(200);
    expect((chosen.body as VoterSignInResponse).event.state).toBe('scheduled');
  });

  it('"Si mimi" shows the officer\'s phone, is logged and ends the session', async () => {
    const eventId = await createEvent('open');
    const voter = await createVoter(eventId);
    const { client, token } = await signIn(eventId, voter);
    const res = await client.post('/not-me', undefined, token).expect(200);
    expect(res.body).toEqual({ contactPhone: '+255754000111' });
    expect(
      await owner.auditLog.count({
        where: { action: 'voter.identity.rejected', entityId: voter.id },
      }),
    ).toBe(1);
    await client.get('/status', token).expect(401);
  });

  it('needs the identity confirmed before the ballot', async () => {
    const eventId = await createEvent('open');
    await createCategory(eventId, 2);
    const voter = await createVoter(eventId);
    const { client, token } = await signIn(eventId, voter);
    await client.get('/ballot', token).expect(403);
    const confirmed = await client.post('/confirm-identity', undefined, token).expect(200);
    expect(confirmed.body).toEqual({ next: 'ballot' });
    await client.get('/ballot', token).expect(200);
    await client.get('/ballot', 'x'.repeat(43)).expect(401);
    await client.get('/ballot').expect(401);
  });

  it('reports every status screen state', async () => {
    const stateOf = async (status: EventStatus) => {
      const eventId = await createEvent(status, {
        startAt: status === 'scheduled' ? new Date(Date.now() + 86_400_000) : undefined,
        endAt: status === 'scheduled' ? new Date(Date.now() + 2 * 86_400_000) : undefined,
      });
      await createCategory(eventId, 2);
      const voter = await createVoter(eventId);
      const { client, token } = await signIn(eventId, voter);
      return (await client.get('/status', token).expect(200)).body as VoterStatus;
    };
    const scheduled = await stateOf('scheduled');
    expect(scheduled.event.state).toBe('scheduled');
    expect(scheduled.categories[0]).toMatchObject({
      state: 'opens_later',
      opensAt: scheduled.event.startAt,
    });
    expect(scheduled.canVote).toBe(false);
    expect((await stateOf('closed')).event.state).toBe('closed');
    expect((await stateOf('closed')).categories[0]?.state).toBe('closed');
    expect((await stateOf('results_published')).event.state).toBe('results_published');
    expect((await stateOf('cancelled')).event.state).toBe('cancelled');
    expect((await stateOf('archived')).event.state).toBe('cancelled');

    // Open: one category open, one opening later, one closed, one voted.
    const eventId = await createEvent('open');
    const open = await createCategory(eventId, 2);
    const later = await createCategory(eventId, 2, { opensAt: new Date(Date.now() + 3_600_000) });
    await createCategory(eventId, 2, { closedAt: new Date() });
    const voter = await createVoter(eventId);
    const first = await signIn(eventId, voter);
    await first.client.post('/confirm-identity', undefined, first.token).expect(200);
    await first.client
      .post(
        '/ballot',
        {
          selections: [
            { categoryId: open.id, choice: 'contester', contesterIds: [open.contesters[0]] },
          ],
        },
        first.token,
      )
      .expect(200);
    const again = await signIn(eventId, voter);
    const status = (await again.client.get('/status', again.token).expect(200)).body as VoterStatus;
    expect(status.categories.map((c) => c.state)).toEqual(['voted', 'opens_later', 'closed']);
    expect(status.categories[1]?.opensAt).toBe(
      (await owner.category.findUniqueOrThrow({ where: { id: later.id } })).opensAt?.toISOString(),
    );
    expect(status.canVote).toBe(false);
    expect(status.votedAt).not.toBeNull();
    const next = await again.client.post('/confirm-identity', undefined, again.token).expect(200);
    expect(next.body).toEqual({ next: 'status' });
  });

  it("keeps each voter's contester order for the session", async () => {
    const eventId = await createEvent('open');
    const category = await createCategory(eventId, 6);
    const orders: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const voter = await createVoter(eventId);
      const { client, token } = await signIn(eventId, voter);
      await client.post('/confirm-identity', undefined, token).expect(200);
      const read = async () =>
        ((await client.get('/ballot', token).expect(200)).body as VoterBallot).categories
          .find((c) => c.id === category.id)
          ?.contesters.map((c) => c.id)
          .join(',') ?? '';
      const once = await read();
      expect(await read()).toBe(once);
      expect(once.split(',').sort()).toEqual([...category.contesters].sort());
      orders.push(once);
    }
    // Six voters with the same order would be a 1 in 720^5 chance.
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it('records the open categories when one closed before submit, and logs no choice', async () => {
    const eventId = await createEvent('open');
    const a = await createCategory(eventId, 2);
    const b = await createCategory(eventId, 3);
    const voter = await createVoter(eventId);
    const { client, token } = await signIn(eventId, voter);
    await client.post('/confirm-identity', undefined, token).expect(200);
    const ballot = (await client.get('/ballot', token).expect(200)).body as VoterBallot;
    expect(ballot.categories.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(ballot.categories[0]?.rules).toMatchObject({
      selectionMode: 'exact',
      exactCount: 1,
      yesNo: false,
    });

    await owner.category.update({ where: { id: b.id }, data: { closedAt: new Date() } });
    const turnoutBefore = Number((await redis.get(`${TURNOUT_PREFIX}${eventId}`)) ?? 0);
    logs.length = 0;
    const res = await client
      .post(
        '/ballot',
        {
          selections: [
            { categoryId: a.id, choice: 'contester', contesterIds: [a.contesters[1]] },
            { categoryId: b.id, choice: 'contester', contesterIds: [b.contesters[2]] },
          ],
        },
        token,
      )
      .expect(200);
    const result = res.body as SubmitBallotResponse;
    expect(result.recorded).toEqual([{ categoryId: a.id, name: a.name }]);
    expect(result.rejected).toEqual([
      { categoryId: b.id, name: b.name, reason: 'CATEGORY_CLOSED' },
    ]);
    const joined = logs.join('\n');
    for (const id of [a.contesters[1], b.contesters[2]]) expect(joined).not.toContain(id);

    // Token spent, turnout counted once, the confirmation SMS queued.
    await client.get('/status', token).expect(401);
    expect(Number(await redis.get(`${TURNOUT_PREFIX}${eventId}`))).toBe(turnoutBefore + 1);
    expect(
      await owner.smsMessage.count({ where: { voterId: voter.id, type: 'vote_confirmation' } }),
    ).toBe(1);
  });

  it('saves nothing when the event closed before submit', async () => {
    const eventId = await createEvent('open');
    const category = await createCategory(eventId, 2);
    const voter = await createVoter(eventId);
    const { client, token } = await signIn(eventId, voter);
    await client.post('/confirm-identity', undefined, token).expect(200);
    await owner.votingEvent.update({
      where: { id: eventId },
      data: { status: 'closed', closedAt: new Date() },
    });
    const res = await client
      .post(
        '/ballot',
        {
          selections: [
            {
              categoryId: category.id,
              choice: 'contester',
              contesterIds: [category.contesters[0]],
            },
          ],
        },
        token,
      )
      .expect(409);
    expect(codeOf(res)).toBe('VOTING_CLOSED');
    expect(await owner.voterParticipation.count({ where: { voterId: voter.id } })).toBe(0);
  });

  it('serves pictures only through a valid signed link', async () => {
    const eventId = await createEvent('open');
    const category = await createCategory(eventId, 2);
    const storagePath = `org/${orgId}/contester_photo/${randomUUID()}.jpg`;
    const absolute = path.join(process.env.STORAGE_DIR ?? '', storagePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, Buffer.from([0xff, 0xd8, 0xff]));
    const photo = await owner.file.create({
      data: {
        organizationId: orgId,
        kind: 'contester_photo',
        storagePath,
        mimeType: 'image/jpeg',
        sizeBytes: 3,
        sha256: 'a'.repeat(64),
      },
    });
    await owner.contester.update({
      where: { id: category.contesters[0] },
      data: { photoFileId: photo.id },
    });
    const voter = await createVoter(eventId);
    const { client, token } = await signIn(eventId, voter);
    await client.post('/confirm-identity', undefined, token).expect(200);
    const ballot = (await client.get('/ballot', token).expect(200)).body as VoterBallot;
    const url = ballot.categories[0]?.contesters.find((c) => c.photoUrl)?.photoUrl ?? '';
    expect(url).toMatch(new RegExp(`^/api/v1/vote/files/${photo.id}\\?e=${eventId}&x=\\d+&s=`));
    const ok = await request(server()).get(url).expect(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const tampered = url.replace(/s=[^&]+$/, 's=AAAA');
    for (const bad of [
      tampered,
      url.replace(eventId, randomUUID()),
      `/api/v1/vote/files/${photo.id}`,
    ]) {
      await request(server()).get(bad).expect(404);
    }
  });
});
