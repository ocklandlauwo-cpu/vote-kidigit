import { FILE_LINK_SECONDS, seededOrder, signFileLink, verifyFileLink } from './vote-links.js';

const SECRET = 'test-secret';
const FILE = '0190f0a1-2b3c-7d4e-8f90-000000000901';
const EVENT = '0190f0a1-2b3c-7d4e-8f90-0000000000f1';

function queryOf(link: string): Record<string, string> {
  return Object.fromEntries(new URL(link, 'http://x').searchParams);
}

describe('signed picture links', () => {
  it('verifies a fresh link and names its event', () => {
    const link = signFileLink(SECRET, FILE, EVENT) ?? '';
    expect(verifyFileLink(SECRET, FILE, queryOf(link))).toBe(EVENT);
  });

  it('refuses an expired, tampered, foreign or incomplete link', () => {
    const now = Date.now();
    const link = signFileLink(SECRET, FILE, EVENT, now) ?? '';
    const query = queryOf(link);
    expect(verifyFileLink(SECRET, FILE, query, now + (FILE_LINK_SECONDS + 1) * 1000)).toBeNull();
    expect(verifyFileLink(SECRET, FILE, { ...query, e: FILE })).toBeNull();
    expect(verifyFileLink(SECRET, FILE, { ...query, x: String(Number(query.x) + 60) })).toBeNull();
    expect(verifyFileLink('other-secret', FILE, query)).toBeNull();
    expect(verifyFileLink(SECRET, EVENT, query)).toBeNull();
    expect(verifyFileLink(SECRET, FILE, { e: query.e, x: query.x })).toBeNull();
  });

  it('gives no link without a file', () => {
    expect(signFileLink(SECRET, null, EVENT)).toBeNull();
  });
});

describe('seededOrder', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `id-${i}` }));

  it('is stable for one seed and keeps every item', () => {
    const once = seededOrder(items, 'seed-a', 'cat-1');
    expect(seededOrder(items, 'seed-a', 'cat-1')).toEqual(once);
    expect([...once].sort((a, b) => a.id.localeCompare(b.id))).toEqual(items);
  });

  it('differs between seeds and between categories', () => {
    const ids = (seed: string, salt: string) =>
      seededOrder(items, seed, salt)
        .map((i) => i.id)
        .join();
    expect(ids('seed-a', 'cat-1')).not.toBe(ids('seed-b', 'cat-1'));
    expect(ids('seed-a', 'cat-1')).not.toBe(ids('seed-a', 'cat-2'));
  });
});
