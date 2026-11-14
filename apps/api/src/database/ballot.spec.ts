// The secret ballot in the database (Implementation Plan step 22, Backend Schema 6.1–6.3, 10.3,
// 11.1, 11.4): app.cast_ballot() is the only way in, vk_api cannot read ballots, one vote per
// voter per category even under concurrency, every rule mode, and nothing can be changed later.
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { EventStatus } from '../generated/prisma/enums.js';
import {
  apiClient,
  createOrganization,
  deleteOrganizations,
  noContext,
  orgContext,
  ownerClient,
  uniqueSuffix,
} from '../testing/db.js';
import type { PrismaService } from './prisma.service.js';

interface CastResult {
  recorded: string[];
  rejected: { categoryId: unknown; reason: string }[];
  votedAt: string;
}

interface Selection {
  categoryId: unknown;
  choice?: unknown;
  contesterIds?: unknown;
}

type Rules = {
  selectionMode?: 'exact' | 'range';
  exactCount?: number | null;
  minCount?: number | null;
  maxCount?: number | null;
  allowSkip?: boolean;
  eligibility?: 'all' | 'selected';
  closedAt?: Date | null;
};

describe('secret ballot', () => {
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let otherOrgId: string;
  let eventId: string;
  let order = 0;
  const cat = {} as Record<
    'exact' | 'range' | 'skip' | 'noSkip' | 'yesNo' | 'selected' | 'closed',
    { id: string; contesters: string[] }
  >;

  async function createEvent(org: string, status: EventStatus, endAt?: Date) {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: org,
        name: `Uchaguzi ${uniqueSuffix()}`,
        startAt: new Date(Date.now() - 3_600_000),
        endAt: endAt ?? new Date(Date.now() + 8 * 3_600_000),
        status,
        ...(status === 'cancelled' && {
          cancelledAt: new Date(),
          cancelReason: 'Mkutano umeahirishwa',
        }),
      },
    });
    return event.id;
  }

  async function createCategory(event: string, contesters: number, rules: Rules = {}) {
    order += 1;
    const category = await owner.category.create({
      data: {
        organizationId: orgId,
        eventId: event,
        name: `Nafasi ${order}`,
        displayOrder: order,
        selectionMode: rules.selectionMode ?? 'exact',
        exactCount: rules.selectionMode === 'range' ? null : (rules.exactCount ?? 1),
        minCount: rules.minCount ?? null,
        maxCount: rules.maxCount ?? null,
        allowSkip: rules.allowSkip ?? false,
        eligibility: rules.eligibility ?? 'all',
        closedAt: rules.closedAt ?? null,
      },
    });
    const ids: string[] = [];
    for (let i = 0; i < contesters; i += 1) {
      const contester = await owner.contester.create({
        data: {
          organizationId: orgId,
          eventId: event,
          categoryId: category.id,
          fullName: `Mgombea ${order}-${i}`,
        },
      });
      ids.push(contester.id);
    }
    return { id: category.id, contesters: ids };
  }

  async function newVoter(event = eventId, org = orgId): Promise<string> {
    const tag = uniqueSuffix();
    const voter = await owner.voter.create({
      data: {
        organizationId: org,
        eventId: event,
        fullName: `Mpiga kura ${tag}`,
        membershipId: tag,
        phone: '+255712000001',
        gender: 'female',
      },
    });
    return voter.id;
  }

  function cast(
    voterId: string,
    selections: unknown,
    event = eventId,
    ctx = orgContext(orgId),
  ): Promise<CastResult> {
    return api.withContext(ctx, async (tx) => {
      const [row] = await tx.$queryRaw<{ result: CastResult }[]>`
        SELECT app.cast_ballot(${voterId}::uuid, ${event}::uuid, ${JSON.stringify(selections)}::jsonb,
                               'web'::vote_channel) AS result`;
      if (!row) throw new Error('no result');
      return row.result;
    });
  }

  const one = (category: { id: string; contesters: string[] }, picks: number[]): Selection => ({
    categoryId: category.id,
    choice: 'contester',
    contesterIds: picks.map((i) => category.contesters[i]),
  });

  /** Selections recorded in a category, read as the owner (the tests' only window on ballots). */
  const selectionsIn = async (categoryId: string) =>
    owner.ballotSelection.count({ where: { categoryId } });

  beforeAll(async () => {
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Kura');
    otherOrgId = await createOrganization(owner, 'Chama Kingine');
    eventId = await createEvent(orgId, 'open');
    cat.exact = await createCategory(eventId, 3, { selectionMode: 'exact', exactCount: 1 });
    cat.range = await createCategory(eventId, 4, {
      selectionMode: 'range',
      minCount: 1,
      maxCount: 2,
    });
    cat.skip = await createCategory(eventId, 2, { allowSkip: true });
    cat.noSkip = await createCategory(eventId, 2, { allowSkip: false });
    cat.yesNo = await createCategory(eventId, 1, { allowSkip: true });
    cat.selected = await createCategory(eventId, 2, { eligibility: 'selected' });
    cat.closed = await createCategory(eventId, 2, { closedAt: new Date() });
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId, otherOrgId]);
    await owner.$disconnect();
    await api.$disconnect();
  });

  it('keeps the ballot schema out of reach of vk_api', async () => {
    const ctx = orgContext(orgId);
    for (const sql of [
      'SELECT * FROM ballot.ballots',
      'SELECT * FROM ballot.ballot_selections',
      'INSERT INTO ballot.ballots (event_id, received_hour) VALUES (gen_random_uuid(), now())',
    ]) {
      await expect(api.withContext(ctx, (tx) => tx.$queryRawUnsafe(sql))).rejects.toThrow(
        /permission denied/,
      );
    }
    const voter = await newVoter();
    await expect(
      api.withContext(
        ctx,
        (tx) =>
          tx.$executeRaw`INSERT INTO public.voter_participation (voter_id, category_id, event_id, organization_id, channel, voted_at)
          VALUES (${voter}::uuid, ${cat.exact.id}::uuid, ${eventId}::uuid, ${orgId}::uuid, 'web', now())`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('records a vote: participation for the voter, a ballot with only the event and the hour', async () => {
    const voter = await newVoter();
    const before = await selectionsIn(cat.exact.id);
    const result = await cast(voter, [one(cat.exact, [1])]);
    expect(result).toMatchObject({ recorded: [cat.exact.id], rejected: [] });

    const participation = await owner.voterParticipation.findMany({ where: { voterId: voter } });
    expect(participation).toEqual([
      expect.objectContaining({
        categoryId: cat.exact.id,
        eventId,
        organizationId: orgId,
        channel: 'web',
      }),
    ]);
    expect(participation[0]?.votedAt.toISOString()).toBe(new Date(result.votedAt).toISOString());
    expect(await selectionsIn(cat.exact.id)).toBe(before + 1);
    const selection = await owner.ballotSelection.findFirstOrThrow({
      where: { categoryId: cat.exact.id, contesterId: cat.exact.contesters[1] },
      include: { ballot: true },
    });
    expect(selection.choice).toBe('contester');
    const hour = new Date(result.votedAt);
    hour.setUTCMinutes(0, 0, 0);
    expect(selection.ballot.receivedHour.toISOString()).toBe(hour.toISOString());
    expect(selection.ballot.eventId).toBe(eventId);
  });

  it('gives ballots no column that could identify a voter or the exact time', async () => {
    const columns = await owner.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'ballot' ORDER BY table_name, ordinal_position`;
    const of = (table: string) =>
      columns.filter((c) => c.table_name === table).map((c) => c.column_name);
    expect(of('ballots')).toEqual(['id', 'event_id', 'received_hour']);
    expect(of('ballot_selections')).toEqual([
      'id',
      'ballot_id',
      'category_id',
      'contester_id',
      'choice',
    ]);
    // No foreign key between participation and the ballot tables, in either direction.
    const links = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage u ON u.constraint_name = rc.constraint_name
      WHERE (k.table_schema = 'ballot' AND u.table_name IN ('voter_participation', 'voters'))
         OR (k.table_name = 'voter_participation' AND u.table_schema = 'ballot')`;
    expect(Number(links[0]?.n)).toBe(0);
  });

  it('accepts one vote per voter per category with 20 concurrent submissions', async () => {
    const voter = await newVoter();
    const before = await selectionsIn(cat.range.id);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => cast(voter, [one(cat.range, [i % 4])])),
    );
    const recorded = results.filter((r) => r.recorded.length === 1);
    expect(recorded).toHaveLength(1);
    expect(
      results.filter((r) => r.rejected.some((x) => x.reason === 'ALREADY_VOTED')),
    ).toHaveLength(19);
    expect(await owner.voterParticipation.count({ where: { voterId: voter } })).toBe(1);
    expect(await selectionsIn(cat.range.id)).toBe(before + 1);
  }, 60_000);

  it('refuses everything after the end time and once the event is not Open', async () => {
    const ended = await createEvent(orgId, 'open', new Date(Date.now() - 60_000));
    const endedCat = await createCategory(ended, 2);
    const late = await newVoter(ended);
    await expect(cast(late, [one(endedCat, [0])], ended)).rejects.toThrow(/VOTING_CLOSED/);

    for (const status of ['closed', 'scheduled', 'cancelled'] as const) {
      const event = await createEvent(orgId, status);
      const category = await createCategory(event, 2);
      const voter = await newVoter(event);
      await expect(cast(voter, [one(category, [0])], event)).rejects.toThrow(/VOTING_CLOSED/);
      expect(await owner.voterParticipation.count({ where: { voterId: voter } })).toBe(0);
    }
  });

  it('records the open categories of a submission and reports the others', async () => {
    const voter = await newVoter();
    const missing = randomUUID();
    const result = await cast(voter, [
      one(cat.closed, [0]),
      one(cat.selected, [0]),
      one(cat.exact, [0]),
      { categoryId: missing, choice: 'contester', contesterIds: [cat.exact.contesters[0]] },
      one(cat.exact, [2]), // the same category twice in one submission
      one(cat.noSkip, [0]),
    ]);
    expect(result.recorded).toEqual([cat.exact.id, cat.noSkip.id]);
    expect(result.rejected).toEqual([
      { categoryId: cat.closed.id, reason: 'CATEGORY_CLOSED' },
      { categoryId: cat.selected.id, reason: 'NOT_ELIGIBLE' },
      { categoryId: missing, reason: 'CATEGORY_NOT_FOUND' },
      { categoryId: cat.exact.id, reason: 'ALREADY_VOTED' },
    ]);
    // One ballot for the submission, holding both recorded categories.
    const ballots = await owner.ballotSelection.groupBy({
      by: ['ballotId'],
      where: {
        OR: [
          { categoryId: cat.exact.id, contesterId: cat.exact.contesters[0] },
          { categoryId: cat.noSkip.id, contesterId: cat.noSkip.contesters[0] },
        ],
      },
      _count: { _all: true },
      having: { ballotId: { _count: { equals: 2 } } },
    });
    expect(ballots.length).toBeGreaterThanOrEqual(1);
  });

  it('lets a voter in a "selected" category vote once added to it', async () => {
    const voter = await newVoter();
    await owner.categoryVoter.create({
      data: { categoryId: cat.selected.id, voterId: voter, organizationId: orgId },
    });
    expect((await cast(voter, [one(cat.selected, [1])])).recorded).toEqual([cat.selected.id]);
  });

  describe('every rule mode', () => {
    const contester = (c: { contesters: string[] }, i: number) => c.contesters[i] ?? '';
    const cases: [string, () => Selection, boolean][] = [
      ['exact: one of three', () => one(cat.exact, [0]), true],
      ['exact: none', () => one(cat.exact, []), false],
      ['exact: two', () => one(cat.exact, [0, 1]), false],
      ['range 1–2: one', () => one(cat.range, [3]), true],
      ['range 1–2: two', () => one(cat.range, [0, 2]), true],
      ['range 1–2: three', () => one(cat.range, [0, 1, 2]), false],
      ['range 1–2: none', () => one(cat.range, []), false],
      ['range: the same contester twice', () => one(cat.range, [1, 1]), false],
      [
        'a contester of another category',
        () => ({
          categoryId: cat.exact.id,
          choice: 'contester',
          contesterIds: [contester(cat.range, 0)],
        }),
        false,
      ],
      ['skip where allowed', () => ({ categoryId: cat.skip.id, choice: 'skipped' }), true],
      ['skip where not allowed', () => ({ categoryId: cat.noSkip.id, choice: 'skipped' }), false],
      [
        'skip with a contester',
        () => ({
          categoryId: cat.skip.id,
          choice: 'skipped',
          contesterIds: [contester(cat.skip, 0)],
        }),
        false,
      ],
      [
        'Yes on the only contester',
        () => ({
          categoryId: cat.yesNo.id,
          choice: 'yes',
          contesterIds: [contester(cat.yesNo, 0)],
        }),
        true,
      ],
      [
        'No on the only contester',
        () => ({ categoryId: cat.yesNo.id, choice: 'no', contesterIds: [contester(cat.yesNo, 0)] }),
        true,
      ],
      [
        'skip on Yes/No where allowed',
        () => ({ categoryId: cat.yesNo.id, choice: 'skipped' }),
        true,
      ],
      [
        'a plain choice on a single contester',
        () => ({
          categoryId: cat.yesNo.id,
          choice: 'contester',
          contesterIds: [contester(cat.yesNo, 0)],
        }),
        false,
      ],
      [
        'Yes in a category with several contesters',
        () => ({
          categoryId: cat.exact.id,
          choice: 'yes',
          contesterIds: [contester(cat.exact, 0)],
        }),
        false,
      ],
      ['Yes without the contester', () => ({ categoryId: cat.yesNo.id, choice: 'yes' }), false],
      ['an unknown choice', () => ({ ...one(cat.exact, [0]), choice: 'maybe' }), false],
      [
        'a malformed contester id',
        () => ({ categoryId: cat.exact.id, choice: 'contester', contesterIds: ['not-a-uuid'] }),
        false,
      ],
      [
        'contester ids that are not a list',
        () => ({ categoryId: cat.exact.id, choice: 'contester', contesterIds: 'x' }),
        false,
      ],
    ];

    it.each(cases)('%s', async (_name, selection, accepted) => {
      const voter = await newVoter();
      const chosen = selection();
      const result = await cast(voter, [chosen]);
      if (accepted) {
        expect(result).toMatchObject({ recorded: [chosen.categoryId], rejected: [] });
      } else {
        expect(result).toEqual(
          expect.objectContaining({
            recorded: [],
            rejected: [{ categoryId: chosen.categoryId, reason: 'RULE_NOT_MET' }],
          }),
        );
        expect(await owner.voterParticipation.count({ where: { voterId: voter } })).toBe(0);
      }
    });

    it('records a skip with no contester and Yes/No against the contester', async () => {
      const skipper = await newVoter();
      await cast(skipper, [{ categoryId: cat.skip.id, choice: 'skipped' }]);
      expect(
        await owner.ballotSelection.count({
          where: { categoryId: cat.skip.id, choice: 'skipped', contesterId: null },
        }),
      ).toBeGreaterThanOrEqual(1);
      const no = await newVoter();
      await cast(no, [
        { categoryId: cat.yesNo.id, choice: 'no', contesterIds: [contester(cat.yesNo, 0)] },
      ]);
      expect(
        await owner.ballotSelection.count({
          where: { categoryId: cat.yesNo.id, choice: 'no', contesterId: contester(cat.yesNo, 0) },
        }),
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it('rejects malformed input without failing the whole call', async () => {
    const voter = await newVoter();
    const result = await cast(voter, [
      { categoryId: 'not-a-uuid', choice: 'contester', contesterIds: [] },
      'just text',
      one(cat.noSkip, [1]),
    ]);
    expect(result.recorded).toEqual([cat.noSkip.id]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'CATEGORY_NOT_FOUND',
      'CATEGORY_NOT_FOUND',
    ]);
    await expect(cast(voter, { not: 'a list' })).rejects.toThrow(/VALIDATION_FAILED/);
  });

  it('finds no voter outside the caller organization or without a context', async () => {
    const voter = await newVoter();
    await expect(
      cast(voter, [one(cat.exact, [0])], eventId, orgContext(otherOrgId)),
    ).rejects.toThrow(/NOT_FOUND/);
    await expect(cast(voter, [one(cat.exact, [0])], eventId, noContext())).rejects.toThrow(
      /NOT_FOUND/,
    );
    // A voter of another event of the same organization.
    const other = await createEvent(orgId, 'open');
    const stranger = await newVoter(other);
    await expect(cast(stranger, [one(cat.exact, [0])])).rejects.toThrow(/NOT_FOUND/);
    expect(
      await owner.voterParticipation.count({ where: { voterId: { in: [voter, stranger] } } }),
    ).toBe(0);
  });

  it('allows no UPDATE, DELETE or TRUNCATE on ballots or participation, even for the owner', async () => {
    const voter = await newVoter();
    await cast(voter, [one(cat.noSkip, [0])]);
    const selection = await owner.ballotSelection.findFirstOrThrow({
      where: { categoryId: cat.noSkip.id },
    });
    for (const sql of [
      `UPDATE public.voter_participation SET channel = 'kiosk' WHERE voter_id = '${voter}'`,
      `DELETE FROM public.voter_participation WHERE voter_id = '${voter}'`,
      `UPDATE ballot.ballots SET received_hour = received_hour WHERE id = '${selection.ballotId}'`,
      `DELETE FROM ballot.ballots WHERE id = '${selection.ballotId}'`,
      `UPDATE ballot.ballot_selections SET contester_id = contester_id WHERE id = '${selection.id}'`,
      `DELETE FROM ballot.ballot_selections WHERE id = '${selection.id}'`,
      'TRUNCATE public.voter_participation',
      'TRUNCATE ballot.ballot_selections',
      // Same lock order as the test clean-up (ballots, then selections), so parallel test files
      // cannot deadlock against it.
      'TRUNCATE ballot.ballots, ballot.ballot_selections',
    ]) {
      await expect(owner.$executeRawUnsafe(sql)).rejects.toThrow(/IMMUTABLE_RECORD/);
    }
    // As vk_api: no privilege at all.
    await expect(
      api.withContext(
        orgContext(orgId),
        (tx) =>
          tx.$executeRaw`DELETE FROM public.voter_participation WHERE voter_id = ${voter}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
    expect(await owner.voterParticipation.count({ where: { voterId: voter } })).toBe(1);
  });
});
