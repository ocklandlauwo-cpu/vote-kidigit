// Setting a staff password, shared by password change, invitation acceptance and reset
// (PRD USR-06). The policy itself is the PasswordSchema in packages/shared.
import { AppError } from '../common/app-error.js';
import type { Tx } from '../database/prisma.service.js';
import { hashPassword, verifyPassword } from './passwords.js';

/** PRD USR-06: the last 5 passwords cannot be reused. */
export const PASSWORD_HISTORY_SIZE = 5;

/** Throws PASSWORD_REUSED when `password` is the current password or one of the last 5. */
export async function assertNotReused(tx: Tx, userId: string, password: string): Promise<void> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });
  const history = await tx.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: PASSWORD_HISTORY_SIZE,
    select: { passwordHash: true },
  });
  const hashes = [user.passwordHash, ...history.map((h) => h.passwordHash)];
  for (const hash of hashes) {
    if (hash && (await verifyPassword(hash, password))) throw new AppError('PASSWORD_REUSED');
  }
}

/**
 * Stores a new password: hash, password_changed_at (the session epoch AuthGuard checks) and a
 * history entry, keeping only the newest PASSWORD_HISTORY_SIZE entries.
 */
export async function savePassword(
  tx: Tx,
  userId: string,
  password: string,
  changedAt: Date,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await tx.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: changedAt },
  });
  await tx.passwordHistory.create({ data: { userId, passwordHash } });
  const keep = await tx.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: PASSWORD_HISTORY_SIZE,
    select: { id: true },
  });
  await tx.passwordHistory.deleteMany({
    where: { userId, id: { notIn: keep.map((k) => k.id) } },
  });
}
