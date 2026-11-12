// What the reports show, read inside the organization's transaction (RLS applies). Results come
// from the frozen snapshot, never from ballots; who voted comes from voter_participation; the
// categories a voter may vote in come from app.voter_is_eligible(), the one rule for that.
import { maskPhone } from '@vote-kidigit/shared';
import { toString as qrSvg } from 'qrcode';
import { AppError } from '../../common/app-error.js';
import type { Tx } from '../../database/prisma.service.js';
import type { FilesService } from '../files/files.service.js';
import { currentSnapshot, toSnapshot } from '../results/snapshot.js';
import type { ResultsReportData } from './templates/results-report.js';
import type { VoterReportRow, VotersReportData } from './templates/voters-report.js';

type Common = Pick<ResultsReportData, 'language' | 'generatedAt' | 'generatedBy' | 'font'>;

async function eventWithOrganization(tx: Tx, eventId: string) {
  const event = await tx.votingEvent.findFirst({
    where: { id: eventId, deletedAt: null },
    include: { organization: { include: { logoFile: true } } },
  });
  if (!event) throw new AppError('NOT_FOUND');
  return event;
}

/** The organization logo as a data URI, or null when there is none or it is missing on disk. */
async function logoUri(
  files: FilesService,
  logo: { storagePath: string; mimeType: string } | null,
): Promise<string | null> {
  if (!logo) return null;
  try {
    const bytes = await files.read(logo.storagePath);
    return `data:${logo.mimeType};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function resultsReportData(
  tx: Tx,
  files: FilesService,
  eventId: string,
  appUrl: string,
  common: Common,
): Promise<ResultsReportData> {
  const event = await eventWithOrganization(tx, eventId);
  const snapshot = await currentSnapshot(tx, eventId);
  // Results exist only after close (a cancelled event has none).
  if (!snapshot || event.cancelledAt) {
    throw new AppError('INVALID_TRANSITION', 'Results are not ready yet.', {
      reason: 'RESULTS_NOT_READY',
    });
  }
  const publicUrl =
    snapshot.publishedAt && event.publicResultsToken && event.publicResultsEnabled
      ? `${appUrl}/results/${event.publicResultsToken}`
      : null;
  return {
    ...common,
    timeZone: event.organization.timeZone,
    organization: {
      name: event.organization.name,
      logo: await logoUri(files, event.organization.logoFile),
    },
    event: {
      name: event.name,
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
      openedAt: event.openedAt,
      closedAt: event.closedAt,
      resultsPublishedAt: event.resultsPublishedAt,
    },
    // Photos are not printed.
    snapshot: toSnapshot(snapshot, () => null),
    publicUrl,
    qrSvg: publicUrl
      ? await qrSvg(publicUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      : null,
  };
}

export async function votersReportData(
  tx: Tx,
  files: FilesService,
  eventId: string,
  common: Common,
): Promise<VotersReportData> {
  const event = await eventWithOrganization(tx, eventId);
  const [voters, categories, eligible, voted] = await Promise.all([
    tx.voter.findMany({
      where: { eventId, deletedAt: null },
      orderBy: [{ fullName: 'asc' }, { membershipId: 'asc' }],
      select: {
        id: true,
        fullName: true,
        membershipId: true,
        gender: true,
        phone: true,
        codeStatus: true,
      },
    }),
    tx.category.findMany({
      where: { eventId, isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, name: true },
    }),
    tx.$queryRaw<{ voter_id: string; category_id: string }[]>`
      SELECT v.id AS voter_id, c.id AS category_id
      FROM public.voters v
      JOIN public.categories c ON c.event_id = v.event_id AND c.is_active
      WHERE v.event_id = ${eventId}::uuid AND v.deleted_at IS NULL
        AND app.voter_is_eligible(v.id, c.id)`,
    tx.voterParticipation.findMany({
      where: { eventId },
      distinct: ['voterId'],
      select: { voterId: true },
    }),
  ]);
  const byVoter = new Map<string, Set<string>>();
  for (const row of eligible) {
    const set = byVoter.get(row.voter_id) ?? new Set<string>();
    set.add(row.category_id);
    byVoter.set(row.voter_id, set);
  }
  const votedIds = new Set(voted.map((row) => row.voterId));
  const rows: VoterReportRow[] = voters.map((voter) => {
    const mine = byVoter.get(voter.id) ?? new Set<string>();
    return {
      fullName: voter.fullName,
      membershipId: voter.membershipId,
      gender: voter.gender,
      phoneMasked: maskPhone(voter.phone),
      categories: categories.filter((c) => mine.has(c.id)).map((c) => c.name),
      allCategories: categories.length > 0 && mine.size === categories.length,
      voted: votedIds.has(voter.id),
      codeStatus: voter.codeStatus,
    };
  });
  return {
    ...common,
    timeZone: event.organization.timeZone,
    organization: {
      name: event.organization.name,
      logo: await logoUri(files, event.organization.logoFile),
    },
    event: { name: event.name, status: event.status },
    voters: rows,
  };
}
