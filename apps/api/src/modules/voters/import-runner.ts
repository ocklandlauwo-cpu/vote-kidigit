import { Injectable, Logger } from '@nestjs/common';
import { normalizeMembershipId, normalizePersonName } from '@vote-kidigit/shared';
import { AuditService } from '../../audit/audit.service.js';
import { AppError } from '../../common/app-error.js';
import { type RequestContext, RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { FilesService } from '../files/files.service.js';
import { CodesService, isCodeCollision } from './codes.service.js';
import { type CsvValidation, type ExistingVoters, validateVoterCsv } from './csv-validation.js';

/** Voters inserted per statement (Implementation Plan step 19). */
const BATCH = 500;
/** An import of 10,000 voters fits easily; the transaction may run this long. */
const IMPORT_TIMEOUT_MS = 120_000;

/**
 * The two steps of a CSV import that run in the worker (App Flow 6.6): validate the file into
 * counters and row problems, and, once staff confirm, insert the valid rows with new codes in one
 * transaction (all or nothing). Both run in the organization of the import.
 */
@Injectable()
export class ImportRunner {
  private readonly logger = new Logger(ImportRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: CodesService,
    private readonly files: FilesService,
    private readonly requestContext: RequestContextService,
  ) {}

  /** The file of an import, validated against the event as it is now. */
  async validation(tx: Tx, importId: string): Promise<{ eventId: string; result: CsvValidation }> {
    const row = await tx.voterImport.findUnique({
      where: { id: importId },
      select: { eventId: true, file: { select: { storagePath: true } } },
    });
    if (!row?.file) throw new AppError('NOT_FOUND');
    const text = (await this.files.read(row.file.storagePath)).toString('utf8');
    return {
      eventId: row.eventId,
      result: validateVoterCsv(text, await this.existing(tx, row.eventId)),
    };
  }

  /** Step 1: counters, row problems and the status validated (or failed). */
  async validate(importId: string): Promise<void> {
    try {
      await this.check(importId);
    } catch (error: unknown) {
      const reason = error instanceof AppError ? error.code : 'unreadable';
      this.logger.warn({ message: 'Voter import validation failed', importId, errorCode: reason });
      await this.prisma.withContext(this.context(), (tx) =>
        tx.voterImport.updateMany({
          where: { id: importId, status: 'uploaded' },
          data: { status: 'failed', failureReason: 'unreadable' },
        }),
      );
    }
  }

  private async check(importId: string): Promise<void> {
    await this.prisma.withContext(this.context(), async (tx) => {
      const current = await tx.voterImport.findUnique({
        where: { id: importId },
        select: { status: true },
      });
      if (current?.status !== 'uploaded') return;
      const { result } = await this.validation(tx, importId);
      const failure = result.missingColumns.length
        ? 'missing_columns'
        : result.totalRows === 0
          ? 'empty'
          : null;
      await tx.voterImport.update({
        where: { id: importId },
        data: {
          status: failure ? 'failed' : 'validated',
          failureReason: failure,
          columnMapping: { missing: result.missingColumns },
          totalRows: result.totalRows,
          validRows: result.validRows,
          warningRows: result.warningRows,
          errorRows: result.errorRows,
          errors: result.problems,
        },
      });
    });
  }

  /** Step 2: insert the rows without errors, each with a new code, then mark the import done. */
  async confirm(importId: string): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.prisma.withContext(this.context(), (tx) => this.insert(tx, importId), {
          timeout: IMPORT_TIMEOUT_MS,
        });
        return;
      } catch (error: unknown) {
        if (isCodeCollision(error) && attempt < 3) continue;
        const reason = error instanceof AppError ? error.code : 'INTERNAL';
        this.logger.warn({ message: 'Voter import failed', importId, errorCode: reason });
        await this.prisma.withContext(this.context(), (tx) =>
          tx.voterImport.updateMany({
            where: { id: importId, status: 'importing' },
            data: { status: 'failed', failureReason: reason },
          }),
        );
        return;
      }
    }
  }

  private async insert(tx: Tx, importId: string): Promise<void> {
    const current = await tx.voterImport.findUnique({
      where: { id: importId },
      select: { status: true },
    });
    if (current?.status !== 'importing') return;
    const { eventId, result } = await this.validation(tx, importId);
    const organizationId = this.context().orgId ?? '';
    const now = new Date();
    for (let start = 0; start < result.rows.length; start += BATCH) {
      const rows = result.rows.slice(start, start + BATCH);
      const created = await tx.voter.createManyAndReturn({
        data: rows.map((row) => ({
          organizationId,
          eventId,
          fullName: row.fullName,
          membershipId: row.membershipId,
          phone: row.phone,
          email: row.email,
          gender: row.gender,
          ...this.codes.issue(),
          codeGeneratedAt: now,
        })),
        select: { id: true, membershipIdNormalized: true },
      });
      const idOf = new Map(created.map((v) => [v.membershipIdNormalized, v.id]));
      const links = rows.flatMap((row) =>
        row.categoryIds.map((categoryId) => ({
          categoryId,
          voterId: idOf.get(normalizeMembershipId(row.membershipId)) ?? '',
          organizationId,
        })),
      );
      if (links.length) await tx.categoryVoter.createMany({ data: links });
    }
    await tx.voterImport.update({
      where: { id: importId },
      data: { status: 'completed', importedRows: result.rows.length, completedAt: now },
    });
    // Counts only: the audit log does not list voters.
    await this.audit.record(tx, {
      action: 'voter.import.complete',
      entityType: 'voter_imports',
      entityId: importId,
      eventId,
      after: { imported: result.rows.length, skipped: result.errorRows },
    });
  }

  private async existing(tx: Tx, eventId: string): Promise<ExistingVoters> {
    const [voters, categories] = await Promise.all([
      tx.voter.findMany({
        where: { eventId, deletedAt: null },
        select: { membershipIdNormalized: true, phone: true },
      }),
      tx.category.findMany({
        where: { eventId },
        select: { id: true, name: true, eligibility: true },
      }),
    ]);
    return {
      membershipIds: new Set(voters.map((v) => v.membershipIdNormalized)),
      phones: new Set(voters.map((v) => v.phone)),
      // Only categories with "selected" voters take a list; the others include everyone.
      categories: new Map(
        categories.map((c) => [
          normalizePersonName(c.name),
          c.eligibility === 'selected' ? c.id : null,
        ]),
      ),
    };
  }

  private context(): RequestContext {
    return this.requestContext.getOrThrow();
  }
}
