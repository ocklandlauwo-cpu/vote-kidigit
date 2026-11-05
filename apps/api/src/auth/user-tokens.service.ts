import { Injectable } from '@nestjs/common';
import {
  TOKEN_LIFETIME_MINUTES,
  UserTokenSchema,
  type UserTokenPurpose,
} from '@vote-kidigit/shared';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../common/app-error.js';
import { type DbContext, PrismaService, type Tx } from '../database/prisma.service.js';

/** Row returned by app.find_user_token (migration 007). */
export interface UserTokenRow {
  token_id: string;
  user_id: string;
  organization_id: string | null;
  purpose: UserTokenPurpose;
  expires_at: Date;
  used_at: Date | null;
  user_status: 'invited' | 'active' | 'deactivated';
  is_platform_admin: boolean;
  full_name: string;
  email: string;
  organization_name: string | null;
}

/** Only the SHA-256 of a link token is stored (Backend Schema 4.4). */
export function tokenHash(token: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHash('sha256').update(token).digest());
}

/** The database context of the token's user, for the accept and reset transactions. */
export function userContext(row: UserTokenRow, requestId: string): DbContext {
  return {
    orgId: row.organization_id,
    userId: row.user_id,
    isPlatformAdmin: row.is_platform_admin,
    requestId,
  };
}

/** Invitation and password-reset tokens in user_tokens (Backend Schema 8.2). */
@Injectable()
export class UserTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a token for the user and returns its value, which exists only in the email.
   * Earlier unused tokens of the same purpose stop working: only the newest link is valid.
   */
  async create(
    tx: Tx,
    userId: string,
    purpose: UserTokenPurpose,
    createdBy: string | null = null,
  ): Promise<{ token: string; expiresAt: Date }> {
    await tx.userToken.deleteMany({ where: { userId, purpose, usedAt: null } });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MINUTES[purpose] * 60_000);
    await tx.userToken.create({
      data: { userId, purpose, tokenHash: tokenHash(token), expiresAt, createdBy },
    });
    return { token, expiresAt };
  }

  /**
   * Finds a usable token: NOT_FOUND for unknown or malformed tokens, a
   * token of the other purpose and accounts that can no longer use it; TOKEN_USED once used
   * (or an invitation whose account is already active); TOKEN_EXPIRED after its lifetime.
   * Without `purpose` (GET /auth/tokens/:token serves both screens) either purpose is accepted.
   */
  async find(token: string, requestId: string, expected?: UserTokenPurpose): Promise<UserTokenRow> {
    const row = UserTokenSchema.safeParse(token).success
      ? await this.lookup(token, requestId)
      : undefined;
    if (!row || (expected && row.purpose !== expected) || row.user_status === 'deactivated') {
      throw new AppError('NOT_FOUND');
    }
    const purpose = row.purpose;
    if (row.used_at) throw new AppError('TOKEN_USED');
    if (purpose === 'invite' && row.user_status !== 'invited') throw new AppError('TOKEN_USED');
    if (purpose === 'password_reset' && row.user_status !== 'active') {
      throw new AppError('NOT_FOUND');
    }
    if (row.expires_at <= new Date()) throw new AppError('TOKEN_EXPIRED');
    return row;
  }

  /**
   * Marks the token used, conditionally, inside the transaction that acts on it: of two
   * concurrent submissions of one link only the first succeeds.
   */
  async consume(tx: Tx, tokenId: string): Promise<void> {
    const used = await tx.$queryRaw<{ id: string }[]>`
      UPDATE public.user_tokens SET used_at = now()
      WHERE id = ${tokenId}::uuid AND used_at IS NULL AND expires_at > now()
      RETURNING id`;
    if (used.length === 0) throw new AppError('TOKEN_USED');
  }

  private async lookup(token: string, requestId: string): Promise<UserTokenRow | undefined> {
    const anonymous: DbContext = { orgId: null, userId: null, isPlatformAdmin: false, requestId };
    const [row] = await this.prisma.withContext(
      anonymous,
      (tx) => tx.$queryRaw<UserTokenRow[]>`SELECT * FROM app.find_user_token(${tokenHash(token)})`,
    );
    return row;
  }
}
