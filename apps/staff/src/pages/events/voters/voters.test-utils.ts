// Test data for the voter screens.
import type { VoterDetail, VoterImport, VoterPage, VoterSummary } from '@vote-kidigit/shared';

export function voter(n: number, name: string, change: Partial<VoterSummary> = {}): VoterSummary {
  return {
    id: `0190f0a1-2b3c-7d4e-8f90-0000000005${String(n).padStart(2, '0')}`,
    fullName: name,
    membershipId: `M-${100 + n}`,
    phoneMasked: `••••••••••${String(100 + n).slice(-3)}`,
    gender: n % 2 ? 'female' : 'male',
    photoUrl: null,
    categoryIds: [],
    codeStatus: 'not_sent',
    codeGeneratedAt: '2026-11-10T08:00:00.000Z',
    ...change,
  };
}

export function voterDetail(summary: VoterSummary, change: Partial<VoterDetail> = {}): VoterDetail {
  return {
    ...summary,
    phone: '+255712345101',
    email: null,
    codeLastSentAt: null,
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: '2026-11-10T08:00:00.000Z',
    messages: [],
    ...change,
  };
}

export function page(items: VoterSummary[]): VoterPage {
  const female = items.filter((v) => v.gender === 'female').length;
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 50,
    totals: { registered: items.length, female, male: items.length - female },
  };
}

export function importResult(change: Partial<VoterImport> = {}): VoterImport {
  return {
    id: '0190f0a1-2b3c-7d4e-8f90-000000000601',
    status: 'validated',
    fileName: 'wapiga.csv',
    totalRows: 4,
    validRows: 1,
    warningRows: 1,
    errorRows: 2,
    importedRows: 0,
    failureReason: null,
    missingColumns: [],
    problems: {
      items: [
        { row: 4, field: 'membership_id', code: 'membership_exists', severity: 'error' },
        { row: 5, field: 'phone', code: 'invalid_phone', severity: 'error' },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    },
    createdAt: '2026-11-10T08:00:00.000Z',
    completedAt: null,
    ...change,
  };
}
