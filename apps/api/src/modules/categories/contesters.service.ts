import { Injectable } from '@nestjs/common';
import {
  type Contester,
  type CreateContesterRequest,
  normalizePersonName,
  PHOTO_ZIP_MAX_FILES,
  type PhotoZipResult,
  type UpdateContesterRequest,
} from '@vote-kidigit/shared';
import { AuditService } from '../../audit/audit.service.js';
import type { AuthState } from '../../auth/auth.types.js';
import { AppError } from '../../common/app-error.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { detectImageType } from '../files/image-processing.js';
import { FilesService, type Upload } from '../files/files.service.js';
import { readZip } from '../files/zip-reader.js';
import { contesterSelect, toContester } from './contesters.mapping.js';

const auditSelect = { fullName: true, party: true, status: true, photoFileId: true } as const;

/** Contesters inside a category (EVT-04b, PRD CAT-03, CAT-04, CAT-08). */
@Injectable()
export class ContestersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** GET /events/:eventId/categories/:categoryId/contesters */
  list(eventId: string, categoryId: string): Promise<{ items: Contester[] }> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.assertCategory(tx, eventId, categoryId);
      const rows = await tx.contester.findMany({
        where: { categoryId },
        orderBy: { createdAt: 'asc' },
        select: contesterSelect,
      });
      return { items: rows.map(toContester) };
    });
  }

  /** POST /events/:eventId/categories/:categoryId/contesters (Draft only: the database). */
  create(eventId: string, categoryId: string, body: CreateContesterRequest): Promise<Contester> {
    return this.prisma.withContext(this.context(), async (tx) => {
      await this.assertCategory(tx, eventId, categoryId);
      const row = await tx.contester.create({
        data: {
          organizationId: this.context().orgId,
          eventId,
          categoryId,
          fullName: body.fullName,
          party: body.party || null,
        },
        select: contesterSelect,
      });
      await this.audit.record(tx, {
        action: 'contester.create',
        entityType: 'contesters',
        entityId: row.id,
        eventId,
        after: { categoryId, fullName: row.fullName, party: row.party },
      });
      return toContester(row);
    });
  }

  /** PATCH /events/:eventId/contesters/:contesterId */
  update(eventId: string, contesterId: string, body: UpdateContesterRequest): Promise<Contester> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.find(tx, eventId, contesterId);
      const row = await tx.contester.update({
        where: { id: contesterId },
        data: {
          ...(body.fullName !== undefined && { fullName: body.fullName }),
          ...(body.party !== undefined && { party: body.party || null }),
        },
        select: contesterSelect,
      });
      await this.audit.record(tx, {
        action: 'contester.update',
        entityType: 'contesters',
        entityId: contesterId,
        eventId,
        before: { fullName: before.fullName, party: before.party },
        after: { fullName: row.fullName, party: row.party },
      });
      return toContester(row);
    });
  }

  /** DELETE /events/:eventId/contesters/:contesterId (Draft only: the database). */
  async remove(eventId: string, contesterId: string): Promise<void> {
    let removed: string[] = [];
    await this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.find(tx, eventId, contesterId);
      await tx.contester.delete({ where: { id: contesterId } });
      if (before.photoFileId) removed = await this.files.deleteRows(tx, [before.photoFileId]);
      await this.audit.record(tx, {
        action: 'contester.delete',
        entityType: 'contesters',
        entityId: contesterId,
        eventId,
        before,
      });
    });
    await this.files.removeFromDisk(removed);
  }

  /**
   * POST …/withdraw (CAT-04): before voting starts, i.e. in Draft or Scheduled. The database
   * refuses it once the event is Open (EVENT_LOCKED).
   */
  withdraw(eventId: string, contesterId: string): Promise<Contester> {
    return this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.find(tx, eventId, contesterId);
      if (before.status === 'withdrawn') {
        throw new AppError('INVALID_TRANSITION', 'The contester has already withdrawn.');
      }
      const row = await tx.contester.update({
        where: { id: contesterId },
        data: { status: 'withdrawn', withdrawnAt: new Date() },
        select: contesterSelect,
      });
      await this.audit.record(tx, {
        action: 'contester.withdraw',
        entityType: 'contesters',
        entityId: contesterId,
        eventId,
        before: { status: before.status },
        after: { status: row.status, withdrawnAt: row.withdrawnAt },
      });
      return toContester(row);
    });
  }

  /** POST …/photo: the cropped 5:7 photo replaces the old one. */
  async uploadPhoto(
    eventId: string,
    contesterId: string,
    upload: Upload | undefined,
  ): Promise<Contester> {
    await this.prisma.withContext(this.context(), (tx) => this.find(tx, eventId, contesterId));
    return this.files.withImage('contester_photo', upload, (tx, file, discard) =>
      this.linkPhoto(tx, eventId, contesterId, file.id, discard),
    );
  }

  /** DELETE …/photo */
  async removePhoto(eventId: string, contesterId: string): Promise<Contester> {
    let removed: string[] = [];
    const contester = await this.prisma.withContext(this.context(), async (tx) => {
      const before = await this.find(tx, eventId, contesterId);
      const row = await tx.contester.update({
        where: { id: contesterId },
        data: { photoFileId: null },
        select: contesterSelect,
      });
      if (before.photoFileId) {
        removed = await this.files.deleteRows(tx, [before.photoFileId]);
        await this.audit.record(tx, {
          action: 'contester.photo.remove',
          entityType: 'contesters',
          entityId: contesterId,
          eventId,
          before: { photoFileId: before.photoFileId },
          after: { photoFileId: null },
        });
      }
      return toContester(row);
    });
    await this.files.removeFromDisk(removed);
    return contester;
  }

  /**
   * POST /events/:eventId/photos/zip (CAT-08): each image whose file name, without extension,
   * is a contester's full name becomes that contester's photo (cover-cropped like any other).
   * Names are compared without case, accents or punctuation; a name shared by two contesters
   * is ambiguous and skipped. Each photo is saved on its own, so one bad file stops nothing.
   */
  async uploadZip(actor: AuthState, eventId: string, upload: Upload | undefined) {
    if (!actor.permissions.includes('contester.manage')) throw new AppError('FORBIDDEN');
    if (!upload) {
      throw new AppError('VALIDATION_FAILED', 'Choose a ZIP file.', {
        source: 'body',
        issues: [{ path: 'file', code: 'required', message: 'required' }],
      });
    }
    const contesters = await this.prisma.withContext(this.context(), async (tx) => {
      const event = await tx.votingEvent.findFirst({
        where: { id: eventId, deletedAt: null },
        select: { status: true },
      });
      if (!event) throw new AppError('NOT_FOUND');
      if (event.status !== 'draft') throw new AppError('EVENT_LOCKED');
      return tx.contester.findMany({ where: { eventId }, select: { id: true, fullName: true } });
    });
    const byName = new Map<string, { id: string; fullName: string }[]>();
    for (const contester of contesters) {
      const key = normalizePersonName(contester.fullName);
      byName.set(key, [...(byName.get(key) ?? []), contester]);
    }

    const entries = readZip(upload.buffer, {
      maxEntries: PHOTO_ZIP_MAX_FILES,
      maxEntryBytes: this.files.maxBytes,
      maxTotalBytes: 200 * 1024 * 1024,
    });
    const result: PhotoZipResult = { matched: [], unmatched: [] };
    for (const entry of entries) {
      const fileName = entry.name;
      if (entry.problem === 'too_large') {
        result.unmatched.push({ fileName, problem: 'too_large' });
        continue;
      }
      if (!entry.data || !detectImageType(entry.data)) {
        result.unmatched.push({ fileName, problem: 'not_image' });
        continue;
      }
      const candidates = byName.get(normalizePersonName(fileName.replace(/\.[^.]+$/, ''))) ?? [];
      const target = candidates[0];
      if (!target || candidates.length > 1) {
        result.unmatched.push({ fileName, problem: target ? 'ambiguous' : 'no_match' });
        continue;
      }
      const data = entry.data;
      try {
        await this.files.withImage(
          'contester_photo',
          { buffer: data, originalname: fileName, size: data.length },
          (tx, file, discard) => this.linkPhoto(tx, eventId, target.id, file.id, discard),
        );
        result.matched.push({ fileName, id: target.id, name: target.fullName });
      } catch (error: unknown) {
        if (!(error instanceof AppError) || error.code !== 'FILE_TYPE') throw error;
        result.unmatched.push({ fileName, problem: 'not_image' });
      }
    }
    return result;
  }

  private async linkPhoto(
    tx: Tx,
    eventId: string,
    contesterId: string,
    fileId: string,
    discard: (fileId: string) => Promise<void>,
  ): Promise<Contester> {
    const before = await this.find(tx, eventId, contesterId);
    const row = await tx.contester.update({
      where: { id: contesterId },
      data: { photoFileId: fileId },
      select: contesterSelect,
    });
    if (before.photoFileId) await discard(before.photoFileId);
    await this.audit.record(tx, {
      action: 'contester.photo.update',
      entityType: 'contesters',
      entityId: contesterId,
      eventId,
      before: { photoFileId: before.photoFileId },
      after: { photoFileId: fileId },
    });
    return toContester(row);
  }

  private async find(tx: Tx, eventId: string, contesterId: string) {
    const row = await tx.contester.findFirst({
      where: { id: contesterId, eventId },
      select: auditSelect,
    });
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async assertCategory(tx: Tx, eventId: string, categoryId: string): Promise<void> {
    if (!(await tx.category.count({ where: { id: categoryId, eventId } }))) {
      throw new AppError('NOT_FOUND');
    }
  }

  /** Platform administrators have no organization and no events of their own. */
  private context() {
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    return { ...ctx, orgId: ctx.orgId };
  }
}
