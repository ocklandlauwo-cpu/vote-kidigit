import { Injectable } from '@nestjs/common';
import {
  type BulkVotersRequest,
  type BulkVotersResponse,
  CreateVoterRequestSchema,
  fileUrl,
  maskPhone,
  normalizeMembershipId,
  type PhotoZipResult,
  UpdateVoterRequestSchema,
  type VoterDetail,
  type VoterListQuery,
  type VoterPage,
  type VoterSummary,
} from '@vote-kidigit/shared';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Discard } from '../files/files.service.js';
import { FilesService, type Upload } from '../files/files.service.js';
import { importPhotoZip } from '../files/photo-zip.js';
import { BatchesService } from '../messages/batches.service.js';
import { CodesService, isCodeCollision } from './codes.service.js';

type CreateVoter = z.output<typeof CreateVoterRequestSchema>;
type UpdateVoter = z.output<typeof UpdateVoterRequestSchema>;

const summarySelect = {
  id: true,
  fullName: true,
  membershipId: true,
  phone: true,
  gender: true,
  photoFileId: true,
  codeStatus: true,
  codeGeneratedAt: true,
  categories: { select: { categoryId: true } },
} satisfies Prisma.VoterSelect;

const detailSelect = {
  ...summarySelect,
  email: true,
  codeLastSentAt: true,
  failedAttempts: true,
  lockedUntil: true,
  createdAt: true,
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      type: true,
      channel: true,
      status: true,
      bodyRedacted: true,
      createdAt: true,
      sentAt: true,
      deliveredAt: true,
      failedAt: true,
    },
  },
} satisfies Prisma.VoterSelect;

/** Audited columns: never the code columns (the audit drops them anyway). */
const auditSelect = {
  fullName: true,
  membershipId: true,
  phone: true,
  email: true,
  gender: true,
  photoFileId: true,
} satisfies Prisma.VoterSelect;

type SummaryRow = Prisma.VoterGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.VoterGetPayload<{ select: typeof detailSelect }>;

const iso = (value: Date | null) => value?.toISOString() ?? null;

function toSummary(row: SummaryRow): VoterSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    membershipId: row.membershipId,
    phoneMasked: maskPhone(row.phone),
    gender: row.gender,
    photoUrl: row.photoFileId ? fileUrl(row.photoFileId) : null,
    categoryIds: row.categories.map((c) => c.categoryId),
    codeStatus: row.codeStatus,
    codeGeneratedAt: iso(row.codeGeneratedAt),
  };
}

function toDetail(row: DetailRow): VoterDetail {
  return {
    ...toSummary(row),
    phone: row.phone,
    email: row.email,
    codeLastSentAt: iso(row.codeLastSentAt),
    failedAttempts: row.failedAttempts,
    lockedUntil: iso(row.lockedUntil),
    createdAt: row.createdAt.toISOString(),
    messages: row.messages.map((m) => ({
      id: m.id,
      type: m.type,
      channel: m.channel,
      status: m.status,
      bodyRedacted: m.bodyRedacted,
      createdAt: m.createdAt.toISOString(),
      sentAt: iso(m.sentAt),
      deliveredAt: iso(m.deliveredAt),
      failedAt: iso(m.failedAt),
    })),
  };
}

const membershipTaken = () =>
  new AppError('VALIDATION_FAILED', 'This membership ID is already used in this event.', {
    source: 'body',
    issues: [{ path: 'membershipId', code: 'taken', message: 'already used' }],
  });

const isMembershipConflict = (error: unknown) =>
  error instanceof Error && error.message.includes('voters_event_id_membership_id_normalized_key');

/** Codes are drawn again on the (very rare) fingerprint collision; give up after a few. */
const CODE_ATTEMPTS = 5;

/**
 * Voters of an event (EVT-05, Backend Schema 12.7, PRD VTR-01–VTR-08). Adding, editing and
 * deleting are Draft-only (the database guard); codes can be regenerated at any time.
 */
@Injectable()
export class VotersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly files: FilesService,
    private readonly batches: BatchesService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /events/:eventId/voters: filters, page and totals (registered, by gender). */
  list(eventId: string, query: VoterListQuery): Promise<VoterPage> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.assertEvent(tx, eventId);
      const where: Prisma.VoterWhereInput = { eventId, deletedAt: null };
      if (query.q) {
        const digits = query.q.replace(/\D/g, '');
        where.OR = [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { membershipIdNormalized: { contains: normalizeMembershipId(query.q) } },
          ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ];
      }
      if (query.categoryId) {
        const category = await tx.category.findFirst({
          where: { id: query.categoryId, eventId },
          select: { eligibility: true },
        });
        if (!category) throw new AppError('NOT_FOUND');
        // "All event voters" categories include everyone.
        if (category.eligibility === 'selected') {
          where.categories = { some: { categoryId: query.categoryId } };
        }
      }
      if (query.gender) where.gender = query.gender;
      if (query.codeStatus) where.codeStatus = query.codeStatus;
      const [rows, total, byGender] = await Promise.all([
        tx.voter.findMany({
          where,
          orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: summarySelect,
        }),
        tx.voter.count({ where }),
        tx.voter.groupBy({
          by: ['gender'],
          where: { eventId, deletedAt: null },
          _count: { _all: true },
        }),
      ]);
      const count = (gender: string) => byGender.find((g) => g.gender === gender)?._count._all ?? 0;
      return {
        items: rows.map(toSummary),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totals: {
          registered: count('male') + count('female'),
          male: count('male'),
          female: count('female'),
        },
      };
    });
  }

  /** POST /events/:eventId/voters (VTR-01): the voter gets a code at once (sent in step 21). */
  async create(eventId: string, body: CreateVoter): Promise<VoterDetail> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.withContext(this.context(), async (tx) => {
          await this.assertEvent(tx, eventId);
          const categoryIds = [...new Set(body.categoryIds ?? [])];
          await this.assertCategories(tx, eventId, categoryIds, 'categoryIds');
          const row = await tx.voter.create({
            data: {
              organizationId: this.context().orgId,
              eventId,
              fullName: body.fullName,
              membershipId: body.membershipId,
              phone: body.phone,
              email: body.email ?? null,
              gender: body.gender,
              ...this.codes.issue(),
              codeGeneratedAt: new Date(),
            },
            select: { id: true, ...auditSelect },
          });
          if (categoryIds.length) {
            await tx.categoryVoter.createMany({
              data: categoryIds.map((categoryId) => ({
                categoryId,
                voterId: row.id,
                organizationId: this.context().orgId,
              })),
            });
          }
          const { id, ...after } = row;
          await this.audit.record(tx, {
            action: 'voter.create',
            entityType: 'voters',
            entityId: id,
            eventId,
            after: { ...after, categoryIds },
          });
          return this.loadDetail(tx, eventId, id);
        });
      } catch (error: unknown) {
        if (isMembershipConflict(error)) throw membershipTaken();
        if (isCodeCollision(error) && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** GET /events/:eventId/voters/:voterId */
  detail(eventId: string, voterId: string): Promise<VoterDetail> {
    return this.prisma.withContext(this.context(), (tx) => this.loadDetail(tx, eventId, voterId));
  }

  /** PATCH /events/:eventId/voters/:voterId (Draft only: the database). */
  async update(eventId: string, voterId: string, body: UpdateVoter): Promise<VoterDetail> {
    try {
      return await this.prisma.withContext(this.context(), async (tx) => {
        const before = await this.find(tx, eventId, voterId, auditSelect);
        const after = await tx.voter.update({
          where: { id: voterId },
          data: body,
          select: auditSelect,
        });
        await this.audit.record(tx, {
          action: 'voter.update',
          entityType: 'voters',
          entityId: voterId,
          eventId,
          before,
          after,
        });
        return this.loadDetail(tx, eventId, voterId);
      });
    } catch (error: unknown) {
      if (isMembershipConflict(error)) throw membershipTaken();
      throw error;
    }
  }

  /** DELETE /events/:eventId/voters/:voterId: soft delete, Draft only (the database). */
  async remove(eventId: string, voterId: string): Promise<void> {
    await this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.find(tx, eventId, voterId, auditSelect);
      await tx.voter.update({ where: { id: voterId }, data: { deletedAt: new Date() } });
      await tx.categoryVoter.deleteMany({ where: { voterId } });
      await this.audit.record(tx, {
        action: 'voter.delete',
        entityType: 'voters',
        entityId: voterId,
        eventId,
        before,
      });
    });
  }

  /**
   * POST /events/:eventId/voters/bulk: assign to or remove from a category with "selected"
   * eligibility, or delete (Draft only). Unknown or deleted voters are a validation error.
   */
  bulk(eventId: string, body: BulkVotersRequest): Promise<BulkVotersResponse> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.assertEvent(tx, eventId);
      const voterIds = [...new Set(body.voterIds)];
      const found = await tx.voter.findMany({
        where: { id: { in: voterIds }, eventId, deletedAt: null },
        select: { id: true },
      });
      const known = new Set(found.map((v) => v.id));
      const missing = voterIds.findIndex((id) => !known.has(id));
      if (missing >= 0) {
        throw new AppError('VALIDATION_FAILED', 'Not a voter of this event.', {
          source: 'body',
          issues: [{ path: `voterIds.${missing}`, code: 'not_found', message: 'not found' }],
        });
      }
      let affected: number;
      if (body.action === 'delete') {
        affected = (
          await tx.voter.updateMany({
            where: { id: { in: voterIds } },
            data: { deletedAt: new Date() },
          })
        ).count;
        await tx.categoryVoter.deleteMany({ where: { voterId: { in: voterIds } } });
      } else {
        const categoryId = body.categoryId ?? '';
        const category = await tx.category.findFirst({
          where: { id: categoryId, eventId },
          select: { eligibility: true },
        });
        if (!category) throw new AppError('NOT_FOUND');
        if (category.eligibility !== 'selected') {
          // Everyone votes in an "all event voters" category; switch it to "selected" first.
          throw new AppError('VALIDATION_FAILED', 'The category is open to all event voters.', {
            source: 'body',
            issues: [{ path: 'categoryId', code: 'all_voters', message: 'all voters' }],
          });
        }
        affected =
          body.action === 'assign'
            ? (
                await tx.categoryVoter.createMany({
                  data: voterIds.map((voterId) => ({
                    categoryId,
                    voterId,
                    organizationId: this.context().orgId,
                  })),
                  skipDuplicates: true,
                })
              ).count
            : (
                await tx.categoryVoter.deleteMany({
                  where: { categoryId, voterId: { in: voterIds } },
                })
              ).count;
      }
      // Counts only: the audit log does not list voters.
      await this.audit.record(tx, {
        action: `voter.bulk.${body.action}`,
        entityType: body.categoryId ? 'categories' : 'voting_events',
        entityId: body.categoryId ?? eventId,
        eventId,
        after: { voters: voterIds.length, affected },
      });
      return { affected };
    });
  }

  /**
   * POST …/resend-code (COD-05): the same code again by SMS. Codes go out once the event is
   * published (Scheduled or Open).
   */
  async resendCode(eventId: string, voterId: string): Promise<VoterDetail> {
    await this.prisma.withContext(this.context(), async (tx) => {
      await this.find(tx, eventId, voterId, { id: true });
      if (!(await this.published(tx, eventId))) {
        throw new AppError('INVALID_TRANSITION', 'Codes are sent once the event is published.', {
          reason: 'NOT_PUBLISHED',
        });
      }
    });
    await this.batches.send({
      eventId,
      type: 'code_delivery',
      channel: 'sms',
      audience: 'single',
      voterId,
    });
    return this.detail(eventId, voterId);
  }

  /**
   * POST …/regenerate-code (COD-06): a new code replaces the old one, which stops working at
   * once, and is sent by SMS when the event is published (before that it waits as "not sent").
   */
  async regenerateCode(eventId: string, voterId: string): Promise<VoterDetail> {
    const detail = await this.issueNewCode(eventId, voterId);
    const send = await this.prisma.withContext(this.context(), (tx) => this.published(tx, eventId));
    if (!send) return detail;
    await this.batches.send({
      eventId,
      type: 'code_delivery',
      channel: 'sms',
      audience: 'single',
      voterId,
    });
    return this.detail(eventId, voterId);
  }

  private async published(tx: Tx, eventId: string): Promise<boolean> {
    const event = await tx.votingEvent.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { status: true },
    });
    return event?.status === 'scheduled' || event?.status === 'open';
  }

  private async issueNewCode(eventId: string, voterId: string): Promise<VoterDetail> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.withContext(this.context(), async (tx) => {
          await this.find(tx, eventId, voterId, { id: true });
          await tx.voter.update({
            where: { id: voterId },
            data: {
              ...this.codes.issue(),
              codeStatus: 'not_sent',
              codeGeneratedAt: new Date(),
              codeLastSentAt: null,
            },
          });
          await this.audit.record(tx, {
            action: 'voter.code.regenerate',
            entityType: 'voters',
            entityId: voterId,
            eventId,
          });
          return this.loadDetail(tx, eventId, voterId);
        });
      } catch (error: unknown) {
        if (isCodeCollision(error) && attempt < CODE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** POST …/photo: the cropped 5:7 photo replaces the old one (Draft only: the database). */
  async uploadPhoto(eventId: string, voterId: string, upload: Upload | undefined) {
    await this.prisma.withContext(this.context(), (tx) =>
      this.find(tx, eventId, voterId, { id: true }),
    );
    return this.files.withImage('voter_photo', upload, (tx, file, discard) =>
      this.linkPhoto(tx, eventId, voterId, file.id, discard),
    );
  }

  /** DELETE …/photo */
  async removePhoto(eventId: string, voterId: string): Promise<VoterDetail> {
    let removed: string[] = [];
    const voter = await this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.find(tx, eventId, voterId, { photoFileId: true });
      if (before.photoFileId) {
        await tx.voter.update({ where: { id: voterId }, data: { photoFileId: null } });
        removed = await this.files.deleteRows(tx, [before.photoFileId]);
        await this.audit.record(tx, {
          action: 'voter.photo.remove',
          entityType: 'voters',
          entityId: voterId,
          eventId,
          before,
          after: { photoFileId: null },
        });
      }
      return this.loadDetail(tx, eventId, voterId);
    });
    await this.files.removeFromDisk(removed);
    return voter;
  }

  /**
   * POST /events/:eventId/photos/zip with target "voters" (VTR-06): an image named after a
   * voter's membership ID (e.g. "M-1029.jpg") becomes that voter's photo.
   */
  async uploadZip(actor: AuthState, eventId: string, upload: Upload | undefined) {
    if (!actor.permissions.includes('voter.manage')) throw new AppError('FORBIDDEN');
    const voters = await this.prisma.withContext(this.context(), async (tx) => {
      const event = await tx.votingEvent.findFirst({
        where: { id: eventId, deletedAt: null },
        select: { status: true },
      });
      if (!event) throw new AppError('NOT_FOUND');
      if (event.status !== 'draft') throw new AppError('EVENT_LOCKED');
      return tx.voter.findMany({
        where: { eventId, deletedAt: null },
        select: { id: true, fullName: true, membershipIdNormalized: true },
      });
    });
    const result: PhotoZipResult = await importPhotoZip({
      files: this.files,
      upload,
      kind: 'voter_photo',
      people: voters.map((v) => ({ id: v.id, name: v.fullName, key: v.membershipIdNormalized })),
      keyOf: normalizeMembershipId,
      link: (tx, id, fileId, discard) => this.linkPhoto(tx, eventId, id, fileId, discard),
    });
    return result;
  }

  private async linkPhoto(
    tx: Tx,
    eventId: string,
    voterId: string,
    fileId: string,
    discard: Discard,
  ): Promise<VoterDetail> {
    const before = await this.find(tx, eventId, voterId, { photoFileId: true });
    await tx.voter.update({ where: { id: voterId }, data: { photoFileId: fileId } });
    if (before.photoFileId) await discard(before.photoFileId);
    await this.audit.record(tx, {
      action: 'voter.photo.update',
      entityType: 'voters',
      entityId: voterId,
      eventId,
      before,
      after: { photoFileId: fileId },
    });
    return this.loadDetail(tx, eventId, voterId);
  }

  private async loadDetail(tx: Tx, eventId: string, voterId: string): Promise<VoterDetail> {
    return toDetail(await this.find(tx, eventId, voterId, detailSelect));
  }

  private async find<S extends Prisma.VoterSelect>(
    tx: Tx,
    eventId: string,
    voterId: string,
    select: S,
  ): Promise<Prisma.VoterGetPayload<{ select: S }>> {
    const row = await tx.voter.findFirst({
      where: { id: voterId, eventId, deletedAt: null },
      select,
    });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async assertEvent(tx: Tx, eventId: string): Promise<void> {
    if (!(await tx.votingEvent.count({ where: { id: eventId, deletedAt: null } }))) {
      throw new AppError('NOT_FOUND');
    }
  }

  private async assertCategories(
    tx: Tx,
    eventId: string,
    ids: string[],
    path: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const found = await tx.category.findMany({
      where: { id: { in: ids }, eventId },
      select: { id: true },
    });
    const known = new Set(found.map((c) => c.id));
    const index = ids.findIndex((id) => !known.has(id));
    if (index >= 0) {
      throw new AppError('VALIDATION_FAILED', 'Not a category of this event.', {
        source: 'body',
        issues: [{ path: `${path}.${index}`, code: 'not_found', message: 'not found' }],
      });
    }
  }

  /** Platform administrators have no organization and no events of their own. */
  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
