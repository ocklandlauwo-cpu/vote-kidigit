// Small pure helpers of the voter API: signed picture links and the seeded contester order.
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Contester photos and category pictures are shown with <img>, which cannot send the ballot
 * token. Instead the API hands out links signed for one file of one event, valid for a few hours:
 * /api/v1/vote/files/{fileId}?e={eventId}&x={expiry}&s={signature}. The query string never
 * reaches the logs (redactPath) or Sentry (scrubUrl).
 */
export const FILE_LINK_SECONDS = 4 * 60 * 60;

function signature(secret: string, fileId: string, eventId: string, expiry: number): string {
  return createHmac('sha256', secret)
    .update(`file:${fileId}:${eventId}:${expiry}`)
    .digest('base64url');
}

export function signFileLink(
  secret: string,
  fileId: string | null,
  eventId: string,
  now = Date.now(),
): string | null {
  if (!fileId) return null;
  const expiry = Math.floor(now / 1000) + FILE_LINK_SECONDS;
  const sig = signature(secret, fileId, eventId, expiry);
  return `/api/v1/vote/files/${fileId}?e=${eventId}&x=${expiry}&s=${sig}`;
}

export function verifyFileLink(
  secret: string,
  fileId: string,
  query: { e?: unknown; x?: unknown; s?: unknown },
  now = Date.now(),
): string | null {
  const { e, x, s } = query;
  if (typeof e !== 'string' || typeof x !== 'string' || typeof s !== 'string') return null;
  const expiry = Number(x);
  if (!Number.isInteger(expiry) || expiry * 1000 < now) return null;
  const expected = Buffer.from(signature(secret, fileId, e, expiry));
  const given = Buffer.from(s);
  return given.length === expected.length && timingSafeEqual(given, expected) ? e : null;
}

/**
 * The voter's own contester order (Backend Schema 8.4): each id gets a key derived from the
 * session seed, so the order is random per voter and stable for the session.
 */
export function seededOrder<T extends { id: string }>(items: T[], seed: string, salt: string): T[] {
  const key = (id: string) => createHmac('sha256', seed).update(`${salt}:${id}`).digest('hex');
  return items
    .map((item) => ({ item, key: key(item.id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ item }) => item);
}
