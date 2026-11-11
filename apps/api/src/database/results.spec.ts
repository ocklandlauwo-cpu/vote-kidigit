// Results in the database (Implementation Plan step 27, Backend Schema 6.4–6.7, 11.5, 11.7 and
// the 11 Nov 2026 change): winners for plurality, multiple seats, threshold, quorum and Yes/No; a
// tie at the last seat blocks publication until resolved; the same data gives the same hash;
// nothing changes after publication; reopen keeps ballots and still blocks double votes; ballots
// are sealed at close.
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  apiClient,
  createOrganization,
  createUser,
  deleteOrganizations,
  orgContext,
  ownerClient,
  uniqueSuffix,
} from '../testing/db.js';
import type { PrismaService } from './prisma.service.js';

interface CategorySetup {
  name: string;
  contesters: string[];
  seats?: number;
  exactCount?: number;
  thresholdPct?: number;
  quorumPct?: number;
  allowSkip?: boolean;
}

describe('results', () => {
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let userId: string;
  let order = 0;

  const ctx = () => orgContext(orgId, userId);

  async function setupEvent(categories: CategorySetup[], voters: number) {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `Matokeo ${uniqueSuffix()}`,
        startAt: new Date(Date.now() - 3_600_000),
        endAt: new Date(Date.now() + 8 * 3_600_000),
        status: 'open',
      },
    });
    const made: { id: string; contesters: Record<string, string> }[] = [];
    for (const setup of categories) {
      order += 1;
      const category = await owner.category.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          name: `${setup.name} ${order}`,
          displayOrder: order,
          seats: setup.seats ?? 1,
          exactCount: setup.exactCount ?? setup.seats ?? 1,
          thresholdPct: setup.thresholdPct ?? null,
          quorumPct: setup.quorumPct ?? null,
          allowSkip: setup.allowSkip ?? false,
        },
      });
      const contesters: Record<string, string> = {};
      for (const fullName of setup.contesters) {
        const contester = await owner.contester.create({
          data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName },
        });
        contesters[fullName] = contester.id;
      }
      made.push({ id: category.id, contesters });
    }
    const tag = uniqueSuffix();
    await owner.voter.createMany({
      data: Array.from({ length: voters }, (_, i) => ({
        organizationId: orgId,
        eventId: event.id,
        fullName: `Mpiga ${i}`,
        membershipId: `${tag}-${String(i).padStart(3, '0')}`,
        phone: '+255712000001',
        gender: 'female' as const,
      })),
    });
    const voterIds = (
      await owner.voter.findMany({ where: { eventId: event.id }, orderBy: { membershipId: 'asc' } })
    ).map((v) => v.id);
    return { eventId: event.id, categories: made, voterIds };
  }

  async function vote(eventId: string, voterId: string, selections: object[]) {
    const [row] = await api.withContext(ctx(), (tx) =>
      tx.$queryRawUnsafe<{ result: { recorded: string[] } }[]>(
        `SELECT app.cast_ballot($1::uuid, $2::uuid, $3::jsonb, 'web'::vote_channel) AS result`,
        voterId,
        eventId,
        JSON.stringify(selections),
      ),
    );
    return row?.result;
  }

  const pick = (categoryId: string, ids: string[]) => ({
    categoryId,
    choice: 'contester',
    contesterIds: ids,
  });

  const transition = (
    eventId: string,
    to: string,
    extra: { reason?: string; endAt?: Date; token?: string } = {},
  ) =>
    api.withContext(ctx(), (tx) =>
      tx.$queryRawUnsafe(
        `SELECT id FROM app.transition_event($1::uuid, $2::event_status, $3, $4::timestamptz, $5)`,
        eventId,
        to,
        extra.reason ?? null,
        extra.endAt ?? null,
        extra.token ?? null,
      ),
    );

  async function current(eventId: string) {
    const snapshot = await owner.resultSnapshot.findFirstOrThrow({
      where: { eventId, isCurrent: true },
      include: { stats: true, rows: true },
    });
    const winners = (categoryId: string, names: Record<string, string>) =>
      snapshot.rows
        .filter((r) => r.categoryId === categoryId && r.isWinner)
        .map((r) => Object.keys(names).find((n) => names[n] === r.contesterId))
        .sort();
    const stat = (categoryId: string) => snapshot.stats.find((s) => s.categoryId === categoryId);
    return { snapshot, winners, stat };
  }

  beforeAll(async () => {
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Matokeo');
    userId = await createUser(owner, orgId);
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId]);
    await owner.$disconnect();
    await api.$disconnect();
  });

  it('elects by plurality, several seats, threshold, quorum and Yes/No', async () => {
    const e = await setupEvent(
      [
        { name: 'Mwenyekiti', contesters: ['Asha', 'Juma', 'Neema'] },
        { name: 'Wajumbe', contesters: ['A', 'B', 'C', 'D'], seats: 2 },
        { name: 'Katibu', contesters: ['X', 'Y'], thresholdPct: 60 },
        { name: 'Mhazini', contesters: ['P', 'Q'], quorumPct: 90 },
        { name: 'Mlezi', contesters: ['Rehema'] },
      ],
      10,
    );
    const [chair, board, secretary, treasurer, patron] = e.categories as [
      (typeof e.categories)[number],
      (typeof e.categories)[number],
      (typeof e.categories)[number],
      (typeof e.categories)[number],
      (typeof e.categories)[number],
    ];
    const c = (cat: typeof chair, ...names: string[]) => names.map((n) => cat.contesters[n] ?? '');
    // 10 voters: chair Asha 5, Juma 3, Neema 2; board A 6, B 5, C 4, D 5 (two each);
    // secretary X 5 vs Y 5 → nobody reaches 60%; treasurer only 5 of 10 vote (quorum 90%);
    // patron Yes 6, No 4.
    const plan: [string[], string[], string, string | null, 'yes' | 'no'][] = [
      [['Asha'], ['A', 'B'], 'X', 'P', 'yes'],
      [['Asha'], ['A', 'B'], 'X', 'P', 'yes'],
      [['Asha'], ['A', 'D'], 'X', 'P', 'yes'],
      [['Asha'], ['A', 'D'], 'X', 'Q', 'yes'],
      [['Asha'], ['A', 'C'], 'X', 'Q', 'yes'],
      [['Juma'], ['A', 'C'], 'Y', null, 'yes'],
      [['Juma'], ['B', 'C'], 'Y', null, 'no'],
      [['Juma'], ['B', 'D'], 'Y', null, 'no'],
      [['Neema'], ['B', 'D'], 'Y', null, 'no'],
      [['Neema'], ['C', 'D'], 'Y', null, 'no'],
    ];
    for (const [i, [ch, bd, sec, tr, yn]] of plan.entries()) {
      const selections: object[] = [
        pick(chair.id, c(chair, ...ch)),
        pick(board.id, c(board, ...bd)),
        pick(secretary.id, c(secretary, sec)),
        { categoryId: patron.id, choice: yn, contesterIds: c(patron, 'Rehema') },
      ];
      if (tr) selections.push(pick(treasurer.id, c(treasurer, tr)));
      const result = await vote(e.eventId, e.voterIds[i] ?? '', selections);
      expect(result?.recorded).toHaveLength(tr ? 5 : 4);
    }
    await transition(e.eventId, 'closed');
    const { snapshot, winners, stat } = await current(e.eventId);
    expect(snapshot).toMatchObject({ version: 1, registeredVoters: 10, votersVoted: 10 });
    expect(winners(chair.id, chair.contesters)).toEqual(['Asha']);
    // Board: A 6, B 5, D 5, C 4, two seats → A, then B and D tie for the second seat.
    expect(stat(board.id)?.hasTie).toBe(true);
    expect(winners(board.id, board.contesters)).toEqual(['A']);
    expect(winners(secretary.id, secretary.contesters)).toEqual([]);
    expect(stat(secretary.id)).toMatchObject({ thresholdMet: false, hasTie: false });
    expect(stat(treasurer.id)).toMatchObject({
      quorumMet: false,
      votersVoted: 5,
      eligibleVoters: 10,
    });
    expect(winners(treasurer.id, treasurer.contesters)).toEqual([]);
    const patronRows = snapshot.rows.filter((r) => r.categoryId === patron.id);
    expect(patronRows.map((r) => [r.choice, r.votes, r.isWinner]).sort()).toEqual([
      ['no', 4, false],
      ['yes', 6, true],
    ]);
    const chairRow = snapshot.rows.find((r) => r.contesterId === chair.contesters.Asha);
    expect([chairRow?.votes, Number(chairRow?.percent), chairRow?.rank]).toEqual([5, 50, 1]);

    // The tie blocks publication until it is resolved.
    await expect(
      transition(e.eventId, 'results_published', { token: 't'.repeat(32) }),
    ).rejects.toThrow(/UNRESOLVED_TIES/);
    const resolve = (ids: string[], reason = 'Kura ya bahati mbele ya mashahidi') =>
      api.withContext(ctx(), (tx) =>
        tx.$executeRawUnsafe(
          `SELECT app.resolve_tie($1::uuid, $2::uuid, 'contester', $3::uuid[], $4)`,
          snapshot.id,
          board.id,
          ids,
          reason,
        ),
      );
    // Not in the tied group, two for one seat, or no reason: refused.
    await expect(resolve(c(board, 'C'))).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(resolve(c(board, 'B', 'D'))).rejects.toThrow(/VALIDATION_FAILED/);
    await expect(resolve(c(board, 'D'), 'short')).rejects.toThrow(/VALIDATION_FAILED/);
    await resolve(c(board, 'D'));
    const resolved = await current(e.eventId);
    expect(resolved.winners(board.id, board.contesters)).toEqual(['A', 'D']);
    expect(resolved.snapshot.contentHash).not.toBe(snapshot.contentHash);

    await transition(e.eventId, 'results_published', { token: 't'.repeat(32) });
    const published = await owner.resultSnapshot.findFirstOrThrow({ where: { id: snapshot.id } });
    expect(published.publishedAt).not.toBeNull();

    // The same data gives the same hash.
    const [again] = await owner.$queryRaw<
      { h: string }[]
    >`SELECT app.result_hash(${snapshot.id}::uuid) AS h`;
    expect(again?.h).toBe(published.contentHash);

    // Nothing changes after publication, not even for the owner.
    await expect(
      owner.$executeRaw`UPDATE public.result_rows SET votes = votes + 1 WHERE snapshot_id = ${snapshot.id}::uuid`,
    ).rejects.toThrow(/RESULTS_PUBLISHED/);
    await expect(
      owner.$executeRaw`UPDATE public.result_snapshots SET content_hash = repeat('0', 64) WHERE id = ${snapshot.id}::uuid`,
    ).rejects.toThrow(/RESULTS_PUBLISHED/);
  });

  it('seals ballots at close: none shares a transaction with a participation row', async () => {
    const e = await setupEvent([{ name: 'Mwenyekiti', contesters: ['Asha', 'Juma'] }], 4);
    const [chair] = e.categories as [(typeof e.categories)[number]];
    for (const voterId of e.voterIds)
      await vote(e.eventId, voterId, [pick(chair.id, [chair.contesters.Asha ?? ''])]);
    const linked = () => owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM ballot.ballots b
      JOIN public.voter_participation p ON p.xmin = b.xmin
      WHERE b.event_id = ${e.eventId}::uuid AND p.event_id = ${e.eventId}::uuid`;
    expect(Number((await linked())[0]?.n)).toBe(4);
    const before = (await owner.ballot.findMany({ where: { eventId: e.eventId } })).map(
      (b) => b.id,
    );
    await transition(e.eventId, 'closed');
    expect(Number((await linked())[0]?.n)).toBe(0);
    const after = await owner.ballot.findMany({ where: { eventId: e.eventId } });
    expect(after).toHaveLength(4);
    expect(after.some((b) => before.includes(b.id))).toBe(false);
    expect(await owner.ballotSelection.count({ where: { ballot: { eventId: e.eventId } } })).toBe(
      4,
    );
    const { winners } = await current(e.eventId);
    expect(winners(chair.id, chair.contesters)).toEqual(['Asha']);
  });

  it('reopens with existing ballots, still one vote per category, and a new version at close', async () => {
    const e = await setupEvent(
      [
        { name: 'Mwenyekiti', contesters: ['Asha', 'Juma'] },
        { name: 'Katibu', contesters: ['X', 'Y'] },
      ],
      3,
    );
    const [chair, secretary] = e.categories as [
      (typeof e.categories)[number],
      (typeof e.categories)[number],
    ];
    await vote(e.eventId, e.voterIds[0] ?? '', [pick(chair.id, [chair.contesters.Asha ?? ''])]);
    await transition(e.eventId, 'closed');
    await expect(
      transition(e.eventId, 'open', { reason: 'short', endAt: new Date(Date.now() + 3_600_000) }),
    ).rejects.toThrow(/VALIDATION_FAILED/);
    await transition(e.eventId, 'open', {
      reason: 'Muda umeongezwa kwa sababu ya mvua',
      endAt: new Date(Date.now() + 3_600_000),
    });
    const reopened = await owner.votingEvent.findUniqueOrThrow({ where: { id: e.eventId } });
    expect(reopened).toMatchObject({ status: 'open', reopenCount: 1, closedAt: null });
    expect(
      await owner.resultSnapshot.count({ where: { eventId: e.eventId, isCurrent: true } }),
    ).toBe(0);
    // The first voter cannot vote again in the chair; votes in the secretary.
    const second = await vote(e.eventId, e.voterIds[0] ?? '', [
      pick(chair.id, [chair.contesters.Juma ?? '']),
      pick(secretary.id, [secretary.contesters.Y ?? '']),
    ]);
    expect(second?.recorded).toEqual([secretary.id]);
    await vote(e.eventId, e.voterIds[1] ?? '', [pick(chair.id, [chair.contesters.Asha ?? ''])]);
    await transition(e.eventId, 'closed');
    const { snapshot, winners } = await current(e.eventId);
    expect(snapshot.version).toBe(2);
    expect(snapshot.rows.find((r) => r.contesterId === chair.contesters.Asha)?.votes).toBe(2);
    expect(winners(secretary.id, secretary.contesters)).toEqual(['Y']);
  });

  it('gives vk_api no way to count ballots before close', async () => {
    const e = await setupEvent([{ name: 'Mwenyekiti', contesters: ['Asha', 'Juma'] }], 1);
    for (const fn of ['app.tally_event', 'app.freeze_results', 'app.seal_ballots']) {
      await expect(
        api.withContext(ctx(), (tx) =>
          tx.$queryRawUnsafe(`SELECT * FROM ${fn}($1::uuid)`, e.eventId),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
