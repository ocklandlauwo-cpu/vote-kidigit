import { type Contester, fileUrl } from '@vote-kidigit/shared';
import type { Prisma } from '../../generated/prisma/client.js';

export const contesterSelect = {
  id: true,
  categoryId: true,
  fullName: true,
  party: true,
  photoFileId: true,
  status: true,
  withdrawnAt: true,
} satisfies Prisma.ContesterSelect;

export type ContesterRow = Prisma.ContesterGetPayload<{ select: typeof contesterSelect }>;

export function toContester(row: ContesterRow): Contester {
  return {
    id: row.id,
    categoryId: row.categoryId,
    fullName: row.fullName,
    party: row.party,
    photoUrl: row.photoFileId ? fileUrl(row.photoFileId) : null,
    status: row.status,
    withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
  };
}
