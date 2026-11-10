import { Injectable } from '@nestjs/common';
import {
  type Category,
  type CategoryListResponse,
  type CategoryRules,
  type CategoryStatus,
  type ChangeEligibilityRequest,
  type CreateCategoryRequest,
  DEFAULT_CATEGORY_RULES,
  type EligibilityResponse,
  fileUrl,
  type ReorderCategoriesRequest,
  type SetEligibilityRequest,
  type UpdateCategoryRequest,
} from '@vote-kidigit/shared';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { FilesService, type Upload } from '../files/files.service.js';
import { contesterSelect, toContester } from './contesters.mapping.js';

const categorySelect = {
  id: true,
  name: true,
  pictureFileId: true,
  displayOrder: true,
  isActive: true,
  opensAt: true,
  closesAt: true,
  manualState: true,
  closedAt: true,
  selectionMode: true,
  exactCount: true,
  minCount: true,
  maxCount: true,
  seats: true,
  allowSkip: true,
  winnerRule: true,
  thresholdPct: true,
  quorumPct: true,
  eligibility: true,
  contesters: { select: contesterSelect, orderBy: { createdAt: 'asc' } },
  _count: { select: { voters: { where: { voter: { deletedAt: null } } } } },
} satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

/** The columns audited for a category change (no contesters or counts). */
const auditSelect = {
  name: true,
  pictureFileId: true,
  isActive: true,
  opensAt: true,
  closesAt: true,
  selectionMode: true,
  exactCount: true,
  minCount: true,
  maxCount: true,
  seats: true,
  allowSkip: true,
  winnerRule: true,
  thresholdPct: true,
  quorumPct: true,
} satisfies Prisma.CategorySelect;

interface EventFacts {
  status: string;
  endAt: Date;
  voters: number;
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

function rulesOf(row: CategoryRow): CategoryRules {
  return {
    selectionMode: row.selectionMode,
    exactCount: row.exactCount,
    minCount: row.minCount,
    maxCount: row.maxCount,
    seats: row.seats,
    allowSkip: row.allowSkip,
    winnerRule: row.winnerRule,
    thresholdPct: row.thresholdPct === null ? null : row.thresholdPct.toNumber(),
    quorumPct: row.quorumPct === null ? null : row.quorumPct.toNumber(),
  };
}

/** Columns for a rules object; the unused counts are cleared so the stored rules stay clean. */
function rulesData(rules: CategoryRules) {
  return {
    selectionMode: rules.selectionMode,
    exactCount: rules.selectionMode === 'exact' ? rules.exactCount : null,
    minCount: rules.selectionMode === 'range' ? rules.minCount : null,
    maxCount: rules.selectionMode === 'range' ? rules.maxCount : null,
    seats: rules.seats,
    allowSkip: rules.allowSkip,
    winnerRule: rules.winnerRule,
    thresholdPct: rules.winnerRule === 'threshold' ? rules.thresholdPct : null,
    quorumPct: rules.quorumPct,
  };
}

/**
 * Category status for the badge. "Open" is app.category_is_votable() (the one definition);
 * closed means closed by hand, by its own closing time, or with the event.
 */
function statusOf(
  row: CategoryRow,
  event: EventFacts,
  votable: boolean,
  now: Date,
): CategoryStatus {
  if (!row.isActive) return 'inactive';
  if (votable) return 'open';
  const eventOver = ['closed', 'results_published', 'archived'].includes(event.status);
  const timeOver =
    event.status === 'open' &&
    (now >= event.endAt ||
      (row.manualState === 'auto' && row.closesAt !== null && now >= row.closesAt));
  if (row.closedAt || row.manualState === 'closed' || eventOver || timeOver) return 'closed';
  return 'not_open';
}

/** Categories of an event (EVT-04): setup, rules, eligibility, voting window and manual open/close. */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /events/:eventId/categories */
  list(eventId: string): Promise<CategoryListResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.loadEvent(tx, eventId);
      const rows = await tx.category.findMany({
        where: { eventId },
        orderBy: { displayOrder: 'asc' },
        select: categorySelect,
      });
      const votable = await this.votable(tx, eventId);
      const now = new Date();
      return { items: rows.map((row) => this.toCategory(row, event, votable.has(row.id), now)) };
    });
  }

  /** POST /events/:eventId/categories: added at the end of the order, with the default rules. */
  create(eventId: string, body: CreateCategoryRequest): Promise<Category> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.loadEvent(tx, eventId);
      const last = await tx.category.aggregate({
        where: { eventId },
        _max: { displayOrder: true },
      });
      const created = await tx.category.create({
        data: {
          organizationId: this.context().orgId,
          eventId,
          name: body.name,
          displayOrder: (last._max.displayOrder ?? -1) + 1,
          isActive: body.isActive ?? true,
          opensAt: body.opensAt ? new Date(body.opensAt) : null,
          closesAt: body.closesAt ? new Date(body.closesAt) : null,
          ...rulesData(body.rules ?? DEFAULT_CATEGORY_RULES),
        },
        select: { id: true, ...auditSelect },
      });
      const { id, ...after } = created;
      await this.audit.record(tx, {
        action: 'category.create',
        entityType: 'categories',
        entityId: id,
        eventId,
        after,
      });
      return this.loadOne(tx, eventId, id);
    });
  }

  /** PATCH /events/:eventId/categories/:categoryId: details, rules and voting window. */
  update(eventId: string, categoryId: string, body: UpdateCategoryRequest): Promise<Category> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.findCategory(tx, eventId, categoryId, auditSelect);
      const after = await tx.category.update({
        where: { id: categoryId },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.opensAt !== undefined && {
            opensAt: body.opensAt ? new Date(body.opensAt) : null,
          }),
          ...(body.closesAt !== undefined && {
            closesAt: body.closesAt ? new Date(body.closesAt) : null,
          }),
          ...(body.rules && rulesData(body.rules)),
        },
        select: auditSelect,
      });
      await this.audit.record(tx, {
        action: 'category.update',
        entityType: 'categories',
        entityId: categoryId,
        eventId,
        before,
        after,
      });
      return this.loadOne(tx, eventId, categoryId);
    });
  }

  /** DELETE /events/:eventId/categories/:categoryId (Draft only: the database refuses later). */
  async remove(eventId: string, categoryId: string): Promise<void> {
    let removed: string[] = [];
    await this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.findCategory(tx, eventId, categoryId, auditSelect);
      const photos = await tx.contester.findMany({
        where: { categoryId, photoFileId: { not: null } },
        select: { photoFileId: true },
      });
      await tx.category.delete({ where: { id: categoryId } });
      const fileIds = [before.pictureFileId, ...photos.map((p) => p.photoFileId)].filter(
        (id): id is string => id !== null,
      );
      removed = await this.files.deleteRows(tx, fileIds);
      await this.audit.record(tx, {
        action: 'category.delete',
        entityType: 'categories',
        entityId: categoryId,
        eventId,
        before,
      });
    });
    await this.files.removeFromDisk(removed);
  }

  /** PUT /events/:eventId/categories/order: every category of the event, in the new order. */
  reorder(eventId: string, body: ReorderCategoriesRequest): Promise<CategoryListResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.loadEvent(tx, eventId);
      const current = await tx.category.findMany({
        where: { eventId },
        orderBy: { displayOrder: 'asc' },
        select: { id: true },
      });
      const known = new Set(current.map((c) => c.id));
      if (
        body.categoryIds.length !== current.length ||
        body.categoryIds.some((id) => !known.has(id))
      ) {
        throw new AppError('VALIDATION_FAILED', 'List every category of the event once.', {
          source: 'body',
          issues: [{ path: 'categoryIds', code: 'mismatch', message: 'every category once' }],
        });
      }
      const unchanged = body.categoryIds.every((id, index) => current[index]?.id === id);
      if (!unchanged) {
        // The (event_id, display_order) key is checked at commit, so orders may swap freely.
        for (const [index, id] of body.categoryIds.entries()) {
          await tx.category.update({ where: { id }, data: { displayOrder: index } });
        }
        await this.audit.record(tx, {
          action: 'category.reorder',
          entityType: 'voting_events',
          entityId: eventId,
          eventId,
          before: { categoryIds: current.map((c) => c.id) },
          after: { categoryIds: body.categoryIds },
        });
      }
      const event = await this.loadEvent(tx, eventId);
      const rows = await tx.category.findMany({
        where: { eventId },
        orderBy: { displayOrder: 'asc' },
        select: categorySelect,
      });
      const votable = await this.votable(tx, eventId);
      const now = new Date();
      return { items: rows.map((row) => this.toCategory(row, event, votable.has(row.id), now)) };
    });
  }

  /** PUT …/eligibility (RUL-07): all event voters, or exactly the listed ones. */
  setEligibility(
    eventId: string,
    categoryId: string,
    body: SetEligibilityRequest,
  ): Promise<EligibilityResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.findCategory(tx, eventId, categoryId, { eligibility: true });
      const beforeCount = await tx.categoryVoter.count({ where: { categoryId } });
      await tx.categoryVoter.deleteMany({ where: { categoryId } });
      if (body.mode === 'selected' && body.voterIds) {
        await this.assertVoters(tx, eventId, body.voterIds, 'voterIds');
        await tx.categoryVoter.createMany({
          data: [...new Set(body.voterIds)].map((voterId) => ({
            categoryId,
            voterId,
            organizationId: this.context().orgId,
          })),
        });
      }
      await tx.category.update({ where: { id: categoryId }, data: { eligibility: body.mode } });
      return this.recordEligibility(tx, eventId, categoryId, before.eligibility, beforeCount);
    });
  }

  /** PATCH …/eligibility: add or remove selected voters; the mode becomes "selected". */
  changeEligibility(
    eventId: string,
    categoryId: string,
    body: ChangeEligibilityRequest,
  ): Promise<EligibilityResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.findCategory(tx, eventId, categoryId, { eligibility: true });
      const beforeCount = await tx.categoryVoter.count({ where: { categoryId } });
      const add = [...new Set(body.add ?? [])];
      await this.assertVoters(tx, eventId, add, 'add');
      if (body.remove?.length) {
        await tx.categoryVoter.deleteMany({ where: { categoryId, voterId: { in: body.remove } } });
      }
      if (add.length) {
        await tx.categoryVoter.createMany({
          data: add.map((voterId) => ({
            categoryId,
            voterId,
            organizationId: this.context().orgId,
          })),
          skipDuplicates: true,
        });
      }
      if (before.eligibility !== 'selected') {
        await tx.category.update({ where: { id: categoryId }, data: { eligibility: 'selected' } });
      }
      return this.recordEligibility(tx, eventId, categoryId, before.eligibility, beforeCount);
    });
  }

  /**
   * POST …/open and …/close while the event is Open (CAT-02). A closed category stays closed:
   * only reopening the whole event (step 27) brings it back.
   */
  setOpen(eventId: string, categoryId: string, open: boolean): Promise<Category> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const event = await this.loadEvent(tx, eventId);
      const before = await this.findCategory(tx, eventId, categoryId, {
        manualState: true,
        closedAt: true,
        isActive: true,
      });
      const reason = (why: string) =>
        new AppError(
          'INVALID_TRANSITION',
          `The category cannot be ${open ? 'opened' : 'closed'}.`,
          {
            reason: why,
          },
        );
      if (event.status !== 'open') throw reason('EVENT_NOT_OPEN');
      if (before.closedAt) throw reason('CATEGORY_CLOSED');
      if (!before.isActive) throw reason('CATEGORY_INACTIVE');
      if (open && before.manualState === 'open') throw reason('ALREADY_OPEN');
      const after = await tx.category.update({
        where: { id: categoryId },
        data: open ? { manualState: 'open' } : { manualState: 'closed', closedAt: new Date() },
        select: { manualState: true, closedAt: true },
      });
      await this.audit.record(tx, {
        action: open ? 'category.open' : 'category.close',
        entityType: 'categories',
        entityId: categoryId,
        eventId,
        before: { manualState: before.manualState, closedAt: before.closedAt },
        after,
      });
      return this.loadOne(tx, eventId, categoryId);
    });
  }

  /** POST …/picture: the cropped 5:7 picture replaces the old one. */
  async uploadPicture(eventId: string, categoryId: string, upload: Upload | undefined) {
    await this.prisma.withContext(this.context(), (tx) =>
      this.findCategory(tx, eventId, categoryId, { id: true }),
    );
    return this.files.withImage('category_picture', upload, async (tx, file, discard) => {
      const before = await this.findCategory(tx, eventId, categoryId, { pictureFileId: true });
      await tx.category.update({ where: { id: categoryId }, data: { pictureFileId: file.id } });
      if (before.pictureFileId) await discard(before.pictureFileId);
      await this.audit.record(tx, {
        action: 'category.picture.update',
        entityType: 'categories',
        entityId: categoryId,
        eventId,
        before,
        after: { pictureFileId: file.id },
      });
      return this.loadOne(tx, eventId, categoryId);
    });
  }

  /** DELETE …/picture */
  async removePicture(eventId: string, categoryId: string): Promise<Category> {
    let removed: string[] = [];
    const category = await this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.findCategory(tx, eventId, categoryId, { pictureFileId: true });
      if (before.pictureFileId) {
        await tx.category.update({ where: { id: categoryId }, data: { pictureFileId: null } });
        removed = await this.files.deleteRows(tx, [before.pictureFileId]);
        await this.audit.record(tx, {
          action: 'category.picture.remove',
          entityType: 'categories',
          entityId: categoryId,
          eventId,
          before,
          after: { pictureFileId: null },
        });
      }
      return this.loadOne(tx, eventId, categoryId);
    });
    await this.files.removeFromDisk(removed);
    return category;
  }

  /** One category as the list shows it. */
  async loadOne(tx: Tx, eventId: string, categoryId: string): Promise<Category> {
    const event = await this.loadEvent(tx, eventId);
    const row = await tx.category.findFirst({
      where: { id: categoryId, eventId },
      select: categorySelect,
    });
    if (!row) throw new AppError('NOT_FOUND');
    const votable = await this.votable(tx, eventId);
    return this.toCategory(row, event, votable.has(row.id), new Date());
  }

  private async recordEligibility(
    tx: Tx,
    eventId: string,
    categoryId: string,
    beforeMode: string,
    beforeCount: number,
  ): Promise<EligibilityResponse> {
    const after = await tx.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { eligibility: true, voters: { select: { voterId: true } } },
    });
    // Counts only: the audit log does not list voters.
    await this.audit.record(tx, {
      action: 'category.eligibility.update',
      entityType: 'categories',
      entityId: categoryId,
      eventId,
      before: { eligibility: beforeMode, selectedVoters: beforeCount },
      after: { eligibility: after.eligibility, selectedVoters: after.voters.length },
    });
    return { mode: after.eligibility, voterIds: after.voters.map((v) => v.voterId) };
  }

  private async assertVoters(tx: Tx, eventId: string, ids: string[], path: string): Promise<void> {
    if (ids.length === 0) return;
    const found = await tx.voter.findMany({
      where: { id: { in: ids }, eventId, deletedAt: null },
      select: { id: true },
    });
    const known = new Set(found.map((v) => v.id));
    const index = ids.findIndex((id) => !known.has(id));
    if (index >= 0) {
      throw new AppError('VALIDATION_FAILED', 'Not a voter of this event.', {
        source: 'body',
        issues: [{ path: `${path}.${index}`, code: 'not_found', message: 'not found' }],
      });
    }
  }

  private async findCategory<S extends Prisma.CategorySelect>(
    tx: Tx,
    eventId: string,
    categoryId: string,
    select: S,
  ): Promise<Prisma.CategoryGetPayload<{ select: S }>> {
    const row = await tx.category.findFirst({ where: { id: categoryId, eventId }, select });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async loadEvent(tx: Tx, eventId: string): Promise<EventFacts> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        status: true,
        endAt: true,
        _count: { select: { voters: { where: { deletedAt: null } } } },
      },
    });
    if (!event) throw new AppError('NOT_FOUND');
    return { status: event.status, endAt: event.endAt, voters: event._count.voters };
  }

  private async votable(tx: Tx, eventId: string): Promise<Set<string>> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM public.categories c
      WHERE c.event_id = ${eventId}::uuid AND app.category_is_votable(c.id)`;
    return new Set(rows.map((row) => row.id));
  }

  private toCategory(row: CategoryRow, event: EventFacts, votable: boolean, now: Date): Category {
    const contesters = row.contesters.map(toContester);
    return {
      id: row.id,
      name: row.name,
      pictureUrl: row.pictureFileId ? fileUrl(row.pictureFileId) : null,
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      opensAt: iso(row.opensAt),
      closesAt: iso(row.closesAt),
      manualState: row.manualState,
      closedAt: iso(row.closedAt),
      status: statusOf(row, event, votable, now),
      rules: rulesOf(row),
      eligibility: row.eligibility,
      eligibleVoters: row.eligibility === 'all' ? event.voters : row._count.voters,
      yesNo: contesters.filter((c) => c.status === 'active').length === 1,
      contesters,
    };
  }

  /** Platform administrators have no organization and no events of their own. */
  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
