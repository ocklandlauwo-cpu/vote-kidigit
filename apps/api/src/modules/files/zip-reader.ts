// A small ZIP reader for bulk photo uploads (PRD CAT-08), on node:zlib only (Tech Stack 1.1
// rule 2: no new dependency). It reads the central directory, supports stored and deflated
// entries, and never inflates more than the limits allow, so a "ZIP bomb" cannot use up memory.
import { inflateRawSync } from 'node:zlib';
import { AppError } from '../../common/app-error.js';

export interface ZipLimits {
  /** Files (not folders) in the archive. */
  maxEntries: number;
  /** Uncompressed size of one file; larger files are listed as too large, not read. */
  maxEntryBytes: number;
  /** Uncompressed size of everything read. */
  maxTotalBytes: number;
}

export interface ZipEntry {
  /** File name without folders, e.g. "Asha Mollel.jpg". */
  name: string;
  data: Buffer | null;
  problem: 'too_large' | 'unreadable' | null;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const notZip = () => new AppError('FILE_TYPE', 'This is not a ZIP file.');

function findEndOfCentralDirectory(zip: Buffer): number {
  // The record is 22 bytes plus a comment of at most 65,535 bytes, at the very end.
  const stop = Math.max(0, zip.length - 22 - 0xffff);
  for (let offset = zip.length - 22; offset >= stop; offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD) return offset;
  }
  throw notZip();
}

/** Lists and reads the files of a ZIP; hidden files and macOS metadata are skipped. */
export function readZip(zip: Buffer, limits: ZipLimits): ZipEntry[] {
  if (zip.length < 22) throw notZip();
  const end = findEndOfCentralDirectory(zip);
  const total = zip.readUInt16LE(end + 10);
  const directoryOffset = zip.readUInt32LE(end + 16);
  if (total === 0xffff || directoryOffset === 0xffffffff) {
    throw new AppError('FILE_TYPE', 'ZIP64 archives are not supported.');
  }

  const entries: ZipEntry[] = [];
  let readBytes = 0;
  let offset = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL) throw notZip();
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const rawName = zip.subarray(offset + 46, offset + 46 + nameLength);
    // Bit 11: the name is UTF-8; otherwise it is CP437, read as Latin-1 (fine for ASCII names).
    const path = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    offset += 46 + nameLength + extraLength + commentLength;

    const name = path.split(/[\\/]/).pop() ?? '';
    if (path.endsWith('/') || !name || name.startsWith('.') || path.startsWith('__MACOSX/')) {
      continue;
    }
    if (entries.length >= limits.maxEntries) {
      throw new AppError('VALIDATION_FAILED', `The ZIP has more than ${limits.maxEntries} files.`, {
        source: 'body',
        issues: [{ path: 'file', code: 'too_many_files', message: 'too many files' }],
      });
    }
    if (size > limits.maxEntryBytes || readBytes + size > limits.maxTotalBytes) {
      entries.push({ name, data: null, problem: 'too_large' });
      continue;
    }
    entries.push({ name, ...readEntry(zip, { flags, method, compressedSize, size, localOffset }) });
    readBytes += size;
  }
  return entries;
}

function readEntry(
  zip: Buffer,
  entry: {
    flags: number;
    method: number;
    compressedSize: number;
    size: number;
    localOffset: number;
  },
): Pick<ZipEntry, 'data' | 'problem'> {
  const unreadable = { data: null, problem: 'unreadable' as const };
  // Bit 0: encrypted.
  if (entry.flags & 0x1) return unreadable;
  const local = entry.localOffset;
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL) return unreadable;
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const compressed = zip.subarray(start, start + entry.compressedSize);
  if (compressed.length !== entry.compressedSize) return unreadable;
  try {
    const data =
      entry.method === 0
        ? Buffer.from(compressed)
        : entry.method === 8
          ? inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) })
          : null;
    // The declared size is what the limits were checked against: it must be the real one.
    if (!data || data.length !== entry.size) return unreadable;
    return { data, problem: null };
  } catch {
    return unreadable;
  }
}
