// Redaction for logs, error reports and audit entries (Tech Stack 11.2: never log request
// bodies on voting endpoints, codes or ballot choices; Backend Schema 7.8: audit before/after
// exclude secrets and codes). Defence in depth: request bodies are never logged at all, and
// these helpers scrub anything that reaches a log line anyway.

/** Object keys whose values are never logged or audited (matched case-insensitively). */
const SENSITIVE_KEY =
  /pass(word)?|secret|token|hash|hmac|cipher|^code$|voting_?code|^pin$|pin_?hash|authorization|cookie|^session(_?id)?$|^sid$|csrf|selections?|contester_?ids|^choices?$|ballot/i;

export const REDACTED = '[redacted]';

/** True when a key holds data that must not be logged or audited. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Voting codes: 8 characters from the unambiguous alphabet (no 0, O, 1, I, L), optionally
 * split as XXXX-XXXX (PRD COD-01). Requires at least one digit, so ordinary capitalised words
 * are left alone; codes always mix letters and digits in practice, and a missed all-letter code
 * still never reaches logs because bodies are not logged.
 */
const VOTING_CODE =
  /\b(?=[A-HJKMNP-Z2-9]{0,4}-?[A-HJKMNP-Z2-9]{0,4}\d)[A-HJKMNP-Z2-9]{4}-?[A-HJKMNP-Z2-9]{4}\b/g;

/** Masks anything shaped like a voting code inside free text. */
export function maskVotingCodes(text: string): string {
  return text.replace(VOTING_CODE, REDACTED);
}

/** Deep copy with sensitive keys replaced by "[redacted]" and voting codes masked in strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return maskVotingCodes(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: maskVotingCodes(value.message) };
  if (ArrayBuffer.isView(value)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(inner, depth + 1);
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A request path safe to log: no query string, and long opaque segments (invite, reset,
 * kiosk and public-results tokens) replaced. UUIDs are kept: they identify records, not secrets.
 */
export function redactPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path
    .split('/')
    .map((segment) => (segment.length >= 20 && !UUID.test(segment) ? REDACTED : segment))
    .map(maskVotingCodes)
    .join('/');
}
