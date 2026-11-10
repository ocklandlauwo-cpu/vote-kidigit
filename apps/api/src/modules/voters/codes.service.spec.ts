// Voting codes (PRD COD-01, COD-02, Backend Schema 5.4): format, uniqueness, the HMAC lookup and
// the encrypted copy for re-sending.
import type { ConfigService } from '@nestjs/config';
import { VOTING_CODE_ALPHABET } from '@vote-kidigit/shared';
import { randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';
import { CodesService } from './codes.service.js';

function service(
  hmacKey = randomBytes(64).toString('hex'),
  aesKey = randomBytes(32).toString('base64'),
) {
  const values: Record<string, string> = { CODE_HMAC_KEY: hmacKey, CODE_ENCRYPTION_KEY: aesKey };
  return new CodesService({ get: (key: string) => values[key] } as unknown as ConfigService<
    Env,
    true
  >);
}

describe('CodesService', () => {
  const codes = service();

  it('draws 8 characters from the unambiguous alphabet, practically never twice', () => {
    const drawn = Array.from({ length: 20_000 }, () => codes.generate());
    for (const code of drawn.slice(0, 500)) {
      expect(code).toHaveLength(8);
      for (const c of code) expect(VOTING_CODE_ALPHABET).toContain(c);
    }
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('finds a code by its fingerprint however it is typed, and only with the same key', () => {
    const code = 'K7M4Q9XR';
    const stored = codes.fingerprint(code);
    expect(Buffer.from(codes.fingerprint('k7m4-q9xr')).equals(Buffer.from(stored))).toBe(true);
    expect(Buffer.from(codes.fingerprint('K7M4Q9XS')).equals(Buffer.from(stored))).toBe(false);
    expect(Buffer.from(service().fingerprint(code)).equals(Buffer.from(stored))).toBe(false);
    expect(stored).toHaveLength(32);
    // The fingerprint does not contain the code.
    expect(Buffer.from(stored).toString('latin1')).not.toContain(code);
  });

  it('encrypts for re-sending and decrypts with the same key only', () => {
    const blob = codes.encrypt('k7m4-q9xr');
    expect(Buffer.from(blob).toString('latin1')).not.toContain('K7M4Q9XR');
    expect(codes.decrypt(blob)).toBe('K7M4Q9XR');
    // A new IV every time: the same code never looks the same twice.
    expect(Buffer.from(codes.encrypt('K7M4Q9XR')).equals(Buffer.from(blob))).toBe(false);
    expect(() => service().decrypt(blob)).toThrow();
    const tampered = Buffer.from(blob);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
    expect(() => codes.decrypt(tampered)).toThrow();
  });

  it('issues a stored code without the plain code', () => {
    const issued = codes.issue();
    expect(Object.keys(issued).sort()).toEqual(['codeCiphertext', 'codeHmac']);
    const code = codes.decrypt(issued.codeCiphertext);
    expect(Buffer.from(codes.fingerprint(code)).equals(Buffer.from(issued.codeHmac))).toBe(true);
  });
});
