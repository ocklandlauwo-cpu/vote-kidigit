// Bulk photos from a ZIP (PRD CAT-08, VTR-06), for contesters (matched by full name) and voters
// (matched by membership ID). Each image becomes one person's photo through FilesService.withImage,
// in its own transaction, so one bad file stops nothing.
import { PHOTO_ZIP_MAX_FILES, type PhotoZipResult } from '@vote-kidigit/shared';
import { AppError } from '../../common/app-error.js';
import type { Tx } from '../../database/prisma.service.js';
import type { Discard, FilesService, Upload } from './files.service.js';
import { detectImageType, type ImageKind } from './image-processing.js';
import { readZip } from './zip-reader.js';

export interface PhotoZipPerson {
  id: string;
  /** Shown in the result ("matched to …"). */
  name: string;
  /** What a file name must match, already normalized. */
  key: string;
}

export async function importPhotoZip(options: {
  files: FilesService;
  upload: Upload | undefined;
  kind: ImageKind;
  people: PhotoZipPerson[];
  /** Normalizes a file name without its extension the same way as PhotoZipPerson.key. */
  keyOf: (baseName: string) => string;
  link: (tx: Tx, personId: string, fileId: string, discard: Discard) => Promise<unknown>;
}): Promise<PhotoZipResult> {
  const { files, upload, kind, people, keyOf, link } = options;
  if (!upload) {
    throw new AppError('VALIDATION_FAILED', 'Choose a ZIP file.', {
      source: 'body',
      issues: [{ path: 'file', code: 'required', message: 'required' }],
    });
  }
  const byKey = new Map<string, PhotoZipPerson[]>();
  for (const person of people) byKey.set(person.key, [...(byKey.get(person.key) ?? []), person]);

  const entries = readZip(upload.buffer, {
    maxEntries: PHOTO_ZIP_MAX_FILES,
    maxEntryBytes: files.maxBytes,
    maxTotalBytes: 200 * 1024 * 1024,
  });
  const result: PhotoZipResult = { matched: [], unmatched: [] };
  for (const entry of entries) {
    const fileName = entry.name;
    if (entry.problem === 'too_large') {
      result.unmatched.push({ fileName, problem: 'too_large' });
      continue;
    }
    const data = entry.data;
    if (!data || !detectImageType(data)) {
      result.unmatched.push({ fileName, problem: 'not_image' });
      continue;
    }
    const candidates = byKey.get(keyOf(fileName.replace(/\.[^.]+$/, ''))) ?? [];
    const person = candidates[0];
    if (!person || candidates.length > 1) {
      result.unmatched.push({ fileName, problem: person ? 'ambiguous' : 'no_match' });
      continue;
    }
    try {
      await files.withImage(
        kind,
        { buffer: data, originalname: fileName, size: data.length },
        (tx, file, discard) => link(tx, person.id, file.id, discard),
      );
      result.matched.push({ fileName, id: person.id, name: person.name });
    } catch (error: unknown) {
      if (!(error instanceof AppError) || error.code !== 'FILE_TYPE') throw error;
      result.unmatched.push({ fileName, problem: 'not_image' });
    }
  }
  return result;
}
