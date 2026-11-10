// The ZIP reader of bulk photo uploads: names, stored and deflated files, and the limits.
import { AppError } from '../../common/app-error.js';
import { buildZip } from '../../testing/zip.js';
import { readZip } from './zip-reader.js';

const limits = { maxEntries: 5, maxEntryBytes: 1000, maxTotalBytes: 2500 };
const bytes = (n: number, fill = 7) => Buffer.alloc(n, fill);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error: unknown) {
    return error instanceof AppError ? error.code : 'other';
  }
  return undefined;
}

describe('readZip', () => {
  it('reads deflated and stored files and drops folders, hidden files and macOS metadata', () => {
    const zip = buildZip([
      { name: 'picha/Asha Mollel.jpg', data: bytes(600, 1) },
      { name: 'Juma.png', data: bytes(300, 2), store: true },
      { name: 'picha/', data: bytes(0) },
      { name: '.DS_Store', data: bytes(10) },
      { name: '__MACOSX/picha/._Asha Mollel.jpg', data: bytes(10) },
      { name: 'Neema Mwakyusa.jpg', data: bytes(200, 3) },
    ]);
    const entries = readZip(zip, limits);
    expect(entries.map((e) => [e.name, e.data?.length, e.problem])).toEqual([
      ['Asha Mollel.jpg', 600, null],
      ['Juma.png', 300, null],
      ['Neema Mwakyusa.jpg', 200, null],
    ]);
    expect(entries[0]?.data?.equals(bytes(600, 1))).toBe(true);
  });

  it('lists files above the limits as too large without reading them', () => {
    const zip = buildZip([
      { name: 'kubwa.jpg', data: bytes(1001) },
      { name: 'a.jpg', data: bytes(1000) },
      { name: 'b.jpg', data: bytes(1000) },
      { name: 'c.jpg', data: bytes(1000) },
    ]);
    expect(readZip(zip, limits).map((e) => [e.name, e.problem])).toEqual([
      ['kubwa.jpg', 'too_large'],
      ['a.jpg', null],
      ['b.jpg', null],
      ['c.jpg', 'too_large'],
    ]);
  });

  it('never inflates more than the declared size (ZIP bomb)', () => {
    const zip = buildZip([{ name: 'bomu.jpg', data: bytes(500_000, 0), declaredSize: 900 }]);
    expect(readZip(zip, limits)).toEqual([{ name: 'bomu.jpg', data: null, problem: 'unreadable' }]);
  });

  it('refuses archives with too many files, and anything that is not a ZIP', () => {
    const many = buildZip(
      Array.from({ length: 6 }, (_, i) => ({ name: `${i}.jpg`, data: bytes(1) })),
    );
    expect(codeOf(() => readZip(many, limits))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => readZip(Buffer.from('jina,simu\nJuma,0712'), limits))).toBe('FILE_TYPE');
    expect(codeOf(() => readZip(Buffer.alloc(0), limits))).toBe('FILE_TYPE');
    const truncated = buildZip([{ name: 'a.jpg', data: bytes(100) }]).subarray(0, 60);
    expect(codeOf(() => readZip(truncated, limits))).toBe('FILE_TYPE');
  });
});
