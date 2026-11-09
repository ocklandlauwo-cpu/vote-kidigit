import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthState } from '../../auth/auth.types.js';
import { EVENT_ACCESS, type EventAccess } from '../../auth/event-access.js';
import { AppError } from '../../common/app-error.js';
import type { Env } from '../../config/env.schema.js';
import { RequestContextService } from '../../context/request-context.js';
import { PrismaService, type Tx } from '../../database/prisma.service.js';
import { type ImageKind, processImage } from './image-processing.js';

/** The part of a Multer file the upload endpoints use (memory storage). */
export interface Upload {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface StoredFile {
  id: string;
  kind: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
}

/** Inside withImage: deletes a replaced file's row now and its bytes after the commit. */
export type Discard = (fileId: string) => Promise<void>;

export interface OpenedFile {
  file: StoredFile;
  /** Bytes on disk (Content-Length). */
  length: number;
  stream: ReadStream;
}

const fileSelect = {
  id: true,
  kind: true,
  storagePath: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  sha256: true,
} as const;

/**
 * Uploaded files (Backend Schema 7.6): bytes under STORAGE_DIR, one row in files each. Rows and
 * bytes are never changed; a new upload is a new file and the replaced one is deleted.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly root: string;
  readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    @Inject(EVENT_ACCESS) private readonly events: EventAccess,
    config: ConfigService<Env, true>,
  ) {
    this.root = path.resolve(config.get('STORAGE_DIR', { infer: true }));
    this.maxBytes = config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024;
  }

  /**
   * Checks and processes an uploaded image, writes it to disk and, in one transaction of the
   * caller's organization, inserts its row and runs `link` (which points a record at it and
   * writes the audit entry). If anything fails the new bytes are removed; files discarded by
   * `link` lose their bytes only after the commit.
   */
  async withImage<T>(
    kind: ImageKind,
    upload: Upload | undefined,
    link: (tx: Tx, file: StoredFile, discard: Discard) => Promise<T>,
  ): Promise<T> {
    if (!upload) {
      throw new AppError('VALIDATION_FAILED', 'Choose a file.', {
        source: 'body',
        issues: [{ path: 'file', code: 'required', message: 'required' }],
      });
    }
    if (upload.size > this.maxBytes) throw new AppError('FILE_TOO_LARGE');
    const image = await processImage(kind, upload.buffer);
    const ctx = this.requestContext.getOrThrow();
    if (!ctx.orgId) throw new AppError('NOT_FOUND');
    const storagePath = `org/${ctx.orgId}/${kind}/${randomUUID()}.${image.extension}`;
    await this.write(storagePath, image.data);
    const discarded: string[] = [];
    let result: T;
    try {
      result = await this.prisma.withContext(ctx, async (tx) => {
        const file = await tx.file.create({
          data: {
            organizationId: ctx.orgId ?? '',
            kind,
            storagePath,
            originalName: upload.originalname.slice(0, 255) || null,
            mimeType: image.mimeType,
            sizeBytes: image.data.length,
            width: image.width,
            height: image.height,
            sha256: createHash('sha256').update(image.data).digest('hex'),
            createdBy: ctx.userId,
          },
          select: fileSelect,
        });
        return link(tx, file, async (fileId) => {
          discarded.push(...(await this.deleteRows(tx, [fileId])));
        });
      });
    } catch (error) {
      await this.removeFromDisk([storagePath]);
      throw error;
    }
    await this.removeFromDisk(discarded);
    return result;
  }

  /** Deletes file rows inside `tx` and returns their storage paths for removeFromDisk. */
  async deleteRows(tx: Tx, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx.file.findMany({
      where: { id: { in: ids } },
      select: { storagePath: true },
    });
    await tx.file.deleteMany({ where: { id: { in: ids } } });
    return rows.map((row) => row.storagePath);
  }

  /** Removes stored bytes; called after the deleting transaction committed. */
  async removeFromDisk(storagePaths: string[]): Promise<void> {
    for (const storagePath of storagePaths) {
      try {
        await rm(this.resolve(storagePath), { force: true });
      } catch (error) {
        this.logger.warn({ message: 'Could not remove a stored file', storagePath, error });
      }
    }
  }

  /**
   * GET /files/:fileId: the file of the caller's organization, if the caller may see what it
   * belongs to. Everything else, including files missing on disk, is NOT_FOUND.
   */
  async open(auth: AuthState, fileId: string): Promise<OpenedFile> {
    const file = await this.prisma.withContext(this.requestContext.getOrThrow(), async (tx) => {
      const row = await tx.file.findUnique({ where: { id: fileId }, select: fileSelect });
      return row && (await this.mayRead(tx, auth, row)) ? row : null;
    });
    if (!file) throw new AppError('NOT_FOUND');
    const absolute = this.resolve(file.storagePath);
    let length: number;
    try {
      length = (await stat(absolute)).size;
    } catch {
      this.logger.warn({ message: 'Stored file is missing on disk', fileId });
      throw new AppError('NOT_FOUND');
    }
    return { file, length, stream: createReadStream(absolute) };
  }

  /** "Owner organization + permission for the file kind" (Backend Schema 12, GET /files/:fileId). */
  private async mayRead(tx: Tx, auth: AuthState, file: StoredFile): Promise<boolean> {
    switch (file.kind) {
      case 'org_logo':
        return true;
      case 'category_picture': {
        const rows = await tx.category.findMany({
          where: { pictureFileId: file.id },
          select: { eventId: true },
        });
        return this.mayReadEventFile(tx, auth, 'event.view', rows);
      }
      case 'contester_photo': {
        const rows = await tx.contester.findMany({
          where: { photoFileId: file.id },
          select: { eventId: true },
        });
        return this.mayReadEventFile(tx, auth, 'event.view', rows);
      }
      case 'voter_photo': {
        const rows = await tx.voter.findMany({
          where: { photoFileId: file.id, deletedAt: null },
          select: { eventId: true },
        });
        return this.mayReadEventFile(tx, auth, 'voter.view', rows);
      }
      default:
        // CSV imports (step 19) and reports (step 26) get their rules with their tables.
        return false;
    }
  }

  /**
   * The same rule as event-scoped routes: the permission, and the event visible to the user
   * (any event with event.access_all; otherwise an active event they are assigned to). A photo
   * that belongs to nothing is visible only with event.access_all.
   */
  private async mayReadEventFile(
    tx: Tx,
    auth: AuthState,
    permission: string,
    owners: { eventId: string }[],
  ): Promise<boolean> {
    if (!auth.permissions.includes(permission)) return false;
    const accessAll = auth.permissions.includes('event.access_all');
    if (owners.length === 0) return accessAll;
    for (const { eventId } of owners) {
      const event = await this.events.findEvent(tx, eventId);
      if (!event) continue;
      if (accessAll) return true;
      if (event.isActive && (await this.events.isAssigned(tx, eventId, auth.userId))) return true;
    }
    return false;
  }

  private async write(storagePath: string, data: Buffer): Promise<void> {
    const absolute = this.resolve(storagePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, absolute);
  }

  /** Storage paths are generated here, but are still kept inside STORAGE_DIR. */
  private resolve(storagePath: string): string {
    const absolute = path.resolve(this.root, storagePath);
    if (!absolute.startsWith(this.root + path.sep)) throw new AppError('NOT_FOUND');
    return absolute;
  }
}
