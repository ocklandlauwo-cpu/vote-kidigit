// Database rules of migration 011 (Implementation Plan step 15, Backend Schema 5, 11.2, 11.5):
// the setup lock after publish with only the allowed columns changeable, the event and category
// window checks, every status transition, the publish checklist and the votable / eligible
// functions. Writes run as vk_api inside an organization context, exactly as the API does;
// fixtures are seeded as the owner.
import type { PrismaClient } from '../generated/prisma/client.js';
import type { EventStatus } from '../generated/prisma/enums.js';
import {
  apiClient,
  createOrganization,
  deleteOrganizations,
  orgContext,
  ownerClient,
  uniqueSuffix,
} from '../testing/db.js';
import type { PrismaService, Tx } from './prisma.service.js';

const HOUR = 3_600_000;
const STATUSES: EventStatus[] = [
  'draft',
  'scheduled',
  'open',
  'closed',
  'results_published',
  'cancelled',
  'archived',
];
const PUBLISHED: EventStatus[] = STATUSES.filter((s) => s !== 'draft');

/** Backend Schema 11.5, as far as step 15 goes (close, reopen, publish results: step 27). */
const ALLOWED = new Set([
  'draft>scheduled',
  'draft>open',
  'scheduled>open',
  'scheduled>draft',
  'draft>cancelled',
  'scheduled>cancelled',
  'open>cancelled',
  'results_published>archived',
  'cancelled>archived',
]);

interface Fixture {
  eventId: string;
  categoryId: string;
  contesterId: string;
  voterId: string;
}

describe('events: setup lock, windows, transitions and checklist', () => {
  let owner: PrismaClient;
  let api: PrismaService;
  let orgId: string;
  let otherOrgId: string;

  const asApi = <T>(fn: (tx: Tx) => Promise<T>, org = orgId) =>
    api.withContext(orgContext(org), fn);

  /** A complete Draft event (passes the checklist): one category, two contesters, one voter. */
  async function completeEvent(overrides: { startAt?: Date; endAt?: Date } = {}): Promise<Fixture> {
    const event = await owner.votingEvent.create({
      data: {
        organizationId: orgId,
        name: `AGM ${uniqueSuffix()}`,
        startAt: overrides.startAt ?? new Date(Date.now() + 24 * HOUR),
        endAt: overrides.endAt ?? new Date(Date.now() + 48 * HOUR),
      },
    });
    const category = await owner.category.create({
      data: { organizationId: orgId, eventId: event.id, name: 'Mwenyekiti', displayOrder: 1 },
    });
    const contester = await owner.contester.create({
      data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName: 'Asha' },
    });
    await owner.contester.create({
      data: { organizationId: orgId, eventId: event.id, categoryId: category.id, fullName: 'Juma' },
    });
    const voter = await owner.voter.create({
      data: {
        organizationId: orgId,
        eventId: event.id,
        fullName: 'Neema',
        membershipId: `M-${uniqueSuffix()}`,
        phone: '+255712000001',
        gender: 'female',
      },
    });
    return {
      eventId: event.id,
      categoryId: category.id,
      contesterId: contester.id,
      voterId: voter.id,
    };
  }

  /** Puts an event straight into a status, as the owner (bypassing the lifecycle rules). */
  async function setStatus(eventId: string, status: EventStatus): Promise<void> {
    await owner.votingEvent.update({
      where: { id: eventId },
      data: {
        status,
        ...(status === 'cancelled' && { cancelReason: 'Seeded for a test' }),
        ...(status === 'open' && { openedAt: new Date() }),
      },
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    api = apiClient();
    orgId = await createOrganization(owner, 'Chama cha Uchaguzi');
    otherOrgId = await createOrganization(owner, 'Shirika Jingine');
  });

  afterAll(async () => {
    await deleteOrganizations(owner, [orgId, otherOrgId]);
    await owner.$disconnect();
    await api.$disconnect();
  });

  describe('setup lock (Backend Schema 11.2)', () => {
    it('allows any change while the event is Draft', async () => {
      const f = await completeEvent();
      await asApi(async (tx) => {
        await tx.category.update({
          where: { id: f.categoryId },
          data: { name: 'Katibu', seats: 1 },
        });
        await tx.contester.update({
          where: { id: f.contesterId },
          data: { fullName: 'Asha Mwinyi' },
        });
        await tx.voter.update({ where: { id: f.voterId }, data: { phone: '+255712000009' } });
        await tx.categoryVoter.create({
          data: { categoryId: f.categoryId, voterId: f.voterId, organizationId: orgId },
        });
        await tx.categoryVoter.deleteMany({ where: { categoryId: f.categoryId } });
        await tx.contester.delete({ where: { id: f.contesterId } });
      });
    });

    describe.each(PUBLISHED)('when %s', (status) => {
      let f: Fixture;
      beforeAll(async () => {
        f = await completeEvent();
        await owner.categoryVoter.create({
          data: { categoryId: f.categoryId, voterId: f.voterId, organizationId: orgId },
        });
        await setStatus(f.eventId, status);
      });

      const locked = (fn: (tx: Tx) => Promise<unknown>) =>
        expect(asApi(fn)).rejects.toThrow('EVENT_LOCKED');

      it('nothing can be added or removed', async () => {
        await locked((tx) =>
          tx.category.create({
            data: { organizationId: orgId, eventId: f.eventId, name: 'Mpya', displayOrder: 2 },
          }),
        );
        await locked((tx) => tx.category.delete({ where: { id: f.categoryId } }));
        await locked((tx) =>
          tx.contester.create({
            data: {
              organizationId: orgId,
              eventId: f.eventId,
              categoryId: f.categoryId,
              fullName: 'X',
            },
          }),
        );
        await locked((tx) => tx.contester.delete({ where: { id: f.contesterId } }));
        await locked((tx) =>
          tx.voter.create({
            data: {
              organizationId: orgId,
              eventId: f.eventId,
              fullName: 'X',
              membershipId: `M-${uniqueSuffix()}`,
              phone: '+255712000003',
              gender: 'male',
            },
          }),
        );
        await locked((tx) => tx.categoryVoter.deleteMany({ where: { categoryId: f.categoryId } }));
      });

      it('setup fields cannot change', async () => {
        await locked((tx) =>
          tx.category.update({ where: { id: f.categoryId }, data: { name: 'Katibu' } }),
        );
        await locked((tx) =>
          tx.category.update({ where: { id: f.categoryId }, data: { seats: 2 } }),
        );
        await locked((tx) =>
          tx.contester.update({ where: { id: f.contesterId }, data: { fullName: 'Y' } }),
        );
        await locked((tx) =>
          tx.voter.update({ where: { id: f.voterId }, data: { phone: '+255712000004' } }),
        );
        await locked((tx) =>
          tx.voter.update({ where: { id: f.voterId }, data: { deletedAt: new Date() } }),
        );
      });

      it(`categories: manual state, close time and active flag change only while open`, async () => {
        const change = asApi((tx) =>
          tx.category.update({ where: { id: f.categoryId }, data: { manualState: 'closed' } }),
        );
        if (status === 'open') await expect(change).resolves.toBeDefined();
        else await expect(change).rejects.toThrow('EVENT_LOCKED');
      });

      it('contesters: withdrawal only while scheduled', async () => {
        const withdraw = asApi((tx) =>
          tx.contester.update({
            where: { id: f.contesterId },
            data: { status: 'withdrawn', withdrawnAt: new Date() },
          }),
        );
        if (status === 'scheduled') await expect(withdraw).resolves.toBeDefined();
        else await expect(withdraw).rejects.toThrow('EVENT_LOCKED');
      });

      it('voters: code delivery and sign-in attempt fields still change', async () => {
        await asApi((tx) =>
          tx.voter.update({
            where: { id: f.voterId },
            data: {
              codeStatus: 'sent',
              codeLastSentAt: new Date(),
              failedAttempts: 2,
              lockedUntil: new Date(Date.now() + HOUR),
            },
          }),
        );
      });
    });
  });

  describe('event row (guard_event_update)', () => {
    it('changes status and lifecycle columns only through transition_event', async () => {
      const f = await completeEvent();
      for (const data of [
        { status: 'open' as const },
        { openedAt: new Date() },
        { reopenCount: 1 },
      ]) {
        await expect(
          asApi((tx) => tx.votingEvent.update({ where: { id: f.eventId }, data })),
        ).rejects.toThrow('INVALID_TRANSITION');
      }
      await asApi((tx) =>
        tx.votingEvent.update({ where: { id: f.eventId }, data: { name: 'Jina Jipya' } }),
      );
    });

    it('keeps details locked after publish, but not the activation, reminders and results settings', async () => {
      const f = await completeEvent();
      await setStatus(f.eventId, 'scheduled');
      for (const data of [
        { name: 'X Y' },
        { endAt: new Date(Date.now() + 72 * HOUR) },
        { showParty: true },
      ]) {
        await expect(
          asApi((tx) => tx.votingEvent.update({ where: { id: f.eventId }, data })),
        ).rejects.toThrow('EVENT_LOCKED');
      }
      await asApi((tx) =>
        tx.votingEvent.update({
          where: { id: f.eventId },
          data: {
            isActive: false,
            reminderBeforeOpenHours: 12,
            reminderBeforeCloseMinutes: null,
            resultsVisibility: 'winners_only',
            firstCodeSentAt: new Date(),
          },
        }),
      );
    });

    it('cannot deactivate an Open event', async () => {
      const f = await completeEvent();
      await setStatus(f.eventId, 'open');
      await expect(
        asApi((tx) =>
          tx.votingEvent.update({ where: { id: f.eventId }, data: { isActive: false } }),
        ),
      ).rejects.toThrow(/voting_events_open_is_active/);
    });

    it('soft-deletes Draft and Cancelled events only', async () => {
      const draft = await completeEvent();
      await asApi((tx) =>
        tx.votingEvent.update({ where: { id: draft.eventId }, data: { deletedAt: new Date() } }),
      );
      const scheduled = await completeEvent();
      await setStatus(scheduled.eventId, 'scheduled');
      await expect(
        asApi((tx) =>
          tx.votingEvent.update({
            where: { id: scheduled.eventId },
            data: { deletedAt: new Date() },
          }),
        ),
      ).rejects.toThrow('EVENT_LOCKED');
      const cancelled = await completeEvent();
      await setStatus(cancelled.eventId, 'cancelled');
      await asApi((tx) =>
        tx.votingEvent.update({
          where: { id: cancelled.eventId },
          data: { deletedAt: new Date() },
        }),
      );
    });
  });

  describe('windows (check_category_window)', () => {
    it('keeps category times inside the event window', async () => {
      const f = await completeEvent();
      const event = await owner.votingEvent.findUniqueOrThrow({ where: { id: f.eventId } });
      const at = (ms: number) => new Date(event.startAt.getTime() + ms);
      const set = (data: { opensAt?: Date | null; closesAt?: Date | null }) =>
        asApi((tx) => tx.category.update({ where: { id: f.categoryId }, data }));

      await set({ opensAt: at(HOUR), closesAt: at(2 * HOUR) });
      await expect(set({ opensAt: at(-HOUR) })).rejects.toThrow('CATEGORY_WINDOW_INVALID');
      await expect(set({ closesAt: at(25 * HOUR) })).rejects.toThrow('CATEGORY_WINDOW_INVALID');
      await expect(set({ opensAt: at(3 * HOUR), closesAt: at(2 * HOUR) })).rejects.toThrow(
        /categories_window/,
      );

      // Shrinking the event so the category falls outside is refused too.
      await expect(
        asApi((tx) =>
          tx.votingEvent.update({ where: { id: f.eventId }, data: { endAt: at(90 * 60_000) } }),
        ),
      ).rejects.toThrow('CATEGORY_WINDOW_INVALID');
    });
  });

  describe('transitions (Backend Schema 11.5)', () => {
    const transition = (
      eventId: string,
      to: EventStatus,
      reason: string | null = 'Kikao kimeahirishwa',
      org = orgId,
    ) =>
      asApi(
        (tx) =>
          tx.$queryRaw<{ status: EventStatus }[]>`
            SELECT status FROM app.transition_event(${eventId}::uuid, ${to}::event_status, ${reason})`,
        org,
      );

    const pairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const));

    it.each(pairs)('%s → %s', async (from, to) => {
      const f = await completeEvent();
      await setStatus(f.eventId, from);
      const result = transition(f.eventId, to);
      if (ALLOWED.has(`${from}>${to}`)) {
        await expect(result).resolves.toEqual([{ status: to }]);
      } else {
        await expect(result).rejects.toThrow('INVALID_TRANSITION');
      }
    });

    it('records the side effects of opening, cancelling and archiving', async () => {
      const f = await completeEvent();
      await transition(f.eventId, 'open');
      let row = await owner.votingEvent.findUniqueOrThrow({ where: { id: f.eventId } });
      expect(row.openedAt).not.toBeNull();
      await transition(f.eventId, 'cancelled', '  Mkutano umeahirishwa  ');
      row = await owner.votingEvent.findUniqueOrThrow({ where: { id: f.eventId } });
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelReason).toBe('Mkutano umeahirishwa');
      await transition(f.eventId, 'archived');
      row = await owner.votingEvent.findUniqueOrThrow({ where: { id: f.eventId } });
      expect(row.archivedAt).not.toBeNull();
    });

    it('needs a complete checklist to publish or open a Draft', async () => {
      const f = await completeEvent();
      await owner.contester.deleteMany({ where: { categoryId: f.categoryId } });
      await expect(transition(f.eventId, 'scheduled')).rejects.toThrow('CHECKLIST_FAILED');
      await expect(transition(f.eventId, 'open')).rejects.toThrow('CHECKLIST_FAILED');
    });

    it('publishes on schedule only with a future start, and opens only before the end', async () => {
      const started = await completeEvent({
        startAt: new Date(Date.now() - HOUR),
        endAt: new Date(Date.now() + HOUR),
      });
      await expect(transition(started.eventId, 'scheduled')).rejects.toThrow('INVALID_TRANSITION');
      await expect(transition(started.eventId, 'open')).resolves.toEqual([{ status: 'open' }]);

      const ended = await completeEvent({
        startAt: new Date(Date.now() - 2 * HOUR),
        endAt: new Date(Date.now() - HOUR),
      });
      await expect(transition(ended.eventId, 'open')).rejects.toThrow('INVALID_TRANSITION');
    });

    it('unpublishes to Draft only until the first code SMS', async () => {
      const f = await completeEvent();
      await transition(f.eventId, 'scheduled');
      await asApi((tx) =>
        tx.votingEvent.update({ where: { id: f.eventId }, data: { firstCodeSentAt: new Date() } }),
      );
      await expect(transition(f.eventId, 'draft')).rejects.toThrow('INVALID_TRANSITION');
    });

    it('cancels only with a reason of at least 10 characters', async () => {
      const f = await completeEvent();
      await expect(transition(f.eventId, 'cancelled', null)).rejects.toThrow('VALIDATION_FAILED');
      await expect(transition(f.eventId, 'cancelled', ' fupi     ')).rejects.toThrow(
        'VALIDATION_FAILED',
      );
    });

    it('does not move a deactivated event', async () => {
      const f = await completeEvent();
      await asApi((tx) =>
        tx.votingEvent.update({ where: { id: f.eventId }, data: { isActive: false } }),
      );
      await expect(transition(f.eventId, 'open')).rejects.toThrow('INVALID_TRANSITION');
    });

    it('cannot reach another organization’s event', async () => {
      const f = await completeEvent();
      await expect(transition(f.eventId, 'open', null, otherOrgId)).rejects.toThrow('NOT_FOUND');
    });
  });

  describe('publish checklist (App Flow 6.3)', () => {
    const checklist = (eventId: string) =>
      asApi(
        (tx) =>
          tx.$queryRaw<{ item: string; ok: boolean; detail: Record<string, unknown> }[]>`
          SELECT item, ok, detail FROM app.publish_checklist(${eventId}::uuid)`,
      );
    const okMap = async (eventId: string) =>
      Object.fromEntries((await checklist(eventId)).map((row) => [row.item, row.ok]));

    it('returns the six items in order and builds up as the event is set up', async () => {
      const event = await owner.votingEvent.create({
        data: {
          organizationId: orgId,
          name: 'AGM 2027',
          startAt: new Date(Date.now() + 24 * HOUR),
          endAt: new Date(Date.now() + 48 * HOUR),
        },
      });
      const rows = await checklist(event.id);
      expect(rows.map((r) => r.item)).toEqual([
        'details',
        'categories',
        'contesters',
        'rules',
        'voters',
        'eligibility',
      ]);
      expect(await okMap(event.id)).toEqual({
        details: true,
        categories: false,
        contesters: false,
        rules: false,
        voters: false,
        eligibility: false,
      });

      // A category with exactly 3 to choose and only 2 contesters: rules fail.
      const chair = await owner.category.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          name: 'Bodi',
          displayOrder: 1,
          exactCount: 3,
          seats: 3,
        },
      });
      // An inactive category never counts.
      await owner.category.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          name: 'Zamani',
          displayOrder: 2,
          isActive: false,
        },
      });
      expect(await okMap(event.id)).toMatchObject({ categories: true, contesters: false });
      for (const name of ['Asha', 'Juma']) {
        await owner.contester.create({
          data: { organizationId: orgId, eventId: event.id, categoryId: chair.id, fullName: name },
        });
      }
      const afterContesters = await checklist(event.id);
      expect(Object.fromEntries(afterContesters.map((r) => [r.item, r.ok]))).toMatchObject({
        contesters: true,
        rules: false,
      });
      expect(afterContesters.find((r) => r.item === 'rules')?.detail).toEqual({
        categoryIds: [chair.id],
      });

      await owner.category.update({ where: { id: chair.id }, data: { exactCount: 1, seats: 1 } });
      expect(await okMap(event.id)).toMatchObject({
        rules: true,
        voters: false,
        eligibility: false,
      });

      const voter = await owner.voter.create({
        data: {
          organizationId: orgId,
          eventId: event.id,
          fullName: 'Neema',
          membershipId: `M-${uniqueSuffix()}`,
          phone: '+255712000001',
          gender: 'female',
        },
      });
      expect(Object.values(await okMap(event.id)).every(Boolean)).toBe(true);

      // Selected eligibility needs linked voters.
      await owner.category.update({ where: { id: chair.id }, data: { eligibility: 'selected' } });
      expect(await okMap(event.id)).toMatchObject({ eligibility: false });
      await owner.categoryVoter.create({
        data: { categoryId: chair.id, voterId: voter.id, organizationId: orgId },
      });
      expect(Object.values(await okMap(event.id)).every(Boolean)).toBe(true);
    });

    it('treats a category with one contester as a valid Yes/No vote', async () => {
      const f = await completeEvent();
      await owner.contester.deleteMany({
        where: { categoryId: f.categoryId, NOT: { id: f.contesterId } },
      });
      await owner.category.update({
        where: { id: f.categoryId },
        data: { exactCount: 2, seats: 2 },
      });
      expect(await okMap(f.eventId)).toMatchObject({ rules: true });
    });
  });

  describe('votable and eligible', () => {
    const votable = (categoryId: string) =>
      asApi(async (tx) => {
        const [row] = await tx.$queryRaw<{ v: boolean }[]>`
          SELECT app.category_is_votable(${categoryId}::uuid) AS v`;
        return row?.v;
      });

    it('is votable only while the event is open and the category is in its window', async () => {
      const f = await completeEvent({
        startAt: new Date(Date.now() - HOUR),
        endAt: new Date(Date.now() + 2 * HOUR),
      });
      expect(await votable(f.categoryId)).toBe(false); // draft
      await setStatus(f.eventId, 'open');
      expect(await votable(f.categoryId)).toBe(true);
      await owner.category.update({
        where: { id: f.categoryId },
        data: { opensAt: new Date(Date.now() + HOUR) },
      });
      expect(await votable(f.categoryId)).toBe(false); // opens later
      await owner.category.update({ where: { id: f.categoryId }, data: { manualState: 'open' } });
      expect(await votable(f.categoryId)).toBe(true); // opened by hand
      await owner.category.update({ where: { id: f.categoryId }, data: { closedAt: new Date() } });
      expect(await votable(f.categoryId)).toBe(false); // closed never reopens
    });

    it('is eligible for every voter of the event, or only the selected ones', async () => {
      const f = await completeEvent();
      const eligible = (voterId: string) =>
        asApi(async (tx) => {
          const [row] = await tx.$queryRaw<{ v: boolean }[]>`
            SELECT app.voter_is_eligible(${voterId}::uuid, ${f.categoryId}::uuid) AS v`;
          return row?.v;
        });
      expect(await eligible(f.voterId)).toBe(true);
      await owner.category.update({
        where: { id: f.categoryId },
        data: { eligibility: 'selected' },
      });
      expect(await eligible(f.voterId)).toBe(false);
      await owner.categoryVoter.create({
        data: { categoryId: f.categoryId, voterId: f.voterId, organizationId: orgId },
      });
      expect(await eligible(f.voterId)).toBe(true);

      // A voter of another event is never eligible, and cannot be linked.
      const other = await completeEvent();
      expect(await eligible(other.voterId)).toBe(false);
      await expect(
        asApi((tx) =>
          tx.categoryVoter.create({
            data: { categoryId: f.categoryId, voterId: other.voterId, organizationId: orgId },
          }),
        ),
      ).rejects.toThrow('NOT_FOUND');
    });

    it('keeps a contester in its category’s event', async () => {
      const f = await completeEvent();
      const other = await completeEvent();
      await expect(
        asApi((tx) =>
          tx.contester.create({
            data: {
              organizationId: orgId,
              eventId: other.eventId,
              categoryId: f.categoryId,
              fullName: 'X',
            },
          }),
        ),
      ).rejects.toThrow(/Foreign key|foreign key/);
    });

    it('normalizes membership IDs and keeps them unique per event', async () => {
      const f = await completeEvent();
      const voter = await owner.voter.findUniqueOrThrow({ where: { id: f.voterId } });
      expect(voter.membershipIdNormalized).toBe(
        voter.membershipId.replace(/\s/g, '').toUpperCase(),
      );
      await expect(
        asApi((tx) =>
          tx.voter.create({
            data: {
              organizationId: orgId,
              eventId: f.eventId,
              fullName: 'Nakala',
              membershipId: ` ${voter.membershipId.toLowerCase()} `,
              phone: '+255712000005',
              gender: 'male',
            },
          }),
        ),
      ).rejects.toThrow(/Unique constraint|unique/i);
    });
  });
});
