// The current result snapshot of an event as staff see it (RES-01, RES-02), shared by the results
// API and the results PDF.
import type { ResultSnapshot } from '@vote-kidigit/shared';
import type { Tx } from '../../database/prisma.service.js';

export const snapshotInclude = {
  stats: { include: { category: true } },
  rows: { include: { contester: true } },
  ties: { include: { resolver: { select: { fullName: true } } } },
} as const;

export function currentSnapshot(tx: Tx, eventId: string) {
  return tx.resultSnapshot.findFirst({
    where: { eventId, isCurrent: true },
    include: snapshotInclude,
  });
}

export type LoadedSnapshot = NonNullable<Awaited<ReturnType<typeof currentSnapshot>>>;

export function toSnapshot(
  snapshot: LoadedSnapshot,
  photo: (fileId: string | null) => string | null,
): ResultSnapshot {
  const stats = [...snapshot.stats].sort(
    (a, b) => a.category.displayOrder - b.category.displayOrder,
  );
  return {
    id: snapshot.id,
    version: snapshot.version,
    generatedAt: snapshot.generatedAt.toISOString(),
    publishedAt: snapshot.publishedAt?.toISOString() ?? null,
    registeredVoters: snapshot.registeredVoters,
    votersVoted: snapshot.votersVoted,
    contentHash: snapshot.contentHash,
    categories: stats.map((stat) => {
      const tie = snapshot.ties.find((t) => t.categoryId === stat.categoryId);
      return {
        id: stat.categoryId,
        name: stat.category.name,
        seats: stat.category.seats,
        thresholdPct:
          stat.category.thresholdPct === null ? null : Number(stat.category.thresholdPct),
        quorumPct: stat.category.quorumPct === null ? null : Number(stat.category.quorumPct),
        eligibleVoters: stat.eligibleVoters,
        votersVoted: stat.votersVoted,
        validVotes: stat.validVotes,
        skipped: stat.skipped,
        quorumMet: stat.quorumMet,
        thresholdMet: stat.thresholdMet,
        hasTie: stat.hasTie,
        tie: tie
          ? {
              outcome: tie.outcome,
              winnerIds: tie.winnerContesterIds,
              reason: tie.reason,
              resolvedBy: tie.resolver.fullName,
              resolvedAt: tie.resolvedAt.toISOString(),
            }
          : null,
        rows: snapshot.rows
          .filter((row) => row.categoryId === stat.categoryId)
          .sort(
            (a, b) => a.rank - b.rank || a.contester.fullName.localeCompare(b.contester.fullName),
          )
          .map((row) => ({
            contesterId: row.contesterId,
            name: row.contester.fullName,
            party: row.contester.party,
            photoUrl: photo(row.contester.photoFileId),
            choice: row.choice,
            votes: row.votes,
            percent: Number(row.percent),
            rank: row.rank,
            isWinner: row.isWinner,
          })),
      };
    }),
  };
}
