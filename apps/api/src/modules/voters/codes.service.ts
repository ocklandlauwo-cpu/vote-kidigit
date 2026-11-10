import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  normalizeVotingCode,
  VOTING_CODE_ALPHABET,
  VOTING_CODE_LENGTH,
} from '@vote-kidigit/shared';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';

/** What a voter row stores for its code; the plain code is not part of it. */
export interface StoredCode {
  codeHmac: Uint8Array<ArrayBuffer>;
  codeCiphertext: Uint8Array<ArrayBuffer>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Voting codes (Backend Schema 5.4, PRD COD-01, COD-02). A code is 8 characters from an
 * unambiguous alphabet drawn with crypto.randomInt. The database keeps an HMAC-SHA256 fingerprint
 * (CODE_HMAC_KEY) for sign-in lookup and an AES-256-GCM copy (CODE_ENCRYPTION_KEY) so the SMS
 * worker can re-send the same code; neither key is in the database, and no endpoint returns a
 * code. Never log a code.
 */
@Injectable()
export class CodesService {
  private readonly hmacKey: Buffer;
  private readonly aesKey: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const hmacKey: string = config.get('CODE_HMAC_KEY', { infer: true });
    const aesKey: string = config.get('CODE_ENCRYPTION_KEY', { infer: true });
    this.hmacKey = Buffer.from(hmacKey, 'hex');
    this.aesKey = Buffer.from(aesKey, 'base64');
  }

  generate(): string {
    let code = '';
    for (let i = 0; i < VOTING_CODE_LENGTH; i += 1) {
      code += VOTING_CODE_ALPHABET[randomInt(VOTING_CODE_ALPHABET.length)];
    }
    return code;
  }

  /** The lookup fingerprint of a code as typed (case, dash and spaces do not matter). */
  fingerprint(code: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(
      createHmac('sha256', this.hmacKey).update(normalizeVotingCode(code)).digest(),
    );
  }

  /** IV (12 bytes) ‖ tag (16 bytes) ‖ ciphertext. */
  encrypt(code: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.aesKey, iv);
    const body = Buffer.concat([cipher.update(normalizeVotingCode(code), 'utf8'), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  /** For the SMS worker only (step 21): the code to send again. */
  decrypt(stored: Uint8Array): string {
    const buffer = Buffer.from(stored);
    const decipher = createDecipheriv('aes-256-gcm', this.aesKey, buffer.subarray(0, IV_BYTES));
    decipher.setAuthTag(buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(buffer.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }

  /** A new random code as it is stored; the plain code is dropped here (sending is step 21). */
  issue(): StoredCode {
    const code = this.generate();
    return { codeHmac: this.fingerprint(code), codeCiphertext: this.encrypt(code) };
  }
}

/** Was this error the per-event unique index on code fingerprints? Then draw a new code. */
export function isCodeCollision(error: unknown): boolean {
  return error instanceof Error && error.message.includes('voters_event_id_code_hmac_key');
}
