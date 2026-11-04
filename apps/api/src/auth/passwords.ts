import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

// Argon2id for staff passwords (PRD NFR-13, Tech Stack 6.1), with the library's defaults
// (64 MiB memory, 3 iterations, parallelism 4), above the OWASP minimum.

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // malformed hash: treat as a mismatch
  }
}

/** A hash of a random value, verified when an email is unknown so timing does not reveal it. */
const dummyHash = hashPassword(randomBytes(16).toString('hex'));

export async function verifyAgainstDummy(password: string): Promise<false> {
  await verifyPassword(await dummyHash, password);
  return false;
}
