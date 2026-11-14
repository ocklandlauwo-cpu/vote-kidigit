// USSD voting over HTTP (Implementation Plan step 37, App Flow 9, PRD VOT-04, VOT-05): every
// state and error path through the generic adapter, Beem's JSON format, the secret and the
// address allow-list. Ballots go through the same voter service, recorded on channel ussd.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  createOrganization,
  deleteOrganizations,
  ownerClient,
  uniqueSuffix,
} from '../../testing/db.js';
import { createTestHttpApp } from '../../testing/http.js';
import { CodesService } from '../voters/codes.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { USSD_PREFIX } from './ussd-engine.js';
import { USSD_MAX } from './ussd-screens.js';
import { UssdController } from './ussd.module.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () =>
  Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

describe('USSD voting', () => {
  let app: NestExpressApplication;
  let owner: PrismaClient;
  let codes: CodesService;
  let secret: string;
  let orgId: string;

  async function event(status: 'open' | 'results_published' = 'open', name = 'Uchaguzi Mkuu') {
    return owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `${name} ${uniqueSuffix()}`,
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 8 * 3_600_000),
        status,
        ...(status === 'results_published' && {
          openedAt: new Date(Date.now() - 3_600_000),
          closedAt: new Date(Date.now() - 60_000),
          resultsPublishedAt: new Date(),
          publicResultsToken: randomBytes(24).toString('base64url'),
        }),
      },
    });
  }

  let order = 0;
  async function category(
    eventId: string,
    names: string[],
    rules: {
      selectionMode?: 'exact' | 'range';
      exactCount?: number;
      minCount?: number;
      maxCount?: number;
      allowSkip?: boolean;
    } = {},
  ) {
    order += 1;
    const created = await owner.category.create({
      data: {
        organizationId: orgId,
        eventId,
        name: names.length === 1 ? 'Katiba mpya' : `Nafasi ${order}`,
        displayOrder: order,
        selectionMode: rules.selectionMode ?? 'exact',
        exactCount: rules.exactCount ?? (rules.selectionMode === 'range' ? null : 1),
        minCount: rules.minCount ?? null,
        maxCount: rules.maxCount ?? null,
        allowSkip: rules.allowSkip ?? false,
      },
    });
    const ids: string[] = [];
    for (const fullName of names) {
      ids.push(
        (
          await owner.contester.create({
            data: { organizationId: orgId, eventId, categoryId: created.id, fullName },
          })
        ).id,
      );
    }
    return { id: created.id, ids };
  }

  async function voter(
    eventId: string,
    change: { membershipId?: string; code?: string; name?: string } = {},
  ) {
    const code = change.code ?? newCode();
    const membershipId = change.membershipId ?? `U-${uniqueSuffix()}`;
    const row = await owner.voter.create({
      data: {
        organizationId: orgId,
        eventId,
        fullName: change.name ?? 'Zawadi Mrema',
        membershipId,
        phone: '+255712000009',
        gender: 'female',
        codeHmac: codes.fingerprint(code),
        codeCiphertext: codes.encrypt(code),
        codeGeneratedAt: new Date(),
      },
    });
    return { id: row.id, membershipId, code };
  }

  /** A phone session through the generic adapter: each call adds one answer. */
  function dial(phoneNumber = `+2557${String(Date.now()).slice(-8)}`) {
    const sessionId = randomUUID();
    const answers: string[] = [];
    let started = false;
    return async (input?: string): Promise<{ end: boolean; text: string }> => {
      if (started && input !== undefined) answers.push(input);
      started = true;
      const res = await request(app.getHttpServer())
        .post(`/api/ussd/generic/callback?secret=${encodeURIComponent(secret)}`)
        .type('form')
        .send({ sessionId, phoneNumber, text: answers.join('*') })
        .expect(200);
      const body = res.text;
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      const text = body.slice(4);
      expect(text.length).toBeLessThanOrEqual(USSD_MAX);
      expect(text).not.toContain('Huduma haipatikani');
      return { end: body.startsWith('END '), text };
    };
  }

  beforeAll(async () => {
    ({ app } = await createTestHttpApp());
    codes = app.get(CodesService);
    secret = app.get(ConfigService).get<string>('USSD_CALLBACK_SECRET') ?? '';
    owner = ownerClient();
    orgId = await createOrganization(owner, 'Chama cha Walimu');
    await owner.organization.update({
      where: { id: orgId },
      data: { contactPhone: '+255754000111' },
    });
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await app.close();
  });

  it('starts at the menu and gives help', async () => {
    const phone = dial();
    expect(await phone()).toEqual({
      end: false,
      text: 'Karibu Vote-Kidigit\n1. Piga kura\n2. Angalia matokeo\n3. Msaada',
    });
    const again = await phone('7'); // not a menu option: the menu again
    expect(again.end).toBe(false);
    expect(again.text).toMatch(/^Karibu/);
    const help = await phone('3');
    expect(help.end).toBe(true);
    expect(help.text).toContain('Msimbo umepotea? Wasiliana na msimamizi wa uchaguzi.');
  });

  it('votes in every kind of category: paging, multi-select, yes/no, skip, review, submit', async () => {
    const e = await event();
    const chair = await category(
      e.id,
      Array.from({ length: 8 }, (_, i) => `Mgombea Mwenyekiti ${i + 1}`),
    );
    const board = await category(e.id, ['Baraka', 'Rehema', 'Daudi', 'Zawadi'], {
      selectionMode: 'range',
      minCount: 2,
      maxCount: 3,
    });
    const charter = await category(e.id, ['Katiba ya 2027'], { allowSkip: true });
    const v = await voter(e.id);
    const phone = dial();
    await phone();
    expect((await phone('1')).text).toBe('Weka namba yako ya uanachama:');
    expect((await phone(v.membershipId)).text).toBe('Weka msimbo wa uthibitisho (herufi 8):');
    const identity = await phone(`${v.code.slice(0, 4)}-${v.code.slice(4).toLowerCase()}`);
    expect(identity.text).toMatch(
      /^Chama cha Walimu: Uchaguzi Mkuu .+\nJina: Zawadi Mrema\n1\. Ndiyo, ni mimi\n2\. Si mimi$/,
    );
    expect((await phone('5')).text).toBe(identity.text); // anything else shows it again

    // Category 1 of 3: 8 contesters, 6 on the first page, numbers continue on the next.
    const first = await phone('1');
    expect(first.text).toMatch(/^Nafasi \d+ \(1\/3\)\nChagua 1:\n1\. .+\n/);
    expect(first.text).toContain('6. ');
    expect(first.text).toContain('99. Zaidi');
    const second = await phone('99');
    expect(second.text).toMatch(/\n7\. .+\n8\. /);
    expect((await phone('9')).text).toMatch(/^Chagua wagombea 1\. Jaribu tena:/);

    // Category 2 of 3: between 2 and 3, typed "1 3" after a wrong count.
    const board1 = await phone('8');
    expect(board1.text).toContain('(2/3)\nChagua kati ya 2 na 3:');
    expect((await phone('1')).text).toMatch(/^Chagua kati ya 2 na 3\. Jaribu tena:/);
    // Category 3 of 3: one contester, so Yes / No, with skip allowed.
    const yesNo = await phone('1,3');
    expect(yesNo.text).toMatch(
      /^Katiba mpya \(3\/3\)\nKatiba ya 2027\n1\. Ndiyo\n2\. Hapana\n0\. Ruka$/,
    );

    // Review, back to the start, then again and confirm.
    const review = await phone('0');
    expect(review.text).toMatch(/^Hakiki:\n/);
    expect(review.text).toContain('Katiba mpya: Umeruka');
    expect(review.text).toMatch(/1\. Thibitisha\n2\. Rudi mwanzo$/);
    expect((await phone('2')).text).toMatch(/\(1\/3\)/);
    await phone('2');
    await phone('2 4');
    const again = await phone('1');
    expect(again.text).toContain('Katiba mpya: Ndiyo');
    const done = await phone('1');
    expect(done.end).toBe(true);
    expect(done.text).toMatch(/^Asante! Kura yako imepokelewa saa \d\d:\d\d\.$/);

    const participation = await owner.voterParticipation.findMany({ where: { voterId: v.id } });
    expect(participation.map((p) => p.categoryId).sort()).toEqual(
      [chair.id, board.id, charter.id].sort(),
    );
    expect(participation.every((p) => p.channel === 'ussd')).toBe(true);

    // Redialling after voting: "Umeshapiga kura saa …".
    const redial = dial();
    await redial();
    await redial('1');
    await redial(v.membershipId);
    await redial(v.code);
    const voted = await redial('1');
    expect(voted.end).toBe(true);
    expect(voted.text).toMatch(
      /^Umeshapiga kura saa \d\d:\d\d\. Matokeo: piga .+ chagua 2 baada ya kutangazwa\.$/,
    );
  });

  it('counts wrong codes like the web, then locks', async () => {
    const e = await event();
    await category(e.id, ['Asha', 'Juma']);
    const v = await voter(e.id);
    const callerPhone = `+2557${String(Date.now()).slice(-8)}`;
    for (let left = 4; left >= 0; left -= 1) {
      const phone = dial(callerPhone);
      await phone();
      await phone('1');
      await phone(v.membershipId);
      const wrong = await phone('AAAAAAAA');
      expect(wrong.end).toBe(true);
      if (left > 0)
        expect(wrong.text).toBe(`Namba au msimbo si sahihi. Majaribio yaliyobaki: ${left}`);
      else expect(wrong.text).toMatch(/^(Namba au msimbo si sahihi|Umezuiwa kwa dakika 15)/);
    }
    const phone = dial(callerPhone);
    await phone();
    await phone('1');
    await phone(v.membershipId);
    expect((await phone(v.code)).text).toMatch(
      /^Umezuiwa kwa dakika 15\. Jaribu tena saa \d\d:\d\d$/,
    );
  });

  it('ends with the contact for "Si mimi"', async () => {
    const e = await event();
    await category(e.id, ['Asha', 'Juma']);
    const v = await voter(e.id);
    const phone = dial();
    await phone();
    await phone('1');
    await phone(v.membershipId);
    await phone(v.code);
    const notMe = await phone('2');
    expect(notMe).toEqual({
      end: true,
      text: 'Tafadhali wasiliana na msimamizi wa uchaguzi: +255754000111',
    });
  });

  it('lets a voter of two events choose one, asking the code again', async () => {
    const membershipId = `TWO-${uniqueSuffix()}`;
    const code = newCode();
    const a = await event('open', 'Mkutano wa Kwanza');
    const b = await event('open', 'Mkutano wa Pili');
    await category(a.id, ['Asha', 'Juma']);
    await category(b.id, ['Neema', 'Hamisi']);
    await voter(a.id, { membershipId, code });
    await voter(b.id, { membershipId, code, name: 'Hassani Juma' });
    const phone = dial();
    await phone();
    await phone('1');
    await phone(membershipId);
    const choose = await phone(code);
    expect(choose.text).toMatch(/^Chagua uchaguzi:\n1\. .+\n2\. .+$/);
    expect((await phone('9')).text).toBe(choose.text);
    const which = choose.text.split('\n').findIndex((line) => line.includes('Mkutano wa Pili'));
    expect(which).toBeGreaterThan(0);
    expect((await phone(String(which))).text).toBe('Weka msimbo wa uthibitisho (herufi 8):');
    expect((await phone(code)).text).toContain('Jina: Hassani Juma');
  });

  it('shows published results, winners first, and nothing before publication', async () => {
    const open = await event();
    await category(open.id, ['Asha', 'Juma']);
    const early = await voter(open.id);
    let phone = dial();
    await phone();
    await phone('2');
    await phone(early.membershipId);
    expect(await phone(early.code)).toEqual({ end: true, text: 'Matokeo bado hayajatangazwa.' });

    const published = await event('results_published');
    const seat = await category(published.id, ['Asha Mollel', 'Juma Ali']);
    const snapshot = await owner.resultSnapshot.create({
      data: {
        organizationId: orgId,
        eventId: published.id,
        version: 1,
        isCurrent: true,
        registeredVoters: 10,
        votersVoted: 7,
        contentHash: 'd'.repeat(64),
      },
    });
    await owner.resultCategoryStat.create({
      data: {
        organizationId: orgId,
        snapshotId: snapshot.id,
        categoryId: seat.id,
        eligibleVoters: 10,
        votersVoted: 7,
        validVotes: 7,
        skipped: 0,
        hasTie: false,
      },
    });
    for (const [i, contesterId] of seat.ids.entries()) {
      await owner.resultRow.create({
        data: {
          organizationId: orgId,
          snapshotId: snapshot.id,
          categoryId: seat.id,
          contesterId,
          choice: 'contester',
          votes: i === 0 ? 5 : 2,
          percent: i === 0 ? 71.4 : 28.6,
          rank: i + 1,
          isWinner: i === 0,
        },
      });
    }
    // Published last: result tables refuse changes once their snapshot is published.
    await owner.resultSnapshot.update({
      where: { id: snapshot.id },
      data: { publishedAt: new Date() },
    });
    const late = await voter(published.id);
    phone = dial();
    await phone();
    await phone('2');
    await phone(late.membershipId);
    const results = await phone(late.code);
    expect(results.end).toBe(true);
    expect(results.text).toMatch(/^Matokeo:\nNafasi \d+: Asha Mollel \(5\)$/);
  });

  it('speaks Beem’s JSON format and drops the session on terminate', async () => {
    const sessionId = `beem-${uniqueSuffix()}`;
    const base = { msisdn: '255712000777', operator: 'vodacom', session_id: sessionId };
    const url = `/api/ussd/beem/callback?secret=${encodeURIComponent(secret)}`;
    const start = await request(app.getHttpServer())
      .post(url)
      .send({ ...base, command: 'initiate', payload: { request_id: 0, response: '0' } })
      .expect(200);
    expect(start.body).toEqual({
      ...base,
      command: 'continue',
      payload: {
        request_id: 1,
        request: 'Karibu Vote-Kidigit\n1. Piga kura\n2. Angalia matokeo\n3. Msaada',
      },
    });
    const help = await request(app.getHttpServer())
      .post(url)
      .send({ ...base, command: 'continue', payload: { request_id: 1, response: '3' } })
      .expect(200);
    expect(help.body).toMatchObject({ command: 'terminate', payload: { request_id: 2 } });

    const next = `beem-${uniqueSuffix()}`;
    await request(app.getHttpServer())
      .post(url)
      .send({
        ...base,
        session_id: next,
        command: 'initiate',
        payload: { request_id: 0, response: '0' },
      });
    await request(app.getHttpServer())
      .post(url)
      .send({
        ...base,
        session_id: next,
        command: 'terminate',
        payload: { request_id: 1, response: '' },
      })
      .expect(200);
    expect(await app.get(RedisService).exists(`${USSD_PREFIX}${next}`)).toBe(0);
  });

  it('refuses a wrong secret, an unknown aggregator and malformed bodies', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/ussd/generic/callback?secret=wrong').send({}).expect(401);
    await request(server).post(`/api/ussd/nope/callback?secret=${secret}`).send({}).expect(404);
    await request(server)
      .post(`/api/ussd/generic/callback?secret=${secret}`)
      .send({ x: 1 })
      .expect(400);
  });

  it('refuses callers outside the allow-list when one is set', async () => {
    const engine = {
      handle: jest.fn().mockResolvedValue({ text: 'x', end: false }),
      drop: jest.fn(),
    };
    const config = {
      get: (key: string) => (key === 'USSD_ALLOWED_IPS' ? ['196.0.0.1'] : 'x'.repeat(32)),
    };
    const controller = new UssdController(engine as never, config as never);
    const res = { type: jest.fn() };
    await expect(
      controller.callback(
        'generic',
        'x'.repeat(32),
        { sessionId: 's', phoneNumber: '1', text: '' },
        { ip: '10.0.0.9' } as never,
        res as never,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await controller.callback(
      'generic',
      'x'.repeat(32),
      { sessionId: 's', phoneNumber: '1', text: '' },
      { ip: '196.0.0.1' } as never,
      res as never,
    );
    expect(engine.handle).toHaveBeenCalledTimes(1);
  });
});
